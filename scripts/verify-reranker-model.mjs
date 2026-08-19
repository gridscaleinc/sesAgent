import { createHash } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { readFile, stat } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { pipeline } from 'node:stream/promises'

const root = resolve(import.meta.dirname, '..')
const modelDirectory = join(root, 'models', 'hotchpotch', 'japanese-reranker-tiny-v2')
const manifest = JSON.parse(await readFile(join(modelDirectory, 'model-manifest.json'), 'utf8'))

if (
  manifest.schemaVersion !== 'local-reranker-model-v1' ||
  manifest.modelId !== 'hotchpotch/japanese-reranker-tiny-v2' ||
  manifest.revision !== 'ba95175a4d53058816b971f31929f10c5cad8560' ||
  manifest.license !== 'MIT' ||
  manifest.maximumSequenceLength !== 512 || manifest.maximumCandidates !== 20
) throw new Error('Reranker model manifest contract is invalid.')

for (const file of manifest.files) {
  const path = join(modelDirectory, file.path)
  const metadata = await stat(path)
  const hash = createHash('sha256')
  await pipeline(createReadStream(path), hash)
  if (!metadata.isFile() || metadata.size !== file.bytes || hash.digest('hex') !== file.sha256) {
    throw new Error(`Reranker model integrity check failed: ${file.path}`)
  }
}

process.stdout.write(`${JSON.stringify({
  modelId: manifest.modelId,
  revision: manifest.revision,
  license: manifest.license,
  maximumSequenceLength: manifest.maximumSequenceLength,
  maximumCandidates: manifest.maximumCandidates,
  files: manifest.files.length,
  networkAccess: false,
  integrity: 'verified'
})}\n`)
