import { createHash, randomBytes, timingSafeEqual } from 'node:crypto'
import { existsSync } from 'node:fs'
import { spawn } from 'node:child_process'
import { join } from 'node:path'
import { z } from 'zod'
import type { WechatVisibleMessageFeasibility } from '@shared/contracts'

const helperVersion = 'wechat-macos-accessibility-v1'
const primaryWechatBundleIdentifier = 'com.tencent.xinWeChat'
const helperSandboxProfile = '(version 1) (allow default) (deny network*)'
const maximumHelperOutputBytes = 180_000

const processIdentitySchema = z.object({
  bundleIdentifier: z.string().min(1).max(200),
  processIdentifier: z.number().int().positive(),
  launchDate: z.string().min(1).max(80),
  version: z.string().min(1).max(80),
  buildVersion: z.string().min(1).max(80),
  active: z.boolean(),
  signatureIdentifier: z.string().min(1).max(200),
  teamIdentifier: z.string().min(1).max(80),
  signatureValid: z.boolean()
}).strict()

const preflightOutputSchema = z.object({
  version: z.literal(helperVersion),
  platform: z.literal('darwin'),
  accessibilityTrusted: z.boolean(),
  screenCaptureTrusted: z.boolean(),
  windowCaptureAvailable: z.boolean(),
  helperNetworkAccess: z.literal(false),
  supportedBundleIdentifiers: z.array(z.string().min(1).max(200)).min(1).max(8),
  processes: z.array(processIdentitySchema).max(8)
}).strict()

const rectSchema = z.object({
  x: z.number().finite(),
  y: z.number().finite(),
  width: z.number().positive().finite(),
  height: z.number().positive().finite()
}).strict()

const readOutputSchema = z.object({
  version: z.literal('wechat-visible-message-read-v1'),
  bundleIdentifier: z.literal(primaryWechatBundleIdentifier),
  processIdentifier: z.number().int().positive(),
  launchDate: z.string().min(1).max(80),
  focusedWindowFrame: rectSchema,
  selectedContainerFrame: rectSchema,
  nodes: z.array(z.object({
    role: z.enum(['AXStaticText', 'AXHeading', 'VisionText']),
    text: z.string().min(1).max(100_000),
    frame: rectSchema
  }).strict()).min(1).max(300),
  rawUtf8Bytes: z.number().int().positive().max(100_000),
  truncated: z.boolean(),
  helperNetworkAccess: z.literal(false),
  scope: z.enum([
    'frontmost-focused-window-visible-message-container',
    'frontmost-focused-wechat-window-visible-conversation-crop'
  ]),
  captureMethod: z.enum(['accessibility-tree', 'screen-capture-kit-vision-ocr'])
}).strict().superRefine((value, context) => {
  const measured = Buffer.byteLength(value.nodes.map((node) => node.text).join('\n'), 'utf8')
  if (measured !== value.rawUtf8Bytes) {
    context.addIssue({ code: 'custom', message: 'Helper byte count does not match the visible text payload.' })
  }
})

const helperErrorSchema = z.object({
  errorCode: z.string().regex(/^[A-Z0-9_]{3,120}$/u),
  message: z.string().max(500)
}).strict()

const activationOutputSchema = z.object({
  version: z.literal('wechat-macos-target-activation-v1'),
  bundleIdentifier: z.literal(primaryWechatBundleIdentifier),
  processIdentifier: z.number().int().positive(),
  launchDate: z.string().min(1).max(80),
  activated: z.literal(true),
  helperNetworkAccess: z.literal(false)
}).strict()

const networkProbeOutputSchema = z.object({
  version: z.literal('wechat-helper-network-probe-v1'),
  loopbackDeniedBySandbox: z.literal(true),
  externalDeniedBySandbox: z.literal(true),
  loopbackErrno: z.number().int(),
  externalErrno: z.number().int(),
  helperNetworkAccess: z.literal(false)
}).strict()

export type WechatProcessIdentity = z.infer<typeof processIdentitySchema>
export type WechatHelperPreflight = z.infer<typeof preflightOutputSchema>
export type WechatVisibleReadOutput = z.infer<typeof readOutputSchema>

