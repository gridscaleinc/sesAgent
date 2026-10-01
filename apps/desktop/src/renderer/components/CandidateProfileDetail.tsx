import { PersonnelMailUpdates } from './PersonnelMailUpdates'
import { BusinessField } from './BusinessField'
import { useMemo, useState, type FormEvent } from 'react'
import type {
  PrepareAiCommerceCloudPromptInput,
  AiCommerceCloudPromptResult,
  AiCommerceMembershipState,
  CandidateDeletionPreview,
  CandidateFieldKey,
  CandidateProfileLibraryField,
  CandidateProfileSearchResult,
  CandidateProfileVersionDetail,
  DataDeletionReport,
  DeleteCandidateDataInput,
  OriginalDocumentPreview,
  ResumeAnalysisSummary,
  UpdateCandidateProfileInput,
  UpdateCandidateProfileResult
} from '@shared'
import { candidateWorkAuthorizationValues } from '@shared'
import { localeText, localizedCandidateFieldLabel, localizedIpcError, useLocaleText, localizedMainText } from '../i18n'
import { summarizeSourceLabels } from '../source-evidence'
import { Icon } from './Icon'
import { OriginalDocumentWorkspace } from './OriginalDocumentWorkspace'
import { DeletionBusinessCountItems, DeletionPlacementBlock, deletionBlockedByPlacement } from './deletion-impact'

type CandidateDetailTab = 'overview' | 'skills' | 'projects' | 'commercial' | 'source' | 'versions'
type AssistantMode = 'local' | 'cloud'

interface AssistantMessage {
  id: string
  role: 'user' | 'assistant'
  content: string
  mode?: 'local' | 'cloud' | 'local-fallback'
  sourceTab?: CandidateDetailTab
  removedIdentifierCount?: number
  usageCredits?: number | null
}

interface CandidateProfileDetailProps {
  candidate: CandidateProfileSearchResult
  versions: CandidateProfileVersionDetail[]
  historyStatus: 'loading' | 'ready' | 'error'
  historyError: string | null
  analysis?: ResumeAnalysisSummary
  aiCommerce?: AiCommerceMembershipState
  onBack(): void
  onOpenCloudSettings?(): void
  onLoadOriginalDocument(sourceDocumentId: string): Promise<OriginalDocumentPreview>
  onOpenOriginalDocument(sourceDocumentId: string): Promise<unknown>
  onSendCloudPrompt?(input: PrepareAiCommerceCloudPromptInput): Promise<AiCommerceCloudPromptResult>
  onUpdateCandidate(input: UpdateCandidateProfileInput): Promise<UpdateCandidateProfileResult>
  onPreviewDeletion(sourceDocumentId: string): Promise<CandidateDeletionPreview>
  onDeleteCandidate(input: DeleteCandidateDataInput): Promise<DataDeletionReport>
}

interface EditableProject {
  id: string
  title: string
  period: string
  role: string
  technologies: string
  summary: string
}

const commercialKeys: CandidateFieldKey[] = ['availability', 'rate', 'work_style', 'location', 'work_authorization']

/** Candidate field labels arrive from Main in Japanese; the renderer names each field by its key. */
export function candidateFieldLabel(key: CandidateFieldKey, ja: string, t: (cn: string, ja: string) => string): string {
  return t(localizedCandidateFieldLabel('zh-CN', { key, label: ja }), ja)
}

/** Work-authorization values are stored in Japanese; only the displayed label is localized. */
export function workAuthorizationLabel(value: string, t: (cn: string, ja: string) => string): string {
  return t(localizedMainText('zh-CN', value), value)
}

function splitSkills(value: string | null): string[] {
  if (!value) return []
  return [
    ...new Set(
      value
        .split(/[,、/・|]/u)
        .map((item) => item.trim().replace(/\s*[（(][◎○◯△×][）)]\s*$/u, ''))
        .filter((item) => item.length > 1)
    )
  ].slice(0, 40)
}

function sourceMarker(label: string): string {
  const page = label.match(/^Page (\d+)$/u)
  if (page?.[1]) return `[PAGE:${page[1]}]`
  const paragraph = label.match(/^Paragraph (\d+)$/u)
  if (paragraph?.[1]) return `[PARAGRAPH:${paragraph[1]}]`
  return `[SHEET:${label}]`
}

function humanizePreview(value: string): string {
  return value
    .split('\n')
    .map((line) => line.replace(/\[(?:SHEET|PAGE|PARAGRAPH):[^\]]*(?:\]\s*|$)/gu, ''))
    .filter((line) => line.trim().length > 0)
    .join('\n')
}

