import { spawn, type ChildProcess } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { isAbsolute, win32 } from 'node:path'

export const localEmbeddingModel = Object.freeze({
  id: 'Xenova/multilingual-e5-small',
  revision: '761b726dd34fb83930e26aab4e9ac3899aa1fa78',
  dimension: 384,
  maximumBatchSize: 32,
  maximumTextLength: 6_000
})

export type LocalEmbeddingRole = 'query' | 'passage'

export interface LocalEmbeddingWorkerRequest {
  id: string
  kind: 'embed'
  role: LocalEmbeddingRole
  texts: string[]
  modelDirectory: string
}

export interface LocalEmbeddingWorkerSuccess {
  id: string
  kind: 'embed'
  ok: true
  modelId: typeof localEmbeddingModel.id
  modelRevision: typeof localEmbeddingModel.revision
  dimension: typeof localEmbeddingModel.dimension
  networkAccess: false
  vectors: number[][]
}

export interface LocalEmbeddingWorkerFailure {
  id: string
  kind: 'embed' | 'invalid'
  ok: false
  errorCode: string
  message: string
}

export type LocalEmbeddingWorkerResponse = LocalEmbeddingWorkerSuccess | LocalEmbeddingWorkerFailure

export function isLocalEmbeddingWorkerRequest(value: unknown): value is LocalEmbeddingWorkerRequest {
  if (!value || typeof value !== 'object') return false
  const candidate = value as Record<string, unknown>
  return typeof candidate.id === 'string' &&
    candidate.kind === 'embed' &&
    (candidate.role === 'query' || candidate.role === 'passage') &&
    typeof candidate.modelDirectory === 'string' &&
    isAbsolute(candidate.modelDirectory) &&
    Array.isArray(candidate.texts) &&
    candidate.texts.length > 0 &&
    candidate.texts.length <= localEmbeddingModel.maximumBatchSize &&
    candidate.texts.every((text) => typeof text === 'string' && text.trim().length > 0 && text.length <= localEmbeddingModel.maximumTextLength)
}

function isFiniteVector(value: unknown): value is number[] {
  return Array.isArray(value) &&
    value.length === localEmbeddingModel.dimension &&
    value.every((item) => typeof item === 'number' && Number.isFinite(item))
}

export function isLocalEmbeddingWorkerResponse(value: unknown): value is LocalEmbeddingWorkerResponse {
  if (!value || typeof value !== 'object') return false
  const candidate = value as Record<string, unknown>
  if (typeof candidate.id !== 'string' || typeof candidate.ok !== 'boolean') return false
  if (!candidate.ok) {
    return (candidate.kind === 'embed' || candidate.kind === 'invalid') &&
      typeof candidate.errorCode === 'string' &&
      typeof candidate.message === 'string'
  }
  return candidate.kind === 'embed' &&
    candidate.modelId === localEmbeddingModel.id &&
    candidate.modelRevision === localEmbeddingModel.revision &&
    candidate.dimension === localEmbeddingModel.dimension &&
    candidate.networkAccess === false &&
    Array.isArray(candidate.vectors) &&
    candidate.vectors.every(isFiniteVector)
}

export interface LocalEmbeddingWorkerClientOptions {
  workerPath: string
  modelDirectory: string
  windowsSandbox?: {
    launcherPath: string
    grantReadRoots: string[]
  }
  timeoutMs?: number
}

function isAbsoluteWorkerPath(path: string): boolean {
  return isAbsolute(path) || win32.isAbsolute(path)
}

interface PendingEmbeddingRequest {
  expectedVectors: number
  resolve: (vectors: number[][]) => void
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

export class LocalEmbeddingWorkerClient {
  private readonly timeoutMs: number
  private child: ChildProcess | null = null
  private readonly pending = new Map<string, PendingEmbeddingRequest>()
  private operationQueue: Promise<void> = Promise.resolve()
  private stdioResponseBuffer = Buffer.alloc(0)

  constructor(private readonly options: LocalEmbeddingWorkerClientOptions) {
    if (
      !isAbsoluteWorkerPath(options.workerPath) ||
      !isAbsoluteWorkerPath(options.modelDirectory) ||
      (options.windowsSandbox && (
        !isAbsoluteWorkerPath(options.windowsSandbox.launcherPath) ||
        options.windowsSandbox.grantReadRoots.length === 0 ||
        options.windowsSandbox.grantReadRoots.some((root) => !isAbsoluteWorkerPath(root))
      ))
    ) {
      throw new Error('Embedding worker and model paths must be absolute.')
    }
    this.timeoutMs = options.timeoutMs ?? 90_000
  }

  embedQueries(texts: string[]): Promise<number[][]> {
    return this.embedBatches('query', texts)
  }

  embedPassages(texts: string[]): Promise<number[][]> {
    return this.embedBatches('passage', texts)
  }

  dispose(): void {
    const error = new Error('The local embedding worker was stopped.')
    for (const request of this.pending.values()) {
      clearTimeout(request.timeout)
      request.reject(error)
    }
    this.pending.clear()
    this.stdioResponseBuffer = Buffer.alloc(0)
    const child = this.child
    this.child = null
    if (child?.connected) child.disconnect()
    if (child && !child.killed) child.kill('SIGTERM')
  }

