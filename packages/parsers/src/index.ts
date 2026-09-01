import { createHash } from 'node:crypto'
import { z } from 'zod'
import { stagedLocalFileSchema } from '@shared'
import type { CandidateSourceFormat, StagedLocalFile } from '@shared/contracts'
import type { EmlFileManifest, ParsedEmlMessage, EmlParserError } from '@mail'

export const documentIrVersion = 'document-ir-v1' as const

export type DocumentBlockKind = 'text' | 'cell'

export interface DocumentSourceReference {
  page?: number
  sheet?: string
  cell?: string
  mergedRange?: string
  printArea?: string
  inPrintArea?: boolean
  paragraph?: number
  boundingBox?: [number, number, number, number]
}

export interface DocumentBlock {
  id: string
  kind: DocumentBlockKind
  text: string
  source: DocumentSourceReference
}

export interface DocumentWarning {
  code:
    | 'PAGE_REQUIRES_OCR'
    | 'FORMULA_IGNORED'
    | 'EXTERNAL_LINK_DISCARDED'
    | 'PARSER_MESSAGE'
    | 'HIDDEN_SHEET_INCLUDED'
    | 'OCR_LOW_CONFIDENCE'
    | 'FACE_REGION_DETECTED'
    | 'BARCODE_REGION_DETECTED'
    | 'SIGNATURE_REVIEW_REQUIRED'
    | 'LOCAL_OCR_FAILED'
  message: string
  source?: DocumentSourceReference
}

export interface DocumentIR {
  version: typeof documentIrVersion
  documentId: string
  source: {
    name: string
    format: CandidateSourceFormat
    sha256: string
    size: number
  }
  blocks: DocumentBlock[]
  warnings: DocumentWarning[]
  requiresLocalOcr: boolean
  statistics: {
    pages: number
    sheets: number
    blocks: number
    characters: number
  }
  security: {
    externalContentLoaded: false
    macrosExecuted: false
    rawFileCloudEligible: false
  }
  ocr?: {
    engine: 'apple-vision' | 'windows-media-ocr' | 'windows-tesseract-wasm'
    processedPages: number
    faceRegions: number
    barcodeRegions: number
    signatureReviewRequired: true
  }
}

const documentSourceReferenceSchema = z.object({
  page: z.number().int().positive().optional(),
  sheet: z.string().min(1).optional(),
  cell: z.string().min(1).optional(),
  mergedRange: z.string().min(1).optional(),
  printArea: z.string().min(1).optional(),
  inPrintArea: z.boolean().optional(),
  paragraph: z.number().int().positive().optional(),
  boundingBox: z.tuple([z.number(), z.number(), z.number(), z.number()]).optional()
})

export const documentIrSchema: z.ZodType<DocumentIR> = z.object({
  version: z.literal(documentIrVersion),
  documentId: z.string().uuid(),
  source: z.object({
    name: z.string().min(1).max(180),
    format: z.enum(['pdf', 'docx', 'xlsx', 'xls', 'xlsb', 'txt']),
    sha256: z.string().regex(/^[a-f0-9]{64}$/),
    size: z.number().int().positive().max(25 * 1024 * 1024)
  }),
  blocks: z.array(
    z.object({
      id: z.string().min(1),
      kind: z.enum(['text', 'cell']),
      text: z.string(),
      source: documentSourceReferenceSchema
    })
  ),
  warnings: z.array(
    z.object({
      code: z.enum([
        'PAGE_REQUIRES_OCR',
        'FORMULA_IGNORED',
        'EXTERNAL_LINK_DISCARDED',
        'PARSER_MESSAGE',
        'HIDDEN_SHEET_INCLUDED',
        'OCR_LOW_CONFIDENCE',
        'FACE_REGION_DETECTED',
        'BARCODE_REGION_DETECTED',
        'SIGNATURE_REVIEW_REQUIRED',
        'LOCAL_OCR_FAILED'
      ]),
      message: z.string(),
      source: documentSourceReferenceSchema.optional()
    })
  ),
  requiresLocalOcr: z.boolean(),
  statistics: z.object({
    pages: z.number().int().nonnegative(),
    sheets: z.number().int().nonnegative(),
    blocks: z.number().int().nonnegative(),
    characters: z.number().int().nonnegative()
  }),
  security: z.object({
    externalContentLoaded: z.literal(false),
    macrosExecuted: z.literal(false),
    rawFileCloudEligible: z.literal(false)
  }),
  ocr: z
    .object({
      engine: z.enum(['apple-vision', 'windows-media-ocr', 'windows-tesseract-wasm']),
      processedPages: z.number().int().nonnegative(),
      faceRegions: z.number().int().nonnegative(),
      barcodeRegions: z.number().int().nonnegative(),
      signatureReviewRequired: z.literal(true)
    })
    .optional()
})

