import { BusinessProgressContext, progressIndexes, type useBusinessProgressData } from '../business-progress-data'
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { beforeEach, expect, it, vi } from 'vitest'
import { builtInPersonnelTemplates, type BusinessFeedEntry, type BusinessFollowUp, type BusinessMatchingProgress, type CandidateReviewSnapshot, type DesktopApi, type JobCaseReviewSnapshot, type PersonnelCaseMatchResult } from '@shared'
import { HrObjectList } from './HrObjectList'
import { HrMatchingWorkspace } from './HrMatchingWorkspace'
import { HrFollowUps } from './HrFollowUps'
import { IntroductionComposer } from './IntroductionComposer'
import { CaseIntroductionComposer } from './CaseIntroductionComposer'
import { builtInBroadcastTemplate } from '@shared'
import { currentBusinessObjects, readHrPosition, saveHrPosition } from '../hr-business-navigation'
import { cardChangeLabels, cardSkillItems } from '../hr-card-presentation'

const documentId = '11111111-1111-4111-8111-111111111111'
const reviewId = '22222222-2222-4222-8222-222222222222'
const person = { documentId, fileName: 'Test Engineer', fields: [], projectExperiences: [], reviewRevision: 1, recordStatus: 'active', profile: { version: 1 }, isOwnCompany: null } as unknown as CandidateReviewSnapshot
const job = { reviewId, redactedSubject: 'Java project', fields: [], lifecycle: 'active', status: 'completed', reviewRevision: 1, jobCase: { id: '33333333-3333-4333-8333-333333333333', version: 1 } } as unknown as JobCaseReviewSnapshot
const entry = { kind: 'person', objectId: documentId, title: 'Same Name', revision: 'a'.repeat(64), source: 'local-personnel', sourceAt: '2026-09-01T00:00:00Z', occurredAt: '2026-09-01T00:00:00Z', event: 'created', businessStatus: 'available', unseen: false, deferred: false, archived: false, needsReview: false, fields: [], changes: [] } satisfies BusinessFeedEntry
const qualification = { policyVersion: 'mandatory-evidence-v1' as const, status: 'recommended' as const, requirements: [{ requirement: { id: 'R1', key: 'required_skills', label: 'Java', category: 'core' as const, alternatives: [['Java']], minimumYears: null, requiresPractice: false }, outcome: 'met' as const, evidence: 'Java', source: 'Project A' }] }
const result: PersonnelCaseMatchResult = { documentId, profileVersion: 1, localMatchCount: 1, cloud: { status: 'unavailable', reviewedCount: 0, modelName: null }, items: [{ reviewId, jobCaseId: job.jobCase!.id, jobCaseVersion: 1, title: 'Java project', score: 5, matched: ['Java'], missing: [], hardFilters: [], qualification }] }
let progress: (event: BusinessMatchingProgress) => void
beforeEach(() => {
  const values = new Map<string, string>()
  vi.stubGlobal('localStorage', { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => values.set(key, value), clear: () => values.clear() })
  Object.defineProperty(window, 'sesAgent', { configurable: true, value: {
    getBusinessFeed: vi.fn(async () => [entry]), markBusinessFeed: vi.fn(async () => []),
    getPersonnelWorkspace: vi.fn(async () => ({ templates: builtInPersonnelTemplates(), states: [], copies: [] })),
    onBusinessMatchingProgress: vi.fn((listener) => { progress = listener; return () => {} }),
    cancelBusinessMatching: vi.fn(async () => {}), findCasesForPersonnel: vi.fn(), findPersonnelForCase: vi.fn(),
    listBusinessFollowUps: vi.fn(async () => []), saveBusinessFollowUp: vi.fn(),
    validatePersonnelMessage: vi.fn(async (input) => input), recordPersonnelCopy: vi.fn(), openPersonnelEmail: vi.fn(), copyTextToClipboard: vi.fn(async () => {}),
    listBroadcastWorkspace: vi.fn(async () => ({ queue: [], templates: [builtInBroadcastTemplate()] })),
    draftCaseBroadcast: vi.fn(async () => ({ textJa: 'Java project', textZh: 'Java 案件', forbiddenJa: [], forbiddenZh: [] })),
    prepareCaseIntroduction: vi.fn(),
    validateCaseBroadcastMessage: vi.fn(async (input) => input), recordCaseBroadcastCopy: vi.fn(), openCaseBroadcastEmail: vi.fn()
  } as Partial<DesktopApi> })
})

it('shows zero recommendations and the missing Scala/Spark requirements without irrelevant action cards', async () => {
  vi.mocked(window.sesAgent.findCasesForPersonnel).mockResolvedValue({ ...result, items: [], searchedCount: 11, excludedCount: 11,
    excludedRequirements: ['Scala', 'Spark'], cloud: { status: 'not-needed', reviewedCount: 0, modelName: null } })
  render(<HrMatchingWorkspace source={{ kind: 'person', id: documentId, requestId: 101 }} cases={[job]} people={[person]} onBusy={vi.fn()} onView={vi.fn()} onPrepare={vi.fn()} onBack={vi.fn()} onFollowUp={vi.fn()} />)
  expect(await screen.findByText('紹介できる案件は見つかりませんでした')).toBeVisible()
  expect(screen.getByText('根拠不足・条件不一致：Scala、Spark')).toBeVisible()
  expect(screen.getByText('0 件の紹介候補')).toBeVisible()
  expect(screen.queryByRole('article')).not.toBeInTheDocument()
  expect(screen.queryByRole('button', { name: '紹介を準備' })).not.toBeInTheDocument()
})

