import assert from 'node:assert/strict'
import { resolve } from 'node:path'
import { LocalRerankerWorkerClient, localRerankerModel } from '@local-ai'

const root = resolve(import.meta.dirname, '..')
const client = new LocalRerankerWorkerClient({
  workerPath: resolve(root, 'out/main/reranker-worker.js'),
  modelDirectory: resolve(root, 'models/hotchpotch/japanese-reranker-tiny-v2'),
  timeoutMs: 60_000
})

try {
  const scores = await client.rerank('AWS と Terraform によるクラウド基盤設計', [
    { id: 'relevant', text: 'AWS、Terraform、Kubernetesを使ったクラウド基盤の設計構築を7年間担当' },
    { id: 'irrelevant', text: '経理事務、請求書処理、月次決算と総務を担当' }
  ])
  const relevant = scores.get('relevant')
  const irrelevant = scores.get('irrelevant')
  assert.equal(typeof relevant, 'number')
  assert.equal(typeof irrelevant, 'number')
  assert.ok(relevant! > irrelevant!, 'local Japanese reranker did not rank the relevant passage first')
  process.stdout.write(`${JSON.stringify({
    modelId: localRerankerModel.id,
    revision: localRerankerModel.revision,
    relevantScore: Math.round(relevant! * 10_000) / 10_000,
    irrelevantScore: Math.round(irrelevant! * 10_000) / 10_000,
    candidateCount: scores.size,
    networkAccess: false,
    processIsolation: true,
    kernelNetworkSandbox: process.platform === 'darwin'
  })}\n`)
} finally {
  client.dispose()
}
