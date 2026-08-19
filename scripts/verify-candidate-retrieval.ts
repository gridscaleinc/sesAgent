import assert from 'node:assert/strict'
import { performance } from 'node:perf_hooks'
import {
  evaluateCandidateRetrieval,
  searchConfirmedCandidateProfiles,
  type CandidateProfile
} from '@resume'

function profile(index: number, fields: Partial<Record<CandidateProfile['fields'][number]['key'], string>>): CandidateProfile {
  const suffix = String(index).padStart(12, '0')
  const id = `00000000-0000-4000-8000-${suffix}`
  const labels: Record<CandidateProfile['fields'][number]['key'], string> = {
    skills: 'スキル',
    experience_years: '経験年数',
    availability: '稼働時期',
    rate: '希望単価',
    japanese_level: '日本語',
    work_style: '勤務形態',
    role: '役割',
    location: '希望勤務地',
    work_authorization: '就労資格'
  }
  return {
    schemaVersion: 'candidate-profile-v1',
    id,
    sourceDocumentId: id,
    profileVersion: 1,
    reviewRevision: 1,
    fields: Object.entries(fields).map(([key, value]) => ({
      key: key as CandidateProfile['fields'][number]['key'],
      label: labels[key as CandidateProfile['fields'][number]['key']],
      value,
      sourceLabels: [`Fixture!${key}`]
    })),
    projectExperiences: [],
    confirmedAt: '2026-07-20T00:00:00.000Z',
    confirmedBy: 'fixture-reviewer',
    containsDirectIdentifiers: false
  }
}

const javaSenior = profile(1, {
  skills: 'Java, Spring Boot, AWS, Kubernetes',
  experience_years: '8年',
  availability: '8月から参画可能',
  work_style: '週3日リモート',
  location: '東京都内・品川通勤可',
  work_authorization: '就労制限なし',
  role: 'バックエンドエンジニア'
})
const pythonPlatform = profile(2, {
  skills: 'Python, AWS, Terraform, Docker',
  experience_years: '6年',
  role: 'クラウドネイティブ基盤エンジニア'
})
const javaJunior = profile(3, {
  skills: 'Java, AWS',
  experience_years: '2年',
  role: 'バックエンドエンジニア'
})
const distractors = Array.from({ length: 997 }, (_, offset) => profile(offset + 4, {
  skills: offset % 2 === 0 ? 'React, TypeScript, CSS' : 'SAP, ABAP, Oracle',
  experience_years: `${3 + offset % 5}年`,
  role: offset % 2 === 0 ? 'フロントエンドエンジニア' : 'ERPコンサルタント'
}))
const profiles = [javaSenior, pythonPlatform, javaJunior, ...distractors]

const startedAt = performance.now()
const metrics = evaluateCandidateRetrieval(profiles, [
  { query: 'Java AWS 5年以上', relevantSourceDocumentIds: [javaSenior.sourceDocumentId] },
  { query: 'Python Terraform', relevantSourceDocumentIds: [pythonPlatform.sourceDocumentId] },
  { query: 'クラウド基盤', relevantSourceDocumentIds: [pythonPlatform.sourceDocumentId] }
], 20)
const latencyMs = performance.now() - startedAt

assert.equal(metrics.recallAtK, 1, 'fixed retrieval fixture did not reach Recall@20 = 1.0')
assert.equal(searchConfirmedCandidateProfiles(profiles, 'Java 5年以上', 20).some(
  (result) => result.sourceDocumentId === javaJunior.sourceDocumentId
), false, 'minimum experience hard filter admitted a junior profile')
assert.equal(
  searchConfirmedCandidateProfiles(profiles, '勤務地:品川 就労資格:日本で就労可能', 20)[0]?.id,
  javaSenior.id,
  'coarse location and work-authorization filters did not select the eligible profile'
)
assert.equal(searchConfirmedCandidateProfiles([javaSenior], '勤務地:大阪', 20).length, 0,
  'a disjoint work location was not rejected')
assert.equal(searchConfirmedCandidateProfiles(profiles, 'fixture-reviewer', 20).length, 0, 'reviewer identity entered the BM25 index')
assert.equal(searchConfirmedCandidateProfiles(profiles.filter((item) => item.id !== pythonPlatform.id), 'Python Terraform', 20).length, 0,
  'a removed profile remained in stateless retrieval results')
assert.ok(latencyMs < 1_500, `1,000-profile local retrieval exceeded the 1.5 second fixture budget (${latencyMs.toFixed(1)} ms)`)

process.stdout.write(`${JSON.stringify({
  engine: 'hard-filter-bm25-v1',
  profiles: profiles.length,
  fixtureRecallAt20: metrics.recallAtK,
  evaluatedCases: metrics.evaluatedCases,
  locationAndWorkAuthorizationVerified: true,
  hardFilterVerified: true,
  reviewerIdentityIndexed: false,
  removalInvalidationVerified: true,
  latencyMs: Math.round(latencyMs * 10) / 10,
  networkAccess: false
})}\n`)
