import { useEffect, useMemo, useRef, useState } from 'react'
import { generatePersonnelMessage, isPersonnelAvailable, type CandidateReviewSnapshot, type PersonnelWorkspace as Workspace,
  type PersonnelTemplate, type PersonnelCaseMatchResult, type PersonnelMessageInput,
  type CandidateBusinessStatus } from '@shared'
import { useUiLocale } from '../i18n'
import { copyTextToClipboard } from '../copy-text'
import { Icon } from './Icon'
import { CandidateProfileSummary } from './CandidateProfileSummary'
import { MatchAssessmentView } from './MatchAssessmentView'

interface Props {
  compact?: boolean
  onOpenEditor?(request: PersonnelEditorTarget): void
  editorRequest?: PersonnelEditorTarget & { id: number }
  messageDrafts?: PersonnelMessageDrafts
  onSelectPerson?(documentId: string): void
  matchRequest?: { id: number; documentId: string }
  focusRequest?: { id: number; documentId: string; section: 'view' | 'match' | 'promote' }
  onMatchingChange?(documentId: string | null): void

  reviews: CandidateReviewSnapshot[]; initialDocumentId?: string; onRefresh(): Promise<void>
  onOpenCase(reviewId: string): void
  onOpenProfile(documentId: string): void
}

export interface PersonnelEditorTarget {
  documentId: string
  templateId?: string
  lang?: 'ja' | 'zh'
}

export interface PersonnelMessageDrafts {
  values: Record<string, string>
  onChange(key: string, text: string): void
}

