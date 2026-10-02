import { expect, it, vi } from 'vitest'
import { AgentCloudNarrativeService } from './agent-cloud-narrative'
import { interviewDimensionAsks, interviewQuestionDimensions, interviewQuestionPolicy } from '@shared'

const input = {
  profile: {
    fields: [{ key: 'skills', value: 'Java AWS' }],
    projectExperiences: [
      { title: 'API development', period: '2024', role: 'Developer', technologies: ['Java'], summary: 'Designed REST APIs' }
    ]
  },
  requirements: ['Java'],
  rules: [],
  previousQuestions: ['Describe your last project'],
  notes: '',
  locale: 'zh-CN',
  model: {},
  signal: new AbortController().signal
} as any
const question = {
  dimension: 'core-capability',
  ask: 'end-to-end',
  text: '你独立设计的接口如何处理失败重试？',
  requirementIds: ['R1'],
  evidenceIds: ['E6'],
  scoringGuide: '具体接口、本人职责和失败场景'
}
type Sourced = { dimension: string; requirementIds?: string[]; evidenceIds?: string[] }
/** STEP 1 as the model would return it for these questions: one entry per dimension holding every id the questions use. */
function classify(questions: unknown[]) {
  const byDimension = new Map<string, { dimension: string; focus: string; requirementIds: string[]; evidenceIds: string[] }>()
  for (const q of (questions as Sourced[]).filter((item) => item.dimension !== 'open-topic')) {
    const entry = byDimension.get(q.dimension) ?? { dimension: q.dimension, focus: 'focus', requirementIds: [], evidenceIds: [] }
    entry.requirementIds = [...new Set([...entry.requirementIds, ...(q.requirementIds ?? [])])]
    entry.evidenceIds = [...new Set([...entry.evidenceIds, ...(q.evidenceIds ?? [])])]
    byDimension.set(q.dimension, entry)
  }
  return [...byDimension.values()]
}
function service(questions: unknown[], capabilities: unknown[] = classify(questions), mode?: 'replace' | 'append') {
  const value = Object.create(AgentCloudNarrativeService.prototype)
  value.invokeCloud = vi.fn(async () => ({
    result: { content: JSON.stringify({ ...(mode ? { mode } : {}), capabilities, questions }) },
    mappings: []
  }))
  return value as AgentCloudNarrativeService
}
/** n distinct questions, all in one dimension, each about its own example. */
const manyQuestions = (n: number) =>
  Array.from({ length: n }, (_, index) => ({ ...question, text: `请说明第 ${index + 1} 个接口项目里你本人负责的设计与失败处理。` }))
it('retains case requirement and actual project evidence in targeted questions', async () => {
  const result = await service([question]).generateRuleQuestions(input)
  expect(result[0]).toMatchObject({
    source: 'match',
    selected: true,
    requirement: 'Java',
    evidence: 'Designed REST APIs',
    scoringGuide: question.scoringGuide
  })
})
it('rejects invented case requirements or candidate evidence', async () => {
  await expect(service([{ ...question, requirementIds: ['R999'] }]).generateRuleQuestions(input)).rejects.toThrow(/资料来源/)
  await expect(service([{ ...question, evidenceIds: ['E999'] }]).generateRuleQuestions(input)).rejects.toThrow(/资料来源/)
})
it('allows a question to clarify genuinely missing evidence without fabricating a quotation', async () => {
  const result = await service([{ ...question, evidenceIds: [] }]).generateRuleQuestions(input)
  expect(result[0]?.evidence).toBe('')
})

it('combines multiple requirements and project facts by reference without requiring model-authored quotations', async () => {
  const cloud = service([
    {
      ...question,
      requirementIds: ['R1', 'R2'],
      evidenceIds: ['E5', 'E6'],
      text: '请结合 Java 接口项目，说明你的方案选择、实现职责及成果。'
    }
  ])
  const result = await cloud.generateRuleQuestions({ ...input, requirements: ['Java', 'REST API設計'] })
  expect(result[0]).toMatchObject({ requirement: 'Java / REST API設計', evidence: 'Java / Designed REST APIs' })
  const request = (cloud as any).invokeCloud.mock.calls[0][0]
  const source = JSON.parse(request.projection)
  expect(source.requirements).toEqual([
    { id: 'R1', text: 'Java' },
    { id: 'R2', text: 'REST API設計' }
  ])
  expect(source.projects[0].summary).toEqual({ id: 'E6', text: 'Designed REST APIs' })
  expect(request.instructions).toContain('Do NOT return requirement/evidence prose')
})

