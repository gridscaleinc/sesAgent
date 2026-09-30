import { spawn, type ChildProcess } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { isAbsolute, win32 } from 'node:path'
import type {
  AppleNameDetectionResult,
  GlinerNameDetectionResult,
  LocalPersonNameDetectorPort,
  UnionNameDetectionResult
} from './vision-ocr'

/**
 * knowledgator/gliner-x-small (Apache-2.0) as a local, cross-platform person
 * name detector. The labels, threshold, word splitter and chunk size are the
 * ones measured in the local evaluation; changing any of them changes recall.
 */
export const localNerModel = Object.freeze({
  id: 'knowledgator/gliner-x-small',
  revision: 'd51a0984d11084a55f9df3899d9dbf7704f580f5',
  engine: 'gliner-x-small-onnx',
  labels: Object.freeze(['person', 'organization', 'location']),
  personLabel: 'person',
  threshold: 0.5,
  maximumSpanWidth: 12,
  maximumSequenceLength: 1024,
  maximumWordsPerChunk: 120,
  /** Characters per worker request. */
  maximumSegmentLength: 4_000,
  /** Characters per detectNames call; longer text fails closed. */
  maximumTextLength: 200_000,
  files: Object.freeze([
    Object.freeze({
      path: 'gliner_config.json',
      platform: 'all',
      bytes: 3_541,
      sha256: 'f8e7758e503d37be53b70910c7d3cebf327fe7f23c8f65f355c9941878940206'
    }),
    Object.freeze({
      path: 'special_tokens_map.json',
      platform: 'all',
      bytes: 416,
      sha256: '80f4c6c5cf3867d7669ff8aa8f6aebb8a7499322e62d7faae06262d6014edd61'
    }),
    Object.freeze({
      path: 'tokenizer_config.json',
      platform: 'all',
      bytes: 19_602,
      sha256: '08540ea44a5b8bf6a155e89902698c642d623657996c6e4d898236b159589404'
    }),
    Object.freeze({
      path: 'tokenizer.json',
      platform: 'all',
      bytes: 16_335_050,
      sha256: '619d3790cf59a0e50afdf04239db19093568fbd8d806963e35d54a8fb71d099c'
    }),
    Object.freeze({
      path: 'onnx/model_quantized.onnx',
      platform: 'all',
      bytes: 172_716_978,
      sha256: 'd76b3349fd4bfe44573221c0912ed459f432d14317552fdc65935dabcb833c4a'
    })
  ])
})

export interface GlinerWord {
  text: string
  start: number
  end: number
}

export interface GlinerSpan {
  text: string
  start: number
  end: number
  score: number
  label: string
}

/**
 * Word units for GLiNER. Intl.Segmenter('ja') splits Japanese and Chinese
 * into dictionary words and keeps Latin words whole; whitespace is dropped.
 * Offsets are UTF-16 indexes into `text`.
 */
export function splitGlinerWords(text: string): GlinerWord[] {
  const segmenter = new Intl.Segmenter('ja', { granularity: 'word' })
  const words: GlinerWord[] = []
  for (const segment of segmenter.segment(text)) {
    if (!segment.segment.trim()) continue
    words.push({ text: segment.segment, start: segment.index, end: segment.index + segment.segment.length })
  }
  return words
}

/**
 * Groups words into chunks of at most `maximumWords`, cutting after a line
 * break when one falls in the second half of the chunk so names in a table
 * row or signature stay together.
 */
export function chunkGlinerWords(text: string, words: GlinerWord[], maximumWords: number): GlinerWord[][] {
  if (!Number.isInteger(maximumWords) || maximumWords < 1) throw new Error('GLiNER chunk size must be a positive integer.')
  const chunks: GlinerWord[][] = []
  let start = 0
  while (start < words.length) {
    let end = Math.min(start + maximumWords, words.length)
    if (end < words.length) {
      for (let cut = end; cut > start + Math.floor(maximumWords / 2); cut -= 1) {
        const previous = words[cut - 1]!
        const next = words[cut]!
        if (text.slice(previous.end, next.start).includes('\n')) {
          end = cut
          break
        }
      }
    }
    chunks.push(words.slice(start, end))
    start = end
  }
  return chunks
}