export class WechatVisibleReadError extends Error {
  constructor(readonly code: string, message = '当前可见微信消息读取失败。') {
    super(message)
    this.name = 'WechatVisibleReadError'
  }
}

export function resolveWechatAccessibilityHelperPath(input: {
  packaged: boolean
  resourcesPath: string
  appPath: string
}): string {
  return input.packaged
    ? join(input.resourcesPath, 'native', 'macos', 'ses-wechat-accessibility')
    : join(input.appPath, 'build', 'native', 'macos', 'ses-wechat-accessibility')
}

export type WechatHelperRunner = (input: {
  helperPath: string
  arguments: string[]
  timeoutMs: number
}) => Promise<unknown>

export const runSandboxedWechatHelper: WechatHelperRunner = ({ helperPath, arguments: helperArguments, timeoutMs }) =>
  new Promise((resolve, reject) => {
    if (process.platform !== 'darwin') {
      reject(new WechatVisibleReadError('TARGET_MACOS_REQUIRED', '微信可见消息读取仅支持 macOS。'))
      return
    }
    if (!existsSync(helperPath) || !existsSync('/usr/bin/sandbox-exec')) {
      reject(new WechatVisibleReadError('WECHAT_HELPER_UNAVAILABLE', '微信本地读取 Helper 尚未安装。'))
      return
    }
    const stdoutChunks: Buffer[] = []
    let stdoutBytes = 0
    let stderrBytes = 0
    let settled = false
    const child = spawn('/usr/bin/sandbox-exec', [
      '-p', helperSandboxProfile, helperPath, ...helperArguments
    ], {
      stdio: ['ignore', 'pipe', 'pipe'],
      env: {
        HOME: process.env.HOME ?? '',
        LANG: process.env.LANG ?? 'ja_JP.UTF-8',
        PATH: '/usr/bin:/bin:/usr/sbin:/sbin',
        TMPDIR: process.env.TMPDIR ?? '/tmp'
      }
    })
    const timer = setTimeout(() => {
      child.kill('SIGKILL')
      finish(new WechatVisibleReadError('WECHAT_HELPER_TIMEOUT', '微信读取超过本地处理时限。'))
    }, timeoutMs)
    timer.unref()

    function wipe(): void {
      for (const chunk of stdoutChunks) chunk.fill(0)
      stdoutChunks.length = 0
    }

    function finish(error?: Error, value?: unknown): void {
      if (settled) return
      settled = true
      clearTimeout(timer)
      if (error) reject(error)
      else resolve(value)
    }

    child.stdout.on('data', (rawChunk: Buffer) => {
      if (settled) return
      const chunk = Buffer.from(rawChunk)
      stdoutBytes += chunk.byteLength
      if (stdoutBytes > maximumHelperOutputBytes) {
        chunk.fill(0)
        child.kill('SIGKILL')
        wipe()
        finish(new WechatVisibleReadError('WECHAT_HELPER_OUTPUT_LIMIT', '微信可见消息超过一次读取上限。'))
        return
      }
      stdoutChunks.push(chunk)
    })
    child.stderr.on('data', (chunk: Buffer) => {
      stderrBytes += chunk.byteLength
      if (stderrBytes > 16_384) child.kill('SIGKILL')
    })
    child.once('error', (cause) => {
      wipe()
      finish(new WechatVisibleReadError('WECHAT_HELPER_LAUNCH_FAILED', cause.message))
    })
    child.once('exit', (code) => {
      if (settled) return
      const output = Buffer.concat(stdoutChunks)
      try {
        const parsed: unknown = JSON.parse(output.toString('utf8'))
        output.fill(0)
        wipe()
        if (code !== 0) {
          const helperError = helperErrorSchema.safeParse(parsed)
          throw new WechatVisibleReadError(
            helperError.success ? helperError.data.errorCode : 'WECHAT_HELPER_FAILED'
          )
        }
        finish(undefined, parsed)
      } catch (cause) {
        output.fill(0)
        wipe()
        finish(cause instanceof WechatVisibleReadError
          ? cause
          : new WechatVisibleReadError('WECHAT_HELPER_INVALID_OUTPUT', '微信 Helper 返回了无效结果。'))
      }
    })
  })