it('rejects wrong-source references and duplicate IDs, even if the numeric suffix exists', async () => {
  // E6 exists but R6 does not: requirement and resume references cannot be exchanged.
  await expect(service([{ ...question, requirementIds: ['R6'] }]).generateRuleQuestions(input)).rejects.toThrow('资料来源')
  await expect(service([{ ...question, evidenceIds: ['E6', 'E6'] }]).generateRuleQuestions(input)).rejects.toThrow('资料来源')
  await expect(service([{ ...question, requirementIds: ['R1', 'R1'] }]).generateRuleQuestions(input)).rejects.toThrow('资料来源')
})

it('rejects model-authored evidence claims instead of accepting a plausible paraphrase as a source', async () => {
  await expect(service([{ ...question, evidence: 'Managed 20 engineers' }]).generateRuleQuestions(input)).rejects.toThrow()
})

it('accepts five distinct capability dimensions and labels their evaluation purpose', async () => {
  const questions = interviewQuestionDimensions.filter((dimension) => dimension !== 'open-topic').map((dimension, i) => ({
    ...question,
    dimension,
    ask: interviewDimensionAsks[dimension][0],
    text: [
      '请说明项目中的职责和成果。',
      '请结合接口交付说明 Java 和 SQL 的核心能力。',
      '请说明调查实际故障时的判断和验证过程。',
      '哪些任务能独立完成，如何向客户确认不明确的事项？',
      '进入本案件后，可以立即承担哪些任务？'
    ][i]
  }))
  const cloud = service(questions)
  const result = await cloud.generateRuleQuestions({ ...input, caseSupplied: true })
  expect(result).toHaveLength(5)
  expect(result[1]!.sourceLabel).toContain('端到端交付能力')
  const request = (cloud as any).invokeCloud.mock.calls[0][0]
  expect(request.instructions).toContain(interviewQuestionPolicy)
  expect(request.instructions).not.toContain('Generate 8-12')
  expect(JSON.parse(request.projection).caseSupplied).toBe(true)
})

it('allows several questions per dimension and more than five, but rejects repeated wording and an oversized set', async () => {
  const several = await service(manyQuestions(8)).generateRuleQuestions(input)
  expect(several).toHaveLength(8)
  expect(new Set(several.map((q) => q.text)).size).toBe(8)
  await expect(
    service([
      question,
      { ...question, dimension: 'authenticity', ask: 'role-scope', text: question.text.replace('？', '?') }
    ]).generateRuleQuestions(input)
  ).rejects.toThrow('重复')
  await expect(service(manyQuestions(31)).generateRuleQuestions(input)).rejects.toThrow()
})

it('asks the model for no more output than the request schema allows', async () => {
  const cloud = service(manyQuestions(5))
  await cloud.generateRuleQuestions(input)
  const request = (cloud as any).invokeCloud.mock.calls[0][0]
  expect(request.maxOutputTokens).toBeGreaterThan(5000)
  expect(request.maxOutputTokens).toBeLessThanOrEqual(8192)
})

it('asks for at least five questions once, and keeps a short second set instead of failing', async () => {
  const short = service(manyQuestions(3))
  const result = await short.generateRuleQuestions(input)
  expect(result).toHaveLength(3)
  const calls = (short as any).invokeCloud.mock.calls
  expect(calls).toHaveLength(2)
  expect(calls[1][0].instructions).toContain('a complete set needs at least 5')
  const enough = service(manyQuestions(5))
  await enough.generateRuleQuestions(input)
  expect((enough as any).invokeCloud).toHaveBeenCalledTimes(1)
})

it('tells the model what to do when the interviewer asks for more questions, and reports the mode it chose', async () => {
  const modes: string[] = []
  const cloud = service(manyQuestions(3), undefined, 'append')
  const added = await cloud.generateRuleQuestions({ ...input, request: '再增加3个问题', onMode: (mode: string) => modes.push(mode) })
  expect(added).toHaveLength(3)
  expect(modes).toEqual(['append'])
  // An append is not held to the five-question floor, so it is asked once.
  expect((cloud as any).invokeCloud).toHaveBeenCalledTimes(1)
  const request = (cloud as any).invokeCloud.mock.calls[0][0]
  expect(request.instructions).toContain('return ONLY the new questions')
  expect(JSON.parse(request.projection).operatorRequest).toBe('再增加3个问题')
  const replaceModes: string[] = []
  await service(manyQuestions(5)).generateRuleQuestions({ ...input, onMode: (mode: string) => replaceModes.push(mode) })
  expect(replaceModes).toEqual(['replace'])
})

