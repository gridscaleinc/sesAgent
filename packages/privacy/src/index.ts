import { createHash, randomUUID } from 'node:crypto'
import { z } from 'zod'
import { workTaskTypes, type WorkTaskType } from '@domain'

export type CloudTaskType = WorkTaskType | 'cloud-assist'

export const directIdentifierTypes = [
  'person_name',
  'phone',
  'private_email',
  'postal_address',
  'birth_date',
  'face_or_photo',
  'signature',
  'government_id',
  'nationality',
  'residence_status',
  'work_authorization',
  'personal_account_or_url',
  'identifying_qr_code'
] as const

export const directIdentifierSchema = z.enum(directIdentifierTypes)
export type DirectIdentifier = z.infer<typeof directIdentifierSchema>

export const privacyExpertTextIdentifierTypes = [
  'person_name',
  'phone',
  'private_email',
  'postal_address',
  'birth_date',
  'government_id',
  'nationality',
  'residence_status',
  'work_authorization',
  'personal_account_or_url'
] as const

const privacyExpertExpectedIdentifierSchema = z.object({
  type: z.enum(privacyExpertTextIdentifierTypes),
  value: z.string().min(1).max(200)
}).strict()

export const privacyExpertDatasetSchema = z.object({
  version: z.literal('ses-privacy-expert-dataset-v1'),
  templateOnly: z.literal(false),
  humanLabeledDataset: z.literal(true),
  syntheticOnly: z.literal(false),
  locale: z.literal('ja-JP'),
  review: z.object({
    protocolVersion: z.literal('ses-privacy-human-review-v1'),
    sourceDocumentCount: z.number().int().min(50).max(10_000),
    independentReviewerCount: z.number().int().min(2).max(20),
    disagreementsResolved: z.literal(true),
    approvedForLocalEvaluation: z.literal(true),
    personalDataHandling: z.enum(['pseudonymized-local-only', 'consented-local-only']),
    reviewedAt: z.string().min(20).max(40).refine((value) => Number.isFinite(Date.parse(value)), 'Invalid review date.')
  }).strict(),
  cases: z.array(z.object({
    id: z.string().regex(/^[a-z0-9][a-z0-9-]{2,79}$/u),
    text: z.string().min(1).max(10_000),
    expected: z.array(privacyExpertExpectedIdentifierSchema).min(1).max(50)
  }).strict()).min(50).max(1_000),
  safeCases: z.array(z.object({
    id: z.string().regex(/^[a-z0-9][a-z0-9-]{2,79}$/u),
    text: z.string().min(1).max(10_000)
  }).strict()).min(20).max(500)
}).strict()

export type PrivacyExpertDataset = z.infer<typeof privacyExpertDatasetSchema>

export const privacyExpertQualityThresholds = Object.freeze({
  expectedPersonNames: 20,
  postReviewIdentifierRecall: 1,
  automaticNonNameIdentifierRecall: 1,
  redactionPrecision: 0.95,
  automaticPersonNameRecall: 0.9,
  residualLeakCount: 0,
  safeCaseFalsePositiveRate: 0.05
})

export interface PrivacyExpertEvaluationResult {
  caseCount: number
  safeCaseCount: number
  sourceDocumentCount: number
  independentReviewerCount: number
  disagreementsResolved: true
  approvedForLocalEvaluation: true
  personalDataHandling: 'pseudonymized-local-only' | 'consented-local-only'
  expectedIdentifiers: number
  postReviewDetectedIdentifiers: number
  expectedPersonNames: number
  automaticallyDetectedPersonNames: number
  expectedNonNameIdentifiers: number
  automaticallyDetectedNonNameIdentifiers: number
  postReviewIdentifierRecall: number
  automaticPersonNameRecall: number
  automaticNonNameIdentifierRecall: number
  redactionPrecision: number
  residualLeakCount: number
  safeCaseFalsePositiveCount: number
  safeCaseFalsePositiveRate: number
  releaseEligible: boolean
  failures: string[]
}