export class MacWechatVisibleReader {
  constructor(
    readonly helperPath: string,
    private readonly runner: WechatHelperRunner = runSandboxedWechatHelper,
    private readonly enabled = process.env.SES_WECHAT_VISIBLE_READ_DISABLED !== '1'
  ) {}

  isEnabled(): boolean { return this.enabled && process.platform === 'darwin' }

  async preflight(promptForPermissions = false): Promise<WechatHelperPreflight> {
    const raw = await this.runner({
      helperPath: this.helperPath,
      arguments: ['--preflight', ...(promptForPermissions ? ['--prompt-accessibility'] : [])],
      timeoutMs: promptForPermissions ? 30_000 : 5_000
    })
    return preflightOutputSchema.parse(raw)
  }

  primaryTarget(preflight: WechatHelperPreflight): WechatProcessIdentity | null {
    return preflight.processes.find((process) =>
      process.bundleIdentifier === primaryWechatBundleIdentifier &&
      process.signatureIdentifier === primaryWechatBundleIdentifier &&
      process.teamIdentifier === '5A4RE8SF68' &&
      process.signatureValid &&
      process.launchDate !== 'unknown'
    ) ?? null
  }

  async activate(target: WechatProcessIdentity): Promise<void> {
    const raw = await this.runner({
      helperPath: this.helperPath,
      arguments: [
        '--activate-target',
        '--expected-pid', String(target.processIdentifier),
        '--expected-launch-date', target.launchDate
      ],
      timeoutMs: 5_000
    })
    const activated = activationOutputSchema.parse(raw)
    if (activated.processIdentifier !== target.processIdentifier || activated.launchDate !== target.launchDate) {
      throw new WechatVisibleReadError('WECHAT_PROCESS_CHANGED', '微信进程在前台切换前发生变化。')
    }
  }

  async verifyNetworkIsolation(): Promise<void> {
    const raw = await this.runner({
      helperPath: this.helperPath,
      arguments: ['--network-probe'],
      timeoutMs: 5_000
    })
    networkProbeOutputSchema.parse(raw)
  }

  async readVisible(target: WechatProcessIdentity): Promise<WechatVisibleReadOutput> {
    const raw = await this.runner({
      helperPath: this.helperPath,
      arguments: [
        '--read-visible', '--allow-local-window-ocr',
        '--expected-pid', String(target.processIdentifier),
        '--expected-launch-date', target.launchDate
      ],
      timeoutMs: 30_000
    })
    const parsed = readOutputSchema.parse(raw)
    if (parsed.processIdentifier !== target.processIdentifier || parsed.launchDate !== target.launchDate) {
      throw new WechatVisibleReadError('WECHAT_PROCESS_CHANGED', '读取期间微信进程发生变化。')
    }
    return parsed
  }

  async feasibility(): Promise<WechatVisibleMessageFeasibility> {
    if (process.platform !== 'darwin') return unavailableWechatFeasibility(['TARGET_MACOS_REQUIRED'])
    if (!this.enabled) return unavailableWechatFeasibility(['WECHAT_FEATURE_KILL_SWITCH_ACTIVE'], false)
    if (!existsSync(this.helperPath) || !existsSync('/usr/bin/sandbox-exec')) {
      return unavailableWechatFeasibility(['WECHAT_HELPER_UNAVAILABLE'])
    }
    try {
      const [preflight] = await Promise.all([
        this.preflight(false),
        this.verifyNetworkIsolation()
      ])
      const target = this.primaryTarget(preflight)
      const failureCodes = [
        ...(!preflight.accessibilityTrusted ? ['MACOS_ACCESSIBILITY_PERMISSION_REQUIRED'] : []),
        ...(!preflight.screenCaptureTrusted ? ['MACOS_SCREEN_CAPTURE_PERMISSION_REQUIRED'] : []),
        ...(!preflight.windowCaptureAvailable ? ['MACOS_14_REQUIRED_FOR_WINDOW_CAPTURE'] : []),
        ...(!target ? ['WECHAT_NOT_RUNNING'] : []),
        'RELEASE_EVIDENCE_PENDING'
      ]
      const runtimeReady = Boolean(
        preflight.accessibilityTrusted && preflight.screenCaptureTrusted && preflight.windowCaptureAvailable && target
      )
      return {
        phase: 'B-03-1',
        gateStatus: runtimeReady ? 'go' : 'no-go',
        platform: process.platform,
        featureFlagEnabled: true,
        userFeatureAvailable: runtimeReady,
        accessibilityTrusted: preflight.accessibilityTrusted,
        screenCaptureTrusted: preflight.screenCaptureTrusted,
        rawTextNetworkIsolationVerified: preflight.helperNetworkAccess === false,
        evidenceVerified: false,
        targetVersion: target?.version ?? null,
        failureCodes
      }
    } catch (cause) {
      return unavailableWechatFeasibility([
        cause instanceof WechatVisibleReadError ? cause.code : 'WECHAT_PREFLIGHT_FAILED'
      ])
    }
  }
}

