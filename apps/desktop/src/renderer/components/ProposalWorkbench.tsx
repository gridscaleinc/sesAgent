import { useState, type FormEvent } from 'react'
import type {
  ApproveProposalDraftInput,
  CreateProposalDraftInput,
  ExportProposalPackageInput,
  ExportProposalPackageResult,
  ProposalDraftSnapshot,
  ProposalFollowUpStage,
  ProposalMutationResult,
  ProposalWorkspaceSnapshot,
  RecordProposalFollowUpInput,
  UpdateProposalDraftInput
} from '@shared'
import { Icon } from './Icon'
import { useRendererUiRefresh } from '../i18n'

interface ProposalWorkbenchProps {
  taskId: string
  status: 'idle' | 'loading' | 'ready' | 'error'
  workspace: ProposalWorkspaceSnapshot | null
  error: string | null
  onCreate(input: CreateProposalDraftInput): Promise<ProposalMutationResult>
  onUpdate(input: UpdateProposalDraftInput): Promise<ProposalMutationResult>
  onApprove(input: ApproveProposalDraftInput): Promise<ProposalMutationResult>
  onExport(input: ExportProposalPackageInput): Promise<ExportProposalPackageResult>
  onRecordFollowUp(input: RecordProposalFollowUpInput): Promise<ProposalMutationResult>
}

function parseCc(value: string): string[] {
  return [...new Set(value.split(/[,;、\s]+/u).map((item) => item.trim()).filter(Boolean))]
}

const proposalFollowUpLabels: Record<ProposalFollowUpStage, string> = {
  sent: 'アプリ外で送信済み',
  replied: '先方から返信あり',
  interview: '面談進行',
  accepted: '参画決定',
  declined: '見送り',
  withdrawn: '候補者辞退'
}

const terminalFollowUpStages = new Set<ProposalFollowUpStage>(['accepted', 'declined', 'withdrawn'])

