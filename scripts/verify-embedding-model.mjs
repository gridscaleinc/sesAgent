import { createHash } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { readFile, stat } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { pipeline } from 'node:stream/promises'

const root = resolve(import.meta.dirname, '..')
const modelDirectory = join(root, 'models', 'Xenova', 'multilingual-e5-small')
const manifest = JSON.parse(await readFile(join(modelDirectory, 'model-manifest.json'), 'utf8'))

for (const file of manifest.files) {
  const path = join(modelDirectory, file.path)
  const metadata = await stat(path)
  const hash = createHash('sha256')
  await pipeline(createReadStream(path), hash)
  if (!metadata.isFile() || metadata.size !== file.bytes || hash.digest('hex') !== file.sha256) {
    throw new Error(`Embedding model integrity check failed: ${file.path}`)
  }
}

console.info(JSON.stringify({
  modelId: manifest.modelId,
  revision: manifest.revision,
  dimension: manifest.embeddingDimension,
  files: manifest.files.length,
  networkAccess: false,
  integrity: 'verified'
}))
