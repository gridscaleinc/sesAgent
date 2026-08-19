import { randomBytes, randomUUID } from 'node:crypto'
import { mkdtemp, mkdir, readFile, rm, stat, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  applyPendingRestore,
  createRecoveryPackage,
  discardStagedRecovery,
  finalizePendingRestore,
  hasPendingRestore,
  rollbackPendingRestore,
  schedulePendingRestore,
  stageRecoveryPackage
} from './index'

const roots: string[] = []

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'ses-recovery-test-'))
  roots.push(root)
  const databasePath = join(root, 'snapshot', 'ses-agent.db')
  const vaultPath = join(root, 'vault', `${randomUUID()}.sesv`)
  await mkdir(join(root, 'snapshot'), { recursive: true })
  await mkdir(join(root, 'vault'), { recursive: true })
  const database = Buffer.concat([Buffer.from('encrypted-sqlcipher-pages:'), randomBytes(32_000)])
  const vault = Buffer.concat([Buffer.from('SESVAULT1'), randomBytes(12_000)])
  await writeFile(databasePath, database, { mode: 0o600 })
  await writeFile(vaultPath, vault, { mode: 0o600 })
  return {
    root,
    databasePath,
    database,
    vaultPath,
    vault,
    token: vaultPath.split('/').at(-1)!.replace('.sesv', ''),
    masterKey: randomBytes(32),
    password: 'correct horse battery staple',
    outputPath: join(root, 'backup.ses-recovery')
  }
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