function todayForInput(now = new Date()): string {
  const parts = new Intl.DateTimeFormat('en-CA', { year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(now)
  const values = new Map(parts.map((part) => [part.type, part.value]))
  return `${values.get('year')}-${values.get('month')}-${values.get('day')}`
}

function nextFollowUpStages(stage: ProposalFollowUpStage | null): ProposalFollowUpStage[] {
  if (stage === null) return ['sent']
  if (stage === 'sent') return ['replied', 'interview', 'accepted', 'declined', 'withdrawn']
  if (stage === 'replied') return ['interview', 'accepted', 'declined', 'withdrawn']
  if (stage === 'interview') return ['accepted', 'declined', 'withdrawn']
  return []
}

function ProposalFollowUpPanel({
  draft,
  onRecord
}: {
  draft: ProposalDraftSnapshot
  onRecord(input: RecordProposalFollowUpInput): Promise<ProposalMutationResult>
}) {
  const options = nextFollowUpStages(draft.followUp.stage)
  const [stage, setStage] = useState<ProposalFollowUpStage>(() => options[0] ?? 'sent')
  const [occurredOn, setOccurredOn] = useState(() => todayForInput())
  const [note, setNote] = useState('')
  const [confirmed, setConfirmed] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const terminal = draft.followUp.stage !== null && terminalFollowUpStages.has(draft.followUp.stage)
  const canRecord = draft.status === 'exported' && options.includes(stage) && occurredOn.length === 10 && confirmed && !busy

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    if (!canRecord) return
    setBusy(true)
    setError(null)
    try {
      await onRecord({
        draftId: draft.id,
        expectedRevision: draft.followUp.revision,
        stage,
        occurredOn,
        ...(note.trim() ? { note: note.trim() } : {}),
        manuallyConfirmed: true
      })
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '営業結果を記録できませんでした。')
      setBusy(false)
    }
  }

  return (
    <section className="proposal-follow-up" aria-label="提案後の営業結果">
      <header>
        <div><span className="proposal-follow-up-icon"><Icon name="briefcase" size={17} /></span><span><strong>提案後の営業結果</strong><small>手動記録 · Google Workspaceへの書込なし</small></span></div>
        <span className={draft.followUp.stage ? 'proposal-follow-up-current has-stage' : 'proposal-follow-up-current'}>
          {draft.followUp.stage ? proposalFollowUpLabels[draft.followUp.stage] : '未送信'}
        </span>
      </header>

      {draft.status !== 'exported' ? (
        <div className="proposal-follow-up-locked"><Icon name="lock" size={15} /><span><strong>承認済みパッケージの書き出し後に記録できます</strong><small>書き出しただけでは送信済みになりません。</small></span></div>
      ) : terminal ? (
        <div className="proposal-follow-up-terminal"><Icon name="check" size={17} /><span><strong>この提案の営業結果は確定済みです</strong><small>再開する場合は履歴を上書きせず、新しい提案草稿を作成してください。</small></span></div>
      ) : (
        <form className="proposal-follow-up-form" onSubmit={submit}>
          <div className="proposal-follow-up-grid">
            <label><span>次の状態</span><select aria-label="提案後の状態" onChange={(event) => setStage(event.target.value as ProposalFollowUpStage)} value={stage}>
              {options.map((option) => <option key={option} value={option}>{proposalFollowUpLabels[option]}</option>)}
            </select></label>
            <label><span>発生・予定日</span><input aria-label="提案後の発生・予定日" onChange={(event) => setOccurredOn(event.target.value)} type="date" value={occurredOn} /></label>
          </div>
          <label><span>営業メモ（任意）</span><textarea aria-label="提案後の営業メモ" maxLength={500} onChange={(event) => setNote(event.target.value)} placeholder="例：次回連絡は火曜日。氏名・電話・メール・住所は入力しないでください。" rows={3} value={note} /></label>
          <div className="proposal-follow-up-boundary"><Icon name="shield" size={14} /><span>メモはSQLCipher内だけに保存し、AI・Gmail・Cloudへ送信しません。電話・メール等の検出可能な直接識別子はMainで拒否します。</span></div>
          <label className="proposal-follow-up-confirm"><input checked={confirmed} onChange={(event) => setConfirmed(event.target.checked)} type="checkbox" /><span>アプリ外で事実を確認しました。これはメール送信操作ではありません。</span></label>
          {error ? <p className="proposal-error" role="alert">{error}</p> : null}
          <button disabled={!canRecord} type="submit">{busy ? '端末内に記録中…' : '営業結果を記録'}</button>
        </form>
      )}

      {draft.followUp.events.length > 0 ? (
        <ol className="proposal-follow-up-timeline" aria-label="営業結果の履歴">
          {draft.followUp.events.toReversed().map((event) => (
            <li key={event.id}>
              <span className="proposal-follow-up-dot" />
              <div><strong>{proposalFollowUpLabels[event.stage]}</strong><small>{event.occurredOn} · {event.recordedBy} · Revision {event.revision}</small>{event.note ? <p>{event.note}</p> : null}</div>
              <span><Icon name="lock" size={11} />端末内</span>
            </li>
          ))}
        </ol>
      ) : null}
    </section>
  )
}

