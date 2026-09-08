import { changedBusinessFields, markBusinessFeedSchema, type BusinessFeedEntry, type MarkBusinessFeedInput } from '@shared'
import { createHash, randomUUID } from 'node:crypto'
import { builtInPersonnelTemplates, candidateBusinessStateInputSchema, personnelMessageInputSchema, savePersonnelTemplateSchema,
  type CandidateBusinessState, type PersonnelCopy, type PersonnelMessageInput, type PersonnelTemplate, type PersonnelWorkspace,
  type SetCandidateBusinessStateInput } from '@shared'
import { detectDirectIdentifiers } from '@privacy'
import { DomainStore } from './base'

export class PersonnelStore extends DomainStore {
  feed(): BusinessFeedEntry[] {
    const marks = new Map(this.database.prepare<[], { id: string; revision: string; deferred: number }>('SELECT id,revision,deferred FROM business_feed_marks').all().map((row) => [row.id, row]))
    const caseTimes = new Map(this.database.prepare<[], { review_id: string; updated_at: string; lifecycle_at: string | null }>(
      `SELECT review.review_id,review.updated_at,life.changed_at AS lifecycle_at FROM job_case_review_states review
       LEFT JOIN (SELECT source_review_id,MAX(created_at) AS changed_at FROM job_case_events
         WHERE event_type IN ('archived','restored') GROUP BY source_review_id) life ON life.source_review_id = review.review_id`
    ).all().map((row) => [row.review_id, row]))
    const personTimes = new Map(this.database.prepare<[], { document_id: string; created_at: string; updated_at: string }>(
      'SELECT review.document_id,file.created_at,review.updated_at FROM candidate_review_states review JOIN staged_files file ON file.token = review.document_id'
    ).all().map((row) => [row.document_id, row]))
    const states = new Map(this.database.prepare<[], { payload: string }>('SELECT payload FROM candidate_business_states').all()
      .map((row) => JSON.parse(row.payload) as CandidateBusinessState).map((state) => [state.documentId, state]))
    const entries: BusinessFeedEntry[] = []
    const add = (entry: Omit<BusinessFeedEntry, 'revision' | 'unseen' | 'deferred'>, version: unknown) => {
      const revision = createHash('sha256').update(JSON.stringify(version)).digest('hex')
      const mark = marks.get(`${entry.kind}:${entry.objectId}`)
      entries.push({ ...entry, revision, unseen: mark?.revision !== revision, deferred: mark?.deferred === 1 })
    }
    for (const review of this.stores.jobCases.listJobCaseReviews()) {
      const times = caseTimes.get(review.reviewId)
      const history = this.stores.jobCases.getJobCaseHistory(review.reviewId)
      const previous = history[review.status === 'completed' ? 1 : 0]
      const updatedAt = times?.updated_at ?? review.intakeAt ?? review.messageDate
      const lifecycleLatest = times?.lifecycle_at && times.lifecycle_at >= updatedAt
      add({ kind: 'case', objectId: review.reviewId,
        title: review.fields.find((f) => f.key === 'title')?.value ?? review.redactedSubject,
        event: review.lifecycle === 'archived' ? 'archived' : lifecycleLatest ? 'status-changed' : previous || review.reviewRevision > 1 ? 'updated' : 'created',
        occurredAt: [updatedAt, times?.lifecycle_at ?? ''].sort().at(-1)!, sourceAt: review.messageDate, source: review.sourceType,
        archived: review.lifecycle === 'archived', businessStatus: review.lifecycle, needsReview: review.status !== 'completed',
        fields: review.fields.filter((f) => ['required_skills','rate','location','start_date','remote'].includes(f.key) && f.value).map((f) => ({ key: f.key, value: f.value! })),
        changes: previous ? changedBusinessFields(previous.fields, review.fields) : []
      }, [review.reviewRevision, review.lifecycle, times?.lifecycle_at])
    }
    for (const review of this.stores.candidates.listCandidateReviews()) {
      if (review.recordStatus === 'deleted') continue
      const times = personTimes.get(review.documentId)
      if (!times) continue
      const state = states.get(review.documentId)
      const previous = this.stores.candidates.getCandidateProfileHistory(review.documentId)[review.status === 'completed' ? 1 : 0]
      const stateLatest = state && state.confirmedAt >= times.updated_at
      add({ kind: 'person', objectId: review.documentId,
        title: review.localIdentity?.displayName ?? review.fileName,
        event: review.recordStatus === 'archived' ? 'archived' : stateLatest ? 'status-changed' : previous ? 'updated' : 'created',
        occurredAt: [times.updated_at, state?.confirmedAt ?? ''].sort().at(-1)!, sourceAt: times.created_at, source: 'local-personnel',
        archived: review.recordStatus === 'archived', businessStatus: state?.status ?? 'available', needsReview: false,
        fields: review.fields.filter((f) => ['skills','experience_years','rate','availability','work_style'].includes(f.key) && f.value).map((f) => ({ key: f.key, value: f.value! })),
        changes: stateLatest ? [{ key: 'business_status', before: null, after: state.status }] : previous ? changedBusinessFields(previous.fields, review.fields) : []
      }, [review.reviewRevision, review.profile?.version, review.recordStatus, state?.status, state?.confirmedAt])
    }
    return entries.sort((a, b) => b.occurredAt.localeCompare(a.occurredAt) || a.objectId.localeCompare(b.objectId))
  }

