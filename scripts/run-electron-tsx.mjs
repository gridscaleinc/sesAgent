import { spawn } from 'node:child_process'
import electronPath from 'electron'
import { resolve } from 'node:path'

const script = process.argv[2]
if (!script) throw new Error('Usage: node scripts/run-electron-tsx.mjs <script.ts> [...args]')

const child = spawn(
  electronPath,
  [resolve('node_modules/tsx/dist/cli.mjs'), resolve(script), ...process.argv.slice(3)],
  {
    env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
    stdio: 'inherit',
    windowsHide: true
  }
)
const exitCode = await new Promise((resolveExit, reject) => {
  child.once('error', reject)
  child.once('exit', (code) => resolveExit(code ?? 1))
})
process.exitCode = exitCode
