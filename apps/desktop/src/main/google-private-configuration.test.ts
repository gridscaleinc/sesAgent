// @vitest-environment node
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, expect, it } from 'vitest'
import { loadPrivateGoogleConfiguration } from './google-private-configuration'

let directory: string
let file: string
const config = {
  version: 'google-private-web-v1',
  accountEmail: 'private-hr@example.com',
  redirectUri: 'http://localhost:3000/api/auth/callback/google',
  web: {
    client_id: '1234567890-private.apps.googleusercontent.com',
    client_secret: 'private-test-only-secret',
    auth_uri: 'https://accounts.google.com/o/oauth2/auth',
    token_uri: 'https://oauth2.googleapis.com/token',
    redirect_uris: ['http://localhost:3000/api/auth/callback/google']
  }
}
beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), 'ses-private-client-'))
  file = join(directory, 'private.json')
  writeFileSync(file, JSON.stringify(config), { mode: 0o600 })
})
afterEach(() => rmSync(directory, { recursive: true, force: true }))
it('loads a registered private local Web client, and ignores it in packaged applications', () => {
  expect(loadPrivateGoogleConfiguration(file, false)).toMatchObject({
    clientId: config.web.client_id,
    privateLocalWeb: { accountEmail: config.accountEmail }
  })
  expect(loadPrivateGoogleConfiguration(file, true)).toBeNull()
})
it('loads the desktop client with the exact mailbox restriction and a dynamic callback', () => {
  writeFileSync(file, JSON.stringify({ version: 'google-private-client-v1', accountEmail: config.accountEmail, installed: config.web }))
  expect(loadPrivateGoogleConfiguration(file, false)).toMatchObject({ clientId: config.web.client_id, accountEmail: config.accountEmail })
  expect(loadPrivateGoogleConfiguration(file, false)?.privateLocalWeb).toBeUndefined()
})
it('rejects ambiguous files containing both client types', () => {
  writeFileSync(file, JSON.stringify({ ...config, installed: config.web }))
  expect(() => loadPrivateGoogleConfiguration(file, false)).toThrow('Private Google configuration is invalid')
})
it('rejects unregistered callbacks without exposing credentials', () => {
  writeFileSync(file, JSON.stringify({ ...config, redirectUri: 'http://localhost:3001/other' }))
  expect(() => loadPrivateGoogleConfiguration(file, false)).toThrow('Private Google configuration is invalid')
  try {
    loadPrivateGoogleConfiguration(file, false)
  } catch (error) {
    expect(String(error)).not.toContain(config.web.client_secret)
  }
})
it.skipIf(process.platform === 'win32')('requires owner-only permissions', () => {
  chmodSync(file, 0o644)
  expect(() => loadPrivateGoogleConfiguration(file, false)).toThrow('file permissions')
})