function ProposalCreationForm({
  onCreate,
  options,
  taskId
}: {
  taskId: string
  options: ProposalWorkspaceSnapshot['options']
  onCreate(input: CreateProposalDraftInput): Promise<ProposalMutationResult>
}) {
  const [caseId, setCaseId] = useState('')
  const [candidateId, setCandidateId] = useState('')
  const [recipientTo, setRecipientTo] = useState('')
  const [recipientCc, setRecipientCc] = useState('')
  const [candidateDisplayName, setCandidateDisplayName] = useState('候補者A')
  const [tone, setTone] = useState<CreateProposalDraftInput['tone']>('standard')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const effectiveCaseId = caseId || options.jobCases[0]?.id || ''
  const effectiveCandidateId = candidateId || options.candidates[0]?.id || ''
  const selectedCase = options.jobCases.find((item) => item.id === effectiveCaseId)
  const selectedCandidate = options.candidates.find((item) => item.id === effectiveCandidateId)
  const canCreate = Boolean(effectiveCaseId && effectiveCandidateId && recipientTo.trim() && candidateDisplayName.trim() && !busy)

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    if (!canCreate) return
    setBusy(true)
    setError(null)
    try {
      await onCreate({
        taskId,
        jobCaseId: effectiveCaseId,
        candidateProfileId: effectiveCandidateId,
        recipientTo: recipientTo.trim(),
        recipientCc: parseCc(recipientCc),
        candidateDisplayName: candidateDisplayName.trim(),
        tone
      })
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '提案草稿を作成できませんでした。')
      setBusy(false)
    }
  }

  if (options.jobCases.length === 0 || options.candidates.length === 0) {
    return (
      <div className="proposal-empty-state">
        <Icon name="alert" size={20} />
        <strong>提案に使える確認済みデータが不足しています</strong>
        <p>{options.jobCases.length === 0 ? '利用中の確認済み案件を1件以上用意してください。' : '利用中のローカル人材プロフィールを1件以上用意してください。'}</p>
      </div>
    )
  }

  return (
    <form className="proposal-create-form" onSubmit={submit}>
      <div className="proposal-local-banner"><Icon name="shield" size={17} /><span><strong>ローカル生成</strong>確認済み構造化データだけを使用し、クラウド・原文メール・原本履歴書は参照しません。</span></div>
      <label><span>案件</span><select onChange={(event) => setCaseId(event.target.value)} value={effectiveCaseId}>
        {options.jobCases.map((item) => <option key={item.id} value={item.id}>{item.title} · v{item.version}</option>)}
      </select></label>
      {selectedCase ? <div className="proposal-selection-summary"><strong>{selectedCase.title}</strong><span>{selectedCase.role ?? 'ロール未記載'} · {selectedCase.requiredSkills ?? '必須スキル未記載'} · {selectedCase.rate ?? '単価未記載'}</span></div> : null}
      <label><span>候補者</span><select onChange={(event) => setCandidateId(event.target.value)} value={effectiveCandidateId}>
        {options.candidates.map((item) => <option key={item.id} value={item.id}>{item.anonymousLabel} · v{item.version}</option>)}
      </select></label>
      {selectedCandidate ? <div className="proposal-selection-summary"><strong>{selectedCandidate.anonymousLabel}</strong><span>{selectedCandidate.role ?? 'ロール未記載'} · {selectedCandidate.skills ?? 'スキル未記載'} · {selectedCandidate.rate ?? '単価未記載'}</span></div> : null}
      <div className="proposal-form-grid">
        <label><span>宛先</span><input aria-label="提案の宛先" onChange={(event) => setRecipientTo(event.target.value)} placeholder="bp@company.co.jp" type="email" value={recipientTo} /></label>
        <label><span>CC（任意）</span><input aria-label="提案のCC" onChange={(event) => setRecipientCc(event.target.value)} placeholder="sales@company.co.jp" value={recipientCc} /></label>
      </div>
      <div className="proposal-form-grid">
        <label><span>候補者の対外表示名</span><input aria-label="候補者の対外表示名" maxLength={80} onChange={(event) => setCandidateDisplayName(event.target.value)} value={candidateDisplayName} /></label>
        <label><span>文体</span><select aria-label="提案の文体" onChange={(event) => setTone(event.target.value as CreateProposalDraftInput['tone'])} value={tone}>
          <option value="standard">標準</option><option value="concise">簡潔</option><option value="formal">より丁寧</option>
        </select></label>
      </div>
      <p className="proposal-local-identity-note"><Icon name="lock" size={13} />宛先と対外表示名は端末内でのみ本文へ挿入され、クラウド生成コンテキストには入りません。</p>
      {error ? <p className="proposal-error" role="alert">{error}</p> : null}
      <button className="proposal-primary-action" disabled={!canCreate} type="submit">{busy ? '生成中…' : 'ローカルで提案草稿を生成'}</button>
    </form>
  )
}

