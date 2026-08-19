import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { resolve } from 'node:path'

const root = process.cwd()
const read = (path) => readFileSync(resolve(root, path), 'utf8')
const contracts = read('packages/shared/src/contracts.ts')
const actionRuntime = read('packages/action-runtime/src/index.ts')
// Read the whole main-process tree: these checks assert that the implementation
// exists somewhere in the main process, not that it lives in one particular file.
const readMainProcessSources = (directory = 'apps/desktop/src/main') => readdirSync(resolve(root, directory), { withFileTypes: true })
  .flatMap((entry) => entry.isDirectory()
    ? [readMainProcessSources(`${directory}/${entry.name}`)]
    : entry.name.endsWith('.ts') && !entry.name.endsWith('.test.ts') ? [read(`${directory}/${entry.name}`)] : [])
  .join('\n')
const main = readMainProcessSources()
const reader = read('apps/desktop/src/main/wechat-visible-reader.ts')
const helper = read('native/macos/wechat-accessibility/main.swift')
const preload = read('apps/desktop/src/preload/index.ts')
const packageConfiguration = read('electron-builder.yml')
const failures = []

const implementationChecks = [
  [/wechat\.visible\.read/u.test(`${contracts}\n${actionRuntime}`), 'FORMAL_WECHAT_TOOL_MISSING'],
  [/replayPolicy:\s*'never'/u.test(actionRuntime), 'NEVER_REPLAY_POLICY_MISSING'],
  [/frontmost-wechat-visible-conversation/u.test(actionRuntime), 'FOREGROUND_SCOPE_MISSING'],
  [/prepareWechatVisibleRead/u.test(`${contracts}\n${preload}\n${main}`), 'PREPARE_IPC_MISSING'],
  [/executeWechatVisibleRead/u.test(`${contracts}\n${preload}\n${main}`), 'EXECUTE_IPC_MISSING'],
  [/WechatVisibleScopeTokenStore/u.test(main), 'SCOPE_TOKEN_STORE_MISSING'],
  [/SES_WECHAT_VISIBLE_READ_DISABLED/u.test(reader), 'KILL_SWITCH_MISSING'],
  [/30_000/u.test(reader), 'THIRTY_SECOND_TOKEN_EXPIRY_MISSING'],
  [/timingSafeEqual/u.test(reader), 'SCOPE_TOKEN_CONSTANT_TIME_CHECK_MISSING'],
  [/sandbox-exec/u.test(reader) && /\(deny network\*\)/u.test(reader), 'HELPER_NETWORK_SANDBOX_MISSING'],
  [/--network-probe/u.test(helper) && /loopbackDeniedBySandbox/u.test(helper), 'INDEPENDENT_NETWORK_PROBE_MISSING'],
  [/expectedWechatTeamIdentifier\s*=\s*"5A4RE8SF68"/u.test(helper), 'WECHAT_TEAM_ID_PIN_MISSING'],
  [/SecStaticCodeCheckValidity/u.test(helper), 'WECHAT_CODE_SIGNATURE_VALIDATION_MISSING'],
  [/AXIsProcessTrustedWithOptions/u.test(helper), 'ACCESSIBILITY_PERMISSION_GATE_MISSING'],
  [/NSWorkspace\.shared\.frontmostApplication/u.test(helper), 'FRONTMOST_PROCESS_BINDING_MISSING'],
  [/expected-launch-date/u.test(helper), 'PROCESS_START_BINDING_MISSING'],
  [/SCScreenshotManager\.captureImage/u.test(helper), 'WINDOW_CAPTURE_IMPLEMENTATION_MISSING'],
  [/VNRecognizeTextRequest/u.test(helper), 'LOCAL_VISION_OCR_MISSING'],
  [/configuration\.capturesAudio\s*=\s*false/u.test(helper), 'AUDIO_CAPTURE_DISABLE_MISSING'],
  [/configuration\.showsCursor\s*=\s*false/u.test(helper), 'CURSOR_CAPTURE_DISABLE_MISSING'],
  [/createRedactedWechatVisibleJobCaseSource/u.test(main), 'LOCAL_REDACTION_PIPELINE_MISSING'],
  [/node\.text\s*=\s*''/u.test(main), 'RAW_NODE_CLEARING_MISSING'],
  [/rawTextPersisted:\s*false/u.test(main) && /rawImagePersisted:\s*false/u.test(main), 'NON_PERSISTENCE_EVIDENCE_MISSING'],
  [/ses-wechat-accessibility/u.test(packageConfiguration), 'PACKAGED_HELPER_MISSING']
]
for (const [passed, code] of implementationChecks) if (!passed) failures.push(code)