it('lets HR independently introduce or follow up three condition-pending cases without changing AI qualifications', async () => {
  const jobs = Array.from({ length: 3 }, (_, i) => ({ ...job, reviewId: `22222222-2222-4222-8222-${String(i).padStart(12, '0')}`, redactedSubject: `Java case ${i}` }))
  const condition = { requirement: { id: 'R2', key: 'start_date', label: '9月', category: 'condition' as const, alternatives: [], minimumYears: null, requiresPractice: false }, outcome: 'unknown' as const, evidence: null, source: null }
  const pendingItems = jobs.map((item) => ({ ...result.items[0]!, reviewId: item.reviewId, qualification: { ...qualification, status: 'needs-confirmation' as const, requirements: [...qualification.requirements, condition] } }))
  vi.mocked(window.sesAgent.findCasesForPersonnel).mockResolvedValue({ ...result, items: pendingItems })
  const onPrepare = vi.fn(), onFollowUp = vi.fn(), onView = vi.fn()
  render(<HrMatchingWorkspace source={{ kind: 'person', id: documentId, requestId: 102 }} cases={jobs} people={[person]} onBusy={vi.fn()} onView={onView} onPrepare={onPrepare} onBack={vi.fn()} onFollowUp={onFollowUp} />)
  const area = within(await screen.findByRole('region', { name: '条件の相談が必要' }))
  expect(screen.queryByText('紹介できる案件は見つかりませんでした')).not.toBeInTheDocument()
  expect(screen.getByText('0 件の紹介候補')).toBeVisible()
  for (const [index, card] of area.getAllByRole('article').entries()) {
    expect(within(card).getByText('9月')).toBeVisible()
    fireEvent.click(within(card).getByRole('button', { name: '紹介を準備' }))
    expect(onPrepare).toHaveBeenLastCalledWith(expect.objectContaining({ documentId, reviewId: jobs[index]!.reviewId, profileVersion: 1, jobCaseVersion: 1, pendingConditions: ['9月'] }))
    fireEvent.click(within(card).getByRole('button', { name: '面談を予約' }))
    expect(onFollowUp).toHaveBeenLastCalledWith({ documentId, reviewId: jobs[index]!.reviewId, pendingConditions: ['9月'] })
    fireEvent.click(within(card).getByRole('button', { name: '情報を見る' }))
    expect(onView).toHaveBeenLastCalledWith('case', jobs[index]!.reviewId)
    await waitFor(() => expect(within(card).getByRole('button', {name:'面談を予約'})).toBeEnabled())
  }
  expect(onPrepare).toHaveBeenCalledTimes(3)
  expect(onFollowUp).toHaveBeenCalledTimes(3)
  expect(pendingItems.every((item) => item.qualification.status === 'needs-confirmation')).toBe(true)
  expect(window.sesAgent.saveBusinessFollowUp).not.toHaveBeenCalled()
})

it('keeps missing core skills and hard conflicts out of the condition-pending actions', async () => {
  const missing = { ...qualification.requirements[0]!, outcome: 'unknown' as const, evidence: null, source: null }
  const conflict = { ...qualification.requirements[0]!, requirement: { ...qualification.requirements[0]!.requirement, id: 'R2', key: 'own_company', category: 'condition' as const }, outcome: 'conflict' as const }
  vi.mocked(window.sesAgent.findCasesForPersonnel).mockResolvedValue({ ...result, items: [
    { ...result.items[0]!, qualification: { ...qualification, status: 'needs-confirmation', requirements: [missing] } },
    { ...result.items[0]!, qualification: { ...qualification, status: 'needs-confirmation', requirements: [...qualification.requirements, conflict] } }
  ] })
  render(<HrMatchingWorkspace source={{ kind: 'person', id: documentId, requestId: 104 }} cases={[job]} people={[person]} onBusy={vi.fn()} onView={vi.fn()} onPrepare={vi.fn()} onBack={vi.fn()} onFollowUp={vi.fn()} />)
  await screen.findByText('0 件の紹介候補')
  expect(screen.queryByRole('button', { name: '紹介を準備' })).not.toBeInTheDocument()
  expect(screen.queryByRole('button', { name: '面談を予約' })).not.toBeInTheDocument()
})

it('offers the same pending-condition next steps when a case searches for personnel', async () => {
  vi.mocked(window.sesAgent.findPersonnelForCase).mockResolvedValue({
    jobCaseId: job.jobCase!.id, jobCaseVersion: 1, localMatchCount: 1, cloud: result.cloud,
    items: [{ documentId, profileVersion: 1, score: 5, matched: ['Java'], missing: [], hardFilters: [],
      qualification: { ...qualification, status: 'needs-confirmation' },
      assessment: { confirm: ['開始日を相談'], gaps: [] } as unknown as NonNullable<typeof result.items[number]['assessment']> }]
  })
  const onPrepare = vi.fn(), onFollowUp = vi.fn()
  render(<HrMatchingWorkspace source={{ kind: 'case', id: job.jobCase!.id, requestId: 106 }} cases={[job]} people={[person]} onBusy={vi.fn()} onView={vi.fn()} onPrepare={onPrepare} onBack={vi.fn()} onFollowUp={onFollowUp} />)
  const card = within(await screen.findByRole('article'))
  expect(card.getByText('Test Engineer')).toBeVisible()
  fireEvent.click(card.getByRole('button', { name: '紹介を準備' }))
  expect(onPrepare).toHaveBeenCalledWith(expect.objectContaining({ documentId, reviewId, profileVersion: 1, jobCaseVersion: 1, pendingConditions: ['開始日を相談'] }))
  fireEvent.click(card.getByRole('button', { name: '面談を予約' }))
  expect(onFollowUp).toHaveBeenCalledWith({ documentId, reviewId, pendingConditions: ['開始日を相談'] })
})

