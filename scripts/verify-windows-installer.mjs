import { execFile, spawn } from 'node:child_process'
import { access, mkdtemp, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, dirname, join, resolve } from 'node:path'
import { promisify } from 'node:util'

if (process.platform !== 'win32' || process.arch !== 'x64') {
  throw new Error('The Windows installer verifier must run on Windows x64.')
}
if (process.env.CI !== 'true' && process.env.SES_ALLOW_WINDOWS_INSTALLER_TEST !== '1') {
  throw new Error('Run the NSIS lifecycle verifier on disposable CI, or explicitly set SES_ALLOW_WINDOWS_INSTALLER_TEST=1.')
}

const run = promisify(execFile)
const args = process.argv.slice(2)
const requireSignature = args.includes('--require-signature')
const developmentInstaller = args.includes('--development')
const positional = args.filter((value) => !['--require-signature', '--development'].includes(value))
const packageMetadata = JSON.parse(await readFile(resolve('package.json'), 'utf8'))
if (typeof packageMetadata.version !== 'string' || !/^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/u.test(packageMetadata.version)) {
  throw new Error('package.json does not contain a valid release version.')
}
const installerPath = resolve(
  positional[0] ?? `release/${developmentInstaller ? 'windows-dev' : 'windows'}/SES-Agent-Desktop-${packageMetadata.version}-x64.exe`
)
const previousInstallerPath = process.env.SES_WINDOWS_PREVIOUS_INSTALLER?.trim()
  ? resolve(process.env.SES_WINDOWS_PREVIOUS_INSTALLER.trim())
  : null
const sandbox = await mkdtemp(join(tmpdir(), 'ses-agent-windows-installer-'))
const installDirectory = join(sandbox, 'application')
const appDataDirectory = join(sandbox, 'appdata')
const localAppDataDirectory = join(sandbox, 'localappdata')
const userProfileDirectory = join(sandbox, 'profile')
const executablePath = join(installDirectory, 'SES Agent Desktop.exe')

async function verifySignature(path) {
  const command = [
    '& { param([string]$Path)',
    '$signature = Get-AuthenticodeSignature -LiteralPath $Path;',
    '$result = [ordered]@{ Status = [string]$signature.Status; Subject = [string]$signature.SignerCertificate.Subject };',
    '$result | ConvertTo-Json -Compress;',
    'if ($signature.Status -ne [System.Management.Automation.SignatureStatus]::Valid) { exit 41 }',
    '}'
  ].join(' ')
  try {
    const { stdout } = await run('powershell.exe', [
      '-NoLogo',
      '-NoProfile',
      '-NonInteractive',
      '-ExecutionPolicy', 'Bypass',
      '-Command', command,
      path
    ], { windowsHide: true, timeout: 30_000, maxBuffer: 1024 * 1024 })
    return JSON.parse(stdout.trim())
  } catch (error) {
    if (requireSignature) throw new Error(`Windows installer signature is not valid: ${basename(path)}`, { cause: error })
    return { Status: 'NotRequiredForDevelopment', Subject: null }
  }
}

async function install(path) {
  await access(path)
  await run(path, ['/S', `/D=${installDirectory}`], {
    windowsHide: true,
    timeout: 180_000,
    maxBuffer: 4 * 1024 * 1024
  })
  await access(executablePath)
}

function launchInstalledApplication(expectedSchemaVersion = 27) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(executablePath, [], {
      cwd: installDirectory,
      env: {
        ...process.env,
        APPDATA: appDataDirectory,
        LOCALAPPDATA: localAppDataDirectory,
        USERPROFILE: userProfileDirectory,
        SES_RELEASE_SMOKE: '1'
      },
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true
    })
    const stdout = []
    const stderr = []
    const timeout = setTimeout(() => {
      child.kill('SIGKILL')
      reject(new Error('Installed Windows application smoke timed out.'))
    }, 60_000)
    child.stdout.on('data', (chunk) => stdout.push(chunk))
    child.stderr.on('data', (chunk) => stderr.push(chunk))
    child.once('error', reject)
    child.once('exit', (code) => {
      clearTimeout(timeout)
      const output = Buffer.concat(stdout).toString('utf8')
      const errors = Buffer.concat(stderr).toString('utf8')
      if (
        code !== 0 ||
        !output.includes('[storage-ready]') ||
        !output.includes('[renderer-ready]') ||
        !output.includes("keyProtection: 'windows-dpapi'") ||
        !(expectedSchemaVersion === null
          ? /schemaVersion:\s*\d+\b/u.test(output)
          : new RegExp(`schemaVersion:\\s*${expectedSchemaVersion}\\b`, 'u').test(output))
      ) {
        reject(new Error(`Installed Windows application failed its startup contract (${code}).\n${output}\n${errors}`))
        return
      }
      resolvePromise({ output, errors })
    })
  })
}

async function walk(directory) {
  const paths = []
  let entries
  try {
    entries = await readdir(directory, { withFileTypes: true })
  } catch {
    return paths
  }
  for (const entry of entries) {
    const path = join(directory, entry.name)
    if (entry.isDirectory()) paths.push(...await walk(path))
    else if (entry.isFile()) paths.push(path)
  }
  return paths
}

