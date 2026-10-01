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
import { localizedIpcError, useLocaleText, localizedCaseFieldLabel, localizedCandidateFieldLabel } from '../i18n'

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
  return [
    ...new Set(
      value
        .split(/[,;、\s]+/u)
        .map((item) => item.trim())
        .filter(Boolean)
    )
  ]
}

type LocaleText = (zh: string, ja: string) => string

function proposalFollowUpLabel(stage: ProposalFollowUpStage, t: LocaleText): string {
  const labels: Record<ProposalFollowUpStage, string> = {
    sent: t('已在应用外发送', 'アプリ外で送信済み'),
    replied: t('对方已回复', '先方から返信あり'),
    interview: t('面谈进行中', '面談進行'),
    accepted: t('决定入场', '参画決定'),
    declined: t('未通过', '見送り'),
    withdrawn: t('人员辞退', '候補者辞退')
  }
  return labels[stage]
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
  const { locale, t } = useLocaleText()
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
      const result = await onRecord({
        draftId: draft.id,
        expectedRevision: draft.followUp.revision,
        stage,
        occurredOn,
        ...(note.trim() ? { note: note.trim() } : {}),
        manuallyConfirmed: true
      })
      // Recorded; when the pair's 跟进 could not follow, say so.
      if (result.followUpNote) setError(localizedIpcError(locale, new Error(result.followUpNote), result.followUpNote))
      // Ready for the next result: the form starts over at the next stage this one allows.
      const next = nextFollowUpStages(result.draft.followUp.stage)
      if (next[0]) setStage(next[0])
      setNote('')
      setConfirmed(false)
      setBusy(false)
    } catch (cause) {
      setError(localizedIpcError(locale, cause, t('无法记录销售结果。', '営業結果を記録できませんでした。')))
      setBusy(false)
    }
  }

  return (
    <section className="proposal-follow-up" aria-label={t('提案后的销售进展', '提案後の営業結果')}>
      <header>
        <div>
          <span className="proposal-follow-up-icon">
            <Icon name="briefcase" size={17} />
          </span>
          <span>
            <strong>{t('提案后的销售进展', '提案後の営業結果')}</strong>
            <small>{t('手工记录 · 不写入 Google Workspace', '手動記録 · Google Workspaceへの書込なし')}</small>
          </span>
        </div>
        <span className={draft.followUp.stage ? 'proposal-follow-up-current has-stage' : 'proposal-follow-up-current'}>
          {draft.followUp.stage ? proposalFollowUpLabel(draft.followUp.stage, t) : t('未发送', '未送信')}
        </span>
      </header>

      {draft.status !== 'exported' ? (
        <div className="proposal-follow-up-locked">
          <Icon name="lock" size={15} />
          <span>
            <strong>{t('批准后的提案包导出后即可记录', '承認済みパッケージの書き出し後に記録できます')}</strong>
            <small>{t('仅导出不代表已发送。', '書き出しただけでは送信済みになりません。')}</small>
          </span>
        </div>
      ) : terminal ? (
        <div className="proposal-follow-up-terminal">
          <Icon name="check" size={17} />
          <span>
            <strong>{t('此提案的销售结果已确认', 'この提案の営業結果は確定済みです')}</strong>
            <small>
              {t(
                '如需重新开始，请创建新的提案草稿，不要覆盖历史记录。',
                '再開する場合は履歴を上書きせず、新しい提案草稿を作成してください。'
              )}
            </small>
          </span>
        </div>
      ) : (
        <form className="proposal-follow-up-form" onSubmit={submit}>
          <div className="proposal-follow-up-grid">
            <label>
              <span>{t('下一状态', '次の状態')}</span>
              <select
                aria-label={t('提案后状态', '提案後の状態')}
                onChange={(event) => setStage(event.target.value as ProposalFollowUpStage)}
                value={stage}
              >
                {options.map((option) => (
                  <option key={option} value={option}>
                    {proposalFollowUpLabel(option, t)}
                  </option>
                ))}
              </select>
            </label>
            <label>
              <span>{t('发生/预计日期', '発生・予定日')}</span>
              <input
                aria-label={t('提案后的发生/预计日期', '提案後の発生・予定日')}
                onChange={(event) => setOccurredOn(event.target.value)}
                type="date"
                value={occurredOn}
              />
            </label>
          </div>
          <label>
            <span>{t('销售备注（选填）', '営業メモ（任意）')}</span>
            <textarea
              aria-label={t('提案后的销售备注', '提案後の営業メモ')}
              maxLength={500}
              onChange={(event) => setNote(event.target.value)}
              placeholder={t(
                '例如：下次联系时间为周二。请勿输入姓名、电话、邮箱或地址。',
                '例：次回連絡は火曜日。氏名・電話・メール・住所は入力しないでください。'
              )}
              rows={3}
              value={note}
            />
          </label>
          <div className="proposal-follow-up-boundary">
            <Icon name="shield" size={14} />
            <span>
              {t(
                '备注仅保存在 SQLCipher 中，不会发送到 AI、Gmail 或云端；主进程会拒绝包含电话、邮箱等可检测直接标识符的内容。',
                'メモはSQLCipher内だけに保存し、AI・Gmail・Cloudへ送信しません。電話・メール等の検出可能な直接識別子はMainで拒否します。'
              )}
            </span>
          </div>
          <label className="proposal-follow-up-confirm">
            <input checked={confirmed} onChange={(event) => setConfirmed(event.target.checked)} type="checkbox" />
            <span>
              {t('已在应用外确认事实；此操作不会发送邮件。', 'アプリ外で事実を確認しました。これはメール送信操作ではありません。')}
            </span>
          </label>
          {error ? (
            <p className="proposal-error" role="alert">
              {error}
            </p>
          ) : null}
          <button disabled={!canRecord} type="submit">
            {busy ? t('正在本机记录…', '端末内に記録中…') : t('记录销售结果', '営業結果を記録')}
          </button>
        </form>
      )}

      {draft.followUp.events.length > 0 ? (
        <ol className="proposal-follow-up-timeline" aria-label={t('销售结果记录', '営業結果の履歴')}>
          {draft.followUp.events.toReversed().map((event) => (
            <li key={event.id}>
              <span className="proposal-follow-up-dot" />
              <div>
                <strong>{proposalFollowUpLabel(event.stage, t)}</strong>
                <small>
                  {event.occurredOn} · {event.recordedBy} · Revision {event.revision}
                </small>
                {event.note ? <p>{event.note}</p> : null}
              </div>
              <span>
                <Icon name="lock" size={11} />
                {t('仅本机', '端末内')}
              </span>
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
  const { locale, t } = useLocaleText()
  const [caseId, setCaseId] = useState('')
  const [candidateId, setCandidateId] = useState('')
  const [recipientTo, setRecipientTo] = useState('')
  const [recipientCc, setRecipientCc] = useState('')
  // i18n-ignore: default display name inserted into the Japanese proposal sent to the client
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
      setError(localizedIpcError(locale, cause, t('无法创建提案草稿。', '提案草稿を作成できませんでした。')))
      setBusy(false)
    }
  }

  if (options.jobCases.length === 0 || options.candidates.length === 0) {
    return (
      <div className="proposal-empty-state">
        <Icon name="alert" size={20} />
        <strong>{t('可用于提案的已确认数据不足', '提案に使える確認済みデータが不足しています')}</strong>
        <p>
          {options.jobCases.length === 0
            ? t('请至少准备 1 个正在使用的已确认案件。', '利用中の確認済み案件を1件以上用意してください。')
            : t('请先准备至少一份可用的本机人员档案。', '利用中のローカル人材プロフィールを1件以上用意してください。')}
        </p>
      </div>
    )
  }

  return (
    <form className="proposal-create-form" onSubmit={submit}>
      <div className="proposal-local-banner">
        <Icon name="shield" size={17} />
        <span>
          <strong>{t('本地生成', 'ローカル生成')}</strong>
          {t(
            '仅使用已确认的结构化数据，不访问云端、邮件原文或原始简历。',
            '確認済み構造化データだけを使用し、クラウド・原文メール・原本履歴書は参照しません。'
          )}
        </span>
      </div>
      <label>
        <span>{t('案件', '案件')}</span>
        <select onChange={(event) => setCaseId(event.target.value)} value={effectiveCaseId}>
          {options.jobCases.map((item) => (
            <option key={item.id} value={item.id}>
              {item.title} · v{item.version}
            </option>
          ))}
        </select>
      </label>
      {selectedCase ? (
        <div className="proposal-selection-summary">
          <strong>{selectedCase.title}</strong>
          <span>
            {selectedCase.role ?? t('未填写角色', 'ロール未記載')} ·{' '}
            {selectedCase.requiredSkills ?? t('未填写必备技能', '必須スキル未記載')} · {selectedCase.rate ?? t('未填写单价', '単価未記載')}
          </span>
        </div>
      ) : null}
      <label>
        <span>{t('人员', '候補者')}</span>
        <select onChange={(event) => setCandidateId(event.target.value)} value={effectiveCandidateId}>
          {options.candidates.map((item) => (
            <option key={item.id} value={item.id}>
              {item.anonymousLabel} · v{item.version}
            </option>
          ))}
        </select>
      </label>
      {selectedCandidate ? (
        <div className="proposal-selection-summary">
          <strong>{selectedCandidate.anonymousLabel}</strong>
          <span>
            {selectedCandidate.role ?? t('未填写角色', 'ロール未記載')} · {selectedCandidate.skills ?? t('未填写技能', 'スキル未記載')} ·{' '}
            {selectedCandidate.rate ?? t('未填写单价', '単価未記載')}
          </span>
        </div>
      ) : null}
      <div className="proposal-form-grid">
        <label>
          <span>{t('收件人', '宛先')}</span>
          <input
            aria-label={t('提案收件人', '提案の宛先')}
            onChange={(event) => setRecipientTo(event.target.value)}
            placeholder="bp@company.co.jp"
            type="email"
            value={recipientTo}
          />
        </label>
        <label>
          <span>{t('抄送（选填）', 'CC（任意）')}</span>
          <input
            aria-label={t('提案抄送', '提案のCC')}
            onChange={(event) => setRecipientCc(event.target.value)}
            placeholder="sales@company.co.jp"
            value={recipientCc}
          />
        </label>
      </div>
      <div className="proposal-form-grid">
        <label>
          <span>{t('人员对外显示名称', '候補者の対外表示名')}</span>
          <input
            aria-label={t('人员对外显示名称', '候補者の対外表示名')}
            maxLength={80}
            onChange={(event) => setCandidateDisplayName(event.target.value)}
            value={candidateDisplayName}
          />
        </label>
        <label>
          <span>{t('语气', '文体')}</span>
          <select
            aria-label={t('提案语气', '提案の文体')}
            onChange={(event) => setTone(event.target.value as CreateProposalDraftInput['tone'])}
            value={tone}
          >
            <option value="standard">{t('标准', '標準')}</option>
            <option value="concise">{t('简洁', '簡潔')}</option>
            <option value="formal">{t('更正式', 'より丁寧')}</option>
          </select>
        </label>
      </div>
      <p className="proposal-local-identity-note">
        <Icon name="lock" size={13} />
        {t(
          '收件人和对外显示名称仅在本机插入正文，不会进入云端生成上下文。',
          '宛先と対外表示名は端末内でのみ本文へ挿入され、クラウド生成コンテキストには入りません。'
        )}
      </p>
      {error ? (
        <p className="proposal-error" role="alert">
          {error}
        </p>
      ) : null}
      <button className="proposal-primary-action" disabled={!canCreate} type="submit">
        {busy ? t('生成中…', '生成中…') : t('在本机生成提案草稿', 'ローカルで提案草稿を生成')}
      </button>
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
  const { locale, t } = useLocaleText()
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
  const dirty =
    recipientTo.trim() !== draft.recipientTo ||
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
      setError(localizedIpcError(locale, cause, t('无法保存提案草稿。', '提案草稿を保存できませんでした。')))
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
      setError(localizedIpcError(locale, cause, t('无法批准提案内容。', '提案内容を承認できませんでした。')))
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
      setNotice(
        result.cancelled
          ? t('已取消导出。', 'エクスポートをキャンセルしました。')
          : t(
              `已导出${result.export?.fileName ?? '提案包'}，尚未标记为已发送。`,
              `${result.export?.fileName ?? '提案パッケージ'}を書き出しました。送信済みにはしていません。`
            )
      )
    } catch (cause) {
      setError(localizedIpcError(locale, cause, t('无法导出提案包。', '提案パッケージを書き出せませんでした。')))
      setBusy('idle')
    }
  }

  return (
    <div className="proposal-responsive-confirmation">
      <aside className="proposal-evidence-pane job-case-evidence" aria-label={t('案件的已确认依据', '案件の確認済み証跡')}>
        <header>
          <span className="eyebrow">{t('案件', '案件')}</span>
          <h3>{jobCase.title}</h3>
          <p>
            JobCase v{jobCase.version} · {t('已固定到此草稿', 'この草稿に固定')}
          </p>
        </header>
        <div className="proposal-evidence-list">
          {jobCase.fields
            .filter((field) => field.value)
            .map((field) => (
              <article key={field.key}>
                <small>{localizedCaseFieldLabel(locale, field)}</small>
                <strong>{field.value}</strong>
                <span>{field.sourceLabels.join(' / ')}</span>
              </article>
            ))}
        </div>
      </aside>
      <aside className="proposal-evidence-pane candidate-evidence" aria-label={t('人员的已确认依据', '候補者の確認済み証跡')}>
        <header>
          <span className="eyebrow">{t('人员依据', '要員の根拠')}</span>
          <h3>{candidate.anonymousLabel}</h3>
          <p>
            CandidateProfile v{candidate.version} · {t('不含直接标识符', '直接識別子なし')}
          </p>
        </header>
        <div className="proposal-evidence-list">
          {candidate.fields
            .filter((field) => field.value)
            .map((field) => (
              <article key={field.key}>
                <small>{localizedCandidateFieldLabel(locale, field)}</small>
                <strong>{field.value}</strong>
                <span>{field.sourceLabels.join(' / ')}</span>
              </article>
            ))}
        </div>
        {candidate.projectExperiences.length > 0 ? (
          <div className="proposal-project-evidence">
            <strong>{t('项目依据', 'プロジェクト証跡')}</strong>
            {candidate.projectExperiences.map((project) => (
              <article key={project.id}>
                <strong>{project.title}</strong>
                <small>
                  {project.period ?? t('未填写期间', '期間未記載')} · {project.sourceLabels.join(' / ')}
                </small>
                <p>{project.summary}</p>
              </article>
            ))}
          </div>
        ) : null}
      </aside>
      <section className="proposal-confirmation-pane" aria-label={t('提案内容与对外提供确认', '提案内容と外部提供確認')}>
        <div className="proposal-draft-editor">
          <div className={`proposal-status-banner status-${draft.status}`}>
            <Icon name={draft.status === 'export_unknown' ? 'alert' : draft.status === 'awaiting_review' ? 'clock' : 'check'} size={16} />
            <div>
              <strong>
                {draft.status === 'awaiting_review'
                  ? t('等待内容确认', '内容確認待ち')
                  : draft.status === 'approved'
                    ? t('当前内容已批准', '現在の内容を承認済み')
                    : draft.status === 'exported'
                      ? t('提案包已导出', '提案パッケージを書き出し済み')
                      : t('无法确认导出结果', 'エクスポート結果を確認できません')}
              </strong>
              <p>
                {t(
                  `Revision ${draft.revision} · 内容哈希 ${draft.contentHash.slice(0, 12)} · 无 Gmail 发送功能`,
                  `Revision ${draft.revision} · 内容ハッシュ ${draft.contentHash.slice(0, 12)} · Gmail送信機能なし`
                )}
              </p>
            </div>
          </div>
          {draft.status === 'export_unknown' ? (
            <button className="proposal-recover-action" onClick={() => void save(true)} type="button">
              {t('创建新修订版以重新确认内容', '内容を再確認するため新しいRevisionを作成')}
            </button>
          ) : null}
          {followUpStarted ? (
            <p className="proposal-content-frozen">
              <Icon name="lock" size={13} />
              {t(
                '由于已有发送后的销售历史，此修订版的收件人、正文和附件已锁定。',
                '送信後の営業履歴があるため、このRevisionの宛先・本文・添付は固定されています。'
              )}
            </p>
          ) : null}
          <div className="proposal-form-grid">
            <label>
              <span>{t('收件人', '宛先')}</span>
              <input
                aria-label={t('草稿收件人', '草稿の宛先')}
                onChange={(event) => setRecipientTo(event.target.value)}
                readOnly={followUpStarted}
                type="email"
                value={recipientTo}
              />
            </label>
            <label>
              <span>CC</span>
              <input
                aria-label={t('草稿抄送', '草稿のCC')}
                onChange={(event) => setRecipientCc(event.target.value)}
                readOnly={followUpStarted}
                value={recipientCc}
              />
            </label>
          </div>
          <label>
            <span>{t('人员的对外显示名称（仅本机）', '候補者の対外表示名（端末内のみ）')}</span>
            <input
              aria-label={t('草稿中的人员显示名称', '草稿の候補者表示名')}
              onChange={(event) => setCandidateDisplayName(event.target.value)}
              readOnly={followUpStarted}
              value={candidateDisplayName}
            />
          </label>
          <label>
            <span>{t('主题', '件名')}</span>
            <input
              aria-label={t('提案主题', '提案件名')}
              maxLength={200}
              onChange={(event) => setSubject(event.target.value)}
              readOnly={followUpStarted}
              value={subject}
            />
          </label>
          <label>
            <span>{t('正文', '本文')}</span>
            <textarea
              aria-label={t('提案正文', '提案本文')}
              maxLength={20_000}
              onChange={(event) => setBody(event.target.value)}
              readOnly={followUpStarted}
              rows={18}
              value={body}
            />
          </label>
          <div className="proposal-edit-actions">
            <span>
              {followUpStarted
                ? t('存在发送后历史 · 内容已锁定', '送信後履歴あり · 内容固定')
                : dirty
                  ? t('存在修改 · 保存后原审批将失效', '変更あり · 保存すると旧承認は失効します')
                  : t('已保存', '保存済み')}
            </span>
            <button disabled={followUpStarted || !dirty || busy !== 'idle'} onClick={() => void save()} type="button">
              {busy === 'save' ? t('保存中…', '保存中…') : t('保存修改', '変更を保存')}
            </button>
          </div>

          <section className="proposal-attachment-preview">
            <header>
              <div>
                <Icon name="file" size={17} />
                <span>
                  <strong>{draft.attachment.fileName}</strong>
                  <small>{t('PDF · 已脱敏 · 不含原始简历', 'PDF · 脱敏済み · 原本履歴書を含まない')}</small>
                </span>
              </div>
              <span>
                {t(
                  `${draft.attachment.fields.length} 项 · 项目 ${draft.attachment.projectExperiences.length}`,
                  `${draft.attachment.fields.length}項目 · Project ${draft.attachment.projectExperiences.length}`
                )}
              </span>
            </header>
            <div>
              {draft.attachment.fields.map((field) => (
                <span key={field.key}>
                  <small>{field.label}</small>
                  <strong>{field.value}</strong>
                </span>
              ))}
            </div>
            {draft.attachment.projectExperiences.length > 0 ? (
              <section className="proposal-attachment-projects">
                <strong>{t('已确认项目经历', '確認済みプロジェクト経験')}</strong>
                {draft.attachment.projectExperiences.map((project, index) => (
                  <article key={`${project.title}-${index}`}>
                    <div>
                      <strong>{project.title}</strong>
                      <small>{project.period ?? t('未填写期间', '期間未記載')}</small>
                    </div>
                    <small>
                      {project.role ?? t('未填写角色', '役割未記載')}
                      {project.technologies.length > 0 ? ` · ${project.technologies.join(' / ')}` : ''}
                    </small>
                    <p>{project.summary}</p>
                  </article>
                ))}
              </section>
            ) : null}
            <footer>
              <Icon name="shield" size={13} />
              {t('匿名', '匿名')} {draft.attachment.anonymousCandidateLabel} · Hash {draft.attachment.contentHash.slice(0, 12)}
            </footer>
          </section>

          <section className="proposal-approval-gate">
            <h3>
              <Icon name="lock" size={16} />
              {t('对外提供前确认', '外部提供前の確認')}
            </h3>
            {(
              [
                ['recipient', t('已确认收件人、抄送和对外显示名称', '宛先・CC・対外表示名を確認しました')],
                ['body', t('已确认主题、正文内容、敬语及案件条件', '件名と本文の内容・敬語・案件条件を確認しました')],
                [
                  'attachment',
                  t('已确认附件预览中不含原始简历和个人标识信息', '添付プレビューに原本履歴書と個人識別情報がないことを確認しました')
                ],
                [
                  'privacy',
                  t(
                    '已了解导出后内容将离开应用，且不会被标记为已发送',
                    'エクスポート後はアプリ外へ出ること、送信済みではないことを理解しました'
                  )
                ]
              ] as const
            ).map(([key, label]) => (
              <label key={key}>
                <input
                  checked={approvals[key]}
                  disabled={followUpStarted}
                  onChange={(event) => setApprovals((current) => ({ ...current, [key]: event.target.checked }))}
                  type="checkbox"
                />
                {label}
              </label>
            ))}
            <button disabled={!allApproved || dirty || busy !== 'idle' || approvalCurrent} onClick={() => void approve()} type="button">
              {busy === 'approve'
                ? t('审批中…', '承認中…')
                : approvalCurrent
                  ? t('当前内容已批准', '現在の内容は承認済み')
                  : t('批准此内容哈希', 'この内容ハッシュを承認')}
            </button>
          </section>

          <section className="proposal-export-zone">
            <div>
              <strong>{t('提案包', '提案パッケージ')}</strong>
              <p>
                {t(
                  '将 message.txt、脱敏档案 PDF 和验证 Manifest 导出为 ZIP。',
                  'message.txt、脱敏プロフィールPDF、検証用ManifestをZIPで書き出します。'
                )}
              </p>
            </div>
            <button
              disabled={followUpStarted || !approvalCurrent || dirty || busy !== 'idle'}
              onClick={() => void exportPackage()}
              type="button"
            >
              {busy === 'export' ? t('正在导出…', '書き出し中…') : t('导出已批准的提案包', '承認済みパッケージを書き出す')}
            </button>
            <span>
              <Icon name="alert" size={13} />
              {t('导出不等于发送，也不会增加 Gmail 权限。', '書き出しは送信ではありません。Gmail権限は追加されません。')}
            </span>
          </section>
          <ProposalFollowUpPanel draft={draft} onRecord={onRecordFollowUp} />
          {error ? (
            <p className="proposal-error" role="alert">
              {error}
            </p>
          ) : null}
          {notice ? (
            <p className="proposal-notice" role="status">
              {notice}
            </p>
          ) : null}
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
  const { t } = useLocaleText()
  const [selectedDraftId, setSelectedDraftId] = useState<string | null>(null)
  const [creatingNew, setCreatingNew] = useState(false)
  if (status === 'loading' || status === 'idle')
    return (
      <div className="proposal-loading">
        <span className="matching-spinner" />
        {t('正在准备提案工作区…', '提案ワークスペースを準備中…')}
      </div>
    )
  if (status === 'error' || !workspace)
    return (
      <div className="proposal-empty-state">
        <Icon name="alert" size={20} />
        <strong>{t('无法读取提案工作区', '提案ワークスペースを読み込めませんでした')}</strong>
        <p>{error}</p>
      </div>
    )
  const selectedDraft = workspace.drafts.find((draft) => draft.id === selectedDraftId) ?? workspace.drafts[0] ?? null
  const selectedEvidence = selectedDraft ? (workspace.evidence.find((evidence) => evidence.draftId === selectedDraft.id) ?? null) : null
  const showCreation = creatingNew || !selectedDraft
  return (
    <div className="proposal-workbench">
      <header className="proposal-workbench-header">
        <div>
          <h2>{t('提案草稿', '提案草稿')}</h2>
          <p>{t('本地生成 · 内容哈希审批 · 不自动发送', 'ローカル生成 · 内容ハッシュ承認 · 自動送信なし')}</p>
        </div>
        {selectedDraft && !showCreation ? (
          <button onClick={() => setCreatingNew(true)} type="button">
            <Icon name="plus" size={13} />
            {t('其他人员的草稿', '別候補者の草稿')}
          </button>
        ) : null}
      </header>
      {workspace.drafts.length > 0 ? (
        <div className="proposal-draft-tabs">
          {workspace.drafts.map((draft) => (
            <button
              className={!showCreation && selectedDraft?.id === draft.id ? 'is-active' : ''}
              key={draft.id}
              onClick={() => {
                setSelectedDraftId(draft.id)
                setCreatingNew(false)
              }}
              type="button"
            >
              {draft.attachment.anonymousCandidateLabel}
              <span>
                {draft.followUp.stage
                  ? proposalFollowUpLabel(draft.followUp.stage, t)
                  : draft.status === 'awaiting_review'
                    ? t('待确认', '確認待ち')
                    : draft.status === 'approved'
                      ? t('已批准', '承認済み')
                      : draft.status === 'exported'
                        ? t('已导出', '書出済み')
                        : t('需要确认', '要確認')}
              </span>
            </button>
          ))}
        </div>
      ) : null}
      {showCreation ? (
        <ProposalCreationForm
          onCreate={async (input) => {
            const result = await onCreate(input)
            setSelectedDraftId(result.draft.id)
            setCreatingNew(false)
            return result
          }}
          options={workspace.options}
          taskId={taskId}
        />
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
      ) : selectedDraft ? (
        <div className="proposal-empty-state">
          <Icon name="alert" size={20} />
          <strong>{t('无法读取固定版本的依据', '固定バージョンの証跡を読み込めません')}</strong>
          <p>
            {t(
              '案件或人员数据可能已删除；请停止对外提供并检查数据管理记录。',
              '案件または候補者データが削除された可能性があります。外部提供を停止してデータ管理履歴を確認してください。'
            )}
          </p>
        </div>
      ) : null}
    </div>
  )
}