function unavailableWechatFeasibility(failureCodes: string[], featureFlagEnabled = process.platform === 'darwin'): WechatVisibleMessageFeasibility {
  return {
    phase: 'B-03-1',
    gateStatus: 'no-go',
    platform: process.platform,
    featureFlagEnabled,
    userFeatureAvailable: false,
    accessibilityTrusted: false,
    screenCaptureTrusted: false,
    rawTextNetworkIsolationVerified: false,
    evidenceVerified: false,
    targetVersion: null,
    failureCodes
  }
}

interface StoredScopeToken {
  tokenHash: Buffer
  expiresAt: number
  webContentsId: number
  actorId: string
  target: WechatProcessIdentity
  actionRunId: string
}

export class WechatVisibleScopeTokenStore {
  private current: StoredScopeToken | null = null

  issue(input: {
    webContentsId: number
    actorId: string
    target: WechatProcessIdentity
    actionRunId: string
    now?: Date
  }): { scopeToken: string; expiresAt: string } {
    this.clear()
    const token = randomBytes(32).toString('base64url')
    const now = input.now ?? new Date()
    const expiresAt = now.getTime() + 30_000
    this.current = {
      tokenHash: tokenDigest(token),
      expiresAt,
      webContentsId: input.webContentsId,
      actorId: input.actorId,
      target: input.target,
      actionRunId: input.actionRunId
    }
    return { scopeToken: token, expiresAt: new Date(expiresAt).toISOString() }
  }

  consume(input: {
    scopeToken: string
    webContentsId: number
    actorId: string
    now?: Date
  }): { target: WechatProcessIdentity; actionRunId: string } {
    const current = this.current
    this.current = null
    if (!current) throw new WechatVisibleReadError('WECHAT_SCOPE_TOKEN_MISSING', '本次微信读取授权不存在或已使用。')
    const presented = tokenDigest(input.scopeToken)
    const valid = current.tokenHash.byteLength === presented.byteLength && timingSafeEqual(current.tokenHash, presented)
    current.tokenHash.fill(0)
    presented.fill(0)
    const now = input.now ?? new Date()
    if (!valid) throw new WechatVisibleReadError('WECHAT_SCOPE_TOKEN_INVALID', '本次微信读取授权无效。')
    if (now.getTime() > current.expiresAt) throw new WechatVisibleReadError('WECHAT_SCOPE_TOKEN_EXPIRED', '本次微信读取授权已过期。')
    if (current.webContentsId !== input.webContentsId || current.actorId !== input.actorId) {
      throw new WechatVisibleReadError('WECHAT_SCOPE_TOKEN_ACTOR_MISMATCH', '本次微信读取授权与当前操作者不一致。')
    }
    return { target: current.target, actionRunId: current.actionRunId }
  }

  clear(): void {
    this.current?.tokenHash.fill(0)
    this.current = null
  }
}

function tokenDigest(token: string): Buffer {
  return createHash('sha256').update(token, 'utf8').digest()
}
