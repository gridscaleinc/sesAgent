import { useEffect, useMemo, useState, type FormEvent } from 'react'
import type {
  PrepareAiCommerceCloudPromptInput,
  AiCommerceCloudPromptResult,
  AiCommerceMembershipState,
  AiConversationMessage,
  AiConversationSnapshot,
  CandidateFieldKey,
  CandidateInterviewQuestion,
  CandidateInterviewSnapshot,
  CandidateReviewSnapshot
} from '@shared'
import { localizedIpcError, useRendererUiRefresh, useUiLocale } from '../i18n'
import { extractInterviewQuestions } from '../interview-question-parser'
import { AiConversationHistoryPanel } from './AiConversationHistoryPanel'
import { Icon } from './Icon'
import { useAiConversationHistory } from './useAiConversationHistory'

export type InterviewAssistantPhase = 'schedule' | 'prepare' | 'record' | 'decision'
export type InterviewAssistantSource = 'profile' | 'projects' | 'interview' | 'case'

type AssistantMode = 'local' | 'cloud'
type AssistantAction = 'questions' | 'notes' | 'decision'

interface QuickPrompt {
  id: string
  label: string
  question: string
  action?: AssistantAction
}

interface InterviewAiAssistantProps {
  candidate: CandidateReviewSnapshot
  interview: CandidateInterviewSnapshot | null
  kind: CandidateInterviewSnapshot['kind']
  phase: InterviewAssistantPhase
  goal: string
  questions: CandidateInterviewQuestion[]
  notes: string
  unresolvedItems: string[]
  aiCommerce?: AiCommerceMembershipState
  cloudConsentGranted: boolean
  onClose(): void
  onCloudConsentChange(granted: boolean): void
  onOpenCloudSettings?(): void
  onOpenSource(source: InterviewAssistantSource): void
  onAddQuestions(questions: string[]): void
  onAppendNotes(content: string): void
  onUseDecisionDraft(content: string): void
  onSendCloudPrompt?(input: PrepareAiCommerceCloudPromptInput): Promise<AiCommerceCloudPromptResult>
}

