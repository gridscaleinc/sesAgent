import { randomBytes } from 'node:crypto'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import Database from 'better-sqlite3-multiple-ciphers'
import { EncryptedApplicationRepository } from '../index'

/**
 * Test-only helper. better-sqlite3-multiple-ciphers is rebuilt for Electron's
 * ABI by `electron-builder install-app-deps`, so it cannot be loaded by the
 * plain Node that `npx vitest run` uses. Store tests use `describe.skipIf`
 * on this flag and actually run under:
 *
 *   ELECTRON_RUN_AS_NODE=1 ./node_modules/.bin/electron node_modules/vitest/vitest.mjs run packages/persistence
 */
export const nativeSqliteAvailable: boolean = (() => {
  try {
    new Database(':memory:').close()
    return true
  } catch {
    return false
  }
})()

export interface TestRepositoryHandle {
  repository: EncryptedApplicationRepository
  path: string
  databaseKey: Buffer
  mappingKey: Buffer
  reopen(): EncryptedApplicationRepository
  dispose(): void
}

export function openTestRepository(): TestRepositoryHandle {
  const directory = mkdtempSync(join(tmpdir(), 'ses-store-test-'))
  const path = join(directory, 'store-test.db')
  const databaseKey = randomBytes(32)
  const mappingKey = randomBytes(32)
  const handle: TestRepositoryHandle = {
    repository: new EncryptedApplicationRepository({ path, databaseKey, mappingKey }),
    path,
    databaseKey,
    mappingKey,
    reopen() {
      handle.repository.close()
      handle.repository = new EncryptedApplicationRepository({ path, databaseKey, mappingKey })
      return handle.repository
    },
    dispose() {
      try {
        handle.repository.close()
      } catch {
        // already closed
      }
      rmSync(directory, { recursive: true, force: true })
    }
  }
  return handle
}
