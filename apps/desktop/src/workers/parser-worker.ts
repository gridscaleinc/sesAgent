import { DocumentParserError, parseStagedDocument, type ParserWorkerRequest, type ParserWorkerResponse } from '@parsers'
import { EmlParserError, emlFileManifestSchema, parseEmlMessage } from '@mail'
import { installParserNetworkDenyGuard } from './network-deny'

installParserNetworkDenyGuard()

function isParserWorkerRequest(value: unknown): value is ParserWorkerRequest {
  if (!value || typeof value !== 'object') return false
  const candidate = value as Record<string, unknown>
  if (typeof candidate.id !== 'string' || !Buffer.isBuffer(candidate.bytes)) return false
  if (candidate.kind === 'parse-document') return Boolean(candidate.file && typeof candidate.file === 'object')
  if (candidate.kind === 'parse-eml') return emlFileManifestSchema.safeParse(candidate.file).success
  return false
}

async function respond(request: ParserWorkerRequest): Promise<void> {
  let response: ParserWorkerResponse
  try {
    if (request.kind === 'parse-document') {
      const document = await parseStagedDocument(request.file, request.bytes)
      response = { id: request.id, kind: request.kind, ok: true, document }
    } else {
      const message = await parseEmlMessage(request.file, request.bytes)
      response = { id: request.id, kind: request.kind, ok: true, message }
    }
  } catch (error) {
    response = {
      id: request.id,
      kind: request.kind,
      ok: false,
      errorCode: error instanceof DocumentParserError || error instanceof EmlParserError ? error.code : 'PARSE_FAILED',
      message: error instanceof Error ? error.message : 'The isolated parser failed.'
    }
  } finally {
    request.bytes.fill(0)
  }
  process.send?.(response, () => process.disconnect())
}

async function stdioRequest(): Promise<ParserWorkerRequest> {
  const chunks: Buffer[] = []
  let total = 0
  for await (const rawChunk of process.stdin) {
    const chunk = Buffer.isBuffer(rawChunk) ? rawChunk : Buffer.from(rawChunk)
    total += chunk.length
    if (total > 30 * 1024 * 1024) throw new Error('PARSER_INPUT_LIMIT')
    chunks.push(chunk)
  }
  const framed = Buffer.concat(chunks)
  if (framed.length < 5) throw new Error('INVALID_REQUEST')
  const headerLength = framed.readUInt32LE(0)
  if (headerLength < 2 || headerLength > 1024 * 1024 || 4 + headerLength >= framed.length) {
    throw new Error('INVALID_REQUEST')
  }
  const metadata = JSON.parse(framed.subarray(4, 4 + headerLength).toString('utf8')) as Record<string, unknown>
  const request = { ...metadata, bytes: Buffer.from(framed.subarray(4 + headerLength)) }
  framed.fill(0)
  for (const chunk of chunks) chunk.fill(0)
  if (!isParserWorkerRequest(request)) {
    request.bytes.fill(0)
    throw new Error('INVALID_REQUEST')
  }
  return request
}

async function respondStdio(): Promise<void> {
  let request: ParserWorkerRequest | null = null
  let response: ParserWorkerResponse
  try {
    request = await stdioRequest()
    if (request.kind === 'parse-document') {
      response = { id: request.id, kind: request.kind, ok: true, document: await parseStagedDocument(request.file, request.bytes) }
    } else {
      response = { id: request.id, kind: request.kind, ok: true, message: await parseEmlMessage(request.file, request.bytes) }
    }
  } catch (error) {
    response = {
      id: request?.id ?? 'invalid',
      kind: request?.kind ?? 'invalid',
      ok: false,
      errorCode: error instanceof DocumentParserError || error instanceof EmlParserError
        ? error.code
        : error instanceof Error && error.message === 'INVALID_REQUEST' ? 'INVALID_REQUEST' : 'PARSE_FAILED',
      message: error instanceof Error ? error.message : 'The isolated parser failed.'
    }
  } finally {
    request?.bytes.fill(0)
  }
  process.stdout.write(`${JSON.stringify(response)}\n`)
}

if (process.argv.includes('--stdio')) {
  void respondStdio()
} else {
  process.once('message', (rawRequest: unknown) => {
    if (!isParserWorkerRequest(rawRequest)) {
      process.send?.(
        { id: 'invalid', kind: 'invalid', ok: false, errorCode: 'INVALID_REQUEST', message: 'Invalid parser worker request.' } satisfies ParserWorkerResponse,
        () => process.disconnect()
      )
      return
    }
    void respond(rawRequest)
  })
}
