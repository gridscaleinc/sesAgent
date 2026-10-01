import { mkdir } from 'node:fs/promises'
import { spawn } from 'node:child_process'
import { resolve } from 'node:path'

if (process.platform !== 'darwin') {
  process.stdout.write('Apple Vision OCR build skipped on non-macOS platform.\n')
  process.exit(0)
}

const source = resolve('native/macos/vision-ocr/main.swift')
const outputDirectory = resolve('build/native/macos')
const output = resolve(outputDirectory, 'ses-vision-ocr')
const deploymentTarget = '13.0'
const swiftArchitecture = (process.env.SES_MAC_ARCH ?? process.arch) === 'x64' ? 'x86_64' : 'arm64'
await mkdir(outputDirectory, { recursive: true })

const child = spawn(
  'xcrun',
  [
    'swiftc',
    '-O',
    '-target',
    `${swiftArchitecture}-apple-macos${deploymentTarget}`,
    '-framework',
    'Vision',
    '-framework',
    'NaturalLanguage',
    '-framework',
    'PDFKit',
    '-framework',
    'AppKit',
    source,
    '-o',
    output
  ],
  { stdio: 'inherit' }
)
const exitCode = await new Promise((resolveExit, reject) => {
  child.once('error', reject)
  child.once('exit', (code) => resolveExit(code ?? 1))
})
if (exitCode !== 0) process.exit(exitCode)
process.stdout.write(`${output}\n`)
