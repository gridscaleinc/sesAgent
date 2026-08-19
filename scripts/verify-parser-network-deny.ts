import net from 'node:net'
import { installParserNetworkDenyGuard } from '../apps/desktop/src/workers/network-deny'

installParserNetworkDenyGuard()

let socketBlocked = false
let fetchBlocked = false
try {
  net.connect({ host: '127.0.0.1', port: 9 })
} catch (error) {
  socketBlocked = error instanceof Error && error.message === 'NETWORK_DISABLED_IN_LOCAL_PARSER'
}
try {
  await fetch('https://example.com')
} catch (error) {
  fetchBlocked = error instanceof Error && error.message === 'NETWORK_DISABLED_IN_LOCAL_PARSER'
}

if (!socketBlocked || !fetchBlocked) throw new Error('The parser network deny guard did not block every probe.')
process.stdout.write(`${JSON.stringify({ socketBlocked, fetchBlocked })}\n`)
