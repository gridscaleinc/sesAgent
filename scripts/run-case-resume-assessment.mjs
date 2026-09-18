import { build } from 'esbuild'
import { spawn } from 'node:child_process'
import { mkdir, writeFile } from 'node:fs/promises'

const output = 'output/case-resume-ui'
await mkdir(output, { recursive: true })
await build({ entryPoints: ['scripts/fixtures/case-resume-panel.tsx'], bundle: true, platform: 'browser', format: 'esm', outfile: `${output}/fixture.js` })
await build({ entryPoints: ['apps/desktop/src/preload/index.ts'], bundle: true, platform: 'node', format: 'cjs', packages: 'external', external: ['electron'], outfile: `${output}/preload.cjs` })
await writeFile(`${output}/index.html`, '<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><link rel="stylesheet" href="/fixture.css"></head><body><div id="root"></div><script type="module" src="/fixture.js"></script></body></html>')
const child = spawn(process.execPath, ['scripts/run-experience-live.mjs', 'scripts/verify-case-resume-assessment.ts'], { stdio: 'inherit', env: { ...process.env, SES_CASE_RESUME_UI: '1' } })
child.on('error', error => { console.error(error.message); process.exitCode = 1 })
child.on('exit', code => { process.exitCode = code ?? 1 })
