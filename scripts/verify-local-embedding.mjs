import { resolve } from 'node:path'
import { env, pipeline } from '@huggingface/transformers'

const root = resolve(import.meta.dirname, '..')
env.allowLocalModels = true
env.allowRemoteModels = false
env.localModelPath = resolve(root, 'models')
env.useBrowserCache = false
env.useFSCache = false

const extractor = await pipeline('feature-extraction', 'Xenova/multilingual-e5-small', {
  dtype: 'q8',
  local_files_only: true
})
const startedAt = performance.now()
const output = await extractor([
  'query: AWS上のクラウド基盤を設計できるエンジニア',
  'passage: AWSとTerraformを利用したクラウド基盤の設計構築を担当',
  'passage: 経理事務と月次決算を担当'
], { pooling: 'mean', normalize: true })
const vectors = output.tolist()
const cosine = (left, right) => left.reduce((sum, value, index) => sum + value * right[index], 0)
const relevant = cosine(vectors[0], vectors[1])
const irrelevant = cosine(vectors[0], vectors[2])
await extractor.dispose()

if (output.dims[1] !== 384 || vectors.length !== 3 || relevant <= irrelevant) {
  throw new Error('Local multilingual embedding quality probe failed.')
}

console.info(JSON.stringify({
  model: 'Xenova/multilingual-e5-small',
  dimension: output.dims[1],
  relevantCosine: Math.round(relevant * 10000) / 10000,
  irrelevantCosine: Math.round(irrelevant * 10000) / 10000,
  inferenceMs: Math.round(performance.now() - startedAt),
  networkAccess: false
}))
