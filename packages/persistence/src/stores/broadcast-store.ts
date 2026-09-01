import { createHash, randomUUID } from 'node:crypto'
import {
  builtInBroadcastTemplate,
  createBroadcastTemplateInputSchema,
  deleteBroadcastTemplateInputSchema,
  updateBroadcastTemplateInputSchema
} from '@shared'
import {
  type BroadcastTemplate,
  type BroadcastTemplateLine,
  type CaseBroadcastCopy,
  type CaseBroadcastRecord,
  type CreateBroadcastTemplateInput,
  type DeleteBroadcastTemplateInput,
  type UpdateBroadcastTemplateInput
} from '@shared/contracts'
import { type BroadcastTemplateRow, type CaseBroadcastCopyRow, type CaseBroadcastRow } from '../rows'
import { DomainStore } from './base'

/** One copy as the caller hands it over; the store owns id, hash and time. */
export interface CaseBroadcastCopyAppend {
  reviewId: string
  jobCaseId: string
  jobCaseVersion: number
  templateId: string
  templateRevision: number
  lang: CaseBroadcastCopy['lang']
  kind: CaseBroadcastCopy['kind']
  text: string
  actorId: string
}

function templateFromRow(row: BroadcastTemplateRow): BroadcastTemplate {
  return {
    id: row.id,
    name: row.name,
    ratePublic: row.rate_public as BroadcastTemplate['ratePublic'],
    headerJa: row.header_ja,
    headerZh: row.header_zh,
    footerJa: row.footer_ja,
    footerZh: row.footer_zh,
    lines: JSON.parse(row.lines_json) as BroadcastTemplateLine[],
    revision: row.revision,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  }
}

function recordFromRow(row: CaseBroadcastRow): CaseBroadcastRecord {
  return {
    id: row.id,
    reviewId: row.review_id,
    jobCaseId: row.job_case_id,
    jobCaseVersion: row.job_case_version,
    groupId: row.group_id,
    groupName: row.group_name,
    templateId: row.template_id,
    templateRevision: row.template_revision,
    lang: row.lang as CaseBroadcastRecord['lang'],
    kind: row.kind as CaseBroadcastRecord['kind'],
    action: row.action as CaseBroadcastRecord['action'],
    text: row.text,
    textSha256: row.text_sha256,
    actorId: row.actor_id,
    createdAt: row.created_at
  }
}

function copyFromRow(row: CaseBroadcastCopyRow): CaseBroadcastCopy {
  return {
    id: row.id,
    reviewId: row.review_id,
    jobCaseId: row.job_case_id,
    jobCaseVersion: row.job_case_version,
    templateId: row.template_id,
    templateRevision: row.template_revision,
    lang: row.lang as CaseBroadcastCopy['lang'],
    kind: row.kind as CaseBroadcastCopy['kind'],
    text: row.text,
    textSha256: row.text_sha256,
    actorId: row.actor_id,
    createdAt: row.created_at
  }
}

/**
 * 案件配信: message templates and the append-only log of the copies this device
 * performed. Whether a copied message was then posted anywhere is not a fact
 * this device has, so it is not stored. The log deliberately exposes no update
 * or delete method - a copy that happened cannot un-happen, and the only way a
 * row disappears is the controlled deletion of the case it belongs to, through
 * the foreign key cascade. `listCaseBroadcasts` still reads the pre-v43 send
 * ledger so an existing device keeps its history; nothing writes to it.
 */
export class BroadcastStore extends DomainStore {
  /**
   * Stored templates, or the built-in 標準 template when the operator never
   * saved one. Returning the default in code rather than seeding it in the
   * migration means an untouched device always reads the current default.
   */
  listBroadcastTemplates(): BroadcastTemplate[] {
    const rows = this.database
      .prepare<[], BroadcastTemplateRow>('SELECT * FROM broadcast_templates ORDER BY created_at, id')
      .all()
    return rows.length > 0 ? rows.map(templateFromRow) : [builtInBroadcastTemplate()]
  }

  getBroadcastTemplate(id: string): BroadcastTemplate | null {
    return this.listBroadcastTemplates().find((template) => template.id === id) ?? null
  }

  createBroadcastTemplate(rawInput: CreateBroadcastTemplateInput, now = new Date()): BroadcastTemplate[] {
    const input = createBroadcastTemplateInputSchema.parse(rawInput)
    const timestamp = now.toISOString()
    this.database.transaction(() => {
      // Adding the first template must not make the built-in default vanish,
      // so it is written down before the new one joins it.
      this.materializeBuiltInTemplate(timestamp)
      this.persistTemplateRows(randomUUID(), input, 1, timestamp, timestamp)
    })()
    return this.listBroadcastTemplates()
  }

  private materializeBuiltInTemplate(timestamp: string): void {
    const stored = this.database
      .prepare<[], { count: number }>('SELECT count(*) AS count FROM broadcast_templates')
      .get()
    if ((stored?.count ?? 0) > 0) return
    const builtIn = builtInBroadcastTemplate()
    this.persistTemplateRows(builtIn.id, builtIn, builtIn.revision, timestamp, timestamp)
  }

