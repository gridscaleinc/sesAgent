import { spawn } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { isAbsolute, win32 } from 'node:path'
import { z } from 'zod'
import { documentIrSchema, type DocumentBlock, type DocumentIR, type DocumentWarning } from '@parsers'

const boundingBoxSchema = z.object({
  x: z.number().min(0).max(1),
  y: z.number().min(0).max(1),
  width: z.number().min(0).max(1),
  height: z.number().min(0).max(1)
})

const localOcrResultShape = {
  networkAccess: z.literal(false),
  pages: z.array(
    z.object({
      page: z.number().int().positive(),
      width: z.number().positive(),
      height: z.number().positive(),
      textBlocks: z.array(
        z.object({
          text: z.string(),
          confidence: z.number().min(0).max(1),
          boundingBox: boundingBoxSchema
        })
      ),
      faceRegions: z.array(boundingBoxSchema),
      barcodeRegions: z.array(
        z.object({
          payload: z.string().nullable(),
          symbology: z.string(),
          boundingBox: boundingBoxSchema
        })
      )
    })
  ),
  warnings: z.array(z.string()),
  coverage: z.object({
    textRecognition: z.string(),
    faceDetection: z.string(),
    qrCodeDetection: z.string(),
    signatureDetection: z.literal('human-review-required')
  })
}

export const visionOcrResultSchema = z.object({
  version: z.literal('vision-ocr-v1'),
  engine: z.literal('apple-vision'),
  ...localOcrResultShape
})

export const windowsOcrResultSchema = z.object({
  version: z.literal('windows-ocr-v1'),
  engine: z.literal('windows-media-ocr'),
  ...localOcrResultShape
})

export const windowsOfflineOcrResultSchema = z.object({
  version: z.literal('windows-ocr-v2'),
  engine: z.literal('windows-tesseract-wasm'),
  ...localOcrResultShape
})

export const localOcrResultSchema = z.discriminatedUnion('engine', [
  visionOcrResultSchema,
  windowsOcrResultSchema,
  windowsOfflineOcrResultSchema
])

export type VisionOcrResult = z.infer<typeof visionOcrResultSchema>
export type WindowsOcrResult = z.infer<typeof windowsOcrResultSchema>
export type WindowsOfflineOcrResult = z.infer<typeof windowsOfflineOcrResultSchema>
export type LocalOcrResult = z.infer<typeof localOcrResultSchema>

export function parseLocalHelperJson(raw: string): unknown {
  const frames = raw
    .split(/\r?\n/u)
    .map((frame) => frame.trim())
    .filter(Boolean)
  if (frames.length === 0) throw new SyntaxError('Local helper returned an empty response.')
  if (frames.length > 1) {
    if (frames.length !== 2 || frames[0] !== frames[1]) {
      throw new SyntaxError('Local helper returned multiple non-identical response frames.')
    }
  }
  return JSON.parse(frames[0] ?? '')
}

export interface LocalOcrPort {
  readonly engine: 'apple-vision' | 'windows-media-ocr' | 'windows-tesseract-wasm'
  ocrPdf(bytes: Buffer): Promise<LocalOcrResult>
}

export const nameDetectionResultSchema = z.object({
  version: z.literal('apple-nl-ner-v1'),
  engine: z.literal('apple-natural-language'),
  networkAccess: z.literal(false),
  requiresHumanConfirmation: z.literal(true),
  entities: z.array(
    z.object({
      text: z.string().min(2).max(120),
      startUtf16: z.number().int().nonnegative(),
      endUtf16: z.number().int().positive(),
      tag: z.literal('personalName')
    })
  )
})

export type NameDetectionResult = z.infer<typeof nameDetectionResultSchema>

export interface LocalPersonNameDetectorPort {
  readonly engine: 'apple-natural-language' | 'windows-local-ner'
  detectNames(text: string): Promise<NameDetectionResult>
}

