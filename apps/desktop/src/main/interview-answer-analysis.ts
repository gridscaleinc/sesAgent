import { interviewAnswerSchema, type CandidateInterviewQuestion, type InterviewAnswer } from '@shared'
import { z } from 'zod'
export const interviewAnswerResponseSchema = z.object({ answers: z.array(interviewAnswerSchema).max(40) }).strict()
export function validateInterviewAnswers(
  raw: unknown,
  source: { notes: string; questions: CandidateInterviewQuestion[] }
): InterviewAnswer[] {
  const { answers } = interviewAnswerResponseSchema.parse(raw)
  if (
    new Set(answers.map((a) => a.questionId)).size !== answers.length ||
    answers.some(
      (a) =>
        !source.questions.some((q) => q.id === a.questionId) ||
        (a.status === 'unanswered' && Boolean(a.quote)) ||
        (a.status !== 'unanswered' && (a.quote.length < 5 || !source.notes.includes(a.quote)))
    )
  )
    throw new Error('面试回答来源无法验证 / 面談回答の根拠を検証できません')
  return source.questions.map(
    (q) =>
      answers.find((a) => a.questionId === q.id) ?? {
        questionId: q.id,
        status: 'unanswered',
        quote: '',
        summary: '',
        remaining: q.requirement ?? q.text
      }
  )
}