export function PersonnelWorkspace({ onSelectPerson, compact = false, onOpenEditor, editorRequest, messageDrafts, matchRequest, focusRequest, onMatchingChange, reviews, initialDocumentId, onRefresh, onOpenCase, onOpenProfile }: Props) {
  const zh = useUiLocale() === 'zh-CN'
  const t = (cn: string, ja: string) => zh ? cn : ja
  const [savedReviews, setSavedReviews] = useState<Record<string, CandidateReviewSnapshot>>({})
  const [affiliationStatus, setAffiliationStatus] = useState<{ documentId: string; text: string; failed?: boolean } | null>(null)
  const [workspace, setWorkspace] = useState<Workspace | null>(null)
  const [selectedId, setSelectedId] = useState(initialDocumentId ?? '')
  const [query, setQuery] = useState('')
  const [onlyPending, setOnlyPending] = useState(false)
  const [businessFilter, setBusinessFilter] = useState<'available' | 'all' | 'assigned' | 'paused'>('available')
  const [templateId, setTemplateId] = useState('')
  const [lang, setLang] = useState<'ja' | 'zh'>('ja')
  const [localEdits, setLocalEdits] = useState<Record<string, string>>({})
  const edits = messageDrafts?.values ?? localEdits
  const editMessage = (key: string, text: string) => {
    if (messageDrafts) messageDrafts.onChange(key, text)
    else setLocalEdits((current) => ({ ...current, [key]: text }))
  }
  const [checkedIds, setCheckedIds] = useState<Set<string>>(new Set())
  const [matchesByPerson, setMatchesByPerson] = useState<Record<string, PersonnelCaseMatchResult>>({})
  const [selectedCases, setSelectedCases] = useState<Record<string, string>>({})
  const [matchingDocumentId, setMatchingDocumentId] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [templateDraft, setTemplateDraft] = useState<PersonnelTemplate | null>(null)
  const actionPending = useRef(false)
  const detailSection = useRef<HTMLDivElement>(null)
  const promotionSection = useRef<HTMLElement>(null)
  const matchSection = useRef<HTMLDivElement>(null)
  const appliedFocus = useRef('')
  const appliedMatch = useRef<number | null>(null)
  const loadSequence = useRef(0)
  const load = async () => {
    const sequence = ++loadSequence.current
    const value = await window.sesAgent.getPersonnelWorkspace()
    if (sequence === loadSequence.current) setWorkspace(value)
  }
  useEffect(() => { let active = true; void load().catch((cause) => { if (active) setError(String(cause)) }); return () => { active = false; loadSequence.current++ } }, [reviews])
  useEffect(() => { if (initialDocumentId) setSelectedId(initialDocumentId) }, [initialDocumentId])
  useEffect(() => {
    setNotice(null); setError(null)
  }, [initialDocumentId])
  useEffect(() => {
    if (!editorRequest || compact) return
    setSelectedId(editorRequest.documentId)
    setBusinessFilter('all'); setQuery(''); setOnlyPending(false)
    if (editorRequest.templateId) setTemplateId(editorRequest.templateId)
    if (editorRequest.lang) setLang(editorRequest.lang)
    setTemplateDraft(null); setNotice(null); setError(null)
  }, [editorRequest, compact])
  const activeReviews = reviews.filter((item) => item.recordStatus === 'active').map((item) => {
    const saved = savedReviews[item.documentId]
    return saved && (saved.profile?.version ?? 0) > (item.profile?.version ?? 0) ? saved : item
  })
  const copyByPerson = useMemo(() => {
    const map = new Map<string, number>()
    for (const copy of workspace?.copies ?? []) map.set(copy.documentId, Math.max(map.get(copy.documentId) ?? 0, copy.profileVersion))
    return map
  }, [workspace?.copies])
  const statusOf = (review: CandidateReviewSnapshot) => workspace?.states.find((state) => state.documentId === review.documentId)?.status ?? 'available'
  const availableReviews = activeReviews.filter((review) => isPersonnelAvailable(statusOf(review)))
  const visible = (workspace ? activeReviews : []).filter((review) => (businessFilter === 'all' || (businessFilter === 'available' ? isPersonnelAvailable(statusOf(review)) : statusOf(review) === businessFilter)) && (!query || [review.localIdentity?.displayName, review.fileName, ...review.fields.map((field) => field.value)].join(' ').toLowerCase().includes(query.toLowerCase())) &&
    (!onlyPending || (copyByPerson.get(review.documentId) ?? 0) < (review.profile?.version ?? 1)))
  const selected = compact ? activeReviews.find((item) => item.documentId === initialDocumentId) ?? null
    : activeReviews.find((item) => item.documentId === selectedId) ?? visible[0] ?? null
  const cachedMatches = selected ? matchesByPerson[selected.documentId] : undefined
  const matches = cachedMatches?.profileVersion === selected?.profile?.version ? cachedMatches : undefined
  const template = workspace?.templates.find((item) => item.id === templateId) ?? workspace?.templates[0]
  const ready = (review: CandidateReviewSnapshot) => Boolean(workspace) && review.recordStatus === 'active' && isPersonnelAvailable(statusOf(review)) && Boolean(review.profile)
  const statusLabel = (status: CandidateBusinessStatus) => ({ available: t('待营业', '営業待ち'), soon: t('近期可入场', '近日稼働可能'), assigned: t('已入场', '参画中'), paused: t('不可营业', '営業不可') })[status]
  const readinessNote = selected && workspace && !isPersonnelAvailable(statusOf(selected))
    ? t('此人员已入场或暂停营业，可在人员管理中调整。', 'この要員は参画中または営業停止中です。要員管理で変更できます。') : null
  const label = (review: CandidateReviewSnapshot) => review.localIdentity?.displayName ?? review.fileName.replace(/\.[^.]+$/u, '')
  const editKey = (review: CandidateReviewSnapshot) => `${review.documentId}:${review.profile?.version}:${template?.id}:${template?.revision}:${lang}`
  const message = (review: CandidateReviewSnapshot) => edits[editKey(review)] ?? (template ? generatePersonnelMessage(review, template, lang) : '')
  const input = (review: CandidateReviewSnapshot): PersonnelMessageInput => ({ documentId: review.documentId, profileVersion: review.profile!.version, reviewRevision: review.reviewRevision,
    templateId: template!.id, templateRevision: template!.revision, lang, text: message(review) })
  const action = async (operation: () => Promise<void>) => {
    if (actionPending.current) return
    actionPending.current = true
    setBusy(true); setError(null); setNotice(null)
    try { await operation() } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)) } finally { actionPending.current = false; setBusy(false) }
  }
  const saveOwnCompany = (review: CandidateReviewSnapshot, value: boolean | null) => {
    if (!review.profile || (review.isOwnCompany ?? null) === value) return
    void action(async () => {
      const documentId = review.documentId
      setAffiliationStatus({ documentId, text: t('保存中…', '保存中…') })
      try {
        const updated = await window.sesAgent.setCandidateOwnCompany({ documentId, expectedVersion: review.profile!.version, isOwnCompany: value })
        setSavedReviews((current) => ({ ...current, [documentId]: updated }))
        setMatchesByPerson((current) => { const next = { ...current }; delete next[documentId]; return next })
        setAffiliationStatus({ documentId, text: t('已保存', '保存しました') })
        try { await onRefresh() } catch {
          setAffiliationStatus({ documentId, text: t('已保存，列表刷新失败', '保存済み。一覧の再読込に失敗しました'), failed: true })
        }
      } catch (cause) {
        setAffiliationStatus({ documentId, text: cause instanceof Error ? cause.message : String(cause), failed: true })
      }
    })
  }
  const findCases = async (documentId: string) => {
    setMatchingDocumentId(documentId)
    onMatchingChange?.(documentId)
    try {
      const result = await window.sesAgent.findCasesForPersonnel(documentId)
      if (result.documentId !== documentId) throw new Error(t('人员资料已更新，请重新找案件。', '要員情報が更新されました。再検索してください。'))
      setMatchesByPerson((current) => ({ ...current, [documentId]: result }))
    } finally { setMatchingDocumentId(null); onMatchingChange?.(null) }
  }
  useEffect(() => {
    if (!matchRequest || appliedMatch.current === matchRequest.id || selected?.documentId !== matchRequest.documentId || !ready(selected)) return
    appliedMatch.current = matchRequest.id
    // A second intent during an active request is discarded, never queued.
    if (actionPending.current) return
    void action(() => findCases(matchRequest.documentId))
  }, [workspace, busy, matchRequest, selected?.documentId, selected?.profile?.version, selected?.talentPoolStatus, selected?.status, selected?.piiReviewed])
  useEffect(() => {
    if (!focusRequest || focusRequest.documentId !== selected?.documentId || !workspace) return
    const phase = focusRequest.section === 'match' && matches ? 'results' : 'initial'
    const key = `${focusRequest.id}:${phase}`
    if (appliedFocus.current === key) return
    const target = focusRequest.section === 'view' ? detailSection.current : focusRequest.section === 'promote' ? promotionSection.current : matchSection.current
    const scroller = target?.closest<HTMLElement>('.agent-tool-content')
    if (!target || !scroller || target.closest('[hidden]')) return
    appliedFocus.current = key
    // Scroll only the right pane, keeping the feed and its selected card still.
    scroller.scrollTop += target.getBoundingClientRect().top - scroller.getBoundingClientRect().top - 12
    target.focus({ preventScroll: true })
  }, [focusRequest, selected?.documentId, workspace, matches, matchingDocumentId])
  const copy = async (people: CandidateReviewSnapshot[]) => {
    if (!template || !people.length || people.length > 20) throw new Error(t('一次请选择 1–20 人。', '1回に1〜20名を選択してください。'))
    const messages = []
    for (const review of people) messages.push(await window.sesAgent.validatePersonnelMessage(input(review)))
    await copyTextToClipboard(messages.map((item) => item.text).join('\n\n──────────\n\n'))
    try {
      for (const item of messages) await window.sesAgent.recordPersonnelCopy(item)
      await load()
    } catch {
      setNotice(t('文案已复制，但准备历史未完整保存。请刷新后核对。', '文面はコピー済みですが、履歴を保存できませんでした。再読込して確認してください。'))
      return
    }
    setNotice(t('已复制，可粘贴到微信群或邮件。', 'コピーしました。微信やメールに貼り付けられます。'))
  }
  return <section className={compact ? "personnel-workspace is-compact" : "personnel-workspace"}>
    {!compact ? <div className="business-intake-heading"><div><h2>{t('人员整理与推广', '要員の確認・紹介')}</h2><p>{t('导入人员后，直接找案件或生成介绍。资料可在人员管理中修改。', '取込後すぐに案件検索や紹介文を作成できます。情報の修正は要員管理で行います。')}</p></div>
      <button disabled={busy} onClick={() => void action(async () => { await load(); await onRefresh() })} type="button">{t('刷新', '再読込')}</button></div>
    : null}
    {error ? <p role="alert" className="business-error">{error}</p> : null}
    {notice ? <p role="status" className="business-notice">{notice}</p> : null}
    {!compact ? <div className="business-inline-actions">
      <select aria-label={t('营业状态筛选', '営業状態の絞り込み')} value={businessFilter} onChange={(event) => setBusinessFilter(event.target.value as typeof businessFilter)}><option value="available">{t('待营业', '営業待ち')}</option><option value="all">{t('全部营业状态', 'すべての営業状態')}</option><option value="assigned">{t('已入场', '参画中')}</option><option value="paused">{t('不可营业', '営業不可')}</option></select>
      <input aria-label={t('搜索人员', '要員を検索')} placeholder={t('姓名、技能、可上岗时间', '氏名・スキル・稼働時期')} value={query} onChange={(event) => setQuery(event.target.value)} />
      <label><input type="checkbox" checked={onlyPending} onChange={(event) => setOnlyPending(event.target.checked)} />{t('未复制或资料有更新', '未コピー・情報更新あり')}</label>
      <button disabled={busy || !availableReviews.some((item) => checkedIds.has(item.documentId) && ready(item)) || !template} onClick={() => void action(() => copy(availableReviews.filter((item) => checkedIds.has(item.documentId) && ready(item))))} type="button"><Icon name="copy" size={15} />{t('复制选中人员', '選択した要員をコピー')} ({availableReviews.filter((item) => checkedIds.has(item.documentId) && ready(item)).length})</button>
    </div> : null}
    <div className="personnel-layout">{!compact ? <aside className="personnel-list" aria-label={t('人员列表', '要員一覧')}>
      {visible.map((review) => <article className={selected?.documentId === review.documentId ? 'is-selected' : ''} key={review.documentId}>
        <input aria-label={`${t('选择', '選択')} ${label(review)}`} type="checkbox" disabled={!ready(review) || busy} checked={checkedIds.has(review.documentId)} onChange={(event) => setCheckedIds((current) => { const next = new Set(current); if (event.target.checked) next.add(review.documentId); else next.delete(review.documentId); return next })} />
        <button onClick={() => { setSelectedId(review.documentId); onSelectPerson?.(review.documentId); setNotice(null); setError(null) }} type="button"><strong>{label(review)}</strong><span>{review.fields.find((field) => field.key === 'skills')?.value ?? t('技能待确认', 'スキル要確認')}</span><small>{statusOf(review) === 'assigned' ? t('已入场', '参画中') : statusOf(review) === 'paused' ? t('不可营业', '営業不可') : (copyByPerson.get(review.documentId) ?? 0) < (review.profile?.version ?? 1) ? t('待推广 / 有更新', '紹介待ち・更新あり') : t('已复制', 'コピー済み')}</small></button>
      </article>)}
      {!visible.length ? <p>{t('暂无符合条件的人员。请先整理人员消息或调整筛选。', '対象の要員がいません。要員メッセージを取り込むか条件を変更してください。')}</p> : null}
    </aside> : null}<div className="personnel-detail" ref={detailSection} tabIndex={-1}>{selected ? <>
      <header className="personnel-detail-header"><div><span className="personnel-detail-eyebrow">{t('人员资料', '要員情報')}</span><h3>{label(selected)}</h3></div><button className="personnel-text-action" onClick={() => onOpenProfile(selected.documentId)} type="button">{compact ? t('查看 / 编辑完整档案', 'プロフィールの確認・編集') : t('完整档案 / 原文', 'プロフィール・原文')}<span aria-hidden="true">↗</span></button></header>
      {compact ? <div className="personnel-status-summary"><span>{t('营业状态', '営業状態')}</span><strong className={`is-${statusOf(selected)}`}>{workspace ? statusLabel(statusOf(selected)) : t('读取中…', '読込中…')}</strong>{onOpenEditor ? <button className="personnel-text-action" onClick={() => onOpenEditor({ documentId: selected.documentId })} type="button">{t('管理状态', '状態を管理')}<span aria-hidden="true">↗</span></button> : null}</div> : <PersonnelStatusForm key={`${selected.documentId}:${selected.reviewRevision}:${selected.profile?.version}:${workspace?.states.find((state) => state.documentId === selected.documentId)?.confirmedAt}`} disabled={!workspace} state={statusOf(selected)} onSave={async (status) => {
        setSelectedId(selected.documentId)
        await window.sesAgent.setCandidateBusinessState({ documentId: selected.documentId, profileVersion: selected.profile?.version ?? 0, reviewRevision: selected.reviewRevision, status, confirmed: true })
        setMatchesByPerson((current) => { const next = { ...current }; delete next[selected.documentId]; return next }); await load(); await onRefresh()
      }} />}
      <CandidateProfileSummary key={selected.documentId} review={selected} collapseProjects={compact} ownCompanyControl={compact ? <>
        <select aria-label={t('是否自社', '自社所属')} disabled={busy || !selected.profile}
          value={selected.isOwnCompany == null ? '' : String(selected.isOwnCompany)}
          onChange={(event) => saveOwnCompany(selected, event.target.value === '' ? null : event.target.value === 'true')}>
          <option value="">{t('未设置', '未設定')}</option><option value="true">自社</option><option value="false">非自社</option>
        </select>
        {affiliationStatus?.documentId === selected.documentId ? <small role={affiliationStatus.failed ? 'alert' : 'status'}>{affiliationStatus.text}</small> : null}
      </> : undefined} />
      <section ref={promotionSection} tabIndex={-1} className="personnel-promotion" aria-label={t('人员推广', '要員紹介')}>
        <header className="personnel-promotion-heading"><h3>{t('推广预览', '紹介プレビュー')}</h3>{compact && onOpenEditor ? <button className="personnel-text-action" onClick={() => onOpenEditor({ documentId: selected.documentId, templateId: template?.id, lang })} type="button">{t('编辑文案与模板', '文面・テンプレートを編集')}<span aria-hidden="true">↗</span></button> : null}</header>
        {readinessNote ? <p className="personnel-readiness-note">{readinessNote}</p> : null}
        {template ? <>
          <div className="personnel-template-controls"><label>{t('推广模板', '紹介テンプレート')}<select aria-label={t('推广模板', '紹介テンプレート')} disabled={busy} value={template.id} onChange={(event) => setTemplateId(event.target.value)}>{workspace?.templates.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
            <label>{t('语言', '言語')}<select value={lang} onChange={(event) => setLang(event.target.value as 'ja' | 'zh')}><option value="ja">{t('日文', '日本語')}</option><option value="zh">{t('中文', '中国語')}</option></select></label>
            </div>
          {!compact ? <button className="personnel-text-action" onClick={() => setTemplateDraft({ ...template })} type="button">{t('编辑模板', 'テンプレート編集')}</button> : null}
          {compact ? <div className="personnel-message-preview" role="region" aria-label={t('推广文案', '紹介文')}>{message(selected)}</div> : <label className="personnel-message">{t('推广文案', '紹介文')}<textarea rows={12} value={message(selected)} onChange={(event) => editMessage(editKey(selected), event.target.value)} /></label>}
          <div className="personnel-promotion-actions"><button className="is-primary" disabled={busy || !ready(selected)} onClick={() => void action(() => copy([selected]))} type="button">{t('复制到微信', '微信向けにコピー')}</button>
            <button disabled={busy || !ready(selected)} onClick={() => void action(async () => { await window.sesAgent.openPersonnelEmail(input(selected)); setNotice(t('已打开邮件，请选择收件人并发送。', 'メールを開きました。宛先と送信を確認してください。')) })} type="button">{t('打开邮件', 'メールを開く')}</button>
            <button disabled={busy || !ready(selected)} onClick={() => void action(() => findCases(selected.documentId))} type="button">{matchingDocumentId === selected.documentId ? t('正在匹配…', 'マッチング中…') : t('为此人找案件', 'この要員の案件を探す')}</button></div>
          <p className="business-help">{t('复制和打开邮件不会记为已发送。', 'コピーやメールを開く操作は送信済みになりません。')}</p>
          <div ref={matchSection} tabIndex={-1}>
          {matchingDocumentId === selected.documentId ? <p className="personnel-match-progress" role="status">{t('正在筛选案件并由云端 AI 评估适合度…', '案件を絞り込み、Cloud AIで適合性を評価しています…')}</p> : null}
          {matches ? <section className="personnel-matches" aria-label={t('案件匹配结果', '案件マッチング結果')}><h3>{t('案件匹配结果', '案件マッチング結果')} ({matches.items.length})</h3>
            {matches.localMatchCount > matches.items.length ? <small>{t('初筛', '一次検索')} {matches.localMatchCount} {t('个案件，优先展示', '件から優先表示')} {matches.items.length} {t('个', '件')}</small> : null}
            <p className="personnel-match-status" role="status">{matches.cloud.status === 'reviewed' ? t('云端 AI 已评估，按适合度排序。', 'Cloud AI評価済み・適合性順に表示。') : matches.cloud.status === 'partial' ? t('部分案件已由云端 AI 评估，其余标为本地初筛。', '一部はCloud AI評価済み、残りはローカル候補として表示します。') : matches.cloud.status === 'not-needed' ? t('没有找到具备技能或角色匹配依据的案件。', 'スキルや役割が一致する案件は見つかりませんでした。') : t('云端 AI 暂不可用，以下仅为本地初筛结果。', 'Cloud AIを利用できないため、以下はローカル検索結果です。')}{matches.cloud.modelName ? ` · ${matches.cloud.modelName}` : ''}</p>
            {matches.items.map((item) => <article aria-current={selectedCases[selected.documentId] === item.jobCaseId ? 'true' : undefined} className={selectedCases[selected.documentId] === item.jobCaseId ? 'is-selected' : ''} key={item.jobCaseId}><strong>{item.title}</strong>
              {item.assessment ? <MatchAssessmentView assessment={item.assessment} zh={zh} title={t('AI 匹配评估', 'AIマッチング評価')} /> : <><small className="personnel-local-match">{t('本地初筛', 'ローカル候補')}</small><p>{t('匹配依据', '一致の根拠')}：{item.matched.join(' · ')}</p>{item.missing.length ? <p>{t('尚未确认符合', '一致未確認')}：{item.missing.join(' · ')}</p> : null}
              {item.hardFilters.filter((filter) => filter.outcome === 'unknown').map((filter) => <small key={`${filter.type}:${filter.requested}`}>{t('待确认', '要確認')}：{filter.requested} </small>)}</>}
              <button onClick={() => { setSelectedCases((current) => ({ ...current, [selected.documentId]: item.jobCaseId })); onOpenCase(item.reviewId) }} type="button">{t('查看案件 / 准备联系', '案件を確認')}</button></article>)}
            {!matches.items.length ? <p>{t('当前没有足够匹配依据。可以先推广此人，或更新资料后再查。', '現在は十分な一致根拠がありません。要員紹介、または情報更新後の再検索をご利用ください。')}</p> : null}</section> : null}
          </div>
          <details className="personnel-promotion-history"><summary>{t('推广准备历史', '紹介の準備履歴')}</summary>{(workspace?.copies ?? []).filter((copy) => copy.documentId === selected.documentId).slice(0, 20).map((copy) => <p key={copy.id}>{new Date(copy.createdAt).toLocaleString()} · {copy.lang === 'ja' ? t('日文', '日本語') : t('中文', '中国語')} · v{copy.profileVersion} · {t('已复制', 'コピー済み')}</p>)}</details>
        </> : workspace ? <p className="business-help">{t('暂无推广模板，请在完整页面刷新推广设置。', '紹介テンプレートがありません。管理画面で設定を再読込してください。')}</p> : null}
      </section>
    </> : <p>{t('选择人员后开始确认和推广。', '要員を選択して確認・紹介を始めます。')}</p>}</div></div>
    {!compact && templateDraft ? <section className="personnel-template-editor" aria-label={t('编辑人员模板', '要員テンプレート編集')}>
      <h3>{t('编辑人员模板', '要員テンプレート編集')}</h3><label>{t('名称', '名前')}<input value={templateDraft.name} onChange={(event) => setTemplateDraft({ ...templateDraft, name: event.target.value })} /></label>
      <p>{t('可用字段', '使用できる項目')}：{'{{label}} {{skills}} {{experience_years}} {{availability}} {{rate}} {{japanese_level}} {{work_style}} {{role}} {{location}}'}</p>
      <label>{t('日文模板', '日本語テンプレート')}<textarea rows={10} value={templateDraft.bodyJa} onChange={(event) => setTemplateDraft({ ...templateDraft, bodyJa: event.target.value })} /></label>
      <label>{t('中文模板', '中国語テンプレート')}<textarea rows={10} value={templateDraft.bodyZh} onChange={(event) => setTemplateDraft({ ...templateDraft, bodyZh: event.target.value })} /></label>
      <div className="business-inline-actions"><button disabled={busy} onClick={() => void action(async () => { await window.sesAgent.savePersonnelTemplate(templateDraft); await load(); await onRefresh(); setTemplateDraft(null) })} type="button">{t('保存模板', 'テンプレートを保存')}</button>
        <button onClick={() => setTemplateDraft(null)} type="button">{t('取消', 'キャンセル')}</button></div>
    </section> : null}
  </section>
}

