import { createCipheriv, createDecipheriv, createHash, randomBytes, randomUUID } from 'node:crypto'
import { lstat, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { basename, dirname, extname, join } from 'node:path'
import { fileTypeFromBuffer } from 'file-type'
import type { DocumentBlock, DocumentIR } from '@parsers'
import {
  localCandidatePersonalFieldKeys,
  type LocalCandidateIdentitySummary,
  type OriginalDocumentPreview,
  type StagedLocalFile,
  type SupportedResumeFormat
} from '@shared/contracts'

const vaultMagic = Buffer.from('SESVAULT1', 'ascii')
const supportedFormats = new Set<SupportedResumeFormat>(['pdf', 'docx', 'xlsx', 'xls', 'xlsb'])
const detectedFormats: Record<SupportedResumeFormat, Set<string>> = {
  pdf: new Set(['pdf']),
  docx: new Set(['docx']),
  xlsx: new Set(['xlsx']),
  xls: new Set(['cfb', 'xls']),
  xlsb: new Set(['xlsx', 'zip'])
}

export interface StagedFileRecord extends StagedLocalFile {
  encryptedPath: string
}

export interface FileVaultOptions {
  directory: string
  key: Buffer
  maxFileBytes?: number
}

export interface QuarantinedVaultFile {
  token: string
  originalPath: string
  quarantinePath: string
}

function safeDisplayName(path: string): string {
  const value = basename(path).normalize('NFC')
  if (!value || value.length > 180 || /[\u0000-\u001f\u007f]/u.test(value)) {
    throw new Error('The selected file name is not supported.')
  }
  return value
}

function associatedData(file: Pick<StagedLocalFile, 'token' | 'format' | 'sha256' | 'size'>): Buffer {
  return Buffer.from(`${file.token}\u0000${file.format}\u0000${file.sha256}\u0000${file.size}`)
}

async function writePrivateFileAtomically(path: string, content: Buffer): Promise<void> {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 })
  const temporaryPath = `${path}.${randomBytes(8).toString('hex')}.tmp`
  await writeFile(temporaryPath, content, { mode: 0o600 })
  await rename(temporaryPath, path)
}

export class EncryptedFileVault {
  private readonly maxFileBytes: number

  constructor(private readonly options: FileVaultOptions) {
    if (options.key.length !== 32) throw new Error('The file vault key must contain exactly 32 bytes.')
    this.maxFileBytes = options.maxFileBytes ?? 25 * 1024 * 1024
  }

  async stageFile(sourcePath: string, now = new Date()): Promise<StagedFileRecord> {
    const sourceStat = await lstat(sourcePath)
    if (!sourceStat.isFile() || sourceStat.isSymbolicLink()) throw new Error('Only regular files can be imported.')
    if (sourceStat.size <= 0) throw new Error('Empty files cannot be imported.')
    if (sourceStat.size > this.maxFileBytes) throw new Error('The selected file exceeds the 25 MB import limit.')
    return this.stageBytes(sourcePath, await readFile(sourcePath), now)
  }

  /**
   * Stages content the main process already holds - a file dropped into the
   * conversation - instead of reading it from a path. The renderer never learns
   * a path, so every check stageFile performs has to happen here too: extension
   * allowlist, magic bytes matching that extension, size, then AES-256-GCM.
   *
   * The declared name is untrusted; only its basename is kept, and the format is
   * decided by the file's own bytes rather than by anything the caller claims.
   */
  async stageBytes(declaredName: string, raw: Buffer, now = new Date()): Promise<StagedFileRecord> {
    if (raw.length <= 0) throw new Error('Empty files cannot be imported.')
    if (raw.length > this.maxFileBytes) throw new Error('The selected file exceeds the 25 MB import limit.')

    const name = safeDisplayName(declaredName)
    const extension = extname(name).slice(1).toLocaleLowerCase('en-US') as SupportedResumeFormat
    if (!supportedFormats.has(extension)) throw new Error(`Unsupported resume extension: .${extension || 'unknown'}`)

    const detected = await fileTypeFromBuffer(raw)
    if (!detected || !detectedFormats[extension].has(detected.ext)) {
      throw new Error(`File content does not match the .${extension} extension.`)
    }

    return this.encryptAndPersist(name, extension, raw, now)
  }

