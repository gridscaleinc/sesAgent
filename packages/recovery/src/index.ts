import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
  randomUUID,
  scrypt
} from 'node:crypto'
import { createReadStream } from 'node:fs'
import { chmod, lstat, mkdir, open, readFile, rename, rm, stat, writeFile, type FileHandle } from 'node:fs/promises'
import { basename, dirname, join, relative, resolve } from 'node:path'
import { z } from 'zod'
import type { RecoveryPackageSummary } from '@shared/contracts'

const outerMagic = Buffer.from('SESRECOVERY1', 'ascii')
const formatVersion = Buffer.from([1])
const saltBytes = 16
const nonceBytes = 12
const tagBytes = 16
const outerHeaderBytes = outerMagic.length + formatVersion.length + saltBytes + nonceBytes
const maximumEntryCount = 10_002
const maximumHeaderBytes = 4_096
const maximumManifestBytes = 1024 * 1024
const maximumKeyMaterialBytes = 2_048
const scryptOptions = { N: 32_768, r: 8, p: 1, maxmem: 64 * 1024 * 1024 } as const

const sha256Schema = z.string().regex(/^[a-f0-9]{64}$/)
const vaultEntryPathSchema = z.string().regex(/^vault\/resume-files\/[0-9a-f-]{36}\.sesv$/iu)
const fileDescriptorSchema = z.object({
  path: z.string().min(1).max(240),
  sha256: sha256Schema,
  bytes: z.number().int().nonnegative()
})

export const recoveryManifestSchema = z.object({
  version: z.literal('ses-recovery-v1'),
  backupId: z.string().uuid(),
  createdAt: z.string().datetime(),
  source: z.object({
    appVersion: z.string().min(1).max(80),
    platform: z.enum(['darwin', 'win32']),
    arch: z.string().min(1).max(40),
    schemaVersion: z.number().int().positive(),
    databaseEngine: z.literal('sqlcipher-compatible'),
    indexVersion: z.literal('deterministic-field-index-v1')
  }),
  database: fileDescriptorSchema.extend({ path: z.literal('database/ses-agent.db') }),
  vaultObjects: z.array(fileDescriptorSchema.extend({ path: vaultEntryPathSchema })).max(10_000),
  totals: z.object({
    databaseBytes: z.number().int().nonnegative(),
    vaultObjectCount: z.number().int().nonnegative(),
    vaultBytes: z.number().int().nonnegative(),
    protectedContentBytes: z.number().int().nonnegative()
  }),
  exclusions: z.object({
    googleWorkspaceCredential: z.literal(true),
    cloudProviderCredential: z.literal(true),
    cache: z.literal(true),
    logs: z.literal(true),
    exportedFiles: z.literal(true)
  }),
  cloudDataIncluded: z.literal(false)
}).superRefine((manifest, context) => {
  const paths = new Set<string>()
  for (const object of manifest.vaultObjects) {
    if (paths.has(object.path)) context.addIssue({ code: 'custom', message: 'Duplicate vault object path.' })
    paths.add(object.path)
  }
  const vaultBytes = manifest.vaultObjects.reduce((total, object) => total + object.bytes, 0)
  if (manifest.totals.databaseBytes !== manifest.database.bytes) {
    context.addIssue({ code: 'custom', message: 'Database byte total does not match the descriptor.' })
  }
  if (manifest.totals.vaultObjectCount !== manifest.vaultObjects.length) {
    context.addIssue({ code: 'custom', message: 'Vault object count does not match the descriptors.' })
  }
  if (manifest.totals.vaultBytes !== vaultBytes) {
    context.addIssue({ code: 'custom', message: 'Vault byte total does not match the descriptors.' })
  }
  if (manifest.totals.protectedContentBytes !== manifest.database.bytes + vaultBytes) {
    context.addIssue({ code: 'custom', message: 'Protected content byte total is invalid.' })
  }
})

export type RecoveryManifest = z.infer<typeof recoveryManifestSchema>

const keyMaterialSchema = z.object({
  version: z.literal('master-key-v1'),
  masterKey: z.string().min(1).max(128),
  masterKeySha256: sha256Schema
})

