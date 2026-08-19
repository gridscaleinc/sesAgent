import { createHash } from 'node:crypto'
import PostalMime, { type Address, type Attachment } from 'postal-mime'
import { z } from 'zod'
import {
  classifyEmailText,
  emailHasPromptInjectionPattern,
  emailHtmlToPlainText,
  minimizeEmailBodyForLocalProcessing,
  normalizeEmailHeaderValue,
  type BusinessEmailClassification
} from './email-content'

export const maxEmlFileSizeBytes = 10 * 1024 * 1024
export const maxEmlFilesPerImport = 20

export interface EmlFileManifest {
  name: string
  size: number
  sha256: string
}

export interface ParsedEmlMessage {
  version: 'parsed-eml-v1'
  file: EmlFileManifest
  sourceMessageKey: string
  threadKey: string
  subject: string
  body: string
  senderDisplayName: string | null
  fromDomain: string | null
  messageDate: string
  attachmentCount: number
  classification: BusinessEmailClassification
  warningCodes: string[]
  security: {
    externalContentLoaded: false
    attachmentsPersisted: false
    rawFileCloudEligible: false
  }
}

export class EmlParserError extends Error {
  constructor(
    readonly code: 'INVALID_MANIFEST' | 'HASH_MISMATCH' | 'LIMIT_EXCEEDED' | 'INVALID_MESSAGE' | 'BODY_EMPTY' | 'PARSE_FAILED',
    message: string,
    options?: ErrorOptions
  ) {
    super(message, options)
    this.name = 'EmlParserError'
  }
}

export const emlFileManifestSchema: z.ZodType<EmlFileManifest> = z.object({
  name: z.string().min(1).max(180).refine((name) => !/[\\/\u0000]/u.test(name)),
  size: z.number().int().positive().max(maxEmlFileSizeBytes),
  sha256: z.string().regex(/^[a-f0-9]{64}$/u)
})

export const parsedEmlMessageSchema: z.ZodType<ParsedEmlMessage> = z.object({
  version: z.literal('parsed-eml-v1'),
  file: emlFileManifestSchema,
  sourceMessageKey: z.string().regex(/^eml_[a-f0-9]{64}$/u),
  threadKey: z.string().regex(/^emlt_[a-f0-9]{64}$/u),
  subject: z.string().min(1).max(2_000),
  body: z.string().min(8).max(100_000),
  senderDisplayName: z.string().min(1).max(300).nullable(),
  fromDomain: z.string().min(1).max(253).nullable(),
  messageDate: z.string().datetime(),
  attachmentCount: z.number().int().nonnegative().max(100),
  classification: z.enum(['job-case', 'candidate-proposal', 'unclassified']),
  warningCodes: z.array(z.string().min(1).max(120)).max(100),
  security: z.object({
    externalContentLoaded: z.literal(false),
    attachmentsPersisted: z.literal(false),
    rawFileCloudEligible: z.literal(false)
  })
})

function hashKey(prefix: 'eml_' | 'emlt_', value: string): string {
  return `${prefix}${createHash('sha256').update(value, 'utf8').digest('hex')}`
}

function firstMailbox(address: Address | undefined): { name: string; address: string } | null {
  if (!address) return null
  if ('address' in address && typeof address.address === 'string') return { name: address.name, address: address.address }
  const first = address.group[0]
  return first ? { name: first.name, address: first.address } : null
}

