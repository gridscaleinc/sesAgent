import { createRequire } from 'node:module'
import { installParserNetworkDenyGuard } from './network-deny'

installParserNetworkDenyGuard()

const require = createRequire(import.meta.url)
require('tesseract.js/src/worker-script/node/index.js')