const entryHeaderSchema = z.object({
  path: z.string().min(1).max(240),
  bytes: z.number().int().nonnegative(),
  sha256: sha256Schema
})

export interface RecoveryVaultObjectSource {
  token: string
  sourcePath: string
}

export interface CreateRecoveryPackageOptions {
  outputPath: string
  databaseSnapshotPath: string
  vaultObjects: RecoveryVaultObjectSource[]
  masterKey: Buffer
  password: string
  source: {
    appVersion: string
    platform: 'darwin' | 'win32'
    arch: string
    schemaVersion: number
  }
  now?: Date
  backupId?: string
}

export interface CreatedRecoveryPackage {
  packageHash: string
  packageBytes: number
  manifest: RecoveryManifest
  summary: RecoveryPackageSummary
}

export interface StagedRecoveryPackage {
  packageHash: string
  manifest: RecoveryManifest
  summary: RecoveryPackageSummary
  masterKey: Buffer
  databasePath: string
  vaultDirectory: string
  confirmationHash: string
}

interface SourceEntry {
  header: z.infer<typeof entryHeaderSchema>
  buffer?: Buffer
  sourcePath?: string
}

async function derivePasswordKey(password: string, salt: Buffer): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(password, salt, 32, scryptOptions, (error, derivedKey) => {
      if (error) reject(error)
      else resolve(Buffer.from(derivedKey))
    })
  })
}

async function writeAll(handle: FileHandle, content: Buffer): Promise<void> {
  let offset = 0
  while (offset < content.length) {
    const { bytesWritten } = await handle.write(content, offset, content.length - offset, null)
    if (bytesWritten <= 0) throw new Error('Unable to write the recovery package.')
    offset += bytesWritten
  }
}

async function hashFile(path: string): Promise<{ sha256: string; bytes: number }> {
  const digest = createHash('sha256')
  let bytes = 0
  for await (const chunk of createReadStream(path)) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
    digest.update(buffer)
    bytes += buffer.length
  }
  return { sha256: digest.digest('hex'), bytes }
}

function encodeLength(value: number): Buffer {
  if (!Number.isSafeInteger(value) || value < 0 || value > 0xffff_ffff) {
    throw new Error('Recovery entry size exceeds the supported framing limit.')
  }
  const encoded = Buffer.allocUnsafe(4)
  encoded.writeUInt32BE(value)
  return encoded
}

function summaryFromManifest(manifest: RecoveryManifest): RecoveryPackageSummary {
  return {
    version: manifest.version,
    backupId: manifest.backupId,
    createdAt: manifest.createdAt,
    sourcePlatform: manifest.source.platform,
    sourceArch: manifest.source.arch,
    schemaVersion: manifest.source.schemaVersion,
    databaseBytes: manifest.totals.databaseBytes,
    vaultObjectCount: manifest.totals.vaultObjectCount,
    vaultBytes: manifest.totals.vaultBytes,
    totalBytes: manifest.totals.protectedContentBytes,
    googleWorkspaceCredentialIncluded: false,
    cloudDataIncluded: false
  }
}

function assertMasterKey(masterKey: Buffer): void {
  if (masterKey.length !== 32) throw new Error('Recovery requires a 32-byte application master key.')
}

function assertPassword(password: string): void {
  if (password.length < 12 || password.length > 256 || password.includes('\u0000')) {
    throw new Error('Recovery password must contain between 12 and 256 characters.')
  }
}

async function descriptorForSource(path: string, entryPath: string): Promise<z.infer<typeof fileDescriptorSchema>> {
  const fileStat = await lstat(path)
  if (!fileStat.isFile() || fileStat.isSymbolicLink()) throw new Error(`Recovery source is not a regular file: ${entryPath}`)
  const hashed = await hashFile(path)
  return fileDescriptorSchema.parse({ path: entryPath, ...hashed })
}

