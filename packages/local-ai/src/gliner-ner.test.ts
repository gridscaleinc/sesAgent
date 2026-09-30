// @vitest-environment node
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  buildGlinerInputs,
  chunkGlinerWords,
  decodeGlinerSpans,
  isLocalNerWorkerRequest,
  isLocalNerWorkerResponse,
  LocalNerWorkerClient,
  LocalUnionPersonNameDetector,
  localNerModel,
  segmentTextForNer,
  splitGlinerWords
} from './gliner-ner'
import type { AppleNameDetectionResult, GlinerNameDetectionResult } from './vision-ocr'

function entity(text: string, source: string, from = 0) {
  const startUtf16 = source.indexOf(text, from)
  return { text, startUtf16, endUtf16: startUtf16 + text.length, tag: 'personalName' as const }
}

describe('splitGlinerWords', () => {
  it.each([
    ['Japanese', '先日ご紹介した佐々木健一は参画可能です。'],
    ['Chinese', '候选人王小明，5年Java开发经验。'],
    ['English', 'Candidate: Priya Raman joined.'],
    ['katakana', '要員：グエン・ヴァン・ナム（ベトナム国籍）']
  ])('keeps UTF-16 offsets for %s text and drops whitespace', (_label, text) => {
    const words = splitGlinerWords(text)
    expect(words.length).toBeGreaterThan(2)
    for (const word of words) {
      expect(text.slice(word.start, word.end)).toBe(word.text)
      expect(word.text.trim()).toBe(word.text)
    }
  })

  it('keeps Latin words whole and indexes past surrogate pairs', () => {
    const text = '𠮷野 Priya Raman'
    const words = splitGlinerWords(text)
    expect(words.map((word) => word.text)).toEqual(expect.arrayContaining(['Priya', 'Raman']))
    const priya = words.find((word) => word.text === 'Priya')!
    expect(text.slice(priya.start, priya.end)).toBe('Priya')
  })
})

describe('chunkGlinerWords', () => {
  it('cuts at a line break in the second half of a full chunk', () => {
    const text = 'a b c d e f\ng h i j'
    const words = splitGlinerWords(text)
    const chunks = chunkGlinerWords(text, words, 8)
    expect(chunks.map((chunk) => chunk.map((word) => word.text).join(''))).toEqual(['abcdef', 'ghij'])
  })

  it('falls back to a hard cut and never exceeds the limit or drops words', () => {
    const text = Array.from({ length: 25 }, (_, index) => `w${index}`).join(' ')
    const words = splitGlinerWords(text)
    const chunks = chunkGlinerWords(text, words, 10)
    expect(chunks.every((chunk) => chunk.length <= 10)).toBe(true)
    expect(chunks.flat()).toEqual(words)
    expect(() => chunkGlinerWords(text, words, 0)).toThrow()
  })
})

describe('buildGlinerInputs', () => {
  it('numbers the first sub-token of each word and masks spans past the text end', () => {
    const inputs = buildGlinerInputs({
      promptTokenIds: [100, 5, 101],
      wordTokenIds: [[7, 8], [9], [10]],
      separatorTokenId: 1,
      maximumSpanWidth: 2
    })
    expect(inputs.inputIds).toEqual([100, 5, 101, 7, 8, 9, 10, 1])
    expect(inputs.wordsMask).toEqual([0, 0, 0, 1, 0, 2, 3, 0])
    expect(inputs.attentionMask).toEqual([1, 1, 1, 1, 1, 1, 1, 1])
    expect(inputs.textLength).toBe(3)
    expect(inputs.spanIndex).toEqual([0, 0, 0, 1, 1, 1, 1, 2, 2, 2, 2, 2])
    expect(inputs.spanMask).toEqual([true, true, true, true, true, false])
  })

  it('prefixes a class token when the tokenizer has one and rejects empty words', () => {
    const inputs = buildGlinerInputs({
      promptTokenIds: [3],
      wordTokenIds: [[4]],
      classTokenId: 0,
      separatorTokenId: 2,
      maximumSpanWidth: 1
    })
    expect(inputs.inputIds).toEqual([0, 3, 4, 2])
    expect(inputs.wordsMask).toEqual([0, 0, 1, 0])
    expect(() => buildGlinerInputs({ promptTokenIds: [], wordTokenIds: [[]], separatorTokenId: 2, maximumSpanWidth: 1 })).toThrow(
      'GLINER_EMPTY_WORD_TOKENS'
    )
  })
})

