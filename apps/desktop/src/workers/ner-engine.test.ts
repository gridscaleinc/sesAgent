// @vitest-environment node
import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { collectLocalPersonNameCandidates } from '@local-ai'
import { redactTextForCloud } from '@privacy'
import { InProcessGlinerNameDetector, releaseGlinerRuntime } from './ner-engine'

// Runs the real pinned model when `npm run fetch:ner-model` has been run;
// synthetic, fictitious fixtures only.
const root = resolve(import.meta.dirname, '../../../..')
const modelDirectory = resolve(root, 'models/knowledgator/gliner-x-small')
const modelPresent =
  existsSync(resolve(modelDirectory, 'onnx/model_quantized.onnx')) && existsSync(resolve(modelDirectory, 'model-manifest.json'))

interface SyntheticCase {
  id: string
  lang: string
  text: string
  names?: string[]
}

const synthetic = JSON.parse(readFileSync(resolve(root, 'tests/fixtures/ner-synthetic-v1.json'), 'utf8')) as {
  cases: SyntheticCase[]
  safeCases: SyntheticCase[]
}
const regression = JSON.parse(readFileSync(resolve(root, 'examples/ses-privacy-regression-v1.json'), 'utf8')) as {
  cases: Array<{ id: string; text: string; expected: Array<{ type: string; value: string }> }>
  safeCases: Array<{ id: string; text: string }>
}

function redact(text: string, names: string[]): string {
  return redactTextForCloud(text, {
    sourceVersion: 'gliner-synthetic-test',
    knownPersonNames: names,
    personNameReviewCompleted: true,
    now: new Date('2026-09-30T00:00:00.000Z')
  }).redactedContent
}

describe.skipIf(!modelPresent)('GLiNER x-small with the pinned local model', () => {
  const detector = new InProcessGlinerNameDetector(modelDirectory)

  afterAll(async () => {
    await releaseGlinerRuntime()
  })

  it('finds Japanese, Chinese, katakana and English names with exact offsets', async () => {
    const samples = [
      ['先日ご紹介した佐々木健一は、来月から保守に参画可能です。', '佐々木健一'],
      ['候选人王小明，5年Java开发经验，目前在上海。', '王小明'],
      ['エンジニアのマイケル・ジョンソンさんは英語と日本語が堪能です。', 'マイケル・ジョンソン'],
      ['Candidate: Priya Raman joined the call with David Chen.', 'Priya Raman']
    ] as const
    for (const [text, name] of samples) {
      const result = await detector.detectNames(text)
      expect(result).toMatchObject({ engine: 'gliner-x-small-onnx', networkAccess: false })
      for (const entity of result.entities) expect(text.slice(entity.startUtf16, entity.endUtf16)).toBe(entity.text)
      expect(collectLocalPersonNameCandidates(text, result)).toContain(name)
    }
  }, 60_000)

  it('keeps offsets exact across chunks of a long document', async () => {
    const text = Array.from({ length: 60 }, (_, index) => `${index + 1}. 要件定義と基本設計を担当。レビューは山田 太郎と実施。`).join('\n')
    const result = await detector.detectNames(text)
    expect(result.entities.length).toBeGreaterThan(10)
    for (const entity of result.entities) expect(text.slice(entity.startUtf16, entity.endUtf16)).toBe(entity.text)
  }, 60_000)

  it('removes synthetic names end to end and leaves the safe traps untouched', async () => {
    let expected = 0
    let removed = 0
    const leaked: string[] = []
    for (const testCase of synthetic.cases) {
      const names = [...new Set(testCase.names ?? [])]
      const candidates = collectLocalPersonNameCandidates(testCase.text, await detector.detectNames(testCase.text))
      const output = redact(testCase.text, candidates)
      expected += names.length
      for (const name of names) {
        if (output.includes(name)) leaked.push(`${testCase.id}:${name}`)
        else removed += 1
      }
    }
    // The evaluation measured 96.3% (52/54) before the katakana fixes; the
    // integrated detector must not fall below it.
    expect(removed / expected, `leaked: ${leaked.join(', ')}`).toBeGreaterThanOrEqual(0.963)

    const safeCandidates: string[] = []
    for (const testCase of [...synthetic.safeCases, ...regression.safeCases]) {
      const candidates = collectLocalPersonNameCandidates(testCase.text, await detector.detectNames(testCase.text))
      safeCandidates.push(...candidates.map((candidate) => `${testCase.id}:${candidate}`))
    }
    expect(safeCandidates).toEqual([])
  }, 180_000)

  it('keeps the regression cases exact: expected names only, nothing extra', async () => {
    for (const testCase of regression.cases) {
      const expectedNames = testCase.expected.filter((item) => item.type === 'person_name').map((item) => item.value)
      const candidates = collectLocalPersonNameCandidates(testCase.text, await detector.detectNames(testCase.text))
      const mapped = redactTextForCloud(testCase.text, {
        sourceVersion: `gliner-regression:${testCase.id}`,
        knownPersonNames: candidates,
        personNameReviewCompleted: true,
        now: new Date('2026-09-30T00:00:00.000Z')
      })
        .mappings.filter((mapping) => mapping.identifierType === 'person_name')
        .map((mapping) => mapping.originalValue)
      expect(new Set(mapped), testCase.id).toEqual(new Set(expectedNames))
    }
  }, 180_000)
})
