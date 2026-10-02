import { openMapping } from '../mappers'
import type { MappingRow } from '../rows'
import { candidateContentFingerprint, jobCaseIntakeFingerprint } from '../intake-deduplication'
import Database from 'better-sqlite3-multiple-ciphers'

import {
  migrationV1,
  migrationV2,
  migrationV3,
  migrationV4,
  migrationV5,
  migrationV6,
  migrationV7,
  migrationV8,
  migrationV9,
  migrationV10,
  migrationV11,
  migrationV12,
  migrationV13,
  migrationV14,
  migrationV15,
  migrationV16,
  migrationV17,
  migrationV18,
  migrationV19,
  migrationV20,
  migrationV21,
  migrationV22,
  migrationV23,
  migrationV24,
  migrationV25,
  migrationV26,
  migrationV27,
  migrationV28,
  migrationV29,
  migrationV30,
  migrationV31,
  migrationV32,
  migrationV33,
  migrationV34,
  migrationV35,
  migrationV36,
  migrationV37,
  migrationV38,
  migrationV39,
  migrationV40,
  migrationV41,
  migrationV42,
  migrationV43,
  migrationV44,
  migrationV45,
  migrationV46,
  migrationV47,
  migrationV48,
  migrationV49,
  migrationV50,
  migrationV51,
  migrationV52,
  migrationV53,
  migrationV54,
  migrationV55,
  migrationV56,
  migrationV57,
  migrationV58,
  migrationV59,
  migrationV60,
  migrationV61,
  migrationV62,
  migrationV63,
  migrationV64,
  migrationV65,
  migrationV66,
  migrationV67
} from './migrations'
import { candidateExtractionDraftSchema } from '@resume'