export async function createRecoveryPackage(options: CreateRecoveryPackageOptions): Promise<CreatedRecoveryPackage> {
  assertMasterKey(options.masterKey)
  assertPassword(options.password)
  const database = await descriptorForSource(options.databaseSnapshotPath, 'database/ses-agent.db')
  const seenTokens = new Set<string>()
  const vaultSources: Array<{ source: RecoveryVaultObjectSource; descriptor: z.infer<typeof fileDescriptorSchema> }> = []
  for (const source of options.vaultObjects) {
    if (!/^[0-9a-f-]{36}$/iu.test(source.token) || seenTokens.has(source.token)) {
      throw new Error('Recovery vault object identifiers must be unique UUIDs.')
    }
    seenTokens.add(source.token)
    const entryPath = `vault/resume-files/${source.token}.sesv`
    vaultSources.push({ source, descriptor: await descriptorForSource(source.sourcePath, entryPath) })
  }
  vaultSources.sort((left, right) => left.descriptor.path.localeCompare(right.descriptor.path, 'en'))
  const vaultBytes = vaultSources.reduce((total, item) => total + item.descriptor.bytes, 0)
  const manifest = recoveryManifestSchema.parse({
    version: 'ses-recovery-v1',
    backupId: options.backupId ?? randomUUID(),
    createdAt: (options.now ?? new Date()).toISOString(),
    source: {
      ...options.source,
      databaseEngine: 'sqlcipher-compatible',
      indexVersion: 'deterministic-field-index-v1'
    },
    database,
    vaultObjects: vaultSources.map((item) => item.descriptor),
    totals: {
      databaseBytes: database.bytes,
      vaultObjectCount: vaultSources.length,
      vaultBytes,
      protectedContentBytes: database.bytes + vaultBytes
    },
    exclusions: {
      googleWorkspaceCredential: true,
      cloudProviderCredential: true,
      cache: true,
      logs: true,
      exportedFiles: true
    },
    cloudDataIncluded: false
  })
  const manifestBuffer = Buffer.from(JSON.stringify(manifest), 'utf8')
  const masterKeyBase64 = options.masterKey.toString('base64')
  const keyMaterialBuffer = Buffer.from(JSON.stringify({
    version: 'master-key-v1',
    masterKey: masterKeyBase64,
    masterKeySha256: createHash('sha256').update(options.masterKey).digest('hex')
  }), 'utf8')
  const entries: SourceEntry[] = [
    {
      header: { path: 'manifest.json', bytes: manifestBuffer.length, sha256: createHash('sha256').update(manifestBuffer).digest('hex') },
      buffer: manifestBuffer
    },
    {
      header: { path: 'key-material.json', bytes: keyMaterialBuffer.length, sha256: createHash('sha256').update(keyMaterialBuffer).digest('hex') },
      buffer: keyMaterialBuffer
    },
    { header: database, sourcePath: options.databaseSnapshotPath },
    ...vaultSources.map((item) => ({ header: item.descriptor, sourcePath: item.source.sourcePath }))
  ]

  await mkdir(dirname(options.outputPath), { recursive: true, mode: 0o700 })
  const temporaryPath = `${options.outputPath}.${randomBytes(8).toString('hex')}.tmp`
  const salt = randomBytes(saltBytes)
  const nonce = randomBytes(nonceBytes)
  const preamble = Buffer.concat([outerMagic, formatVersion, salt, nonce])
  const passwordKey = await derivePasswordKey(options.password, salt)
  const cipher = createCipheriv('aes-256-gcm', passwordKey, nonce)
  cipher.setAAD(preamble)
  let handle: FileHandle | null = null
  try {
    handle = await open(temporaryPath, 'wx', 0o600)
    await writeAll(handle, preamble)
    const writeEncrypted = async (plaintext: Buffer) => {
      if (plaintext.length === 0) return
      const encrypted = cipher.update(plaintext)
      if (encrypted.length > 0 && handle) await writeAll(handle, encrypted)
    }
    await writeEncrypted(encodeLength(entries.length))
    for (const entry of entries) {
      const header = Buffer.from(JSON.stringify(entryHeaderSchema.parse(entry.header)), 'utf8')
      if (header.length > maximumHeaderBytes) throw new Error('Recovery entry header is too large.')
      await writeEncrypted(encodeLength(header.length))
      await writeEncrypted(header)
      if (entry.buffer) {
        await writeEncrypted(entry.buffer)
      } else if (entry.sourcePath) {
        for await (const chunk of createReadStream(entry.sourcePath)) {
          await writeEncrypted(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
        }
      } else {
        throw new Error('Recovery entry has no content source.')
      }
    }
    await writeAll(handle, cipher.final())
    await writeAll(handle, cipher.getAuthTag())
    await handle.sync()
    await handle.close()
    handle = null
    await chmod(temporaryPath, 0o600)
    await rm(options.outputPath, { force: true })
    await rename(temporaryPath, options.outputPath)
    const packageInfo = await hashFile(options.outputPath)
    return {
      packageHash: packageInfo.sha256,
      packageBytes: packageInfo.bytes,
      manifest,
      summary: summaryFromManifest(manifest)
    }
  } catch (error) {
    if (handle) await handle.close().catch(() => undefined)
    await rm(temporaryPath, { force: true })
    throw error
  } finally {
    passwordKey.fill(0)
  }
}

async function readAt(handle: FileHandle, bytes: number, position: number): Promise<Buffer> {
  const buffer = Buffer.alloc(bytes)
  let offset = 0
  while (offset < bytes) {
    const result = await handle.read(buffer, offset, bytes - offset, position + offset)
    if (result.bytesRead <= 0) throw new Error('Recovery package is truncated.')
    offset += result.bytesRead
  }
  return buffer
}

class AsyncChunkReader {
  private readonly iterator: AsyncIterator<Buffer>
  private buffered: Buffer<ArrayBufferLike> = Buffer.alloc(0)
  private done = false

  constructor(source: AsyncIterable<Buffer>) {
    this.iterator = source[Symbol.asyncIterator]()
  }

  private async fill(): Promise<void> {
    if (this.done) return
    const next = await this.iterator.next()
    if (next.done) {
      this.done = true
      return
    }
    this.buffered = this.buffered.length === 0 ? next.value : Buffer.concat([this.buffered, next.value])
  }

  async readExact(bytes: number): Promise<Buffer> {
    const chunks: Buffer[] = []
    await this.consumeExact(bytes, async (chunk) => { chunks.push(Buffer.from(chunk)) })
    return chunks.length === 1 ? chunks[0] : Buffer.concat(chunks)
  }

  async consumeExact(bytes: number, consume: (chunk: Buffer) => Promise<void>): Promise<void> {
    let remaining = bytes
    while (remaining > 0) {
      if (this.buffered.length === 0) await this.fill()
      if (this.buffered.length === 0) throw new Error('Recovery package entry is truncated.')
      const take = Math.min(remaining, this.buffered.length)
      const chunk = this.buffered.subarray(0, take)
      this.buffered = this.buffered.subarray(take)
      remaining -= take
      await consume(chunk)
    }
  }

  async assertEnd(): Promise<void> {
    if (this.buffered.length > 0) throw new Error('Recovery package contains trailing plaintext data.')
    await this.fill()
    if (this.buffered.length > 0 || !this.done) throw new Error('Recovery package contains unexpected entries.')
  }
}

async function* decryptedPackageChunks(
  packagePath: string,
  start: number,
  end: number,
  decipher: ReturnType<typeof createDecipheriv>
): AsyncGenerator<Buffer> {
  for await (const chunk of createReadStream(packagePath, { start, end })) {
    const decrypted = decipher.update(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
    if (decrypted.length > 0) yield decrypted
  }
  const final = decipher.final()
  if (final.length > 0) yield final
}

async function authenticatePackage(
  packagePath: string,
  start: number,
  end: number,
  key: Buffer,
  nonce: Buffer,
  preamble: Buffer,
  tag: Buffer
): Promise<void> {
  const verifier = createDecipheriv('aes-256-gcm', key, nonce)
  verifier.setAAD(preamble)
  verifier.setAuthTag(tag)
  try {
    for await (const chunk of createReadStream(packagePath, { start, end })) {
      verifier.update(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
    }
    verifier.final()
  } catch {
    throw new Error('復元パスワードが違うか、復元パッケージが改ざんされています。')
  }
}

function outputPathForEntry(stagingDirectory: string, path: string): string | null {
  if (path === 'database/ses-agent.db') return join(stagingDirectory, 'data', 'ses-agent.db')
  if (vaultEntryPathSchema.safeParse(path).success) return join(stagingDirectory, 'vault', 'resume-files', basename(path))
  return null
}

function descriptorsMatch(
  left: z.infer<typeof fileDescriptorSchema>,
  right: z.infer<typeof fileDescriptorSchema>
): boolean {
  return left.path === right.path && left.sha256 === right.sha256 && left.bytes === right.bytes
}

export function recoveryConfirmationHash(manifest: RecoveryManifest, packageHash: string): string {
  return createHash('sha256')
    .update([
      manifest.version,
      manifest.backupId,
      manifest.createdAt,
      String(manifest.source.schemaVersion),
      manifest.database.sha256,
      String(manifest.vaultObjects.length),
      String(manifest.totals.protectedContentBytes),
      packageHash
    ].join('\u0000'))
    .digest('hex')
}

export async function stageRecoveryPackage(options: {
  packagePath: string
  password: string
  stagingDirectory: string
}): Promise<StagedRecoveryPackage> {
  assertPassword(options.password)
  await rm(options.stagingDirectory, { recursive: true, force: true })
  await mkdir(options.stagingDirectory, { recursive: true, mode: 0o700 })
  const packageStat = await stat(options.packagePath)
  const minimumBytes = outerHeaderBytes + tagBytes + 1
  if (!packageStat.isFile() || packageStat.size < minimumBytes) throw new Error('Recovery package is invalid or truncated.')
  const packageHandle = await open(options.packagePath, 'r')
  let passwordKey: Buffer | null = null
  try {
    const preamble = await readAt(packageHandle, outerHeaderBytes, 0)
    if (!preamble.subarray(0, outerMagic.length).equals(outerMagic)) throw new Error('Unsupported recovery package format.')
    if (preamble[outerMagic.length] !== formatVersion[0]) throw new Error('Unsupported recovery package version.')
    const saltStart = outerMagic.length + formatVersion.length
    const nonceStart = saltStart + saltBytes
    const salt = preamble.subarray(saltStart, nonceStart)
    const nonce = preamble.subarray(nonceStart, nonceStart + nonceBytes)
    const tag = await readAt(packageHandle, tagBytes, packageStat.size - tagBytes)
    passwordKey = await derivePasswordKey(options.password, salt)
    const ciphertextStart = outerHeaderBytes
    const ciphertextEnd = packageStat.size - tagBytes - 1
    await authenticatePackage(
      options.packagePath,
      ciphertextStart,
      ciphertextEnd,
      passwordKey,
      nonce,
      preamble,
      tag
    )
    const decipher = createDecipheriv('aes-256-gcm', passwordKey, nonce)
    decipher.setAAD(preamble)
    decipher.setAuthTag(tag)
    const reader = new AsyncChunkReader(decryptedPackageChunks(
      options.packagePath,
      ciphertextStart,
      ciphertextEnd,
      decipher
    ))
    const entryCount = (await reader.readExact(4)).readUInt32BE(0)
    if (entryCount < 3 || entryCount > maximumEntryCount) throw new Error('Recovery package entry count is invalid.')
    const seen = new Set<string>()
    const descriptors = new Map<string, z.infer<typeof fileDescriptorSchema>>()
    let manifestBuffer: Buffer | null = null
    let keyMaterialBuffer: Buffer | null = null

    for (let index = 0; index < entryCount; index += 1) {
      const headerBytes = (await reader.readExact(4)).readUInt32BE(0)
      if (headerBytes <= 0 || headerBytes > maximumHeaderBytes) throw new Error('Recovery entry header length is invalid.')
      const header = entryHeaderSchema.parse(JSON.parse((await reader.readExact(headerBytes)).toString('utf8')) as unknown)
      if (seen.has(header.path)) throw new Error('Recovery package contains a duplicate entry path.')
      seen.add(header.path)
      if (header.bytes > packageStat.size) throw new Error('Recovery entry declares an impossible size.')
      const digest = createHash('sha256')
      if (header.path === 'manifest.json' || header.path === 'key-material.json') {
        const limit = header.path === 'manifest.json' ? maximumManifestBytes : maximumKeyMaterialBytes
        if (header.bytes > limit) throw new Error('Recovery metadata entry is too large.')
        const content = await reader.readExact(header.bytes)
        digest.update(content)
        if (header.path === 'manifest.json') manifestBuffer = content
        else keyMaterialBuffer = content
      } else {
        const outputPath = outputPathForEntry(options.stagingDirectory, header.path)
        if (!outputPath) throw new Error('Recovery package contains an unsupported entry path.')
        await mkdir(dirname(outputPath), { recursive: true, mode: 0o700 })
        const output = await open(outputPath, 'wx', 0o600)
        try {
          await reader.consumeExact(header.bytes, async (chunk) => {
            digest.update(chunk)
            await writeAll(output, chunk)
          })
          await output.sync()
        } finally {
          await output.close()
        }
        await chmod(outputPath, 0o600)
        descriptors.set(header.path, header)
      }
      if (digest.digest('hex') !== header.sha256) throw new Error('Recovery entry hash verification failed.')
    }
    await reader.assertEnd()
    if (!manifestBuffer || !keyMaterialBuffer) throw new Error('Recovery package metadata is incomplete.')
    const manifest = recoveryManifestSchema.parse(JSON.parse(manifestBuffer.toString('utf8')) as unknown)
    const keyMaterial = keyMaterialSchema.parse(JSON.parse(keyMaterialBuffer.toString('utf8')) as unknown)
    const masterKey = Buffer.from(keyMaterial.masterKey, 'base64')
    assertMasterKey(masterKey)
    if (createHash('sha256').update(masterKey).digest('hex') !== keyMaterial.masterKeySha256) {
      masterKey.fill(0)
      throw new Error('Recovery key material integrity verification failed.')
    }
    const expected = [manifest.database, ...manifest.vaultObjects]
    if (descriptors.size !== expected.length) {
      masterKey.fill(0)
      throw new Error('Recovery Manifest does not match the protected entries.')
    }
    for (const descriptor of expected) {
      const actual = descriptors.get(descriptor.path)
      if (!actual || !descriptorsMatch(descriptor, actual)) {
        masterKey.fill(0)
        throw new Error('Recovery Manifest descriptor verification failed.')
      }
    }
    const packageInfo = await hashFile(options.packagePath)
    return {
      packageHash: packageInfo.sha256,
      manifest,
      summary: summaryFromManifest(manifest),
      masterKey,
      databasePath: join(options.stagingDirectory, 'data', 'ses-agent.db'),
      vaultDirectory: join(options.stagingDirectory, 'vault', 'resume-files'),
      confirmationHash: recoveryConfirmationHash(manifest, packageInfo.sha256)
    }
  } catch (error) {
    await rm(options.stagingDirectory, { recursive: true, force: true })
    throw error
  } finally {
    await packageHandle.close()
    passwordKey?.fill(0)
  }
}

export async function discardStagedRecovery(staged: Pick<StagedRecoveryPackage, 'masterKey' | 'databasePath'>): Promise<void> {
  staged.masterKey.fill(0)
  await rm(join(dirname(staged.databasePath), '..'), { recursive: true, force: true })
}

const recoverySummarySchema = z.object({
  version: z.literal('ses-recovery-v1'),
  backupId: z.string().uuid(),
  createdAt: z.string().datetime(),
  sourcePlatform: z.enum(['darwin', 'win32']),
  sourceArch: z.string().min(1).max(40),
  schemaVersion: z.number().int().positive(),
  databaseBytes: z.number().int().nonnegative(),
  vaultObjectCount: z.number().int().nonnegative(),
  vaultBytes: z.number().int().nonnegative(),
  totalBytes: z.number().int().nonnegative(),
  googleWorkspaceCredentialIncluded: z.literal(false),
  cloudDataIncluded: z.literal(false)
})

const pendingRestoreMarkerSchema = z.object({
  version: z.literal('pending-restore-v1'),
  restoreToken: z.string().uuid(),
  phase: z.enum(['ready', 'active-moved', 'installed']),
  stagingRelativePath: z.string().regex(/^previews\/[0-9a-f-]{36}$/iu),
  rollbackRelativePath: z.string().regex(/^rollback\/[0-9a-f-]{36}$/iu),
  packageHash: sha256Schema,
  confirmationHash: sha256Schema,
  summary: recoverySummarySchema,
  requestedAt: z.string().datetime()
})

export type PendingRestoreMarker = z.infer<typeof pendingRestoreMarkerSchema>

export interface PendingRestoreActivation {
  marker: PendingRestoreMarker
  activeDatabasePath: string
  activeVaultDirectory: string
}

function recoveryRoot(userDataPath: string): string {
  return join(userDataPath, 'recovery')
}

function pendingMarkerPath(userDataPath: string): string {
  return join(recoveryRoot(userDataPath), 'pending-restore.json')
}

function assertPathWithin(parent: string, child: string): void {
  const relation = relative(resolve(parent), resolve(child))
  if (!relation || relation.startsWith('..') || relation.includes(`..${process.platform === 'win32' ? '\\' : '/'}`)) {
    throw new Error('Recovery staging path is outside the managed recovery directory.')
  }
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await stat(path)
    return true
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false
    throw error
  }
}

async function writePrivateJsonAtomically(path: string, value: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 })
  const temporaryPath = `${path}.${randomBytes(8).toString('hex')}.tmp`
  try {
    await writeFile(temporaryPath, `${JSON.stringify(value)}\n`, { mode: 0o600 })
    await rename(temporaryPath, path)
    await chmod(path, 0o600)
  } catch (error) {
    await rm(temporaryPath, { force: true })
    throw error
  }
}