function senderDomain(address: string | undefined): string | null {
  const domain = address?.trim().toLocaleLowerCase('en-US').match(/@([^@\s>]+)$/u)?.[1]
  if (!domain || domain.length > 253 || !/^[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?$/u.test(domain)) return null
  return domain
}

function clearAttachment(attachment: Attachment): void {
  if (attachment.content instanceof ArrayBuffer) new Uint8Array(attachment.content).fill(0)
  else if (ArrayBuffer.isView(attachment.content)) new Uint8Array(
    attachment.content.buffer,
    attachment.content.byteOffset,
    attachment.content.byteLength
  ).fill(0)
}

export async function parseEmlMessage(
  rawManifest: EmlFileManifest,
  bytes: Buffer,
  now = new Date()
): Promise<ParsedEmlMessage> {
  const manifest = emlFileManifestSchema.parse(rawManifest)
  if (bytes.length !== manifest.size) throw new EmlParserError('INVALID_MANIFEST', 'EML size does not match its manifest.')
  const sha256 = createHash('sha256').update(bytes).digest('hex')
  if (sha256 !== manifest.sha256) throw new EmlParserError('HASH_MISMATCH', 'EML content does not match its manifest.')

  let email: Awaited<ReturnType<typeof PostalMime.parse>> | null = null
  try {
    email = await PostalMime.parse(bytes, {
      attachmentEncoding: 'arraybuffer',
      maxNestingDepth: 30,
      maxHeadersSize: 256 * 1024,
      rfc822Attachments: true
    })
    if (email.headers.length === 0) throw new EmlParserError('INVALID_MESSAGE', 'EML headers are missing.')
    if (email.attachments.length > 100) throw new EmlParserError('LIMIT_EXCEEDED', 'EML contains more than 100 attachments.')

    const warnings = new Set<string>(['EML_SOURCE_LOCAL_PARSE'])
    const subject = normalizeEmailHeaderValue(email.subject, '(件名なし)')
    const rawBody = email.text?.trim() || (email.html ? emailHtmlToPlainText(email.html) : '')
    const body = minimizeEmailBodyForLocalProcessing(rawBody)
    if (body.length < 8) throw new EmlParserError('BODY_EMPTY', 'EML does not contain a usable text body.')
    if (!email.text && email.html) warnings.add('EML_HTML_CONVERTED_TO_TEXT')
    if (rawBody.length > body.length) warnings.add('EML_BODY_TRUNCATED_OR_QUOTED_HISTORY_REMOVED')
    if (email.attachments.length > 0) warnings.add('EML_ATTACHMENTS_IGNORED')
    if (emailHasPromptInjectionPattern(`${subject}\n${body}`)) warnings.add('PROMPT_INJECTION_PATTERN')

    const parsedDate = email.date ? new Date(email.date) : null
    const messageDate = parsedDate && Number.isFinite(parsedDate.getTime()) ? parsedDate.toISOString() : now.toISOString()
    if (!parsedDate || !Number.isFinite(parsedDate.getTime())) warnings.add('EML_DATE_MISSING_OR_INVALID')

    const sender = firstMailbox(email.from)
    const senderDisplayName = normalizeEmailHeaderValue(sender?.name, '').slice(0, 300) || null
    const identityAnchor = email.messageId?.trim() || manifest.sha256
    const referenceAnchor = email.references?.trim().split(/\s+/u).at(-1)
      || email.inReplyTo?.trim()
      || email.messageId?.trim()
      || manifest.sha256
    const result = parsedEmlMessageSchema.parse({
      version: 'parsed-eml-v1',
      file: manifest,
      sourceMessageKey: hashKey('eml_', identityAnchor),
      threadKey: hashKey('emlt_', referenceAnchor),
      subject,
      body,
      senderDisplayName,
      fromDomain: senderDomain(sender?.address),
      messageDate,
      attachmentCount: email.attachments.length,
      classification: classifyEmailText(subject, body),
      warningCodes: [...warnings],
      security: {
        externalContentLoaded: false,
        attachmentsPersisted: false,
        rawFileCloudEligible: false
      }
    })
    return result
  } catch (error) {
    if (error instanceof EmlParserError) throw error
    const message = error instanceof Error ? error.message : ''
    if (/nesting depth|header size/iu.test(message)) {
      throw new EmlParserError('LIMIT_EXCEEDED', 'EML MIME structure exceeds the local safety limit.', { cause: error })
    }
    throw new EmlParserError('PARSE_FAILED', 'EML could not be parsed by the isolated local parser.', { cause: error })
  } finally {
    for (const attachment of email?.attachments ?? []) clearAttachment(attachment)
  }
}
