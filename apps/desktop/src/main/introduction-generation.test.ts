import { expect, it, vi } from 'vitest'
import { loadAgentChatModelCatalog } from '@agent'
import { createIntroductionGenerator } from './introduction-generation'
import { AgentCloudNarrativeService } from './agent-cloud-narrative'
import { redactTextForCloud, type RedactionSessionEvidence } from '@privacy'
import type { AiCommerceNativeClient } from '@aicommerce'
const id = '11111111-1111-4111-8111-111111111111'
it('uses the cloud once for concurrent clicks and excludes the local identity/contact fields from its projection', async () => {
  let finish: (value: string) => void = () => {}
  const cloud = vi.fn(
    (_input: { projection: string }) =>
      new Promise<string>((resolve) => {
        finish = resolve
      })
  )
  const repository = {
    getCurrentCandidateProfile: () => ({
      profileVersion: 1,
      localPersonalDetails: { displayName: 'Private Name', email: 'private@example.com' },
      fields: [{ key: 'skills', value: 'Java' }],
      projectExperiences: []
    })
  }
  const generate = createIntroductionGenerator({
    repository,
    agentNarrativeStreamer: { regenerateIntroduction: cloud },
    agentChatModelCatalog: loadAgentChatModelCatalog()
  } as any)
  const input = { kind: 'person' as const, id, version: 1, lang: 'ja' as const, style: 'brief' as const }
  const first = generate(input)
  const second = generate(input)
  expect(first).toBe(second)
  expect(cloud).toHaveBeenCalledTimes(1)
  expect(cloud.mock.calls[0]?.[0]?.projection).not.toContain('private@example.com')
  finish('Java 経験者をご紹介します。')
  expect(await first).toEqual({ text: 'Java 経験者をご紹介します。' })
})
it('rejects a generated message when a profile changes during the cloud request', async () => {
  let version = 1
  const generate = createIntroductionGenerator({
    repository: { getCurrentCandidateProfile: () => ({ profileVersion: version, fields: [], projectExperiences: [] }) },
    agentNarrativeStreamer: {
      regenerateIntroduction: async () => {
        version++
        return 'Generated'
      }
    },
    agentChatModelCatalog: loadAgentChatModelCatalog()
  } as any)
  await expect(generate({ kind: 'person', id, version: 1, lang: 'zh', style: 'standard' })).rejects.toThrow('资料已更新')
})

it('accepts an unknown eligibility label and renders masked tokens without exposing identity', async () => {
  const generate = createIntroductionGenerator({
    repository: { getCurrentCandidateProfile: () => ({ profileVersion: 1, fields: [], projectExperiences: [] }) },
    agentNarrativeStreamer: {
      regenerateIntroduction: async () => '就労資格：要確認\n要員：<PERSON_NAME_001>\n連絡先：<PRIVATE_EMAIL_001>'
    },
    agentChatModelCatalog: loadAgentChatModelCatalog()
  } as any)
  await expect(generate({ kind: 'person', id, version: 1, lang: 'ja', style: 'standard' })).resolves.toEqual({
    text: '就労資格：要確認\n要員：[送信前に記入]\n連絡先：[送信前に記入]'
  })
})
it('still rejects a generated real contact address', async () => {
  const generate = createIntroductionGenerator({
    repository: { getCurrentCandidateProfile: () => ({ profileVersion: 1, fields: [], projectExperiences: [] }) },
    agentNarrativeStreamer: { regenerateIntroduction: async () => '連絡先：invented@example.com' },
    agentChatModelCatalog: loadAgentChatModelCatalog()
  } as any)
  await expect(generate({ kind: 'person', id, version: 1, lang: 'ja', style: 'standard' })).rejects.toThrow('联系信息')
})

it('keeps overview, skill and language facts fixed while AI writes the case-specific match points', async () => {
  const person = {
    profileVersion: 1,
    fields: [
      { key: 'role', value: 'SE' },
      { key: 'skills', value: 'Java' },
      { key: 'experience_years', value: '19年' },
      { key: 'japanese_level', value: '会話 C（ゆっくり対応可）' }
    ],
    projectExperiences: [{ title: '金融', technologies: ['Java'], summary: 'Javaによる既存機能の障害調査と改修を担当。' }]
  }
  const cloud = vi.fn(
    async () =>
      '■要員概要\n日本語：ネイティブ\n単価：999万円\n■主要スキル\nJava\n■案件とのマッチポイント\n・金融システムで、Javaによる既存機能の障害調査と改修を担当しています。\n\n何卒よろしくお願いいたします。'
  )
  const generate = createIntroductionGenerator({
    repository: {
      getCandidateProfileForAssessment: () => person,
      getJobCaseReview: () => ({
        reviewId: id,
        lifecycle: 'active',
        jobCase: { version: 1 },
        fields: [
          { key: 'title', value: 'Java障害改修' },
          { key: 'required_skills', value: 'Java' }
        ]
      })
    },
    agentNarrativeStreamer: { regenerateIntroduction: cloud },
    agentChatModelCatalog: loadAgentChatModelCatalog()
  } as any)
  const result = await generate({
    kind: 'person',
    id,
    version: 1,
    lang: 'ja',
    style: 'standard',
    caseContext: { reviewId: id, version: 1 }
  })
  expect(result.text).not.toContain('日本語：')
  expect(result.text).not.toContain('希望単価：')
  expect(result.text).toContain('金融システムで、Javaによる既存機能の障害調査と改修を担当しています。')
  expect(result.text).not.toMatch(/ネイティブ|999万円/)
})

