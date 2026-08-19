import { basename } from 'node:path'

import { EncryptedFileVault } from '@files'
import { EncryptedApplicationRepository } from '@persistence'
import { deriveApplicationKeys } from '@platform/keys'
import type { StagedRecoveryPackage } from '@recovery'

/**
 * Opens a staged recovery package with its own derived keys and proves the
 * database and the encrypted vault agree before anything is activated.
 */
export async function verifyStagedRecovery(
  staged: StagedRecoveryPackage,
  currentSchemaVersion: number
): Promise<void> {
  if (staged.manifest.source.schemaVersion > currentSchemaVersion) {
    throw new Error(`この復元パッケージは新しい Schema v${staged.manifest.source.schemaVersion} で作成されています。アプリを更新してください。`)
  }
  const keys = deriveApplicationKeys(staged.masterKey)
  const repository = new EncryptedApplicationRepository({
    path: staged.databasePath,
    databaseKey: keys.databaseKey,
    mappingKey: keys.mappingKey
  })
  try {
    repository.rebindStagedFilePaths(staged.vaultDirectory)
    const records = repository.listStagedFileRecords()
    const expectedTokens = new Set(staged.manifest.vaultObjects.map((object) => basename(object.path, '.sesv')))
    if (records.length !== expectedTokens.size || records.some((record) => !expectedTokens.has(record.token))) {
      throw new Error('復元パッケージのデータベースとファイル Manifest が一致しません。')
    }
    const vault = new EncryptedFileVault({ directory: staged.vaultDirectory, key: keys.fileVaultKey })
    for (const record of records) {
      const plaintext = await vault.decryptForLocalProcessing(record)
      plaintext.fill(0)
    }
  } finally {
    repository.close()
    keys.databaseKey.fill(0)
    keys.mappingKey.fill(0)
    keys.fileVaultKey.fill(0)
  }
}
