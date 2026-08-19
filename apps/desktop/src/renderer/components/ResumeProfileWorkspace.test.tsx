import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { createWorkTaskPreview, getDataScope, materializeWorkTask } from '@application'
import type { CandidateReviewSnapshot, OriginalDocumentPreview, ResumeAnalysisSummary } from '@shared'
import { UiLocaleProvider } from '../i18n'
import { ResumeProfileWorkspace } from './ResumeProfileWorkspace'

const documentId = 'ddbb8e9e-75f4-44a4-aa65-3111550fccf2'
const fieldValues = {
  skills: 'Java, Spring Boot, AWS',
  experience_years: '19年',
  availability: '2026年8月',
  rate: '80〜90万円/月',
  japanese_level: 'N2',
  work_style: 'ハイブリッド',
  role: 'SE',
  location: '東京都23区・神奈川',
  work_authorization: '就労制限なし'
} satisfies Record<CandidateReviewSnapshot['fields'][number]['key'], string>

const fields: CandidateReviewSnapshot['fields'] = Object.entries(fieldValues).map(([key, value]) => ({
  key: key as CandidateReviewSnapshot['fields'][number]['key'],
  label: ({
    skills: 'スキル',
    experience_years: '経験年数',
    availability: '稼働時期',
    rate: '希望単価',
    japanese_level: '日本語レベル',
    work_style: '勤務形態',
    role: '役割',
    location: '希望勤務地',
    work_authorization: '就労資格'
  } as Record<string, string>)[key]!,
  originalValue: value,
  value,
  confidence: 0.9,
  status: 'needs_review',
  sourceLabels: ['Skills!B2'],
  changed: false,
  changeReason: null
}))

