import { randomBytes } from 'node:crypto'
import { mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import { safeStorage } from 'electron'
import { deriveApplicationKeys, type ApplicationKeyMaterial, type ApplicationKeys } from './keys'

export * from './capabilities'
export { deriveApplicationKeys } from './keys'
export type { ApplicationKeyMaterial, ApplicationKeys } from './keys'

export class ProtectedMasterKeyUnavailableError extends Error {
  constructor(options?: ErrorOptions) {
    super('The protected application master key could not be decrypted.', options)
    this.name = 'ProtectedMasterKeyUnavailableError'
  }
}

async function writePrivateFileAtomically(path: string, content: Buffer): Promise<void> {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 })
  const temporaryPath = `${path}.${randomBytes(8).toString('hex')}.tmp`
  await writeFile(temporaryPath, content, { mode: 0o600 })
  await rename(temporaryPath, path)
}

export class SafeStorageMasterKeyProvider {
  constructor(private readonly keyBlobPath: string) {}

  async loadOrCreate(): Promise<ApplicationKeys> {
    const material = await this.loadOrCreateKeyMaterial()
    const keys: ApplicationKeys = {
      databaseKey: material.databaseKey,
      mappingKey: material.mappingKey,
      fileVaultKey: material.fileVaultKey
    }
    material.masterKey.fill(0)
    return keys
  }

  async loadOrCreateKeyMaterial(): Promise<ApplicationKeyMaterial> {
    if (!(await safeStorage.isAsyncEncryptionAvailable())) {
      throw new Error('OS key protection is unavailable. Refusing to create an unprotected local database.')
    }

    let encryptedMasterKey: Buffer | null = null
    try {
      encryptedMasterKey = await readFile(this.keyBlobPath)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    }

    if (!encryptedMasterKey) {
      const masterKey = randomBytes(32)
      const protectedBlob = await safeStorage.encryptStringAsync(masterKey.toString('base64'))
      await writePrivateFileAtomically(this.keyBlobPath, protectedBlob)
      return { masterKey, ...deriveApplicationKeys(masterKey) }
    }

    let decrypted: Awaited<ReturnType<typeof safeStorage.decryptStringAsync>>
    try {
      decrypted = await safeStorage.decryptStringAsync(encryptedMasterKey)
    } catch (error) {
      throw new ProtectedMasterKeyUnavailableError({ cause: error })
    }
    const masterKey = Buffer.from(decrypted.result, 'base64')
    if (masterKey.length !== 32) {
      masterKey.fill(0)
      throw new ProtectedMasterKeyUnavailableError()
    }

    if (decrypted.shouldReEncrypt) {
      const protectedBlob = await safeStorage.encryptStringAsync(masterKey.toString('base64'))
      await writePrivateFileAtomically(this.keyBlobPath, protectedBlob)
    }

    return { masterKey, ...deriveApplicationKeys(masterKey) }
  }

  async writeProtectedMasterKey(path: string, masterKey: Buffer): Promise<void> {
    if (masterKey.length !== 32) throw new Error('The restored application master key is invalid.')
    if (!(await safeStorage.isAsyncEncryptionAvailable())) {
      throw new Error('OS key protection is unavailable. Refusing to stage an unprotected recovery key.')
    }
    const protectedBlob = await safeStorage.encryptStringAsync(masterKey.toString('base64'))
    await writePrivateFileAtomically(path, protectedBlob)
  }
}

export class SafeStorageJsonCredentialVault<T> {
  constructor(
    private readonly blobPath: string,
    private readonly parse: (input: unknown) => T
  ) {}

  async load(): Promise<T | null> {
    let encrypted: Buffer
    try {
      encrypted = await readFile(this.blobPath)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null
      throw error
    }
    if (!(await safeStorage.isAsyncEncryptionAvailable())) {
      throw new Error('OS key protection is unavailable. Refusing to decrypt Google Workspace credentials.')
    }
    const decrypted = await safeStorage.decryptStringAsync(encrypted)
    const parsed = this.parse(JSON.parse(decrypted.result) as unknown)
    if (decrypted.shouldReEncrypt) await this.save(parsed)
    return parsed
  }

  async save(value: T): Promise<void> {
    if (!(await safeStorage.isAsyncEncryptionAvailable())) {
      throw new Error('OS key protection is unavailable. Refusing to store Google Workspace credentials.')
    }
    const validated = this.parse(value)
    const encrypted = await safeStorage.encryptStringAsync(JSON.stringify(validated))
    await writePrivateFileAtomically(this.blobPath, encrypted)
  }

  async clear(): Promise<void> {
    try {
      await unlink(this.blobPath)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    }
  }
}
