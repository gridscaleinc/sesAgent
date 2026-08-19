import assert from 'node:assert/strict'
import { resolve } from 'node:path'
import {
  LocalEmbeddingWorkerClient,
  LocalRerankerWorkerClient,
  localEmbeddingModel,
  localRerankerModel
} from '@local-ai'
import {
  evaluateSesCandidateBenchmark,
  LocalHybridCandidateRetrieval,
  type CandidateEmbeddingCacheRecord,
  type CandidateProfile
} from '@resume'
import type { SesCandidateBenchmark } from '@shared'

const root = resolve(import.meta.dirname, '..')
const worker = new LocalEmbeddingWorkerClient({
  workerPath: resolve(root, 'out', 'main', 'embedding-worker.js'),
  modelDirectory: resolve(root, 'models', 'Xenova', 'multilingual-e5-small')
})
const rerankerWorker = new LocalRerankerWorkerClient({
  workerPath: resolve(root, 'out', 'main', 'reranker-worker.js'),
  modelDirectory: resolve(root, 'models', 'hotchpotch', 'japanese-reranker-tiny-v2')
})
const cache: CandidateEmbeddingCacheRecord[] = []
const projectCache: Array<CandidateEmbeddingCacheRecord & { projectId: string }> = []
const retrieval = new LocalHybridCandidateRetrieval(worker, {
  listCandidateProfileEmbeddings: () => cache,
  saveCandidateProfileEmbeddings: (records) => cache.push(...records.map((record) => ({
    ...record,
    updatedAt: '2026-07-20T00:00:00.000Z'
  }))),
  listCandidateProjectEmbeddings: () => projectCache,
  saveCandidateProjectEmbeddings: (records) => projectCache.push(...records.map((record) => ({
    ...record,
    updatedAt: '2026-07-20T00:00:00.000Z'
  })))
}, {
  modelId: localEmbeddingModel.id,
  modelRevision: localEmbeddingModel.revision,
  dimension: localEmbeddingModel.dimension
}, rerankerWorker)

const profileId = (index: number): string => `${index.toString(16).padStart(8, '0')}-0000-4000-8000-${String(index).padStart(12, '0')}`
const profile = (index: number, skills: string, role: string, project?: {
  title: string
  summary: string
  technologies: string[]
}): CandidateProfile => ({
  schemaVersion: 'candidate-profile-v1',
  id: profileId(index),
  sourceDocumentId: profileId(index),
  profileVersion: 1,
  reviewRevision: 1,
  fields: [
    { key: 'skills', label: 'スキル', value: skills, sourceLabels: [`Fixture ${index}`] },
    { key: 'experience_years', label: '経験年数', value: '7年', sourceLabels: [`Fixture ${index}`] },
    { key: 'availability', label: '稼働可能時期', value: '来月から参画可能', sourceLabels: [`Fixture ${index}`] },
    { key: 'rate', label: '希望単価', value: '85万円/月', sourceLabels: [`Fixture ${index}`] },
    { key: 'japanese_level', label: '日本語', value: 'ビジネス', sourceLabels: [`Fixture ${index}`] },
    { key: 'work_style', label: '勤務形態', value: 'ハイブリッド', sourceLabels: [`Fixture ${index}`] },
    { key: 'role', label: 'ロール', value: role, sourceLabels: [`Fixture ${index}`] },
    { key: 'location', label: '希望勤務地', value: '首都圏', sourceLabels: [`Fixture ${index}`] },
    { key: 'work_authorization', label: '就労資格', value: '就労制限なし', sourceLabels: [`Fixture ${index}`] }
  ],
  projectExperiences: project ? [{
    id: profileId(index + 20_000),
    title: project.title,
    period: '2023年4月〜2025年3月',
    role,
    technologies: project.technologies,
    summary: project.summary,
    sourceLabels: [`Fixture project ${index}`]
  }] : [],
  confirmedAt: '2026-07-20T00:00:00.000Z',
  confirmedBy: `fixture-reviewer-${index}`,
  containsDirectIdentifiers: false
})

const relevant = [
  profile(1, 'Kubernetes, Argo CD, Prometheus, Grafana', 'SRE', {
    title: 'コンテナ基盤の信頼性改善',
    summary: '可観測性を再設計し、アラート品質と障害検知速度を改善した。',
    technologies: ['Kubernetes', 'Prometheus', 'Grafana']
  }),
  profile(2, 'SAP S/4HANA, ABAP, FI/CO', 'ERPコンサルタント', {
    title: '基幹会計システム刷新',
    summary: '財務会計領域の要件定義とS/4HANA移行を担当した。',
    technologies: ['SAP S/4HANA', 'ABAP', 'FI/CO']
  }),
  profile(3, 'Swift, SwiftUI, Combine, Xcode', 'iOSエンジニア', {
    title: 'iPhone向けネイティブアプリ開発',
    summary: 'SwiftUIを用いたApple端末向けアプリの設計と実装を担当した。',
    technologies: ['Swift', 'SwiftUI', 'Xcode']
  })
]
const distractorTemplates = [
  ['Java, Spring Boot, Oracle', 'バックエンドエンジニア'],
  ['React, TypeScript, Next.js', 'フロントエンドエンジニア'],
  ['Python, Django, PostgreSQL', 'Webエンジニア'],
  ['C#, .NET, SQL Server', '業務システムエンジニア'],
  ['Excel, VBA, Access', '社内SE'],
  ['Salesforce, Apex, Lightning', 'CRMエンジニア'],
  ['PHP, Laravel, MySQL', 'Webアプリエンジニア'],
  ['AWS, Lambda, DynamoDB', 'クラウドエンジニア']
] as const
const profiles = [...relevant]
for (let index = relevant.length + 1; index <= 1_000; index += 1) {
  const template = distractorTemplates[index % distractorTemplates.length]!
  profiles.push(profile(index, `${template[0]}, project-${index}`, template[1]))
}

