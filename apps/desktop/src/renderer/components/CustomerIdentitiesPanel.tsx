import { useEffect, useRef, useState } from 'react'
import type { CustomerIdentity } from '@shared'
import { localizedIpcError, useUiLocale } from '../i18n'
export function CustomerIdentitiesPanel({ active = true }: { active?: boolean }) {
  const locale = useUiLocale(),
    zh = locale === 'zh-CN',
    t = (cn: string, ja: string) => (zh ? cn : ja)
  const [rows, setRows] = useState<CustomerIdentity[]>([]),
    [editing, setEditing] = useState<CustomerIdentity | null>(null),
    [name, setName] = useState(''),
    [aliases, setAliases] = useState(''),
    [busy, setBusy] = useState(false),
    [error, setError] = useState('')
  const lock = useRef(false)
  useEffect(() => {
    if (!active || !window.sesAgent.listCustomerIdentities) return
    let live = true
    void window.sesAgent
      .listCustomerIdentities()
      .then((r) => {
        if (live) setRows(r)
      })
      .catch((e) => {
        if (live) setError(localizedIpcError(locale, e, t('无法读取客户名称。', '顧客名を読み込めませんでした。')))
      })
    return () => {
      live = false
    }
  }, [active])
  const reset = () => {
    setEditing(null)
    setName('')
    setAliases('')
  }
  return (
    <details className="customer-identities">
      <summary>{t('客户名称与别名', '顧客名と別名')}</summary>
      <p>
        {t(
          '将同一客户的简称和正式名称关联，便于沿用经验。只有明确关联的名称才会合并使用；删除别名即可解除关联。',
          '同じ顧客の略称と正式名称を関連付けて経験を適用します。明示した名称だけを関連付け、別名を削除すると解除できます。'
        )}
      </p>
      {rows.map((row) => (
        <article className="work-rule-card" key={row.id}>
          <strong>{row.name}</strong>
          <p>{row.aliases.join(' · ')}</p>
          <button
            onClick={() => {
              setEditing(row)
              setName(row.name)
              setAliases(row.aliases.join('\n'))
              setError('')
            }}
          >
            {t('编辑关联', '関連付けを編集')}
          </button>
        </article>
      ))}
      <form
        className="work-rule-editor"
        onSubmit={(event) => {
          event.preventDefault()
          if (lock.current) return
          lock.current = true
          setBusy(true)
          setError('')
          void window.sesAgent
            .saveCustomerIdentity({
              ...(editing ? { id: editing.id } : {}),
              expectedVersion: editing?.version ?? 0,
              name,
              aliases: aliases
                .split('\n')
                .map((s) => s.trim())
                .filter(Boolean)
            })
            .then((r) => {
              setRows(r)
              reset()
              window.dispatchEvent(new Event('ses-business-data-changed'))
            })
            .catch((e) => setError(localizedIpcError(locale, e, t('保存失败，请重试。', '保存できませんでした。もう一度お試しください。'))))
            .finally(() => {
              lock.current = false
              setBusy(false)
            })
        }}
      >
        <label>
          {t('正式名称', '正式名称')}
          <input disabled={busy} required maxLength={120} value={name} onChange={(e) => setName(e.target.value)} />
        </label>
        <label>
          {t('其他名称，每行一个', '別名を一行に一つ')}
          <textarea disabled={busy} value={aliases} onChange={(e) => setAliases(e.target.value)} maxLength={3600} />
        </label>
        {error ? <p role="alert">{error}</p> : null}
        <div className="work-rule-actions">
          <button disabled={busy || !name.trim()}>{t('保存名称关联', '名称の関連付けを保存')}</button>
          {editing ? (
            <button type="button" disabled={busy} onClick={reset}>
              {t('取消编辑', '編集を中止')}
            </button>
          ) : null}
        </div>
      </form>
    </details>
  )
}
