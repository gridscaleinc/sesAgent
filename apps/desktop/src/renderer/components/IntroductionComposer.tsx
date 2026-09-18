import { useIntroductionExperience } from './use-introduction-experience'
import { useEffect, useId, useRef, useState } from 'react'
import { generatePersonnelMessage, generatePersonnelProposal, type CandidateReviewSnapshot, type JobCaseReviewSnapshot, type PersonnelTemplate } from '@shared'
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
  const [subjects, setSubjects] = useState<Record<string, string>>({})
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
  const valid = Boolean(target && person && person.recordStatus !== 'deleted' && (person.recordStatus === 'active' || Boolean(target.reviewId)) && person.profile?.version === target.profileVersion
    && (!target.reviewId || (job?.lifecycle === 'active' && job.jobCase?.version === target.jobCaseVersion)))
  const key = target ? `${target.documentId}:${target.profileVersion}:${target.reviewId ?? 'general'}:${target.jobCaseVersion ?? 0}:${template?.id}:${template?.revision}:${lang}` : ''
  const proposal = person ? generatePersonnelProposal(person, job, lang, template?.id === briefTemplateId) : null
  const subject = subjects[key] ?? proposal?.subject ?? ''
  const initial = () => {
    if (!person || !template || !target) return ''
    return template.id === standardTemplateId || template.id === briefTemplateId ? proposal?.text ?? '' : generatePersonnelMessage(person, template, lang)
  }
  const generationInput=target?{kind:'person' as const,id:target.documentId,version:target.profileVersion,lang,style:template?.id===briefTemplateId?'brief' as const:'standard' as const,...(target.reviewId&&target.jobCaseVersion?{caseContext:{reviewId:target.reviewId,version:target.jobCaseVersion}}:{})}:null
  const experience=useIntroductionExperience(key,generationInput,initial(),valid,true)
  const working = busy || experience.generating
  const text = drafts[key] ?? experience.text
  const missingFields = proposal?.missingFields.filter(label => text.includes(`${label}：${lang === 'ja' ? '[送信前に記入]' : '[发送前填写]'}`)) ?? []
  const regenerate = async () => {
    if (lock.current || experience.generating || !target || !valid) return
    lock.current = true; setBusy(true); setError(''); setNotice('')
    try {
      const result = await window.sesAgent.regenerateIntroduction({ kind: 'person', id: target.documentId, version: target.profileVersion, lang, style: template?.id === briefTemplateId ? 'brief' : 'standard', ...(target.reviewId && target.jobCaseVersion ? { caseContext: { reviewId: target.reviewId, version: target.jobCaseVersion } } : {}) })
      experience.replace(result)
      setDrafts((current) => ({ ...current, [key]: result.text }))
      setNotice(t('AI 已重新生成，可直接编辑。', 'AIで再生成しました。そのまま編集できます。'))
    } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)) }
    finally { lock.current = false; setBusy(false) }
  }
  const submit = async (method: 'copy' | 'email' | 'subject') => {
    if (lock.current || !valid || !target || !template || !person) return
    lock.current = true; setBusy(true); setNotice(''); setError('')
    try {
      const input = { documentId: target.documentId, profileVersion: target.profileVersion, reviewRevision: person.reviewRevision,
        ...(target.reviewId && target.jobCaseVersion ? { caseContext: { reviewId: target.reviewId, version: target.jobCaseVersion } } : {}),
        templateId: template.id, templateRevision: template.revision, lang, subject, text, experienceRunId:await experience.runId() }
      if (method === 'copy' || method === 'subject') {
        const validated = await window.sesAgent.validatePersonnelMessage(input)
        await copyTextToClipboard(method === 'subject' ? validated.subject ?? subject : validated.text)
        if (method === 'copy') await window.sesAgent.recordPersonnelCopy(validated)
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
        const items = Array.from(event.currentTarget.querySelectorAll<HTMLElement>('button:not(:disabled):not([tabindex="-1"]),textarea:not(:disabled),input:not(:disabled)'))
        const first = items[0]; const last = items.at(-1)
        if (event.shiftKey && (document.activeElement === first || document.activeElement === dialog.current)) { event.preventDefault(); last?.focus() }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus() }
      }
    }}>
    <header><div><small>{job ? t('针对当前案件', 'この案件向け') : t('人员推广', '要員紹介')}</small><h2>{t('准备介绍', '紹介を準備')}</h2></div><button type="button" aria-label={t('关闭介绍', '紹介画面を閉じる')} disabled={busy} onClick={onClose}>×</button></header>
    <p className="hr-intro-context">{person?.localIdentity?.displayName ?? person?.fileName}{job ? ` → ${job.fields.find((item) => item.key === 'title')?.value ?? job.redactedSubject}` : ''}</p>
    <label className="hr-intro-subject">{t('邮件主题', 'メール件名')}<input aria-label={t('邮件主题', 'メール件名')} value={subject} maxLength={240} disabled={busy} onChange={event => setSubjects(state => ({ ...state, [key]: event.target.value.replace(/[\r\n]/gu, '') }))} /></label>
    <button type="button" disabled={working || !valid || !subject.trim()} onClick={() => void submit('subject')}>{t('复制主题', '件名をコピー')}</button>
    {missingFields.length ? <aside className="hr-intro-pending"><strong>{t('发送前补充', '送信前に補足')}</strong><p>{missingFields.join('、')}</p><small>{t('正文中的占位符请按实际情况补齐。打开邮件后，请添加收件人称呼并附上技能简历。', '本文の未記入欄を実情に合わせて補足してください。メールを開いた後、宛名を記入し、スキルシートを添付してください。')}</small></aside> : null}
    {target.pendingConditions?.length ? <aside className="hr-intro-pending" aria-label={t('还需沟通', '相談する内容')}><small>{t('内部沟通备忘，不写入邮件正文', '社内の相談メモ（メール本文には含めません）')}：{target.pendingConditions.join(' / ')}</small></aside> : null}
    {!valid ? <p role="alert">{t('资料已更新或不可用。草稿已保留，请关闭后重新匹配或打开人员资料。', '情報が更新されたか利用できません。下書きは保持されています。再マッチングするか要員情報を開いてください。')}</p> : null}
    <IntroductionOptions templates={[...templates].sort((a, b) => Number(b.id === standardTemplateId) - Number(a.id === standardTemplateId)).map((item) => ({ id: item.id,
      label: item.id === standardTemplateId ? t('标准', '標準') : item.id === briefTemplateId ? t('省略', '簡潔') : item.name }))}
      templateId={template?.id ?? ''} lang={lang} disabled={busy} panelId={panelId} onTemplateChange={setTemplateId} onLanguageChange={setLang} />
    {experience.generating ? <p role="status">{t('正在结合案件要求、项目技术和实际职责生成提案文…', '案件要件・使用技術・担当業務をもとに提案文を生成しています…')}</p> : null}
    <div className="hr-intro-generation"><button type="button" disabled={working || !valid} onClick={() => void regenerate()}>{working ? t('云端 AI 正在生成…', 'Cloud AIで生成中…') : t('AI 重新生成', 'AIで再生成')}</button></div>
    <div role="tabpanel" id={panelId} aria-label={t('介绍文案', '紹介文')} className="hr-intro-body"><textarea aria-label={t('介绍文案', '紹介文')} value={text} onChange={(event) => {experience.markEdited();setDrafts((state) => ({ ...state, [key]: event.target.value }))}} disabled={working} /></div>
    {error || experience.error ? <p role="alert">{error || experience.error}</p> : null}{notice ? <p role="status">{notice}</p> : null}
    <footer>{target.reviewId ? <button type="button" disabled={working || !valid} onClick={() => { if (busy) return; setBusy(true); void Promise.resolve(onFollowUp({ documentId: target.documentId, reviewId: target.reviewId!, ...(target.pendingConditions ? { pendingConditions: target.pendingConditions } : {}) })).catch((cause) => setError(String(cause))).finally(() => setBusy(false)) }}>{t('安排面试', '面談を予約')}</button> : null}<small>{t('复制和打开邮件不会记为已发送。', 'コピーやメールを開く操作は送信済みになりません。')}</small><button disabled={working || !valid || !template || !text.trim()} type="button" onClick={() => void submit('email')}>{t('打开邮件', 'メールを開く')}</button><button className="hr-primary" disabled={working || !valid || !template || !text.trim()} type="button" onClick={() => void submit('copy')}>{t('复制介绍', '紹介文をコピー')}</button></footer>
  </div></div>
}