  markFeed(raw: MarkBusinessFeedInput): BusinessFeedEntry[] {
    const input = markBusinessFeedSchema.parse(raw)
    const entries = this.feed()
    const current = entries.find((entry) => entry.kind === input.kind && entry.objectId === input.objectId)
    if (!current || current.revision !== input.revision) throw new Error('信息已更新，请刷新后查看。 / 情報が更新されました。再読込してください。')
    this.database.prepare(`INSERT INTO business_feed_marks(id,case_review_id,candidate_document_id,revision,seen_at,deferred) VALUES (?,?,?,?,?,?)
      ON CONFLICT(id) DO UPDATE SET revision=excluded.revision,seen_at=excluded.seen_at,deferred=CASE WHEN ? = 'seen' THEN business_feed_marks.deferred ELSE excluded.deferred END`)
      .run(`${input.kind}:${input.objectId}`, input.kind === 'case' ? input.objectId : null, input.kind === 'person' ? input.objectId : null,
        input.revision, new Date().toISOString(), input.action === 'defer' ? 1 : 0, input.action)
    return entries.map((entry) => entry === current ? { ...entry, unseen: false, deferred: input.action === 'seen' ? entry.deferred : input.action === 'defer' } : entry)
  }

  private templates(): PersonnelTemplate[] {
    const saved = this.database.prepare<[], { payload: string }>('SELECT payload FROM personnel_templates ORDER BY id').all()
    const values = new Map(builtInPersonnelTemplates().map((item) => [item.id, item]))
    for (const row of saved) { const item = savePersonnelTemplateSchema.parse(JSON.parse(row.payload)); values.set(item.id, item) }
    return [...values.values()]
  }

  workspace(): PersonnelWorkspace {
    return {
      templates: this.templates(),
      states: this.database.prepare<[], { payload: string }>('SELECT payload FROM candidate_business_states').all()
        .map((row) => JSON.parse(row.payload) as CandidateBusinessState),
      copies: this.database.prepare<[], { payload: string }>(`SELECT payload FROM (SELECT payload,created_at,ROW_NUMBER() OVER (PARTITION BY document_id ORDER BY created_at DESC,id DESC) AS rank FROM personnel_copies) WHERE rank <= 20 ORDER BY created_at DESC`).all()
        .map((row) => JSON.parse(row.payload) as PersonnelCopy)
    }
  }