function PersonnelStatusForm({ disabled, state, onSave }: { disabled: boolean; state: CandidateBusinessStatus; onSave(status: CandidateBusinessStatus): Promise<void> }) {
  const zh = useUiLocale() === 'zh-CN'; const t = (cn: string, ja: string) => zh ? cn : ja
  const [status, setStatus] = useState<CandidateBusinessStatus>(state)
  const [busy, setBusy] = useState(false); const [error, setError] = useState<string | null>(null)
  return <form className="personnel-status" onSubmit={(event) => { event.preventDefault(); if (disabled || busy) return; setBusy(true); setError(null); void onSave(status).catch((cause) => setError(String(cause))).finally(() => setBusy(false)) }}>
    <label>{t('营业状态', '営業状態')}<select disabled={disabled || busy} value={status} onChange={(event) => setStatus(event.target.value as CandidateBusinessStatus)}>
      <option value="available">{t('待营业', '営業待ち')}</option><option value="soon">{t('待营业（近期可入场）', '営業待ち（近日稼働可能）')}</option><option value="assigned">{t('已入场', '参画中')}</option><option value="paused">{t('不可营业', '営業不可')}</option></select></label>
    <button disabled={disabled || busy} type="submit">{t('保存状态', '状態を保存')}</button>{error ? <p role="alert">{error}</p> : null}
  </form>
}
