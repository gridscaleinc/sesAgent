import { experienceMethodDraftSchema, type ExperienceEvent, type ExperienceProcedure } from '@shared'

/** Learned prose is task data. The fixed service contract remains the authority. */
export function validateExperienceProcedure(raw:unknown, training:ExperienceEvent[]):ExperienceProcedure {
  const draft=experienceMethodDraftSchema.parse(raw)
  const ids=new Set(draft.sources.map(s=>s.eventId))
  if(ids.size!==3 || draft.sources.some(s=>!training.some(e=>!e.superseded&&e.id===s.eventId&&e.text.includes(s.quote))))throw new Error('LEARNING_METHOD_SOURCE_INVALID')
  const text=[draft.procedure.title,...draft.procedure.steps,...draft.procedure.avoid].join('\n')
  // General procedures must not retain contact details, names masked by DLP, code,
  // numerical thresholds or instructions to weaken the application contract.
  if(/https?:|[\w.+-]+@[\w.-]+|<[^>]+>|```|\b(?:eval|exec|system prompt|ignore previous|override|bypass|disqualify)\b|忽略.{0,8}(?:规则|指令)|绕过|上書き|年齢|年龄|性別|性别|国籍|民族|宗教|\d/iu.test(text))throw new Error('LEARNING_METHOD_UNSAFE')
  return draft.procedure
}
