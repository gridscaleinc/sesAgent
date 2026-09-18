import {expect,it} from 'vitest'
import type {QuestionBankSource} from '@shared'
import {validateQuestionTemplate} from './question-bank'
const source={text:'请说明 Java 项目中本人负责的设计和交付物。',requirement:'Java 开发'} as QuestionBankSource
const draft={category:'responsibility',keyword:'Java',text:'请以相关项目为例，说明本人职责和具体交付物。',scoringGuide:'应区分本人承担的职责和团队共同工作。',sourceQuote:source.text}
it('accepts a generic question tied to its adopted source',()=>expect(validateQuestionTemplate(draft,source).keyword).toBe('Java'))
it('rejects invented sources, unrelated keywords, identity placeholders and new thresholds',()=>{
 for(const change of [{sourceQuote:'不存在的来源内容'},{keyword:'Python'},{text:'请介绍在 <PERSON_NAME_001> 团队中的职责。'},{text:'请证明具备 10 年以上设计经验。'}])expect(()=>validateQuestionTemplate({...draft,...change},source)).toThrow()
})
