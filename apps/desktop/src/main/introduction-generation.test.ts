import { expect, it, vi } from 'vitest'
import { loadAgentChatModelCatalog } from '@agent'
import { createIntroductionGenerator } from './introduction-generation'
const id = '11111111-1111-4111-8111-111111111111'
it('uses the cloud once for concurrent clicks and excludes the local identity/contact fields from its projection', async () => {
  let finish: (value: string) => void = () => {}
  const cloud = vi.fn((_input: { projection: string }) => new Promise<string>((resolve) => { finish = resolve }))
  const repository = { getCurrentCandidateProfile: () => ({ profileVersion: 1, localPersonalDetails: { displayName: 'Private Name', email: 'private@example.com' }, fields: [{ key: 'skills', value: 'Java' }], projectExperiences: [] }) }
  const generate = createIntroductionGenerator({ repository, agentNarrativeStreamer: { regenerateIntroduction: cloud }, agentChatModelCatalog: loadAgentChatModelCatalog() } as any)
  const input = { kind: 'person' as const, id, version: 1, lang: 'ja' as const, style: 'brief' as const }
  const first = generate(input); const second = generate(input)
  expect(first).toBe(second)
  expect(cloud).toHaveBeenCalledTimes(1)
  expect(cloud.mock.calls[0]?.[0]?.projection).not.toContain('private@example.com')
  finish('Java 経験者をご紹介します。')
  expect(await first).toEqual({ text: 'Java 経験者をご紹介します。' })
})
it('rejects a generated message when a profile changes during the cloud request', async () => {
  let version = 1
  const generate = createIntroductionGenerator({ repository: { getCurrentCandidateProfile: () => ({ profileVersion: version, fields: [], projectExperiences: [] }) },
    agentNarrativeStreamer: { regenerateIntroduction: async () => { version++; return 'Generated' } }, agentChatModelCatalog: loadAgentChatModelCatalog() } as any)
  await expect(generate({ kind: 'person', id, version: 1, lang: 'zh', style: 'standard' })).rejects.toThrow('资料已更新')
})

it('accepts an unknown eligibility label and renders masked tokens without exposing identity', async () => {
  const generate = createIntroductionGenerator({ repository: { getCurrentCandidateProfile: () => ({ profileVersion: 1, fields: [], projectExperiences: [] }) },
    agentNarrativeStreamer: { regenerateIntroduction: async () => '就労資格：要確認\n要員：<PERSON_NAME_001>\n連絡先：<PRIVATE_EMAIL_001>' }, agentChatModelCatalog: loadAgentChatModelCatalog() } as any)
  await expect(generate({ kind: 'person', id, version: 1, lang: 'ja', style: 'standard' })).resolves.toEqual({ text: '就労資格：要確認\n要員：要確認\n連絡先：要確認' })
})
it('still rejects a generated real contact address', async () => {
  const generate = createIntroductionGenerator({ repository: { getCurrentCandidateProfile: () => ({ profileVersion: 1, fields: [], projectExperiences: [] }) },
    agentNarrativeStreamer: { regenerateIntroduction: async () => '連絡先：invented@example.com' }, agentChatModelCatalog: loadAgentChatModelCatalog() } as any)
  await expect(generate({ kind: 'person', id, version: 1, lang: 'ja', style: 'standard' })).rejects.toThrow('联系信息')
})