export interface ParserLimits {
  maxPages: number
  maxSheets: number
  maxBlocks: number
  maxCharacters: number
  maxCells: number
}

export interface DocumentParserWorkerRequest {
  id: string
  kind: 'parse-document'
  file: StagedLocalFile
  bytes: Buffer
}

export interface EmlParserWorkerRequest {
  id: string
  kind: 'parse-eml'
  file: EmlFileManifest
  bytes: Buffer
}

export type ParserWorkerRequest = DocumentParserWorkerRequest | EmlParserWorkerRequest

export type ParserWorkerResponse =
  | { id: string; kind: 'parse-document'; ok: true; document: DocumentIR }
  | { id: string; kind: 'parse-eml'; ok: true; message: ParsedEmlMessage }
  | {
      id: string
      kind: ParserWorkerRequest['kind'] | 'invalid'
      ok: false
      errorCode: DocumentParserError['code'] | EmlParserError['code'] | 'INVALID_REQUEST'
      message: string
    }

export const defaultParserLimits: ParserLimits = {
  maxPages: 100,
  maxSheets: 50,
  maxBlocks: 20_000,
  maxCharacters: 2_000_000,
  maxCells: 200_000
}

export class DocumentParserError extends Error {
  constructor(
    readonly code: 'INVALID_MANIFEST' | 'HASH_MISMATCH' | 'LIMIT_EXCEEDED' | 'UNSUPPORTED_FORMAT' | 'PARSE_FAILED',
    message: string,
    options?: ErrorOptions
  ) {
    super(message, options)
    this.name = 'DocumentParserError'
  }
}

interface ParsedContent {
  blocks: DocumentBlock[]
  warnings: DocumentWarning[]
  pages: number
  sheets: number
  requiresLocalOcr: boolean
}

function enforceOutputLimits(content: ParsedContent, limits: ParserLimits): void {
  if (content.blocks.length > limits.maxBlocks) {
    throw new DocumentParserError('LIMIT_EXCEEDED', `Document contains more than ${limits.maxBlocks} blocks.`)
  }
  const characters = content.blocks.reduce((total, block) => total + block.text.length, 0)
  if (characters > limits.maxCharacters) {
    throw new DocumentParserError('LIMIT_EXCEEDED', `Document contains more than ${limits.maxCharacters} characters.`)
  }
}