it('labels ambiguous business values and avoids repeating them from AI confirmation notes', async () => {
  vi.mocked(window.sesAgent.findCasesForPersonnel).mockResolvedValue({ ...result, items: [{ ...result.items[0]!,
    qualification: { ...qualification, status: 'needs-confirmation', requirements: [...qualification.requirements, {
      requirement: { ...qualification.requirements[0]!.requirement, id: 'R2', key: 'remote', label: '無', category: 'condition' }, outcome: 'unknown', evidence: null, source: null
    }] }, assessment: { confirm: ['無', '现场出勤能否对应'], gaps: [] } as unknown as NonNullable<typeof result.items[number]['assessment']>
  }] })
  const onPrepare = vi.fn()
  render(<HrMatchingWorkspace source={{ kind: 'person', id: documentId, requestId: 107 }} cases={[{ ...job, fields: [{ key: 'remote', label: 'リモート', value: '無' } as typeof job.fields[number]] }]} people={[person]} onBusy={vi.fn()} onView={vi.fn()} onPrepare={onPrepare} onBack={vi.fn()} onFollowUp={vi.fn()} />)
  expect(await screen.findByText('リモート：無')).toBeVisible()
  expect(screen.queryByText('無')).not.toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: '紹介を準備' }))
  expect(onPrepare).toHaveBeenCalledWith(expect.objectContaining({ pendingConditions: ['リモート：無', '现场出勤能否对应'] }))
})

it('locks condition-pending next steps during matching and rejects changed versions', async () => {
  const pendingResult = { ...result, items: [{ ...result.items[0]!, qualification: { ...qualification, status: 'needs-confirmation' as const } }] }
  let finish!: (value: PersonnelCaseMatchResult) => void
  vi.mocked(window.sesAgent.findCasesForPersonnel).mockImplementation(() => new Promise((resolve) => { finish = resolve }))
  const props = { source: { kind: 'person' as const, id: documentId, requestId: 105 }, cases: [job], people: [person], onBusy: vi.fn(), onView: vi.fn(), onPrepare: vi.fn(), onBack: vi.fn(), onFollowUp: vi.fn() }
  const view = render(<HrMatchingWorkspace {...props} />)
  act(() => progress({ kind: 'person', id: documentId, result: pendingResult }))
  expect(screen.getByRole('button', { name: '紹介を準備' })).toBeDisabled()
  expect(screen.getByRole('button', { name: '面談を予約' })).toBeDisabled()
  await act(async () => finish(pendingResult))
  expect(screen.getByRole('button', { name: '紹介を準備' })).toBeEnabled()
  view.rerender(<HrMatchingWorkspace {...props} cases={[{ ...job, jobCase: { ...job.jobCase!, version: 2 } }]} />)
  expect(screen.queryByRole('button', { name: '紹介を準備' })).not.toBeInTheDocument()
  expect(screen.queryByRole('button', { name: '面談を予約' })).not.toBeInTheDocument()
})

it('refuses to display a legacy unqualified result as a recommendation', async () => {
  vi.mocked(window.sesAgent.findCasesForPersonnel).mockResolvedValue({ ...result, items: [{ ...result.items[0]!, qualification: undefined }] })
  render(<HrMatchingWorkspace source={{ kind: 'person', id: documentId, requestId: 103 }} cases={[job]} people={[person]} onBusy={vi.fn()} onView={vi.fn()} onPrepare={vi.fn()} onBack={vi.fn()} onFollowUp={vi.fn()} />)
  expect(await screen.findByText('情報が更新されました。再マッチングが必要です。')).toBeVisible()
  expect(screen.queryByRole('article')).not.toBeInTheDocument()
})

it('names real unread field changes without inventing changes from import or technical revisions', () => {
  const updated: BusinessFeedEntry = { ...entry, event: 'updated', unseen: true, changes: [
    { key: 'rate', before: '70万円', after: '80万円' },
    { key: 'availability', before: '即日', after: '10月' },
    { key: 'skills', before: 'Java', after: ' Java ' },
    { key: 'location', before: null, after: '東京' },
    { key: 'work_style', before: '常駐', after: null },
    { key: 'review_status', before: 'pending', after: 'completed' }
  ] }
  expect(cardChangeLabels(updated, true)).toEqual(['单价调整', '入场时间更新', '地点补充', '工作方式清空'])
  expect(cardChangeLabels(updated, false)).toEqual(['単価を変更', '稼働時期を変更', '勤務地を追加', '勤務形態を削除'])
  expect(cardChangeLabels({ ...updated, unseen: false }, true)).toEqual([])
  expect(cardChangeLabels({ ...updated, event: 'created' }, true)).toEqual([])
  expect(cardChangeLabels({ ...updated, changes: [] }, true)).toEqual([])
})

it('keeps full OR requirements and parenthesized skill lists intact in the compact presentation', async () => {
  expect(cardSkillItems('Java, SQL Server（SQL, T-SQL）, AWS')).toEqual(['Java', 'SQL Server（SQL, T-SQL）', 'AWS'])
  const requirements = 'FI 中上级SE\nBTP or Fiori or Cdsview\nアドオン設計者 or 品質レビューアー\nSAP S/4のFI知見があり、基本設計を自走できる方\nBTP or Fiori, Cdsviewの設計経験'
  expect(cardSkillItems(requirements).at(-1)).toBe('BTP or Fiori, Cdsviewの設計経験')
  vi.mocked(window.sesAgent.getBusinessFeed).mockResolvedValue([{ ...entry, kind: 'case', businessStatus: 'active', occurredAt: new Date().toISOString(),
    fields: [{ key: 'required_skills', value: requirements }, { key: 'rate', value: '80万円' }], event: 'updated', changes: [] }])
  const onOpen = vi.fn()
  render(<HrObjectList kind="case" reloadToken={0} candidates={[]} busy={false} onOpen={onOpen} onIntake={vi.fn()} onImportResume={vi.fn()} onRefresh={vi.fn()} />)
  const card = await screen.findByRole('article')
  expect(within(card).getByText('BTP or Fiori or Cdsview')).toBeVisible()
  const extra = within(card).getByText('BTP or Fiori, Cdsviewの設計経験')
  expect(extra).not.toBeVisible()
  fireEvent.click(within(card).getByText('残り 2 項目'))
  expect(extra).toBeVisible()
  expect(onOpen).not.toHaveBeenCalled()
  expect(within(card).getAllByRole('button')).toHaveLength(4)
  expect(within(card).queryByText(/情報が更新されました|取込済み/u)).not.toBeInTheDocument()
})