export interface LocalAiRuntime {
  platform: NodeJS.Platform
  ocr: LocalOcrPort | null
  personNameDetector: LocalPersonNameDetectorPort | null
  status: 'vision-ocr-and-pii-active' | 'windows-ocr-and-pii-rules-active' | 'windows-ocr-bundled-isolation-pending' | 'pii-rules-active-ocr-unavailable'
}

export interface MacVisionOcrClientOptions {
  executablePath: string
  timeoutMs?: number
  maxOutputBytes?: number
}

const macOcrSandboxProfile = '(version 1) (allow default) (deny network*)'

export class MacVisionOcrClient implements LocalOcrPort {
  readonly engine = 'apple-vision' as const
  private readonly timeoutMs: number
  private readonly maxOutputBytes: number

  constructor(private readonly options: MacVisionOcrClientOptions) {
    this.timeoutMs = options.timeoutMs ?? 60_000
    this.maxOutputBytes = options.maxOutputBytes ?? 10 * 1024 * 1024
  }

  ocrPdf(bytes: Buffer): Promise<VisionOcrResult> {
    if (process.platform !== 'darwin') return Promise.reject(new Error('Apple Vision OCR is only available on macOS.'))
    if (bytes.length === 0 || bytes.length > 25 * 1024 * 1024) {
      return Promise.reject(new Error('The OCR input violates the local 25 MB limit.'))
    }

    return new Promise((resolve, reject) => {
      const child = spawn(
        '/usr/bin/sandbox-exec',
        ['-p', macOcrSandboxProfile, this.options.executablePath, '--pdf'],
        {
          env: {
            LANG: process.env.LANG ?? 'ja_JP.UTF-8',
            TZ: process.env.TZ ?? 'Asia/Tokyo'
          },
          stdio: ['pipe', 'pipe', 'ignore']
        }
      )
      const output: Buffer[] = []
      let outputBytes = 0
      let settled = false
      const finish = (operation: () => void): void => {
        if (settled) return
        settled = true
        clearTimeout(timeout)
        if (child.exitCode === null && !child.killed) child.kill('SIGTERM')
        operation()
      }
      const timeout = setTimeout(
        () => finish(() => reject(new Error('Apple Vision OCR exceeded its local execution time limit.'))),
        this.timeoutMs
      )

      child.once('error', (error) => finish(() => reject(new Error('Apple Vision OCR could not start.', { cause: error }))))
      child.stdout.on('data', (chunk: Buffer) => {
        outputBytes += chunk.length
        if (outputBytes > this.maxOutputBytes) {
          finish(() => reject(new Error('Apple Vision OCR output exceeded its size limit.')))
          return
        }
        output.push(chunk)
      })
      child.once('close', (code) => {
        if (settled) return
        const raw = Buffer.concat(output).toString('utf8').trim()
        if (code !== 0) {
          finish(() => reject(new Error(`Apple Vision OCR rejected the document (${safeOcrErrorCode(raw)}).`)))
          return
        }
        let parsed: unknown
        try {
          parsed = parseLocalHelperJson(raw)
        } catch (error) {
          finish(() => reject(new Error('Apple Vision OCR returned invalid JSON.', { cause: error })))
          return
        }
        const result = visionOcrResultSchema.safeParse(parsed)
        if (!result.success) {
          finish(() => reject(new Error('Apple Vision OCR output violates its schema.')))
          return
        }
        finish(() => resolve(result.data))
      })
      child.stdin.once('error', (error) => finish(() => reject(new Error('OCR input could not be delivered.', { cause: error }))))
      child.stdin.end(bytes)
    })
  }
}

export class MacNaturalLanguageNerClient implements LocalPersonNameDetectorPort {
  readonly engine = 'apple-natural-language' as const
  constructor(private readonly executablePath: string) {}

