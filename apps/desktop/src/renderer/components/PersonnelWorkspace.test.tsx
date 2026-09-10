import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { builtInPersonnelTemplates, type CandidateBusinessState, type CandidateReviewSnapshot, type PersonnelCaseMatchResult } from '@shared'
import { PersonnelWorkspace } from './PersonnelWorkspace'
const documentId = '11111111-1111-4111-8111-111111111111'
const interviewId = '22222222-2222-4222-8222-222222222222'

const review: CandidateReviewSnapshot = {
  documentId,
  fileName: 'candidate.xlsx',
  reviewRevision: 1,
  status: 'completed',
  piiReviewed: true,
  localIdentity: {
    displayName: '张伟', gender: null, birthDate: null, nationality: null, phone: null, email: null,
    address: null, education: null, major: null, graduationDate: null, degree: null,
    storage: 'encrypted-local-only', cloudEligible: false
  },
  fields: [
    { key: 'skills', label: '技能', originalValue: 'Java, AWS', value: 'Java, AWS', confidence: 1, status: 'confirmed', sourceLabels: [], changed: false, changeReason: null },
    { key: 'experience_years', label: '经验', originalValue: '6年', value: '6年', confidence: 1, status: 'confirmed', sourceLabels: [], changed: false, changeReason: null },
    { key: 'availability', label: '可入场', originalValue: null, value: null, confidence: 0, status: 'confirmed', sourceLabels: [], changed: false, changeReason: null },
    { key: 'rate', label: '单价', originalValue: null, value: null, confidence: 0, status: 'confirmed', sourceLabels: [], changed: false, changeReason: null },
    { key: 'japanese_level', label: '日语', originalValue: 'N2', value: 'N2', confidence: 1, status: 'confirmed', sourceLabels: [], changed: false, changeReason: null },
    { key: 'work_style', label: '工作方式', originalValue: null, value: null, confidence: 0, status: 'confirmed', sourceLabels: [], changed: false, changeReason: null },
    { key: 'role', label: '角色', originalValue: 'Java开发工程师', value: 'Java开发工程师', confidence: 1, status: 'confirmed', sourceLabels: [], changed: false, changeReason: null },
    { key: 'location', label: '所在地', originalValue: '东京', value: '东京', confidence: 1, status: 'confirmed', sourceLabels: [], changed: false, changeReason: null },
    { key: 'work_authorization', label: '工作资格', originalValue: null, value: null, confidence: 0, status: 'confirmed', sourceLabels: [], changed: false, changeReason: null }
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


const props = () => ({ reviews: [review], onRefresh: vi.fn(async () => {}), onReview: vi.fn(async () => {}), onOpenCase: vi.fn(), onOpenProfile: vi.fn() })
const setup = (invalid = false) => {
  const api = {
    getPersonnelWorkspace: vi.fn(async () => ({ templates: builtInPersonnelTemplates(), states: [] as CandidateBusinessState[], copies: [] })),
    validatePersonnelMessage: vi.fn(async (input) => { if (invalid) throw new Error('profile changed'); return input }),
    recordPersonnelCopy: vi.fn(async () => ({})), copyTextToClipboard: vi.fn(async () => {}),
    setCandidateOwnCompany: vi.fn(async (input: { isOwnCompany: boolean | null }): Promise<CandidateReviewSnapshot> => ({ ...review, isOwnCompany: input.isOwnCompany, profile: { ...review.profile!, version: 2 } })),
    setCandidateBusinessState: vi.fn(async () => ({})), findCasesForPersonnel: vi.fn(async (): Promise<PersonnelCaseMatchResult> => ({ documentId, profileVersion: 1, items: [], localMatchCount: 0, cloud: { status: 'not-needed', reviewedCount: 0, modelName: null } }))
  }
  Object.defineProperty(window, 'sesAgent', { configurable: true, value: api })
  return api
}
describe('personnel workbench', () => {
  it('auto-saves affiliation only, blocks duplicate changes and uses the returned version for subsequent saves', async () => {
    const api = setup()
    let finish!: (value: CandidateReviewSnapshot) => void
    api.setCandidateOwnCompany.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve }))
    const callbacks = props()
    render(<PersonnelWorkspace {...callbacks} compact initialDocumentId={documentId} />)
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
    render(<PersonnelWorkspace {...props()} compact initialDocumentId={documentId} />)
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
    api.setCandidateOwnCompany.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve }))
    const other = { ...review, documentId: '44444444-4444-4444-8444-444444444444' }
    const callbacks = { ...props(), reviews: [review, other], onRefresh: vi.fn(async () => { throw new Error('refresh failed') }) }
    const view = render(<PersonnelWorkspace {...callbacks} compact initialDocumentId={documentId} />)
    fireEvent.change(await screen.findByRole('combobox', { name: '自社所属' }), { target: { value: 'true' } })
    view.rerender(<PersonnelWorkspace {...callbacks} compact initialDocumentId={other.documentId} />)
    finish({ ...review, isOwnCompany: true, profile: { ...review.profile!, version: 2 } })
    await waitFor(() => expect(screen.getByRole('combobox', { name: '自社所属' })).toBeEnabled())
    expect(screen.getByRole('combobox', { name: '自社所属' })).toHaveValue('')
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    view.rerender(<PersonnelWorkspace {...callbacks} compact initialDocumentId={documentId} />)
    expect(screen.getByRole('combobox', { name: '自社所属' })).toHaveValue('true')
    expect(screen.getByRole('alert')).toHaveTextContent('保存済み')
  })

  it('discards repeated matching intents while pending and unlocks after failure', async () => {
    const api = setup()
    let fail!: (cause: Error) => void
    api.findCasesForPersonnel.mockImplementationOnce(() => new Promise((_resolve, reject) => { fail = reject }))
    const callbacks = props()
    const onMatchingChange = vi.fn()
    const view = render(<PersonnelWorkspace {...callbacks} compact initialDocumentId={documentId} onMatchingChange={onMatchingChange} matchRequest={{ id: 1, documentId }} />)
    expect(await screen.findByRole('button', { name: 'マッチング中…' })).toBeDisabled()
    view.rerender(<PersonnelWorkspace {...callbacks} compact initialDocumentId={documentId} onMatchingChange={onMatchingChange} matchRequest={{ id: 2, documentId }} />)
    fail(new Error('Network failed'))
    expect(await screen.findByRole('alert')).toHaveTextContent('Network failed')
    await waitFor(() => expect(screen.getByRole('button', { name: 'この要員の案件を探す' })).toBeEnabled())
    expect(api.findCasesForPersonnel).toHaveBeenCalledTimes(1)
    expect(onMatchingChange.mock.calls.map(([id]) => id)).toEqual([documentId, null])
    fireEvent.click(screen.getByRole('button', { name: 'この要員の案件を探す' }))
    await waitFor(() => expect(api.findCasesForPersonnel).toHaveBeenCalledTimes(2))
  })

  it('keeps results bound to the original person when an AI reply arrives after switching selection', async () => {
    const api = setup()
    let finish!: (value: PersonnelCaseMatchResult) => void
    api.findCasesForPersonnel.mockImplementation(() => new Promise((resolve) => { finish = resolve }))
    const other = { ...review, documentId: '44444444-4444-4444-8444-444444444444', localIdentity: { ...review.localIdentity!, displayName: 'Second Engineer' } }
    const callbacks = props()
    const view = render(<PersonnelWorkspace {...callbacks} compact initialDocumentId={documentId} reviews={[review, other]} />)
    const find = await screen.findByRole('button', { name: 'この要員の案件を探す' })
    await waitFor(() => expect(find).toBeEnabled())
    fireEvent.click(find)
    expect(await screen.findByText('案件を絞り込み、Cloud AIで適合性を評価しています…')).toBeVisible()
    view.rerender(<PersonnelWorkspace {...callbacks} compact initialDocumentId={other.documentId} reviews={[review, other]} />)
    finish({ documentId, profileVersion: 1, localMatchCount: 1, cloud: { status: 'failed', reviewedCount: 0, modelName: null },
      items: [{ reviewId: 'case-review', jobCaseId: 'case', jobCaseVersion: 1, title: 'First person Java case', score: 90, matched: ['Java'], missing: [], hardFilters: [], qualification: { policyVersion: 'mandatory-evidence-v1', status: 'recommended', requirements: [] } }] })
    await waitFor(() => expect(screen.queryByText('マッチング中…')).not.toBeInTheDocument())
    expect(screen.queryByText('First person Java case')).not.toBeInTheDocument()
    view.rerender(<PersonnelWorkspace {...callbacks} compact initialDocumentId={documentId} reviews={[review, other]} />)
    expect(await screen.findByText('First person Java case')).toBeVisible()
    expect(screen.getByText('Cloud AIを利用できないため、以下はローカル検索結果です。')).toBeVisible()
    expect(api.findCasesForPersonnel).toHaveBeenCalledTimes(1)
    view.rerender(<PersonnelWorkspace {...callbacks} compact initialDocumentId={documentId} reviews={[{ ...review, profile: { ...review.profile!, version: 2 } }, other]} />)
    expect(screen.queryByText('First person Java case')).not.toBeInTheDocument()
  })

  it('shows only the exact selected person in compact mode without a nested directory', async () => {
    setup()
    const other = { ...review, documentId: '44444444-4444-4444-8444-444444444444', localIdentity: { ...review.localIdentity!, displayName: 'TEST Second Engineer' } }
    const onSelectPerson = vi.fn()
    const view = render(<PersonnelWorkspace {...props()} compact initialDocumentId={documentId} reviews={[review, other]} onSelectPerson={onSelectPerson} />)
    expect(await screen.findByRole('heading', { name: '张伟' })).toBeVisible()
    expect(screen.queryByRole('complementary', { name: '要員一覧' })).not.toBeInTheDocument()
    expect(screen.queryByRole('textbox', { name: '要員を検索' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /選択した要員をコピー/ })).not.toBeInTheDocument()
    expect(onSelectPerson).not.toHaveBeenCalled()
    view.rerender(<PersonnelWorkspace {...props()} compact initialDocumentId={other.documentId} reviews={[review, other]} onSelectPerson={onSelectPerson} />)
    expect(screen.getByRole('heading', { name: 'TEST Second Engineer' })).toBeVisible()
    view.rerender(<PersonnelWorkspace {...props()} compact initialDocumentId={other.documentId} reviews={[review]} onSelectPerson={onSelectPerson} />)
    expect(screen.queryByRole('heading', { name: '张伟' })).not.toBeInTheDocument()
  })

  it('copies a personnel template without selecting a case and records only after clipboard succeeds', async () => {
    const api = setup()
    render(<PersonnelWorkspace {...props()} />)
    fireEvent.click(await screen.findByRole('button', { name: '微信向けにコピー' }))
    await waitFor(() => expect(api.recordPersonnelCopy).toHaveBeenCalledTimes(1))
    const payload = api.validatePersonnelMessage.mock.calls[0]![0]
    expect(payload.text).toContain('Java, AWS')
    expect(payload.text).not.toContain('张伟')
    expect(payload).not.toHaveProperty('jobCaseId')
    expect(api.copyTextToClipboard.mock.invocationCallOrder[0]).toBeLessThan(api.recordPersonnelCopy.mock.invocationCallOrder[0]!)
  })
  it('does not copy or record when current profile validation fails', async () => {
    const api = setup(true)
    render(<PersonnelWorkspace {...props()} />)
    fireEvent.click(await screen.findByRole('button', { name: '微信向けにコピー' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('profile changed')
    expect(api.copyTextToClipboard).not.toHaveBeenCalled()
    expect(api.recordPersonnelCopy).not.toHaveBeenCalled()
  })
  it('saves the selected business status without an extra confirmation checkbox', async () => {
    const api = setup()
    render(<PersonnelWorkspace {...props()} />)
    const save = await screen.findByRole('button', { name: '状態を保存' })
    await waitFor(() => expect(save).toBeEnabled())
    fireEvent.change(screen.getByLabelText('営業状態'), { target: { value: 'paused' } })
    fireEvent.click(save)
    await waitFor(() => expect(api.setCandidateBusinessState).toHaveBeenCalledWith({ documentId, profileVersion: 1, reviewRevision: 1, status: 'paused', confirmed: true }))
  })
  it('excludes unavailable personnel by default and provides access to restore their status', async () => {
    const api = setup()
    api.getPersonnelWorkspace.mockResolvedValue({ templates: builtInPersonnelTemplates(), copies: [], states: [{ documentId, profileVersion: 1, status: 'assigned', confirmedAt: new Date().toISOString(), actorId: 'hr' }] })
    render(<PersonnelWorkspace {...props()} />)
    await waitFor(() => expect(api.getPersonnelWorkspace).toHaveBeenCalled())
    expect(screen.queryByRole('heading', { name: '张伟' })).not.toBeInTheDocument()
    fireEvent.change(screen.getByLabelText('営業状態の絞り込み'), { target: { value: 'all' } })
    expect(await screen.findByRole('heading', { name: '张伟' })).toBeVisible()
    expect(screen.getByLabelText('営業状態')).toHaveValue('assigned')
    expect(screen.getByRole('button', { name: '微信向けにコピー' })).toBeDisabled()
    expect(screen.getByRole('combobox', { name: '紹介テンプレート' })).toBeVisible()
  })
  it('can mark imported personnel unavailable without confirming their profile', async () => {
    const api = setup()
    render(<PersonnelWorkspace {...props()} initialDocumentId={documentId} reviews={[{ ...review, status: 'awaiting-review', piiReviewed: false }]} />)
    const save = await screen.findByRole('button', { name: '状態を保存' })
    await waitFor(() => expect(save).toBeEnabled())
    fireEvent.change(screen.getByLabelText('営業状態'), { target: { value: 'paused' } })
    fireEvent.click(save)
    await waitFor(() => expect(api.setCandidateBusinessState).toHaveBeenCalledWith({ documentId, profileVersion: 1, reviewRevision: 1, status: 'paused', confirmed: true }))
  })
  it.each([
    ['newly imported', { ...review, status: 'awaiting-review' as const, piiReviewed: false, talentPoolStatus: 'none' as const }, 'available' as const, true],
    ['outside the talent pool', { ...review, talentPoolStatus: 'none' as const }, 'available' as const, true],
    ['assigned', review, 'assigned' as const, false],
    ['paused', review, 'paused' as const, false],
    ['available', review, 'available' as const, true]
  ])('shows the same read-only promotion panel for %s personnel', async (_name, candidate, status, canPromote) => {
    const api = setup()
    api.getPersonnelWorkspace.mockResolvedValue({ templates: builtInPersonnelTemplates(), copies: [], states: [{ documentId, profileVersion: 1, status, confirmedAt: new Date().toISOString(), actorId: 'hr' }] })
    const callbacks = { ...props(), onOpenEditor: vi.fn() }
    render(<PersonnelWorkspace {...callbacks} compact initialDocumentId={documentId} reviews={[candidate]} />)
    expect(await screen.findByRole('combobox', { name: '紹介テンプレート' })).toBeVisible()
    expect(screen.getByRole('region', { name: '紹介文' })).toHaveTextContent('Java, AWS')
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument()
    expect(screen.queryByRole('combobox', { name: '営業状態' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '状態を保存' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'テンプレート編集' })).not.toBeInTheDocument()
    expect(screen.queryByText(/紹介可否が未確認|情報確認前のプレビュー/)).not.toBeInTheDocument()
    const copy = screen.getByRole('button', { name: '微信向けにコピー' })
    if (canPromote) expect(copy).toBeEnabled()
    else { expect(copy).toBeDisabled(); fireEvent.click(copy); expect(api.validatePersonnelMessage).not.toHaveBeenCalled() }
    fireEvent.click(screen.getByRole('button', { name: 'プロフィールの確認・編集' }))
    expect(callbacks.onOpenProfile).toHaveBeenCalledWith(documentId)
    fireEvent.click(screen.getByRole('button', { name: '状態を管理' }))
    expect(callbacks.onOpenEditor).toHaveBeenLastCalledWith({ documentId })
    fireEvent.change(screen.getByRole('combobox', { name: '紹介テンプレート' }), { target: { value: builtInPersonnelTemplates()[1]!.id } })
    fireEvent.change(screen.getByRole('combobox', { name: '言語' }), { target: { value: 'zh' } })
    fireEvent.click(screen.getByRole('button', { name: '文面・テンプレートを編集' }))
    expect(callbacks.onOpenEditor).toHaveBeenLastCalledWith({ documentId, templateId: builtInPersonnelTemplates()[1]!.id, lang: 'zh' })
    expect(api.setCandidateBusinessState).not.toHaveBeenCalled()
  })

  it('opens the exact person and preview settings in the full editor', async () => {
    setup()
    const other = { ...review, documentId: '44444444-4444-4444-8444-444444444444', localIdentity: { ...review.localIdentity!, displayName: 'Second Engineer' } }
    render(<PersonnelWorkspace {...props()} reviews={[review, other]} editorRequest={{ id: 1, documentId: other.documentId, templateId: builtInPersonnelTemplates()[1]!.id, lang: 'zh' }} />)
    expect(await screen.findByRole('heading', { name: 'Second Engineer' })).toBeVisible()
    expect(await screen.findByRole('combobox', { name: '紹介テンプレート' })).toHaveValue(builtInPersonnelTemplates()[1]!.id)
    expect((screen.getByRole('textbox', { name: '紹介文' }) as HTMLTextAreaElement).value).toContain('您好')
    expect(screen.getByRole('combobox', { name: '営業状態' })).toBeVisible()
  })
})
