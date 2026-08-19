import { describe, expect, it } from 'vitest'
import { extractInterviewQuestions } from './interview-question-parser'

describe('extractInterviewQuestions', () => {
  it('extracts numbered questions even when the model joins every item onto one line', () => {
    const response = '以下是根据候选人档案、项目经历和面试目标生成的8个面试问题，每行一个：\n\n1.你在商取引应用后台系统中参与了微服务化改造，请具体说明拆分原则和通信方式？2.在财务报表系统中你负责技术方针制定，请说明选择PostgreSQL与Spring Boot的标准？3.你具备19年开发经验，请描述如何与日本客户确认需求？4.在勤怠管理系统中你负责测试，请说明缺陷管理流程？5.在SWIFT结算系统中你涉及监管对应，请说明如何确保消息转换准确性？6.你在多个项目中担任TL角色，请举例如何协调技术分歧？7.请结合实际案例说明如何优化复杂查询性能？8.你的简历中React标记为△，请说明你如何决定是否采用React？'

    const questions = extractInterviewQuestions(response)

    expect(questions).toHaveLength(8)
    expect(questions[0]).toMatch(/^你在商取引应用后台系统/u)
    expect(questions[7]).toMatch(/是否采用React？$/u)
  })

  it('keeps supporting ordinary multiline and bullet responses', () => {
    expect(extractInterviewQuestions('1. 请说明你负责的架构设计？\n2. 故障发生时你如何定位？')).toEqual([
      '请说明你负责的架构设计？',
      '故障发生时你如何定位？'
    ])
    expect(extractInterviewQuestions('- AWS移行で担当した範囲を説明してください。\n- 障害時にどのように原因を確認しましたか？')).toEqual([
      'AWS移行で担当した範囲を説明してください。',
      '障害時にどのように原因を確認しましたか？'
    ])
    expect(extractInterviewQuestions('问题如下：１．请说明架构设计？２．发生故障时如何定位？')).toEqual([
      '请说明架构设计？',
      '发生故障时如何定位？'
    ])
  })
})
