import { createHash } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { readFile, stat } from 'node:fs/promises'
import { cpus } from 'node:os'
import { join, relative, resolve } from 'node:path'
import { pipeline as streamPipeline } from 'node:stream/promises'
import { AutoTokenizer, env } from '@huggingface/transformers'
import { InferenceSession, Tensor } from 'onnxruntime-node'
import {
  buildGlinerInputs,
  chunkGlinerWords,
  decodeGlinerSpans,
  localNerModel,
  segmentTextForNer,
  splitGlinerWords,
  type GlinerWord,
  type GlinerNameDetectionResult,
  type LocalNerEntity
} from '@local-ai'
interface LocalTokenizer {
  encode(text: string, options: { add_special_tokens: false }): number[]
  cls_token_id?: number | null
  sep_token_id?: number | null
  eos_token_id?: number | null
}

interface GlinerConfig {
  ent_token: string
  sep_token: string
  max_width: number
  class_token_index: number
}

let loadedDirectory: string | null = null
let runtimePromise: Promise<{ tokenizer: LocalTokenizer; session: InferenceSession; config: GlinerConfig }> | null = null

async function sha256(path: string): Promise<string> {
  const hash = createHash('sha256')
  await streamPipeline(createReadStream(path), hash)
  return hash.digest('hex')
}

async function verifyModel(modelDirectory: string): Promise<GlinerConfig> {
  const directory = resolve(modelDirectory)
  if (loadedDirectory && loadedDirectory !== directory) throw new Error('MODEL_DIRECTORY_CHANGED')
  loadedDirectory = directory
  const manifest = JSON.parse(await readFile(join(directory, 'model-manifest.json'), 'utf8')) as Record<string, unknown>
  if (
    manifest.schemaVersion !== 'local-ner-model-v1' ||
    manifest.modelId !== localNerModel.id ||
    manifest.revision !== localNerModel.revision ||
    manifest.license !== 'Apache-2.0' ||
    manifest.threshold !== localNerModel.threshold ||
    manifest.maximumSpanWidth !== localNerModel.maximumSpanWidth ||
    JSON.stringify(manifest.labels) !== JSON.stringify(localNerModel.labels) ||
    JSON.stringify(manifest.files) !== JSON.stringify(localNerModel.files)
  )
    throw new Error('MODEL_MANIFEST_INVALID')
  for (const file of localNerModel.files) {
    const path = resolve(directory, file.path)
    if (relative(directory, path).startsWith('..')) throw new Error('MODEL_PATH_INVALID')
    const metadata = await stat(path)
    if (!metadata.isFile() || metadata.size !== file.bytes || (await sha256(path)) !== file.sha256) {
      throw new Error(`MODEL_INTEGRITY_FAILED:${file.path}`)
    }
  }
  const config = JSON.parse(await readFile(join(directory, 'gliner_config.json'), 'utf8')) as GlinerConfig
  if (config.max_width !== localNerModel.maximumSpanWidth || config.ent_token !== '<<ENT>>' || config.sep_token !== '<<SEP>>') {
    throw new Error('MODEL_CONFIG_INVALID')
  }
  return config
}

function runtime(modelDirectory: string): Promise<{ tokenizer: LocalTokenizer; session: InferenceSession; config: GlinerConfig }> {
  runtimePromise ??= (async () => {
    const config = await verifyModel(modelDirectory)
    env.allowLocalModels = true
    env.allowRemoteModels = false
    env.useBrowserCache = false
    env.useFSCache = false
    const tokenizer = (await AutoTokenizer.from_pretrained(resolve(modelDirectory), {
      local_files_only: true
    })) as unknown as LocalTokenizer
    const entityTokens = tokenizer.encode(config.ent_token, { add_special_tokens: false })
    if (entityTokens.length !== 1 || entityTokens[0] !== config.class_token_index) throw new Error('TOKENIZER_CONTRACT_INVALID')
    const session = await InferenceSession.create(resolve(modelDirectory, 'onnx/model_quantized.onnx'), {
      executionProviders: ['cpu'],
      graphOptimizationLevel: 'all',
      intraOpNumThreads: Math.max(1, Math.min(4, cpus().length - 1))
    })
    return { tokenizer, session, config }
  })()
  runtimePromise.catch(() => {
    runtimePromise = null
  })
  return runtimePromise
}

function int64(values: number[], dims: number[]): Tensor {
  return new Tensor(
    'int64',
    BigInt64Array.from(values, (value) => BigInt(value)),
    dims
  )
}

/**
 * Runs GLiNER over one segment of text (at most the worker segment length)
 * and returns person entities with UTF-16 offsets into `text`. Callers must
 * have installed the network deny guard; model files are hash-verified first.
 */