const redactedPayloadBrand: unique symbol = Symbol('RedactedPayload')

export const redactedPayloadSchema = z.object({
  kind: z.literal('redacted-payload'),
  content: z.string().max(2_000_000),
  redactionSessionId: z.string().uuid(),
  sourceVersion: z.string().min(1),
  policyVersion: z.string().min(1),
  dlpStatus: z.literal('passed'),
  contentHash: z.string().regex(/^[a-f0-9]{64}$/),
  removedTypes: z.array(directIdentifierSchema)
})

type SerializedRedactedPayload = z.infer<typeof redactedPayloadSchema>

export type RedactedPayload = Readonly<SerializedRedactedPayload> & {
  readonly [redactedPayloadBrand]: true
}

export interface LocalPiiMapping {
  placeholder: string
  identifierType: DirectIdentifier
  originalValue: string
}

export interface RedactionSessionEvidence {
  id: string
  sourceVersion: string
  policyVersion: string
  status: 'passed' | 'failed' | 'uncertain' | 'invalidated'
  contentHash: string | null
  removedTypes: DirectIdentifier[]
  createdAt: string
  expiresAt: string
}

export interface LocalRedactionResult {
  session: RedactionSessionEvidence
  mappings: LocalPiiMapping[]
  findings: Array<{ identifierType: DirectIdentifier; placeholder: string }>
  redactedContent: string
  payload: RedactedPayload | null
  blockedReasons: string[]
}

export interface LocalRedactionOptions {
  sourceVersion: string
  policyVersion?: string
  knownPersonNames?: string[]
  mediaRisks?: Array<'face_or_photo' | 'signature' | 'identifying_qr_code'>
  personNameReviewCompleted?: true
  sessionId?: string
  now?: Date
  ttlMinutes?: number
}

export function applyLocalPiiMappings(value: string, mappings: LocalPiiMapping[]): string {
  let redacted = value
  for (const mapping of mappings.toSorted((a, b) => b.originalValue.length - a.originalValue.length)) {
    redacted = redacted.replaceAll(mapping.originalValue, mapping.placeholder)
  }
  return redacted
}

interface Detection {
  start: number
  end: number
  value: string
  identifierType: DirectIdentifier
}

interface CaptureRule {
  identifierType: DirectIdentifier
  pattern: RegExp
  captureGroup?: number
}