  saveTemplate(raw: PersonnelTemplate): PersonnelTemplate[] {
    const input = savePersonnelTemplateSchema.parse(raw)
    if (detectDirectIdentifiers(`${input.bodyJa}\n${input.bodyZh}`).length) throw new Error('模板中含有联系方式，请移除后保存。 / テンプレート内の連絡先を削除してください。')
    this.database.transaction(() => {
      const current = this.templates().find((item) => item.id === input.id)
      if ((current?.revision ?? 0) !== input.revision) throw new Error('模板已更新，请重新打开。 / テンプレートを再読込してください。')
      const saved = { ...input, revision: input.revision + 1 }
      this.database.prepare('INSERT INTO personnel_templates(id,payload) VALUES (?,?) ON CONFLICT(id) DO UPDATE SET payload=excluded.payload')
        .run(saved.id, JSON.stringify(saved))
    })()
    return this.templates()
  }

  setState(raw: SetCandidateBusinessStateInput, actorId: string): CandidateBusinessState {
    const input = candidateBusinessStateInputSchema.parse(raw)
    const review = this.stores.candidates.getCandidateReview(input.documentId)
    if (!review || review.recordStatus !== 'active') {
      throw new Error('人员记录不存在或已归档。 / 要員情報が存在しないか保管済みです。')
    }
    if ((review.profile?.version ?? 0) !== input.profileVersion || (input.reviewRevision !== undefined && input.reviewRevision !== review.reviewRevision) || (review.status !== 'completed' && input.reviewRevision === undefined)) throw new Error('人员资料已更新，请重新确认。 / 要員情報を再確認してください。')
    const state: CandidateBusinessState = { documentId: input.documentId, profileVersion: input.profileVersion,
      status: input.status, confirmedAt: new Date().toISOString(), actorId }
    this.database.prepare(`INSERT INTO candidate_business_states(document_id,status,profile_version,payload) VALUES (?,?,?,?)
      ON CONFLICT(document_id) DO UPDATE SET status=excluded.status,profile_version=excluded.profile_version,payload=excluded.payload`)
      .run(state.documentId, state.status, state.profileVersion, JSON.stringify(state))
    return state
  }

  validateMessage(raw: PersonnelMessageInput): PersonnelMessageInput {
    const input = personnelMessageInputSchema.parse(raw)
    const review = this.stores.candidates.getCandidateReview(input.documentId)
    if (!review || review.recordStatus !== 'active' || !review.profile || review.profile.status !== 'current' ||
      review.profile.version !== input.profileVersion || (input.reviewRevision !== undefined && input.reviewRevision !== review.reviewRevision)) {
      throw new Error('人员资料已更新或不可用，请刷新后重试。 / 要員情報が更新されたか利用できません。再読込してください。')
    }
    const state = this.database.prepare<[string], { status: string }>('SELECT status FROM candidate_business_states WHERE document_id = ?').get(input.documentId)
    if (state && !['available', 'soon'].includes(state.status)) throw new Error('此人员已入场或暂停营业。 / この要員は参画中または営業停止中です。')
    const template = this.templates().find((item) => item.id === input.templateId)
    if (!template || template.revision !== input.templateRevision) throw new Error('模板已更新，请重新生成文案。 / テンプレート更新後の文面を確認してください。')
    const localIdentity = review.localIdentity
    if ([localIdentity?.displayName, localIdentity?.phone, localIdentity?.email, localIdentity?.address].some((value) => value && input.text.includes(value))) {
      throw new Error('文案包含本地个人身份信息，请使用匿名介绍。 / 匿名の紹介文を使用してください。')
    }
    if (detectDirectIdentifiers(input.text).length) throw new Error('文案中含有联系方式，请检查后重试。 / 文面内の直接識別子を確認してください。')
    return input
  }

  recordCopy(raw: PersonnelMessageInput, actorId: string): PersonnelCopy {
    const input = this.validateMessage(raw)
    const copy: PersonnelCopy = { id: randomUUID(), documentId: input.documentId, profileVersion: input.profileVersion,
      templateId: input.templateId, templateRevision: input.templateRevision, lang: input.lang, createdAt: new Date().toISOString() }
    this.database.prepare('INSERT INTO personnel_copies(id,document_id,created_at,payload,text_hash,actor_id) VALUES (?,?,?,?,?,?)')
      .run(copy.id, copy.documentId, copy.createdAt, JSON.stringify(copy), createHash('sha256').update(input.text).digest('hex'), actorId)
    return copy
  }
}