  detectNames(text: string): Promise<NameDetectionResult> {
    if (process.platform !== 'darwin') return Promise.reject(new Error('Apple NaturalLanguage NER is only available on macOS.'))
    const input = Buffer.from(text, 'utf8')
    if (input.length === 0 || input.length > 2 * 1024 * 1024) {
      return Promise.reject(new Error('The local NER input violates its 2 MB limit.'))
    }
    return new Promise((resolve, reject) => {
      const child = spawn('/usr/bin/sandbox-exec', ['-p', macOcrSandboxProfile, this.executablePath, '--detect-names'], {
        env: { LANG: process.env.LANG ?? 'ja_JP.UTF-8', TZ: process.env.TZ ?? 'Asia/Tokyo' },
        stdio: ['pipe', 'pipe', 'ignore']
      })
      const chunks: Buffer[] = []
      let total = 0
      let settled = false
      const finish = (operation: () => void): void => {
        if (settled) return
        settled = true
        clearTimeout(timeout)
        if (child.exitCode === null && !child.killed) child.kill('SIGTERM')
        operation()
      }
      const timeout = setTimeout(
        () => finish(() => reject(new Error('Apple NaturalLanguage NER exceeded its execution time limit.'))),
        15_000
      )
      child.once('error', (error) =>
        finish(() => reject(new Error('Apple NaturalLanguage NER could not start.', { cause: error })))
      )
      child.stdout.on('data', (chunk: Buffer) => {
        total += chunk.length
        if (total > 2 * 1024 * 1024) {
          finish(() => reject(new Error('Apple NaturalLanguage NER output exceeded its size limit.')))
        }
        else chunks.push(chunk)
      })
      child.once('close', (code) => {
        if (settled) return
        if (code !== 0) {
          finish(() => reject(new Error('Apple NaturalLanguage NER rejected the content.')))
          return
        }
        try {
          const result = nameDetectionResultSchema.parse(parseLocalHelperJson(Buffer.concat(chunks).toString('utf8')))
          finish(() => resolve(result))
        } catch (error) {
          finish(() => reject(new Error('Apple NaturalLanguage NER output violates its schema.', { cause: error })))
        }
      })
      child.stdin.once('error', (error) =>
        finish(() => reject(new Error('NER input could not be delivered.', { cause: error })))
      )
      child.stdin.end(input)
    })
  }
}

export interface WindowsOfflineOcrWorkerRequest {
  id: string
  kind: 'ocr-pdf'
  bytes: Buffer
}

export type WindowsOfflineOcrWorkerResponse =
  | { id: string; kind: 'ocr-pdf'; ok: true; result: WindowsOfflineOcrResult }
  | { id: string; kind: 'ocr-pdf' | 'invalid'; ok: false; errorCode: string; message: string }

export interface WindowsOfflineOcrWorkerClientOptions {
  sandboxLauncherPath: string
  workerPath: string
  tesseractWorkerPath: string
  tessdataPath: string
  resourceManifestPath: string
  appContainerGrantRoots: string[]
  networkIsolation: 'windows-kernel-network-verified'
  timeoutMs?: number
  maxOutputBytes?: number
}

function isAbsoluteWorkerPath(path: string): boolean {
  return isAbsolute(path) || win32.isAbsolute(path)
}

export class WindowsOfflineOcrWorkerClient implements LocalOcrPort {
  readonly engine = 'windows-tesseract-wasm' as const
  private readonly timeoutMs: number
  private readonly maxOutputBytes: number

  constructor(private readonly options: WindowsOfflineOcrWorkerClientOptions) {
    if (
      !isAbsoluteWorkerPath(options.sandboxLauncherPath) ||
      !isAbsoluteWorkerPath(options.workerPath) ||
      !isAbsoluteWorkerPath(options.tesseractWorkerPath) ||
      !isAbsoluteWorkerPath(options.tessdataPath) ||
      !isAbsoluteWorkerPath(options.resourceManifestPath) ||
      options.appContainerGrantRoots.length === 0 ||
      options.appContainerGrantRoots.some((root) => !isAbsoluteWorkerPath(root))
    ) throw new Error('Windows OCR worker, resource, and sandbox paths must be absolute.')
    this.timeoutMs = options.timeoutMs ?? 120_000
    this.maxOutputBytes = options.maxOutputBytes ?? 10 * 1024 * 1024
  }

