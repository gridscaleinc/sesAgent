import { useEffect, useId, useRef, useState, type FormEvent } from 'react'
import type { ImportCaseTextBatchResult, JobCaseReviewSnapshot } from '@shared'
import { aiServiceProblem, localizedAiServiceProblem, useUiLocale, localeText } from '../i18n'
import { joinCreatedCases, revealCreatedCases } from '../case-adoption'

const shownCreated = 3

export function CaseTextImport({
  inputSeed,
  cases,
  onRefresh,
  onImport = window.sesAgent.importCaseTextBatch,
  onAddToWorking = (reviewId) => window.sesAgent.setCaseWorking({ reviewId, working: true }),
  onFindPeople,
  onOpenCase,
  onShowInList,
  onOpenPersonImport
}: {
  inputSeed?: { id: number; text: string }
  cases: JobCaseReviewSnapshot[]
  onRefresh(): Promise<void>
  onImport?(input: { text: string }): Promise<ImportCaseTextBatchResult>
  /** Adds a newly created case to 我的案件 so it shows in the list's default view. */
  onAddToWorking?(reviewId: string): Promise<unknown>
  /** 「找人」 for a newly created case (its reviewId, the case list object id). */
  onFindPeople?(caseObjectId: string): void
  /** 「查看」 a newly created case. */
  onOpenCase?(caseObjectId: string): void
  /** 「在列表中查看全部」 when more cases were created than are listed here. */
  onShowInList?(): void
  /** 「去人员页导入」 for passages that were personnel introductions. */
  onOpenPersonImport?(): void
}) {
  const zh = useUiLocale() === 'zh-CN'
  const t = localeText(zh)
  const id = useId()
  const [text, setText] = useState('')
  const [running, setRunning] = useState(false)
  const [notice, setNotice] = useState('')
  const [created, setCreated] = useState<string[]>([])
  const [skippedPersonnel, setSkippedPersonnel] = useState(0)
  const [error, setError] = useState('')
  const busy = useRef(false)
  const seed = useRef<number | null>(null)
  useEffect(() => {
    if (!inputSeed || seed.current === inputSeed.id || running) return
    seed.current = inputSeed.id
    setText((current) => (current.trim() ? `${current}\n\n${inputSeed.text}` : inputSeed.text))
  }, [inputSeed, running])

  const caseTitle = (reviewId: string, index: number) => {
    const review = cases.find((item) => item.reviewId === reviewId)
    return (
      review?.fields.find((field) => field.key === 'title')?.value?.trim() ||
      review?.redactedSubject?.trim() ||
      t(`新案件 ${index + 1}`, `新しい案件 ${index + 1}`)
    )
  }

  const save = async (event: FormEvent) => {
    event.preventDefault()
    if (busy.current || !text.trim()) return
    busy.current = true
    setRunning(true)
    setError('')
    setNotice('')
    setCreated([])
    setSkippedPersonnel(0)
    try {
      const result = await onImport({ text })
      setText(result.remainingText)
      const personnel = result.skippedPersonnel ?? 0
      const createdIds = result.createdReviewIds ?? []
      setNotice(
        t(
          `已新增 ${result.created} 个案件，跳过 ${result.duplicates} 个重复案件。`,
          `${result.created}件を追加し、重複${result.duplicates}件をスキップしました。`
        )
      )
      setSkippedPersonnel(personnel)
      if (result.failed)
        setError(
          t(
            `${result.failed} 条未能保存，原文已保留，请修改后重试。`,
            `${result.failed}件を保存できませんでした。入力を保持しています。修正して再試行してください。`
          )
        )
      // New cases go straight into 我的案件, the list's default view, so they do not vanish after saving.
      const allJoined = await joinCreatedCases(createdIds, onAddToWorking)
      if (createdIds.length && !allJoined)
        setError((current) =>
          [
            current,
            t(
              '部分新案件未能加入我的案件，可在「全部」中找到。',
              '一部の新しい案件を担当案件に追加できませんでした。「すべて」で確認できます。'
            )
          ]
            .filter(Boolean)
            .join(' ')
        )
      setCreated(createdIds)
      try {
        await onRefresh()
        revealCreatedCases(createdIds, allJoined)
      } catch {
        setError(t('案件已保存，但列表刷新失败，请刷新列表。', '案件は保存済みですが、一覧を更新できませんでした。再読込してください。'))
      }
    } catch (cause) {
      const aiProblem = aiServiceProblem(cause)
      setError(
        aiProblem
          ? `${localizedAiServiceProblem(zh ? 'zh-CN' : 'ja-JP', aiProblem)} ${t('输入已保留。', '入力は保持しています。')}`
          : String(cause).includes('CASE_AI_UNAVAILABLE')
            ? t('请先连接 AI，再新增案件。输入已保留。', 'AIに接続してから案件を追加してください。入力は保持しています。')
            : t(
                'AI 未能完成案件识别，本次没有保存，输入已保留，请重试。',
                'AIが案件の識別を完了できませんでした。保存せず入力を保持しています。再試行してください。'
              )
      )
    } finally {
      busy.current = false
      setRunning(false)
    }
  }

  return (
    <form className="business-intake business-paste-box" onSubmit={(event) => void save(event)} aria-label={t('新增案件', '案件を追加')}>
      <label htmlFor={id}>{t('案件内容', '案件内容')}</label>
      <textarea
        id={id}
        rows={16}
        value={text}
        disabled={running}
        onChange={(event) => setText(event.target.value)}
        placeholder={t('把案件内容粘贴到这里，可一次粘贴多个案件。', '案件情報を貼り付けてください。複数の案件をまとめて追加できます。')}
      />
      <div className="business-inline-actions">
        <button className="is-primary" type="submit" disabled={running || !text.trim()}>
          {running ? t('AI 正在识别并保存…', 'AIが識別・保存中…') : t('新增案件', '案件を追加')}
        </button>
      </div>
      {notice ? (
        <p role="status">
          {notice}
          {skippedPersonnel
            ? t(
                `另有 ${skippedPersonnel} 段是人员介绍（要员营业），不是案件，未导入；请在人员页导入。`,
                `ほかに要員紹介（要員営業）が${skippedPersonnel}件あり、案件ではないため取り込んでいません。要員として取り込んでください。`
              )
            : ''}
        </p>
      ) : null}
      {skippedPersonnel && onOpenPersonImport ? (
        <div className="business-inline-actions">
          <button type="button" onClick={onOpenPersonImport}>
            {t('去人员页导入', '要員として取り込む')}
          </button>
        </div>
      ) : null}
      {created.length ? (
        <ul className="case-import-created" aria-label={t('新增的案件', '追加した案件')}>
          {created.slice(0, shownCreated).map((reviewId, index) => {
            const title = caseTitle(reviewId, index)
            return (
              <li key={reviewId}>
                <span>{title}</span>
                {onFindPeople || onOpenCase ? (
                  <span className="business-inline-actions">
                    {onFindPeople ? (
                      <button
                        className="is-primary"
                        type="button"
                        aria-label={`${t('找人', '要員を探す')}：${title}`}
                        onClick={() => onFindPeople(reviewId)}
                      >
                        {t('找人', '要員を探す')}
                      </button>
                    ) : null}
                    {onOpenCase ? (
                      <button type="button" aria-label={`${t('查看', '表示')}：${title}`} onClick={() => onOpenCase(reviewId)}>
                        {t('查看', '表示')}
                      </button>
                    ) : null}
                  </span>
                ) : null}
              </li>
            )
          })}
        </ul>
      ) : null}
      {created.length > shownCreated && onShowInList ? (
        <div className="business-inline-actions">
          <button type="button" onClick={onShowInList}>
            {t(`在列表中查看全部（${created.length}）`, `一覧ですべて見る（${created.length}）`)}
          </button>
        </div>
      ) : null}
      {error ? <p role="alert">{error}</p> : null}
    </form>
  )
}