async function parsePdf(bytes: Buffer, limits: ParserLimits): Promise<ParsedContent> {
  const { getDocument } = await import('pdfjs-dist/legacy/build/pdf.mjs')
  const loadingTask = getDocument({
    data: new Uint8Array(bytes),
    useSystemFonts: false,
    disableFontFace: true,
    disableAutoFetch: true,
    disableStream: true
  })
  try {
    const document = await loadingTask.promise
    if (document.numPages > limits.maxPages) {
      throw new DocumentParserError('LIMIT_EXCEEDED', `PDF contains more than ${limits.maxPages} pages.`)
    }

    const blocks: DocumentBlock[] = []
    const warnings: DocumentWarning[] = []
    let requiresLocalOcr = false
    for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber += 1) {
      const page = await document.getPage(pageNumber)
      const textContent = await page.getTextContent({ disableNormalization: false, includeMarkedContent: false })
      const lineItems = new Map<number, Array<{ text: string; x: number; y: number; width: number; height: number }>>()
      for (const rawItem of textContent.items) {
        if (!(typeof rawItem === 'object' && rawItem && 'str' in rawItem && 'transform' in rawItem)) continue
        const item = rawItem as { str: string; transform: number[]; width: number; height: number }
        const text = item.str.trim()
        if (!text) continue
        const x = Number(item.transform[4] ?? 0)
        const y = Number(item.transform[5] ?? 0)
        const lineKey = Math.round(y / 2) * 2
        const line = lineItems.get(lineKey) ?? []
        line.push({ text, x, y, width: Number(item.width || 0), height: Number(item.height || 0) })
        lineItems.set(lineKey, line)
      }

      if (lineItems.size === 0) {
        requiresLocalOcr = true
        warnings.push({
          code: 'PAGE_REQUIRES_OCR',
          message: 'This page has no reliable text layer and requires local OCR.',
          source: { page: pageNumber }
        })
      }

      const sortedLines = [...lineItems.entries()].toSorted(([a], [b]) => b - a)
      for (const [, items] of sortedLines) {
        const sortedItems = items.toSorted((a, b) => a.x - b.x)
        const text = sortedItems.map((item) => item.text).join(' ').trim()
        const minX = Math.min(...sortedItems.map((item) => item.x))
        const minY = Math.min(...sortedItems.map((item) => item.y))
        const maxX = Math.max(...sortedItems.map((item) => item.x + item.width))
        const maxY = Math.max(...sortedItems.map((item) => item.y + item.height))
        blocks.push({
          id: `page-${pageNumber}-line-${blocks.length + 1}`,
          kind: 'text',
          text,
          source: { page: pageNumber, boundingBox: [minX, minY, maxX, maxY] }
        })
      }

      const annotations = (await page.getAnnotations({ intent: 'display' })) as Array<Record<string, unknown>>
      if (annotations.some((annotation) => typeof annotation.url === 'string' || typeof annotation.unsafeUrl === 'string')) {
        warnings.push({
          code: 'EXTERNAL_LINK_DISCARDED',
          message: 'External PDF links were discarded and were not loaded.',
          source: { page: pageNumber }
        })
      }
      page.cleanup()
      enforceOutputLimits({ blocks, warnings, pages: document.numPages, sheets: 0, requiresLocalOcr }, limits)
    }
    return { blocks, warnings, pages: document.numPages, sheets: 0, requiresLocalOcr }
  } finally {
    await loadingTask.destroy()
  }
}

async function parseSpreadsheet(bytes: Buffer, limits: ParserLimits): Promise<ParsedContent> {
  const imported = await import('xlsx')
  const XLSX = imported
  const workbook = XLSX.read(bytes, {
    type: 'buffer',
    cellFormula: true,
    cellHTML: false,
    cellNF: false,
    cellStyles: false,
    bookFiles: false,
    bookVBA: false,
    WTF: false
  })
  if (workbook.SheetNames.length > limits.maxSheets) {
    throw new DocumentParserError('LIMIT_EXCEEDED', `Workbook contains more than ${limits.maxSheets} sheets.`)
  }

  const blocks: DocumentBlock[] = []
  const warnings: DocumentWarning[] = []
  let cellCount = 0
  for (const [sheetIndex, sheetName] of workbook.SheetNames.entries()) {
    const sheet = workbook.Sheets[sheetName]
    if (!sheet) continue
    const printArea = workbook.Workbook?.Names
      ?.find((name) => name.Name === '_xlnm.Print_Area' && name.Sheet === sheetIndex)
      ?.Ref.split('!').at(-1)?.replaceAll('$', '').split(',')[0]
    const printRange = printArea && /^[A-Z]{1,3}[1-9]\d*:[A-Z]{1,3}[1-9]\d*$/u.test(printArea)
      ? XLSX.utils.decode_range(printArea)
      : null
    const mergedRanges = sheet['!merges'] ?? []
    const visibility = workbook.Workbook?.Sheets?.[sheetIndex]?.Hidden
    if (visibility) {
      warnings.push({
        code: 'HIDDEN_SHEET_INCLUDED',
        message: 'A hidden sheet was included for local review.',
        source: { sheet: sheetName }
      })
    }
    const addresses = Object.keys(sheet)
      .filter((key) => !key.startsWith('!') && /^[A-Z]{1,3}[1-9]\d*$/u.test(key))
      .toSorted((a, b) => {
        const left = XLSX.utils.decode_cell(a)
        const right = XLSX.utils.decode_cell(b)
        return left.r - right.r || left.c - right.c
      })
    cellCount += addresses.length
    if (cellCount > limits.maxCells) {
      throw new DocumentParserError('LIMIT_EXCEEDED', `Workbook contains more than ${limits.maxCells} populated cells.`)
    }

    for (const address of addresses) {
      const cell = sheet[address]
      if (!cell) continue
      if (cell.f) {
        warnings.push({
          code: 'FORMULA_IGNORED',
          message: 'A formula was not executed; only its cached display value was used.',
          source: { sheet: sheetName, cell: address }
        })
      }
      if (cell.l?.Target) {
        warnings.push({
          code: 'EXTERNAL_LINK_DISCARDED',
          message: 'A spreadsheet hyperlink was discarded and was not loaded.',
          source: { sheet: sheetName, cell: address }
        })
      }
      const text = XLSX.utils.format_cell(cell).trim()
      if (!text) continue
      const coordinate = XLSX.utils.decode_cell(address)
      const merged = mergedRanges.find((range) =>
        coordinate.r >= range.s.r && coordinate.r <= range.e.r &&
        coordinate.c >= range.s.c && coordinate.c <= range.e.c
      )
      blocks.push({
        id: `sheet-${sheetIndex + 1}-cell-${address}`,
        kind: 'cell',
        text,
        source: {
          sheet: sheetName,
          cell: address,
          ...(merged ? { mergedRange: XLSX.utils.encode_range(merged) } : {}),
          ...(printArea && printRange
            ? {
                printArea,
                inPrintArea: coordinate.r >= printRange.s.r && coordinate.r <= printRange.e.r &&
                  coordinate.c >= printRange.s.c && coordinate.c <= printRange.e.c
              }
            : {})
        }
      })
    }
    enforceOutputLimits({ blocks, warnings, pages: 0, sheets: workbook.SheetNames.length, requiresLocalOcr: false }, limits)
  }
  return { blocks, warnings, pages: 0, sheets: workbook.SheetNames.length, requiresLocalOcr: false }
}

