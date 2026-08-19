// @vitest-environment node
import { createHash } from 'node:crypto'
import JSZip from 'jszip'
import { PDFDocument, StandardFonts } from 'pdf-lib'
import * as XLSX from 'xlsx'
import type { StagedLocalFile, SupportedResumeFormat } from '@shared/contracts'
import { DocumentParserError, parseStagedDocument } from './index'

function stagedFile(format: SupportedResumeFormat, bytes: Buffer): StagedLocalFile {
  return {
    token: 'b9b5316e-8fe8-44ff-9f82-e664e7acbbaa',
    name: `candidate.${format}`,
    format,
    size: bytes.length,
    sha256: createHash('sha256').update(bytes).digest('hex'),
    createdAt: '2026-07-17T00:00:00.000Z',
    privacyStatus: 'awaiting-local-scan'
  }
}

async function createDocx(): Promise<Buffer> {
  const zip = new JSZip()
  zip.file(
    '[Content_Types].xml',
    '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>'
  )
  zip.folder('_rels')?.file(
    '.rels',
    '<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>'
  )
  zip.folder('word')?.file(
    'document.xml',
    '<?xml version="1.0"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>Java Engineer</w:t></w:r></w:p><w:p><w:r><w:t>AWS 5 years</w:t></w:r></w:p></w:body></w:document>'
  )
  return zip.generateAsync({ type: 'nodebuffer' })
}

describe('parseStagedDocument', () => {
  it('extracts spreadsheet cells with exact source references without executing formulas', async () => {
    const sheet = XLSX.utils.aoa_to_sheet([
      ['Skill', 'Years'],
      ['Java', 6]
    ])
    sheet.B3 = { t: 'n', f: '1+1', v: 2 }
    sheet['!ref'] = 'A1:B3'
    const workbook = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(workbook, sheet, 'Skills')
    const bytes = Buffer.from(XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' }))

    const result = await parseStagedDocument(stagedFile('xlsx', bytes), bytes)
    expect(result.blocks).toContainEqual(expect.objectContaining({ text: 'Java', source: { sheet: 'Skills', cell: 'A2' } }))
    expect(result.warnings).toContainEqual(expect.objectContaining({ code: 'FORMULA_IGNORED', source: { sheet: 'Skills', cell: 'B3' } }))
    expect(result.security).toEqual({ externalContentLoaded: false, macrosExecuted: false, rawFileCloudEligible: false })
  })

  it('preserves spreadsheet merge and print-area context for structural resume extraction', async () => {
    const sheet = XLSX.utils.aoa_to_sheet([
      ['Header', null, null, null, null, 'Helper'],
      ['Merged value']
    ])
    sheet['!merges'] = [XLSX.utils.decode_range('A2:B3')]
    sheet['!ref'] = 'A1:F3'
    const workbook = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(workbook, sheet, 'Resume')
    workbook.Workbook = {
      ...workbook.Workbook,
      Names: [{ Name: '_xlnm.Print_Area', Sheet: 0, Ref: 'Resume!$A$1:$D$3' }]
    }
    const bytes = Buffer.from(XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' }))

    const result = await parseStagedDocument(stagedFile('xlsx', bytes), bytes)
    expect(result.blocks.find((block) => block.text === 'Merged value')?.source).toEqual({
      sheet: 'Resume',
      cell: 'A2',
      mergedRange: 'A2:B3',
      printArea: 'A1:D3',
      inPrintArea: true
    })
    expect(result.blocks.find((block) => block.text === 'Helper')?.source).toMatchObject({
      sheet: 'Resume',
      cell: 'F1',
      printArea: 'A1:D3',
      inPrintArea: false
    })
  })

  it('extracts DOCX paragraphs as local source references', async () => {
    const bytes = await createDocx()
    const result = await parseStagedDocument(stagedFile('docx', bytes), bytes)
    expect(result.blocks.map((block) => block.text)).toEqual(['Java Engineer', 'AWS 5 years'])
    expect(result.blocks[0]?.source).toEqual({ paragraph: 1 })
  })

  it('extracts PDF text with page references', async () => {
    const document = await PDFDocument.create()
    const page = document.addPage([400, 300])
    const font = await document.embedFont(StandardFonts.Helvetica)
    page.drawText('Java AWS Engineer', { x: 40, y: 220, size: 14, font })
    const bytes = Buffer.from(await document.save())

    const result = await parseStagedDocument(stagedFile('pdf', bytes), bytes)
    expect(result.statistics.pages).toBe(1)
    expect(result.blocks.some((block) => block.text.includes('Java AWS Engineer') && block.source.page === 1)).toBe(true)
    expect(result.requiresLocalOcr).toBe(false)
  })

  it('rejects tampered bytes and bounded-output violations', async () => {
    const bytes = await createDocx()
    const manifest = stagedFile('docx', bytes)
    await expect(parseStagedDocument(manifest, Buffer.concat([bytes, Buffer.from('tampered')]))).rejects.toMatchObject({
      code: 'INVALID_MANIFEST'
    } satisfies Partial<DocumentParserError>)

    await expect(
      parseStagedDocument(manifest, bytes, {
        maxPages: 1,
        maxSheets: 1,
        maxBlocks: 1,
        maxCharacters: 10,
        maxCells: 1
      })
    ).rejects.toMatchObject({ code: 'LIMIT_EXCEEDED' } satisfies Partial<DocumentParserError>)
  })
})
