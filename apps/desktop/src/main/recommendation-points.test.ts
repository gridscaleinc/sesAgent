import { describe, expect, it, vi } from 'vitest'
import type { IpcMainInvokeEvent } from 'electron'
import { loadAgentChatModelCatalog, type AgentChatModelDefinition } from '@agent'
import type { AiCommerceNativeClient } from '@aicommerce'
import type { LocalPiiMapping, RedactionSessionEvidence } from '@privacy'
import { ipcChannels, type RecommendationPointsRecord } from '@shared'
import {
  AgentCloudNarrativeService,
  applyRecommendationPointTranslation,
  buildRecommendationPointsProjection,
  parseRecommendationPointsResponse,
  recommendationPointsInstructions,
  recommendationPointsNeedTranslation,
  type RecommendationPointsMaterial
} from './agent-cloud-narrative'
import { createRecommendationPointsGenerator, getRecommendationPoints } from './recommendation-points'
import { createIntroductionGenerator } from './introduction-generation'
import { registerPersonnelHandlers } from './ipc/personnel'
import type { MainIpcContext } from './ipc/context'

const mock = vi.hoisted(() => ({ handlers: new Map<string, (e: IpcMainInvokeEvent, raw?: unknown) => unknown>() }))
vi.mock('electron', () => ({
  ipcMain: { handle: (key: string, handler: (e: IpcMainInvokeEvent, raw?: unknown) => unknown) => mock.handlers.set(key, handler) },
  shell: { openExternal: vi.fn() }
}))
vi.mock('./ipc/context', () => ({ assertTrustedSender: vi.fn() }))

const documentId = '11111111-1111-4111-8111-111111111111'
const reviewId = '33333333-3333-4333-8333-333333333333'
const material: RecommendationPointsMaterial = {
  facts: ['Java 8年、Spring Boot', '<PERSON_NAME_001> は基本設計から担当可能'],
  projects: [
    {
      title: '損保向け契約管理システム刷新',
      parts: ['損保向け契約管理システム刷新', '2023/04-2025/03', 'PL', 'Java', '基本設計から結合テストまでを5名チームで担当']
    },
    { title: '決済基盤刷新', parts: ['決済基盤刷新', '2021/01-2023/03', 'SE', 'Spring Boot で決済 API を開発'] }
  ]
}
const mappings = [
  { placeholder: '<PERSON_NAME_001>', originalValue: '山田太郎', identifierType: 'person_name' }
] as unknown as LocalPiiMapping[]
const point = (over: Record<string, unknown> = {}) => ({
  headline: '损保系统的基本设计经验',
  detail: '在损保契约管理系统刷新中担任 PL，负责基本设计到结合测试，与本案件的设计阶段一致。',
  project: '損保向け契約管理システム刷新',
  quote: '基本設計から結合テストまでを5名チームで担当',
  ...over
})
const parse = (points: unknown[]) => parseRecommendationPointsResponse(JSON.stringify({ points }), material, mappings)

