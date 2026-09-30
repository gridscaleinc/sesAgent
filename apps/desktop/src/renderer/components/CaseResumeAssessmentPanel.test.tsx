import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import type { CandidateReviewSnapshot, CasePersonAssessment, JobCaseReviewSnapshot } from '@shared'
import { CaseResumeAssessmentPanel } from './CaseResumeAssessmentPanel'
import { useCaseResumeAssessments } from './use-case-resume-assessments'
vi.mock('../i18n', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../i18n')>()
  return {
    ...actual,
    useUiLocale: () => 'zh-CN',
    useLocaleText: () => ({ locale: 'zh-CN' as const, zh: true, t: actual.localeText(true) })
  }
})

const job = {
  reviewId: 'review',
  reviewRevision: 1,
  lifecycle: 'active',
  redactedSubject: 'Java case',
  fields: [],
  jobCase: { id: 'case', version: 1 }
} as unknown as JobCaseReviewSnapshot
const person = (documentId: string, name: string, confirmedAt = '2026-09-01T00:00:00.000Z') =>
  ({
    documentId,
    fileName: `${documentId}.pdf`,
    localIdentity: { displayName: name },
    recordStatus: 'active',
    inTalentLibrary: true,
    projectExperiences: [],
    profile: { version: 1, confirmedAt }
  }) as unknown as CandidateReviewSnapshot
const requirement = (outcome: 'met' | 'conflict') => ({
  requirement: {
    id: 'R1',
    key: 'required_skills',
    label: 'Java',
    category: 'core' as const,
    alternatives: [['Java']],
    minimumYears: null,
    requiresPractice: false
  },
  outcome,
  evidence: null,
  source: null
})
const saved = (
  documentId: string,
  status: 'recommended' | 'needs-confirmation' | 'excluded',
  score: number,
  assessedAt = '2026-09-10T01:30:00.000Z'
): CasePersonAssessment => ({
  id: `a-${documentId}`,
  origin: 'search',
  documentId,
  jobCaseId: 'case',
  jobCaseVersion: 1,
  profileVersion: 1,
  rulesRevision: 0,
  appliedRules: [],
  assessedAt,
  result: {
    documentId,
    profileVersion: 1,
    score,
    matched: [],
    missing: [],
    hardFilters: [],
    qualification: {
      policyVersion: 'technical-language-v5',
      status,
      requirements: status === 'excluded' ? [requirement('conflict')] : []
    }
  },
  cloud: { status: 'reviewed', reviewedCount: 1, modelName: 'Test AI' }
})
const people = [person('pending', '待补充'), person('fit', '可提案'), person('out', '被排除')]
const onSchedule = vi.fn(async (_values: CasePersonAssessment[]) => {})
function Harness({
  list = people,
  onOpenPersonImport,
  onBack = () => {}
}: {
  list?: CandidateReviewSnapshot[]
  onOpenPersonImport?(): void
  onBack?(): void
}) {
  const controller = useCaseResumeAssessments('zh-CN')
  return (
    <CaseResumeAssessmentPanel
      job={job}
      people={list}
      controller={controller}
      onBack={onBack}
      onOriginal={() => {}}
      onPrepare={() => {}}
      onFollowUp={() => {}}
      onSchedule={onSchedule}
      onOpenPersonImport={onOpenPersonImport}
    />
  )
}
/** The list rows of the people list, in display order. */
const rows = () =>
  within(screen.getByRole('list', { name: '人员' }))
    .getAllByRole('button')
    .filter((item) => item.dataset.matchRow)
