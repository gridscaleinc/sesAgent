import { createHash } from 'node:crypto'
import { createReadStream, createWriteStream } from 'node:fs'
import { chmod, mkdir, open, readFile, rename, rm, stat } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { pipeline } from 'node:stream/promises'

const root = resolve(import.meta.dirname, '..')
const modelDirectory = join(root, 'models', 'hotchpotch', 'japanese-reranker-tiny-v2')
const manifest = JSON.parse(await readFile(join(modelDirectory, 'model-manifest.json'), 'utf8'))

function sourceUrl(relativePath) {
  const encodedPath = relativePath.split('/').map(encodeURIComponent).join('/')
  return `https://huggingface.co/${manifest.modelId}/resolve/${manifest.revision}/${encodedPath}?download=true`
}

async function fileDigest(path) {
  const hash = createHash('sha256')
  await pipeline(createReadStream(path), hash)
  return hash.digest('hex')
}

async function isVerified(path, file) {
  try {
    const metadata = await stat(path)
    return metadata.isFile() && metadata.size === file.bytes && await fileDigest(path) === file.sha256
  } catch {
    return false
  }
}

for (const file of manifest.files) {
  const destination = join(modelDirectory, file.path)
  if (await isVerified(destination, file)) {
    console.info(`[reranker-model] verified ${file.path}`)
    continue
  }
  await mkdir(dirname(destination), { recursive: true, mode: 0o755 })
  const temporary = `${destination}.part`
  await rm(temporary, { force: true })
  console.info(`[reranker-model] downloading ${file.path}`)
  const response = await fetch(sourceUrl(file.path), { redirect: 'follow' })
  if (!response.ok || !response.body) throw new Error(`Download failed for ${file.path}: HTTP ${response.status}`)
  await pipeline(response.body, createWriteStream(temporary, { flags: 'wx', mode: 0o600 }))
  if (!await isVerified(temporary, file)) {
    const metadata = await stat(temporary)
    const digest = await fileDigest(temporary)
    await rm(temporary, { force: true })
    throw new Error(
      `Integrity verification failed for ${file.path}: expected ${file.bytes}/${file.sha256}, received ${metadata.size}/${digest}.`
    )
  }
  await rename(temporary, destination)
  await chmod(destination, 0o444)
}

const lockPath = join(modelDirectory, '.verified')
const lock = await open(lockPath, 'w', 0o444)
await lock.writeFile(`${manifest.modelId}\n${manifest.revision}\n`)
await lock.close()
await chmod(lockPath, 0o444)
console.info(`[reranker-model] ready ${manifest.modelId}@${manifest.revision}`)
