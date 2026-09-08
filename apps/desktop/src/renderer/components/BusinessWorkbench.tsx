import { useEffect, useState } from 'react'
import './business-workbench.css'
import type { BootstrapPayload } from '@shared'
import { useUiLocale } from '../i18n'
import { BusinessIntakeWorkspace } from './BusinessIntakeWorkspace'
import { PersonnelWorkspace, type PersonnelEditorTarget, type PersonnelMessageDrafts } from './PersonnelWorkspace'
import { BroadcastWorkspaceView, type BroadcastPanelActions } from './BroadcastWorkspaceView'
import { Icon } from './Icon'

interface Props {
  personnelRequest?: PersonnelEditorTarget & { id: number }
  personnelMessageDrafts?: PersonnelMessageDrafts
  bootstrap: BootstrapPayload; broadcastActions: BroadcastPanelActions
  onRefresh(): Promise<void>; onCaseImport(): void; onCase(reviewId: string): void
  onProfile(documentId: string): void; onMatchCase(jobCaseId: string): void
}

export function BusinessWorkbench({ personnelRequest, personnelMessageDrafts, bootstrap, broadcastActions, onRefresh, onCaseImport, onCase, onProfile, onMatchCase }: Props) {
  const zh = useUiLocale() === 'zh-CN'; const t = (cn: string, ja: string) => zh ? cn : ja
  const [tab, setTab] = useState<'intake' | 'cases' | 'people'>('intake')
  const [personId, setPersonId] = useState<string>()
  const [caseId, setCaseId] = useState<string>()
  const [caseQuery, setCaseQuery] = useState('')
  useEffect(() => {
    if (!personnelRequest) return
    setPersonId(personnelRequest.documentId); setTab('people')
  }, [personnelRequest])
  const cases = bootstrap.jobCaseReviews.filter((item) => item.lifecycle === 'active')
  const people = bootstrap.candidateReviews.filter((item) => item.recordStatus === 'active')
  const showPerson = (id: string) => { setPersonId(id); setTab('people') }
  const showCase = (id: string) => { setCaseId(id); setTab('cases') }
  return <main className="business-workbench">
    <header className="business-workbench-header"><div><span className="eyebrow">SES WORKSPACE</span><h1>{t('信息整理与推广', '情報整理・紹介ワークスペース')}</h1>
      <p>{t('邮件和微信消息进来，整理成案件与人员，再匹配、生成介绍并推广。', 'メール・微信の情報を案件と要員に整理し、照合・紹介へつなげます。')}</p></div>
      <div className="business-header-counts"><span>{cases.length} {t('有效案件', '有効案件')}</span><span>{people.length} {t('人员', '要員')}</span></div></header>
    <nav className="business-tabs" aria-label={t('业务流程', '業務フロー')}>
      <button aria-current={tab === 'intake' ? 'page' : undefined} onClick={() => setTab('intake')} type="button"><Icon name="upload" size={17} />{t('信息整理', '情報整理')}</button>
      <button aria-current={tab === 'cases' ? 'page' : undefined} onClick={() => setTab('cases')} type="button"><Icon name="briefcase" size={17} />{t('案件配信 / 找人', '案件紹介・要員検索')}</button>
      <button aria-current={tab === 'people' ? 'page' : undefined} onClick={() => setTab('people')} type="button"><Icon name="users" size={17} />{t('人员推广 / 找案件', '要員紹介・案件検索')}</button>
    </nav>
    <div hidden={tab !== 'intake'}><BusinessIntakeWorkspace modelKey={bootstrap.defaultAgentChatModelKey ?? 'gpt-5.6-luna'} cases={bootstrap.jobCaseReviews} candidates={bootstrap.candidateReviews}
      onRefresh={onRefresh} onCase={showCase} onPerson={showPerson} onCaseImport={onCaseImport} /></div>
    {tab === 'cases' ? <section className="business-case-workspace"><div className="business-intake-heading"><div><h2>{t('案件整理后，直接配信或找人', '整理した案件から紹介・要員検索へ')}</h2><p>{t('选择案件后沿用现有模板。需要补充的条件可以返回案件详情修正。', '案件を選ぶと既存のテンプレートを利用できます。不明条件は案件詳細で補足できます。')}</p></div><button onClick={onCaseImport} type="button">{t('导入案件', '案件を取り込む')}</button></div>
      <input className="business-case-search" aria-label={t('筛选案件', '案件を絞り込む')} placeholder={t('搜索案件名称、技能或单价', '案件名・スキル・単価で検索')} value={caseQuery} onChange={(event) => setCaseQuery(event.target.value)} />
      <div className="business-case-actions">{cases.filter((item) => !caseQuery || item.fields.map((field) => field.value).join(' ').toLowerCase().includes(caseQuery.toLowerCase())).map((item) => <article key={item.reviewId} className={caseId === item.reviewId ? 'is-selected' : ''}>
        <button onClick={() => setCaseId(item.reviewId)} type="button"><strong>{item.fields.find((field) => field.key === 'title')?.value ?? item.redactedSubject}</strong></button>
        <span>{item.fields.find((field) => field.key === 'rate')?.value ?? t('单价待确认', '単価要確認')}</span>
        <button onClick={() => onCase(item.reviewId)} type="button">{t('原文 / 编辑', '原文・編集')}</button>
        {item.jobCase ? <button onClick={() => onMatchCase(item.jobCase!.id)} type="button">{t('找人', '要員を探す')}</button> : null}</article>)}</div>
      <BroadcastWorkspaceView key={caseId ?? 'queue'} actions={broadcastActions} initialReviewId={caseId} />
    </section> : null}
    <div hidden={tab !== 'people'}><PersonnelWorkspace reviews={bootstrap.candidateReviews} initialDocumentId={personId} editorRequest={personnelRequest} messageDrafts={personnelMessageDrafts} onRefresh={onRefresh} onOpenCase={showCase} onOpenProfile={onProfile} /></div>
  </main>
}