  /**
   * Stages text this process itself produced - a business-text intake turn.
   * The extension/magic checks are deliberately bypassed: a 'txt' source can
   * only be created here, never from a user-supplied file, and the renderer
   * still only ever receives the token. The generated name must not contain
   * personal information; callers pass a content-digest name.
   */
  async stageTrustedText(generatedName: string, text: string, now = new Date()): Promise<StagedFileRecord> {
    const raw = Buffer.from(text, 'utf8')
    if (raw.length <= 0) throw new Error('Empty trusted text cannot be staged.')
    if (raw.length > this.maxFileBytes) throw new Error('The trusted text exceeds the 25 MB import limit.')
    const name = safeDisplayName(generatedName)
    if (extname(name).toLocaleLowerCase('en-US') !== '.txt') {
      throw new Error('Trusted text staging only produces .txt sources.')
    }
    return this.encryptAndPersist(name, 'txt', raw, now)
  }

  private async encryptAndPersist(
    name: string,
    format: StagedLocalFile['format'],
    raw: Buffer,
    now: Date
  ): Promise<StagedFileRecord> {
    const metadata: StagedLocalFile = {
      token: randomUUID(),
      name,
      format,
      size: raw.length,
      sha256: createHash('sha256').update(raw).digest('hex'),
      createdAt: now.toISOString(),
      privacyStatus: 'awaiting-local-scan'
    }
    const nonce = randomBytes(12)
    const cipher = createCipheriv('aes-256-gcm', this.options.key, nonce)
    cipher.setAAD(associatedData(metadata))
    const ciphertext = Buffer.concat([cipher.update(raw), cipher.final()])
    const encrypted = Buffer.concat([vaultMagic, nonce, cipher.getAuthTag(), ciphertext])
    const encryptedPath = join(this.options.directory, `${metadata.token}.sesv`)
    await writePrivateFileAtomically(encryptedPath, encrypted)
    return { ...metadata, encryptedPath }
  }

  async discardStagedFile(record: StagedFileRecord): Promise<void> {
    const expectedPath = join(this.options.directory, `${record.token}.sesv`)
    if (record.encryptedPath !== expectedPath) throw new Error('Refusing to remove a file outside the encrypted vault.')
    await rm(expectedPath, { force: true })
  }

  async quarantineStagedFile(record: StagedFileRecord, deletionId: string): Promise<QuarantinedVaultFile | null> {
    if (!/^[0-9a-f-]{36}$/iu.test(deletionId)) throw new Error('Invalid deletion identifier.')
    const expectedPath = join(this.options.directory, `${record.token}.sesv`)
    if (record.encryptedPath !== expectedPath) throw new Error('Refusing to quarantine a file outside the encrypted vault.')
    const quarantinePath = `${expectedPath}.deleting-${deletionId}`
    try {
      await rename(expectedPath, quarantinePath)
      return { token: record.token, originalPath: expectedPath, quarantinePath }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null
      throw error
    }
  }

  async restoreQuarantinedFile(file: QuarantinedVaultFile): Promise<void> {
    this.assertQuarantinePath(file)
    await rename(file.quarantinePath, file.originalPath)
  }

  async purgeQuarantinedFile(file: QuarantinedVaultFile): Promise<void> {
    this.assertQuarantinePath(file)
    await rm(file.quarantinePath, { force: true })
  }

  async decryptForLocalProcessing(record: StagedFileRecord): Promise<Buffer> {
    const encrypted = await readFile(record.encryptedPath)
    if (!encrypted.subarray(0, vaultMagic.length).equals(vaultMagic)) throw new Error('Invalid encrypted vault file.')
    const nonceStart = vaultMagic.length
    const tagStart = nonceStart + 12
    const ciphertextStart = tagStart + 16
    if (encrypted.length <= ciphertextStart) throw new Error('Encrypted vault file is truncated.')
    const decipher = createDecipheriv('aes-256-gcm', this.options.key, encrypted.subarray(nonceStart, tagStart))
    decipher.setAAD(associatedData(record))
    decipher.setAuthTag(encrypted.subarray(tagStart, ciphertextStart))
    const plaintext = Buffer.concat([decipher.update(encrypted.subarray(ciphertextStart)), decipher.final()])
    if (createHash('sha256').update(plaintext).digest('hex') !== record.sha256) {
      throw new Error('The decrypted file hash does not match its manifest.')
    }
    return plaintext
  }

