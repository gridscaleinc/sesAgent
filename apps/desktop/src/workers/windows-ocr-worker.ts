import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { createCanvas } from '@napi-rs/canvas'
import Tesseract from 'tesseract.js'
import {
  windowsOfflineOcrResultSchema,
  type WindowsOfflineOcrResult,
  type WindowsOfflineOcrWorkerRequest,
  type WindowsOfflineOcrWorkerResponse
} from '@local-ai'
import { installParserNetworkDenyGuard } from './network-deny'

installParserNetworkDenyGuard()

const maximumPages = 50
const maximumRenderedDimension = 3_500
const maximumTotalPixels = 80_000_000

interface OcrResourceManifest {
  version: 'windows-offline-ocr-resources-v1'
  engine: 'windows-tesseract-wasm'
  networkAccess: false
  languages: ['jpn', 'eng']
  files: Array<{ language: string; path: string; bytes: number; sha256: string }>
}

function requiredEnvironmentPath(name: string): string {
  const value = process.env[name]?.trim()
  if (!value) throw new Error(`Missing local OCR resource path: ${name}`)
  return resolve(value)
}

async function verifyResources(tessdataPath: string, manifestPath: string): Promise<OcrResourceManifest> {
  const parsed = JSON.parse(await readFile(manifestPath, 'utf8')) as Partial<OcrResourceManifest>
  if (
    parsed.version !== 'windows-offline-ocr-resources-v1' ||
    parsed.engine !== 'windows-tesseract-wasm' ||
    parsed.networkAccess !== false ||
    JSON.stringify(parsed.languages) !== JSON.stringify(['jpn', 'eng']) ||
    !Array.isArray(parsed.files) || parsed.files.length !== 2
  ) throw new Error('Windows offline OCR resource manifest is invalid.')
  for (const file of parsed.files) {
    if (
      !file ||
      !['jpn', 'eng'].includes(file.language) ||
      !Number.isInteger(file.bytes) || file.bytes <= 0 ||
      !/^[a-f0-9]{64}$/u.test(file.sha256)
    ) throw new Error('Windows offline OCR resource manifest contains an invalid file entry.')
    const bytes = await readFile(resolve(tessdataPath, `${file.language}.traineddata.gz`))
    const hash = createHash('sha256').update(bytes).digest('hex')
    if (bytes.length !== file.bytes || hash !== file.sha256) {
      throw new Error(`Windows offline OCR resource failed integrity verification: ${file.language}`)
    }
  }
  return parsed as OcrResourceManifest
}

function normalizedBox(
  box: { x0: number; y0: number; x1: number; y1: number },
  width: number,
  height: number
): { x: number; y: number; width: number; height: number } {
  const clamp = (value: number): number => Math.max(0, Math.min(1, value))
  const x0 = clamp(box.x0 / width)
  const y0 = clamp(box.y0 / height)
  const x1 = clamp(box.x1 / width)
  const y1 = clamp(box.y1 / height)
  return { x: x0, y: y0, width: Math.max(0, x1 - x0), height: Math.max(0, y1 - y0) }
}

