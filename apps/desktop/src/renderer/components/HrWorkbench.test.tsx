import { BusinessProgressContext, progressIndexes, type useBusinessProgressData } from '../business-progress-data'
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { beforeEach, expect, it, vi } from 'vitest'
import {
  generatePersonnelProposal,
  builtInPersonnelTemplates,
  type BusinessFeedEntry,
  type BusinessFollowUp,
  type BusinessMatchingProgress,
  type CandidateReviewSnapshot,
  type DesktopApi,
  type JobCaseReviewSnapshot,
  type PersonnelCaseMatchResult
} from '@shared'
import { HrObjectList, hrListPageSizeKey } from './HrObjectList'
import { HrMatchingWorkspace } from './HrMatchingWorkspace'
import { clearPersonCaseMatchCache } from '../person-case-match-cache'
import { IntroductionComposer } from './IntroductionComposer'
import { CaseIntroductionComposer, clearCaseIntroductionSession } from './CaseIntroductionComposer'
import { builtInBroadcastTemplate } from '@shared'
import { currentBusinessObjects, readHrPosition, saveHrPosition } from '../hr-business-navigation'
import { cardChangeLabels, cardSkillItems } from '../hr-card-presentation'
import { UiLocaleProvider } from '../i18n'
import { BusinessHeaderActionsContext } from './business-header-actions'

const documentId = '11111111-1111-4111-8111-111111111111'
const reviewId = '22222222-2222-4222-8222-222222222222'
const person = {
  documentId,
  fileName: 'Test Engineer',
  fields: [],
  projectExperiences: [],
  reviewRevision: 1,
  recordStatus: 'active',
  profile: { version: 1 },
  isOwnCompany: null
} as unknown as CandidateReviewSnapshot
const job = {
  reviewId,
  redactedSubject: 'Java project',
  fields: [],
  lifecycle: 'active',
  status: 'completed',
  reviewRevision: 1,
  jobCase: { id: '33333333-3333-4333-8333-333333333333', version: 1 }
} as unknown as JobCaseReviewSnapshot
const entry = {
  kind: 'person',
  objectId: documentId,
  title: 'Same Name',
  revision: 'a'.repeat(64),
  source: 'local-personnel',
  sourceAt: '2026-09-01T00:00:00Z',
  occurredAt: '2026-09-01T00:00:00Z',
  event: 'created',
  businessStatus: 'available',
  unseen: false,
  deferred: false,
  archived: false,
  needsReview: false,
  fields: [],
  changes: []
} satisfies BusinessFeedEntry
const qualification = {
  policyVersion: 'technical-language-v5' as const,
  status: 'recommended' as const,
  requirements: [
    {
      requirement: {
        id: 'R1',
        key: 'required_skills',
        label: 'Java',
        category: 'core' as const,
        alternatives: [['Java']],
        minimumYears: null,
        requiresPractice: false
      },
      outcome: 'met' as const,
      evidence: 'Java',
      source: 'Project A'
    }
  ]
}
const result: PersonnelCaseMatchResult = {
  documentId,
  profileVersion: 1,
  localMatchCount: 1,
  cloud: { status: 'unavailable', reviewedCount: 0, modelName: null },
  items: [
    {
      reviewId,
      jobCaseId: job.jobCase!.id,
      jobCaseVersion: 1,
      title: 'Java project',
      score: 5,
      matched: ['Java'],
      missing: [],
      hardFilters: [],
      qualification
    }
  ]
}
let progress: (event: BusinessMatchingProgress) => void
/** Opens a card's 「…」 menu and returns it; secondary card actions live there. */
const openCardMenu = (card: HTMLElement) => {
  fireEvent.click(within(card).getByRole('button', { name: /^その他の操作/u }))
  return within(within(card).getByRole('menu'))
}
beforeEach(() => {
  clearCaseIntroductionSession()
  clearPersonCaseMatchCache()
  const values = new Map<string, string>()
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
    clear: () => values.clear()
  })
  Object.defineProperty(window, 'sesAgent', {
    configurable: true,
    value: {
      getBusinessFeed: vi.fn(async () => [entry]),
      markBusinessFeed: vi.fn(async () => []),
      getPersonnelWorkspace: vi.fn(async () => ({ templates: builtInPersonnelTemplates(), states: [], copies: [] })),
      regenerateIntroduction: vi.fn(async (input) => ({
        text: generatePersonnelProposal(
          person,
          input.caseContext
            ? { ...job, redactedSubject: input.caseContext.reviewId === reviewId ? 'Java project' : 'Second case' }
            : undefined,
          input.lang
        ).text
      })),
      onBusinessMatchingProgress: vi.fn((listener) => {
        progress = listener
        return () => {}
      }),
      cancelBusinessMatching: vi.fn(async () => {}),
      findCasesForPersonnel: vi.fn(),
      findPersonnelForCase: vi.fn(),
      listBusinessFollowUps: vi.fn(async () => []),
      saveBusinessFollowUp: vi.fn(),
      validatePersonnelMessage: vi.fn(async (input) => input),
      recordPersonnelCopy: vi.fn(),
      openPersonnelEmail: vi.fn(),
      copyTextToClipboard: vi.fn(async () => {}),
      listBroadcastWorkspace: vi.fn(async () => ({ queue: [], templates: [builtInBroadcastTemplate()] })),
      draftCaseBroadcast: vi.fn(async () => ({ textJa: 'Java project', textZh: 'Java 案件', forbiddenJa: [], forbiddenZh: [] })),
      prepareCaseIntroduction: vi.fn(),
      validateCaseBroadcastMessage: vi.fn(async (input) => input),
      recordCaseBroadcastCopy: vi.fn(),
      openCaseBroadcastEmail: vi.fn()
    } as Partial<DesktopApi>
  })
})

it('shows zero recommendations and the missing Scala/Spark requirements without irrelevant action cards', async () => {
  vi.mocked(window.sesAgent.findCasesForPersonnel).mockResolvedValue({
    ...result,
    items: [],
    searchedCount: 11,
    excludedCount: 11,
    excludedRequirements: ['Scala', 'Spark'],
    cloud: { status: 'not-needed', reviewedCount: 0, modelName: null }
  })
  render(
    <HrMatchingWorkspace
      source={{ kind: 'person', id: documentId, requestId: 101 }}
      cases={[job]}
      people={[person]}
      onBusy={vi.fn()}
      onView={vi.fn()}
      onPrepare={vi.fn()}
      onBack={vi.fn()}
      onFollowUp={vi.fn()}
    />
  )
  expect(await screen.findByText('紹介できる案件は見つかりませんでした')).toBeVisible()
  expect(screen.getByText('根拠不足・条件不一致：Scala、Spark')).toBeVisible()
  expect(screen.getByText('0 件の紹介候補')).toBeVisible()
  expect(screen.queryByRole('article')).not.toBeInTheDocument()
  expect(screen.queryByRole('button', { name: '紹介を準備' })).not.toBeInTheDocument()
})

it('lets HR independently introduce or follow up three condition-pending cases without changing AI qualifications', async () => {
  const jobs = Array.from({ length: 3 }, (_, i) => ({
    ...job,
    reviewId: `22222222-2222-4222-8222-${String(i).padStart(12, '0')}`,
    redactedSubject: `Java case ${i}`
  }))
  const condition = {
    requirement: {
      id: 'R2',
      key: 'start_date',
      label: '9月',
      category: 'condition' as const,
      alternatives: [],
      minimumYears: null,
      requiresPractice: false
    },
    outcome: 'unknown' as const,
    evidence: null,
    source: null
  }
  const pendingItems = jobs.map((item) => ({
    ...result.items[0]!,
    reviewId: item.reviewId,
    qualification: { ...qualification, status: 'recommended' as const, requirements: [...qualification.requirements, condition] }
  }))
  vi.mocked(window.sesAgent.findCasesForPersonnel).mockResolvedValue({ ...result, items: pendingItems })
  const onPrepare = vi.fn(),
    onFollowUp = vi.fn(),
    onView = vi.fn()
  render(
    <HrMatchingWorkspace
      source={{ kind: 'person', id: documentId, requestId: 102 }}
      cases={jobs}
      people={[person]}
      onBusy={vi.fn()}
      onView={onView}
      onPrepare={onPrepare}
      onBack={vi.fn()}
      onFollowUp={onFollowUp}
    />
  )
  await screen.findByText('3 件の紹介候補')
  const area = screen
  expect(screen.queryByText('紹介できる案件は見つかりませんでした')).not.toBeInTheDocument()
  expect(screen.getByText('3 件の紹介候補')).toBeVisible()
  const rows = within(area.getByRole('list', { name: '案件' }))
    .getAllByRole('button')
    .filter((item) => item.dataset.matchRow)
  expect(rows).toHaveLength(3)
  for (const [index, row] of rows.entries()) {
    fireEvent.click(row)
    const card = area.getByRole('article', { name: `Java case ${index}` })
    fireEvent.click(within(card).getByRole('tab', { name: '要相談 (1)' }))
    expect(within(card).getByText('9月')).toBeVisible()
    fireEvent.click(within(card).getByRole('button', { name: '紹介を準備' }))
    expect(onPrepare).toHaveBeenLastCalledWith(
      expect.objectContaining({
        documentId,
        reviewId: jobs[index]!.reviewId,
        profileVersion: 1,
        jobCaseVersion: 1,
        pendingConditions: ['9月']
      })
    )
    fireEvent.click(within(card).getByRole('button', { name: '対応を開始' }))
    expect(onFollowUp).toHaveBeenLastCalledWith({ documentId, reviewId: jobs[index]!.reviewId, pendingConditions: ['9月'] })
    fireEvent.click(within(card).getByRole('button', { name: /^その他の操作/u }))
    fireEvent.click(within(within(card).getByRole('menu')).getByRole('menuitem', { name: '案件を見る' }))
    expect(onView).toHaveBeenLastCalledWith('case', jobs[index]!.reviewId)
    await waitFor(() => expect(within(card).getByRole('button', { name: '対応を開始' })).toBeEnabled())
  }
  expect(onPrepare).toHaveBeenCalledTimes(3)
  expect(onFollowUp).toHaveBeenCalledTimes(3)
  expect(pendingItems.every((item) => item.qualification.status === 'recommended')).toBe(true)
  expect(window.sesAgent.saveBusinessFollowUp).not.toHaveBeenCalled()
})

it('keeps known technical and language shortfalls out of recommendation actions', async () => {
  const missing = { ...qualification.requirements[0]!, outcome: 'conflict' as const, evidence: null, source: null }
  const conflict = {
    ...qualification.requirements[0]!,
    requirement: {
      ...qualification.requirements[0]!.requirement,
      id: 'R2',
      key: 'japanese_level',
      label: '日本語N1流暢',
      category: 'condition' as const
    },
    outcome: 'conflict' as const
  }
  vi.mocked(window.sesAgent.findCasesForPersonnel).mockResolvedValue({
    ...result,
    items: [
      { ...result.items[0]!, qualification: { ...qualification, status: 'needs-confirmation', requirements: [missing] } },
      {
        ...result.items[0]!,
        qualification: { ...qualification, status: 'needs-confirmation', requirements: [...qualification.requirements, conflict] }
      }
    ]
  })
  render(
    <HrMatchingWorkspace
      source={{ kind: 'person', id: documentId, requestId: 104 }}
      cases={[job]}
      people={[person]}
      onBusy={vi.fn()}
      onView={vi.fn()}
      onPrepare={vi.fn()}
      onBack={vi.fn()}
      onFollowUp={vi.fn()}
    />
  )
  await screen.findByText('0 件の紹介候補')
  expect(screen.queryByRole('button', { name: '紹介を準備' })).not.toBeInTheDocument()
  expect(screen.queryByRole('button', { name: '対応を開始' })).not.toBeInTheDocument()
})

it('labels ambiguous business values and avoids repeating them from AI confirmation notes', async () => {
  vi.mocked(window.sesAgent.findCasesForPersonnel).mockResolvedValue({
    ...result,
    items: [
      {
        ...result.items[0]!,
        qualification: {
          ...qualification,
          status: 'recommended',
          requirements: [
            ...qualification.requirements,
            {
              requirement: { ...qualification.requirements[0]!.requirement, id: 'R2', key: 'remote', label: '無', category: 'condition' },
              outcome: 'unknown',
              evidence: null,
              source: null
            }
          ]
        },
        assessment: { confirm: ['無', '现场出勤能否对应'], gaps: [] } as unknown as NonNullable<(typeof result.items)[number]['assessment']>
      }
    ]
  })
  const onPrepare = vi.fn()
  render(
    <HrMatchingWorkspace
      source={{ kind: 'person', id: documentId, requestId: 107 }}
      cases={[{ ...job, fields: [{ key: 'remote', label: 'リモート', value: '無' } as (typeof job.fields)[number]] }]}
      people={[person]}
      onBusy={vi.fn()}
      onView={vi.fn()}
      onPrepare={onPrepare}
      onBack={vi.fn()}
      onFollowUp={vi.fn()}
    />
  )
  fireEvent.click(await screen.findByRole('tab', { name: '要相談 (1)' }))
  expect(screen.getByText('勤務形態：無')).toBeVisible()
  expect(screen.getByRole('rowheader', { name: 'リモート' })).toBeVisible()
  expect(screen.queryByText('無')).not.toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: '紹介を準備' }))
  expect(onPrepare).toHaveBeenCalledWith(expect.objectContaining({ pendingConditions: ['勤務形態：無'] }))
})

