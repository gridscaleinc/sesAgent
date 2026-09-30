// @vitest-environment node
import { afterEach, beforeEach, expect, it, vi } from 'vitest'

const electron = vi.hoisted(() => ({ app: { isPackaged: true }, dialog: {} }))
vi.mock('electron', () => electron)

const sender = (url: string) => ({ senderFrame: { url }, sender: { getURL: () => url } }) as never
const originalDevUrl = process.env.ELECTRON_RENDERER_URL

beforeEach(() => {
  delete process.env.ELECTRON_RENDERER_URL
  electron.app.isPackaged = true
})
afterEach(() => {
  if (originalDevUrl === undefined) delete process.env.ELECTRON_RENDERER_URL
  else process.env.ELECTRON_RENDERER_URL = originalDevUrl
})

it('keeps the menu-bar panel page out of every main-window IPC handler', async () => {
  const { assertTrustedSender, isTrayPanelUrl } = await import('./context')
  expect(() => assertTrustedSender(sender('ses-agent://app/'))).not.toThrow()
  expect(() => assertTrustedSender(sender('ses-agent://app/index.html'))).not.toThrow()
  expect(() => assertTrustedSender(sender('ses-agent://app/tray.html'))).toThrow(/untrusted/u)
  expect(() => assertTrustedSender(sender('ses-agent://app/tray.html#vibrancy'))).toThrow(/untrusted/u)
  expect(() => assertTrustedSender(sender('https://example.invalid/'))).toThrow(/untrusted/u)
  expect(isTrayPanelUrl('ses-agent://app/tray.html#vibrancy')).toBe(true)
  expect(isTrayPanelUrl('https://example.invalid/tray.html')).toBe(false)
  expect(isTrayPanelUrl('not a url')).toBe(false)
})

it('applies the same split to the development server', async () => {
  electron.app.isPackaged = false
  process.env.ELECTRON_RENDERER_URL = 'http://localhost:5173'
  const { assertTrustedSender, isTrayPanelUrl } = await import('./context')
  expect(() => assertTrustedSender(sender('http://localhost:5173/'))).not.toThrow()
  expect(() => assertTrustedSender(sender('http://localhost:5173/tray.html'))).toThrow(/untrusted/u)
  expect(isTrayPanelUrl('http://localhost:5173/tray.html')).toBe(true)
  expect(isTrayPanelUrl('http://localhost:5174/tray.html')).toBe(false)
})