describe('推荐要点 cloud validation', () => {
  it('keeps a point whose quote is a verbatim fragment of the named project', () => {
    expect(parse([point()])).toEqual({ points: [point()], emptyReason: null })
  })
  it('drops a paraphrased quote, a quote from another project and a quote stitched across fields', () => {
    const result = parse([
      point({ quote: '基本設計〜結合テストを担当' }),
      point({ headline: 'A', quote: 'Spring Boot で決済 API を開発' }),
      point({ headline: 'B', quote: 'PL Java' })
    ])
    expect(result).toEqual({ points: [], emptyReason: 'no-grounded-points' })
  })
  it('drops an unknown project title but accepts facts-based points with project null', () => {
    const result = parse([
      point({ project: '架空のプロジェクト' }),
      point({ headline: '长期 Java 经验', detail: '有 8 年 Java 与 Spring Boot 经验。', project: null, quote: 'Java 8年、Spring Boot' })
    ])
    expect(result.points).toEqual([
      { headline: '长期 Java 经验', detail: '有 8 年 Java 与 Spring Boot 经验。', project: null, quote: 'Java 8年、Spring Boot' }
    ])
  })
  it('restores placeholders and drops a point whose placeholder does not restore', () => {
    const result = parse([
      point({ project: null, quote: '<PERSON_NAME_001> は基本設計から担当可能', detail: '<PERSON_NAME_001> 可从基本设计开始负责。' }),
      point({ headline: '另一个要点', detail: '<PERSON_NAME_002> 的经验。' })
    ])
    expect(result.points).toEqual([
      point({ project: null, quote: '山田太郎 は基本設計から担当可能', detail: '山田太郎 可从基本设计开始负责。' })
    ])
  })
  it('bounds lengths, removes duplicate headlines and keeps at most five points', () => {
    const many = Array.from({ length: 8 }, (_, index) => point({ headline: `要点${index + 1}` }))
    expect(parse(many).points.map((item) => item.headline)).toEqual(['要点1', '要点2', '要点3', '要点4', '要点5'])
    expect(parse([point({ headline: 'x'.repeat(31) }), point({ detail: 'x'.repeat(161) }), point({ quote: '' })]).points).toEqual([])
    expect(parse([point(), point()]).points).toHaveLength(1)
  })
  it('returns an empty list with a reason for no points and rejects malformed JSON', () => {
    expect(parse([])).toEqual({ points: [], emptyReason: 'no-grounded-points' })
    expect(() => parseRecommendationPointsResponse('not json', material)).toThrow('Invalid recommendation points JSON')
    expect(() => parseRecommendationPointsResponse('{"items":[]}', material)).toThrow('protocol')
  })
  it('sends every project, bounded case text without foreign placeholders, and no database ids', () => {
    const built = buildRecommendationPointsProjection({
      locale: 'zh-CN',
      person: {
        facts: [{ label: 'スキル', value: 'Java' }],
        projects: Array.from({ length: 30 }, (_, index) => ({
          title: `案件${index + 1}`,
          period: '2020',
          role: 'SE',
          technologies: ['Java'],
          summary: '設計'.repeat(400)
        }))
      },
      jobCase: { title: '損保案件', fields: [{ label: '必須', value: 'Java' }], body: `連絡先 <EMAIL_001>\n${'本文'.repeat(5000)}` }
    })
    const projection = JSON.parse(built.projection)
    expect(built.projection.length).toBeLessThanOrEqual(20_000)
    expect(projection.person.projects).toHaveLength(30)
    expect(built.projects).toHaveLength(30)
    expect(projection.case.body).not.toContain('<EMAIL_001>')
    expect(projection.case.body.length).toBeLessThanOrEqual(3_000)
    expect(built.projection).not.toContain(documentId)
    expect(recommendationPointsInstructions('zh-CN')).toContain('Simplified Chinese')
    expect(recommendationPointsInstructions('ja-JP')).toContain('rate, price, location')
  })
})

describe('推荐要点 language fix-up', () => {
  const japanese = point({
    headline: '損保システムの基本設計経験',
    detail: '損保向け契約管理システムでPLとして基本設計から結合テストまでを担当しました。'
  })
  it('reuses the generic language check on headline and detail only', () => {
    expect(recommendationPointsNeedTranslation([japanese], 'zh-CN')).toBe(true)
    expect(recommendationPointsNeedTranslation([japanese], 'ja-JP')).toBe(false)
    expect(recommendationPointsNeedTranslation([point()], 'zh-CN')).toBe(false)
  })
  it('translates headline and detail, never the quote or project, and keeps an incomplete item', () => {
    const [first, second] = applyRecommendationPointTranslation(
      [japanese, { ...japanese, headline: '別の要点' }],
      JSON.stringify({
        items: [
          { id: 'P1', headline: '损保系统的基本设计经验', detail: '在损保契约管理系统中作为 PL 负责基本设计到结合测试。', quote: '改写' },
          { id: 'P2', headline: '另一个要点' }
        ]
      }),
      []
    )
    expect(first).toEqual({
      ...japanese,
      headline: '损保系统的基本设计经验',
      detail: '在损保契约管理系统中作为 PL 负责基本设计到结合测试。'
    })
    expect(second).toEqual({ ...japanese, headline: '別の要点' })
  })
})

const model: AgentChatModelDefinition = {
  key: 'gpt-5.6-luna',
  displayName: 'GPT-5.6 Luna',
  upstreamModel: 'gpt-5.6-luna',
  maxOutputTokens: 1_200,
  provider: 'openai',
  endpoint: 'responses'
}
const serviceWith = (streamResponses: ReturnType<typeof vi.fn>) => {
  const sessions = new Map<string, RedactionSessionEvidence>()
  return new AgentCloudNarrativeService({
    repository: {
      saveRedactionSession: (session) => {
        sessions.set(session.id, session)
      },
      getRedactionSession: (id) => sessions.get(id) ?? null,
      appendCloudCallAudit: vi.fn()
    },
    localNer: {
      engine: 'apple-natural-language',
      detectNames: vi.fn().mockResolvedValue({ engine: 'apple-natural-language', networkAccess: false, entities: [] })
    },
    aiCommerce: {
      responsesEndpoint: 'https://aicommerce.gridscale.com/v1/ai/native/openai/v1/responses',
      streamResponses,
      cancelClientRequest: vi.fn()
    } as unknown as AiCommerceNativeClient,
    policyVersion: 'cloud-redaction-v2',
    loadGates: vi.fn().mockResolvedValue({
      qualityGate: { status: 'passed' as const },
      expertGate: { status: 'not-verified' as const },
      binding: {
        qualityReportHash: 'a'.repeat(64),
        expertAttestationHash: null,
        privacyImplementationSha256: 'c'.repeat(64),
        cloudEnforcementSha256: 'd'.repeat(64)
      }
    }),
    allowLoopbackHttp: false
  })
}
const reply = (content: unknown) => ({
  clientRequestId: 'remote',
  responseId: 'response',
  billingModeUsed: 'subscription' as const,
  content: JSON.stringify(content)
})