it('does not demand a case-readiness question from an append', async () => {
  const cloud = service(manyQuestions(2), undefined, 'append')
  await expect(cloud.generateRuleQuestions({ ...input, caseSupplied: true, request: 'もう2問追加して' })).resolves.toHaveLength(2)
})

const openQuestion = (text: string) => ({
  dimension: 'open-topic',
  ask: 'open-topic',
  text,
  requirementIds: [] as string[],
  evidenceIds: [] as string[],
  scoringGuide: '回答の具体性と一貫性を見る'
})

it('writes the open topics the interviewer asked for - Japanese, plans after joining - without case or resume sources', async () => {
  const modes: string[] = []
  const cloud = service([openQuestion('日本語での業務コミュニケーションで、これまで苦労した場面はありますか？'), openQuestion('今後のキャリアについて、どのように考えていますか？')], [], 'append')
  const result = await cloud.generateRuleQuestions({
    ...input,
    caseSupplied: true,
    request: '再增加三道面试题，关于日语的，还有日后打算的',
    onMode: (mode: string) => modes.push(mode)
  })
  expect(result).toHaveLength(2)
  expect(result[0]).toMatchObject({ dimension: 'open-topic', requirement: '', evidence: '', requirementItems: [], evidenceItems: [] })
  expect(result[0]!.sourceLabel).toBe('开放话题（面试官追加）')
  expect(modes).toEqual(['append'])
  expect((cloud as any).invokeCloud).toHaveBeenCalledTimes(1)
})

it('holds open-topic questions to their rules: only on request, no sources, and no sales conditions', async () => {
  const q = openQuestion('今後のキャリアについて、どのように考えていますか？')
  // The interviewer asked for nothing, so the model may not add one.
  await expect(service([question, q], undefined, 'replace').generateRuleQuestions(input)).rejects.toThrow('开放话题')
  // It cites nothing.
  await expect(
    service([{ ...q, requirementIds: ['R1'] }], [], 'append').generateRuleQuestions({ ...input, request: '加一道关于日后打算的' })
  ).rejects.toThrow('不应引用')
  // Sales conditions never become questions, open or not.
  await expect(
    service([openQuestion('希望単価と稼働開始日はいつですか？')], [], 'append').generateRuleQuestions({ ...input, request: '加一道关于单价的' })
  ).rejects.toThrow('营业条件')
})

it('still demands a case requirement of every question that is not open-topic', async () => {
  const classified = [{ dimension: 'core-capability', focus: 'x', requirementIds: ['R1'], evidenceIds: ['E6'] }]
  await expect(service([{ ...question, requirementIds: [] }], classified).generateRuleQuestions(input)).rejects.toThrow('案件要求')
})

it('filters sales conditions and garbage before generation, and rejects them in generated questions', async () => {
  const cloud = service([question])
  await cloud.generateRuleQuestions({ ...input, requirements: ['Java', '週3日出社', '単価80万円', '2026-10-01', '要確認', '\uFFFD\uFFFD'] })
  expect(JSON.parse((cloud as any).invokeCloud.mock.calls[0][0].projection).requirements).toEqual([{ id: 'R1', text: 'Java' }])
  await expect(service([{ ...question, text: '可以每週3日出社吗？' }]).generateRuleQuestions(input)).rejects.toThrow('营业条件')
  const empty = service([question])
  await expect(empty.generateRuleQuestions({ ...input, requirements: ['単価80万円', '要確認'] })).rejects.toThrow('能力要求')
  expect((empty as any).invokeCloud).not.toHaveBeenCalled()
})

it('does not invent case readiness in a resume-only interview', async () => {
  await expect(service([{ ...question, dimension: 'case-readiness', ask: 'onboarding' }]).generateRuleQuestions(input)).rejects.toThrow(
    '未指定案件'
  )
})

it.each([
  ['PMO', '課題管理・顧客調整', '課題一覧を整理し顧客との合意形成を担当'],
  ['運用', 'AWS監視・運用', 'アラート調査と復旧確認を担当'],
  ['テスト', '結合テスト', 'テスト設計と不具合の再現確認を担当']
])('retains role-specific evidence for %s without requiring Java or repair', async (role, requirement, evidence) => {
  const result = await service([
    {
      ...question,
      dimension: 'authenticity',
      ask: 'role-scope',
      text: '请结合该项目说明你的具体贡献、判断和成果。',
      requirementIds: ['R1'],
      evidenceIds: ['E4']
    },
    {
      ...question,
      dimension: 'case-readiness',
      ask: 'onboarding',
      text: '进入本案件后最先可以独立承担哪些任务？',
      requirementIds: ['R1'],
      evidenceIds: ['E4']
    }
  ]).generateRuleQuestions({
    ...input,
    caseSupplied: true,
    requirements: [requirement],
    profile: { fields: [{ key: 'role', value: role }], projectExperiences: [{ title: '業務', role, technologies: [], summary: evidence }] }
  })
  expect(result[0]).toMatchObject({ requirement, evidence })
})