it('aggregates same IDs, keeps same-name people separate and buffers reordered updates', async () => {
  saveHrPosition('person', { timeRange: 'all' })
  const second = { ...entry, objectId: reviewId }
  vi.mocked(window.sesAgent.getBusinessFeed).mockResolvedValue([entry, { ...entry, revision: '0'.repeat(64), occurredAt: '2026-08-01T00:00:00Z' }, second])
  const props = { kind: 'person' as const, reloadToken: 0, candidates: [person, { ...person, documentId: reviewId, isOwnCompany: true }], busy: false, onOpen: vi.fn(), onIntake: vi.fn(), onImportResume: vi.fn(), onRefresh: vi.fn(async () => {}) }
  const view = render(<HrObjectList {...props} />)
  expect(await screen.findAllByRole('article', { name: 'Same Name' })).toHaveLength(2)
  const before = screen.getAllByRole('article')[0]!.textContent
  vi.mocked(window.sesAgent.getBusinessFeed).mockResolvedValue([entry, { ...second, title: 'Updated engineer', revision: 'b'.repeat(64), occurredAt: '2026-09-02T00:00:00Z' }])
  view.rerender(<HrObjectList {...props} reloadToken={1} />)
  await screen.findByText('更新情報があります')
  expect(screen.getAllByRole('article')[0]!.textContent).toBe(before)
  expect(screen.queryByRole('article', { name: 'Updated engineer' })).not.toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: '一覧を更新' }))
  expect(await screen.findByRole('article', { name: 'Updated engineer' })).toBe(screen.getAllByRole('article')[0])
  fireEvent.change(screen.getByRole('combobox', { name: '自社所属で絞り込み' }), { target: { value: 'unset' } })
  expect(screen.getAllByRole('article')).toHaveLength(1)
  expect(screen.getByRole('article')).toHaveTextContent('未設定')
})

it('retains the selected unread card while acknowledging it', async () => {
  saveHrPosition('person', { timeRange: 'all' })
  vi.mocked(window.sesAgent.getBusinessFeed).mockResolvedValue([{ ...entry, unseen: true }])
  vi.mocked(window.sesAgent.markBusinessFeed).mockResolvedValue([entry])
  render(<HrObjectList kind="person" reloadToken={0} candidates={[person]} selectedKey={`person:${documentId}`} busy={false} onOpen={vi.fn()} onIntake={vi.fn()} onImportResume={vi.fn()} onRefresh={vi.fn()} />)
  const card = await screen.findByRole('article')
  fireEvent.click(screen.getByRole('button', { name: '未読' }))
  fireEvent.click(card)
  await waitFor(() => expect(window.sesAgent.markBusinessFeed).toHaveBeenCalledTimes(1))
  expect(screen.getByRole('article')).toHaveAttribute('aria-current', 'true')
})

it('pages both lists, restores each page and keeps actions visible with matching disabled while busy', async () => {
  saveHrPosition('person', { timeRange: 'all' })
  const rows: BusinessFeedEntry[] = Array.from({ length: 45 }, (_, index) => ({ ...entry,
    objectId: `11111111-1111-4111-8111-${String(index).padStart(12, '0')}`, title: `Engineer ${index}` }))
  const cases: BusinessFeedEntry[] = rows.slice(0, 25).map((row) => ({ ...row, kind: 'case', businessStatus: 'active', occurredAt: new Date().toISOString(), title: `Case ${row.title}` }))
  vi.mocked(window.sesAgent.getBusinessFeed).mockResolvedValue([...rows, ...cases])
  const props = { kind: 'person' as const, reloadToken: 0, candidates: [], busy: true, onOpen: vi.fn(), onIntake: vi.fn(), onImportResume: vi.fn(), onRefresh: vi.fn() }
  const view = render(<HrObjectList {...props} />)
  expect(await screen.findAllByRole('article')).toHaveLength(20)
  const card = within(screen.getAllByRole('article')[0]!)
  expect(card.getByRole('button', { name: '詳細を見る' })).toBeVisible()
  expect(card.getByRole('button', { name: '紹介を準備' })).toBeVisible()
  expect(card.getByRole('button', { name: 'あとで対応' })).toBeVisible()
  fireEvent.click(card.getByRole('button', { name: '案件を探す' }))
  expect(props.onOpen).not.toHaveBeenCalled()
  fireEvent.click(screen.getByRole('button', { name: '次のページ' }))
  const selected = rows[20]!
  view.rerender(<HrObjectList {...props} selectedKey={`person:${selected.objectId}`} />)
  expect(screen.getByRole('article', { name: selected.title })).toHaveAttribute('aria-current', 'true')
  fireEvent.click(within(screen.getByRole('article', { name: selected.title })).getByRole('button', { name: '詳細を見る' }))
  expect(props.onOpen).toHaveBeenCalledWith(expect.objectContaining({ objectId: selected.objectId }), 'view')
  const scroller = view.container.querySelector('.hr-object-scroll')!
  fireEvent.scroll(scroller, { target: { scrollTop: 280 } })
  view.rerender(<HrObjectList {...props} kind="case" />)
  expect(screen.getByRole('navigation')).toHaveTextContent('1 / 2')
  view.rerender(<HrObjectList {...props} />)
  expect(screen.getByRole('navigation')).toHaveTextContent('2 / 3')
  expect(scroller.scrollTop).toBe(280)
  view.unmount()
  const restored = render(<HrObjectList {...props} />)
  await screen.findByRole('article', { name: selected.title })
  expect(screen.getByRole('navigation')).toHaveTextContent('2 / 3')
  expect(restored.container.querySelector('.hr-object-scroll')!.scrollTop).toBe(280)
  fireEvent.click(screen.getByRole('button', { name: '次のページ' }))
  expect(screen.getAllByRole('article')).toHaveLength(5)
  expect(screen.getByRole('button', { name: '次のページ' })).toBeDisabled()
  vi.mocked(window.sesAgent.getBusinessFeed).mockResolvedValue(rows.slice(0, 25))
  restored.rerender(<HrObjectList {...props} reloadToken={1} />)
  await waitFor(() => expect(screen.getByRole('navigation')).toHaveTextContent('2 / 2'))
  expect(screen.getAllByRole('article')).toHaveLength(5)
  fireEvent.change(screen.getByRole('textbox', { name: '案件・要員を検索' }), { target: { value: 'Engineer 0' } })
  expect(screen.getAllByRole('article')).toHaveLength(1)
  expect(screen.queryByRole('navigation')).not.toBeInTheDocument()
})

