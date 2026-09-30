import { PersonnelMailUpdates } from './PersonnelMailUpdates'
import { BusinessField } from './BusinessField'
import { useEffect, useRef, useState, type ReactNode } from 'react'
import {
  isPersonnelAvailable,
  type CandidateReviewSnapshot,
  type PersonnelWorkspace as Workspace,
  type CandidateBusinessStatus
} from '@shared'
import { localizedIpcError, useLocaleText } from '../i18n'
import { CandidateProfileSummary } from './CandidateProfileSummary'
import { usePersonCaseMatchCounts } from '../person-case-match-cache'

interface Props {
  renderBusinessProgress?(kind: 'person' | 'case', id: string): ReactNode
  /** @deprecated A global lock; this person's own 「找案件」 run is already tracked by the match cache. */
  matchingBusy?: boolean
  onMatch?(): void
  onPrepare?(): void
  /** Scrolls the panel to this person when the list asks to view them again. */
  focusRequest?: { id: number; documentId: string }
  reviews: CandidateReviewSnapshot[]
  initialDocumentId?: string
  onRefresh(): Promise<void>
  onOpenProfile(documentId: string): void
  /** Own-company hiring interviews (自社採用面談) are a separate workflow from client interviews, which live in the follow-up. */
  onOpenRecruiting?(documentId: string): void
}

