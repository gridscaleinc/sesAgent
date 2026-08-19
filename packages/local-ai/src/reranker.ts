import { spawn, type ChildProcess } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { isAbsolute, win32 } from 'node:path'

export const localRerankerModel = Object.freeze({
  id: 'hotchpotch/japanese-reranker-tiny-v2',
  revision: 'ba95175a4d53058816b971f31929f10c5cad8560',
  maximumCandidates: 20,
  maximumQueryLength: 2_000,
  maximumPassageLength: 6_000,
  maximumSequenceLength: 512,
  files: Object.freeze([
    Object.freeze({ path: 'config.json', platform: 'all', bytes: 1_348, sha256: '56ac1e6180e7ee5b7d0700fe69794bff9eb6228bb5510209296d6c7e3f3c98d1' }),
    Object.freeze({ path: 'special_tokens_map.json', platform: 'all', bytes: 968, sha256: '30bf8256f9a1eb3287af2a9b7940465e29a38aad4a459a3e773bb3a14bd34c0f' }),
    Object.freeze({ path: 'tokenizer.json', platform: 'all', bytes: 6_724_873, sha256: '0a94ac9a0a02c067bdef25b72ae9f4ee33f48f552e55988d444f6d25eeb1d062' }),
    Object.freeze({ path: 'tokenizer.model', platform: 'all', bytes: 1_831_879, sha256: '008293028e1a9d9a1038d9b63d989a2319797dfeaa03f171093a57b33a3a8277' }),
    Object.freeze({ path: 'tokenizer_config.json', platform: 'all', bytes: 3_779, sha256: '34004511993472f15c7202074284c57788c161fb6567de164b8e0c0266f155e4' }),
    Object.freeze({ path: 'onnx/model_qint8_arm64.onnx', platform: 'darwin-arm64', bytes: 29_634_681, sha256: '7dd460445ddac13fcbbc4f0111a4287e99697fedacd5421d0cc07f08aab881b0' }),
    Object.freeze({ path: 'onnx/model_qint8_avx2.onnx', platform: 'win32-x64', bytes: 29_634_681, sha256: '649a18583e21ad532e420a4ded4c9c4ff7ce882aa84af2bf2180ec4d4f679e38' })
  ])
})

export interface LocalRerankerCandidate {
  id: string
  text: string
}

export interface LocalRerankerWorkerRequest {
  id: string
  kind: 'rerank'
  query: string
  candidates: LocalRerankerCandidate[]
  modelDirectory: string
}

export type LocalRerankerWorkerResponse =
  | {
      id: string
      kind: 'rerank'
      ok: true
      modelId: typeof localRerankerModel.id
      modelRevision: typeof localRerankerModel.revision
      networkAccess: false
      scores: Array<{ id: string; score: number }>
    }
  | { id: string; kind: 'rerank' | 'invalid'; ok: false; errorCode: string; message: string }

function isAbsoluteWorkerPath(path: string): boolean {
  return isAbsolute(path) || win32.isAbsolute(path)
}

export function isLocalRerankerWorkerRequest(value: unknown): value is LocalRerankerWorkerRequest {
  if (!value || typeof value !== 'object') return false
  const candidate = value as Record<string, unknown>
  if (
    typeof candidate.id !== 'string' || candidate.kind !== 'rerank' ||
    typeof candidate.query !== 'string' || !candidate.query.trim() ||
    candidate.query.length > localRerankerModel.maximumQueryLength ||
    typeof candidate.modelDirectory !== 'string' || !isAbsoluteWorkerPath(candidate.modelDirectory) ||
    !Array.isArray(candidate.candidates) || candidate.candidates.length === 0 ||
    candidate.candidates.length > localRerankerModel.maximumCandidates
  ) return false
  const ids = new Set<string>()
  return candidate.candidates.every((item) => {
    if (!item || typeof item !== 'object') return false
    const entry = item as Record<string, unknown>
    if (
      typeof entry.id !== 'string' || !entry.id || ids.has(entry.id) ||
      typeof entry.text !== 'string' || !entry.text.trim() ||
      entry.text.length > localRerankerModel.maximumPassageLength
    ) return false
    ids.add(entry.id)
    return true
  })
}

export function isLocalRerankerWorkerResponse(value: unknown): value is LocalRerankerWorkerResponse {
  if (!value || typeof value !== 'object') return false
  const candidate = value as Record<string, unknown>
  if (typeof candidate.id !== 'string' || typeof candidate.ok !== 'boolean') return false
  if (!candidate.ok) {
    return (candidate.kind === 'rerank' || candidate.kind === 'invalid') &&
      typeof candidate.errorCode === 'string' && typeof candidate.message === 'string'
  }
  return candidate.kind === 'rerank' &&
    candidate.modelId === localRerankerModel.id &&
    candidate.modelRevision === localRerankerModel.revision &&
    candidate.networkAccess === false &&
    Array.isArray(candidate.scores) &&
    candidate.scores.every((item) => item && typeof item === 'object' &&
      typeof (item as Record<string, unknown>).id === 'string' &&
      typeof (item as Record<string, unknown>).score === 'number' &&
      Number.isFinite((item as Record<string, unknown>).score))
}

