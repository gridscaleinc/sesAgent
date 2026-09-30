import { createHash } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { readFile, stat } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { pipeline } from 'node:stream/promises'

const root = resolve(import.meta.dirname, '..')
const modelDirectory = join(root, 'models', 'knowledgator', 'gliner-x-small')
const manifest = JSON.parse(await readFile(join(modelDirectory, 'model-manifest.json'), 'utf8'))

if (
  manifest.schemaVersion !== 'local-ner-model-v1' ||
  manifest.modelId !== 'knowledgator/gliner-x-small' ||
  manifest.revision !== 'd51a0984d11084a55f9df3899d9dbf7704f580f5' ||
  manifest.license !== 'Apache-2.0' ||
  manifest.personLabel !== 'person' ||
  manifest.threshold !== 0.5 ||
  manifest.maximumSpanWidth !== 12
)
  throw new Error('NER model manifest contract is invalid.')

for (const file of manifest.files) {
  const path = join(modelDirectory, file.path)
  const metadata = await stat(path)
  const hash = createHash('sha256')
  await pipeline(createReadStream(path), hash)
  if (!metadata.isFile() || metadata.size !== file.bytes || hash.digest('hex') !== file.sha256) {
    throw new Error(`NER model integrity check failed: ${file.path}`)
  }
}

process.stdout.write(
  `${JSON.stringify({
    modelId: manifest.modelId,
    revision: manifest.revision,
    license: manifest.license,
    threshold: manifest.threshold,
    files: manifest.files.length,
    bytes: manifest.files.reduce((total, file) => total + file.bytes, 0),
    networkAccess: false,
    integrity: 'verified'
  })}\n`
)
