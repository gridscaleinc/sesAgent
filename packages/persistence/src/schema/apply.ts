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
  migrationV39
} from './migrations'
import { candidateExtractionDraftSchema } from '@resume'

export function applyMigrations(database: Database.Database): void {
  database.exec(migrationV1)
  database
    .prepare('INSERT OR IGNORE INTO schema_migrations(version, applied_at) VALUES (?, ?)')
    .run(1, new Date().toISOString())
  database.exec(migrationV2)
  database
    .prepare('INSERT OR IGNORE INTO schema_migrations(version, applied_at) VALUES (?, ?)')
    .run(2, new Date().toISOString())
  database.exec(migrationV3)
  database
    .prepare('INSERT OR IGNORE INTO schema_migrations(version, applied_at) VALUES (?, ?)')
    .run(3, new Date().toISOString())
  database.exec(migrationV4)
  database
    .prepare('INSERT OR IGNORE INTO schema_migrations(version, applied_at) VALUES (?, ?)')
    .run(4, new Date().toISOString())
  database.exec(migrationV5)
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
  database
    .prepare('INSERT OR IGNORE INTO schema_migrations(version, applied_at) VALUES (?, ?)')
    .run(5, new Date().toISOString())
  database.exec(migrationV6)
  database
    .prepare('INSERT OR IGNORE INTO schema_migrations(version, applied_at) VALUES (?, ?)')
    .run(6, new Date().toISOString())
  database.exec(migrationV7)
  database
    .prepare('INSERT OR IGNORE INTO schema_migrations(version, applied_at) VALUES (?, ?)')
    .run(7, new Date().toISOString())
  database.exec(migrationV8)
  database
    .prepare('INSERT OR IGNORE INTO schema_migrations(version, applied_at) VALUES (?, ?)')
    .run(8, new Date().toISOString())
  const hasV9 = database
    .prepare<[], { version: number }>('SELECT version FROM schema_migrations WHERE version = 9')
    .get()
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
  const hasV10 = database
    .prepare<[], { version: number }>('SELECT version FROM schema_migrations WHERE version = 10')
    .get()
  if (!hasV10) {
    database.exec(migrationV10)
    const violations = database.pragma('foreign_key_check') as unknown[]
    if (violations.length > 0) throw new Error('Schema v10 foreign key verification failed.')
  }
  const hasV11 = database
    .prepare<[], { version: number }>('SELECT version FROM schema_migrations WHERE version = 11')
    .get()
  if (!hasV11) {
    database.exec(migrationV11)
    const violations = database.pragma('foreign_key_check') as unknown[]
    if (violations.length > 0) throw new Error('Schema v11 foreign key verification failed.')
  }
  const hasV12 = database
    .prepare<[], { version: number }>('SELECT version FROM schema_migrations WHERE version = 12')
    .get()
  if (!hasV12) {
    database.exec(migrationV12)
    const violations = database.pragma('foreign_key_check') as unknown[]
    if (violations.length > 0) throw new Error('Schema v12 foreign key verification failed.')
  }
  const hasV13 = database
    .prepare<[], { version: number }>('SELECT version FROM schema_migrations WHERE version = 13')
    .get()
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
  const hasV14 = database
    .prepare<[], { version: number }>('SELECT version FROM schema_migrations WHERE version = 14')
    .get()
  if (!hasV14) {
    database.exec(migrationV14)
    const violations = database.pragma('foreign_key_check') as unknown[]
    if (violations.length > 0) throw new Error('Schema v14 foreign key verification failed.')
  }
  const hasV15 = database
    .prepare<[], { version: number }>('SELECT version FROM schema_migrations WHERE version = 15')
    .get()
  if (!hasV15) {
    database.exec(migrationV15)
    const violations = database.pragma('foreign_key_check') as unknown[]
    if (violations.length > 0) throw new Error('Schema v15 foreign key verification failed.')
  }
  const hasV16 = database
    .prepare<[], { version: number }>('SELECT version FROM schema_migrations WHERE version = 16')
    .get()
  if (!hasV16) {
    database.exec(migrationV16)
    const violations = database.pragma('foreign_key_check') as unknown[]
    if (violations.length > 0) throw new Error('Schema v16 foreign key verification failed.')
  }
  const hasV17 = database
    .prepare<[], { version: number }>('SELECT version FROM schema_migrations WHERE version = 17')
    .get()
  if (!hasV17) {
    database.exec(migrationV17)
    const violations = database.pragma('foreign_key_check') as unknown[]
    if (violations.length > 0) throw new Error('Schema v17 foreign key verification failed.')
  }
  const hasV18 = database
    .prepare<[], { version: number }>('SELECT version FROM schema_migrations WHERE version = 18')
    .get()
  if (!hasV18) {
    database.exec(migrationV18)
    const violations = database.pragma('foreign_key_check') as unknown[]
    if (violations.length > 0) throw new Error('Schema v18 foreign key verification failed.')
  }
  const hasV19 = database
    .prepare<[], { version: number }>('SELECT version FROM schema_migrations WHERE version = 19')
    .get()
  if (!hasV19) {
    database.exec(migrationV19)
    const violations = database.pragma('foreign_key_check') as unknown[]
    if (violations.length > 0) throw new Error('Schema v19 foreign key verification failed.')
  }
  const hasV20 = database
    .prepare<[], { version: number }>('SELECT version FROM schema_migrations WHERE version = 20')
    .get()
  if (!hasV20) {
    database.exec(migrationV20)
    const violations = database.pragma('foreign_key_check') as unknown[]
    if (violations.length > 0) throw new Error('Schema v20 foreign key verification failed.')
  }
  const hasV21 = database
    .prepare<[], { version: number }>('SELECT version FROM schema_migrations WHERE version = 21')
    .get()
  if (!hasV21) {
    database.exec(migrationV21)
    const violations = database.pragma('foreign_key_check') as unknown[]
    if (violations.length > 0) throw new Error('Schema v21 foreign key verification failed.')
  }
  const hasV22 = database
    .prepare<[], { version: number }>('SELECT version FROM schema_migrations WHERE version = 22')
    .get()
  if (!hasV22) {
    database.exec(migrationV22)
    const violations = database.pragma('foreign_key_check') as unknown[]
    if (violations.length > 0) throw new Error('Schema v22 foreign key verification failed.')
  }
  const hasV23 = database
    .prepare<[], { version: number }>('SELECT version FROM schema_migrations WHERE version = 23')
    .get()
  if (!hasV23) {
    database.exec(migrationV23)
    const violations = database.pragma('foreign_key_check') as unknown[]
    if (violations.length > 0) throw new Error('Schema v23 foreign key verification failed.')
  }
  const hasV24 = database
    .prepare<[], { version: number }>('SELECT version FROM schema_migrations WHERE version = 24')
    .get()
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
  const hasV25 = database
    .prepare<[], { version: number }>('SELECT version FROM schema_migrations WHERE version = 25')
    .get()
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
  const hasV26 = database
    .prepare<[], { version: number }>('SELECT version FROM schema_migrations WHERE version = 26')
    .get()
  if (!hasV26) {
    database.exec(migrationV26)
    const violations = database.pragma('foreign_key_check') as unknown[]
    if (violations.length > 0) throw new Error('Schema v26 foreign key verification failed.')
  }
  const hasV27 = database
    .prepare<[], { version: number }>('SELECT version FROM schema_migrations WHERE version = 27')
    .get()
  if (!hasV27) {
    database.exec(migrationV27)
    const violations = database.pragma('foreign_key_check') as unknown[]
    if (violations.length > 0) throw new Error('Schema v27 foreign key verification failed.')
  }
  const hasV28 = database
    .prepare<[], { version: number }>('SELECT version FROM schema_migrations WHERE version = 28')
    .get()
  if (!hasV28) {
    database.exec(migrationV28)
    const violations = database.pragma('foreign_key_check') as unknown[]
    if (violations.length > 0) throw new Error('Schema v28 foreign key verification failed.')
  }
  const hasV29 = database
    .prepare<[], { version: number }>('SELECT version FROM schema_migrations WHERE version = 29')
    .get()
  if (!hasV29) {
    database.exec(migrationV29)
    const violations = database.pragma('foreign_key_check') as unknown[]
    if (violations.length > 0) throw new Error('Schema v29 foreign key verification failed.')
  }
  const hasV30 = database
    .prepare<[], { version: number }>('SELECT version FROM schema_migrations WHERE version = 30')
    .get()
  if (!hasV30) {
    database.exec(migrationV30)
    const violations = database.pragma('foreign_key_check') as unknown[]
    if (violations.length > 0) throw new Error('Schema v30 foreign key verification failed.')
  }
  const hasV31 = database
    .prepare<[], { version: number }>('SELECT version FROM schema_migrations WHERE version = 31')
    .get()
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
  const hasV32 = database
    .prepare<[], { version: number }>('SELECT version FROM schema_migrations WHERE version = 32')
    .get()
  if (!hasV32) {
    database.exec(migrationV32)
    const violations = database.pragma('foreign_key_check') as unknown[]
    if (violations.length > 0) throw new Error('Schema v32 foreign key verification failed.')
  }
  const hasV33 = database
    .prepare<[], { version: number }>('SELECT version FROM schema_migrations WHERE version = 33')
    .get()
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
  const hasV34 = database
    .prepare<[], { version: number }>('SELECT version FROM schema_migrations WHERE version = 34')
    .get()
  if (!hasV34) {
    database.exec(migrationV34)
    const violations = database.pragma('foreign_key_check') as unknown[]
    if (violations.length > 0) throw new Error('Schema v34 foreign key verification failed.')
  }
  const hasV35 = database
    .prepare<[], { version: number }>('SELECT version FROM schema_migrations WHERE version = 35')
    .get()
  if (!hasV35) {
    database.exec(migrationV35)
    const violations = database.pragma('foreign_key_check') as unknown[]
    if (violations.length > 0) throw new Error('Schema v35 foreign key verification failed.')
  }
  const hasV36 = database
    .prepare<[], { version: number }>('SELECT version FROM schema_migrations WHERE version = 36')
    .get()
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
  const hasV37 = database
    .prepare<[], { version: number }>('SELECT version FROM schema_migrations WHERE version = 37')
    .get()
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
  const hasV38 = database
    .prepare<[], { version: number }>('SELECT version FROM schema_migrations WHERE version = 38')
    .get()
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
  const hasV39 = database
    .prepare<[], { version: number }>('SELECT version FROM schema_migrations WHERE version = 39')
    .get()
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
}