const cases = [
  { query: 'コンテナ運用の信頼性と可観測性を改善できる人材', sourceDocumentId: relevant[0]!.sourceDocumentId },
  { query: 'S/4HANAで財務会計システムを刷新できる人材', sourceDocumentId: relevant[1]!.sourceDocumentId },
  { query: 'Apple端末向けネイティブアプリの開発担当', sourceDocumentId: relevant[2]!.sourceDocumentId }
]

try {
  const startedAt = performance.now()
  let retrieved = 0
  let projectEvidenceHits = 0
  const ranks: number[] = []
  for (const testCase of cases) {
    const results = await retrieval.search(profiles, testCase.query, 20)
    const rank = results.findIndex((result) => result.sourceDocumentId === testCase.sourceDocumentId) + 1
    if (rank > 0) retrieved += 1
    if (results.find((result) => result.sourceDocumentId === testCase.sourceDocumentId)?.projectEvidence) projectEvidenceHits += 1
    ranks.push(rank)
    assert.ok(results.every((result) => result.retrieval.strategy === 'hard-filter-hybrid-local-rerank-v1'))
    assert.ok(results.every((result) => result.retrieval.preRerankRank !== null && result.retrieval.rerankerRank !== null))
    assert.ok(results.every((result) => result.retrieval.hardFilterPolicyVersion === 'tri-state-v3'))
  }
  const elapsedMs = Math.round(performance.now() - startedAt)
  assert.equal(cache.length, profiles.length, 'fixed profile fixture was not cached exactly once')
  assert.equal(projectCache.length, relevant.length, 'project segments were not cached exactly once')
  assert.equal(retrieved, cases.length, `fixed semantic fixture missed a relevant profile at K=20: ${ranks.join(',')}`)
  assert.equal(projectEvidenceHits, cases.length, 'relevant results did not expose project-level evidence')
  assert.equal(cache.some((record) => JSON.stringify(record).includes('fixture-reviewer')), false, 'reviewer identity entered the vector cache')
  const benchmark: SesCandidateBenchmark = {
    version: 'ses-candidate-benchmark-v1',
    id: 'd5a8372a-f701-4862-8f5d-4278c116fe3c',
    name: 'Synthetic Hybrid Quality Gate',
    createdAt: '2026-07-20T00:00:00.000Z',
    privacy: { directIdentifiersRemoved: true, rawResumeIncluded: false, rawMailIncluded: false },
    labeling: { method: 'ses-expert', reviewerCount: 2 },
    thresholds: { minimumCases: 30, recallAt20: 0.9, ndcgAt20: 0.75, projectEvidenceCoverageAt20: 0.8 },
    cases: Array.from({ length: 30 }, (_, index) => {
      const testCase = cases[index % cases.length]!
      const profile = relevant[index % relevant.length]!
      const label = `候補者 ${profile.id.slice(0, 8).toLocaleUpperCase('en-US')}`
      return {
        id: `synthetic-case-${index + 1}`,
        query: testCase.query,
        relevantCandidateLabels: [label],
        expectedProjectEvidenceLabels: [label]
      }
    })
  }
  const qualityReport = await evaluateSesCandidateBenchmark(
    benchmark,
    new Set(profiles.map((profile) => `候補者 ${profile.id.slice(0, 8).toLocaleUpperCase('en-US')}`)),
    (query, maxResults) => retrieval.search(profiles, query, maxResults),
    {
      id: `${localEmbeddingModel.id}+${localRerankerModel.id}`,
      revision: `${localEmbeddingModel.revision}+${localRerankerModel.revision}`,
      algorithmVersion: 'hard-filter-hybrid-local-rerank-v1'
    }
  )
  assert.equal(qualityReport.status, 'passed', 'synthetic 30-case quality gate did not pass')
  assert.equal(qualityReport.algorithmVersion, 'hard-filter-hybrid-local-rerank-v1')
  assert.equal(qualityReport.hardFilterPolicyVersion, 'tri-state-v3')
  assert.equal(qualityReport.metrics.recallAt20, 1)
  assert.equal(qualityReport.metrics.projectEvidenceCoverageAt20, 1)
  assert.equal(JSON.stringify(qualityReport).includes(cases[0]!.query), false, 'quality report retained raw query text')
  console.info(JSON.stringify({
    engine: 'hard-filter-bm25-vector-rrf-local-rerank-v1',
    modelId: `${localEmbeddingModel.id}+${localRerankerModel.id}`,
    profiles: profiles.length,
    cases: cases.length,
    recallAt20: retrieved / cases.length,
    relevantRanks: ranks,
    elapsedMs,
    cacheEntries: cache.length,
    projectCacheEntries: projectCache.length,
    projectEvidenceHits,
    qualityGateStatus: qualityReport.status,
    qualityGateCases: qualityReport.metrics.caseCount,
    qualityGateNdcgAt20: qualityReport.metrics.ndcgAt20,
    hardFilterPolicyVersion: qualityReport.hardFilterPolicyVersion,
    networkAccess: false,
    kernelNetworkSandbox: process.platform === 'darwin',
    humanLabeledDataset: false
  }))
} finally {
  worker.dispose()
  rerankerWorker.dispose()
}
