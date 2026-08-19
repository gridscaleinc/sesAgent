import { execFile } from 'node:child_process'
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { promisify } from 'node:util'

const run = promisify(execFile)
const args = process.argv.slice(2)
const releasePackage = args.includes('--release')
const requireSignature = args.includes('--require-signature')
const positional = args.filter((value) => !['--release', '--require-signature'].includes(value))
const packageMetadata = JSON.parse(await readFile(resolve('package.json'), 'utf8'))
const dmgPath = resolve(positional[0] ?? (releasePackage
  ? `release/SES-Agent-Desktop-${packageMetadata.version}-arm64.dmg`
  : `release/dev/SES-Agent-Desktop-${packageMetadata.version}-arm64.dmg`))
const mountPath = await mkdtemp(join(tmpdir(), 'ses-agent-dmg-'))
const installationPath = await mkdtemp(join(tmpdir(), 'ses-agent-dmg-install-'))
let attached = false

async function detachWithRetry() {
  for (let attempt = 0; attempt < 4; attempt += 1) {
    try {
      await run('/usr/bin/hdiutil', ['detach', mountPath])
      return
    } catch (error) {
      if (attempt === 3) {
        await run('/usr/bin/hdiutil', ['detach', '-force', mountPath])
        return
      }
      await new Promise((resolveDelay) => setTimeout(resolveDelay, 750))
    }
  }
}

try {
  await run('/usr/bin/hdiutil', ['attach', dmgPath, '-nobrowse', '-readonly', '-mountpoint', mountPath])
  attached = true
  const appName = (await readdir(mountPath)).find((name) => name.endsWith('.app'))
  if (!appName) throw new Error('DMG does not contain a macOS application bundle.')
  const installedAppPath = join(installationPath, appName)
  await run('/usr/bin/ditto', [join(mountPath, appName), installedAppPath])
  await detachWithRetry()
  attached = false
  if (requireSignature) {
    await run('/usr/bin/codesign', ['--verify', '--deep', '--strict', '--verbose=2', installedAppPath])
    await run('/usr/sbin/spctl', ['--assess', '--type', 'execute', '--verbose=2', installedAppPath])
  }
  const packageVerificationArgs = [resolve('scripts/verify-macos-package.mjs'), installedAppPath]
  const { stdout, stderr } = await run(process.execPath, packageVerificationArgs, {
    maxBuffer: 4 * 1024 * 1024
  })
  if (stderr.trim()) process.stderr.write(stderr)
  process.stdout.write(`${JSON.stringify({
    dmgPath,
    mountedApp: appName,
    codeSignatureVerified: requireSignature,
    packageVerification: JSON.parse(stdout)
  }, null, 2)}\n`)
} finally {
  if (attached) await detachWithRetry()
  await rm(mountPath, { recursive: true, force: true })
  await rm(installationPath, { recursive: true, force: true })
}
