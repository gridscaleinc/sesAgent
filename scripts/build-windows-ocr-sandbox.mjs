import { execFile } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { promisify } from 'node:util'

if (process.platform !== 'win32') {
  process.stdout.write(`${JSON.stringify({ platform: process.platform, built: false, reason: 'windows-x64-build-required' })}\n`)
  process.exit(0)
}
if (process.arch !== 'x64') throw new Error('The Windows OCR sandbox launcher must be built on Windows x64.')

const run = promisify(execFile)
const outputDirectory = resolve('build/native/windows/ocr')
const output = resolve(outputDirectory, 'ses-ocr-sandbox.exe')
const source = resolve('native/windows/ocr-sandbox-launcher/main.cpp')
const buildRecordPath = resolve(outputDirectory, 'ses-ocr-sandbox.build.json')
await mkdir(outputDirectory, { recursive: true })

const sourceSha256 = createHash('sha256').update(await readFile(source)).digest('hex')
try {
  const [record, executable] = await Promise.all([
    readFile(buildRecordPath, 'utf8').then((value) => JSON.parse(value)),
    readFile(output)
  ])
  const executableSha256 = createHash('sha256').update(executable).digest('hex')
  if (
    record?.version === 'windows-sandbox-build-v1' &&
    record?.platform === 'win32' && record?.arch === 'x64' &&
    record?.sourceSha256 === sourceSha256 && record?.executableSha256 === executableSha256
  ) {
    process.stdout.write(`${JSON.stringify({
      platform: process.platform,
      arch: process.arch,
      built: true,
      reused: true,
      output,
      executableSha256
    })}\n`)
    process.exit(0)
  }
} catch {
  // Missing or stale build records require one authoritative Windows x64 rebuild.
}

await run('cl.exe', [
  '/nologo',
  '/std:c++20',
  '/O2',
  '/EHsc',
  '/DUNICODE',
  '/D_UNICODE',
  source,
  `/Fe:${output}`,
  '/link',
  'advapi32.lib',
  'userenv.lib'
], { windowsHide: true, maxBuffer: 4 * 1024 * 1024 })

const executableSha256 = createHash('sha256').update(await readFile(output)).digest('hex')
await writeFile(buildRecordPath, `${JSON.stringify({
  version: 'windows-sandbox-build-v1',
  platform: process.platform,
  arch: process.arch,
  sourceSha256,
  executableSha256
}, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 })
process.stdout.write(`${JSON.stringify({
  platform: process.platform,
  arch: process.arch,
  built: true,
  reused: false,
  output,
  executableSha256
})}\n`)
