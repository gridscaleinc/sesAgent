import { questionTemplateDraftSchema, experienceMatches, type QuestionBankSource, type QuestionTemplateDraft } from '@shared'
export function validateQuestionTemplate(raw:unknown,source:QuestionBankSource):QuestionTemplateDraft {
 const draft=questionTemplateDraftSchema.parse(raw)
 if(!source.text.includes(draft.sourceQuote)||!experienceMatches(draft.keyword,[{key:'requirement',label:'requirement',value:source.requirement}]))throw new Error('QUESTION_TEMPLATE_SOURCE_INVALID')
 const text=[draft.text,draft.scoringGuide].join('\n')
 if(/<[^>]+>|https?:|[\w.+-]+@[\w.-]+|```|忽略.{0,8}(?:规则|指令)|绕过|ignore previous|system prompt|\d|年龄|年齢|性别|性別|国籍|宗教/iu.test(text))throw new Error('QUESTION_TEMPLATE_UNSAFE')
 return draft
}