  /** Editing a template bumps its revision, so a ledger row still names what it used. */
  updateBroadcastTemplate(rawInput: UpdateBroadcastTemplateInput, now = new Date()): BroadcastTemplate[] {
    const input = updateBroadcastTemplateInputSchema.parse(rawInput)
    const stored = this.database
      .prepare<[string], BroadcastTemplateRow>('SELECT * FROM broadcast_templates WHERE id = ?')
      .get(input.id)
    const timestamp = now.toISOString()
    // Editing the built-in default materialises it: the device has an opinion now.
    this.persistTemplateRows(input.id, input, (stored?.revision ?? 0) + 1, stored?.created_at ?? timestamp, timestamp)
    return this.listBroadcastTemplates()
  }

  deleteBroadcastTemplate(rawInput: DeleteBroadcastTemplateInput): BroadcastTemplate[] {
    const input = deleteBroadcastTemplateInputSchema.parse(rawInput)
    const stored = this.database
      .prepare<[], { count: number }>('SELECT count(*) AS count FROM broadcast_templates')
      .get()
    if ((stored?.count ?? 0) <= 1) throw new Error('紹介文テンプレートは最低1件必要です。')
    this.database.prepare('DELETE FROM broadcast_templates WHERE id = ?').run(input.id)
    return this.listBroadcastTemplates()
  }

  private persistTemplateRows(
    id: string,
    draft: Omit<UpdateBroadcastTemplateInput, 'id'>,
    revision: number,
    createdAt: string,
    updatedAt: string
  ): void {
    this.database
      .prepare(
        `INSERT INTO broadcast_templates(
           id, name, rate_public, header_ja, header_zh, footer_ja, footer_zh, lines_json, revision, created_at, updated_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           name = excluded.name,
           rate_public = excluded.rate_public,
           header_ja = excluded.header_ja,
           header_zh = excluded.header_zh,
           footer_ja = excluded.footer_ja,
           footer_zh = excluded.footer_zh,
           lines_json = excluded.lines_json,
           revision = excluded.revision,
           updated_at = excluded.updated_at`
      )
      .run(
        id,
        draft.name,
        draft.ratePublic,
        draft.headerJa,
        draft.headerZh,
        draft.footerJa,
        draft.footerZh,
        JSON.stringify(draft.lines),
        revision,
        createdAt,
        updatedAt
      )
  }

  /** Appends one copy. Never updates. */
  appendCaseBroadcastCopy(entry: CaseBroadcastCopyAppend, now = new Date()): CaseBroadcastCopy {
    const copy: CaseBroadcastCopy = {
      ...entry,
      id: randomUUID(),
      textSha256: createHash('sha256').update(entry.text).digest('hex'),
      createdAt: now.toISOString()
    }
    this.database
      .prepare(
        `INSERT INTO case_broadcast_copies(
           id, review_id, job_case_id, job_case_version, template_id, template_revision,
           lang, kind, text, text_sha256, actor_id, created_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        copy.id,
        copy.reviewId,
        copy.jobCaseId,
        copy.jobCaseVersion,
        copy.templateId,
        copy.templateRevision,
        copy.lang,
        copy.kind,
        copy.text,
        copy.textSha256,
        copy.actorId,
        copy.createdAt
      )
    return copy
  }

  listCaseBroadcastCopies(reviewId: string): CaseBroadcastCopy[] {
    return this.database
      .prepare<[string], CaseBroadcastCopyRow>(
        'SELECT * FROM case_broadcast_copies WHERE review_id = ? ORDER BY created_at DESC, id'
      )
      .all(reviewId)
      .map(copyFromRow)
  }

  /** Every copy on this device, newest first; the queue derives from it. */
  listAllCaseBroadcastCopies(): CaseBroadcastCopy[] {
    return this.database
      .prepare<[], CaseBroadcastCopyRow>('SELECT * FROM case_broadcast_copies ORDER BY created_at DESC, id')
      .all()
      .map(copyFromRow)
  }

  /** Pre-v43 send ledger rows for one case. Read-only history. */
  listCaseBroadcasts(reviewId: string): CaseBroadcastRecord[] {
    return this.database
      .prepare<[string], CaseBroadcastRow>(
        'SELECT * FROM case_broadcasts WHERE review_id = ? ORDER BY created_at DESC, id'
      )
      .all(reviewId)
      .map(recordFromRow)
  }

  /** Every pre-v43 ledger row on this device; the queue reads it beside the copies. */
  listAllCaseBroadcasts(): CaseBroadcastRecord[] {
    return this.database
      .prepare<[], CaseBroadcastRow>('SELECT * FROM case_broadcasts ORDER BY created_at DESC, id')
      .all()
      .map(recordFromRow)
  }
}