it('filters by local calendar days and restores independent case and personnel time ranges', async () => {
  const today = new Date(); today.setHours(0, 0, 0, 0)
  const atDay = (offset: number) => { const date = new Date(today); date.setDate(date.getDate() + offset); return date.toISOString() }
  const rows: BusinessFeedEntry[] = [0, -6, -7, -29, -30, 1].map((offset) => ({ ...entry,
    objectId: `day-${offset}`, title: `Day ${offset}`, occurredAt: atDay(offset) }))
  vi.mocked(window.sesAgent.getBusinessFeed).mockResolvedValue([...rows, { ...entry, kind: 'case', businessStatus: 'active' }])
  const props = { kind: 'person' as const, reloadToken: 0, candidates: [], busy: false, onOpen: vi.fn(), onIntake: vi.fn(), onImportResume: vi.fn(), onRefresh: vi.fn() }
  const view = render(<HrObjectList {...props} />)
  expect(await screen.findAllByRole('article')).toHaveLength(1)
  const range = screen.getByRole('combobox', { name: '一覧の期間' })
  expect(range).toHaveValue('today')
  expect(screen.getAllByRole('article')).toHaveLength(1)
  expect(screen.getByRole('article')).toHaveAccessibleName('Day 0')
  fireEvent.change(range, { target: { value: '7d' } })
  expect(screen.getAllByRole('article')).toHaveLength(2)
  fireEvent.change(range, { target: { value: '30d' } })
  expect(screen.getAllByRole('article')).toHaveLength(4)
  view.rerender(<HrObjectList {...props} kind="case" />)
  expect(range).toHaveValue('today')
  view.rerender(<HrObjectList {...props} />)
  expect(range).toHaveValue('30d')
  fireEvent.change(range, { target: { value: 'all' } })
  expect(screen.getAllByRole('article')).toHaveLength(6)
})

it('opens cases on today in descending time order without a matchability filter or import-review gate', async () => {
  const today = new Date(); today.setHours(0, 0, 0, 0)
  const atHour = (hour: number) => new Date(today.getTime() + hour * 3_600_000).toISOString()
  const cases: BusinessFeedEntry[] = [9, -1, 16, 0].map((hour) => ({ ...entry, kind: 'case', businessStatus: 'active',
    objectId: `case-${hour}`, title: `Case ${hour}`, needsReview: true, occurredAt: atHour(hour) }))
  vi.mocked(window.sesAgent.getBusinessFeed).mockResolvedValue(cases)
  const onOpen = vi.fn()
  render(<HrObjectList kind="case" reloadToken={0} candidates={[]} busy={false} onOpen={onOpen} onIntake={vi.fn()} onImportResume={vi.fn()} onRefresh={vi.fn()} />)
  expect(await screen.findAllByRole('article')).toHaveLength(3)
  expect(screen.getByRole('combobox', { name: '一覧の期間' })).toHaveValue('today')
  expect(screen.getByRole('button', { name: 'すべて' })).toHaveAttribute('aria-pressed', 'true')
  expect(screen.queryByRole('button', { name: 'マッチング可能' })).not.toBeInTheDocument()
  expect(screen.getAllByRole('article').map((card) => card.getAttribute('aria-label'))).toEqual(['Case 16', 'Case 9', 'Case 0'])
  const newest = within(screen.getAllByRole('article')[0]!)
  expect(newest.getByRole('button', { name: '要員を探す' })).toBeEnabled()
  fireEvent.click(newest.getByRole('button', { name: '要員を探す' }))
  expect(onOpen).toHaveBeenCalledWith(expect.objectContaining({ objectId: 'case-16' }), 'match')
  fireEvent.change(screen.getByRole('combobox', { name: '一覧の期間' }), { target: { value: 'all' } })
  expect(screen.getAllByRole('article').map((card) => card.getAttribute('aria-label'))).toEqual(['Case 16', 'Case 9', 'Case 0', 'Case -1'])
})

it('migrates the former available filter to the new defaults and retains later explicit choices', () => {
  localStorage.setItem('ses-hr-position-v2:case', JSON.stringify({ filter: 'available', timeRange: 'all', page: 3, scroll: 280, selected: `case:${reviewId}` }))
  localStorage.setItem('ses-hr-position-v2:person', JSON.stringify({ filter: 'available', timeRange: '7d' }))
  expect(readHrPosition('case')).toEqual({ filter: 'all', timeRange: 'today', page: 1, scroll: 0, selected: `case:${reviewId}` })
  expect(readHrPosition('person')).toMatchObject({ filter: 'all', timeRange: 'today' })
  saveHrPosition('case', { timeRange: '7d', page: 2, scroll: 120 })
  expect(readHrPosition('case')).toMatchObject({ filter: 'all', timeRange: '7d', page: 2, scroll: 120 })
})

it('migrates personnel to today without resetting saved case filters or later personnel choices', () => {
  localStorage.setItem('ses-hr-position-v3:person', JSON.stringify({ filter: 'unseen', timeRange: '30d', page: 4, scroll: 300, selected: `person:${reviewId}` }))
  localStorage.setItem('ses-hr-position-v3:case', JSON.stringify({ filter: 'all', timeRange: '7d', page: 2, scroll: 120, selected: null }))
  expect(readHrPosition('person')).toEqual({ filter: 'all', timeRange: 'today', page: 1, scroll: 0, selected: `person:${reviewId}` })
  expect(readHrPosition('case')).toMatchObject({ timeRange: '7d', page: 2, scroll: 120 })
  saveHrPosition('person', { timeRange: 'all' })
  expect(readHrPosition('person').timeRange).toBe('all')
})

