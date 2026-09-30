import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { useState } from 'react'
import { businessMatchingPolicyVersion, type CasePersonAssessment } from '@shared'
import { CasePersonDetail, type MatchDetailTabId } from './CasePersonDetail'
vi.mock('../i18n', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../i18n')>()
  return {
    ...actual,
    useUiLocale: () => 'zh-CN',
    useLocaleText: () => ({ locale: 'zh-CN' as const, zh: true, t: actual.localeText(true) })
  }
})
const assessment = {
  id: 'result',
  documentId: 'person',
  jobCaseId: 'case',
  jobCaseVersion: 1,
  profileVersion: 1,
  rulesRevision: 0,
  assessedAt: new Date().toISOString(),
  appliedRules: [],
  result: {
    documentId: 'person',
    profileVersion: 1,
    score: 0,
    matched: [],
    missing: ['Java'],
    hardFilters: [],
    qualification: {
      policyVersion: 'technical-language-v5',
      status: 'excluded',
      requirements: [
        {
          requirement: {
            id: 'R1',
            key: 'required_skills',
            label: 'Java',
            category: 'core',
            alternatives: [['Java']],
            minimumYears: null,
            requiresPractice: false
          },
          outcome: 'conflict',
          evidence: null,
          source: null
        }
      ]
    },
    assessment: {
      version: 'match-assessment-v1',
      fit: 'weak',
      met: [],
      gaps: [],
      confirm: [],
      reason: '',
      modelKey: 'test',
      assessedAt: new Date().toISOString()
    }
  },
  cloud: { status: 'reviewed', modelName: 'test', reviewedCount: 1 }
} as CasePersonAssessment
beforeEach(() => {
  Object.defineProperty(window, 'sesAgent', {
    configurable: true,
    value: {
      listWorkRules: vi.fn(async () => ({ revision: 0, rules: [] })),
      assessCasePerson: vi.fn(async () => assessment)
    } as any
  })
})
afterEach(cleanup)
/** Holds the latest assessment the way the results page does, so reassessment results replace the detail. */
function Card({ initial, archived }: { initial: CasePersonAssessment; archived?: boolean }) {
  const [value, setValue] = useState(initial)
  const [tab, setTab] = useState<MatchDetailTabId>('evidence')
  return (
    <CasePersonDetail
      value={value}
      name="resume.pdf"
      jobCaseId="case"
      reviewId="review"
      archived={archived}
      blocked=""
      hasFollowUp={false}
      tab={tab}
      onTab={setTab}
      onBackToList={() => {}}
      stale={value.result.qualification?.policyVersion !== businessMatchingPolicyVersion}
      onRefresh={setValue}
    />
  )
}
const menu = () => {
  fireEvent.click(screen.getByRole('button', { name: '更多操作' }))
  return within(screen.getByRole('menu'))
}
const openTab = (name: string) => {
  fireEvent.click(screen.getByRole('tab', { name }))
  return within(screen.getByRole('tabpanel'))
}
it('displays a clear unsuitable result for missing required skills in the requirement table', async () => {
  render(<Card initial={assessment} />)
  await screen.findByText('不建议向本案提案')
  expect(screen.queryByText('需要确认的地方')).not.toBeInTheDocument()
  const table = within(screen.getByRole('table', { name: '匹配依据' }))
  const cells = within(table.getByRole('row', { name: /Java/ })).getAllByRole('cell')
  expect(table.getByRole('rowheader', { name: '必需技能' })).toBeInTheDocument()
  expect(cells.map((cell) => cell.textContent)).toEqual(['Java', '—', '✗ 不满足'])
  // A missing value is only the em dash and the state; no sentence is repeated per requirement.
  expect(screen.queryByText(/当前简历未体现|人员资料尚未说明/)).not.toBeInTheDocument()
})
it('explains a reused archived resume and preserves that notice after reevaluation', async () => {
  render(<Card initial={assessment} archived />)
  await screen.findByText('复用了已归档简历进行本次评估，原记录仍保持归档。')
  fireEvent.click(menu().getByRole('menuitem', { name: '重新评估（可附要求）' }))
  fireEvent.click(screen.getByRole('button', { name: '重新评估' }))
  await waitFor(() => expect(window.sesAgent.assessCasePerson).toHaveBeenCalledWith({ documentId: 'person', jobCaseId: 'case' }))
  expect(screen.getByText('复用了已归档简历进行本次评估，原记录仍保持归档。')).toBeInTheDocument()
})

it('marks old-policy assessments historical and allows reevaluation', async () => {
  const historical = structuredClone(assessment)
  historical.result.qualification!.policyVersion = 'mandatory-evidence-v1'
  render(<Card initial={historical} />)
  expect((await screen.findAllByText('资料或规则已更新，旧结论已停用。请重新评估。'))[0]).toBeVisible()
  expect(openTab('面试问题').getByRole('button', { name: '生成面试问题' })).toBeDisabled()
  // A stale result shows the reassessment right away, not behind the menu.
  fireEvent.click(screen.getByRole('button', { name: '重新评估' }))
  await waitFor(() => expect(screen.queryByText('资料或规则已更新，旧结论已停用。请重新评估。')).not.toBeInTheDocument())
})