describe('decodeGlinerSpans', () => {
  const labels = ['person', 'organization']
  const logit = (probability: number) => Math.log(probability / (1 - probability))

  it('keeps spans at or above the threshold and resolves overlaps greedily by score', () => {
    const text = '担当 佐藤 花子 株式会社'
    const words = splitGlinerWords(text)
    expect(words.map((word) => word.text)).toEqual(['担当', '佐藤', '花子', '株式会社'])
    const width = 3
    const logits = new Array(words.length * width * labels.length).fill(-10)
    const set = (word: number, offset: number, label: number, probability: number) => {
      logits[(word * width + offset) * labels.length + label] = logit(probability)
    }
    set(1, 1, 0, 0.9) // 佐藤 花子 person
    set(1, 0, 0, 0.6) // 佐藤 alone overlaps and loses
    set(3, 0, 1, 0.8) // 株式会社 organization
    set(0, 0, 0, 0.49) // below threshold
    const spans = decodeGlinerSpans({ text, words, logits, maximumSpanWidth: width, labels, threshold: 0.5 })
    expect(spans.map((span) => [span.text, span.label])).toEqual([
      ['佐藤 花子', 'person'],
      ['株式会社', 'organization']
    ])
    expect(text.slice(spans[0]!.start, spans[0]!.end)).toBe('佐藤 花子')
    expect(spans[0]!.score).toBeCloseTo(0.9, 5)
  })

  it('fails closed on a logits shape or value it did not expect', () => {
    const text = '王小明'
    const words = splitGlinerWords(text)
    expect(() => decodeGlinerSpans({ text, words, logits: [0], maximumSpanWidth: 2, labels, threshold: 0.5 })).toThrow(
      'GLINER_LOGITS_SHAPE_INVALID'
    )
    const nan = new Array(words.length * 2 * labels.length).fill(Number.NaN)
    expect(() => decodeGlinerSpans({ text, words, logits: nan, maximumSpanWidth: 2, labels, threshold: 0.5 })).toThrow(
      'GLINER_LOGITS_INVALID'
    )
  })
})

describe('segmentTextForNer', () => {
  it('splits long text at line breaks and keeps offsets exact', () => {
    const line = `${'あ'.repeat(30)}\n`
    const text = line.repeat(10)
    const segments = segmentTextForNer(text, 100)
    expect(segments.every((segment) => segment.text.length <= 100)).toBe(true)
    expect(segments.every((segment) => segment.text.endsWith('\n'))).toBe(true)
    expect(segments.map((segment) => segment.text).join('')).toBe(text)
    for (const segment of segments) expect(text.slice(segment.offset, segment.offset + segment.text.length)).toBe(segment.text)
  })

  it('cuts one very long line at a word boundary', () => {
    const text = `${'word '.repeat(40)}end`
    const segments = segmentTextForNer(text, 50)
    expect(segments.every((segment) => segment.text.length <= 50)).toBe(true)
    expect(segments.slice(0, -1).every((segment) => segment.text.endsWith(' '))).toBe(true)
    expect(segments.map((segment) => segment.text).join('')).toBe(text)
  })
})

