const failures = []
if (process.platform !== 'win32') {
  failures.push('Windows packaging must run on Windows because the SQLCipher native module cannot be cross-compiled by node-gyp.')
}
if (process.arch !== 'x64') failures.push('The first Windows development and release packages target x64.')
process.stdout.write(`${JSON.stringify({ platform: process.platform, arch: process.arch, failures }, null, 2)}\n`)
if (failures.length > 0) process.exit(1)