/** The person shown in the right panel beside the HR list: facts, affiliation, business status and the next business actions. */
export function PersonnelWorkspace({
  renderBusinessProgress,
  matchingBusy,
  onMatch,
  onPrepare,
  focusRequest,
  reviews,
  initialDocumentId,
  onRefresh,
  onOpenProfile,
  onOpenRecruiting
}: Props) {
  const { locale, t } = useLocaleText()
  const matches = usePersonCaseMatchCounts()
  const [savedReviews, setSavedReviews] = useState<Record<string, CandidateReviewSnapshot>>({})
  const [affiliationStatus, setAffiliationStatus] = useState<{ documentId: string; text: string; failed?: boolean } | null>(null)
  const [workspace, setWorkspace] = useState<Workspace | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const actionPending = useRef(false)
  const detailSection = useRef<HTMLDivElement>(null)
  const appliedFocus = useRef(0)
  const loadSequence = useRef(0)
  const load = async () => {
    const sequence = ++loadSequence.current
    const value = await window.sesAgent.getPersonnelWorkspace()
    if (sequence === loadSequence.current) setWorkspace(value)
  }
  useEffect(() => {
    let active = true
    void load().catch((cause) => {
      if (active) setError(localizedIpcError(locale, cause, t('无法读取人员工作区。', '要員の画面を読み込めませんでした。')))
    })
    return () => {
      active = false
      loadSequence.current++
    }
  }, [reviews])
  useEffect(() => {
    setError(null)
  }, [initialDocumentId])
  const selected =
    reviews
      .filter((item) => item.recordStatus === 'active')
      .map((item) => {
        const saved = savedReviews[item.documentId]
        return saved && (saved.profile?.version ?? 0) > (item.profile?.version ?? 0) ? saved : item
      })
      .find((item) => item.documentId === initialDocumentId) ?? null
  const statusOf = (review: CandidateReviewSnapshot) =>
    workspace?.states.find((state) => state.documentId === review.documentId)?.status ?? 'available'
  const ready = (review: CandidateReviewSnapshot) =>
    Boolean(workspace) && review.recordStatus === 'active' && isPersonnelAvailable(statusOf(review)) && Boolean(review.profile)
  const readinessNote =
    selected && workspace && !isPersonnelAvailable(statusOf(selected))
      ? t('此人员已入场或暂停营业，可在下方营业状态中调整。', 'この要員は参画中または営業停止中です。下の営業状態で変更できます。')
      : null
  const label = (review: CandidateReviewSnapshot) => review.localIdentity?.displayName ?? review.fileName.replace(/\.[^.]+$/u, '')
  const action = async (operation: () => Promise<void>) => {
    if (actionPending.current) return
    actionPending.current = true
    setBusy(true)
    setError(null)
    try {
      await operation()
    } catch (cause) {
      setError(localizedIpcError(locale, cause, t('操作失败，请重试。', '操作に失敗しました。もう一度お試しください。')))
    } finally {
      actionPending.current = false
      setBusy(false)
    }
  }
  const saveOwnCompany = (review: CandidateReviewSnapshot, value: boolean | null) => {
    if (!review.profile || (review.isOwnCompany ?? null) === value) return
    void action(async () => {
      const documentId = review.documentId
      setAffiliationStatus({ documentId, text: t('保存中…', '保存中…') })
      try {
        const updated = await window.sesAgent.setCandidateOwnCompany({
          documentId,
          expectedVersion: review.profile!.version,
          isOwnCompany: value
        })
        setSavedReviews((current) => ({ ...current, [documentId]: updated }))
        setAffiliationStatus({ documentId, text: t('已保存', '保存しました') })
        try {
          await onRefresh()
        } catch {
          setAffiliationStatus({ documentId, text: t('已保存，列表刷新失败', '保存済み。一覧の再読込に失敗しました'), failed: true })
        }
      } catch (cause) {
        setAffiliationStatus({
          documentId,
          text: localizedIpcError(locale, cause, t('保存失败，请重试。', '保存できませんでした。もう一度お試しください。')),
          failed: true
        })
      }
    })
  }
  useEffect(() => {
    if (!focusRequest || focusRequest.documentId !== selected?.documentId || appliedFocus.current === focusRequest.id) return
    const target = detailSection.current
    const scroller = target?.closest<HTMLElement>('.agent-tool-content')
    if (!target || !scroller || target.closest('[hidden]')) return
    appliedFocus.current = focusRequest.id
    // Scroll only the right pane, keeping the feed and its selected card still.
    scroller.scrollTop += target.getBoundingClientRect().top - scroller.getBoundingClientRect().top - 12
    target.focus({ preventScroll: true })
  }, [focusRequest, selected?.documentId, workspace])
  return (
    <section className="personnel-workspace is-compact">
      {error ? (
        <p role="alert" className="business-error">
          {error}
        </p>
      ) : null}
      <div className="personnel-layout">
        <div className="personnel-detail" ref={detailSection} tabIndex={-1}>
          {selected ? (
            <>
              <header className="personnel-detail-header">
                <div>
                  <span className="personnel-detail-eyebrow">{t('人员资料', '要員情報')}</span>
                  <h3>
                    <BusinessField
                      kind="person"
                      id={selected.documentId}
                      version={selected.profile?.version ?? 1}
                      field="identity.displayName"
                      value={selected.localIdentity?.displayName ?? null}
                      label={t('姓名', '氏名')}
                      disabled={!selected.profile}
                    >
                      {label(selected)}
                    </BusinessField>
                  </h3>
                </div>
                <button className="personnel-text-action" onClick={() => onOpenProfile(selected.documentId)} type="button">
                  {t('查看 / 编辑完整档案', 'プロフィールの確認・編集')}
                  <span aria-hidden="true">↗</span>
                </button>
              </header>
              <PersonnelMailUpdates documentId={selected.documentId} version={selected.profile?.version ?? 1} />
              {renderBusinessProgress?.('person', selected.documentId)}
              {readinessNote ? <p className="personnel-readiness-note">{readinessNote}</p> : null}
              <CandidateProfileSummary
                key={selected.documentId}
                review={selected}
                collapseProjects
                ownCompanyControl={
                  <>
                    <select
                      aria-label={t('是否自社', '自社所属')}
                      disabled={busy || !selected.profile}
                      value={selected.isOwnCompany == null ? '' : String(selected.isOwnCompany)}
                      onChange={(event) => saveOwnCompany(selected, event.target.value === '' ? null : event.target.value === 'true')}
                    >
                      <option value="">{t('未设置', '未設定')}</option>
                      <option value="true">自社</option>
                      <option value="false">非自社</option>
                    </select>
                    {affiliationStatus?.documentId === selected.documentId ? (
                      <small role={affiliationStatus.failed ? 'alert' : 'status'}>{affiliationStatus.text}</small>
                    ) : null}
                  </>
                }
              />
              <PersonnelStatusForm
                key={`${selected.documentId}:${selected.reviewRevision}:${selected.profile?.version}:${workspace?.states.find((state) => state.documentId === selected.documentId)?.confirmedAt}`}
                disabled={!workspace}
                state={statusOf(selected)}
                onSave={async (status) => {
                  await window.sesAgent.setCandidateBusinessState({
                    documentId: selected.documentId,
                    profileVersion: selected.profile?.version ?? 0,
                    reviewRevision: selected.reviewRevision,
                    status,
                    confirmed: true
                  })
                  await load()
                  await onRefresh()
                }}
              />
              <div className="hr-person-actions">
                {/* Kept beside the list card's actions: this panel also opens where the list is hidden (matching results, follow-ups). */}
                <button
                  className="hr-primary"
                  disabled={busy || matchingBusy || matches.running(selected.documentId) || !ready(selected)}
                  type="button"
                  onClick={onMatch}
                >
                  {matches.running(selected.documentId)
                    ? t('正在找案件…', '案件を探しています…')
                    : matches.count(selected.documentId, selected.profile?.version) !== null
                      ? t(
                          `查看案件 (${matches.count(selected.documentId, selected.profile?.version)})`,
                          `案件を見る (${matches.count(selected.documentId, selected.profile?.version)})`
                        )
                      : t('找案件', '案件を探す')}
                </button>
                <button disabled={busy || !ready(selected)} type="button" onClick={onPrepare}>
                  {t('准备介绍', '紹介を準備')}
                </button>
                {onOpenRecruiting ? (
                  <button type="button" onClick={() => onOpenRecruiting(selected.documentId)}>
                    {t('自社录用面试', '自社採用面談')}
                  </button>
                ) : null}
              </div>
            </>
          ) : (
            <p>{t('选择人员后开始确认和推广。', '要員を選択して確認・紹介を始めます。')}</p>
          )}
        </div>
      </div>
    </section>
  )
}