it('asks for the capability classification first and only accepts questions drawn from it', async () => {
  const cloud = service([question])
  await cloud.generateRuleQuestions(input)
  const request = (cloud as any).invokeCloud.mock.calls[0][0]
  expect(request.instructions).toContain('"capabilities"')
  expect(request.instructions).toContain('STEP 1')
  // The question's dimension was never classified.
  await expect(
    service([question], [{ dimension: 'authenticity', focus: 'x', requirementIds: ['R1'], evidenceIds: ['E6'] }]).generateRuleQuestions(
      input
    )
  ).rejects.toThrow('能力归类')
  // The question cites evidence its dimension did not collect.
  await expect(
    service([question], [{ dimension: question.dimension, focus: 'x', requirementIds: ['R1'], evidenceIds: [] }]).generateRuleQuestions(
      input
    )
  ).rejects.toThrow('能力归类')
  await expect(
    service(
      [question],
      [
        { dimension: question.dimension, focus: 'x', requirementIds: ['R1'], evidenceIds: ['E6'] },
        { dimension: question.dimension, focus: 'y', requirementIds: ['R1'], evidenceIds: ['E6'] }
      ]
    ).generateRuleQuestions(input)
  ).rejects.toThrow('重复维度')
})

it('rejects a question that leaves choosing the example to the candidate', async () => {
  await expect(
    service([{ ...question, text: '具体的な一機能を選び、担当範囲と成果を説明してください。' }]).generateRuleQuestions(input)
  ).rejects.toThrow('选择例子')
  await expect(
    service([{ ...question, text: '请选择一个你负责的功能，说明设计判断和成果。' }]).generateRuleQuestions(input)
  ).rejects.toThrow('选择例子')
})

it('allows only the single conditional question to have no resume evidence', async () => {
  await expect(
    service([
      { ...question, evidenceIds: [] },
      { ...question, dimension: 'authenticity', ask: 'role-scope', evidenceIds: [], text: '请说明项目中的职责和成果。' }
    ]).generateRuleQuestions(input)
  ).rejects.toThrow('简历依据')
})

it('reports an invalid response shape as a business error instead of a raw schema dump', async () => {
  await expect(service([{ ...question, text: 'あ'.repeat(301) }]).generateRuleQuestions(input)).rejects.toThrow('格式无效')
})

it('retries once with the concrete rejection reason and never retries a transport failure', async () => {
  const cloud = service([question])
  ;(cloud as any).invokeCloud.mockResolvedValueOnce({
    result: {
      content: JSON.stringify({
        capabilities: classify([question]),
        questions: [{ ...question, text: '想定外の問題を一つ選び、対応を説明してください。' }]
      })
    },
    mappings: []
  })
  const result = await cloud.generateRuleQuestions(input)
  expect(result[0]?.text).toBe(question.text)
  expect((cloud as any).invokeCloud).toHaveBeenCalledTimes(2)
  const retry = (cloud as any).invokeCloud.mock.calls[1][0]
  expect(retry.instructions).toContain('previous attempt was rejected')
  expect(retry.instructions).toContain('choose the example')
  expect(retry.requestId).not.toBe((cloud as any).invokeCloud.mock.calls[0][0].requestId)
  const twice = service([{ ...question, text: '请选择一个你负责的功能，说明设计判断和成果。' }])
  await expect(twice.generateRuleQuestions(input)).rejects.toThrow('选择例子')
  expect((twice as any).invokeCloud).toHaveBeenCalledTimes(2)
  const failing = service([question])
  ;(failing as any).invokeCloud.mockRejectedValue(new Error('network down'))
  await expect(failing.generateRuleQuestions(input)).rejects.toThrow('network down')
  expect((failing as any).invokeCloud).toHaveBeenCalledTimes(1)
})

