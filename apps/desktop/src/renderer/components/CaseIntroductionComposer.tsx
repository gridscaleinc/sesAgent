import { useIntroductionExperience } from './use-introduction-experience'
import { useEffect, useId, useRef, useState } from 'react'
import {
  introductionRequestMaxLength,
  type BroadcastQueueItem,
  type BroadcastTemplate,
  type DraftCaseBroadcastResult,
  type JobCaseReviewSnapshot
} from '@shared'
import { localizedIpcError, useLocaleText } from '../i18n'
import { copyTextToClipboard } from '../copy-text'
import { IntroductionOptions } from './IntroductionOptions'
import { notifyBusinessDataChanged } from '../business-data-events'

// AI-regenerated introductions are saved in the encrypted database (latest per case, language and style) and loaded
// when the dialog opens. Unsaved hand edits outlive the dialog for this app session only: business text is never
// written to ordinary browser storage.
const sessionDrafts: Record<string, string> = {}
/** Clears the session drafts; tests start from an empty session. */
export function clearCaseIntroductionSession() {
  for (const key of Object.keys(sessionDrafts)) delete sessionDrafts[key]
}

export interface CaseIntroductionTarget {
  reviewId: string
  jobCaseVersion: number | null
  reviewRevision?: number
}
export function CaseIntroductionComposer({
  target,
  cases,
  onClose,
  onPrepared
}: {
  target: CaseIntroductionTarget | null
  cases: JobCaseReviewSnapshot[]
  onClose(): void
  onPrepared?(review: JobCaseReviewSnapshot): void
}) {
  const { locale, zh, t } = useLocaleText()
  const [templates, setTemplates] = useState<BroadcastTemplate[]>([])
  const [templateId, setTemplateId] = useState('')
  const [lang, setLang] = useState<'ja' | 'zh'>('ja')
  const [drafts, setDraftState] = useState<Record<string, string>>(() => ({ ...sessionDrafts }))
  // The request to AI is a one-off instruction: every opening of the dialog starts with an empty box.
  const [requests, setRequestState] = useState<Record<string, string>>({})
  const setDrafts = (change: Record<string, string>) => {
    Object.assign(sessionDrafts, change)
    setDraftState((current) => ({ ...current, ...change }))
  }
  const [generated, setGenerated] = useState<Record<string, DraftCaseBroadcastResult>>({})
  // Copied before and revised since: HR may send just what changed (更新通知) instead of the whole case again.
  const [queueItem, setQueueItem] = useState<BroadcastQueueItem | null>(null)
  const [updateNotice, setUpdateNotice] = useState<{ ja: string; zh: string } | null>(null)
  const [busy, setBusy] = useState(false)
  const [loading, setLoading] = useState(false)
  const [preparing, setPreparing] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const dialog = useRef<HTMLDivElement>(null)
  const panelId = useId()
  const lock = useRef(false)
  const preparationRequests = useRef(new Map<string, Promise<JobCaseReviewSnapshot>>())
  const job = cases.find((item) => item.reviewId === target?.reviewId)
  const template = templates.find((item) => item.id === templateId) ?? templates[0]
  const key = target && template ? `${target.reviewId}:${target.jobCaseVersion}:${template.id}:${template.revision}` : ''
  const brief = templateId === 'brief'
  const styleKey = `${key}:${brief ? 'brief' : 'standard'}`
  const languageKey = (value: 'ja' | 'zh') => `${key}:${value}:${brief ? 'brief' : 'standard'}`
  const textKey = languageKey(lang)
  const needsPreparation = target?.jobCaseVersion === null
  const valid = Boolean(
    target &&
    !needsPreparation &&
    job?.lifecycle === 'active' &&
    job.status === 'completed' &&
    job.jobCase?.version === target.jobCaseVersion
  )
  useEffect(() => {
    if (!target) return
    let active = true
    const trigger = document.activeElement as HTMLElement | null
    setError('')
    setNotice('')
    setRequestState({})
    setPreparing(needsPreparation)
    dialog.current?.focus()
    void window.sesAgent
      .listBroadcastWorkspace()
      .then((value) => {
        if (!active) return
        setTemplates(value.templates)
        setQueueItem(value.queue.find((item) => item.reviewId === target.reviewId) ?? null)
        setUpdateNotice(null)
      })
      .catch((cause) => {
        if (active) setError(localizedIpcError(locale, cause, t('无法读取文案模板。', '紹介文テンプレートを読み込めませんでした。')))
      })
    if (needsPreparation) {
      const requestKey = `${target.reviewId}:${target.reviewRevision}`
      let request = preparationRequests.current.get(requestKey)
      if (!request) {
        request = window.sesAgent.prepareCaseIntroduction({ reviewId: target.reviewId, expectedReviewRevision: target.reviewRevision! })
        preparationRequests.current.set(requestKey, request)
      }
      void request
        .then((review) => {
          if (active) onPrepared?.(review)
        })
        .catch((cause) => {
          preparationRequests.current.delete(requestKey)
          if (active)
            setError(
              localizedIpcError(locale, cause, t('案件介绍准备失败，请重试。', '案件紹介を準備できませんでした。もう一度お試しください。'))
            )
        })
        .finally(() => {
          if (active) setPreparing(false)
        })
    }
    return () => {
      active = false
      if (trigger?.isConnected) trigger.focus({ preventScroll: true })
    }
  }, [target, onPrepared])
  useEffect(() => {
    if (!target || !template || !valid || generated[key]) {
      setLoading(false)
      return
    }
    let active = true
    setLoading(true)
    setError('')
    void window.sesAgent
      .draftCaseBroadcast({ reviewId: target.reviewId, templateId: template.id })
      .then((value) => {
        if (active) setGenerated((current) => ({ ...current, [key]: value }))
      })
      .catch((cause) => {
        if (active) setError(localizedIpcError(locale, cause, t('无法生成介绍文案。', '紹介文を作成できませんでした。')))
      })
      .finally(() => {
        if (active) setLoading(false)
      })
    return () => {
      active = false
    }
  }, [key, valid, target])
  let initial = (lang === 'ja' ? generated[key]?.textJa : generated[key]?.textZh) ?? ''
  if (brief && template) {
    // Keep every business condition. The brief version only removes the closing greeting and empty lines.
    const footer = (lang === 'ja' ? template.footerJa : template.footerZh).trim()
    initial = initial.trim()
    if (footer && initial.endsWith(footer)) initial = initial.slice(0, -footer.length).trimEnd()
    initial = initial.replace(/\n[ \t]*\n+/gu, '\n')
  }
  const generationInput = target?.jobCaseVersion
    ? {
        kind: 'case' as const,
        id: target.reviewId,
        version: target.jobCaseVersion,
        lang,
        style: brief ? ('brief' as const) : ('standard' as const)
      }
    : null
  const experience = useIntroductionExperience(textKey, generationInput, initial, valid)
  const reviewId = target?.reviewId
  useEffect(() => {
    if (!reviewId || !key || !valid || !window.sesAgent.listCaseIntroductionDrafts) return
    let active = true
    void window.sesAgent
      .listCaseIntroductionDrafts(reviewId)
      .then((stored) => {
        if (!active) return
        // A hand edit made in this session wins over the stored generation it started from.
        const restored = Object.fromEntries(
          stored
            .map((draft) => [`${key}:${draft.lang}:${draft.style}`, draft.text] as const)
            .filter(([draftKey]) => sessionDrafts[draftKey] === undefined)
        )
        if (Object.keys(restored).length) setDrafts(restored)
      })
      .catch((cause) => {
        if (active) setError(localizedIpcError(locale, cause, t('无法读取已保存的介绍。', '保存済みの紹介文を読み込めませんでした。')))
      })
    return () => {
      active = false
    }
  }, [reviewId, key, valid])
  const text = updateNotice ? updateNotice[lang] : (drafts[textKey] ?? experience.text)
  const loadUpdateNotice = async () => {
    if (lock.current || !target || !template) return
    lock.current = true
    setBusy(true)
    setError('')
    setNotice('')
    try {
      const result = await window.sesAgent.draftCaseUpdateNotice({ reviewId: target.reviewId, templateId: template.id })
      if (result.status === 'ready') setUpdateNotice({ ja: result.textJa, zh: result.textZh })
      else
        setNotice(
          result.status === 'no-changes'
            ? t('与上次复制的版本没有差异。', '前回コピーした内容から変更はありません。')
            : t('还没有复制过的版本可以对比。', '比較できるコピー済みバージョンがありません。')
        )
    } catch (cause) {
      setError(localizedIpcError(locale, cause, t('无法生成更新通知。', '更新通知を作成できませんでした。')))
    } finally {
      lock.current = false
      setBusy(false)
    }
  }
  // One request per case and style: it applies to both languages.
  const request = (requests[styleKey] ?? '').trim()
  const regenerate = async () => {
    if (lock.current || !target || target.jobCaseVersion === null || !valid) return
    lock.current = true
    setBusy(true)
    setError('')
    setNotice('')
    try {
      // Both languages are regenerated from the same request, so switching language shows the matching version.
      const generate = (value: 'ja' | 'zh') =>
        window.sesAgent.regenerateIntroduction({
          kind: 'case',
          id: target.reviewId,
          version: target.jobCaseVersion!,
          lang: value,
          style: brief ? 'brief' : 'standard',
          ...(request ? { request } : {})
        })
      const otherLang = lang === 'ja' ? 'zh' : 'ja'
      const [current, other] = await Promise.all([generate(lang), generate(otherLang)])
      experience.replace(current)
      setDrafts({ [languageKey(lang)]: current.text, [languageKey(otherLang)]: other.text })
      // Each generation replaces the stored one; a failed save keeps the new text on screen and says so.
      try {
        await window.sesAgent.saveCaseIntroductionDrafts({
          reviewId: target.reviewId,
          jobCaseVersion: target.jobCaseVersion!,
          style: brief ? 'brief' : 'standard',
          request: request || null,
          drafts: [
            { lang, text: current.text, experienceRunId: current.experienceRunId ?? null },
            { lang: otherLang, text: other.text, experienceRunId: other.experienceRunId ?? null }
          ]
        })
        setNotice(t('AI 已重新生成中日两种语言并保存，可直接编辑。', 'AIで日本語と中国語を再生成して保存しました。そのまま編集できます。'))
      } catch (cause) {
        setError(
          localizedIpcError(
            locale,
            cause,
            t('介绍已生成，但保存失败，请重新生成。', '紹介文は生成しましたが、保存できませんでした。再生成してください。')
          )
        )
      }
    } catch (cause) {
      setError(localizedIpcError(locale, cause, t('AI 重新生成失败，请重试。', 'AIで再生成できませんでした。もう一度お試しください。')))
    } finally {
      lock.current = false
      setBusy(false)
    }
  }
  const submit = async (method: 'copy' | 'email') => {
    if (lock.current || !target || target.jobCaseVersion === null || !template || !valid || !text.trim()) return
    lock.current = true
    setBusy(true)
    setError('')
    setNotice('')
    try {
      const input = {
        reviewId: target.reviewId,
        templateId: template.id,
        expectedJobCaseVersion: target.jobCaseVersion,
        expectedTemplateRevision: template.revision,
        lang,
        kind: updateNotice ? ('update' as const) : ('new' as const),
        text,
        ...(updateNotice ? {} : { experienceRunId: await experience.runId() })
      }
      if (method === 'copy') {
        const checked = await window.sesAgent.validateCaseBroadcastMessage(input)
        await copyTextToClipboard(checked.text)
        await window.sesAgent.recordCaseBroadcastCopy(checked)
        setNotice(t('已复制，可粘贴发送。', 'コピーしました。貼り付けて送信できます。'))
      } else {
        await window.sesAgent.openCaseBroadcastEmail(input)
        setNotice(t('已打开邮件，请选择收件人并发送。', 'メールを開きました。宛先と送信を確認してください。'))
      }
      // Copied or handed to mail: this version is now the baseline, so 「有更新」 is settled — here and in 群发.
      notifyBusinessDataChanged()
      void window.sesAgent
        .listBroadcastWorkspace()
        .then((value) => setQueueItem(value.queue.find((item) => item.reviewId === target.reviewId) ?? null))
        .catch(() => undefined)
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
  if (!target) return null
  return (
    <div className="hr-modal-backdrop">
      <div
        className="hr-introduction"
        role="dialog"
        aria-modal="true"
        aria-label={t('群发案件', '案件を配信')}
        tabIndex={-1}
        ref={dialog}
        onKeyDown={(event) => {
          if (event.key === 'Escape' && !lock.current) onClose()
          if (event.key === 'Tab') {
            const controls = Array.from(
              event.currentTarget.querySelectorAll<HTMLElement>('button:not(:disabled):not([tabindex="-1"]),textarea:not(:disabled)')
            )
            if (event.shiftKey && (document.activeElement === controls[0] || document.activeElement === dialog.current)) {
              event.preventDefault()
              controls.at(-1)?.focus()
            } else if (!event.shiftKey && document.activeElement === controls.at(-1)) {
              event.preventDefault()
              controls[0]?.focus()
            }
          }
        }}
      >
        <header>
          <div>
            <small>{t('案件介绍', '案件紹介')}</small>
            <h2>{t('群发案件', '案件を配信')}</h2>
          </div>
          <button type="button" disabled={busy} aria-label={t('关闭介绍', '紹介画面を閉じる')} onClick={onClose}>
            ×
          </button>
        </header>
        <p className="hr-intro-context">{job?.fields.find((field) => field.key === 'title')?.value ?? job?.redactedSubject}</p>
        {!valid && !needsPreparation ? (
          <p role="alert">
            {t(
              '资料已更新，请重新打开介绍。草稿仍保留。',
              '情報が更新されました。紹介画面を開き直してください。下書きは保持されています。'
            )}
          </p>
        ) : null}
        <IntroductionOptions
          templates={
            templates.length
              ? [
                  { id: templates[0]!.id, label: t('标准', '標準') },
                  { id: 'brief', label: t('省略', '簡潔') },
                  ...templates.slice(1).map((item) => ({ id: item.id, label: item.name }))
                ]
              : []
          }
          templateId={brief ? 'brief' : (template?.id ?? '')}
          lang={lang}
          disabled={busy}
          panelId={panelId}
          onTemplateChange={setTemplateId}
          onLanguageChange={setLang}
        />
        <div className="hr-intro-generation">
          <textarea
            className="ai-request-input"
            aria-label={t('对 AI 的要求', 'AIへの要望')}
            placeholder={t(
              '例：突出远程和长期稳定，或粘贴一篇参考范文',
              '例：リモート可と長期案件である点を強調して。参考にする文例を貼り付けることもできます'
            )}
            rows={2}
            maxLength={introductionRequestMaxLength}
            disabled={busy || !valid}
            value={requests[styleKey] ?? ''}
            onChange={(event) => setRequestState((state) => ({ ...state, [styleKey]: event.target.value }))}
          />
          <button type="button" disabled={busy || !valid} onClick={() => void regenerate()}>
            {busy ? t('处理中', '処理中') : t('AI 重新生成', 'AIで再生成')}
          </button>
        </div>
        {queueItem?.hasUpdateSinceLastCopy && valid ? (
          <p className="hr-intro-update" role="status">
            {updateNotice
              ? t('当前是更新通知，只列出上次复制后改动的条件。', '更新通知です。前回コピー以降に変わった条件だけを記載しています。')
              : t(
                  '上次复制后案件有更新：可以重发完整介绍，或只发更新通知。',
                  '前回コピー後に案件が更新されています。紹介文を再送するか、更新通知だけを送れます。'
                )}
            <button type="button" disabled={busy} onClick={() => (updateNotice ? setUpdateNotice(null) : void loadUpdateNotice())}>
              {updateNotice ? t('改回完整介绍', '紹介文に戻す') : t('生成更新通知', '更新通知を作る')}
            </button>
          </p>
        ) : null}
        <div role="tabpanel" id={panelId} aria-label={t('介绍文案', '紹介文')} className="hr-intro-body">
          <textarea
            aria-label={t('介绍文案', '紹介文')}
            disabled={busy || loading || !valid}
            value={text}
            onChange={(event) => {
              if (updateNotice) {
                setUpdateNotice({ ...updateNotice, [lang]: event.target.value })
                return
              }
              experience.markEdited()
              setDrafts({ [textKey]: event.target.value })
            }}
          />
        </div>
        {loading || preparing ? <p role="status">{t('正在准备…', '準備中…')}</p> : null}
        {error ? <p role="alert">{error}</p> : null}
        {notice ? <p role="status">{notice}</p> : null}
        <footer>
          <small>{t('复制和打开邮件不会记为已发送。', 'コピーやメールを開く操作は送信済みになりません。')}</small>
          <button type="button" disabled={busy || loading || !valid || !text.trim()} onClick={() => void submit('email')}>
            {t('打开邮件', 'メールを開く')}
          </button>
          <button
            type="button"
            className="hr-primary"
            disabled={busy || loading || !valid || !text.trim()}
            onClick={() => void submit('copy')}
          >
            {t('复制介绍', '紹介文をコピー')}
          </button>
        </footer>
      </div>
    </div>
  )
}
