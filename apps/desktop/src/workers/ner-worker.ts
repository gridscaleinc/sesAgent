import { isLocalNerWorkerRequest, localNerModel, type LocalNerWorkerRequest, type LocalNerWorkerResponse } from '@local-ai'
import { detectGlinerPersonEntities } from './ner-engine'
import { installParserNetworkDenyGuard } from './network-deny'
import { exitModelWorker } from './native-exit'

installParserNetworkDenyGuard()

async function detectNames(request: LocalNerWorkerRequest): Promise<LocalNerWorkerResponse> {
  return {
    id: request.id,
    kind: 'detect-names',
    ok: true,
    modelId: localNerModel.id,
    modelRevision: localNerModel.revision,
    networkAccess: false,
    entities: await detectGlinerPersonEntities(request.modelDirectory, request.text)
  }
}

let operationQueue: Promise<void> = Promise.resolve()

function queueRequest(rawRequest: unknown, respond: (response: LocalNerWorkerResponse) => void): void {
  operationQueue = operationQueue.then(async () => {
    if (!isLocalNerWorkerRequest(rawRequest)) {
      respond({ id: 'invalid', kind: 'invalid', ok: false, errorCode: 'INVALID_REQUEST', message: 'Invalid NER request.' })
      return
    }
    try {
      respond(await detectNames(rawRequest))
    } catch (error) {
      respond({
        id: rawRequest.id,
        kind: 'detect-names',
        ok: false,
        errorCode: error instanceof Error ? (error.message.split(':')[0] ?? 'NER_FAILED') : 'NER_FAILED',
        message: 'Local name detection failed closed.'
      })
    }
  })
}

if (process.argv.includes('--stdio')) {
  let input = Buffer.alloc(0)
  process.stdin.on('data', (chunk: Buffer) => {
    input = Buffer.concat([input, chunk])
    if (input.length > 256 * 1024) {
      process.stdout.write(
        `${JSON.stringify({ id: 'invalid', kind: 'invalid', ok: false, errorCode: 'INPUT_LIMIT', message: 'NER request exceeded its IPC limit.' })}\n`
      )
      process.exitCode = 64
      process.stdin.destroy()
      return
    }
    while (true) {
      const newline = input.indexOf(0x0a)
      if (newline < 0) return
      const line = input.subarray(0, newline).toString('utf8').trim()
      input = Buffer.from(input.subarray(newline + 1))
      if (!line) continue
      let request: unknown
      try {
        request = JSON.parse(line)
      } catch {
        request = null
      }
      queueRequest(request, (response) => process.stdout.write(`${JSON.stringify(response)}\n`))
    }
  })
  // The loaded model holds ~0.9 GB; never outlive the parent.
  process.stdin.once('end', exitModelWorker)
} else {
  process.on('message', (request: unknown) => queueRequest(request, (response) => process.send?.(response)))
  process.once('disconnect', exitModelWorker)
}

for (const signal of ['SIGTERM', 'SIGINT'] as const) process.once(signal, exitModelWorker)