  private embedBatches(role: LocalEmbeddingRole, texts: string[]): Promise<number[][]> {
    if (texts.length === 0) return Promise.resolve([])
    if (texts.some((text) => text.trim().length === 0 || text.length > localEmbeddingModel.maximumTextLength)) {
      return Promise.reject(new Error('Embedding text violates the local length limit.'))
    }
    return this.enqueue(async () => {
      const vectors: number[][] = []
      for (let offset = 0; offset < texts.length; offset += localEmbeddingModel.maximumBatchSize) {
        const batch = texts.slice(offset, offset + localEmbeddingModel.maximumBatchSize)
        vectors.push(...await this.sendBatch(role, batch))
      }
      return vectors
    })
  }

  private enqueue<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.operationQueue.then(operation, operation)
    this.operationQueue = result.then(() => undefined, () => undefined)
    return result
  }

  private sendBatch(role: LocalEmbeddingRole, texts: string[]): Promise<number[][]> {
    const child = this.ensureChild()
    const request: LocalEmbeddingWorkerRequest = {
      id: randomUUID(),
      kind: 'embed',
      role,
      texts,
      modelDirectory: this.options.modelDirectory
    }
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pending.delete(request.id)
        reject(new Error('Local embedding inference exceeded its execution time limit.'))
      }, this.timeoutMs)
      this.pending.set(request.id, { expectedVectors: texts.length, resolve, reject, timeout })
      if (process.platform === 'win32' && this.options.windowsSandbox) {
        child.stdin?.write(`${JSON.stringify(request)}\n`, (error) => {
          if (!error) return
          this.rejectPendingRequest(request.id, new Error('Embedding input could not be sent to the AppContainer worker.', { cause: error }))
        })
      } else {
        child.send(request, (error) => {
          if (!error) return
          this.rejectPendingRequest(request.id, new Error('Embedding input could not be sent to the isolated worker.', { cause: error }))
        })
      }
    })
  }

  private ensureChild(): ChildProcess {
    if (this.child && !this.child.killed && this.child.exitCode === null) return this.child
    const sandboxProfile = '(version 1) (allow default) (deny network*)'
    const windowsSandbox = process.platform === 'win32' ? this.options.windowsSandbox : undefined
    if (process.platform === 'win32' && !windowsSandbox) {
      throw new Error('Windows embedding inference requires the AppContainer sandbox launcher.')
    }
    const command = process.platform === 'darwin'
      ? '/usr/bin/sandbox-exec'
      : windowsSandbox?.launcherPath ?? process.execPath
    const args = process.platform === 'darwin'
      ? ['-p', sandboxProfile, process.execPath, this.options.workerPath]
      : windowsSandbox
        ? [
            '--profile', 'jp.sesai.agentdesktop.localworkers',
            ...windowsSandbox.grantReadRoots.flatMap((root) => ['--grant-read', root]),
            '--', process.execPath, this.options.workerPath, '--stdio'
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
      child.on('message', (rawResponse: unknown) => this.handleResponse(rawResponse))
    }
    child.once('error', (error) => this.failChild(new Error('The isolated embedding worker could not start.', { cause: error })))
    child.once('exit', (code, signal) => {
      if (this.child === child) this.child = null
      this.failChild(new Error(`The isolated embedding worker exited (${code ?? signal ?? 'unknown'}).`))
    })
    return child
  }

  private handleStdioData(chunk: Buffer): void {
    this.stdioResponseBuffer = Buffer.concat([this.stdioResponseBuffer, chunk])
    if (this.stdioResponseBuffer.length > 8 * 1024 * 1024) {
      this.failChild(new Error('The AppContainer embedding worker response exceeded its size limit.'))
      this.dispose()
      return
    }
    while (true) {
      const newline = this.stdioResponseBuffer.indexOf(0x0a)
      if (newline < 0) return
      const line = this.stdioResponseBuffer.subarray(0, newline).toString('utf8').trim()
      this.stdioResponseBuffer = Buffer.from(this.stdioResponseBuffer.subarray(newline + 1))
      if (!line) continue
      try {
        this.handleResponse(JSON.parse(line))
      } catch (error) {
        this.failChild(new Error('The AppContainer embedding worker returned invalid JSON.', { cause: error }))
        this.dispose()
        return
      }
    }
  }

  private handleResponse(rawResponse: unknown): void {
    if (!isLocalEmbeddingWorkerResponse(rawResponse)) {
      this.failChild(new Error('The isolated embedding worker returned an invalid response.'))
      this.dispose()
      return
    }
    const pending = this.pending.get(rawResponse.id)
    if (!pending) return
    this.pending.delete(rawResponse.id)
    clearTimeout(pending.timeout)
    if (!rawResponse.ok) {
      pending.reject(new Error(`${rawResponse.errorCode}: ${rawResponse.message}`))
      return
    }
    if (rawResponse.vectors.length !== pending.expectedVectors) {
      pending.reject(new Error('The isolated embedding worker returned an unexpected vector count.'))
      return
    }
    pending.resolve(rawResponse.vectors)
  }

  private failChild(error: Error): void {
    for (const request of this.pending.values()) {
      clearTimeout(request.timeout)
      request.reject(error)
    }
    this.pending.clear()
  }

  private rejectPendingRequest(id: string, error: Error): void {
    const pending = this.pending.get(id)
    if (!pending) return
    this.pending.delete(id)
    clearTimeout(pending.timeout)
    pending.reject(error)
  }
}
