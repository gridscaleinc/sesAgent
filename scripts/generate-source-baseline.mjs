import { createHash } from 'node:crypto'
import { chmod, mkdir, readFile, readdir, stat, writeFile } from 'node:fs/promises'
import { basename, dirname, relative, resolve, sep } from 'node:path'

const sourceRoot = resolve(import.meta.dirname, '..')
const outputPath = process.argv[2] ? resolve(process.argv[2]) : null

if (!outputPath || basename(outputPath) !== 'source-manifest.json') {
  throw new Error('Usage: node scripts/generate-source-baseline.mjs /absolute/path/source-manifest.json')
}

const excludedDirectories = new Set([
  '.git', '.playwright-cli', 'build', 'coverage', 'dist', 'local', 'node_modules', 'out', 'output', 'release'
])
const excludedExtensions = new Set(['.cer', '.crt', '.key', '.p12', '.pem', '.pfx'])

function isExcludedFile(path) {
  const relativePath = relative(sourceRoot, path)
  const name = basename(path)
  const extension = name.includes('.') ? name.slice(name.lastIndexOf('.')).toLowerCase() : ''
  if (name === '.DS_Store' || name === '.verified' || name.startsWith('.env')) return true
  if (excludedExtensions.has(extension)) return true
  if (/(^|[-_.])(credential|private[-_]?key|secret|token)([-_.]|$)/iu.test(name)) return true
  if (relativePath.startsWith(`models${sep}`) && name !== 'model-manifest.json') return true
  return false
}

async function collect(directory) {
  const entries = await readdir(directory, { withFileTypes: true })
  const files = []
  for (const entry of entries) {
    if (entry.isDirectory() && excludedDirectories.has(entry.name)) continue
    const path = resolve(directory, entry.name)
    if (entry.isDirectory()) files.push(...await collect(path))
    else if (entry.isFile() && !isExcludedFile(path)) files.push(path)
  }
  return files
}

const files = []
for (const path of (await collect(sourceRoot)).sort()) {
  const bytes = await readFile(path)
  files.push({
    path: relative(sourceRoot, path).split(sep).join('/'),
    bytes: bytes.length,
    sha256: createHash('sha256').update(bytes).digest('hex')
  })
}

const aggregate = createHash('sha256')
for (const file of files) aggregate.update(`${file.path}\0${file.bytes}\0${file.sha256}\n`)
const rootMetadata = await stat(sourceRoot)
const manifest = {
  version: 'ses-remediation-source-baseline-v1',
  createdAt: new Date().toISOString(),
  sourceRoot,
  sourceRootBirthtime: rootMetadata.birthtime.toISOString(),
  provenance: 'unknown',
  gitStatus: 'not-a-git-checkout',
  releaseEligible: false,
  purpose: 'Immutable source baseline after the local external-adoption implementation.',
  exclusions: [
    'Git metadata and generated dependency/build/test-output directories',
    'environment files, private keys, certificates, and credential/secret/token-named files',
    'local privacy-expert datasets and generated reports',
    'model binaries; only model-manifest.json files are included'
  ],
  fileCount: files.length,
  aggregateSha256: aggregate.digest('hex'),
  files
}

await mkdir(dirname(outputPath), { recursive: true, mode: 0o755 })
await writeFile(outputPath, `${JSON.stringify(manifest, null, 2)}\n`, { mode: 0o444, flag: 'wx' })
await chmod(outputPath, 0o444)
await chmod(dirname(outputPath), 0o555)
process.stdout.write(`${JSON.stringify({
  outputPath,
  fileCount: manifest.fileCount,
  aggregateSha256: manifest.aggregateSha256,
  releaseEligible: manifest.releaseEligible
})}\n`)
