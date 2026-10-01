import { useEffect, useState } from 'react'
import type { HeldDeletion } from '@shared'
import { localizedIpcError, useLocaleText } from '../i18n'

/**
 * After restoring a backup, deletions made since then are applied again. One the restored data refused (someone was
 * in place then) is listed here until HR decides: delete it now, or keep the record for good. Nothing is deleted
 * later without asking.
 */
export function HeldDeletionsNotice() {
  const { locale, t } = useLocaleText()
  const [rows, setRows] = useState<HeldDeletion[]>([])
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState('')
  useEffect(() => {
    let alive = true
    void window.sesAgent
      ?.listHeldDeletions?.()
      .then((list) => {
        if (alive) setRows(list)
      })
      .catch(() => undefined)
    return () => {
      alive = false
    }
  }, [])
  if (!rows.length) return null
  const resolve = async (row: HeldDeletion, action: 'delete' | 'keep') => {
    if (busy || !window.sesAgent.resolveHeldDeletion) return
    setBusy(row.id)
    setError('')
    try {
      setRows(await window.sesAgent.resolveHeldDeletion({ id: row.id, action }))
      window.dispatchEvent(new Event('ses-business-data-changed'))
    } catch (cause) {
      setError(localizedIpcError(locale, cause, t('处理失败，请重试。', '処理できませんでした。もう一度お試しください。')))
    } finally {
      setBusy(null)
    }
  }
  return (
    <section className="held-deletions" role="region" aria-label={t('恢复后待确认的删除', '復元後に確認が必要な削除')}>
      <strong>{t('恢复备份后，有以下记录没能再次删除', 'バックアップ復元後、次の記録を再削除できませんでした')}</strong>
      <p>
        {t(
          '它们在备份之后被永久删除过，但备份里有人员处于已进场，所以没有自动删除。请选择现在删除，或保留这条记录。',
          'バックアップ後に完全削除した記録ですが、バックアップ時点で参画中のため自動では削除していません。今すぐ削除するか、記録を残すかを選んでください。'
        )}
      </p>
      <ul>
        {rows.map((row) => (
          <li key={row.id}>
            <span>
              {row.entityType === 'candidate' ? t('人员', '要員') : t('案件', '案件')} · {row.label}
            </span>
            {row.reason ? <small>{localizedIpcError(locale, new Error(row.reason), row.reason)}</small> : null}
            <button type="button" disabled={busy !== null} onClick={() => void resolve(row, 'delete')}>
              {busy === row.id ? t('处理中…', '処理中…') : t('现在删除', '今すぐ削除')}
            </button>
            <button type="button" disabled={busy !== null} onClick={() => void resolve(row, 'keep')}>
              {t('保留', '残す')}
            </button>
          </li>
        ))}
      </ul>
      {error ? <p role="alert">{error}</p> : null}
    </section>
  )
}