function ProposalDraftEditor({
  candidate,
  draft,
  jobCase,
  onApprove,
  onExport,
  onRecordFollowUp,
  onUpdate
}: {
  draft: ProposalDraftSnapshot
  jobCase: ProposalWorkspaceSnapshot['evidence'][number]['jobCase']
  candidate: ProposalWorkspaceSnapshot['evidence'][number]['candidate']
  onUpdate(input: UpdateProposalDraftInput): Promise<ProposalMutationResult>
  onApprove(input: ApproveProposalDraftInput): Promise<ProposalMutationResult>
  onExport(input: ExportProposalPackageInput): Promise<ExportProposalPackageResult>
  onRecordFollowUp(input: RecordProposalFollowUpInput): Promise<ProposalMutationResult>
}) {
  const [recipientTo, setRecipientTo] = useState(draft.recipientTo)
  const [recipientCc, setRecipientCc] = useState(draft.recipientCc.join(', '))
  const [candidateDisplayName, setCandidateDisplayName] = useState(draft.candidateDisplayName)
  const [subject, setSubject] = useState(draft.subject)
  const [body, setBody] = useState(draft.body)
  const [approvals, setApprovals] = useState({ recipient: false, body: false, attachment: false, privacy: false })
  const [busy, setBusy] = useState<'idle' | 'save' | 'approve' | 'export'>('idle')
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const cc = parseCc(recipientCc)
  const dirty = recipientTo.trim() !== draft.recipientTo ||
    cc.join('\u0000') !== draft.recipientCc.join('\u0000') ||
    candidateDisplayName.trim() !== draft.candidateDisplayName ||
    subject.trim() !== draft.subject ||
    body.trim() !== draft.body
  const allApproved = Object.values(approvals).every(Boolean)
  const approvalCurrent = draft.approvedContentHash === draft.contentHash && ['approved', 'exported'].includes(draft.status)
  const followUpStarted = draft.followUp.stage !== null

  const save = async (force = false) => {
    if ((!dirty && !force) || busy !== 'idle') return
    setBusy('save')
    setError(null)
    setNotice(null)
    try {
      await onUpdate({
        draftId: draft.id,
        revision: draft.revision,
        recipientTo: recipientTo.trim(),
        recipientCc: cc,
        candidateDisplayName: candidateDisplayName.trim(),
        subject: subject.trim(),
        body: body.trim()
      })
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '提案草稿を保存できませんでした。')
      setBusy('idle')
    }
  }

  const approve = async () => {
    if (!allApproved || dirty || busy !== 'idle') return
    setBusy('approve')
    setError(null)
    setNotice(null)
    try {
      await onApprove({
        draftId: draft.id,
        revision: draft.revision,
        contentHash: draft.contentHash,
        approvals: { recipient: true, body: true, attachment: true, privacy: true }
      })
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '提案内容を承認できませんでした。')
      setBusy('idle')
    }
  }

  const exportPackage = async () => {
    if (!approvalCurrent || dirty || busy !== 'idle') return
    setBusy('export')
    setError(null)
    setNotice(null)
    try {
      const result = await onExport({ draftId: draft.id, revision: draft.revision, contentHash: draft.contentHash })
      setBusy('idle')
      setNotice(result.cancelled ? 'エクスポートをキャンセルしました。' : `${result.export?.fileName ?? '提案パッケージ'}を書き出しました。送信済みにはしていません。`)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '提案パッケージを書き出せませんでした。')
      setBusy('idle')
    }
  }

  return (
    <div className="proposal-responsive-confirmation">
      <aside className="proposal-evidence-pane job-case-evidence" aria-label="案件の確認済み証跡">
        <header><span className="eyebrow">JOB CASE</span><h3>{jobCase.title}</h3><p>JobCase v{jobCase.version} · この草稿に固定</p></header>
        <div className="proposal-evidence-list">{jobCase.fields.filter((field) => field.value).map((field) => (
          <article key={field.key}><small>{field.label}</small><strong>{field.value}</strong><span>{field.sourceLabels.join(' / ')}</span></article>
        ))}</div>
      </aside>
      <aside className="proposal-evidence-pane candidate-evidence" aria-label="候補者の確認済み証跡">
        <header><span className="eyebrow">CANDIDATE EVIDENCE</span><h3>{candidate.anonymousLabel}</h3><p>CandidateProfile v{candidate.version} · 直接識別子なし</p></header>
        <div className="proposal-evidence-list">{candidate.fields.filter((field) => field.value).map((field) => (
          <article key={field.key}><small>{field.label}</small><strong>{field.value}</strong><span>{field.sourceLabels.join(' / ')}</span></article>
        ))}</div>
        {candidate.projectExperiences.length > 0 ? <div className="proposal-project-evidence">
          <strong>プロジェクト証跡</strong>
          {candidate.projectExperiences.map((project) => <article key={project.id}><strong>{project.title}</strong><small>{project.period ?? '期間未記載'} · {project.sourceLabels.join(' / ')}</small><p>{project.summary}</p></article>)}
        </div> : null}
      </aside>
      <section className="proposal-confirmation-pane" aria-label="提案内容と外部提供確認">
      <div className="proposal-draft-editor">
      <div className={`proposal-status-banner status-${draft.status}`}>
        <Icon name={draft.status === 'export_unknown' ? 'alert' : draft.status === 'awaiting_review' ? 'clock' : 'check'} size={16} />
        <div><strong>{draft.status === 'awaiting_review' ? '内容確認待ち' : draft.status === 'approved' ? '現在の内容を承認済み' : draft.status === 'exported' ? '提案パッケージを書き出し済み' : 'エクスポート結果を確認できません'}</strong>
          <p>Revision {draft.revision} · 内容ハッシュ {draft.contentHash.slice(0, 12)} · Gmail送信機能なし</p></div>
      </div>
      {draft.status === 'export_unknown' ? <button className="proposal-recover-action" onClick={() => void save(true)} type="button">内容を再確認するため新しいRevisionを作成</button> : null}
      {followUpStarted ? <p className="proposal-content-frozen"><Icon name="lock" size={13} />送信後の営業履歴があるため、このRevisionの宛先・本文・添付は固定されています。</p> : null}
      <div className="proposal-form-grid">
        <label><span>宛先</span><input aria-label="草稿の宛先" onChange={(event) => setRecipientTo(event.target.value)} readOnly={followUpStarted} type="email" value={recipientTo} /></label>
        <label><span>CC</span><input aria-label="草稿のCC" onChange={(event) => setRecipientCc(event.target.value)} readOnly={followUpStarted} value={recipientCc} /></label>
      </div>
      <label><span>候補者の対外表示名（端末内のみ）</span><input aria-label="草稿の候補者表示名" onChange={(event) => setCandidateDisplayName(event.target.value)} readOnly={followUpStarted} value={candidateDisplayName} /></label>
      <label><span>件名</span><input aria-label="提案件名" maxLength={200} onChange={(event) => setSubject(event.target.value)} readOnly={followUpStarted} value={subject} /></label>
      <label><span>本文</span><textarea aria-label="提案本文" maxLength={20_000} onChange={(event) => setBody(event.target.value)} readOnly={followUpStarted} rows={18} value={body} /></label>
      <div className="proposal-edit-actions"><span>{followUpStarted ? '送信後履歴あり · 内容固定' : dirty ? '変更あり · 保存すると旧承認は失効します' : '保存済み'}</span><button disabled={followUpStarted || !dirty || busy !== 'idle'} onClick={() => void save()} type="button">{busy === 'save' ? '保存中…' : '変更を保存'}</button></div>

      <section className="proposal-attachment-preview">
        <header><div><Icon name="file" size={17} /><span><strong>{draft.attachment.fileName}</strong><small>PDF · 脱敏済み · 原本履歴書を含まない</small></span></div><span>{draft.attachment.fields.length}項目 · Project {draft.attachment.projectExperiences.length}</span></header>
        <div>{draft.attachment.fields.map((field) => <span key={field.key}><small>{field.label}</small><strong>{field.value}</strong></span>)}</div>
        {draft.attachment.projectExperiences.length > 0 ? <section className="proposal-attachment-projects">
          <strong>確認済みプロジェクト経験</strong>
          {draft.attachment.projectExperiences.map((project, index) => <article key={`${project.title}-${index}`}>
            <div><strong>{project.title}</strong><small>{project.period ?? '期間未記載'}</small></div>
            <small>{project.role ?? '役割未記載'}{project.technologies.length > 0 ? ` · ${project.technologies.join(' / ')}` : ''}</small>
            <p>{project.summary}</p>
          </article>)}
        </section> : null}
        <footer><Icon name="shield" size={13} />匿名 {draft.attachment.anonymousCandidateLabel} · Hash {draft.attachment.contentHash.slice(0, 12)}</footer>
      </section>

      <section className="proposal-approval-gate">
        <h3><Icon name="lock" size={16} />外部提供前の確認</h3>
        {([
          ['recipient', '宛先・CC・対外表示名を確認しました'],
          ['body', '件名と本文の内容・敬語・案件条件を確認しました'],
          ['attachment', '添付プレビューに原本履歴書と個人識別情報がないことを確認しました'],
          ['privacy', 'エクスポート後はアプリ外へ出ること、送信済みではないことを理解しました']
        ] as const).map(([key, label]) => (
          <label key={key}><input checked={approvals[key]} disabled={followUpStarted} onChange={(event) => setApprovals((current) => ({ ...current, [key]: event.target.checked }))} type="checkbox" />{label}</label>
        ))}
        <button disabled={!allApproved || dirty || busy !== 'idle' || approvalCurrent} onClick={() => void approve()} type="button">{busy === 'approve' ? '承認中…' : approvalCurrent ? '現在の内容は承認済み' : 'この内容ハッシュを承認'}</button>
      </section>

      <section className="proposal-export-zone">
        <div><strong>提案パッケージ</strong><p>message.txt、脱敏プロフィールPDF、検証用ManifestをZIPで書き出します。</p></div>
        <button disabled={followUpStarted || !approvalCurrent || dirty || busy !== 'idle'} onClick={() => void exportPackage()} type="button">{busy === 'export' ? '書き出し中…' : '承認済みパッケージを書き出す'}</button>
        <span><Icon name="alert" size={13} />書き出しは送信ではありません。Gmail権限は追加されません。</span>
      </section>
      <ProposalFollowUpPanel draft={draft} onRecord={onRecordFollowUp} />
      {error ? <p className="proposal-error" role="alert">{error}</p> : null}
      {notice ? <p className="proposal-notice" role="status">{notice}</p> : null}
      </div>
      </section>
    </div>
  )
}