it('compares actual timestamps across timezone offsets when picking latest revisions and sorting', () => {
  const early = { ...entry, occurredAt: '2026-09-09T08:00:00+09:00' }
  const newest = { ...early, objectId: reviewId, occurredAt: '2026-09-09T07:00:00Z' }
  const updated = { ...early, occurredAt: '2026-09-09T06:00:00Z', revision: 'b'.repeat(64) }
  expect(currentBusinessObjects([early, newest, updated])).toEqual([newest, updated])
})

it('shows local results during cloud work, ignores unrelated progress and invalidates changed target versions', async () => {
  let finish!: (value: PersonnelCaseMatchResult) => void
  vi.mocked(window.sesAgent.findCasesForPersonnel).mockImplementation(() => new Promise((resolve) => { finish = resolve }))
  const props = { source: { kind: 'person' as const, id: documentId, requestId: 1 }, cases: [job], people: [person], onBusy: vi.fn(), onView: vi.fn(), onPrepare: vi.fn(), onBack: vi.fn(), onFollowUp: vi.fn() }
  const view = render(<HrMatchingWorkspace {...props} />)
  act(() => progress({ kind: 'person', id: 'unrelated', result }))
  expect(screen.queryByRole('article')).not.toBeInTheDocument()
  act(() => progress({ kind: 'person', id: documentId, result }))
  expect(screen.getByText('ローカル検索完了、Cloud評価中…')).toBeVisible()
  expect(screen.getByRole('button', { name: '紹介を準備' })).toBeDisabled()
  fireEvent.click(screen.getByRole('button', { name: '停止' }))
  expect(window.sesAgent.cancelBusinessMatching).toHaveBeenCalledWith({ kind: 'person', id: documentId })
  await act(async () => finish(result))
  expect(screen.getByRole('button', { name: '紹介を準備' })).toBeEnabled()
  view.rerender(<HrMatchingWorkspace {...props} cases={[{ ...job, jobCase: { ...job.jobCase!, version: 2 } }]} />)
  expect(screen.getByText('情報が更新されました。再マッチングが必要です。')).toBeVisible()
  expect(screen.queryByRole('article')).not.toBeInTheDocument()
  expect(window.sesAgent.findCasesForPersonnel).toHaveBeenCalledTimes(1)
})

it('does not replay a consumed click when the matching view remounts', async () => {
  vi.mocked(window.sesAgent.findCasesForPersonnel).mockResolvedValue(result)
  const props = { source: { kind: 'person' as const, id: documentId, requestId: 2 }, cases: [job], people: [person], onBusy: vi.fn(), onView: vi.fn(), onPrepare: vi.fn(), onBack: vi.fn(), onFollowUp: vi.fn() }
  const first = render(<HrMatchingWorkspace {...props} />)
  await screen.findByRole('article')
  first.unmount()
  render(<HrMatchingWorkspace {...props} />)
  expect(window.sesAgent.findCasesForPersonnel).toHaveBeenCalledTimes(1)
  fireEvent.click(screen.getByRole('button', { name: '再マッチング' }))
  await waitFor(() => expect(window.sesAgent.findCasesForPersonnel).toHaveBeenCalledTimes(2))
})

it('preserves personnel edits across languages and blocks copy before Main validation succeeds', async () => {
  render(<IntroductionComposer target={{ documentId, profileVersion: 1, matched: [] }} people={[person]} cases={[job]} onClose={vi.fn()} onFollowUp={vi.fn()} />)
  await waitFor(() => expect(screen.getByRole('textbox', { name: '紹介文' })).not.toHaveValue(''))
  fireEvent.change(screen.getByRole('textbox', { name: '紹介文' }), { target: { value: 'Human draft' } })
  fireEvent.click(screen.getByRole('tab', { name: '中国語' }))
  fireEvent.click(screen.getByRole('tab', { name: '日本語' }))
  fireEvent.click(screen.getByRole('tab', { name: '簡潔' }))
  fireEvent.change(screen.getByRole('textbox', { name: '紹介文' }), { target: { value: 'Brief draft' } })
  fireEvent.keyDown(screen.getByRole('tab', { name: '簡潔' }), { key: 'ArrowLeft' })
  expect(screen.getByRole('tab', { name: '標準' })).toHaveAttribute('aria-selected', 'true')
  expect(screen.getByRole('textbox', { name: '紹介文' })).toHaveValue('Human draft')
  vi.mocked(window.sesAgent.validatePersonnelMessage).mockRejectedValue(new Error('stale profile'))
  fireEvent.click(screen.getByRole('button', { name: '紹介文をコピー' }))
  await screen.findByText('stale profile')
  expect(window.sesAgent.copyTextToClipboard).not.toHaveBeenCalled()
  expect(window.sesAgent.recordPersonnelCopy).not.toHaveBeenCalled()
  expect(window.sesAgent.saveBusinessFollowUp).not.toHaveBeenCalled()
})

it('shows case preparation errors in the open dialog and retries after reopening', async () => {
  const pending = { ...job, status: 'awaiting-review' as const, jobCase: null }
  const target = { reviewId, reviewRevision: 1, jobCaseVersion: null }
  vi.mocked(window.sesAgent.prepareCaseIntroduction).mockRejectedValueOnce(new Error('案件名は必須です。')).mockResolvedValue(job)
  const onPrepared = vi.fn()
  const props = { target, cases: [pending], onClose: vi.fn(), onPrepared }
  const view = render(<CaseIntroductionComposer {...props} />)
  expect(screen.getByRole('dialog', { name: '紹介を準備' })).toBeVisible()
  expect(await screen.findByRole('alert')).toHaveTextContent('案件名は必須です。')
  expect(screen.getByRole('button', { name: '紹介文をコピー' })).toBeDisabled()
  expect(screen.getByRole('button', { name: 'AIで再生成' })).toBeDisabled()
  expect(window.sesAgent.draftCaseBroadcast).not.toHaveBeenCalled()
  view.rerender(<CaseIntroductionComposer {...props} target={null} />)
  view.rerender(<CaseIntroductionComposer {...props} />)
  await waitFor(() => expect(onPrepared).toHaveBeenCalledWith(job))
  expect(window.sesAgent.prepareCaseIntroduction).toHaveBeenCalledTimes(2)
})