function dateLabel(value: string, locale: 'ja-JP' | 'zh-CN'): string {
  return new Intl.DateTimeFormat(locale, { year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(value))
}

function messageId(): string {
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`
}

function compact(value: string, limit = 700): string {
  return value.replace(/\s+/gu, ' ').trim().slice(0, limit)
}

function createCloudPrompt(candidate: CandidateProfileSearchResult, question: string, locale: 'ja-JP' | 'zh-CN'): string {
  const t = localeText(locale === 'zh-CN')

  const fields = candidate.fields.flatMap((field) =>
    field.value ? [`- ${field.label}: ${compact(field.value, field.key === 'skills' ? 2_000 : 500)}`] : []
  )
  // i18n-ignore: project lines are part of the AI prompt sent to the cloud model
  const projects = candidate.projectExperiences.slice(0, 8).map((project, index) =>
    [
      `${index + 1}. ${compact(project.title, 180)}`,
      `   ${t('期间', '期間')}: ${compact(project.period ?? '-', 120)}`,
      `   ${t('角色', '役割')}: ${compact(project.role ?? '-', 120)}`,
      `   ${t('技术', '技術')}: ${
        project.technologies
          .slice(0, 20)
          .map((item) => compact(item, 80))
          .join(', ') || '-'
      }`,
      `   ${t('负责内容', '担当内容')}: ${compact(project.summary)}`
    ].join('\n')
  )
  const anonymousId = `C-${candidate.id.replaceAll('-', '').slice(0, 8).toUpperCase()}`
  // i18n-ignore: AI assistant prompt sent to the cloud model
  const lines =
    locale === 'zh-CN'
      ? [
          '你是日本 SES 公司的人才档案分析助手。',
          '只能依据下方结构化档案回答；缺少依据时明确说不知道。',
          '禁止推测或输出姓名、电话、邮箱、详细住址、国籍、籍贯、年龄、性别等个人身份或敏感属性。',
          '事实与建议必须分开，使用简洁、专业的中文回答。',
          `用户问题: ${compact(question, 500)}`,
          `匿名候选人编号: ${anonymousId}`,
          '档案字段:',
          fields.join('\n') || '- 无',
          '项目经历:',
          projects.join('\n') || '- 无'
        ]
      : [
          'あなたは日本のSES企業向け人材プロフィール分析アシスタントです。',
          '以下の構造化プロフィールだけを根拠に回答し、根拠がない場合は不明と明記してください。',
          '氏名、電話、メール、詳細住所、国籍、出身地、年齢、性別などの本人情報・機微属性を推測または出力しないでください。',
          '事実と提案を分け、簡潔で業務的な日本語で回答してください。',
          `質問: ${compact(question, 500)}`,
          `匿名候補者番号: ${anonymousId}`,
          'プロフィール項目:',
          fields.join('\n') || '- なし',
          'プロジェクト経験:',
          projects.join('\n') || '- なし'
        ]
  return lines.join('\n').slice(0, 12_000)
}

function localAnswer(
  question: string,
  candidate: CandidateProfileSearchResult,
  fields: Map<CandidateFieldKey, CandidateProfileLibraryField>,
  locale: 'ja-JP' | 'zh-CN'
): { content: string; sourceTab: CandidateDetailTab } {
  const value = (key: CandidateFieldKey) => fields.get(key)?.value ?? null
  const skills = splitSkills(value('skills'))
  const role = value('role')
  const experience = value('experience_years')

  const t = localeText(locale === 'zh-CN')

  // i18n-ignore: question-matching regex
  if (/哪里人|出身|国籍|住所|住まい|where.*from/iu.test(question)) {
    const nationality = candidate.localIdentity?.nationality
    const address = candidate.localIdentity?.address
    const facts = [
      nationality ? t(`国籍：${nationality}`, `国籍：${nationality}`) : null,
      address ? t(`住址／最近车站：${address}`, `住所・最寄り駅：${address}`) : null
    ].filter(Boolean)
    return {
      content: facts.length
        ? t(
            `本机档案登记的信息为：${facts.join('；')}。系统不会据此推测籍贯。`,
            `端末内プロフィールの登録情報：${facts.join('；')}。この情報から出身地は推測しません。`
          )
        : t(
            '本机档案没有登记可靠的国籍或住址信息，系统不会根据姓名、语言或期望工作地点推测“哪里人”。',
            '端末内プロフィールに信頼できる国籍・住所情報がなく、氏名・言語・希望勤務地から出身地を推測もしません。'
          ),
      sourceTab: 'overview'
    }
  }
  // i18n-ignore: question-matching regex
  if (/项目|案件|做过|経験|project/iu.test(question)) {
    const names = candidate.projectExperiences.slice(0, 4).map((project) => project.title)
    return {
      content: t(
        `档案中有 ${candidate.projectExperiences.length} 项项目经历${names.length ? `，代表项目包括：${names.join('、')}` : ''}。`,
        `プロフィールには${candidate.projectExperiences.length}件のプロジェクト経験があります${names.length ? `。代表例：${names.join('、')}` : '。'} `
      ),
      sourceTab: 'projects'
    }
  }
  // i18n-ignore: question-matching regex
  if (/入场|稼働|单价|単価|工作方式|勤務|条件|available|rate/iu.test(question)) {
    const facts = [value('availability'), value('rate'), value('work_style'), value('location')].filter(Boolean)
    return {
      content: facts.length
        ? t(`当前商务条件：${facts.join('；')}。`, `現在の商務条件：${facts.join('；')}。`)
        : t('档案中暂未填写可入场时间、期望单价或工作方式。', '稼働時期、希望単価、勤務形態はまだ登録されていません。'),
      sourceTab: 'commercial'
    }
  }
  return {
    content: skills.length
      ? t(
          `主要能力是 ${skills.slice(0, 6).join('、')}${role ? `，主力角色为 ${role}` : ''}${experience ? `，总经验 ${experience}` : ''}。结论基于当前人员档案和 ${candidate.projectExperiences.length} 项项目经历。`,
          `主な能力は${skills.slice(0, 6).join('、')}${role ? `、主力ロールは${role}` : ''}${experience ? `、総経験は${experience}` : ''}です。現在のプロフィールと${candidate.projectExperiences.length}件のプロジェクト経験を根拠にしています。`
        )
      : t(
          '当前档案没有足够的技能信息，可以继续查看项目经历或使用云端 AI 进行综合分析。',
          '現在のプロフィールには十分なスキル情報がありません。プロジェクト経験を確認するか、Cloud AIで総合分析できます。'
        ),
    sourceTab: skills.length ? 'skills' : 'projects'
  }
}

export function CandidateProfileDetail({
  candidate,
  versions,
  historyStatus,
  historyError,
  analysis,
  aiCommerce,
  onBack,
  onOpenCloudSettings,
  onLoadOriginalDocument,
  onOpenOriginalDocument,
  onSendCloudPrompt,
  onUpdateCandidate,
  onPreviewDeletion,
  onDeleteCandidate
}: CandidateProfileDetailProps) {
  const { locale, t } = useLocaleText()
  const [activeTab, setActiveTab] = useState<CandidateDetailTab>('overview')
  const [aiOpen, setAiOpen] = useState(true)
  const [assistantMode, setAssistantMode] = useState<AssistantMode>('local')
  const [aiInput, setAiInput] = useState('')
  const [messages, setMessages] = useState<AssistantMessage[]>([])
  const [cloudConsent, setCloudConsent] = useState(false)
  const [cloudBusy, setCloudBusy] = useState(false)
  const [cloudError, setCloudError] = useState<string | null>(null)
  const [deletionPreview, setDeletionPreview] = useState<CandidateDeletionPreview | null>(null)
  const [deletionStatus, setDeletionStatus] = useState<'idle' | 'loading' | 'deleting'>('idle')
  const [deletionConfirmation, setDeletionConfirmation] = useState('')
  const [deletionError, setDeletionError] = useState<string | null>(null)
  const [editMode, setEditMode] = useState(false)
  const [draftIdentity, setDraftIdentity] = useState(() => ({
    displayName: candidate.localIdentity?.displayName ?? '',
    gender: candidate.localIdentity?.gender ?? '',
    birthDate: candidate.localIdentity?.birthDate ?? '',
    nationality: candidate.localIdentity?.nationality ?? '',
    phone: candidate.localIdentity?.phone ?? '',
    email: candidate.localIdentity?.email ?? '',
    address: candidate.localIdentity?.address ?? '',
    education: candidate.localIdentity?.education ?? '',
    major: candidate.localIdentity?.major ?? '',
    graduationDate: candidate.localIdentity?.graduationDate ?? '',
    degree: candidate.localIdentity?.degree ?? ''
  }))
  const [draftOwnCompany, setDraftOwnCompany] = useState<boolean | null>(candidate.isOwnCompany ?? null)
  const [draftFields, setDraftFields] = useState<Record<CandidateFieldKey, string>>(
    () => Object.fromEntries(candidate.fields.map((field) => [field.key, field.value ?? ''])) as Record<CandidateFieldKey, string>
  )
  const [draftProjects, setDraftProjects] = useState<EditableProject[]>(() =>
    candidate.projectExperiences.map((project) => ({
      id: project.id,
      title: project.title,
      period: project.period ?? '',
      role: project.role ?? '',
      technologies: project.technologies.join(', '),
      summary: project.summary
    }))
  )
  const [saveBusy, setSaveBusy] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)

  const fields = useMemo(() => new Map(candidate.fields.map((field) => [field.key, field])), [candidate.fields])
  const displayName = candidate.localIdentity?.displayName ?? candidate.anonymousLabel
  const valueFor = (key: CandidateFieldKey) => fields.get(key)?.value || t('未设置', '未設定')
  const skills = useMemo(() => {
    const rows = new Map<string, { projects: string[]; sources: number }>()
    for (const skill of splitSkills(fields.get('skills')?.value ?? null))
      rows.set(skill, { projects: [], sources: fields.get('skills')?.sourceLabels.length ?? 0 })
    for (const project of candidate.projectExperiences) {
      for (const skill of project.technologies) {
        const current = rows.get(skill) ?? { projects: [], sources: 0 }
        if (!current.projects.includes(project.title)) current.projects.push(project.title)
        current.sources += project.sourceLabels.length > 0 ? 1 : 0
        rows.set(skill, current)
      }
    }
    return [...rows.entries()]
      .map(([name, evidence]) => ({ name, ...evidence }))
      .toSorted((left, right) => right.projects.length - left.projects.length || left.name.localeCompare(right.name))
  }, [candidate.projectExperiences, fields])
  const cloudConfigured = aiCommerce?.configuration === 'ready'
  const cloudConnected = aiCommerce?.connection === 'connected'
  const cloudSendReady = Boolean(cloudConfigured && cloudConnected && cloudConsent && onSendCloudPrompt && !cloudBusy)
  const leadSkills =
    skills
      .slice(0, 6)
      .map((skill) => skill.name)
      .join('、') || t('待补充', '未設定')
  const summary = t(
    `${valueFor('experience_years')}经验的${valueFor('role')}，主要技能为${leadSkills}。档案包含${candidate.projectExperiences.length}项项目经历，可直接用于人员检索和案件匹配。`,
    `${valueFor('experience_years')}経験の${valueFor('role')}。主なスキルは${leadSkills}です。${candidate.projectExperiences.length}件のプロジェクト経験を人材検索と案件マッチングに利用できます。`
  )
  const projectsReadyToSave = draftProjects.every((project) => project.title.trim().length > 0 && project.summary.trim().length > 0)

  const resetDraft = (nextCandidate = candidate) => {
    setDraftOwnCompany(nextCandidate.isOwnCompany ?? null)
    setDraftIdentity({
      displayName: nextCandidate.localIdentity?.displayName ?? '',
      gender: nextCandidate.localIdentity?.gender ?? '',
      birthDate: nextCandidate.localIdentity?.birthDate ?? '',
      nationality: nextCandidate.localIdentity?.nationality ?? '',
      phone: nextCandidate.localIdentity?.phone ?? '',
      email: nextCandidate.localIdentity?.email ?? '',
      address: nextCandidate.localIdentity?.address ?? '',
      education: nextCandidate.localIdentity?.education ?? '',
      major: nextCandidate.localIdentity?.major ?? '',
      graduationDate: nextCandidate.localIdentity?.graduationDate ?? '',
      degree: nextCandidate.localIdentity?.degree ?? ''
    })
    setDraftFields(
      Object.fromEntries(nextCandidate.fields.map((field) => [field.key, field.value ?? ''])) as Record<CandidateFieldKey, string>
    )
    setDraftProjects(
      nextCandidate.projectExperiences.map((project) => ({
        id: project.id,
        title: project.title,
        period: project.period ?? '',
        role: project.role ?? '',
        technologies: project.technologies.join(', '),
        summary: project.summary
      }))
    )
  }

  const beginEditing = () => {
    resetDraft()
    setSaveError(null)
    setAiOpen(false)
    setEditMode(true)
  }

  const saveProfile = async () => {
    if (!projectsReadyToSave || saveBusy) return
    setSaveBusy(true)
    setSaveError(null)
    const normalize = (value: string) => value.trim() || null
    try {
      const result = await onUpdateCandidate({
        sourceDocumentId: candidate.sourceDocumentId,
        expectedVersion: candidate.version,
        isOwnCompany: draftOwnCompany,
        identity: {
          displayName: normalize(draftIdentity.displayName),
          gender: normalize(draftIdentity.gender),
          birthDate: normalize(draftIdentity.birthDate),
          nationality: normalize(draftIdentity.nationality),
          phone: normalize(draftIdentity.phone),
          email: normalize(draftIdentity.email),
          address: normalize(draftIdentity.address),
          education: normalize(draftIdentity.education),
          major: normalize(draftIdentity.major),
          graduationDate: normalize(draftIdentity.graduationDate),
          degree: normalize(draftIdentity.degree)
        },
        fields: candidate.fields.map((field) => ({ key: field.key, value: normalize(draftFields[field.key] ?? '') })),
        projectExperiences: draftProjects.map((project) => ({
          id: project.id,
          title: project.title.trim(),
          period: normalize(project.period),
          role: normalize(project.role),
          technologies: [
            ...new Set(
              project.technologies
                .split(/[,、/]/u)
                .map((item) => item.trim())
                .filter(Boolean)
            )
          ].slice(0, 40),
          summary: project.summary.trim()
        }))
      })
      resetDraft(result.candidate)
      setEditMode(false)
    } catch (cause) {
      setSaveError(localizedIpcError(locale, cause, t('无法保存人员档案。', '人材プロフィールを保存できませんでした。')))
    } finally {
      setSaveBusy(false)
    }
  }

  const askCandidate = async (rawQuestion: string) => {
    const question = rawQuestion.trim()
    if (!question) return
    const fallback = localAnswer(question, candidate, fields, locale)
    setMessages((current) => [...current, { id: messageId(), role: 'user', content: question }])
    setAiInput('')
    if (assistantMode === 'local') {
      setMessages((current) => [
        ...current,
        { id: messageId(), role: 'assistant', content: fallback.content, mode: 'local', sourceTab: fallback.sourceTab }
      ])
      return
    }
    if (!cloudSendReady || !onSendCloudPrompt) return
    setCloudBusy(true)
    setCloudError(null)
    try {
      const result = await onSendCloudPrompt({ content: createCloudPrompt(candidate, question, locale) })
      setMessages((current) => [
        ...current,
        {
          id: messageId(),
          role: 'assistant',
          content: result.content,
          mode: 'cloud',
          removedIdentifierCount: result.removedIdentifierTypes.length,
          usageCredits: result.usageCredits
        }
      ])
    } catch (cause) {
      setCloudError(localizedIpcError(locale, cause, t('无法使用云端 AI。', 'Cloud AIを利用できませんでした。')))
      setMessages((current) => [
        ...current,
        { id: messageId(), role: 'assistant', content: fallback.content, mode: 'local-fallback', sourceTab: fallback.sourceTab }
      ])
    } finally {
      setCloudBusy(false)
    }
  }

  const loadDeletionPreview = async () => {
    if (deletionStatus !== 'idle') return
    setDeletionStatus('loading')
    setDeletionError(null)
    try {
      setDeletionPreview(await onPreviewDeletion(candidate.sourceDocumentId))
    } catch (cause) {
      setDeletionError(localizedIpcError(locale, cause, t('无法确认删除影响。', '削除影響を確認できませんでした。')))
    } finally {
      setDeletionStatus('idle')
    }
  }

  const deleteCandidate = async () => {
    if (!deletionPreview || deletionConfirmation !== t('删除', '削除') || deletionStatus === 'deleting') return
    setDeletionStatus('deleting')
    setDeletionError(null)
    try {
      await onDeleteCandidate({
        sourceDocumentId: deletionPreview.sourceDocumentId,
        confirmationHash: deletionPreview.confirmationHash,
        confirmationText: '削除' // i18n-ignore: confirmation token checked by Main
      })
    } catch (cause) {
      setDeletionError(localizedIpcError(locale, cause, t('无法删除人员数据。', '要員データを削除できませんでした。')))
      setDeletionStatus('idle')
    }
  }

  const editable = (field: string, value: string | null, label: string, projectId?: string) => (
    <BusinessField
      kind="person"
      id={candidate.sourceDocumentId}
      version={candidate.version}
      field={field}
      value={value}
      label={label}
      projectId={projectId}
    />
  )
  const tabs: Array<{ id: CandidateDetailTab; label: string; count?: number }> = [
    { id: 'overview', label: t('档案总览', 'プロフィール概要') },
    { id: 'skills', label: t('技能矩阵', 'スキルマトリクス'), count: skills.length },
    { id: 'projects', label: t('项目经历', 'プロジェクト経験'), count: candidate.projectExperiences.length },
    { id: 'commercial', label: t('商务条件', '商務条件') },
    { id: 'source', label: t('原始资料', '原始資料') },
    { id: 'versions', label: t('版本历史', 'バージョン履歴'), count: versions.length }
  ]
  const selectTab = (tab: CandidateDetailTab) => {
    setActiveTab(tab)
    if (tab === 'source') setAiOpen(false)
  }

  return (
    <main
      aria-label={t('人员档案详情', '人材プロフィール詳細')}
      className={
        aiOpen && !editMode
          ? 'resume-profile-workspace candidate-detail-workspace has-ai'
          : 'resume-profile-workspace candidate-detail-workspace'
      }
    >
      <PersonnelMailUpdates documentId={candidate.sourceDocumentId} version={candidate.version} />
      <header className="resume-profile-header">
        <div className="resume-profile-identity">
          <button aria-label={t('返回人员库', '要員一覧へ戻る')} onClick={onBack} type="button">
            <Icon name="arrow-left" size={17} />
          </button>
          <span className="candidate-detail-avatar">{displayName.slice(-2)}</span>
          <div>
            <span>
              {t('人员业务列表', '要員一覧')} / {t('人员档案详情', '人材プロフィール詳細')}
            </span>
            <h1>{editable('identity.displayName', candidate.localIdentity?.displayName ?? null, t('姓名', '氏名'))}</h1>
          </div>
          <small>
            {candidate.anonymousLabel} · v{candidate.version}
          </small>
          <span className="local-identity-status">
            <Icon name="lock" size={13} />
            {t('个人信息在本机加密保存', '本人情報は端末内で暗号化')}
          </span>
          <span className="local-parse-status">
            <Icon name="check" size={13} />
            {t('具备推荐资格', '推薦資格あり')}
          </span>
        </div>
        <div className="resume-profile-actions">
          {editMode ? (
            <>
              <button
                className="profile-secondary-action"
                disabled={saveBusy}
                onClick={() => {
                  resetDraft()
                  setEditMode(false)
                  setSaveError(null)
                }}
                type="button"
              >
                {t('取消编辑', '編集をキャンセル')}
              </button>
              <button
                className="profile-primary-action"
                disabled={!projectsReadyToSave || saveBusy}
                onClick={() => void saveProfile()}
                type="button"
              >
                <Icon name="check" size={15} />
                {saveBusy ? t('正在保存…', '保存中…') : t('保存修改', '変更を保存')}
              </button>
            </>
          ) : (
            <>
              <button className="profile-secondary-action" onClick={() => selectTab('source')} type="button">
                <Icon name="file" size={15} />
                {t('查看原始资料', '原始資料を見る')}
              </button>
              <button className="profile-primary-action" onClick={beginEditing} type="button">
                <Icon name="edit" size={15} />
                {t('编辑档案', 'プロフィールを編集')}
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
            </>
          )}
        </div>
      </header>

      {editMode ? (
        <div className="candidate-profile-edit-banner">
          <Icon name="edit" size={16} />
          <div>
            <strong>{t('正在编辑人员档案', '人材プロフィールを編集中')}</strong>
            <span>
              {t(
                '姓名、联系方式、档案字段和项目经历将一起保存。',
                '姓名・連絡先・プロフィール項目・プロジェクト経験をまとめて保存します。'
              )}
            </span>
          </div>
          <em>{t('本机加密', '端末内暗号化')}</em>
        </div>
      ) : (
        <div className="candidate-detail-summary-strip">
          <div>
            <span>{t('主力岗位', '主力ポジション')}</span>
            <strong>
              {editable('role', fields.get('role')?.value ?? null, candidateFieldLabel('role', fields.get('role')?.label ?? 'role', t))}
            </strong>
          </div>
          <div>
            <span>{t('总经验', '総経験')}</span>
            <strong>
              {editable(
                'experience_years',
                fields.get('experience_years')?.value ?? null,
                fields.get('experience_years')?.label ?? 'experience_years'
              )}
            </strong>
          </div>
          <div>
            <span>{t('可入场时间', '稼働時期')}</span>
            <strong>
              {editable(
                'availability',
                fields.get('availability')?.value ?? null,
                candidateFieldLabel('availability', fields.get('availability')?.label ?? 'availability', t)
              )}
            </strong>
          </div>
          <div>
            <span>{t('期望单价', '希望単価')}</span>
            <strong>
              {editable('rate', fields.get('rate')?.value ?? null, candidateFieldLabel('rate', fields.get('rate')?.label ?? 'rate', t))}
            </strong>
          </div>
          <div>
            <span>{t('项目', 'プロジェクト')}</span>
            <strong>
              {candidate.projectExperiences.length}
              {t('项', '件')}
            </strong>
          </div>
        </div>
      )}

      {editMode ? (
        <div className="candidate-profile-edit-steps">
          <span>{t('基本信息与联系方式', '基本・連絡先')}</span>
          <span>{t('人员档案字段', '人材プロフィール項目')}</span>
          <span>{t('项目经历', 'プロジェクト経験')}</span>
        </div>
      ) : (
        <nav aria-label={t('人员档案区域', '人材プロフィールのセクション')} className="resume-profile-tabs" role="tablist">
          {tabs.map((tab) => (
            <button
              aria-selected={activeTab === tab.id}
              className={activeTab === tab.id ? 'is-active' : undefined}
              key={tab.id}
              onClick={() => selectTab(tab.id)}
              role="tab"
              type="button"
            >
              {tab.label}
              {tab.count ? <span>{tab.count}</span> : null}
            </button>
          ))}
        </nav>
      )}

      <div className="resume-profile-body">
        <section className="resume-profile-scroll" role="tabpanel">
          {editMode ? (
            <div className="candidate-profile-edit-view">
              <section>
                <header>
                  <span>{'LOCAL IDENTITY'}</span>
                  <h2>{t('基本信息与联系方式', '基本情報・連絡先')}</h2>
                  <p>
                    {t(
                      '个人信息与学历会加密并仅保存在本机，不会发送给云端 AI。',
                      '個人情報と学歴は暗号化して端末内だけに保存し、Cloud AIには送信しません。'
                    )}
                  </p>
                </header>
                <div className="candidate-profile-edit-grid">
                  <label>
                    {t('姓名', '姓名')}
                    <input
                      aria-label={t('姓名', '姓名')}
                      maxLength={120}
                      onChange={(event) => setDraftIdentity((current) => ({ ...current, displayName: event.target.value }))}
                      value={draftIdentity.displayName}
                    />
                  </label>
                  <label>
                    {t('性别', '性別')}
                    <input
                      aria-label={t('性别', '性別')}
                      maxLength={40}
                      onChange={(event) => setDraftIdentity((current) => ({ ...current, gender: event.target.value }))}
                      value={draftIdentity.gender}
                    />
                  </label>
                  <label>
                    {t('出生年月', '生年月')}
                    <input
                      aria-label={t('出生年月', '生年月')}
                      maxLength={80}
                      onChange={(event) => setDraftIdentity((current) => ({ ...current, birthDate: event.target.value }))}
                      value={draftIdentity.birthDate}
                    />
                  </label>
                  <label>
                    {t('国籍', '国籍')}
                    <input
                      aria-label={t('国籍', '国籍')}
                      maxLength={80}
                      onChange={(event) => setDraftIdentity((current) => ({ ...current, nationality: event.target.value }))}
                      value={draftIdentity.nationality}
                    />
                  </label>
                  <label>
                    {t('电话号码', '電話番号')}
                    <input
                      aria-label={t('电话号码', '電話番号')}
                      maxLength={80}
                      onChange={(event) => setDraftIdentity((current) => ({ ...current, phone: event.target.value }))}
                      value={draftIdentity.phone}
                    />
                  </label>
                  <label>
                    {t('电子邮箱', 'メールアドレス')}
                    <input
                      aria-label={t('电子邮箱', 'メールアドレス')}
                      maxLength={200}
                      onChange={(event) => setDraftIdentity((current) => ({ ...current, email: event.target.value }))}
                      value={draftIdentity.email}
                    />
                  </label>
                  <label className="is-wide">
                    {t('住址／最近车站', '住所・最寄り駅')}
                    <input
                      aria-label={t('住址／最近车站', '住所・最寄り駅')}
                      maxLength={500}
                      onChange={(event) => setDraftIdentity((current) => ({ ...current, address: event.target.value }))}
                      value={draftIdentity.address}
                    />
                  </label>
                  <label>
                    {t('学校／最高学历', '学校名・最終学歴')}
                    <input
                      aria-label={t('学校／最高学历', '学校名・最終学歴')}
                      maxLength={300}
                      onChange={(event) => setDraftIdentity((current) => ({ ...current, education: event.target.value }))}
                      value={draftIdentity.education}
                    />
                  </label>
                  <label>
                    {t('专业', '専攻')}
                    <input
                      aria-label={t('专业', '専攻')}
                      maxLength={200}
                      onChange={(event) => setDraftIdentity((current) => ({ ...current, major: event.target.value }))}
                      value={draftIdentity.major}
                    />
                  </label>
                  <label>
                    {t('毕业时间', '卒業年月')}
                    <input
                      aria-label={t('毕业时间', '卒業年月')}
                      maxLength={80}
                      onChange={(event) => setDraftIdentity((current) => ({ ...current, graduationDate: event.target.value }))}
                      value={draftIdentity.graduationDate}
                    />
                  </label>
                  <label>
                    {t('学位', '学位')}
                    <input
                      aria-label={t('学位', '学位')}
                      maxLength={120}
                      onChange={(event) => setDraftIdentity((current) => ({ ...current, degree: event.target.value }))}
                      value={draftIdentity.degree}
                    />
                  </label>
                </div>
              </section>
              <section>
                <header>
                  <span>{'STANDARD PROFILE'}</span>
                  <h2>{t('人员档案字段', '人材プロフィール項目')}</h2>
                  <p>{t('所有字段均为可选，未填写的内容可以留空保存。', 'すべて任意です。未入力の項目は空欄のまま保存できます。')}</p>
                </header>
                <div className="candidate-profile-edit-grid">
                  <label>
                    {t('是否自社', '自社所属')}
                    <select
                      aria-label={t('是否自社', '自社所属')}
                      value={draftOwnCompany === null ? '' : String(draftOwnCompany)}
                      onChange={(event) => setDraftOwnCompany(event.target.value === '' ? null : event.target.value === 'true')}
                    >
                      <option value="">{t('未设置', '未設定')}</option>
                      <option value="true">{t('自社', '自社')}</option>
                      <option value="false">{t('非自社', '非自社')}</option>
                    </select>
                  </label>
                  {candidate.fields.map((field) => (
                    <label className={field.key === 'skills' ? 'is-wide' : undefined} key={field.key}>
                      {candidateFieldLabel(field.key, field.label, t)}
                      {field.key === 'skills' ? (
                        <textarea
                          aria-label={candidateFieldLabel(field.key, field.label, t)}
                          maxLength={500}
                          onChange={(event) => setDraftFields((current) => ({ ...current, [field.key]: event.target.value }))}
                          value={draftFields[field.key] ?? ''}
                        />
                      ) : field.key === 'work_authorization' ? (
                        <select
                          aria-label={candidateFieldLabel(field.key, field.label, t)}
                          onChange={(event) => setDraftFields((current) => ({ ...current, [field.key]: event.target.value }))}
                          value={draftFields[field.key] ?? ''}
                        >
                          <option value="">{t('未设置', '未設定')}</option>
                          {candidateWorkAuthorizationValues.map((value) => (
                            <option key={value} value={value}>
                              {workAuthorizationLabel(value, t)}
                            </option>
                          ))}
                        </select>
                      ) : (
                        <input
                          aria-label={candidateFieldLabel(field.key, field.label, t)}
                          maxLength={500}
                          onChange={(event) => setDraftFields((current) => ({ ...current, [field.key]: event.target.value }))}
                          value={draftFields[field.key] ?? ''}
                        />
                      )}
                    </label>
                  ))}
                </div>
              </section>
              <section>
                <header className="candidate-profile-edit-project-heading">
                  <div>
                    <span>{'PROJECT HISTORY'}</span>
                    <h2>{t('项目经历', 'プロジェクト経験')}</h2>
                    <p>{t('填写每个项目的名称和负责内容后即可保存。', '各プロジェクトの名称と担当内容を入力すると保存できます。')}</p>
                  </div>
                  <button
                    onClick={() =>
                      setDraftProjects((current) => [
                        ...current,
                        { id: crypto.randomUUID(), title: '', period: '', role: '', technologies: '', summary: '' }
                      ])
                    }
                    type="button"
                  >
                    <Icon name="plus" size={15} />
                    {t('添加项目', 'プロジェクトを追加')}
                  </button>
                </header>
                <div className="candidate-profile-edit-projects">
                  {draftProjects.map((project, index) => (
                    <article key={project.id}>
                      <header>
                        <strong>
                          {t('项目', 'プロジェクト')} {index + 1}
                        </strong>
                        <button
                          aria-label={t(`删除项目 ${index + 1}`, `プロジェクト ${index + 1} を削除`)}
                          onClick={() => setDraftProjects((current) => current.filter((item) => item.id !== project.id))}
                          type="button"
                        >
                          {t('删除', '削除')}
                        </button>
                      </header>
                      <div className="candidate-profile-edit-grid">
                        <label>
                          {t('案件/项目名称', '案件・プロジェクト名')}
                          <input
                            aria-label={t(`项目 ${index + 1} 的名称`, `プロジェクト ${index + 1} の名称`)}
                            maxLength={160}
                            onChange={(event) =>
                              setDraftProjects((current) =>
                                current.map((item) => (item.id === project.id ? { ...item, title: event.target.value } : item))
                              )
                            }
                            value={project.title}
                          />
                        </label>
                        <label>
                          {t('期间', '期間')}
                          <input
                            aria-label={t(`项目 ${index + 1} 的期间`, `プロジェクト ${index + 1} の期間`)}
                            maxLength={120}
                            onChange={(event) =>
                              setDraftProjects((current) =>
                                current.map((item) => (item.id === project.id ? { ...item, period: event.target.value } : item))
                              )
                            }
                            value={project.period}
                          />
                        </label>
                        <label>
                          {t('角色', '役割')}
                          <input
                            aria-label={t(`项目 ${index + 1} 的角色`, `プロジェクト ${index + 1} の役割`)}
                            maxLength={120}
                            onChange={(event) =>
                              setDraftProjects((current) =>
                                current.map((item) => (item.id === project.id ? { ...item, role: event.target.value } : item))
                              )
                            }
                            value={project.role}
                          />
                        </label>
                        <label>
                          {t('技术（以逗号分隔）', '技術（カンマ区切り）')}
                          <input
                            aria-label={t(`项目 ${index + 1} 的技术`, `プロジェクト ${index + 1} の技術`)}
                            maxLength={500}
                            onChange={(event) =>
                              setDraftProjects((current) =>
                                current.map((item) => (item.id === project.id ? { ...item, technologies: event.target.value } : item))
                              )
                            }
                            value={project.technologies}
                          />
                        </label>
                        <label className="is-wide">
                          {t('负责内容', '担当内容')}
                          <textarea
                            aria-label={t(`项目 ${index + 1} 的负责内容`, `プロジェクト ${index + 1} の担当内容`)}
                            maxLength={1500}
                            onChange={(event) =>
                              setDraftProjects((current) =>
                                current.map((item) => (item.id === project.id ? { ...item, summary: event.target.value } : item))
                              )
                            }
                            value={project.summary}
                          />
                        </label>
                      </div>
                    </article>
                  ))}
                </div>
                {!projectsReadyToSave ? (
                  <p className="candidate-profile-edit-warning">
                    <Icon name="alert" size={14} />
                    {t('请填写新增项目的名称和负责内容。', '追加したプロジェクトは名称と担当内容を入力してください。')}
                  </p>
                ) : null}
              </section>
              {saveError ? (
                <div className="candidate-profile-edit-error" role="alert">
                  <Icon name="alert" size={15} />
                  {saveError}
                </div>
              ) : null}
            </div>
          ) : null}

          {!editMode && activeTab === 'overview' ? (
            <div className="profile-overview-view">
              <section className="profile-overview-section">
                <h2>{t('人员概览', '要員概要')}</h2>
                <div className="candidate-local-contact-card">
                  <div>
                    <span>{t('是否自社', '自社所属')}</span>
                    <strong>
                      {candidate.isOwnCompany === true
                        ? t('自社', '自社')
                        : candidate.isOwnCompany === false
                          ? t('非自社', '非自社')
                          : t('未设置', '未設定')}
                    </strong>
                  </div>
                  <div>
                    <span>{t('姓名', '姓名')}</span>
                    <strong>{editable('identity.displayName', candidate.localIdentity?.displayName ?? null, 'displayName')}</strong>
                  </div>
                  <div>
                    <span>{t('性别', '性別')}</span>
                    <strong>{editable('identity.gender', candidate.localIdentity?.gender ?? null, 'gender')}</strong>
                  </div>
                  <div>
                    <span>{t('出生年月', '生年月')}</span>
                    <strong>{editable('identity.birthDate', candidate.localIdentity?.birthDate ?? null, 'birthDate')}</strong>
                  </div>
                  <div>
                    <span>{t('国籍', '国籍')}</span>
                    <strong>{editable('identity.nationality', candidate.localIdentity?.nationality ?? null, 'nationality')}</strong>
                  </div>
                  <div>
                    <span>{t('电话号码', '電話番号')}</span>
                    <strong>{editable('identity.phone', candidate.localIdentity?.phone ?? null, 'phone')}</strong>
                  </div>
                  <div>
                    <span>{t('电子邮箱', 'メールアドレス')}</span>
                    <strong>{editable('identity.email', candidate.localIdentity?.email ?? null, 'email')}</strong>
                  </div>
                  <div>
                    <span>{t('住址／最近车站', '住所・最寄り駅')}</span>
                    <strong>{editable('identity.address', candidate.localIdentity?.address ?? null, 'address')}</strong>
                  </div>
                  <div>
                    <span>{t('学校／最高学历', '学校名・最終学歴')}</span>
                    <strong>{editable('identity.education', candidate.localIdentity?.education ?? null, 'education')}</strong>
                  </div>
                  <div>
                    <span>{t('专业', '専攻')}</span>
                    <strong>{editable('identity.major', candidate.localIdentity?.major ?? null, 'major')}</strong>
                  </div>
                  <div>
                    <span>{t('毕业时间', '卒業年月')}</span>
                    <strong>
                      {editable('identity.graduationDate', candidate.localIdentity?.graduationDate ?? null, 'graduationDate')}
                    </strong>
                  </div>
                  <div>
                    <span>{t('学位', '学位')}</span>
                    <strong>{editable('identity.degree', candidate.localIdentity?.degree ?? null, 'degree')}</strong>
                  </div>
                </div>
                <div className="profile-overview-facts">
                  <div>
                    <Icon name="sparkles" size={18} />
                    <span>
                      <small>{t('总经验', '総経験')}</small>
                      <strong>
                        {editable(
                          'experience_years',
                          fields.get('experience_years')?.value ?? null,
                          fields.get('experience_years')?.label ?? 'experience_years'
                        )}
                      </strong>
                    </span>
                  </div>
                  <div>
                    <Icon name="briefcase" size={18} />
                    <span>
                      <small>{t('主力岗位', '主力ポジション')}</small>
                      <strong>
                        {editable(
                          'role',
                          fields.get('role')?.value ?? null,
                          candidateFieldLabel('role', fields.get('role')?.label ?? 'role', t)
                        )}
                      </strong>
                    </span>
                  </div>
                  <div>
                    <Icon name="mail" size={18} />
                    <span>
                      <small>{t('日语能力', '日本語力')}</small>
                      <strong>
                        {editable(
                          'japanese_level',
                          fields.get('japanese_level')?.value ?? null,
                          fields.get('japanese_level')?.label ?? 'japanese_level'
                        )}
                      </strong>
                    </span>
                  </div>
                  <div>
                    <Icon name="file" size={18} />
                    <span>
                      <small>{t('项目数量', 'プロジェクト数')}</small>
                      <strong>
                        {candidate.projectExperiences.length}
                        {t('项', '件')}
                      </strong>
                    </span>
                  </div>
                  <div>
                    <Icon name="home" size={18} />
                    <span>
                      <small>{t('期望工作地点', '希望勤務地')}</small>
                      <strong>
                        {editable(
                          'location',
                          fields.get('location')?.value ?? null,
                          candidateFieldLabel('location', fields.get('location')?.label ?? 'location', t)
                        )}
                      </strong>
                    </span>
                  </div>
                  <div>
                    <Icon name="clock" size={18} />
                    <span>
                      <small>{t('可入场时间', '稼働時期')}</small>
                      <strong>
                        {editable(
                          'availability',
                          fields.get('availability')?.value ?? null,
                          fields.get('availability')?.label ?? 'availability'
                        )}
                      </strong>
                    </span>
                  </div>
                </div>
              </section>
              <section className="profile-overview-section">
                <div className="profile-section-heading">
                  <h2>{t('职业摘要', '職務要約')}</h2>
                  <button onClick={() => setAiOpen(true)} type="button">
                    {t('询问当前人员', 'この人材に質問')}
                  </button>
                </div>
                <p className="profile-career-summary">{summary}</p>
              </section>
              <section className="profile-overview-section">
                <div className="profile-section-heading">
                  <h2>{t('核心技能', '主要スキル')}</h2>
                  <button onClick={() => setActiveTab('skills')} type="button">
                    {t('打开技能矩阵', 'スキルマトリクスを開く')}
                  </button>
                </div>
                <p>{editable('skills', fields.get('skills')?.value ?? null, t('技能', 'スキル'))}</p>
                <div className="profile-skill-table" role="table">
                  <div className="profile-table-header" role="row">
                    <span>{t('技术', '技術')}</span>
                    <span>{t('相关项目', '関連プロジェクト')}</span>
                    <span>{t('来源', '出典')}</span>
                    <span>{t('状态', '状態')}</span>
                  </div>
                  {skills.slice(0, 7).map((skill) => (
                    <div key={skill.name} role="row">
                      <strong>{skill.name}</strong>
                      <span>
                        {skill.projects.length}
                        {t('项', '件')}
                      </span>
                      <span>
                        {skill.sources}
                        {t('项', '件')}
                      </span>
                      <em>{t('已入库', '登録済み')}</em>
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
                  {candidate.projectExperiences.slice(0, 4).map((project) => (
                    <div key={project.id} role="row">
                      <span>{editable('period', project.period, t('期间', '期間'), project.id)}</span>
                      <strong>{editable('title', project.title, t('案件/项目名称', '案件・プロジェクト名'), project.id)}</strong>
                      <span>{editable('role', project.role, t('角色', '役割'), project.id)}</span>
                      <p>{editable('summary', project.summary, t('负责内容', '担当内容'), project.id)}</p>
                      <span>{editable('technologies', project.technologies.join(', '), t('技术栈', '技術スタック'), project.id)}</span>
                    </div>
                  ))}
                </div>
              </section>
            </div>
          ) : null}

          {!editMode && activeTab === 'skills' ? (
            <div className="profile-detail-view">
              <header>
                <span>{'STANDARD PROFILE'}</span>
                <h2>{t('技能矩阵', 'スキルマトリクス')}</h2>
                <p>{t('将已入库技能与相关项目经历关联展示。', '登録済みの技能をプロジェクト経験と結び付けて表示します。')}</p>
              </header>
              <p>{editable('skills', fields.get('skills')?.value ?? null, t('技能', 'スキル'))}</p>
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
                    <span>{skill.projects.slice(0, 4).join('、') || t('尚未关联项目', 'プロジェクト未紐付け')}</span>
                    <span>
                      {skill.sources}
                      {t('项', '件')}
                    </span>
                    <em>{t('已入库', '登録済み')}</em>
                  </div>
                ))}
              </div>
            </div>
          ) : null}

          {!editMode && activeTab === 'projects' ? (
            <div className="profile-detail-view">
              <header>
                <span>{'PROJECT HISTORY'}</span>
                <h2>{t('项目经历', 'プロジェクト経験')}</h2>
                <p>{t('以标准格式展示期间、角色、负责内容和技术。', '期間、役割、担当内容と技術を標準形式で表示します。')}</p>
              </header>
              <div className="candidate-detail-project-list">
                {candidate.projectExperiences.map((project, index) => (
                  <article key={project.id}>
                    <header>
                      <span>PROJECT {String(index + 1).padStart(2, '0')}</span>
                      <strong>{editable('title', project.title, t('案件/项目名称', '案件・プロジェクト名'), project.id)}</strong>
                      <small>{summarizeSourceLabels(project.sourceLabels, locale, { projectIndex: index + 1 })}</small>
                    </header>
                    <dl>
                      <div>
                        <dt>{t('期间', '期間')}</dt>
                        <dd>{editable('period', project.period, t('期间', '期間'), project.id)}</dd>
                      </div>
                      <div>
                        <dt>{t('角色', '役割')}</dt>
                        <dd>{editable('role', project.role, t('角色', '役割'), project.id)}</dd>
                      </div>
                    </dl>
                    <section>
                      <span>{t('负责内容', '担当内容')}</span>
                      <p>{editable('summary', project.summary, t('负责内容', '担当内容'), project.id)}</p>
                    </section>
                    <footer>{editable('technologies', project.technologies.join(', '), t('技术栈', '技術スタック'), project.id)}</footer>
                  </article>
                ))}
                {candidate.projectExperiences.length === 0 ? (
                  <div className="candidate-detail-empty-section">
                    <Icon name="file" size={22} />
                    <p>{t('尚未登记项目经历。', 'プロジェクト経験はまだ登録されていません。')}</p>
                  </div>
                ) : null}
              </div>
            </div>
          ) : null}

          {!editMode && activeTab === 'commercial' ? (
            <div className="profile-detail-view">
              <header>
                <span>{'WORK CONDITIONS'}</span>
                <h2>{t('商务条件', '商務条件')}</h2>
                <p>{t('这些是用于案件匹配和营业判断的已登记条件。', '案件マッチングと営業判断に使う登録済み条件です。')}</p>
              </header>
              <div className="candidate-detail-field-grid">
                {commercialKeys.map((key) => {
                  const field = fields.get(key)
                  return (
                    <article key={key}>
                      <span>{candidateFieldLabel(key, field?.label ?? key, t)}</span>
                      <strong>{editable(key, field?.value ?? null, candidateFieldLabel(key, field?.label ?? key, t))}</strong>
                      <small>
                        {field?.sourceLabels.length ? summarizeSourceLabels(field.sourceLabels, locale) : t('无来源', '出典なし')}
                      </small>
                    </article>
                  )
                })}
              </div>
            </div>
          ) : null}

          {!editMode && activeTab === 'source' ? (
            <OriginalDocumentWorkspace
              candidate={candidate}
              onLoad={onLoadOriginalDocument}
              onOpen={onOpenOriginalDocument}
              onUpdate={onUpdateCandidate}
            />
          ) : null}

          {!editMode && activeTab === 'versions' ? (
            <div className="profile-detail-view candidate-detail-version-view">
              <header>
                <span>{'PROFILE HISTORY'}</span>
                <h2>{t('版本历史', 'バージョン履歴')}</h2>
                <p>{t('查看入库后的档案变更、依据和生命周期。', '入庫後のプロフィール変更、根拠とライフサイクルを確認します。')}</p>
              </header>
              {historyStatus === 'loading' ? (
                <div className="candidate-history-state">
                  <span className="matching-spinner" />
                  {t('正在读取历史…', '履歴を読み込み中…')}
                </div>
              ) : null}
              {historyStatus === 'error' ? (
                <div className="candidate-history-state is-error">
                  <Icon name="alert" size={17} />
                  {historyError}
                </div>
              ) : null}
              <div className="candidate-history-list candidate-detail-history-list">
                {versions.map((version) => (
                  <article key={version.id}>
                    <div className="candidate-history-version-heading">
                      <div>
                        <strong>Version {version.version}</strong>
                        <span>Review r{version.reviewRevision}</span>
                      </div>
                      <span className={`candidate-version-status status-${version.status}`}>
                        {version.status === 'current'
                          ? 'CURRENT'
                          : version.status === 'stale'
                            ? t('需要重新确认', '要再確認')
                            : t('已更新', '更新済み')}
                      </span>
                    </div>
                    <p>
                      {dateLabel(version.confirmedAt, locale)} · {version.confirmedBy}
                    </p>
                    <div className="candidate-history-fields">
                      {version.fields.map((field) => (
                        <div key={field.key}>
                          <span>{candidateFieldLabel(field.key, field.label, t)}</span>
                          <strong>{field.value ?? t('未填写', '未入力')}</strong>
                          <small>{summarizeSourceLabels(field.sourceLabels, locale)}</small>
                        </div>
                      ))}
                    </div>
                    <div className="candidate-history-projects">
                      <strong>
                        {t('项目经历', 'プロジェクト経験')} {version.projectExperiences.length}
                        {t('项', '件')}
                      </strong>
                      {version.projectExperiences.map((project, index) => (
                        <div key={project.id}>
                          <span>{project.title}</span>
                          <small>
                            {project.period ?? t('期间未设置', '期間未設定')} · {project.role ?? t('角色未设置', '役割未設定')} ·{' '}
                            {summarizeSourceLabels(project.sourceLabels, locale, { projectIndex: index + 1 })}
                          </small>
                        </div>
                      ))}
                    </div>
                  </article>
                ))}
              </div>
              {historyStatus === 'ready' ? (
                <section className="candidate-lifecycle-actions candidate-detail-management">
                  <div className="candidate-delete-zone">
                    <h3>{t('删除人员数据', '要員データを削除')}</h3>
                    <p>
                      {t(
                        '将删除加密原始文件、解析结果、档案历史、PII 映射表及关联任务；已导出到应用外的副本不在删除范围内。',
                        '暗号化原本ファイル、解析結果、プロフィール履歴、PII対応表と関連タスクを削除します。アプリ外へ書き出したコピーは対象外です。'
                      )}
                    </p>
                    {!deletionPreview ? (
                      <button
                        className="candidate-delete-preview-button"
                        disabled={deletionStatus === 'loading'}
                        onClick={() => void loadDeletionPreview()}
                        type="button"
                      >
                        {deletionStatus === 'loading' ? t('正在确认影响…', '影響を確認中…') : t('确认删除影响', '削除前の影響を確認')}
                      </button>
                    ) : (
                      <div className="candidate-deletion-preview">
                        <strong>{deletionPreview.anonymousLabel}</strong>
                        <span>
                          {t('本机文件', 'ローカルファイル')}：{deletionPreview.localFileName}
                        </span>
                        <ul>
                          <li>
                            Profile {deletionPreview.counts.profileVersions}
                            {t('版本', 'バージョン')}
                          </li>
                          <li>
                            {t('审计记录', '監査記録')} {deletionPreview.counts.reviewAudits}
                            {t('项', '件')}
                          </li>
                          <li>
                            {t('关联任务', '関連タスク')} {deletionPreview.counts.taskRecords}
                            {t('项', '件')}
                          </li>
                          <li>
                            {t('匹配结果与评估', 'マッチ結果・評価')} {deletionPreview.counts.matchRecords}
                            {t('项', '件')}
                          </li>
                          <li>
                            {t('加密文件', '暗号化ファイル')} {deletionPreview.counts.encryptedFiles}
                            {t('项', '件')}
                          </li>
                          <DeletionBusinessCountItems counts={deletionPreview.counts} />
                          {deletionPreview.counts.agentReferences ? (
                            <li>
                              {t(
                                `Agent 历史引用 ${deletionPreview.counts.agentReferences.conversations} 个会话 / ${deletionPreview.counts.agentReferences.messages} 条消息`,
                                `Agent履歴参照 ${deletionPreview.counts.agentReferences.conversations}会話 / ${deletionPreview.counts.agentReferences.messages}メッセージ`
                              )}
                            </li>
                          ) : null}
                        </ul>
                        <DeletionPlacementBlock kind="person" counts={deletionPreview.counts} />
                        <p>{t('请输入“删除”以继续。', '続行するには「削除」と入力してください。')}</p>
                        <input
                          aria-label={t('删除确认', '削除確認')}
                          disabled={Boolean(deletionBlockedByPlacement(deletionPreview.counts))}
                          onChange={(event) => setDeletionConfirmation(event.target.value)}
                          value={deletionConfirmation}
                        />
                        <button
                          disabled={
                            deletionConfirmation !== t('删除', '削除') ||
                            deletionStatus === 'deleting' ||
                            Boolean(deletionBlockedByPlacement(deletionPreview.counts))
                          }
                          onClick={() => void deleteCandidate()}
                          type="button"
                        >
                          {deletionStatus === 'deleting' ? t('正在删除…', '削除中…') : t('彻底删除', '完全に削除')}
                        </button>
                      </div>
                    )}
                    {deletionError ? (
                      <p className="candidate-action-error" role="alert">
                        {deletionError}
                      </p>
                    ) : null}
                  </div>
                </section>
              ) : null}
            </div>
          ) : null}
        </section>

        {!editMode && aiOpen ? (
          <aside className="candidate-ai-drawer">
            <header>
              <div>
                <h2>{t('询问当前人员', 'この人材に質問')}</h2>
                <span>{assistantMode === 'local' ? t('本地快速查询', 'ローカル高速照会') : 'AICommerce Cloud AI'}</span>
              </div>
              <button aria-label={t('关闭 AI 面板', 'AIパネルを閉じる')} onClick={() => setAiOpen(false)} type="button">
                {t('关闭', '閉じる')}
              </button>
            </header>
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
                  ? t('仅在本机查询已入库档案', '登録済みプロフィールを端末内だけで照会')
                  : t('仅向云端发送已脱敏的最少数据', '脱敏済みの最小データだけをCloudへ送信')}
              </span>
            </div>
            {assistantMode === 'cloud' ? (
              <div className={cloudConnected ? 'candidate-ai-cloud-gate is-ready' : 'candidate-ai-cloud-gate'}>
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
                t('做过哪些项目？', 'どんな案件を経験した？'),
                t('目前的商务条件是什么？', '現在の商務条件は？')
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
                  <strong>{t('立即查询完整人员档案', '詳細プロフィールをすぐに照会')}</strong>
                  <p>
                    {assistantMode === 'local'
                      ? t('仅在本机查询技能、项目经历和商务条件。', '技能、プロジェクト、商務条件を端末内だけで検索します。')
                      : t('云端 AI 会在发送前于本机脱敏个人信息。', 'Cloud AIは送信前に個人情報をローカルで脱敏します。')}
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
                    {message.sourceTab ? (
                      <div>
                        <span>{t('引用来源', '参照元')}</span>
                        <button onClick={() => setActiveTab(message.sourceTab ?? 'overview')} type="button">
                          {t('在档案中查看', 'プロフィールで確認')}
                        </button>
                      </div>
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
            {cloudError ? (
              <div className="candidate-ai-cloud-error" role="alert">
                <Icon name="alert" size={14} />
                <span>{cloudError}</span>
              </div>
            ) : null}
            <form
              className="candidate-ai-composer"
              onSubmit={(event: FormEvent) => {
                event.preventDefault()
                void askCandidate(aiInput)
              }}
            >
              <textarea
                aria-label={t('向 AI 询问当前人员', '人材についてAIに質問')}
                disabled={assistantMode === 'cloud' && !cloudSendReady}
                maxLength={500}
                onChange={(event) => setAiInput(event.target.value)}
                placeholder={t('询问能力、项目经历、条件等……', '能力、プロジェクト、条件などを質問…')}
                value={aiInput}
              />
              <button disabled={!aiInput.trim() || (assistantMode === 'cloud' && !cloudSendReady)} type="submit">
                <Icon name="chevron-right" size={18} />
                <span>{t('发送', '送信')}</span>
              </button>
            </form>
            <footer>
              <Icon name="shield" size={14} />
              {assistantMode === 'local'
                ? t('本机查询 · 不发送云端', '端末内照会・Cloud送信なし')
                : t('个人信息在发送前于本机脱敏', '個人情報は送信前にローカル脱敏')}
            </footer>
          </aside>
        ) : null}
      </div>
    </main>
  )
}
