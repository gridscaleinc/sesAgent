import { downloadArtifact } from '@electron/get'
import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync, rmSync } from 'node:fs'
import { resolve } from 'node:path'

// The Intel package's privacy quality gate must run on the x64 Electron it ships, under Rosetta.
const { version } = JSON.parse(readFileSync(resolve('node_modules/electron/package.json'), 'utf8'))
const directory = resolve('build/electron-x64', version)
const executable = resolve(directory, 'Electron.app/Contents/MacOS/Electron')
if (!existsSync(executable)) {
  const zip = await downloadArtifact({ version, platform: 'darwin', arch: 'x64', artifactName: 'electron' })
  rmSync(directory, { recursive: true, force: true })
  const result = spawnSync('ditto', ['-x', '-k', zip, directory], { stdio: 'inherit' })
  if (result.status !== 0) process.exit(result.status ?? 1)
}
process.stdout.write(`${executable}\n`)
