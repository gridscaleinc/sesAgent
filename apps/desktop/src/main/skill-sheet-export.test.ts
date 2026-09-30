// @vitest-environment node
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { CandidateProfile } from '@resume'
import { exportSkillSheet, prepareSkillSheet } from './skill-sheet-export'
import type { MainIpcContext } from './ipc/context'

const mock = vi.hoisted(() => ({
  save: vi.fn(async (): Promise<{ canceled: boolean; filePath?: string }> => ({ canceled: true })),
  reveal: vi.fn()
}))
vi.mock('electron', () => ({
  BrowserWindow: vi.fn(),
  dialog: { showSaveDialog: mock.save },
  shell: { showItemInFolder: mock.reveal }
}))

const documentId = '559dcb5d-dcf0-4c11-a12d-698cfef220e6'
const reviewId = 'ee6b5a0f-ecc2-4f6c-8f71-5f6e89f0fd09'
const profile: CandidateProfile = {
  schemaVersion: 'candidate-profile-v1',
  id: '8055be48-a08f-499d-9d82-c95a36018ad9',
  sourceDocumentId: documentId,
  profileVersion: 2,
  reviewRevision: 1,
  localPersonalDetails: {
    displayName: '山田 太郎',
    gender: null,
    birthDate: null,
    nationality: null,
    phone: '090-1234-5678',
    email: 'taro@example.test',
    address: null,
    education: null,
    major: null,
    graduationDate: null,
    degree: null
  },
  fields: [
    { key: 'skills', label: 'スキル', value: 'Java / AWS', sourceLabels: ['Page 1'] },
    { key: 'work_authorization', label: '就労資格', value: '就労制限なし', sourceLabels: ['Page 1'] }
  ],
  projectExperiences: [
    {
      id: '9a8d556d-5052-4b7d-b3db-947b65f2e7c2',
      title: '決済基盤クラウド刷新',
      period: '2024/01–2025/06',
      role: 'バックエンドリード',
      technologies: ['Java', 'AWS'],
      summary: '決済APIの再設計とクラウド移行を担当。',
      sourceLabels: ['Page 2']
    }
  ],
  confirmedAt: '2026-07-17T00:00:00.000Z',
  confirmedBy: 'HR',
  containsDirectIdentifiers: false
}
const job = { reviewId, lifecycle: 'active', jobCase: { version: 3 }, fields: [{ key: 'title', value: 'Java決済案件' }] }
const fakePdf = Buffer.from('%PDF-1.7 skill sheet')

let directory = ''
const setup = (overrides: Partial<Record<string, unknown>> = {}) => {
  const repository = {
    getCurrentCandidateProfile: vi.fn(() => profile),
    getCandidateProfileForAssessment: vi.fn(() => profile),
    getJobCaseReview: vi.fn(() => job),
    updateActionRun: vi.fn(),
    ...overrides
  }
  const context = {
    repository,
    processingResources: { run: (_lane: string, work: () => Promise<unknown>) => work() },
    currentOperator: () => ({ operatorId: 'operator-1', displayName: 'HR' }),
    preflightAction: vi.fn(() => 'action-run-1')
  } as unknown as MainIpcContext
  return { repository, context }
}

beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), 'ses-skill-sheet-'))
  mock.save.mockReset()
  mock.reveal.mockReset()
})
afterEach(async () => {
  await rm(directory, { recursive: true, force: true })
})