const cloudFieldKeys: CandidateFieldKey[] = [
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

function fieldValue(review: CandidateReviewSnapshot, key: CandidateFieldKey): string | null {
  return review.fields.find((field) => field.key === key)?.value ?? null
}

function splitSkills(value: string | null): string[] {
  if (!value) return []
  return [...new Set(value.split(/[,、/\n]/u).map((item) => item.trim()).filter(Boolean))].slice(0, 12)
}

function compact(value: string | null | undefined, limit = 700): string {
  return (value ?? '').replace(/\s+/gu, ' ').trim().slice(0, limit)
}

function messageId(): string {
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`
}

function anonymousCandidateId(documentId: string): string {
  return `C-${documentId.replaceAll('-', '').slice(0, 8).toUpperCase()}`
}

function phaseLabel(phase: InterviewAssistantPhase, zh: boolean): string {
  if (phase === 'schedule') return zh ? '预约' : '予約'
  if (phase === 'prepare') return zh ? '面试准备' : '面談準備'
  if (phase === 'record') return zh ? '面试辅助' : '面談支援'
  return zh ? '面试总结' : '面談まとめ'
}

function quickPrompts(kind: CandidateInterviewSnapshot['kind'], phase: InterviewAssistantPhase, zh: boolean): QuickPrompt[] {
  if (phase === 'prepare') return kind === 'client'
    ? [
        { id: 'match', label: zh ? '案件匹配点' : '案件との適合点', question: zh ? '分析这个人与当前案件最匹配的经历，以及客户可能追问的缺口。' : 'この候補者と現在案件の適合経験、および顧客が確認しそうな不足点を分析してください。' },
        { id: 'questions', label: zh ? '生成客户面试问题' : '顧客面談質問を生成', question: zh ? '结合候选人档案和本轮客户面试上下文，生成8个有针对性的问题，每行一个。' : '候補者プロフィールと今回の顧客面談コンテキストから、具体的な質問を8件、1行ずつ生成してください。', action: 'questions' },
        { id: 'pitch', label: zh ? '整理候选人卖点' : '候補者の訴求点', question: zh ? '整理向客户介绍这个候选人时可以使用的事实性卖点，不要夸大。' : '顧客へ候補者を紹介する際の事実に基づく訴求点を、誇張せず整理してください。' }
      ]
    : [
        { id: 'strengths', label: zh ? '主要能力与风险' : '主な能力と懸念', question: zh ? '总结候选人的主要能力、简历风险和本轮必须确认的事项。' : '候補者の主な能力、履歴書上の懸念、今回必ず確認する事項をまとめてください。' },
        { id: 'questions', label: zh ? '生成面试问题' : '面談質問を生成', question: zh ? '结合候选人简历、公司固定题和本轮目标，生成8个有针对性的面试问题，每行一个。' : '候補者の履歴書、会社固定質問、今回目標を踏まえ、具体的な面談質問を8件、1行ずつ生成してください。', action: 'questions' },
        { id: 'verify', label: zh ? '找出需要核实的地方' : '確認すべき点を抽出', question: zh ? '找出简历中需要面试核实的经历、职责深度和时间线问题。' : '履歴書から面談で確認すべき経験、担当の深さ、時系列上の論点を抽出してください。' }
      ]
  if (phase === 'record') return [
    { id: 'followup', label: zh ? '建议下一步追问' : '次の深掘り質問', question: zh ? '根据本轮问题、当前面试记录和待确认事项，建议接下来最有价值的3个追问。' : '今回の質問、現在の面談記録、未確認事項から、次に聞く価値が高い深掘り質問を3件提案してください。' },
    { id: 'facts', label: zh ? '核对简历事实' : '履歴書の事実確認', question: zh ? '对照候选人档案，指出当前面试记录中哪些内容有简历依据，哪些仍需要确认。' : '候補者プロフィールと照合し、現在の面談記録で根拠がある点と、まだ確認が必要な点を分けてください。' },
    { id: 'summary', label: zh ? '整理面试记录' : '面談記録を整理', question: zh ? '把当前面试记录整理成简洁、客观、可追溯的结构化记录，不要替员工下结论。' : '現在の面談記録を、簡潔で客観的かつ根拠を追える形に整理してください。採否判断はしないでください。', action: 'notes' }
  ]
  if (phase === 'decision') return kind === 'client'
    ? [
        { id: 'decision', label: zh ? '整理客户面试结论' : '顧客面談結論を整理', question: zh ? '根据面试事实和客户反馈，整理优势、风险、未确认事项和建议后续行动。最终决定由员工做出。' : '面談事実と顧客フィードバックから、強み、懸念、未確認事項、次の行動案を整理してください。最終判断は担当者が行います。', action: 'decision' },
        { id: 'next', label: zh ? '判断是否需要客户复试' : '顧客再面談の必要性', question: zh ? '分析哪些信息尚不足以形成客户面试结论，以及是否值得安排客户复试。' : '顧客面談の結論に不足する情報と、顧客再面談を設定する価値があるかを分析してください。' },
        { id: 'entry', label: zh ? '提取入场确认事项' : '参画確認事項を抽出', question: zh ? '如果客户面试通过，列出下一步需要人工确认的入场条件和准备事项。' : '顧客面談を通過した場合、次に人が確認すべき参画条件と準備事項を列挙してください。' }
      ]
    : [
        { id: 'decision', label: zh ? '整理招聘结论草稿' : '採用結論案を整理', question: zh ? '根据简历、面试问题、记录和待确认事项，整理优势、风险和结论草稿。不要代替员工做录用决定。' : '履歴書、面談質問、記録、未確認事項から、強み、懸念、結論案を整理してください。採用判断は担当者に委ねてください。', action: 'decision' },
        { id: 'next', label: zh ? '是否需要复试' : '再面談の必要性', question: zh ? '分析当前信息是否足以形成招聘结论；如不足，列出复试必须确认的问题。' : '現在情報で採用結論を出せるか分析し、不足する場合は再面談で必ず確認する質問を列挙してください。' },
        { id: 'evidence', label: zh ? '区分事实与推断' : '事実と推測を分離', question: zh ? '把当前评价拆分为有档案或面试记录依据的事实、员工判断和仍待确认的推断。' : '現在評価を、プロフィールまたは面談記録に根拠がある事実、担当者判断、未確認の推測に分けてください。' }
      ]
  return [
    { id: 'strengths', label: zh ? '快速了解候选人' : '候補者を把握', question: zh ? '简要总结候选人的主要能力、经验和本轮面试重点。' : '候補者の主な能力、経験、今回面談の重点を簡潔にまとめてください。' },
    { id: 'risk', label: zh ? '预约前确认事项' : '予約前の確認事項', question: zh ? '预约面试前，还需要确认哪些基本信息和时间安排？' : '面談予約前に確認すべき基本情報と日程条件は何ですか。' },
    { id: 'process', label: zh ? '本轮应该怎么推进' : '今回の進め方', question: zh ? '根据当前阶段，给出本轮面试准备和推进建议。' : '現在段階に合わせ、今回面談の準備と進め方を提案してください。' }
  ]
}

function sourceLabels(kind: CandidateInterviewSnapshot['kind'], zh: boolean): Record<InterviewAssistantSource, string> {
  return {
    profile: zh ? '候选人档案' : '候補者プロフィール',
    projects: zh ? '项目经历' : 'プロジェクト経験',
    interview: kind === 'client' ? (zh ? '客户面试记录' : '顧客面談記録') : (zh ? '招聘面试记录' : '採用面談記録'),
    case: zh ? '案件/预约上下文' : '案件・予約コンテキスト'
  }
}

function localAnswer(
  question: string,
  candidate: CandidateReviewSnapshot,
  interview: CandidateInterviewSnapshot | null,
  kind: CandidateInterviewSnapshot['kind'],
  notes: string,
  unresolvedItems: string[],
  zh: boolean
): { content: string; sources: InterviewAssistantSource[] } {
  const skills = splitSkills(fieldValue(candidate, 'skills'))
  const role = fieldValue(candidate, 'role')
  const experience = fieldValue(candidate, 'experience_years')
  const projects = candidate.projectExperiences.slice(0, 4)

  if (/问题|追问|質問|聞く/iu.test(question)) {
    const skillQuestions = skills.slice(0, 3).map((skill) => zh
      ? `请说明在使用 ${skill} 的项目中，你本人负责的设计、难点和最终结果。`
      : `${skill}を使った案件で、本人が担当した設計、難所、最終結果を説明してください。`)
    const remaining = unresolvedItems.slice(0, 3).map((item) => zh ? `请补充说明：${item}` : `追加確認：${item}`)
    const generated = [...remaining, ...skillQuestions]
    return {
      content: generated.length > 0
        ? generated.map((item, index) => `${index + 1}. ${item}`).join('\n')
        : (zh ? '当前档案没有足够的技能或待确认事项，建议先补充简历重点。' : '現在のプロフィールには質問生成に必要な技能・未確認事項が不足しています。'),
      sources: ['profile', 'projects', 'interview']
    }
  }
  if (/记录|总结|结论|评价|面談記録|結論|まとめ/iu.test(question)) {
    const facts = [
      notes.trim() ? (zh ? `当前记录：${compact(notes, 1_200)}` : `現在記録：${compact(notes, 1_200)}`) : null,
      unresolvedItems.length ? (zh ? `待确认：${unresolvedItems.join('；')}` : `未確認：${unresolvedItems.join('；')}`) : null,
      interview?.interviewGoal ? (zh ? `本轮目标：${interview.interviewGoal}` : `今回目標：${interview.interviewGoal}`) : null
    ].filter(Boolean)
    return {
      content: facts.length
        ? `${facts.join('\n')}\n${zh ? '以上为本机已登记事实，最终评价需要员工确认。' : '以上は端末内の登録事実です。最終評価は担当者が確認してください。'}`
        : (zh ? '本轮尚未记录足够事实，无法可靠整理结论。' : '今回の事実記録が不足しているため、結論を整理できません。'),
      sources: ['interview', 'profile']
    }
  }
  if (/项目|案件|做过|経験|project/iu.test(question)) {
    return {
      content: projects.length
        ? (zh ? `档案中登记了 ${candidate.projectExperiences.length} 项项目经历：${projects.map((project) => project.title).join('、')}。` : `プロフィールには${candidate.projectExperiences.length}件のプロジェクト経験があります：${projects.map((project) => project.title).join('、')}。`)
        : (zh ? '当前档案没有登记项目经历。' : '現在のプロフィールにプロジェクト経験は登録されていません。'),
      sources: ['projects']
    }
  }
  if (/哪里人|出身|国籍|住所|住まい/iu.test(question)) {
    const facts = [candidate.localIdentity?.nationality, candidate.localIdentity?.address].filter(Boolean)
    return {
      content: facts.length
        ? (zh ? `本机档案登记信息：${facts.join('；')}。这些个人信息不会发送给云端 AI。` : `端末内登録情報：${facts.join('；')}。この本人情報はCloud AIへ送信しません。`)
        : (zh ? '本机档案没有登记可靠的国籍或住址信息，系统不会进行推测。' : '端末内プロフィールに信頼できる国籍・住所情報がなく、推測もしません。'),
      sources: ['profile']
    }
  }
  const focus = kind === 'client'
    ? (zh ? '客户面试还应核对具体案件要求和客户关注点。' : '顧客面談では具体的な案件要件と顧客の関心点も確認してください。')
    : (zh ? '招聘面试还应核对项目职责深度、求职动机和稳定性。' : '採用面談では案件での担当の深さ、応募動機、安定性も確認してください。')
  return {
    content: skills.length
      ? (zh ? `主要能力是 ${skills.slice(0, 6).join('、')}${role ? `，主力角色为 ${role}` : ''}${experience ? `，总经验 ${experience}` : ''}。${focus}` : `主な能力は${skills.slice(0, 6).join('、')}${role ? `、主力ロールは${role}` : ''}${experience ? `、総経験は${experience}` : ''}です。${focus}`)
      : (zh ? '当前档案没有足够的技能信息，建议先核对简历和项目经历。' : '現在のプロフィールには十分な技能情報がありません。履歴書と案件経験を確認してください。'),
    sources: ['profile', 'projects', ...(interview ? ['interview' as const] : [])]
  }
}

function createCloudPrompt({
  candidate,
  goal,
  interview,
  kind,
  notes,
  phase,
  question,
  questions,
  unresolvedItems,
  zh
}: {
  candidate: CandidateReviewSnapshot
  goal: string
  interview: CandidateInterviewSnapshot | null
  kind: CandidateInterviewSnapshot['kind']
  notes: string
  phase: InterviewAssistantPhase
  question: string
  questions: CandidateInterviewQuestion[]
  unresolvedItems: string[]
  zh: boolean
}): string {
  const fields = cloudFieldKeys.flatMap((key) => {
    const field = candidate.fields.find((item) => item.key === key)
    if (!field?.value) return []
    return [`- ${field.label}: ${compact(field.value, key === 'skills' ? 1_600 : 400)}`]
  })
  const projects = candidate.projectExperiences.slice(0, 7).map((project, index) => [
    `${index + 1}. ${compact(project.title, 160) || (zh ? '未命名项目' : '名称未設定')}`,
    `   ${zh ? '期间' : '期間'}: ${compact(project.period, 100) || '-'}`,
    `   ${zh ? '角色' : '役割'}: ${compact(project.role, 100) || '-'}`,
    `   ${zh ? '技术' : '技術'}: ${project.technologies.slice(0, 18).map((item) => compact(item, 60)).join(', ') || '-'}`,
    `   ${zh ? '负责内容' : '担当内容'}: ${compact(project.summary, 600) || '-'}`
  ].join('\n'))
  const selectedQuestions = questions.filter((item) => item.selected).slice(0, 14).map((item, index) => `${index + 1}. ${compact(item.text, 260)}`)
  const interviewContext = [
    `${zh ? '面试类型' : '面談種別'}: ${kind === 'client' ? (zh ? '客户面试' : '顧客面談') : (zh ? '公司招聘面试' : '社内採用面談')}`,
    `${zh ? '轮次' : '回数'}: ${interview?.roundNumber ?? 1}`,
    `${zh ? '当前阶段' : '現在段階'}: ${phaseLabel(phase, zh)}`,
    `${zh ? '面试目标' : '面談目標'}: ${compact(goal, 700) || '-'}`,
    `${zh ? '案件或预约背景' : '案件・予約背景'}: ${compact(interview?.contactNote, 700) || '-'}`,
    `${zh ? '当前记录' : '現在記録'}: ${compact(notes, 1_800) || '-'}`,
    `${zh ? '待确认事项' : '未確認事項'}: ${unresolvedItems.slice(0, 12).map((item) => compact(item, 180)).join('；') || '-'}`,
    `${zh ? '已选问题' : '選択済み質問'}:\n${selectedQuestions.join('\n') || '-'}`
  ].join('\n')
  const rules = zh
    ? [
        '你是日本 SES 公司的面试辅助助手。',
        '只能依据下方匿名候选人档案、项目经历和当前面试上下文回答；没有依据时明确说不知道。',
        '禁止推测或输出姓名、电话、邮箱、详细住址、国籍、籍贯、年龄、性别等个人身份或敏感属性。',
        '不要替员工做录用、淘汰或客户通过决定；应区分事实、分析建议和待人工确认事项。',
        '涉及候选人事实时，说明依据来自档案、项目经历还是面试记录。使用简洁、专业的中文。'
      ]
    : [
        'あなたは日本のSES企業向け面談支援アシスタントです。',
        '以下の匿名候補者プロフィール、プロジェクト経験、現在の面談コンテキストだけを根拠に回答し、根拠がない場合は不明と明記してください。',
        '氏名、電話、メール、詳細住所、国籍、出身地、年齢、性別などの本人情報・機微属性を推測または出力しないでください。',
        '採用、見送り、顧客通過の最終判断を代行せず、事実、分析提案、人の確認事項を分けてください。',
        '候補者に関する事実は、プロフィール、プロジェクト経験、面談記録のどれが根拠か示し、簡潔で業務的な日本語で回答してください。'
      ]
  return [
    ...rules,
    `${zh ? '员工问题' : '担当者の質問'}: ${compact(question, 700)}`,
    `${zh ? '匿名候选人编号' : '匿名候補者番号'}: ${anonymousCandidateId(candidate.documentId)}`,
    zh ? '匿名结构化档案:' : '匿名構造化プロフィール:',
    fields.join('\n') || '-',
    zh ? '项目经历:' : 'プロジェクト経験:',
    projects.join('\n') || '-',
    zh ? '当前面试上下文:' : '現在の面談コンテキスト:',
    interviewContext
  ].join('\n').slice(0, 16_000)
}

export function InterviewAiAssistant({
  aiCommerce,
  candidate,
  cloudConsentGranted,
  goal,
  interview,
  kind,
  notes,
  onAddQuestions,
  onAppendNotes,
  onClose,
  onCloudConsentChange,
  onOpenCloudSettings,
  onOpenSource,
  onSendCloudPrompt,
  onUseDecisionDraft,
  phase,
  questions,
  unresolvedItems
}: InterviewAiAssistantProps) {
  useRendererUiRefresh()
  const locale = useUiLocale()
  const zh = locale === 'zh-CN'
  const cloudConfigured = aiCommerce?.configuration === 'ready'
  const cloudConnected = aiCommerce?.connection === 'connected'
  const cloudAvailable = Boolean(cloudConfigured && cloudConnected && onSendCloudPrompt)
  const [mode, setMode] = useState<AssistantMode>(() => cloudAvailable ? 'cloud' : 'local')
  const [input, setInput] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [historyOpen, setHistoryOpen] = useState(false)
  const [width, setWidth] = useState(430)
  const [resizing, setResizing] = useState(false)
  const prompts = useMemo(() => quickPrompts(kind, phase, zh), [kind, phase, zh])
  const labels = useMemo(() => sourceLabels(kind, zh), [kind, zh])
  const cloudReady = cloudAvailable && cloudConsentGranted && !busy
  const conversationContext = useMemo(() => ({
    assistant: 'interview' as const,
    candidateDocumentId: candidate.documentId,
    interviewId: interview?.id ?? null,
    interviewKind: kind,
    roundNumber: interview?.roundNumber ?? 1
  }), [candidate.documentId, interview?.id, interview?.roundNumber, kind])
  const history = useAiConversationHistory(conversationContext)
  const { messages, persistMessages } = history

  useEffect(() => {
    if (!resizing) return
    const move = (event: PointerEvent) => setWidth(Math.max(360, Math.min(620, window.innerWidth - event.clientX)))
    const stop = () => setResizing(false)
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', stop, { once: true })
    return () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', stop)
    }
  }, [resizing])

  const ask = async (rawQuestion: string, action?: AssistantAction) => {
    const question = rawQuestion.trim()
    const sendCloudPrompt = onSendCloudPrompt
    if (!question || busy || (mode === 'cloud' && history.saving)) return
    if (mode === 'cloud' && (!cloudReady || !sendCloudPrompt)) return
    const fallback = localAnswer(question, candidate, interview, kind, notes, unresolvedItems, zh)
    const createdAt = new Date().toISOString()
    const userMessage: AiConversationMessage = { id: messageId(), role: 'user', content: question, mode, createdAt }
    setInput('')
    setError(null)
    if (mode === 'local') {
      const assistantMessage: AiConversationMessage = {
        id: messageId(),
        role: 'assistant',
        content: fallback.content,
        mode: 'local',
        references: fallback.sources.map((source) => ({ label: labels[source], target: source })),
        action,
        createdAt: new Date().toISOString()
      }
      try {
        await persistMessages([...messages, userMessage, assistantMessage])
      } catch (cause) {
        setError(localizedIpcError(locale, cause, '会話履歴を保存できませんでした。'))
      }
      return
    }
    if (!sendCloudPrompt) return
    setBusy(true)
    let userConversation: AiConversationSnapshot
    try {
      userConversation = await persistMessages([...messages, userMessage])
    } catch (cause) {
      setError(localizedIpcError(locale, cause, '会話履歴を保存できないため、Cloud AIへ送信しませんでした。'))
      setBusy(false)
      return
    }
    try {
      const result = await sendCloudPrompt({
        content: createCloudPrompt({ candidate, goal, interview, kind, notes, phase, question, questions, unresolvedItems, zh })
      })
      const assistantMessage: AiConversationMessage = {
        id: messageId(),
        role: 'assistant',
        content: result.content,
        mode: 'cloud',
        references: (['profile', 'projects', 'interview', ...(kind === 'client' && interview?.contactNote ? ['case'] : [])] as InterviewAssistantSource[])
          .map((source) => ({ label: labels[source], target: source })),
        action,
        removedIdentifierCount: result.removedIdentifierTypes.length,
        usageCredits: result.usageCredits,
        createdAt: new Date().toISOString()
      }
      await persistMessages([...userConversation.messages, assistantMessage], userConversation)
    } catch (cause) {
      setError(localizedIpcError(locale, cause, 'Cloud AIを利用できませんでした。'))
      const fallbackMessage: AiConversationMessage = {
        id: messageId(),
        role: 'assistant',
        content: fallback.content,
        mode: 'local-fallback',
        references: fallback.sources.map((source) => ({ label: labels[source], target: source })),
        action,
        createdAt: new Date().toISOString()
      }
      try {
        await persistMessages([...userConversation.messages, fallbackMessage], userConversation)
      } catch (saveCause) {
        setError(localizedIpcError(locale, saveCause, 'Cloud AIの失敗回答を会話履歴へ保存できませんでした。'))
      }
    } finally {
      setBusy(false)
    }
  }

  const applyMessage = (message: AiConversationMessage) => {
    if (message.action === 'questions') {
      const extracted = extractInterviewQuestions(message.content)
      if (extracted.length > 0) onAddQuestions(extracted)
      else setError(zh ? 'AI 回答中没有识别到可加入的问题，请复制后手动整理。' : 'AI回答から追加可能な質問を抽出できませんでした。手動で整理してください。')
      return
    }
    if (message.action === 'notes') onAppendNotes(message.content)
    if (message.action === 'decision') onUseDecisionDraft(message.content)
  }

  return <aside className={resizing ? 'interview-ai-assistant is-resizing' : 'interview-ai-assistant'} style={{ width }}>
    <button aria-label={zh ? '调整 AI 面板宽度' : 'AIパネル幅を調整'} className="interview-ai-resizer" onPointerDown={() => setResizing(true)} type="button" />
    <header>
      <div><span><Icon name="sparkles" size={14} />{phaseLabel(phase, zh)}</span><h2>{zh ? 'AI 面试助手' : 'AI面談アシスタント'}</h2><p>{kind === 'client' ? (zh ? '当前客户面试上下文' : '現在の顧客面談コンテキスト') : (zh ? '当前招聘面试上下文' : '現在の採用面談コンテキスト')} · {zh ? `第 ${interview?.roundNumber ?? 1} 轮` : `${interview?.roundNumber ?? 1}回目`}</p></div>
      <div className="interview-ai-header-actions">
        <button aria-pressed={historyOpen} className={historyOpen ? 'is-active' : ''} onClick={() => setHistoryOpen((current) => !current)} type="button"><Icon name="clock" size={14} />{zh ? '历史' : '履歴'}</button>
        <button aria-label={zh ? '关闭 AI 面试助手' : 'AI面談アシスタントを閉じる'} onClick={onClose} type="button">×</button>
      </div>
    </header>

    {historyOpen ? <AiConversationHistoryPanel
      activeConversationId={history.activeConversationId}
      busy={history.saving}
      conversations={history.conversations}
      error={history.error}
      loading={history.loading}
      onDelete={history.deleteConversations}
      onNew={() => { history.newConversation(); setHistoryOpen(false) }}
      onSelect={(conversationId) => { history.selectConversation(conversationId); setHistoryOpen(false) }}
    /> : <>
    <div aria-label={zh ? 'AI 回答模式' : 'AI回答モード'} className="interview-ai-mode-switch" role="group">
      <button aria-pressed={mode === 'local'} className={mode === 'local' ? 'is-active' : ''} onClick={() => { setMode('local'); setError(null) }} type="button"><Icon name="database" size={14} />{zh ? '本机结构化辅助' : '端末内構造化支援'}</button>
      <button aria-pressed={mode === 'cloud'} className={mode === 'cloud' ? 'is-active is-cloud' : ''} onClick={() => { setMode('cloud'); setError(null) }} type="button"><Icon name="sparkles" size={14} />Cloud AI</button>
    </div>

    <div className={mode === 'cloud' ? 'interview-ai-scope is-cloud' : 'interview-ai-scope'}><Icon name={mode === 'cloud' ? 'shield' : 'database'} size={14} /><span>{mode === 'cloud' ? (zh ? '仅发送脱敏后的最小面试上下文' : '脱敏済みの最小面談コンテキストだけを送信') : (zh ? '读取本机档案和面试记录，不连接云端' : '端末内プロフィールと面談記録だけを参照')}</span></div>

    {mode === 'cloud' ? <div className={cloudConnected ? `interview-ai-cloud-gate is-ready${cloudConsentGranted ? ' is-consented' : ''}` : 'interview-ai-cloud-gate'}>
      {!cloudConfigured ? <><strong>{zh ? '需要配置 Cloud AI' : 'Cloud AIの設定が必要です'}</strong><p>{zh ? '请先在设置中完成 AICommerce 配置。' : '設定でAICommerceを構成してください。'}</p><button onClick={onOpenCloudSettings} type="button">{zh ? '打开 Cloud AI 设置' : 'Cloud AI設定を開く'}</button></>
        : !cloudConnected ? <><strong>{zh ? 'Cloud AI 尚未连接' : 'Cloud AIは未接続です'}</strong><p>{zh ? '连接会员账号后可以使用面试分析。' : '会員アカウントへ接続すると面談分析を利用できます。'}</p><button onClick={onOpenCloudSettings} type="button">{zh ? '打开连接设置' : '接続設定を開く'}</button></>
          : cloudConsentGranted
            ? <div className="interview-ai-consent-active"><span><Icon name="check" size={14} /><span><strong>{zh ? '本轮已允许发送脱敏上下文' : '今回面談の匿名コンテキスト送信を許可済み'}</strong><small>{zh ? '本轮后续提问无需重复确认；切换候选人或面试轮次后会自动失效。' : '今回の続きは再確認不要です。候補者または面談回を切り替えると自動で失効します。'}</small></span></span><button onClick={() => onCloudConsentChange(false)} type="button">{zh ? '撤销' : '取消'}</button></div>
            : <div className="interview-ai-consent-request"><span><strong>{zh ? '仅需为本轮确认一次' : '今回面談で一度だけ確認'}</strong><small>{zh ? '姓名、电话、邮箱、详细住址、原始简历和会议链接不会发送；主进程仍会执行 PII/DLP 复检。' : '氏名、電話、メール、詳細住所、原履歴書、会議リンクは送信せず、MainでPII/DLPを再検査します。'}</small></span><button onClick={() => onCloudConsentChange(true)} type="button">{zh ? '允许本轮使用 Cloud AI' : '今回だけCloud AIを許可'}</button></div>}
    </div> : null}

    <div className="interview-ai-prompts">{prompts.map((prompt) => <button disabled={mode === 'cloud' && !cloudReady} key={prompt.id} onClick={() => void ask(prompt.question, prompt.action)} type="button">{prompt.label}</button>)}</div>

    <div aria-live="polite" className="interview-ai-messages">
      {messages.length === 0 ? <div className="interview-ai-empty"><span><Icon name="sparkles" size={23} /></span><strong>{zh ? '围绕本轮面试直接提问' : '今回面談について直接質問'}</strong><p>{zh ? 'AI 只使用当前候选人、当前轮次和当前阶段的上下文，不会混入其他候选人。' : '現在の候補者、回数、段階だけを参照し、他候補者の情報を混在させません。'}</p></div> : messages.map((message) => <article className={`interview-ai-message is-${message.role}`} key={message.id}>
        {message.role === 'assistant' && message.mode ? <span className={`interview-ai-answer-mode is-${message.mode}`}>{message.mode === 'cloud' ? (zh ? 'Cloud AI · 已脱敏' : 'Cloud AI・脱敏済み') : message.mode === 'local-fallback' ? (zh ? '云端不可用 · 本机回答' : 'Cloud利用不可・端末内回答') : (zh ? '本机结构化辅助' : '端末内構造化支援')}</span> : null}
        <p>{message.content}</p>
        {message.role === 'assistant' && message.references?.length ? <div className="interview-ai-sources"><span>{zh ? '依据' : '根拠'}</span>{message.references.map((reference) => <button key={`${reference.target}-${reference.label}`} onClick={() => onOpenSource(reference.target as InterviewAssistantSource)} type="button">{reference.label}</button>)}</div> : null}
        {message.role === 'assistant' && message.action ? <button className="interview-ai-apply" onClick={() => applyMessage(message)} type="button"><Icon name={message.action === 'questions' ? 'plus' : 'edit'} size={13} />{message.action === 'questions' ? (zh ? '加入问题清单' : '質問リストへ追加') : message.action === 'notes' ? (zh ? '追加到面试记录' : '面談記録へ追加') : (zh ? '作为结论草稿' : '結論下書きに使用')}</button> : null}
        {message.mode === 'cloud' ? <small className="interview-ai-cloud-meta">{message.removedIdentifierCount ? `${zh ? '发送前替换' : '送信前置換'} ${message.removedIdentifierCount} · ` : ''}{message.usageCredits === null ? (zh ? '未提供用量' : '利用量未提供') : `${message.usageCredits ?? 0} credits`}</small> : null}
      </article>)}
      {busy ? <div className="interview-ai-loading"><i /><span>{zh ? 'Cloud AI 正在分析脱敏后的面试上下文…' : 'Cloud AIが脱敏済み面談コンテキストを分析中…'}</span></div> : null}
    </div>

    {error || history.error ? <div className="interview-ai-error" role="alert"><Icon name="alert" size={14} /><span>{error ?? history.error}</span></div> : null}
    <form className="interview-ai-composer" onSubmit={(event: FormEvent) => { event.preventDefault(); void ask(input) }}><textarea aria-label={zh ? '向 AI 询问本轮面试' : '今回面談についてAIに質問'} disabled={mode === 'cloud' && (history.saving || !cloudReady)} maxLength={700} onChange={(event) => setInput(event.target.value)} placeholder={zh ? '例如：针对这段项目经历，下一步应该怎么追问？' : '例：この案件経験について、次に何を深掘りすべき？'} value={input} /><button disabled={!input.trim() || busy || (mode === 'cloud' && (history.saving || !cloudReady))} type="submit"><Icon name="chevron-right" size={18} /><span>{zh ? '发送' : '送信'}</span></button></form>
    <footer><Icon name="shield" size={13} /><span>{mode === 'cloud' ? (zh ? '个人信息在本机脱敏，输出需人工确认' : '本人情報は端末内脱敏・出力は人が確認') : (zh ? '完全本机处理，不发送云端' : '完全端末内処理・Cloud送信なし')}</span></footer>
    </>}
  </aside>
}
