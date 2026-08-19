import dgram from 'node:dgram'
import dns from 'node:dns'
import http from 'node:http'
import https from 'node:https'
import net from 'node:net'
import tls from 'node:tls'

const networkDisabled = (): never => {
  throw new Error('NETWORK_DISABLED_IN_LOCAL_PARSER')
}

function replaceFunction(target: object, key: string): void {
  Object.defineProperty(target, key, {
    configurable: true,
    enumerable: true,
    value: networkDisabled,
    writable: false
  })
}

export function installParserNetworkDenyGuard(): void {
  for (const key of ['connect', 'createConnection']) replaceFunction(net, key)
  replaceFunction(tls, 'connect')
  for (const key of ['request', 'get']) {
    replaceFunction(http, key)
    replaceFunction(https, key)
  }
  replaceFunction(dgram, 'createSocket')
  for (const key of ['lookup', 'resolve', 'resolve4', 'resolve6', 'resolveAny', 'reverse']) replaceFunction(dns, key)
  Object.defineProperty(globalThis, 'fetch', { configurable: true, value: networkDisabled, writable: false })
  if ('WebSocket' in globalThis) {
    Object.defineProperty(globalThis, 'WebSocket', { configurable: true, value: networkDisabled, writable: false })
  }
}