describe('NER worker contract', () => {
  const modelDirectory = join(tmpdir(), 'ner-model')

  it('accepts only bounded requests with an absolute model directory', () => {
    expect(isLocalNerWorkerRequest({ id: 'a', kind: 'detect-names', text: '王小明', modelDirectory })).toBe(true)
    expect(isLocalNerWorkerRequest({ id: 'a', kind: 'detect-names', text: '王小明', modelDirectory: 'relative' })).toBe(false)
    expect(isLocalNerWorkerRequest({ id: 'a', kind: 'detect-names', text: '  ', modelDirectory })).toBe(false)
    expect(
      isLocalNerWorkerRequest({ id: 'a', kind: 'detect-names', text: 'x'.repeat(localNerModel.maximumSegmentLength + 1), modelDirectory })
    ).toBe(false)
  })

  it('accepts only responses bound to the pinned model with networkAccess=false', () => {
    const ok = {
      id: 'a',
      kind: 'detect-names',
      ok: true,
      modelId: localNerModel.id,
      modelRevision: localNerModel.revision,
      networkAccess: false,
      entities: [{ text: '王小明', startUtf16: 0, endUtf16: 3, score: 0.9 }]
    }
    expect(isLocalNerWorkerResponse(ok)).toBe(true)
    expect(isLocalNerWorkerResponse({ ...ok, networkAccess: true })).toBe(false)
    expect(isLocalNerWorkerResponse({ ...ok, modelRevision: 'main' })).toBe(false)
    expect(isLocalNerWorkerResponse({ ...ok, entities: [{ text: '王', startUtf16: 0, endUtf16: 1, score: 0.9 }] })).toBe(false)
    expect(isLocalNerWorkerResponse({ ...ok, entities: [{ text: '王小明', startUtf16: 3, endUtf16: 3, score: 0.9 }] })).toBe(false)
    expect(isLocalNerWorkerResponse({ id: 'a', kind: 'detect-names', ok: false, errorCode: 'MODEL_INTEGRITY_FAILED', message: 'x' })).toBe(
      true
    )
  })
})

describe('LocalUnionPersonNameDetector', () => {
  const text = 'Tim Cook と王小明が参加'
  const apple = (entities: AppleNameDetectionResult['entities']) => ({
    engine: 'apple-natural-language' as const,
    detectNames: vi.fn(async (): Promise<AppleNameDetectionResult> => ({
      version: 'apple-nl-ner-v1',
      engine: 'apple-natural-language',
      networkAccess: false,
      requiresHumanConfirmation: true,
      entities
    }))
  })
  const gliner = (entities: GlinerNameDetectionResult['entities'] | Error) => ({
    engine: 'gliner-x-small-onnx' as const,
    detectNames: vi.fn(async (): Promise<GlinerNameDetectionResult> => {
      if (entities instanceof Error) throw entities
      return {
        version: 'gliner-ner-v1',
        engine: 'gliner-x-small-onnx',
        modelRevision: localNerModel.revision,
        networkAccess: false,
        requiresHumanConfirmation: true,
        entities
      }
    })
  })

  it('merges both entity lists before candidate collection and removes duplicates', async () => {
    const detector = new LocalUnionPersonNameDetector(
      apple([entity('Tim Cook', text)]),
      gliner([entity('Tim Cook', text), entity('王小明', text)])
    )
    const result = await detector.detectNames(text)
    expect(result.engines).toEqual(['apple-natural-language', 'gliner-x-small-onnx'])
    expect(result.entities.map((item) => item.text)).toEqual(['Tim Cook', '王小明'])
    expect(result.networkAccess).toBe(false)
  })

  it('keeps Apple NL alone when GLiNER fails, so macOS never falls below its baseline', async () => {
    const onUnavailable = vi.fn()
    const detector = new LocalUnionPersonNameDetector(
      apple([entity('Tim Cook', text)]),
      gliner(new Error('MODEL_INTEGRITY_FAILED')),
      onUnavailable
    )
    const result = await detector.detectNames(text)
    expect(result.engines).toEqual(['apple-natural-language'])
    expect(result.entities.map((item) => item.text)).toEqual(['Tim Cook'])
    expect(onUnavailable).toHaveBeenCalledTimes(1)
  })

  it('fails closed when Apple NL fails', async () => {
    const failingApple = { engine: 'apple-natural-language' as const, detectNames: vi.fn().mockRejectedValue(new Error('helper missing')) }
    const detector = new LocalUnionPersonNameDetector(failingApple, gliner([entity('王小明', text)]))
    await expect(detector.detectNames(text)).rejects.toThrow('helper missing')
  })
})