it('locks condition-pending next steps during matching and rejects changed versions', async () => {
  const pendingResult = {
    ...result,
    items: [{ ...result.items[0]!, qualification: { ...qualification, status: 'needs-confirmation' as const } }]
  }
  let finish!: (value: PersonnelCaseMatchResult) => void
  vi.mocked(window.sesAgent.findCasesForPersonnel).mockImplementation(
    () =>
      new Promise((resolve) => {
        finish = resolve
      })
  )
  const props = {
    source: { kind: 'person' as const, id: documentId, requestId: 105 },
    cases: [job],
    people: [person],
    onBusy: vi.fn(),
    onView: vi.fn(),
    onPrepare: vi.fn(),
    onBack: vi.fn(),
    onFollowUp: vi.fn()
  }
  const view = render(<HrMatchingWorkspace {...props} />)
  await waitFor(() => expect(window.sesAgent.findCasesForPersonnel).toHaveBeenCalled())
  act(() => progress({ kind: 'person', id: documentId, result: pendingResult }))
  expect(screen.getByRole('button', { name: '紹介を準備' })).toBeDisabled()
  expect(screen.getByRole('button', { name: '対応を開始' })).toBeDisabled()
  await act(async () => finish(pendingResult))
  expect(screen.getByRole('button', { name: '紹介を準備' })).toBeEnabled()
  view.rerender(<HrMatchingWorkspace {...props} cases={[{ ...job, jobCase: { ...job.jobCase!, version: 2 } }]} />)
  expect(screen.queryByRole('button', { name: '紹介を準備' })).not.toBeInTheDocument()
  expect(screen.queryByRole('button', { name: '対応を開始' })).not.toBeInTheDocument()
})

it('refuses to display a legacy unqualified result as a recommendation', async () => {
  vi.mocked(window.sesAgent.findCasesForPersonnel).mockResolvedValue({
    ...result,
    items: [{ ...result.items[0]!, qualification: undefined }]
  })
  render(
    <HrMatchingWorkspace
      source={{ kind: 'person', id: documentId, requestId: 103 }}
      cases={[job]}
      people={[person]}
      onBusy={vi.fn()}
      onView={vi.fn()}
      onPrepare={vi.fn()}
      onBack={vi.fn()}
      onFollowUp={vi.fn()}
    />
  )
  expect(await screen.findByText('情報またはAIルールが更新されました。案件を再検索してください。')).toBeVisible()
  expect(screen.queryByRole('article')).not.toBeInTheDocument()
})

it('names real unread field changes without inventing changes from import or technical revisions', () => {
  const updated: BusinessFeedEntry = {
    ...entry,
    event: 'updated',
    unseen: true,
    changes: [
      { key: 'rate', before: '70万円', after: '80万円' },
      { key: 'availability', before: '即日', after: '10月' },
      { key: 'skills', before: 'Java', after: ' Java ' },
      { key: 'location', before: null, after: '東京' },
      { key: 'work_style', before: '常駐', after: null },
      { key: 'review_status', before: 'pending', after: 'completed' }
    ]
  }
  expect(cardChangeLabels(updated, true)).toEqual(['单价调整', '入场时间更新', '地点补充', '工作方式清空'])
  expect(cardChangeLabels(updated, false)).toEqual(['単価を変更', '稼働時期を変更', '勤務地を追加', '勤務形態を削除'])
  expect(cardChangeLabels({ ...updated, unseen: false }, true)).toEqual([])
  expect(cardChangeLabels({ ...updated, event: 'created' }, true)).toEqual([])
  expect(cardChangeLabels({ ...updated, changes: [] }, true)).toEqual([])
})

it('keeps full OR requirements and parenthesized skill lists intact in the compact presentation', async () => {
  expect(cardSkillItems('Java, SQL Server（SQL, T-SQL）, AWS')).toEqual(['Java', 'SQL Server（SQL, T-SQL）', 'AWS'])
  const requirements =
    'FI 中上级SE\nBTP or Fiori or Cdsview\nアドオン設計者 or 品質レビューアー\nSAP S/4のFI知見があり、基本設計を自走できる方\nBTP or Fiori, Cdsviewの設計経験'
  expect(cardSkillItems(requirements).at(-1)).toBe('BTP or Fiori, Cdsviewの設計経験')
  vi.mocked(window.sesAgent.getBusinessFeed).mockResolvedValue([
    {
      ...entry,
      kind: 'case',
      businessStatus: 'active',
      working: true,
      occurredAt: new Date().toISOString(),
      fields: [
        { key: 'required_skills', value: `Java\nPython\n${requirements}` },
        { key: 'rate', value: '80万円' }
      ],
      event: 'updated',
      changes: []
    }
  ])
  const onOpen = vi.fn()
  render(
    <HrObjectList
      kind="case"
      reloadToken={0}
      candidates={[]}
      busy={false}
      onOpen={onOpen}
      onIntake={vi.fn()}
      onImportResume={vi.fn()}
      onRefresh={vi.fn()}
    />
  )
  const card = await screen.findByRole('article')
  expect(within(card).getByText('BTP or Fiori or Cdsview')).toBeVisible()
  // The card shows the first five requirements whole and counts the rest, which stay whole in its tooltip.
  expect(within(card).queryByText('BTP or Fiori, Cdsviewの設計経験')).not.toBeInTheDocument()
  const more = within(card).getByText('+2')
  expect(more).toHaveAttribute('title', expect.stringContaining('BTP or Fiori, Cdsviewの設計経験'))
  expect(more.getAttribute('title')!.split('\n')).toHaveLength(2)
  expect(onOpen).not.toHaveBeenCalled()
  expect(openCardMenu(card).getByRole('menuitem', { name: /^削除 /u })).toBeEnabled()
  expect(within(card).queryByText(/情報が更新されました|取込済み/u)).not.toBeInTheDocument()
})

it('shows Japanese case values in the Chinese UI with the stored wording on hover', async () => {
  vi.mocked(window.sesAgent.getBusinessFeed).mockResolvedValue([
    {
      ...entry,
      kind: 'case',
      businessStatus: 'active',
      working: true,
      occurredAt: new Date().toISOString(),
      fields: [
        { key: 'rate', value: 'スキル見合い' },
        { key: 'remote', value: '週3日リモート' },
        { key: 'location', value: '東京都港区' }
      ],
      changes: []
    }
  ])
  render(
    <UiLocaleProvider locale="zh-CN">
      <HrObjectList
        kind="case"
        reloadToken={0}
        candidates={[]}
        busy={false}
        onOpen={vi.fn()}
        onIntake={vi.fn()}
        onImportResume={vi.fn()}
        onRefresh={vi.fn()}
      />
    </UiLocaleProvider>
  )
  const card = await screen.findByRole('article')
  // Each value sits under its own label; the tooltip carries the full value and the stored wording, without an underline.
  expect(within(card).getByText('面议')).toHaveAttribute('title', '面议\nスキル見合い')
  expect(within(card).getByText('每周远程3天')).toHaveAttribute('title', '每周远程3天\n週3日リモート')
  expect(within(card).getByText('每周远程3天')).not.toHaveClass('is-normalized-value')
  expect(card.querySelector('.is-normalized-value')).toBeNull()
  expect(within(card).getByText('東京都港区')).toHaveAttribute('title', '東京都港区')
  const facts = [...card.querySelectorAll('.hr-card-fact')].map((fact) => [
    fact.querySelector('dt')!.textContent,
    fact.querySelector('dd')!.textContent
  ])
  expect(facts).toEqual([
    ['单价', '面议'],
    ['地点', '東京都港区'],
    ['工作方式', '每周远程3天'],
    ['开始', '—']
  ])
})

it('aggregates same IDs, keeps same-name people separate and buffers reordered updates', async () => {
  saveHrPosition('person', { timeRange: 'all' })
  const second = { ...entry, objectId: reviewId }
  vi.mocked(window.sesAgent.getBusinessFeed).mockResolvedValue([
    entry,
    { ...entry, revision: '0'.repeat(64), occurredAt: '2026-08-01T00:00:00Z' },
    second
  ])
  const props = {
    kind: 'person' as const,
    reloadToken: 0,
    candidates: [person, { ...person, documentId: reviewId, isOwnCompany: true }],
    busy: false,
    onOpen: vi.fn(),
    onIntake: vi.fn(),
    onImportResume: vi.fn(),
    onRefresh: vi.fn(async () => {})
  }
  const view = render(<HrObjectList {...props} />)
  expect(await screen.findAllByRole('article', { name: 'Same Name' })).toHaveLength(2)
  const before = screen.getAllByRole('article')[0]!.textContent
  vi.mocked(window.sesAgent.getBusinessFeed).mockResolvedValue([
    entry,
    { ...second, title: 'Updated engineer', revision: 'b'.repeat(64), occurredAt: '2026-09-02T00:00:00Z' }
  ])
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
  render(
    <HrObjectList
      kind="person"
      reloadToken={0}
      candidates={[person]}
      selectedKey={`person:${documentId}`}
      busy={false}
      onOpen={vi.fn()}
      onIntake={vi.fn()}
      onImportResume={vi.fn()}
      onRefresh={vi.fn()}
    />
  )
  const card = await screen.findByRole('article')
  fireEvent.click(screen.getByRole('button', { name: '未読' }))
  fireEvent.click(card)
  await waitFor(() => expect(window.sesAgent.markBusinessFeed).toHaveBeenCalledTimes(1))
  expect(screen.getByRole('article')).toHaveAttribute('aria-current', 'true')
})

it('pages both lists, restores each page and keeps actions visible with matching disabled while busy', async () => {
  saveHrPosition('person', { timeRange: 'all' })
  const rows: BusinessFeedEntry[] = Array.from({ length: 22 }, (_, index) => ({
    ...entry,
    objectId: `11111111-1111-4111-8111-${String(index).padStart(12, '0')}`,
    title: `Engineer ${index}`
  }))
  const cases: BusinessFeedEntry[] = rows.slice(0, 12).map((row) => ({
    ...row,
    kind: 'case',
    businessStatus: 'active',
    working: true,
    occurredAt: new Date().toISOString(),
    title: `Case ${row.title}`
  }))
  vi.mocked(window.sesAgent.getBusinessFeed).mockResolvedValue([...rows, ...cases])
  const props = {
    kind: 'person' as const,
    reloadToken: 0,
    candidates: [],
    busy: true,
    onOpen: vi.fn(),
    onIntake: vi.fn(),
    onImportResume: vi.fn(),
    onRefresh: vi.fn()
  }
  const view = render(<HrObjectList {...props} />)
  expect(await screen.findAllByRole('article')).toHaveLength(10)
  const card = within(screen.getAllByRole('article')[0]!)
  // A person card shows 紹介を準備 beside the primary; the rest of its actions are in 「…」.
  expect(card.getByRole('button', { name: '紹介を準備' })).toBeEnabled()
  const menu = openCardMenu(screen.getAllByRole('article')[0]!)
  // 稍后处理 sits on the card; the menu keeps only 删除.
  expect(menu.getAllByRole('menuitem').map((item) => item.textContent)).toEqual(['削除'])
  expect(card.getByRole('button', { name: 'あとで対応' })).toBeEnabled()
  expect(menu.queryByRole('menuitem', { name: '紹介を準備' })).not.toBeInTheDocument()
  expect(menu.getByRole('menuitem', { name: /^削除 /u })).toBeDisabled()
  const find = card.getByRole('button', { name: '案件を探す' })
  expect(find).toBeDisabled()
  expect(find).toHaveAccessibleDescription('評価中です。しばらくお待ちください')
  fireEvent.click(find)
  expect(props.onOpen).not.toHaveBeenCalled()
  fireEvent.click(screen.getByRole('button', { name: '次のページ' }))
  const selected = rows[10]!
  view.rerender(<HrObjectList {...props} selectedKey={`person:${selected.objectId}`} />)
  expect(screen.getByRole('article', { name: selected.title })).toHaveAttribute('aria-current', 'true')
  fireEvent.click(screen.getByRole('article', { name: selected.title }))
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
  expect(screen.getAllByRole('article')).toHaveLength(2)
  expect(screen.getByRole('button', { name: '次のページ' })).toBeDisabled()
  // ←/→ turn pages and a page number jumps straight to it.
  fireEvent.keyDown(document.body, { key: 'ArrowLeft' })
  expect(screen.getByRole('button', { name: '2 ページ目' })).toHaveAttribute('aria-current', 'page')
  fireEvent.click(screen.getByRole('button', { name: '1 ページ目' }))
  expect(screen.getByRole('navigation')).toHaveTextContent('1 / 3')
  // A larger page size is remembered.
  fireEvent.click(screen.getByRole('button', { name: '20 件ずつ表示' }))
  expect(screen.getAllByRole('article')).toHaveLength(20)
  expect(localStorage.getItem(hrListPageSizeKey)).toBe('20')
  expect(screen.getByRole('button', { name: '20 件ずつ表示' })).toHaveAttribute('aria-pressed', 'true')
  fireEvent.click(screen.getByRole('button', { name: '10 件ずつ表示' }))
  fireEvent.click(screen.getByRole('button', { name: '3 ページ目' }))
  vi.mocked(window.sesAgent.getBusinessFeed).mockResolvedValue(rows.slice(0, 12))
  restored.rerender(<HrObjectList {...props} reloadToken={1} />)
  await waitFor(() => expect(screen.getByRole('navigation')).toHaveTextContent('2 / 2'))
  expect(screen.getAllByRole('article')).toHaveLength(2)
  fireEvent.change(screen.getByRole('textbox', { name: '案件・要員を検索' }), { target: { value: 'Engineer 0' } })
  expect(screen.getAllByRole('article')).toHaveLength(1)
  expect(screen.queryByRole('navigation')).not.toBeInTheDocument()
})

