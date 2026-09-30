import { useEffect, useRef, useState } from 'react'
import type { PersonnelMailUpdate } from '@shared'
import { localizedIpcError, useUiLocale } from '../i18n'

export function PersonnelMailUpdates({ documentId, version }: { documentId: string; version: number }) {
  const zh = useUiLocale() === 'zh-CN',
    t = (cn: string, ja: string) => (zh ? cn : ja)
  const [rows, setRows] = useState<PersonnelMailUpdate[]>([]),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false),
    [reload, setReload] = useState(0)
  const lock = useRef(false)
  useEffect(() => {
    let alive = true
    setRows([])
    setError('')
    void window.sesAgent
      .listPersonnelMailUpdates?.(documentId)
      .then((value) => {
        if (alive) setRows(value.filter((row) => row.status === 'pending'))
      })
      .catch(() => {
        if (alive) setError(t('未能读取邮件条件更新', 'メールの条件更新を読み込めませんでした'))
      })
    return () => {
      alive = false
    }
  }, [documentId, version, reload])
  const resolve = async (row: PersonnelMailUpdate, action: 'apply' | 'dismiss') => {
    if (lock.current) return
    lock.current = true
    setBusy(true)
    setError('')
    try {
      await window.sesAgent.resolvePersonnelMailUpdate({ id: row.id, action, expectedVersion: version })
      setRows((current) => current.filter((item) => item.id !== row.id))
      window.dispatchEvent(new CustomEvent('ses-business-data-changed', { detail: { kind: 'person', id: documentId } }))
    } catch (cause) {
      setError(
        localizedIpcError(
          zh ? 'zh-CN' : 'ja-JP',
          cause,
          t('更新未完成，请刷新资料后重试。', '更新できませんでした。プロフィールを再読込して再試行してください。')
        )
      )
    } finally {
      lock.current = false
      setBusy(false)
    }
  }
  if (!rows.length && !error) return null
  const labels = {
    rate: t('单价', '単価'),
    availability: t('可入场时间', '稼働可能時期'),
    work_style: t('工作方式', '勤務形態'),
    location: t('期望地点', '希望勤務地')
  }
  return (
    <section className="personnel-mail-updates" aria-label={t('邮件条件更新', 'メールの条件更新')}>
      <h4>{t('邮件条件更新', 'メールの条件更新')}</h4>
      {error ? (
        <p role="alert">
          {error}
          <button disabled={busy} onClick={() => setReload((value) => value + 1)}>
            {t('重试', '再試行')}
          </button>
        </p>
      ) : null}
      {rows.map((row) => (
        <article key={row.id}>
          <strong>{labels[row.field]}</strong>
          <p>
            {(row.currentValue === undefined ? row.previousValue : row.currentValue) || t('未填写', '未記入')} → {row.value}
          </p>
          <small>
            {new Date(row.receivedAt).toLocaleDateString()} · {row.subject}
          </small>
          <p>
            {row.reason === 'multiple-people'
              ? t(
                  '邮件涉及多份人员资料，请对照原文在资料中分别修改。',
                  '複数の要員資料が含まれます。原文を確認し、各プロフィールを編集してください。'
                )
              : t(
                  '与已由 HR 设置的条件不同，请选择采用邮件更新或保留当前资料。',
                  'HRが設定した条件と異なります。メールの更新を採用するか、現在の情報を保持してください。'
                )}
          </p>
          <details>
            <summary>{t('查看邮件原文', 'メール原文を見る')}</summary>
            <p style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{row.evidence}</p>
          </details>
          <div className="hr-progress-actions">
            {row.reason !== 'multiple-people' ? (
              <button disabled={busy} onClick={() => void resolve(row, 'apply')}>
                {t('采用邮件条件', 'メールの条件を採用')}
              </button>
            ) : null}
            <button disabled={busy} onClick={() => void resolve(row, 'dismiss')}>
              {row.reason === 'multiple-people' ? t('已核对处理', '確認済みにする') : t('保留当前资料', '現在の情報を保持')}
            </button>
          </div>
        </article>
      ))}
    </section>
  )
}
