import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { useState } from 'react'
import { businessMatchingPolicyVersion, type CasePersonAssessment } from '@shared'
import { AssessmentCard } from './CaseResumeAssessment'
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
/** Holds the card's latest assessment the way the resume panel does, so reassessment results replace the card. */
function Card({ initial, archived }: { initial: CasePersonAssessment; archived?: boolean }) {
  const [value, setValue] = useState(initial)
  return (
    <AssessmentCard
      value={value}
      name="resume.pdf"
      jobCaseId="case"
      archived={archived}
      stale={value.result.qualification?.policyVersion !== businessMatchingPolicyVersion}
      onRefresh={setValue}
    />
  )
}
it('displays a clear unsuitable result for missing required skills', async () => {
  render(<Card initial={assessment} />)
  await screen.findByText('不建议向本案提案')
  expect(screen.queryByText('需要确认的地方')).not.toBeInTheDocument()
  expect(screen.getByText('Java')).toBeInTheDocument()
  expect(screen.getByText('当前简历未体现此项必需技能或经验。')).toBeInTheDocument()
})
it('explains a reused archived resume and preserves that notice after reevaluation', async () => {
  render(<Card initial={assessment} archived />)
  await screen.findByText('复用了已归档简历进行本次评估，原记录仍保持归档。')
  fireEvent.click(screen.getByRole('button', { name: '重新评估' }))
  await waitFor(() => expect(window.sesAgent.assessCasePerson).toHaveBeenCalledWith({ documentId: 'person', jobCaseId: 'case' }))
  expect(screen.getByText('复用了已归档简历进行本次评估，原记录仍保持归档。')).toBeInTheDocument()
})

it('marks old-policy assessments historical and allows reevaluation', async () => {
  const historical = structuredClone(assessment)
  historical.result.qualification!.policyVersion = 'mandatory-evidence-v1'
  render(<Card initial={historical} />)
  await screen.findByText('资料或规则已更新，旧结论已停用。请重新评估。')
  expect(screen.getByRole('button', { name: '生成面试问题' })).toBeDisabled()
  fireEvent.click(screen.getByRole('button', { name: '重新评估' }))
  await waitFor(() => expect(screen.queryByText('资料或规则已更新，旧结论已停用。请重新评估。')).not.toBeInTheDocument())
})

it('shows the saved question draft for this person and case again when the card is reopened', async () => {
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
  await screen.findByText('请说明 Java 项目中本人负责的范围。')
  expect((window.sesAgent as any).getCaseQuestionDraft).toHaveBeenCalledWith({ documentId: 'person', jobCaseId: 'case' })
  expect(screen.getByText('已随本人员与案件保存，开始跟进后会带入第一轮面试。')).toBeInTheDocument()
  expect(screen.getByRole('button', { name: '重新生成面试问题' })).toBeInTheDocument()
})

it('reassesses with what HR asked for and shows that request on the resulting card', async () => {
  vi.mocked(window.sesAgent.assessCasePerson).mockResolvedValue({ ...assessment, id: 'steered', request: '重点看日语沟通能力' })
  render(<Card initial={assessment} />)
  await screen.findByText('不建议向本案提案')
  expect(screen.queryByText(/本次评估按你的要求侧重/)).not.toBeInTheDocument()
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
  expect(screen.getByLabelText('对 AI 评估的要求')).toHaveValue('')
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
  expect(await screen.findByText(/AI 核实/, { selector: '.is-ai-verified' })).toBeInTheDocument()
  expect(screen.getByText(/AI 引用简历原文核实了 1 项条件/)).toBeInTheDocument()
})
it('says plainly when the cloud AI did not change the local result', async () => {
  render(<Card initial={assessment} />)
  expect(await screen.findByText(/AI 核对了简历原文，没有改变本地核对的结论/)).toBeInTheDocument()
})