export interface GlinerModelInputs {
  inputIds: number[]
  attentionMask: number[]
  wordsMask: number[]
  textLength: number
  /** Flattened [numberOfWords * maximumSpanWidth, 2]. */
  spanIndex: number[]
  /** Flattened [numberOfWords * maximumSpanWidth]. */
  spanMask: boolean[]
}

/**
 * The GLiNER span-model inputs: `<<ENT>> label ... <<SEP>>` followed by the
 * words, where words_mask numbers the first sub-token of each word from 1.
 */
export function buildGlinerInputs(options: {
  promptTokenIds: number[]
  wordTokenIds: number[][]
  classTokenId?: number | null
  separatorTokenId: number
  maximumSpanWidth: number
}): GlinerModelInputs {
  const inputIds: number[] = []
  const wordsMask: number[] = []
  if (options.classTokenId !== undefined && options.classTokenId !== null) {
    inputIds.push(options.classTokenId)
    wordsMask.push(0)
  }
  for (const id of options.promptTokenIds) {
    inputIds.push(id)
    wordsMask.push(0)
  }
  let wordNumber = 1
  for (const tokens of options.wordTokenIds) {
    if (tokens.length === 0) throw new Error('GLINER_EMPTY_WORD_TOKENS')
    tokens.forEach((id, index) => {
      inputIds.push(id)
      wordsMask.push(index === 0 ? wordNumber : 0)
    })
    wordNumber += 1
  }
  inputIds.push(options.separatorTokenId)
  wordsMask.push(0)
  const numberOfWords = options.wordTokenIds.length
  const width = options.maximumSpanWidth
  const spanIndex: number[] = new Array(numberOfWords * width * 2)
  const spanMask: boolean[] = new Array(numberOfWords * width)
  for (let wordIndex = 0; wordIndex < numberOfWords; wordIndex += 1) {
    for (let offset = 0; offset < width; offset += 1) {
      const span = wordIndex * width + offset
      const end = wordIndex + offset
      spanIndex[2 * span] = wordIndex
      spanIndex[2 * span + 1] = Math.min(end, numberOfWords - 1)
      spanMask[span] = end < numberOfWords
    }
  }
  return {
    inputIds,
    attentionMask: inputIds.map(() => 1),
    wordsMask,
    textLength: numberOfWords,
    spanIndex,
    spanMask
  }
}

/**
 * Decodes GLiNER span logits ([words, maximumSpanWidth, labels]) into flat
 * entities: every span whose sigmoid score reaches `threshold`, then a
 * greedy non-overlapping selection by score.
 */
export function decodeGlinerSpans(options: {
  text: string
  words: GlinerWord[]
  logits: ArrayLike<number>
  maximumSpanWidth: number
  labels: readonly string[]
  threshold: number
}): GlinerSpan[] {
  const { words, logits, maximumSpanWidth, labels, threshold, text } = options
  if (logits.length !== words.length * maximumSpanWidth * labels.length) throw new Error('GLINER_LOGITS_SHAPE_INVALID')
  const spans: GlinerSpan[] = []
  for (let wordIndex = 0; wordIndex < words.length; wordIndex += 1) {
    for (let offset = 0; offset < maximumSpanWidth; offset += 1) {
      if (wordIndex + offset >= words.length) continue
      for (let label = 0; label < labels.length; label += 1) {
        const value = logits[(wordIndex * maximumSpanWidth + offset) * labels.length + label]!
        if (!Number.isFinite(value)) throw new Error('GLINER_LOGITS_INVALID')
        const score = 1 / (1 + Math.exp(-value))
        if (score < threshold) continue
        const start = words[wordIndex]!.start
        const end = words[wordIndex + offset]!.end
        spans.push({ text: text.slice(start, end), start, end, score, label: labels[label]! })
      }
    }
  }
  spans.sort((left, right) => right.score - left.score || left.start - right.start)
  const kept: GlinerSpan[] = []
  for (const span of spans) {
    if (kept.some((other) => span.start < other.end && span.end > other.start)) continue
    kept.push(span)
  }
  return kept.toSorted((left, right) => left.start - right.start)
}