describe('LocalNerWorkerClient', () => {
  let directory: string

  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), 'ses-ner-client-'))
  })

  afterEach(async () => {
    await rm(directory, { recursive: true, force: true })
  })

  async function fakeWorker(body: string): Promise<string> {
    const path = join(directory, 'fake-ner-worker.cjs')
    await writeFile(path, `process.on('message', (request) => { ${body} });\nprocess.once('disconnect', () => process.exit(0));\n`, 'utf8')
    return path
  }

  it('rejects relative worker or model paths', () => {
    expect(() => new LocalNerWorkerClient({ workerPath: 'worker.js', modelDirectory: directory })).toThrow('must be absolute')
  })

  it('maps entities from each segment back to offsets in the whole text and unloads when idle', async () => {
    const workerPath = await fakeWorker(`
      const index = request.text.indexOf('山田太郎');
      process.send({ id: request.id, kind: 'detect-names', ok: true, modelId: ${JSON.stringify(localNerModel.id)},
        modelRevision: ${JSON.stringify(localNerModel.revision)}, networkAccess: false,
        entities: index < 0 ? [] : [{ text: '山田太郎', startUtf16: index, endUtf16: index + 4, score: 0.9 }] });`)
    const client = new LocalNerWorkerClient({ workerPath, modelDirectory: directory, idleUnloadMs: 50 })
    try {
      const line = `${'案件の概要と要件を確認。'.repeat(20)}\n`
      const text = `${line.repeat(20)}担当は山田太郎です。\n${line.repeat(20)}`
      expect(text.length).toBeGreaterThan(localNerModel.maximumSegmentLength)
      const result = await client.detectNames(text)
      expect(result).toMatchObject({ engine: 'gliner-x-small-onnx', version: 'gliner-ner-v1', networkAccess: false })
      expect(result.entities).toHaveLength(1)
      const found = result.entities[0]!
      expect(text.slice(found.startUtf16, found.endUtf16)).toBe('山田太郎')
      expect(client.loaded).toBe(true)
      await vi.waitFor(() => expect(client.loaded).toBe(false), { timeout: 2_000 })
    } finally {
      client.dispose()
    }
  })

  it('fails closed on a worker failure, an invalid response, or an over-long input', async () => {
    const failing = new LocalNerWorkerClient({
      workerPath: await fakeWorker(
        `process.send({ id: request.id, kind: 'detect-names', ok: false, errorCode: 'MODEL_INTEGRITY_FAILED', message: 'Local name detection failed closed.' });`
      ),
      modelDirectory: directory
    })
    try {
      await expect(failing.detectNames('王小明が参加')).rejects.toThrow('MODEL_INTEGRITY_FAILED')
    } finally {
      failing.dispose()
    }
    const invalid = new LocalNerWorkerClient({
      workerPath: await fakeWorker(
        `process.send({ id: request.id, kind: 'detect-names', ok: true, modelId: 'other/model', modelRevision: 'main', networkAccess: false, entities: [] });`
      ),
      modelDirectory: directory
    })
    try {
      await expect(invalid.detectNames('王小明が参加')).rejects.toThrow('invalid response')
    } finally {
      invalid.dispose()
    }
    await expect(invalid.detectNames('x'.repeat(localNerModel.maximumTextLength + 1))).rejects.toThrow('length limit')
  })

  it('rejects an entity that does not match the text it claims to come from', async () => {
    const client = new LocalNerWorkerClient({
      workerPath: await fakeWorker(`
        process.send({ id: request.id, kind: 'detect-names', ok: true, modelId: ${JSON.stringify(localNerModel.id)},
          modelRevision: ${JSON.stringify(localNerModel.revision)}, networkAccess: false,
          entities: [{ text: '鈴木一郎', startUtf16: 0, endUtf16: 4, score: 0.9 }] });`),
      modelDirectory: directory
    })
    try {
      await expect(client.detectNames('王小明が参加します')).rejects.toThrow('outside its input')
    } finally {
      client.dispose()
    }
  })
})