it('binds each question to an ask shape its dimension owns, so two dimensions cannot share a question form', async () => {
  const cloud = service([question])
  await cloud.generateRuleQuestions(input)
  expect((cloud as any).invokeCloud.mock.calls[0][0].instructions).toContain('"ask"')
  expect((cloud as any).invokeCloud.mock.calls[0][0].instructions).toContain('MOTHER QUESTIONS')
  // role-scope belongs to authenticity, not to the core-capability question.
  await expect(service([{ ...question, ask: 'role-scope' }]).generateRuleQuestions(input)).rejects.toThrow('问法')
  await expect(service([{ ...question, ask: 'walkthrough' }]).generateRuleQuestions(input)).rejects.toThrow('格式无效')
  const retry = service([question])
  ;(retry as any).invokeCloud.mockResolvedValueOnce({
    result: { content: JSON.stringify({ capabilities: classify([question]), questions: [{ ...question, ask: 'incident-chain' }] }) },
    mappings: []
  })
  await retry.generateRuleQuestions(input)
  expect((retry as any).invokeCloud.mock.calls[1][0].instructions).toContain('not a shape owned by core-capability')
})

const readiness = {
  ...question,
  dimension: 'case-readiness',
  ask: 'onboarding',
  text: '假设明天进入本案件负责 API 追加功能，前三天按什么顺序确认代码、设计书和测试资料？',
  evidenceIds: ['E2']
}
it('requires one case-readiness question whenever a case is supplied', async () => {
  await expect(service([question]).generateRuleQuestions({ ...input, caseSupplied: true })).rejects.toThrow('案件适配')
  const result = await service([question, readiness]).generateRuleQuestions({ ...input, caseSupplied: true })
  expect(result.map((q) => q.sourceLabel?.split(' · ')[0])).toEqual(['端到端交付能力', '项目适应与快速上手能力'])
})

it('lets the candidate choose a feature only inside a project the question names from its cited title', async () => {
  const named = '「API development」の中で実際に開発した機能を一つ選び、要件から結合テストまでの流れを説明してください。'
  const result = await service([{ ...question, text: named, evidenceIds: ['E2', 'E6'] }]).generateRuleQuestions(input)
  expect(result[0]?.evidence).toBe('API development / Designed REST APIs')
  // Citing the project's summary instead of its title still anchors the question to that project.
  expect((await service([{ ...question, text: named, evidenceIds: ['E6'] }]).generateRuleQuestions(input))[0]?.evidence).toBe(
    'Designed REST APIs'
  )
  // Naming a project none of the cited sources belong to is not provenance, so choosing is still delegated.
  await expect(service([{ ...question, text: named, evidenceIds: ['E1'] }]).generateRuleQuestions(input)).rejects.toThrow('选择例子')
})

it('rejects a question about general practice instead of a real case', async () => {
  await expect(service([{ ...question, text: '一般您如何处理线上障害？' }]).generateRuleQuestions(input)).rejects.toThrow('一般做法')
  await expect(
    service([{ ...question, text: '障害が発生した場合、普段はどのように調査しますか。' }]).generateRuleQuestions(input)
  ).rejects.toThrow('一般做法')
})

it('carries one optional follow-up probe with the question', async () => {
  const probe = '设计书和现行代码不一致时，你会怎么处理？'
  const result = await service([{ ...question, followUp: probe }]).generateRuleQuestions(input)
  expect(result[0]).toMatchObject({ followUp: probe })
  expect('followUp' in (await service([question]).generateRuleQuestions(input))[0]!).toBe(false)
})

it('drops a question that still violates a style rule after the retry instead of failing the whole set', async () => {
  const good = {
    ...question,
    dimension: 'authenticity',
    ask: 'role-scope',
    text: '「API development」で本人が担当した範囲を説明してください。',
    evidenceIds: ['E6']
  }
  const bad = { ...question, text: '请选择一个你负责的功能，说明设计判断和成果。' }
  const cloud = service([good, bad])
  const result = await cloud.generateRuleQuestions(input)
  expect((cloud as any).invokeCloud).toHaveBeenCalledTimes(2)
  expect(result.map((q) => q.text)).toEqual([good.text])
})

it('sends the operator request as redactable source data, never as an instruction', async () => {
  const cloud = service([question])
  await cloud.generateRuleQuestions({ ...input, request: '加上团队管理的问题' })
  const call = (cloud as any).invokeCloud.mock.calls[0][0]
  expect(JSON.parse(call.projection).operatorRequest).toBe('加上团队管理的问题')
  expect(call.instructions).not.toContain('加上团队管理的问题')
  expect(call.instructions).toContain('operatorRequest')
  // No request means an explicit null, so the model never sees a stale one.
  const plain = service([question])
  await plain.generateRuleQuestions(input)
  expect(JSON.parse((plain as any).invokeCloud.mock.calls[0][0].projection).operatorRequest).toBeNull()
})
