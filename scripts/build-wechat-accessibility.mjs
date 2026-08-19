import { chmod, mkdir } from 'node:fs/promises'
import { spawn } from 'node:child_process'
import { arch } from 'node:process'
import { resolve } from 'node:path'

if (process.platform !== 'darwin') {
  process.stdout.write('macOS WeChat Accessibility helper build skipped on non-macOS platform.\n')
  process.exit(0)
}

if (!['arm64', 'x64'].includes(arch)) {
  throw new Error(`Unsupported macOS architecture for WeChat Accessibility helper: ${arch}`)
}

const source = resolve('native/macos/wechat-accessibility/main.swift')
const outputDirectory = resolve('build/native/macos')
const output = resolve(outputDirectory, 'ses-wechat-accessibility')
const deploymentTarget = '13.0'
const swiftArchitecture = arch === 'x64' ? 'x86_64' : 'arm64'
await mkdir(outputDirectory, { recursive: true })

const child = spawn(
  'xcrun',
  [
    'swiftc',
    '-parse-as-library',
    '-O',
    '-target',
    `${swiftArchitecture}-apple-macos${deploymentTarget}`,
    '-framework',
    'AppKit',
    '-framework',
    'ApplicationServices',
    '-framework',
    'ScreenCaptureKit',
    '-framework',
    'Security',
    '-framework',
    'Vision',
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
await chmod(output, 0o755)
process.stdout.write(`${output}\n`)
