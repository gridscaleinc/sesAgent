import { createHash } from 'node:crypto'
import net from 'node:net'
import { chmod, lstat, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { collectLocalPersonNameCandidates, MacNaturalLanguageNerClient } from '@local-ai'
import { evaluatePrivacyExpertDataset, privacyExpertDatasetSchema } from '@privacy'
import { installParserNetworkDenyGuard } from '../apps/desktop/src/workers/network-deny'
import {
  computeCloudEnforcementSha256,
  computePrivacyImplementationSha256,
  privacyExpertReportFailures,
  privacyExpertReportVersion
} from './privacy-expert-evidence.mjs'

const root = resolve(import.meta.dirname, '..')
const outputDirectory = resolve(root, 'build/privacy-verification')
const reportPath = resolve(outputDirectory, 'privacy-expert-report.json')
await mkdir(outputDirectory, { recursive: true })
await rm(reportPath, { force: true })

const requestedPath = process.argv[2]?.trim() || process.env.SES_PRIVACY_EXPERT_DATASET?.trim()
if (!requestedPath) {
  process.stderr.write('[privacy-expert] Provide a local dataset path as an argument or SES_PRIVACY_EXPERT_DATASET.\n')
  process.exit(1)
}
const datasetPath = resolve(requestedPath)
const metadata = await lstat(datasetPath)
if (!metadata.isFile() || metadata.isSymbolicLink()) {
  process.stderr.write('[privacy-expert] The dataset must be a regular local file, not a directory or symbolic link.\n')
  process.exit(1)
}
if (metadata.size <= 0 || metadata.size > 10 * 1024 * 1024) {
  process.stderr.write('[privacy-expert] The dataset must be between 1 byte and 10 MB.\n')
  process.exit(1)
}
if (process.platform !== 'win32' && (metadata.mode & 0o077) !== 0) {
  process.stderr.write('[privacy-expert] The dataset must not be readable or writable by group/other users. Run chmod 600 on the local file.\n')
  process.exit(1)
}
const datasetBytes = await readFile(datasetPath)
let parsedJson: unknown
try {
  parsedJson = JSON.parse(datasetBytes.toString('utf8'))
} catch {
  process.stderr.write('[privacy-expert] The dataset is not valid JSON. No case content was logged or copied.\n')
  process.exit(1)
}
const parsed = privacyExpertDatasetSchema.safeParse(parsedJson)
if (!parsed.success) {
  const issues = parsed.error.issues.slice(0, 20).map((issue) => `${issue.path.join('.') || 'root'}:${issue.code}`)
  process.stderr.write(`[privacy-expert] Dataset schema rejected (${issues.join(', ')}). No case content was logged or copied.\n`)
  process.exit(1)
}

installParserNetworkDenyGuard()
let socketBlocked = false
let fetchBlocked = false
try {
  net.connect({ host: '127.0.0.1', port: 9 })
} catch (error) {
  socketBlocked = error instanceof Error && error.message === 'NETWORK_DISABLED_IN_LOCAL_PARSER'
}
try {
  await fetch('https://example.com')
} catch (error) {
  fetchBlocked = error instanceof Error && error.message === 'NETWORK_DISABLED_IN_LOCAL_PARSER'
}
if (!socketBlocked || !fetchBlocked) throw new Error('The local expert evaluator network guard is not active.')

const automaticNamesByCase: Record<string, string[]> = {}
const appleNer = process.platform === 'darwin'
  ? new MacNaturalLanguageNerClient(resolve(root, 'build/native/macos/ses-vision-ocr'))
  : null
for (const testCase of [...parsed.data.cases, ...parsed.data.safeCases]) {
  const localNerResult = appleNer ? await appleNer.detectNames(testCase.text) : undefined
  if (localNerResult && localNerResult.networkAccess !== false) {
    throw new Error('The local Apple NER helper did not prove networkAccess=false.')
  }
  automaticNamesByCase[testCase.id] = collectLocalPersonNameCandidates(testCase.text, localNerResult)
}

const evaluation = evaluatePrivacyExpertDataset(parsed.data, automaticNamesByCase)
const privacyImplementationSha256 = await computePrivacyImplementationSha256(root)
const cloudEnforcementSha256 = await computeCloudEnforcementSha256(root)
const report = {
  version: privacyExpertReportVersion,
  datasetVersion: parsed.data.version,
  datasetSha256: createHash('sha256').update(datasetBytes).digest('hex'),
  privacyImplementationSha256,
  cloudEnforcementSha256,
  humanLabeledDataset: true,
  syntheticOnly: false,
  locale: parsed.data.locale,
  platform: process.platform,
  arch: process.arch,
  reviewedAt: parsed.data.review.reviewedAt,
  evaluatedAt: new Date().toISOString(),
  ...evaluation,
  nameDetectionEngines: process.platform === 'darwin'
    ? ['label-and-form-rules', 'apple-natural-language']
    : ['label-and-form-rules'],
  manualPersonNameReviewRequired: true,
  containsCaseContent: false,
  cloudDirectIdentifiers: 0,
  networkAccess: false,
  nodeNetworkDenyGuard: true
}
const reportFailures = privacyExpertReportFailures(report, {
  platform: process.platform,
  arch: process.arch,
  privacyImplementationSha256,
  cloudEnforcementSha256
})
const finalReport = reportFailures.length === 0
  ? report
  : { ...report, releaseEligible: false, failures: [...new Set([...report.failures, ...reportFailures])] }
await writeFile(reportPath, `${JSON.stringify(finalReport, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 })
await chmod(reportPath, 0o600)
process.stdout.write(`${JSON.stringify(finalReport)}\n`)
if (!finalReport.releaseEligible) process.exit(1)
