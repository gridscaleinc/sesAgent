import { useMemo, useState } from 'react'
import type { WorkTask } from '@domain'
import type {
  PrepareAiCommerceCloudPromptInput,
  AiCommerceCloudPromptResult,
  AiCommerceMembershipState,
  AiConversationMessage,
  AiConversationSnapshot,
  CandidateFieldKey,
  CandidateProjectReviewSnapshot,
  CandidateReviewSnapshot,
  OriginalDocumentPreview,
  ResumeAnalysisSummary,
  SubmitCandidateReviewInput,
  SubmitCandidateReviewResult
} from '@shared'
import { Icon } from './Icon'
import { candidateFieldLabel } from './CandidateProfileDetail'
import { AiConversationHistoryPanel } from './AiConversationHistoryPanel'
import { ImportOriginalDocumentWorkspace } from './ImportOriginalDocumentWorkspace'
import { useAiConversationHistory } from './useAiConversationHistory'
import { summarizeSourceLabels } from '../source-evidence'
import { localeText, localizedIpcError, useLocaleText } from '../i18n'

type ProfileTab = 'overview' | 'skills' | 'projects' | 'commercial' | 'source' | 'quality'

interface ResumeProfileWorkspaceProps {
  task: WorkTask
  analyses: ResumeAnalysisSummary[]
  reviews: CandidateReviewSnapshot[]
  aiCommerce: AiCommerceMembershipState
  onBack(): void
  backLabel?: string
  onCancel(): void
  onOpenCloudSettings(): void
  lifecycleBusy: boolean
  lifecycleError: string | null
  onLoadOriginalDocument?(sourceDocumentId: string): Promise<OriginalDocumentPreview>
  onOpenOriginalDocument?(sourceDocumentId: string): Promise<unknown>
  onSendCloudPrompt(input: PrepareAiCommerceCloudPromptInput): Promise<AiCommerceCloudPromptResult>
  onSubmit(input: SubmitCandidateReviewInput): Promise<SubmitCandidateReviewResult>
}

interface EditableProjectExperience extends Omit<CandidateProjectReviewSnapshot, 'technologies'> {
  technologies: string
}

interface AssistantSource {
  label: string
  tab: ProfileTab
}

type AssistantMode = 'local' | 'cloud'

const commercialFieldKeys: CandidateFieldKey[] = ['availability', 'rate', 'work_style', 'location', 'work_authorization']

const autoConfirmFieldKeys = new Set<CandidateFieldKey>(['skills', 'experience_years', 'japanese_level', 'role'])

const cloudContextFieldKeys: CandidateFieldKey[] = [
  'skills',
  'experience_years',
  'japanese_level',
  'role',
  'availability',
  'rate',
  'work_style',
  'location',
  'work_authorization'
]

// i18n-ignore: field labels written into the AI prompt sent to the cloud model
const cloudContextFieldLabels: Record<CandidateFieldKey, { 'ja-JP': string; 'zh-CN': string }> = {
  skills: { 'ja-JP': 'スキル', 'zh-CN': '技能' },
  experience_years: { 'ja-JP': '経験年数', 'zh-CN': '经验年限' },
  availability: { 'ja-JP': '稼働時期', 'zh-CN': '可入场时间' },
  rate: { 'ja-JP': '希望単価', 'zh-CN': '期望单价' },
  japanese_level: { 'ja-JP': '日本語力', 'zh-CN': '日语能力' },
  work_style: { 'ja-JP': '勤務形態', 'zh-CN': '工作方式' },
  role: { 'ja-JP': '主力ロール', 'zh-CN': '主力角色' },
  location: { 'ja-JP': '希望勤務地', 'zh-CN': '期望工作地点' },
  work_authorization: { 'ja-JP': '就労資格', 'zh-CN': '工作资格' }
}

function normalizeValue(value: string): string | null {
  const normalized = value.trim()
  return normalized.length > 0 ? normalized : null
}

function editableProject(project: CandidateProjectReviewSnapshot): EditableProjectExperience {
  return { ...project, technologies: project.technologies.join(', ') }
}

function projectTechnologies(value: string): string[] {
  return [
    ...new Set(
      value
        .split(/[,、/]/u)
        .map((item) => item.trim())
        .filter(Boolean)
    )
  ].slice(0, 40)
}

function projectComparable(project: EditableProjectExperience) {
  return {
    draftId: project.draftId,
    title: project.title.trim(),
    period: normalizeValue(project.period ?? ''),
    role: normalizeValue(project.role ?? ''),
    technologies: projectTechnologies(project.technologies),
    summary: project.summary.trim()
  }
}

function splitSkills(value: string): string[] {
  return [
    ...new Set(
      value
        .split(/[,、/・|]/u)
        .map((item) => item.trim().replace(/\s*[（(][◎○◯△×][）)]\s*$/u, ''))
        .filter((item) => item.length > 1)
    )
  ].slice(0, 12)
}

// i18n-ignore: rewrites Japanese résumé data values for zh-CN display
function localizeProfileDisplay(value: string, locale: 'ja-JP' | 'zh-CN'): string {
  if (locale !== 'zh-CN') return value
  return value
    .replaceAll('〜', '—')
    .replace(/(\d+)ヶ月/gu, '$1个月')
    .replaceAll('\u8aad\u3080', '阅读')
    .replaceAll('\u66f8\u304f', '书写')
    .replaceAll('\u4f1a\u8a71', '会话')
}

function candidateCode(review: CandidateReviewSnapshot): string {
  const id = review.profile?.id ?? review.documentId
  return `C-${id.replaceAll('-', '').slice(0, 8).toUpperCase()}`
}

function createInitialConfirmedKeys(review: CandidateReviewSnapshot): Set<CandidateFieldKey> {
  if (review.status === 'completed') return new Set(review.fields.map((field) => field.key))
  return new Set(
    review.fields
      .filter((field) => autoConfirmFieldKeys.has(field.key) && field.originalValue !== null && field.confidence >= 0.8)
      .map((field) => field.key)
  )
}

function createInitialConfirmedProjects(review: CandidateReviewSnapshot): Set<string> {
  if (review.status === 'completed') return new Set(review.projectExperiences.map((project) => project.draftId))
  return new Set(review.projectExperiences.filter((project) => project.confidence >= 0.8).map((project) => project.draftId))
}