  ocrPdf(bytes: Buffer): Promise<WindowsOfflineOcrResult> {
    if (process.platform !== 'win32') return Promise.reject(new Error('Windows offline OCR is only available on Windows.'))
    if (this.options.networkIsolation !== 'windows-kernel-network-verified') {
      return Promise.reject(new Error('Windows OCR network isolation is not verified.'))
    }
    if (bytes.length === 0 || bytes.length > 25 * 1024 * 1024) {
      return Promise.reject(new Error('The OCR input violates the local 25 MB limit.'))
    }
    const request: WindowsOfflineOcrWorkerRequest = { id: randomUUID(), kind: 'ocr-pdf', bytes }
    return new Promise<WindowsOfflineOcrResult>((resolve, reject) => {
      const child = spawn(this.options.sandboxLauncherPath, [
        '--profile',
        'jp.sesai.agentdesktop.ocr',
        ...this.options.appContainerGrantRoots.flatMap((root) => ['--grant-read', root]),
        '--',
        process.execPath,
        this.options.workerPath,
        '--stdio'
      ], {
        cwd: this.options.appContainerGrantRoots[0] ?? process.cwd(),
        env: {
          ELECTRON_RUN_AS_NODE: '1',
          NODE_ENV: 'production',
          SystemRoot: process.env.SystemRoot,
          WINDIR: process.env.WINDIR,
          ComSpec: process.env.ComSpec,
          PATHEXT: process.env.PATHEXT,
          PROCESSOR_ARCHITECTURE: process.env.PROCESSOR_ARCHITECTURE,
          LANG: process.env.LANG ?? 'ja_JP.UTF-8',
          TZ: process.env.TZ ?? 'Asia/Tokyo',
          SES_WINDOWS_OCR_TESSDATA_PATH: this.options.tessdataPath,
          SES_WINDOWS_OCR_MANIFEST_PATH: this.options.resourceManifestPath,
          SES_TESSERACT_WORKER_PATH: this.options.tesseractWorkerPath
        },
        shell: false,
        stdio: ['pipe', 'pipe', 'pipe'],
        windowsHide: true
      })
      const output: Buffer[] = []
      const errors: Buffer[] = []
      let outputBytes = 0
      let settled = false
      const finish = (operation: () => void): void => {
        if (settled) return
        settled = true
        clearTimeout(timeout)
        if (child.exitCode === null && !child.killed) child.kill('SIGTERM')
        operation()
      }
      const timeout = setTimeout(
        () => finish(() => reject(new Error('Windows OCR exceeded its local execution time limit.'))),
        this.timeoutMs
      )
      child.once('error', (error) => finish(() => reject(new Error('Windows OCR sandbox could not start.', { cause: error }))))
      child.stdout.on('data', (chunk: Buffer) => {
        outputBytes += chunk.length
        if (outputBytes > this.maxOutputBytes) {
          finish(() => reject(new Error('Windows OCR output exceeded its size limit.')))
          return
        }
        output.push(chunk)
      })
      child.stderr.on('data', (chunk: Buffer) => {
        if (Buffer.concat(errors).length < 64 * 1024) errors.push(chunk)
      })
      child.once('close', (code, signal) => {
        if (settled) return
        const raw = Buffer.concat(output).toString('utf8').trim()
        if (code !== 0) {
          const errorCode = safeOcrErrorCode(raw) === 'UNKNOWN'
            ? safeOcrErrorCode(Buffer.concat(errors).toString('utf8'))
            : safeOcrErrorCode(raw)
          finish(() => reject(new Error(`Windows OCR rejected the document (${errorCode || code || signal || 'UNKNOWN'}).`)))
          return
        }
        let parsed: unknown
        try {
          parsed = parseLocalHelperJson(raw)
        } catch (error) {
          finish(() => reject(new Error('Windows OCR worker returned invalid JSON.', { cause: error })))
          return
        }
        const result = windowsOfflineOcrResultSchema.safeParse(parsed)
        if (!result.success) {
          finish(() => reject(new Error('Windows OCR output violates its schema.')))
          return
        }
        finish(() => resolve(result.data))
      })
      child.stdin.once('error', (error) => finish(() => reject(new Error('OCR input could not be delivered.', { cause: error }))))
      child.stdin.end(request.bytes)
    })
  }
}

