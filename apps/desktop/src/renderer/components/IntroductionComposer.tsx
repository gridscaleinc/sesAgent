import { useEffect, useId, useRef, useState } from 'react'
import {
  generatePersonnelMessage,
  generatePersonnelProposal,
  introductionRequestMaxLength,
  type BusinessFollowUp,
  type CandidateReviewSnapshot,
  type JobCaseReviewSnapshot,
  type PersonnelTemplate,
  type RecommendationPoint,
  recommendationPointText
} from '@shared'
import {
  aiServiceProblem,
  localizedAiServiceProblem,
  localizedIpcError,
  requestAiSignIn,
  useLocaleText,
  type AiServiceProblem
} from '../i18n'
import { copyTextToClipboard } from '../copy-text'
import { progressPairKey, progressPresentation, useBusinessProgress } from '../business-progress-data'
import type { IntroductionTarget } from './HrMatchingWorkspace'
import type { FollowUpTarget } from './follow-up-target'
import { IntroductionOptions } from './IntroductionOptions'
import { RecommendationPointsPicker } from './RecommendationPoints'

const briefTemplateId = 'e72e12d0-0000-4000-8000-000000000001'
const standardTemplateId = 'e72e12d0-0000-4000-8000-000000000002'

export function IntroductionComposer({
  target,
  people,
  cases,
  onClose,
  onFollowUp
}: {
  onFollowUp(target: FollowUpTarget): void | Promise<void>
  target: IntroductionTarget | null
  people: CandidateReviewSnapshot[]
  cases: JobCaseReviewSnapshot[]
  onClose(): void
}) {
  const { locale, zh, t } = useLocaleText()
  const [templates, setTemplates] = useState<PersonnelTemplate[]>([])
  const [templateId, setTemplateId] = useState(standardTemplateId)
  const [lang, setLang] = useState<'ja' | 'zh'>('ja')
  const [subjects, setSubjects] = useState<Record<string, string>>({})
  const [drafts, setDrafts] = useState<Record<string, string>>({})
  const [requests, setRequests] = useState<Record<string, string>>({})
  // AI introductions saved in the encrypted database for this person, keyed "<case|general>:<style>:<lang>".
  const [stored, setStored] = useState<Record<string, { text: string; experienceRunId: string | null }>>({})
  const [storedReady, setStoredReady] = useState(false)
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState('')
  const [error, setError] = useState('')
  // AI is not signed in: one explanation with a way to sign in, instead of the same error once per language.
  const [aiSignIn, setAiSignIn] = useState(false)
  // Set after copy or open-mail succeeds: the app cannot see the send, so it asks HR to confirm it.
  const [askSent, setAskSent] = useState(false)
  // The follow-up saved from this dialog, for when no shared progress list is mounted.
  const [savedFollow, setSavedFollow] = useState<BusinessFollowUp | null>(null)
  const businessProgress = useBusinessProgress()
  const lock = useRef(false)
  const dialog = useRef<HTMLDivElement>(null)
  const editor = useRef<HTMLTextAreaElement>(null)
  // Where HR last placed the cursor in the body; null until they do, so 「插入」 then appends at the end.
  const cursor = useRef<{ start: number; end: number } | null>(null)
  const panelId = useId()
  useEffect(() => {
    if (!target) return
    let active = true
    const trigger = document.activeElement as HTMLElement | null
    setNotice('')
    setError('')
    setAiSignIn(false)
    setAskSent(false)
    setSavedFollow(null)
    // The request to AI is a one-off instruction: every opening of the dialog starts with an empty box.
    setRequests({})
    setStoredReady(false)
    const current = target
    Promise.resolve(window.sesAgent.listPersonnelIntroductionDrafts?.(current.documentId) ?? [])
      .then((drafts) => {
        if (!active) return
        setStored(
          Object.fromEntries(
            drafts
              .filter(
                (draft) =>
                  (draft.caseReviewId ?? null) === (current.reviewId ?? null) &&
                  (!draft.caseReviewId || draft.jobCaseVersion === current.jobCaseVersion)
              )
              .map((draft) => [
                `${draft.caseReviewId ?? 'general'}:${draft.style}:${draft.lang}`,
                { text: draft.text, experienceRunId: draft.experienceRunId }
              ])
          )
        )
      })
      .catch((cause) => {
        if (active) setError(localizedIpcError(locale, cause, t('无法读取已保存的介绍。', '保存済みの紹介文を読み込めませんでした。')))
      })
      .finally(() => {
        if (active) setStoredReady(true)
      })
    void window.sesAgent
      .getPersonnelWorkspace()
      .then((value) => {
        if (active) setTemplates(value.templates)
      })
      .catch((cause) => {
        if (active) setError(localizedIpcError(locale, cause, t('无法读取文案模板。', '紹介文テンプレートを読み込めませんでした。')))
      })
    dialog.current?.focus()
    return () => {
      active = false
      if (trigger?.isConnected) trigger.focus({ preventScroll: true })
    }
  }, [target])
  const person = people.find((item) => item.documentId === target?.documentId)
  const job = cases.find((item) => item.reviewId === target?.reviewId)
  const template = templates.find((item) => item.id === templateId) ?? templates[0]
  const pair = target?.reviewId ? { documentId: target.documentId, reviewId: target.reviewId } : null
  const follow =
    (pair ? businessProgress?.indexes.pairs.get(progressPairKey(pair)) : undefined) ??
    (savedFollow && pair && savedFollow.documentId === pair.documentId && savedFollow.reviewId === pair.reviewId ? savedFollow : undefined)
  const followState = follow?.progress ? progressPresentation(follow, businessProgress?.now ?? new Date(), zh) : null
  const recommendedAt = follow?.progress?.recommendedAt
  const valid = Boolean(
    target &&
    person &&
    person.recordStatus !== 'deleted' &&
    (person.recordStatus === 'active' || Boolean(target.reviewId)) &&
    person.profile?.version === target.profileVersion &&
    (!target.reviewId || (job?.lifecycle === 'active' && job.jobCase?.version === target.jobCaseVersion))
  )
  const key = target
    ? `${target.documentId}:${target.profileVersion}:${target.reviewId ?? 'general'}:${target.jobCaseVersion ?? 0}:${template?.id}:${template?.revision}:${lang}`
    : ''
  const proposal = person ? generatePersonnelProposal(person, job, lang, template?.id === briefTemplateId) : null
  const subject = subjects[key] ?? proposal?.subject ?? ''
  const initial = () => {
    if (!person || !template || !target) return ''
    return template.id === standardTemplateId || template.id === briefTemplateId
      ? (proposal?.text ?? '')
      : generatePersonnelMessage(person, template, lang)
  }
  // Only the two AI styles are generated and stored; other templates are local template text.
  const style = template?.id === briefTemplateId ? 'brief' : template?.id === standardTemplateId ? 'standard' : null
  const storedKey = (value: 'ja' | 'zh', forStyle = style) => `${target?.reviewId ?? 'general'}:${forStyle}:${value}`
  const keyFor = (value: 'ja' | 'zh') => `${key.slice(0, key.lastIndexOf(':'))}:${value}`
  const caseContext = target?.reviewId && target.jobCaseVersion ? { reviewId: target.reviewId, version: target.jobCaseVersion } : null
  const save = async (
    value: 'ja' | 'zh',
    result: { text: string; experienceRunId?: string },
    withRequest: string | null,
    forStyle: 'standard' | 'brief'
  ) => {
    if (!target) return
    await window.sesAgent.savePersonnelIntroductionDrafts({
      documentId: target.documentId,
      profileVersion: target.profileVersion,
      caseContext,
      style: forStyle,
      request: withRequest,
      drafts: [{ lang: value, text: result.text, experienceRunId: result.experienceRunId ?? null }]
    })
    setStored((current) => ({
      ...current,
      [storedKey(value, forStyle)]: { text: result.text, experienceRunId: result.experienceRunId ?? null }
    }))
  }
  /**
   * Chinese and Japanese are always generated together. Each language is shown and stored as soon as it succeeds,
   * so one failed language never discards the other.
   */
  const generate = async (
    languages: Array<'ja' | 'zh'>,
    forStyle: 'standard' | 'brief',
    withRequest: string | null,
    replaceEdits: boolean
  ) => {
    if (!target) return
    const failed: string[] = []
    const problems = new Set<AiServiceProblem>()
    await Promise.all(
      languages.map(async (value) => {
        try {
          const result = await window.sesAgent.regenerateIntroduction({
            kind: 'person',
            id: target.documentId,
            version: target.profileVersion,
            lang: value,
            style: forStyle,
            ...(withRequest ? { request: withRequest } : {}),
            ...(caseContext ? { caseContext } : {})
          })
          if (replaceEdits) setDrafts((current) => ({ ...current, [keyFor(value)]: result.text }))
          try {
            await save(value, result, withRequest, forStyle)
          } catch (cause) {
            // Keep the generated text on screen even when it cannot be stored.
            setStored((current) => ({
              ...current,
              [storedKey(value, forStyle)]: { text: result.text, experienceRunId: result.experienceRunId ?? null }
            }))
            failed.push(localizedIpcError(locale, cause, t('介绍已生成，但保存失败。', '紹介文は生成しましたが、保存できませんでした。')))
          }
        } catch (cause) {
          const problem = aiServiceProblem(cause)
          if (problem) {
            problems.add(problem)
            return
          }
          const label = value === 'ja' ? t('日文', '日本語') : t('中文', '中国語')
          failed.push(
            `${label}：${localizedIpcError(locale, cause, t('生成失败，请重试。', '生成できませんでした。もう一度お試しください。'))}`
          )
        }
      })
    )
    if (problems.has('sign-in')) setAiSignIn(true)
    const messages = [
      ...failed,
      ...[...problems].filter((problem) => problem !== 'sign-in').map((problem) => localizedAiServiceProblem(locale, problem))
    ]
    if (messages.length) setError(messages.join(' / '))
    return messages.length === 0 && !problems.size
  }
  const [generating, setGenerating] = useState(false)
  const attempted = useRef(new Set<string>())
  // On open, generate whatever this style still lacks in either language - once per person, case, style and version.
  useEffect(() => {
    if (!target || !storedReady || !valid || !style || lock.current) return
    const missing = (['ja', 'zh'] as const).filter((value) => !stored[storedKey(value)])
    const attempt = `${key.slice(0, key.lastIndexOf(':'))}:${style}`
    if (!missing.length || attempted.current.has(attempt)) return
    attempted.current.add(attempt)
    lock.current = true
    setGenerating(true)
    setError('')
    void generate(missing, style, null, false).finally(() => {
      lock.current = false
      setGenerating(false)
    })
  }, [target, storedReady, valid, style, key])
  const working = busy || generating
  const storedDraft = style ? stored[storedKey(lang)] : undefined
  const text = drafts[key] ?? (style ? (storedDraft?.text ?? '') : initial())
  useEffect(() => {
    cursor.current = null
  }, [key])
  /** Puts one 推荐要点 (headline and detail) into the body at the cursor, or at the end when HR has not placed one. */
  const insertPoint = (point: RecommendationPoint) => {
    const line = recommendationPointText(point)
    const start = Math.min(cursor.current?.start ?? text.length, text.length)
    const end = Math.min(cursor.current?.end ?? text.length, text.length)
    const before = text.slice(0, start),
      after = text.slice(end)
    const inserted = `${before && !before.endsWith('\n') ? '\n' : ''}${line}${after && !after.startsWith('\n') ? '\n' : ''}`
    setDrafts((state) => ({ ...state, [key]: `${before}${inserted}${after}` }))
    const position = before.length + inserted.length
    cursor.current = { start: position, end: position }
    requestAnimationFrame(() => {
      editor.current?.focus()
      editor.current?.setSelectionRange(position, position)
    })
  }
  const missingFields =
    // i18n-ignore: placeholder written into the draft in the message language
    proposal?.missingFields.filter((label) => text.includes(`${label}：${lang === 'ja' ? '[送信前に記入]' : '[发送前填写]'}`)) ?? []
  // One request per opening and style: it applies to both languages.
  const requestKey = `${target?.reviewId ?? 'general'}:${style}`
  const request = (requests[requestKey] ?? '').trim()
  const regenerate = async () => {
    if (lock.current || !target || !valid || !style) return
    lock.current = true
    setBusy(true)
    setError('')
    setAiSignIn(false)
    setNotice('')
    try {
      if (await generate(['ja', 'zh'], style, request || null, true))
        setNotice(t('AI 已重新生成中日两种语言并保存，可直接编辑。', 'AIで日本語と中国語を再生成して保存しました。そのまま編集できます。'))
    } finally {
      lock.current = false
      setBusy(false)
    }
  }
  const submit = async (method: 'copy' | 'email' | 'subject') => {
    if (lock.current || !valid || !target || !template || !person) return
    lock.current = true
    setBusy(true)
    setNotice('')
    setError('')
    try {
      const input = {
        documentId: target.documentId,
        profileVersion: target.profileVersion,
        reviewRevision: person.reviewRevision,
        ...(target.reviewId && target.jobCaseVersion ? { caseContext: { reviewId: target.reviewId, version: target.jobCaseVersion } } : {}),
        templateId: template.id,
        templateRevision: template.revision,
        lang,
        subject,
        text,
        experienceRunId: storedDraft?.experienceRunId ?? undefined
      }
      if (method === 'copy' || method === 'subject') {
        const validated = await window.sesAgent.validatePersonnelMessage(input)
        await copyTextToClipboard(method === 'subject' ? (validated.subject ?? subject) : validated.text)
        if (method === 'copy') await window.sesAgent.recordPersonnelCopy(validated)
        setNotice(t('已复制，可粘贴发送。', 'コピーしました。貼り付けて送信できます。'))
        if (method === 'copy') setAskSent(true)
      } else {
        const result = await window.sesAgent.openPersonnelEmail(input)
        setNotice(
          result.recipientPrefilled
            ? t('已打开邮件并带入案件回复地址，请核对后发送。', '案件の返信先を入れてメールを開きました。宛先を確認して送信してください。')
            : t(
                '已打开邮件。未找到案件回复地址，请选择收件人后发送。',
                'メールを開きました。案件の返信先が見つからないため宛先を選択してください。'
              )
        )
        setAskSent(true)
      }
    } catch (cause) {
      setError(
        localizedIpcError(
          locale,
          cause,
          t('无法复制或打开邮件，请重试。', 'コピーまたはメール作成ができませんでした。もう一度お試しください。')
        )
      )
    } finally {
      lock.current = false
      setBusy(false)
    }
  }
  /** Records the introduction as sent: creates the follow-up at 已推荐, or leaves one already further along unchanged. */
  const markRecommended = async () => {
    if (lock.current || !target?.reviewId || !valid) return
    lock.current = true
    setBusy(true)
    setError('')
    try {
      const saved = await window.sesAgent.advanceBusinessProgress({
        documentId: target.documentId,
        reviewId: target.reviewId,
        expectedRevision: follow?.revision ?? 0,
        mutationId: crypto.randomUUID(),
        action: 'recommend'
      })
      setSavedFollow(saved)
      businessProgress?.publish([saved])
      setAskSent(false)
      setNotice('')
    } catch (cause) {
      setError(localizedIpcError(locale, cause, t('无法标记已推荐，请重试。', '推薦済みにできませんでした。もう一度お試しください。')))
    } finally {
      lock.current = false
      setBusy(false)
    }
  }
  const openFollow = () => {
    if (busy || !target?.reviewId) return
    setBusy(true)
    void Promise.resolve(
      onFollowUp({
        documentId: target.documentId,
        reviewId: target.reviewId,
        ...(target.pendingConditions ? { pendingConditions: target.pendingConditions } : {})
      })
    )
      .catch((cause) =>
        setError(localizedIpcError(locale, cause, t('无法打开跟进，请重试。', '対応を開けませんでした。もう一度お試しください。')))
      )
      .finally(() => setBusy(false))
  }
  const openResume = () => {
    if (!target) return
    void window.sesAgent
      .openOriginalDocument(target.documentId)
      .catch((cause) => setError(localizedIpcError(locale, cause, t('无法打开简历原件。', '履歴書の原本を開けませんでした。'))))
  }
  /** Saves the redacted skill sheet (anonymous, no contact details) built from the confirmed profile, for attaching to the mail. */
  const exportSheet = async () => {
    if (lock.current || !target || !valid || !window.sesAgent.exportSkillSheet) return
    lock.current = true
    setBusy(true)
    setError('')
    setNotice('')
    try {
      const result = await window.sesAgent.exportSkillSheet({
        documentId: target.documentId,
        profileVersion: target.profileVersion,
        ...(caseContext ? { caseContext } : {})
      })
      if (!result.cancelled)
        setNotice(
          t(
            `已导出技能表 ${result.fileName}，并在访达中显示，请附加到邮件。`,
            `スキルシート ${result.fileName} を書き出し、Finderで表示しました。メールに添付してください。`
          )
        )
    } catch (cause) {
      setError(
        localizedIpcError(locale, cause, t('无法导出技能表，请重试。', 'スキルシートを書き出せませんでした。もう一度お試しください。'))
      )
    } finally {
      lock.current = false
      setBusy(false)
    }
  }
  const tokyoTime = (value: string) =>
    new Date(value).toLocaleString(t('zh-CN', 'ja-JP'), {
      timeZone: 'Asia/Tokyo',
      month: 'numeric',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false
    })
  const title = job ? t('准备介绍', '紹介を準備') : t('推广人员', '要員を紹介')
  if (!target) return null
  return (
    <div className="hr-modal-backdrop">
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className="hr-introduction"
        ref={dialog}
        tabIndex={-1}
        onKeyDown={(event) => {
          if (event.key === 'Escape' && !lock.current) onClose()
          if (event.key === 'Tab') {
            const items = Array.from(
              event.currentTarget.querySelectorAll<HTMLElement>(
                'button:not(:disabled):not([tabindex="-1"]),textarea:not(:disabled),input:not(:disabled)'
              )
            )
            const first = items[0]
            const last = items.at(-1)
            if (event.shiftKey && (document.activeElement === first || document.activeElement === dialog.current)) {
              event.preventDefault()
              last?.focus()
            } else if (!event.shiftKey && document.activeElement === last) {
              event.preventDefault()
              first?.focus()
            }
          }
        }}
      >
        <header>
          <div>
            <small>{job ? t('针对当前案件', 'この案件向け') : t('人员推广', '要員紹介')}</small>
            <h2>{title}</h2>
          </div>
          <button type="button" aria-label={t('关闭介绍', '紹介画面を閉じる')} disabled={busy} onClick={onClose}>
            ×
          </button>
        </header>
        <p className="hr-intro-context">
          {person?.localIdentity?.displayName ?? person?.fileName}
          {job ? ` → ${job.fields.find((item) => item.key === 'title')?.value ?? job.redactedSubject}` : ''}
        </p>
        <label className="hr-intro-subject">
          {t('邮件主题', 'メール件名')}
          <input
            aria-label={t('邮件主题', 'メール件名')}
            value={subject}
            maxLength={240}
            disabled={busy}
            onChange={(event) => setSubjects((state) => ({ ...state, [key]: event.target.value.replace(/[\r\n]/gu, '') }))}
          />
        </label>
        <button type="button" disabled={working || !valid || !subject.trim()} onClick={() => void submit('subject')}>
          {t('复制主题', '件名をコピー')}
        </button>
        {missingFields.length ? (
          <aside className="hr-intro-pending">
            <strong>{t('发送前补充', '送信前に補足')}</strong>
            <p>{missingFields.join('、')}</p>
            <small>
              {t(
                '正文中的占位符请按实际情况补齐。打开邮件后，请添加收件人称呼。',
                '本文の未記入欄を実情に合わせて補足してください。メールを開いた後、宛名を記入してください。'
              )}
            </small>
          </aside>
        ) : null}
        {target.pendingConditions?.length ? (
          <aside className="hr-intro-pending" aria-label={t('还需沟通', '相談する内容')}>
            <small>
              {t('内部沟通备忘，不写入邮件正文', '社内の相談メモ（メール本文には含めません）')}：{target.pendingConditions.join(' / ')}
            </small>
          </aside>
        ) : null}
        {!valid ? (
          <p role="alert">
            {t(
              '资料已更新或不可用。草稿已保留，请关闭后重新匹配或打开人员资料。',
              '情報が更新されたか利用できません。下書きは保持されています。再マッチングするか要員情報を開いてください。'
            )}
          </p>
        ) : null}
        <IntroductionOptions
          templates={[...templates]
            .sort((a, b) => Number(b.id === standardTemplateId) - Number(a.id === standardTemplateId))
            .map((item) => ({
              id: item.id,
              label: item.id === standardTemplateId ? t('标准', '標準') : item.id === briefTemplateId ? t('省略', '簡潔') : item.name
            }))}
          templateId={template?.id ?? ''}
          lang={lang}
          disabled={busy}
          panelId={panelId}
          onTemplateChange={setTemplateId}
          onLanguageChange={setLang}
        />
        {generating ? (
          <p role="status">
            {t('正在结合案件要求、项目技术和实际职责生成提案文…', '案件要件・使用技術・担当業務をもとに提案文を生成しています…')}
          </p>
        ) : null}
        <div className="hr-intro-generation">
          <textarea
            className="ai-request-input"
            aria-label={t('对 AI 的要求', 'AIへの要望')}
            placeholder={t(
              '例：加上他的团队管理经验，或粘贴一篇参考范文',
              '例：チーム管理の経験を加えて。参考にする文例を貼り付けることもできます'
            )}
            rows={2}
            maxLength={introductionRequestMaxLength}
            disabled={working || !valid || !style}
            value={requests[requestKey] ?? ''}
            onChange={(event) => setRequests((state) => ({ ...state, [requestKey]: event.target.value }))}
          />
          <button type="button" disabled={working || !valid || !style} onClick={() => void regenerate()}>
            {working ? t('云端 AI 正在生成…', 'Cloud AIで生成中…') : t('AI 重新生成', 'AIで再生成')}
          </button>
        </div>
        {aiSignIn ? (
          <div className="hr-intro-ai-signin" role="alert">
            <p>
              {t(
                'AI 未登录，无法自动生成介绍。可以登录后重试，或直接在下方手动填写。',
                'AIにログインしていないため、紹介文を自動生成できません。ログインして再試行するか、下に直接入力してください。'
              )}
            </p>
            <button type="button" onClick={requestAiSignIn}>
              {t('去登录', 'ログインする')}
            </button>
          </div>
        ) : null}
        {target.reviewId && valid ? (
          <RecommendationPointsPicker documentId={target.documentId} reviewId={target.reviewId} disabled={working} onInsert={insertPoint} />
        ) : null}
        <div role="tabpanel" id={panelId} aria-label={t('介绍文案', '紹介文')} className="hr-intro-body">
          <textarea
            ref={editor}
            aria-label={t('介绍文案', '紹介文')}
            value={text}
            onSelect={(event) => {
              cursor.current = { start: event.currentTarget.selectionStart, end: event.currentTarget.selectionEnd }
            }}
            onChange={(event) => {
              cursor.current = { start: event.currentTarget.selectionStart, end: event.currentTarget.selectionEnd }
              setDrafts((state) => ({ ...state, [key]: event.target.value }))
            }}
            disabled={working}
            placeholder={t('可以直接在这里填写介绍。', 'ここに紹介文を直接入力できます。')}
          />
        </div>
        {error ? <p role="alert">{error}</p> : null}
        {notice ? <p role="status">{notice}</p> : null}
        <aside className="hr-intro-attachment">
          <small>
            {t(
              '技能表不会自动附加：导出技能表后请附加到邮件。技能表由已确认的人员资料生成，使用匿名编号，不含姓名、联系方式和简历原件；邮件发出后无法撤回。',
              'スキルシートは自動で添付されません。書き出したスキルシートをメールに添付してください。確認済みの要員情報から作成し、匿名表記で氏名・連絡先・履歴書の原本は含みません。送信後は取り消せません。'
            )}
          </small>
          <button type="button" disabled={busy || !valid || !window.sesAgent.exportSkillSheet} onClick={() => void exportSheet()}>
            {t('导出技能表', 'スキルシートを書き出す')}
          </button>
          <button type="button" disabled={busy || !valid} onClick={openResume}>
            {t('打开简历原件', '履歴書の原本を開く')}
          </button>
        </aside>
        <footer>
          {target.reviewId ? (
            follow?.progress ? (
              <>
                <span className="hr-intro-recommended" role="status">
                  {recommendedAt
                    ? `${t('已推荐', '推薦済み')} · ${tokyoTime(recommendedAt)}`
                    : `${t('跟进中', '対応中')} · ${followState?.label ?? ''}`}
                </span>
                {/* Introduced after the follow-up started: the recommendation still counts once recorded. */}
                {!recommendedAt ? (
                  <button type="button" disabled={working || !valid} onClick={() => void markRecommended()}>
                    {t('标记已推荐', '推薦済みにする')}
                  </button>
                ) : null}
                <button type="button" disabled={working} onClick={openFollow}>
                  {t('查看跟进', '対応を見る')}
                </button>
              </>
            ) : (
              <>
                <button type="button" disabled={working || !valid} onClick={openFollow}>
                  {t('开始跟进', '対応を開始')}
                </button>
                {askSent ? <small role="status">{t('已经发出了吗？', '送信しましたか？')}</small> : null}
                <button type="button" disabled={working || !valid} onClick={() => void markRecommended()}>
                  {t('标记已推荐', '推薦済みにする')}
                </button>
              </>
            )
          ) : null}
          <button disabled={working || !valid || !template || !text.trim()} type="button" onClick={() => void submit('email')}>
            {t('打开邮件', 'メールを開く')}
          </button>
          <button
            className="hr-primary"
            disabled={working || !valid || !template || !text.trim()}
            type="button"
            onClick={() => void submit('copy')}
          >
            {t('复制介绍', '紹介文をコピー')}
          </button>
        </footer>
      </div>
    </div>
  )
}
