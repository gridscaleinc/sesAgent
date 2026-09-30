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
function Harness({ list = people, onOpenPersonImport }: { list?: CandidateReviewSnapshot[]; onOpenPersonImport?(): void }) {
  const controller = useCaseResumeAssessments('zh-CN')
  return (
    <CaseResumeAssessmentPanel
      job={job}
      people={list}
      controller={controller}
      onClose={() => {}}
      onOriginal={() => {}}
      onPrepare={() => {}}
      onFollowUp={() => {}}
      onSchedule={onSchedule}
      onOpenPersonImport={onOpenPersonImport}
    />
  )
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
  render(<Harness />)
  await screen.findByRole('article', { name: '可提案' })
  const names = screen.getAllByRole('article').map((item) => item.getAttribute('aria-label'))
  expect(names).toEqual(['可提案', '待补充'])
  expect(screen.getByText(/上次找人：2026\/9\/10 10:30/)).toBeInTheDocument()
  const excluded = screen.getByText('另有 1 人因硬性条件被排除').closest('details')!
  expect(within(excluded).getByText('被排除')).toBeInTheDocument()
  expect(within(excluded).getByText('不满足：Java')).toBeInTheDocument()
  // A saved search is not rerun on open.
  expect(window.sesAgent.findPersonnelForCase).not.toHaveBeenCalled()
  expect(screen.getByRole('button', { name: '重新找人' })).toBeEnabled()
})

it('puts the next steps first and starts a follow-up for one or several people', async () => {
  render(<Harness />)
  const card = await screen.findByRole('article', { name: '可提案' })
  fireEvent.click(within(card).getByRole('button', { name: /查看评估详情/ }))
  const actions = within(card).getByRole('button', { name: '准备介绍' }).parentElement!
  expect(within(actions).getByRole('button', { name: '开始跟进' })).toBeEnabled()
  expect(within(card).queryByRole('button', { name: '安排面试' })).not.toBeInTheDocument()
  expect(within(card).getByText('更多工具')).toBeInTheDocument()
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
  const card = await screen.findByRole('article', { name: '可提案' })
  expect(await screen.findByRole('button', { name: '全部重新评估（2）' })).toBeEnabled()
  fireEvent.click(within(card).getByRole('button', { name: /查看评估详情/ }))
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
  fireEvent.click(within(card).getByRole('button', { name: /查看评估详情/ }))
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

it('marks people kept for this case only and joins them to the library one by one or all at once', async () => {
  const addCandidateToLibrary = vi.fn(async () => ({}))
  Object.assign(window.sesAgent, { addCandidateToLibrary })
  const outside = people.map((item) => ({ ...item, inTalentLibrary: false }) as CandidateReviewSnapshot)
  render(<Harness list={outside} />)
  const card = await screen.findByRole('article', { name: '可提案' })
  expect(within(card).getByText('未入库')).toBeVisible()
  fireEvent.click(within(card).getByRole('button', { name: '加入人员库' }))
  await waitFor(() => expect(addCandidateToLibrary).toHaveBeenCalledWith({ documentId: 'fit', profileVersion: 1 }))
  await waitFor(() => expect(within(card).queryByText('未入库')).not.toBeInTheDocument())
  fireEvent.click(screen.getByRole('button', { name: '全部加入人员库（1）' }))
  await waitFor(() => expect(addCandidateToLibrary).toHaveBeenCalledWith({ documentId: 'pending', profileVersion: 1 }))
  await waitFor(() => expect(screen.queryByRole('button', { name: /全部加入人员库/u })).not.toBeInTheDocument())
})
