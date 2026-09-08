import { useEffect, useId, useRef, useState } from 'react'
import { businessBatchCharacterLimit, businessIntakeSegmentLimit, splitBusinessBatch,
  type BusinessIntakeRecordResult, type CandidateReviewSnapshot, type JobCaseReviewSnapshot } from '@shared'
import { useUiLocale } from '../i18n'
import { Icon } from './Icon'

type Segment = { id: string; text: string; startLine: number; endLine: number; status: 'pending' | 'running' | 'done' | 'failed' | 'partial' | 'skipped';
  records: BusinessIntakeRecordResult[]; error: string | null; revision: number | null }
interface Props {
  inputSeed?: { id: number; text: string }

  modelKey: string; cases: JobCaseReviewSnapshot[]; candidates: CandidateReviewSnapshot[]
  onRefresh(): Promise<void>
  onCase(reviewId: string): void
  onPerson(documentId: string): void
  onCaseImport(): void
}

export function BusinessIntakeWorkspace({ inputSeed, modelKey, cases, candidates, onRefresh, onCase, onPerson, onCaseImport }: Props) {
  const inputId = useId()
  const zh = useUiLocale() === 'zh-CN'
  const t = (cn: string, ja: string) => zh ? cn : ja
  const [text, setText] = useState('')
  const [segments, setSegments] = useState<Segment[]>([])
  const [running, setRunning] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [filter, setFilter] = useState<'all' | 'attention'>('all')
  const appliedSeed = useRef<number | null>(null)
  const batchFinished = segments.every((item) => ['done', 'skipped'].includes(item.status))
  useEffect(() => {
    if (!inputSeed || appliedSeed.current === inputSeed.id || running) return
    if (segments.length && !batchFinished) { setError(t('当前批次尚未完成，新内容仍保留在 Agent 输入框。', '現在の一括処理が未完了です。新しい内容はAgent入力欄に残っています。')); return }
    appliedSeed.current = inputSeed.id
    setSegments([]); setText(inputSeed.text); setError(null)
  }, [inputSeed, segments.length, batchFinished, running])
  const pause = useRef(false)
  const busy = useRef(false)
  const patch = (id: string, changes: Partial<Segment>) => setSegments((current) => current.map((item) => item.id === id ? { ...item, ...changes } : item))
  const prepare = () => {
    setError(null)
    try {
      const next = splitBusinessBatch(text).map((item): Segment => ({ ...item, id: crypto.randomUUID(), status: 'pending', records: [], error: null, revision: null }))
      if (!next.length) return
      setSegments(next); setFilter('all'); setText('')
    } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)) }
  }
  const run = async (ids: string[]) => {
    if (busy.current) return
    busy.current = true; pause.current = false; setRunning(true); setError(null)
    try {
      for (const segment of segments.filter((item) => ids.includes(item.id))) {
        if (pause.current) break
        if (!segment.text.trim() || segment.text.length > businessIntakeSegmentLimit) {
          patch(segment.id, { status: 'failed', error: t('本段过长或为空，请编辑后重试；不会截断内容。', 'この区画は長すぎるか空です。内容を編集して再試行してください。') }); continue
        }
        patch(segment.id, { status: 'running', error: null })
        try {
          const result = await window.sesAgent.executeAgentTurn({ conversationId: segment.id, message: segment.text,
            expectedConversationRevision: segment.revision, requestId: crypto.randomUUID(), modelKey, intakeOnly: true })
          const records = result.intake?.records ?? []
          const succeeded = records.filter((item) => item.status === 'succeeded')
          const failed = records.filter((item) => item.status !== 'succeeded')
          const retrySegments: Segment[] = (failed.every((item) => item.startLine && item.endLine) ? failed : []).flatMap((item) => {
            if (!item.startLine || !item.endLine) return []
            const source = segment.text.split('\n').slice(item.startLine - 1, item.endLine).join('\n')
            return [{ id: crypto.randomUUID(), text: source, startLine: segment.startLine + item.startLine - 1,
              endLine: segment.startLine + item.endLine - 1, status: 'failed', records: [], revision: null,
              error: t('这条记录未成功，已单独保留，可修改重试。', '未完了のレコードを分離しました。編集して再試行できます。') }]
          })
          patch(segment.id, { revision: result.conversation.revision, records: succeeded.length && retrySegments.length ? succeeded : records,
            status: succeeded.length ? (failed.length && !retrySegments.length ? 'partial' : 'done') : 'failed',
            error: succeeded.length ? null : result.assistantMessage.content })
          if (succeeded.length && retrySegments.length) setSegments((current) => [...current, ...retrySegments])
        } catch (cause) {
          // A transport failure may follow a committed import. Refresh its conversation revision before retrying.
          const conversation = await window.sesAgent.listAiConversations({ assistant: 'sales-agent', candidateDocumentId: null, interviewId: null, interviewKind: null, roundNumber: null }).then((items) => items.find((item) => item.id === segment.id)).catch(() => null)
          patch(segment.id, { status: 'failed', revision: conversation?.revision ?? segment.revision,
            error: cause instanceof Error ? cause.message : String(cause) })
        }
      }
    } finally {
      try { await onRefresh() } catch { setError(t('记录处理完成，但列表刷新失败，请点击刷新。', '処理後の一覧更新に失敗しました。再読込してください。')) }
      setRunning(false); busy.current = false
    }
  }
  const records = segments.flatMap((item) => item.records).filter((item) => item.status === 'succeeded')
  const added = records.filter((item) => item.outcome === 'created')
  const todo = segments.filter((item) => ['pending', 'failed', 'partial'].includes(item.status))
  return <section className="business-intake">
    <div className="business-intake-heading"><div><h2>{t('把消息整理成可使用的案件和人员', 'メッセージから案件・要員情報を整理')}</h2>
      <p>{t('粘贴邮件正文或微信聊天记录，先检查分段，再开始整理。', 'メール本文や微信の会話を貼り付け、区切りを確認して取り込みます。')}</p></div>
      <button onClick={onCaseImport} type="button"><Icon name="mail" size={16} />{t('邮件 / EML 导入', 'メール・EML取込')}</button></div>
    <div className="business-metrics" aria-live="polite">
      <span><strong>{added.filter((item) => item.kind === 'job-case').length}</strong>{t('新增案件', '新規案件')}</span>
      <span><strong>{added.filter((item) => item.kind === 'candidate').length}</strong>{t('新增人员', '新規要員')}</span>
      <span><strong>{records.filter((item) => item.outcome !== 'created').length}</strong>{t('已存在 / 已归档', '登録済み・保管済み')}</span>
      <span><strong>{segments.filter((item) => ['failed', 'partial'].includes(item.status)).length}</strong>{t('需要处理', '要確認')}</span>
    </div>
    {segments.length === 0 ? <div className="business-paste-box">
      <label htmlFor={inputId}>{t('邮件或聊天记录', 'メール・会話テキスト')}</label>
      <textarea id={inputId} rows={12} value={text} onChange={(event) => setText(event.target.value)}
        placeholder={t('可粘贴多条案件、人员信息。用案件名、姓名或单独一行 ---- 分隔记录。', '複数の案件・要員を貼り付けられます。案件名・氏名、または独立した ---- 行で区切ってください。')} />
      <div className="business-inline-actions"><small>{text.length.toLocaleString()} / 100,000</small><button className="is-primary" disabled={!text.trim()} onClick={prepare} type="button">{t('预览分段', '区切りを確認')}</button></div>
    </div> : <>
      <div className="business-inline-actions">
        <span>{t('本批', '今回')} {segments.length} {t('段', '件')} · {segments.filter((item) => item.status === 'done').length} {t('已完成', '完了')}</span>
        <button aria-pressed={filter === 'attention'} onClick={() => setFilter(filter === 'all' ? 'attention' : 'all')} type="button">{t('只看需要处理', '要確認のみ')}</button>
        {running ? <button onClick={() => { pause.current = true }} type="button">{t('本段结束后暂停', '現在の処理後に一時停止')}</button> : <button className="is-primary" disabled={!todo.length} onClick={() => void run(todo.map((item) => item.id))} type="button">{t('整理未完成的内容', '未完了の情報を整理')}</button>}
        {segments.every((item) => item.status === 'pending') && !running ? <button onClick={() => { setText(segments.map((item) => item.text).join('\n----\n')); setSegments([]) }} type="button">{t('返回编辑', '入力に戻る')}</button> : null}
        <button disabled={running || todo.length > 0} onClick={() => { setSegments([]); setText('') }} type="button">{t('整理下一批', '次の一括取込')}</button>
      </div>
      <p className="business-help">{t('只处理未完成的内容。原始输入暂留本页，已导入资料保存在本机；关闭应用前请处理或另存未完成内容。', '未完了分だけを処理します。入力原文はこの画面に一時保持されます。終了前に未完了分を処理または保存してください。')}</p>
      <div className="business-segments">{segments.filter((item) => filter === 'all' || ['failed', 'partial'].includes(item.status)).map((segment, index) => <article key={segment.id} className={`business-segment is-${segment.status}`}>
        <header><strong>{t('分段', '区画')} {index + 1}</strong><span>{t('原文行', '元の行')} {segment.startLine}–{segment.endLine}</span>
          <span>{({ pending: t('待整理', '取込待ち'), running: t('整理中', '処理中'), done: t('已整理', '整理済み'), failed: t('需要处理', '要確認'), partial: t('部分完成', '一部完了'), skipped: t('已跳过', 'スキップ済み') })[segment.status]}</span></header>
        {segment.status !== 'done' ? <textarea aria-label={`${t('分段内容', '区画の内容')} ${index + 1}`} value={segment.text} disabled={running}
          onChange={(event) => patch(segment.id, { text: event.target.value })} rows={5} /> : <details><summary>{t('查看本次原文', '今回の原文を表示')}</summary><pre>{segment.text}</pre></details>}
        {segment.error ? <p role="alert">{segment.error}</p> : null}
        {segment.records.map((record, i) => {
          const job = cases.find((item) => item.reviewId === record.reviewId)
          const person = candidates.find((item) => item.documentId === record.sourceDocumentId)
          return <div className="business-record" key={`${record.reviewId ?? record.sourceDocumentId ?? i}`}><span>{record.kind === 'job-case' ? t('案件', '案件') : t('人员', '要員')}</span>
            <strong>{job?.fields.find((field) => field.key === 'title')?.value ?? person?.localIdentity?.displayName ?? person?.fileName ?? `${t('记录', 'レコード')} ${i + 1}`}</strong>
            <small>{record.outcome === 'created' ? t('新增', '新規') : t('已存在', '登録済み')}</small>
            {record.reviewId ? <button onClick={() => onCase(record.reviewId!)} type="button">{t('查看 / 配信', '確認・配信')}</button> : record.sourceDocumentId ? <button onClick={() => onPerson(record.sourceDocumentId!)} type="button">{t('确认 / 推广', '確認・紹介')}</button> : null}</div>
        })}
        {['failed', 'partial'].includes(segment.status) ? <div className="business-inline-actions"><button disabled={running} onClick={() => void run([segment.id])} type="button">{t('仅重试本段', 'この区画を再試行')}</button><button disabled={running} onClick={() => patch(segment.id, { status: 'skipped', error: null })} type="button">{t('跳过本段', 'この区画をスキップ')}</button></div> : null}
      </article>)}</div>
    </>}
    {error ? <p role="alert">{error}<button onClick={() => void onRefresh()} type="button">{t('刷新', '再読込')}</button></p> : null}
  </section>
}
