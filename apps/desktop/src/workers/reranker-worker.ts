import { createHash } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { readFile, stat } from 'node:fs/promises'
import { join, relative, resolve } from 'node:path'
import { pipeline as streamPipeline } from 'node:stream/promises'
import { AutoTokenizer, env } from '@huggingface/transformers'
import { InferenceSession, Tensor } from 'onnxruntime-node'
import {
  isLocalRerankerWorkerRequest,
  localRerankerModel,
  type LocalRerankerWorkerRequest,
  type LocalRerankerWorkerResponse
} from '@local-ai'
import { installParserNetworkDenyGuard } from './network-deny'

installParserNetworkDenyGuard()

interface TokenizedTensor {
  type: 'int64'
  data: BigInt64Array
  dims: number[]
}

type LocalTokenizer = (
  query: string[],
  options: { text_pair: string[]; padding: true; truncation: true; max_length: number }
) => Promise<Record<string, TokenizedTensor>>

let loadedDirectory: string | null = null
let tokenizerPromise: Promise<LocalTokenizer> | null = null
let sessionPromise: Promise<InferenceSession> | null = null

async function sha256(path: string): Promise<string> {
  const hash = createHash('sha256')
  await streamPipeline(createReadStream(path), hash)
  return hash.digest('hex')
}

function platformModelPath(): string {
  if (process.platform === 'darwin' && process.arch === 'arm64') return 'onnx/model_qint8_arm64.onnx'
  if (process.platform === 'win32' && process.arch === 'x64') return 'onnx/model_qint8_avx2.onnx'
  throw new Error('RERANKER_PLATFORM_UNSUPPORTED')
}

async function verifyModel(modelDirectory: string): Promise<string> {
  const directory = resolve(modelDirectory)
  if (loadedDirectory && loadedDirectory !== directory) throw new Error('MODEL_DIRECTORY_CHANGED')
  loadedDirectory = directory
  const manifest = JSON.parse(await readFile(join(directory, 'model-manifest.json'), 'utf8')) as Record<string, unknown>
  if (
    manifest.schemaVersion !== 'local-reranker-model-v1' || manifest.modelId !== localRerankerModel.id ||
    manifest.revision !== localRerankerModel.revision || manifest.license !== 'MIT' ||
    manifest.maximumSequenceLength !== localRerankerModel.maximumSequenceLength ||
    manifest.maximumCandidates !== localRerankerModel.maximumCandidates ||
    JSON.stringify(manifest.files) !== JSON.stringify(localRerankerModel.files)
  ) throw new Error('MODEL_MANIFEST_INVALID')
  const modelPath = platformModelPath()
  const requiredFiles = localRerankerModel.files.filter((file) => file.platform === 'all' || file.path === modelPath)
  for (const file of requiredFiles) {
    const path = resolve(directory, file.path)
    if (relative(directory, path).startsWith('..')) throw new Error('MODEL_PATH_INVALID')
    const metadata = await stat(path)
    if (!metadata.isFile() || metadata.size !== file.bytes || await sha256(path) !== file.sha256) {
      throw new Error(`MODEL_INTEGRITY_FAILED:${file.path}`)
    }
  }
  return resolve(directory, modelPath)
}

async function runtime(modelDirectory: string): Promise<{ tokenizer: LocalTokenizer; session: InferenceSession }> {
  const modelPath = await verifyModel(modelDirectory)
  env.allowLocalModels = true
  env.allowRemoteModels = false
  env.useBrowserCache = false
  env.useFSCache = false
  tokenizerPromise ??= AutoTokenizer.from_pretrained(resolve(modelDirectory), {
    local_files_only: true
  }) as unknown as Promise<LocalTokenizer>
  sessionPromise ??= InferenceSession.create(modelPath, { executionProviders: ['cpu'] })
  return { tokenizer: await tokenizerPromise, session: await sessionPromise }
}

async function rerank(request: LocalRerankerWorkerRequest): Promise<LocalRerankerWorkerResponse> {
  const { tokenizer, session } = await runtime(request.modelDirectory)
  const tokenized = await tokenizer(
    request.candidates.map(() => request.query.normalize('NFKC').trim()),
    {
      text_pair: request.candidates.map((candidate) => candidate.text.normalize('NFKC').trim()),
      padding: true,
      truncation: true,
      max_length: localRerankerModel.maximumSequenceLength
    }
  )
  const feeds: Record<string, Tensor> = {}
  for (const name of session.inputNames) {
    const value = tokenized[name]
    if (!value || value.type !== 'int64' || !(value.data instanceof BigInt64Array)) throw new Error('TOKENIZER_OUTPUT_INVALID')
    feeds[name] = new Tensor('int64', value.data, value.dims)
  }
  const output = await session.run(feeds)
  const logits = output.logits
  if (!logits || logits.type !== 'float32' || logits.dims.length !== 2 ||
    logits.dims[0] !== request.candidates.length || logits.dims[1] !== 1) {
    throw new Error('MODEL_OUTPUT_INVALID')
  }
  const values = Array.from(logits.data as Float32Array)
  if (values.some((value) => !Number.isFinite(value))) throw new Error('MODEL_OUTPUT_INVALID')
  return {
    id: request.id,
    kind: 'rerank',
    ok: true,
    modelId: localRerankerModel.id,
    modelRevision: localRerankerModel.revision,
    networkAccess: false,
    scores: request.candidates.map((candidate, index) => ({ id: candidate.id, score: values[index]! }))
  }
}

let operationQueue: Promise<void> = Promise.resolve()

function queueRequest(rawRequest: unknown, respond: (response: LocalRerankerWorkerResponse) => void): void {
  operationQueue = operationQueue.then(async () => {
    if (!isLocalRerankerWorkerRequest(rawRequest)) {
      respond({ id: 'invalid', kind: 'invalid', ok: false, errorCode: 'INVALID_REQUEST', message: 'Invalid reranker request.' })
      return
    }
    try {
      respond(await rerank(rawRequest))
    } catch (error) {
      respond({
        id: rawRequest.id,
        kind: 'rerank',
        ok: false,
        errorCode: error instanceof Error ? error.message.split(':')[0] ?? 'RERANK_FAILED' : 'RERANK_FAILED',
        message: 'Local reranking failed closed.'
      })
    }
  })
}

if (process.argv.includes('--stdio')) {
  let input = Buffer.alloc(0)
  process.stdin.on('data', (chunk: Buffer) => {
    input = Buffer.concat([input, chunk])
    if (input.length > 256 * 1024) {
      process.stdout.write(`${JSON.stringify({ id: 'invalid', kind: 'invalid', ok: false, errorCode: 'INPUT_LIMIT', message: 'Reranker request exceeded its IPC limit.' })}\n`)
      process.exitCode = 64
      process.stdin.destroy()
      return
    }
    while (true) {
      const newline = input.indexOf(0x0a)
      if (newline < 0) return
      const line = input.subarray(0, newline).toString('utf8').trim()
      input = Buffer.from(input.subarray(newline + 1))
      if (!line) continue
      let request: unknown
      try { request = JSON.parse(line) } catch { request = null }
      queueRequest(request, (response) => process.stdout.write(`${JSON.stringify(response)}\n`))
    }
  })
} else {
  process.on('message', (request: unknown) => queueRequest(request, (response) => process.send?.(response)))
}

for (const signal of ['SIGTERM', 'SIGINT'] as const) {
  process.once(signal, () => {
    void sessionPromise?.then((session) => session.release()).finally(() => process.exit(0))
  })
}