async function readPendingMarker(userDataPath: string): Promise<PendingRestoreMarker | null> {
  try {
    return pendingRestoreMarkerSchema.parse(JSON.parse(await readFile(pendingMarkerPath(userDataPath), 'utf8')) as unknown)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null
    throw error
  }
}

export async function hasPendingRestore(userDataPath: string): Promise<boolean> {
  return (await readPendingMarker(userDataPath)) !== null
}

export async function schedulePendingRestore(options: {
  userDataPath: string
  restoreToken: string
  stagingDirectory: string
  packageHash: string
  confirmationHash: string
  summary: RecoveryPackageSummary
  requestedAt?: Date
}): Promise<PendingRestoreMarker> {
  const root = recoveryRoot(options.userDataPath)
  const expectedStaging = join(root, 'previews', options.restoreToken)
  assertPathWithin(root, options.stagingDirectory)
  if (resolve(expectedStaging) !== resolve(options.stagingDirectory)) {
    throw new Error('Recovery staging token does not match the managed directory.')
  }
  for (const required of [
    join(expectedStaging, 'data', 'ses-agent.db'),
    join(expectedStaging, 'security', 'master-key.v1')
  ]) {
    if (!(await pathExists(required))) throw new Error('Staged recovery data is incomplete.')
  }
  await mkdir(join(expectedStaging, 'vault', 'resume-files'), { recursive: true, mode: 0o700 })
  const marker = pendingRestoreMarkerSchema.parse({
    version: 'pending-restore-v1',
    restoreToken: options.restoreToken,
    phase: 'ready',
    stagingRelativePath: `previews/${options.restoreToken}`,
    rollbackRelativePath: `rollback/${options.restoreToken}`,
    packageHash: options.packageHash,
    confirmationHash: options.confirmationHash,
    summary: options.summary,
    requestedAt: (options.requestedAt ?? new Date()).toISOString()
  })
  if (await hasPendingRestore(options.userDataPath)) throw new Error('別の復元処理がすでに予約されています。')
  await writePrivateJsonAtomically(pendingMarkerPath(options.userDataPath), marker)
  return marker
}