it('filters by Tokyo calendar days and restores independent case and personnel time ranges', async () => {
  const tokyoToday = Date.parse(
    `${new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Tokyo', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date())}T00:00:00+09:00`
  )
  const atDay = (offset: number) => new Date(tokyoToday + offset * 86_400_000).toISOString()
  const rows: BusinessFeedEntry[] = [0, -6, -7, -29, -30, 1].map((offset) => ({
    ...entry,
    objectId: `day-${offset}`,
    title: `Day ${offset}`,
    occurredAt: atDay(offset)
  }))
  vi.mocked(window.sesAgent.getBusinessFeed).mockResolvedValue([
    ...rows,
    { ...entry, kind: 'case', businessStatus: 'active', working: true }
  ])
  const props = {
    kind: 'person' as const,
    reloadToken: 0,
    candidates: [],
    busy: false,
    onOpen: vi.fn(),
    onIntake: vi.fn(),
    onImportResume: vi.fn(),
    onRefresh: vi.fn()
  }
  const view = render(<HrObjectList {...props} />)
  expect(await screen.findAllByRole('article')).toHaveLength(6)
  const range = screen.getByRole('combobox', { name: '一覧の期間' })
  expect(range).toHaveValue('all')
  fireEvent.change(range, { target: { value: 'today' } })
  expect(screen.getAllByRole('article')).toHaveLength(1)
  expect(screen.getByRole('article')).toHaveAccessibleName('Day 0')
  fireEvent.change(range, { target: { value: '7d' } })
  expect(screen.getAllByRole('article')).toHaveLength(2)
  fireEvent.change(range, { target: { value: '30d' } })
  expect(screen.getAllByRole('article')).toHaveLength(4)
  view.rerender(<HrObjectList {...props} kind="case" />)
  expect(range).toHaveValue('all')
  view.rerender(<HrObjectList {...props} />)
  expect(range).toHaveValue('30d')
  fireEvent.change(range, { target: { value: 'all' } })
  expect(screen.getAllByRole('article')).toHaveLength(6)
})

it('opens cases on the working set, and "all" on every case in descending time order without a matchability filter or import-review gate', async () => {
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const atHour = (hour: number) => new Date(today.getTime() + hour * 3_600_000).toISOString()
  const cases: BusinessFeedEntry[] = [9, -1, 16, 0].map((hour) => ({
    ...entry,
    kind: 'case',
    businessStatus: 'active',
    objectId: `case-${hour}`,
    title: `Case ${hour}`,
    needsReview: true,
    occurredAt: atHour(hour)
  }))
  vi.mocked(window.sesAgent.getBusinessFeed).mockResolvedValue(cases)
  const onOpen = vi.fn()
  render(
    <HrObjectList
      kind="case"
      reloadToken={0}
      candidates={[]}
      busy={false}
      onOpen={onOpen}
      onIntake={vi.fn()}
      onImportResume={vi.fn()}
      onRefresh={vi.fn()}
    />
  )
  expect(await screen.findByText(/担当中の案件はまだありません/)).toBeInTheDocument()
  expect(screen.getByRole('button', { name: '担当中 0' })).toHaveAttribute('aria-pressed', 'true')
  expect(screen.queryByRole('article')).not.toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: '案件プール' }))
  expect(await screen.findAllByRole('article')).toHaveLength(4)
  expect(screen.getByRole('combobox', { name: '一覧の期間' })).toHaveValue('all')
  expect(screen.getByRole('button', { name: '案件プール' })).toHaveAttribute('aria-pressed', 'true')
  expect(screen.queryByRole('button', { name: 'マッチング可能' })).not.toBeInTheDocument()
  expect(screen.getAllByRole('article').map((card) => card.getAttribute('aria-label'))).toEqual(['Case 16', 'Case 9', 'Case 0', 'Case -1'])
  const newest = within(screen.getAllByRole('article')[0]!)
  expect(newest.getByRole('button', { name: '要員を探す' })).toBeEnabled()
  fireEvent.click(newest.getByRole('button', { name: '要員を探す' }))
  expect(onOpen).toHaveBeenCalledWith(expect.objectContaining({ objectId: 'case-16' }), 'match')
  fireEvent.change(screen.getByRole('combobox', { name: '一覧の期間' }), { target: { value: 'today' } })
  expect(screen.getAllByRole('article').map((card) => card.getAttribute('aria-label'))).toEqual(['Case 16', 'Case 9', 'Case 0'])
  // The count on unread follows the same time range as the list.
  expect(screen.getByRole('button', { name: '未読 0' })).toBeInTheDocument()
})

it('starts older saved positions once on every time, keeping only the selected object', () => {
  localStorage.setItem(
    'ses-hr-position-v3:case',
    JSON.stringify({ filter: 'all', timeRange: 'today', page: 3, scroll: 280, selected: `case:${reviewId}` })
  )
  localStorage.setItem(
    'ses-hr-position-v4:person',
    JSON.stringify({ filter: 'unseen', timeRange: 'today', page: 4, scroll: 300, selected: `person:${reviewId}` })
  )
  localStorage.setItem('ses-hr-position-v2:person', JSON.stringify({ filter: 'available', timeRange: '7d' }))
  expect(readHrPosition('case')).toEqual({ filter: 'working', timeRange: 'all', page: 1, scroll: 0, selected: `case:${reviewId}` })
  expect(readHrPosition('person')).toEqual({ filter: 'all', timeRange: 'all', page: 1, scroll: 0, selected: `person:${reviewId}` })
  saveHrPosition('case', { timeRange: '7d', page: 2, scroll: 120 })
  expect(readHrPosition('case')).toMatchObject({ filter: 'working', timeRange: '7d', page: 2, scroll: 120 })
  saveHrPosition('person', { filter: 'later', timeRange: 'today' })
  expect(readHrPosition('person')).toMatchObject({ filter: 'later', timeRange: 'today', selected: `person:${reviewId}` })
})

it('opens cases on my cases every time while people keep their saved filter', () => {
  saveHrPosition('case', { filter: 'unseen' })
  expect(readHrPosition('case').filter).toBe('working')
  localStorage.setItem('ses-hr-position-v5:person', JSON.stringify({ filter: 'working', timeRange: 'bogus' }))
  expect(readHrPosition('person')).toMatchObject({ filter: 'all', timeRange: 'all' })
})

it('compares actual timestamps across timezone offsets when picking latest revisions and sorting', () => {
  const early = { ...entry, occurredAt: '2026-09-09T08:00:00+09:00' }
  const newest = { ...early, objectId: reviewId, occurredAt: '2026-09-09T07:00:00Z' }
  const updated = { ...early, occurredAt: '2026-09-09T06:00:00Z', revision: 'b'.repeat(64) }
  expect(currentBusinessObjects([early, newest, updated])).toEqual([newest, updated])
})

it('shows local results during cloud work, ignores unrelated progress and invalidates changed target versions', async () => {
  let finish!: (value: PersonnelCaseMatchResult) => void
  vi.mocked(window.sesAgent.findCasesForPersonnel).mockImplementation(
    () =>
      new Promise((resolve) => {
        finish = resolve
      })
  )
  const props = {
    source: { kind: 'person' as const, id: documentId, requestId: 1 },
    cases: [job],
    people: [person],
    onBusy: vi.fn(),
    onView: vi.fn(),
    onPrepare: vi.fn(),
    onBack: vi.fn(),
    onFollowUp: vi.fn()
  }
  const view = render(<HrMatchingWorkspace {...props} />)
  await waitFor(() => expect(window.sesAgent.findCasesForPersonnel).toHaveBeenCalled())
  act(() => progress({ kind: 'person', id: 'unrelated', result }))
  expect(screen.queryByRole('article')).not.toBeInTheDocument()
  act(() => progress({ kind: 'person', id: documentId, result }))
  expect(screen.getByText('適合度を評価しています…')).toBeVisible()
  expect(screen.getByRole('button', { name: '紹介を準備' })).toBeDisabled()
  fireEvent.click(screen.getByRole('button', { name: '停止' }))
  expect(window.sesAgent.cancelBusinessMatching).toHaveBeenCalledWith({ kind: 'person', id: documentId })
  await act(async () => finish(result))
  expect(screen.getByRole('button', { name: '紹介を準備' })).toBeEnabled()
  view.rerender(<HrMatchingWorkspace {...props} cases={[{ ...job, jobCase: { ...job.jobCase!, version: 2 } }]} />)
  // An edited case drops out of the result with a note; the rest of the result is not locked.
  expect(screen.getByText('1 件の案件が終了・更新されたため結果から外しました')).toBeVisible()
  expect(screen.queryByRole('article')).not.toBeInTheDocument()
  expect(window.sesAgent.findCasesForPersonnel).toHaveBeenCalledTimes(1)
})

it('does not replay a consumed click when the matching view remounts', async () => {
  vi.mocked(window.sesAgent.findCasesForPersonnel).mockResolvedValue(result)
  const props = {
    source: { kind: 'person' as const, id: documentId, requestId: 2 },
    cases: [job],
    people: [person],
    onBusy: vi.fn(),
    onView: vi.fn(),
    onPrepare: vi.fn(),
    onBack: vi.fn(),
    onFollowUp: vi.fn()
  }
  const first = render(<HrMatchingWorkspace {...props} />)
  await screen.findByRole('article')
  first.unmount()
  render(<HrMatchingWorkspace {...props} />)
  expect(window.sesAgent.findCasesForPersonnel).toHaveBeenCalledTimes(1)
  // The kept result is shown right away with its run time; only 「重新找案件」 runs it again.
  expect(screen.getByRole('article')).toBeVisible()
  expect(screen.getByText(/前回の検索：/)).toBeVisible()
  const rerun = screen.getByRole('button', { name: '案件を再検索' })
  await waitFor(() => expect(rerun).toBeEnabled())
  fireEvent.click(rerun)
  await waitFor(() => expect(window.sesAgent.findCasesForPersonnel).toHaveBeenCalledTimes(2))
})

