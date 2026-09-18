import { build } from 'esbuild'
import { spawn } from 'node:child_process'
import { createRequire } from 'node:module'
const require=createRequire(import.meta.url)
const outfile='output/system-experience/verify-experience-live.js'
await build({entryPoints:[process.argv[2]??'scripts/verify-experience-live.ts'],bundle:true,platform:'node',format:'esm',packages:'external',outfile,banner:{js:'import { createRequire } from "node:module"; const require = createRequire(import.meta.url);'}})
const child=spawn(require('electron'),[outfile],{stdio:'inherit',env:process.env})
const timer=setTimeout(()=>child.kill('SIGTERM'),10*60_000)
child.on('error',error=>{clearTimeout(timer);console.error(error.message);process.exitCode=1})
child.on('exit',code=>{clearTimeout(timer);process.exitCode=code??1})