async function moveForSwap(source: string, destination: string, required: boolean): Promise<void> {
  const sourceExists = await pathExists(source)
  const destinationExists = await pathExists(destination)
  if (sourceExists && destinationExists) throw new Error('Recovery swap encountered conflicting paths.')
  if (sourceExists) {
    await mkdir(dirname(destination), { recursive: true, mode: 0o700 })
    await rename(source, destination)
    return
  }
  if (!destinationExists && required) throw new Error('Recovery swap source is missing.')
}

async function updatePendingPhase(userDataPath: string, marker: PendingRestoreMarker, phase: PendingRestoreMarker['phase']): Promise<PendingRestoreMarker> {
  const updated = pendingRestoreMarkerSchema.parse({ ...marker, phase })
  await writePrivateJsonAtomically(pendingMarkerPath(userDataPath), updated)
  return updated
}

export async function applyPendingRestore(userDataPath: string): Promise<PendingRestoreActivation | null> {
  let marker = await readPendingMarker(userDataPath)
  if (!marker) return null
  const root = recoveryRoot(userDataPath)
  const staging = join(root, marker.stagingRelativePath)
  const rollback = join(root, marker.rollbackRelativePath)
  assertPathWithin(root, staging)
  assertPathWithin(root, rollback)
  const active = {
    data: join(userDataPath, 'data'),
    vault: join(userDataPath, 'vault', 'resume-files'),
    key: join(userDataPath, 'security', 'master-key.v1')
  }
  const previous = {
    data: join(rollback, 'data'),
    vault: join(rollback, 'vault', 'resume-files'),
    key: join(rollback, 'security', 'master-key.v1')
  }
  const next = {
    data: join(staging, 'data'),
    vault: join(staging, 'vault', 'resume-files'),
    key: join(staging, 'security', 'master-key.v1')
  }

  if (marker.phase === 'ready') {
    await mkdir(rollback, { recursive: true, mode: 0o700 })
    await moveForSwap(active.data, previous.data, true)
    await moveForSwap(active.vault, previous.vault, false)
    await moveForSwap(active.key, previous.key, true)
    marker = await updatePendingPhase(userDataPath, marker, 'active-moved')
  }
  if (marker.phase === 'active-moved') {
    await moveForSwap(next.data, active.data, true)
    await moveForSwap(next.vault, active.vault, true)
    await moveForSwap(next.key, active.key, true)
    marker = await updatePendingPhase(userDataPath, marker, 'installed')
  }
  return {
    marker,
    activeDatabasePath: join(active.data, 'ses-agent.db'),
    activeVaultDirectory: active.vault
  }
}