it('preserves personnel edits across languages and blocks copy before Main validation succeeds', async () => {
  render(
    <IntroductionComposer
      target={{ documentId, profileVersion: 1, matched: [] }}
      people={[person]}
      cases={[job]}
      onClose={vi.fn()}
      onFollowUp={vi.fn()}
    />
  )
  await waitFor(() => expect(screen.getByRole('textbox', { name: '紹介文' })).not.toHaveValue(''))
  fireEvent.change(screen.getByRole('textbox', { name: '紹介文' }), { target: { value: 'Human draft' } })
  fireEvent.click(screen.getByRole('tab', { name: '中国語' }))
  fireEvent.click(screen.getByRole('tab', { name: '日本語' }))
  fireEvent.click(screen.getByRole('tab', { name: '簡潔' }))
  await waitFor(() => expect(screen.getByRole('textbox', { name: '紹介文' })).toBeEnabled())
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

it('explains an AI sign-in failure once, offers sign-in and keeps the introduction editable by hand', async () => {
  vi.mocked(window.sesAgent.regenerateIntroduction).mockRejectedValue(
    new Error(
      "Error invoking remote method 'personnel:regenerate-introduction': AiCommerceRequestError: Please sign in to Member Center first."
    )
  )
  const signIn = vi.fn()
  window.addEventListener('ses-open-ai-sign-in', signIn)
  render(
    <IntroductionComposer
      target={{ documentId, profileVersion: 1, matched: [] }}
      people={[person]}
      cases={[job]}
      onClose={vi.fn()}
      onFollowUp={vi.fn()}
    />
  )
  const alert = await screen.findByText(/AIにログインしていないため、紹介文を自動生成できません/u)
  expect(screen.queryByText(/AiCommerceRequestError|Please sign in/u)).not.toBeInTheDocument()
  expect(screen.getAllByRole('alert')).toHaveLength(1)
  fireEvent.click(within(alert.closest('[role="alert"]') as HTMLElement).getByRole('button', { name: 'ログインする' }))
  expect(signIn).toHaveBeenCalledOnce()
  window.removeEventListener('ses-open-ai-sign-in', signIn)
  const body = screen.getByRole('textbox', { name: '紹介文' })
  expect(body).toBeEnabled()
  expect(screen.getByRole('button', { name: '紹介文をコピー' })).toBeDisabled()
  fireEvent.change(body, { target: { value: 'Handwritten introduction' } })
  expect(screen.getByRole('button', { name: '紹介文をコピー' })).toBeEnabled()
  expect(screen.getByRole('button', { name: 'メールを開く' })).toBeEnabled()
})

it('shows case preparation errors in the open dialog and retries after reopening', async () => {
  const pending = { ...job, status: 'awaiting-review' as const, jobCase: null }
  const target = { reviewId, reviewRevision: 1, jobCaseVersion: null }
  vi.mocked(window.sesAgent.prepareCaseIntroduction).mockRejectedValueOnce(new Error('案件名は必須です。')).mockResolvedValue(job)
  const onPrepared = vi.fn()
  const props = { target, cases: [pending], onClose: vi.fn(), onPrepared }
  const view = render(<CaseIntroductionComposer {...props} />)
  expect(screen.getByRole('dialog', { name: '案件を配信' })).toBeVisible()
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
  vi.mocked(window.sesAgent.draftCaseBroadcast).mockResolvedValue({
    textJa: `${conditions}\n\n${template.footerJa}`,
    textZh: '中文案件',
    forbiddenJa: [],
    forbiddenZh: []
  })
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
  expect(window.sesAgent.validateCaseBroadcastMessage).toHaveBeenCalledWith(
    expect.objectContaining({ reviewId, expectedJobCaseVersion: 1, expectedTemplateRevision: 1, text: 'Human case draft' })
  )
  expect(window.sesAgent.copyTextToClipboard).toHaveBeenCalledWith('Human case draft')
  expect(window.sesAgent.saveBusinessFollowUp).not.toHaveBeenCalled()
})

it('retains pending conditions when preparing an introduction and opening follow-up without marking anything contacted', async () => {
  const onFollowUp = vi.fn()
  render(
    <IntroductionComposer
      target={{ documentId, reviewId, profileVersion: 1, jobCaseVersion: 1, matched: ['Java'], pendingConditions: ['9月入場', '単価相談'] }}
      people={[person]}
      cases={[job]}
      onClose={vi.fn()}
      onFollowUp={onFollowUp}
    />
  )
  await waitFor(() =>
    expect((screen.getByRole('textbox', { name: '紹介文' }) as HTMLTextAreaElement).value).toContain('■案件とのマッチポイント')
  )
  expect((screen.getByRole('textbox', { name: '紹介文' }) as HTMLTextAreaElement).value).not.toContain('9月入場')
  expect(screen.getByRole('complementary', { name: '相談する内容' })).toHaveTextContent('単価相談')
  fireEvent.click(screen.getByRole('button', { name: '対応を開始' }))
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
  await waitFor(() => expect((screen.getByRole('textbox', { name: '紹介文' }) as HTMLTextAreaElement).value).toContain('Second case'))
  expect(screen.getByRole('complementary', { name: '相談する内容' })).toHaveTextContent('単価相談')
  fireEvent.change(screen.getByRole('textbox', { name: '紹介文' }), { target: { value: 'Second case human draft' } })
  view.rerender(<IntroductionComposer {...props} target={null} />)
  view.rerender(<IntroductionComposer {...props} />)
  expect(screen.getByRole('textbox', { name: '紹介文' })).toHaveValue('First case human draft')
  expect(screen.getByRole('complementary', { name: '相談する内容' })).toHaveTextContent('9月入場')
})

it('starts three selected matches once and disables all scheduling buttons while creating them', async () => {
  const jobs = Array.from({ length: 3 }, (_, i) => ({
    ...job,
    reviewId: `22222222-2222-4222-8222-${String(i).padStart(12, '0')}`,
    redactedSubject: `Batch case ${i}`
  }))
  vi.mocked(window.sesAgent.findCasesForPersonnel).mockResolvedValue({
    ...result,
    items: jobs.map((item) => ({ ...result.items[0]!, reviewId: item.reviewId }))
  })
  let finish!: () => void
  const many = vi.fn(
    () =>
      new Promise<void>((resolve) => {
        finish = resolve
      })
  )
  render(
    <HrMatchingWorkspace
      source={{ kind: 'person', id: documentId, requestId: 9100 }}
      cases={jobs}
      people={[person]}
      onBusy={vi.fn()}
      onView={vi.fn()}
      onPrepare={vi.fn()}
      onBack={vi.fn()}
      onFollowUp={vi.fn()}
      onScheduleMany={many}
    />
  )
  const boxes = await screen.findAllByRole('checkbox', { name: 'この案件を選択' })
  boxes.forEach((box) => fireEvent.click(box))
  fireEvent.click(screen.getByRole('button', { name: '選択した案件の対応を開始（3）' }))
  expect(many).toHaveBeenCalledWith(jobs.map((item) => ({ documentId, reviewId: item.reviewId })))
  const pending = screen.getByRole('button', { name: '開始中（3）' })
  expect(pending).toBeDisabled()
  fireEvent.click(pending)
  expect(screen.getAllByRole('button', { name: '対応を開始' }).every((button) => button.hasAttribute('disabled'))).toBe(true)
  expect(many).toHaveBeenCalledTimes(1)
  await act(async () => finish())
})

it('continues an existing pair from matching without starting another followup', async () => {
  vi.mocked(window.sesAgent.findCasesForPersonnel).mockResolvedValue(result)
  const row = {
    id: 'existing-pair',
    documentId,
    reviewId,
    revision: 3,
    status: 'interview',
    note: '',
    nextStep: '',
    recordedBy: 'HR',
    updatedAt: '2026-09-10T00:00:00Z'
  } as BusinessFollowUp
  const data = {
    rows: [row],
    indexes: progressIndexes([row]),
    now: new Date(),
    loading: false,
    failed: false,
    publish: vi.fn(),
    refresh: vi.fn(),
    remove: vi.fn()
  } as ReturnType<typeof useBusinessProgressData>
  const onContinue = vi.fn(),
    onFollowUp = vi.fn()
  render(
    <BusinessProgressContext.Provider value={data}>
      <HrMatchingWorkspace
        source={{ kind: 'person', id: documentId, requestId: 99999 }}
        people={[person]}
        cases={[job]}
        onBusy={vi.fn()}
        onView={vi.fn()}
        onPrepare={vi.fn()}
        onBack={vi.fn()}
        onFollowUp={onFollowUp}
        onContinue={onContinue}
        onScheduleMany={vi.fn()}
      />
    </BusinessProgressContext.Provider>
  )
  const button = await screen.findByRole('button', { name: '対応を続ける' })
  expect(screen.getByText(/対応記録あり/)).toBeVisible()
  expect(screen.getByRole('checkbox')).toBeDisabled()
  fireEvent.click(button)
  expect(onContinue).toHaveBeenCalledWith({ documentId, reviewId })
  expect(onFollowUp).not.toHaveBeenCalled()
})

it('accepts resume files on a case card and never bubbles them into generic attachment handling', async () => {
  const caseEntry = {
    ...entry,
    kind: 'case' as const,
    objectId: reviewId,
    title: 'Java project',
    businessStatus: 'active' as const,
    working: true,
    occurredAt: new Date().toISOString()
  }
  vi.mocked(window.sesAgent.getBusinessFeed).mockResolvedValue([caseEntry])
  const onDrop = vi.fn(),
    onAssess = vi.fn()
  render(
    <div onDrop={onDrop}>
      <HrObjectList
        kind="case"
        cases={[job]}
        reloadToken={0}
        candidates={[]}
        busy={false}
        onOpen={vi.fn()}
        onIntake={vi.fn()}
        onImportResume={vi.fn()}
        onRefresh={vi.fn()}
        onAssessResumes={onAssess}
      />
    </div>
  )
  const card = await screen.findByRole('article', { name: 'Java project' })
  const resume = new File(['resume'], 'resume.xlsx')
  fireEvent.dragOver(card, { dataTransfer: { types: ['Files'], dropEffect: 'none' } })
  expect(card).toHaveClass('is-resume-drag-target')
  fireEvent.drop(card, { dataTransfer: { files: [resume], types: ['Files'] } })
  expect(onAssess).toHaveBeenCalledWith(caseEntry, [resume])
  expect(onDrop).not.toHaveBeenCalled()
  fireEvent.drop(card.closest('.hr-object-list')!, { dataTransfer: { files: [resume], types: ['Files'] } })
  expect(onAssess).toHaveBeenCalledTimes(1)
  expect(onDrop).not.toHaveBeenCalled()
})

const workingCase = (id: string, working: boolean): BusinessFeedEntry =>
  ({
    ...entry,
    kind: 'case',
    objectId: id,
    title: `Case ${id}`,
    businessStatus: 'active',
    working,
    occurredAt: new Date().toISOString()
  }) as BusinessFeedEntry
const caseTitles = () => screen.queryAllByRole('article').map((card) => card.getAttribute('aria-label'))
it('opens on the working set and adds, removes and undoes membership without a confirmation', async () => {
  vi.mocked(window.sesAgent.getBusinessFeed).mockResolvedValue([workingCase('a', false), workingCase('b', true)])
  window.sesAgent.setCaseWorking = vi.fn(async (input) => input)
  render(
    <HrObjectList
      kind="case"
      reloadToken={0}
      candidates={[]}
      busy={false}
      onOpen={vi.fn()}
      onIntake={vi.fn()}
      onImportResume={vi.fn()}
      onRefresh={vi.fn()}
    />
  )
  await waitFor(() => expect(caseTitles()).toEqual(['Case b']))
  expect(screen.getByRole('button', { name: '担当中 1' })).toHaveAttribute('aria-pressed', 'true')
  expect(screen.queryByRole('combobox', { name: '一覧の期間' })).not.toBeInTheDocument()
  expect(screen.queryByRole('button', { name: 'あとで対応' })).not.toBeInTheDocument()
  fireEvent.click(openCardMenu(screen.getByRole('article', { name: 'Case b' })).getByRole('menuitem', { name: '案件プールに戻す' }))
  await waitFor(() => expect(caseTitles()).toEqual([]))
  expect(window.sesAgent.setCaseWorking).toHaveBeenLastCalledWith({ reviewId: 'b', working: false })
  fireEvent.click(screen.getByRole('button', { name: '元に戻す' }))
  await waitFor(() => expect(caseTitles()).toEqual(['Case b']))
  expect(window.sesAgent.setCaseWorking).toHaveBeenLastCalledWith({ reviewId: 'b', working: true })
  expect(screen.queryByRole('button', { name: '元に戻す' })).not.toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: '案件プール' }))
  // 「全部」 lists only cases not in my cases; joining moves a case out of it.
  await waitFor(() => expect(caseTitles()).toEqual(['Case a']))
  fireEvent.click(within(screen.getByRole('article', { name: 'Case a' })).getByRole('button', { name: '担当する' }))
  await waitFor(() => expect(window.sesAgent.setCaseWorking).toHaveBeenLastCalledWith({ reviewId: 'a', working: true }))
  await waitFor(() => expect(caseTitles()).toEqual([]))
  fireEvent.click(await screen.findByRole('button', { name: '担当中 2' }))
  expect(caseTitles()).toEqual(expect.arrayContaining(['Case a', 'Case b']))
  // Removing it from my cases brings it back to 「全部」.
  fireEvent.click(openCardMenu(screen.getByRole('article', { name: 'Case a' })).getByRole('menuitem', { name: '案件プールに戻す' }))
  await waitFor(() => expect(window.sesAgent.setCaseWorking).toHaveBeenLastCalledWith({ reviewId: 'a', working: false }))
  fireEvent.click(screen.getByRole('button', { name: '案件プール' }))
  await waitFor(() => expect(caseTitles()).toEqual(['Case a']))
})
it('returns to the working set each time the list is shown again', async () => {
  vi.mocked(window.sesAgent.getBusinessFeed).mockResolvedValue([workingCase('a', false), workingCase('b', true)])
  const props = {
    kind: 'case' as const,
    reloadToken: 0,
    candidates: [],
    busy: false,
    onOpen: vi.fn(),
    onIntake: vi.fn(),
    onImportResume: vi.fn(),
    onRefresh: vi.fn()
  }
  const view = render(<HrObjectList {...props} active />)
  await waitFor(() => expect(caseTitles()).toEqual(['Case b']))
  fireEvent.click(screen.getByRole('button', { name: '案件プール' }))
  await waitFor(() => expect(caseTitles()).toEqual(['Case a']))
  view.rerender(<HrObjectList {...props} active={false} />)
  view.rerender(<HrObjectList {...props} active />)
  await waitFor(() => expect(caseTitles()).toEqual(['Case b']))
  expect(screen.getByRole('button', { name: '担当中 1' })).toHaveAttribute('aria-pressed', 'true')
})
it('suggests, but never performs, removal once every follow-up of a working case has ended', async () => {
  vi.mocked(window.sesAgent.getBusinessFeed).mockResolvedValue([workingCase('b', true)])
  window.sesAgent.setCaseWorking = vi.fn()
  const ended = {
    id: 'f',
    documentId,
    reviewId: 'b',
    revision: 1,
    status: 'closed',
    note: '',
    nextStep: '',
    recordedBy: 'HR',
    updatedAt: new Date().toISOString(),
    events: [],
    progress: { stage: 'closed', rounds: [], candidateAvailability: '', clientAvailability: '', pendingConditions: [], entry: null }
  } as unknown as BusinessFollowUp
  const data = {
    rows: [ended],
    indexes: progressIndexes([ended]),
    now: new Date(),
    loading: false,
    failed: false,
    publish: vi.fn(),
    refresh: vi.fn(),
    remove: vi.fn()
  } as ReturnType<typeof useBusinessProgressData>
  render(
    <BusinessProgressContext.Provider value={data}>
      <HrObjectList
        kind="case"
        reloadToken={0}
        candidates={[]}
        busy={false}
        onOpen={vi.fn()}
        onIntake={vi.fn()}
        onImportResume={vi.fn()}
        onRefresh={vi.fn()}
      />
    </BusinessProgressContext.Provider>
  )
  expect(await screen.findByText('この案件の対応はすべて終了しています。案件プールに戻せます。')).toBeInTheDocument()
  expect(window.sesAgent.setCaseWorking).not.toHaveBeenCalled()
  expect(caseTitles()).toEqual(['Case b'])
})
it('keeps the working-set notice on the case list when switching to people', async () => {
  vi.mocked(window.sesAgent.getBusinessFeed).mockResolvedValue([workingCase('b', true)])
  window.sesAgent.setCaseWorking = vi.fn(async (input) => input)
  const props = {
    reloadToken: 0,
    candidates: [],
    busy: false,
    onOpen: vi.fn(),
    onIntake: vi.fn(),
    onImportResume: vi.fn(),
    onRefresh: vi.fn()
  }
  const view = render(<HrObjectList kind="case" {...props} />)
  fireEvent.click(openCardMenu(await screen.findByRole('article', { name: 'Case b' })).getByRole('menuitem', { name: '案件プールに戻す' }))
  expect(await screen.findByRole('button', { name: '元に戻す' })).toBeInTheDocument()
  view.rerender(<HrObjectList kind="person" {...props} />)
  expect(screen.queryByRole('button', { name: '元に戻す' })).not.toBeInTheDocument()
})
it('regenerates a case introduction with what HR asked for', async () => {
  render(<CaseIntroductionComposer target={{ reviewId, jobCaseVersion: 1 }} cases={[job]} onClose={vi.fn()} />)
  const request = await screen.findByRole('textbox', { name: 'AIへの要望' })
  await waitFor(() => expect(request).toBeEnabled())
  fireEvent.change(request, { target: { value: ' リモート可と長期案件である点を強調して ' } })
  fireEvent.click(screen.getByRole('button', { name: 'AIで再生成' }))
  await waitFor(() =>
    expect(window.sesAgent.regenerateIntroduction).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'case', id: reviewId, request: 'リモート可と長期案件である点を強調して' })
    )
  )
})
it('regenerates both languages at once, shares the request across them and keeps them after a remount', async () => {
  window.sesAgent.regenerateIntroduction = vi.fn(async (input) => ({ text: `AI ${input.lang} ${input.request ?? ''}`.trim() }))
  window.sesAgent.saveCaseIntroductionDrafts = vi.fn(async () => [])
  window.sesAgent.listCaseIntroductionDrafts = vi.fn(async () => [])
  const props = { target: { reviewId, jobCaseVersion: 1 }, cases: [job], onClose: vi.fn() }
  const first = render(<CaseIntroductionComposer {...props} />)
  const request = await screen.findByRole('textbox', { name: 'AIへの要望' })
  await waitFor(() => expect(request).toBeEnabled())
  fireEvent.change(request, { target: { value: '長期' } })
  fireEvent.click(screen.getByRole('tab', { name: '中国語' }))
  expect(screen.getByRole('textbox', { name: 'AIへの要望' })).toHaveValue('長期')
  fireEvent.click(screen.getByRole('button', { name: 'AIで再生成' }))
  await waitFor(() => expect(screen.getByRole('textbox', { name: '紹介文' })).toHaveValue('AI zh 長期'))
  expect(window.sesAgent.regenerateIntroduction).toHaveBeenCalledTimes(2)
  expect(vi.mocked(window.sesAgent.regenerateIntroduction).mock.calls.map((call) => [call[0].lang, call[0].request])).toEqual(
    expect.arrayContaining([
      ['zh', '長期'],
      ['ja', '長期']
    ])
  )
  fireEvent.click(screen.getByRole('tab', { name: '日本語' }))
  expect(screen.getByRole('textbox', { name: '紹介文' })).toHaveValue('AI ja 長期')
  // Every generation replaces the stored one for both languages.
  await waitFor(() =>
    expect(window.sesAgent.saveCaseIntroductionDrafts).toHaveBeenCalledWith({
      reviewId,
      jobCaseVersion: 1,
      style: 'standard',
      request: '長期',
      drafts: [
        { lang: 'zh', text: 'AI zh 長期', experienceRunId: null },
        { lang: 'ja', text: 'AI ja 長期', experienceRunId: null }
      ]
    })
  )
  expect(await screen.findByText('AIで日本語と中国語を再生成して保存しました。そのまま編集できます。')).toBeInTheDocument()
  // Leaving the page may unmount the dialog; the regenerated drafts stay for this session.
  first.unmount()
  render(<CaseIntroductionComposer {...props} />)
  await waitFor(() => expect(screen.getByRole('textbox', { name: '紹介文' })).toHaveValue('AI ja 長期'))
})

