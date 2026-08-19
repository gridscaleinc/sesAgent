import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { createWorkTaskPreview, materializeWorkTask } from '@application'
import type { CandidateInterviewSnapshot, CandidateReviewSnapshot, OriginalDocumentPreview, ResumeAnalysisSummary } from '@shared'
import { UiLocaleProvider } from '../i18n'
import { CandidatePipeline } from './CandidatePipeline'

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
  talentPoolStatus: 'none',
  recordStatus: 'active'
}

const interview: CandidateInterviewSnapshot = {
  id: interviewId,
  sourceDocumentId: documentId,
  kind: 'recruiting',
  roundNumber: 1,
  parentInterviewId: null,
  stage: 'interviewing',
  scheduledAt: '2026-07-24T01:00:00.000Z',
  durationMinutes: 60,
  meetingMethod: 'zoom',
  meetingUrl: 'https://company.zoom.us/j/1234567890',
  interviewer: '李娜',
  contactNote: null,
  interviewGoal: '确认技术基础',
  questionPlan: [{ id: 'standard-1', text: '请介绍负责过的项目。', source: 'standard', sourceLabel: '公司固定题', selected: true }],
  interviewNotes: '',
  unresolvedItems: [],
  decision: null,
  decisionReason: null,
  decidedAt: null,
  decidedBy: null,
  createdAt: '2026-07-22T00:00:00.000Z',
  updatedAt: '2026-07-22T00:00:00.000Z',
  updatedBy: '李娜',
  cloudEligible: false
}

