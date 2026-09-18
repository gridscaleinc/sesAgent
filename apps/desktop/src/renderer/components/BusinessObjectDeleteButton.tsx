import { createPortal } from 'react-dom'
import { useEffect, useRef, useState } from 'react'
import type { CandidateDeletionPreview, JobCaseDeletionPreview, DataDeletionReport } from '@shared'
import { useUiLocale } from '../i18n'
import './business-object-delete.css'

/** Uses the same impact snapshot and deletion service as the full profile pages. */
export function BusinessObjectDeleteButton({ kind, id, title, disabled, onDeleted, onPreview, onDelete }: {
  kind: 'case' | 'person'; id: string; title: string; disabled?: boolean
  onPreview?(): Promise<CandidateDeletionPreview | JobCaseDeletionPreview>
  onDelete?(confirmationHash: string): Promise<{ report: DataDeletionReport }>
  onDeleted(report: DataDeletionReport): Promise<void> | void
}) {
  const zh = useUiLocale() === 'zh-CN'
  const t = (cn: string, ja: string) => zh ? cn : ja
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
    setPreview(null); setError('')
    const result = onPreview ? onPreview() : kind === 'case' ? window.sesAgent.previewJobCaseDeletion(id) : window.sesAgent.previewCandidateDeletion(id)
    void result.then((value) => { if (active) setPreview(value) }).catch((cause) => { if (active) setError(String(cause)) })
    return () => { active = false }
  }, [open, kind, id])
  const close = () => { if (!pending.current) { setOpen(false); trigger.current?.focus() } }
  const remove = async () => {
    if (!preview || pending.current) return
    pending.current = true; setBusy(true); setError('')
    let deleted = false
    try {
      const result = onDelete ? await onDelete(preview.confirmationHash) : kind === 'case'
        ? await window.sesAgent.deleteJobCaseData({ reviewId: id, confirmationHash: preview.confirmationHash, confirmationText: '削除' })
        : await window.sesAgent.deleteCandidateData({ sourceDocumentId: id, confirmationHash: preview.confirmationHash, confirmationText: '削除' })
      deleted = result.report.components.database === 'deleted'
      if (!deleted) throw new Error(t('删除未完成，请刷新后重试。', '削除が完了しませんでした。再読込してください。'))
      await onDeleted(result.report)
      setOpen(false)
    } catch (cause) {
      setError(deleted ? t('记录已删除，列表刷新失败，请刷新列表。', '削除済みですが一覧を更新できませんでした。再読込してください。') : String(cause))
      // A changed impact snapshot needs another preview before retrying.
      setPreview(null)
    } finally { pending.current = false; setBusy(false) }
  }
  return <>
    <button className="business-delete-button" ref={trigger} aria-label={`${t('删除', '削除')} ${title}`} disabled={disabled || busy} onClick={(event) => { event.stopPropagation(); setOpen(true) }} type="button">{t('删除', '削除')}</button>
    {open ? createPortal(<div className="business-delete-backdrop" onClick={(event) => event.stopPropagation()}>
      <section className="business-delete-dialog" role="dialog" aria-modal="true" aria-label={t('确认删除', '削除の確認')} onKeyDown={(event) => {
        event.stopPropagation()
        if (event.key === 'Escape') close()
        if (event.key === 'Tab') {
          const buttons = [...event.currentTarget.querySelectorAll<HTMLButtonElement>('button:not(:disabled)')]
          const first = buttons[0], last = buttons.at(-1)
          if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus() }
          else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus() }
        }
      }}>
        <h3>{kind === 'case' ? t('删除案件', '案件を削除') : t('删除人员', '要員を削除')}</h3>
        <p><strong>{title}</strong></p>
        <p>{t('将永久删除本地资料及其关联记录，无法恢复。', 'ローカル資料と関連記録を完全に削除します。元に戻せません。')}</p>
        {preview ? <ul>
          <li>{t('资料版本', '資料の版')}：{'caseVersions' in preview.counts ? preview.counts.caseVersions : preview.counts.profileVersions}</li>
          <li>{t('跟进记录', '対応記録')}：{preview.counts.businessFollowUps ?? 0}</li>
          <li>{t('关联任务', '関連タスク')}：{preview.counts.taskRecords}</li>
          <li>{t('会话引用', '会話参照')}：{preview.counts.agentReferences.messages}</li>
        </ul> : !error ? <p role="status">{t('正在读取删除影响…', '削除の影響を確認中…')}</p> : null}
        {error ? <p role="alert">{error}</p> : null}
        <div className="business-delete-actions"><button ref={cancel} disabled={busy} onClick={close} type="button">{t('取消', 'キャンセル')}</button><button className="business-delete-button" disabled={!preview || busy} onClick={() => void remove()} type="button">{busy ? t('删除中…', '削除中…') : t('确认删除', '削除を確定')}</button></div>
      </section>
    </div>, document.body) : null}
  </>
}
