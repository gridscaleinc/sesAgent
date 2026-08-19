import { spawn } from 'node:child_process'
import { readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import electronPath from 'electron'

const outputPath = join(tmpdir(), `ses-proposal-pdf-verify-${process.pid}.json`)
await rm(outputPath, { force: true })
const child = spawn(electronPath, [resolve('scripts/proposal-pdf-verifier')], {
  env: { ...process.env, SES_PROPOSAL_PDF_VERIFY_OUTPUT: outputPath },
  stdio: 'inherit'
})
let timedOut = false
const timeout = setTimeout(() => {
  timedOut = true
  child.kill('SIGTERM')
}, 30_000)
const exitCode = await new Promise((resolveExit, reject) => {
  child.once('error', reject)
  child.once('exit', (code) => resolveExit(code ?? 1))
})
clearTimeout(timeout)
if (timedOut) throw new Error('Proposal PDF verification timed out after 30 seconds.')
if (exitCode !== 0) process.exit(exitCode)
try {
  const result = await readFile(outputPath, 'utf8')
  if (!result.trim()) throw new Error('Proposal PDF verification did not produce evidence.')
  process.stdout.write(result)
} finally {
  await rm(outputPath, { force: true })
}
