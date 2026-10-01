import { useEffect, useState } from 'react'
import type { RequirementConfirmation } from '@shared'
import { localizedIpcError, useLocaleText } from '../i18n'
import { announceRequirementDecision, onRequirementDecision } from '../requirement-decision-events'

/**
 * HR's decisions written into the person's record (「写入人员资料」): they apply to every case asking the same
 * thing, so they are listed with the person and can be withdrawn here, not only from the case they were made in.
 */
export function PersonRequirementDecisions({ documentId }: { documentId: string }) {
  const { locale, t } = useLocaleText()
  const [rows, setRows] = useState<RequirementConfirmation[]>([])
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState('')
  useEffect(() => {
    let alive = true
    const load = () =>
      void window.sesAgent
        .listRequirementConfirmations?.(documentId)
        .then((list) => {
          if (alive) setRows(list)
        })
        .catch(() => undefined)
    load()
    const stop = onRequirementDecision((detail) => {
      if (detail.documentId === documentId) load()
    })
    return () => {
      alive = false
      stop()
    }
  }, [documentId])
  if (!rows.length) return null
  const outcome = (row: RequirementConfirmation) =>
    row.outcome === 'met' ? t('满足', '充足') : row.outcome === 'conflict' ? t('不满足', '未充足') : t('沟通中', '確認中')
  const withdraw = async (row: RequirementConfirmation) => {
    if (busy || !window.sesAgent.withdrawRequirementDecision) return
    setBusy(row.id)
    setError('')
    try {
      const result = await window.sesAgent.withdrawRequirementDecision({ id: row.id, documentId })
      announceRequirementDecision({ ...result, documentId })
      setRows((current) => current.filter((item) => item.id !== row.id))
    } catch (cause) {
      setError(localizedIpcError(locale, cause, t('撤销失败，请重试。', '取り消せませんでした。もう一度お試しください。')))
    } finally {
      setBusy(null)
    }
  }
  return (
    <section className="person-requirement-decisions" aria-label={t('HR 的条件判断', 'HR の条件判断')}>
      <h3>{t('HR 的条件判断', 'HR の条件判断')}</h3>
      <p>
        {t(
          '「所有案件」的判断适用于提出相同条件的每个案件；「仅一个案件」的只用于做出判断的那个案件。',
          '「すべての案件」の判断は同じ条件を求める各案件に、「1 件の案件のみ」は判断した案件だけに適用されます。'
        )}
      </p>
      <ul>
        {rows.map((row) => (
          <li key={row.id}>
            <span className={`requirement-pill is-${row.outcome === 'met' ? 'met' : row.outcome === 'conflict' ? 'conflict' : 'asking'}`}>
              {outcome(row)}
            </span>
            <strong>{row.requirementLabel}</strong>
            <small>{row.scope === 'person' ? t('所有案件', 'すべての案件') : t('仅一个案件', '1 件の案件のみ')}</small>
            {row.note ? <small>{row.note}</small> : null}
            <button
              type="button"
              disabled={busy !== null}
              title={
                row.scope === 'person'
                  ? t('撤销后，所有提出这个条件的案件都会恢复原来的判断。', '取り消すと、この条件を求めるすべての案件で元の判断に戻ります。')
                  : t('只撤销这一个案件里的判断。', 'この案件の判断だけを取り消します。')
              }
              onClick={() => void withdraw(row)}
            >
              {busy === row.id ? t('撤销中…', '取消中…') : t('撤销', '取り消す')}
            </button>
          </li>
        ))}
      </ul>
      {error ? <p role="alert">{error}</p> : null}
    </section>
  )
}
