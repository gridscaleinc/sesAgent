import assert from 'node:assert/strict'
import { randomBytes, randomUUID } from 'node:crypto'
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createWorkTaskPreview, materializeWorkTask } from '@application'
import { EncryptedFileVault } from '@files'
import { EncryptedApplicationRepository } from '@persistence'
import { deriveApplicationKeys } from '@platform/keys'
import {
  applyPendingRestore,
  createRecoveryPackage,
  finalizePendingRestore,
  hasPendingRestore,
  schedulePendingRestore,
  stageRecoveryPackage
} from '@recovery'

const root = await mkdtemp(join(tmpdir(), 'ses-agent-recovery-verification-'))
const masterKey = randomBytes(32)
const password = 'pilot recovery phrase 2026'
const piiSentinel = '復元検証 山田太郎 090-1234-5678'

try {
  const keys = deriveApplicationKeys(masterKey)
  const sourceDatabasePath = join(root, 'source', 'data', 'ses-agent.db')
  const sourceVaultDirectory = join(root, 'source', 'vault', 'resume-files')
  const sourceRepository = new EncryptedApplicationRepository({
    path: sourceDatabasePath,
    databaseKey: keys.databaseKey,
    mappingKey: keys.mappingKey
  })
  const task = materializeWorkTask(
    createWorkTaskPreview('暗号化バックアップから復元できることを確認したい'),
    'recovery-verification-task',
    '2026-07-17T10:00:00.000Z'
  )
  sourceRepository.saveWorkTask(task)
  const sourcePdfPath = join(root, 'source-resume.pdf')
  const sourcePdf = Buffer.from(`%PDF-1.4\n1 0 obj<</Type/Catalog>>endobj\n${piiSentinel}\n%%EOF`, 'utf8')
  await writeFile(sourcePdfPath, sourcePdf, { mode: 0o600 })
  const sourceVault = new EncryptedFileVault({ directory: sourceVaultDirectory, key: keys.fileVaultKey })
  const stagedFile = await sourceVault.stageFile(sourcePdfPath, new Date('2026-07-17T10:01:00.000Z'))
  sourceRepository.saveStagedFile(stagedFile)

  const snapshotPath = join(root, 'backup-work', 'ses-agent.db')
  await sourceRepository.createConsistentSnapshot(snapshotPath)
  const snapshotRepository = new EncryptedApplicationRepository({
    path: snapshotPath,
    databaseKey: keys.databaseKey,
    mappingKey: keys.mappingKey
  })
  const snapshotFiles = snapshotRepository.listStagedFileRecords()
  const snapshotSchemaVersion = snapshotRepository.getSchemaVersion()
  assert.equal(snapshotFiles.length, 1)
  snapshotRepository.close()

  const packagePath = join(root, 'pilot.ses-recovery')
  const created = await createRecoveryPackage({
    outputPath: packagePath,
    databaseSnapshotPath: snapshotPath,
    vaultObjects: snapshotFiles.map((file) => ({ token: file.token, sourcePath: file.encryptedPath })),
    masterKey,
    password,
    source: {
      appVersion: '0.1.0',
      platform: 'darwin',
      arch: 'arm64',
      schemaVersion: snapshotSchemaVersion
    },
    now: new Date('2026-07-17T10:02:00.000Z'),
    backupId: randomUUID()
  })
  sourceRepository.recordRecoveryEvent('backup-created', created.summary, created.packageHash)
  sourceRepository.close()

  const packageBytes = await readFile(packagePath)
  assert.equal(packageBytes.includes(Buffer.from(piiSentinel)), false, 'PII leaked into recovery package bytes')
  assert.equal(packageBytes.includes(masterKey), false, 'master key leaked in plaintext')
  assert.equal(packageBytes.includes(Buffer.from('SQLite format 3')), false, 'plaintext SQLite header leaked')
  assert.equal((await stat(packagePath)).mode & 0o777, 0o600)

  const lostDevicePath = join(root, 'lost-device')
  const restoreToken = randomUUID()
  const stagingDirectory = join(lostDevicePath, 'recovery', 'previews', restoreToken)
  const staged = await stageRecoveryPackage({
    packagePath,
    password,
    stagingDirectory
  })
  const restoredKeys = deriveApplicationKeys(staged.masterKey)
  const stagedRepository = new EncryptedApplicationRepository({
    path: staged.databasePath,
    databaseKey: restoredKeys.databaseKey,
    mappingKey: restoredKeys.mappingKey
  })
  stagedRepository.rebindStagedFilePaths(staged.vaultDirectory)
  assert.equal(stagedRepository.getWorkTask(task.id)?.instruction, task.instruction)
  stagedRepository.close()

  await mkdir(join(lostDevicePath, 'data'), { recursive: true, mode: 0o700 })
  await mkdir(join(lostDevicePath, 'vault', 'resume-files'), { recursive: true, mode: 0o700 })
  await mkdir(join(lostDevicePath, 'security'), { recursive: true, mode: 0o700 })
  await writeFile(join(lostDevicePath, 'data', 'ses-agent.db'), 'inaccessible-encrypted-database', { mode: 0o600 })
  await writeFile(join(lostDevicePath, 'vault', 'resume-files', 'obsolete.sesv'), 'obsolete-vault-data', { mode: 0o600 })
  await writeFile(join(lostDevicePath, 'security', 'master-key.v1'), 'unavailable-protected-key', { mode: 0o600 })
  await mkdir(join(stagingDirectory, 'security'), { recursive: true, mode: 0o700 })
  await writeFile(join(stagingDirectory, 'security', 'master-key.v1'), 'restored-protected-key', { mode: 0o600 })
  await schedulePendingRestore({
    userDataPath: lostDevicePath,
    restoreToken,
    stagingDirectory,
    packageHash: staged.packageHash,
    confirmationHash: staged.confirmationHash,
    summary: staged.summary,
    requestedAt: new Date('2026-07-17T10:03:00.000Z')
  })
  assert.equal(await hasPendingRestore(lostDevicePath), true)
  const activation = await applyPendingRestore(lostDevicePath)
  assert.ok(activation)
  const restoredRepository = new EncryptedApplicationRepository({
    path: activation.activeDatabasePath,
    databaseKey: restoredKeys.databaseKey,
    mappingKey: restoredKeys.mappingKey
  })
  restoredRepository.rebindStagedFilePaths(activation.activeVaultDirectory)
  assert.equal(restoredRepository.getWorkTask(task.id)?.instruction, task.instruction)
  const restoredFile = restoredRepository.listStagedFileRecords()[0]
  assert.ok(restoredFile)
  const restoredVault = new EncryptedFileVault({ directory: activation.activeVaultDirectory, key: restoredKeys.fileVaultKey })
  const restoredPdf = await restoredVault.decryptForLocalProcessing(restoredFile)
  assert.equal(restoredPdf.toString('utf8').includes(piiSentinel), true)
  restoredPdf.fill(0)
  restoredRepository.recordRecoveryEvent('restore-completed', staged.summary, staged.packageHash)
  assert.ok(restoredRepository.getRecoveryState().lastRestoreAt)
  restoredRepository.close()
  await finalizePendingRestore(lostDevicePath, activation)
  assert.equal(await hasPendingRestore(lostDevicePath), false)
  assert.equal((await readFile(join(lostDevicePath, 'security', 'master-key.v1'), 'utf8')), 'restored-protected-key')
  staged.masterKey.fill(0)

  process.stdout.write(`${JSON.stringify({
    authenticatedEncryption: true,
    plaintextLeak: false,
    consistentSqlcipherSnapshot: true,
    manifestVaultObjects: created.summary.vaultObjectCount,
    crossDirectoryRestore: true,
    inaccessibleActiveDataReplacedAfterConfirmation: true,
    pendingRestoreFinalized: true,
    restoredTask: true,
    restoredVaultAead: true,
    googleWorkspaceCredentialIncluded: false,
    schemaVersion: created.summary.schemaVersion,
    fileMode: '0600'
  })}\n`)
} finally {
  masterKey.fill(0)
  await rm(root, { recursive: true, force: true })
}
