import { useEffect, useId, useRef, useState } from 'react'
import { generatePersonnelMessage, reviewMatchAssessmentEvidence, type CandidateReviewSnapshot, type JobCaseReviewSnapshot, type PersonnelTemplate } from '@shared'
import { useUiLocale } from '../i18n'
import { copyTextToClipboard } from '../copy-text'
import type { IntroductionTarget } from './HrMatchingWorkspace'
import type { FollowUpTarget } from './HrFollowUps'
import { IntroductionOptions } from './IntroductionOptions'

const briefTemplateId = 'e72e12d0-0000-4000-8000-000000000001'
const standardTemplateId = 'e72e12d0-0000-4000-8000-000000000002'

export function IntroductionComposer({ target, people, cases, onClose, onFollowUp }: {
  onFollowUp(target: FollowUpTarget): void | Promise<void>
  target: IntroductionTarget | null; people: CandidateReviewSnapshot[]; cases: JobCaseReviewSnapshot[]; onClose(): void
}) {
  const zh = useUiLocale() === 'zh-CN'; const t = (cn: string, ja: string) => zh ? cn : ja
  const [templates, setTemplates] = useState<PersonnelTemplate[]>([])
  const [templateId, setTemplateId] = useState(standardTemplateId)
  const [lang, setLang] = useState<'ja' | 'zh'>('ja')
  const [drafts, setDrafts] = useState<Record<string, string>>({})
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState('')
  const [error, setError] = useState('')
  const lock = useRef(false)
  const dialog = useRef<HTMLDivElement>(null)
  const panelId = useId()
  useEffect(() => {
    if (!target) return
    let active = true
    const trigger = document.activeElement as HTMLElement | null
    setNotice(''); setError('')
    void window.sesAgent.getPersonnelWorkspace().then((value) => { if (active) setTemplates(value.templates) }).catch((cause) => { if (active) setError(String(cause)) })
    dialog.current?.focus()
    return () => { active = false; if (trigger?.isConnected) trigger.focus({ preventScroll: true }) }
  }, [target])
  const person = people.find((item) => item.documentId === target?.documentId)
  const job = cases.find((item) => item.reviewId === target?.reviewId)
  const template = templates.find((item) => item.id === templateId) ?? templates[0]
  const valid = Boolean(target && person?.recordStatus === 'active' && person.profile?.version === target.profileVersion
    && (!target.reviewId || (job?.lifecycle === 'active' && job.jobCase?.version === target.jobCaseVersion)))
  const key = target ? `${target.documentId}:${target.profileVersion}:${target.reviewId ?? 'general'}:${target.jobCaseVersion ?? 0}:${template?.id}:${template?.revision}:${lang}` : ''
  const initial = () => {
    if (!person || !template || !target) return ''
    const general = generatePersonnelMessage(person, template, lang)
    if (!job) return general
    const title = job.fields.find((item) => item.key === 'title')?.value ?? job.redactedSubject
    const assessment = target.assessment ? reviewMatchAssessmentEvidence(target.assessment).assessment : null
    const evidence = assessment?.met.map((item) => `${item.requirement}：${item.evidence}`) ?? target.matched
    const confirms = target.pendingConditions ?? assessment?.confirm ?? []
    return [lang === 'ja' ? `【案件向け要員紹介】${title}` : `【案件人员介绍】${title}`, general,
      evidence.length ? `${lang === 'ja' ? '関連経験・一致の根拠' : '相关经验与匹配依据'}：\n${evidence.map((line) => `・${line}`).join('\n')}` : '',
      confirms.length ? `${lang === 'ja' ? '要確認' : '待确认'}：${confirms.join(' / ')}` : ''].filter(Boolean).join('\n\n')
  }
  const text = drafts[key] ?? initial()
  const regenerate = async () => {
    if (lock.current || !target || !valid) return
    lock.current = true; setBusy(true); setError(''); setNotice('')
    try {
      const result = await window.sesAgent.regenerateIntroduction({ kind: 'person', id: target.documentId, version: target.profileVersion, lang, style: template?.id === briefTemplateId ? 'brief' : 'standard', ...(target.reviewId && target.jobCaseVersion ? { caseContext: { reviewId: target.reviewId, version: target.jobCaseVersion } } : {}) })
      setDrafts((current) => ({ ...current, [key]: result.text }))
      setNotice(t('AI 已重新生成，可直接编辑。', 'AIで再生成しました。そのまま編集できます。'))
    } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)) }
    finally { lock.current = false; setBusy(false) }
  }
  const submit = async (method: 'copy' | 'email') => {
    if (lock.current || !valid || !target || !template || !person) return
    lock.current = true; setBusy(true); setNotice(''); setError('')
    try {
      const input = { documentId: target.documentId, profileVersion: target.profileVersion, reviewRevision: person.reviewRevision,
        ...(target.reviewId && target.jobCaseVersion ? { caseContext: { reviewId: target.reviewId, version: target.jobCaseVersion } } : {}),
        templateId: template.id, templateRevision: template.revision, lang, text }
      if (method === 'copy') {
        const validated = await window.sesAgent.validatePersonnelMessage(input)
        await copyTextToClipboard(validated.text)
        await window.sesAgent.recordPersonnelCopy(validated)
        setNotice(t('已复制，可粘贴发送。', 'コピーしました。貼り付けて送信できます。'))
      } else { const result = await window.sesAgent.openPersonnelEmail(input); setNotice(result.recipientPrefilled ? t('已打开邮件并带入案件回复地址，请核对后发送。', '案件の返信先を入れてメールを開きました。宛先を確認して送信してください。') : t('已打开邮件。未找到案件回复地址，请选择收件人后发送。', 'メールを開きました。案件の返信先が見つからないため宛先を選択してください。')) }
    } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)) }
    finally { lock.current = false; setBusy(false) }
  }
  if (!target) return null
  return <div className="hr-modal-backdrop"><div role="dialog" aria-modal="true" aria-label={t('准备介绍', '紹介を準備')} className="hr-introduction" ref={dialog} tabIndex={-1}
    onKeyDown={(event) => {
      if (event.key === 'Escape' && !lock.current) onClose()
      if (event.key === 'Tab') {
        const items = Array.from(event.currentTarget.querySelectorAll<HTMLElement>('button:not(:disabled):not([tabindex="-1"]),textarea:not(:disabled)'))
        const first = items[0]; const last = items.at(-1)
        if (event.shiftKey && (document.activeElement === first || document.activeElement === dialog.current)) { event.preventDefault(); last?.focus() }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus() }
      }
    }}>
    <header><div><small>{job ? t('针对当前案件', 'この案件向け') : t('人员推广', '要員紹介')}</small><h2>{t('准备介绍', '紹介を準備')}</h2></div><button type="button" aria-label={t('关闭介绍', '紹介画面を閉じる')} disabled={busy} onClick={onClose}>×</button></header>
    <p className="hr-intro-context">{person?.localIdentity?.displayName ?? person?.fileName}{job ? ` → ${job.fields.find((item) => item.key === 'title')?.value ?? job.redactedSubject}` : ''}</p>
    {target.pendingConditions?.length ? <aside className="hr-intro-pending" aria-label={t('还需沟通', '相談する内容')}><strong>{t('还需沟通', '相談する内容')}</strong><ul>{target.pendingConditions.map((condition) => <li key={condition}>{condition}</li>)}</ul></aside> : null}
    {!valid ? <p role="alert">{t('资料已更新或不可用。草稿已保留，请关闭后重新匹配或打开人员资料。', '情報が更新されたか利用できません。下書きは保持されています。再マッチングするか要員情報を開いてください。')}</p> : null}
    <IntroductionOptions templates={[...templates].sort((a, b) => Number(b.id === standardTemplateId) - Number(a.id === standardTemplateId)).map((item) => ({ id: item.id,
      label: item.id === standardTemplateId ? t('标准', '標準') : item.id === briefTemplateId ? t('省略', '簡潔') : item.name }))}
      templateId={template?.id ?? ''} lang={lang} disabled={busy} panelId={panelId} onTemplateChange={setTemplateId} onLanguageChange={setLang} />
    <div className="hr-intro-generation"><button type="button" disabled={busy || !valid} onClick={() => void regenerate()}>{busy ? t('处理中', '処理中') : t('AI 重新生成', 'AIで再生成')}</button></div>
    <div role="tabpanel" id={panelId} aria-label={t('介绍文案', '紹介文')} className="hr-intro-body"><textarea aria-label={t('介绍文案', '紹介文')} value={text} onChange={(event) => setDrafts((state) => ({ ...state, [key]: event.target.value }))} disabled={busy} /></div>
    {error ? <p role="alert">{error}</p> : null}{notice ? <p role="status">{notice}</p> : null}
    <footer>{target.reviewId ? <button type="button" disabled={busy || !valid} onClick={() => { if (busy) return; setBusy(true); void Promise.resolve(onFollowUp({ documentId: target.documentId, reviewId: target.reviewId!, ...(target.pendingConditions ? { pendingConditions: target.pendingConditions } : {}) })).catch((cause) => setError(String(cause))).finally(() => setBusy(false)) }}>{t('安排面试', '面談を予約')}</button> : null}<small>{t('复制和打开邮件不会记为已发送。', 'コピーやメールを開く操作は送信済みになりません。')}</small><button disabled={busy || !valid || !template || !text.trim()} type="button" onClick={() => void submit('email')}>{t('打开邮件', 'メールを開く')}</button><button className="hr-primary" disabled={busy || !valid || !template || !text.trim()} type="button" onClick={() => void submit('copy')}>{t('复制介绍', '紹介文をコピー')}</button></footer>
  </div></div>
}