const row = (name: string) => rows().find((item) => item.textContent?.startsWith(name))!
const detail = (name: string) => screen.getByRole('article', { name })
const openMenu = (card: HTMLElement) => {
  fireEvent.click(within(card).getByRole('button', { name: '更多操作' }))
  return within(within(card).getByRole('menu'))
}
beforeEach(() => {
  onSchedule.mockClear()
  Object.defineProperty(window, 'sesAgent', {
    configurable: true,
    value: {
      listWorkRules: vi.fn(async () => ({ revision: 0, rules: [] })),
      listCaseAssessments: vi.fn(async () => [
        saved('pending', 'needs-confirmation', 9),
        saved('fit', 'recommended', 1),
        saved('out', 'excluded', 5)
      ]),
      getPersonnelWorkspace: vi.fn(async () => ({ templates: [], states: [], copies: [] })),
      findPersonnelForCase: vi.fn()
    }
  })
})
afterEach(cleanup)

it('ranks saved results by fit, names who was excluded and when the search ran', async () => {
  const onBack = vi.fn()
  render(<Harness onBack={onBack} />)
  await screen.findByRole('article', { name: '可提案' })
  expect(rows().map((item) => item.querySelector('strong')?.textContent)).toEqual(['可提案', '待补充'])
  // The best fit is selected and shown; its row is the current one.
  expect(row('可提案')).toHaveAttribute('aria-current', 'true')
  expect(within(row('可提案')).getByText('可以提案')).toBeInTheDocument()
  expect(within(row('待补充')).getByText('核心信息待补充')).toBeInTheDocument()
  expect(screen.getByText(/上次找人：2026\/9\/10 10:30/)).toBeInTheDocument()
  const excluded = screen.getByText('已排除 1', { selector: 'summary' }).closest('details')!
  expect(within(excluded).getByText('1 人因硬性条件被排除')).toBeInTheDocument()
  expect(within(excluded).getByText('被排除')).toBeInTheDocument()
  expect(within(excluded).getByText('不满足：Java')).toBeInTheDocument()
  // A saved search is not rerun on open.
  expect(window.sesAgent.findPersonnelForCase).not.toHaveBeenCalled()
  expect(screen.getByRole('button', { name: '重新找人' })).toBeEnabled()
  fireEvent.click(screen.getByRole('button', { name: /返回案件列表/ }))
  expect(onBack).toHaveBeenCalledOnce()
})

it('keeps the page header to one row with the case requirements and existing people behind 「要求」', async () => {
  const withFields = {
    ...job,
    fields: [
      { key: 'title', label: '案件名', value: 'Java 开发' },
      { key: 'required_skills', label: '必須スキル', value: 'Java 5年' }
    ]
  } as unknown as JobCaseReviewSnapshot
  function FieldsHarness() {
    const controller = useCaseResumeAssessments('zh-CN')
    return (
      <CaseResumeAssessmentPanel
        job={withFields}
        people={people}
        controller={controller}
        onBack={() => {}}
        onOriginal={() => {}}
        onPrepare={() => {}}
        onFollowUp={() => {}}
      />
    )
  }
  render(<FieldsHarness />)
  await screen.findByRole('article', { name: '可提案' })
  expect(screen.getByRole('heading', { name: 'Java 开发' })).toBeVisible()
  const trigger = screen.getByRole('button', { name: /^要求/ })
  expect(trigger).toHaveAttribute('aria-haspopup', 'dialog')
  expect(screen.queryByRole('dialog', { name: '案件要求' })).not.toBeInTheDocument()
  fireEvent.click(trigger)
  const popover = screen.getByRole('dialog', { name: '案件要求' })
  expect(within(popover).getByText('Java 5年')).toBeVisible()
  expect(within(popover).getByRole('combobox', { name: '选择已有人员评估' })).toBeVisible()
  fireEvent.keyDown(popover, { key: 'Escape' })
  expect(screen.queryByRole('dialog', { name: '案件要求' })).not.toBeInTheDocument()
  // The file hint is only a tooltip, not a header line.
  expect(screen.queryByText(/每次最多 10 份/)).not.toBeInTheDocument()
  expect(screen.getByText('+ 添加简历').closest('label')).toHaveAttribute('title', expect.stringContaining('每次最多 10 份'))
})

