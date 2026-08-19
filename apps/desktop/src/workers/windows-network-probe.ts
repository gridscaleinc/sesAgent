import net from 'node:net'

const port = Number(process.env.SES_NETWORK_PROBE_PORT)
if (!Number.isInteger(port) || port < 1 || port > 65_535) {
  process.stdout.write(`${JSON.stringify({ errorCode: 'INVALID_PROBE_PORT' })}\n`)
  process.exit(64)
}

const result = await new Promise<{ loopbackDenied: boolean; errorCode: string | null }>((resolve) => {
  const socket = net.connect({ host: '127.0.0.1', port })
  const timeout = setTimeout(() => {
    socket.destroy()
    resolve({ loopbackDenied: true, errorCode: 'TIMEOUT' })
  }, 3_000)
  socket.once('connect', () => {
    clearTimeout(timeout)
    socket.destroy()
    resolve({ loopbackDenied: false, errorCode: null })
  })
  socket.once('error', (error: NodeJS.ErrnoException) => {
    clearTimeout(timeout)
    resolve({ loopbackDenied: true, errorCode: error.code ?? 'NETWORK_DENIED' })
  })
})

process.stdout.write(`${JSON.stringify({
  version: 'windows-appcontainer-network-probe-v1',
  ...result
})}\n`)
if (!result.loopbackDenied) process.exitCode = 2
