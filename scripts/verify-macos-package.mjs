import { execFile, spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { promisify } from 'node:util'
import { pipeline } from 'node:stream/promises'
import { extractFile } from '@electron/asar'
import { privacyExpertReportFailures } from './privacy-expert-evidence.mjs'

const run = promisify(execFile)
const args = process.argv.slice(2)
const requireExpertReport = args.includes('--require-expert-report')
const positional = args.filter((value) => value !== '--require-expert-report')
const appPath = resolve(positional[0] ?? 'release/dev/mac-arm64/SES Agent Desktop.app')
const resourcesPath = join(appPath, 'Contents', 'Resources')
const executablePath = join(appPath, 'Contents', 'MacOS', 'SES Agent Desktop')
const helperPath = join(resourcesPath, 'native', 'macos', 'ses-vision-ocr')
const wechatHelperPath = join(resourcesPath, 'native', 'macos', 'ses-wechat-accessibility')
const asarPath = join(resourcesPath, 'app.asar')
const embeddingModelPath = join(resourcesPath, 'models', 'Xenova', 'multilingual-e5-small')
const rerankerModelPath = join(resourcesPath, 'models', 'hotchpotch', 'japanese-reranker-tiny-v2')
const privacyQualityReportPath = join(resourcesPath, 'verification', 'privacy-quality-report.json')
const privacyExpertReportPath = join(resourcesPath, 'verification', 'privacy-expert-report.json')
const cloudEnforcementManifestPath = join(resourcesPath, 'verification', 'cloud-enforcement-manifest.json')
const userDataPath = await mkdtemp(join(tmpdir(), 'ses-agent-package-smoke-'))

function unexpectedMacOsStderr(value) {
  return value.split('\n').filter((line) => {
    const message = line.trim()
    if (!message) return false
    return !/error messaging the mach port for IMKCFRunLoopWakeUpReliable$/u.test(message)
  }).join('\n')
}

async function inspectMachO(path, label) {
  const { stdout } = await run('/usr/bin/file', [path])
  if (!stdout.includes('arm64')) throw new Error(`${label} is not arm64: ${stdout.trim()}`)
}

async function verifyEmbeddingModel() {
  const manifest = JSON.parse(await readFile(join(embeddingModelPath, 'model-manifest.json'), 'utf8'))
  if (
    manifest.modelId !== 'Xenova/multilingual-e5-small' ||
    manifest.revision !== '761b726dd34fb83930e26aab4e9ac3899aa1fa78' ||
    manifest.embeddingDimension !== 384
  ) throw new Error('Packaged embedding model manifest is invalid.')
  for (const file of manifest.files) {
    const path = join(embeddingModelPath, file.path)
    const metadata = await stat(path)
    const hash = createHash('sha256')
    await pipeline(createReadStream(path), hash)
    if (!metadata.isFile() || metadata.size !== file.bytes || hash.digest('hex') !== file.sha256) {
      throw new Error(`Packaged embedding model failed integrity verification: ${file.path}`)
    }
  }
  await stat(join(resourcesPath, 'THIRD_PARTY_NOTICES.md'))
  return manifest
}

async function verifyRerankerModel() {
  const manifest = JSON.parse(await readFile(join(rerankerModelPath, 'model-manifest.json'), 'utf8'))
  if (
    manifest.schemaVersion !== 'local-reranker-model-v1' ||
    manifest.modelId !== 'hotchpotch/japanese-reranker-tiny-v2' ||
    manifest.revision !== 'ba95175a4d53058816b971f31929f10c5cad8560' ||
    manifest.license !== 'MIT' || manifest.maximumSequenceLength !== 512 || manifest.maximumCandidates !== 20
  ) throw new Error('Packaged reranker model manifest is invalid.')
  const expectedFiles = manifest.files.filter((file) => file.platform === 'all' || file.platform === 'darwin-arm64')
  for (const file of expectedFiles) {
    const path = join(rerankerModelPath, file.path)
    const metadata = await stat(path)
    const hash = createHash('sha256')
    await pipeline(createReadStream(path), hash)
    if (!metadata.isFile() || metadata.size !== file.bytes || hash.digest('hex') !== file.sha256) {
      throw new Error(`Packaged reranker model failed integrity verification: ${file.path}`)
    }
  }
  try {
    await stat(join(rerankerModelPath, 'onnx', 'model_qint8_avx2.onnx'))
    throw new Error('macOS package contains the Windows reranker model.')
  } catch (error) {
    if (error instanceof Error && error.message === 'macOS package contains the Windows reranker model.') throw error
    if (!error || typeof error !== 'object' || error.code !== 'ENOENT') throw error
  }
  return manifest
}

async function runPackagedReranker() {
  return new Promise((resolveResult, reject) => {
    const workerPath = join(asarPath, 'out', 'main', 'reranker-worker.js')
    const child = spawn('/usr/bin/sandbox-exec', [
      '-p', '(version 1) (allow default) (deny network*)', executablePath, workerPath, '--stdio'
    ], {
      env: {
        ELECTRON_RUN_AS_NODE: '1', NODE_ENV: 'production', LANG: 'ja_JP.UTF-8', TZ: 'Asia/Tokyo'
      },
      stdio: ['pipe', 'pipe', 'pipe']
    })
    const stderr = []
    let stdout = Buffer.alloc(0)
    let settled = false
    const timeout = setTimeout(() => {
      child.kill('SIGKILL')
      reject(new Error('Packaged local reranker timed out.'))
    }, 120_000)
    const finish = (callback) => {
      if (settled) return
      settled = true
      clearTimeout(timeout)
      callback()
      if (!child.killed) child.kill('SIGTERM')
    }
    child.stderr.on('data', (chunk) => stderr.push(chunk))
    child.stdout.on('data', (chunk) => {
      stdout = Buffer.concat([stdout, chunk])
      const newline = stdout.indexOf(0x0a)
      if (newline < 0) return
      try {
        const result = JSON.parse(stdout.subarray(0, newline).toString('utf8'))
        const relevant = result.scores?.find((score) => score.id === 'relevant')?.score
        const irrelevant = result.scores?.find((score) => score.id === 'irrelevant')?.score
        if (
          result.ok !== true || result.networkAccess !== false ||
          result.modelId !== 'hotchpotch/japanese-reranker-tiny-v2' ||
          typeof relevant !== 'number' || typeof irrelevant !== 'number' || relevant <= irrelevant
        ) throw new Error(`Packaged local reranker returned an unexpected result: ${JSON.stringify(result)}`)
        finish(() => resolveResult(result))
      } catch (error) {
        finish(() => reject(error))
      }
    })
    child.once('error', (error) => finish(() => reject(error)))
    child.once('exit', (code) => {
      if (!settled) finish(() => reject(new Error(`Packaged local reranker exited (${code}): ${Buffer.concat(stderr).toString('utf8')}`)))
    })
    child.stdin.end(`${JSON.stringify({
      id: 'macos-package-reranker-smoke',
      kind: 'rerank',
      query: 'AWS と Terraform によるクラウド基盤設計',
      candidates: [
        { id: 'relevant', text: 'AWS Terraform を用いたクラウド基盤の設計と構築を担当' },
        { id: 'irrelevant', text: '飲食店での接客と店舗運営を担当' }
      ],
      modelDirectory: rerankerModelPath
    })}\n`)
  })
}

async function runNativeNer() {
  return new Promise((resolveResult, reject) => {
    const child = spawn('/usr/bin/sandbox-exec', [
      '-p',
      '(version 1) (allow default) (deny network*)',
      helperPath,
      '--detect-names'
    ], { stdio: ['pipe', 'pipe', 'pipe'] })
    const stdout = []
    const stderr = []
    const timeout = setTimeout(() => {
      child.kill('SIGKILL')
      reject(new Error('Packaged local NER helper timed out.'))
    }, 15_000)
    child.stdout.on('data', (chunk) => stdout.push(chunk))
    child.stderr.on('data', (chunk) => stderr.push(chunk))
    child.once('error', reject)
    child.once('exit', (code) => {
      clearTimeout(timeout)
      if (code !== 0) {
        reject(new Error(`Packaged local NER helper failed (${code}): ${Buffer.concat(stderr).toString('utf8')}`))
        return
      }
      try {
        const result = JSON.parse(Buffer.concat(stdout).toString('utf8'))
        const detectedNames = Array.isArray(result.entities) ? result.entities.map((entity) => entity.text) : []
        if (
          result.networkAccess !== false || result.engine !== 'apple-natural-language' ||
          result.requiresHumanConfirmation !== true ||
          !detectedNames.includes('Tim Cook') || !detectedNames.includes('Satya Nadella')
        ) {
          throw new Error('Packaged local NER helper returned an unsafe or unexpected capability declaration.')
        }
        resolveResult(result)
      } catch (error) {
        reject(error)
      }
    })
    child.stdin.end('Tim Cook met Satya Nadella in Tokyo.')
  })
}

async function verifyPrivacyQualityReport() {
  const report = JSON.parse(await readFile(privacyQualityReportPath, 'utf8'))
  if (
    report.version !== 'ses-privacy-quality-report-v1' || report.datasetVersion !== 'ses-privacy-regression-v1' ||
    report.datasetSha256 !== '83ce7ac64d07337b41bdd303450c97cc894e74fcf36730bcade60cbb2bf9cb4e' ||
    report.syntheticOnly !== true || report.humanLabeledDataset !== false ||
    report.platform !== 'darwin' || report.arch !== 'arm64' || report.caseCount !== 28 ||
    report.expectedIdentifiers !== 30 || report.detectedIdentifiers !== 30 ||
    report.identifierRecall !== 1 || report.redactionPrecision !== 1 ||
    report.residualLeakCount !== 0 || report.safeCaseFalsePositiveCount !== 0 ||
    report.failedClosedCases !== 4 || report.cloudDirectIdentifiers !== 0 ||
    report.networkAccess !== false || report.appleNer?.verified !== true || report.releaseEligible !== true
  ) throw new Error('Packaged privacy quality report is missing, stale, or incomplete.')
  return report
}

async function verifyPrivacyExpertReport() {
  let report
  try {
    report = JSON.parse(await readFile(privacyExpertReportPath, 'utf8'))
  } catch (error) {
    if (!requireExpertReport && error && typeof error === 'object' && error.code === 'ENOENT') return null
    throw new Error('Packaged human-labeled privacy report is missing or unreadable.')
  }
  if (
    report.version !== 'ses-privacy-expert-quality-report-v2' ||
    report.datasetVersion !== 'ses-privacy-expert-dataset-v1' ||
    report.humanLabeledDataset !== true || report.syntheticOnly !== false ||
    report.locale !== 'ja-JP' || report.platform !== 'darwin' || report.arch !== 'arm64' ||
    report.containsCaseContent !== false || report.cloudDirectIdentifiers !== 0 || report.networkAccess !== false ||
    !/^[a-f0-9]{64}$/u.test(report.datasetSha256 ?? '') ||
    !/^[a-f0-9]{64}$/u.test(report.privacyImplementationSha256 ?? '') ||
    !/^[a-f0-9]{64}$/u.test(report.cloudEnforcementSha256 ?? '')
  ) throw new Error('Packaged human-labeled privacy report violates its aggregate-only contract.')
  if (requireExpertReport && privacyExpertReportFailures(report, { platform: 'darwin', arch: 'arm64' }).length > 0) {
    throw new Error('Packaged human-labeled privacy report did not pass the formal release threshold.')
  }
  return report
}

async function verifyCloudEnforcementManifest(privacyExpert) {
  const manifest = JSON.parse(await readFile(cloudEnforcementManifestPath, 'utf8'))
  const [qualityReportBytes, expertReportBytes] = await Promise.all([
    readFile(privacyQualityReportPath),
    privacyExpert ? readFile(privacyExpertReportPath) : Promise.resolve(null)
  ])
  const hash = (bytes) => bytes ? createHash('sha256').update(bytes).digest('hex') : null
  const runtimeBundleFiles = Array.isArray(manifest.runtimeBundleFiles) ? manifest.runtimeBundleFiles : []
  const runtimeBundleSetHash = createHash('sha256')
  const runtimeBundlePaths = new Set()
  for (const file of runtimeBundleFiles) {
    if (
      typeof file.path !== 'string' || typeof file.sha256 !== 'string' ||
      (!file.path.startsWith('out/main/') && !file.path.startsWith('out/preload/')) ||
      file.path.includes('..') || file.path.includes('\\') || runtimeBundlePaths.has(file.path)
    ) throw new Error('Packaged Cloud enforcement manifest contains an unsafe runtime bundle path.')
    const bytes = extractFile(asarPath, file.path)
    if (hash(bytes) !== file.sha256) throw new Error(`Packaged runtime bundle is stale: ${file.path}`)
    runtimeBundleSetHash.update(file.path).update('\0').update(bytes).update('\0')
    runtimeBundlePaths.add(file.path)
  }
  if (
    manifest.version !== 'ses-cloud-enforcement-manifest-v2' ||
    manifest.platform !== 'darwin' || manifest.arch !== 'arm64' ||
    !runtimeBundlePaths.has('out/main/index.js') || !runtimeBundlePaths.has('out/preload/index.js') ||
    manifest.runtimeBundleSetSha256 !== runtimeBundleSetHash.digest('hex') ||
    manifest.qualityReportSha256 !== hash(qualityReportBytes) ||
    manifest.expertReportSha256 !== hash(expertReportBytes) ||
    !/^[a-f0-9]{64}$/u.test(manifest.privacyImplementationSha256 ?? '') ||
    !/^[a-f0-9]{64}$/u.test(manifest.cloudEnforcementSourceSha256 ?? '') ||
    manifest.qualityGateBound !== true
  ) throw new Error('Packaged Cloud enforcement manifest is missing, stale, or incomplete.')
  const expertFailures = privacyExpert
    ? privacyExpertReportFailures(privacyExpert, {
        platform: 'darwin',
        arch: 'arm64',
        privacyImplementationSha256: manifest.privacyImplementationSha256,
        cloudEnforcementSha256: manifest.cloudEnforcementSourceSha256
      })
    : ['report:missing']
  const expertBound = expertFailures.length === 0
  if (
    manifest.expertAttestationBound !== expertBound ||
    manifest.releaseEligible !== true ||
    (privacyExpert && (
      privacyExpert.privacyImplementationSha256 !== manifest.privacyImplementationSha256 ||
      privacyExpert.cloudEnforcementSha256 !== manifest.cloudEnforcementSourceSha256
    ))
  ) throw new Error('Packaged expert evidence is not bound to the Cloud enforcement manifest.')
  if (requireExpertReport && !expertBound) {
    throw new Error(`Packaged optional expert evidence was explicitly required but is not valid: ${expertFailures.join(',')}`)
  }
  return manifest
}

function parseAgentSmoke(output) {
  const line = output.split('\n').find((candidate) => candidate.includes('[agent-bridge-smoke]'))
  if (!line) throw new Error(`Packaged Agent bridge smoke output is missing.\n${output}`)
  const json = line.slice(line.indexOf('[agent-bridge-smoke]') + '[agent-bridge-smoke]'.length).trim()
  return JSON.parse(json)
}

async function launchSmoke(featureMode = 'default', agentSmokeConversationId = null) {
  return new Promise((resolveResult, reject) => {
    const env = { ...process.env, SES_RELEASE_SMOKE: '1' }
    if (featureMode === 'enabled') env.SES_CONVERSATIONAL_MATCHING_ENABLED = '1'
    else if (featureMode === 'disabled') env.SES_CONVERSATIONAL_MATCHING_ENABLED = '0'
    else delete env.SES_CONVERSATIONAL_MATCHING_ENABLED
    if (agentSmokeConversationId) env.SES_AGENT_SMOKE_CONVERSATION_ID = agentSmokeConversationId
    else delete env.SES_AGENT_SMOKE_CONVERSATION_ID
    const child = spawn(executablePath, [`--user-data-dir=${userDataPath}`], {
      env,
      stdio: ['ignore', 'pipe', 'pipe']
    })
    const stdout = []
    const stderr = []
    const timeout = setTimeout(() => {
      child.kill('SIGKILL')
      reject(new Error('Packaged application smoke launch timed out.'))
    }, 30_000)
    child.stdout.on('data', (chunk) => stdout.push(chunk))
    child.stderr.on('data', (chunk) => stderr.push(chunk))
    child.once('error', reject)
    child.once('exit', (code) => {
      clearTimeout(timeout)
      const output = Buffer.concat(stdout).toString('utf8')
      const errors = Buffer.concat(stderr).toString('utf8')
      if (code !== 0) {
        reject(new Error(`Packaged application exited with ${code}.\n${output}\n${errors}`))
        return
      }
      if (!output.includes('[storage-ready]') || !output.includes('[renderer-ready]')) {
        reject(new Error(`Packaged application did not reach storage and renderer readiness.\n${output}\n${errors}`))
        return
      }
      if (!output.includes("api: 'object'")) {
        reject(new Error(`Packaged preload bridge was unavailable.\n${output}`))
        return
      }
      if (!/schemaVersion:\s*39\b/u.test(output)) {
        reject(new Error(`Packaged application did not initialize Schema v39.\n${output}`))
        return
      }
      resolveResult({ output, errors, agentSmoke: parseAgentSmoke(output) })
    })
  })
}

async function launchKeyLossRecoverySmoke() {
  await rm(join(userDataPath, 'security', 'master-key.v1'), { force: true })
  return new Promise((resolveResult, reject) => {
    const child = spawn(executablePath, [`--user-data-dir=${userDataPath}`], {
      env: { ...process.env, SES_RELEASE_SMOKE: '1' },
      stdio: ['ignore', 'pipe', 'pipe']
    })
    const stdout = []
    const stderr = []
    const timeout = setTimeout(() => {
      child.kill('SIGKILL')
      reject(new Error('Packaged key-loss recovery smoke launch timed out.'))
    }, 30_000)
    child.stdout.on('data', (chunk) => stdout.push(chunk))
    child.stderr.on('data', (chunk) => stderr.push(chunk))
    child.once('error', reject)
    child.once('exit', (code) => {
      clearTimeout(timeout)
      const output = Buffer.concat(stdout).toString('utf8')
      const errors = Buffer.concat(stderr).toString('utf8')
      if (code !== 0) {
        reject(new Error(`Packaged key-loss recovery mode exited with ${code}.\n${output}\n${errors}`))
        return
      }
      if (!output.includes('[startup-recovery-ready]') || !output.includes('[renderer-ready]')) {
        reject(new Error(`Packaged application did not enter visible startup recovery mode.\n${output}\n${errors}`))
        return
      }
      if (!output.includes('ローカルデータを開けません')) {
        reject(new Error(`Packaged startup recovery renderer did not explain the failure.\n${output}`))
        return
      }
      const unexpectedErrors = unexpectedMacOsStderr(errors)
      if (unexpectedErrors) {
        reject(new Error(`Packaged startup recovery mode emitted unexpected stderr.\n${unexpectedErrors}`))
        return
      }
      resolveResult({ output, errors })
    })
  })
}

async function runPackagedEmlParser() {
  const { stdout, stderr } = await run(executablePath, [
    resolve('scripts/verify-packaged-eml-worker.mjs'),
    asarPath
  ], {
    env: { ELECTRON_RUN_AS_NODE: '1', NODE_ENV: 'production', LANG: 'ja_JP.UTF-8', TZ: 'Asia/Tokyo' },
    maxBuffer: 4 * 1024 * 1024
  })
  if (stderr.trim()) throw new Error(`Packaged EML parser emitted stderr: ${stderr.trim()}`)
  const result = JSON.parse(stdout)
  if (
    result.version !== 'parsed-eml-v1' ||
    result.classification !== 'job-case' ||
    result.attachmentCount !== 1 ||
    result.externalContentLoaded !== false ||
    result.attachmentPersisted !== false ||
    result.rawFileCloudEligible !== false
  ) throw new Error('Packaged EML worker violated its local privacy contract.')
  return result
}

try {
  const appStats = await stat(appPath)
  if (!appStats.isDirectory()) throw new Error(`macOS app bundle is not a directory: ${appPath}`)
  await inspectMachO(executablePath, 'Electron application executable')
  await inspectMachO(helperPath, 'Apple Vision/NaturalLanguage helper')
  await inspectMachO(wechatHelperPath, 'macOS WeChat visible-read helper')

  const helperStats = await stat(helperPath)
  if ((helperStats.mode & 0o111) === 0) throw new Error('Packaged native helper is not executable.')
  const wechatHelperStats = await stat(wechatHelperPath)
  if ((wechatHelperStats.mode & 0o111) === 0) throw new Error('Packaged WeChat helper is not executable.')

  const { stdout: plist } = await run('/usr/bin/plutil', ['-p', join(appPath, 'Contents', 'Info.plist')])
  if (!plist.includes('jp.sesai.agentdesktop')) throw new Error('Packaged application identifier is incorrect.')
  if (!plist.includes('CFBundleURLSchemes') || !plist.includes('com.gridscale.native.ses-agent')) {
    throw new Error('Packaged application is missing the SES Member Center callback scheme.')
  }
  if (!plist.includes('LSMinimumSystemVersion') || !plist.includes('13.0.0')) {
    throw new Error('Packaged application minimum macOS version is not 13.0.0.')
  }

  const { stdout: helperLoadCommands } = await run('/usr/bin/otool', ['-l', helperPath])
  if (!/\bminos\s+13\.0\b/u.test(helperLoadCommands)) {
    throw new Error('Packaged native helper does not support the declared macOS 13 minimum.')
  }
  const { stdout: wechatHelperLoadCommands } = await run('/usr/bin/otool', ['-l', wechatHelperPath])
  if (!/\bminos\s+13\.0\b/u.test(wechatHelperLoadCommands)) {
    throw new Error('Packaged WeChat helper does not support the declared macOS 13 minimum.')
  }
  const { stdout: wechatNetworkProbe } = await run('/usr/bin/sandbox-exec', [
    '-p', '(version 1) (allow default) (deny network*)', wechatHelperPath, '--network-probe'
  ])
  const wechatNetworkEvidence = JSON.parse(wechatNetworkProbe)
  if (
    wechatNetworkEvidence.version !== 'wechat-helper-network-probe-v1' ||
    wechatNetworkEvidence.loopbackDeniedBySandbox !== true ||
    wechatNetworkEvidence.externalDeniedBySandbox !== true ||
    wechatNetworkEvidence.helperNetworkAccess !== false
  ) throw new Error('Packaged WeChat helper network isolation probe failed.')

  const { stdout: asarEntries } = await run(process.execPath, [
    resolve('node_modules/@electron/asar/bin/asar.js'),
    'list',
    asarPath
  ])
  for (const expected of ['/out/main/index.js', '/out/main/embedding-worker.js', '/out/main/reranker-worker.js', '/out/preload/index.js', '/out/renderer/index.html']) {
    if (!asarEntries.includes(expected)) throw new Error(`Packaged ASAR is missing ${expected}.`)
  }
  const asarEntryList = asarEntries.split('\n').filter(Boolean)
  const packagedMainSource = asarEntryList
    .filter((entry) => entry.startsWith('/out/main/') && entry.endsWith('.js'))
    .map((entry) => extractFile(asarPath, entry.slice(1)).toString('utf8'))
    .join('\n')
  const packagedPreloadSource = extractFile(asarPath, 'out/preload/index.js').toString('utf8')
  const packagedRendererSource = asarEntryList
    .filter((entry) => entry.startsWith('/out/renderer/') && entry.endsWith('.js'))
    .map((entry) => extractFile(asarPath, entry.slice(1)).toString('utf8'))
    .join('\n')
  if (
    !packagedMainSource.includes('agent:execute-turn') || !packagedMainSource.includes('agent:cancel-turn') ||
    !packagedMainSource.includes('agent:turn-event') || !packagedMainSource.includes('response.output_text.delta') ||
    !packagedMainSource.includes('/v1/ai/native/openai/v1/responses') || !packagedMainSource.includes('gpt-5.6-luna') ||
    !packagedMainSource.includes('deepseek-v4-flash') || !packagedMainSource.includes('/v1/chat/completions') ||
    !packagedMainSource.includes('stream_options') || !packagedMainSource.includes('search_job_cases') ||
    !packagedMainSource.includes('read_candidate_profile') || !packagedMainSource.includes('read_candidate_interviews') ||
    !packagedMainSource.includes('candidate.profile.read.local') || !packagedMainSource.includes('candidate.interview.read.local') ||
    !packagedMainSource.includes('AI 未按受控规划 JSON 协议返回') ||
    !packagedMainSource.includes('ses-agent-direct-answer-context-v2') ||
    !packagedMainSource.includes('CONVERSATION_CONTEXT_MISMATCH') || !packagedMainSource.includes('job-case.search.local') ||
    !packagedPreloadSource.includes('executeAgentTurn') || !packagedPreloadSource.includes('cancelAgentTurn') || !packagedPreloadSource.includes('onAgentTurnEvent') ||
    !packagedRendererSource.includes('conversationalMatchingEnabled') || !packagedRendererSource.includes('发送下一条消息时，Agent 会读取此工作区的最新本机数据') ||
    !packagedRendererSource.includes('DeepSeek V4 Flash') || !packagedRendererSource.includes('正在理解问题并选择 Tool') ||
    !packagedRendererSource.includes('matching-page')
  ) throw new Error('Packaged ASAR is missing the Agent Main/Preload/Renderer surface or classic matching fallback.')
  if (packagedRendererSource.includes('DeepSeek V4 Flash 正在理解问题并选择 Tool')) {
    throw new Error('Packaged Agent progress text exposes a concrete model name.')
  }
  for (const forbiddenGmailCapability of [
    '/gmail/v1/users/me/drafts', '/gmail/v1/users/me/messages/send', '/gmail/v1/users/me/drafts/send',
    'client_secret'
  ]) {
    if (packagedMainSource.includes(forbiddenGmailCapability)) {
      throw new Error(`Packaged application contains forbidden Gmail capability ${forbiddenGmailCapability}.`)
    }
  }
  if (!packagedMainSource.includes('historyTypes", "messageAdded') || !packagedMainSource.includes('historyTypes", "labelAdded')) {
    throw new Error('Packaged Gmail incremental synchronization is missing messageAdded or labelAdded coverage.')
  }
  for (const windowsOnly of [
    '/out/main/windows-ocr-worker.js',
    '/out/main/tesseract-worker.js',
    '/node_modules/tesseract.js',
    '/node_modules/tesseract.js-core',
    '/node_modules/@tesseract.js-data',
    '/node_modules/@napi-rs/canvas'
  ]) {
    if (asarEntryList.some((entry) => entry === windowsOnly || entry.startsWith(`${windowsOnly}/`))) {
      throw new Error(`macOS package contains Windows-only OCR resource ${windowsOnly}.`)
    }
  }
  if (asarEntryList.some((entry) => entry.startsWith('/node_modules/@napi-rs/canvas-'))) {
    throw new Error('macOS package contains a Windows-OCR-only Canvas native runtime.')
  }
  for (const forbiddenRoot of ['/apps', '/packages', '/tests', '/.env']) {
    if (asarEntryList.some((entry) => entry === forbiddenRoot || entry.startsWith(`${forbiddenRoot}/`))) {
      throw new Error(`Packaged ASAR contains forbidden project path ${forbiddenRoot}.`)
    }
  }

  const { stdout: nativeModules } = await run('/usr/bin/find', [
    join(resourcesPath, 'app.asar.unpacked'),
    '-name',
    '*.node',
    '-type',
    'f'
  ])
  const nativeModulePaths = nativeModules.trim().split('\n').filter(Boolean)
  if (nativeModulePaths.length === 0) throw new Error('No unpacked native database module was found.')
  if (!nativeModulePaths.some((path) => path.endsWith('onnxruntime_binding.node'))) {
    throw new Error('Packaged local embedding runtime is missing its native ONNX module.')
  }
  for (const modulePath of nativeModulePaths) await inspectMachO(modulePath, 'Native Node module')

  const embeddingModel = await verifyEmbeddingModel()
  const rerankerModel = await verifyRerankerModel()
  const privacyQuality = await verifyPrivacyQualityReport()
  const privacyExpert = await verifyPrivacyExpertReport()
  const cloudEnforcement = await verifyCloudEnforcementManifest(privacyExpert)
  const ner = await runNativeNer()
  const eml = await runPackagedEmlParser()
  const reranker = await runPackagedReranker()
  const defaultLaunch = await launchSmoke()
  if (
    defaultLaunch.agentSmoke.bridge !== 'object' ||
    defaultLaunch.agentSmoke.conversationalMatchingEnabled !== true ||
    defaultLaunch.agentSmoke.turnStatus !== 'failed' ||
    defaultLaunch.agentSmoke.planningFailedClosed !== true ||
    defaultLaunch.agentSmoke.saved !== true ||
    typeof defaultLaunch.agentSmoke.conversationId !== 'string'
  ) throw new Error(`Packaged default Agent entry smoke failed: ${JSON.stringify(defaultLaunch.agentSmoke)}`)
  const classicFallbackLaunch = await launchSmoke('disabled')
  if (
    classicFallbackLaunch.agentSmoke.bridge !== 'object' ||
    classicFallbackLaunch.agentSmoke.conversationalMatchingEnabled !== false ||
    classicFallbackLaunch.agentSmoke.classicMatchingPath !== true
  ) throw new Error(`Packaged explicit classic fallback smoke failed: ${JSON.stringify(classicFallbackLaunch.agentSmoke)}`)
  const agentDeleteLaunch = await launchSmoke('default', defaultLaunch.agentSmoke.conversationId)
  if (
    agentDeleteLaunch.agentSmoke.bridge !== 'object' ||
    agentDeleteLaunch.agentSmoke.conversationalMatchingEnabled !== true ||
    agentDeleteLaunch.agentSmoke.reopened !== true ||
    agentDeleteLaunch.agentSmoke.deleted !== true ||
    agentDeleteLaunch.agentSmoke.remaining !== false
  ) throw new Error(`Packaged Agent restart/read/delete smoke failed: ${JSON.stringify(agentDeleteLaunch.agentSmoke)}`)
  const database = await readFile(join(userDataPath, 'data', 'ses-agent.db'))
  if (database.subarray(0, 16).toString('utf8') === 'SQLite format 3\u0000') {
    throw new Error('Packaged smoke database is not encrypted.')
  }
  const recoveryLaunch = await launchKeyLossRecoverySmoke()

  process.stdout.write(`${JSON.stringify({
    appPath,
    bundleIdentifier: 'jp.sesai.agentdesktop',
    nativeModules: nativeModulePaths.length,
    localEmbeddingModel: embeddingModel.modelId,
    localEmbeddingDimension: embeddingModel.embeddingDimension,
    localEmbeddingIntegrity: true,
    localRerankerModel: rerankerModel.modelId,
    localRerankerIntegrity: true,
    packagedRerankerCompleted: reranker.ok === true,
    privacyQualityDataset: privacyQuality.datasetVersion,
    privacyQualitySyntheticOnly: privacyQuality.syntheticOnly,
    privacyIdentifierRecall: privacyQuality.identifierRecall,
    privacyRedactionPrecision: privacyQuality.redactionPrecision,
    privacyResidualLeaks: privacyQuality.residualLeakCount,
    privacyExpertRequired: requireExpertReport,
    privacyExpertStatus: privacyExpert?.releaseEligible === true ? 'passed' : 'not-verified',
    privacyExpertCases: privacyExpert?.caseCount ?? 0,
    cloudEnforcementRuntimeBundleSetSha256: cloudEnforcement.runtimeBundleSetSha256,
    cloudEnforcementReleaseEligible: cloudEnforcement.releaseEligible,
    gmailApiContract: 'get-only',
    gmailIncrementalEvents: ['messageAdded', 'labelAdded'],
    gmailClientSecretPath: false,
    localNerEngine: ner.engine,
    localNerNetworkAccess: ner.networkAccess,
    localNerExpectedNamesDetected: true,
    packagedEmlParser: eml.version,
    emlAttachmentPersisted: eml.attachmentPersisted,
    schemaVersion: 39,
    encryptedDatabase: true,
    rendererReady: defaultLaunch.output.includes('[renderer-ready]') && classicFallbackLaunch.output.includes('[renderer-ready]') && agentDeleteLaunch.output.includes('[renderer-ready]'),
    agentBridge: true,
    agentDefaultChatEntry: true,
    agentExplicitClassicFallback: true,
    aiPlannedToolRouting: true,
    agentToolCatalogDriven: true,
    agentCandidateProfileRead: true,
    agentCandidateInterviewRead: true,
    agentProgressHidesConcreteModel: true,
    agentPlanningFailsClosedWithoutCloud: true,
    deepSeekModelAvailable: true,
    agentConversationSaveRestartDelete: true,
    keyLossRecoveryModeReady: recoveryLaunch.output.includes('[startup-recovery-ready]'),
    activeDataPreservedOnKeyLoss: true,
    stderr: [defaultLaunch.errors.trim(), classicFallbackLaunch.errors.trim(), agentDeleteLaunch.errors.trim(), recoveryLaunch.errors.trim()].filter(Boolean).join('\n') || null
  }, null, 2)}\n`)
} finally {
  await rm(userDataPath, { recursive: true, force: true })
}