describe('AgentCloudNarrativeService.generateRecommendationPoints', () => {
  const generate = (service: AgentCloudNarrativeService) =>
    service.generateRecommendationPoints({
      conversationId: '44444444-4444-4444-8444-444444444444',
      requestId: '55555555-5555-4555-8555-555555555555',
      locale: 'zh-CN',
      model,
      signal: new AbortController().signal,
      onClientRequestId: vi.fn(),
      person: {
        facts: [{ label: 'スキル', value: 'Java 8年 private@example.com' }],
        projects: [{ title: '決済基盤刷新', period: '2021', role: 'SE', technologies: ['Java'], summary: 'Spring Boot で決済 API を開発' }]
      },
      jobCase: { title: '決済案件', fields: [{ label: '必須', value: 'Java' }], body: null }
    })
  const japanesePoint = {
    headline: '決済APIの開発経験',
    detail: '決済基盤刷新でSpring Bootによる決済APIを開発しました。',
    project: '決済基盤刷新',
    quote: 'Spring Boot で決済 API を開発'
  }
  it('redacts the projection, validates the reply and translates Japanese prose into the operator language', async () => {
    const streamResponses = vi
      .fn()
      .mockResolvedValueOnce(reply({ points: [japanesePoint, { ...japanesePoint, headline: '捏造', quote: '存在しない経験' }] }))
      .mockResolvedValueOnce(
        reply({ items: [{ id: 'P1', headline: '决济 API 开发经验', detail: '在決済基盤刷新中用 Spring Boot 开发了决济 API。' }] })
      )
    const result = await generate(serviceWith(streamResponses))
    expect(streamResponses).toHaveBeenCalledTimes(2)
    expect(streamResponses.mock.calls[0]![0].input).not.toContain('private@example.com')
    expect(streamResponses.mock.calls[0]![0].instructions).toContain('selling points')
    expect(streamResponses.mock.calls[1]![0].input).not.toContain('Spring Boot で決済 API を開発')
    expect(result).toEqual({
      points: [{ ...japanesePoint, headline: '决济 API 开发经验', detail: '在決済基盤刷新中用 Spring Boot 开发了决济 API。' }],
      emptyReason: null
    })
  })
  it('keeps the validated points when the translation call fails', async () => {
    const streamResponses = vi
      .fn()
      .mockResolvedValueOnce(reply({ points: [japanesePoint] }))
      .mockRejectedValueOnce(new Error('network down'))
    expect((await generate(serviceWith(streamResponses))).points).toEqual([japanesePoint])
  })
})

const record = (over: Partial<RecommendationPointsRecord> = {}): RecommendationPointsRecord => ({
  documentId,
  reviewId,
  profileVersion: 1,
  jobCaseVersion: 2,
  locale: 'zh-CN',
  points: [point()],
  emptyReason: null,
  generatedAt: '2026-09-30T01:00:00.000Z',
  modelName: 'GPT',
  ...over
})
const repositoryWith = (versions: { profile: number; job: number | null }, stored: RecommendationPointsRecord | null = record()) => ({
  getCandidateProfileForAssessment: vi.fn(() => ({
    profileVersion: versions.profile,
    fields: [{ key: 'skills', label: 'スキル', value: 'Java' }],
    projectExperiences: []
  })),
  getJobCaseReview: vi.fn(() =>
    versions.job === null
      ? null
      : {
          reviewId,
          lifecycle: 'active',
          redactedSubject: '件名',
          fields: [{ key: 'title', label: '案件名', value: '損保案件', status: 'confirmed' }],
          jobCase: { version: versions.job }
        }
  ),
  getJobCaseSourceText: vi.fn(() => ({ redactedBody: '案件本文' })),
  getRecommendationPoints: vi.fn(() => stored),
  saveRecommendationPoints: vi.fn(() => true),
  getLocalApplicationPreferences: vi.fn(() => ({ locale: 'zh-CN' }))
})

