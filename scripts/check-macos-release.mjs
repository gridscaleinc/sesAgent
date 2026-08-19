import { execFile } from 'node:child_process'
import { access, readFile } from 'node:fs/promises'
import { constants } from 'node:fs'
import { resolve } from 'node:path'
import { promisify } from 'node:util'
import {
  computeCloudEnforcementSha256,
  computePrivacyImplementationSha256,
  privacyExpertReportFailures
} from './privacy-expert-evidence.mjs'

const run = promisify(execFile)
const failures = []
const report = {
  platform: process.platform,
  architecture: process.arch,
  signing: 'missing',
  notarization: 'missing',
  nativeHelper: 'missing',
  icon: 'missing',
  privacyQualityGate: 'missing',
  privacyExpertGate: 'not-verified',
  privacyExpertRequired: false
}

async function requireExecutable(path, label) {
  try {
    await access(path, constants.X_OK)
  } catch {
    failures.push(`${label} is missing or is not executable: ${path}`)
  }
}

if (process.platform !== 'darwin') failures.push('A signed macOS release must be built on macOS.')

for (const tool of ['codesign', 'security']) {
  try {
    await run('/usr/bin/xcrun', ['--find', tool])
  } catch {
    failures.push(`Xcode command-line tool is unavailable: ${tool}`)
  }
}
try {
  await run('/usr/bin/xcrun', ['--find', 'notarytool'])
} catch {
  failures.push('Apple notarytool is unavailable. Install or select a current Xcode toolchain.')
}

const nativeHelpers = [
  [resolve('build/native/macos/ses-vision-ocr'), 'Apple Vision/NaturalLanguage helper'],
  [resolve('build/native/macos/ses-wechat-accessibility'), 'macOS WeChat visible-read helper']
]
for (const [helperPath, label] of nativeHelpers) {
  await requireExecutable(helperPath, label)
  try {
    const { stdout } = await run('/usr/bin/file', [helperPath])
    if (!stdout.includes('Mach-O 64-bit executable arm64')) failures.push(`${label} is not an arm64 Mach-O executable.`)
    else report[label === 'Apple Vision/NaturalLanguage helper' ? 'nativeHelper' : 'wechatHelper'] = 'arm64-ready'
  } catch {
    failures.push(`${label} architecture could not be inspected.`)
  }
  try {
    const { stdout } = await run('/usr/bin/otool', ['-l', helperPath])
    const minimumVersion = stdout.match(/\bminos\s+(\d+(?:\.\d+){1,2})/u)?.[1]
    if (minimumVersion !== '13.0') failures.push(`${label} deployment target is ${minimumVersion ?? 'unknown'}, expected 13.0.`)
  } catch {
    failures.push(`${label} deployment target could not be inspected.`)
  }
}

const iconPath = resolve('build/release/icon.icns')
try {
  const icon = await readFile(iconPath)
  if (icon.length < 1024 || icon.subarray(0, 4).toString('ascii') !== 'icns') failures.push('The generated app icon is not a valid ICNS file.')
  else report.icon = 'ready'
} catch {
  failures.push(`The generated app icon is missing: ${iconPath}`)
}

try {
  const privacy = JSON.parse(await readFile(resolve('build/privacy-verification/privacy-quality-report.json'), 'utf8'))
  if (
    privacy?.version !== 'ses-privacy-quality-report-v1' || privacy?.releaseEligible !== true ||
    privacy?.syntheticOnly !== true || privacy?.humanLabeledDataset !== false ||
    privacy?.platform !== 'darwin' || privacy?.arch !== 'arm64' ||
    privacy?.identifierRecall !== 1 || privacy?.redactionPrecision !== 1 ||
    privacy?.residualLeakCount !== 0 || privacy?.safeCaseFalsePositiveCount !== 0 ||
    privacy?.cloudDirectIdentifiers !== 0 || privacy?.networkAccess !== false ||
    privacy?.appleNer?.verified !== true
  ) throw new Error('privacy quality report is incomplete')
  report.privacyQualityGate = privacy.datasetSha256
} catch {
  failures.push('The macOS privacy quality gate is missing, failed, or stale. Run npm run test:privacy-quality-gate.')
}

try {
  const [privacyImplementationSha256, cloudEnforcementSha256] = await Promise.all([
    computePrivacyImplementationSha256(),
    computeCloudEnforcementSha256()
  ])
  const privacyExpert = JSON.parse(await readFile(resolve('build/privacy-verification/privacy-expert-report.json'), 'utf8'))
  const expertFailures = privacyExpertReportFailures(privacyExpert, {
    platform: 'darwin',
    arch: 'arm64',
    privacyImplementationSha256,
    cloudEnforcementSha256
  })
  if (expertFailures.length > 0) throw new Error(expertFailures.join(','))
  report.privacyExpertGate = privacyExpert.datasetSha256
} catch {
  report.privacyExpertGate = 'not-verified'
}

if (process.env.CSC_LINK?.trim()) {
  report.signing = 'CSC_LINK'
} else if (process.env.CSC_NAME?.trim()) {
  report.signing = 'CSC_NAME'
} else {
  try {
    const { stdout } = await run('/usr/bin/security', ['find-identity', '-v', '-p', 'codesigning'])
    if (/Developer ID Application:/u.test(stdout)) report.signing = 'keychain-developer-id'
    else failures.push('No Developer ID Application identity was found. Set CSC_LINK/CSC_NAME or import the certificate.')
  } catch {
    failures.push('The signing identity could not be inspected.')
  }
}

const apiKeyVariables = ['APPLE_API_KEY', 'APPLE_API_KEY_ID', 'APPLE_API_ISSUER']
const appleIdVariables = ['APPLE_ID', 'APPLE_APP_SPECIFIC_PASSWORD', 'APPLE_TEAM_ID']
const completeSet = (names) => names.every((name) => Boolean(process.env[name]?.trim()))
if (completeSet(apiKeyVariables)) report.notarization = 'app-store-connect-api-key'
else if (completeSet(appleIdVariables)) report.notarization = 'apple-id-app-password'
else if (process.env.APPLE_KEYCHAIN_PROFILE?.trim()) report.notarization = 'keychain-profile'
else {
  failures.push(
    `Notarization credentials are incomplete. Provide ${apiKeyVariables.join(', ')}, ${appleIdVariables.join(', ')}, or APPLE_KEYCHAIN_PROFILE.`
  )
}

process.stdout.write(`${JSON.stringify(report, null, 2)}\n`)
if (failures.length > 0) {
  for (const failure of failures) process.stderr.write(`[release-check] ${failure}\n`)
  process.exit(1)
}