function createMessageId(): string {
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`
}

function findRelevantProjects(projects: EditableProjectExperience[], pattern: RegExp): EditableProjectExperience[] {
  return projects.filter((project) => pattern.test(`${project.title} ${project.summary} ${project.technologies}`))
}

function answerCandidateQuestion(
  question: string,
  locale: 'ja-JP' | 'zh-CN',
  localIdentity: CandidateReviewSnapshot['localIdentity'],
  values: Record<CandidateFieldKey, string>,
  confirmedKeys: Set<CandidateFieldKey>,
  projects: EditableProjectExperience[],
  confirmedProjectIds: Set<string>
): { content: string; sources: AssistantSource[]; suggestCloud?: boolean } {
  const confirmedValue = (key: CandidateFieldKey) => (confirmedKeys.has(key) ? normalizeValue(values[key] ?? '') : null)
  const skills = splitSkills(confirmedValue('skills') ?? '')
  const confirmedProjects = projects.filter((project) => confirmedProjectIds.has(project.draftId))
  const role = confirmedValue('role')
  const experience = confirmedValue('experience_years')
  const location = confirmedValue('location')
  const availability = confirmedValue('availability')
  const rate = confirmedValue('rate')
  const workStyle = confirmedValue('work_style')

  const t = localeText(locale === 'zh-CN')

  // i18n-ignore: question-matching regex
  if (/哪里人|出身|国籍|住所|住まい|where.*from/iu.test(question)) {
    const localFacts = [
      localIdentity?.nationality ? t(`国籍：${localIdentity.nationality}`, `国籍：${localIdentity.nationality}`) : null,
      localIdentity?.address ? t(`住址／最近车站：${localIdentity.address}`, `住所・最寄り駅：${localIdentity.address}`) : null
    ].filter(Boolean)
    if (localFacts.length > 0) {
      return {
        content: t(
          `本机简历登记的信息为：${localFacts.join('；')}。系统不会据此推测籍贯。`,
          `端末内の履歴書に登録された情報：${localFacts.join('；')}。この情報から出身地は推測しません。`
        ),
        sources: [{ label: t('档案总览 · 本机信息', 'プロフィール概要 · 端末内情報'), tab: 'overview' }]
      }
    }
    return {
      content: location
        ? t(
            `档案没有保存籍贯或国籍，因此不能推测“哪里人”。已确认的工作地点偏好是“${location}”。`,
            `出身地や国籍は保存していないため推測できません。確認済みの希望勤務地は「${location}」です。`
          )
        : t(
            '档案没有保存籍贯、国籍或可用于判断“哪里人”的信息，系统不会根据姓名和语言进行推测。',
            '出身地・国籍・住所はプロフィールへ保存せず、姓名や言語から推測もしません。'
          ),
      sources: location
        ? [{ label: t('商务条件 · 希望地点', '商務条件 · 希望勤務地'), tab: 'commercial' }]
        : [{ label: t('数据检查 · 隐私规则', 'データ確認 · プライバシー'), tab: 'quality' }]
    }
  }

  // i18n-ignore: question-matching regex
  if (/金融|银行|銀行|決済|finance|bank/iu.test(question)) {
    // i18n-ignore: project-matching regex
    const relevant = findRelevantProjects(confirmedProjects, /金融|银行|銀行|決済|finance|bank/iu)
    const relevantNames = relevant
      .slice(0, 3)
      .map((project) => project.title)
      .join('、')
    return {
      content:
        relevant.length > 0
          ? t(
              `已确认的金融相关经历有${relevant.length}项：${relevantNames}。`,
              `確認済みの金融関連経験は${relevant.length}件です：${relevantNames}。`
            )
          : t(
              '已确认项目中没有找到明确的金融行业描述，可以在项目经历中继续核对原文。',
              '確認済みプロジェクトには金融業界と明記された経験がありません。原文で追加確認できます。'
            ),
      sources: [{ label: t(`项目经历 · ${relevant.length}项`, `プロジェクト経験 · ${relevant.length}件`), tab: 'projects' }]
    }
  }

  // i18n-ignore: question-matching regex
  if (/项目|案件|做过|経験|project/iu.test(question)) {
    const names = confirmedProjects.slice(0, 4).map((project) => project.title)
    return {
      content:
        names.length > 0
          ? t(
              `目前有${confirmedProjects.length}项已确认项目经历，代表项目包括：${names.join('、')}。`,
              `確認済みプロジェクトは${confirmedProjects.length}件です。代表例：${names.join('、')}。`
            )
          : t(
              '目前还没有经过确认的项目经历，不能生成可靠的项目总结。',
              '確認済みのプロジェクト経験がないため、信頼できる案件要約はまだ作成できません。'
            ),
      sources: [
        {
          label: t(`项目经历 · ${confirmedProjects.length}项`, `プロジェクト経験 · ${confirmedProjects.length}件`),
          tab: 'projects'
        }
      ]
    }
  }

  // i18n-ignore: question-matching regex
  if (/入场|稼働|单价|単価|工作方式|勤務|条件|available|rate/iu.test(question)) {
    const facts = [availability, rate, workStyle].filter(Boolean)
    return {
      content:
        facts.length > 0
          ? t(
              `已确认的商务条件：${facts.join('；')}。未确认字段不会作为确定结论。`,
              `確認済みの商務条件：${facts.join('；')}。未確認項目は確定情報として扱いません。`
            )
          : t('可入场时间、期望单价和工作方式尚未全部确认。', '稼働時期・希望単価・勤務形態はまだ十分に確認されていません。'),
      sources: [{ label: t('商务条件', '商務条件'), tab: 'commercial' }]
    }
  }

  // i18n-ignore: question-matching regex
  if (/主要能力|擅长|强项|強み|得意|スキル|能力|skill|strength|ability/iu.test(question)) {
    const skillSummary = skills.slice(0, 5).join('、')
    return {
      content:
        skills.length > 0
          ? t(
              `主要能力是${skillSummary}${role ? `，主力角色为${role}` : ''}${experience ? `，总经验${experience}` : ''}。已确认项目${confirmedProjects.length}项，结论只依据当前已确认档案。`,
              `主な強みは${skillSummary}${role ? `、主力ロールは${role}` : ''}${experience ? `、総経験は${experience}` : ''}です。確認済みプロジェクト${confirmedProjects.length}件だけを根拠にしています。`
            )
          : t(
              '技能字段尚未确认，当前无法可靠总结主要能力。请先完成技能矩阵审核。',
              'スキル項目が未確認のため、主な強みを信頼できる形で要約できません。先にスキルマトリクスを確認してください。'
            ),
      sources: [
        { label: t(`技能矩阵 · ${skills.length}项`, `スキルマトリクス · ${skills.length}項目`), tab: 'skills' },
        {
          label: t(`项目经历 · ${confirmedProjects.length}项`, `プロジェクト経験 · ${confirmedProjects.length}件`),
          tab: 'projects'
        },
        { label: t('档案总览', 'プロフィール概要'), tab: 'overview' }
      ]
    }
  }
  return {
    content: t(
      '本地快速查询只能读取已确认的技能、项目、商务条件和隐私规则。这个开放性问题需要使用云端 AI 分析。',
      'ローカル高速照会は、確認済みのスキル・プロジェクト・商務条件・プライバシー規則だけを検索します。この自由質問にはCloud AI分析が必要です。'
    ),
    sources: [],
    suggestCloud: true
  }
}

function compactPromptValue(value: string, limit = 700): string {
  return value.replace(/\s+/gu, ' ').trim().slice(0, limit)
}

function createCloudCandidatePrompt({
  candidateId,
  confirmedKeys,
  confirmedProjectIds,
  locale,
  projects,
  question,
  values
}: {
  candidateId: string
  confirmedKeys: Set<CandidateFieldKey>
  confirmedProjectIds: Set<string>
  locale: 'ja-JP' | 'zh-CN'
  projects: EditableProjectExperience[]
  question: string
  values: Record<CandidateFieldKey, string>
}): { content: string; sources: AssistantSource[] } {
  const t = localeText(locale === 'zh-CN')

  const fieldLines = cloudContextFieldKeys.flatMap((key) => {
    if (!confirmedKeys.has(key)) return []
    const value = normalizeValue(values[key] ?? '')
    if (!value) return []
    return [`- ${cloudContextFieldLabels[key][locale]}: ${compactPromptValue(value, key === 'skills' ? 2_000 : 500)}`]
  })
  const confirmedProjects = projects.filter((project) => confirmedProjectIds.has(project.draftId)).slice(0, 6)
  // i18n-ignore: project lines are part of the AI prompt sent to the cloud model
  const projectLines = confirmedProjects.map((project, index) =>
    [
      `${index + 1}. ${compactPromptValue(project.title, 180) || t('未命名项目', '名称未設定')}`,
      `   ${t('期间', '期間')}: ${compactPromptValue(project.period ?? '', 120) || '-'}`,
      `   ${t('角色', '役割')}: ${compactPromptValue(project.role ?? '', 120) || '-'}`,
      `   ${t('技术', '技術')}: ${
        projectTechnologies(project.technologies)
          .slice(0, 20)
          .map((value) => compactPromptValue(value, 80))
          .join(', ') || '-'
      }`,
      `   ${t('内容', '担当内容')}: ${compactPromptValue(project.summary)}`
    ].join('\n')
  )
  const sources: AssistantSource[] = [{ label: t('档案总览', 'プロフィール概要'), tab: 'overview' }]
  if (confirmedKeys.has('skills')) sources.push({ label: t('技能矩阵', 'スキルマトリクス'), tab: 'skills' })
  if (confirmedProjects.length > 0)
    sources.push({
      label: t(`项目经历 · ${confirmedProjects.length}项`, `プロジェクト経験 · ${confirmedProjects.length}件`),
      tab: 'projects'
    })
  if (commercialFieldKeys.some((key) => confirmedKeys.has(key))) sources.push({ label: t('商务条件', '商務条件'), tab: 'commercial' })

  // i18n-ignore: AI assistant prompt sent to the cloud model
  const content =
    locale === 'zh-CN'
      ? [
          '你是日本 SES 公司的人才档案分析助手。',
          '只能依据下方已确认的匿名结构化档案回答；缺少依据时明确说不知道。',
          '禁止推测或输出姓名、电话、邮箱、详细住址、国籍、籍贯、年龄、性别等个人身份或敏感属性。',
          '不要把候选人编号解释为真实身份。用简洁、专业的中文回答，并区分事实与建议。',
          `用户问题: ${compactPromptValue(question, 500)}`,
          `匿名候选人编号: ${candidateId}`,
          '已确认字段:',
          fieldLines.join('\n') || '- 无',
          '已确认项目:',
          projectLines.join('\n') || '- 无'
        ].join('\n')
      : [
          'あなたは日本のSES企業向け人材プロフィール分析アシスタントです。',
          '以下の確認済み匿名構造化プロフィールだけを根拠に回答し、根拠がない場合は不明と明記してください。',
          '氏名、電話、メール、詳細住所、国籍、出身地、年齢、性別などの本人情報・機微属性を推測または出力しないでください。',
          '候補者番号を実在の本人情報として解釈しないでください。事実と提案を分け、簡潔で業務的な日本語で回答してください。',
          `質問: ${compactPromptValue(question, 500)}`,
          `匿名候補者番号: ${candidateId}`,
          '確認済み項目:',
          fieldLines.join('\n') || '- なし',
          '確認済みプロジェクト:',
          projectLines.join('\n') || '- なし'
        ].join('\n')

  return { content: content.slice(0, 12_000), sources }
}

export function ResumeProfileWorkspace(props: ResumeProfileWorkspaceProps) {
  const [activeDocumentId, setActiveDocumentId] = useState(props.reviews[0]?.documentId ?? '')
  const review = props.reviews.find((item) => item.documentId === activeDocumentId) ?? props.reviews[0]
  const analysis = props.analyses.find((item) => item.fileToken === review?.documentId) ?? props.analyses[0]

  if (!review || !analysis) return null

  return (
    <CandidateProfileEditor
      {...props}
      analysis={analysis}
      key={`${review.documentId}-${review.reviewRevision}-${review.status}`}
      onSelectDocument={setActiveDocumentId}
      review={review}
    />
  )
}

interface CandidateProfileEditorProps extends ResumeProfileWorkspaceProps {
  analysis: ResumeAnalysisSummary
  review: CandidateReviewSnapshot
  onSelectDocument(documentId: string): void
}

function CandidateProfileEditor({
  task,
  analysis,
  review,
  reviews,
  aiCommerce,
  onBack,
  backLabel,
  onCancel,
  onOpenCloudSettings,
  onSelectDocument,
  lifecycleBusy,
  lifecycleError,
  onLoadOriginalDocument,
  onOpenOriginalDocument,
  onSendCloudPrompt,
  onSubmit
}: CandidateProfileEditorProps) {
  const { locale, t } = useLocaleText()
  const completed = review.status === 'completed'
  const [activeTab, setActiveTab] = useState<ProfileTab>('overview')
  const [aiOpen, setAiOpen] = useState(true)
  const [assistantMode, setAssistantMode] = useState<AssistantMode>('local')
  const [aiInput, setAiInput] = useState('')
  const [historyOpen, setHistoryOpen] = useState(false)
  const [cloudConsent, setCloudConsent] = useState(false)
  const [cloudBusy, setCloudBusy] = useState(false)
  const [cloudError, setCloudError] = useState<string | null>(null)
  const [values, setValues] = useState<Record<CandidateFieldKey, string>>(
    () => Object.fromEntries(review.fields.map((field) => [field.key, field.value ?? ''])) as Record<CandidateFieldKey, string>
  )
  const [reasons, setReasons] = useState<Partial<Record<CandidateFieldKey, string>>>({})
  const [confirmedKeys, setConfirmedKeys] = useState<Set<CandidateFieldKey>>(() => createInitialConfirmedKeys(review))
  const [projects, setProjects] = useState<EditableProjectExperience[]>(() => review.projectExperiences.map(editableProject))
  const [confirmedProjectIds, setConfirmedProjectIds] = useState<Set<string>>(() => createInitialConfirmedProjects(review))
  const [projectChangeReason, setProjectChangeReason] = useState('')
  const [selectedKey, setSelectedKey] = useState<CandidateFieldKey>(review.fields[0]?.key ?? 'skills')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const conversationContext = useMemo(
    () => ({
      assistant: 'candidate-profile' as const,
      candidateDocumentId: review.documentId,
      interviewId: null,
      interviewKind: null,
      roundNumber: null
    }),
    [review.documentId]
  )
  const history = useAiConversationHistory(conversationContext)
  const { messages, persistMessages } = history

  const fieldMap = useMemo(() => new Map(review.fields.map((field) => [field.key, field])), [review.fields])
  const cloudConfigured = aiCommerce.configuration === 'ready'
  const cloudConnected = aiCommerce.connection === 'connected'
  const cloudContextAvailable =
    review.fields.some((field) => confirmedKeys.has(field.key) && normalizeValue(values[field.key] ?? '') !== null) ||
    projects.some((project) => confirmedProjectIds.has(project.draftId))
  const cloudSendReady = cloudConnected && cloudContextAvailable && cloudConsent && !cloudBusy
  const changedKeys = new Set(
    review.fields.filter((field) => normalizeValue(values[field.key]) !== field.originalValue).map((field) => field.key)
  )
  const originalProjects = new Map(review.projectExperiences.map((project) => [project.draftId, editableProject(project)]))
  const projectsChanged =
    projects.length !== review.projectExperiences.length ||
    projects.some((project) => {
      const original = originalProjects.get(project.draftId)
      return !original || JSON.stringify(projectComparable(project)) !== JSON.stringify(projectComparable(original))
    })
  const projectsComplete = projects.every((project) => project.title.trim().length > 0 && project.summary.trim().length > 0)
  const projectReviewComplete = projects.every((project) => confirmedProjectIds.has(project.draftId))
  const ready = !completed && projectsComplete && !submitting
  const pendingCommercial = commercialFieldKeys.filter((key) => fieldMap.has(key) && !confirmedKeys.has(key)).length
  const pendingFieldCount = review.fields.filter((field) => !confirmedKeys.has(field.key)).length
  const pendingProjectCount = projects.filter((project) => !confirmedProjectIds.has(project.draftId)).length
  const optionalReviewCount = pendingFieldCount + pendingProjectCount
  const pendingCount = optionalReviewCount
  const totalChecks = review.fields.length + projects.length
  const completedChecks = confirmedKeys.size + confirmedProjectIds.size
  const completionPercent = completed ? 100 : Math.round((completedChecks / Math.max(totalChecks, 1)) * 100)
  const skills = useMemo(() => {
    const fromField = splitSkills(values.skills ?? '')
    const rows = new Map<string, { projects: string[]; sourceCount: number }>()
    for (const skill of fromField) rows.set(skill, { projects: [], sourceCount: fieldMap.get('skills')?.sourceLabels.length ? 1 : 0 })
    for (const project of projects) {
      for (const skill of projectTechnologies(project.technologies)) {
        const current = rows.get(skill) ?? { projects: [], sourceCount: 0 }
        if (project.title && !current.projects.includes(project.title)) current.projects.push(project.title)
        current.sourceCount += project.sourceLabels.length > 0 ? 1 : 0
        rows.set(skill, current)
      }
    }
    return [...rows.entries()]
      .map(([name, evidence]) => ({ name, ...evidence }))
      .toSorted((left, right) => right.projects.length - left.projects.length || left.name.localeCompare(right.name))
      .slice(0, 14)
  }, [fieldMap, projects, values.skills])
  const localDisplayName = review.localIdentity?.displayName ?? null
  const valueFor = (key: CandidateFieldKey) => {
    const value = normalizeValue(values[key] ?? '')
    return value ? localizeProfileDisplay(value, locale) : t('未设置', '未設定')
  }
  const leadSkills =
    splitSkills(values.skills ?? '')
      .slice(0, 5)
      .join('、') || t('待确认', '確認待ち')
  const overviewSummary = t(
    `${valueFor('experience_years')}经验的${valueFor('role')}，核心技能为${leadSkills}。已解析${projects.length}项项目经历，所有结论以人工确认后的档案为准。`,
    `${valueFor('experience_years')}経験の${valueFor('role')}。主なスキルは${leadSkills}です。${projects.length}件のプロジェクト経験を抽出し、確定情報は人の確認後だけ利用します。`
  )

  const confirmHighConfidence = () => {
    setConfirmedKeys((current) => {
      const next = new Set(current)
      for (const field of review.fields) if (field.confidence >= 0.8 && field.originalValue !== null) next.add(field.key)
      return next
    })
    setConfirmedProjectIds((current) => {
      const next = new Set(current)
      for (const project of projects) if (project.confidence >= 0.8) next.add(project.draftId)
      return next
    })
  }

  const submit = async () => {
    if (!ready) return
    setSubmitting(true)
    setError(null)
    try {
      await onSubmit({
        documentId: review.documentId,
        reviewRevision: review.reviewRevision,
        piiReviewed: review.piiReviewed,
        fields: review.fields.map((field) => ({
          key: field.key,
          value: normalizeValue(values[field.key]),
          confirmed: true,
          ...(changedKeys.has(field.key) && reasons[field.key]?.trim() ? { changeReason: reasons[field.key]?.trim() } : {})
        })),
        projectExperiences: projects.map((project) => ({ ...projectComparable(project), confirmed: true as const })),
        ...(projectsChanged && projectChangeReason.trim() ? { projectChangeReason: projectChangeReason.trim() } : {})
      })
    } catch (cause) {
      setError(localizedIpcError(locale, cause, t('无法确认人员档案。', '要員プロフィールを確認できませんでした。')))
    } finally {
      setSubmitting(false)
    }
  }

  const askCandidate = async (rawQuestion: string) => {
    const question = rawQuestion.trim()
    if (!question || (assistantMode === 'cloud' && history.saving)) return
    if (assistantMode === 'cloud' && !cloudSendReady) return
    const localAnswer = answerCandidateQuestion(
      question,
      locale,
      review.localIdentity,
      values,
      confirmedKeys,
      projects,
      confirmedProjectIds
    )
    const userMessage: AiConversationMessage = {
      id: createMessageId(),
      role: 'user',
      content: question,
      mode: assistantMode,
      createdAt: new Date().toISOString()
    }
    setAiInput('')
    setCloudError(null)
    if (assistantMode === 'local') {
      const assistantMessage: AiConversationMessage = {
        id: createMessageId(),
        role: 'assistant',
        content: localAnswer.content,
        references: localAnswer.sources.map((source) => ({ label: source.label, target: source.tab })),
        mode: 'local',
        ...(localAnswer.suggestCloud ? { suggestCloudQuestion: question } : {}),
        createdAt: new Date().toISOString()
      }
      try {
        await persistMessages([...messages, userMessage, assistantMessage])
      } catch (cause) {
        setCloudError(localizedIpcError(locale, cause, t('无法保存会话历史。', '会話履歴を保存できませんでした。')))
      }
      return
    }
    const cloudPrompt = createCloudCandidatePrompt({
      candidateId: candidateCode(review),
      confirmedKeys,
      confirmedProjectIds,
      locale,
      projects,
      question,
      values
    })
    setCloudBusy(true)
    let userConversation: AiConversationSnapshot
    try {
      userConversation = await persistMessages([...messages, userMessage])
    } catch (cause) {
      setCloudError(
        localizedIpcError(
          locale,
          cause,
          t('由于无法保存会话历史，本次内容未发送到 Cloud AI。', '会話履歴を保存できないため、Cloud AIへ送信しませんでした。')
        )
      )
      setCloudBusy(false)
      return
    }
    try {
      const result = await onSendCloudPrompt({ content: cloudPrompt.content })
      const assistantMessage: AiConversationMessage = {
        id: createMessageId(),
        role: 'assistant',
        content: result.content,
        references: cloudPrompt.sources.map((source) => ({ label: source.label, target: source.tab })),
        mode: 'cloud',
        removedIdentifierCount: result.removedIdentifierTypes.length,
        usageCredits: result.usageCredits,
        createdAt: new Date().toISOString()
      }
      await persistMessages([...userConversation.messages, assistantMessage], userConversation)
    } catch (cause) {
      setCloudError(localizedIpcError(locale, cause, t('无法使用云端 AI。', 'Cloud AIを利用できませんでした。')))
      const fallbackMessage: AiConversationMessage = {
        id: createMessageId(),
        role: 'assistant',
        content: t(
          `云端 AI 暂时不可用，已使用本机档案助手回答：${localAnswer.content}`,
          `Cloud AIを利用できないため、端末内アシスタントで回答しました：${localAnswer.content}`
        ),
        references: localAnswer.sources.map((source) => ({ label: source.label, target: source.tab })),
        mode: 'local-fallback',
        createdAt: new Date().toISOString()
      }
      try {
        await persistMessages([...userConversation.messages, fallbackMessage], userConversation)
      } catch (saveCause) {
        setCloudError(
          localizedIpcError(
            locale,
            saveCause,
            t('无法将 Cloud AI 失败后的本机回答保存到会话历史。', 'Cloud AIの失敗回答を会話履歴へ保存できませんでした。')
          )
        )
      }
    } finally {
      setCloudBusy(false)
    }
  }

  const toggleConfirmedKey = (key: CandidateFieldKey, checked: boolean) => {
    setConfirmedKeys((current) => {
      const next = new Set(current)
      if (checked) next.add(key)
      else next.delete(key)
      return next
    })
  }

  const renderFieldEditor = (key: CandidateFieldKey) => {
    const field = fieldMap.get(key)
    if (!field) return null
    const changed = changedKeys.has(key)
    const confirmed = confirmedKeys.has(key)
    return (
      <article className={confirmed ? 'profile-field-editor is-confirmed' : 'profile-field-editor'} key={key}>
        <button
          onClick={() => {
            setSelectedKey(key)
            setActiveTab('source')
          }}
          type="button"
        >
          <span>{candidateFieldLabel(field.key, field.label, t)}</span>
          <small>
            {summarizeSourceLabels(field.sourceLabels, locale)} · {Math.round(field.confidence * 100)}%
          </small>
        </button>
        <input
          aria-label={t(`${candidateFieldLabel(field.key, field.label, t)}确认值`, `${field.label} の確認値`)}
          disabled={completed}
          onChange={(event) => setValues((current) => ({ ...current, [key]: event.target.value }))}
          placeholder={t('未检测到（可保持为空确认）', '未検出（空欄のまま確認可）')}
          value={values[key]}
        />
        {changed && !completed ? (
          <input
            aria-label={t(`${candidateFieldLabel(field.key, field.label, t)}修改备注`, `${field.label} の修正メモ`)}
            className="profile-change-reason"
            onChange={(event) => setReasons((current) => ({ ...current, [key]: event.target.value }))}
            placeholder={t('修改备注（可选）', '修正メモ（任意）')}
            value={reasons[key] ?? ''}
          />
        ) : null}
        <label>
          <input
            checked={confirmed}
            disabled={completed}
            onChange={(event) => toggleConfirmedKey(key, event.target.checked)}
            type="checkbox"
          />
          <span>{completed ? t('已确认', '確認済み') : t('标记为已核对（可选）', '確認済みとしてマーク（任意）')}</span>
        </label>
      </article>
    )
  }

  const tabs: Array<{ id: ProfileTab; label: string; count?: number }> = [
    { id: 'overview', label: t('档案总览', 'プロフィール概要') },
    { id: 'skills', label: t('技能矩阵', 'スキルマトリクス') },
    { id: 'projects', label: t('项目经历', 'プロジェクト経験'), count: projects.length },
    { id: 'commercial', label: t('商务条件', '商務条件'), count: pendingCommercial },
    { id: 'source', label: t('原文对照', '原文比較') },
    { id: 'quality', label: t('数据检查', 'データ確認'), count: pendingCount }
  ]

  return (
    <main className={aiOpen ? 'resume-profile-workspace has-ai' : 'resume-profile-workspace'}>
      <header className="resume-profile-header">
        <div className="resume-profile-identity">
          <button aria-label={backLabel ?? t('返回今日任务', '今日の作業へ戻る')} onClick={onBack} type="button">
            <Icon name="arrow-left" size={17} />
          </button>
          <div>
            <span>
              {t('人员资料', '要員資料')} / {t('人员主档', '人材マスタ')}
            </span>
            <h1>{candidateCode(review)}</h1>
          </div>
          {localDisplayName ? (
            <small>
              {t('本机姓名', '端末内氏名')}：{localDisplayName}
            </small>
          ) : null}
          <span className="local-identity-status">
            <Icon name="lock" size={13} />
            {t('身份信息仅保存在本机', '本人情報は端末内のみ')}
          </span>
          <span className="local-parse-status">
            <Icon name="check" size={13} />
            {t('本地解析完成', 'ローカル解析完了')}
          </span>
        </div>
        <div className="resume-profile-actions">
          {reviews.length > 1 ? (
            <select
              aria-label={t('选择需要确认的人员资料', '確認する要員資料')}
              onChange={(event) => onSelectDocument(event.target.value)}
              value={review.documentId}
            >
              {reviews.map((item, index) => (
                <option key={item.documentId} value={item.documentId}>
                  {item.localIdentity?.displayName ?? t(`人员资料 ${index + 1}`, `要員資料 ${index + 1}`)}
                </option>
              ))}
            </select>
          ) : null}
          <button className="profile-secondary-action" onClick={() => setActiveTab('source')} type="button">
            <Icon name="file" size={15} />
            {t('查看原始简历', '原文を見る')}
          </button>
          <button
            className="profile-primary-action"
            disabled={!ready}
            onClick={() => void submit()}
            title={t(
              '确认资料后保存人员档案；营业状态为「待营业」的人员即可参与案件匹配，无需等待招聘结论。',
              '資料を確認して要員プロフィールを保存します。営業状態が「営業待ち」の要員は、採用結論を待たずに案件マッチングに使われます。'
            )}
            type="button"
          >
            <Icon name="check" size={15} />
            {completed
              ? t('人员档案已确认', '要員プロフィール確認済み')
              : submitting
                ? t('正在保存…', '保存中…')
                : t('确认人员资料', '要員資料を確認')}
          </button>
          <button
            aria-expanded={aiOpen}
            className={aiOpen ? 'profile-ai-toggle is-active' : 'profile-ai-toggle'}
            onClick={() => setAiOpen((current) => !current)}
            type="button"
          >
            <Icon name="sparkles" size={15} />
            {t('问 AI', 'AIに質問')}
          </button>
        </div>
      </header>

      <div className="resume-profile-progress">
        <span>{t('档案完整度', 'プロフィール完成度')}</span>
        <strong>{completionPercent}%</strong>
        <div
          aria-label={`${completionPercent}%`}
          aria-valuemax={100}
          aria-valuemin={0}
          aria-valuenow={completionPercent}
          role="progressbar"
        >
          <i style={{ width: `${completionPercent}%` }} />
        </div>
        <small>{t('未填写、未逐项确认也可以入库', '未入力・未確認でも入庫できます')}</small>
        <button onClick={() => setActiveTab('quality')} type="button">
          {optionalReviewCount > 0
            ? t(`${optionalReviewCount}项可选确认`, `${optionalReviewCount}件の任意確認項目`)
            : t('可以入库', '入庫可能')}
        </button>
      </div>

      <nav aria-label={t('人员档案区域', '人材プロフィールのセクション')} className="resume-profile-tabs" role="tablist">
        {tabs.map((tab) => (
          <button
            aria-selected={activeTab === tab.id}
            className={activeTab === tab.id ? 'is-active' : undefined}
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            role="tab"
            type="button"
          >
            {tab.label}
            {typeof tab.count === 'number' && tab.count > 0 ? <span>{tab.count}</span> : null}
          </button>
        ))}
      </nav>

      <div className="resume-profile-body">
        <section className="resume-profile-scroll" role="tabpanel">
          {activeTab === 'overview' ? (
            <div className="profile-overview-view">
              <section className="profile-overview-section">
                <h2>{t('人员概览', '要員概要')}</h2>
                <div className="profile-overview-facts">
                  <div className={confirmedKeys.has('experience_years') ? undefined : 'is-pending'}>
                    <Icon name="sparkles" size={18} />
                    <span>
                      <small>{t('总经验', '総経験')}</small>
                      <strong>{valueFor('experience_years')}</strong>
                    </span>
                  </div>
                  <div className={confirmedKeys.has('role') ? undefined : 'is-pending'}>
                    <Icon name="briefcase" size={18} />
                    <span>
                      <small>{t('主力岗位', '主力ポジション')}</small>
                      <strong>{valueFor('role')}</strong>
                    </span>
                  </div>
                  <div className={confirmedKeys.has('japanese_level') ? undefined : 'is-pending'}>
                    <Icon name="mail" size={18} />
                    <span>
                      <small>{t('日语能力', '日本語力')}</small>
                      <strong>{valueFor('japanese_level')}</strong>
                    </span>
                  </div>
                  <div className={projectReviewComplete ? undefined : 'is-pending'}>
                    <Icon name="file" size={18} />
                    <span>
                      <small>{t('项目数量', 'プロジェクト数')}</small>
                      <strong>
                        {projects.length}
                        {t('项', '件')}
                      </strong>
                    </span>
                  </div>
                  <div className={confirmedKeys.has('location') ? undefined : 'is-pending'}>
                    <Icon name="home" size={18} />
                    <span>
                      <small>{t('期望工作地点', '希望勤務地')}</small>
                      <strong>{valueFor('location')}</strong>
                    </span>
                  </div>
                  <div className={confirmedKeys.has('availability') ? undefined : 'is-pending'}>
                    <Icon name="clock" size={18} />
                    <span>
                      <small>{t('可入场时间', '稼働時期')}</small>
                      <strong>{valueFor('availability')}</strong>
                    </span>
                  </div>
                </div>
                {pendingCommercial > 0 ? (
                  <button className="profile-inline-warning" onClick={() => setActiveTab('commercial')} type="button">
                    <Icon name="alert" size={16} />
                    {t(
                      '可入场时间、期望单价等即使未填写也能入库；补充后可提高匹配准确度。',
                      '稼働時期・希望単価などは未設定でも登録できます。補完するとマッチング精度が上がります。'
                    )}
                    <Icon name="chevron-right" size={15} />
                  </button>
                ) : null}
              </section>

              <section className="profile-overview-section">
                <div className="profile-section-heading">
                  <h2>{t('职业摘要', '職務要約')}</h2>
                  <button onClick={() => setActiveTab('quality')} type="button">
                    {t('确认和编辑', '確認・編集')}
                  </button>
                </div>
                <p className="profile-career-summary">{overviewSummary}</p>
              </section>

              <section className="profile-overview-section">
                <div className="profile-section-heading">
                  <h2>{t('核心技能', '主要スキル')}</h2>
                  <button onClick={() => setActiveTab('skills')} type="button">
                    {t('打开技能矩阵', 'スキルマトリクスを開く')}
                  </button>
                </div>
                <div className="profile-skill-table" role="table">
                  <div className="profile-table-header" role="row">
                    <span>{t('技术', '技術')}</span>
                    <span>{t('相关项目', '関連プロジェクト')}</span>
                    <span>{t('来源', '出典')}</span>
                    <span>{t('状态', '状態')}</span>
                  </div>
                  {skills.slice(0, 6).map((skill) => (
                    <div key={skill.name} role="row">
                      <strong>{skill.name}</strong>
                      <span>
                        {skill.projects.length}
                        {t('项', '件')}
                      </span>
                      <span>
                        {skill.sourceCount}
                        {t('项', '件')}
                      </span>
                      <em>{confirmedKeys.has('skills') ? t('已确认', '確認済み') : t('待确认', '確認待ち')}</em>
                    </div>
                  ))}
                  {skills.length === 0 ? <p>{t('尚未检测到技能。', 'スキルはまだ検出されていません。')}</p> : null}
                </div>
              </section>

              <section className="profile-overview-section">
                <div className="profile-section-heading">
                  <h2>{t('最近项目经历', '最近のプロジェクト経験')}</h2>
                  <button onClick={() => setActiveTab('projects')} type="button">
                    {t('查看全部项目', 'すべてのプロジェクトを見る')}
                  </button>
                </div>
                <div className="profile-project-table" role="table">
                  <div className="profile-project-header" role="row">
                    <span>{t('期间', '期間')}</span>
                    <span>{t('项目概要', 'プロジェクト概要')}</span>
                    <span>{t('角色', '役割')}</span>
                    <span>{t('负责内容', '担当内容')}</span>
                    <span>{t('技术栈', '技術スタック')}</span>
                  </div>
                  {projects.slice(0, 3).map((project) => (
                    <div key={project.draftId} role="row">
                      <span>{project.period ? localizeProfileDisplay(project.period, locale) : t('未设置', '未設定')}</span>
                      <strong>{project.title}</strong>
                      <span>{project.role ?? t('未设置', '未設定')}</span>
                      <p>{project.summary}</p>
                      <span>{projectTechnologies(project.technologies).slice(0, 5).join(' · ') || t('未设置', '未設定')}</span>
                    </div>
                  ))}
                </div>
              </section>
            </div>
          ) : null}

          {activeTab === 'skills' ? (
            <div className="profile-detail-view">
              <header>
                <span>{'STANDARD PROFILE'}</span>
                <h2>{t('技能矩阵', 'スキルマトリクス')}</h2>
                <p>{t('将检测到的技术与项目经历关联后进行确认。', '抽出された技術をプロジェクト経験と結び付けて確認します。')}</p>
              </header>
              {renderFieldEditor('skills')}
              <div className="profile-skill-table is-expanded" role="table">
                <div className="profile-table-header" role="row">
                  <span>{t('技术', '技術')}</span>
                  <span>{t('相关项目', '関連プロジェクト')}</span>
                  <span>{t('来源', '出典')}</span>
                  <span>{t('状态', '状態')}</span>
                </div>
                {skills.map((skill) => (
                  <div key={skill.name} role="row">
                    <strong>{skill.name}</strong>
                    <span>{skill.projects.slice(0, 3).join('、') || t('尚未关联项目', 'プロジェクト未紐付け')}</span>
                    <span>
                      {skill.sourceCount}
                      {t('项', '件')}
                    </span>
                    <em>{confirmedKeys.has('skills') ? t('已确认', '確認済み') : t('待确认', '確認待ち')}</em>
                  </div>
                ))}
              </div>
            </div>
          ) : null}

          {activeTab === 'commercial' ? (
            <div className="profile-detail-view">
              <header>
                <span>{'WORK CONDITIONS'}</span>
                <h2>{t('商务条件', '商務条件')}</h2>
                <p>
                  {t(
                    '只确认匹配所需条件；未经确认的信息不会作为确定条件。',
                    'マッチングに使う条件だけを確認し、未確認情報は確定条件として扱いません。'
                  )}
                </p>
              </header>
              <div className="profile-field-grid">{commercialFieldKeys.map(renderFieldEditor)}</div>
            </div>
          ) : null}

          {activeTab === 'projects' ? (
            <div className="profile-detail-view">
              <header className="profile-projects-title">
                <div>
                  <span>{'PROJECT HISTORY'}</span>
                  <h2>{t('项目经历', 'プロジェクト経験')}</h2>
                  <p>{t('以标准格式确认期间、角色、负责内容和技术。', '期間、役割、担当内容と技術を標準形式で確認します。')}</p>
                </div>
                {!completed ? (
                  <button
                    onClick={() =>
                      setProjects((current) => [
                        ...current,
                        {
                          draftId: `manual-${crypto.randomUUID()}`,
                          title: '',
                          period: null,
                          role: null,
                          technologies: '',
                          summary: '',
                          confidence: 0,
                          sourceLabels: [],
                          changed: true,
                          changeReason: null
                        }
                      ])
                    }
                    type="button"
                  >
                    <Icon name="plus" size={15} />
                    {t('添加经历', '経験を追加')}
                  </button>
                ) : null}
              </header>
              <div className="profile-project-editor-list">
                {projects.map((project, index) => (
                  <article key={project.draftId}>
                    <header>
                      <strong>
                        {t('项目', 'プロジェクト')} {index + 1}
                      </strong>
                      <span>{summarizeSourceLabels(project.sourceLabels, locale, { projectIndex: index + 1 })}</span>
                      {!completed ? (
                        <button
                          onClick={() => {
                            setProjects((current) => current.filter((item) => item.draftId !== project.draftId))
                            setConfirmedProjectIds((current) => {
                              const next = new Set(current)
                              next.delete(project.draftId)
                              return next
                            })
                          }}
                          type="button"
                        >
                          {t('删除', '削除')}
                        </button>
                      ) : null}
                    </header>
                    <div className="profile-project-fields">
                      <label>
                        {t('案件/项目名称', '案件・プロジェクト名')}
                        <input
                          aria-label={t(`项目 ${index + 1} 的名称`, `プロジェクト ${index + 1} の名称`)}
                          disabled={completed}
                          onChange={(event) =>
                            setProjects((current) =>
                              current.map((item) => (item.draftId === project.draftId ? { ...item, title: event.target.value } : item))
                            )
                          }
                          value={project.title}
                        />
                      </label>
                      <label>
                        {t('期间', '期間')}
                        <input
                          aria-label={t(`项目 ${index + 1} 的期间`, `プロジェクト ${index + 1} の期間`)}
                          disabled={completed}
                          onChange={(event) =>
                            setProjects((current) =>
                              current.map((item) => (item.draftId === project.draftId ? { ...item, period: event.target.value } : item))
                            )
                          }
                          value={project.period ?? ''}
                        />
                      </label>
                      <label>
                        {t('角色', '役割')}
                        <input
                          aria-label={t(`项目 ${index + 1} 的角色`, `プロジェクト ${index + 1} の役割`)}
                          disabled={completed}
                          onChange={(event) =>
                            setProjects((current) =>
                              current.map((item) => (item.draftId === project.draftId ? { ...item, role: event.target.value } : item))
                            )
                          }
                          value={project.role ?? ''}
                        />
                      </label>
                      <label>
                        {t('技术（以逗号分隔）', '技術（カンマ区切り）')}
                        <input
                          aria-label={t(`项目 ${index + 1} 的技术`, `プロジェクト ${index + 1} の技術`)}
                          disabled={completed}
                          onChange={(event) =>
                            setProjects((current) =>
                              current.map((item) =>
                                item.draftId === project.draftId ? { ...item, technologies: event.target.value } : item
                              )
                            )
                          }
                          value={project.technologies}
                        />
                      </label>
                    </div>
                    <label>
                      {t('负责内容', '担当内容')}
                      <textarea
                        aria-label={t(`项目 ${index + 1} 的负责内容`, `プロジェクト ${index + 1} の担当内容`)}
                        disabled={completed}
                        maxLength={1500}
                        onChange={(event) =>
                          setProjects((current) =>
                            current.map((item) => (item.draftId === project.draftId ? { ...item, summary: event.target.value } : item))
                          )
                        }
                        value={project.summary}
                      />
                    </label>
                    <label className="profile-project-confirm">
                      <input
                        checked={confirmedProjectIds.has(project.draftId)}
                        disabled={completed}
                        onChange={(event) =>
                          setConfirmedProjectIds((current) => {
                            const next = new Set(current)
                            if (event.target.checked) next.add(project.draftId)
                            else next.delete(project.draftId)
                            return next
                          })
                        }
                        type="checkbox"
                      />
                      {completed ? t('已确认', '確認済み') : t('标记为已核对（可选）', '確認済みとしてマーク（任意）')}
                    </label>
                  </article>
                ))}
              </div>
              {projectsChanged && !completed ? (
                <label className="profile-project-reason">
                  {t('项目经历修改备注（可选）', 'プロジェクト経験の変更メモ（任意）')}
                  <input
                    aria-label={t('项目经历修改备注（可选）', 'プロジェクト経験の変更メモ（任意）')}
                    onChange={(event) => setProjectChangeReason(event.target.value)}
                    placeholder={t('修改内容备注（可选）', '変更内容のメモ（任意）')}
                    value={projectChangeReason}
                  />
                </label>
              ) : null}
            </div>
          ) : null}

          {activeTab === 'source' && onLoadOriginalDocument && onOpenOriginalDocument ? (
            <ImportOriginalDocumentWorkspace
              disabled={completed}
              documentId={review.documentId}
              fields={review.fields}
              onChangeField={(key, value) => setValues((current) => ({ ...current, [key]: value }))}
              onChangeProject={(draftId, key, value) =>
                setProjects((current) => current.map((project) => (project.draftId === draftId ? { ...project, [key]: value } : project)))
              }
              onLoad={onLoadOriginalDocument}
              onOpen={onOpenOriginalDocument}
              onSelectField={setSelectedKey}
              projects={projects}
              selectedFieldKey={selectedKey}
              values={values}
            />
          ) : null}

          {activeTab === 'quality' ? (
            <div className="profile-detail-view profile-quality-view">
              <header>
                <span>{'DATA QUALITY'}</span>
                <h2>{t('数据检查', 'データ確認')}</h2>
                <p>
                  {t(
                    '所有档案字段均为可选；可以保留空白入库，之后再补充需要的信息。',
                    'すべてのプロフィール項目は任意です。未入力のまま登録し、必要な情報だけ後から補えます。'
                  )}
                </p>
              </header>
              {!completed ? (
                <div className="profile-quality-toolbar">
                  <span>
                    {optionalReviewCount}
                    {t('项可选确认', '件の任意確認項目')}
                  </span>
                  <button onClick={confirmHighConfidence} type="button">
                    {t('批量确认高置信度项', '高信頼度を一括確認')}
                  </button>
                </div>
              ) : null}
              <div className="profile-field-grid profile-quality-fields">{review.fields.map((field) => renderFieldEditor(field.key))}</div>
              <div className="profile-processing-details">
                <details>
                  <summary>{t('解析与安全记录', '解析と安全記録')}</summary>
                  <p>
                    {t(
                      '本地解析、PII 替换和 DLP 检查记录仅在此处显示。',
                      'ローカル解析、PII置換、DLP確認の技術記録はここでのみ表示します。'
                    )}
                  </p>
                  <code>
                    {task.id} · {analysis.analysisVersion} · No Network
                  </code>
                </details>
                {!completed ? (
                  <button className="profile-cancel-task" disabled={lifecycleBusy} onClick={onCancel} type="button">
                    {t('取消导入任务', 'インポート作業をキャンセル')}
                  </button>
                ) : null}
              </div>
              {lifecycleError ? (
                <div className="inline-error" role="alert">
                  <Icon name="alert" size={16} />
                  {lifecycleError}
                </div>
              ) : null}
            </div>
          ) : null}
        </section>

        {aiOpen ? (
          <aside className="candidate-ai-drawer">
            <header>
              <div>
                <h2>{t('询问当前人员', 'この人材に質問')}</h2>
                <span>{assistantMode === 'local' ? t('本地快速查询', 'ローカル高速照会') : 'AICommerce Cloud AI'}</span>
              </div>
              <div className="candidate-ai-header-actions">
                <button
                  aria-pressed={historyOpen}
                  className={historyOpen ? 'is-active' : ''}
                  onClick={() => setHistoryOpen((current) => !current)}
                  type="button"
                >
                  <Icon name="clock" size={14} />
                  {t('历史', '履歴')}
                </button>
                <button aria-label={t('关闭 AI 面板', 'AIパネルを閉じる')} onClick={() => setAiOpen(false)} type="button">
                  {t('关闭', '閉じる')}
                </button>
              </div>
            </header>
            {historyOpen ? (
              <AiConversationHistoryPanel
                activeConversationId={history.activeConversationId}
                busy={history.saving}
                conversations={history.conversations}
                error={history.error}
                loading={history.loading}
                onDelete={history.deleteConversations}
                onNew={() => {
                  history.newConversation()
                  setHistoryOpen(false)
                }}
                onSelect={(conversationId) => {
                  history.selectConversation(conversationId)
                  setHistoryOpen(false)
                }}
              />
            ) : (
              <>
                <div aria-label={t('AI 回答模式', 'AI回答モード')} className="candidate-ai-mode-switch" role="group">
                  <button
                    aria-pressed={assistantMode === 'local'}
                    className={assistantMode === 'local' ? 'is-active' : undefined}
                    onClick={() => {
                      setAssistantMode('local')
                      setCloudError(null)
                    }}
                    type="button"
                  >
                    <Icon name="database" size={14} />
                    {t('本地快速查询', 'ローカル高速照会')}
                  </button>
                  <button
                    aria-pressed={assistantMode === 'cloud'}
                    className={assistantMode === 'cloud' ? 'is-active is-cloud' : undefined}
                    onClick={() => {
                      setAssistantMode('cloud')
                      setCloudError(null)
                    }}
                    type="button"
                  >
                    <Icon name="sparkles" size={14} />
                    {t('云端 AI 分析', 'Cloud AI分析')}
                  </button>
                </div>
                <div className={assistantMode === 'cloud' ? 'candidate-ai-scope is-cloud' : 'candidate-ai-scope'}>
                  <Icon name={assistantMode === 'local' ? 'database' : 'shield'} size={14} />
                  <span>
                    {assistantMode === 'local'
                      ? t(
                          '仅用规则查询已确认的结构化数据，不使用模型或网络',
                          '確認済み構造化データを規則で検索・モデルもネットワークも不使用'
                        )
                      : t('只发送已确认、已脱敏的最小必要数据', '確認済み・脱敏済みの最小データだけを送信')}
                  </span>
                </div>
                {assistantMode === 'cloud' ? (
                  <div className={cloudConnected && cloudContextAvailable ? 'candidate-ai-cloud-gate is-ready' : 'candidate-ai-cloud-gate'}>
                    {!cloudConfigured ? (
                      <>
                        <strong>{t('需要配置云端 AI', 'Cloud AIの配布設定が必要です')}</strong>
                        <p>{t('请在设置中检查 AICommerce 连接。', '設定でAICommerce接続を確認してください。')}</p>
                        <button onClick={onOpenCloudSettings} type="button">
                          {t('打开云端 AI 设置', 'Cloud AI設定を開く')}
                        </button>
                      </>
                    ) : !cloudConnected ? (
                      <>
                        <strong>{t('云端 AI 尚未连接', 'Cloud AIは未接続です')}</strong>
                        <p>{t('登录 Member Center 后即可使用云端增强。', 'Member CenterへサインインするとCloud強化を利用できます。')}</p>
                        <button onClick={onOpenCloudSettings} type="button">
                          {t('打开连接与用量', '接続と利用状況を開く')}
                        </button>
                      </>
                    ) : !cloudContextAvailable ? (
                      <>
                        <strong>{t('没有已确认数据', '確認済みデータがありません')}</strong>
                        <p>
                          {t('只有已确认字段或项目才能发送到云端。', '確認済みフィールドまたはプロジェクトだけをCloudへ送信できます。')}
                        </p>
                      </>
                    ) : (
                      <label>
                        <input checked={cloudConsent} onChange={(event) => setCloudConsent(event.target.checked)} type="checkbox" />
                        <span>
                          <strong>{t('确认发送脱敏后的匿名档案', '脱敏後の匿名プロフィール送信を確認')}</strong>
                          <small>
                            {t(
                              '不会发送姓名、电话、邮箱、详细住址或原文；回答也会在本机再次检查。',
                              '姓名・電話・メール・詳細住所・原文は送信しません。応答も端末内で再検査します。'
                            )}
                          </small>
                        </span>
                      </label>
                    )}
                  </div>
                ) : null}
                <div className="candidate-ai-prompts">
                  {[
                    t('主要能力是什么？', '主な強みは？'),
                    t('做过哪些金融项目？', '金融案件の経験は？'),
                    t('适合什么案件？', 'どんな案件に合う？')
                  ].map((question) => (
                    <button
                      disabled={assistantMode === 'cloud' && !cloudSendReady}
                      key={question}
                      onClick={() => void askCandidate(question)}
                      type="button"
                    >
                      {question}
                    </button>
                  ))}
                </div>
                <div aria-live="polite" className="candidate-ai-messages">
                  {messages.length === 0 ? (
                    <div className="candidate-ai-empty">
                      <Icon name={assistantMode === 'local' ? 'database' : 'sparkles'} size={22} />
                      <strong>
                        {assistantMode === 'local'
                          ? t('立即查询已确认数据', '確認済みデータをすぐに照会')
                          : t('使用云端 AI 分析人员档案', '人材プロフィールをCloud AIで分析')}
                      </strong>
                      <p>
                        {assistantMode === 'local'
                          ? t(
                              '通过规则查询技能、项目和商务条件；这不是生成式 AI，也不使用网络。',
                              '規則で技能・プロジェクト・商務条件を検索します。生成AIではなく、ネットワークも使用しません。'
                            )
                          : t(
                              '云端 AI 分析仅使用已确认的脱敏数据，深入分析总结、适合度和建议。',
                              'Cloud AI分析は脱敏済みの確認データだけで、要約・適性・提案を深く分析します。'
                            )}
                      </p>
                    </div>
                  ) : (
                    messages.map((message) => (
                      <article className={`candidate-ai-message is-${message.role}`} key={message.id}>
                        {message.role === 'assistant' && message.mode ? (
                          <span className={`candidate-ai-answer-mode is-${message.mode}`}>
                            {message.mode === 'cloud'
                              ? t('云端 AI · 已脱敏', 'Cloud AI・脱敏済み')
                              : message.mode === 'local-fallback'
                                ? t('云端不可用 · 已回退到本地查询', 'Cloud不可・ローカル照会へフォールバック')
                                : t('本地数据查询', 'ローカルデータ照会')}
                          </span>
                        ) : null}
                        <p>{message.content}</p>
                        {message.references && message.references.length > 0 ? (
                          <div>
                            <span>{t('引用来源', '参照元')}</span>
                            {message.references.map((reference) => (
                              <button
                                key={`${message.id}-${reference.target}-${reference.label}`}
                                onClick={() => setActiveTab(reference.target as ProfileTab)}
                                type="button"
                              >
                                {reference.label}
                              </button>
                            ))}
                          </div>
                        ) : null}
                        {message.suggestCloudQuestion ? (
                          <button
                            className="candidate-ai-escalate"
                            onClick={() => {
                              setAssistantMode('cloud')
                              setAiInput(message.suggestCloudQuestion ?? '')
                              setCloudError(null)
                            }}
                            type="button"
                          >
                            <Icon name="sparkles" size={14} />
                            {t('使用云端 AI 分析此问题', 'Cloud AI分析で質問')}
                          </button>
                        ) : null}
                        {message.mode === 'cloud' ? (
                          <small className="candidate-ai-cloud-meta">
                            {message.removedIdentifierCount
                              ? t(
                                  `${message.removedIdentifierCount}项已在发送前替换 · `,
                                  `${message.removedIdentifierCount}件を送信前に置換 · `
                                )
                              : ''}
                            {message.usageCredits === null ? t('未提供使用量', '利用量は未提供') : `${message.usageCredits ?? 0} credits`}
                          </small>
                        ) : null}
                      </article>
                    ))
                  )}
                  {cloudBusy ? (
                    <div className="candidate-ai-loading">
                      <i />
                      <span>{t('云端 AI 正在分析脱敏档案…', 'Cloud AIが脱敏済みプロフィールを分析中…')}</span>
                    </div>
                  ) : null}
                </div>
                {cloudError || history.error ? (
                  <div className="candidate-ai-cloud-error" role="alert">
                    <Icon name="alert" size={14} />
                    <span>{cloudError ?? history.error}</span>
                  </div>
                ) : null}
                <form
                  className="candidate-ai-composer"
                  onSubmit={(event) => {
                    event.preventDefault()
                    void askCandidate(aiInput)
                  }}
                >
                  <textarea
                    aria-label={t('向 AI 询问当前人员', '人材についてAIに質問')}
                    disabled={assistantMode === 'cloud' && (history.saving || !cloudSendReady)}
                    maxLength={500}
                    onChange={(event) => setAiInput(event.target.value)}
                    placeholder={
                      assistantMode === 'local'
                        ? t('查询技能、项目、入场时间等数据…', '技能、プロジェクト、入場時期などを照会…')
                        : t('向云端 AI 询问适合度、优势或案件建议…', '適性、強み、案件提案をCloud AIに質問…')
                    }
                    value={aiInput}
                  />
                  <button disabled={!aiInput.trim() || (assistantMode === 'cloud' && (history.saving || !cloudSendReady))} type="submit">
                    <Icon name="chevron-right" size={18} />
                    <span>{t('发送', '送信')}</span>
                  </button>
                </form>
                <footer>
                  <Icon name="shield" size={14} />
                  {assistantMode === 'local'
                    ? t('仅使用规则查询，不调用模型，也不发送到云端', '規則照会だけ・モデル不使用・Cloud送信なし')
                    : t('输入和回答均在本机检查，身份信息不会发送到云端', '入力と応答を端末内で検査・本人情報はCloud送信なし')}
                </footer>
              </>
            )}
          </aside>
        ) : null}
      </div>
      {error ? (
        <div className="resume-profile-error" role="alert">
          <Icon name="alert" size={16} />
          {error}
        </div>
      ) : null}
    </main>
  )
}
