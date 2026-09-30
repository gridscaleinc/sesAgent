import { createHash, randomUUID } from 'node:crypto'
import {
  hasMeaningfulTextChange,
  experienceScopeFor,
  experienceScopeMatches,
  experienceMatches,
  questionBankQuerySchema,
  questionBankControlSchema,
  type BankQuestion,
  type QuestionBankSource,
  type QuestionTemplateDraft,
  type ExperienceContext,
  type CandidateInterviewQuestion,
  type QuestionBankQuery,
  type QuestionBankControl
} from '@shared'
import { DomainStore } from './base'
const hash = (v: unknown) => createHash('sha256').update(JSON.stringify(v)).digest('hex')
export class QuestionBankStore extends DomainStore {
  private owner() {
    return this.stores.localSettings.getLocalOperatorProfile()?.operatorId ?? '00000000-0000-4000-8000-000000000001'
  }
  private entries(): BankQuestion[] {
    return this.database
      .prepare<[], { payload: string }>('SELECT payload FROM question_bank')
      .all()
      .map((r) => JSON.parse(r.payload))
  }
  private write(value: BankQuestion) {
    this.database.prepare('UPDATE question_bank SET payload=? WHERE id=?').run(JSON.stringify(value), value.id)
  }
  list(raw: QuestionBankQuery = {}) {
    const query = questionBankQuerySchema.parse(raw),
      needle = query.search?.normalize('NFKC').toLowerCase() ?? ''
    const entries = this.entries().filter((q) => q.scope.owner === this.owner())
    return entries
      .map((q) => {
        const sourceIds = new Set([q.id])
        for (let size = -1; size !== sourceIds.size;) {
          size = sourceIds.size
          for (const other of entries) if (other.mergedInto && sourceIds.has(other.mergedInto) && !other.enabled) sourceIds.add(other.id)
        }
        const sources = [...sourceIds].reduce(
          (sum, id) =>
            sum + this.database.prepare<[string], { n: number }>('SELECT count(*) n FROM question_bank_sources WHERE bank_id=?').get(id)!.n,
          0
        )
        const uses = this.database
          .prepare<[string], { payload: string; run_id: string; question_id: string }>(
            'SELECT payload,run_id,question_id FROM question_bank_uses WHERE bank_id=?'
          )
          .all(q.id)
          .map((r) => ({ ...(JSON.parse(r.payload) as { edited: boolean }), runId: r.run_id, questionId: r.question_id }))
        const answered = uses.flatMap((use) => {
          const source = this.database
            .prepare<[string, string], { interview_id: string }>(
              'SELECT interview_id FROM question_bank_sources WHERE run_id=? AND question_id=?'
            )
            .get(use.runId, use.questionId)
          return source
            ? (this.stores.growth.answers(source.interview_id)?.answers.filter((a) => a.questionId === use.questionId) ?? [])
            : []
        })
        return {
          ...q,
          sources,
          answerRecords: answered.filter((a) => a.status === 'answered' || a.status === 'partial').length,
          partialAnswers: answered.filter((a) => a.status === 'partial').length,
          adoptions: uses.length,
          edits: uses.filter((u) => u.edited).length,
          enabled: q.enabled && sources > 0,
          state: !sources
            ? ('withdrawn' as const)
            : q.state === 'paused' || q.state === 'withdrawn'
              ? q.state
              : uses.length >= 3
                ? ('frequent' as const)
                : ('available' as const)
        }
      })
      .filter(
        (q) =>
          (query.includeDisabled || q.enabled) &&
          (!query.category || q.category === query.category) &&
          (!needle || [q.text, q.keyword, q.scoringGuide, q.scope.label].join('\n').normalize('NFKC').toLowerCase().includes(needle))
      )
      .sort((a, b) => b.adoptions - a.adoptions || b.updatedAt.localeCompare(a.updatedAt))
      .slice(0, 200)
  }
  applicable(requirements: Array<{ key: string; label: string; value: string }>, context: ExperienceContext) {
    return this.list()
      .filter((q) => experienceScopeMatches(q.scope, context) && experienceMatches(q.keyword, requirements))
      .slice(0, 8)
  }
  control(raw: QuestionBankControl) {
    const input = questionBankControlSchema.parse(raw),
      entry = this.list({ includeDisabled: true }).find((q) => q.id === input.id)
    if (!entry || entry.version !== input.expectedVersion) throw new Error('题库已更新，请刷新 / 質問集が更新されました')
    if (input.enabled && !entry.sources) throw new Error('原始依据已删除，无法恢复 / 元の根拠が削除されました')
    this.write({
      ...entry,
      ...(input.enabled && entry.mergedInto ? { mergedInto: undefined, mergeProtected: true } : {}),
      version: entry.version + 1,
      enabled: input.enabled,
      locked: !input.enabled,
      state: input.enabled ? 'available' : 'paused',
      reason: input.enabled ? 'HR 恢复使用 / HRが利用を再開' : 'HR 停用 / HRが無効化',
      updatedAt: new Date().toISOString()
    })
    return this.list({ includeDisabled: true })
  }
  capture(interviewId: string, questions: CandidateInterviewQuestion[]) {
    this.database.transaction(() => {
      const selected = questions.filter((q) => q.selected)
      for (const row of this.database
        .prepare<[string], { id: string; question_id: string; run_id: string }>(
          'SELECT id,question_id,run_id FROM question_bank_sources WHERE interview_id=?'
        )
        .all(interviewId))
        if (!selected.some((q) => q.id === row.question_id)) {
          this.database.prepare('DELETE FROM question_bank_uses WHERE run_id=? AND question_id=?').run(row.run_id, row.question_id)
          this.database.prepare('DELETE FROM question_bank_sources WHERE id=?').run(row.id)
        }
      for (const question of selected) {
        if (!question.experienceRunId) continue
        const run = this.stores.experience.run(question.experienceRunId),
          original = (run?.output as CandidateInterviewQuestion[] | undefined)?.find((q) => q.id === question.id)
        if (!run || run.input.task !== 'interview' || !original) continue
        this.stores.experience.assertAdoption(run.id, { documentId: run.documentId, reviewId: run.reviewId, interviewId })
        const scope = experienceScopeFor(run.input)
        if (!scope || scope.owner !== this.owner()) continue
        if (original.bankQuestionId) {
          const entry = this.entries().find((q) => q.id === original.bankQuestionId)
          if (entry && entry.scope.owner === scope.owner) {
            const value = {
              edited: hasMeaningfulTextChange(original.text, question.text),
              version: original.bankVersion,
              documentId: run.documentId,
              reviewId: run.reviewId,
              createdAt: new Date().toISOString()
            }
            this.database
              .prepare(
                'INSERT INTO question_bank_uses(run_id,question_id,bank_id,payload) VALUES(?,?,?,?) ON CONFLICT(run_id,question_id) DO UPDATE SET payload=excluded.payload'
              )
              .run(run.id, question.id, entry.id, JSON.stringify(value))
          }
        }
        const prior = this.database
          .prepare<[string, string], { id: string; payload: string }>(
            'SELECT id,payload FROM question_bank_sources WHERE interview_id=? AND question_id=?'
          )
          .get(interviewId, question.id)
        const old = prior ? (JSON.parse(prior.payload) as QuestionBankSource) : null
        if (old?.text === question.text && old.runId === run.id) continue
        const source: QuestionBankSource = {
          id: prior?.id ?? randomUUID(),
          runId: run.id,
          questionId: question.id,
          text: question.text,
          requirement: original.requirement ?? original.sourceLabel ?? '',
          scope,
          bankId: null,
          createdAt: new Date().toISOString()
        }
        if (!source.requirement) continue
        this.database
          .prepare(
            'INSERT INTO question_bank_sources(id,run_id,interview_id,question_id,bank_id,payload) VALUES(?,?,?,?,NULL,?) ON CONFLICT(interview_id,question_id) DO UPDATE SET run_id=excluded.run_id,bank_id=NULL,payload=excluded.payload,analyzed=0'
          )
          .run(source.id, run.id, interviewId, question.id, JSON.stringify(source))
      }
    })()
  }
  pending(): QuestionBankSource[] {
    return this.database
      .prepare<[], { payload: string }>('SELECT payload FROM question_bank_sources WHERE analyzed=0 ORDER BY rowid')
      .all()
      .map((r) => JSON.parse(r.payload))
      .filter((s) => s.scope.owner === this.owner())
      .slice(0, 3)
  }
  accept(source: QuestionBankSource, draft: QuestionTemplateDraft | null) {
    return this.database.transaction(() => {
      const row = this.database
        .prepare<[string], { payload: string }>('SELECT payload FROM question_bank_sources WHERE id=? AND analyzed=0')
        .get(source.id)
      if (!row || row.payload !== JSON.stringify(source)) return
      if (!draft) {
        this.database.prepare('UPDATE question_bank_sources SET analyzed=1 WHERE id=?').run(source.id)
        return
      }
      const family = hash([
        source.scope.kind,
        source.scope.owner,
        source.scope.key,
        source.scope.locale,
        draft.category,
        draft.keyword.normalize('NFKC').toLowerCase(),
        draft.text.normalize('NFKC').replace(/\s+/gu, '').toLowerCase()
      ])
      const found = this.database.prepare<[string], { payload: string }>('SELECT payload FROM question_bank WHERE family=?').get(family)
      let entry: BankQuestion
      if (found) entry = JSON.parse(found.payload)
      else {
        const now = new Date().toISOString()
        entry = {
          id: randomUUID(),
          version: 1,
          scope: source.scope,
          category: draft.category,
          keyword: draft.keyword,
          text: draft.text,
          scoringGuide: draft.scoringGuide,
          enabled: true,
          locked: false,
          reason: '从已保存问题整理 / 保存済み質問から整理',
          createdAt: now,
          updatedAt: now,
          sources: 1,
          adoptions: 0,
          edits: 0,
          state: 'available'
        }
        this.database.prepare('INSERT INTO question_bank(id,family,payload) VALUES(?,?,?)').run(entry.id, family, JSON.stringify(entry))
      }
      this.database.prepare('UPDATE question_bank_sources SET bank_id=?,analyzed=1 WHERE id=?').run(entry.id, source.id)
    })()
  }
  history(id: string): import('@shared').QuestionBankRevision[] {
    if (!this.entries().some((q) => q.id === id && q.scope.owner === this.owner())) return []
    return this.database
      .prepare<[string], { payload: string }>('SELECT payload FROM question_bank_revisions WHERE bank_id=? ORDER BY rowid DESC')
      .all(id)
      .map((r) => JSON.parse(r.payload))
  }
  private sourceRows(): QuestionBankSource[] {
    return this.database
      .prepare<[], { payload: string }>('SELECT payload FROM question_bank_sources WHERE analyzed=1')
      .all()
      .map((r) => JSON.parse(r.payload))
  }
  refinement() {
    for (const current of this.list().filter((q) => !q.locked)) {
      const people = new Set<string>(),
        cases = new Set<string>()
      const sources = this.sourceRows()
        .filter((source) => {
          const run = this.stores.experience.run(source.runId),
            question = (run?.output as CandidateInterviewQuestion[] | undefined)?.find((q) => q.id === source.questionId)
          if (
            question?.bankQuestionId !== current.id ||
            question.bankVersion !== current.version ||
            !hasMeaningfulTextChange(question.text, source.text) ||
            !run?.documentId ||
            people.has(run.documentId) ||
            (run.reviewId && cases.has(run.reviewId))
          )
            return false
          people.add(run.documentId)
          if (run.reviewId) cases.add(run.reviewId)
          return true
        })
        .slice(-5)
      if (sources.length === 5) {
        const signature = hash([current.version, sources])
        if (this.stores.growth.checkpoint('bank-refine:' + current.id) !== signature) return { current, sources, signature }
      }
    }
    return null
  }
  mergeCandidate() {
    const entries = this.list().filter((q) => !q.locked && !q.mergeProtected)
    for (let i = 0; i < entries.length; i++)
      for (const candidate of entries.slice(i + 1)) {
        const current = entries[i]!
        if (
          current.category !== candidate.category ||
          current.keyword.normalize('NFKC').toLowerCase() !== candidate.keyword.normalize('NFKC').toLowerCase() ||
          JSON.stringify(current.scope) !== JSON.stringify(candidate.scope)
        )
          continue
        const signature = hash([current.id, current.version, candidate.id, candidate.version])
        if (this.stores.growth.checkpoint('bank-merge:' + signature)) continue
        const row = this.database
          .prepare<[string], { payload: string }>('SELECT payload FROM question_bank_sources WHERE bank_id=? LIMIT 1')
          .get(candidate.id)
        if (row) return { current, candidate, source: JSON.parse(row.payload) as QuestionBankSource, signature }
      }
    return null
  }
  revise(id: string, version: number, draft: QuestionTemplateDraft, sources: QuestionBankSource[], reason: string) {
    return this.database.transaction(() => {
      const current = this.entries().find((q) => q.id === id && q.scope.owner === this.owner())
      if (!current || current.version !== version || !current.enabled || current.locked) return false
      for (const source of sources) {
        const row = this.database
          .prepare<[string], { payload: string }>('SELECT payload FROM question_bank_sources WHERE id=?')
          .get(source.id)
        if (!row || row.payload !== JSON.stringify(source)) return false
      }
      for (const value of [current, { ...current, text: draft.text, scoringGuide: draft.scoringGuide, version: current.version + 1 }]) {
        const history: import('@shared').QuestionBankRevision = {
          id: randomUUID(),
          bankId: id,
          version: value.version,
          text: value.text,
          scoringGuide: value.scoringGuide,
          reason,
          createdAt: new Date().toISOString(),
          sources: sources.map((s) => s.id),
          sourceHashes: Object.fromEntries(sources.map((s) => [s.id, hash(s)]))
        }
        this.database
          .prepare('INSERT INTO question_bank_revisions(id,bank_id,payload) VALUES(?,?,?)')
          .run(history.id, id, JSON.stringify(history))
      }
      this.write({
        ...current,
        text: draft.text,
        scoringGuide: draft.scoringGuide,
        version: current.version + 1,
        reason,
        updatedAt: new Date().toISOString()
      })
      return true
    })()
  }
  restore(id: string, expectedVersion: number, version: number) {
    const current = this.list({ includeDisabled: true }).find((q) => q.id === id),
      history = this.history(id).find((r) => r.version === version)
    if (!current || current.version !== expectedVersion || !history || !current.sources)
      throw new Error('题库版本或来源已失效 / 質問集の版または根拠が無効です')
    if (
      history.sources.some((sourceId) => {
        const row = this.database
          .prepare<[string], { payload: string }>('SELECT payload FROM question_bank_sources WHERE id=?')
          .get(sourceId)
        return !row || history.sourceHashes?.[sourceId] !== hash(JSON.parse(row.payload))
      })
    )
      throw new Error('原始依据已删除 / 元の根拠が削除されました')
    const next = {
      ...current,
      ...(current.mergedInto ? { mergedInto: undefined, mergeProtected: true } : {}),
      text: history.text,
      scoringGuide: history.scoringGuide,
      version: current.version + 1,
      enabled: true,
      locked: false,
      state: 'available' as const,
      reason: 'HR 恢复历史问法 / HRが以前の質問を復元',
      updatedAt: new Date().toISOString()
    }
    this.write(next)
    return this.list({ includeDisabled: true })
  }
  merge(current: BankQuestion, candidate: BankQuestion, reason: string, source?: QuestionBankSource) {
    this.database.transaction(() => {
      if (source) {
        const row = this.database
          .prepare<[string], { payload: string; bank_id: string }>('SELECT payload,bank_id FROM question_bank_sources WHERE id=?')
          .get(source.id)
        if (!row || row.payload !== JSON.stringify(source) || row.bank_id !== candidate.id) return
      }
      const entries = this.list(),
        a = entries.find((q) => q.id === current.id),
        b = entries.find((q) => q.id === candidate.id)
      if (
        !a ||
        !b ||
        a.version !== current.version ||
        b.version !== candidate.version ||
        a.locked ||
        b.locked ||
        !a.enabled ||
        !b.enabled ||
        a.scope.owner !== this.owner() ||
        b.scope.owner !== this.owner()
      )
        return
      this.write({
        ...b,
        mergedInto: a.id,
        version: b.version + 1,
        enabled: false,
        locked: true,
        state: 'paused',
        reason: '同义问法已合并 / 同等の質問を統合：' + a.text + ' · ' + reason,
        updatedAt: new Date().toISOString()
      })
    })()
  }
  monitor() {
    for (const entry of this.entries().filter((q) => q.enabled && !q.locked && q.scope.owner === this.owner())) {
      const raw = this.database
        .prepare<[string], { payload: string }>('SELECT payload FROM question_bank_uses WHERE bank_id=? ORDER BY rowid DESC')
        .all(entry.id)
        .map((r) => JSON.parse(r.payload))
      const people = new Set<string>(),
        cases = new Set<string>()
      const uses = raw
        .filter((u) => u.version === entry.version)
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
        .filter((u) => {
          if (people.has(u.documentId) || (u.reviewId && cases.has(u.reviewId))) return false
          people.add(u.documentId)
          if (u.reviewId) cases.add(u.reviewId)
          return true
        })
        .slice(0, 10)
      if (uses.length === 10 && uses.slice(0, 5).filter((u) => u.edited).length >= 4 && uses.slice(5).filter((u) => u.edited).length <= 1)
        this.write({
          ...entry,
          version: entry.version + 1,
          enabled: false,
          locked: true,
          state: 'withdrawn',
          reason: '近期独立使用中反复改写，已停止自动复用 / 最近の独立した利用で修正が増えたため自動利用を停止',
          updatedAt: new Date().toISOString()
        })
    }
  }
}