it('opens with the introduction saved in the database and an empty request box', async () => {
  window.sesAgent.listCaseIntroductionDrafts = vi.fn(async () => [
    {
      reviewId,
      jobCaseVersion: 1,
      lang: 'ja' as const,
      style: 'standard' as const,
      text: '保存済み紹介文',
      request: '長期',
      experienceRunId: null,
      generatedAt: '2026-09-24T00:00:00Z'
    },
    {
      reviewId,
      jobCaseVersion: 1,
      lang: 'zh' as const,
      style: 'standard' as const,
      text: '已保存的介绍',
      request: '長期',
      experienceRunId: null,
      generatedAt: '2026-09-24T00:00:00Z'
    }
  ])
  render(<CaseIntroductionComposer target={{ reviewId, jobCaseVersion: 1 }} cases={[job]} onClose={vi.fn()} />)
  await waitFor(() => expect(screen.getByRole('textbox', { name: '紹介文' })).toHaveValue('保存済み紹介文'))
  expect(window.sesAgent.listCaseIntroductionDrafts).toHaveBeenCalledWith(reviewId)
  // The stored request is kept as a record only; the request box is a one-off input.
  expect(screen.getByRole('textbox', { name: 'AIへの要望' })).toHaveValue('')
  fireEvent.click(screen.getByRole('tab', { name: '中国語' }))
  expect(screen.getByRole('textbox', { name: '紹介文' })).toHaveValue('已保存的介绍')
})

it('keeps a regenerated introduction on screen and says so when saving it fails', async () => {
  window.sesAgent.regenerateIntroduction = vi.fn(async (input) => ({ text: `AI ${input.lang}` }))
  window.sesAgent.listCaseIntroductionDrafts = vi.fn(async () => [])
  window.sesAgent.saveCaseIntroductionDrafts = vi.fn(async () => {
    throw new Error(
      "Error invoking remote method 'x': Error: 案件资料已更新，本次介绍未保存，请重新生成。 / 案件情報が更新されたため紹介文を保存できませんでした。再生成してください。"
    )
  })
  render(<CaseIntroductionComposer target={{ reviewId, jobCaseVersion: 1 }} cases={[job]} onClose={vi.fn()} />)
  const regenerate = await screen.findByRole('button', { name: 'AIで再生成' })
  await waitFor(() => expect(regenerate).toBeEnabled())
  fireEvent.click(regenerate)
  expect(await screen.findByRole('alert')).toHaveTextContent('案件情報が更新されたため紹介文を保存できませんでした。')
  expect(screen.getByRole('textbox', { name: '紹介文' })).toHaveValue('AI ja')
})

it('starts every opening of the case introduction with an empty request box', async () => {
  const props = { target: { reviewId, jobCaseVersion: 1 }, cases: [job], onClose: vi.fn() }
  const view = render(<CaseIntroductionComposer {...props} />)
  const request = await screen.findByRole('textbox', { name: 'AIへの要望' })
  fireEvent.change(request, { target: { value: '長期' } })
  view.rerender(<CaseIntroductionComposer {...props} target={null} />)
  view.rerender(<CaseIntroductionComposer {...props} target={{ reviewId, jobCaseVersion: 1 }} />)
  expect(await screen.findByRole('textbox', { name: 'AIへの要望' })).toHaveValue('')
})
it('starts every opening of the personnel introduction with an empty request box', async () => {
  const props = { people: [person], cases: [], onClose: vi.fn(), onFollowUp: vi.fn() }
  const view = render(<IntroductionComposer {...props} target={{ documentId, profileVersion: 1, matched: [] }} />)
  fireEvent.change(await screen.findByRole('textbox', { name: 'AIへの要望' }), { target: { value: 'チーム管理' } })
  view.rerender(<IntroductionComposer {...props} target={null} />)
  view.rerender(<IntroductionComposer {...props} target={{ documentId, profileVersion: 1, matched: [] }} />)
  expect(await screen.findByRole('textbox', { name: 'AIへの要望' })).toHaveValue('')
})
it('keeps ended cases under their own status filter while archived people still leave the list', () => {
  const ended = { ...workingCase('c', false), archived: true, businessStatus: 'archived' as const }
  const archivedPerson = { ...entry, objectId: 'p-archived', archived: true }
  const current = currentBusinessObjects([workingCase('a', false), ended, archivedPerson as BusinessFeedEntry])
  expect(current.map((item) => item.objectId).sort()).toEqual(['a', 'c'])
})
it('ends a case from its card, lists it under "ended" and makes it active again', async () => {
  const ended = { ...workingCase('c', false), archived: true, businessStatus: 'archived' as const }
  vi.mocked(window.sesAgent.getBusinessFeed).mockResolvedValue([workingCase('a', false), ended])
  window.sesAgent.setJobCaseLifecycle = vi.fn(async () => ({}) as never)
  const onRefresh = vi.fn(async () => {})
  // The app re-reads its data on this event, once per change.
  const changed = vi.fn()
  window.addEventListener('ses-business-data-changed', changed)
  render(
    <HrObjectList
      kind="case"
      reloadToken={0}
      candidates={[]}
      busy={false}
      onOpen={vi.fn()}
      onIntake={vi.fn()}
      onImportResume={vi.fn()}
      onRefresh={onRefresh}
    />
  )
  fireEvent.click(await screen.findByRole('button', { name: '案件プール' }))
  expect(screen.getByRole('combobox', { name: '案件の状態' })).toHaveValue('active')
  await waitFor(() => expect(caseTitles()).toEqual(['Case a']))
  fireEvent.click(openCardMenu(screen.getByRole('article', { name: 'Case a' })).getByRole('menuitem', { name: '案件を終了' }))
  await waitFor(() =>
    expect(window.sesAgent.setJobCaseLifecycle).toHaveBeenCalledWith(expect.objectContaining({ reviewId: 'a', state: 'archived' }))
  )
  await waitFor(() => expect(caseTitles()).toEqual([]))
  expect(changed).toHaveBeenCalledTimes(1)
  expect(onRefresh).not.toHaveBeenCalled()
  window.removeEventListener('ses-business-data-changed', changed)
  fireEvent.click(screen.getByRole('button', { name: '元に戻す' }))
  await waitFor(() =>
    expect(window.sesAgent.setJobCaseLifecycle).toHaveBeenLastCalledWith(expect.objectContaining({ reviewId: 'a', state: 'active' }))
  )
  await waitFor(() => expect(caseTitles()).toEqual(['Case a']))
  fireEvent.change(screen.getByRole('combobox', { name: '案件の状態' }), { target: { value: 'ended' } })
  await waitFor(() => expect(caseTitles()).toEqual(['Case c']))
  const endedCard = within(screen.getByRole('article', { name: 'Case c' }))
  expect(endedCard.getByText('終了')).toBeInTheDocument()
  expect(endedCard.queryByRole('menuitem', { name: '担当する', hidden: true })).not.toBeInTheDocument()
  // An ended case offers re-activation in place of looking for people, and no broadcasting or joining.
  expect(endedCard.queryByRole('button', { name: '要員を探す' })).not.toBeInTheDocument()
  expect(endedCard.queryByRole('button', { name: '案件を配信' })).not.toBeInTheDocument()
  const endedMenu = openCardMenu(screen.getByRole('article', { name: 'Case c' }))
  expect(endedMenu.getAllByRole('menuitem').map((item) => item.textContent)).toEqual(['削除'])
  fireEvent.click(endedCard.getByRole('button', { name: '案件を再開' }))
  await waitFor(() =>
    expect(window.sesAgent.setJobCaseLifecycle).toHaveBeenLastCalledWith(expect.objectContaining({ reviewId: 'c', state: 'active' }))
  )
  await waitFor(() => expect(caseTitles()).toEqual([]))
})
it('counts and lists only active unread cases, and lets a read card leave "unread" once HR leaves that view', async () => {
  const unread = { ...workingCase('a', false), unseen: true }
  const endedUnread = { ...workingCase('c', false), unseen: true, archived: true, businessStatus: 'archived' as const }
  vi.mocked(window.sesAgent.getBusinessFeed).mockResolvedValue([unread, endedUnread])
  vi.mocked(window.sesAgent.markBusinessFeed).mockImplementation(async (input) => [{ ...unread, revision: input.revision, unseen: false }])
  const onOpen = vi.fn()
  render(
    <HrObjectList
      kind="case"
      reloadToken={0}
      candidates={[]}
      busy={false}
      onOpen={onOpen}
      onIntake={vi.fn()}
      onImportResume={vi.fn()}
      onRefresh={vi.fn()}
      selectedKey="case:a"
    />
  )
  fireEvent.click(await screen.findByRole('button', { name: '未読 1' }))
  await waitFor(() => expect(caseTitles()).toEqual(['Case a']))
  fireEvent.click(screen.getByRole('article', { name: 'Case a' }))
  await waitFor(() =>
    expect(window.sesAgent.markBusinessFeed).toHaveBeenCalledWith(expect.objectContaining({ objectId: 'a', action: 'seen' }))
  )
  // Still shown while HR stays on "unread", even though it is the selected card...
  expect(caseTitles()).toEqual(['Case a'])
  expect(screen.getByRole('button', { name: '未読 0' })).toBeInTheDocument()
  // ...and gone once HR comes back to "unread".
  fireEvent.click(screen.getByRole('button', { name: '案件プール' }))
  fireEvent.click(screen.getByRole('button', { name: '未読 0' }))
  await waitFor(() => expect(caseTitles()).toEqual([]))
})
it('marks a case read on its current revision after it was ended and re-activated', async () => {
  const before = { ...workingCase('a', false), unseen: true, revision: '1'.repeat(64) }
  const after = { ...before, revision: '2'.repeat(64) }
  vi.mocked(window.sesAgent.getBusinessFeed).mockResolvedValueOnce([before]).mockResolvedValue([after])
  vi.mocked(window.sesAgent.markBusinessFeed).mockImplementation(async (input) => {
    if (input.revision !== after.revision) throw new Error('信息已更新，请刷新后查看。 / 情報が更新されました。再読込してください。')
    return [{ ...after, unseen: false }]
  })
  render(
    <HrObjectList
      kind="case"
      reloadToken={0}
      candidates={[]}
      busy={false}
      onOpen={vi.fn()}
      onIntake={vi.fn()}
      onImportResume={vi.fn()}
      onRefresh={vi.fn()}
    />
  )
  fireEvent.click(await screen.findByRole('button', { name: '案件プール' }))
  fireEvent.click(await screen.findByRole('article', { name: 'Case a' }))
  await waitFor(() =>
    expect(window.sesAgent.markBusinessFeed).toHaveBeenLastCalledWith(expect.objectContaining({ revision: after.revision, action: 'seen' }))
  )
  expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  expect(screen.getByRole('button', { name: '未読 0' })).toBeInTheDocument()
})