describe('encrypted recovery packages', () => {
  it('streams an authenticated package and restores its exact encrypted database and vault objects', async () => {
    const data = await fixture()
    const created = await createRecoveryPackage({
      outputPath: data.outputPath,
      databaseSnapshotPath: data.databasePath,
      vaultObjects: [{ token: data.token, sourcePath: data.vaultPath }],
      masterKey: data.masterKey,
      password: data.password,
      source: { appVersion: '0.1.0', platform: 'darwin', arch: 'arm64', schemaVersion: 11 },
      now: new Date('2026-07-17T10:00:00.000Z'),
      backupId: '2cf04f2b-4506-4dc7-838a-2041ca417dce'
    })

    expect(created.summary).toMatchObject({
      vaultObjectCount: 1,
      googleWorkspaceCredentialIncluded: false,
      cloudDataIncluded: false
    })
    const packageBytes = await readFile(data.outputPath)
    expect(packageBytes.includes(data.masterKey)).toBe(false)
    expect(packageBytes.includes(Buffer.from(data.password))).toBe(false)
    expect(packageBytes.includes(data.database.subarray(0, 24))).toBe(false)

    const staged = await stageRecoveryPackage({
      packagePath: data.outputPath,
      password: data.password,
      stagingDirectory: join(data.root, 'restore-staging')
    })
    expect(staged.masterKey.equals(data.masterKey)).toBe(true)
    expect(await readFile(staged.databasePath)).toEqual(data.database)
    expect(await readFile(join(staged.vaultDirectory, `${data.token}.sesv`))).toEqual(data.vault)
    expect(staged.confirmationHash).toMatch(/^[a-f0-9]{64}$/u)
    await discardStagedRecovery(staged)
    await expect(stat(join(data.root, 'restore-staging'))).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('keeps the encrypted recovery container portable across Windows and macOS hosts', async () => {
    const data = await fixture()
    const created = await createRecoveryPackage({
      outputPath: data.outputPath,
      databaseSnapshotPath: data.databasePath,
      vaultObjects: [{ token: data.token, sourcePath: data.vaultPath }],
      masterKey: data.masterKey,
      password: data.password,
      source: { appVersion: '0.1.0', platform: 'win32', arch: 'x64', schemaVersion: 20 },
      now: new Date('2026-07-20T04:00:00.000Z'),
      backupId: 'de4d3bc5-4d9c-4dd5-8f24-fcd0508f2fd9'
    })
    expect(created.summary).toMatchObject({ sourcePlatform: 'win32', sourceArch: 'x64', schemaVersion: 20 })
    const staged = await stageRecoveryPackage({
      packagePath: data.outputPath,
      password: data.password,
      stagingDirectory: join(data.root, 'cross-platform-restore')
    })
    expect(staged.summary.sourcePlatform).toBe('win32')
    expect(await readFile(staged.databasePath)).toEqual(data.database)
    expect(await readFile(join(staged.vaultDirectory, `${data.token}.sesv`))).toEqual(data.vault)
    await discardStagedRecovery(staged)
  })

  it('switches restored state before startup and can roll back or finalize idempotently', async () => {
    const root = await mkdtemp(join(tmpdir(), 'ses-recovery-swap-test-'))
    roots.push(root)
    const token = randomUUID()
    const staging = join(root, 'recovery', 'previews', token)
    await mkdir(join(root, 'data'), { recursive: true })
    await mkdir(join(root, 'vault', 'resume-files'), { recursive: true })
    await mkdir(join(root, 'security'), { recursive: true })
    await writeFile(join(root, 'data', 'ses-agent.db'), 'old-database')
    await writeFile(join(root, 'vault', 'resume-files', 'old.sesv'), 'old-vault')
    await writeFile(join(root, 'security', 'master-key.v1'), 'old-key')
    await mkdir(join(staging, 'data'), { recursive: true })
    await mkdir(join(staging, 'vault', 'resume-files'), { recursive: true })
    await mkdir(join(staging, 'security'), { recursive: true })
    await writeFile(join(staging, 'data', 'ses-agent.db'), 'new-database')
    await writeFile(join(staging, 'vault', 'resume-files', 'new.sesv'), 'new-vault')
    await writeFile(join(staging, 'security', 'master-key.v1'), 'new-key')
    const summary = {
      version: 'ses-recovery-v1' as const,
      backupId: randomUUID(),
      createdAt: '2026-07-17T10:00:00.000Z',
      sourcePlatform: 'darwin' as const,
      sourceArch: 'arm64',
      schemaVersion: 12,
      databaseBytes: 12,
      vaultObjectCount: 1,
      vaultBytes: 9,
      totalBytes: 21,
      googleWorkspaceCredentialIncluded: false as const,
      cloudDataIncluded: false as const
    }
    await schedulePendingRestore({
      userDataPath: root,
      restoreToken: token,
      stagingDirectory: staging,
      packageHash: 'a'.repeat(64),
      confirmationHash: 'b'.repeat(64),
      summary
    })
    expect(await hasPendingRestore(root)).toBe(true)
    const activation = await applyPendingRestore(root)
    expect(activation?.marker.phase).toBe('installed')
    expect(await readFile(join(root, 'data', 'ses-agent.db'), 'utf8')).toBe('new-database')
    expect(await readFile(join(root, 'security', 'master-key.v1'), 'utf8')).toBe('new-key')
    expect((await applyPendingRestore(root))?.marker.phase).toBe('installed')
    await rollbackPendingRestore(root, activation!)
    expect(await readFile(join(root, 'data', 'ses-agent.db'), 'utf8')).toBe('old-database')
    expect(await readFile(join(root, 'security', 'master-key.v1'), 'utf8')).toBe('old-key')
    expect(await hasPendingRestore(root)).toBe(false)

    const secondToken = randomUUID()
    const secondStaging = join(root, 'recovery', 'previews', secondToken)
    await mkdir(join(secondStaging, 'data'), { recursive: true })
    await mkdir(join(secondStaging, 'vault', 'resume-files'), { recursive: true })
    await mkdir(join(secondStaging, 'security'), { recursive: true })
    await writeFile(join(secondStaging, 'data', 'ses-agent.db'), 'final-database')
    await writeFile(join(secondStaging, 'security', 'master-key.v1'), 'final-key')
    await schedulePendingRestore({
      userDataPath: root,
      restoreToken: secondToken,
      stagingDirectory: secondStaging,
      packageHash: 'c'.repeat(64),
      confirmationHash: 'd'.repeat(64),
      summary: { ...summary, backupId: randomUUID() }
    })
    const finalized = await applyPendingRestore(root)
    await finalizePendingRestore(root, finalized!)
    expect(await readFile(join(root, 'data', 'ses-agent.db'), 'utf8')).toBe('final-database')
    expect(await hasPendingRestore(root)).toBe(false)
  })

  it('rejects a wrong password without leaving staged files', async () => {
    const data = await fixture()
    await createRecoveryPackage({
      outputPath: data.outputPath,
      databaseSnapshotPath: data.databasePath,
      vaultObjects: [],
      masterKey: data.masterKey,
      password: data.password,
      source: { appVersion: '0.1.0', platform: 'darwin', arch: 'arm64', schemaVersion: 11 }
    })
    const stagingDirectory = join(data.root, 'wrong-password-staging')
    await expect(stageRecoveryPackage({
      packagePath: data.outputPath,
      password: 'incorrect password value',
      stagingDirectory
    })).rejects.toThrow('復元パスワードが違うか')
    await expect(stat(stagingDirectory)).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('detects authenticated-package tampering and removes partial restoration output', async () => {
    const data = await fixture()
    await createRecoveryPackage({
      outputPath: data.outputPath,
      databaseSnapshotPath: data.databasePath,
      vaultObjects: [{ token: data.token, sourcePath: data.vaultPath }],
      masterKey: data.masterKey,
      password: data.password,
      source: { appVersion: '0.1.0', platform: 'darwin', arch: 'arm64', schemaVersion: 11 }
    })
    const damaged = await readFile(data.outputPath)
    damaged[Math.floor(damaged.length / 2)] ^= 0x40
    await writeFile(data.outputPath, damaged, { mode: 0o600 })
    const stagingDirectory = join(data.root, 'tampered-staging')
    await expect(stageRecoveryPackage({
      packagePath: data.outputPath,
      password: data.password,
      stagingDirectory
    })).rejects.toThrow()
    await expect(stat(stagingDirectory)).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('fails closed when a declared vault object is missing or is a symbolic link', async () => {
    const data = await fixture()
    const missingPath = join(data.root, 'vault', 'missing.sesv')
    await expect(createRecoveryPackage({
      outputPath: data.outputPath,
      databaseSnapshotPath: data.databasePath,
      vaultObjects: [{ token: randomUUID(), sourcePath: missingPath }],
      masterKey: data.masterKey,
      password: data.password,
      source: { appVersion: '0.1.0', platform: 'darwin', arch: 'arm64', schemaVersion: 12 }
    })).rejects.toThrow()
    const linkedPath = join(data.root, 'vault', 'linked.sesv')
    await symlink(data.vaultPath, linkedPath)
    await expect(createRecoveryPackage({
      outputPath: data.outputPath,
      databaseSnapshotPath: data.databasePath,
      vaultObjects: [{ token: randomUUID(), sourcePath: linkedPath }],
      masterKey: data.masterKey,
      password: data.password,
      source: { appVersion: '0.1.0', platform: 'darwin', arch: 'arm64', schemaVersion: 12 }
    })).rejects.toThrow('not a regular file')
  })
})