export function isWindowsOfflineOcrWorkerResponse(value: unknown): value is WindowsOfflineOcrWorkerResponse {
  if (!value || typeof value !== 'object') return false
  const candidate = value as Record<string, unknown>
  if (typeof candidate.id !== 'string' || typeof candidate.ok !== 'boolean') return false
  if (candidate.ok) {
    return candidate.kind === 'ocr-pdf' && Boolean(candidate.result && typeof candidate.result === 'object')
  }
  return ['ocr-pdf', 'invalid'].includes(String(candidate.kind)) &&
    typeof candidate.errorCode === 'string' && typeof candidate.message === 'string'
}

export function createLocalAiRuntime(options: {
  platform?: NodeJS.Platform
  macExecutablePath?: string
  windowsOcrSandboxLauncherPath?: string
  windowsOcrWorkerPath?: string
  windowsTesseractWorkerPath?: string
  windowsTessdataPath?: string
  windowsOcrResourceManifestPath?: string
  windowsAppContainerGrantRoots?: string[]
  windowsNetworkIsolation?: 'windows-kernel-network-verified'
}): LocalAiRuntime {
  const platform = options.platform ?? process.platform
  if (platform === 'darwin' && options.macExecutablePath) {
    return {
      platform,
      ocr: new MacVisionOcrClient({ executablePath: options.macExecutablePath }),
      personNameDetector: new MacNaturalLanguageNerClient(options.macExecutablePath),
      status: 'vision-ocr-and-pii-active'
    }
  }
  if (
    platform === 'win32' &&
    options.windowsOcrSandboxLauncherPath &&
    options.windowsOcrWorkerPath &&
    options.windowsTesseractWorkerPath &&
    options.windowsTessdataPath &&
    options.windowsOcrResourceManifestPath &&
    options.windowsAppContainerGrantRoots?.length &&
    options.windowsNetworkIsolation === 'windows-kernel-network-verified'
  ) {
    return {
      platform,
      ocr: new WindowsOfflineOcrWorkerClient({
        sandboxLauncherPath: options.windowsOcrSandboxLauncherPath,
        workerPath: options.windowsOcrWorkerPath,
        tesseractWorkerPath: options.windowsTesseractWorkerPath,
        tessdataPath: options.windowsTessdataPath,
        resourceManifestPath: options.windowsOcrResourceManifestPath,
        appContainerGrantRoots: options.windowsAppContainerGrantRoots,
        networkIsolation: options.windowsNetworkIsolation
      }),
      personNameDetector: null,
      status: 'windows-ocr-and-pii-rules-active'
    }
  }
  if (
    platform === 'win32' &&
    options.windowsOcrSandboxLauncherPath &&
    options.windowsOcrWorkerPath &&
    options.windowsTesseractWorkerPath &&
    options.windowsTessdataPath &&
    options.windowsOcrResourceManifestPath
  ) {
    return {
      platform,
      ocr: null,
      personNameDetector: null,
      status: 'windows-ocr-bundled-isolation-pending'
    }
  }
  return {
    platform,
    ocr: null,
    personNameDetector: null,
    status: 'pii-rules-active-ocr-unavailable'
  }
}