const personTarget = { documentId, profileVersion: 1, matched: [] }
const personDraft = (lang: 'ja' | 'zh', text: string) => ({
  documentId,
  profileVersion: 1,
  caseReviewId: null,
  jobCaseVersion: null,
  lang,
  style: 'standard' as const,
  text,
  request: null,
  experienceRunId: null,
  generatedAt: '2026-09-24T00:00:00Z'
})
it('generates Chinese and Japanese together on open, stores each, and shows both without another call', async () => {
  window.sesAgent.listPersonnelIntroductionDrafts = vi.fn(async () => [])
  window.sesAgent.savePersonnelIntroductionDrafts = vi.fn(async () => [])
  window.sesAgent.regenerateIntroduction = vi.fn(async (input) => ({ text: `AI ${input.lang}`, experienceRunId: `run-${input.lang}` }))
  render(<IntroductionComposer target={personTarget} people={[person]} cases={[]} onClose={vi.fn()} onFollowUp={vi.fn()} />)
  await waitFor(() => expect(screen.getByRole('textbox', { name: '紹介文' })).toHaveValue('AI ja'))
  expect(
    vi
      .mocked(window.sesAgent.regenerateIntroduction)
      .mock.calls.map((call) => call[0].lang)
      .sort()
  ).toEqual(['ja', 'zh'])
  await waitFor(() => expect(window.sesAgent.savePersonnelIntroductionDrafts).toHaveBeenCalledTimes(2))
  expect(window.sesAgent.savePersonnelIntroductionDrafts).toHaveBeenCalledWith({
    documentId,
    profileVersion: 1,
    caseContext: null,
    style: 'standard',
    request: null,
    drafts: [{ lang: 'zh', text: 'AI zh', experienceRunId: 'run-zh' }]
  })
  fireEvent.click(screen.getByRole('tab', { name: '中国語' }))
  expect(screen.getByRole('textbox', { name: '紹介文' })).toHaveValue('AI zh')
  expect(window.sesAgent.regenerateIntroduction).toHaveBeenCalledTimes(2)
})
it('opens a stored personnel introduction directly and only generates the language that is missing', async () => {
  window.sesAgent.savePersonnelIntroductionDrafts = vi.fn(async () => [])
  window.sesAgent.regenerateIntroduction = vi.fn(async (input) => ({ text: `AI ${input.lang}` }))
  window.sesAgent.listPersonnelIntroductionDrafts = vi.fn(async () => [
    personDraft('ja', '保存済みの要員紹介'),
    personDraft('zh', '已保存的人员介绍')
  ])
  const first = render(<IntroductionComposer target={personTarget} people={[person]} cases={[]} onClose={vi.fn()} onFollowUp={vi.fn()} />)
  await waitFor(() => expect(screen.getByRole('textbox', { name: '紹介文' })).toHaveValue('保存済みの要員紹介'))
  expect(window.sesAgent.regenerateIntroduction).not.toHaveBeenCalled()
  first.unmount()
  window.sesAgent.listPersonnelIntroductionDrafts = vi.fn(async () => [personDraft('ja', '保存済みの要員紹介')])
  render(<IntroductionComposer target={personTarget} people={[person]} cases={[]} onClose={vi.fn()} onFollowUp={vi.fn()} />)
  await waitFor(() => expect(window.sesAgent.regenerateIntroduction).toHaveBeenCalledTimes(1))
  expect(vi.mocked(window.sesAgent.regenerateIntroduction).mock.calls[0]![0].lang).toBe('zh')
  expect(screen.getByRole('textbox', { name: '紹介文' })).toHaveValue('保存済みの要員紹介')
})
it('regenerates both languages with one request, keeps a language that failed as it was, and stores the one that succeeded', async () => {
  window.sesAgent.listPersonnelIntroductionDrafts = vi.fn(async () => [personDraft('ja', '保存済みJA'), personDraft('zh', '已保存ZH')])
  window.sesAgent.savePersonnelIntroductionDrafts = vi.fn(async () => [])
  window.sesAgent.regenerateIntroduction = vi.fn(async (input) => {
    if (input.lang === 'ja') throw new Error('cloud unavailable')
    return { text: `新しい ${input.lang} ${input.request}` }
  })
  render(<IntroductionComposer target={personTarget} people={[person]} cases={[]} onClose={vi.fn()} onFollowUp={vi.fn()} />)
  const text = screen.getByRole('textbox', { name: '紹介文' })
  await waitFor(() => expect(text).toHaveValue('保存済みJA'))
  fireEvent.change(text, { target: { value: 'My existing draft' } })
  fireEvent.change(screen.getByRole('textbox', { name: 'AIへの要望' }), { target: { value: 'チーム管理' } })
  fireEvent.click(screen.getByRole('button', { name: 'AIで再生成' }))
  expect(screen.getByRole('button', { name: 'Cloud AIで生成中…' })).toBeDisabled()
  expect(await screen.findByRole('alert')).toHaveTextContent('日本語')
  expect(text).toHaveValue('My existing draft')
  expect(
    vi
      .mocked(window.sesAgent.regenerateIntroduction)
      .mock.calls.map((call) => [call[0].lang, call[0].request])
      .sort()
  ).toEqual([
    ['ja', 'チーム管理'],
    ['zh', 'チーム管理']
  ])
  expect(window.sesAgent.savePersonnelIntroductionDrafts).toHaveBeenCalledTimes(1)
  expect(window.sesAgent.savePersonnelIntroductionDrafts).toHaveBeenCalledWith(
    expect.objectContaining({ request: 'チーム管理', drafts: [{ lang: 'zh', text: '新しい zh チーム管理', experienceRunId: null }] })
  )
  fireEvent.click(screen.getByRole('tab', { name: '中国語' }))
  expect(text).toHaveValue('新しい zh チーム管理')
})

const listProps = {
  reloadToken: 0,
  candidates: [],
  onOpen: vi.fn(),
  onIntake: vi.fn(),
  onImportResume: vi.fn(),
  onRefresh: vi.fn(async () => {})
}
it('keeps secondary card actions in an accessible menu that arrows, Esc and a click outside operate', async () => {
  vi.mocked(window.sesAgent.getBusinessFeed).mockResolvedValue([workingCase('a', true)])
  const onOpen = vi.fn()
  render(<HrObjectList kind="case" {...listProps} onOpen={onOpen} />)
  const card = await screen.findByRole('article', { name: 'Case a' })
  const actions = within(card)
  // A case I handle shows 要員を探す, 案件を配信 and 案件を終了; the rest live in its 「…」 menu.
  expect(actions.getByRole('button', { name: '要員を探す' })).toBeVisible()
  expect(actions.getByRole('button', { name: '案件を配信' })).toBeVisible()
  expect(actions.getByRole('button', { name: '案件を終了' })).toBeVisible()
  expect(actions.queryByRole('button', { name: '紹介を準備' })).not.toBeInTheDocument()
  expect(actions.queryByRole('button', { name: '案件プールに戻す' })).not.toBeInTheDocument()
  const trigger = actions.getByRole('button', { name: /^その他の操作/u })
  expect(trigger).toHaveAttribute('aria-haspopup', 'menu')
  expect(trigger).toHaveAttribute('aria-expanded', 'false')
  fireEvent.click(trigger)
  expect(trigger).toHaveAttribute('aria-expanded', 'true')
  const menu = actions.getByRole('menu')
  const items = within(menu).getAllByRole('menuitem')
  expect(items.map((item) => item.textContent)).toEqual(['案件プールに戻す', '削除'])
  expect(items[0]).toHaveFocus()
  fireEvent.keyDown(menu, { key: 'ArrowDown' })
  expect(items[1]).toHaveFocus()
  fireEvent.keyDown(menu, { key: 'ArrowUp' })
  fireEvent.keyDown(menu, { key: 'ArrowUp' })
  expect(items[1]).toHaveFocus()
  fireEvent.keyDown(menu, { key: 'Escape' })
  expect(actions.queryByRole('menu')).not.toBeInTheDocument()
  expect(trigger).toHaveFocus()
  fireEvent.click(trigger)
  fireEvent.mouseDown(document.body)
  expect(actions.queryByRole('menu')).not.toBeInTheDocument()
  expect(onOpen).not.toHaveBeenCalled()
  fireEvent.click(card)
  expect(onOpen).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ objectId: 'a' }), 'view')
  fireEvent.click(actions.getByRole('button', { name: '案件を配信' }))
  expect(onOpen).toHaveBeenLastCalledWith(expect.objectContaining({ objectId: 'a' }), 'promote')
  // The internal record number is not shown on the card.
  expect(actions.queryByText(/資料番号/u)).not.toBeInTheDocument()
})

it('locks only the cards whose matching runs and shows found case counts on people', async () => {
  const other = { ...entry, objectId: reviewId, title: 'Other Engineer' }
  const third = { ...entry, objectId: 'third-person', title: 'Third Engineer' }
  vi.mocked(window.sesAgent.getBusinessFeed).mockResolvedValue([entry, other, third])
  const onOpen = vi.fn()
  render(
    <HrObjectList
      kind="person"
      {...listProps}
      onOpen={onOpen}
      busy
      busyObjectIds={[documentId, third.objectId]}
      personMatchCounts={{ [reviewId]: 3 }}
    />
  )
  for (const name of ['Same Name', 'Third Engineer']) {
    const busyCard = within(await screen.findByRole('article', { name }))
    const locked = busyCard.getByRole('button', { name: '案件を探す' })
    expect(locked).toBeDisabled()
    expect(locked).toHaveAttribute('title', '評価中です。しばらくお待ちください')
    expect(locked).toHaveAccessibleDescription('評価中です。しばらくお待ちください')
  }
  const free = within(screen.getByRole('article', { name: 'Other Engineer' })).getByRole('button', { name: '案件を見る (3)' })
  expect(free).toBeEnabled()
  expect(free).not.toHaveAttribute('aria-describedby')
  fireEvent.click(free)
  expect(onOpen).toHaveBeenCalledWith(expect.objectContaining({ objectId: reviewId }), 'match')
})

it('explains why a case cannot look for people yet', async () => {
  vi.mocked(window.sesAgent.getBusinessFeed).mockResolvedValue([workingCase(reviewId, true)])
  render(<HrObjectList kind="case" {...listProps} cases={[]} onAssessResumes={vi.fn()} />)
  const find = within(await screen.findByRole('article')).getByRole('button', { name: '要員を探す' })
  expect(find).toBeDisabled()
  expect(find).toHaveAccessibleDescription('資料が不完全です')
})

it('moves between cards with arrow keys, opens with Enter and focuses search with /', async () => {
  vi.mocked(window.sesAgent.getBusinessFeed).mockResolvedValue([workingCase('a', true), workingCase('b', true)])
  const onOpen = vi.fn()
  render(<HrObjectList kind="case" {...listProps} onOpen={onOpen} />)
  await waitFor(() => expect(caseTitles()).toHaveLength(2))
  const [first, second] = screen.getAllByRole('article')
  first!.focus()
  fireEvent.keyDown(first!, { key: 'ArrowDown' })
  expect(second).toHaveFocus()
  fireEvent.keyDown(second!, { key: 'ArrowDown' })
  expect(second).toHaveFocus()
  fireEvent.keyDown(second!, { key: 'ArrowUp' })
  expect(first).toHaveFocus()
  fireEvent.keyDown(first!, { key: 'Enter' })
  expect(onOpen).toHaveBeenCalledWith(expect.objectContaining({ objectId: first!.getAttribute('aria-label')!.slice(5) }), 'view')
  const search = screen.getByRole('textbox', { name: '案件・要員を検索' })
  expect(search).toHaveAttribute('placeholder', expect.stringContaining('（/）'))
  fireEvent.keyDown(first!, { key: '/' })
  expect(search).toHaveFocus()
  fireEvent.keyDown(search, { key: '/' })
  expect(search).toHaveFocus()
})

it('offers one primary import per list and keeps full data as a quiet secondary action', async () => {
  vi.mocked(window.sesAgent.getBusinessFeed).mockResolvedValue([entry])
  const onIntake = vi.fn(),
    onImportResume = vi.fn(),
    onOpenLibrary = vi.fn(),
    onImportHistory = vi.fn()
  const props = { ...listProps, onIntake, onImportResume, onOpenLibrary, onImportHistory }
  const view = render(<HrObjectList kind="person" {...props} />)
  await screen.findByRole('article')
  const toolbar = within(view.container.querySelector('.hr-list-toolbar') as HTMLElement)
  expect(toolbar.queryByRole('button', { name: '履歴書を取り込む' })).not.toBeInTheDocument()
  fireEvent.click(toolbar.getByRole('button', { name: '要員を取り込む' }))
  fireEvent.click(toolbar.getByRole('menuitem', { name: '履歴書ファイルを取り込む' }))
  expect(onImportResume).toHaveBeenCalledOnce()
  fireEvent.click(toolbar.getByRole('button', { name: '要員を取り込む' }))
  fireEvent.click(toolbar.getByRole('menuitem', { name: '要員紹介を貼り付け' }))
  expect(onIntake).toHaveBeenCalledOnce()
  expect(toolbar.getByRole('button', { name: '要員の全資料' })).toHaveClass('hr-quiet')
  fireEvent.click(toolbar.getByRole('button', { name: '要員の全資料' }))
  expect(onOpenLibrary).toHaveBeenCalledOnce()
  view.rerender(<HrObjectList kind="case" {...props} />)
  expect(toolbar.getByRole('button', { name: '案件を追加' })).toHaveClass('hr-primary')
  fireEvent.click(toolbar.getByRole('button', { name: '一括取込' }))
  expect(onImportHistory).toHaveBeenCalledOnce()
  expect(toolbar.queryByRole('button', { name: '取込履歴' })).not.toBeInTheDocument()
})

