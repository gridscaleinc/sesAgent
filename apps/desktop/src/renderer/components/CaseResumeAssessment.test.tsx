import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import type { CasePersonAssessment } from '@shared'
import { CaseResumeAssessment } from './CaseResumeAssessment'
vi.mock('../i18n', () => ({ useUiLocale: () => 'zh-CN' }))
const job = { reviewId: 'review', lifecycle: 'active', fields: [], jobCase: { id: 'case', version: 1 } } as any
const person = { documentId: 'person', recordStatus: 'active', fileName: 'resume.pdf', profile: { version: 1 } } as any
const assessment = { id: 'result', documentId: 'person', jobCaseId: 'case', jobCaseVersion: 1, profileVersion: 1, rulesRevision: 0, assessedAt: new Date().toISOString(), appliedRules: [], result: {
  documentId: 'person', profileVersion: 1, score: 0, matched: [], missing: ['Java'], hardFilters: [], qualification: { policyVersion: 'technical-language-v3', status: 'excluded', requirements: [{ requirement: { id: 'R1', key: 'required_skills', label: 'Java', category: 'core', alternatives: [['Java']], minimumYears: null, requiresPractice: false }, outcome: 'conflict', evidence: null, source: null }] },
  assessment: { version: 'match-assessment-v1', fit: 'weak', met: [], gaps: [], confirm: [], reason: '', modelKey: 'test', assessedAt: new Date().toISOString() }
}, cloud: { status: 'reviewed', modelName: 'test', reviewedCount: 1 } } as CasePersonAssessment
beforeEach(() => { Object.defineProperty(window, 'sesAgent', { configurable: true, value: { listWorkRules: vi.fn(async () => ({ revision: 0, rules: [] })), importResumeForCase: vi.fn(async () => ({ person, assessment, error: null })), assessCasePerson: vi.fn(async () => assessment) } as any }) })
afterEach(cleanup)
function file(name: string) { const value = new File(['resume'], name, { type: 'application/pdf' }); Object.defineProperty(value, 'arrayBuffer', { value: async () => new Uint8Array([1,2,3]).buffer }); return value }
it('imports into the current case and displays a clear unsuitable result for missing required skills', async () => {
  render(<CaseResumeAssessment job={job} cases={[job]} />)
  fireEvent.change(screen.getByLabelText('选择简历'), { target: { files: [file('resume.pdf')] } })
  await screen.findByText('不建议向本案提案')
  expect(window.sesAgent.importResumeForCase).toHaveBeenCalledWith({ jobCaseId: 'case', file: { name: 'resume.pdf', bytes: new Uint8Array([1,2,3]) } })
  expect(screen.queryByText('需要确认的地方')).not.toBeInTheDocument()
  expect(screen.getByText('Java')).toBeInTheDocument()
  expect(screen.getByText('当前简历未体现此项必需技能或经验。')).toBeInTheDocument()
})
it('keeps independent failures and reuses a duplicate person result', async () => {
  vi.mocked(window.sesAgent.importResumeForCase).mockRejectedValueOnce(new Error('损坏文件'))
  render(<CaseResumeAssessment job={job} cases={[job]} />)
  fireEvent.change(screen.getByLabelText('选择简历'), { target: { files: [file('bad.pdf'), file('first.pdf'), file('copy.pdf')] } })
  await waitFor(() => expect(window.sesAgent.importResumeForCase).toHaveBeenCalledTimes(3))
  await screen.findByText('不建议向本案提案')
  expect(screen.getAllByText('resume.pdf')).toHaveLength(1)
  expect(screen.getByText('损坏文件')).toBeInTheDocument()
})
it('reuses an archived dropped resume, explains its status and preserves that notice after retry',async()=>{
  vi.mocked(window.sesAgent.importResumeForCase).mockResolvedValue({person:{...person,recordStatus:'archived'},assessment:null,error:'暂时无法评估'})
  render(<CaseResumeAssessment job={job} cases={[job]}/> )
  fireEvent.drop(screen.getByRole('heading',{name:'拖入简历，评估这个案件是否合适'}).parentElement!,{dataTransfer:{files:[file('old-resume.pdf')]}})
  fireEvent.click(await screen.findByRole('button',{name:'简历已导入，重试评估'}))
  await screen.findByText('复用了已归档简历进行本次评估，原记录仍保持归档。')
  expect(window.sesAgent.assessCasePerson).toHaveBeenCalledWith({documentId:'person',jobCaseId:'case'})
  fireEvent.click(screen.getByRole('button',{name:'重新评估'}))
  await waitFor(()=>expect(window.sesAgent.assessCasePerson).toHaveBeenCalledTimes(2))
  expect(screen.getByText('复用了已归档简历进行本次评估，原记录仍保持归档。')).toBeInTheDocument()
})

it('marks old-policy assessments historical and allows reevaluation', async () => {
  const historical = structuredClone(assessment)
  historical.result.qualification!.policyVersion = 'mandatory-evidence-v1'
  vi.mocked(window.sesAgent.importResumeForCase).mockResolvedValue({ person, assessment: historical, error: null })
  render(<CaseResumeAssessment job={job} cases={[job]} />)
  fireEvent.change(screen.getByLabelText('选择简历'), { target: { files: [file('resume.pdf')] } })
  await screen.findByText('资料或规则已更新，旧结论已停用。请重新评估。')
  expect(screen.getByRole('button', { name: '生成面试问题' })).toBeDisabled()
  fireEvent.click(screen.getByRole('button', { name: '重新评估' }))
  await waitFor(() => expect(screen.queryByText('资料或规则已更新，旧结论已停用。请重新评估。')).not.toBeInTheDocument())
})

it('shows the saved question draft for this person and case again when the card is reopened', async () => {
  const draft = { id: 'd1', documentId: 'person', jobCaseId: 'case', jobCaseVersion: 1, profileVersion: 1, rulesRevision: 0, experienceRunId: null, createdAt: new Date().toISOString(), supersededAt: null,
    questions: [{ id: 'dq-1', text: '请说明 Java 项目中本人负责的范围。', selected: true, source: 'match', sourceLabel: '履历真实性与深度 · Java', scoringGuide: '本人职责与成果' }] }
  ;(window.sesAgent as any).getCaseQuestionDraft = vi.fn(async () => ({ draft, stale: false }))
  render(<CaseResumeAssessment job={job} cases={[job]} />)
  fireEvent.change(screen.getByLabelText('选择简历'), { target: { files: [file('resume.pdf')] } })
  await screen.findByText('请说明 Java 项目中本人负责的范围。')
  expect((window.sesAgent as any).getCaseQuestionDraft).toHaveBeenCalledWith({ documentId: 'person', jobCaseId: 'case' })
  expect(screen.getByText('已随本人员与案件保存，安排面试后会带入第一轮。')).toBeInTheDocument()
  expect(screen.getByRole('button', { name: '重新生成面试问题' })).toBeInTheDocument()
})