function privacyBoundaryFixture(summary = 'Javaによる既存機能の障害調査と改修を担当。') {
  const opaqueId = 'aaaaaaaa-a123-4567-8abc-aaaaaaaaaaaa'
  const sessions = new Map<string, RedactionSessionEvidence>()
  const streamResponses = vi.fn(async (_request: Parameters<AiCommerceNativeClient['streamResponses']>[0]) => ({
    clientRequestId: 'fixture',
    responseId: 'fixture',
    billingModeUsed: 'subscription' as const,
    content: '■案件とのマッチポイント\n・Javaによる既存機能の障害調査と改修を担当した経験があります。'
  }))
  const service = new AgentCloudNarrativeService({
    repository: {
      saveRedactionSession: (s) => {
        sessions.set(s.id, s)
      },
      getRedactionSession: (key) => sessions.get(key) ?? null,
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
    allowLoopbackHttp: false,
    loadGates: vi.fn().mockResolvedValue({
      qualityGate: { status: 'passed' },
      expertGate: { status: 'not-verified' },
      binding: {
        qualityReportHash: 'a'.repeat(64),
        expertAttestationHash: null,
        privacyImplementationSha256: 'c'.repeat(64),
        cloudEnforcementSha256: 'd'.repeat(64)
      }
    })
  })
  const person = {
    profileVersion: 1,
    fields: [
      {
        key: 'skills',
        label: '技術',
        value: 'Java',
        sources: [{ documentId: opaqueId, locator: 'private-source.xlsx!A1' }],
        originalValue: 'obsolete-private-value'
      }
    ],
    projectExperiences: [
      {
        id: opaqueId,
        title: '業務システム',
        period: '2020年〜2024年',
        role: 'SE',
        technologies: ['Java', 'SQL'],
        summary,
        sourceLabels: ['private-source.xlsx!A2']
      }
    ]
  }
  const repository = {
    getCandidateProfileForAssessment: () => person,
    getJobCaseReview: () => ({
      reviewId: id,
      lifecycle: 'active',
      jobCase: { version: 1 },
      fields: [
        { key: 'title', value: 'Java障害改修' },
        { key: 'required_skills', value: 'Java' }
      ]
    }),
    listWorkRules: () => ({
      revision: 1,
      rules: [
        {
          id: opaqueId,
          revision: 1,
          enabled: true,
          scope: { kind: 'global' },
          clauses: [{ kind: 'presentation', text: '技術と担当範囲を簡潔に記載する。', caseKeywords: [] }]
        }
      ]
    }),
    saveExperienceRun: vi.fn((_run: { input: { hrRules: Array<{ id: string }> } }) => 'saved-run')
  }
  const generate = createIntroductionGenerator({
    repository,
    agentNarrativeStreamer: service,
    agentChatModelCatalog: loadAgentChatModelCatalog()
  } as any)
  return {
    generate: () => generate({ kind: 'person', id, version: 1, lang: 'ja', style: 'standard', caseContext: { reviewId: id, version: 1 } }),
    streamResponses,
    repository,
    opaqueId,
    person
  }
}

it('generates a proposal through the actual DLP gateway without sending project, source or rule IDs', async () => {
  const fixture = privacyBoundaryFixture()
  // This database UUID really triggers the independent postal-code detector.
  expect(
    redactTextForCloud(JSON.stringify({ id: fixture.opaqueId }), { sourceVersion: 'fixture', personNameReviewCompleted: true })
      .blockedReasons
  ).toContain('residual:postal_address')
  const result = await fixture.generate()
  expect(result.text).toContain('Javaによる既存機能の障害調査と改修')
  expect(fixture.streamResponses).toHaveBeenCalledTimes(1)
  const sent = fixture.streamResponses.mock.calls[0]![0].input
  expect(sent).not.toContain(fixture.opaqueId)
  expect(sent).not.toMatch(/private-source|obsolete-private-value|sourceLabels/)
  const source = JSON.parse(sent).source
  expect(source.person.fields).toEqual([{ key: 'skills', label: '技術', value: 'Java' }])
  expect(source.person.projects).toEqual([
    {
      title: '業務システム',
      period: '2020年〜2024年',
      role: 'SE',
      technologies: ['Java', 'SQL'],
      summary: fixture.person.projectExperiences[0]!.summary
    }
  ])
  expect(source.hrRules).toEqual([{ kind: 'presentation', text: '技術と担当範囲を簡潔に記載する。' }])
  // Provenance remains in the local learning record, outside the cloud projection.
  expect(fixture.repository.saveExperienceRun.mock.calls[0]![0].input.hrRules[0].id).toBe(fixture.opaqueId)
})

it('still blocks a residual postal address in proposal business facts before any cloud request', async () => {
  const fixture = privacyBoundaryFixture('Java開発。郵便番号 123-4567')
  await expect(fixture.generate()).rejects.toThrow('residual:postal_address')
  expect(fixture.streamResponses).not.toHaveBeenCalled()
  expect(fixture.repository.saveExperienceRun).not.toHaveBeenCalled()
})

it('writes with the 文案与分析 model the operator chose, not the 批量核对 one', async () => {
  const cloud = vi.fn(async (_input: { model: { key: string } }) => 'Generated')
  const generate = createIntroductionGenerator({
    repository: {
      getCurrentCandidateProfile: () => ({ profileVersion: 1, fields: [], projectExperiences: [] }),
      getLocalApplicationPreferences: () => ({ aiModels: { checking: 'gpt-6-luna', writing: 'gpt-6.1-sol-pro' } })
    },
    agentNarrativeStreamer: { regenerateIntroduction: cloud },
    agentChatModelCatalog: loadAgentChatModelCatalog()
  } as any)
  await generate({ kind: 'person', id, version: 1, lang: 'ja', style: 'standard' })
  expect(cloud.mock.calls[0]?.[0]?.model.key).toBe('gpt-6.1-sol-pro')
})
