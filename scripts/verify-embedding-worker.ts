import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { resolve } from 'node:path'
import {
  isLocalEmbeddingWorkerResponse,
  LocalEmbeddingWorkerClient,
  localEmbeddingModel,
  type LocalEmbeddingWorkerResponse
} from '@local-ai'

const root = resolve(import.meta.dirname, '..')
const client = new LocalEmbeddingWorkerClient({
  workerPath: resolve(process.argv[2] ?? resolve(root, 'out', 'main', 'embedding-worker.js')),
  modelDirectory: resolve(process.argv[3] ?? resolve(root, 'models', 'Xenova', 'multilingual-e5-small'))
})

async function verifyStdioProtocol(): Promise<LocalEmbeddingWorkerResponse> {
  return await new Promise((resolvePromise, reject) => {
    const child = spawn(process.execPath, [resolve(root, 'out', 'main', 'embedding-worker.js'), '--stdio'], {
      env: {
        ELECTRON_RUN_AS_NODE: '1',
        NODE_ENV: 'production',
        LANG: 'ja_JP.UTF-8',
        TZ: 'Asia/Tokyo'
      },
      stdio: ['pipe', 'pipe', 'pipe']
    })
    const output: Buffer[] = []
    const errors: Buffer[] = []
    const timeout = setTimeout(() => {
      child.kill('SIGKILL')
      reject(new Error('Embedding stdio verification timed out.'))
    }, 120_000)
    child.stdout.on('data', (chunk: Buffer) => {
      output.push(chunk)
      const line = Buffer.concat(output).toString('utf8').split('\n').find((item) => item.trim())
      if (!line) return
      let response: unknown
      try {
        response = JSON.parse(line)
      } catch {
        return
      }
      if (!isLocalEmbeddingWorkerResponse(response)) {
        clearTimeout(timeout)
        child.kill('SIGKILL')
        reject(new Error('Embedding stdio worker returned an invalid response.'))
        return
      }
      clearTimeout(timeout)
      child.kill('SIGTERM')
      resolvePromise(response)
    })
    child.stderr.on('data', (chunk: Buffer) => errors.push(chunk))
    child.once('error', reject)
    child.once('close', (code, signal) => {
      if (code !== 0 && signal !== 'SIGTERM') {
        clearTimeout(timeout)
        reject(new Error(`Embedding stdio worker failed (${code ?? signal}): ${Buffer.concat(errors).toString('utf8')}`))
      }
    })
    child.stdin.write(`${JSON.stringify({
      id: randomUUID(),
      kind: 'embed',
      role: 'query',
      texts: ['ローカルで候補者を検索する'],
      modelDirectory: resolve(root, 'models', 'Xenova', 'multilingual-e5-small')
    })}\n`)
  })
}

try {
  const query = (await client.embedQueries(['AWS環境の設計と構築を担当できる人材']))[0]
  const passages = await client.embedPassages([
    'AWS、Terraform、Kubernetesを使ったクラウド基盤の設計構築',
    '経理事務、請求書処理、月次決算'
  ])
  assert.equal(query?.length, localEmbeddingModel.dimension)
  assert.equal(passages.length, 2)
  const cosine = (left: number[], right: number[]): number =>
    left.reduce((sum, value, index) => sum + value * (right[index] ?? 0), 0)
  const relevant = cosine(query!, passages[0]!)
  const irrelevant = cosine(query!, passages[1]!)
  assert.ok(relevant > irrelevant, 'isolated worker did not rank the relevant Japanese passage first')
  const stdioResponse = await verifyStdioProtocol()
  assert.equal(stdioResponse.ok, true)
  if (!stdioResponse.ok) throw new Error(stdioResponse.message)
  assert.equal(stdioResponse.vectors[0]?.length, localEmbeddingModel.dimension)
  console.info(JSON.stringify({
    modelId: localEmbeddingModel.id,
    dimension: localEmbeddingModel.dimension,
    relevantCosine: Math.round(relevant * 10_000) / 10_000,
    irrelevantCosine: Math.round(irrelevant * 10_000) / 10_000,
    processIsolation: true,
    kernelNetworkSandbox: process.platform === 'darwin',
    stdioProtocolVerified: true
  }))
} finally {
  client.dispose()
}
