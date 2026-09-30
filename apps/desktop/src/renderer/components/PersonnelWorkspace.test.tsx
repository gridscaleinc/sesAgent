import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import {
  builtInPersonnelTemplates,
  type CandidateBusinessState,
  type CandidateReviewSnapshot,
  type PersonnelCaseMatchResult
} from '@shared'
import { PersonnelWorkspace } from './PersonnelWorkspace'
import { clearPersonCaseMatchCache, savePersonCaseMatch, setPersonCaseMatchRunning } from '../person-case-match-cache'
const documentId = '11111111-1111-4111-8111-111111111111'
const interviewId = '22222222-2222-4222-8222-222222222222'

const review: CandidateReviewSnapshot = {
  documentId,
  fileName: 'candidate.xlsx',
  reviewRevision: 1,
  status: 'completed',
  piiReviewed: true,
  localIdentity: {
    displayName: '张伟',
    gender: null,
    birthDate: null,
    nationality: null,
    phone: null,
    email: null,
    address: null,
    education: null,
    major: null,
    graduationDate: null,
    degree: null,
    storage: 'encrypted-local-only',
    cloudEligible: false
  },
  fields: [
    {
      key: 'skills',
      label: '技能',
      originalValue: 'Java, AWS',
      value: 'Java, AWS',
      confidence: 1,
      status: 'confirmed',
      sourceLabels: [],
      changed: false,
      changeReason: null
    },
    {
      key: 'experience_years',
      label: '经验',
      originalValue: '6年',
      value: '6年',
      confidence: 1,
      status: 'confirmed',
      sourceLabels: [],
      changed: false,
      changeReason: null
    },
    {
      key: 'availability',
      label: '可入场',
      originalValue: null,
      value: null,
      confidence: 0,
      status: 'confirmed',
      sourceLabels: [],
      changed: false,
      changeReason: null
    },
    {
      key: 'rate',
      label: '单价',
      originalValue: null,
      value: null,
      confidence: 0,
      status: 'confirmed',
      sourceLabels: [],
      changed: false,
      changeReason: null
    },
    {
      key: 'japanese_level',
      label: '日语',
      originalValue: 'N2',
      value: 'N2',
      confidence: 1,
      status: 'confirmed',
      sourceLabels: [],
      changed: false,
      changeReason: null
    },
    {
      key: 'work_style',
      label: '工作方式',
      originalValue: null,
      value: null,
      confidence: 0,
      status: 'confirmed',
      sourceLabels: [],
      changed: false,
      changeReason: null
    },
    {
      key: 'role',
      label: '角色',
      originalValue: 'Java开发工程师',
      value: 'Java开发工程师',
      confidence: 1,
      status: 'confirmed',
      sourceLabels: [],
      changed: false,
      changeReason: null
    },
    {
      key: 'location',
      label: '所在地',
      originalValue: '东京',
      value: '东京',
      confidence: 1,
      status: 'confirmed',
      sourceLabels: [],
      changed: false,
      changeReason: null
    },
    {
      key: 'work_authorization',
      label: '工作资格',
      originalValue: null,
      value: null,
      confidence: 0,
      status: 'confirmed',
      sourceLabels: [],
      changed: false,
      changeReason: null
    }
  ],
  projectExperiences: [],
  completedAt: '2026-07-21T00:00:00.000Z',
  reviewerDisplayName: '李娜',
  profile: {
    id: '33333333-3333-4333-8333-333333333333',
    sourceDocumentId: documentId,
    version: 1,
    status: 'current',
    confirmedAt: '2026-07-21T00:00:00.000Z',
    confirmedBy: '李娜',
    containsDirectIdentifiers: false
  },
  recruitingStatus: 'ready-for-recruiting',
  talentPoolStatus: 'eligible',
  recordStatus: 'active'
}

