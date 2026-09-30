import { useEffect, useState, type ReactNode } from 'react'
import type { AppliedWorkRule, CandidateInterviewQuestion, CandidateReviewSnapshot, MatchRequirementEvidence } from '@shared'
import { useLocaleText } from '../i18n'
import { InterviewQuestionCard, interviewPreparationSheet, questionErrorMessage } from './BusinessInterviewQuestions'

/** The HR rules one evaluation used. */
export function AppliedRules({ rules }: { rules?: AppliedWorkRule[] }) {
  const { t } = useLocaleText()
  if (!rules?.length) return null
  return (
    <section className="match-applied-rules">
      <h4>
        {t('本次使用的规则', '今回適用したルール')} ({rules.length})
      </h4>
      <ul>
        {rules.map((rule, i) => (
          <li key={i}>
            v{rule.revision} · {rule.text}
          </li>
        ))}
      </ul>
    </section>
  )
}

/** The question draft saved for one person and case, read again whenever the pair is shown. */
export function useCaseQuestionDraft(documentId: string, jobCaseId: string | undefined) {
  const { zh, t } = useLocaleText()
  const [questions, setQuestions] = useState<CandidateInterviewQuestion[]>([])
  const [stale, setStale] = useState(false)
  const [error, setError] = useState('')
  useEffect(() => {
    let active = true
    setQuestions([])
    setStale(false)
    setError('')
    if (!jobCaseId) return
    Promise.resolve(window.sesAgent.getCaseQuestionDraft?.({ documentId, jobCaseId }))
      .then((view) => {
        if (!active || !view?.draft) return
        setQuestions(view.draft.questions)
        setStale(view.stale)
      })
      .catch((cause) => {
        if (active)
          setError(
            `${t('无法读取面试题草案', '質問案を読み込めません')}: ${questionErrorMessage(cause, zh, t('请稍后重试。', 'しばらくしてから再試行してください。'))}`
          )
      })
    return () => {
      active = false
    }
  }, [documentId, jobCaseId])
  return { questions, setQuestions, stale, setStale, error }
}

/** 面试问题: one summary line; the saved cards only when expanded. */
export function InterviewQuestionsSection({
  questions,
  stale,
  error,
  onCopied,
  children
}: {
  questions: CandidateInterviewQuestion[]
  stale: boolean
  error?: string
  onCopied?(message: string): void
  /** The generate / regenerate controls. */
  children?: ReactNode
}) {
  const { zh, t } = useLocaleText()
  return (
    <div className="match-questions">
      {error ? <p role="alert">{error}</p> : null}
      {questions.length ? (
        stale ? (
          <p role="status">
            {t(
              '资料或规则已更新，这份面试题草案已过期，请重新生成。',
              '情報またはルールが更新されたため、この質問案は古くなっています。再生成してください。'
            )}
          </p>
        ) : (
          <p>
            {t(
              `已准备 ${questions.length} 题，开始跟进后带入第一轮。`,
              `${questions.length} 問を準備済みです。対応を開始すると第1回面談に引き継がれます。`
            )}
          </p>
        )
      ) : (
        <p className="match-muted">{t('尚未生成面试问题。', '面談質問はまだ生成していません。')}</p>
      )}
      {children}
      {questions.length ? (
        <details className="match-questions-list">
          <summary>{t('展开', '展開')}</summary>
          <div className="interview-question-list">
            {questions.map((question, index) => (
              <InterviewQuestionCard key={question.id} question={question} index={index} zh={zh} editable={false} />
            ))}
          </div>
          <button
            type="button"
            onClick={() =>
              void navigator.clipboard
                .writeText(interviewPreparationSheet(questions, zh))
                .then(() => onCopied?.(t('问题已复制。', '質問をコピーしました。')))
                .catch(() => onCopied?.(t('无法复制问题。', '質問をコピーできませんでした。')))
            }
          >
            {t('复制问题', '質問をコピー')}
          </button>
          <p className="match-muted">
            {t('进入对应案件的面试跟进后，可以生成并保存本轮正式问题单。', 'この案件の面談対応画面で、今回の質問票を生成・保存できます。')}
          </p>
        </details>
      ) : null}
    </div>
  )
}

/** The person's projects that gave evidence for a met requirement. */
export function relatedProjects(person: CandidateReviewSnapshot | undefined, requirements: MatchRequirementEvidence[]) {
  return (
    person?.projectExperiences?.filter((project) =>
      requirements.some(
        (item) =>
          item.outcome === 'met' && (item.source === project.title || Boolean(item.evidence && project.summary.includes(item.evidence)))
      )
    ) ?? []
  )
}
export function RelatedProjects({ projects }: { projects: ReturnType<typeof relatedProjects> }) {
  const { t } = useLocaleText()
  if (!projects.length) return null
  return (
    <section className="match-projects">
      <h4>
        {t('相关项目经历', '関連する案件経験')} ({projects.length})
      </h4>
      {projects.slice(0, 3).map((project) => (
        <article key={project.draftId}>
          <strong>{project.title}</strong>
          <p>
            {project.period} · {project.role}
          </p>
          <p>{project.summary}</p>
        </article>
      ))}
    </section>
  )
}
