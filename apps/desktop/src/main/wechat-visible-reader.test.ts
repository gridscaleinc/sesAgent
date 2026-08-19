import { describe, expect, it, vi } from 'vitest'
import {
  MacWechatVisibleReader,
  WechatVisibleReadError,
  WechatVisibleScopeTokenStore,
  resolveWechatAccessibilityHelperPath,
  type WechatHelperRunner
} from './wechat-visible-reader'

const target = {
  bundleIdentifier: 'com.tencent.xinWeChat',
  processIdentifier: 72063,
  launchDate: '2026-08-04T00:51:49.514Z',
  version: '4.1.5',
  buildVersion: '31960',
  active: true,
  signatureIdentifier: 'com.tencent.xinWeChat',
  teamIdentifier: '5A4RE8SF68',
  signatureValid: true
}

const preflight = {
  version: 'wechat-macos-accessibility-v1',
  platform: 'darwin',
  accessibilityTrusted: true,
  screenCaptureTrusted: true,
  windowCaptureAvailable: true,
  helperNetworkAccess: false,
  supportedBundleIdentifiers: ['com.tencent.xinWeChat'],
  processes: [target]
}

describe('MacWechatVisibleReader', () => {
  it('resolves source and packaged helper paths without probing user data', () => {
    expect(resolveWechatAccessibilityHelperPath({ packaged: false, resourcesPath: '/Resources', appPath: '/repo' }))
      .toBe('/repo/build/native/macos/ses-wechat-accessibility')
    expect(resolveWechatAccessibilityHelperPath({ packaged: true, resourcesPath: '/Resources', appPath: '/repo' }))
      .toBe('/Resources/native/macos/ses-wechat-accessibility')
  })

  it('accepts only the signed Tencent primary WeChat process as a target', async () => {
    const runner = vi.fn<WechatHelperRunner>().mockResolvedValue(preflight)
    const reader = new MacWechatVisibleReader('/tmp/helper', runner)
    const result = await reader.preflight()
    expect(reader.primaryTarget(result)).toEqual(target)
    expect(runner).toHaveBeenCalledWith(expect.objectContaining({
      arguments: ['--preflight'], timeoutMs: 5_000
    }))
  })

  it('rejects a same-bundle process without the pinned Tencent team identity', async () => {
    const runner = vi.fn<WechatHelperRunner>().mockResolvedValue({
      ...preflight,
      processes: [{ ...target, teamIdentifier: 'ATTACKER01' }]
    })
    const reader = new MacWechatVisibleReader('/tmp/helper', runner)
    expect(reader.primaryTarget(await reader.preflight())).toBeNull()
  })

  it('validates raw byte accounting and never accepts a changed process identity', async () => {
    const visibleText = 'Java案件\nAWS必須'
    const runner = vi.fn<WechatHelperRunner>().mockResolvedValue({
      version: 'wechat-visible-message-read-v1',
      bundleIdentifier: 'com.tencent.xinWeChat',
      processIdentifier: target.processIdentifier,
      launchDate: target.launchDate,
      focusedWindowFrame: { x: 100, y: 100, width: 1_000, height: 800 },
      selectedContainerFrame: { x: 480, y: 180, width: 620, height: 600 },
      nodes: [
        { role: 'VisionText', text: 'Java案件', frame: { x: 500, y: 240, width: 100, height: 20 } },
        { role: 'VisionText', text: 'AWS必須', frame: { x: 500, y: 280, width: 100, height: 20 } }
      ],
      rawUtf8Bytes: Buffer.byteLength(visibleText, 'utf8'),
      truncated: false,
      helperNetworkAccess: false,
      scope: 'frontmost-focused-wechat-window-visible-conversation-crop',
      captureMethod: 'screen-capture-kit-vision-ocr'
    })
    const reader = new MacWechatVisibleReader('/tmp/helper', runner)
    await expect(reader.readVisible(target)).resolves.toMatchObject({ rawUtf8Bytes: Buffer.byteLength(visibleText, 'utf8') })
  })

  it('propagates a stable safe error code from the helper boundary', async () => {
    const runner = vi.fn<WechatHelperRunner>().mockRejectedValue(
      new WechatVisibleReadError('WECHAT_NOT_FRONTMOST')
    )
    const reader = new MacWechatVisibleReader('/tmp/helper', runner)
    await expect(reader.readVisible(target)).rejects.toMatchObject({ code: 'WECHAT_NOT_FRONTMOST' })
  })
})

describe('WechatVisibleScopeTokenStore', () => {
  it('issues a 30-second actor-bound token and consumes it exactly once', () => {
    const store = new WechatVisibleScopeTokenStore()
    const issued = store.issue({
      webContentsId: 7,
      actorId: 'operator-1',
      target,
      actionRunId: 'action-1',
      now: new Date('2026-08-18T06:00:00.000Z')
    })
    expect(issued.scopeToken).toMatch(/^[A-Za-z0-9_-]{43}$/u)
    expect(issued.expiresAt).toBe('2026-08-18T06:00:30.000Z')
    expect(store.consume({
      scopeToken: issued.scopeToken,
      webContentsId: 7,
      actorId: 'operator-1',
      now: new Date('2026-08-18T06:00:29.000Z')
    })).toEqual({ target, actionRunId: 'action-1' })
    expect(() => store.consume({
      scopeToken: issued.scopeToken,
      webContentsId: 7,
      actorId: 'operator-1'
    })).toThrowError(WechatVisibleReadError)
  })

  it('fails closed on actor mismatch and expiry while consuming the token', () => {
    const store = new WechatVisibleScopeTokenStore()
    const issued = store.issue({
      webContentsId: 7,
      actorId: 'operator-1',
      target,
      actionRunId: 'action-1',
      now: new Date('2026-08-18T06:00:00.000Z')
    })
    expect(() => store.consume({
      scopeToken: issued.scopeToken,
      webContentsId: 8,
      actorId: 'operator-1',
      now: new Date('2026-08-18T06:00:01.000Z')
    })).toThrow(/操作者/u)

    const expired = store.issue({
      webContentsId: 7,
      actorId: 'operator-1',
      target,
      actionRunId: 'action-2',
      now: new Date('2026-08-18T06:01:00.000Z')
    })
    expect(() => store.consume({
      scopeToken: expired.scopeToken,
      webContentsId: 7,
      actorId: 'operator-1',
      now: new Date('2026-08-18T06:01:31.000Z')
    })).toThrow(/过期/u)
  })
})