/**
 * Splits text into worker segments of at most `maximumLength` characters at
 * line breaks; a single longer line is cut at the last whitespace or
 * punctuation before the limit.
 */
export function segmentTextForNer(text: string, maximumLength: number): Array<{ offset: number; text: string }> {
  const segments: Array<{ offset: number; text: string }> = []
  let offset = 0
  while (offset < text.length) {
    let end = Math.min(offset + maximumLength, text.length)
    if (end < text.length) {
      const window = text.slice(offset, end)
      const newline = window.lastIndexOf('\n')
      if (newline > 0) {
        end = offset + newline + 1
      } else {
        const boundary = Math.max(...[' ', '　', '。', '、', '.', ',', '，', '\t'].map((mark) => window.lastIndexOf(mark)))
        if (boundary > maximumLength / 2) end = offset + boundary + 1
      }
    }
    const segment = text.slice(offset, end)
    if (segment.trim()) segments.push({ offset, text: segment })
    offset = end
  }
  return segments
}

export interface LocalNerWorkerRequest {
  id: string
  kind: 'detect-names'
  text: string
  modelDirectory: string
}

export interface LocalNerEntity {
  text: string
  startUtf16: number
  endUtf16: number
  score: number
}

export type LocalNerWorkerResponse =
  | {
      id: string
      kind: 'detect-names'
      ok: true
      modelId: typeof localNerModel.id
      modelRevision: typeof localNerModel.revision
      networkAccess: false
      entities: LocalNerEntity[]
    }
  | { id: string; kind: 'detect-names' | 'invalid'; ok: false; errorCode: string; message: string }

function isAbsoluteWorkerPath(path: string): boolean {
  return isAbsolute(path) || win32.isAbsolute(path)
}

export function isLocalNerWorkerRequest(value: unknown): value is LocalNerWorkerRequest {
  if (!value || typeof value !== 'object') return false
  const candidate = value as Record<string, unknown>
  return (
    typeof candidate.id === 'string' &&
    candidate.id.length > 0 &&
    candidate.kind === 'detect-names' &&
    typeof candidate.text === 'string' &&
    candidate.text.trim().length > 0 &&
    candidate.text.length <= localNerModel.maximumSegmentLength &&
    typeof candidate.modelDirectory === 'string' &&
    isAbsoluteWorkerPath(candidate.modelDirectory)
  )
}

function isLocalNerEntity(value: unknown): value is LocalNerEntity {
  if (!value || typeof value !== 'object') return false
  const entity = value as Record<string, unknown>
  return (
    typeof entity.text === 'string' &&
    entity.text.length >= 2 &&
    entity.text.length <= 120 &&
    Number.isInteger(entity.startUtf16) &&
    Number.isInteger(entity.endUtf16) &&
    (entity.startUtf16 as number) >= 0 &&
    (entity.endUtf16 as number) > (entity.startUtf16 as number) &&
    typeof entity.score === 'number' &&
    Number.isFinite(entity.score) &&
    entity.score >= 0 &&
    entity.score <= 1
  )
}

export function isLocalNerWorkerResponse(value: unknown): value is LocalNerWorkerResponse {
  if (!value || typeof value !== 'object') return false
  const candidate = value as Record<string, unknown>
  if (typeof candidate.id !== 'string' || typeof candidate.ok !== 'boolean') return false
  if (!candidate.ok) {
    return (
      (candidate.kind === 'detect-names' || candidate.kind === 'invalid') &&
      typeof candidate.errorCode === 'string' &&
      typeof candidate.message === 'string'
    )
  }
  return (
    candidate.kind === 'detect-names' &&
    candidate.modelId === localNerModel.id &&
    candidate.modelRevision === localNerModel.revision &&
    candidate.networkAccess === false &&
    Array.isArray(candidate.entities) &&
    candidate.entities.length <= 2_000 &&
    candidate.entities.every(isLocalNerEntity)
  )
}