export function applyMigrations(database: Database.Database, mappingKey: Buffer): void {
  // v1 creates schema_migrations, so a database without that table has run nothing yet.
  const applied = (version: number): boolean =>
    Boolean(
      database.prepare<[], { name: string }>("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'schema_migrations'").get()
    ) && Boolean(database.prepare<[number], { version: number }>('SELECT version FROM schema_migrations WHERE version = ?').get(version))
  const record = (version: number): void => {
    database.prepare('INSERT OR IGNORE INTO schema_migrations(version, applied_at) VALUES (?, ?)').run(version, new Date().toISOString())
  }
  // v1-v8 predate per-migration transactions. They used to run on every open, which re-created tables later
  // migrations retired (candidate_lifecycle) and re-parsed every stored extraction at startup. Each now runs once, atomically.
  const earlyMigrations: Array<[number, string, (() => void)?]> = [
    [1, migrationV1],
    [2, migrationV2],
    [3, migrationV3],
    [4, migrationV4],
    [
      5,
      migrationV5,
      () => {
        const existingExtractions = database
          .prepare<[], { document_id: string; draft_json: string; updated_at: string }>(
            'SELECT document_id, draft_json, updated_at FROM candidate_extractions'
          )
          .all()
        const backfillReview = database.prepare(
          `INSERT OR IGNORE INTO candidate_review_states(
           document_id, extraction_version, extraction_created_at, status, pii_reviewed, revision, updated_at
         ) VALUES (?, ?, ?, 'awaiting-review', 0, 1, ?)`
        )
        for (const row of existingExtractions) {
          const draft = candidateExtractionDraftSchema.parse(JSON.parse(row.draft_json))
          backfillReview.run(row.document_id, draft.version, draft.createdAt, row.updated_at)
        }
      }
    ],
    [6, migrationV6],
    [7, migrationV7],
    [8, migrationV8]
  ]
  for (const [version, sql, backfill] of earlyMigrations) {
    if (applied(version)) continue
    database.transaction(() => {
      database.exec(sql)
      backfill?.()
      record(version)
    })()
  }
  const hasV9 = database.prepare<[], { version: number }>('SELECT version FROM schema_migrations WHERE version = 9').get()
  if (!hasV9) {
    database.pragma('foreign_keys=OFF')
    try {
      database.exec(migrationV9)
    } finally {
      database.pragma('foreign_keys=ON')
    }
    const violations = database.pragma('foreign_key_check') as unknown[]
    if (violations.length > 0) throw new Error('Schema v9 foreign key verification failed.')
  }
  const hasV10 = database.prepare<[], { version: number }>('SELECT version FROM schema_migrations WHERE version = 10').get()
  if (!hasV10) {
    database.exec(migrationV10)
    const violations = database.pragma('foreign_key_check') as unknown[]
    if (violations.length > 0) throw new Error('Schema v10 foreign key verification failed.')
  }
  const hasV11 = database.prepare<[], { version: number }>('SELECT version FROM schema_migrations WHERE version = 11').get()
  if (!hasV11) {
    database.exec(migrationV11)
    const violations = database.pragma('foreign_key_check') as unknown[]
    if (violations.length > 0) throw new Error('Schema v11 foreign key verification failed.')
  }
  const hasV12 = database.prepare<[], { version: number }>('SELECT version FROM schema_migrations WHERE version = 12').get()
  if (!hasV12) {
    database.exec(migrationV12)
    const violations = database.pragma('foreign_key_check') as unknown[]
    if (violations.length > 0) throw new Error('Schema v12 foreign key verification failed.')
  }
  const hasV13 = database.prepare<[], { version: number }>('SELECT version FROM schema_migrations WHERE version = 13').get()
  if (!hasV13) {
    database.pragma('foreign_keys=OFF')
    try {
      database.exec(migrationV13)
    } finally {
      database.pragma('foreign_keys=ON')
    }
    const violations = database.pragma('foreign_key_check') as unknown[]
    if (violations.length > 0) throw new Error('Schema v13 foreign key verification failed.')
  }
  const hasV14 = database.prepare<[], { version: number }>('SELECT version FROM schema_migrations WHERE version = 14').get()
  if (!hasV14) {
    database.exec(migrationV14)
    const violations = database.pragma('foreign_key_check') as unknown[]
    if (violations.length > 0) throw new Error('Schema v14 foreign key verification failed.')
  }
  const hasV15 = database.prepare<[], { version: number }>('SELECT version FROM schema_migrations WHERE version = 15').get()
  if (!hasV15) {
    database.exec(migrationV15)
    const violations = database.pragma('foreign_key_check') as unknown[]
    if (violations.length > 0) throw new Error('Schema v15 foreign key verification failed.')
  }
  const hasV16 = database.prepare<[], { version: number }>('SELECT version FROM schema_migrations WHERE version = 16').get()
  if (!hasV16) {
    database.exec(migrationV16)
    const violations = database.pragma('foreign_key_check') as unknown[]
    if (violations.length > 0) throw new Error('Schema v16 foreign key verification failed.')
  }
  const hasV17 = database.prepare<[], { version: number }>('SELECT version FROM schema_migrations WHERE version = 17').get()
  if (!hasV17) {
    database.exec(migrationV17)
    const violations = database.pragma('foreign_key_check') as unknown[]
    if (violations.length > 0) throw new Error('Schema v17 foreign key verification failed.')
  }
  const hasV18 = database.prepare<[], { version: number }>('SELECT version FROM schema_migrations WHERE version = 18').get()
  if (!hasV18) {
    database.exec(migrationV18)
    const violations = database.pragma('foreign_key_check') as unknown[]
    if (violations.length > 0) throw new Error('Schema v18 foreign key verification failed.')
  }
  const hasV19 = database.prepare<[], { version: number }>('SELECT version FROM schema_migrations WHERE version = 19').get()
  if (!hasV19) {
    database.exec(migrationV19)
    const violations = database.pragma('foreign_key_check') as unknown[]
    if (violations.length > 0) throw new Error('Schema v19 foreign key verification failed.')
  }
  const hasV20 = database.prepare<[], { version: number }>('SELECT version FROM schema_migrations WHERE version = 20').get()
  if (!hasV20) {
    database.exec(migrationV20)
    const violations = database.pragma('foreign_key_check') as unknown[]
    if (violations.length > 0) throw new Error('Schema v20 foreign key verification failed.')
  }
  const hasV21 = database.prepare<[], { version: number }>('SELECT version FROM schema_migrations WHERE version = 21').get()
  if (!hasV21) {
    database.exec(migrationV21)
    const violations = database.pragma('foreign_key_check') as unknown[]
    if (violations.length > 0) throw new Error('Schema v21 foreign key verification failed.')
  }
  const hasV22 = database.prepare<[], { version: number }>('SELECT version FROM schema_migrations WHERE version = 22').get()
  if (!hasV22) {
    database.exec(migrationV22)
    const violations = database.pragma('foreign_key_check') as unknown[]
    if (violations.length > 0) throw new Error('Schema v22 foreign key verification failed.')
  }
  const hasV23 = database.prepare<[], { version: number }>('SELECT version FROM schema_migrations WHERE version = 23').get()
  if (!hasV23) {
    database.exec(migrationV23)
    const violations = database.pragma('foreign_key_check') as unknown[]
    if (violations.length > 0) throw new Error('Schema v23 foreign key verification failed.')
  }
  const hasV24 = database.prepare<[], { version: number }>('SELECT version FROM schema_migrations WHERE version = 24').get()
  if (!hasV24) {
    database.pragma('foreign_keys=OFF')
    try {
      database.exec(migrationV24)
    } finally {
      database.pragma('foreign_keys=ON')
    }
    const violations = database.pragma('foreign_key_check') as unknown[]
    if (violations.length > 0) throw new Error('Schema v24 foreign key verification failed.')
  }
  const hasV25 = database.prepare<[], { version: number }>('SELECT version FROM schema_migrations WHERE version = 25').get()
  if (!hasV25) {
    database.pragma('foreign_keys=OFF')
    try {
      database.exec(migrationV25)
    } finally {
      database.pragma('foreign_keys=ON')
    }
    const violations = database.pragma('foreign_key_check') as unknown[]
    if (violations.length > 0) throw new Error('Schema v25 foreign key verification failed.')
  }
  const hasV26 = database.prepare<[], { version: number }>('SELECT version FROM schema_migrations WHERE version = 26').get()
  if (!hasV26) {
    database.exec(migrationV26)
    const violations = database.pragma('foreign_key_check') as unknown[]
    if (violations.length > 0) throw new Error('Schema v26 foreign key verification failed.')
  }
  const hasV27 = database.prepare<[], { version: number }>('SELECT version FROM schema_migrations WHERE version = 27').get()
  if (!hasV27) {
    database.exec(migrationV27)
    const violations = database.pragma('foreign_key_check') as unknown[]
    if (violations.length > 0) throw new Error('Schema v27 foreign key verification failed.')
  }
  const hasV28 = database.prepare<[], { version: number }>('SELECT version FROM schema_migrations WHERE version = 28').get()
  if (!hasV28) {
    database.exec(migrationV28)
    const violations = database.pragma('foreign_key_check') as unknown[]
    if (violations.length > 0) throw new Error('Schema v28 foreign key verification failed.')
  }
  const hasV29 = database.prepare<[], { version: number }>('SELECT version FROM schema_migrations WHERE version = 29').get()
  if (!hasV29) {
    database.exec(migrationV29)
    const violations = database.pragma('foreign_key_check') as unknown[]
    if (violations.length > 0) throw new Error('Schema v29 foreign key verification failed.')
  }
  const hasV30 = database.prepare<[], { version: number }>('SELECT version FROM schema_migrations WHERE version = 30').get()
  if (!hasV30) {
    database.exec(migrationV30)
    const violations = database.pragma('foreign_key_check') as unknown[]
    if (violations.length > 0) throw new Error('Schema v30 foreign key verification failed.')
  }
  const hasV31 = database.prepare<[], { version: number }>('SELECT version FROM schema_migrations WHERE version = 31').get()
  if (!hasV31) {
    database.pragma('foreign_keys=OFF')
    try {
      database.exec(migrationV31)
    } finally {
      database.pragma('foreign_keys=ON')
    }
    const violations = database.pragma('foreign_key_check') as unknown[]
    if (violations.length > 0) throw new Error('Schema v31 foreign key verification failed.')
  }
  const hasV32 = database.prepare<[], { version: number }>('SELECT version FROM schema_migrations WHERE version = 32').get()
  if (!hasV32) {
    database.exec(migrationV32)
    const violations = database.pragma('foreign_key_check') as unknown[]
    if (violations.length > 0) throw new Error('Schema v32 foreign key verification failed.')
  }
  const hasV33 = database.prepare<[], { version: number }>('SELECT version FROM schema_migrations WHERE version = 33').get()
  if (!hasV33) {
    database.pragma('foreign_keys=OFF')
    try {
      database.exec(migrationV33)
    } finally {
      database.pragma('foreign_keys=ON')
    }
    const violations = database.pragma('foreign_key_check') as unknown[]
    if (violations.length > 0) throw new Error('Schema v33 foreign key verification failed.')
  }
  const hasV34 = database.prepare<[], { version: number }>('SELECT version FROM schema_migrations WHERE version = 34').get()
  if (!hasV34) {
    database.exec(migrationV34)
    const violations = database.pragma('foreign_key_check') as unknown[]
    if (violations.length > 0) throw new Error('Schema v34 foreign key verification failed.')
  }
  const hasV35 = database.prepare<[], { version: number }>('SELECT version FROM schema_migrations WHERE version = 35').get()
  if (!hasV35) {
    database.exec(migrationV35)
    const violations = database.pragma('foreign_key_check') as unknown[]
    if (violations.length > 0) throw new Error('Schema v35 foreign key verification failed.')
  }
  const hasV36 = database.prepare<[], { version: number }>('SELECT version FROM schema_migrations WHERE version = 36').get()
  if (!hasV36) {
    database.pragma('foreign_keys=OFF')
    try {
      database.exec(migrationV36)
    } finally {
      database.pragma('foreign_keys=ON')
    }
    const violations = database.pragma('foreign_key_check') as unknown[]
    if (violations.length > 0) throw new Error('Schema v36 foreign key verification failed.')
  }
  const hasV37 = database.prepare<[], { version: number }>('SELECT version FROM schema_migrations WHERE version = 37').get()
  if (!hasV37) {
    database.pragma('foreign_keys=OFF')
    try {
      database.exec(migrationV37)
    } finally {
      database.pragma('foreign_keys=ON')
    }
    const violations = database.pragma('foreign_key_check') as unknown[]
    if (violations.length > 0) throw new Error('Schema v37 foreign key verification failed.')
  }
  const hasV38 = database.prepare<[], { version: number }>('SELECT version FROM schema_migrations WHERE version = 38').get()
  if (!hasV38) {
    database.pragma('foreign_keys=OFF')
    try {
      database.exec(migrationV38)
    } finally {
      database.pragma('foreign_keys=ON')
    }
    const violations = database.pragma('foreign_key_check') as unknown[]
    if (violations.length > 0) throw new Error('Schema v38 foreign key verification failed.')
  }
  const hasV39 = database.prepare<[], { version: number }>('SELECT version FROM schema_migrations WHERE version = 39').get()
  if (!hasV39) {
    database.pragma('foreign_keys=OFF')
    try {
      database.exec(migrationV39)
    } finally {
      database.pragma('foreign_keys=ON')
    }
    const violations = database.pragma('foreign_key_check') as unknown[]
    if (violations.length > 0) throw new Error('Schema v39 foreign key verification failed.')
  }
  const hasV40 = database.prepare<[], { version: number }>('SELECT version FROM schema_migrations WHERE version = 40').get()
  if (!hasV40) database.exec(migrationV40)
  const hasV41 = database.prepare<[], { version: number }>('SELECT version FROM schema_migrations WHERE version = 41').get()
  if (!hasV41) database.exec(migrationV41)
  const hasV42 = database.prepare<[], { version: number }>('SELECT version FROM schema_migrations WHERE version = 42').get()
  if (!hasV42) database.exec(migrationV42)
  const hasV43 = database.prepare<[], { version: number }>('SELECT version FROM schema_migrations WHERE version = 43').get()
  if (!hasV43) database.exec(migrationV43)
  const hasV44 = database.prepare<[], { version: number }>('SELECT version FROM schema_migrations WHERE version = 44').get()
  if (!hasV44) database.exec(migrationV44)
  const hasV45 = database.prepare<[], { version: number }>('SELECT version FROM schema_migrations WHERE version = 45').get()
  if (!hasV45) database.exec(migrationV45)
  if (!database.prepare('SELECT version FROM schema_migrations WHERE version = 46').get()) database.exec(migrationV46)
  if (!database.prepare('SELECT version FROM schema_migrations WHERE version = 47').get()) database.exec(migrationV47)
  if (!database.prepare('SELECT version FROM schema_migrations WHERE version = 48').get()) database.exec(migrationV48)
  if (!database.prepare('SELECT version FROM schema_migrations WHERE version = 49').get()) {
    database.pragma('foreign_keys=OFF')
    try {
      database.exec(migrationV49)
    } catch (error) {
      if (database.inTransaction) database.exec('ROLLBACK')
      throw error
    } finally {
      database.pragma('foreign_keys=ON')
    }
    if ((database.pragma('foreign_key_check') as unknown[]).length) throw new Error('Schema v49 foreign key verification failed.')
  }
  if (!database.prepare('SELECT version FROM schema_migrations WHERE version = 50').get()) database.exec(migrationV50)
  if (!database.prepare('SELECT version FROM schema_migrations WHERE version = 51').get()) {
    database.transaction(() => {
      database.exec(migrationV51)
      const update = database.prepare('UPDATE parsed_documents SET intake_fingerprint = ? WHERE document_id = ?')
      const documents = database
        .prepare<[], { document_id: string; document_ir_json: string }>('SELECT document_id, document_ir_json FROM parsed_documents')
        .all()
      for (const row of documents) update.run(candidateContentFingerprint(JSON.parse(row.document_ir_json)), row.document_id)
      const updateCase = database.prepare('UPDATE job_case_sources SET intake_fingerprint = ? WHERE id = ?')
      const sources = database
        .prepare<[], { id: string; redacted_subject: string; redacted_body: string; redaction_session_id: string }>(
          'SELECT id, redacted_subject, redacted_body, redaction_session_id FROM job_case_sources'
        )
        .all()
      const mappingRows = database.prepare<[string], MappingRow>(
        'SELECT placeholder, identifier_type, encrypted_original FROM local_pii_mappings WHERE redaction_session_id = ?'
      )
      for (const row of sources) {
        const mappings = mappingRows.all(row.redaction_session_id).map((mapping) => ({
          placeholder: mapping.placeholder,
          originalValue: openMapping(mappingKey, mapping, row.redaction_session_id)
        }))
        updateCase.run(jobCaseIntakeFingerprint(row.redacted_subject, row.redacted_body, mappings), row.id)
      }
      database.prepare('INSERT INTO schema_migrations(version, applied_at) VALUES (51, ?)').run(new Date().toISOString())
    })()
  }
  if (!database.prepare('SELECT version FROM schema_migrations WHERE version = 52').get()) database.exec(migrationV52)
  if (!database.prepare('SELECT version FROM schema_migrations WHERE version = 53').get()) database.exec(migrationV53)
  if (!database.prepare('SELECT version FROM schema_migrations WHERE version = 54').get()) {
    database.pragma('foreign_keys=OFF')
    try {
      database.exec(migrationV54)
    } catch (error) {
      if (database.inTransaction) database.exec('ROLLBACK')
      throw error
    } finally {
      database.pragma('foreign_keys=ON')
    }
    if ((database.pragma('foreign_key_check') as unknown[]).length) throw new Error('Schema v54 foreign key verification failed.')
  }
  if (!database.prepare('SELECT version FROM schema_migrations WHERE version = 55').get()) database.exec(migrationV55)
  if (!database.prepare('SELECT version FROM schema_migrations WHERE version = 56').get()) database.exec(migrationV56)
  if (!database.prepare('SELECT version FROM schema_migrations WHERE version = 57').get()) database.exec(migrationV57)
  if (!database.prepare('SELECT version FROM schema_migrations WHERE version = 58').get()) database.exec(migrationV58)
  if (!database.prepare('SELECT version FROM schema_migrations WHERE version = 59').get()) database.exec(migrationV59)
  if (!database.prepare('SELECT version FROM schema_migrations WHERE version = 60').get()) database.exec(migrationV60)
  if (!database.prepare('SELECT version FROM schema_migrations WHERE version = 61').get()) database.exec(migrationV61)
  if (!database.prepare('SELECT version FROM schema_migrations WHERE version = 62').get()) database.exec(migrationV62)
  if (!database.prepare('SELECT version FROM schema_migrations WHERE version = 63').get()) database.exec(migrationV63)
  if (!database.prepare('SELECT version FROM schema_migrations WHERE version = 64').get()) database.exec(migrationV64)
  if (!database.prepare('SELECT version FROM schema_migrations WHERE version = 65').get()) database.exec(migrationV65)
  if (!database.prepare('SELECT version FROM schema_migrations WHERE version = 66').get()) database.exec(migrationV66)
  if (!database.prepare('SELECT version FROM schema_migrations WHERE version = 67').get()) database.exec(migrationV67)
  // People archived by an earlier version, which no longer has archiving: hidden from 人员 and matching with no way
  // back, they still made an import of the same résumé count as 该人员已入库. They return as ordinary people.
  database.prepare("UPDATE candidate_records SET record_status = 'active' WHERE record_status = 'archived'").run()
  // Introductions for a case deleted before deletion took them along: the case's text must not outlive it.
  database
    .prepare(
      `DELETE FROM personnel_introduction_drafts
       WHERE case_review_id <> '' AND case_review_id NOT IN (SELECT review_id FROM job_case_extractions)`
    )
    .run()
}
