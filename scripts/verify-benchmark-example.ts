import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { detectDirectIdentifiers } from '@privacy'
import { sesCandidateBenchmarkSchema } from '@shared'

const path = resolve(import.meta.dirname, '..', 'examples', 'ses-candidate-benchmark-v1.example.json')
const benchmark = sesCandidateBenchmarkSchema.parse(JSON.parse(await readFile(path, 'utf8')))
const privacyText = [benchmark.name, ...benchmark.cases.map((testCase) => testCase.query)].join('\n')

assert.deepEqual(detectDirectIdentifiers(privacyText), [], 'benchmark example contains a direct identifier')
assert.equal(/<(?:PERSON_NAME|PHONE|EMAIL|ADDRESS|PRIVATE_EMAIL)_\d+>/iu.test(privacyText), false)
assert.equal(benchmark.privacy.directIdentifiersRemoved, true)
assert.equal(benchmark.privacy.rawResumeIncluded, false)
assert.equal(benchmark.privacy.rawMailIncluded, false)

process.stdout.write(`${JSON.stringify({
  version: benchmark.version,
  cases: benchmark.cases.length,
  minimumCases: benchmark.thresholds.minimumCases,
  directIdentifiers: 0,
  rawDocuments: false,
  expectedStatus: 'insufficient-cases-example-only'
})}\n`)