describe('skill sheet export', () => {
  it('uses the proposal redaction: anonymous label, no contact details, no work authorization, case title when present', () => {
    const { repository } = setup()
    const sheet = prepareSkillSheet(repository as never, { documentId, profileVersion: 2, caseContext: { reviewId, version: 3 } })
    expect(sheet.attachment).toMatchObject({ redacted: true, sourceDocumentIncluded: false, anonymousCandidateLabel: '候補者 8055BE48' })
    expect(sheet.html).toContain('候補者 8055BE48')
    expect(sheet.html).toContain('ご提案案件：Java決済案件')
    expect(sheet.html).toContain('決済基盤クラウド刷新')
    for (const hidden of ['山田', '090-1234-5678', 'taro@example.test', '就労制限なし']) expect(sheet.html).not.toContain(hidden)
    expect(sheet.fileName).toBe('skill-sheet-8055be48.pdf')
    expect(repository.getCandidateProfileForAssessment).toHaveBeenCalledWith(documentId)
    expect(repository.getCurrentCandidateProfile).not.toHaveBeenCalled()
  })

  it('refuses stale profiles or cases and profiles carrying direct identifiers', () => {
    expect(() => prepareSkillSheet(setup().repository as never, { documentId, profileVersion: 1 })).toThrow(/要員情報が更新されました/u)
    expect(() =>
      prepareSkillSheet(setup().repository as never, { documentId, profileVersion: 2, caseContext: { reviewId, version: 2 } })
    ).toThrow(/案件情報が更新されました/u)
    const leaking = { ...profile, fields: [{ key: 'skills', label: 'スキル', value: '連絡先 090-1234-5678', sourceLabels: [] }] }
    expect(() =>
      prepareSkillSheet(setup({ getCurrentCandidateProfile: vi.fn(() => leaking) }).repository as never, { documentId, profileVersion: 2 })
    ).toThrow(/個人識別情報/u)
  })

  it('writes the rendered PDF to the chosen path, records the audit run and reveals it in Finder', async () => {
    const { context, repository } = setup()
    const filePath = join(directory, 'sheet.pdf')
    mock.save.mockResolvedValueOnce({ canceled: false, filePath })
    const render = vi.fn(async (_html: string) => fakePdf)
    const result = await exportSkillSheet(context, null, { documentId, profileVersion: 2 }, render)
    expect(result).toEqual({ cancelled: false, fileName: 'sheet.pdf' })
    expect(await readFile(filePath)).toEqual(fakePdf)
    expect(render).toHaveBeenCalledWith(expect.stringContaining('候補者 8055BE48'))
    expect(context.preflightAction).toHaveBeenCalledWith(
      'skill-sheet.export',
      expect.objectContaining({ origin: 'user-command', scopeId: 'selected-candidate-profile', actorId: 'operator-1' }),
      expect.objectContaining({ documentId, profileVersion: 2, caseContext: null }),
      expect.any(String),
      expect.stringMatching(/^skill-sheet-export:/u)
    )
    expect(repository.updateActionRun).toHaveBeenLastCalledWith('action-run-1', 'succeeded', {
      resultHash: expect.stringMatching(/^[a-f0-9]{64}$/u)
    })
    expect(mock.reveal).toHaveBeenCalledWith(filePath)
  })

  it('writes nothing when the save dialog is cancelled or rendering fails', async () => {
    const { context, repository } = setup()
    mock.save.mockResolvedValueOnce({ canceled: true })
    const render = vi.fn(async (_html: string) => fakePdf)
    expect(await exportSkillSheet(context, null, { documentId, profileVersion: 2 }, render)).toEqual({ cancelled: true, fileName: null })
    expect(render).not.toHaveBeenCalled()
    expect(repository.updateActionRun).toHaveBeenCalledWith('action-run-1', 'cancelled', { errorCode: 'NATIVE_SAVE_CANCELLED' })
    mock.save.mockResolvedValueOnce({ canceled: false, filePath: join(directory, 'broken.pdf') })
    await expect(exportSkillSheet(context, null, { documentId, profileVersion: 2 }, async () => Buffer.from('not a pdf'))).rejects.toThrow(
      /スキルシートを書き出せませんでした/u
    )
    expect(await readdir(directory)).toEqual([])
    expect(repository.updateActionRun).toHaveBeenLastCalledWith('action-run-1', 'failed', { errorCode: 'LOCAL_EXPORT_FAILED' })
    expect(mock.reveal).not.toHaveBeenCalled()
  })
})
