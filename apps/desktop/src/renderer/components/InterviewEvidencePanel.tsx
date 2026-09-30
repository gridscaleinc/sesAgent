import { useEffect, useState } from 'react'
import type { PairInterviewEvidence } from '@shared'
import { localizedIpcError, useUiLocale } from '../i18n'
export function InterviewEvidencePanel({
  documentId,
  reviewId,
  reloadToken,
  interviewId
}: {
  documentId: string
  reviewId: string
  reloadToken?: unknown
  interviewId?: string
}) {
  const locale = useUiLocale(),
    zh = locale === 'zh-CN',
    t = (cn: string, ja: string) => (zh ? cn : ja)
  const [open, setOpen] = useState(false)
  const [result, setResult] = useState<{
    documentId: string
    reviewId: string
    reloadToken: unknown
    rows: PairInterviewEvidence[]
    error: string
  } | null>(null)
  useEffect(() => {
    if (!open || !window.sesAgent.getPairInterviewEvidence) return
    let live = true,
      running = false
    const refresh = async () => {
      if (running) return
      running = true
      try {
        const rows = await window.sesAgent.getPairInterviewEvidence({ documentId, reviewId })
        if (live) setResult({ documentId, reviewId, reloadToken, rows, error: '' })
      } catch (e) {
        if (live)
          setResult({
            documentId,
            reviewId,
            reloadToken,
            rows: [],
            error: localizedIpcError(locale, e, t('无法读取面试依据。', '面談の根拠を読み込めませんでした。'))
          })
      } finally {
        running = false
      }
    }
    void refresh()
    const timer = setInterval(() => void refresh(), 20000)
    return () => {
      live = false
      clearInterval(timer)
    }
  }, [open, documentId, reviewId, reloadToken])
  const current = result?.documentId === documentId && result.reviewId === reviewId && result.reloadToken === reloadToken ? result : null
  const error = current?.error ?? ''
  const shown = (current?.rows ?? []).filter((r) => !interviewId || r.interviewId === interviewId)
  return (
    <details className="interview-evidence" onToggle={(e) => setOpen(e.currentTarget.open)}>
      <summary>{t('面试回答与待核实事项', '面談の回答と確認事項')}</summary>
      <p>
        {t(
          '从已保存记录自动整理。回答已有记录不代表技能已经核实；资料修改后会重新整理。',
          '保存済み記録から自動整理します。回答の記録はスキルの検証済みを意味しません。記録の変更後は再整理します。'
        )}
      </p>
      {error ? <p role="alert">{error}</p> : null}
      {!shown.length ? (
        <p>{t('尚无可用的逐题回答，保存记录后将在空闲时整理。', '質問別の回答はまだありません。記録保存後、待機時に整理します。')}</p>
      ) : (
        shown.map((row) => (
          <article className="work-rule-card" key={`${row.interviewId}:${row.questionId}`}>
            <strong>{row.questionText}</strong>
            <p>
              {row.status === 'answered'
                ? t('已有回答记录，待核实', '回答記録あり・検証待ち')
                : row.status === 'partial'
                  ? t('已有部分回答，需继续确认', '一部の回答あり・追加確認が必要')
                  : t('记录中未找到回答', '記録に回答が見つかりません')}
            </p>
            {row.quote ? <blockquote>{row.quote}</blockquote> : null}
            {row.summary ? <p>{row.summary}</p> : null}
            {row.remaining ? (
              <p>
                {t('待确认', '要確認')}：{row.remaining}
              </p>
            ) : null}
            <small>
              {t('对应要求', '対応する要件')}：{row.requirement}
            </small>
          </article>
        ))
      )}
    </details>
  )
}