function PersonnelStatusForm({
  disabled,
  state,
  onSave
}: {
  disabled: boolean
  state: CandidateBusinessStatus
  onSave(status: CandidateBusinessStatus): Promise<void>
}) {
  const { locale, zh, t } = useLocaleText()
  const [status, setStatus] = useState<CandidateBusinessStatus>(state)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  return (
    <form
      className="personnel-status"
      onSubmit={(event) => {
        event.preventDefault()
        if (disabled || busy) return
        setBusy(true)
        setError(null)
        void onSave(status)
          .catch((cause) =>
            setError(localizedIpcError(locale, cause, t('保存失败，请重试。', '保存できませんでした。もう一度お試しください。')))
          )
          .finally(() => setBusy(false))
      }}
    >
      <label>
        {t('营业状态', '営業状態')}
        <select disabled={disabled || busy} value={status} onChange={(event) => setStatus(event.target.value as CandidateBusinessStatus)}>
          <option value="available">{t('待营业', '営業待ち')}</option>
          <option value="soon">{t('待营业（近期可入场）', '営業待ち（近日稼働可能）')}</option>
          <option value="assigned">{t('已入场', '参画中')}</option>
          <option value="paused">{t('不可营业', '営業不可')}</option>
        </select>
      </label>
      <button disabled={disabled || busy} type="submit">
        {t('保存状态', '状態を保存')}
      </button>
      {error ? <p role="alert">{error}</p> : null}
    </form>
  )
}
