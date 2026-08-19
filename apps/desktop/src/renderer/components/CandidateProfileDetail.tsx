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
import { localizedIpcError, useRendererUiRefresh, useUiLocale, useUiText } from '../i18n'
import { summarizeSourceLabels } from '../source-evidence'
import { Icon } from './Icon'
import { OriginalDocumentWorkspace } from './OriginalDocumentWorkspace'

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

function splitSkills(value: string | null): string[] {
  if (!value) return []
  return [...new Set(value
    .split(/[,、/・|]/u)
    .map((item) => item.trim().replace(/\s*[（(][◎○◯△×][）)]\s*$/u, ''))
    .filter((item) => item.length > 1))].slice(0, 40)
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

function createCloudPrompt(
  candidate: CandidateProfileSearchResult,
  question: string,
  locale: 'ja-JP' | 'zh-CN'
): string {
  const fields = candidate.fields.flatMap((field) => field.value
    ? [`- ${field.label}: ${compact(field.value, field.key === 'skills' ? 2_000 : 500)}`]
    : [])
  const projects = candidate.projectExperiences.slice(0, 8).map((project, index) => [
    `${index + 1}. ${compact(project.title, 180)}`,
    `   ${locale === 'zh-CN' ? '期间' : '期間'}: ${compact(project.period ?? '-', 120)}`,
    `   ${locale === 'zh-CN' ? '角色' : '役割'}: ${compact(project.role ?? '-', 120)}`,
    `   ${locale === 'zh-CN' ? '技术' : '技術'}: ${project.technologies.slice(0, 20).map((item) => compact(item, 80)).join(', ') || '-'}`,
    `   ${locale === 'zh-CN' ? '负责内容' : '担当内容'}: ${compact(project.summary)}`
  ].join('\n'))
  const anonymousId = `C-${candidate.id.replaceAll('-', '').slice(0, 8).toUpperCase()}`
  const lines = locale === 'zh-CN'
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

  if (/哪里人|出身|国籍|住所|住まい|where.*from/iu.test(question)) {
    const nationality = candidate.localIdentity?.nationality
    const address = candidate.localIdentity?.address
    const facts = [
      nationality ? `${locale === 'zh-CN' ? '国籍' : '国籍'}：${nationality}` : null,
      address ? `${locale === 'zh-CN' ? '住址／最近车站' : '住所・最寄り駅'}：${address}` : null
    ].filter(Boolean)
    return {
      content: locale === 'zh-CN'
        ? facts.length ? `本机档案登记的信息为：${facts.join('；')}。系统不会据此推测籍贯。` : '本机档案没有登记可靠的国籍或住址信息，系统不会根据姓名、语言或期望工作地点推测“哪里人”。'
        : facts.length ? `端末内プロフィールの登録情報：${facts.join('；')}。この情報から出身地は推測しません。` : '端末内プロフィールに信頼できる国籍・住所情報がなく、氏名・言語・希望勤務地から出身地を推測もしません。',
      sourceTab: 'overview'
    }
  }
  if (/项目|案件|做过|経験|project/iu.test(question)) {
    const names = candidate.projectExperiences.slice(0, 4).map((project) => project.title)
    return {
      content: locale === 'zh-CN'
        ? `档案中有 ${candidate.projectExperiences.length} 项项目经历${names.length ? `，代表项目包括：${names.join('、')}` : ''}。`
        : `プロフィールには${candidate.projectExperiences.length}件のプロジェクト経験があります${names.length ? `。代表例：${names.join('、')}` : '。'} `,
      sourceTab: 'projects'
    }
  }
  if (/入场|稼働|单价|単価|工作方式|勤務|条件|available|rate/iu.test(question)) {
    const facts = [value('availability'), value('rate'), value('work_style'), value('location')].filter(Boolean)
    return {
      content: locale === 'zh-CN'
        ? facts.length ? `当前商务条件：${facts.join('；')}。` : '档案中暂未填写可入场时间、期望单价或工作方式。'
        : facts.length ? `現在の商務条件：${facts.join('；')}。` : '稼働時期、希望単価、勤務形態はまだ登録されていません。',
      sourceTab: 'commercial'
    }
  }
  return {
    content: locale === 'zh-CN'
      ? skills.length
        ? `主要能力是 ${skills.slice(0, 6).join('、')}${role ? `，主力角色为 ${role}` : ''}${experience ? `，总经验 ${experience}` : ''}。结论基于当前人才档案和 ${candidate.projectExperiences.length} 项项目经历。`
        : '当前档案没有足够的技能信息，可以继续查看项目经历或使用云端 AI 进行综合分析。'
      : skills.length
        ? `主な能力は${skills.slice(0, 6).join('、')}${role ? `、主力ロールは${role}` : ''}${experience ? `、総経験は${experience}` : ''}です。現在のプロフィールと${candidate.projectExperiences.length}件のプロジェクト経験を根拠にしています。`
        : '現在のプロフィールには十分なスキル情報がありません。プロジェクト経験を確認するか、Cloud AIで総合分析できます。',
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
  useRendererUiRefresh()
  const locale = useUiLocale()
  const t = useUiText()
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
  const [draftFields, setDraftFields] = useState<Record<CandidateFieldKey, string>>(() =>
    Object.fromEntries(candidate.fields.map((field) => [field.key, field.value ?? ''])) as Record<CandidateFieldKey, string>
  )
  const [draftProjects, setDraftProjects] = useState<EditableProject[]>(() => candidate.projectExperiences.map((project) => ({
    id: project.id,
    title: project.title,
    period: project.period ?? '',
    role: project.role ?? '',
    technologies: project.technologies.join(', '),
    summary: project.summary
  })))
  const [saveBusy, setSaveBusy] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)

  const fields = useMemo(() => new Map(candidate.fields.map((field) => [field.key, field])), [candidate.fields])
  const displayName = candidate.localIdentity?.displayName ?? candidate.anonymousLabel
  const valueFor = (key: CandidateFieldKey) => fields.get(key)?.value || t('未設定')
  const skills = useMemo(() => {
    const rows = new Map<string, { projects: string[]; sources: number }>()
    for (const skill of splitSkills(fields.get('skills')?.value ?? null)) rows.set(skill, { projects: [], sources: fields.get('skills')?.sourceLabels.length ?? 0 })
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
  const summary = locale === 'zh-CN'
    ? `${valueFor('experience_years')}经验的${valueFor('role')}，主要技能为${skills.slice(0, 6).map((skill) => skill.name).join('、') || '待补充'}。档案包含${candidate.projectExperiences.length}项项目经历，可直接用于人才检索和案件匹配。`
    : `${valueFor('experience_years')}経験の${valueFor('role')}。主なスキルは${skills.slice(0, 6).map((skill) => skill.name).join('、') || '未設定'}です。${candidate.projectExperiences.length}件のプロジェクト経験を人材検索と案件マッチングに利用できます。`
  const projectsReadyToSave = draftProjects.every((project) => project.title.trim().length > 0 && project.summary.trim().length > 0)

  const resetDraft = (nextCandidate = candidate) => {
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
    setDraftFields(Object.fromEntries(nextCandidate.fields.map((field) => [field.key, field.value ?? ''])) as Record<CandidateFieldKey, string>)
    setDraftProjects(nextCandidate.projectExperiences.map((project) => ({
      id: project.id,
      title: project.title,
      period: project.period ?? '',
      role: project.role ?? '',
      technologies: project.technologies.join(', '),
      summary: project.summary
    })))
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
          technologies: [...new Set(project.technologies.split(/[,、/]/u).map((item) => item.trim()).filter(Boolean))].slice(0, 40),
          summary: project.summary.trim()
        }))
      })
      resetDraft(result.candidate)
      setEditMode(false)
    } catch (cause) {
      setSaveError(localizedIpcError(locale, cause, '人材プロフィールを保存できませんでした。'))
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
      setMessages((current) => [...current, { id: messageId(), role: 'assistant', content: fallback.content, mode: 'local', sourceTab: fallback.sourceTab }])
      return
    }
    if (!cloudSendReady || !onSendCloudPrompt) return
    setCloudBusy(true)
    setCloudError(null)
    try {
      const result = await onSendCloudPrompt({ content: createCloudPrompt(candidate, question, locale) })
      setMessages((current) => [...current, {
        id: messageId(),
        role: 'assistant',
        content: result.content,
        mode: 'cloud',
        removedIdentifierCount: result.removedIdentifierTypes.length,
        usageCredits: result.usageCredits
      }])
    } catch (cause) {
      setCloudError(localizedIpcError(locale, cause, 'Cloud AIを利用できませんでした。'))
      setMessages((current) => [...current, { id: messageId(), role: 'assistant', content: fallback.content, mode: 'local-fallback', sourceTab: fallback.sourceTab }])
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
      setDeletionError(cause instanceof Error ? cause.message : '削除影響を確認できませんでした。')
    } finally {
      setDeletionStatus('idle')
    }
  }

  const deleteCandidate = async () => {
    if (!deletionPreview || deletionConfirmation !== (locale === 'zh-CN' ? '删除' : '削除') || deletionStatus === 'deleting') return
    setDeletionStatus('deleting')
    setDeletionError(null)
    try {
      await onDeleteCandidate({
        sourceDocumentId: deletionPreview.sourceDocumentId,
        confirmationHash: deletionPreview.confirmationHash,
        confirmationText: '削除'
      })
    } catch (cause) {
      setDeletionError(cause instanceof Error ? cause.message : '候補者データを削除できませんでした。')
      setDeletionStatus('idle')
    }
  }

  const tabs: Array<{ id: CandidateDetailTab; label: string; count?: number }> = [
    { id: 'overview', label: t('プロフィール概要') },
    { id: 'skills', label: t('スキルマトリクス'), count: skills.length },
    { id: 'projects', label: t('プロジェクト経験'), count: candidate.projectExperiences.length },
    { id: 'commercial', label: t('商務条件') },
    { id: 'source', label: t('原始資料') },
    { id: 'versions', label: t('バージョン履歴'), count: versions.length }
  ]
  const selectTab = (tab: CandidateDetailTab) => {
    setActiveTab(tab)
    if (tab === 'source') setAiOpen(false)
  }

  return (
    <main aria-label={t('人材プロフィール詳細')} className={aiOpen && !editMode ? 'resume-profile-workspace candidate-detail-workspace has-ai' : 'resume-profile-workspace candidate-detail-workspace'}>
      <header className="resume-profile-header">
        <div className="resume-profile-identity">
          <button aria-label={t('人材プールへ戻る')} onClick={onBack} type="button"><Icon name="arrow-left" size={17} /></button>
          <span className="candidate-detail-avatar">{displayName.slice(-2)}</span>
          <div><span>{t('人材プール')} / {t('人材プロフィール詳細')}</span><h1>{displayName}</h1></div>
          <small>{candidate.anonymousLabel} · v{candidate.version}</small>
          <span className="local-identity-status"><Icon name="lock" size={13} />{t('本人情報は端末内で暗号化')}</span>
          <span className="local-parse-status"><Icon name="check" size={13} />{t('推薦資格あり')}</span>
        </div>
        <div className="resume-profile-actions">
          {editMode ? <>
            <button className="profile-secondary-action" disabled={saveBusy} onClick={() => { resetDraft(); setEditMode(false); setSaveError(null) }} type="button">{t('編集をキャンセル')}</button>
            <button className="profile-primary-action" disabled={!projectsReadyToSave || saveBusy} onClick={() => void saveProfile()} type="button"><Icon name="check" size={15} />{saveBusy ? t('保存中…') : t('変更を保存')}</button>
          </> : <>
            <button className="profile-secondary-action" onClick={() => selectTab('source')} type="button"><Icon name="file" size={15} />{t('原始資料を見る')}</button>
            <button className="profile-primary-action" onClick={beginEditing} type="button"><Icon name="edit" size={15} />{t('プロフィールを編集')}</button>
            <button aria-expanded={aiOpen} className={aiOpen ? 'profile-ai-toggle is-active' : 'profile-ai-toggle'} onClick={() => setAiOpen((current) => !current)} type="button"><Icon name="sparkles" size={15} />{t('AIに質問')}</button>
          </>}
        </div>
      </header>

      {editMode ? <div className="candidate-profile-edit-banner"><Icon name="edit" size={16} /><div><strong>{t('人材プロフィールを編集中')}</strong><span>{t('姓名・連絡先・プロフィール項目・プロジェクト経験をまとめて保存します。')}</span></div><em>{t('端末内暗号化')}</em></div> : <div className="candidate-detail-summary-strip">
        <div><span>{t('主力ポジション')}</span><strong>{valueFor('role')}</strong></div>
        <div><span>{t('総経験')}</span><strong>{valueFor('experience_years')}</strong></div>
        <div><span>{t('稼働時期')}</span><strong>{valueFor('availability')}</strong></div>
        <div><span>{t('希望単価')}</span><strong>{valueFor('rate')}</strong></div>
        <div><span>{t('プロジェクト')}</span><strong>{candidate.projectExperiences.length}{t('件')}</strong></div>
      </div>}

      {editMode ? <div className="candidate-profile-edit-steps"><span>{t('基本・連絡先')}</span><span>{t('人材プロフィール項目')}</span><span>{t('プロジェクト経験')}</span></div> : <nav aria-label={t('人材プロフィールのセクション')} className="resume-profile-tabs" role="tablist">
        {tabs.map((tab) => <button aria-selected={activeTab === tab.id} className={activeTab === tab.id ? 'is-active' : undefined} key={tab.id} onClick={() => selectTab(tab.id)} role="tab" type="button">{tab.label}{tab.count ? <span>{tab.count}</span> : null}</button>)}
      </nav>}

      <div className="resume-profile-body">
        <section className="resume-profile-scroll" role="tabpanel">
          {editMode ? <div className="candidate-profile-edit-view">
            <section>
              <header><span>{t('LOCAL IDENTITY')}</span><h2>{t('基本情報・連絡先')}</h2><p>{t('個人情報と学歴は暗号化して端末内だけに保存し、Cloud AIには送信しません。')}</p></header>
              <div className="candidate-profile-edit-grid">
                <label>{t('姓名')}<input aria-label={t('姓名')} maxLength={120} onChange={(event) => setDraftIdentity((current) => ({ ...current, displayName: event.target.value }))} value={draftIdentity.displayName} /></label>
                <label>{t('性別')}<input aria-label={t('性別')} maxLength={40} onChange={(event) => setDraftIdentity((current) => ({ ...current, gender: event.target.value }))} value={draftIdentity.gender} /></label>
                <label>{t('生年月')}<input aria-label={t('生年月')} maxLength={80} onChange={(event) => setDraftIdentity((current) => ({ ...current, birthDate: event.target.value }))} value={draftIdentity.birthDate} /></label>
                <label>{t('国籍')}<input aria-label={t('国籍')} maxLength={80} onChange={(event) => setDraftIdentity((current) => ({ ...current, nationality: event.target.value }))} value={draftIdentity.nationality} /></label>
                <label>{t('電話番号')}<input aria-label={t('電話番号')} maxLength={80} onChange={(event) => setDraftIdentity((current) => ({ ...current, phone: event.target.value }))} value={draftIdentity.phone} /></label>
                <label>{t('メールアドレス')}<input aria-label={t('メールアドレス')} maxLength={200} onChange={(event) => setDraftIdentity((current) => ({ ...current, email: event.target.value }))} value={draftIdentity.email} /></label>
                <label className="is-wide">{t('住所・最寄り駅')}<input aria-label={t('住所・最寄り駅')} maxLength={500} onChange={(event) => setDraftIdentity((current) => ({ ...current, address: event.target.value }))} value={draftIdentity.address} /></label>
                <label>{t('学校名・最終学歴')}<input aria-label={t('学校名・最終学歴')} maxLength={300} onChange={(event) => setDraftIdentity((current) => ({ ...current, education: event.target.value }))} value={draftIdentity.education} /></label>
                <label>{t('専攻')}<input aria-label={t('専攻')} maxLength={200} onChange={(event) => setDraftIdentity((current) => ({ ...current, major: event.target.value }))} value={draftIdentity.major} /></label>
                <label>{t('卒業年月')}<input aria-label={t('卒業年月')} maxLength={80} onChange={(event) => setDraftIdentity((current) => ({ ...current, graduationDate: event.target.value }))} value={draftIdentity.graduationDate} /></label>
                <label>{t('学位')}<input aria-label={t('学位')} maxLength={120} onChange={(event) => setDraftIdentity((current) => ({ ...current, degree: event.target.value }))} value={draftIdentity.degree} /></label>
              </div>
            </section>
            <section>
              <header><span>{t('STANDARD PROFILE')}</span><h2>{t('人材プロフィール項目')}</h2><p>{t('すべて任意です。未入力の項目は空欄のまま保存できます。')}</p></header>
              <div className="candidate-profile-edit-grid">
                {candidate.fields.map((field) => <label className={field.key === 'skills' ? 'is-wide' : undefined} key={field.key}>{t(field.label)}{field.key === 'skills'
                  ? <textarea aria-label={t(field.label)} maxLength={500} onChange={(event) => setDraftFields((current) => ({ ...current, [field.key]: event.target.value }))} value={draftFields[field.key] ?? ''} />
                  : field.key === 'work_authorization'
                    ? <select aria-label={t(field.label)} onChange={(event) => setDraftFields((current) => ({ ...current, [field.key]: event.target.value }))} value={draftFields[field.key] ?? ''}><option value="">{t('未設定')}</option>{candidateWorkAuthorizationValues.map((value) => <option key={value} value={value}>{t(value)}</option>)}</select>
                    : <input aria-label={t(field.label)} maxLength={500} onChange={(event) => setDraftFields((current) => ({ ...current, [field.key]: event.target.value }))} value={draftFields[field.key] ?? ''} />}</label>)}
              </div>
            </section>
            <section>
              <header className="candidate-profile-edit-project-heading"><div><span>{t('PROJECT HISTORY')}</span><h2>{t('プロジェクト経験')}</h2><p>{t('各プロジェクトの名称と担当内容を入力すると保存できます。')}</p></div><button onClick={() => setDraftProjects((current) => [...current, { id: crypto.randomUUID(), title: '', period: '', role: '', technologies: '', summary: '' }])} type="button"><Icon name="plus" size={15} />{t('プロジェクトを追加')}</button></header>
              <div className="candidate-profile-edit-projects">
                {draftProjects.map((project, index) => <article key={project.id}>
                  <header><strong>{t('プロジェクト')} {index + 1}</strong><button aria-label={`${t('プロジェクト')} ${index + 1} ${t('を削除')}`} onClick={() => setDraftProjects((current) => current.filter((item) => item.id !== project.id))} type="button">{t('削除')}</button></header>
                  <div className="candidate-profile-edit-grid">
                    <label>{t('案件・プロジェクト名')}<input aria-label={`${t('プロジェクト')} ${index + 1} ${t('の名称')}`} maxLength={160} onChange={(event) => setDraftProjects((current) => current.map((item) => item.id === project.id ? { ...item, title: event.target.value } : item))} value={project.title} /></label>
                    <label>{t('期間')}<input aria-label={`${t('プロジェクト')} ${index + 1} ${t('の期間')}`} maxLength={120} onChange={(event) => setDraftProjects((current) => current.map((item) => item.id === project.id ? { ...item, period: event.target.value } : item))} value={project.period} /></label>
                    <label>{t('役割')}<input aria-label={`${t('プロジェクト')} ${index + 1} ${t('の役割')}`} maxLength={120} onChange={(event) => setDraftProjects((current) => current.map((item) => item.id === project.id ? { ...item, role: event.target.value } : item))} value={project.role} /></label>
                    <label>{t('技術（カンマ区切り）')}<input aria-label={`${t('プロジェクト')} ${index + 1} ${t('の技術')}`} maxLength={500} onChange={(event) => setDraftProjects((current) => current.map((item) => item.id === project.id ? { ...item, technologies: event.target.value } : item))} value={project.technologies} /></label>
                    <label className="is-wide">{t('担当内容')}<textarea aria-label={`${t('プロジェクト')} ${index + 1} ${t('の担当内容')}`} maxLength={1500} onChange={(event) => setDraftProjects((current) => current.map((item) => item.id === project.id ? { ...item, summary: event.target.value } : item))} value={project.summary} /></label>
                  </div>
                </article>)}
              </div>
              {!projectsReadyToSave ? <p className="candidate-profile-edit-warning"><Icon name="alert" size={14} />{t('追加したプロジェクトは名称と担当内容を入力してください。')}</p> : null}
            </section>
            {saveError ? <div className="candidate-profile-edit-error" role="alert"><Icon name="alert" size={15} />{saveError}</div> : null}
          </div> : null}

          {!editMode && activeTab === 'overview' ? <div className="profile-overview-view">
            <section className="profile-overview-section">
              <h2>{t('候補者概要')}</h2>
              <div className="candidate-local-contact-card">
                <div><span>{t('姓名')}</span><strong>{candidate.localIdentity?.displayName || t('未設定')}</strong></div>
                <div><span>{t('性別')}</span><strong>{candidate.localIdentity?.gender || t('未設定')}</strong></div>
                <div><span>{t('生年月')}</span><strong>{candidate.localIdentity?.birthDate || t('未設定')}</strong></div>
                <div><span>{t('国籍')}</span><strong>{candidate.localIdentity?.nationality || t('未設定')}</strong></div>
                <div><span>{t('電話番号')}</span><strong>{candidate.localIdentity?.phone || t('未設定')}</strong></div>
                <div><span>{t('メールアドレス')}</span><strong>{candidate.localIdentity?.email || t('未設定')}</strong></div>
                <div><span>{t('住所・最寄り駅')}</span><strong>{candidate.localIdentity?.address || t('未設定')}</strong></div>
                <div><span>{t('学校名・最終学歴')}</span><strong>{candidate.localIdentity?.education || t('未設定')}</strong></div>
                <div><span>{t('専攻')}</span><strong>{candidate.localIdentity?.major || t('未設定')}</strong></div>
                <div><span>{t('卒業年月')}</span><strong>{candidate.localIdentity?.graduationDate || t('未設定')}</strong></div>
                <div><span>{t('学位')}</span><strong>{candidate.localIdentity?.degree || t('未設定')}</strong></div>
              </div>
              <div className="profile-overview-facts">
                <div><Icon name="sparkles" size={18} /><span><small>{t('総経験')}</small><strong>{valueFor('experience_years')}</strong></span></div>
                <div><Icon name="briefcase" size={18} /><span><small>{t('主力ポジション')}</small><strong>{valueFor('role')}</strong></span></div>
                <div><Icon name="mail" size={18} /><span><small>{t('日本語力')}</small><strong>{valueFor('japanese_level')}</strong></span></div>
                <div><Icon name="file" size={18} /><span><small>{t('プロジェクト数')}</small><strong>{candidate.projectExperiences.length}{t('件')}</strong></span></div>
                <div><Icon name="home" size={18} /><span><small>{t('希望勤務地')}</small><strong>{valueFor('location')}</strong></span></div>
                <div><Icon name="clock" size={18} /><span><small>{t('稼働時期')}</small><strong>{valueFor('availability')}</strong></span></div>
              </div>
            </section>
            <section className="profile-overview-section">
              <div className="profile-section-heading"><h2>{t('職務要約')}</h2><button onClick={() => setAiOpen(true)} type="button">{t('この人材に質問')}</button></div>
              <p className="profile-career-summary">{summary}</p>
            </section>
            <section className="profile-overview-section">
              <div className="profile-section-heading"><h2>{t('主要スキル')}</h2><button onClick={() => setActiveTab('skills')} type="button">{t('スキルマトリクスを開く')}</button></div>
              <div className="profile-skill-table" role="table">
                <div className="profile-table-header" role="row"><span>{t('技術')}</span><span>{t('関連プロジェクト')}</span><span>{t('出典')}</span><span>{t('状態')}</span></div>
                {skills.slice(0, 7).map((skill) => <div key={skill.name} role="row"><strong>{skill.name}</strong><span>{skill.projects.length}{t('件')}</span><span>{skill.sources}{t('件')}</span><em>{t('登録済み')}</em></div>)}
                {skills.length === 0 ? <p>{t('スキルはまだ検出されていません。')}</p> : null}
              </div>
            </section>
            <section className="profile-overview-section">
              <div className="profile-section-heading"><h2>{t('最近のプロジェクト経験')}</h2><button onClick={() => setActiveTab('projects')} type="button">{t('すべてのプロジェクトを見る')}</button></div>
              <div className="profile-project-table" role="table">
                <div className="profile-project-header" role="row"><span>{t('期間')}</span><span>{t('プロジェクト概要')}</span><span>{t('役割')}</span><span>{t('担当内容')}</span><span>{t('技術スタック')}</span></div>
                {candidate.projectExperiences.slice(0, 4).map((project) => <div key={project.id} role="row"><span>{project.period ?? t('未設定')}</span><strong>{project.title}</strong><span>{project.role ?? t('未設定')}</span><p>{project.summary}</p><span>{project.technologies.slice(0, 6).join(' · ') || t('未設定')}</span></div>)}
              </div>
            </section>
          </div> : null}

          {!editMode && activeTab === 'skills' ? <div className="profile-detail-view">
            <header><span>{t('STANDARD PROFILE')}</span><h2>{t('スキルマトリクス')}</h2><p>{t('登録済みの技能をプロジェクト経験と結び付けて表示します。')}</p></header>
            <div className="profile-skill-table is-expanded" role="table">
              <div className="profile-table-header" role="row"><span>{t('技術')}</span><span>{t('関連プロジェクト')}</span><span>{t('出典')}</span><span>{t('状態')}</span></div>
              {skills.map((skill) => <div key={skill.name} role="row"><strong>{skill.name}</strong><span>{skill.projects.slice(0, 4).join('、') || t('プロジェクト未紐付け')}</span><span>{skill.sources}{t('件')}</span><em>{t('登録済み')}</em></div>)}
            </div>
          </div> : null}

          {!editMode && activeTab === 'projects' ? <div className="profile-detail-view">
            <header><span>{t('PROJECT HISTORY')}</span><h2>{t('プロジェクト経験')}</h2><p>{t('期間、役割、担当内容と技術を標準形式で表示します。')}</p></header>
            <div className="candidate-detail-project-list">
              {candidate.projectExperiences.map((project, index) => <article key={project.id}>
                <header><span>PROJECT {String(index + 1).padStart(2, '0')}</span><strong>{project.title}</strong><small>{summarizeSourceLabels(project.sourceLabels, locale, { projectIndex: index + 1 })}</small></header>
                <dl><div><dt>{t('期間')}</dt><dd>{project.period ?? t('未設定')}</dd></div><div><dt>{t('役割')}</dt><dd>{project.role ?? t('未設定')}</dd></div></dl>
                <section><span>{t('担当内容')}</span><p>{project.summary || t('未設定')}</p></section>
                <footer>{project.technologies.map((technology) => <span key={technology}>{technology}</span>)}</footer>
              </article>)}
              {candidate.projectExperiences.length === 0 ? <div className="candidate-detail-empty-section"><Icon name="file" size={22} /><p>{t('プロジェクト経験はまだ登録されていません。')}</p></div> : null}
            </div>
          </div> : null}

          {!editMode && activeTab === 'commercial' ? <div className="profile-detail-view">
            <header><span>{t('WORK CONDITIONS')}</span><h2>{t('商務条件')}</h2><p>{t('案件マッチングと営業判断に使う登録済み条件です。')}</p></header>
            <div className="candidate-detail-field-grid">{commercialKeys.map((key) => {
              const field = fields.get(key)
              return <article key={key}><span>{t(field?.label ?? key)}</span><strong>{field?.value || t('未設定')}</strong><small>{field?.sourceLabels.length ? summarizeSourceLabels(field.sourceLabels, locale) : t('出典なし')}</small></article>
            })}</div>
          </div> : null}

          {!editMode && activeTab === 'source' ? <OriginalDocumentWorkspace candidate={candidate} onLoad={onLoadOriginalDocument} onOpen={onOpenOriginalDocument} onUpdate={onUpdateCandidate} /> : null}

          {!editMode && activeTab === 'versions' ? <div className="profile-detail-view candidate-detail-version-view">
            <header><span>{t('PROFILE HISTORY')}</span><h2>{t('バージョン履歴')}</h2><p>{t('入庫後のプロフィール変更、根拠とライフサイクルを確認します。')}</p></header>
            {historyStatus === 'loading' ? <div className="candidate-history-state"><span className="matching-spinner" />{t('履歴を読み込み中…')}</div> : null}
            {historyStatus === 'error' ? <div className="candidate-history-state is-error"><Icon name="alert" size={17} />{historyError}</div> : null}
            <div className="candidate-history-list candidate-detail-history-list">{versions.map((version) => <article key={version.id}><div className="candidate-history-version-heading"><div><strong>Version {version.version}</strong><span>Review r{version.reviewRevision}</span></div><span className={`candidate-version-status status-${version.status}`}>{version.status === 'current' ? 'CURRENT' : version.status === 'stale' ? t('要再確認') : t('更新済み')}</span></div><p>{dateLabel(version.confirmedAt, locale)} · {version.confirmedBy}</p><div className="candidate-history-fields">{version.fields.map((field) => <div key={field.key}><span>{t(field.label)}</span><strong>{field.value ?? t('未入力')}</strong><small>{summarizeSourceLabels(field.sourceLabels, locale)}</small></div>)}</div><div className="candidate-history-projects"><strong>{t('プロジェクト経験')} {version.projectExperiences.length}{t('件')}</strong>{version.projectExperiences.map((project, index) => <div key={project.id}><span>{project.title}</span><small>{project.period ?? t('期間未設定')} · {project.role ?? t('役割未設定')} · {summarizeSourceLabels(project.sourceLabels, locale, { projectIndex: index + 1 })}</small></div>)}</div></article>)}</div>
            {historyStatus === 'ready' ? <section className="candidate-lifecycle-actions candidate-detail-management">
              <div className="candidate-delete-zone"><h3>{t('候補者データを削除')}</h3><p>{t('暗号化原本ファイル、解析結果、プロフィール履歴、PII対応表と関連タスクを削除します。アプリ外へ書き出したコピーは対象外です。')}</p>
                {!deletionPreview ? <button className="candidate-delete-preview-button" disabled={deletionStatus === 'loading'} onClick={() => void loadDeletionPreview()} type="button">{deletionStatus === 'loading' ? t('影響を確認中…') : t('削除前の影響を確認')}</button> : <div className="candidate-deletion-preview"><strong>{deletionPreview.anonymousLabel}</strong><span>{t('ローカルファイル')}：{deletionPreview.localFileName}</span><ul><li>Profile {deletionPreview.counts.profileVersions}{t('バージョン')}</li><li>{t('監査記録')} {deletionPreview.counts.reviewAudits}{t('件')}</li><li>{t('関連タスク')} {deletionPreview.counts.taskRecords}{t('件')}</li><li>{t('マッチ結果・評価')} {deletionPreview.counts.matchRecords}{t('件')}</li><li>{t('暗号化ファイル')} {deletionPreview.counts.encryptedFiles}{t('件')}</li>{deletionPreview.counts.agentReferences ? <li>Agent履歴参照 {deletionPreview.counts.agentReferences.conversations}会話 / {deletionPreview.counts.agentReferences.messages}メッセージ</li> : null}</ul><p>{t('続行するには「削除」と入力してください。')}</p><input aria-label={t('削除確認')} onChange={(event) => setDeletionConfirmation(event.target.value)} value={deletionConfirmation} /><button disabled={deletionConfirmation !== (locale === 'zh-CN' ? '删除' : '削除') || deletionStatus === 'deleting'} onClick={() => void deleteCandidate()} type="button">{deletionStatus === 'deleting' ? t('削除中…') : t('完全に削除')}</button></div>}
                {deletionError ? <p className="candidate-action-error" role="alert">{deletionError}</p> : null}
              </div>
            </section> : null}
          </div> : null}
        </section>

        {!editMode && aiOpen ? <aside className="candidate-ai-drawer">
          <header><div><h2>{t('この人材に質問')}</h2><span>{assistantMode === 'local' ? t('ローカル高速照会') : t('AICommerce Cloud AI')}</span></div><button aria-label={t('AIパネルを閉じる')} onClick={() => setAiOpen(false)} type="button">{t('閉じる')}</button></header>
          <div aria-label={t('AI回答モード')} className="candidate-ai-mode-switch" role="group"><button aria-pressed={assistantMode === 'local'} className={assistantMode === 'local' ? 'is-active' : undefined} onClick={() => { setAssistantMode('local'); setCloudError(null) }} type="button"><Icon name="database" size={14} />{t('ローカル高速照会')}</button><button aria-pressed={assistantMode === 'cloud'} className={assistantMode === 'cloud' ? 'is-active is-cloud' : undefined} onClick={() => { setAssistantMode('cloud'); setCloudError(null) }} type="button"><Icon name="sparkles" size={14} />{t('Cloud AI分析')}</button></div>
          <div className={assistantMode === 'cloud' ? 'candidate-ai-scope is-cloud' : 'candidate-ai-scope'}><Icon name={assistantMode === 'local' ? 'database' : 'shield'} size={14} /><span>{assistantMode === 'local' ? t('登録済みプロフィールを端末内だけで照会') : t('脱敏済みの最小データだけをCloudへ送信')}</span></div>
          {assistantMode === 'cloud' ? <div className={cloudConnected ? 'candidate-ai-cloud-gate is-ready' : 'candidate-ai-cloud-gate'}>{!cloudConfigured ? <><strong>{t('Cloud AIの配布設定が必要です')}</strong><p>{t('設定でAICommerce接続を確認してください。')}</p><button onClick={onOpenCloudSettings} type="button">{t('Cloud AI設定を開く')}</button></> : !cloudConnected ? <><strong>{t('Cloud AIは未接続です')}</strong><p>{t('Member CenterへサインインするとCloud強化を利用できます。')}</p><button onClick={onOpenCloudSettings} type="button">{t('接続と利用状況を開く')}</button></> : <label><input checked={cloudConsent} onChange={(event) => setCloudConsent(event.target.checked)} type="checkbox" /><span><strong>{t('脱敏後の匿名プロフィール送信を確認')}</strong><small>{t('姓名・電話・メール・詳細住所・原文は送信しません。応答も端末内で再検査します。')}</small></span></label>}</div> : null}
          <div className="candidate-ai-prompts">{[t('主な強みは？'), t('どんな案件を経験した？'), t('現在の商務条件は？')].map((question) => <button disabled={assistantMode === 'cloud' && !cloudSendReady} key={question} onClick={() => void askCandidate(question)} type="button">{question}</button>)}</div>
          <div aria-live="polite" className="candidate-ai-messages">{messages.length === 0 ? <div className="candidate-ai-empty"><Icon name={assistantMode === 'local' ? 'database' : 'sparkles'} size={22} /><strong>{t('詳細プロフィールをすぐに照会')}</strong><p>{assistantMode === 'local' ? t('技能、プロジェクト、商務条件を端末内だけで検索します。') : t('Cloud AIは送信前に個人情報をローカルで脱敏します。')}</p></div> : messages.map((message) => <article className={`candidate-ai-message is-${message.role}`} key={message.id}>{message.role === 'assistant' && message.mode ? <span className={`candidate-ai-answer-mode is-${message.mode}`}>{message.mode === 'cloud' ? t('Cloud AI・脱敏済み') : message.mode === 'local-fallback' ? t('Cloud不可・ローカル照会へフォールバック') : t('ローカルデータ照会')}</span> : null}<p>{message.content}</p>{message.sourceTab ? <div><span>{t('参照元')}</span><button onClick={() => setActiveTab(message.sourceTab ?? 'overview')} type="button">{t('プロフィールで確認')}</button></div> : null}{message.mode === 'cloud' ? <small className="candidate-ai-cloud-meta">{message.removedIdentifierCount ? `${message.removedIdentifierCount}${t('件を送信前に置換')} · ` : ''}{message.usageCredits === null ? t('利用量は未提供') : `${message.usageCredits ?? 0} credits`}</small> : null}</article>)}{cloudBusy ? <div className="candidate-ai-loading"><i /><span>{t('Cloud AIが脱敏済みプロフィールを分析中…')}</span></div> : null}</div>
          {cloudError ? <div className="candidate-ai-cloud-error" role="alert"><Icon name="alert" size={14} /><span>{cloudError}</span></div> : null}
          <form className="candidate-ai-composer" onSubmit={(event: FormEvent) => { event.preventDefault(); void askCandidate(aiInput) }}><textarea aria-label={t('人材についてAIに質問')} disabled={assistantMode === 'cloud' && !cloudSendReady} maxLength={500} onChange={(event) => setAiInput(event.target.value)} placeholder={t('能力、プロジェクト、条件などを質問…')} value={aiInput} /><button disabled={!aiInput.trim() || (assistantMode === 'cloud' && !cloudSendReady)} type="submit"><Icon name="chevron-right" size={18} /><span>{t('送信')}</span></button></form>
          <footer><Icon name="shield" size={14} />{assistantMode === 'local' ? t('端末内照会・Cloud送信なし') : t('個人情報は送信前にローカル脱敏')}</footer>
        </aside> : null}
      </div>
    </main>
  )
}