describe('推荐要点 IPC', () => {
  const invoke = (channel: string, input?: unknown) =>
    mock.handlers.get(channel)!({ sender: { id: 1, isDestroyed: () => false, send: vi.fn() } } as unknown as IpcMainInvokeEvent, input)
  it('returns stored points with a stale flag when the profile or case version changed', async () => {
    for (const [versions, stale] of [
      [{ profile: 1, job: 2 }, false],
      [{ profile: 2, job: 2 }, true],
      [{ profile: 1, job: 3 }, true],
      [{ profile: 1, job: null }, true]
    ] as const) {
      mock.handlers.clear()
      registerPersonnelHandlers({
        repository: repositoryWith(versions),
        currentOperator: () => ({ displayName: 'HR' })
      } as unknown as MainIpcContext)
      expect(await invoke(ipcChannels.getRecommendationPoints, { documentId, reviewId })).toEqual({ record: record(), stale })
    }
    expect(
      getRecommendationPoints({ repository: repositoryWith({ profile: 1, job: 2 }, null) } as never, { documentId, reviewId })
    ).toEqual({
      record: null,
      stale: false
    })
    expect(() => invoke(ipcChannels.getRecommendationPoints, { documentId: 'x', reviewId })).toThrow()
  })
  it('generates once for concurrent clicks and stores the points with versions, locale and model', async () => {
    const repository = repositoryWith({ profile: 1, job: 2 })
    let finish: (value: unknown) => void = () => {}
    const cloud = vi.fn(() => new Promise((resolve) => (finish = resolve)))
    const generate = createRecommendationPointsGenerator({
      repository,
      agentNarrativeStreamer: { generateRecommendationPoints: cloud },
      agentChatModelCatalog: loadAgentChatModelCatalog()
    } as never)
    const first = generate({ documentId, reviewId })
    expect(generate({ documentId, reviewId })).toBe(first)
    await vi.waitFor(() => expect(cloud).toHaveBeenCalledTimes(1))
    const input = (cloud.mock.calls[0] as unknown as [{ jobCase: { body: string; title: string }; locale: string }])[0]
    expect(input).toMatchObject({ locale: 'zh-CN', jobCase: { title: '損保案件', body: '案件本文' } })
    expect(JSON.stringify(input)).not.toContain(reviewId)
    finish({ points: [point()], emptyReason: null })
    const view = await first
    expect(view).toMatchObject({ stale: false, record: { profileVersion: 1, jobCaseVersion: 2, locale: 'zh-CN', points: [point()] } })
    expect(repository.saveRecommendationPoints).toHaveBeenCalledWith(view.record)
  })
  it('does not store points when the profile changed during generation', async () => {
    const repository = repositoryWith({ profile: 1, job: 2 })
    const generate = createRecommendationPointsGenerator({
      repository,
      agentNarrativeStreamer: {
        generateRecommendationPoints: async () => {
          repository.getCandidateProfileForAssessment.mockReturnValue({ profileVersion: 2, fields: [], projectExperiences: [] })
          return { points: [point()], emptyReason: null }
        }
      },
      agentChatModelCatalog: loadAgentChatModelCatalog()
    } as never)
    await expect(generate({ documentId, reviewId })).rejects.toThrow('资料已更新')
    expect(repository.saveRecommendationPoints).not.toHaveBeenCalled()
  })
})

describe('introduction generation with 推荐要点', () => {
  const generatorWith = (stored: RecommendationPointsRecord | null) => {
    const cloud = vi.fn(async (_input: { projection: string }) => 'Java 経験者をご紹介します。')
    const repository = {
      getCandidateProfileForAssessment: () => ({
        profileVersion: 1,
        fields: [{ key: 'skills', label: 'スキル', value: 'Java' }],
        projectExperiences: []
      }),
      getJobCaseReview: () => ({ reviewId, lifecycle: 'active', fields: [], jobCase: { version: 2 } }),
      getRecommendationPoints: () => stored
    }
    const generate = createIntroductionGenerator({
      repository,
      agentNarrativeStreamer: { regenerateIntroduction: cloud },
      agentChatModelCatalog: loadAgentChatModelCatalog()
    } as never)
    return {
      cloud,
      run: () => generate({ kind: 'person', id: documentId, version: 1, lang: 'zh', style: 'brief', caseContext: { reviewId, version: 2 } })
    }
  }
  it('passes stored, current points to the AI introduction as material', async () => {
    const { cloud, run } = generatorWith(record())
    // The reply has no match-point section; only what was sent matters here.
    await run().catch(() => undefined)
    expect(JSON.parse(cloud.mock.calls[0]![0].projection).recommendationPoints).toEqual([point()])
  })
  it('leaves stale points out', async () => {
    const { cloud, run } = generatorWith(record({ jobCaseVersion: 1 }))
    await run().catch(() => undefined)
    expect(JSON.parse(cloud.mock.calls[0]![0].projection)).not.toHaveProperty('recommendationPoints')
  })
})
