import { useEffect, useState } from 'react'
import type { CandidateInterviewSnapshot, InterviewAnswers } from '@shared'
import { useUiLocale, localeText } from '../i18n'

/** Read the exact saved round; an answer record is never a skill-verification result. */
export function InterviewRoundEvidence({ interview }: { interview: CandidateInterviewSnapshot }) {
  const zh = useUiLocale() === 'zh-CN'
  const t = localeText(zh)
  const sourceKey = JSON.stringify([
    interview.id,
    interview.updatedAt,
    interview.decision,
    interview.interviewNotes,
    interview.questionPlan
  ])
  const [result, setResult] = useState<{ key: string; data: InterviewAnswers | null; error: boolean } | null>(null)
  useEffect(() => {
    let live = true,
      running = false
    const refresh = async () => {
      if (running) return
      running = true
      try {
        const data = (await window.sesAgent?.getInterviewAnswers?.(interview.id)) ?? null
        if (live) setResult({ key: sourceKey, data, error: false })
      } catch {
        if (live) setResult({ key: sourceKey, data: null, error: true })
      } finally {
        running = false
      }
    }
    void refresh()
    const timer = setInterval(() => void refresh(), 20_000)
    return () => {
      live = false
      clearInterval(timer)
    }
  }, [sourceKey, interview.id])
  const current = result?.key === sourceKey ? result : null
  const data = current?.data?.interviewId === interview.id ? current.data : null
  const questions = interview.questionPlan.filter((q) => q.selected)
  const answers =
    data?.answers.filter(
      (a) =>
        questions.some((q) => q.id === a.questionId) &&
        (a.status === 'unanswered' ? !a.quote : Boolean(a.quote) && Boolean(interview.interviewNotes?.includes(a.quote)))
    ) ?? []
  return (
    <section className="interview-evidence" aria-label={t('本轮回答依据', '今回の回答根拠')}>
      <h3>{t('本轮回答依据', '今回の回答根拠')}</h3>
      <p>
        {t(
          '从已保存记录自动整理。回答已有记录不代表技能已经核实；资料修改后会重新整理。',
          '保存済み記録から自動整理します。回答の記録はスキルの検証済みを意味しません。記録の変更後は再整理します。'
        )}
      </p>
      {current?.error ? (
        <p role="alert">{t('回答依据读取失败，请稍后重试。', '回答の根拠を読み込めませんでした。後でもう一度お試しください。')}</p>
      ) : !current ? (
        <p>{t('正在读取回答依据…', '回答の根拠を読み込み中…')}</p>
      ) : !answers.length ? (
        <p>
          {interview.interviewNotes?.trim()
            ? t('尚无可用的逐题回答，保存记录后将在空闲时整理。', '質問別の回答はまだありません。記録保存後、待機時に整理します。')
            : t('本轮尚未保存回答记录。', '今回の回答記録はまだ保存されていません。')}
        </p>
      ) : (
        answers.map((row) => (
          <article className="work-rule-card" key={row.questionId}>
            <strong>{questions.find((q) => q.id === row.questionId)?.text}</strong>
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
          </article>
        ))
      )}
    </section>
  )
}
