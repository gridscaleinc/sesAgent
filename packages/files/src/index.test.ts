// @vitest-environment node
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { DocumentIR } from '@parsers'
import { buildOriginalDocumentPreview, EncryptedFileVault } from './index'

describe('EncryptedFileVault', () => {
  it('validates, encrypts and decrypts a staged PDF without returning its source path', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'ses-agent-vault-'))
    try {
      const sourcePath = join(directory, 'candidate.pdf')
      const raw = Buffer.from('%PDF-1.4\n1 0 obj\n<</Type/Catalog>>\nendobj\n%%EOF\nPRIVATE_FILE_SENTINEL')
      await writeFile(sourcePath, raw)
      const vault = new EncryptedFileVault({ directory: join(directory, 'vault'), key: Buffer.alloc(32, 7) })
      const staged = await vault.stageFile(sourcePath, new Date('2026-07-17T00:00:00.000Z'))

      expect(staged).toMatchObject({ name: 'candidate.pdf', format: 'pdf', privacyStatus: 'awaiting-local-scan' })
      expect(staged).not.toHaveProperty('sourcePath')
      expect((await readFile(staged.encryptedPath)).includes(Buffer.from('PRIVATE_FILE_SENTINEL'))).toBe(false)
      expect((await stat(staged.encryptedPath)).mode & 0o777).toBe(0o600)
      await expect(vault.decryptForLocalProcessing(staged)).resolves.toEqual(raw)
      const temporaryCopy = await vault.materializeTemporaryCopy(staged, join(directory, 'open-copy'))
      expect(await readFile(temporaryCopy)).toEqual(raw)
      expect((await stat(temporaryCopy)).mode & 0o777).toBe(0o600)
      const quarantined = await vault.quarantineStagedFile(staged, '38dca6f6-947b-45d5-98bc-c9e6dcd242e9')
      expect(quarantined?.quarantinePath).toContain('.deleting-38dca6f6')
      await expect(stat(staged.encryptedPath)).rejects.toMatchObject({ code: 'ENOENT' })
      await vault.restoreQuarantinedFile(quarantined!)
      await expect(vault.decryptForLocalProcessing(staged)).resolves.toEqual(raw)
      const quarantinedAgain = await vault.quarantineStagedFile(staged, '8055be48-a08f-499d-9d82-c95a36018ad9')
      await vault.purgeQuarantinedFile(quarantinedAgain!)
      await expect(stat(staged.encryptedPath)).rejects.toMatchObject({ code: 'ENOENT' })
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
  })

  it('builds a structured local preview and maps personal fields back to source cells', () => {
    const document: DocumentIR = {
      version: 'document-ir-v1',
      documentId: '5e910bbc-7aeb-4087-8130-4ff63ef8bd68',
      source: { name: 'candidate.xlsx', format: 'xlsx', sha256: 'a'.repeat(64), size: 2048 },
      blocks: [
        { id: 'name-label', kind: 'cell', text: '氏名', source: { sheet: '履歴書', cell: 'A5', printArea: 'A1:AM90', inPrintArea: true } },
        { id: 'name-value', kind: 'cell', text: '楊凱', source: { sheet: '履歴書', cell: 'D5', mergedRange: 'D5:I5', printArea: 'A1:AM90', inPrintArea: true } },
        { id: 'school-value', kind: 'cell', text: '鄭州大学', source: { sheet: '履歴書', cell: 'D8', mergedRange: 'D8:R8', printArea: 'A1:AM90', inPrintArea: true } }
      ],
      warnings: [],
      requiresLocalOcr: false,
      statistics: { pages: 0, sheets: 1, blocks: 3, characters: 10 },
      security: { externalContentLoaded: false, macrosExecuted: false, rawFileCloudEligible: false }
    }
    const preview = buildOriginalDocumentPreview(document, {
      displayName: '楊凱',
      gender: null,
      birthDate: null,
      nationality: null,
      phone: null,
      email: null,
      address: null,
      education: '鄭州大学',
      major: null,
      graduationDate: null,
      degree: null,
      storage: 'encrypted-local-only',
      cloudEligible: false
    }, null)

    expect(preview).toMatchObject({
      viewMode: 'spreadsheet',
      storage: 'encrypted-local-vault',
      cloudEligible: false,
      personalFieldSources: { displayName: ['履歴書!D5'], education: ['履歴書!D8'] }
    })
    expect(preview.sheets[0]).toMatchObject({ name: '履歴書', printArea: 'A1:AM90' })
    expect(preview.sheets[0]?.cells).toHaveLength(3)
  })

  it('stages bytes dropped into the conversation with the same checks as a path import', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'ses-agent-vault-'))
    try {
      const raw = Buffer.from('%PDF-1.4\n1 0 obj\n<</Type/Catalog>>\nendobj\n%%EOF\nDROPPED_FILE_SENTINEL')
      const vault = new EncryptedFileVault({ directory: join(directory, 'vault'), key: Buffer.alloc(32, 9) })
      const staged = await vault.stageBytes('candidate.pdf', raw, new Date('2026-07-17T00:00:00.000Z'))

      expect(staged).toMatchObject({ name: 'candidate.pdf', format: 'pdf', privacyStatus: 'awaiting-local-scan' })
      expect(staged).not.toHaveProperty('sourcePath')
      expect((await readFile(staged.encryptedPath)).includes(Buffer.from('DROPPED_FILE_SENTINEL'))).toBe(false)
      expect(await vault.decryptForLocalProcessing(staged)).toEqual(raw)
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
  })

  it('decides the dropped format from the bytes, not from the name the renderer supplied', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'ses-agent-vault-'))
    try {
      const vault = new EncryptedFileVault({ directory: join(directory, 'vault'), key: Buffer.alloc(32, 10) })
      await expect(vault.stageBytes('spoofed.pdf', Buffer.from('not a pdf at all'))).rejects.toThrow('does not match')
      await expect(vault.stageBytes('payload.exe', Buffer.from('%PDF-1.4\n%%EOF'))).rejects.toThrow('Unsupported resume extension')
      await expect(vault.stageBytes('empty.pdf', Buffer.alloc(0))).rejects.toThrow('Empty files')
      // A traversal attempt is neutralised to its basename rather than rejected.
      const traversal = await vault.stageBytes('../../escape.pdf', Buffer.from('%PDF-1.4\n%%EOF'))
      expect(traversal.name).toBe('escape.pdf')
      expect(traversal.encryptedPath.endsWith(`${traversal.token}.sesv`)).toBe(true)
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
  })

  it('rejects an extension whose bytes do not match', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'ses-agent-vault-'))
    try {
      const sourcePath = join(directory, 'spoofed.pdf')
      await writeFile(sourcePath, 'not a pdf')
      const vault = new EncryptedFileVault({ directory: join(directory, 'vault'), key: Buffer.alloc(32, 8) })
      await expect(vault.stageFile(sourcePath)).rejects.toThrow('does not match')
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
  })
})