export async function detectGlinerPersonEntities(modelDirectory: string, text: string): Promise<LocalNerEntity[]> {
  if (text.length > localNerModel.maximumSegmentLength) throw new Error('INPUT_LENGTH_LIMIT')
  const { tokenizer, session, config } = await runtime(modelDirectory)
  const promptTokenIds: number[] = []
  for (const label of localNerModel.labels) {
    promptTokenIds.push(...tokenizer.encode(config.ent_token, { add_special_tokens: false }))
    promptTokenIds.push(...tokenizer.encode(label, { add_special_tokens: false }))
  }
  promptTokenIds.push(...tokenizer.encode(config.sep_token, { add_special_tokens: false }))
  const separatorTokenId = tokenizer.sep_token_id ?? tokenizer.eos_token_id
  if (typeof separatorTokenId !== 'number') throw new Error('TOKENIZER_CONTRACT_INVALID')
  const wordTokens = new Map<string, number[]>()
  const encodeWord = (word: string): number[] => {
    let tokens = wordTokens.get(word)
    if (!tokens) {
      tokens = tokenizer.encode(word, { add_special_tokens: false })
      wordTokens.set(word, tokens)
    }
    return tokens
  }

  const entities: LocalNerEntity[] = []
  const runChunk = async (words: GlinerWord[]): Promise<void> => {
    const usableWords = words.filter((word) => encodeWord(word.text).length > 0)
    if (usableWords.length === 0) return
    const inputs = buildGlinerInputs({
      promptTokenIds,
      wordTokenIds: usableWords.map((word) => encodeWord(word.text)),
      classTokenId: tokenizer.cls_token_id,
      separatorTokenId,
      maximumSpanWidth: localNerModel.maximumSpanWidth
    })
    if (inputs.inputIds.length > localNerModel.maximumSequenceLength) {
      if (usableWords.length === 1) throw new Error('INPUT_TOKEN_LIMIT')
      const middle = Math.ceil(usableWords.length / 2)
      await runChunk(usableWords.slice(0, middle))
      await runChunk(usableWords.slice(middle))
      return
    }
    const length = inputs.inputIds.length
    const spans = usableWords.length * localNerModel.maximumSpanWidth
    const output = await session.run({
      input_ids: int64(inputs.inputIds, [1, length]),
      attention_mask: int64(inputs.attentionMask, [1, length]),
      words_mask: int64(inputs.wordsMask, [1, length]),
      text_lengths: int64([inputs.textLength], [1, 1]),
      span_idx: int64(inputs.spanIndex, [1, spans, 2]),
      span_mask: new Tensor(
        'bool',
        Uint8Array.from(inputs.spanMask, (value) => (value ? 1 : 0)),
        [1, spans]
      )
    })
    const logits = output.logits
    if (
      !logits ||
      logits.type !== 'float32' ||
      logits.dims.length !== 4 ||
      logits.dims[0] !== 1 ||
      logits.dims[1] !== usableWords.length ||
      logits.dims[2] !== localNerModel.maximumSpanWidth ||
      logits.dims[3] !== localNerModel.labels.length
    )
      throw new Error('MODEL_OUTPUT_INVALID')
    for (const span of decodeGlinerSpans({
      text,
      words: usableWords,
      logits: logits.data as Float32Array,
      maximumSpanWidth: localNerModel.maximumSpanWidth,
      labels: localNerModel.labels,
      threshold: localNerModel.threshold
    })) {
      if (span.label !== localNerModel.personLabel) continue
      const value = span.text.trim()
      if (value.length < 2 || value.length > 120) continue
      const start = span.start + span.text.indexOf(value)
      entities.push({ text: value, startUtf16: start, endUtf16: start + value.length, score: Math.round(span.score * 10_000) / 10_000 })
    }
  }
  const words = splitGlinerWords(text)
  for (const chunk of chunkGlinerWords(text, words, localNerModel.maximumWordsPerChunk)) await runChunk(chunk)
  return entities
}

export async function releaseGlinerRuntime(): Promise<void> {
  const loaded = await (runtimePromise ?? Promise.resolve(null)).catch(() => null)
  runtimePromise = null
  await loaded?.session.release()
}

/**
 * The same GLiNER inference in the current process, for local verification
 * scripts that already run behind the network deny guard. The app always uses
 * the isolated worker.
 */
export class InProcessGlinerNameDetector {
  readonly engine = 'gliner-x-small-onnx' as const
  constructor(private readonly modelDirectory: string) {}

  async detectNames(text: string): Promise<GlinerNameDetectionResult> {
    if (text.length > localNerModel.maximumTextLength) throw new Error('The local NER input violates its length limit.')
    const entities: GlinerNameDetectionResult['entities'] = []
    for (const segment of segmentTextForNer(text, localNerModel.maximumSegmentLength)) {
      for (const entity of await detectGlinerPersonEntities(this.modelDirectory, segment.text)) {
        entities.push({
          text: entity.text,
          startUtf16: segment.offset + entity.startUtf16,
          endUtf16: segment.offset + entity.endUtf16,
          tag: 'personalName'
        })
      }
    }
    return {
      version: 'gliner-ner-v1',
      engine: 'gliner-x-small-onnx',
      modelRevision: localNerModel.revision,
      networkAccess: false,
      requiresHumanConfirmation: true,
      entities
    }
  }

  dispose(): void {
    void releaseGlinerRuntime()
  }
}
