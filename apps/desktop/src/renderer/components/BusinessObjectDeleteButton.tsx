import { createPortal } from 'react-dom'
import { useEffect, useRef, useState } from 'react'
import type { CandidateDeletionPreview, JobCaseDeletionPreview, DataDeletionReport } from '@shared'
import { localizedIpcError, useUiLocale, localeText } from '../i18n'
import './business-object-delete.css'

/** Uses the same impact snapshot and deletion service as the full profile pages. */
export function BusinessObjectDeleteButton({
  kind,
  id,
  title,
  disabled,
  onDeleted,
  onPreview,
  onDelete
}: {
  kind: 'case' | 'person'
  id: string
  title: string
  disabled?: boolean
  onPreview?(): Promise<CandidateDeletionPreview | JobCaseDeletionPreview>
  onDelete?(confirmationHash: string): Promise<{ report: DataDeletionReport }>
  onDeleted(report: DataDeletionReport): Promise<void> | void
}) {
  const locale = useUiLocale()
  const zh = locale === 'zh-CN'
  const t = localeText(zh)
  const [open, setOpen] = useState(false)
  const [preview, setPreview] = useState<CandidateDeletionPreview | JobCaseDeletionPreview | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const pending = useRef(false)
  const trigger = useRef<HTMLButtonElement>(null)
  const cancel = useRef<HTMLButtonElement>(null)
  useEffect(() => {
    if (!open) return
    let active = true
    cancel.current?.focus()
    setPreview(null)
    setError('')
    const result = onPreview
      ? onPreview()
      : kind === 'case'
        ? window.sesAgent.previewJobCaseDeletion(id)
        : window.sesAgent.previewCandidateDeletion(id)
    void result
      .then((value) => {
        if (active) setPreview(value)
      })
      .catch((cause) => {
        if (active) setError(localizedIpcError(locale, cause, t('无法确认删除影响。', '削除影響を確認できませんでした。')))
      })
    return () => {
      active = false
    }
  }, [open, kind, id])
  const close = () => {
    if (!pending.current) {
      setOpen(false)
      trigger.current?.focus()
    }
  }
  const remove = async () => {
    if (!preview || pending.current) return
    pending.current = true
    setBusy(true)
    setError('')
    let deleted = false
    try {
      const result = onDelete
        ? await onDelete(preview.confirmationHash)
        : kind === 'case'
          ? await window.sesAgent.deleteJobCaseData({ reviewId: id, confirmationHash: preview.confirmationHash, confirmationText: '削除' }) // i18n-ignore: confirmation token checked by Main
          : await window.sesAgent.deleteCandidateData({
              sourceDocumentId: id,
              confirmationHash: preview.confirmationHash,
              // i18n-ignore: confirmation token checked by Main
              confirmationText: '削除'
            })
      deleted = result.report.components.database === 'deleted'
      if (!deleted) throw new Error(t('删除未完成，请刷新后重试。', '削除が完了しませんでした。再読込してください。'))
      await onDeleted(result.report)
      setOpen(false)
    } catch (cause) {
      setError(
        deleted
          ? t('记录已删除，列表刷新失败，请刷新列表。', '削除済みですが一覧を更新できませんでした。再読込してください。')
          : localizedIpcError(locale, cause, t('删除失败，请重试。', '削除できませんでした。もう一度お試しください。'))
      )
      // A changed impact snapshot needs another preview before retrying.
      setPreview(null)
    } finally {
      pending.current = false
      setBusy(false)
    }
  }
  return (
    <>
      <button
        className="business-delete-button"
        ref={trigger}
        aria-label={`${t('删除', '削除')} ${title}`}
        disabled={disabled || busy}
        onClick={(event) => {
          event.stopPropagation()
          setOpen(true)
        }}
        type="button"
      >
        {t('删除', '削除')}
      </button>
      {open
        ? createPortal(
            <div className="business-delete-backdrop" onClick={(event) => event.stopPropagation()}>
              <section
                className="business-delete-dialog"
                role="dialog"
                aria-modal="true"
                aria-label={t('确认删除', '削除の確認')}
                onKeyDown={(event) => {
                  event.stopPropagation()
                  if (event.key === 'Escape') close()
                  if (event.key === 'Tab') {
                    const buttons = [...event.currentTarget.querySelectorAll<HTMLButtonElement>('button:not(:disabled)')]
                    const first = buttons[0],
                      last = buttons.at(-1)
                    if (event.shiftKey && document.activeElement === first) {
                      event.preventDefault()
                      last?.focus()
                    } else if (!event.shiftKey && document.activeElement === last) {
                      event.preventDefault()
                      first?.focus()
                    }
                  }
                }}
              >
                <h3>{kind === 'case' ? t('删除案件', '案件を削除') : t('删除人员', '要員を削除')}</h3>
                <p className="business-delete-target">{title}</p>
                <p className="business-delete-warning">
                  {t('将永久删除本地资料及其关联记录，无法恢复。', 'ローカル資料と関連記録を完全に削除します。元に戻せません。')}
                </p>
                {preview ? (
                  <dl className="business-delete-impact">
                    <div>
                      <dt>{t('资料版本', '資料の版')}</dt>
                      <dd>{'caseVersions' in preview.counts ? preview.counts.caseVersions : preview.counts.profileVersions}</dd>
                    </div>
                    <div>
                      <dt>{t('跟进记录', '対応記録')}</dt>
                      <dd>{preview.counts.businessFollowUps ?? 0}</dd>
                    </div>
                    {'endedPlacements' in preview.counts && preview.counts.endedPlacements ? (
                      <div>
                        <dt>{t('其中已退场记录', 'うち退場済みの記録')}</dt>
                        <dd>{preview.counts.endedPlacements}</dd>
                      </div>
                    ) : null}
                    {'introductionDrafts' in preview.counts && preview.counts.introductionDrafts ? (
                      <div>
                        <dt>{t('人员介绍草稿', '要員紹介の下書き')}</dt>
                        <dd>{preview.counts.introductionDrafts}</dd>
                      </div>
                    ) : null}
                    {'caseVersions' in preview.counts
                      ? (
                          [
                            ['caseBroadcastCopies', t('群发记录', '配信記録')],
                            ['caseIntroductionDrafts', t('案件介绍草稿', '案件紹介の下書き')],
                            ['recommendationPoints', t('推荐要点', '推薦ポイント')],
                            ['matchingOpportunities', t('匹配机会', 'マッチング機会')],
                            ['requirementDecisions', t('要求判定', '要件の判断')],
                            ['questionDrafts', t('面试问题草稿', '面談質問の下書き')],
                            ['personAssessments', t('人员评估', '要員評価')]
                          ] as const
                        ).map(([key, label]) => {
                          const value = (preview.counts as Record<string, unknown>)[key]
                          return typeof value === 'number' && value > 0 ? (
                            <div key={key}>
                              <dt>{label}</dt>
                              <dd>{value}</dd>
                            </div>
                          ) : null
                        })
                      : null}
                    <div>
                      <dt>{t('关联任务', '関連タスク')}</dt>
                      <dd>{preview.counts.taskRecords}</dd>
                    </div>
                    <div>
                      <dt>{t('会话引用', '会話参照')}</dt>
                      <dd>{preview.counts.agentReferences.messages}</dd>
                    </div>
                  </dl>
                ) : !error ? (
                  <p role="status">{t('正在读取删除影响…', '削除の影響を確認中…')}</p>
                ) : null}
                {preview && 'activePlacements' in preview.counts && preview.counts.activePlacements ? (
                  <p role="alert" className="business-delete-blocked">
                    {t(
                      kind === 'case'
                        ? `有 ${preview.counts.activePlacements} 名人员通过这个案件处于已进场。请先在跟进中记录退场或撤销进场，再删除案件。`
                        : '这个人员还处于已进场。请先在跟进中记录退场或撤销进场，再删除。',
                      kind === 'case'
                        ? `この案件で参画中の要員が ${preview.counts.activePlacements} 名います。対応記録で退場または参画取消を記録してから削除してください。`
                        : 'この要員は参画中です。対応記録で退場または参画取消を記録してから削除してください。'
                    )}
                  </p>
                ) : null}
                {error ? <p role="alert">{error}</p> : null}
                <div className="business-delete-actions">
                  <button className="business-delete-cancel" ref={cancel} disabled={busy} onClick={close} type="button">
                    {t('取消', 'キャンセル')}
                  </button>
                  <button
                    className="business-delete-confirm"
                    disabled={
                      !preview || busy || Boolean(preview && 'activePlacements' in preview.counts && preview.counts.activePlacements)
                    }
                    onClick={() => void remove()}
                    type="button"
                  >
                    {busy ? t('删除中…', '削除中…') : t('确认删除', '削除を確定')}
                  </button>
                </div>
              </section>
            </div>,
            document.body
          )
        : null}
    </>
  )
}
