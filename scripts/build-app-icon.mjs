import { execFile } from 'node:child_process'
import { mkdir, rm } from 'node:fs/promises'
import { resolve } from 'node:path'
import { promisify } from 'node:util'

const run = promisify(execFile)

if (process.platform !== 'darwin') {
  process.stdout.write('macOS application icon build skipped on non-macOS platform.\n')
  process.exit(0)
}

const source = resolve('assets/sesai-app-icon.png')
const outputDirectory = resolve('build/release')
const iconset = resolve(outputDirectory, 'icon.iconset')
const output = resolve(outputDirectory, 'icon.icns')
const pngOutput = resolve(outputDirectory, 'icon.png')

await mkdir(outputDirectory, { recursive: true })
await rm(iconset, { recursive: true, force: true })
await mkdir(iconset, { recursive: true })

const variants = [
  ['icon_16x16.png', 16],
  ['icon_16x16@2x.png', 32],
  ['icon_32x32.png', 32],
  ['icon_32x32@2x.png', 64],
  ['icon_128x128.png', 128],
  ['icon_128x128@2x.png', 256],
  ['icon_256x256.png', 256],
  ['icon_256x256@2x.png', 512],
  ['icon_512x512.png', 512],
  ['icon_512x512@2x.png', 1024]
]

for (const [filename, size] of variants) {
  await run('/usr/bin/sips', ['-z', String(size), String(size), source, '--out', resolve(iconset, filename)])
}
await run('/usr/bin/sips', ['-z', '1024', '1024', source, '--out', pngOutput])
await run('/usr/bin/iconutil', ['-c', 'icns', iconset, '-o', output])
await rm(iconset, { recursive: true, force: true })

process.stdout.write(`${output}\n`)