it('moves the selection with the arrow keys and shows one person at a time with tabs', async () => {
  render(<Harness />)
  await screen.findByRole('article', { name: '可提案' })
  fireEvent.keyDown(row('可提案'), { key: 'ArrowDown' })
  expect(row('待补充')).toHaveAttribute('aria-current', 'true')
  expect(row('可提案')).not.toHaveAttribute('aria-current')
  expect(detail('待补充')).toBeInTheDocument()
  expect(screen.queryByRole('article', { name: '可提案' })).not.toBeInTheDocument()
  const tabs = within(detail('待补充')).getAllByRole('tab')
  expect(tabs.map((tab) => tab.textContent)).toEqual(['匹配依据', '推荐要点', '需沟通', 'AI 意见', '面试问题', '记录'])
  expect(tabs[0]).toHaveAttribute('aria-selected', 'true')
  fireEvent.click(tabs[5]!)
  expect(within(detail('待补充')).getByRole('tabpanel')).toHaveTextContent('评估时间')
  // The chosen tab stays when another person is compared.
  fireEvent.click(row('可提案'))
  expect(within(detail('可提案')).getByRole('tab', { name: '记录' })).toHaveAttribute('aria-selected', 'true')
})

it('puts the next steps first and starts a follow-up for one or several people', async () => {
  render(<Harness />)
  const card = await screen.findByRole('article', { name: '可提案' })
  const actions = within(card).getByRole('button', { name: '准备介绍' }).parentElement!
  expect(within(actions).getByRole('button', { name: '开始跟进' })).toBeEnabled()
  expect(within(card).queryByRole('button', { name: '安排面试' })).not.toBeInTheDocument()
  expect(within(actions).getByRole('button', { name: '更多操作' })).toHaveAttribute('aria-haspopup', 'menu')
  expect(within(card).queryByText('已入库')).not.toBeInTheDocument()
  fireEvent.click(within(actions).getByRole('button', { name: '开始跟进' }))
  await waitFor(() => expect(onSchedule).toHaveBeenCalledWith([expect.objectContaining({ documentId: 'fit' })]))
  fireEvent.click(screen.getByRole('checkbox', { name: '选择 可提案' }))
  fireEvent.click(screen.getByRole('checkbox', { name: '选择 待补充' }))
  fireEvent.click(screen.getByRole('button', { name: '为选中人员开始跟进（2）' }))
  await waitFor(() => expect(onSchedule).toHaveBeenCalledTimes(2))
  expect(onSchedule.mock.calls[1]![0]).toHaveLength(2)
})

it('offers one bulk reassessment for outdated results and explains disabled actions', async () => {
  vi.mocked(window.sesAgent.listWorkRules).mockResolvedValue({ revision: 2, rules: [] } as never)
  render(<Harness />)
  expect(await screen.findByRole('button', { name: '全部重新评估（2）' })).toBeEnabled()
  expect(within(row('可提案')).getByText('需重新评估')).toBeInTheDocument()
  const card = detail('可提案')
  const prepare = within(card).getByRole('button', { name: '准备介绍' })
  expect(prepare).toBeDisabled()
  expect(prepare).toHaveAttribute('title', '资料或规则已更新，请先重新评估')
  expect(within(card).getByText('资料或规则已更新，请先重新评估')).toBeVisible()
})

it('shows a retry instead of outdated results when the rules cannot be read', async () => {
  vi.mocked(window.sesAgent.listWorkRules).mockRejectedValue(new Error('offline'))
  render(<Harness />)
  const card = await screen.findByRole('article', { name: '可提案' })
  expect(await screen.findByRole('button', { name: '重试' })).toBeInTheDocument()
  expect(screen.queryByText('需重新评估')).not.toBeInTheDocument()
  expect(screen.queryByRole('button', { name: /全部重新评估/ })).not.toBeInTheDocument()
  expect(within(card).getByRole('button', { name: '准备介绍' })).toHaveAttribute('title', '规则读取失败，请先重试')
})

it('hints at a new search when people were confirmed after the last one', async () => {
  render(<Harness list={[...people, person('new', '新人员', '2026-09-20T00:00:00.000Z')]} />)
  expect(await screen.findByText(/上次找人后有 1 位人员新增或更新了资料/)).toBeInTheDocument()
})