it('shows imported cases in my cases when the import added them there', async () => {
  vi.mocked(window.sesAgent.getBusinessFeed).mockResolvedValue([workingCase('a', false)])
  render(<HrObjectList kind="case" {...listProps} />)
  fireEvent.click(await screen.findByRole('button', { name: '案件プール' }))
  await waitFor(() => expect(caseTitles()).toEqual(['Case a']))
  vi.mocked(window.sesAgent.getBusinessFeed).mockResolvedValue([workingCase('a', false), workingCase('n', true)])
  act(() => {
    window.dispatchEvent(new CustomEvent('ses-cases-imported', { detail: { reviewIds: ['n'], working: true } }))
  })
  await waitFor(() => expect(caseTitles()).toEqual(['Case n']))
  expect(screen.getByRole('button', { name: '担当中 1' })).toHaveAttribute('aria-pressed', 'true')
})

it('applies waiting updates at once when the list on screen is empty instead of asking to refresh it', async () => {
  vi.mocked(window.sesAgent.getBusinessFeed).mockResolvedValue([])
  const view = render(<HrObjectList kind="case" {...listProps} onAssessResumes={vi.fn()} />)
  // No case at all yet: the empty list says how to add one.
  await screen.findByText(/案件はまだありません。案件情報を貼り付ける/u)
  // The resume drop hint only makes sense over case cards.
  expect(screen.queryByText(/履歴書を案件カードにドロップ/u)).not.toBeInTheDocument()
  vi.mocked(window.sesAgent.getBusinessFeed).mockResolvedValue([workingCase('n', true)])
  view.rerender(<HrObjectList kind="case" {...listProps} onAssessResumes={vi.fn()} reloadToken={1} />)
  await waitFor(() => expect(caseTitles()).toEqual(['Case n']))
  expect(screen.queryByText('更新情報があります')).not.toBeInTheDocument()
})

it('opens where cases imported from another page landed, and names the case status as in progress or ended', async () => {
  vi.mocked(window.sesAgent.getBusinessFeed).mockResolvedValue([workingCase('a', true)])
  const view = render(<HrObjectList kind="case" {...listProps} active={false} />)
  await waitFor(() => expect(caseTitles()).toEqual(['Case a']))
  vi.mocked(window.sesAgent.getBusinessFeed).mockResolvedValue([workingCase('a', true), workingCase('n', false)])
  act(() => {
    window.dispatchEvent(new CustomEvent('ses-cases-imported', { detail: { reviewIds: ['n'], working: false } }))
  })
  view.rerender(<HrObjectList kind="case" {...listProps} active />)
  // The re-read after the import event is async and can be slow under a loaded full run.
  // 「全部」 shows the imported case; Case a is in my cases.
  await waitFor(() => expect(caseTitles()).toEqual(['Case n']), { timeout: 3000 })
  expect(screen.getByRole('button', { name: '案件プール' })).toHaveAttribute('aria-pressed', 'true')
  const status = screen.getByRole('combobox', { name: '案件の状態' })
  expect(
    within(status)
      .getAllByRole('option')
      .map((option) => option.textContent)
  ).toEqual(['進行中', '終了'])
})

it('explains an empty person library and offers the import instead of the filter message', async () => {
  vi.mocked(window.sesAgent.getBusinessFeed).mockResolvedValue([])
  const onImportResume = vi.fn()
  const view = render(<HrObjectList kind="person" {...listProps} onImportResume={onImportResume} />)
  expect(await screen.findByText(/要員はまだいません/u)).toBeVisible()
  expect(screen.queryByText(/条件に一致する情報がありません/u)).not.toBeInTheDocument()
  const empty = within(view.container.querySelector('.hr-object-scroll') as HTMLElement)
  fireEvent.click(empty.getByRole('button', { name: '要員を取り込む' }))
  expect(onImportResume).toHaveBeenCalledOnce()
})

it('names the selected time range when it hides everything and offers every time', async () => {
  vi.mocked(window.sesAgent.getBusinessFeed).mockResolvedValue([{ ...workingCase('old', false), occurredAt: '2020-01-01T00:00:00Z' }])
  render(<HrObjectList kind="case" {...listProps} />)
  fireEvent.click(await screen.findByRole('button', { name: '案件プール' }))
  fireEvent.change(screen.getByRole('combobox', { name: '一覧の期間' }), { target: { value: '7d' } })
  expect(screen.getByText('直近7日の条件に一致する案件はありません。')).toBeVisible()
  expect(screen.queryByText(/今日の案件はありません/u)).not.toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: '全期間を見る' }))
  expect(caseTitles()).toEqual(['Case old'])
})

it('shows cards with up to five requirements, labelled facts, a follow-up line and an unread dot', async () => {
  const followed = {
    ...workingCase('a', true),
    title: 'Case followed',
    unseen: true,
    fields: [
      { key: 'required_skills', value: 'Java, Spring, AWS, Docker, React, Go, Rust' },
      { key: 'rate', value: '80万円' },
      { key: 'location', value: '東京' },
      { key: 'start_date', value: '即日' }
    ]
  } as BusinessFeedEntry
  const quiet = { ...workingCase('b', true), title: 'Case quiet' } as BusinessFeedEntry
  vi.mocked(window.sesAgent.getBusinessFeed).mockResolvedValue([followed, quiet])
  const active = {
    id: 'f',
    documentId,
    reviewId: 'a',
    revision: 1,
    status: 'pending',
    note: '',
    nextStep: '',
    recordedBy: 'HR',
    updatedAt: new Date().toISOString(),
    events: []
  } as unknown as BusinessFollowUp
  const data = {
    rows: [active],
    indexes: progressIndexes([active]),
    now: new Date(),
    loading: false,
    failed: false,
    publish: vi.fn(),
    refresh: vi.fn(),
    remove: vi.fn()
  } as ReturnType<typeof useBusinessProgressData>
  const onOpenProgress = vi.fn()
  render(
    <BusinessProgressContext.Provider value={data}>
      <HrObjectList kind="case" {...listProps} onOpenProgress={onOpenProgress} />
    </BusinessProgressContext.Provider>
  )
  const row = within(await screen.findByRole('article', { name: 'Case followed' }))
  // Every row in 担当中 is mine, so the row carries no 担当中 badge there.
  expect(row.queryByText('担当中')).not.toBeInTheDocument()
  expect(row.getByText('未読')).toHaveClass('hr-visually-hidden')
  expect(row.getByRole('heading', { name: 'Case followed' })).toHaveAttribute('title', 'Case followed')
  expect(row.getByRole('list', { name: '必須スキル' }).querySelectorAll('li:not(.hr-row-more)').length).toBe(5)
  expect(row.getByText('+2')).toHaveAttribute('title', 'Go\nRust')
  for (const value of ['80万円', '東京', '即日']) expect(row.getByText(value)).toBeInTheDocument()
  // Four labelled facts in fixed places; a missing one reads 「—」 instead of disappearing.
  const facts = [...screen.getByRole('article', { name: 'Case followed' }).querySelectorAll('.hr-card-fact')]
  expect(facts.map((fact) => fact.querySelector('dt')!.textContent)).toEqual(['単価', '勤務地', '勤務形態', '開始'])
  expect(facts.map((fact) => fact.querySelector('dd')!.textContent)).toEqual(['80万円', '東京', '—', '即日'])
  // Follow-ups are a small chip that opens them; a case without any shows no empty box.
  const chip = row.getByRole('button', { name: /対応中 1 名/u })
  fireEvent.click(chip)
  expect(onOpenProgress).toHaveBeenCalledWith(expect.objectContaining({ objectId: 'a' }))
  const quietRow = within(screen.getByRole('article', { name: 'Case quiet' }))
  expect(quietRow.queryByText(/対応中の要員はいません/u)).not.toBeInTheDocument()
  expect(quietRow.queryByRole('button', { name: /対応/u })).not.toBeInTheDocument()
  expect(quietRow.queryByText('未読')).not.toBeInTheDocument()
})

it('drops skill chips that repeat the title and shows the date and source on the card', async () => {
  const titled = {
    ...workingCase('a', true),
    title: 'ＪＡＶＡ／Spring Boot 開発',
    source: 'chat-paste',
    fields: [{ key: 'required_skills', value: 'java, spring boot, AWS' }]
  } as BusinessFeedEntry
  const repeated = {
    ...workingCase('b', true),
    title: 'Java, Spring',
    fields: [{ key: 'required_skills', value: 'Java, Spring' }]
  } as BusinessFeedEntry
  vi.mocked(window.sesAgent.getBusinessFeed).mockResolvedValue([titled, repeated])
  render(<HrObjectList kind="case" {...listProps} />)
  const card = within(await screen.findByRole('article', { name: titled.title }))
  // Case- and width-insensitive: 「ＪＡＶＡ」 in the title covers the 「java」 requirement.
  expect([...card.getByRole('list', { name: '必須スキル' }).querySelectorAll('li')].map((item) => item.textContent)).toEqual(['AWS'])
  expect(card.getByText(/チャット貼付/u)).toBeVisible()
  // A card whose requirements all repeat its title shows no chip row at all.
  expect(within(screen.getByRole('article', { name: repeated.title })).queryByRole('list')).not.toBeInTheDocument()
})

it('shows person cards with their own facts, status tags and footer actions', async () => {
  saveHrPosition('person', { timeRange: 'all' })
  const engineer = {
    ...entry,
    businessStatus: 'soon',
    source: 'gmail',
    fields: [
      { key: 'skills', value: 'Java, Go' },
      { key: 'experience_years', value: '8年' },
      { key: 'rate', value: '70万円' }
    ]
  } as BusinessFeedEntry
  vi.mocked(window.sesAgent.getBusinessFeed).mockResolvedValue([engineer])
  const onOpen = vi.fn()
  render(<HrObjectList kind="person" {...listProps} candidates={[{ ...person, inTalentLibrary: false }]} onOpen={onOpen} />)
  const article = await screen.findByRole('article', { name: 'Same Name' })
  const card = within(article)
  const facts = [...article.querySelectorAll('.hr-card-fact')]
  expect(facts.map((fact) => fact.querySelector('dt')!.textContent)).toEqual(['経験', '稼働開始', '勤務形態', '営業状況'])
  expect(facts.map((fact) => fact.querySelector('dd')!.textContent)).toEqual(['8年', '—', '—', '近日稼働可能'])
  expect(article.querySelector('.hr-card-meta')).toHaveTextContent('未登録')
  expect(article.querySelector('.hr-card-meta')).toHaveTextContent('Gmail')
  expect(card.getByRole('button', { name: '案件を探す' })).toBeEnabled()
  fireEvent.click(card.getByRole('button', { name: '紹介を準備' }))
  expect(onOpen).toHaveBeenLastCalledWith(expect.objectContaining({ objectId: documentId }), 'promote')
  fireEvent.click(card.getByRole('button', { name: '案件を探す' }))
  expect(onOpen).toHaveBeenLastCalledWith(expect.objectContaining({ objectId: documentId }), 'match')
})

it('badges my cases only in views that mix them with pool cases', async () => {
  const mine = { ...workingCase('a', true), unseen: true } as BusinessFeedEntry
  const pooled = { ...workingCase('b', false), unseen: true } as BusinessFeedEntry
  vi.mocked(window.sesAgent.getBusinessFeed).mockResolvedValue([mine, pooled])
  render(<HrObjectList kind="case" {...listProps} />)
  const working = within(await screen.findByRole('article', { name: 'Case a' }))
  expect(working.queryByText('担当中')).not.toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: '案件プール' }))
  const pool = within(await screen.findByRole('article', { name: 'Case b' }))
  expect(pool.queryByText('担当中')).not.toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: '未読 2' }))
  expect(within(await screen.findByRole('article', { name: 'Case a' })).getByText('担当中')).toHaveClass('hr-working-badge')
  expect(within(screen.getByRole('article', { name: 'Case b' })).queryByText('担当中')).not.toBeInTheDocument()
})

it('puts the open detail beside the list, closes it with Esc and gives the list its full width back', async () => {
  vi.mocked(window.sesAgent.getBusinessFeed).mockResolvedValue([workingCase('a', true), workingCase('b', true)])
  const onCloseDetail = vi.fn()
  const props = {
    ...listProps,
    kind: 'case' as const,
    selectedKey: 'case:a',
    detail: <p>Case a detail</p>,
    detailLabel: '業務ワークスペース',
    onCloseDetail
  }
  const view = render(<HrObjectList {...props} />)
  await waitFor(() => expect(caseTitles()).toHaveLength(2))
  const list = screen.getByRole('region', { name: '案件一覧' })
  // Nothing open: the list has the whole surface and the pane is not there for assistive tech.
  expect(list).not.toHaveClass('has-detail')
  expect(screen.queryByRole('complementary', { name: '業務ワークスペース' })).not.toBeInTheDocument()
  view.rerender(<HrObjectList {...props} detailOpen />)
  const pane = screen.getByRole('complementary', { name: '業務ワークスペース' })
  expect(list).toHaveClass('has-detail')
  expect(pane).toHaveTextContent('Case a detail')
  expect(screen.getByRole('article', { name: 'Case a' })).toBeVisible()
  expect(within(pane).queryByRole('button', { name: '一覧に戻る' })).not.toBeInTheDocument()
  // A menu takes Esc first; only then does Esc close the detail.
  const menuTrigger = within(screen.getByRole('article', { name: 'Case a' })).getByRole('button', { name: /^その他の操作/u })
  fireEvent.click(menuTrigger)
  fireEvent.keyDown(within(screen.getByRole('article', { name: 'Case a' })).getByRole('menu'), { key: 'Escape' })
  expect(onCloseDetail).not.toHaveBeenCalled()
  fireEvent.keyDown(window, { key: 'Escape' })
  expect(onCloseDetail).toHaveBeenCalledOnce()
  view.rerender(<HrObjectList {...props} detailOpen={false} />)
  expect(list).not.toHaveClass('has-detail')
  expect(screen.queryByRole('complementary', { name: '業務ワークスペース' })).not.toBeInTheDocument()
  expect(screen.getByRole('article', { name: 'Case a' })).toHaveFocus()
  // Closed, Esc is left to others.
  fireEvent.keyDown(window, { key: 'Escape' })
  expect(onCloseDetail).toHaveBeenCalledOnce()
})

