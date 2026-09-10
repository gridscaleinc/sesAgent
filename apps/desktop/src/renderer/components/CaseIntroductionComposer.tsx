import { useEffect, useId, useRef, useState } from 'react'
import type { BroadcastTemplate, DraftCaseBroadcastResult, JobCaseReviewSnapshot } from '@shared'
import { useUiLocale } from '../i18n'
import { copyTextToClipboard } from '../copy-text'
import { IntroductionOptions } from './IntroductionOptions'

export interface CaseIntroductionTarget { reviewId: string; jobCaseVersion: number | null; reviewRevision?: number }
export function CaseIntroductionComposer({ target, cases, onClose, onPrepared }: {
  target: CaseIntroductionTarget | null; cases: JobCaseReviewSnapshot[]; onClose(): void; onPrepared?(review: JobCaseReviewSnapshot): void
}) {
  const zh = useUiLocale() === 'zh-CN'; const t = (cn: string, ja: string) => zh ? cn : ja
  const [templates, setTemplates] = useState<BroadcastTemplate[]>([])
  const [templateId, setTemplateId] = useState('')
  const [lang, setLang] = useState<'ja' | 'zh'>('ja')
  const [drafts, setDrafts] = useState<Record<string, string>>({})
  const [generated, setGenerated] = useState<Record<string, DraftCaseBroadcastResult>>({})
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
  const textKey = `${key}:${lang}:${brief ? 'brief' : 'standard'}`
  const needsPreparation = target?.jobCaseVersion === null
  const valid = Boolean(target && !needsPreparation && job?.lifecycle === 'active' && job.status === 'completed' && job.jobCase?.version === target.jobCaseVersion)
  useEffect(() => {
    if (!target) return
    let active = true
    const trigger = document.activeElement as HTMLElement | null
    setError(''); setNotice('')
    setPreparing(needsPreparation)
    dialog.current?.focus()
    void window.sesAgent.listBroadcastWorkspace().then((value) => { if (active) setTemplates(value.templates) }).catch((cause) => { if (active) setError(String(cause)) })
    if (needsPreparation) {
      const requestKey = `${target.reviewId}:${target.reviewRevision}`
      let request = preparationRequests.current.get(requestKey)
      if (!request) {
        request = window.sesAgent.prepareCaseIntroduction({ reviewId: target.reviewId, expectedReviewRevision: target.reviewRevision! })
        preparationRequests.current.set(requestKey, request)
      }
      void request.then((review) => { if (active) onPrepared?.(review) })
        .catch((cause) => { preparationRequests.current.delete(requestKey); if (active) setError(String(cause)) })
        .finally(() => { if (active) setPreparing(false) })
    }
    return () => { active = false; if (trigger?.isConnected) trigger.focus({ preventScroll: true }) }
  }, [target, onPrepared])
  useEffect(() => {
    if (!target || !template || !valid || generated[key]) { setLoading(false); return }
    let active = true
    setLoading(true); setError('')
    void window.sesAgent.draftCaseBroadcast({ reviewId: target.reviewId, templateId: template.id })
      .then((value) => { if (active) setGenerated((current) => ({ ...current, [key]: value })) })
      .catch((cause) => { if (active) setError(String(cause)) }).finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [key, valid, target])
  let initial = (lang === 'ja' ? generated[key]?.textJa : generated[key]?.textZh) ?? ''
  if (brief && template) {
    // Keep every business condition. The brief version only removes the closing greeting and empty lines.
    const footer = (lang === 'ja' ? template.footerJa : template.footerZh).trim()
    initial = initial.trim()
    if (footer && initial.endsWith(footer)) initial = initial.slice(0, -footer.length).trimEnd()
    initial = initial.replace(/\n[ \t]*\n+/gu, '\n')
  }
  const text = drafts[textKey] ?? initial
  const regenerate = async () => {
    if (lock.current || !target || target.jobCaseVersion === null || !valid) return
    lock.current = true; setBusy(true); setError(''); setNotice('')
    try {
      const result = await window.sesAgent.regenerateIntroduction({ kind: 'case', id: target.reviewId, version: target.jobCaseVersion, lang, style: brief ? 'brief' : 'standard' })
      setDrafts((current) => ({ ...current, [textKey]: result.text }))
      setNotice(t('AI 已重新生成，可直接编辑。', 'AIで再生成しました。そのまま編集できます。'))
    } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)) }
    finally { lock.current = false; setBusy(false) }
  }
  const submit = async (method: 'copy' | 'email') => {
    if (lock.current || !target || target.jobCaseVersion === null || !template || !valid || !text.trim()) return
    lock.current = true; setBusy(true); setError(''); setNotice('')
    try {
      const input = { reviewId: target.reviewId, templateId: template.id, expectedJobCaseVersion: target.jobCaseVersion,
        expectedTemplateRevision: template.revision, lang, kind: 'new' as const, text }
      if (method === 'copy') {
        const checked = await window.sesAgent.validateCaseBroadcastMessage(input)
        await copyTextToClipboard(checked.text)
        await window.sesAgent.recordCaseBroadcastCopy(checked)
        setNotice(t('已复制，可粘贴发送。', 'コピーしました。貼り付けて送信できます。'))
      } else {
        await window.sesAgent.openCaseBroadcastEmail(input)
        setNotice(t('已打开邮件，请选择收件人并发送。', 'メールを開きました。宛先と送信を確認してください。'))
      }
    } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)) }
    finally { lock.current = false; setBusy(false) }
  }
  if (!target) return null
  return <div className="hr-modal-backdrop"><div className="hr-introduction" role="dialog" aria-modal="true" aria-label={t('准备介绍', '紹介を準備')} tabIndex={-1} ref={dialog} onKeyDown={(event) => {
    if (event.key === 'Escape' && !lock.current) onClose()
    if (event.key === 'Tab') {
      const controls = Array.from(event.currentTarget.querySelectorAll<HTMLElement>('button:not(:disabled):not([tabindex="-1"]),textarea:not(:disabled)'))
      if (event.shiftKey && (document.activeElement === controls[0] || document.activeElement === dialog.current)) { event.preventDefault(); controls.at(-1)?.focus() }
      else if (!event.shiftKey && document.activeElement === controls.at(-1)) { event.preventDefault(); controls[0]?.focus() }
    }
  }}>
    <header><div><small>{t('案件介绍', '案件紹介')}</small><h2>{t('准备介绍', '紹介を準備')}</h2></div><button type="button" disabled={busy} aria-label={t('关闭介绍', '紹介画面を閉じる')} onClick={onClose}>×</button></header>
    <p className="hr-intro-context">{job?.fields.find((field) => field.key === 'title')?.value ?? job?.redactedSubject}</p>
    {!valid && !needsPreparation ? <p role="alert">{t('资料已更新，请重新打开介绍。草稿仍保留。', '情報が更新されました。紹介画面を開き直してください。下書きは保持されています。')}</p> : null}
    <IntroductionOptions templates={templates.length ? [
      { id: templates[0]!.id, label: t('标准', '標準') }, { id: 'brief', label: t('省略', '簡潔') },
      ...templates.slice(1).map((item) => ({ id: item.id, label: item.name }))] : []}
      templateId={brief ? 'brief' : template?.id ?? ''} lang={lang} disabled={busy} panelId={panelId} onTemplateChange={setTemplateId} onLanguageChange={setLang} />
    <div className="hr-intro-generation"><button type="button" disabled={busy || !valid} onClick={() => void regenerate()}>{busy ? t('处理中', '処理中') : t('AI 重新生成', 'AIで再生成')}</button></div>
    <div role="tabpanel" id={panelId} aria-label={t('介绍文案', '紹介文')} className="hr-intro-body"><textarea aria-label={t('介绍文案', '紹介文')} disabled={busy || loading || !valid} value={text} onChange={(event) => setDrafts((current) => ({ ...current, [textKey]: event.target.value }))} /></div>
    {loading || preparing ? <p role="status">{t('正在准备…', '準備中…')}</p> : null}{error ? <p role="alert">{error}</p> : null}{notice ? <p role="status">{notice}</p> : null}
    <footer><small>{t('复制和打开邮件不会记为已发送。', 'コピーやメールを開く操作は送信済みになりません。')}</small><button type="button" disabled={busy || loading || !valid || !text.trim()} onClick={() => void submit('email')}>{t('打开邮件', 'メールを開く')}</button><button type="button" className="hr-primary" disabled={busy || loading || !valid || !text.trim()} onClick={() => void submit('copy')}>{t('复制介绍', '紹介文をコピー')}</button></footer>
  </div></div>
}
