import { useEffect, useId, useRef, useState, type FormEvent } from 'react'
import type { ImportCaseTextBatchResult, JobCaseReviewSnapshot } from '@shared'
import { useUiLocale } from '../i18n'

export function CaseTextImport({ inputSeed, onRefresh, onImport = window.sesAgent.importCaseTextBatch }: {
  inputSeed?: { id: number; text: string }
  cases: JobCaseReviewSnapshot[]
  onRefresh(): Promise<void>
  onImport?(input: { text: string }): Promise<ImportCaseTextBatchResult>
}) {
  const zh = useUiLocale() === 'zh-CN'
  const t = (cn: string, ja: string) => zh ? cn : ja
  const id = useId()
  const [text, setText] = useState('')
  const [running, setRunning] = useState(false)
  const [notice, setNotice] = useState('')
  const [error, setError] = useState('')
  const busy = useRef(false)
  const seed = useRef<number | null>(null)
  useEffect(() => {
    if (!inputSeed || seed.current === inputSeed.id || running) return
    seed.current = inputSeed.id
    setText(current => current.trim() ? `${current}\n\n${inputSeed.text}` : inputSeed.text)
  }, [inputSeed, running])

  const save = async (event: FormEvent) => {
    event.preventDefault()
    if (busy.current || !text.trim()) return
    busy.current = true; setRunning(true); setError(''); setNotice('')
    try {
      const result = await onImport({ text })
      setText(result.remainingText)
      setNotice(t(`已新增 ${result.created} 个案件，跳过 ${result.duplicates} 个重复案件。`, `${result.created}件を追加し、重複${result.duplicates}件をスキップしました。`))
      if (result.failed) setError(t(`${result.failed} 条未能保存，原文已保留，请修改后重试。`, `${result.failed}件を保存できませんでした。入力を保持しています。修正して再試行してください。`))
      try {
        await onRefresh()
        window.dispatchEvent(new Event('ses-cases-imported'))
      } catch { setError(t('案件已保存，但列表刷新失败，请刷新列表。', '案件は保存済みですが、一覧を更新できませんでした。再読込してください。')) }
    } catch (cause) {
      setError(String(cause).includes('CASE_AI_UNAVAILABLE')
        ? t('请先连接 AI，再新增案件。输入已保留。', 'AIに接続してから案件を追加してください。入力は保持しています。')
        : t('AI 未能完成案件识别，本次没有保存，输入已保留，请重试。', 'AIが案件の識別を完了できませんでした。保存せず入力を保持しています。再試行してください。'))
    } finally { busy.current = false; setRunning(false) }
  }

  return <form className="business-intake business-paste-box" onSubmit={event => void save(event)} aria-label={t('新增案件', '案件を追加')}>
    <label htmlFor={id}>{t('案件内容', '案件内容')}</label>
    <textarea id={id} rows={16} value={text} disabled={running} onChange={event => setText(event.target.value)}
      placeholder={t('把案件内容粘贴到这里，可一次粘贴多个案件。', '案件情報を貼り付けてください。複数の案件をまとめて追加できます。')} />
    <div className="business-inline-actions"><button className="is-primary" type="submit" disabled={running || !text.trim()}>{running ? t('AI 正在识别并保存…', 'AIが識別・保存中…') : t('新增案件', '案件を追加')}</button></div>
    {notice ? <p role="status">{notice}</p> : null}
    {error ? <p role="alert">{error}</p> : null}
  </form>
}