async function recognizePdf(bytes: Buffer): Promise<WindowsOfflineOcrResult> {
  if (bytes.length === 0 || bytes.length > 25 * 1024 * 1024) throw new Error('OCR_INPUT_LIMIT')
  const tessdataPath = requiredEnvironmentPath('SES_WINDOWS_OCR_TESSDATA_PATH')
  const manifestPath = requiredEnvironmentPath('SES_WINDOWS_OCR_MANIFEST_PATH')
  const tesseractWorkerPath = requiredEnvironmentPath('SES_TESSERACT_WORKER_PATH')
  await verifyResources(tessdataPath, manifestPath)

  const { getDocument } = await import('pdfjs-dist/legacy/build/pdf.mjs')
  const loadingTask = getDocument({
    data: new Uint8Array(bytes),
    useSystemFonts: false,
    disableFontFace: true,
    disableAutoFetch: true,
    disableStream: true,
    isImageDecoderSupported: false,
    useWasm: false
  })
  let worker: Awaited<ReturnType<typeof Tesseract.createWorker>> | null = null
  try {
    const document = await loadingTask.promise
    if (document.numPages < 1 || document.numPages > maximumPages) throw new Error('OCR_PAGE_LIMIT')
    worker = await Tesseract.createWorker(['jpn', 'eng'], Tesseract.OEM.LSTM_ONLY, {
      langPath: tessdataPath,
      workerPath: tesseractWorkerPath,
      cacheMethod: 'none',
      gzip: true,
      legacyCore: false,
      legacyLang: false
    })
    await worker.setParameters({
      tessedit_pageseg_mode: Tesseract.PSM.AUTO,
      preserve_interword_spaces: '1',
      user_defined_dpi: '144'
    })

    const pages: WindowsOfflineOcrResult['pages'] = []
    let totalPixels = 0
    for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber += 1) {
      const page = await document.getPage(pageNumber)
      const baseViewport = page.getViewport({ scale: 2 })
      const reduction = Math.min(1, maximumRenderedDimension / Math.max(baseViewport.width, baseViewport.height))
      const viewport = page.getViewport({ scale: 2 * reduction })
      const width = Math.max(1, Math.ceil(viewport.width))
      const height = Math.max(1, Math.ceil(viewport.height))
      totalPixels += width * height
      if (totalPixels > maximumTotalPixels) throw new Error('OCR_PIXEL_LIMIT')
      const canvas = createCanvas(width, height)
      const context = canvas.getContext('2d')
      await page.render({ canvas: canvas as never, canvasContext: context as never, viewport }).promise
      const png = canvas.toBuffer('image/png')
      const recognition = await worker.recognize(
        png,
        { rotateAuto: true },
        { text: true, blocks: true }
      )
      const textBlocks = (recognition.data.blocks ?? []).flatMap((block) =>
        block.paragraphs.flatMap((paragraph) => paragraph.lines)
      ).map((line) => ({
        text: line.text.normalize('NFKC').trim(),
        confidence: Math.max(0, Math.min(1, line.confidence / 100)),
        boundingBox: normalizedBox(line.bbox, width, height)
      })).filter((line) => line.text.length > 0)
      if (textBlocks.length === 0 && recognition.data.text?.trim()) {
        textBlocks.push({
          text: recognition.data.text.normalize('NFKC').trim(),
          confidence: Math.max(0, Math.min(1, recognition.data.confidence / 100)),
          boundingBox: { x: 0, y: 0, width: 1, height: 1 }
        })
      }
      pages.push({ page: pageNumber, width, height, textBlocks, faceRegions: [], barcodeRegions: [] })
      page.cleanup()
    }
    return windowsOfflineOcrResultSchema.parse({
      version: 'windows-ocr-v2',
      engine: 'windows-tesseract-wasm',
      networkAccess: false,
      pages,
      warnings: [
        'FACE_DETECTION_REQUIRES_HUMAN_REVIEW',
        'QR_CODE_DETECTION_REQUIRES_HUMAN_REVIEW'
      ],
      coverage: {
        textRecognition: 'tesseract-wasm-7.0.0-jpn-eng',
        faceDetection: 'human-review-required',
        qrCodeDetection: 'human-review-required',
        signatureDetection: 'human-review-required'
      }
    })
  } finally {
    await worker?.terminate().catch(() => undefined)
    await loadingTask.destroy()
  }
}

function isRequest(value: unknown): value is WindowsOfflineOcrWorkerRequest {
  if (!value || typeof value !== 'object') return false
  const request = value as Partial<WindowsOfflineOcrWorkerRequest>
  return typeof request.id === 'string' && request.kind === 'ocr-pdf' && Buffer.isBuffer(request.bytes)
}

async function respond(request: WindowsOfflineOcrWorkerRequest): Promise<void> {
  let response: WindowsOfflineOcrWorkerResponse
  try {
    response = { id: request.id, kind: request.kind, ok: true, result: await recognizePdf(request.bytes) }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'WINDOWS_OFFLINE_OCR_FAILED'
    response = { id: request.id, kind: request.kind, ok: false, errorCode: message, message }
  } finally {
    request.bytes.fill(0)
  }
  process.send?.(response, () => process.disconnect())
}

async function runStdio(): Promise<void> {
  const chunks: Buffer[] = []
  let total = 0
  for await (const rawChunk of process.stdin) {
    const chunk = Buffer.isBuffer(rawChunk) ? rawChunk : Buffer.from(rawChunk)
    total += chunk.length
    if (total > 25 * 1024 * 1024) throw new Error('OCR_INPUT_LIMIT')
    chunks.push(chunk)
  }
  const bytes = Buffer.concat(chunks)
  try {
    const result = await recognizePdf(bytes)
    process.stdout.write(`${JSON.stringify(result)}\n`)
  } finally {
    bytes.fill(0)
    for (const chunk of chunks) chunk.fill(0)
  }
}

if (process.argv.includes('--stdio')) {
  void runStdio().catch((error) => {
    const errorCode = error instanceof Error ? error.message : 'WINDOWS_OFFLINE_OCR_FAILED'
    process.stdout.write(`${JSON.stringify({ errorCode })}\n`)
    process.exitCode = 1
  })
} else {
  process.once('message', (rawRequest: unknown) => {
    if (!isRequest(rawRequest)) {
      process.send?.({
        id: 'invalid',
        kind: 'invalid',
        ok: false,
        errorCode: 'INVALID_REQUEST',
        message: 'Invalid Windows OCR worker request.'
      } satisfies WindowsOfflineOcrWorkerResponse, () => process.disconnect())
      return
    }
    void respond(rawRequest)
  })
}