function cleanNameCandidate(value: string): string | null {
  const cleaned = value
    .replace(/(?:さん|様|氏)$/u, '')
    .replaceAll(/[\t　 ]+/gu, ' ')
    .trim()
  if (cleaned.length < 2 || cleaned.length > 40) return null
  if (/[\d<>@/\\・,，;；:：|｜]/u.test(cleaned)) return null
  return cleaned
}

const personNameStopwords = new Set([
  '案件', '概要', '必須', 'スキル', '経験', '開発', '設計', '担当', '業務', '職務', '経歴',
  '期間', '単価', '勤務地', '勤務', '役割', '要件', '技術', '工程', '内容', '詳細', '募集', '候補者'
])

function looksLikeStructuredPersonName(value: string): boolean {
  const parts = value.split(' ').filter(Boolean)
  if (parts.some((part) => personNameStopwords.has(part))) return false
  if (parts.length === 2) {
    return parts.every((part) => /^[一-龯々ぁ-んァ-ヶA-Za-z-]{1,20}$/u.test(part))
  }
  if (parts.length !== 1) return false
  return /^[一-龯々]{2,8}$/u.test(value)
}

export function collectLocalPersonNameCandidates(text: string, appleResult?: NameDetectionResult): string[] {
  const candidates = new Set<string>()
  for (const entity of appleResult?.entities ?? []) {
    const cleaned = cleanNameCandidate(entity.text)
    if (cleaned) candidates.add(cleaned)
  }

  const labeledName = /(?:氏名|姓名|候補者名|お名前|担当者?|営業担当|ご担当|窓口|Name|Candidate)\s*[:：]\s*([^\r\n]{2,40})/giu
  for (const match of text.matchAll(labeledName)) {
    const cleaned = cleanNameCandidate(match[1] ?? '')
    if (cleaned && looksLikeStructuredPersonName(cleaned)) candidates.add(cleaned)
  }
  const spreadsheetRows = new Map<string, Array<{ column: number; value: string }>>()
  for (const line of text.split(/\r?\n/u)) {
    const match = line.match(/^\[SHEET:(.+)!([A-Z]{1,3})([1-9]\d*)\]\s*(.*?)\s*$/u)
    if (!match?.[1] || !match[2] || !match[3]) continue
    const column = [...match[2]].reduce((value, character) => value * 26 + character.charCodeAt(0) - 64, 0)
    const key = `${match[1]}\u0000${match[3]}`
    const row = spreadsheetRows.get(key) ?? []
    row.push({ column, value: match[4] ?? '' })
    spreadsheetRows.set(key, row)
  }
  for (const row of spreadsheetRows.values()) {
    const sorted = row.toSorted((left, right) => left.column - right.column)
    const labelIndex = sorted.findIndex((cell) => /^(?:氏名|姓名|候補者名|お名前)$/u.test(cell.value.normalize('NFKC').trim()))
    if (labelIndex < 0) continue
    const value = sorted.slice(labelIndex + 1).find((cell) => {
      const cleaned = cleanNameCandidate(cell.value)
      return Boolean(cleaned && looksLikeStructuredPersonName(cleaned))
    })
    const cleaned = value ? cleanNameCandidate(value.value) : null
    if (cleaned) candidates.add(cleaned)
  }
  const spacedJapaneseName = /(?:^|[\r\n])[\t ]*([一-龯々]{1,4})[\t　 ]+([一-龯々ぁ-んァ-ヶ]{1,5})(?:さん|様|氏)?[\t ]*(?=$|[\r\n])/gmu
  for (const match of text.matchAll(spacedJapaneseName)) {
    const cleaned = cleanNameCandidate(`${match[1] ?? ''} ${match[2] ?? ''}`)
    if (cleaned && looksLikeStructuredPersonName(cleaned)) candidates.add(cleaned)
  }
  const honorificName = /([一-龯々]{2,8})(?:さん|様|氏)(?![一-龯々])/gu
  for (const match of text.matchAll(honorificName)) {
    const cleaned = cleanNameCandidate(match[1] ?? '')
    if (cleaned && !personNameStopwords.has(cleaned)) candidates.add(cleaned)
  }
  return [...candidates]
}