it('shows the list or the detail in a narrow surface, with a way back to the list', async () => {
  vi.mocked(window.sesAgent.getBusinessFeed).mockResolvedValue([workingCase('a', true)])
  const onCloseDetail = vi.fn()
  const props = {
    ...listProps,
    kind: 'case' as const,
    selectedKey: 'case:a',
    detail: <p>Case a detail</p>,
    detailLabel: '業務ワークスペース',
    onCloseDetail,
    layoutWidth: 720
  }
  const view = render(<HrObjectList {...props} detailOpen />)
  const pane = await screen.findByRole('complementary', { name: '業務ワークスペース' })
  const list = screen.getByRole('region', { name: '案件一覧' })
  expect(list).toHaveClass('is-narrow')
  expect(screen.queryByRole('article', { name: 'Case a' })).not.toBeInTheDocument()
  // The toolbar row stays; search is still one key away.
  expect(screen.getByRole('textbox', { name: '案件・要員を検索' })).toBeVisible()
  fireEvent.click(within(pane).getByRole('button', { name: '一覧に戻る' }))
  expect(onCloseDetail).toHaveBeenCalledOnce()
  view.rerender(<HrObjectList {...props} detailOpen={false} />)
  expect(screen.getByRole('article', { name: 'Case a' })).toBeVisible()
  expect(screen.queryByRole('complementary', { name: '業務ワークスペース' })).not.toBeInTheDocument()
  // Wide again: list and detail side by side, no back link.
  view.rerender(<HrObjectList {...props} layoutWidth={1400} detailOpen />)
  expect(list).not.toHaveClass('is-narrow')
  expect(screen.getByRole('article', { name: 'Case a' })).toBeVisible()
  expect(within(screen.getByRole('complementary', { name: '業務ワークスペース' })).queryByRole('button', { name: '一覧に戻る' })).toBeNull()
})

it('shows the resume drop hint only while files are dragged over the case list, never for drags over the detail', async () => {
  vi.mocked(window.sesAgent.getBusinessFeed).mockResolvedValue([workingCase('a', true)])
  const onDrop = vi.fn()
  render(
    <div onDrop={onDrop}>
      <HrObjectList
        kind="case"
        {...listProps}
        cases={[job]}
        onAssessResumes={vi.fn()}
        detail={<p>Case detail</p>}
        detailOpen
        detailLabel="業務ワークスペース"
      />
    </div>
  )
  await waitFor(() => expect(caseTitles()).toEqual(['Case a']))
  const hint = /履歴書を案件カードにドロップ/u
  expect(screen.queryByText(hint)).not.toBeInTheDocument()
  const list = screen.getByRole('region', { name: '案件一覧' })
  const scroller = list.querySelector('.hr-object-scroll')!
  fireEvent.dragEnter(scroller, { dataTransfer: { types: ['Files'] } })
  expect(screen.getByText(hint)).toHaveAttribute('role', 'status')
  fireEvent.dragLeave(list, { relatedTarget: null, dataTransfer: { types: ['Files'] } })
  expect(screen.queryByText(hint)).not.toBeInTheDocument()
  // Over the detail pane the list neither announces nor swallows the drop.
  const pane = screen.getByRole('complementary', { name: '業務ワークスペース' })
  fireEvent.dragEnter(pane.firstElementChild!, { dataTransfer: { types: ['Files'] } })
  expect(screen.queryByText(hint)).not.toBeInTheDocument()
  fireEvent.drop(pane.firstElementChild!, { dataTransfer: { files: [new File(['x'], 'resume.pdf')], types: ['Files'] } })
  expect(onDrop).toHaveBeenCalledOnce()
})

it('carries the shell actions at the end of its toolbar row and steps the detail back while the Agent drawer is open', async () => {
  vi.mocked(window.sesAgent.getBusinessFeed).mockResolvedValue([workingCase('a', true)])
  const props = { ...listProps, kind: 'case' as const, detail: <p>Case detail</p>, detailOpen: true, detailLabel: '業務ワークスペース' }
  const shell = (chatOpen: boolean) => (
    <BusinessHeaderActionsContext.Provider value={{ actions: <button type="button">Agentに質問</button>, chatOpen }}>
      <HrObjectList {...props} />
    </BusinessHeaderActionsContext.Provider>
  )
  const view = render(shell(false))
  await waitFor(() => expect(caseTitles()).toEqual(['Case a']))
  const toolbar = view.container.querySelector('.hr-list-toolbar') as HTMLElement
  expect(within(toolbar).getByRole('button', { name: 'Agentに質問' })).toBeVisible()
  // Search, the primary and the secondary come first in the same row.
  expect(within(toolbar).getAllByRole('button')[0]).toHaveTextContent('案件を追加')
  expect(screen.getByRole('complementary', { name: '業務ワークスペース' })).toBeVisible()
  view.rerender(shell(true))
  expect(screen.queryByRole('complementary', { name: '業務ワークスペース' })).not.toBeInTheDocument()
  view.rerender(shell(false))
  expect(screen.getByRole('complementary', { name: '業務ワークスペース' })).toBeVisible()
})

it('names the missing facts in one line instead of four dashes when a case has none', async () => {
  vi.mocked(window.sesAgent.getBusinessFeed).mockResolvedValue([{ ...workingCase('e', true), fields: [] } as BusinessFeedEntry])
  render(<HrObjectList kind="case" {...listProps} />)
  const card = await screen.findByRole('article', { name: 'Case e' })
  expect(within(card).getByText('単価・勤務地・勤務形態・開始は未入力')).toBeInTheDocument()
  expect(card.querySelector('.hr-card-facts')).toBeNull()
})

it('filters people by 营业状态, counting each status with the other filters applied', async () => {
  saveHrPosition('person', { timeRange: 'all' })
  const person = (id: string, title: string, businessStatus: BusinessFeedEntry['businessStatus']) => ({
    ...entry,
    objectId: `11111111-1111-4111-8111-00000000000${id}`,
    title,
    businessStatus
  })
  vi.mocked(window.sesAgent.getBusinessFeed).mockResolvedValue([
    person('1', '待机 A', 'available'),
    person('2', '待机 B', 'available'),
    person('3', '进场 C', 'assigned'),
    person('4', '暂停 D', 'paused')
  ])
  render(
    <UiLocaleProvider locale="zh-CN">
      <HrObjectList kind="person" {...listProps} busy={false} />
    </UiLocaleProvider>
  )
  await screen.findByRole('article', { name: '待机 A' })
  const filter = screen.getByRole('combobox', { name: '营业状态筛选' })
  expect([...filter.querySelectorAll('option')].map((option) => option.textContent)).toEqual([
    '全部状态',
    '待机中 (2)',
    '近期可入场 (0)',
    '已进场 (1)',
    '暂停营业 (1)'
  ])
  fireEvent.change(filter, { target: { value: 'assigned' } })
  expect(screen.getAllByRole('article').map((card) => card.getAttribute('aria-label'))).toEqual(['进场 C'])
  // Counts stay those of every status, so HR can see where to switch next.
  expect(within(filter).getByRole('option', { name: '待机中 (2)' })).toBeInTheDocument()
  fireEvent.change(screen.getByRole('textbox', { name: '搜索案件或人员' }), { target: { value: 'B' } })
  expect(within(filter).getByRole('option', { name: '待机中 (1)' })).toBeInTheDocument()
  fireEvent.change(filter, { target: { value: 'all' } })
  expect(screen.getAllByRole('article').map((card) => card.getAttribute('aria-label'))).toEqual(['待机 B'])
})

it('re-reads the whole list on a data change that names no object, without an error', async () => {
  vi.mocked(window.sesAgent.getBusinessFeed).mockResolvedValue([entry])
  render(<HrObjectList kind="person" {...listProps} busy={false} />)
  await screen.findByRole('article', { name: entry.title })
  const calls = vi.mocked(window.sesAgent.getBusinessFeed).mock.calls.length
  act(() => window.dispatchEvent(new Event('ses-business-data-changed')))
  await waitFor(() => expect(vi.mocked(window.sesAgent.getBusinessFeed).mock.calls.length).toBeGreaterThan(calls))
  expect(screen.queryByRole('alert')).not.toBeInTheDocument()
})

it('asks before ending a case with open follow-ups and can end them together', async () => {
  vi.mocked(window.sesAgent.getBusinessFeed).mockResolvedValue([workingCase('b', true)])
  window.sesAgent.setJobCaseLifecycle = vi.fn(async () => ({}) as never)
  window.sesAgent.advanceBusinessProgress = vi.fn(async () => ({}) as never)
  const open = {
    id: '33333333-3333-4333-8333-000000000001',
    documentId,
    reviewId: 'b',
    revision: 3,
    status: 'interview',
    events: [],
    progress: { stage: 'coordinating', rounds: [], candidateAvailability: '', clientAvailability: '', pendingConditions: [], entry: {} }
  } as unknown as BusinessFollowUp
  const data = {
    rows: [open],
    indexes: progressIndexes([open]),
    now: new Date(),
    loading: false,
    failed: false,
    publish: vi.fn(),
    refresh: vi.fn(async () => {}),
    remove: vi.fn()
  } as unknown as ReturnType<typeof useBusinessProgressData>
  render(
    <BusinessProgressContext.Provider value={data}>
      <HrObjectList kind="case" {...listProps} busy={false} />
    </BusinessProgressContext.Provider>
  )
  fireEvent.click(within(await screen.findByRole('article', { name: 'Case b' })).getByRole('button', { name: '案件を終了' }))
  const dialog = within(await screen.findByRole('dialog', { name: '案件を終了' }))
  expect(dialog.getByText(/終了していない対応が 1 件/u)).toBeInTheDocument()
  expect(window.sesAgent.setJobCaseLifecycle).not.toHaveBeenCalled()
  fireEvent.click(dialog.getByRole('button', { name: '対応もまとめて終了' }))
  // Main ends the case and its open follow-ups in one transaction.
  await waitFor(() =>
    expect(window.sesAgent.setJobCaseLifecycle).toHaveBeenCalledWith(
      expect.objectContaining({ reviewId: 'b', state: 'archived', closeOpenFollowUps: true })
    )
  )
  expect(window.sesAgent.advanceBusinessProgress).not.toHaveBeenCalled()
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
})

it('marks people in place or not offered, shows where a person is placed, offers their own actions and lists them last', async () => {
  saveHrPosition('person', { timeRange: 'all' })
  const person = (id: string, title: string, businessStatus: BusinessFeedEntry['businessStatus'], minutes: number) => ({
    ...entry,
    objectId: `11111111-1111-4111-8111-00000000000${id}`,
    title,
    businessStatus,
    occurredAt: new Date(Date.now() - minutes * 60_000).toISOString()
  })
  vi.mocked(window.sesAgent.getBusinessFeed).mockResolvedValue([
    person('1', '进场 A', 'assigned', 1),
    person('2', '暂停 B', 'paused', 2),
    person('3', '待机 C', 'available', 3)
  ])
  const placed = {
    id: '33333333-3333-4333-8333-000000000009',
    documentId: '11111111-1111-4111-8111-000000000001',
    reviewId,
    revision: 1,
    status: 'closed',
    events: [],
    progress: {
      stage: 'started',
      rounds: [],
      candidateAvailability: '',
      clientAvailability: '',
      pendingConditions: [],
      entry: { actualDate: '2026-09-10' }
    }
  } as unknown as BusinessFollowUp
  const data = {
    rows: [placed],
    indexes: progressIndexes([placed]),
    now: new Date(),
    loading: false,
    failed: false,
    publish: vi.fn(),
    refresh: vi.fn(async () => {}),
    remove: vi.fn()
  } as unknown as ReturnType<typeof useBusinessProgressData>
  const onOpenProgress = vi.fn()
  const javaCase = {
    reviewId,
    redactedSubject: 'Java 案件',
    fields: [{ key: 'title', value: 'Java 案件' }]
  } as unknown as JobCaseReviewSnapshot
  render(
    <UiLocaleProvider locale="zh-CN">
      <BusinessProgressContext.Provider value={data}>
        <HrObjectList kind="person" {...listProps} busy={false} cases={[javaCase]} onOpenProgress={onOpenProgress} />
      </BusinessProgressContext.Provider>
    </UiLocaleProvider>
  )
  await screen.findByRole('article', { name: '进场 A' })
  // People who can be arranged come first in 全部, even when the others are newer.
  expect(screen.getAllByRole('article').map((card) => card.getAttribute('aria-label'))).toEqual(['待机 C', '进场 A', '暂停 B'])
  const placedCard = within(screen.getByRole('article', { name: '进场 A' }))
  expect(placedCard.getByText('已进场', { selector: '.hr-status-badge' })).toBeInTheDocument()
  expect(placedCard.getByText('9/10 起 · Java 案件')).toBeInTheDocument()
  expect(placedCard.queryByRole('button', { name: '找案件' })).not.toBeInTheDocument()
  fireEvent.click(placedCard.getByRole('button', { name: '记录退场' }))
  expect(onOpenProgress).toHaveBeenCalledWith(expect.objectContaining({ title: '进场 A' }))
  expect(within(screen.getByRole('article', { name: '暂停 B' })).getByRole('button', { name: '恢复营业' })).toBeInTheDocument()
  expect(
    within(screen.getByRole('article', { name: '待机 C' })).queryByText('待机中', { selector: '.hr-status-badge' })
  ).not.toBeInTheDocument()
})