const detectionRules: CaptureRule[] = [
  {
    identifierType: 'private_email',
    pattern: /[\p{L}\p{N}.．!#$%&'*+/=?^_`{|}~-]+[@＠][\p{L}\p{N}-]+(?:[.．][\p{L}\p{N}-]+)+/giu
  },
  {
    identifierType: 'phone',
    pattern: /(?<![0-9０-９])(?:[+＋](?:81|８１)[-ー－\s]?(?:[0０])?|[0０])(?:[0-9０-９][-ー－\s]?){8,10}[0-9０-９](?![0-9０-９])/gu
  },
  {
    identifierType: 'postal_address',
    pattern: /〒\s*[0-9０-９]{3}[-ー－][0-9０-９]{4}(?:\s*[^\n\r,，]{0,80})?/gu
  },
  {
    identifierType: 'postal_address',
    pattern: /(?:住所|現住所|所在地)\s*[:：]\s*([^\n\r]{3,120})/gu,
    captureGroup: 1
  },
  {
    identifierType: 'birth_date',
    pattern: /(?:生年月日|誕生日|DOB)\s*[:：]?\s*((?:19|20|１９|２０)[0-9０-９]{2}(?:年|[/.．\-ー－])[0-9０-９]{1,2}(?:月|[/.．\-ー－])[0-9０-９]{1,2}日?)/giu,
    captureGroup: 1
  },
  {
    identifierType: 'government_id',
    pattern: /(?:マイナンバー|個人番号)\s*[:：]?\s*([0-9０-９][\s-]?){12}/gu
  },
  {
    identifierType: 'government_id',
    pattern: /(?:旅券番号|パスポート番号|在留カード番号)\s*[:：]?\s*[A-Z0-9-]{6,16}/giu
  },
  {
    identifierType: 'nationality',
    pattern: /(?:国籍|Nationality)\s*[:：]\s*([^\n\r\t|｜,，;；]{1,80})/giu,
    captureGroup: 1
  },
  {
    identifierType: 'nationality',
    pattern: /(?:外国籍不可|日本国籍(?:のみ|限定)|日本人(?:のみ|限定))/gu
  },
  {
    identifierType: 'residence_status',
    pattern: /(?:在留資格|Residence\s+status|Visa\s+status|ビザ(?:種別|種類)?)\s*[:：]\s*([^\n\r\t|｜,，;；]{1,100})/giu,
    captureGroup: 1
  },
  {
    identifierType: 'residence_status',
    pattern: /(?:^|[\s　])((?:永住者|定住者|高度専門職|技術・人文知識・国際業務|日本人の配偶者等|永住者の配偶者等|特定活動|特定技能|技能実習|留学|家族滞在))(?:$|[\s　,，;；])/gmu,
    captureGroup: 1
  },
  {
    identifierType: 'work_authorization',
    pattern: /(?:就労資格|就労可否|就労制限|Work\s+authori[sz]ation)\s*[:：]\s*([^\n\r\t|｜,，;；]{1,100})/giu,
    captureGroup: 1
  },
  {
    identifierType: 'work_authorization',
    pattern: /(?:^|[\s　])((?:就労制限なし|就労資格あり（職種・期限要確認）|資格外活動のみ（制限あり）|就労不可))(?:$|[\s　,，;；])/gmu,
    captureGroup: 1
  },
  {
    identifierType: 'personal_account_or_url',
    pattern: /(?:https?:\/\/|www\.)[^\s<>()]+/giu
  },
  {
    identifierType: 'personal_account_or_url',
    pattern: /(?:LINE|Skype|GitHub|LinkedIn|SNS)\s*(?:ID|アカウント)?\s*[:：]\s*[@\p{L}\p{N}_.-]{2,64}/giu
  }
]

const dlpRules: Array<{ label: string; pattern: RegExp }> = [
  { label: 'private_email', pattern: /[\p{L}\p{N}.．!#$%&'*+/=?^_`{|}~-]+[@＠][\p{L}\p{N}-]+(?:[.．][\p{L}\p{N}-]+)+/iu },
  { label: 'phone', pattern: /(?<![0-9０-９])(?:[+＋](?:81|８１)[-ー－\s]?(?:[0０])?|[0０])(?:[0-9０-９][-ー－\s]?){8,10}[0-9０-９](?![0-9０-９])/u },
  { label: 'postal_address', pattern: /(?:〒\s*)?[0-9０-９]{3}[-ー－][0-9０-９]{4}/u },
  { label: 'birth_date', pattern: /(?:生年月日|誕生日|DOB)\s*[:：]?\s*(?:19|20|１９|２０)[0-9０-９]{2}(?:年|[/.．\-ー－])[0-9０-９]{1,2}/iu },
  { label: 'government_id', pattern: /(?:マイナンバー|個人番号|旅券番号|パスポート番号|在留カード番号)\s*[:：]?\s*[A-Z0-9０-９-]{6,}/iu },
  { label: 'nationality', pattern: /(?:国籍|Nationality)\s*[:：](?!\s*<(?:NATIONALITY|RESIDENCE_STATUS|WORK_AUTHORIZATION)_\d{3}>)\s*[^\n\r\t|｜,，;；]{1,80}/iu },
  { label: 'nationality', pattern: /(?:外国籍不可|日本国籍(?:のみ|限定)|日本人(?:のみ|限定))/u },
  { label: 'residence_status', pattern: /(?:在留資格|Residence\s+status|Visa\s+status|ビザ(?:種別|種類)?)\s*[:：](?!\s*<(?:NATIONALITY|RESIDENCE_STATUS|WORK_AUTHORIZATION)_\d{3}>)\s*[^\n\r\t|｜,，;；]{1,100}/iu },
  { label: 'residence_status', pattern: /(?:^|[\s　])(?:永住者|定住者|高度専門職|技術・人文知識・国際業務|日本人の配偶者等|永住者の配偶者等|特定活動|特定技能|技能実習|留学|家族滞在)(?:$|[\s　,，;；])/mu },
  { label: 'work_authorization', pattern: /(?:就労資格|就労可否|就労制限|Work\s+authori[sz]ation)\s*[:：](?!\s*<(?:NATIONALITY|RESIDENCE_STATUS|WORK_AUTHORIZATION)_\d{3}>)\s*[^\n\r\t|｜,，;；]{1,100}/iu },
  { label: 'work_authorization', pattern: /(?:^|[\s　])(?:就労制限なし|就労資格あり（職種・期限要確認）|資格外活動のみ（制限あり）|就労不可)(?:$|[\s　,，;；])/mu },
  { label: 'personal_account_or_url', pattern: /(?:https?:\/\/|www\.)[^\s<>()]+/iu }
]

function collectRuleDetections(input: string): Detection[] {
  const detections: Detection[] = []
  for (const rule of detectionRules) {
    for (const match of input.matchAll(rule.pattern)) {
      const fullValue = match[0]
      const value = rule.captureGroup ? match[rule.captureGroup] : fullValue
      if (!value || match.index === undefined) continue
      const offset = rule.captureGroup ? fullValue.indexOf(value) : 0
      detections.push({
        start: match.index + offset,
        end: match.index + offset + value.length,
        value,
        identifierType: rule.identifierType
      })
    }
  }
  return detections
}

function collectKnownPersonDetections(input: string, names: string[]): Detection[] {
  const detections: Detection[] = []
  for (const rawName of names) {
    const name = rawName.trim()
    if (name.length < 2) continue
    let start = input.indexOf(name)
    while (start >= 0) {
      detections.push({ start, end: start + name.length, value: name, identifierType: 'person_name' })
      start = input.indexOf(name, start + name.length)
    }
  }
  return detections
}

function removeOverlaps(detections: Detection[]): Detection[] {
  const accepted: Detection[] = []
  const sorted = detections.toSorted((a, b) => a.start - b.start || b.end - b.start - (a.end - a.start))
  for (const detection of sorted) {
    if (accepted.some((item) => detection.start < item.end && detection.end > item.start)) continue
    accepted.push(detection)
  }
  return accepted.toSorted((a, b) => a.start - b.start)
}

function placeholderPrefix(type: DirectIdentifier): string {
  return type.toUpperCase()
}

function hashContent(content: string): string {
  return createHash('sha256').update(content).digest('hex')
}

function runIndependentDlp(content: string, knownPersonNames: string[]): string[] {
  const reasons = dlpRules.filter(({ pattern }) => pattern.test(content)).map(({ label }) => `residual:${label}`)
  for (const name of knownPersonNames) {
    if (name.trim().length >= 2 && content.includes(name.trim())) reasons.push('residual:person_name')
  }
  return [...new Set(reasons)]
}

export function detectDirectIdentifiers(input: string, knownPersonNames: string[] = []): DirectIdentifier[] {
  const detected = [
    ...collectRuleDetections(input).map((item) => item.identifierType),
    ...collectKnownPersonDetections(input, knownPersonNames).map((item) => item.identifierType)
  ]
  const placeholderPattern = /<(PERSON_NAME|PHONE|PRIVATE_EMAIL|POSTAL_ADDRESS|BIRTH_DATE|FACE_OR_PHOTO|SIGNATURE|GOVERNMENT_ID|NATIONALITY|RESIDENCE_STATUS|WORK_AUTHORIZATION|PERSONAL_ACCOUNT_OR_URL|IDENTIFYING_QR_CODE)_\d{3}>/gu
  for (const match of input.matchAll(placeholderPattern)) {
    const type = match[1]?.toLocaleLowerCase('en-US')
    if (type && directIdentifierSchema.safeParse(type).success) detected.push(type as DirectIdentifier)
  }
  return [...new Set(detected)]
}

function brandPayload(payload: SerializedRedactedPayload): RedactedPayload {
  return Object.freeze(
    Object.defineProperty(payload, redactedPayloadBrand, {
      value: true,
      enumerable: false,
      configurable: false,
      writable: false
    })
  ) as RedactedPayload
}

export function redactTextForCloud(input: string, options: LocalRedactionOptions): LocalRedactionResult {
  if (!input.trim()) throw new Error('Cannot redact empty content.')
  if (input.length > 2_000_000) throw new Error('Content exceeds the local redaction limit.')

  const now = options.now ?? new Date()
  const sessionId = options.sessionId ?? randomUUID()
  const policyVersion = options.policyVersion ?? 'cloud-redaction-v2'
  const knownPersonNames = options.knownPersonNames ?? []
  const detections = removeOverlaps([
    ...collectRuleDetections(input),
    ...collectKnownPersonDetections(input, knownPersonNames)
  ])
  const counters = new Map<DirectIdentifier, number>()
  const values = new Map<string, string>()
  const mappings: LocalPiiMapping[] = []

  const replacements = detections.map((detection) => {
    const key = `${detection.identifierType}\u0000${detection.value}`
    let placeholder = values.get(key)
    if (!placeholder) {
      const next = (counters.get(detection.identifierType) ?? 0) + 1
      counters.set(detection.identifierType, next)
      placeholder = `<${placeholderPrefix(detection.identifierType)}_${String(next).padStart(3, '0')}>`
      values.set(key, placeholder)
      mappings.push({
        placeholder,
        identifierType: detection.identifierType,
        originalValue: detection.value
      })
    }
    return { ...detection, placeholder }
  })

  let content = input
  for (const replacement of replacements.toReversed()) {
    content = `${content.slice(0, replacement.start)}${replacement.placeholder}${content.slice(replacement.end)}`
  }

  const blockedReasons = runIndependentDlp(content, knownPersonNames)
  for (const risk of options.mediaRisks ?? []) blockedReasons.push(`unredacted-media:${risk}`)
  if (options.personNameReviewCompleted !== true) blockedReasons.push('coverage:person_name_review_required')
  const hasUncertainCoverage = blockedReasons.some(
    (reason) => reason.startsWith('unredacted-media:') || reason.startsWith('coverage:')
  )
  const status = blockedReasons.length === 0 ? 'passed' : hasUncertainCoverage ? 'uncertain' : 'failed'
  const contentHash = status === 'passed' ? hashContent(content) : null
  const removedTypes = [...new Set(mappings.map((mapping) => mapping.identifierType))]
  const expiresAt = new Date(now.getTime() + (options.ttlMinutes ?? 30) * 60_000).toISOString()
  const session: RedactionSessionEvidence = {
    id: sessionId,
    sourceVersion: options.sourceVersion,
    policyVersion,
    status,
    contentHash,
    removedTypes,
    createdAt: now.toISOString(),
    expiresAt
  }

  const serializedPayload =
    status === 'passed' && contentHash
      ? redactedPayloadSchema.parse({
          kind: 'redacted-payload',
          content,
          redactionSessionId: sessionId,
          sourceVersion: options.sourceVersion,
          policyVersion,
          dlpStatus: 'passed',
          contentHash,
          removedTypes
        })
      : null

  return {
    session,
    mappings,
    findings: mappings.map(({ identifierType, placeholder }) => ({ identifierType, placeholder })),
    redactedContent: content,
    payload: serializedPayload ? brandPayload(serializedPayload) : null,
    blockedReasons: [...new Set(blockedReasons)]
  }
}

function mappingKey(identifierType: DirectIdentifier, value: string): string {
  return `${identifierType}\u0000${value}`
}

export function evaluatePrivacyExpertDataset(
  input: unknown,
  automaticNamesByCase: Readonly<Record<string, readonly string[] | undefined>>
): PrivacyExpertEvaluationResult {
  const dataset = privacyExpertDatasetSchema.parse(input)
  const failures: string[] = []
  const ids = [...dataset.cases, ...dataset.safeCases].map((testCase) => testCase.id)
  if (new Set(ids).size !== ids.length) failures.push('dataset:duplicate-case-id')

  let expectedIdentifiers = 0
  let postReviewDetectedIdentifiers = 0
  let expectedPersonNames = 0
  let automaticallyDetectedPersonNames = 0
  let expectedNonNameIdentifiers = 0
  let automaticallyDetectedNonNameIdentifiers = 0
  let expectedMappingCount = 0
  let mappingCount = 0
  let residualLeakCount = 0

  for (const testCase of dataset.cases) {
    const expectedMappings = new Set<string>()
    for (const expected of testCase.expected) {
      const key = mappingKey(expected.type, expected.value)
      if (expectedMappings.has(key)) failures.push(`${testCase.id}:duplicate-annotation:${expected.type}`)
      expectedMappings.add(key)
      if (!testCase.text.includes(expected.value)) failures.push(`${testCase.id}:annotation-not-in-text:${expected.type}`)
    }
    const automaticNames = [...new Set(automaticNamesByCase[testCase.id] ?? [])]
    const automatic = redactTextForCloud(testCase.text, {
      sourceVersion: `privacy-expert-automatic:${testCase.id}`,
      knownPersonNames: automaticNames,
      personNameReviewCompleted: true
    })
    const automaticMappings = new Set(
      automatic.mappings.map((mapping) => mappingKey(mapping.identifierType, mapping.originalValue))
    )
    const reviewedPersonNames = testCase.expected
      .filter((expected) => expected.type === 'person_name')
      .map((expected) => expected.value)
    const reviewed = redactTextForCloud(testCase.text, {
      sourceVersion: `privacy-expert-reviewed:${testCase.id}`,
      knownPersonNames: [...new Set([...automaticNames, ...reviewedPersonNames])],
      personNameReviewCompleted: true
    })
    const reviewedMappings = new Set(
      reviewed.mappings.map((mapping) => mappingKey(mapping.identifierType, mapping.originalValue))
    )

    expectedIdentifiers += expectedMappings.size
    mappingCount += reviewedMappings.size
    if (reviewed.session.status !== 'passed' || reviewed.payload === null) {
      failures.push(`${testCase.id}:reviewed-redaction-not-passed`)
    }
    for (const expected of testCase.expected) {
      const key = mappingKey(expected.type, expected.value)
      const automaticallyDetected = automaticMappings.has(key)
      const detectedAfterReview = reviewedMappings.has(key)
      if (expected.type === 'person_name') {
        expectedPersonNames += 1
        if (automaticallyDetected) automaticallyDetectedPersonNames += 1
      } else {
        expectedNonNameIdentifiers += 1
        if (automaticallyDetected) automaticallyDetectedNonNameIdentifiers += 1
      }
      if (detectedAfterReview) {
        postReviewDetectedIdentifiers += 1
        expectedMappingCount += 1
      } else {
        failures.push(`${testCase.id}:post-review-missed:${expected.type}`)
      }
      if (reviewed.redactedContent.includes(expected.value)) {
        residualLeakCount += 1
        failures.push(`${testCase.id}:residual-value:${expected.type}`)
      }
    }
  }

  let safeCaseFalsePositiveCount = 0
  for (const testCase of dataset.safeCases) {
    const automaticNames = [...new Set(automaticNamesByCase[testCase.id] ?? [])]
    const identifiers = detectDirectIdentifiers(testCase.text, automaticNames)
    if (automaticNames.length > 0 || identifiers.length > 0) {
      safeCaseFalsePositiveCount += 1
      failures.push(`${testCase.id}:safe-case-false-positive`)
    }
  }

  const postReviewIdentifierRecall = expectedIdentifiers === 0
    ? 0
    : postReviewDetectedIdentifiers / expectedIdentifiers
  const automaticPersonNameRecall = expectedPersonNames === 0
    ? 0
    : automaticallyDetectedPersonNames / expectedPersonNames
  const automaticNonNameIdentifierRecall = expectedNonNameIdentifiers === 0
    ? 0
    : automaticallyDetectedNonNameIdentifiers / expectedNonNameIdentifiers
  const redactionPrecision = mappingCount === 0 ? 0 : expectedMappingCount / mappingCount
  const safeCaseFalsePositiveRate = safeCaseFalsePositiveCount / dataset.safeCases.length
  if (expectedPersonNames < privacyExpertQualityThresholds.expectedPersonNames) {
    failures.push('dataset:insufficient-person-name-coverage')
  }
  const releaseEligible = failures.length === 0 &&
    postReviewIdentifierRecall === privacyExpertQualityThresholds.postReviewIdentifierRecall &&
    automaticNonNameIdentifierRecall === privacyExpertQualityThresholds.automaticNonNameIdentifierRecall &&
    redactionPrecision >= privacyExpertQualityThresholds.redactionPrecision &&
    automaticPersonNameRecall >= privacyExpertQualityThresholds.automaticPersonNameRecall &&
    residualLeakCount === privacyExpertQualityThresholds.residualLeakCount &&
    safeCaseFalsePositiveRate <= privacyExpertQualityThresholds.safeCaseFalsePositiveRate

  return {
    caseCount: dataset.cases.length,
    safeCaseCount: dataset.safeCases.length,
    sourceDocumentCount: dataset.review.sourceDocumentCount,
    independentReviewerCount: dataset.review.independentReviewerCount,
    disagreementsResolved: dataset.review.disagreementsResolved,
    approvedForLocalEvaluation: dataset.review.approvedForLocalEvaluation,
    personalDataHandling: dataset.review.personalDataHandling,
    expectedIdentifiers,
    postReviewDetectedIdentifiers,
    expectedPersonNames,
    automaticallyDetectedPersonNames,
    expectedNonNameIdentifiers,
    automaticallyDetectedNonNameIdentifiers,
    postReviewIdentifierRecall,
    automaticPersonNameRecall,
    automaticNonNameIdentifierRecall,
    redactionPrecision,
    residualLeakCount,
    safeCaseFalsePositiveCount,
    safeCaseFalsePositiveRate,
    releaseEligible,
    failures: [...new Set(failures)]
  }
}

export function assertCloudPayload(input: unknown): SerializedRedactedPayload {
  return redactedPayloadSchema.parse(input)
}

export interface CloudCallAuditRecord {
  id: string
  redactionSessionId: string
  provider: string
  taskType: CloudTaskType
  endpoint: string
  inputHash: string
  dlpStatus: 'passed'
  outcome: 'succeeded' | 'blocked' | 'failed'
  reasonCode: string | null
  qualityGateReportHash: string
  expertAttestationHash: string | null
  reviewTicketHash: string
  reviewTicketStatus: 'confirmed'
  gatePolicyVersion: string
  createdAt: string
}

export interface CloudCallAuditContext {
  qualityGateReportHash: string
  expertAttestationHash: string | null
  reviewTicketHash: string
  gatePolicyVersion: string
}

export interface RedactionEvidenceStore {
  getRedactionSession(id: string): RedactionSessionEvidence | null
  appendCloudCallAudit(record: CloudCallAuditRecord): void
}

export interface CloudProviderAdapter {
  readonly id: string
  readonly endpoint: string
  invoke(taskType: CloudTaskType, content: string): Promise<unknown>
}

export interface CloudGatewayConfig {
  policyVersion: string
  allowedEndpoints: string[]
  allowedTasks?: CloudTaskType[]
  allowLoopbackHttp?: boolean
  now?: () => Date
  idFactory?: () => string
}

export class CloudRedactionGateway {
  private readonly providers = new Map<string, CloudProviderAdapter>()
  private readonly allowedTasks: Set<CloudTaskType>

  constructor(
    adapters: CloudProviderAdapter[],
    private readonly evidenceStore: RedactionEvidenceStore,
    private readonly config: CloudGatewayConfig
  ) {
    for (const adapter of adapters) this.providers.set(adapter.id, adapter)
    this.allowedTasks = new Set(config.allowedTasks ?? [...workTaskTypes, 'cloud-assist'])
  }

  async invoke(
    providerId: string,
    taskType: CloudTaskType,
    payload: RedactedPayload,
    auditContext: CloudCallAuditContext
  ): Promise<unknown> {
    const now = this.config.now?.() ?? new Date()
    const auditBase = {
      id: this.config.idFactory?.() ?? randomUUID(),
      redactionSessionId: payload?.redactionSessionId ?? 'invalid',
      provider: providerId,
      taskType,
      endpoint: this.providers.get(providerId)?.endpoint ?? 'unregistered',
      inputHash: payload?.contentHash ?? 'invalid',
      dlpStatus: 'passed' as const,
      qualityGateReportHash: auditContext.qualityGateReportHash,
      expertAttestationHash: auditContext.expertAttestationHash,
      reviewTicketHash: auditContext.reviewTicketHash,
      reviewTicketStatus: 'confirmed' as const,
      gatePolicyVersion: auditContext.gatePolicyVersion,
      createdAt: now.toISOString()
    }

    const block = (reasonCode: string): never => {
      this.evidenceStore.appendCloudCallAudit({ ...auditBase, outcome: 'blocked', reasonCode })
      throw new Error(`Cloud request blocked: ${reasonCode}`)
    }

    const requiredAuditHashes = [auditContext.qualityGateReportHash, auditContext.reviewTicketHash]
    const invalidOptionalExpertHash = auditContext.expertAttestationHash !== null &&
      !/^[a-f0-9]{64}$/u.test(auditContext.expertAttestationHash)
    if (
      requiredAuditHashes.some((value) => !/^[a-f0-9]{64}$/u.test(value)) ||
      invalidOptionalExpertHash
    ) block('invalid-gate-audit-context')
    if (auditContext.gatePolicyVersion !== this.config.policyVersion) block('gate-policy-mismatch')
    if (!payload || payload[redactedPayloadBrand] !== true) block('unbranded-payload')
    const parsed = redactedPayloadSchema.safeParse(payload)
    if (!parsed.success) return block('invalid-payload-schema')
    const data = parsed.data
    if (!this.allowedTasks.has(taskType)) block('task-not-allowed')
    const adapter = this.providers.get(providerId)
    if (!adapter) return block('provider-not-registered')
    if (!this.config.allowedEndpoints.includes(adapter.endpoint)) block('endpoint-not-allowed')
    const endpoint = new URL(adapter.endpoint)
    const loopbackHttp = endpoint.protocol === 'http:' &&
      (endpoint.hostname === 'localhost' || endpoint.hostname === '127.0.0.1' || endpoint.hostname === '[::1]')
    if (endpoint.protocol !== 'https:' && !(this.config.allowLoopbackHttp === true && loopbackHttp)) {
      block('endpoint-not-https')
    }
    if (data.policyVersion !== this.config.policyVersion) block('policy-mismatch')
    if (hashContent(data.content) !== data.contentHash) block('payload-hash-mismatch')

    const session = this.evidenceStore.getRedactionSession(data.redactionSessionId)
    if (!session) return block('redaction-session-not-found')
    if (session.status !== 'passed') block('redaction-session-not-passed')
    if (session.expiresAt <= now.toISOString()) block('redaction-session-expired')
    if (session.sourceVersion !== data.sourceVersion) block('source-version-mismatch')
    if (session.policyVersion !== data.policyVersion) block('session-policy-mismatch')
    if (session.contentHash !== data.contentHash) block('session-hash-mismatch')

    try {
      const response = await adapter.invoke(taskType, data.content)
      this.evidenceStore.appendCloudCallAudit({ ...auditBase, outcome: 'succeeded', reasonCode: null })
      return response
    } catch (error) {
      this.evidenceStore.appendCloudCallAudit({ ...auditBase, outcome: 'failed', reasonCode: 'provider-error' })
      throw error
    }
  }
}