it('summarises the saved question draft for this person and case, with the cards behind 「展开」', async () => {
  const draft = {
    id: 'd1',
    documentId: 'person',
    jobCaseId: 'case',
    jobCaseVersion: 1,
    profileVersion: 1,
    rulesRevision: 0,
    experienceRunId: null,
    createdAt: new Date().toISOString(),
    supersededAt: null,
    questions: [
      {
        id: 'dq-1',
        text: '请说明 Java 项目中本人负责的范围。',
        selected: true,
        source: 'match',
        sourceLabel: '履历真实性与深度 · Java',
        scoringGuide: '本人职责与成果'
      }
    ]
  }
  ;(window.sesAgent as any).getCaseQuestionDraft = vi.fn(async () => ({ draft, stale: false }))
  render(<Card initial={assessment} />)
  const panel = openTab('面试问题')
  expect(await panel.findByText('已准备 1 题，开始跟进后带入第一轮。')).toBeVisible()
  expect((window.sesAgent as any).getCaseQuestionDraft).toHaveBeenCalledWith({ documentId: 'person', jobCaseId: 'case' })
  // The full questions are not shown at matching time until expanded.
  expect(panel.getByText('请说明 Java 项目中本人负责的范围。')).not.toBeVisible()
  fireEvent.click(panel.getByText('展开'))
  expect(panel.getByText('请说明 Java 项目中本人负责的范围。')).toBeVisible()
  expect(panel.getByRole('button', { name: '重新生成面试问题' })).toBeInTheDocument()
  expect(menu().getByRole('menuitem', { name: '重新生成面试问题' })).toBeInTheDocument()
})

it('reassesses with what HR asked for and shows that request on the resulting detail', async () => {
  vi.mocked(window.sesAgent.assessCasePerson).mockResolvedValue({ ...assessment, id: 'steered', request: '重点看日语沟通能力' })
  render(<Card initial={assessment} />)
  await screen.findByText('不建议向本案提案')
  expect(screen.queryByText(/本次评估按你的要求侧重/)).not.toBeInTheDocument()
  expect(screen.queryByLabelText('对 AI 评估的要求')).not.toBeInTheDocument()
  fireEvent.click(menu().getByRole('menuitem', { name: '重新评估（可附要求）' }))
  fireEvent.change(screen.getByLabelText('对 AI 评估的要求'), { target: { value: ' 重点看日语沟通能力 ' } })
  fireEvent.click(screen.getByRole('button', { name: '重新评估' }))
  await waitFor(() =>
    expect(window.sesAgent.assessCasePerson).toHaveBeenCalledWith({
      jobCaseId: 'case',
      documentId: 'person',
      request: '重点看日语沟通能力'
    })
  )
  expect(await screen.findByText('本次评估按你的要求侧重：重点看日语沟通能力')).toBeInTheDocument()
  expect(screen.queryByLabelText('对 AI 评估的要求')).not.toBeInTheDocument()
})
it('records my judgement from the menu on the 记录 tab', async () => {
  ;(window.sesAgent as any).saveAssessmentFeedback = vi.fn(async () => ({}))
  render(<Card initial={assessment} />)
  await screen.findByText('不建议向本案提案')
  fireEvent.click(menu().getByRole('menuitem', { name: '记录我的判断' }))
  expect(screen.getByRole('tab', { name: '记录' })).toHaveAttribute('aria-selected', 'true')
  const panel = within(screen.getByRole('tabpanel'))
  fireEvent.change(panel.getByRole('combobox', { name: '我的判断' }), { target: { value: 'unsuitable' } })
  fireEvent.click(panel.getByRole('button', { name: '保存判断' }))
  await waitFor(() =>
    expect((window.sesAgent as any).saveAssessmentFeedback).toHaveBeenCalledWith({
      assessmentId: 'result',
      decision: 'unsuitable',
      reason: 'evidence',
      note: ''
    })
  )
  expect(await screen.findByText('判断已保存，已关联本次评估。')).toBeInTheDocument()
})
it('says what the cloud AI settled, not only that it finished', async () => {
  const requirement = assessment.result.qualification!.requirements[0]!
  const reviewed = {
    ...assessment,
    result: {
      ...assessment.result,
      qualification: {
        ...assessment.result.qualification!,
        status: 'recommended',
        requirements: [{ ...requirement, outcome: 'met', evidence: 'Java で決済 API を開発', source: '決済基盤', aiVerified: true }]
      }
    }
  } as CasePersonAssessment
  render(<Card initial={reviewed} />)
  expect(await screen.findByText(/AI 核实/, { selector: '.is-ai-verified' })).toBeVisible()
  expect(screen.getByText('決済基盤', { selector: '.requirement-source' })).toBeVisible()
  expect(openTab('AI 意见').getByText(/AI 引用简历原文核实了 1 项条件/)).toBeVisible()
})
it('says plainly when the cloud AI did not change the local result', async () => {
  render(<Card initial={assessment} />)
  expect(await openTab('AI 意见').findByText(/AI 核对了简历原文，没有改变本地核对的结论/)).toBeVisible()
})