async function findEncryptedDatabase() {
  const databases = (await walk(appDataDirectory)).filter((path) => path.endsWith('ses-agent.db'))
  if (databases.length !== 1) throw new Error(`Expected one installed application database, found ${databases.length}.`)
  const database = await readFile(databases[0])
  if (database.subarray(0, 16).toString('utf8') === 'SQLite format 3\u0000') {
    throw new Error('Installed Windows application database is not encrypted.')
  }
  return databases[0]
}

async function findUninstaller() {
  const files = await readdir(installDirectory)
  const name = files.find((value) => /^Uninstall.*\.exe$/iu.test(value))
  if (!name) throw new Error('The NSIS uninstaller was not installed.')
  return join(installDirectory, name)
}

async function verifyMemberCallbackProtocol(expectedPresent) {
  const registryPaths = [
    'HKCU\\Software\\Classes\\com.gridscale.native.ses-agent\\shell\\open\\command',
    'HKLM\\Software\\Classes\\com.gridscale.native.ses-agent\\shell\\open\\command'
  ]
  const registrations = []
  for (const registryPath of registryPaths) {
    try {
      const { stdout } = await run('reg.exe', ['query', registryPath, '/ve'], {
        windowsHide: true,
        timeout: 15_000,
        maxBuffer: 1024 * 1024
      })
      registrations.push(stdout)
    } catch {
      // The installer may use either the current-user or local-machine registry hive.
    }
  }
  if (!expectedPresent) {
    if (registrations.length > 0) throw new Error('Member Center callback protocol remains registered after uninstall.')
    return
  }
  const command = registrations.join('\n').toLocaleLowerCase('en-US')
  if (!command.includes(executablePath.toLocaleLowerCase('en-US')) || !command.includes('%1')) {
    throw new Error('Installed application did not register the SES Member Center callback protocol.')
  }
}

async function waitForMissing(path) {
  for (let attempt = 0; attempt < 120; attempt += 1) {
    try {
      await access(path)
    } catch {
      return
    }
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 250))
  }
  throw new Error(`Timed out waiting for removal: ${path}`)
}

let uninstallerPath = null
try {
  const signature = await verifySignature(installerPath)
  let databaseBeforeUpgrade = null
  let sentinelPath = null
  if (previousInstallerPath) {
    await verifySignature(previousInstallerPath)
    await install(previousInstallerPath)
    await launchInstalledApplication(null)
    databaseBeforeUpgrade = await findEncryptedDatabase()
    sentinelPath = join(dirname(dirname(databaseBeforeUpgrade)), 'installer-preservation-sentinel.txt')
    await writeFile(sentinelPath, 'preserve-on-upgrade-and-uninstall\n', { encoding: 'utf8', mode: 0o600 })
  }
  await install(installerPath)
  await verifyMemberCallbackProtocol(true)
  await launchInstalledApplication()
  const databasePath = await findEncryptedDatabase()
  sentinelPath ??= join(dirname(dirname(databasePath)), 'installer-preservation-sentinel.txt')
  if (previousInstallerPath) {
    if (databasePath !== databaseBeforeUpgrade || await readFile(sentinelPath, 'utf8') !== 'preserve-on-upgrade-and-uninstall\n') {
      throw new Error('Encrypted business data was not preserved during NSIS upgrade.')
    }
  } else {
    await writeFile(sentinelPath, 'preserve-on-upgrade-and-uninstall\n', { encoding: 'utf8', mode: 0o600 })
  }
  uninstallerPath = await findUninstaller()
  await run(uninstallerPath, ['/S'], {
    windowsHide: true,
    timeout: 180_000,
    maxBuffer: 4 * 1024 * 1024
  })
  uninstallerPath = null
  await waitForMissing(executablePath)
  await verifyMemberCallbackProtocol(false)
  const databaseMetadata = await stat(databasePath)
  const sentinel = await readFile(sentinelPath, 'utf8')
  if (!databaseMetadata.isFile() || sentinel !== 'preserve-on-upgrade-and-uninstall\n') {
    throw new Error('Encrypted business data was not preserved after NSIS uninstall.')
  }
  process.stdout.write(`${JSON.stringify({
    installer: basename(installerPath),
    releaseChannel: developmentInstaller ? 'development-unsigned' : 'release',
    signatureStatus: signature.Status,
    signerSubject: signature.Subject || null,
    installedLaunchVerified: true,
    schemaVersion: 37,
    keyProtection: 'windows-dpapi',
    encryptedDatabase: true,
    memberCallbackProtocol: 'com.gridscale.native.ses-agent',
    upgradeVerified: previousInstallerPath !== null,
    uninstallVerified: true,
    businessDataPreservedAfterUninstall: true
  }, null, 2)}\n`)
} finally {
  if (uninstallerPath) {
    try {
      await run(uninstallerPath, ['/S'], { windowsHide: true, timeout: 180_000 })
    } catch {
      // Preserve the original verifier failure while making a best-effort cleanup.
    }
  }
  await rm(sandbox, { recursive: true, force: true })
}
