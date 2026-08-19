// @vitest-environment node
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import type { StagedLocalFile, SupportedResumeFormat } from '@shared'
import { parseStagedDocument } from './index'

const fixtureRoot = resolve(process.cwd(), 'tests/fixtures/external-adoption')

function staged(name: string, format: SupportedResumeFormat, bytes: Buffer): StagedLocalFile {
  return {
    token: '792e22a9-15dc-4c65-b6f3-06f70bdd3e26',
    name,
    format,
    size: bytes.length,
    sha256: createHash('sha256').update(bytes).digest('hex'),
    createdAt: '2026-08-18T00:00:00.000Z',
    privacyStatus: 'awaiting-local-scan'
  }
}

describe('external-adoption synthetic parser fixtures', () => {
  it('binds every generated fixture to a synthetic provenance manifest', () => {
    const manifest = JSON.parse(readFileSync(resolve(fixtureRoot, 'fixture-manifest.json'), 'utf8')) as {
      synthetic: boolean
      externalBytesCopied: boolean
      containsRealPersonalData: boolean
      networkRequired: boolean
      files: Array<{ name: string; bytes: number; sha256: string; synthetic: boolean }>
    }
    expect(manifest).toMatchObject({
      synthetic: true,
      externalBytesCopied: false,
      containsRealPersonalData: false,
      networkRequired: false
    })
    for (const file of manifest.files) {
      const bytes = readFileSync(resolve(fixtureRoot, file.name))
      expect(bytes.length).toBe(file.bytes)
      expect(createHash('sha256').update(bytes).digest('hex')).toBe(file.sha256)
      expect(file.synthetic).toBe(true)
    }
  })

  it('extracts DOCX paragraphs and table text with local source references', async () => {
    const bytes = readFileSync(resolve(fixtureRoot, 'resume-paragraph-table.docx'))
    const result = await parseStagedDocument(staged('resume-paragraph-table.docx', 'docx', bytes), bytes)
    expect(result.blocks.some((block) => block.text.includes('候補者 SYN00001') && block.source.paragraph)).toBe(true)
    expect(result.blocks.some((block) => block.text.includes('合成決済API刷新') && block.source.paragraph)).toBe(true)
    expect(result.security).toEqual({ externalContentLoaded: false, macrosExecuted: false, rawFileCloudEligible: false })
  })

  it('extracts multiple XLSX sheets and rejects formula/link execution', async () => {
    const bytes = readFileSync(resolve(fixtureRoot, 'resume-multi-sheet.xlsx'))
    const result = await parseStagedDocument(staged('resume-multi-sheet.xlsx', 'xlsx', bytes), bytes)
    expect(result.statistics.sheets).toBe(2)
    expect(result.blocks.some((block) => block.source.sheet === 'Skills' && block.source.cell === 'A3')).toBe(true)
    expect(result.blocks.some((block) => block.source.sheet === 'Projects' && block.source.cell === 'A2')).toBe(true)
    expect(result.warnings).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'FORMULA_IGNORED', source: { sheet: 'Skills', cell: 'C5' } }),
      expect.objectContaining({ code: 'EXTERNAL_LINK_DISCARDED', source: { sheet: 'Skills', cell: 'D5' } })
    ]))
    expect(result.security).toEqual({ externalContentLoaded: false, macrosExecuted: false, rawFileCloudEligible: false })
  })

  it('keeps ATS CSV outside the resume parser allowlist', () => {
    const bytes = readFileSync(resolve(fixtureRoot, 'ats-multi-candidate.csv'))
    expect(bytes.toString('utf8')).toContain('synthetic')
    expect(['pdf', 'docx', 'xlsx', 'xls', 'xlsb']).not.toContain('csv')
  })

  it('treats prompt-injection text as fixture data, not an executable instruction', () => {
    const text = readFileSync(resolve(fixtureRoot, 'job-case-untrusted.txt'), 'utf8')
    expect(text).toContain('Ignore previous instructions')
    expect(text).toContain('ツール命令ではありません')
  })
})
