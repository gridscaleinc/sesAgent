import { fork, spawn, type ChildProcess } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { isAbsolute, win32 } from 'node:path'
import { parsedEmlMessageSchema, type EmlFileManifest, type ParsedEmlMessage } from '@mail'
import type { StagedLocalFile } from '@shared/contracts'
import { documentIrSchema, type DocumentIR, type ParserWorkerRequest, type ParserWorkerResponse } from './index'

export interface ParserWorkerClientOptions {
  workerPath: string
  windowsSandbox?: {
    launcherPath: string
    grantReadRoots: string[]
  }
  timeoutMs?: number
  maxResponseBytes?: number
}

function isAbsoluteWorkerPath(path: string): boolean {
  return isAbsolute(path) || win32.isAbsolute(path)
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

export class ParserWorkerClient {
  private readonly timeoutMs: number
  private readonly maxResponseBytes: number

  constructor(private readonly options: ParserWorkerClientOptions) {
    if (
      !isAbsoluteWorkerPath(options.workerPath) ||
      (options.windowsSandbox && (
        !isAbsoluteWorkerPath(options.windowsSandbox.launcherPath) ||
        options.windowsSandbox.grantReadRoots.length === 0 ||
        options.windowsSandbox.grantReadRoots.some((root) => !isAbsoluteWorkerPath(root))
      ))
    ) throw new Error('Parser worker and sandbox paths must be absolute.')
    this.timeoutMs = options.timeoutMs ?? 20_000
    this.maxResponseBytes = options.maxResponseBytes ?? 5 * 1024 * 1024
  }

  parse(file: StagedLocalFile, bytes: Buffer): Promise<DocumentIR> {
    const request: ParserWorkerRequest = {
      id: randomUUID(),
      kind: 'parse-document',
      file,
      bytes
    }

    return this.sendRequest(request, (response) => {
      if (!response.ok || response.kind !== 'parse-document') return null
      const parsedDocument = documentIrSchema.safeParse(response.document)
      return parsedDocument.success ? parsedDocument.data : null
    }, 'document')
  }

  parseEml(file: EmlFileManifest, bytes: Buffer): Promise<ParsedEmlMessage> {
    const request: ParserWorkerRequest = {
      id: randomUUID(),
      kind: 'parse-eml',
      file,
      bytes
    }
    return this.sendRequest(request, (response) => {
      if (!response.ok || response.kind !== 'parse-eml') return null
      const parsedMessage = parsedEmlMessageSchema.safeParse(response.message)
      return parsedMessage.success ? parsedMessage.data : null
    }, 'EML message')
  }

  private sendRequest<T>(
    request: ParserWorkerRequest,
    parseResponse: (response: ParserWorkerResponse) => T | null,
    resultLabel: string
  ): Promise<T> {
    if (process.platform === 'win32') {
      if (!this.options.windowsSandbox) {
        return Promise.reject(new Error('Windows document parsing requires the AppContainer sandbox launcher.'))
      }
      return this.sendSandboxedRequest(request, parseResponse, resultLabel)
    }
    return new Promise<T>((resolve, reject) => {
      let settled = false
      const child = fork(this.options.workerPath, [], {
        cwd: process.cwd(),
        env: sanitizedWorkerEnvironment(),
        execArgv: [],
        execPath: process.execPath,
        serialization: 'advanced',
        stdio: ['ignore', 'ignore', 'ignore', 'ipc']
      })

      const finish = (operation: () => void): void => {
        if (settled) return
        settled = true
        clearTimeout(timeout)
        safelyStop(child)
        operation()
      }
      const timeout = setTimeout(() => {
        finish(() => reject(new Error('The local parser exceeded its execution time limit.')))
      }, this.timeoutMs)

      child.once('error', (error) => finish(() => reject(new Error('The isolated parser process could not start.', { cause: error }))))
      child.once('exit', (code, signal) => {
        if (!settled) {
          finish(() => reject(new Error(`The isolated parser exited before returning a result (${code ?? signal ?? 'unknown'}).`)))
        }
      })
      child.on('message', (rawResponse: unknown) => {
        if (!isParserWorkerResponse(rawResponse) || rawResponse.id !== request.id || rawResponse.kind !== request.kind) {
          finish(() => reject(new Error('The isolated parser returned an invalid response.')))
          return
        }
        if (Buffer.byteLength(JSON.stringify(rawResponse), 'utf8') > this.maxResponseBytes) {
          finish(() => reject(new Error('The isolated parser response exceeded its size limit.')))
          return
        }
        if (!rawResponse.ok) {
          finish(() => reject(new Error(`${rawResponse.errorCode}: ${rawResponse.message}`)))
          return
        }
        const parsedResult = parseResponse(rawResponse)
        if (parsedResult === null) {
          finish(() => reject(new Error(`The isolated parser returned a ${resultLabel} that violates its schema.`)))
          return
        }
        finish(() => resolve(parsedResult))
      })

      child.send(request, (error) => {
        if (error) finish(() => reject(new Error('The staged document could not be sent to the isolated parser.', { cause: error })))
      })
    })
  }

  private sendSandboxedRequest<T>(
    request: ParserWorkerRequest,
    parseResponse: (response: ParserWorkerResponse) => T | null,
    resultLabel: string
  ): Promise<T> {
    const sandbox = this.options.windowsSandbox
    if (!sandbox) return Promise.reject(new Error('Windows parser sandbox configuration is missing.'))
    return new Promise<T>((resolve, reject) => {
      const child = spawn(sandbox.launcherPath, [
        '--profile', 'jp.sesai.agentdesktop.localworkers',
        ...sandbox.grantReadRoots.flatMap((root) => ['--grant-read', root]),
        '--', process.execPath, this.options.workerPath, '--stdio'
      ], {
        cwd: sandbox.grantReadRoots[0] ?? process.cwd(),
        env: sanitizedWorkerEnvironment(),
        shell: false,
        stdio: ['pipe', 'pipe', 'pipe'],
        windowsHide: true
      })
      const chunks: Buffer[] = []
      const errors: Buffer[] = []
      let responseBytes = 0
      let settled = false
      const finish = (operation: () => void): void => {
        if (settled) return
        settled = true
        clearTimeout(timeout)
        if (child.exitCode === null && !child.killed) child.kill('SIGTERM')
        operation()
      }
      const timeout = setTimeout(
        () => finish(() => reject(new Error('The AppContainer parser exceeded its execution time limit.'))),
        this.timeoutMs
      )
      child.once('error', (error) => finish(() => reject(new Error('The AppContainer parser could not start.', { cause: error }))))
      child.stdout.on('data', (chunk: Buffer) => {
        responseBytes += chunk.length
        if (responseBytes > this.maxResponseBytes) {
          finish(() => reject(new Error('The AppContainer parser response exceeded its size limit.')))
          return
        }
        chunks.push(chunk)
      })
      child.stderr.on('data', (chunk: Buffer) => {
        if (errors.reduce((total, item) => total + item.length, 0) < 64 * 1024) errors.push(chunk)
      })
      child.once('close', (code, signal) => {
        if (settled) return
        if (code !== 0) {
          finish(() => reject(new Error(
            `The AppContainer parser exited (${code ?? signal ?? 'unknown'}): ${Buffer.concat(errors).toString('utf8').slice(0, 1_000)}`
          )))
          return
        }
        let response: unknown
        try {
          response = JSON.parse(Buffer.concat(chunks).toString('utf8').trim())
        } catch (error) {
          finish(() => reject(new Error('The AppContainer parser returned invalid JSON.', { cause: error })))
          return
        }
        if (!isParserWorkerResponse(response) || response.id !== request.id || response.kind !== request.kind) {
          finish(() => reject(new Error('The AppContainer parser returned an invalid response.')))
          return
        }
        if (!response.ok) {
          finish(() => reject(new Error(`${response.errorCode}: ${response.message}`)))
          return
        }
        const parsedResult = parseResponse(response)
        if (parsedResult === null) {
          finish(() => reject(new Error(`The AppContainer parser returned a ${resultLabel} that violates its schema.`)))
          return
        }
        finish(() => resolve(parsedResult))
      })

      const { bytes, ...metadata } = request
      const header = Buffer.from(JSON.stringify(metadata), 'utf8')
      const length = Buffer.allocUnsafe(4)
      length.writeUInt32LE(header.length, 0)
      child.stdin.once('error', (error) => finish(() => reject(new Error('Parser input could not be delivered.', { cause: error }))))
      child.stdin.write(length)
      child.stdin.write(header)
      child.stdin.end(bytes)
    })
  }
}

function safelyStop(child: ChildProcess): void {
  if (child.connected) child.disconnect()
  if (!child.killed) child.kill('SIGTERM')
}

function isParserWorkerResponse(value: unknown): value is ParserWorkerResponse {
  if (!value || typeof value !== 'object') return false
  const candidate = value as Record<string, unknown>
  if (
    typeof candidate.id !== 'string' ||
    typeof candidate.ok !== 'boolean' ||
    !['parse-document', 'parse-eml', 'invalid'].includes(String(candidate.kind))
  ) return false
  if (candidate.ok && candidate.kind === 'parse-document') return Boolean(candidate.document && typeof candidate.document === 'object')
  if (candidate.ok && candidate.kind === 'parse-eml') return Boolean(candidate.message && typeof candidate.message === 'object')
  return !candidate.ok && typeof candidate.errorCode === 'string' && typeof candidate.message === 'string'
}

export const parserWorkerEnvironmentKeys = Object.freeze(['ELECTRON_RUN_AS_NODE', 'NODE_ENV', 'LANG', 'TZ'])