function safeOcrErrorCode(raw: string): string {
  try {
    const parsed = JSON.parse(raw) as { errorCode?: unknown }
    return typeof parsed.errorCode === 'string' ? parsed.errorCode : 'UNKNOWN'
  } catch {
    return 'UNKNOWN'
  }
}

export function mergeLocalOcr(document: DocumentIR, ocr: LocalOcrResult): DocumentIR {
  const pagesRequiringOcr = new Set(
    document.warnings
      .filter((warning) => warning.code === 'PAGE_REQUIRES_OCR' && warning.source?.page)
      .map((warning) => warning.source?.page as number)
  )
  const ocrBlocks: DocumentBlock[] = []
  const newWarnings: DocumentWarning[] = []
  let faceRegionCount = 0
  let barcodeRegionCount = 0

  for (const page of ocr.pages) {
    if (!pagesRequiringOcr.has(page.page)) continue
    for (const [index, block] of page.textBlocks.entries()) {
      const box = block.boundingBox
      ocrBlocks.push({
        id: `page-${page.page}-ocr-${index + 1}`,
        kind: 'text',
        text: block.text,
        source: {
          page: page.page,
          boundingBox: [
            box.x * page.width,
            box.y * page.height,
            (box.x + box.width) * page.width,
            (box.y + box.height) * page.height
          ]
        }
      })
      if (block.confidence < 0.45) {
        newWarnings.push({
          code: 'OCR_LOW_CONFIDENCE',
          message: 'Local OCR returned a low-confidence text block.',
          source: { page: page.page }
        })
      }
    }
    faceRegionCount += page.faceRegions.length
    barcodeRegionCount += page.barcodeRegions.length
    if (page.faceRegions.length > 0) {
      newWarnings.push({
        code: 'FACE_REGION_DETECTED',
        message: 'A face or portrait region requires local redaction.',
        source: { page: page.page }
      })
    }
    if (page.barcodeRegions.length > 0) {
      newWarnings.push({
        code: 'BARCODE_REGION_DETECTED',
        message: 'A barcode or QR region requires local review.',
        source: { page: page.page }
      })
    }
  }
  newWarnings.push({
    code: 'SIGNATURE_REVIEW_REQUIRED',
    message: 'Signature detection is not automatic and requires human review.'
  })

  const pagesWithOcrText = new Set(ocrBlocks.map((block) => block.source.page).filter(Boolean))
  const remainingWarnings = document.warnings.filter(
    (warning) => warning.code !== 'PAGE_REQUIRES_OCR' || !warning.source?.page || !pagesWithOcrText.has(warning.source.page)
  )
  const blocks = [...document.blocks, ...ocrBlocks].toSorted((a, b) => {
    const pageDifference = (a.source.page ?? 0) - (b.source.page ?? 0)
    if (pageDifference !== 0) return pageDifference
    return (b.source.boundingBox?.[1] ?? 0) - (a.source.boundingBox?.[1] ?? 0)
  })
  const merged: DocumentIR = {
    ...document,
    blocks,
    warnings: [...remainingWarnings, ...newWarnings],
    requiresLocalOcr: remainingWarnings.some((warning) => warning.code === 'PAGE_REQUIRES_OCR'),
    statistics: {
      ...document.statistics,
      blocks: blocks.length,
      characters: blocks.reduce((total, block) => total + block.text.length, 0)
    },
    ocr: {
      engine: ocr.engine,
      processedPages: pagesRequiringOcr.size,
      faceRegions: faceRegionCount,
      barcodeRegions: barcodeRegionCount,
      signatureReviewRequired: true
    }
  }
  return documentIrSchema.parse(merged)
}

export function mergeVisionOcr(document: DocumentIR, ocr: VisionOcrResult): DocumentIR {
  return mergeLocalOcr(document, ocr)
}