describe('CandidatePipeline recruiting workspace', () => {
  it('keeps the full resume workspace and original-document comparison in the candidate flow', async () => {
    const pendingReview: CandidateReviewSnapshot = {
      ...review,
      status: 'awaiting-review',
      completedAt: null,
      reviewerDisplayName: null,
      profile: null,
      recruitingStatus: 'pending-review'
    }
    const analysis: ResumeAnalysisSummary = {
      analysisVersion: 'resume-analysis-v6',
      fileToken: documentId,
      fileName: pendingReview.fileName,
      status: 'requires-pii-review',
      cloudEligible: false,
      statistics: { pages: 0, sheets: 1, blocks: 2, characters: 24 },
      detectedIdentifiers: [],
      localProcessing: { ocr: 'not-required', ocrPages: 0, personNameCandidates: 0, networkAccess: false },
      extractedFields: [],
      extractedProjectExperiences: [],
      warningCodes: [],
      redactedPreview: '[SHEET:Sheet1!A1] Java, AWS',
      analyzedAt: '2026-07-20T00:00:00.000Z'
    }
    const task = {
      ...materializeWorkTask(createWorkTaskPreview('選択した履歴書を安全に取り込みたい'), 'resume-task', '2026-07-20T00:00:00.000Z'),
      contextBindings: [{ objectType: 'staged-file' as const, objectId: documentId, version: 'a'.repeat(64) }]
    }
    const originalPreview: OriginalDocumentPreview = {
      version: 'original-document-preview-v1',
      documentId,
      fileName: pendingReview.fileName,
      format: 'xlsx',
      size: 2048,
      sha256: 'a'.repeat(64),
      viewMode: 'spreadsheet',
      previewUrl: null,
      sheets: [{ name: 'Sheet1', printArea: null, cells: [{ address: 'A1', text: 'Java, AWS', mergedRange: null, inPrintArea: true }] }],
      pages: [],
      paragraphs: [],
      personalFieldSources: {},
      storage: 'encrypted-local-vault',
      cloudEligible: false,
      originalFileAvailable: true
    }
    const onLoadOriginalDocument = vi.fn().mockResolvedValue(originalPreview)

    render(
      <UiLocaleProvider locale="zh-CN">
        <CandidatePipeline
          aiCommerce={{
            configuration: 'required', connection: 'not-connected', productCode: null, billingMode: null,
            memberDisplayName: null, accountId: null, accountAiTokenExpiresAt: null, wallet: null, capabilities: [], refreshedAt: null
          }}
          analyses={[analysis]}
          interviews={[]}
          onConfirmCandidateProfile={vi.fn()} onCreateRound={vi.fn()}
          onImportResume={vi.fn()}
          onLoadOriginalDocument={onLoadOriginalDocument}
          onOpenCandidateLibrary={vi.fn()}
          onOpenCloudSettings={vi.fn()}
          onOpenIntegrationSettings={vi.fn()}
          onOpenOriginalDocument={vi.fn()}
          onOpenZoomMeeting={vi.fn()}
          onRecordDecision={vi.fn()}
          onSaveNotes={vi.fn()}
          onSavePreparation={vi.fn()}
          onSaveSchedule={vi.fn()}
          onSendCloudPrompt={vi.fn()}
          onSetTaskLifecycle={vi.fn()}
          onViewChange={vi.fn()}
          reviews={[pendingReview]}
          tasks={[task]}
          view="resume"
        />
      </UiLocaleProvider>
    )

    fireEvent.click(await screen.findByRole('button', { name: '查看原始简历' }))
    await waitFor(() => expect(onLoadOriginalDocument).toHaveBeenCalledWith(documentId))
    expect(await screen.findByRole('heading', { name: '核对原件与人才档案' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '确认候选人资料' })).toBeInTheDocument()
  })

  it('opens a validated Zoom meeting from the focused interview record tab', async () => {
    const onOpenZoomMeeting = vi.fn().mockResolvedValue({ opened: true })
    render(
      <UiLocaleProvider locale="zh-CN">
        <CandidatePipeline
          analyses={[]}
          interviews={[interview]}
          onConfirmCandidateProfile={vi.fn()} onCreateRound={vi.fn()}
          onImportResume={vi.fn()}
          onOpenCandidateLibrary={vi.fn()}
          onOpenIntegrationSettings={vi.fn()}
          onOpenZoomMeeting={onOpenZoomMeeting}
          onRecordDecision={vi.fn()}
          onSaveNotes={vi.fn()}
          onSavePreparation={vi.fn()}
          onSaveSchedule={vi.fn()}
          onViewChange={vi.fn()}
          reviews={[review]}
          view="workbench"
        />
      </UiLocaleProvider>
    )

    expect(await screen.findByRole('button', { name: '进入 Zoom' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '招聘面试' })).toHaveClass('is-active')
    fireEvent.click(screen.getByRole('button', { name: '进入 Zoom' }))
    expect(onOpenZoomMeeting).toHaveBeenCalledWith({ url: 'https://company.zoom.us/j/1234567890' })
  })

  it('keeps a client-interview decision separate from talent-pool membership', async () => {
    const clientInterview: CandidateInterviewSnapshot = {
      ...interview,
      id: '33333333-3333-4333-8333-333333333333',
      kind: 'client',
      stage: 'awaiting-decision',
      interviewNotes: '客户确认了技术经验。'
    }
    const onRecordDecision = vi.fn().mockResolvedValue({
      ...clientInterview,
      stage: 'passed',
      decision: 'passed',
      decisionReason: '客户确认通过'
    })
    render(
      <UiLocaleProvider locale="zh-CN">
        <CandidatePipeline
          analyses={[]}
          initialCandidateId={documentId}
          interviewKind="client"
          interviews={[clientInterview]}
          onConfirmCandidateProfile={vi.fn()} onCreateRound={vi.fn()}
          onImportResume={vi.fn()}
          onOpenCandidateLibrary={vi.fn()}
          onOpenIntegrationSettings={vi.fn()}
          onOpenZoomMeeting={vi.fn()}
          onRecordDecision={onRecordDecision}
          onSaveNotes={vi.fn()}
          onSavePreparation={vi.fn()}
          onSaveSchedule={vi.fn()}
          onViewChange={vi.fn()}
          reviews={[review]}
          view="decision"
        />
      </UiLocaleProvider>
    )

    expect(await screen.findByRole('heading', { name: '客户面试结论' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '客户面试' })).toHaveClass('is-active')
    fireEvent.change(screen.getByLabelText('客户反馈与人工判断'), { target: { value: '客户确认通过' } })
    fireEvent.click(screen.getByRole('button', { name: '确认面试结论' }))
    await waitFor(() => expect(onRecordDecision).toHaveBeenCalled())
    expect(onRecordDecision).toHaveBeenCalledWith(expect.objectContaining({ decision: 'passed' }))
  })

  it('sends only anonymous interview context to Cloud AI and adds confirmed questions to the plan', async () => {
    const onSendCloudPrompt = vi.fn().mockResolvedValue({
      requestId: 'request-1',
      aiRequestId: 'ai-request-1',
      content: '1. 请说明你在 AWS 项目中本人负责的架构设计和最终结果。\n2. 项目出现故障时，你如何定位并推动恢复？',
      usageCredits: 2,
      wallet: null,
      removedIdentifierTypes: ['person_name'],
      billingModeUsed: 'subscription'
    })
    const privateReview: CandidateReviewSnapshot = {
      ...review,
      localIdentity: {
        ...review.localIdentity!,
        phone: '090-1234-5678',
        email: 'zhang@example.com',
        address: '东京都新宿区西新宿1-1-1'
      }
    }
    render(
      <UiLocaleProvider locale="zh-CN">
        <CandidatePipeline
          aiCommerce={{
            configuration: 'ready', connection: 'connected', productCode: 'sesAgent', billingMode: 'subscription',
            memberDisplayName: 'HR', accountId: 'account-1', accountAiTokenExpiresAt: null, wallet: null, capabilities: [], refreshedAt: null
          }}
          analyses={[]}
          initialCandidateId={documentId}
          interviewKind="recruiting"
          interviews={[{ ...interview, stage: 'scheduled' }]}
          onConfirmCandidateProfile={vi.fn()} onCreateRound={vi.fn()}
          onImportResume={vi.fn()}
          onOpenCandidateLibrary={vi.fn()}
          onOpenCloudSettings={vi.fn()}
          onOpenIntegrationSettings={vi.fn()}
          onOpenZoomMeeting={vi.fn()}
          onRecordDecision={vi.fn()}
          onSaveNotes={vi.fn()}
          onSavePreparation={vi.fn()}
          onSaveSchedule={vi.fn()}
          onSendCloudPrompt={onSendCloudPrompt}
          onViewChange={vi.fn()}
          reviews={[privateReview]}
          view="prepare"
        />
      </UiLocaleProvider>
    )

    expect(await screen.findByRole('heading', { name: 'AI 面试助手' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '允许本轮使用 Cloud AI' }))
    fireEvent.click(screen.getByRole('button', { name: '生成面试问题' }))
    await waitFor(() => expect(onSendCloudPrompt).toHaveBeenCalled())
    const prompt = onSendCloudPrompt.mock.calls[0]?.[0].content as string
    expect(prompt).toContain('匿名候选人编号: C-11111111')
    expect(prompt).toContain('当前面试上下文')
    expect(prompt).not.toContain('张伟')
    expect(prompt).not.toContain('090-1234-5678')
    expect(prompt).not.toContain('zhang@example.com')
    expect(prompt).not.toContain('东京都新宿区西新宿1-1-1')
    expect(prompt).not.toContain('https://company.zoom.us')
    fireEvent.click(screen.getByRole('button', { name: '找出需要核实的地方' }))
    await waitFor(() => expect(onSendCloudPrompt).toHaveBeenCalledTimes(2))
    expect(screen.getByText('本轮已允许发送脱敏上下文')).toBeInTheDocument()
    fireEvent.click(await screen.findByRole('button', { name: '加入问题清单' }))
    expect((await screen.findAllByText('AI 建议 · 待人工确认')).length).toBe(2)
    fireEvent.click(screen.getByRole('button', { name: '关闭 AI 面试助手' }))
    fireEvent.click(screen.getByRole('button', { name: 'AI 面试助手' }))
    expect(screen.getByText('本轮已允许发送脱敏上下文')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '允许本轮使用 Cloud AI' })).not.toBeInTheDocument()
  })

  it('accepts Cloud AI preparation questions when numbered items are joined onto one line', async () => {
    const onSendCloudPrompt = vi.fn().mockResolvedValue({
      requestId: 'request-joined',
      aiRequestId: 'ai-request-joined',
      content: '以下是生成的8个面试问题：\n1.请说明微服务拆分的原则和通信方式？2.请说明选择PostgreSQL与Spring Boot的标准？3.你如何与日本客户确认需求？4.请说明缺陷管理和回归测试流程？5.你如何确保消息转换准确性和审计追踪？6.请举例说明如何协调团队技术分歧？7.你如何优化复杂查询性能？8.请说明你如何决定是否采用React？',
      usageCredits: 2,
      wallet: null,
      removedIdentifierTypes: [],
      billingModeUsed: 'subscription'
    })

    render(
      <UiLocaleProvider locale="zh-CN">
        <CandidatePipeline
          aiCommerce={{
            configuration: 'ready', connection: 'connected', productCode: 'sesAgent', billingMode: 'subscription',
            memberDisplayName: 'HR', accountId: 'account-1', accountAiTokenExpiresAt: null, wallet: null, capabilities: [], refreshedAt: null
          }}
          analyses={[]}
          initialCandidateId={documentId}
          interviewKind="recruiting"
          interviews={[{ ...interview, stage: 'scheduled' }]}
          onConfirmCandidateProfile={vi.fn()} onCreateRound={vi.fn()}
          onImportResume={vi.fn()}
          onOpenCandidateLibrary={vi.fn()}
          onOpenCloudSettings={vi.fn()}
          onOpenIntegrationSettings={vi.fn()}
          onOpenZoomMeeting={vi.fn()}
          onRecordDecision={vi.fn()}
          onSaveNotes={vi.fn()}
          onSavePreparation={vi.fn()}
          onSaveSchedule={vi.fn()}
          onSendCloudPrompt={onSendCloudPrompt}
          onViewChange={vi.fn()}
          reviews={[review]}
          view="prepare"
        />
      </UiLocaleProvider>
    )

    fireEvent.click(await screen.findByRole('checkbox', { name: /确认仅发送匿名化的简历摘要和项目经历/ }))
    fireEvent.click(screen.getByRole('button', { name: '使用 Cloud AI 重新生成' }))

    await waitFor(() => expect(onSendCloudPrompt).toHaveBeenCalledOnce())
    expect(await screen.findByText('Cloud AI 建议 · 已脱敏 · 需人工确认')).toBeInTheDocument()
    expect(document.querySelectorAll('.recruiting-ai-suggestion-list input[type="checkbox"]')).toHaveLength(8)
    expect(screen.getByText('请说明微服务拆分的原则和通信方式？')).toBeInTheDocument()
    expect(screen.getByText('请说明你如何决定是否采用React？')).toBeInTheDocument()
    expect(screen.queryByText('Cloud AI 没有返回可用的面试问题，已保留本机建议。')).not.toBeInTheDocument()
  })

  it('lets HR append a local structured summary into the interview record', async () => {
    render(
      <UiLocaleProvider locale="zh-CN">
        <CandidatePipeline
          analyses={[]}
          interviews={[{ ...interview, interviewNotes: '候选人说明了 AWS 迁移经历。' }]}
          onConfirmCandidateProfile={vi.fn()} onCreateRound={vi.fn()}
          onImportResume={vi.fn()}
          onOpenCandidateLibrary={vi.fn()}
          onOpenIntegrationSettings={vi.fn()}
          onOpenZoomMeeting={vi.fn()}
          onRecordDecision={vi.fn()}
          onSaveNotes={vi.fn()}
          onSavePreparation={vi.fn()}
          onSaveSchedule={vi.fn()}
          onViewChange={vi.fn()}
          reviews={[review]}
          view="workbench"
        />
      </UiLocaleProvider>
    )

    fireEvent.click(await screen.findByRole('button', { name: '整理面试记录' }))
    fireEvent.click(await screen.findByRole('button', { name: '追加到面试记录' }))
    expect((screen.getByLabelText('面试记录') as HTMLTextAreaElement).value).toContain('以上为本机已登记事实')
  })

  it('derives the overview action from the newest round instead of showing an initial-interview CTA', async () => {
    const firstRound: CandidateInterviewSnapshot = {
      ...interview,
      stage: 'on-hold',
      decision: 'next-round',
      decisionReason: '需要确认高并发设计经验。',
      decidedAt: '2026-07-22T01:00:00.000Z',
      decidedBy: '李娜'
    }
    const secondRound: CandidateInterviewSnapshot = {
      ...interview,
      id: '44444444-4444-4444-8444-444444444444',
      roundNumber: 2,
      parentInterviewId: interviewId,
      stage: 'new',
      scheduledAt: null,
      meetingUrl: null,
      interviewer: null,
      questionPlan: [],
      interviewNotes: null,
      unresolvedItems: ['高并发设计经验'],
      decision: null,
      decisionReason: null,
      decidedAt: null,
      decidedBy: null
    }
    render(<UiLocaleProvider locale="zh-CN"><CandidatePipeline analyses={[]} interviews={[firstRound, secondRound]} onConfirmCandidateProfile={vi.fn()} onCreateRound={vi.fn()} onImportResume={vi.fn()} onOpenCandidateLibrary={vi.fn()} onOpenIntegrationSettings={vi.fn()} onOpenZoomMeeting={vi.fn()} onRecordDecision={vi.fn()} onSaveNotes={vi.fn()} onSavePreparation={vi.fn()} onSaveSchedule={vi.fn()} onViewChange={vi.fn()} reviews={[review]} view="overview" /></UiLocaleProvider>)

    expect(await screen.findByRole('button', { name: '预约复试' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '预约初面' })).not.toBeInTheDocument()
  })

  it('opens a completed first round as a read-only history instead of its editable schedule', async () => {
    const firstRound: CandidateInterviewSnapshot = {
      ...interview,
      stage: 'on-hold',
      decision: 'next-round',
      decisionReason: '进入复试。',
      decidedAt: '2026-07-22T01:00:00.000Z',
      decidedBy: '李娜',
      interviewNotes: '初面记录只应属于初面。'
    }
    const secondRound: CandidateInterviewSnapshot = {
      ...interview,
      id: '55555555-5555-4555-8555-555555555555',
      roundNumber: 2,
      parentInterviewId: interviewId,
      stage: 'prepared',
      questionPlan: [{ id: 'second-round', text: '请补充说明高并发设计。', source: 'inherited', sourceLabel: '上一轮待确认项', selected: true }]
    }
    render(<UiLocaleProvider locale="zh-CN"><CandidatePipeline analyses={[]} interviews={[firstRound, secondRound]} onConfirmCandidateProfile={vi.fn()} onCreateRound={vi.fn()} onImportResume={vi.fn()} onOpenCandidateLibrary={vi.fn()} onOpenIntegrationSettings={vi.fn()} onOpenZoomMeeting={vi.fn()} onRecordDecision={vi.fn()} onSaveNotes={vi.fn()} onSavePreparation={vi.fn()} onSaveSchedule={vi.fn()} onViewChange={vi.fn()} reviews={[review]} view="workbench" /></UiLocaleProvider>)

    fireEvent.click(await screen.findByRole('button', { name: /初面.*已完成/ }))
    expect(screen.getByText('历史轮次 · 只读')).toBeInTheDocument()
    expect(screen.getByText('初面记录只应属于初面。')).toBeInTheDocument()
    expect(screen.queryByLabelText('面试时间')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '改期' })).not.toBeInTheDocument()
  })

  it('shows only the scheduling fields that apply to each meeting channel', async () => {
    render(<UiLocaleProvider locale="zh-CN"><CandidatePipeline analyses={[]} interviews={[]} onConfirmCandidateProfile={vi.fn()} onCreateRound={vi.fn()} onImportResume={vi.fn()} onOpenCandidateLibrary={vi.fn()} onOpenIntegrationSettings={vi.fn()} onOpenZoomMeeting={vi.fn()} onRecordDecision={vi.fn()} onSaveNotes={vi.fn()} onSavePreparation={vi.fn()} onSaveSchedule={vi.fn()} onViewChange={vi.fn()} reviews={[review]} view="schedule" /></UiLocaleProvider>)

    expect(await screen.findByLabelText('Zoom 会议链接')).toBeInTheDocument()
    fireEvent.change(screen.getByLabelText('会议方式'), { target: { value: 'google-meet' } })
    expect(screen.getByLabelText('Google Meet 会议链接')).toBeInTheDocument()
    expect(screen.queryByLabelText('Zoom 会议链接')).not.toBeInTheDocument()
    fireEvent.change(screen.getByLabelText('会议方式'), { target: { value: 'phone' } })
    expect(screen.getByLabelText('候选人本地联系电话')).toBeInTheDocument()
    expect(screen.getByLabelText('电话备注')).toBeInTheDocument()
    expect(screen.queryByLabelText('Google Meet 会议链接')).not.toBeInTheDocument()
    fireEvent.change(screen.getByLabelText('会议方式'), { target: { value: 'onsite' } })
    expect(screen.getByLabelText('面试地址')).toBeInTheDocument()
    expect(screen.getByLabelText('会议室/集合说明')).toBeInTheDocument()
    expect(screen.getByLabelText('接待联系人')).toBeInTheDocument()
  })

  it('opens Google Meet only through the validated main-process meeting bridge', async () => {
    const onOpenInterviewMeeting = vi.fn().mockResolvedValue({ opened: true })
    const googleMeetInterview: CandidateInterviewSnapshot = {
      ...interview,
      stage: 'prepared',
      meetingMethod: 'google-meet',
      meetingUrl: 'https://meet.google.com/abc-defg-hij'
    }
    render(<UiLocaleProvider locale="zh-CN"><CandidatePipeline analyses={[]} interviews={[googleMeetInterview]} onConfirmCandidateProfile={vi.fn()} onCreateRound={vi.fn()} onImportResume={vi.fn()} onOpenCandidateLibrary={vi.fn()} onOpenIntegrationSettings={vi.fn()} onOpenInterviewMeeting={onOpenInterviewMeeting} onOpenZoomMeeting={vi.fn()} onRecordDecision={vi.fn()} onSaveNotes={vi.fn()} onSavePreparation={vi.fn()} onSaveSchedule={vi.fn()} onViewChange={vi.fn()} reviews={[review]} view="workbench" /></UiLocaleProvider>)

    fireEvent.click(await screen.findByRole('button', { name: '进入 Google Meet' }))
    expect(onOpenInterviewMeeting).toHaveBeenCalledWith({ method: 'google-meet', url: 'https://meet.google.com/abc-defg-hij' })
  })

  it('keeps resume AI suggestions separate until HR selects and adds them, prioritising a follow-up unresolved item', async () => {
    const firstRound: CandidateInterviewSnapshot = {
      ...interview,
      stage: 'on-hold',
      decision: 'next-round',
      decisionReason: '补充确认。',
      decidedAt: '2026-07-22T01:00:00.000Z',
      decidedBy: '李娜',
      unresolvedItems: ['高并发设计经验'],
      questionPlan: [{ id: 'already-asked', text: '请介绍负责过的项目。', source: 'standard', sourceLabel: '公司固定题', selected: true }]
    }
    const secondRound: CandidateInterviewSnapshot = {
      ...interview,
      id: '66666666-6666-4666-8666-666666666666',
      roundNumber: 2,
      parentInterviewId: interviewId,
      stage: 'scheduled',
      questionPlan: [],
      unresolvedItems: ['高并发设计经验']
    }
    const onSavePreparation = vi.fn()
    render(<UiLocaleProvider locale="zh-CN"><CandidatePipeline analyses={[]} interviews={[firstRound, secondRound]} onConfirmCandidateProfile={vi.fn()} onCreateRound={vi.fn()} onImportResume={vi.fn()} onOpenCandidateLibrary={vi.fn()} onOpenIntegrationSettings={vi.fn()} onOpenZoomMeeting={vi.fn()} onRecordDecision={vi.fn()} onSaveNotes={vi.fn()} onSavePreparation={onSavePreparation} onSaveSchedule={vi.fn()} onViewChange={vi.fn()} reviews={[review]} view="prepare" /></UiLocaleProvider>)

    fireEvent.click(await screen.findByRole('button', { name: '生成本机结构化建议' }))
    const suggestion = await screen.findByLabelText(/上一轮仍待确认：高并发设计经验/)
    const generatedCount = document.querySelectorAll('.recruiting-ai-suggestion-list input[type="checkbox"]').length
    expect(generatedCount).toBeGreaterThanOrEqual(6)
    expect(generatedCount).toBeLessThanOrEqual(10)
    expect((suggestion as HTMLInputElement).checked).toBe(false)
    expect(onSavePreparation).not.toHaveBeenCalled()
    fireEvent.click(suggestion)
    fireEvent.click(screen.getByRole('button', { name: '加入已选问题（1）' }))
    expect(screen.getAllByText(/上一轮仍待确认：高并发设计经验/).length).toBeGreaterThanOrEqual(1)
    expect(onSavePreparation).not.toHaveBeenCalled()
  })

  it('locks completed preparation and notes while the current round is awaiting a decision', async () => {
    const awaitingDecision: CandidateInterviewSnapshot = {
      ...interview,
      stage: 'awaiting-decision',
      interviewNotes: '候选人已回答技术问题。'
    }
    render(<UiLocaleProvider locale="zh-CN"><CandidatePipeline analyses={[]} interviews={[awaitingDecision]} onConfirmCandidateProfile={vi.fn()} onCreateRound={vi.fn()} onImportResume={vi.fn()} onOpenCandidateLibrary={vi.fn()} onOpenIntegrationSettings={vi.fn()} onOpenZoomMeeting={vi.fn()} onRecordDecision={vi.fn()} onSaveNotes={vi.fn()} onSavePreparation={vi.fn()} onSaveSchedule={vi.fn()} onViewChange={vi.fn()} reviews={[review]} view="decision" /></UiLocaleProvider>)

    fireEvent.click(await screen.findByText('准备', { selector: 'button' }))
    expect(screen.getByText('准备已锁定')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '保存问题清单并进入面试' })).not.toBeInTheDocument()
    fireEvent.click(screen.getByText('面试记录', { selector: 'button' }))
    expect(screen.getByText('面试记录已锁定')).toBeInTheDocument()
    expect(screen.queryByLabelText('面试记录')).not.toBeInTheDocument()
  })

  it('moves to the selected candidate current stage instead of keeping the previous candidate tab', async () => {
    const secondDocumentId = '77777777-7777-4777-8777-777777777777'
    const secondReview: CandidateReviewSnapshot = {
      ...review,
      documentId: secondDocumentId,
      localIdentity: { ...review.localIdentity!, displayName: '李明' }
    }
    const secondInterview: CandidateInterviewSnapshot = {
      ...interview,
      id: '88888888-8888-4888-8888-888888888888',
      sourceDocumentId: secondDocumentId,
      stage: 'scheduled',
      questionPlan: [],
      interviewNotes: null
    }
    render(<UiLocaleProvider locale="zh-CN"><CandidatePipeline analyses={[]} initialCandidateId={documentId} interviews={[interview, secondInterview]} onConfirmCandidateProfile={vi.fn()} onCreateRound={vi.fn()} onImportResume={vi.fn()} onOpenCandidateLibrary={vi.fn()} onOpenIntegrationSettings={vi.fn()} onOpenZoomMeeting={vi.fn()} onRecordDecision={vi.fn()} onSaveNotes={vi.fn()} onSavePreparation={vi.fn()} onSaveSchedule={vi.fn()} onViewChange={vi.fn()} reviews={[review, secondReview]} view="workbench" /></UiLocaleProvider>)

    expect(await screen.findByRole('heading', { name: '面试记录' })).toBeInTheDocument()
    fireEvent.change(screen.getByLabelText('切换候选人'), { target: { value: secondDocumentId } })
    expect(await screen.findByRole('heading', { name: '准备面试问题' })).toBeInTheDocument()
    expect(screen.queryByText('面试记录已锁定')).not.toBeInTheDocument()
  })

  it('keeps the exact routed interview round instead of silently opening the latest round', async () => {
    const firstRound: CandidateInterviewSnapshot = {
      ...interview,
      id: '99999999-9999-4999-8999-999999999991',
      roundNumber: 1,
      stage: 'interviewing'
    }
    const secondRound: CandidateInterviewSnapshot = {
      ...interview,
      id: '99999999-9999-4999-8999-999999999992',
      roundNumber: 2,
      parentInterviewId: firstRound.id,
      stage: 'prepared'
    }
    render(<UiLocaleProvider locale="zh-CN"><CandidatePipeline analyses={[]} initialCandidateId={documentId} initialInterviewId={firstRound.id} interviews={[secondRound, firstRound]} onConfirmCandidateProfile={vi.fn()} onCreateRound={vi.fn()} onImportResume={vi.fn()} onOpenCandidateLibrary={vi.fn()} onOpenIntegrationSettings={vi.fn()} onOpenZoomMeeting={vi.fn()} onRecordDecision={vi.fn()} onSaveNotes={vi.fn()} onSavePreparation={vi.fn()} onSaveSchedule={vi.fn()} onViewChange={vi.fn()} reviews={[review]} view="workbench" /></UiLocaleProvider>)

    expect(await screen.findByText('历史轮次 · 只读')).toBeInTheDocument()
    expect(screen.getByText('初面', { selector: 'button' })).toHaveClass('is-active')
    expect(screen.getByText('复试 1', { selector: 'button' })).not.toHaveClass('is-active')
    fireEvent.click(screen.getByText('复试 1', { selector: 'button' }))
    expect(screen.getByText('复试 1', { selector: 'button' })).toHaveClass('is-active')
    expect(screen.getByText('初面', { selector: 'button' })).not.toHaveClass('is-active')
  })

  it('uses the recruiting decision as the sole talent-pool admission trigger', async () => {
    const completedReview: CandidateReviewSnapshot = { ...review, talentPoolStatus: 'none' }
    const awaitingDecision = { ...interview, stage: 'awaiting-decision' as const, interviewNotes: '面试事实已记录。' }
    const passed = { ...awaitingDecision, stage: 'passed' as const, decision: 'passed' as const, decisionReason: '技术与沟通符合要求。' }
    const onRecordDecision = vi.fn().mockResolvedValue(passed)
    const onOpenCandidateLibrary = vi.fn()
    render(<UiLocaleProvider locale="zh-CN"><CandidatePipeline analyses={[]} interviews={[awaitingDecision]} onConfirmCandidateProfile={vi.fn()} onCreateRound={vi.fn()} onImportResume={vi.fn()} onOpenCandidateLibrary={onOpenCandidateLibrary} onOpenIntegrationSettings={vi.fn()} onOpenZoomMeeting={vi.fn()} onRecordDecision={onRecordDecision} onSaveNotes={vi.fn()} onSavePreparation={vi.fn()} onSaveSchedule={vi.fn()} onViewChange={vi.fn()} reviews={[completedReview]} view="decision" /></UiLocaleProvider>)

    fireEvent.change(await screen.findByLabelText('人工判断理由'), { target: { value: '技术与沟通符合要求。' } })
    fireEvent.click(screen.getByRole('button', { name: '确认面试结论' }))
    await waitFor(() => expect(onRecordDecision).toHaveBeenCalled())
    expect(onOpenCandidateLibrary).toHaveBeenCalledOnce()
  })

  it('opens the eligible talent list for an already-passed recruiting interview', async () => {
    const passed = { ...interview, stage: 'passed' as const, decision: 'passed' as const, decisionReason: '技术符合要求。' }
    const onOpenCandidateLibrary = vi.fn()
    render(<UiLocaleProvider locale="zh-CN"><CandidatePipeline analyses={[]} interviews={[passed]} onConfirmCandidateProfile={vi.fn()} onCreateRound={vi.fn()} onImportResume={vi.fn()} onOpenCandidateLibrary={onOpenCandidateLibrary} onOpenIntegrationSettings={vi.fn()} onOpenZoomMeeting={vi.fn()} onRecordDecision={vi.fn()} onSaveNotes={vi.fn()} onSavePreparation={vi.fn()} onSaveSchedule={vi.fn()} onViewChange={vi.fn()} reviews={[{ ...review, talentPoolStatus: 'eligible' }]} view="overview" /></UiLocaleProvider>)

    fireEvent.click(await screen.findByRole('button', { name: '打开人才池' }))
    expect(onOpenCandidateLibrary).toHaveBeenCalledOnce()
  })
})