it('keeps all case conditions in the brief tab without another draft request and retains each edited version', async () => {
  const template = builtInBroadcastTemplate()
  const conditions = '【案件】Java\n必須：Java\n場所：東京\n単価：60万\n備考：自社社員のみ'
  vi.mocked(window.sesAgent.draftCaseBroadcast).mockResolvedValue({ textJa: `${conditions}\n\n${template.footerJa}`, textZh: '中文案件', forbiddenJa: [], forbiddenZh: [] })
  render(<CaseIntroductionComposer target={{ reviewId, jobCaseVersion: 1 }} cases={[job]} onClose={vi.fn()} />)
  const textbox = screen.getByRole('textbox', { name: '紹介文' })
  await waitFor(() => expect(textbox).toHaveValue(`${conditions}\n\n${template.footerJa}`))
  fireEvent.change(textbox, { target: { value: 'Standard edited' } })
  fireEvent.click(screen.getByRole('tab', { name: '簡潔' }))
  expect(textbox).toHaveValue(conditions)
  fireEvent.change(textbox, { target: { value: 'Brief edited' } })
  fireEvent.click(screen.getByRole('tab', { name: '中国語' }))
  expect(textbox).toHaveValue('中文案件')
  fireEvent.click(screen.getByRole('tab', { name: '日本語' }))
  expect(textbox).toHaveValue('Brief edited')
  fireEvent.click(screen.getByRole('tab', { name: '標準' }))
  expect(textbox).toHaveValue('Standard edited')
  expect(window.sesAgent.draftCaseBroadcast).toHaveBeenCalledTimes(1)
  expect(screen.queryByRole('combobox')).not.toBeInTheDocument()
})

it('keeps case drafts across closing and validates case and template versions before copying', async () => {
  const target = { reviewId, jobCaseVersion: 1 }
  const props = { target, cases: [job], onClose: vi.fn() }
  const view = render(<CaseIntroductionComposer {...props} />)
  await waitFor(() => expect(screen.getByRole('textbox', { name: '紹介文' })).toHaveValue('Java project'))
  fireEvent.change(screen.getByRole('textbox', { name: '紹介文' }), { target: { value: 'Human case draft' } })
  view.rerender(<CaseIntroductionComposer {...props} target={null} />)
  view.rerender(<CaseIntroductionComposer {...props} />)
  expect(screen.getByRole('textbox', { name: '紹介文' })).toHaveValue('Human case draft')
  fireEvent.click(screen.getByRole('button', { name: '紹介文をコピー' }))
  await waitFor(() => expect(window.sesAgent.recordCaseBroadcastCopy).toHaveBeenCalledTimes(1))
  expect(window.sesAgent.validateCaseBroadcastMessage).toHaveBeenCalledWith(expect.objectContaining({ reviewId, expectedJobCaseVersion: 1, expectedTemplateRevision: 1, text: 'Human case draft' }))
  expect(window.sesAgent.copyTextToClipboard).toHaveBeenCalledWith('Human case draft')
  expect(window.sesAgent.saveBusinessFollowUp).not.toHaveBeenCalled()
})

it('creates contact only on explicit save and preserves unsaved notes after a write failure', async () => {
  const props = { target: { documentId, reviewId }, reloadToken: 0, people: [person], cases: [job], onView: vi.fn(), onInterview: vi.fn() }
  render(<HrFollowUps {...props} />)
  const note = await screen.findByRole('textbox', { name: '今回のメモ' })
  expect(window.sesAgent.saveBusinessFollowUp).not.toHaveBeenCalled()
  fireEvent.change(note, { target: { value: 'Synthetic contact' } })
  vi.mocked(window.sesAgent.saveBusinessFollowUp).mockRejectedValueOnce(new Error('write failed'))
  fireEvent.click(screen.getByRole('button', { name: '対応記録を保存' }))
  await screen.findByText('write failed')
  expect(note).toHaveValue('Synthetic contact')
  const saved = { ...props.target, status: 'contacted', note: 'Synthetic contact', nextStep: '', revision: 1, id: 'follow-1', updatedAt: '2026-09-09T00:00:00Z', recordedBy: 'HR', events: [] } as BusinessFollowUp
  vi.mocked(window.sesAgent.saveBusinessFollowUp).mockResolvedValueOnce(saved)
  fireEvent.click(screen.getByRole('button', { name: '対応記録を保存' }))
  await screen.findByText('対応記録を保存しました')
  fireEvent.click(within(screen.getByRole('article')).getByRole('button', { name: '案件を見る' }))
  expect(props.onView).toHaveBeenCalledWith('case', reviewId)
})

it('regenerates an introduction through AI with request locking and preserves the draft on failure', async () => {
  let fail: (error: Error) => void = () => {}
  const regenerate = vi.fn().mockImplementationOnce(() => new Promise((_, reject) => { fail = reject })).mockResolvedValue({ text: 'AI generated introduction' })
  window.sesAgent.regenerateIntroduction = regenerate
  render(<IntroductionComposer target={{ documentId, profileVersion: 1, matched: [] }} people={[person]} cases={[]} onClose={vi.fn()} onFollowUp={vi.fn()} />)
  const text = await screen.findByRole('textbox', { name: '紹介文' })
  fireEvent.change(text, { target: { value: 'My existing draft' } })
  fireEvent.click(screen.getByRole('button', { name: 'AIで再生成' }))
  expect(screen.getByRole('button', { name: '処理中' })).toBeDisabled()
  await act(async () => fail(new Error('cloud unavailable')))
  expect(text).toHaveValue('My existing draft')
  fireEvent.click(screen.getByRole('button', { name: 'AIで再生成' }))
  await waitFor(() => expect(text).toHaveValue('AI generated introduction'))
  expect(regenerate).toHaveBeenCalledTimes(2)
})