export interface LocalNerWorkerClientOptions {
  workerPath: string
  modelDirectory: string
  windowsSandbox?: { launcherPath: string; grantReadRoots: string[] }
  /** Per worker request. The first request also loads the model. */
  timeoutMs?: number
  /** The worker holds ~0.9 GB once loaded; it is stopped after this idle time. */
  idleUnloadMs?: number
}

interface PendingNerRequest {
  text: string
  resolve: (entities: LocalNerEntity[]) => void
  reject: (error: Error) => void
  timeout: NodeJS.Timeout
}

function sanitizedWorkerEnvironment(): NodeJS.ProcessEnv {
  return {
    ELECTRON_RUN_AS_NODE: '1',
    NODE_ENV: 'production',
    SystemRoot: process.env.SystemRoot,
    WINDIR: process.env.WINDIR,
    ComSpec: process.env.ComSpec,
    PATHEXT: process.env.PATHEXT,
    PROCESSOR_ARCHITECTURE: process.env.PROCESSOR_ARCHITECTURE,
    LANG: process.env.LANG ?? 'ja_JP.UTF-8',
    TZ: process.env.TZ ?? 'Asia/Tokyo'
  }
}

/**
 * Person-name detection in an isolated, network-denied worker process
 * (sandbox-exec on macOS, the AppContainer launcher on Windows). The model is
 * loaded on first use and the process is stopped after an idle period.
 */
export class LocalNerWorkerClient implements LocalPersonNameDetectorPort {
  readonly engine = 'gliner-x-small-onnx' as const
  private readonly timeoutMs: number
  private readonly idleUnloadMs: number
  private child: ChildProcess | null = null
  private readonly pending = new Map<string, PendingNerRequest>()
  private responseBuffer = Buffer.alloc(0)
  private operationQueue: Promise<void> = Promise.resolve()
  private idleTimer: NodeJS.Timeout | null = null

  constructor(private readonly options: LocalNerWorkerClientOptions) {
    if (
      !isAbsoluteWorkerPath(options.workerPath) ||
      !isAbsoluteWorkerPath(options.modelDirectory) ||
      (options.windowsSandbox &&
        (!isAbsoluteWorkerPath(options.windowsSandbox.launcherPath) ||
          options.windowsSandbox.grantReadRoots.length === 0 ||
          options.windowsSandbox.grantReadRoots.some((root) => !isAbsoluteWorkerPath(root))))
    )
      throw new Error('NER worker, model, and sandbox paths must be absolute.')
    this.timeoutMs = options.timeoutMs ?? 90_000
    this.idleUnloadMs = options.idleUnloadMs ?? 5 * 60_000
  }

  get loaded(): boolean {
    return this.child !== null
  }

  detectNames(text: string): Promise<GlinerNameDetectionResult> {
    if (text.length > localNerModel.maximumTextLength) {
      return Promise.reject(new Error('The local NER input violates its length limit.'))
    }
    const result = this.operationQueue.then(
      () => this.detect(text),
      () => this.detect(text)
    )
    this.operationQueue = result.then(
      () => undefined,
      () => undefined
    )
    return result
  }