  async materializeTemporaryCopy(record: StagedFileRecord, directory: string): Promise<string> {
    const fileName = safeDisplayName(record.name)
    await mkdir(directory, { recursive: true, mode: 0o700 })
    const path = join(directory, fileName)
    const plaintext = await this.decryptForLocalProcessing(record)
    try {
      await writePrivateFileAtomically(path, plaintext)
    } finally {
      plaintext.fill(0)
    }
    return path
  }

  private assertQuarantinePath(file: QuarantinedVaultFile): void {
    const expectedPath = join(this.options.directory, `${file.token}.sesv`)
    if (file.originalPath !== expectedPath || !file.quarantinePath.startsWith(`${expectedPath}.deleting-`)) {
      throw new Error('Refusing to operate on a quarantine file outside the encrypted vault.')
    }
  }
}

function sourceLabel(block: DocumentBlock): string | null {
  if (block.source.sheet && block.source.cell) return `${block.source.sheet}!${block.source.cell}`
  if (block.source.page) return `Page ${block.source.page}`
  if (block.source.paragraph) return `Paragraph ${block.source.paragraph}`
  return null
}

function normalizedPreviewValue(value: string): string {
  return value.normalize('NFKC').replace(/\s+/gu, ' ').trim()
}

export function buildOriginalDocumentPreview(
  document: DocumentIR,
  identity: LocalCandidateIdentitySummary,
  pdfPreviewUrl: string | null
): OriginalDocumentPreview {
  const sheets = new Map<string, OriginalDocumentPreview['sheets'][number]>()
  const pages = new Map<number, OriginalDocumentPreview['pages'][number]>()
  const paragraphs: OriginalDocumentPreview['paragraphs'] = []

  for (const block of document.blocks) {
    if (block.source.sheet && block.source.cell) {
      const sheet = sheets.get(block.source.sheet) ?? {
        name: block.source.sheet,
        printArea: block.source.printArea ?? null,
        cells: []
      }
      if (!sheet.printArea && block.source.printArea) sheet.printArea = block.source.printArea
      sheet.cells.push({
        address: block.source.cell,
        text: block.text,
        mergedRange: block.source.mergedRange ?? null,
        inPrintArea: block.source.inPrintArea ?? null
      })
      sheets.set(block.source.sheet, sheet)
    }
    if (block.source.page) {
      const page = pages.get(block.source.page) ?? { pageNumber: block.source.page, blocks: [] }
      page.blocks.push({ text: block.text, boundingBox: block.source.boundingBox ?? null })
      pages.set(block.source.page, page)
    }
    if (block.source.paragraph) paragraphs.push({ paragraphNumber: block.source.paragraph, text: block.text })
  }

  const personalFieldSources: OriginalDocumentPreview['personalFieldSources'] = {}
  for (const key of localCandidatePersonalFieldKeys) {
    const value = identity[key]
    if (!value) continue
    const normalized = normalizedPreviewValue(value)
    const exact = document.blocks.filter((block) => normalizedPreviewValue(block.text) === normalized)
    const matchingBlocks = exact.length > 0
      ? exact
      : document.blocks.filter((block) => normalizedPreviewValue(block.text).includes(normalized))
    const sources = [...new Set(matchingBlocks.map(sourceLabel).filter((label): label is string => Boolean(label)))].slice(0, 12)
    if (sources.length > 0) personalFieldSources[key] = sources
  }

  return {
    version: 'original-document-preview-v1',
    documentId: document.documentId,
    fileName: document.source.name,
    format: document.source.format,
    size: document.source.size,
    sha256: document.source.sha256,
    viewMode: document.source.format === 'pdf'
      ? 'pdf'
      : ['xlsx', 'xls', 'xlsb'].includes(document.source.format) ? 'spreadsheet' : 'document',
    previewUrl: document.source.format === 'pdf' ? pdfPreviewUrl : null,
    sheets: [...sheets.values()],
    pages: [...pages.values()].toSorted((left, right) => left.pageNumber - right.pageNumber),
    paragraphs: paragraphs.toSorted((left, right) => left.paragraphNumber - right.paragraphNumber),
    personalFieldSources,
    storage: 'encrypted-local-vault',
    cloudEligible: false,
    originalFileAvailable: true
  }
}
