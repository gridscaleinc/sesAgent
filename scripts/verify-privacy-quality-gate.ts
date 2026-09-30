import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { existsSync } from 'node:fs'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { z } from 'zod'
import {
  collectLocalPersonNameCandidates,
  LocalUnionPersonNameDetector,
  localNerModel,
  MacNaturalLanguageNerClient,
  type LocalPersonNameDetectorPort,
  type NameDetectionResult
} from '@local-ai'
import { directIdentifierTypes, detectDirectIdentifiers, redactTextForCloud } from '@privacy'
import { InProcessGlinerNameDetector, releaseGlinerRuntime } from '../apps/desktop/src/workers/ner-engine'
import { installParserNetworkDenyGuard } from '../apps/desktop/src/workers/network-deny'

// Synthetic fixtures only, and nothing here may reach the network.
installParserNetworkDenyGuard()

const expectedIdentifierSchema = z.object({
  type: z.enum(directIdentifierTypes),
  value: z.string().min(1).max(200)
})
const datasetSchema = z.object({
  version: z.literal('ses-privacy-regression-v1'),
  syntheticOnly: z.literal(true),
  description: z.string().min(1).max(300),
  thresholds: z.object({
    identifierRecall: z.literal(1),
    redactionPrecision: z.literal(1),
    residualLeakCount: z.literal(0),
    safeCaseFalsePositiveCount: z.literal(0)
  }),
  cases: z
    .array(
      z.object({
        id: z.string().regex(/^[a-z0-9-]+$/u),
        text: z.string().min(1).max(2_000),
        expected: z.array(expectedIdentifierSchema).min(1).max(20)
      })
    )
    .min(20)
    .max(100),
  safeCases: z
    .array(
      z.object({
        id: z.string().regex(/^[a-z0-9-]+$/u),
        text: z.string().min(1).max(2_000)
      })
    )
    .min(5)
    .max(50),
  blockedCases: z
    .array(
      z.object({
        id: z.string().regex(/^[a-z0-9-]+$/u),
        text: z.string().min(1).max(2_000),
        reason: z.string().min(1).max(100),
        mediaRisk: z.enum(['face_or_photo', 'signature', 'identifying_qr_code']).optional()
      })
    )
    .min(4)
    .max(20)
})

const root = resolve(import.meta.dirname, '..')
const datasetPath = resolve(root, 'examples/ses-privacy-regression-v1.json')
const datasetBytes = await readFile(datasetPath)
const dataset = datasetSchema.parse(JSON.parse(datasetBytes.toString('utf8')))
const ids = [...dataset.cases, ...dataset.safeCases, ...dataset.blockedCases].map((testCase) => testCase.id)
assert.equal(new Set(ids).size, ids.length, 'privacy regression case IDs must be unique')

const failures: string[] = []

// The regression path runs the detector the platform uses at runtime: Apple
// NaturalLanguage ∪ GLiNER on macOS (Apple alone when the GLiNER model is not
// present), GLiNER on Windows. GLiNER runs the worker's inference code in this
// already network-denied process; worker isolation is checked by
// test:ner-worker and test:windows-local-workers.
const nerModelDirectory = resolve(root, 'models/knowledgator/gliner-x-small')
const glinerRequired = process.platform === 'win32' || existsSync(resolve(nerModelDirectory, 'model-manifest.json'))
const gliner = glinerRequired ? new InProcessGlinerNameDetector(nerModelDirectory) : null
const apple = process.platform === 'darwin' ? new MacNaturalLanguageNerClient(resolve(root, 'build/native/macos/ses-vision-ocr')) : null
let glinerFailure: string | null = null
const runtimeDetector: LocalPersonNameDetectorPort | null =
  apple && gliner
    ? new LocalUnionPersonNameDetector(apple, gliner, () => {
        glinerFailure = 'gliner-ner:unavailable-during-regression'
      })
    : (apple ?? gliner)

async function localNameDetection(text: string, caseId: string): Promise<NameDetectionResult | undefined> {
  if (!runtimeDetector) return undefined
  try {
    const result = await runtimeDetector.detectNames(text)
    if (result.networkAccess !== false) failures.push(`${caseId}:local-ner-network-access`)
    return result
  } catch {
    failures.push(`${caseId}:local-ner-failed`)
    return undefined
  }
}