export async function finalizePendingRestore(userDataPath: string, activation: PendingRestoreActivation): Promise<void> {
  const root = recoveryRoot(userDataPath)
  await rm(pendingMarkerPath(userDataPath), { force: true })
  await rm(join(root, activation.marker.rollbackRelativePath), { recursive: true, force: true })
  await rm(join(root, activation.marker.stagingRelativePath), { recursive: true, force: true })
}

export async function rollbackPendingRestore(userDataPath: string, activation: PendingRestoreActivation): Promise<void> {
  const root = recoveryRoot(userDataPath)
  const rollback = join(root, activation.marker.rollbackRelativePath)
  const active = {
    data: join(userDataPath, 'data'),
    vault: join(userDataPath, 'vault', 'resume-files'),
    key: join(userDataPath, 'security', 'master-key.v1')
  }
  const previous = {
    data: join(rollback, 'data'),
    vault: join(rollback, 'vault', 'resume-files'),
    key: join(rollback, 'security', 'master-key.v1')
  }
  for (const [name, activePath, previousPath] of [
    ['data', active.data, previous.data],
    ['vault', active.vault, previous.vault],
    ['key', active.key, previous.key]
  ] as const) {
    const previousExists = await pathExists(previousPath)
    if (previousExists) {
      await rm(activePath, { recursive: name !== 'key', force: true })
      await mkdir(dirname(activePath), { recursive: true, mode: 0o700 })
      await rename(previousPath, activePath)
    } else if (activation.marker.phase !== 'ready') {
      await rm(activePath, { recursive: name !== 'key', force: true })
    }
  }
  await rm(join(root, activation.marker.stagingRelativePath), { recursive: true, force: true })
  await rm(rollback, { recursive: true, force: true })
  await rm(pendingMarkerPath(userDataPath), { force: true })
}

export async function rollbackIncompletePendingRestore(userDataPath: string): Promise<boolean> {
  const marker = await readPendingMarker(userDataPath)
  if (!marker) return false
  await rollbackPendingRestore(userDataPath, {
    marker,
    activeDatabasePath: join(userDataPath, 'data', 'ses-agent.db'),
    activeVaultDirectory: join(userDataPath, 'vault', 'resume-files')
  })
  return true
}