export interface LocalRerankerWorkerClientOptions {
  workerPath: string
  modelDirectory: string
  windowsSandbox?: { launcherPath: string; grantReadRoots: string[] }
  timeoutMs?: number
}

interface PendingRequest {
  expectedIds: Set<string>
  resolve: (scores: ReadonlyMap<string, number>) => void
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

export class LocalRerankerWorkerClient {
  private readonly timeoutMs: number
  private child: ChildProcess | null = null
  private readonly pending = new Map<string, PendingRequest>()
  private responseBuffer = Buffer.alloc(0)
  private operationQueue: Promise<void> = Promise.resolve()

  constructor(private readonly options: LocalRerankerWorkerClientOptions) {
    if (
      !isAbsoluteWorkerPath(options.workerPath) || !isAbsoluteWorkerPath(options.modelDirectory) ||
      (options.windowsSandbox && (
        !isAbsoluteWorkerPath(options.windowsSandbox.launcherPath) ||
        options.windowsSandbox.grantReadRoots.length === 0 ||
        options.windowsSandbox.grantReadRoots.some((root) => !isAbsoluteWorkerPath(root))
      ))
    ) throw new Error('Reranker worker, model, and sandbox paths must be absolute.')
    this.timeoutMs = options.timeoutMs ?? 60_000
  }

  rerank(query: string, candidates: LocalRerankerCandidate[]): Promise<ReadonlyMap<string, number>> {
    const result = this.operationQueue.then(() => this.send(query, candidates), () => this.send(query, candidates))
    this.operationQueue = result.then(() => undefined, () => undefined)
    return result
  }

  dispose(): void {
    const error = new Error('The local reranker worker was stopped.')
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

  private send(query: string, candidates: LocalRerankerCandidate[]): Promise<ReadonlyMap<string, number>> {
    const request: LocalRerankerWorkerRequest = {
      id: randomUUID(),
      kind: 'rerank',
      query,
      candidates,
      modelDirectory: this.options.modelDirectory
    }
    if (!isLocalRerankerWorkerRequest(request)) return Promise.reject(new Error('Reranker input violates the local contract.'))
    const child = this.ensureChild()
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pending.delete(request.id)
        reject(new Error('Local reranking exceeded its execution time limit.'))
      }, this.timeoutMs)
      this.pending.set(request.id, {
        expectedIds: new Set(candidates.map((candidate) => candidate.id)),
        resolve,
        reject,
        timeout
      })
      if (process.platform === 'win32' && this.options.windowsSandbox) {
        child.stdin?.write(`${JSON.stringify(request)}\n`, (error) => {
          if (error) this.rejectRequest(request.id, new Error('Reranker input could not be sent to AppContainer.', { cause: error }))
        })
      } else {
        child.send(request, (error) => {
          if (error) this.rejectRequest(request.id, new Error('Reranker input could not be sent to the isolated worker.', { cause: error }))
        })
      }
    })
  }

  private ensureChild(): ChildProcess {
    if (this.child && !this.child.killed && this.child.exitCode === null) return this.child
    const windowsSandbox = process.platform === 'win32' ? this.options.windowsSandbox : undefined
    if (process.platform === 'win32' && !windowsSandbox) {
      throw new Error('Windows reranking requires the AppContainer sandbox launcher.')
    }
    const command = process.platform === 'darwin' ? '/usr/bin/sandbox-exec' : windowsSandbox?.launcherPath ?? process.execPath
    const args = process.platform === 'darwin'
      ? ['-p', '(version 1) (allow default) (deny network*)', process.execPath, this.options.workerPath]
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
      child.on('message', (response: unknown) => this.handleResponse(response))
    }
    child.once('error', (error) => this.failChild(new Error('The isolated reranker worker could not start.', { cause: error })))
    child.once('exit', (code, signal) => {
      if (this.child === child) this.child = null
      this.failChild(new Error(`The isolated reranker worker exited (${code ?? signal ?? 'unknown'}).`))
    })
    return child
  }

  private handleStdioData(chunk: Buffer): void {
    this.responseBuffer = Buffer.concat([this.responseBuffer, chunk])
    if (this.responseBuffer.length > 2 * 1024 * 1024) {
      this.failChild(new Error('The AppContainer reranker response exceeded its size limit.'))
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
        this.failChild(new Error('The AppContainer reranker returned invalid JSON.', { cause: error }))
        this.dispose()
        return
      }
    }
  }

  private handleResponse(response: unknown): void {
    if (!isLocalRerankerWorkerResponse(response)) {
      this.failChild(new Error('The isolated reranker returned an invalid response.'))
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
    if (
      response.scores.length !== pending.expectedIds.size ||
      response.scores.some((score) => !pending.expectedIds.has(score.id))
    ) {
      pending.reject(new Error('The isolated reranker returned an unexpected candidate set.'))
      return
    }
    pending.resolve(new Map(response.scores.map((score) => [score.id, score.score])))
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