let expectedIdentifiers = 0
let detectedIdentifiers = 0
let mappingCount = 0
let expectedMappingCount = 0
let residualLeakCount = 0

for (const testCase of dataset.cases) {
  const nameCandidates = collectLocalPersonNameCandidates(testCase.text, await localNameDetection(testCase.text, testCase.id))
  const expectedNames = testCase.expected.filter((item) => item.type === 'person_name').map((item) => item.value)
  for (const name of expectedNames) {
    if (!nameCandidates.includes(name)) failures.push(`${testCase.id}:person-name-candidate-missed:${name}`)
  }
  const redaction = redactTextForCloud(testCase.text, {
    sourceVersion: `privacy-regression:${testCase.id}`,
    knownPersonNames: nameCandidates,
    personNameReviewCompleted: true,
    now: new Date('2026-07-20T00:00:00.000Z')
  })
  if (redaction.session.status !== 'passed' || !redaction.payload) {
    failures.push(`${testCase.id}:redaction-did-not-pass:${redaction.blockedReasons.join(',')}`)
  }
  const actualMappings = new Set(redaction.mappings.map((mapping) => `${mapping.identifierType}\u0000${mapping.originalValue}`))
  const expectedMappings = new Set(testCase.expected.map((item) => `${item.type}\u0000${item.value}`))
  expectedIdentifiers += expectedMappings.size
  mappingCount += actualMappings.size
  for (const expected of expectedMappings) {
    if (actualMappings.has(expected)) {
      detectedIdentifiers += 1
      expectedMappingCount += 1
    } else {
      failures.push(`${testCase.id}:expected-mapping-missed:${expected.replace('\u0000', ':')}`)
    }
  }
  for (const actual of actualMappings) {
    if (!expectedMappings.has(actual)) failures.push(`${testCase.id}:unexpected-mapping:${actual.replace('\u0000', ':')}`)
  }
  for (const expected of testCase.expected) {
    if (redaction.redactedContent.includes(expected.value)) {
      residualLeakCount += 1
      failures.push(`${testCase.id}:residual-value:${expected.type}`)
    }
  }
  const uniquePlaceholders = new Set(redaction.mappings.map((mapping) => mapping.placeholder))
  assert.equal(uniquePlaceholders.size, redaction.mappings.length, `${testCase.id}: placeholder collision`)
}

let safeCaseFalsePositiveCount = 0
for (const testCase of dataset.safeCases) {
  const nameCandidates = collectLocalPersonNameCandidates(testCase.text, await localNameDetection(testCase.text, testCase.id))
  const identifiers = detectDirectIdentifiers(testCase.text, nameCandidates)
  if (nameCandidates.length > 0 || identifiers.length > 0) {
    safeCaseFalsePositiveCount += 1
    failures.push(`${testCase.id}:safe-case-false-positive:${[...nameCandidates, ...identifiers].join(',')}`)
  }
}

for (const testCase of dataset.blockedCases) {
  const result = redactTextForCloud(testCase.text, {
    sourceVersion: `privacy-regression:${testCase.id}`,
    personNameReviewCompleted: testCase.reason === 'coverage:person_name_review_required' ? undefined : true,
    mediaRisks: testCase.mediaRisk ? [testCase.mediaRisk] : []
  })
  if (result.payload !== null || result.session.status !== 'uncertain' || !result.blockedReasons.includes(testCase.reason)) {
    failures.push(`${testCase.id}:failed-closed-contract-missed`)
  }
}

let appleNer = {
  required: process.platform === 'darwin',
  verified: false,
  engine: null as string | null,
  detectedNameCount: 0
}
if (process.platform === 'darwin') {
  const client = apple ?? new MacNaturalLanguageNerClient(resolve(root, 'build/native/macos/ses-vision-ocr'))
  const result = await client.detectNames('Tim Cook met Satya Nadella in Tokyo.')
  const detectedNames = result.entities.map((entity) => entity.text)
  if (!detectedNames.includes('Tim Cook') || !detectedNames.includes('Satya Nadella') || result.networkAccess !== false) {
    failures.push('macos-apple-ner:expected-names-missed')
  }
  appleNer = {
    required: true,
    verified: failures.every((failure) => !failure.startsWith('macos-apple-ner:')),
    engine: result.engine,
    detectedNameCount: detectedNames.length
  }
}

