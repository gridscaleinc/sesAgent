import { randomUUID } from 'node:crypto'
import {
  jobCaseFieldAliasesSchema,
  localApplicationPreferencesSchema,
  localOperatorProfileSchema,
  saveJobCaseFieldAliasesInputSchema,
  saveLocalApplicationPreferencesInputSchema,
  saveLocalOperatorProfileInputSchema
} from '@shared'
import {
  type JobCaseFieldAliases,
  type LocalApplicationPreferences,
  type LocalOperatorProfile,
  type SaveJobCaseFieldAliasesInput,
  type SaveLocalApplicationPreferencesInput,
  type SaveLocalOperatorProfileInput
} from '@shared/contracts'
import { type JobCaseFieldAliasesRow, type LocalApplicationPreferencesRow, type LocalOperatorProfileRow } from '../rows'
import { DomainStore } from './base'

export class LocalSettingsStore extends DomainStore {
  getLocalOperatorProfile(): LocalOperatorProfile | null {
    const row = this.database
      .prepare<[], LocalOperatorProfileRow>(
        `SELECT operator_id, display_name, role_label, revision, updated_at
         FROM local_operator_profile WHERE singleton = 1`
      )
      .get()
    if (!row) return null
    return localOperatorProfileSchema.parse({
      version: 'local-operator-profile-v1',
      operatorId: row.operator_id,
      displayName: row.display_name,
      roleLabel: row.role_label,
      configured: true,
      revision: row.revision,
      updatedAt: row.updated_at,
      cloudEligible: false
    })
  }

  saveLocalOperatorProfile(
    rawInput: SaveLocalOperatorProfileInput,
    now = new Date()
  ): LocalOperatorProfile {
    const input = saveLocalOperatorProfileInputSchema.parse(rawInput)
    const current = this.getLocalOperatorProfile()
    if ((current && current.revision !== input.expectedRevision) || (!current && input.expectedRevision !== null)) {
      throw new Error('操作員プロフィールが更新されました。再読み込みしてください。')
    }
    const timestamp = now.toISOString()
    const nextRevision = (current?.revision ?? 0) + 1
    const operatorId = current?.operatorId ?? randomUUID()
    this.database
      .prepare(
        `INSERT INTO local_operator_profile(
           singleton, operator_id, display_name, role_label, revision, created_at, updated_at
         ) VALUES (1, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(singleton) DO UPDATE SET
           display_name = excluded.display_name,
           role_label = excluded.role_label,
           revision = excluded.revision,
           updated_at = excluded.updated_at`
      )
      .run(operatorId, input.displayName, input.roleLabel, nextRevision, timestamp, timestamp)
    const saved = this.getLocalOperatorProfile()
    if (!saved) throw new Error('操作員プロフィールを再読み込みできませんでした。')
    return saved
  }

  getLocalApplicationPreferences(): LocalApplicationPreferences | null {
    const row = this.database
      .prepare<[], LocalApplicationPreferencesRow>(
        `SELECT locale, revision, updated_at
         FROM local_application_preferences WHERE singleton = 1`
      )
      .get()
    if (!row) return null
    return localApplicationPreferencesSchema.parse({
      version: 'local-application-preferences-v1',
      locale: row.locale,
      configured: true,
      revision: row.revision,
      updatedAt: row.updated_at,
      cloudEligible: false
    })
  }

  saveLocalApplicationPreferences(
    rawInput: SaveLocalApplicationPreferencesInput,
    now = new Date()
  ): LocalApplicationPreferences {
    const input = saveLocalApplicationPreferencesInputSchema.parse(rawInput)
    const current = this.getLocalApplicationPreferences()
    if ((current && current.revision !== input.expectedRevision) || (!current && input.expectedRevision !== null)) {
      throw new Error('表示設定が更新されました。再読み込みしてください。')
    }
    const timestamp = now.toISOString()
    const nextRevision = (current?.revision ?? 0) + 1
    this.database
      .prepare(
        `INSERT INTO local_application_preferences(
           singleton, locale, revision, created_at, updated_at
         ) VALUES (1, ?, ?, ?, ?)
         ON CONFLICT(singleton) DO UPDATE SET
           locale = excluded.locale,
           revision = excluded.revision,
           updated_at = excluded.updated_at`
      )
      .run(input.locale, nextRevision, timestamp, timestamp)
    const saved = this.getLocalApplicationPreferences()
    if (!saved) throw new Error('表示設定を再読み込みできませんでした。')
    return saved
  }

  getJobCaseFieldAliases(): JobCaseFieldAliases | null {
    const row = this.database
      .prepare<[], JobCaseFieldAliasesRow>(
        'SELECT aliases_json, revision, updated_at FROM job_case_field_aliases WHERE singleton = 1'
      )
      .get()
    if (!row) return null
    return jobCaseFieldAliasesSchema.parse({
      version: 'job-case-field-aliases-v1',
      aliases: JSON.parse(row.aliases_json),
      configured: true,
      revision: row.revision,
      updatedAt: row.updated_at
    })
  }

  saveJobCaseFieldAliases(rawInput: SaveJobCaseFieldAliasesInput, now = new Date()): JobCaseFieldAliases {
    const input = saveJobCaseFieldAliasesInputSchema.parse(rawInput)
    const current = this.getJobCaseFieldAliases()
    if ((current && current.revision !== input.expectedRevision) || (!current && input.expectedRevision !== null)) {
      throw new Error('案件項目の別名が更新されました。再読み込みしてください。')
    }
    const timestamp = now.toISOString()
    const nextRevision = (current?.revision ?? 0) + 1
    // Empty alias lists are dropped so the stored map only carries real entries.
    const aliases = Object.fromEntries(
      Object.entries(input.aliases).filter(([, values]) => Array.isArray(values) && values.length > 0)
    )
    this.database
      .prepare(
        `INSERT INTO job_case_field_aliases(singleton, aliases_json, revision, created_at, updated_at)
         VALUES (1, ?, ?, ?, ?)
         ON CONFLICT(singleton) DO UPDATE SET
           aliases_json = excluded.aliases_json,
           revision = excluded.revision,
           updated_at = excluded.updated_at`
      )
      .run(JSON.stringify(aliases), nextRevision, timestamp, timestamp)
    const saved = this.getJobCaseFieldAliases()
    if (!saved) throw new Error('案件項目の別名を再読み込みできませんでした。')
    return saved
  }
}