  dispose(): void {
    this.clearIdleTimer()
    const error = new Error('The local NER worker was stopped.')
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timeout)
      pending.reject(error)
    }
    this.pending.clear()
    this.responseBuffer = Buffer.alloc(0)
    const child = this.child
    this.child = null
    if (child?.connected) child.disconnect()
    if (child && !child.killed) child.kill('SIGTERM')
  }

  private async detect(text: string): Promise<GlinerNameDetectionResult> {
    this.clearIdleTimer()
    try {
      const entities: GlinerNameDetectionResult['entities'] = []
      for (const segment of segmentTextForNer(text, localNerModel.maximumSegmentLength)) {
        for (const entity of await this.send(segment.text)) {
          const startUtf16 = segment.offset + entity.startUtf16
          const endUtf16 = segment.offset + entity.endUtf16
          if (text.slice(startUtf16, endUtf16) !== entity.text) {
            throw new Error('The isolated NER worker returned an entity outside its input.')
          }
          entities.push({ text: entity.text, startUtf16, endUtf16, tag: 'personalName' })
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
    } finally {
      this.scheduleIdleUnload()
    }
  }

  private scheduleIdleUnload(): void {
    this.clearIdleTimer()
    if (!this.child || this.idleUnloadMs <= 0) return
    this.idleTimer = setTimeout(() => {
      this.idleTimer = null
      if (this.pending.size === 0) this.dispose()
    }, this.idleUnloadMs)
    this.idleTimer.unref?.()
  }

  private clearIdleTimer(): void {
    if (this.idleTimer) clearTimeout(this.idleTimer)
    this.idleTimer = null
  }

  private send(text: string): Promise<LocalNerEntity[]> {
    const request: LocalNerWorkerRequest = {
      id: randomUUID(),
      kind: 'detect-names',
      text,
      modelDirectory: this.options.modelDirectory
    }
    if (!isLocalNerWorkerRequest(request)) return Promise.reject(new Error('NER input violates the local contract.'))
    const child = this.ensureChild()
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pending.delete(request.id)
        reject(new Error('Local NER exceeded its execution time limit.'))
        // A timed-out worker may still be busy; restart it on the next call.
        this.dispose()
      }, this.timeoutMs)
      this.pending.set(request.id, { text, resolve, reject, timeout })
      if (process.platform === 'win32' && this.options.windowsSandbox) {
        child.stdin?.write(`${JSON.stringify(request)}\n`, (error) => {
          if (error) this.rejectRequest(request.id, new Error('NER input could not be sent to AppContainer.', { cause: error }))
        })
      } else {
        child.send(request, (error) => {
          if (error) this.rejectRequest(request.id, new Error('NER input could not be sent to the isolated worker.', { cause: error }))
        })
      }
    })
  }

  private ensureChild(): ChildProcess {
    if (this.child && !this.child.killed && this.child.exitCode === null) return this.child
    const windowsSandbox = process.platform === 'win32' ? this.options.windowsSandbox : undefined
    if (process.platform === 'win32' && !windowsSandbox) {
      throw new Error('Windows local NER requires the AppContainer sandbox launcher.')
    }
    const command = process.platform === 'darwin' ? '/usr/bin/sandbox-exec' : (windowsSandbox?.launcherPath ?? process.execPath)
    const args =
      process.platform === 'darwin'
        ? ['-p', '(version 1) (allow default) (deny network*)', process.execPath, this.options.workerPath]
        : windowsSandbox
          ? [
              '--profile',
              'jp.sesai.agentdesktop.localworkers',
              ...windowsSandbox.grantReadRoots.flatMap((root) => ['--grant-read', root]),
              '--',
              process.execPath,
              this.options.workerPath,
              '--stdio'
            ]
          : [this.options.workerPath]
    const child = spawn(command, args, {
      cwd: windowsSandbox?.grantReadRoots[0] ?? process.cwd(),
      env: sanitizedWorkerEnvironment(),
      stdio: windowsSandbox ? ['pipe', 'pipe', 'pipe'] : ['ignore', 'ignore', 'ignore', 'ipc'],
      windowsHide: true
    })
    this.child = child
    if (windowsSandbox) {
      child.stdout?.on('data', (chunk: Buffer) => this.handleStdioData(chunk))
      child.stderr?.on('data', () => undefined)
    } else {
      child.on('message', (response: unknown) => this.handleResponse(response))
    }
    child.once('error', (error) => this.failChild(new Error('The isolated NER worker could not start.', { cause: error })))
    child.once('exit', (code, signal) => {
      if (this.child === child) this.child = null
      this.failChild(new Error(`The isolated NER worker exited (${code ?? signal ?? 'unknown'}).`))
    })
    return child
  }

  private handleStdioData(chunk: Buffer): void {
    this.responseBuffer = Buffer.concat([this.responseBuffer, chunk])
    if (this.responseBuffer.length > 2 * 1024 * 1024) {
      this.failChild(new Error('The AppContainer NER response exceeded its size limit.'))
      this.dispose()
      return
    }
    while (true) {
      const newline = this.responseBuffer.indexOf(0x0a)
      if (newline < 0) return
      const line = this.responseBuffer.subarray(0, newline).toString('utf8').trim()
      this.responseBuffer = Buffer.from(this.responseBuffer.subarray(newline + 1))
      if (!line) continue
      try {
        this.handleResponse(JSON.parse(line))
      } catch (error) {
        this.failChild(new Error('The AppContainer NER worker returned invalid JSON.', { cause: error }))
        this.dispose()
        return
      }
    }
  }

  private handleResponse(response: unknown): void {
    if (!isLocalNerWorkerResponse(response)) {
      this.failChild(new Error('The isolated NER worker returned an invalid response.'))
      this.dispose()
      return
    }
    const pending = this.pending.get(response.id)
    if (!pending) return
    this.pending.delete(response.id)
    clearTimeout(pending.timeout)
    if (!response.ok) {
      pending.reject(new Error(`${response.errorCode}: ${response.message}`))
      return
    }
    if (response.entities.some((entity) => entity.endUtf16 > pending.text.length)) {
      pending.reject(new Error('The isolated NER worker returned an entity outside its input.'))
      return
    }
    pending.resolve(response.entities)
  }

  private rejectRequest(id: string, error: Error): void {
    const pending = this.pending.get(id)
    if (!pending) return
    this.pending.delete(id)
    clearTimeout(pending.timeout)
    pending.reject(error)
  }

  private failChild(error: Error): void {
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timeout)
      pending.reject(error)
    }
    this.pending.clear()
  }
}