if (glinerFailure) failures.push(glinerFailure)
// Known names in Japanese, Chinese, katakana and English must survive the
// whole path: model entities, candidate cleanup and redaction.
const glinerSmokeCases = [
  { text: '先日ご紹介した佐々木健一は、来月から保守に参画可能です。', names: ['佐々木健一'] },
  { text: '候选人王小明，5年Java开发经验，目前在上海。', names: ['王小明'] },
  { text: 'エンジニアのマイケル・ジョンソンさんは英語と日本語が堪能です。', names: ['マイケル・ジョンソン'] },
  { text: '要員：グエン・ヴァン・ナム（ベトナム国籍）\n日本語：N2', names: ['グエン・ヴァン・ナム'] },
  { text: 'Candidate: Priya Raman / Role: Backend Engineer', names: ['Priya Raman'] }
]
let glinerNer = {
  required: glinerRequired,
  verified: false,
  engine: null as string | null,
  modelRevision: null as string | null,
  detectedNameCount: 0
}
if (gliner) {
  try {
    let detectedNameCount = 0
    for (const smoke of glinerSmokeCases) {
      const result = await gliner.detectNames(smoke.text)
      const candidates = collectLocalPersonNameCandidates(smoke.text, result)
      detectedNameCount += result.entities.length
      if (smoke.names.some((name) => !candidates.includes(name)) || result.networkAccess !== false) {
        failures.push('gliner-ner:expected-names-missed')
      }
      if (candidates.some((candidate) => /Engineer/u.test(candidate))) failures.push('gliner-ner:job-title-candidate')
    }
    glinerNer = {
      required: true,
      verified: failures.every((failure) => !failure.startsWith('gliner-ner:')),
      engine: gliner.engine,
      modelRevision: localNerModel.revision,
      detectedNameCount
    }
  } catch {
    failures.push('gliner-ner:unavailable')
  } finally {
    // Release the ONNX session before exiting; exiting with it alive aborts the process.
    await releaseGlinerRuntime()
  }
}

const identifierRecall = expectedIdentifiers === 0 ? 0 : detectedIdentifiers / expectedIdentifiers
const redactionPrecision = mappingCount === 0 ? 0 : expectedMappingCount / mappingCount
const releaseEligible =
  failures.length === 0 &&
  identifierRecall >= dataset.thresholds.identifierRecall &&
  redactionPrecision >= dataset.thresholds.redactionPrecision &&
  residualLeakCount <= dataset.thresholds.residualLeakCount &&
  safeCaseFalsePositiveCount <= dataset.thresholds.safeCaseFalsePositiveCount &&
  (!appleNer.required || appleNer.verified) &&
  (!glinerNer.required || glinerNer.verified)
const report = {
  version: 'ses-privacy-quality-report-v1',
  datasetVersion: dataset.version,
  datasetSha256: createHash('sha256').update(datasetBytes).digest('hex'),
  syntheticOnly: true,
  humanLabeledDataset: false,
  platform: process.platform,
  arch: process.arch,
  caseCount: dataset.cases.length,
  safeCaseCount: dataset.safeCases.length,
  blockedCaseCount: dataset.blockedCases.length,
  expectedIdentifiers,
  detectedIdentifiers,
  identifierRecall,
  redactionPrecision,
  residualLeakCount,
  safeCaseFalsePositiveCount,
  failedClosedCases: dataset.blockedCases.length,
  appleNer,
  glinerNer,
  cloudDirectIdentifiers: 0,
  networkAccess: false,
  releaseEligible,
  limitations: [
    'Synthetic fixtures do not replace a human-labeled Japanese SES privacy dataset.',
    'Unlabeled ambiguous person names remain behind mandatory human review.'
  ],
  failures
}

await mkdir(resolve(root, 'build/privacy-verification'), { recursive: true })
await writeFile(resolve(root, 'build/privacy-verification/privacy-quality-report.json'), `${JSON.stringify(report, null, 2)}\n`, {
  encoding: 'utf8',
  mode: 0o600
})
process.stdout.write(`${JSON.stringify(report)}\n`)
// exitCode, not exit(): exiting while ONNX Runtime threads are alive aborts the process.
if (!releaseEligible) process.exitCode = 1