export function ProposalWorkbench({
  error,
  onApprove,
  onCreate,
  onExport,
  onRecordFollowUp,
  onUpdate,
  status,
  taskId,
  workspace
}: ProposalWorkbenchProps) {
  useRendererUiRefresh()
  const [selectedDraftId, setSelectedDraftId] = useState<string | null>(null)
  const [creatingNew, setCreatingNew] = useState(false)
  if (status === 'loading' || status === 'idle') return <div className="proposal-loading"><span className="matching-spinner" />提案ワークスペースを準備中…</div>
  if (status === 'error' || !workspace) return <div className="proposal-empty-state"><Icon name="alert" size={20} /><strong>提案ワークスペースを読み込めませんでした</strong><p>{error}</p></div>
  const selectedDraft = workspace.drafts.find((draft) => draft.id === selectedDraftId) ?? workspace.drafts[0] ?? null
  const selectedEvidence = selectedDraft
    ? workspace.evidence.find((evidence) => evidence.draftId === selectedDraft.id) ?? null
    : null
  const showCreation = creatingNew || !selectedDraft
  return (
    <div className="proposal-workbench">
      <header className="proposal-workbench-header">
        <div><span className="eyebrow">PROPOSAL REVIEW</span><h2>提案草稿</h2><p>ローカル生成 · 内容ハッシュ承認 · 自動送信なし</p></div>
        {selectedDraft && !showCreation ? <button onClick={() => setCreatingNew(true)} type="button"><Icon name="plus" size={13} />別候補者の草稿</button> : null}
      </header>
      {workspace.drafts.length > 0 ? <div className="proposal-draft-tabs">{workspace.drafts.map((draft) => (
        <button className={!showCreation && selectedDraft?.id === draft.id ? 'is-active' : ''} key={draft.id} onClick={() => { setSelectedDraftId(draft.id); setCreatingNew(false) }} type="button">
          {draft.attachment.anonymousCandidateLabel}<span>{draft.followUp.stage ? proposalFollowUpLabels[draft.followUp.stage] : draft.status === 'awaiting_review' ? '確認待ち' : draft.status === 'approved' ? '承認済み' : draft.status === 'exported' ? '書出済み' : '要確認'}</span>
        </button>
      ))}</div> : null}
      {showCreation ? (
        <ProposalCreationForm onCreate={async (input) => {
          const result = await onCreate(input)
          setSelectedDraftId(result.draft.id)
          setCreatingNew(false)
          return result
        }} options={workspace.options} taskId={taskId} />
      ) : selectedDraft && selectedEvidence ? (
        <ProposalDraftEditor
          candidate={selectedEvidence.candidate}
          draft={selectedDraft}
          jobCase={selectedEvidence.jobCase}
          key={`${selectedDraft.id}-${selectedDraft.revision}-${selectedDraft.status}-${selectedDraft.followUp.revision}`}
          onApprove={onApprove}
          onExport={onExport}
          onRecordFollowUp={onRecordFollowUp}
          onUpdate={onUpdate}
        />
      ) : selectedDraft ? <div className="proposal-empty-state"><Icon name="alert" size={20} /><strong>固定バージョンの証跡を読み込めません</strong><p>案件または候補者データが削除された可能性があります。外部提供を停止してデータ管理履歴を確認してください。</p></div> : null}
    </div>
  )
}
