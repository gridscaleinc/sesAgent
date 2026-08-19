import { createHash } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { readFile, stat } from 'node:fs/promises'
import { join, relative, resolve } from 'node:path'
import { pipeline as streamPipeline } from 'node:stream/promises'
import {
  isLocalEmbeddingWorkerRequest,
  localEmbeddingModel,
  type LocalEmbeddingRole,
  type LocalEmbeddingWorkerFailure,
  type LocalEmbeddingWorkerRequest,
  type LocalEmbeddingWorkerSuccess
} from '@local-ai'
import { installParserNetworkDenyGuard } from './network-deny'

installParserNetworkDenyGuard()

interface EmbeddingManifest {
  schemaVersion: 'local-embedding-model-v1'
  modelId: string
  revision: string
  embeddingDimension: number
  queryPrefix: string
  passagePrefix: string
  files: Array<{ path: string; bytes: number; sha256: string }>
}

type FeatureExtractor = ((texts: string[], options: { pooling: 'mean'; normalize: true }) => Promise<{
  dims: number[]
  tolist(): number[][]
}>) & { dispose(): Promise<void> }

let loadedDirectory: string | null = null
let manifestPromise: Promise<EmbeddingManifest> | null = null
let extractorPromise: Promise<FeatureExtractor> | null = null

async function sha256(path: string): Promise<string> {
  const hash = createHash('sha256')
  await streamPipeline(createReadStream(path), hash)
  return hash.digest('hex')
}

async function verifiedManifest(modelDirectory: string): Promise<EmbeddingManifest> {
  const directory = resolve(modelDirectory)
  if (loadedDirectory && loadedDirectory !== directory) throw new Error('MODEL_DIRECTORY_CHANGED')
  loadedDirectory = directory
  const raw = JSON.parse(await readFile(join(directory, 'model-manifest.json'), 'utf8')) as EmbeddingManifest
  if (
    raw.schemaVersion !== 'local-embedding-model-v1' ||
    raw.modelId !== localEmbeddingModel.id ||
    raw.revision !== localEmbeddingModel.revision ||
    raw.embeddingDimension !== localEmbeddingModel.dimension ||
    !Array.isArray(raw.files) || raw.files.length === 0
  ) throw new Error('MODEL_MANIFEST_INVALID')
  for (const file of raw.files) {
    const path = resolve(directory, file.path)
    if (relative(directory, path).startsWith('..')) throw new Error('MODEL_PATH_INVALID')
    const metadata = await stat(path)
    if (!metadata.isFile() || metadata.size !== file.bytes || await sha256(path) !== file.sha256) {
      throw new Error(`MODEL_INTEGRITY_FAILED:${file.path}`)
    }
  }
  return raw
}

async function getExtractor(modelDirectory: string): Promise<{ extractor: FeatureExtractor; manifest: EmbeddingManifest }> {
  manifestPromise ??= verifiedManifest(modelDirectory)
  const manifest = await manifestPromise
  extractorPromise ??= (async () => {
    const { env, pipeline } = await import('@huggingface/transformers')
    env.allowLocalModels = true
    env.allowRemoteModels = false
    env.localModelPath = resolve(modelDirectory, '..', '..')
    env.useBrowserCache = false
    env.useFSCache = false
    return await pipeline('feature-extraction', localEmbeddingModel.id, {
      dtype: 'q8',
      local_files_only: true
    }) as unknown as FeatureExtractor
  })()
  return { extractor: await extractorPromise, manifest }
}

function prefix(role: LocalEmbeddingRole, manifest: EmbeddingManifest): string {
  return role === 'query' ? manifest.queryPrefix : manifest.passagePrefix
}

async function embed(request: LocalEmbeddingWorkerRequest): Promise<LocalEmbeddingWorkerSuccess> {
  const { extractor, manifest } = await getExtractor(request.modelDirectory)
  const output = await extractor(
    request.texts.map((text) => `${prefix(request.role, manifest)}${text.normalize('NFKC').trim()}`),
    { pooling: 'mean', normalize: true }
  )
  const vectors = output.tolist()
  if (
    output.dims.length !== 2 ||
    output.dims[0] !== request.texts.length ||
    output.dims[1] !== localEmbeddingModel.dimension ||
    vectors.length !== request.texts.length
  ) throw new Error('MODEL_OUTPUT_INVALID')
  return {
    id: request.id,
    kind: 'embed',
    ok: true,
    modelId: localEmbeddingModel.id,
    modelRevision: localEmbeddingModel.revision,
    dimension: localEmbeddingModel.dimension,
    networkAccess: false,
    vectors
  }
}

let operationQueue: Promise<void> = Promise.resolve()

function queueRequest(rawRequest: unknown, respond: (response: LocalEmbeddingWorkerSuccess | LocalEmbeddingWorkerFailure) => void): void {
  operationQueue = operationQueue.then(async () => {
    if (!isLocalEmbeddingWorkerRequest(rawRequest)) {
      respond({
        id: typeof rawRequest === 'object' && rawRequest && 'id' in rawRequest ? String(rawRequest.id) : 'invalid',
        kind: 'invalid',
        ok: false,
        errorCode: 'INVALID_REQUEST',
        message: 'Invalid embedding request.'
      } satisfies LocalEmbeddingWorkerFailure)
      return
    }
    try {
      respond(await embed(rawRequest))
    } catch (error) {
      respond({
        id: rawRequest.id,
        kind: 'embed',
        ok: false,
        errorCode: error instanceof Error ? error.message.split(':')[0] ?? 'EMBEDDING_FAILED' : 'EMBEDDING_FAILED',
        message: 'Local embedding inference failed closed.'
      } satisfies LocalEmbeddingWorkerFailure)
    }
  })
}

if (process.argv.includes('--stdio')) {
  let input = Buffer.alloc(0)
  process.stdin.on('data', (chunk: Buffer) => {
    input = Buffer.concat([input, chunk])
    if (input.length > 512 * 1024) {
      process.stdout.write(`${JSON.stringify({
        id: 'invalid',
        kind: 'invalid',
        ok: false,
        errorCode: 'INPUT_LIMIT',
        message: 'Embedding request exceeded its local IPC size limit.'
      } satisfies LocalEmbeddingWorkerFailure)}\n`)
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
      try {
        request = JSON.parse(line)
      } catch {
        request = null
      }
      queueRequest(request, (response) => process.stdout.write(`${JSON.stringify(response)}\n`))
    }
  })
} else {
  process.on('message', (rawRequest: unknown) => {
    queueRequest(rawRequest, (response) => process.send?.(response))
  })
}

for (const signal of ['SIGTERM', 'SIGINT'] as const) {
  process.once(signal, () => {
    void extractorPromise?.then((extractor) => extractor.dispose()).finally(() => process.exit(0))
  })
}