it('retains pending conditions when preparing an introduction and opening follow-up without marking anything contacted', async () => {
  const onFollowUp = vi.fn()
  render(<IntroductionComposer target={{ documentId, reviewId, profileVersion: 1, jobCaseVersion: 1, matched: ['Java'], pendingConditions: ['9月入場', '単価相談'] }} people={[person]} cases={[job]} onClose={vi.fn()} onFollowUp={onFollowUp} />)
  await waitFor(() => expect((screen.getByRole('textbox', { name: '紹介文' }) as HTMLTextAreaElement).value).toContain('9月入場'))
  expect(screen.getByRole('complementary', { name: '相談する内容' })).toHaveTextContent('単価相談')
  fireEvent.click(screen.getByRole('button', { name: '面談を予約' }))
  expect(onFollowUp).toHaveBeenCalledWith({ documentId, reviewId, pendingConditions: ['9月入場', '単価相談'] })
  expect(window.sesAgent.saveBusinessFollowUp).not.toHaveBeenCalled()
  expect(window.sesAgent.openPersonnelEmail).not.toHaveBeenCalled()
})

it('keeps each case introduction draft independent when HR advances multiple cases', async () => {
  const secondJob = { ...job, reviewId: '22222222-2222-4222-8222-222222222223', redactedSubject: 'Second case' }
  const target = { documentId, reviewId, profileVersion: 1, jobCaseVersion: 1, matched: ['Java'], pendingConditions: ['9月入場'] }
  const props = { target, people: [person], cases: [job, secondJob], onClose: vi.fn(), onFollowUp: vi.fn() }
  const view = render(<IntroductionComposer {...props} />)
  await waitFor(() => expect((screen.getByRole('textbox', { name: '紹介文' }) as HTMLTextAreaElement).value).toContain('Java project'))
  fireEvent.change(screen.getByRole('textbox', { name: '紹介文' }), { target: { value: 'First case human draft' } })
  view.rerender(<IntroductionComposer {...props} target={{ ...target, reviewId: secondJob.reviewId, pendingConditions: ['単価相談'] }} />)
  expect((screen.getByRole('textbox', { name: '紹介文' }) as HTMLTextAreaElement).value).toContain('Second case')
  expect(screen.getByRole('complementary', { name: '相談する内容' })).toHaveTextContent('単価相談')
  fireEvent.change(screen.getByRole('textbox', { name: '紹介文' }), { target: { value: 'Second case human draft' } })
  view.rerender(<IntroductionComposer {...props} target={null} />)
  view.rerender(<IntroductionComposer {...props} />)
  expect(screen.getByRole('textbox', { name: '紹介文' })).toHaveValue('First case human draft')
  expect(screen.getByRole('complementary', { name: '相談する内容' })).toHaveTextContent('9月入場')
})

it('starts three selected matches once and disables all scheduling buttons while creating them', async () => {
  const jobs = Array.from({length:3},(_,i)=>({...job,reviewId:`22222222-2222-4222-8222-${String(i).padStart(12,'0')}`,redactedSubject:`Batch case ${i}`}))
  vi.mocked(window.sesAgent.findCasesForPersonnel).mockResolvedValue({...result,items:jobs.map(item=>({...result.items[0]!,reviewId:item.reviewId}))})
  let finish!:()=>void
  const many=vi.fn(()=>new Promise<void>(resolve=>{finish=resolve}))
  render(<HrMatchingWorkspace source={{kind:'person',id:documentId,requestId:9100}} cases={jobs} people={[person]} onBusy={vi.fn()} onView={vi.fn()} onPrepare={vi.fn()} onBack={vi.fn()} onFollowUp={vi.fn()} onScheduleMany={many}/>)
  const boxes=await screen.findAllByRole('checkbox',{name:'この候補を選択'})
  boxes.forEach(box=>fireEvent.click(box))
  fireEvent.click(screen.getByRole('button',{name:'選択した面談を手配 (3)'}))
  expect(many).toHaveBeenCalledWith(jobs.map(item=>({documentId,reviewId:item.reviewId})))
  const pending=screen.getByRole('button',{name:'準備中 (3)'})
  expect(pending).toBeDisabled();fireEvent.click(pending)
  expect(screen.getAllByRole('button',{name:'面談を予約'}).every(button=>button.hasAttribute('disabled'))).toBe(true)
  expect(many).toHaveBeenCalledTimes(1)
  await act(async()=>finish())
})


it('continues an existing pair from matching without starting another followup', async () => {
  vi.mocked(window.sesAgent.findCasesForPersonnel).mockResolvedValue(result)
  const row = { id: 'existing-pair', documentId, reviewId, revision: 3, status: 'interview', note: '', nextStep: '', recordedBy: 'HR', updatedAt: '2026-09-10T00:00:00Z' } as BusinessFollowUp
  const data = { rows: [row], indexes: progressIndexes([row]), now: new Date(), loading: false, failed: false, publish: vi.fn(), refresh: vi.fn() } as ReturnType<typeof useBusinessProgressData>
  const onContinue = vi.fn(), onFollowUp = vi.fn()
  render(<BusinessProgressContext.Provider value={data}><HrMatchingWorkspace source={{kind:'person',id:documentId,requestId:99999}} people={[person]} cases={[job]} onBusy={vi.fn()} onView={vi.fn()} onPrepare={vi.fn()} onBack={vi.fn()} onFollowUp={onFollowUp} onContinue={onContinue} onScheduleMany={vi.fn()}/></BusinessProgressContext.Provider>)
  const button = await screen.findByRole('button', {name:'対応を続ける'})
  expect(screen.getByText(/対応記録あり/)).toBeVisible()
  expect(screen.getByRole('checkbox')).toBeDisabled()
  fireEvent.click(button)
  expect(onContinue).toHaveBeenCalledWith({documentId,reviewId})
  expect(onFollowUp).not.toHaveBeenCalled()
})