it('shows one empty state naming an empty person library, with ways to add people', async () => {
  vi.mocked(window.sesAgent.listCaseAssessments).mockResolvedValue([])
  const onOpenPersonImport = vi.fn()
  render(<Harness list={[]} onOpenPersonImport={onOpenPersonImport} />)
  const empty = await screen.findByText('人员库里还没有可匹配的人员。先添加简历，或到人员页导入。')
  const box = within(empty.closest('.hr-empty') as HTMLElement)
  expect(screen.queryByText(/技能不相关/u)).not.toBeInTheDocument()
  expect(screen.queryByText('暂无可推荐人员')).not.toBeInTheDocument()
  expect(box.getByText('添加简历')).toBeInTheDocument()
  fireEvent.click(box.getByRole('button', { name: '去人员页导入' }))
  expect(onOpenPersonImport).toHaveBeenCalledOnce()
})

it('offers the batch follow-up only once someone is selected', async () => {
  render(<Harness />)
  await screen.findByRole('article', { name: '可提案' })
  expect(screen.queryByRole('button', { name: /为选中人员开始跟进/u })).not.toBeInTheDocument()
  fireEvent.click(screen.getByRole('checkbox', { name: '选择 可提案' }))
  expect(screen.getByRole('button', { name: '为选中人员开始跟进（1）' })).toBeEnabled()
})

it('accepts resumes dropped anywhere on the page and names the formats only while dragging', async () => {
  const enqueue = vi.fn()
  Object.assign(window.sesAgent, {
    prepareCaseAssessment: vi.fn(async () => ({ jobCase: { id: 'case' } })),
    importResumeForCase: vi.fn(() => new Promise(() => undefined)),
    onCaseResumeImportProgress: enqueue
  })
  render(<Harness />)
  const page = await screen.findByRole('region', { name: '案件找人' })
  await screen.findByRole('article', { name: '可提案' })
  const file = new File(['resume'], 'Engineer.xlsx')
  Object.defineProperty(file, 'arrayBuffer', { value: async () => new ArrayBuffer(6) })
  fireEvent.dragEnter(page, { dataTransfer: { types: ['Files'] } })
  expect(screen.getByText(/每次最多 10 份/)).toBeInTheDocument()
  fireEvent.drop(page, { dataTransfer: { files: [file], types: ['Files'] } })
  expect(screen.queryByText(/每次最多 10 份/)).not.toBeInTheDocument()
  // The new resume is listed first and selected.
  expect(await screen.findByRole('article', { name: 'Engineer.xlsx' })).toBeInTheDocument()
  expect(rows()[0]).toHaveAttribute('aria-current', 'true')
})

it('marks people kept for this case only and joins them to the library one by one or all at once', async () => {
  const addCandidateToLibrary = vi.fn(async () => ({}))
  Object.assign(window.sesAgent, { addCandidateToLibrary })
  const outside = people.map((item) => ({ ...item, inTalentLibrary: false }) as CandidateReviewSnapshot)
  render(<Harness list={outside} />)
  const card = await screen.findByRole('article', { name: '可提案' })
  expect(within(row('可提案')).getByText('未入库')).toBeVisible()
  fireEvent.click(openMenu(card).getByRole('menuitem', { name: '加入人员库' }))
  await waitFor(() => expect(addCandidateToLibrary).toHaveBeenCalledWith({ documentId: 'fit', profileVersion: 1 }))
  await waitFor(() => expect(within(row('可提案')).queryByText('未入库')).not.toBeInTheDocument())
  expect(within(card).queryByRole('menuitem', { name: '加入人员库', hidden: true })).not.toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: '全部加入人员库（1）' }))
  await waitFor(() => expect(addCandidateToLibrary).toHaveBeenCalledWith({ documentId: 'pending', profileVersion: 1 }))
  await waitFor(() => expect(screen.queryByRole('button', { name: /全部加入人员库/u })).not.toBeInTheDocument())
})
