import assert from 'node:assert/strict'
import { resolve } from 'node:path'
import { collectLocalPersonNameCandidates, LocalNerWorkerClient, localNerModel } from '@local-ai'
import { redactTextForCloud } from '@privacy'

// Synthetic fixtures only. An optional built worker path may be passed.
const root = resolve(import.meta.dirname, '..')
const client = new LocalNerWorkerClient({
  workerPath: resolve(process.argv[2] ?? resolve(root, 'out/main/ner-worker.js')),
  modelDirectory: resolve(root, 'models/knowledgator/gliner-x-small'),
  timeoutMs: 120_000,
  idleUnloadMs: 0
})

const samples = [
  { text: '先日ご紹介した佐々木健一は、来月から保守に参画可能です。', names: ['佐々木健一'] },
  { text: '候选人王小明，5年Java开发经验，目前在上海。', names: ['王小明'] },
  { text: 'Candidate: Priya Raman joined the call with David Chen.', names: ['Priya Raman', 'David Chen'] },
  { text: '技術者：グエン・ヴァン・ナム（ベトナム国籍）\n日本語N1', names: ['グエン・ヴァン・ナム'] }
]
const safe = 'Project: Tokyo Metro 運行管理 / Role: Backend Engineer / Stack: Go, gRPC, PostgreSQL'

try {
  const loadStarted = performance.now()
  const results = []
  for (const sample of samples) {
    const detection = await client.detectNames(sample.text)
    assert.equal(detection.networkAccess, false)
    assert.equal(detection.engine, 'gliner-x-small-onnx')
    for (const entity of detection.entities) assert.equal(sample.text.slice(entity.startUtf16, entity.endUtf16), entity.text)
    const candidates = collectLocalPersonNameCandidates(sample.text, detection)
    const redacted = redactTextForCloud(sample.text, {
      sourceVersion: 'ner-worker-verification',
      knownPersonNames: candidates,
      personNameReviewCompleted: true,
      now: new Date('2026-09-30T00:00:00.000Z')
    }).redactedContent
    for (const name of sample.names) assert.equal(redacted.includes(name), false, `local NER did not remove ${name}`)
    results.push(detection.entities.map((entity) => entity.text))
  }
  const firstCallMs = Math.round(performance.now() - loadStarted)
  const safeDetection = await client.detectNames(safe)
  assert.deepEqual(collectLocalPersonNameCandidates(safe, safeDetection), [], 'a job title became a person-name candidate')

  const document = Array.from({ length: 40 }, (_, index) => `${index + 1}. 担当案件の要件定義と基本設計を実施。山田 太郎と連携。`).join(
    '\n'
  )
  const warmStarted = performance.now()
  const long = await client.detectNames(document)
  const warmMs = Math.round(performance.now() - warmStarted)
  assert.ok(
    long.entities.some((entity) => entity.text.includes('山田')),
    'a name deep in a long document was missed'
  )
  for (const entity of long.entities) assert.equal(document.slice(entity.startUtf16, entity.endUtf16), entity.text)

  process.stdout.write(
    `${JSON.stringify({
      modelId: localNerModel.id,
      revision: localNerModel.revision,
      engine: localNerModel.engine,
      detected: results,
      firstCallsIncludingLoadMs: firstCallMs,
      warmMsForDocumentChars: { ms: warmMs, chars: document.length },
      networkAccess: false,
      processIsolation: true,
      kernelNetworkSandbox: process.platform === 'darwin'
    })}\n`
  )
} finally {
  client.dispose()
}