const evidencePath = process.env.SES_WECHAT_FEASIBILITY_EVIDENCE
let evidenceStatus = 'not-provided'
if (evidencePath) {
  const absoluteEvidencePath = resolve(evidencePath)
  if (!existsSync(absoluteEvidencePath)) {
    failures.push('TARGET_EVIDENCE_NOT_FOUND')
  } else {
    const evidence = JSON.parse(readFileSync(absoluteEvidencePath, 'utf8'))
    const filled = (value) => typeof value === 'string' && value.length > 0 && !value.startsWith('REPLACE_')
    const required = [
      process.platform === 'darwin',
      evidence.version === 'wechat-macos-visible-read-acceptance-v2',
      evidence.platform === 'darwin',
      filled(evidence.macosVersion),
      filled(evidence.wechatVersion),
      evidence.wechatBundleIdentifier === 'com.tencent.xinWeChat',
      evidence.wechatTeamIdentifier === '5A4RE8SF68',
      evidence.helper?.signed === true,
      evidence.helper?.hardenedRuntime === true,
      evidence.helper?.separateProcess === true,
      evidence.helper?.noSecretsInherited === true,
      evidence.scope?.oneTimeTokenSeconds === 30,
      evidence.scope?.tokenReplayRejected === true,
      evidence.scope?.frontmostBundlePidStartTimeBound === true,
      evidence.scope?.focusedWindowAndFrameBound === true,
      evidence.scope?.syntheticInputOrHistoryExpansionUsed === false,
      evidence.capture?.axProbePerformed === true,
      Number.isInteger(evidence.capture?.axReadableTextNodeCount),
      evidence.capture?.windowOnlyScreenCapture === true,
      evidence.capture?.conversationRegionCrop === true,
      evidence.capture?.cursorCaptured === false,
      evidence.capture?.audioCaptured === false,
      evidence.capture?.appleVisionOcrLocalOnly === true,
      evidence.capture?.rawImagePersisted === false,
      evidence.networkIsolation?.sandboxDenyNetwork === true,
      evidence.networkIsolation?.loopbackProbeDenied === true,
      evidence.networkIsolation?.externalProbeDenied === true,
      evidence.dataBoundary?.rawTextNeverRenderer === true,
      evidence.dataBoundary?.rawTextNeverPersisted === true,
      evidence.dataBoundary?.redactedSourceOnly === true,
      evidence.dataBoundary?.aggregateOnlyEvidence === true,
      evidence.approvals?.security === 'go',
      evidence.approvals?.product === 'go',
      evidence.approvals?.companyIt === 'go',
      evidence.approvals?.legal === 'go'
    ]
    if (required.some((item) => !item)) failures.push('TARGET_EVIDENCE_INCOMPLETE')
    else evidenceStatus = 'release-go-eligible'
  }
}

if (process.env.SES_WECHAT_RELEASE_REQUIRED === '1' && evidenceStatus !== 'release-go-eligible') {
  failures.push('WECHAT_RELEASE_EVIDENCE_REQUIRED')
}

if (failures.length > 0) {
  console.error(JSON.stringify({ phase: 'B-03-1', status: 'failed', evidenceStatus, failures }))
  process.exit(1)
}

console.log(JSON.stringify({
  phase: 'B-03-1',
  status: evidenceStatus === 'release-go-eligible' ? 'release-go-eligible' : 'implemented-release-no-go',
  evidenceStatus,
  featureFlagEnabled: true,
  formalToolRegistered: true,
  rawTextReadImplemented: true,
  releaseEvidenceVerified: evidenceStatus === 'release-go-eligible'
}))