const props = () => ({ reviews: [review], onRefresh: vi.fn(async () => {}), onOpenProfile: vi.fn() })
const setup = (invalid = false) => {
  const api = {
    getPersonnelWorkspace: vi.fn(async () => ({
      templates: builtInPersonnelTemplates(),
      states: [] as CandidateBusinessState[],
      copies: []
    })),
    validatePersonnelMessage: vi.fn(async (input) => {
      if (invalid) throw new Error('profile changed')
      return input
    }),
    recordPersonnelCopy: vi.fn(async () => ({})),
    copyTextToClipboard: vi.fn(async () => {}),
    setCandidateOwnCompany: vi.fn(async (input: { isOwnCompany: boolean | null }): Promise<CandidateReviewSnapshot> => ({
      ...review,
      isOwnCompany: input.isOwnCompany,
      profile: { ...review.profile!, version: 2 }
    })),
    setCandidateBusinessState: vi.fn(async () => ({})),
    findCasesForPersonnel: vi.fn(async (): Promise<PersonnelCaseMatchResult> => ({
      documentId,
      profileVersion: 1,
      items: [],
      localMatchCount: 0,
      cloud: { status: 'not-needed', reviewedCount: 0, modelName: null }
    }))
  }
  Object.defineProperty(window, 'sesAgent', { configurable: true, value: api })
  return api
}
describe('personnel panel', () => {
  it('opens own-company hiring interviews for the person shown in the business panel', async () => {
    setup()
    const onOpenRecruiting = vi.fn()
    render(<PersonnelWorkspace {...props()} initialDocumentId={documentId} onOpenRecruiting={onOpenRecruiting} />)
    fireEvent.click(await screen.findByRole('button', { name: '自社採用面談' }))
    expect(onOpenRecruiting).toHaveBeenCalledWith(documentId)
  })
  it('auto-saves affiliation only, blocks duplicate changes and uses the returned version for subsequent saves', async () => {
    const api = setup()
    let finish!: (value: CandidateReviewSnapshot) => void
    api.setCandidateOwnCompany.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve
        })
    )
    const callbacks = props()
    render(<PersonnelWorkspace {...callbacks} initialDocumentId={documentId} />)
    const select = await screen.findByRole('combobox', { name: '自社所属' })
    fireEvent.change(select, { target: { value: 'true' } })
    expect(select).toBeDisabled()
    fireEvent.change(select, { target: { value: 'false' } })
    expect(api.setCandidateOwnCompany).toHaveBeenCalledTimes(1)
    expect(api.setCandidateOwnCompany).toHaveBeenCalledWith({ documentId, expectedVersion: 1, isOwnCompany: true })
    finish({ ...review, isOwnCompany: true, profile: { ...review.profile!, version: 2 } })
    await waitFor(() => expect(select).toBeEnabled())
    expect(select).toHaveValue('true')
    expect(callbacks.onRefresh).toHaveBeenCalledOnce()
    fireEvent.change(select, { target: { value: '' } })
    await waitFor(() => expect(api.setCandidateOwnCompany).toHaveBeenLastCalledWith({ documentId, expectedVersion: 2, isOwnCompany: null }))
  })
  it('retains the previous affiliation on failure and allows retry', async () => {
    const api = setup()
    api.setCandidateOwnCompany.mockRejectedValueOnce(new Error('save failed'))
    render(<PersonnelWorkspace {...props()} initialDocumentId={documentId} />)
    const select = await screen.findByRole('combobox', { name: '自社所属' })
    fireEvent.change(select, { target: { value: 'true' } })
    expect(await screen.findByRole('alert')).toHaveTextContent('save failed')
    expect(select).toHaveValue('')
    expect(select).toBeEnabled()
    fireEvent.change(select, { target: { value: 'false' } })
    await waitFor(() => expect(select).toHaveValue('false'))
  })
  it('keeps a late save attached to its original person and retains it when list refresh fails', async () => {
    const api = setup()
    let finish!: (value: CandidateReviewSnapshot) => void
    api.setCandidateOwnCompany.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve
        })
    )
    const other = { ...review, documentId: '44444444-4444-4444-8444-444444444444' }
    const callbacks = {
      ...props(),
      reviews: [review, other],
      onRefresh: vi.fn(async () => {
        throw new Error('refresh failed')
      })
    }
    const view = render(<PersonnelWorkspace {...callbacks} initialDocumentId={documentId} />)
    fireEvent.change(await screen.findByRole('combobox', { name: '自社所属' }), { target: { value: 'true' } })
    view.rerender(<PersonnelWorkspace {...callbacks} initialDocumentId={other.documentId} />)
    finish({ ...review, isOwnCompany: true, profile: { ...review.profile!, version: 2 } })
    await waitFor(() => expect(screen.getByRole('combobox', { name: '自社所属' })).toBeEnabled())
    expect(screen.getByRole('combobox', { name: '自社所属' })).toHaveValue('')
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    view.rerender(<PersonnelWorkspace {...callbacks} initialDocumentId={documentId} />)
    expect(screen.getByRole('combobox', { name: '自社所属' })).toHaveValue('true')
    expect(screen.getByRole('alert')).toHaveTextContent('保存済み')
  })
  it('shows only the exact selected person in mode without a nested directory', async () => {
    setup()
    const other = {
      ...review,
      documentId: '44444444-4444-4444-8444-444444444444',
      localIdentity: { ...review.localIdentity!, displayName: 'TEST Second Engineer' }
    }
    const view = render(<PersonnelWorkspace {...props()} initialDocumentId={documentId} reviews={[review, other]} />)
    expect(await screen.findByRole('heading', { name: '张伟' })).toBeVisible()
    expect(screen.queryByRole('complementary', { name: '要員一覧' })).not.toBeInTheDocument()
    expect(screen.queryByRole('textbox', { name: '要員を検索' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /選択した要員をコピー/ })).not.toBeInTheDocument()
    view.rerender(<PersonnelWorkspace {...props()} initialDocumentId={other.documentId} reviews={[review, other]} />)
    expect(screen.getByRole('heading', { name: 'TEST Second Engineer' })).toBeVisible()
    view.rerender(<PersonnelWorkspace {...props()} initialDocumentId={other.documentId} reviews={[review]} />)
    expect(screen.queryByRole('heading', { name: '张伟' })).not.toBeInTheDocument()
  })

  it('saves the business status in the panel without an extra confirmation, even before the profile is confirmed', async () => {
    const api = setup()
    render(
      <PersonnelWorkspace
        {...props()}
        initialDocumentId={documentId}
        reviews={[{ ...review, status: 'awaiting-review', piiReviewed: false }]}
      />
    )
    const save = await screen.findByRole('button', { name: '状態を保存' })
    await waitFor(() => expect(save).toBeEnabled())
    fireEvent.change(screen.getByLabelText('営業状態'), { target: { value: 'paused' } })
    fireEvent.click(save)
    await waitFor(() =>
      expect(api.setCandidateBusinessState).toHaveBeenCalledWith({
        documentId,
        profileVersion: 1,
        reviewRevision: 1,
        status: 'paused',
        confirmed: true
      })
    )
  })

  it.each([
    ['assigned', 'assigned' as const, false],
    ['paused', 'paused' as const, false],
    ['available', 'available' as const, true]
  ])('offers business actions for %s personnel only when they can be proposed', async (_name, status, canPropose) => {
    const api = setup()
    api.getPersonnelWorkspace.mockResolvedValue({
      templates: builtInPersonnelTemplates(),
      copies: [],
      states: [{ documentId, profileVersion: 1, status, confirmedAt: new Date().toISOString(), actorId: 'hr' }]
    })
    const callbacks = { ...props(), onMatch: vi.fn(), onPrepare: vi.fn() }
    render(<PersonnelWorkspace {...callbacks} initialDocumentId={documentId} />)
    await waitFor(() => expect(screen.getByLabelText('営業状態')).toHaveValue(status))
    const match = screen.getByRole('button', { name: '案件を探す' })
    if (canPropose) {
      await waitFor(() => expect(match).toBeEnabled())
      fireEvent.click(match)
      expect(callbacks.onMatch).toHaveBeenCalled()
    } else {
      expect(match).toBeDisabled()
      expect(screen.getByText(/参画中または営業停止中/)).toBeInTheDocument()
    }
    fireEvent.click(screen.getByRole('button', { name: 'プロフィールの確認・編集' }))
    expect(callbacks.onOpenProfile).toHaveBeenCalledWith(documentId)
    expect(api.setCandidateBusinessState).not.toHaveBeenCalled()
  })

  it('shows the kept case count and locks only while this person is being matched', async () => {
    setup()
    clearPersonCaseMatchCache()
    render(<PersonnelWorkspace {...props()} initialDocumentId={documentId} onMatch={vi.fn()} />)
    const match = await screen.findByRole('button', { name: '案件を探す' })
    await waitFor(() => expect(match).toBeEnabled())
    act(() => setPersonCaseMatchRunning(documentId, true))
    expect(screen.getByRole('button', { name: '案件を探しています…' })).toBeDisabled()
    act(() => {
      setPersonCaseMatchRunning(documentId, false)
      savePersonCaseMatch({
        ranAt: '2026-09-30T00:00:00Z',
        caseSignature: '',
        result: {
          documentId,
          profileVersion: 1,
          localMatchCount: 0,
          items: [],
          cloud: { status: 'not-needed', reviewedCount: 0, modelName: null }
        }
      })
    })
    expect(screen.getByRole('button', { name: '案件を見る (0)' })).toBeEnabled()
    act(() => setPersonCaseMatchRunning('44444444-4444-4444-8444-444444444444', true))
    expect(screen.getByRole('button', { name: '案件を見る (0)' })).toBeEnabled()
    act(() => clearPersonCaseMatchCache())
  })
})