interface AppleNameDetectorPort {
  readonly engine: 'apple-natural-language'
  detectNames(text: string): Promise<AppleNameDetectionResult>
}

interface GlinerNameDetectorPort {
  readonly engine: 'gliner-x-small-onnx'
  detectNames(text: string): Promise<GlinerNameDetectionResult>
  dispose?(): void
}

/** Stops a detector's worker process, if it has one. */
export function disposeLocalPersonNameDetector(detector: LocalPersonNameDetectorPort | null | undefined): void {
  const disposable = detector as { dispose?: () => void } | null | undefined
  disposable?.dispose?.()
}

/**
 * macOS: Apple NaturalLanguage ∪ GLiNER. Entity lists are merged before
 * candidate collection. Apple NL stays mandatory - its failure rejects - and
 * a GLiNER failure degrades to Apple NL alone, which was the macOS baseline.
 */
export class LocalUnionPersonNameDetector implements LocalPersonNameDetectorPort {
  readonly engine = 'local-ner-union' as const

  constructor(
    private readonly apple: AppleNameDetectorPort,
    private readonly gliner: GlinerNameDetectorPort,
    private readonly onGlinerUnavailable?: (error: unknown) => void
  ) {}

  dispose(): void {
    this.gliner.dispose?.()
  }

  async detectNames(text: string): Promise<UnionNameDetectionResult> {
    const [apple, gliner] = await Promise.allSettled([this.apple.detectNames(text), this.gliner.detectNames(text)])
    if (apple.status === 'rejected') throw apple.reason instanceof Error ? apple.reason : new Error('Apple NaturalLanguage NER failed.')
    if (apple.value.networkAccess !== false) throw new Error('Apple NaturalLanguage NER did not prove networkAccess=false.')
    const engines: UnionNameDetectionResult['engines'] = ['apple-natural-language']
    const entities = [...apple.value.entities]
    if (gliner.status === 'fulfilled' && gliner.value.networkAccess === false) {
      engines.push('gliner-x-small-onnx')
      entities.push(...gliner.value.entities)
    } else {
      this.onGlinerUnavailable?.(gliner.status === 'rejected' ? gliner.reason : new Error('GLiNER networkAccess was not false.'))
    }
    const seen = new Set<string>()
    return {
      version: 'local-ner-union-v1',
      engine: 'local-ner-union',
      engines,
      networkAccess: false,
      requiresHumanConfirmation: true,
      entities: entities
        .toSorted((left, right) => left.startUtf16 - right.startUtf16 || left.endUtf16 - right.endUtf16)
        .filter((entity) => {
          const key = `${entity.startUtf16}:${entity.endUtf16}:${entity.text}`
          if (seen.has(key)) return false
          seen.add(key)
          return true
        })
    }
  }
}