async function parseDocx(bytes: Buffer, limits: ParserLimits): Promise<ParsedContent> {
  const imported = await import('mammoth')
  const mammoth = imported.default
  const result = await mammoth.extractRawText({ buffer: bytes })
  const paragraphs = result.value
    .split(/(?:\r?\n){2,}/u)
    .map((paragraph) => paragraph.trim())
    .filter(Boolean)
  const blocks = paragraphs.map((text, index): DocumentBlock => ({
    id: `paragraph-${index + 1}`,
    kind: 'text',
    text,
    source: { paragraph: index + 1 }
  }))
  const warnings = result.messages.map(
    (message): DocumentWarning => ({
      code: 'PARSER_MESSAGE',
      message: `DOCX parser ${message.type}: ${message.message}`
    })
  )
  const content = { blocks, warnings, pages: 0, sheets: 0, requiresLocalOcr: false }
  enforceOutputLimits(content, limits)
  return content
}

export async function parseStagedDocument(
  rawFile: StagedLocalFile,
  bytes: Buffer,
  limits: ParserLimits = defaultParserLimits
): Promise<DocumentIR> {
  const parsedManifest = stagedLocalFileSchema.safeParse(rawFile)
  if (!parsedManifest.success || !Buffer.isBuffer(bytes) || bytes.length !== rawFile.size) {
    throw new DocumentParserError('INVALID_MANIFEST', 'The staged file manifest does not match the parser input.')
  }
  if (createHash('sha256').update(bytes).digest('hex') !== rawFile.sha256) {
    throw new DocumentParserError('HASH_MISMATCH', 'The staged file hash does not match the parser input.')
  }

  let content: ParsedContent
  try {
    switch (rawFile.format) {
      case 'pdf':
        content = await parsePdf(bytes, limits)
        break
      case 'docx':
        content = await parseDocx(bytes, limits)
        break
      case 'xls':
      case 'xlsx':
      case 'xlsb':
        content = await parseSpreadsheet(bytes, limits)
        break
      default:
        throw new DocumentParserError('UNSUPPORTED_FORMAT', `Unsupported document format: ${rawFile.format}`)
    }
  } catch (error) {
    if (error instanceof DocumentParserError) throw error
    throw new DocumentParserError('PARSE_FAILED', `The ${rawFile.format.toUpperCase()} parser rejected the document.`, {
      cause: error
    })
  }
  enforceOutputLimits(content, limits)
  const characters = content.blocks.reduce((total, block) => total + block.text.length, 0)
  return {
    version: documentIrVersion,
    documentId: rawFile.token,
    source: {
      name: rawFile.name,
      format: rawFile.format,
      sha256: rawFile.sha256,
      size: rawFile.size
    },
    ...content,
    statistics: {
      pages: content.pages,
      sheets: content.sheets,
      blocks: content.blocks.length,
      characters
    },
    security: {
      externalContentLoaded: false,
      macrosExecuted: false,
      rawFileCloudEligible: false
    }
  }
}