const review: CandidateReviewSnapshot = {
  documentId,
  fileName: 'private-candidate.xlsx',
  reviewRevision: 1,
  status: 'awaiting-review',
  piiReviewed: false,
  localIdentity: {
    displayName: '本地候选人',
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
  fields,
  projectExperiences: [{
    draftId: 'project-finance-001',
    title: '決済プラットフォーム刷新',
    period: '2023年7月〜2026年6月',
    role: 'バックエンドSE',
    technologies: ['Java', 'Spring Boot', 'AWS'],
    summary: '金融決済基盤の要件分析、設計、開発とクラウド移行を担当。',
    confidence: 0.9,
    sourceLabels: ['Projects!A2'],
    changed: false,
    changeReason: null
  }],
  completedAt: null,
  reviewerDisplayName: null,
  profile: null,
  recruitingStatus: 'pending-review',
  talentPoolStatus: 'none',
  recordStatus: 'active'
}

const analysis: ResumeAnalysisSummary = {
  analysisVersion: 'resume-analysis-v6',
  fileToken: documentId,
  fileName: review.fileName,
  status: 'requires-pii-review',
  cloudEligible: false,
  statistics: { pages: 0, sheets: 1, blocks: 30, characters: 500 },
  detectedIdentifiers: [{ type: 'person_name', count: 1 }],
  localProcessing: { ocr: 'not-required', ocrPages: 0, personNameCandidates: 1, networkAccess: false },
  extractedFields: fields.map((field) => ({
    key: field.key,
    label: field.label,
    value: field.value,
    confidence: field.confidence,
    status: 'needs_review',
    sourceLabels: field.sourceLabels
  })),
  extractedProjectExperiences: [],
  warningCodes: [],
  redactedPreview: '[SHEET:Skills!B2] Java / Spring Boot / AWS',
  analyzedAt: '2026-07-21T01:00:00.000Z'
}

const task = materializeWorkTask(
  createWorkTaskPreview(
    '選択したスキルシートを安全に取り込み、候補者プロフィールを作成したい',
    getDataScope('selected-files'),
    [{ objectType: 'staged-file', objectId: documentId, version: 'a'.repeat(64) }]
  ),
  'resume-profile-task',
  '2026-07-21T01:00:00.000Z'
)

const connectedAiCommerce = {
  configuration: 'ready' as const,
  connection: 'connected' as const,
  productCode: 'sesAgent',
  billingMode: 'automatic' as const,
  memberDisplayName: '测试会员',
  accountId: 'account-001',
  accountAiTokenExpiresAt: '2026-07-22T01:00:00.000Z',
  wallet: { balanceCredits: 120, reservedCredits: 5 },
  capabilities: [{ alias: 'chat', displayName: 'Cloud Chat', modality: 'text' }],
  refreshedAt: '2026-07-21T01:00:00.000Z'
}

const originalSpreadsheetPreview = {
  version: 'original-document-preview-v1',
  documentId,
  fileName: 'private-candidate.xlsx',
  format: 'xlsx',
  size: 18_432,
  sha256: 'f'.repeat(64),
  viewMode: 'spreadsheet',
  previewUrl: null,
  sheets: [{
    name: 'Skills',
    printArea: 'A1:B3',
    cells: [
      { address: 'A1', text: '分类', mergedRange: null, inPrintArea: true },
      { address: 'B2', text: 'Java / Spring Boot / AWS', mergedRange: null, inPrintArea: true }
    ]
  }],
  pages: [],
  paragraphs: [],
  personalFieldSources: {},
  storage: 'encrypted-local-vault',
  cloudEligible: false,
  originalFileAvailable: true
} satisfies OriginalDocumentPreview

describe('ResumeProfileWorkspace', () => {
  it('opens imported spreadsheets in the same local source comparison workspace before registration', async () => {
    const onLoadOriginalDocument = vi.fn().mockResolvedValue(originalSpreadsheetPreview)
    const onOpenOriginalDocument = vi.fn().mockResolvedValue({ opened: true })
    const onSubmit = vi.fn().mockResolvedValue({ review: { ...review, status: 'completed' }, updatedTasks: [] })

    render(
      <UiLocaleProvider locale="zh-CN">
        <ResumeProfileWorkspace
          aiCommerce={{
            configuration: 'ready', connection: 'not-connected', productCode: 'sesAgent', billingMode: 'automatic',
            memberDisplayName: null, accountId: null, accountAiTokenExpiresAt: null, wallet: null, capabilities: [], refreshedAt: null
          }}
          analyses={[analysis]}
          lifecycleBusy={false}
          lifecycleError={null}
          onBack={vi.fn()}
          onCancel={vi.fn()}
          onLoadOriginalDocument={onLoadOriginalDocument}
          onOpenCloudSettings={vi.fn()}
          onOpenOriginalDocument={onOpenOriginalDocument}
          onSendCloudPrompt={vi.fn()}
          onSubmit={onSubmit}
          reviews={[review]}
          task={task}
        />
      </UiLocaleProvider>
    )

    fireEvent.click(screen.getByRole('button', { name: '查看原始简历' }))

    expect(await screen.findByText('核对原件与人才档案')).toBeInTheDocument()
    expect(onLoadOriginalDocument).toHaveBeenCalledWith(documentId)
    expect(screen.getByRole('table', { name: 'Skills' })).toBeInTheDocument()
    expect(screen.getByText('Java / Spring Boot / AWS')).toBeInTheDocument()

    fireEvent.change(screen.getByRole('textbox', { name: '技能' }), { target: { value: 'Java, AWS, React' } })
    fireEvent.click(screen.getByRole('button', { name: '确认候选人资料' }))

    await waitFor(() => expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({
      fields: expect.arrayContaining([expect.objectContaining({ key: 'skills', value: 'Java, AWS, React' })])
    })))
  })

  it('allows a sparse imported resume to enter the talent library without filling optional fields', async () => {
    const onSubmit = vi.fn().mockResolvedValue({ review: { ...review, status: 'completed' }, updatedTasks: [] })
    const sparseFields = fields.map((field) => ({
      ...field,
      originalValue: null,
      value: null,
      confidence: 0.2,
      sourceLabels: []
    }))
    const sparseReview: CandidateReviewSnapshot = {
      ...review,
      fields: sparseFields,
      projectExperiences: []
    }
    const sparseAnalysis: ResumeAnalysisSummary = {
      ...analysis,
      extractedFields: sparseFields.map((field) => ({
        key: field.key,
        label: field.label,
        value: null,
        confidence: field.confidence,
        status: 'needs_review',
        sourceLabels: []
      })),
      redactedPreview: ''
    }

    render(
      <UiLocaleProvider locale="zh-CN">
        <ResumeProfileWorkspace
          aiCommerce={{
            configuration: 'ready',
            connection: 'not-connected',
            productCode: 'sesAgent',
            billingMode: 'automatic',
            memberDisplayName: null,
            accountId: null,
            accountAiTokenExpiresAt: null,
            wallet: null,
            capabilities: [],
            refreshedAt: null
          }}
          analyses={[sparseAnalysis]}
          lifecycleBusy={false}
          lifecycleError={null}
          onBack={vi.fn()}
          onCancel={vi.fn()}
          onOpenCloudSettings={vi.fn()}
          onSendCloudPrompt={vi.fn()}
          onSubmit={onSubmit}
          reviews={[sparseReview]}
          task={task}
        />
      </UiLocaleProvider>
    )

    const confirm = screen.getByRole('button', { name: '确认候选人资料' })
    expect(confirm).toBeEnabled()
    fireEvent.click(screen.getByRole('tab', { name: /数据检查/ }))
    fireEvent.change(screen.getByRole('textbox', { name: 'スキル の確認値' }), { target: { value: 'Java' } })
    expect(screen.getByPlaceholderText('修改备注（可选）')).toBeInTheDocument()
    expect(confirm).toBeEnabled()
    fireEvent.click(confirm)

    await waitFor(() => expect(onSubmit).toHaveBeenCalledOnce())
    expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({
      piiReviewed: false,
      fields: sparseFields.map((field) => ({
        key: field.key,
        value: field.key === 'skills' ? 'Java' : null,
        confirmed: true
      })),
      projectExperiences: []
    }))
  })

  it('supports Chinese tabs, private local questions, evidence navigation and final confirmation', async () => {
    const onSubmit = vi.fn().mockResolvedValue({ review: { ...review, status: 'completed' }, updatedTasks: [] })
    render(
      <UiLocaleProvider locale="zh-CN">
        <ResumeProfileWorkspace
          aiCommerce={{
            configuration: 'ready',
            connection: 'not-connected',
            productCode: 'sesAgent',
            billingMode: 'automatic',
            memberDisplayName: null,
            accountId: null,
            accountAiTokenExpiresAt: null,
            wallet: null,
            capabilities: [],
            refreshedAt: null
          }}
          analyses={[analysis]}
          lifecycleBusy={false}
          lifecycleError={null}
          onBack={vi.fn()}
          onCancel={vi.fn()}
          onOpenCloudSettings={vi.fn()}
          onSendCloudPrompt={vi.fn()}
          onSubmit={onSubmit}
          reviews={[review]}
          task={task}
        />
      </UiLocaleProvider>
    )

    expect(screen.getByRole('tab', { name: '档案总览' })).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByText(/本机姓名/)).toHaveTextContent('本机姓名：本地候选人')
    expect(screen.queryByText('private-candidate.xlsx')).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '云端 AI 分析' }))
    expect(screen.getByText('云端 AI 尚未连接')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '本地快速查询' }))

    fireEvent.click(screen.getByRole('button', { name: '主要能力是什么？' }))
    expect(screen.getByText(/主要能力是Java、Spring Boot、AWS/)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /技能矩阵 · 3项/ }))
    expect(screen.getByRole('tab', { name: '技能矩阵' })).toHaveAttribute('aria-selected', 'true')

    fireEvent.change(screen.getByRole('textbox', { name: '向 AI 询问当前人才' }), { target: { value: '这个人是哪里人？' } })
    fireEvent.click(screen.getByRole('button', { name: '发送' }))
    expect(await screen.findByText(/不会根据姓名和语言进行推测/)).toBeInTheDocument()

    fireEvent.change(screen.getByRole('textbox', { name: '向 AI 询问当前人才' }), { target: { value: '请综合判断这个人的领导力风险' } })
    fireEvent.click(screen.getByRole('button', { name: '发送' }))
    expect(await screen.findByText(/这个开放性问题需要使用云端 AI 分析/)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '使用云端 AI 分析此问题' }))
    expect(screen.getByRole('button', { name: '云端 AI 分析' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('textbox', { name: '向 AI 询问当前人才' })).toHaveValue('请综合判断这个人的领导力风险')

    fireEvent.click(screen.getByRole('tab', { name: /数据检查/ }))
    expect(screen.getByText('所有档案字段均为可选；可以保留空白入库，之后再补充需要的信息。')).toBeInTheDocument()
    expect(screen.getAllByText(/项可选确认/).length).toBeGreaterThan(0)

    const confirm = screen.getByRole('button', { name: '确认候选人资料' })
    expect(confirm).toBeEnabled()
    fireEvent.click(confirm)

    await waitFor(() => expect(onSubmit).toHaveBeenCalledOnce())
    expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({
      documentId,
      piiReviewed: false,
      fields: expect.arrayContaining([expect.objectContaining({ key: 'skills', value: 'Java, Spring Boot, AWS', confirmed: true })]),
      projectExperiences: [expect.objectContaining({ draftId: 'project-finance-001', confirmed: true })]
    }))
  })

  it('sends only confirmed anonymous context through the cloud gateway and labels the answer', async () => {
    const onSendCloudPrompt = vi.fn().mockResolvedValue({
      requestId: 'request-001',
      aiRequestId: 'ai-request-001',
      content: '该候选人适合 Java、Spring Boot 与 AWS 相关的金融系统后端案件。',
      usageCredits: 1.25,
      wallet: { balanceCredits: 118.75, reservedCredits: 0 },
      removedIdentifierTypes: ['person_name', 'private_email'],
      billingModeUsed: 'standard'
    })
    const completedReview: CandidateReviewSnapshot = {
      ...review,
      status: 'completed',
      piiReviewed: false,
      completedAt: '2026-07-21T02:00:00.000Z'
    }

    render(
      <UiLocaleProvider locale="zh-CN">
        <ResumeProfileWorkspace
          aiCommerce={connectedAiCommerce}
          analyses={[analysis]}
          lifecycleBusy={false}
          lifecycleError={null}
          onBack={vi.fn()}
          onCancel={vi.fn()}
          onOpenCloudSettings={vi.fn()}
          onSendCloudPrompt={onSendCloudPrompt}
          onSubmit={vi.fn()}
          reviews={[completedReview]}
          task={task}
        />
      </UiLocaleProvider>
    )

    fireEvent.click(screen.getByRole('button', { name: '云端 AI 分析' }))
    fireEvent.click(screen.getByRole('checkbox', { name: /确认发送脱敏后的匿名档案/ }))
    fireEvent.click(screen.getByRole('button', { name: '适合什么案件？' }))

    await waitFor(() => expect(onSendCloudPrompt).toHaveBeenCalledOnce())
    const input = onSendCloudPrompt.mock.calls[0]![0]
    expect(input).toEqual({ content: expect.any(String) })
    expect(input.content).toContain('匿名候选人编号: C-DDBB8E9E')
    expect(input.content).toContain('技能: Java, Spring Boot, AWS')
    expect(input.content).toContain('已确认项目:')
    expect(input.content).not.toContain('本地候选人')
    expect(input.content).not.toContain('private-candidate.xlsx')
    expect(input.content).not.toContain('[SHEET:')

    expect(await screen.findByText(/适合 Java、Spring Boot 与 AWS/)).toBeInTheDocument()
    expect(screen.getByText('云端 AI · 已脱敏')).toBeInTheDocument()
    expect(screen.getByText(/2项已在发送前替换 · 1.25 credits/)).toBeInTheDocument()
  })

  it('falls back to a local answer when the cloud request fails', async () => {
    const onSendCloudPrompt = vi.fn().mockRejectedValue(new Error(
      "Error invoking remote method 'aicommerce:execute-cloud-prompt': Error: ローカルのプライバシー品質ゲートを確認できないため、Cloud AI を停止しました。データ安全画面で状態を確認してください。"
    ))
    const completedReview: CandidateReviewSnapshot = {
      ...review,
      status: 'completed',
      piiReviewed: true,
      completedAt: '2026-07-21T02:00:00.000Z'
    }

    render(
      <UiLocaleProvider locale="zh-CN">
        <ResumeProfileWorkspace
          aiCommerce={connectedAiCommerce}
          analyses={[analysis]}
          lifecycleBusy={false}
          lifecycleError={null}
          onBack={vi.fn()}
          onCancel={vi.fn()}
          onOpenCloudSettings={vi.fn()}
          onSendCloudPrompt={onSendCloudPrompt}
          onSubmit={vi.fn()}
          reviews={[completedReview]}
          task={task}
        />
      </UiLocaleProvider>
    )

    fireEvent.click(screen.getByRole('button', { name: '云端 AI 分析' }))
    fireEvent.click(screen.getByRole('checkbox', { name: /确认发送脱敏后的匿名档案/ }))
    fireEvent.click(screen.getByRole('button', { name: '主要能力是什么？' }))

    expect(await screen.findByText(/云端 AI 暂时不可用，已使用本机档案助手回答/)).toBeInTheDocument()
    expect(screen.getByText('云端不可用 · 已回退到本地查询')).toBeInTheDocument()
    expect(screen.getByRole('alert')).toHaveTextContent('本机隐私质量检查未通过，云端 AI 已停止。请在“数据安全”中检查状态。')
  })
})
