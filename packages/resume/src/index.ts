import { createHash, randomUUID } from 'node:crypto'
import { z } from 'zod'
import type { DocumentBlock, DocumentIR } from '@parsers'
import {
  candidateFieldKeys,
  candidateWorkAuthorizationValues,
  candidateProjectExperienceSchema,
  localCandidatePersonalDetailsSchema,
  type CandidateFieldKey,
  type CandidateWorkAuthorization,
  type CandidateProjectExperience,
  type CandidateProjectMatchEvidence,
  type CandidateProfileSearchResult,
  type CandidateEvaluationReport,
  type SesCandidateBenchmark,
  type LocalCandidatePersonalDetails
} from '@shared'

export { candidateFieldKeys }
export type { CandidateFieldKey }

export interface CandidateFieldSource {
  blockId: string
  sourceLabel: string
  excerpt: string
}

export interface CandidateExtractionField {
  key: CandidateFieldKey
  label: string
  value: string | null
  confidence: number
  status: 'needs_review' | 'missing'
  sources: CandidateFieldSource[]
}

export interface CandidateExtractionDraft {
  version: 'candidate-extraction-v1' | 'candidate-extraction-v2' | 'candidate-extraction-v3' | 'candidate-extraction-v4' | 'candidate-extraction-v5'
  documentId: string
  extractor: 'deterministic-local-v1' | 'deterministic-local-v2' | 'deterministic-local-v3' | 'deterministic-local-v4'
  localPersonalDetails: LocalCandidatePersonalDetails
  fields: CandidateExtractionField[]
  projectExperiences: CandidateProjectExperienceDraft[]
  requiresReview: true
  createdAt: string
}

export interface CandidateProjectExperienceDraft {
  draftId: string
  title: string
  period: string | null
  role: string | null
  technologies: string[]
  summary: string
  confidence: number
  sources: CandidateFieldSource[]
}

export interface CandidateProfile {
  schemaVersion: 'candidate-profile-v1'
  id: string
  sourceDocumentId: string
  profileVersion: number
  reviewRevision: number
  localPersonalDetails: LocalCandidatePersonalDetails
  fields: Array<{
    key: CandidateFieldKey
    label: string
    value: string | null
    sourceLabels: string[]
  }>
  projectExperiences: CandidateProjectExperience[]
  confirmedAt: string
  confirmedBy: string
  containsDirectIdentifiers: boolean
}

const sourceSchema = z.object({
  blockId: z.string().min(1),
  sourceLabel: z.string().min(1),
  excerpt: z.string().max(240)
})

const candidateProjectExperienceDraftSchema = z.object({
  draftId: z.string().regex(/^[A-Za-z0-9_-]{1,80}$/u),
  title: z.string().min(1).max(160),
  period: z.string().min(1).max(120).nullable(),
  role: z.string().min(1).max(120).nullable(),
  technologies: z.array(z.string().min(1).max(80)).max(40),
  summary: z.string().min(1).max(1_500),
  confidence: z.number().min(0).max(1),
  sources: z.array(sourceSchema).max(100)
})

export const candidateExtractionDraftSchema: z.ZodType<CandidateExtractionDraft> = z.object({
  version: z.enum(['candidate-extraction-v1', 'candidate-extraction-v2', 'candidate-extraction-v3', 'candidate-extraction-v4', 'candidate-extraction-v5']),
  documentId: z.string().uuid(),
  extractor: z.enum(['deterministic-local-v1', 'deterministic-local-v2', 'deterministic-local-v3', 'deterministic-local-v4']),
  localPersonalDetails: localCandidatePersonalDetailsSchema.default({
    displayName: null,
    gender: null,
    birthDate: null,
    nationality: null,
    phone: null,
    email: null,
    address: null,
    education: null,
    major: null,
    graduationDate: null,
    degree: null
  }),
  fields: z.array(
    z.object({
      key: z.enum(candidateFieldKeys),
      label: z.string().min(1),
      value: z.string().nullable(),
      confidence: z.number().min(0).max(1),
      status: z.enum(['needs_review', 'missing']),
      sources: z.array(sourceSchema)
    })
  ),
  projectExperiences: z.array(candidateProjectExperienceDraftSchema).max(20).default([]),
  requiresReview: z.literal(true),
  createdAt: z.string().datetime()
})

export const candidateProfileSchema: z.ZodType<CandidateProfile> = z.object({
  schemaVersion: z.literal('candidate-profile-v1'),
  id: z.string().uuid(),
  sourceDocumentId: z.string().uuid(),
  profileVersion: z.number().int().positive(),
  reviewRevision: z.number().int().positive(),
  localPersonalDetails: localCandidatePersonalDetailsSchema.default({
    displayName: null,
    gender: null,
    birthDate: null,
    nationality: null,
    phone: null,
    email: null,
    address: null,
    education: null,
    major: null,
    graduationDate: null,
    degree: null
  }),
  fields: z.array(
    z.object({
      key: z.enum(candidateFieldKeys),
      label: z.string().min(1).max(80),
      value: z.string().max(500).nullable(),
      sourceLabels: z.array(z.string().min(1).max(180))
    })
  ),
  projectExperiences: z.array(candidateProjectExperienceSchema).max(20).default([]),
  confirmedAt: z.string().datetime(),
  confirmedBy: z.string().min(1).max(120),
  containsDirectIdentifiers: z.boolean()
})

export function candidateSearchTerms(query: string): string[] {
  const normalized = query
    .normalize('NFKC')
    .replace(/([A-Za-z0-9#+.]+)と(?=[A-Za-z0-9#+.]+)/gu, '$1 ')
    .replace(/[、,／/・]+/gu, ' ')
    .trim()
  const tokens = normalized.match(/"[^"]+"|'[^']+'|[^\s]+/gu) ?? []
  return [...new Set(tokens.map((term) => term.replace(/^['"]|['"]$/gu, '').trim()).filter((term) => term.length >= 2))]
}

const candidateFieldWeights: Record<CandidateFieldKey, number> = {
  skills: 3,
  experience_years: 1.8,
  availability: 1.5,
  rate: 1,
  japanese_level: 1.2,
  work_style: 1.5,
  role: 2.2,
  location: 1.3,
  work_authorization: 0.8
}

const candidateEmbeddingLabels: Record<CandidateFieldKey, string> = {
  skills: 'スキル',
  experience_years: '経験年数',
  availability: '稼働可能時期',
  rate: '希望単価',
  japanese_level: '日本語レベル',
  work_style: '勤務形態',
  role: 'ロール',
  location: '希望勤務地',
  work_authorization: '就労資格'
}

const candidateSemanticFieldKeys = new Set<CandidateFieldKey>(['skills', 'role', 'work_style', 'location'])

export function candidateProfileEmbeddingText(profile: CandidateProfile): string {
  return profile.fields
    .filter((field) => candidateSemanticFieldKeys.has(field.key) && Boolean(field.value?.trim()))
    .map((field) => `${candidateEmbeddingLabels[field.key]}: ${field.value!.normalize('NFKC').trim()}`)
    .join('\n')
    .slice(0, 6_000)
}

export function projectExperienceEmbeddingText(project: CandidateProjectExperience): string {
  return [
    `プロジェクト: ${project.title}`,
    project.period ? `期間: ${project.period}` : null,
    project.role ? `役割: ${project.role}` : null,
    project.technologies.length > 0 ? `技術: ${project.technologies.join(', ')}` : null,
    `内容: ${project.summary}`
  ].filter(Boolean).join('\n').normalize('NFKC').slice(0, 6_000)
}

export function cosineSimilarity(left: number[], right: number[]): number {
  if (left.length === 0 || left.length !== right.length) throw new Error('Embedding dimensions do not match.')
  let score = 0
  for (let index = 0; index < left.length; index += 1) {
    const leftValue = left[index]
    const rightValue = right[index]
    if (!Number.isFinite(leftValue) || !Number.isFinite(rightValue)) throw new Error('Embedding contains a non-finite value.')
    score += leftValue! * rightValue!
  }
  return score
}

const lexicalStopWords = new Set([
  '候補', '候補者', '人材', '探す', '検索', '経験', 'できる', 'したい', 'ください', '可能'
])

export function tokenizeCandidateSearchText(text: string): string[] {
  const normalized = text.normalize('NFKC').toLocaleLowerCase('ja-JP')
  const segments = normalized.match(/[a-z0-9][a-z0-9+#.]*|[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}ー]+/gu) ?? []
  const tokens: string[] = []
  for (const segment of segments) {
    if (/^[a-z0-9]/u.test(segment)) {
      if (segment.length >= 1) tokens.push(segment)
      continue
    }
    const characters = [...segment]
    if (characters.length >= 2 && characters.length <= 5 && !lexicalStopWords.has(segment)) tokens.push(segment)
    for (const width of [2, 3]) {
      if (characters.length < width) continue
      for (let index = 0; index <= characters.length - width; index += 1) {
        const token = characters.slice(index, index + width).join('')
        if (!lexicalStopWords.has(token)) tokens.push(token)
      }
    }
  }
  return tokens
}

interface CandidateBm25Document {
  profile: CandidateProfile
  termFrequency: Map<string, number>
  fieldTokens: Map<CandidateFieldKey, Set<string>>
  projectTokens: Map<string, Set<string>>
  length: number
  indexedFieldCount: number
}

function buildCandidateBm25Documents(profiles: CandidateProfile[]): CandidateBm25Document[] {
  return profiles.map((profile) => {
    const termFrequency = new Map<string, number>()
    const fieldTokens = new Map<CandidateFieldKey, Set<string>>()
    const projectTokens = new Map<string, Set<string>>()
    let length = 0
    let indexedFieldCount = 0
    for (const field of profile.fields) {
      if (!field.value) continue
      const tokens = tokenizeCandidateSearchText(field.value)
      if (tokens.length === 0) continue
      indexedFieldCount += 1
      fieldTokens.set(field.key, new Set(tokens))
      const weight = candidateFieldWeights[field.key]
      length += tokens.length * weight
      for (const token of tokens) termFrequency.set(token, (termFrequency.get(token) ?? 0) + weight)
    }
    for (const project of profile.projectExperiences) {
      const tokens = tokenizeCandidateSearchText(projectExperienceEmbeddingText(project))
      if (tokens.length === 0) continue
      const weight = 2.4
      indexedFieldCount += 1
      projectTokens.set(project.id, new Set(tokens))
      length += tokens.length * weight
      for (const token of tokens) termFrequency.set(token, (termFrequency.get(token) ?? 0) + weight)
    }
    return { profile, termFrequency, fieldTokens, projectTokens, length, indexedFieldCount }
  })
}

function candidateBm25Scores(documents: CandidateBm25Document[], query: string): Map<string, number> {
  const queryTokens = [...new Set(tokenizeCandidateSearchText(query))]
  const scores = new Map<string, number>()
  if (documents.length === 0 || queryTokens.length === 0) return scores
  const averageLength = documents.reduce((total, document) => total + document.length, 0) / documents.length || 1
  const k1 = 1.2
  const b = 0.75
  for (const token of queryTokens) {
    const documentFrequency = documents.filter((document) => document.termFrequency.has(token)).length
    if (documentFrequency === 0) continue
    const inverseDocumentFrequency = Math.log(
      1 + (documents.length - documentFrequency + 0.5) / (documentFrequency + 0.5)
    )
    for (const document of documents) {
      const frequency = document.termFrequency.get(token) ?? 0
      if (frequency <= 0) continue
      const normalization = frequency + k1 * (1 - b + b * document.length / averageLength)
      const contribution = inverseDocumentFrequency * (frequency * (k1 + 1)) / normalization
      scores.set(document.profile.id, (scores.get(document.profile.id) ?? 0) + contribution)
    }
  }
  return scores
}

type CandidateHardFilter = CandidateProfileSearchResult['retrieval']['hardFilters'][number]

function candidateFieldValue(profile: CandidateProfile, key: CandidateFieldKey): string | null {
  return profile.fields.find((field) => field.key === key)?.value?.normalize('NFKC').trim() || null
}

function hardFilterOutcome(
  actual: string | null,
  predicate: (value: string) => boolean | null
): CandidateHardFilter['outcome'] {
  if (!actual) return 'unknown'
  const result = predicate(actual)
  return result === null ? 'unknown' : result ? 'passed' : 'failed'
}

function requestedMaximumRate(term: string): number | null {
  const normalized = term.normalize('NFKC').replaceAll(' ', '')
  const range = normalized.match(/^(\d{2,3})(?:〜|~|-)(\d{2,3})万円$/u)
  if (range) return Number(range[2])
  const maximum = normalized.match(/^(?:上限)?(\d{2,3})万円(?:以下)?$/u)
  return maximum && (normalized.startsWith('上限') || normalized.endsWith('以下'))
    ? Number(maximum[1])
    : null
}

function candidateRateRange(value: string): { minimum: number; maximum: number } | null {
  const normalized = value.normalize('NFKC').replaceAll(' ', '')
  const range = normalized.match(/(\d{2,3})(?:〜|~|-)(\d{2,3})万(?:円)?/u)
  if (range) return { minimum: Number(range[1]), maximum: Number(range[2]) }
  const single = normalized.match(/(\d{2,3})万(?:円)?/u)
  return single ? { minimum: Number(single[1]), maximum: Number(single[1]) } : null
}

function availabilityPoint(value: string): { year: number | null; month: number } | 'immediate' | null {
  const normalized = value.normalize('NFKC')
  if (/(?:即日|随時|すぐ|即時)/u.test(normalized)) return 'immediate'
  const date = normalized.match(/(?:(20\d{2})年)?(1[0-2]|0?[1-9])月/u)
  return date ? { year: date[1] ? Number(date[1]) : null, month: Number(date[2]) } : null
}

function availabilityMeets(actual: string, requested: string): boolean | null {
  const actualPoint = availabilityPoint(actual)
  const requestedPoint = availabilityPoint(requested)
  if (actualPoint === 'immediate') return true
  if (!actualPoint || !requestedPoint || requestedPoint === 'immediate') return null
  if (actualPoint.year !== null && requestedPoint.year !== null) {
    return actualPoint.year * 12 + actualPoint.month <= requestedPoint.year * 12 + requestedPoint.month
  }
  const monthDifference = requestedPoint.month - actualPoint.month
  if (Math.abs(monthDifference) > 6) return null
  return monthDifference >= 0
}

function remoteWorkMeets(actual: string, requested: string): boolean | null {
  const normalizedActual = actual.normalize('NFKC').toLocaleLowerCase('ja-JP')
  const normalizedRequested = requested.normalize('NFKC').toLocaleLowerCase('ja-JP')
  const requestedDays = normalizedRequested.match(/^週(\d)日(?:リモート|在宅)$/u)?.[1]
  if (requestedDays) {
    if (/(?:フルリモート|完全在宅)/u.test(normalizedActual)) return true
    const actualDays = normalizedActual.match(/週(\d)日(?:リモート|在宅)/u)?.[1]
    if (actualDays) return Number(actualDays) >= Number(requestedDays)
    if (/(?:常駐のみ|出社のみ)/u.test(normalizedActual)) return false
    return null
  }
  if (normalizedRequested === 'フルリモート') {
    if (/(?:フルリモート|完全在宅)/u.test(normalizedActual)) return true
    if (/(?:常駐|出社)/u.test(normalizedActual)) return false
    return null
  }
  if (normalizedRequested === '常駐') {
    if (/(?:常駐可|出社可|オンサイト可)/u.test(normalizedActual)) return true
    if (/(?:フルリモートのみ|完全在宅のみ)/u.test(normalizedActual)) return false
    return null
  }
  if (normalizedRequested === 'リモート可') {
    if (/(?:リモート|在宅)/u.test(normalizedActual)) return true
    if (/(?:常駐のみ|出社のみ)/u.test(normalizedActual)) return false
  }
  return null
}

function japaneseLevelMeets(actual: string, requested: string): boolean | null {
  if (/(?:ネイティブ|母語)/u.test(actual.normalize('NFKC'))) return true
  const actualLevel = actual.normalize('NFKC').toLocaleUpperCase('en-US').match(/N([1-5])/u)?.[1]
  const requestedLevel = requested.normalize('NFKC').toLocaleUpperCase('en-US').match(/^N([1-5])(?:相当)?$/u)?.[1]
  if (!actualLevel || !requestedLevel) return null
  return Number(actualLevel) <= Number(requestedLevel)
}

interface CoarseLocationDescriptor {
  macro: 'hokkaido' | 'tohoku' | 'kanto' | 'chubu' | 'kansai' | 'chugoku' | 'shikoku' | 'kyushu'
  place: string | null
  broad: boolean
}

const coarseLocationAliases: ReadonlyArray<{
  pattern: RegExp
  macro: CoarseLocationDescriptor['macro']
  place: string | null
  broad?: boolean
}> = [
  { pattern: /全国|場所不問/u, macro: 'kanto', place: null, broad: true },
  { pattern: /北海道/u, macro: 'hokkaido', place: 'hokkaido' },
  { pattern: /札幌/u, macro: 'hokkaido', place: 'sapporo' },
  { pattern: /東北/u, macro: 'tohoku', place: null, broad: true },
  { pattern: /宮城|仙台/u, macro: 'tohoku', place: 'miyagi' },
  { pattern: /関東|首都圏/u, macro: 'kanto', place: null, broad: true },
  { pattern: /東京|都内|23区|品川|新宿|渋谷|大手町|豊洲|六本木|池袋/u, macro: 'kanto', place: 'tokyo' },
  { pattern: /神奈川|横浜|川崎/u, macro: 'kanto', place: 'kanagawa' },
  { pattern: /埼玉|大宮/u, macro: 'kanto', place: 'saitama' },
  { pattern: /千葉|船橋/u, macro: 'kanto', place: 'chiba' },
  { pattern: /中部|東海/u, macro: 'chubu', place: null, broad: true },
  { pattern: /愛知|名古屋/u, macro: 'chubu', place: 'aichi' },
  { pattern: /静岡/u, macro: 'chubu', place: 'shizuoka' },
  { pattern: /関西|近畿/u, macro: 'kansai', place: null, broad: true },
  { pattern: /大阪|梅田/u, macro: 'kansai', place: 'osaka' },
  { pattern: /(?<!東)京都/u, macro: 'kansai', place: 'kyoto' },
  { pattern: /兵庫|神戸/u, macro: 'kansai', place: 'hyogo' },
  { pattern: /中国地方/u, macro: 'chugoku', place: null, broad: true },
  { pattern: /広島/u, macro: 'chugoku', place: 'hiroshima' },
  { pattern: /四国/u, macro: 'shikoku', place: null, broad: true },
  { pattern: /九州/u, macro: 'kyushu', place: null, broad: true },
  { pattern: /福岡|博多/u, macro: 'kyushu', place: 'fukuoka' }
]

function locationRequirement(term: string): string | null {
  const normalized = term.normalize('NFKC').trim()
  const match = normalized.match(/^(?:勤務地|現場|勤務先)\s*[:：=は]\s*([^\d\n]{1,40})$/u)
  if (!match?.[1]) return null
  const value = match[1].replace(/(?:勤務|通勤)(?:可|可能)?$/u, '').trim()
  if (!value || /(?:丁目|番地|号|〒)/u.test(value)) return null
  return value
}

function coarseCandidateLocationDescriptors(value: string): CoarseLocationDescriptor[] {
  const normalized = value.normalize('NFKC')
  if (/全国|場所不問/u.test(normalized)) {
    return [
      { macro: 'hokkaido', place: null, broad: true },
      { macro: 'tohoku', place: null, broad: true },
      { macro: 'kanto', place: null, broad: true },
      { macro: 'chubu', place: null, broad: true },
      { macro: 'kansai', place: null, broad: true },
      { macro: 'chugoku', place: null, broad: true },
      { macro: 'shikoku', place: null, broad: true },
      { macro: 'kyushu', place: null, broad: true }
    ]
  }
  return coarseLocationAliases.flatMap((alias) => alias.pattern.test(normalized)
    ? [{ macro: alias.macro, place: alias.place, broad: alias.broad ?? false }]
    : [])
}

export function coarseCandidateLocationMeets(actual: string, requested: string): boolean | null {
  const normalizedActual = actual.normalize('NFKC')
  const normalizedRequested = requested.normalize('NFKC')
  if (normalizedActual.includes(normalizedRequested) || normalizedRequested.includes(normalizedActual)) return true
  if (new RegExp(`${normalizedRequested.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&')}(?:不可|NG)`, 'u').test(normalizedActual)) return false
  const actualLocations = coarseCandidateLocationDescriptors(normalizedActual)
  const requestedLocations = coarseCandidateLocationDescriptors(normalizedRequested)
  if (actualLocations.length === 0 || requestedLocations.length === 0) return null
  if (requestedLocations.some((requestedLocation) => actualLocations.some((actualLocation) =>
    actualLocation.macro === requestedLocation.macro &&
    (actualLocation.broad || (actualLocation.place !== null && actualLocation.place === requestedLocation.place))
  ))) return true
  const actualMacros = new Set(actualLocations.map((location) => location.macro))
  const requestedMacros = new Set(requestedLocations.map((location) => location.macro))
  if ([...actualMacros].every((macro) => !requestedMacros.has(macro))) return false
  return null
}

export function normalizeCandidateWorkAuthorization(value: string): CandidateWorkAuthorization | null {
  const normalized = value.normalize('NFKC').replace(/\s+/gu, '')
  if (/(?:就労不可|就労資格なし|在留期限切れ|資格なし)/u.test(normalized)) return '就労不可'
  if (/(?:資格外活動|週28時間|留学|家族滞在)/u.test(normalized)) return '資格外活動のみ（制限あり）'
  if (/(?:就労制限なし|永住者?|特別永住|定住者?|日本人の配偶者|永住者の配偶者)/u.test(normalized)) return '就労制限なし'
  if (/(?:技術・?人文知識・?国際業務|高度専門職|企業内転勤|技能|就労ビザ|就労資格あり)/u.test(normalized)) {
    return '就労資格あり（職種・期限要確認）'
  }
  return null
}

function workAuthorizationRequirement(term: string): string | null {
  const normalized = term.normalize('NFKC').trim()
  const prefixed = normalized.match(/^就労資格\s*[:：=]\s*(.{2,50})$/u)?.[1]?.trim()
  const value = prefixed ?? normalized
  return /^(?:日本で就労可能|就労資格必須|就労資格あり|就労制限なし|ビザサポートなし|資格外活動不可|週28時間制限不可)$/u.test(value)
    ? value
    : null
}

function workAuthorizationMeets(actual: string, requested: string): boolean | null {
  const category = (candidateWorkAuthorizationValues as readonly string[]).includes(actual)
    ? actual as CandidateWorkAuthorization
    : normalizeCandidateWorkAuthorization(actual)
  if (!category) return null
  if (category === '就労不可') return false
  if (/^(?:日本で就労可能|就労資格必須|就労資格あり)$/u.test(requested)) {
    return category === '就労制限なし' || category === '就労資格あり（職種・期限要確認）'
  }
  if (/^(?:就労制限なし|ビザサポートなし|資格外活動不可|週28時間制限不可)$/u.test(requested)) {
    if (category === '就労制限なし') return true
    if (category === '資格外活動のみ（制限あり）') return false
    return null
  }
  return null
}

function isHardFilterTerm(term: string): boolean {
  const normalized = term.normalize('NFKC').trim()
  return /^(?:\d+(?:\.\d+)?)年以上$/u.test(normalized) ||
    requestedMaximumRate(normalized) !== null ||
    /^(?:(?:20\d{2})年)?(?:1[0-2]|0?[1-9])月$/u.test(normalized) ||
    /^(?:週\d日(?:リモート|在宅)|フルリモート|リモート可|常駐)$/u.test(normalized) ||
    /^N[1-5](?:相当)?$/iu.test(normalized) ||
    locationRequirement(normalized) !== null ||
    workAuthorizationRequirement(normalized) !== null
}

function hardFilterForTerm(profile: CandidateProfile, term: string): CandidateHardFilter | null {
  const normalized = term.normalize('NFKC').trim()
  const requestedYears = normalized.match(/^(\d+(?:\.\d+)?)年以上$/u)?.[1]
  if (requestedYears) {
    const actual = candidateFieldValue(profile, 'experience_years')
    return {
      type: 'minimum-experience-years',
      requested: term,
      actual,
      outcome: hardFilterOutcome(actual, (value) => {
        const years = value.match(/(\d+(?:\.\d+)?)年/u)?.[1]
        return years ? Number(years) >= Number(requestedYears) : null
      })
    }
  }
  const maximumRate = requestedMaximumRate(normalized)
  if (maximumRate !== null) {
    const actual = candidateFieldValue(profile, 'rate')
    return {
      type: 'maximum-rate',
      requested: term,
      actual,
      outcome: hardFilterOutcome(actual, (value) => {
        const range = candidateRateRange(value)
        if (!range) return null
        if (range.minimum > maximumRate) return false
        if (range.maximum <= maximumRate) return true
        return null
      })
    }
  }
  if (/^(?:(?:20\d{2})年)?(?:1[0-2]|0?[1-9])月$/u.test(normalized)) {
    const actual = candidateFieldValue(profile, 'availability')
    return {
      type: 'availability-by',
      requested: term,
      actual,
      outcome: hardFilterOutcome(actual, (value) => availabilityMeets(value, normalized))
    }
  }
  if (/^(?:週\d日(?:リモート|在宅)|フルリモート|リモート可|常駐)$/u.test(normalized)) {
    const actual = candidateFieldValue(profile, 'work_style')
    return {
      type: 'remote-work',
      requested: term,
      actual,
      outcome: hardFilterOutcome(actual, (value) => remoteWorkMeets(value, normalized))
    }
  }
  if (/^N[1-5](?:相当)?$/iu.test(normalized)) {
    const actual = candidateFieldValue(profile, 'japanese_level')
    return {
      type: 'japanese-level',
      requested: term,
      actual,
      outcome: hardFilterOutcome(actual, (value) => japaneseLevelMeets(value, normalized))
    }
  }
  const requestedLocation = locationRequirement(normalized)
  if (requestedLocation) {
    const actual = candidateFieldValue(profile, 'location')
    return {
      type: 'location',
      requested: term,
      actual,
      outcome: hardFilterOutcome(actual, (value) => coarseCandidateLocationMeets(value, requestedLocation))
    }
  }
  const requestedAuthorization = workAuthorizationRequirement(normalized)
  if (requestedAuthorization) {
    const actual = candidateFieldValue(profile, 'work_authorization')
    return {
      type: 'work-authorization',
      requested: term,
      actual,
      outcome: hardFilterOutcome(actual, (value) => workAuthorizationMeets(value, requestedAuthorization))
    }
  }
  return null
}

function hardFilterEvidence(profile: CandidateProfile, terms: string[]): CandidateProfileSearchResult['retrieval']['hardFilters'] {
  return terms.flatMap((term) => {
    const filter = hardFilterForTerm(profile, term)
    return filter ? [filter] : []
  })
}

export function candidateHardFilterEvidence(
  profile: CandidateProfile,
  query: string
): CandidateProfileSearchResult['retrieval']['hardFilters'] {
  return hardFilterEvidence(profile, candidateSearchTerms(query))
}

function fieldMatchesTermLexically(
  document: CandidateBm25Document,
  field: CandidateProfile['fields'][number],
  term: string
): boolean {
  if (!field.value) return false
  if (fieldMatchStrength(field.value, term, field.key) > 0) return true
  const termTokens = [...new Set(tokenizeCandidateSearchText(term))]
  const fieldTokens = document.fieldTokens.get(field.key)
  if (!fieldTokens || termTokens.length === 0) return false
  const overlap = termTokens.filter((token) => fieldTokens.has(token)).length
  const requiredOverlap = termTokens.length <= 2 ? termTokens.length : Math.ceil(termTokens.length * 0.45)
  return overlap >= Math.max(1, requiredOverlap)
}

function projectMatchesTermLexically(
  document: CandidateBm25Document,
  project: CandidateProjectExperience,
  term: string
): boolean {
  const normalizedText = projectExperienceEmbeddingText(project)
  if (fieldMatchStrength(normalizedText, term) > 0) return true
  const termTokens = [...new Set(tokenizeCandidateSearchText(term))]
  const tokens = document.projectTokens.get(project.id)
  if (!tokens || termTokens.length === 0) return false
  const overlap = termTokens.filter((token) => tokens.has(token)).length
  return overlap >= Math.max(1, termTokens.length <= 2 ? termTokens.length : Math.ceil(termTokens.length * 0.45))
}

function fieldMatchStrength(value: string, term: string, key?: CandidateFieldKey): number {
  const normalizedValue = value.normalize('NFKC').toLocaleLowerCase('ja-JP')
  const normalizedTerm = term.normalize('NFKC').toLocaleLowerCase('ja-JP')
  if (key === 'experience_years') {
    const requiredYears = normalizedTerm.match(/^(\d+(?:\.\d+)?)年以上$/u)?.[1]
    const actualYears = normalizedValue.match(/(\d+(?:\.\d+)?)年/u)?.[1]
    if (requiredYears && actualYears) return Number(actualYears) >= Number(requiredYears) ? 1 : 0
  }
  if (normalizedValue === normalizedTerm) return 1
  if (/^[a-z0-9#+.]+$/iu.test(normalizedTerm)) {
    const escaped = normalizedTerm.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&')
    if (new RegExp(`(?:^|[^a-z0-9#+.])${escaped}(?:$|[^a-z0-9#+.])`, 'iu').test(normalizedValue)) return 0.95
    return 0
  }
  return normalizedValue.includes(normalizedTerm) ? 0.75 : 0
}

export function searchConfirmedCandidateProfiles(
  profiles: CandidateProfile[],
  query: string,
  maxResults = 30,
  vectorScores?: ReadonlyMap<string, number>,
  vectorProjectEvidence?: ReadonlyMap<string, CandidateProjectMatchEvidence>
): CandidateProfileSearchResult[] {
  const terms = candidateSearchTerms(query)
  const documents = buildCandidateBm25Documents(profiles)
  const bm25Scores = candidateBm25Scores(documents, query)
  const candidates = documents
    .flatMap((document) => {
      const hardFilters = hardFilterEvidence(document.profile, terms)
      if (hardFilters.some((filter) => filter.outcome === 'failed')) return []
      const evidence = document.profile.fields.filter((field) =>
        field.value && terms.some((term) => fieldMatchesTermLexically(document, field, term))
      )
      const projectMatches = document.profile.projectExperiences.map((project) => ({
        project,
        matchedTerms: terms.filter((term) => projectMatchesTermLexically(document, project, term))
      })).filter((match) => match.matchedTerms.length > 0)
      const lexicalProject = projectMatches.toSorted((a, b) =>
        b.matchedTerms.length - a.matchedTerms.length || a.project.id.localeCompare(b.project.id)
      )[0]
      const matchedTerms = terms.filter((term) =>
        hardFilters.some((filter) => filter.requested === term && filter.outcome === 'passed') ||
        document.profile.fields.some((field) => fieldMatchesTermLexically(document, field, term)) ||
        document.profile.projectExperiences.some((project) => projectMatchesTermLexically(document, project, term))
      )
      const matchStrength = terms.length === 0
        ? null
        : terms.reduce((total, term) => {
            const best = Math.max(
              0,
              ...document.profile.fields.map((field) => field.value ? fieldMatchStrength(field.value, term, field.key) : 0),
              ...document.profile.projectExperiences.map((project) =>
                projectMatchesTermLexically(document, project, term) ? 0.8 : 0
              )
            )
            return total + (best > 0 ? best : matchedTerms.includes(term) ? 0.6 : 0)
          }, 0) / terms.length
      const bm25Score = bm25Scores.get(document.profile.id) ?? 0
      return [{
        id: document.profile.id,
        sourceDocumentId: document.profile.sourceDocumentId,
        version: document.profile.profileVersion,
        status: 'current' as const,
        confirmedAt: document.profile.confirmedAt,
        confirmedBy: document.profile.confirmedBy,
        containsDirectIdentifiers: document.profile.containsDirectIdentifiers,
        anonymousLabel: `候補者 ${document.profile.id.slice(0, 8).toLocaleUpperCase('en-US')}`,
        fields: document.profile.fields,
        projectExperiences: document.profile.projectExperiences,
        matchScore: matchStrength === null ? null : Math.round(matchStrength * 100),
        matchedTerms,
        evidence,
        projectEvidence: lexicalProject ? {
          ...lexicalProject.project,
          matchType: 'lexical' as const,
          matchedTerms: lexicalProject.matchedTerms,
          vectorScore: null
        } : null,
        retrieval: {
          strategy: 'hard-filter-bm25-v1' as const,
          hardFilterPolicyVersion: 'tri-state-v3' as const,
          bm25Score: terms.length === 0 ? null : Math.round(bm25Score * 1000) / 1000,
          vectorScore: null,
          fusionScore: null,
          rerankerScore: null,
          bm25Rank: null,
          vectorRank: null,
          preRerankRank: null,
          rerankerRank: null,
          rank: null,
          termCoverage: terms.length === 0 ? null : Math.round(matchedTerms.length / terms.length * 100),
          indexedFieldCount: document.indexedFieldCount,
          hardFilters
        }
      }]
    })
  if (terms.length === 0) {
    return candidates
      .toSorted((a, b) => b.confirmedAt.localeCompare(a.confirmedAt))
      .slice(0, Math.max(1, Math.min(100, maxResults)))
  }
  const structuredOnlyQuery = terms.length > 0 && terms.every(isHardFilterTerm)
  const lexicalRanking = candidates
    .filter((result) => result.matchedTerms.length > 0 || structuredOnlyQuery)
    .toSorted((a, b) =>
      a.retrieval.hardFilters.filter((filter) => filter.outcome === 'unknown').length -
        b.retrieval.hardFilters.filter((filter) => filter.outcome === 'unknown').length ||
      (b.retrieval.bm25Score ?? 0) - (a.retrieval.bm25Score ?? 0) ||
      (b.matchScore ?? 0) - (a.matchScore ?? 0) ||
      b.confirmedAt.localeCompare(a.confirmedAt)
    )
  if (!vectorScores) {
    return lexicalRanking
      .map((result, index) => ({
        ...result,
        retrieval: { ...result.retrieval, bm25Rank: index + 1, rank: index + 1 }
      }))
      .slice(0, Math.max(1, Math.min(100, maxResults)))
  }
  const bm25Ranks = new Map(lexicalRanking.map((result, index) => [result.id, index + 1]))
  const vectorRanking = candidates
    .flatMap((result) => {
      const vectorScore = vectorScores.get(result.id)
      return Number.isFinite(vectorScore) ? [{ id: result.id, score: vectorScore! }] : []
    })
    .toSorted((a, b) => b.score - a.score || a.id.localeCompare(b.id))
  const vectorRanks = new Map(vectorRanking.map((result, index) => [result.id, index + 1]))
  const rrfK = 60
  return candidates
    .flatMap((result) => {
      const bm25Rank = bm25Ranks.get(result.id) ?? null
      const vectorRank = vectorRanks.get(result.id) ?? null
      if (bm25Rank === null && vectorRank === null) return []
      const vectorScore = vectorScores.get(result.id) ?? null
      const semanticProject = vectorProjectEvidence?.get(result.id) ?? null
      const combinedProjectEvidence = semanticProject
        ? {
            ...semanticProject,
            matchType: result.projectEvidence?.id === semanticProject.id ? 'hybrid' as const : 'semantic' as const,
            matchedTerms: result.projectEvidence?.id === semanticProject.id
              ? [...new Set([...result.projectEvidence.matchedTerms, ...semanticProject.matchedTerms])]
              : semanticProject.matchedTerms
          }
        : result.projectEvidence
      const fusionScore = (bm25Rank === null ? 0 : 1 / (rrfK + bm25Rank)) +
        (vectorRank === null ? 0 : 1 / (rrfK + vectorRank))
      return [{
        ...result,
        projectEvidence: combinedProjectEvidence,
        matchScore: result.matchScore ?? (vectorScore === null ? null : Math.round(vectorScore * 100)),
        retrieval: {
          ...result.retrieval,
          strategy: 'hard-filter-hybrid-rrf-v1' as const,
          vectorScore: vectorScore === null ? null : Math.round(vectorScore * 10_000) / 10_000,
          fusionScore: Math.round(fusionScore * 1_000_000) / 1_000_000,
          bm25Rank,
          vectorRank
        }
      }]
    })
    .toSorted((a, b) =>
      (b.retrieval.fusionScore ?? 0) - (a.retrieval.fusionScore ?? 0) ||
      (b.retrieval.vectorScore ?? 0) - (a.retrieval.vectorScore ?? 0) ||
      (b.retrieval.bm25Score ?? 0) - (a.retrieval.bm25Score ?? 0) ||
      b.confirmedAt.localeCompare(a.confirmedAt)
    )
    .map((result, index) => ({
      ...result,
      retrieval: { ...result.retrieval, rank: index + 1 }
    }))
    .slice(0, Math.max(1, Math.min(100, maxResults)))
}

export function evaluateCandidateRetrieval(
  profiles: CandidateProfile[],
  cases: Array<{ query: string; relevantSourceDocumentIds: string[] }>,
  k = 20
): { recallAtK: number; evaluatedCases: number; relevantCandidates: number; retrievedRelevantCandidates: number } {
  let relevantCandidates = 0
  let retrievedRelevantCandidates = 0
  for (const testCase of cases) {
    const relevant = new Set(testCase.relevantSourceDocumentIds)
    const retrieved = new Set(
      searchConfirmedCandidateProfiles(profiles, testCase.query, k).map((result) => result.sourceDocumentId)
    )
    relevantCandidates += relevant.size
    retrievedRelevantCandidates += [...relevant].filter((id) => retrieved.has(id)).length
  }
  return {
    recallAtK: relevantCandidates === 0 ? 1 : retrievedRelevantCandidates / relevantCandidates,
    evaluatedCases: cases.length,
    relevantCandidates,
    retrievedRelevantCandidates
  }
}

function normalizedMetric(value: number): number {
  return Math.round(value * 10_000) / 10_000
}

function binaryNdcgAt20(results: CandidateProfileSearchResult[], relevantLabels: ReadonlySet<string>): number {
  const dcg = results.slice(0, 20).reduce((score, result, index) =>
    score + (relevantLabels.has(result.anonymousLabel) ? 1 / Math.log2(index + 2) : 0), 0)
  const idealCount = Math.min(20, relevantLabels.size)
  const idcg = Array.from({ length: idealCount }, (_, index) => 1 / Math.log2(index + 2))
    .reduce((score, gain) => score + gain, 0)
  return idcg === 0 ? 0 : dcg / idcg
}

export async function evaluateSesCandidateBenchmark(
  benchmark: SesCandidateBenchmark,
  availableCandidateLabels: ReadonlySet<string>,
  search: (query: string, maxResults: number) => Promise<CandidateProfileSearchResult[]>,
  model: {
    id: string
    revision: string
    algorithmVersion?: CandidateEvaluationReport['algorithmVersion']
  },
  now = new Date()
): Promise<CandidateEvaluationReport> {
  const datasetHash = createHash('sha256').update(JSON.stringify(benchmark), 'utf8').digest('hex')
  const cases: CandidateEvaluationReport['cases'] = []
  let relevantCandidates = 0
  let retrievedRelevantCandidates = 0
  let expectedProjectEvidence = 0
  let matchedProjectEvidence = 0
  let recallTotal = 0
  let ndcgTotal = 0
  const algorithmVersion = model.algorithmVersion ?? 'hard-filter-hybrid-rrf-v1'
  for (const testCase of benchmark.cases) {
    const results = await search(testCase.query, 20)
    const relevant = new Set(testCase.relevantCandidateLabels)
    const expectedProject = new Set(testCase.expectedProjectEvidenceLabels)
    const retrievedRelevant = results.filter((result) => relevant.has(result.anonymousLabel))
    const matchedProjects = results.filter((result) =>
      expectedProject.has(result.anonymousLabel) && result.projectEvidence !== null
    ).length
    const missingCandidateLabels = testCase.relevantCandidateLabels.filter((label) => !availableCandidateLabels.has(label))
    const recall = retrievedRelevant.length / relevant.size
    const ndcg = binaryNdcgAt20(results, relevant)
    relevantCandidates += relevant.size
    retrievedRelevantCandidates += retrievedRelevant.length
    expectedProjectEvidence += expectedProject.size
    matchedProjectEvidence += matchedProjects
    recallTotal += recall
    ndcgTotal += ndcg
    cases.push({
      caseId: testCase.id,
      queryHash: createHash('sha256').update(testCase.query.normalize('NFKC').trim(), 'utf8').digest('hex'),
      relevantCandidates: relevant.size,
      retrievedRelevantCandidates: retrievedRelevant.length,
      recallAt20: normalizedMetric(recall),
      ndcgAt20: normalizedMetric(ndcg),
      expectedProjectEvidence: expectedProject.size,
      matchedProjectEvidence: matchedProjects,
      missingCandidateLabels
    })
  }
  const metrics = {
    caseCount: benchmark.cases.length,
    relevantCandidates,
    retrievedRelevantCandidates,
    recallAt20: normalizedMetric(recallTotal / benchmark.cases.length),
    ndcgAt20: normalizedMetric(ndcgTotal / benchmark.cases.length),
    expectedProjectEvidence,
    matchedProjectEvidence,
    projectEvidenceCoverageAt20: expectedProjectEvidence === 0
      ? null
      : normalizedMetric(matchedProjectEvidence / expectedProjectEvidence),
    missingCandidateReferences: cases.reduce((total, result) => total + result.missingCandidateLabels.length, 0)
  }
  const metricThresholdsPassed = metrics.recallAt20 >= benchmark.thresholds.recallAt20 &&
    metrics.ndcgAt20 >= benchmark.thresholds.ndcgAt20 &&
    (metrics.projectEvidenceCoverageAt20 === null ||
      metrics.projectEvidenceCoverageAt20 >= benchmark.thresholds.projectEvidenceCoverageAt20)
  const status: CandidateEvaluationReport['status'] = metrics.missingCandidateReferences > 0
    ? 'invalid-references'
    : metrics.caseCount < benchmark.thresholds.minimumCases
      ? 'insufficient-cases'
      : metricThresholdsPassed ? 'passed' : 'failed'
  return {
    version: 'candidate-evaluation-report-v1',
    id: randomUUID(),
    datasetId: benchmark.id,
    datasetHash,
    status,
    algorithmVersion,
    hardFilterPolicyVersion: 'tri-state-v3',
    modelId: model.id,
    modelRevision: model.revision,
    evaluatedAt: now.toISOString(),
    networkAccess: false,
    cloudUsed: false,
    metrics,
    thresholds: benchmark.thresholds,
    cases
  }
}

export interface CandidateEmbeddingPort {
  embedQueries(texts: string[]): Promise<number[][]>
  embedPassages(texts: string[]): Promise<number[][]>
}

export interface CandidateRerankerPort {
  rerank(query: string, candidates: Array<{ id: string; text: string }>): Promise<ReadonlyMap<string, number>>
}

export interface CandidateEmbeddingCacheRecord {
  profileId: string
  modelId: string
  modelRevision: string
  contentHash: string
  vector: number[]
  updatedAt: string
}

export interface CandidateProjectEmbeddingCacheRecord extends CandidateEmbeddingCacheRecord {
  projectId: string
}

export interface CandidateEmbeddingCachePort {
  listCandidateProfileEmbeddings(modelId: string, modelRevision: string): CandidateEmbeddingCacheRecord[]
  saveCandidateProfileEmbeddings(records: Array<Omit<CandidateEmbeddingCacheRecord, 'updatedAt'>>): void
  listCandidateProjectEmbeddings(modelId: string, modelRevision: string): CandidateProjectEmbeddingCacheRecord[]
  saveCandidateProjectEmbeddings(records: Array<Omit<CandidateProjectEmbeddingCacheRecord, 'updatedAt'>>): void
}

export interface LocalHybridCandidateRetrievalOptions {
  modelId: string
  modelRevision: string
  dimension: number
  minimumVectorScore?: number
  maximumVectorCandidates?: number
  maximumRerankCandidates?: number
}

export function candidateProfileRerankerText(profile: CandidateProfile): string {
  return [
    candidateProfileEmbeddingText(profile),
    ...profile.projectExperiences.map(projectExperienceEmbeddingText)
  ].filter(Boolean).join('\n\n').slice(0, 6_000)
}

export function applyLocalRerankerScores(
  results: CandidateProfileSearchResult[],
  scores: ReadonlyMap<string, number>
): CandidateProfileSearchResult[] {
  const scored = results.filter((result) => Number.isFinite(scores.get(result.id)))
    .toSorted((left, right) =>
      scores.get(right.id)! - scores.get(left.id)! ||
      (left.retrieval.rank ?? Number.MAX_SAFE_INTEGER) - (right.retrieval.rank ?? Number.MAX_SAFE_INTEGER)
    )
  const rerankerRanks = new Map(scored.map((result, index) => [result.id, index + 1]))
  const ordered = [...scored, ...results.filter((result) => !rerankerRanks.has(result.id))]
  return ordered.map((result, index) => ({
    ...result,
    retrieval: {
      ...result.retrieval,
      strategy: 'hard-filter-hybrid-local-rerank-v1',
      rerankerScore: scores.has(result.id) ? Math.round(scores.get(result.id)! * 10_000) / 10_000 : null,
      preRerankRank: result.retrieval.rank,
      rerankerRank: rerankerRanks.get(result.id) ?? null,
      rank: index + 1
    }
  }))
}

export class LocalHybridCandidateRetrieval {
  private readonly minimumVectorScore: number
  private readonly maximumVectorCandidates: number
  private readonly maximumRerankCandidates: number

  constructor(
    private readonly embeddings: CandidateEmbeddingPort,
    private readonly cache: CandidateEmbeddingCachePort,
    private readonly options: LocalHybridCandidateRetrievalOptions,
    private readonly reranker?: CandidateRerankerPort
  ) {
    this.minimumVectorScore = options.minimumVectorScore ?? 0.78
    this.maximumVectorCandidates = options.maximumVectorCandidates ?? 50
    this.maximumRerankCandidates = options.maximumRerankCandidates ?? 20
  }

  async search(
    profiles: CandidateProfile[],
    query: string,
    maxResults = 30
  ): Promise<CandidateProfileSearchResult[]> {
    if (candidateSearchTerms(query).length === 0) {
      return searchConfirmedCandidateProfiles(profiles, query, maxResults)
    }
    const queryTerms = candidateSearchTerms(query)
    const eligibleProfiles = profiles.filter((profile) =>
      candidateHardFilterEvidence(profile, query).every((filter) => filter.outcome !== 'failed')
    )
    if (eligibleProfiles.length === 0) return []
    if (queryTerms.every(isHardFilterTerm)) {
      return searchConfirmedCandidateProfiles(eligibleProfiles, query, maxResults)
    }
    const profileDocuments = eligibleProfiles.map((profile) => {
      const text = candidateProfileEmbeddingText(profile)
      return {
        profile,
        text,
        contentHash: createHash('sha256').update(text, 'utf8').digest('hex')
      }
    }).filter((document) => document.text.length > 0)
    const projectDocuments = eligibleProfiles.flatMap((profile) => profile.projectExperiences.map((project) => {
      const text = projectExperienceEmbeddingText(project)
      return {
        profile,
        project,
        text,
        contentHash: createHash('sha256').update(text, 'utf8').digest('hex')
      }
    }).filter((document) => document.text.length > 0))
    if (profileDocuments.length === 0 && projectDocuments.length === 0) {
      return searchConfirmedCandidateProfiles(eligibleProfiles, query, maxResults)
    }

    const storedProfiles = new Map(
      this.cache
        .listCandidateProfileEmbeddings(this.options.modelId, this.options.modelRevision)
        .filter((record) => record.vector.length === this.options.dimension)
        .map((record) => [record.profileId, record])
    )
    const profileVectors = new Map<string, number[]>()
    const missingProfiles = profileDocuments.filter((document) => {
      const cached = storedProfiles.get(document.profile.id)
      if (!cached || cached.contentHash !== document.contentHash) return true
      profileVectors.set(document.profile.id, cached.vector)
      return false
    })
    if (missingProfiles.length > 0) {
      const generated = await this.embeddings.embedPassages(missingProfiles.map((document) => document.text))
      if (generated.length !== missingProfiles.length || generated.some((vector) => vector.length !== this.options.dimension)) {
        throw new Error('Local embedding worker returned an invalid candidate vector batch.')
      }
      const records = missingProfiles.map((document, index) => ({
        profileId: document.profile.id,
        modelId: this.options.modelId,
        modelRevision: this.options.modelRevision,
        contentHash: document.contentHash,
        vector: generated[index]!
      }))
      this.cache.saveCandidateProfileEmbeddings(records)
      records.forEach((record) => profileVectors.set(record.profileId, record.vector))
    }
    const storedProjects = new Map(
      this.cache
        .listCandidateProjectEmbeddings(this.options.modelId, this.options.modelRevision)
        .filter((record) => record.vector.length === this.options.dimension)
        .map((record) => [`${record.profileId}\u0000${record.projectId}`, record])
    )
    const projectVectors = new Map<string, number[]>()
    const missingProjects = projectDocuments.filter((document) => {
      const key = `${document.profile.id}\u0000${document.project.id}`
      const cached = storedProjects.get(key)
      if (!cached || cached.contentHash !== document.contentHash) return true
      projectVectors.set(key, cached.vector)
      return false
    })
    if (missingProjects.length > 0) {
      const generated = await this.embeddings.embedPassages(missingProjects.map((document) => document.text))
      if (generated.length !== missingProjects.length || generated.some((vector) => vector.length !== this.options.dimension)) {
        throw new Error('Local embedding worker returned an invalid project vector batch.')
      }
      const records = missingProjects.map((document, index) => ({
        profileId: document.profile.id,
        projectId: document.project.id,
        modelId: this.options.modelId,
        modelRevision: this.options.modelRevision,
        contentHash: document.contentHash,
        vector: generated[index]!
      }))
      this.cache.saveCandidateProjectEmbeddings(records)
      records.forEach((record) => projectVectors.set(`${record.profileId}\u0000${record.projectId}`, record.vector))
    }
    const queryVector = (await this.embeddings.embedQueries([query]))[0]
    if (!queryVector || queryVector.length !== this.options.dimension) {
      throw new Error('Local embedding worker returned an invalid query vector.')
    }
    const candidateScores = new Map<string, number>()
    for (const document of profileDocuments) {
      candidateScores.set(document.profile.id, cosineSimilarity(queryVector, profileVectors.get(document.profile.id)!))
    }
    const bestProjectEvidence = new Map<string, CandidateProjectMatchEvidence>()
    for (const document of projectDocuments) {
      const score = cosineSimilarity(
        queryVector,
        projectVectors.get(`${document.profile.id}\u0000${document.project.id}`)!
      )
      if (score > (candidateScores.get(document.profile.id) ?? Number.NEGATIVE_INFINITY)) {
        candidateScores.set(document.profile.id, score)
      }
      const current = bestProjectEvidence.get(document.profile.id)
      if (!current || score > (current.vectorScore ?? Number.NEGATIVE_INFINITY)) {
        bestProjectEvidence.set(document.profile.id, {
          ...document.project,
          matchType: 'semantic',
          matchedTerms: [],
          vectorScore: Math.round(score * 10_000) / 10_000
        })
      }
    }
    const rankedVectorScores = [...candidateScores.entries()]
        .map(([profileId, score]) => ({ profileId, score }))
        .filter((candidate) => candidate.score >= this.minimumVectorScore)
        .toSorted((a, b) => b.score - a.score || a.profileId.localeCompare(b.profileId))
        .slice(0, this.maximumVectorCandidates)
    const vectorScores = new Map(rankedVectorScores.map((candidate) => [candidate.profileId, candidate.score]))
    const selectedProjects = new Map(
      rankedVectorScores.flatMap((candidate) => {
        const evidence = bestProjectEvidence.get(candidate.profileId)
        return evidence && (evidence.vectorScore ?? 0) >= this.minimumVectorScore
          ? [[candidate.profileId, evidence] as const]
          : []
      })
    )
    const fused = searchConfirmedCandidateProfiles(
      eligibleProfiles,
      query,
      Math.max(maxResults, this.reranker ? this.maximumRerankCandidates : maxResults),
      vectorScores,
      selectedProjects
    )
    if (!this.reranker || fused.length < 2) return fused.slice(0, maxResults)
    const profilesById = new Map(eligibleProfiles.map((profile) => [profile.id, profile]))
    const candidates = fused.slice(0, this.maximumRerankCandidates).flatMap((result) => {
      const profile = profilesById.get(result.id)
      if (!profile) return []
      const text = candidateProfileRerankerText(profile)
      return text ? [{ id: result.id, text }] : []
    })
    if (candidates.length < 2) return fused.slice(0, maxResults)
    try {
      const scores = await this.reranker.rerank(query, candidates)
      if (scores.size !== candidates.length || candidates.some((candidate) => !Number.isFinite(scores.get(candidate.id)))) {
        throw new Error('Local reranker returned an invalid candidate score set.')
      }
      return applyLocalRerankerScores(fused, scores).slice(0, maxResults)
    } catch {
      return fused.slice(0, maxResults)
    }
  }
}

const skillVocabulary = [
  'Java',
  'Spring Boot',
  'AWS',
  'Azure',
  'GCP',
  'TypeScript',
  'JavaScript',
  'React',
  'Vue',
  'Angular',
  'Node.js',
  'Python',
  'Go',
  'C#',
  '.NET',
  'Kotlin',
  'Swift',
  'SQL',
  'Oracle',
  'PostgreSQL',
  'MySQL',
  'Docker',
  'Kubernetes',
  'Terraform',
  'Argo CD',
  'Prometheus',
  'Grafana',
  'Linux',
  'SAP',
  'S/4HANA',
  'ABAP',
  'FI/CO',
  'SwiftUI',
  'Next.js',
  'Salesforce',
  'Apex'
] as const

function containsSkill(text: string, skill: string): boolean {
  const escaped = skill.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const startsWithAsciiWord = /^[A-Za-z0-9]/.test(skill)
  const endsWithAsciiWord = /[A-Za-z0-9]$/.test(skill)
  const prefix = startsWithAsciiWord ? '(?<![A-Za-z0-9+#.])' : ''
  const suffix = endsWithAsciiWord ? '(?![A-Za-z0-9+#.])' : ''
  // SWIFT is also a banking-message standard. Only title-cased "Swift" is treated
  // as Apple's programming language by the generic fallback extractor.
  return new RegExp(`${prefix}${escaped}${suffix}`, skill === 'Swift' ? 'u' : 'iu').test(text)
}

function sourceLabel(block: DocumentBlock): string {
  if (block.source.page) return `Page ${block.source.page}`
  if (block.source.sheet && block.source.cell) return `${block.source.sheet}!${block.source.cell}`
  if (block.source.paragraph) return `Paragraph ${block.source.paragraph}`
  return 'Unknown source'
}

interface SpreadsheetCellPosition {
  row: number
  column: number
}

interface SpreadsheetRangePosition {
  startRow: number
  endRow: number
  startColumn: number
  endColumn: number
}

function spreadsheetColumnNumber(label: string): number {
  return [...label].reduce((value, character) => value * 26 + character.charCodeAt(0) - 64, 0)
}

function spreadsheetCellPosition(block: DocumentBlock): SpreadsheetCellPosition | null {
  const match = block.source.cell?.match(/^([A-Z]{1,3})([1-9]\d*)$/u)
  return match?.[1] && match[2]
    ? { row: Number(match[2]), column: spreadsheetColumnNumber(match[1]) }
    : null
}

function spreadsheetRangePosition(value: string | undefined): SpreadsheetRangePosition | null {
  const match = value?.match(/^([A-Z]{1,3})([1-9]\d*):([A-Z]{1,3})([1-9]\d*)$/u)
  return match?.[1] && match[2] && match[3] && match[4]
    ? {
        startRow: Number(match[2]),
        endRow: Number(match[4]),
        startColumn: spreadsheetColumnNumber(match[1]),
        endColumn: spreadsheetColumnNumber(match[3])
      }
    : null
}

function blockRange(block: DocumentBlock): SpreadsheetRangePosition | null {
  const merged = spreadsheetRangePosition(block.source.mergedRange)
  if (merged) return merged
  const cell = spreadsheetCellPosition(block)
  return cell
    ? { startRow: cell.row, endRow: cell.row, startColumn: cell.column, endColumn: cell.column }
    : null
}

function primaryResumeBlocks(document: DocumentIR): DocumentBlock[] {
  const printColumns = new Map<string, { start: number; end: number }>()
  for (const block of document.blocks) {
    if (!block.source.sheet) continue
    const printRange = spreadsheetRangePosition(block.source.printArea)
    if (printRange) printColumns.set(block.source.sheet, { start: printRange.startColumn, end: printRange.endColumn })
  }
  return document.blocks.filter((block) => {
    if (!block.source.sheet) return true
    const columns = printColumns.get(block.source.sheet)
    const position = spreadsheetCellPosition(block)
    if (!columns || !position) return true
    // Keep table continuations below a stale print-area row boundary, while excluding
    // validation dictionaries and helper lists placed to the right of the printable form.
    return position.column >= columns.start && position.column <= columns.end
  })
}

function spreadsheetRows(blocks: DocumentBlock[]): Map<string, DocumentBlock[]> {
  const rows = new Map<string, DocumentBlock[]>()
  for (const block of blocks) {
    const position = spreadsheetCellPosition(block)
    if (!block.source.sheet || !position) continue
    const key = `${block.source.sheet}\u0000${position.row}`
    const row = rows.get(key) ?? []
    row.push(block)
    rows.set(key, row)
  }
  for (const [key, row] of rows) {
    rows.set(key, row.toSorted((left, right) =>
      (spreadsheetCellPosition(left)?.column ?? 0) - (spreadsheetCellPosition(right)?.column ?? 0)
    ))
  }
  return rows
}

function uniqueBlocks(blocks: DocumentBlock[]): DocumentBlock[] {
  return [...new Map(blocks.map((block) => [block.id, block])).values()]
}

function toSource(block: DocumentBlock): CandidateFieldSource {
  return {
    blockId: block.id,
    sourceLabel: sourceLabel(block),
    excerpt: block.text.slice(0, 240)
  }
}

function field(
  key: CandidateFieldKey,
  label: string,
  value: string | null,
  confidence: number,
  sources: DocumentBlock[]
): CandidateExtractionField {
  return {
    key,
    label,
    value,
    confidence: value === null ? 0 : confidence,
    status: value === null ? 'missing' : 'needs_review',
    sources: sources.map(toSource)
  }
}

function firstMatchingBlock(blocks: DocumentBlock[], pattern: RegExp): { block: DocumentBlock; match: RegExpMatchArray } | null {
  for (const block of blocks) {
    const match = block.text.match(pattern)
    if (match) return { block, match }
  }
  return null
}

const projectKeywordPattern = /案件|プロジェクト|開発|構築|更改|刷新|移行|導入|設計|運用|保守|実装|検証/u
const projectPeriodPattern = /(?:20\d{2}[年/.\-]\d{1,2}(?:月)?|令和\d{1,2}年\d{1,2}月)\s*(?:[〜～~\-]|から|より)\s*(?:(?:20\d{2}[年/.\-])?\d{1,2}(?:月)?|現在)|\d{1,2}か月/u
const projectRolePattern = /PMO|PM|PL|SE|PG|SRE|テックリード|アーキテクト|リーダー|メンバー|コンサルタント/iu

const technologyAliases = new Map<string, string>([
  ['java', 'Java'],
  ['javascript', 'JavaScript'],
  ['typescript', 'TypeScript'],
  ['python', 'Python'],
  ['vba', 'VBA'],
  ['c#', 'C#'],
  ['vb.net', 'VB.NET'],
  ['linux', 'Linux'],
  ['windows', 'Windows'],
  ['mac', 'Mac'],
  ['mysql', 'MySQL'],
  ['postgresql', 'PostgreSQL'],
  ['sqlserver', 'SQL Server'],
  ['oracle', 'Oracle'],
  ['springboot', 'Spring Boot'],
  ['spring boot', 'Spring Boot'],
  ['mybatis', 'MyBatis'],
  ['tomcat', 'Tomcat'],
  ['weblogic', 'WebLogic'],
  ['websphere', 'WebSphere'],
  ['struts2', 'Struts2'],
  ['jquery', 'jQuery'],
  ['jsp', 'JSP'],
  ['react.js', 'React'],
  ['reactjs', 'React'],
  ['intellij idea', 'IntelliJ IDEA'],
  ['eclipse', 'Eclipse'],
  ['vscode', 'VS Code'],
  ['ajax', 'AJAX'],
  ['vb', 'VB'],
  ['shell', 'Shell'],
  ['redis', 'Redis'],
  ['kafka', 'Kafka'],
  ['disconf', 'Disconf'],
  ['elasticjob', 'ElasticJob'],
  ['rocketmq', 'RocketMQ'],
  ['dubbo', 'Dubbo'],
  ['mongodb', 'MongoDB'],
  ['flume', 'Flume'],
  ['quartz', 'Quartz'],
  ['hibernate', 'Hibernate'],
  ['thymeleaf', 'Thymeleaf'],
  ['nexacro', 'Nexacro'],
  ['bootstrap', 'Bootstrap'],
  ['freemarker', 'FreeMarker'],
  ['zookeeper', 'ZooKeeper'],
  ['sap', 'SAP'],
  ['extjs3.0', 'Ext JS 3.0']
])

function normalizeTechnology(value: string): string | null {
  const normalized = value.normalize('NFKC').trim().replace(/^[・\-]+|[・\-]+$/gu, '')
  if (!normalized || /^(?:なし|無し|その他|言語|DB|OS|FW|サーバー|フレームワーク)$/iu.test(normalized)) return null
  return technologyAliases.get(normalized.toLocaleLowerCase('en-US')) ?? normalized.slice(0, 80)
}

function splitTechnologies(value: string): string[] {
  return value
    .split(/[,，、;；\n]+/u)
    .map(normalizeTechnology)
    .filter((item): item is string => Boolean(item))
}

function findSpreadsheetLabelValue(blocks: DocumentBlock[], labelPattern: RegExp): DocumentBlock | null {
  for (const label of blocks) {
    if (!labelPattern.test(label.text.normalize('NFKC').trim())) continue
    const labelPosition = spreadsheetCellPosition(label)
    const labelBounds = blockRange(label)
    if (!label.source.sheet || !labelPosition || !labelBounds) continue
    const candidates = blocks.flatMap((candidate) => {
      if (candidate.source.sheet !== label.source.sheet || candidate.id === label.id) return []
      const position = spreadsheetCellPosition(candidate)
      const bounds = blockRange(candidate)
      if (!position || !bounds) return []
      const columnOverlap = bounds.endColumn >= labelBounds.startColumn && bounds.startColumn <= labelBounds.endColumn
      if (columnOverlap && position.row > labelBounds.endRow && position.row <= labelBounds.endRow + 3) {
        return [{ block: candidate, priority: 0, distance: position.row - labelBounds.endRow }]
      }
      const rowOverlap = bounds.endRow >= labelBounds.startRow && bounds.startRow <= labelBounds.endRow
      if (rowOverlap && position.column > labelBounds.endColumn && position.column <= labelBounds.endColumn + 24) {
        return [{ block: candidate, priority: 1, distance: position.column - labelBounds.endColumn }]
      }
      return []
    }).toSorted((left, right) => left.priority - right.priority || left.distance - right.distance)
    if (candidates[0]) return candidates[0].block
  }
  return null
}

const personalDetailLabelPattern = /^(?:フリガナ|氏名|名前|性別|生年月(?:日)?(?:[（(]西暦[）)])?(?:\/年齢)?|国籍|住所|現住所|自宅・最寄り駅|学校名|最終学歴|学歴|専攻学科|専攻|専門|卒業年月|卒業年|学位|電話|電話番号|携帯|メール|メールアドレス|E-?mail)$/iu

function findSpreadsheetPersonalValue(
  blocks: DocumentBlock[],
  labelPattern: RegExp,
  preferredDirection: 'right' | 'below',
  accepts: (value: string) => boolean
): DocumentBlock | null {
  interface PersonalValueCandidate {
    block: DocumentBlock
    direction: 'right' | 'below'
    distance: number
  }
  for (const label of blocks) {
    if (!labelPattern.test(label.text.normalize('NFKC').trim())) continue
    const labelBounds = blockRange(label)
    if (!label.source.sheet || !labelBounds) continue
    const candidates = blocks.flatMap<PersonalValueCandidate>((candidate) => {
      if (candidate.source.sheet !== label.source.sheet || candidate.id === label.id) return []
      const value = candidate.text.normalize('NFKC').trim()
      if (!value || personalDetailLabelPattern.test(value) || !accepts(value)) return []
      const position = spreadsheetCellPosition(candidate)
      const bounds = blockRange(candidate)
      if (!position || !bounds) return []
      const rowOverlap = bounds.endRow >= labelBounds.startRow && bounds.startRow <= labelBounds.endRow
      const columnOverlap = bounds.endColumn >= labelBounds.startColumn && bounds.startColumn <= labelBounds.endColumn
      if (rowOverlap && position.column > labelBounds.endColumn && position.column <= labelBounds.endColumn + 24) {
        return [{ block: candidate, direction: 'right' as const, distance: position.column - labelBounds.endColumn }]
      }
      if (columnOverlap && position.row > labelBounds.endRow && position.row <= labelBounds.endRow + 3) {
        return [{ block: candidate, direction: 'below' as const, distance: position.row - labelBounds.endRow }]
      }
      return []
    }).toSorted((left, right) =>
      Number(left.direction !== preferredDirection) - Number(right.direction !== preferredDirection) ||
      left.distance - right.distance
    )
    if (candidates[0]) return candidates[0].block
  }
  return null
}

function inlinePersonalValue(blocks: DocumentBlock[], pattern: RegExp): string | null {
  for (const block of blocks) {
    const match = block.text.normalize('NFKC').match(pattern)
    const value = match?.[1]?.trim()
    if (value) return value.slice(0, 500)
  }
  return null
}

function localPersonalValue(
  blocks: DocumentBlock[],
  labelPattern: RegExp,
  direction: 'right' | 'below',
  inlinePattern: RegExp,
  accepts: (value: string) => boolean = (value) => value.length > 0
): string | null {
  const spreadsheet = findSpreadsheetPersonalValue(blocks, labelPattern, direction, accepts)?.text.normalize('NFKC').trim()
  const inline = inlinePersonalValue(blocks, inlinePattern)
  return spreadsheet || (inline && accepts(inline) ? inline : null)
}

export function extractLocalCandidatePersonalDetails(document: DocumentIR): LocalCandidatePersonalDetails {
  const blocks = primaryResumeBlocks(document)
  const hasLetter = (value: string) => /[\p{L}]/u.test(value)
  const looksLikeYearOrDate = (value: string) => /(?:19|20)\d{2}|(?:昭和|平成|令和)\d{1,2}/u.test(value)
  return localCandidatePersonalDetailsSchema.parse({
    displayName: localPersonalValue(blocks, /^(?:氏名|名前)$/u, 'right', /(?:氏名|名前)\s*[:：]\s*([^\n|｜]{1,120})/u, (value) => value.length <= 120 && hasLetter(value) && !/@/u.test(value)),
    gender: localPersonalValue(blocks, /^性別$/u, 'below', /性別\s*[:：]\s*([^\n|｜]{1,40})/u, (value) => /^(?:男|女|男性|女性|その他|非公開|未回答|M|F)$/iu.test(value)),
    birthDate: localPersonalValue(blocks, /^生年月(?:日)?(?:[（(]西暦[）)])?(?:\/年齢)?$/u, 'below', /生年月(?:日)?(?:[（(]西暦[）)])?\s*[:：]\s*([^\n|｜]{1,80})/u, looksLikeYearOrDate),
    nationality: localPersonalValue(blocks, /^国籍$/u, 'below', /国籍\s*[:：]\s*([^\n|｜]{1,80})/u, (value) => value.length <= 80 && hasLetter(value)),
    phone: localPersonalValue(blocks, /^(?:電話|電話番号|携帯)$/u, 'right', /(?:電話|電話番号|携帯)\s*[:：]\s*([^\n|｜]{1,80})/u, (value) => value.replace(/\D/gu, '').length >= 7),
    email: localPersonalValue(blocks, /^(?:メール|メールアドレス|E-?mail)$/iu, 'right', /(?:メール|メールアドレス|E-?mail)\s*[:：]\s*([^\s|｜]{3,200})/iu, (value) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/u.test(value)),
    address: localPersonalValue(blocks, /^(?:住所|現住所|自宅・最寄り駅)$/u, 'below', /(?:住所|現住所|自宅・最寄り駅)\s*[:：]\s*([^\n|｜]{1,500})/u, (value) => value.length >= 2),
    education: localPersonalValue(blocks, /^(?:学校名|最終学歴)$/u, 'below', /(?:学校名|最終学歴|学歴)\s*[:：]\s*([^\n|｜]{1,300})/u, (value) => value.length >= 2 && hasLetter(value)),
    major: localPersonalValue(blocks, /^(?:専攻学科|専攻|専門)$/u, 'below', /(?:専攻学科|専攻|専門)\s*[:：]\s*([^\n|｜]{1,200})/u, (value) => value.length >= 2 && hasLetter(value)),
    graduationDate: localPersonalValue(blocks, /^(?:卒業年月|卒業年)$/u, 'below', /(?:卒業年月|卒業年)\s*[:：]\s*([^\n|｜]{1,80})/u, looksLikeYearOrDate),
    degree: localPersonalValue(blocks, /^学位$/u, 'below', /学位\s*[:：]\s*([^\n|｜]{1,120})/u, (value) => value.length >= 1 && hasLetter(value))
  })
}

interface StructuredSkillEntry {
  value: string
  rating: '◎' | '○' | '△' | null
  sources: DocumentBlock[]
}

function extractStructuredSkillMatrix(blocks: DocumentBlock[]): StructuredSkillEntry[] {
  const heading = blocks.find((block) => block.text.normalize('NFKC').trim() === '技術情報' && block.source.sheet)
  if (!heading?.source.sheet) return []
  const headingPosition = spreadsheetCellPosition(heading)
  if (!headingPosition) return []
  const endingRow = blocks
    .filter((block) => block.source.sheet === heading.source.sheet && /^(?:技術履歴|技術経歴|職務経歴)$/u.test(block.text.normalize('NFKC').trim()))
    .map((block) => spreadsheetCellPosition(block)?.row ?? Number.POSITIVE_INFINITY)
    .filter((row) => row > headingPosition.row)
    .toSorted((left, right) => left - right)[0] ?? headingPosition.row + 12
  const rows = spreadsheetRows(blocks)
  const ignoredLabels = /^(?:OS|言語関連|言語|DB関連|DB|WEBサーバ|サーバー|Framework|FrameWork|FW|他|その他)$/iu
  const entries: StructuredSkillEntry[] = []
  for (let rowNumber = headingPosition.row + 1; rowNumber < endingRow; rowNumber += 1) {
    const row = rows.get(`${heading.source.sheet}\u0000${rowNumber}`) ?? []
    let previous: DocumentBlock | null = null
    for (const block of row) {
      const value = block.text.normalize('NFKC').trim()
      const rating = value.match(/^[◎○△]$/u)?.[0] as StructuredSkillEntry['rating'] | undefined
      if (rating && previous) {
        const technology = normalizeTechnology(previous.text)
        if (technology) entries.push({ value: technology, rating, sources: [previous, block] })
        previous = null
        continue
      }
      if (!ignoredLabels.test(value) && !/[◎○△]\s*[:：]/u.test(value)) previous = block
    }
  }
  const unique = new Map<string, StructuredSkillEntry>()
  for (const entry of entries) {
    const key = entry.value.toLocaleLowerCase('en-US')
    const current = unique.get(key)
    const rank = (rating: StructuredSkillEntry['rating']) => rating === '◎' ? 3 : rating === '○' ? 2 : rating === '△' ? 1 : 0
    if (!current || rank(entry.rating) > rank(current.rating)) unique.set(key, entry)
  }
  return [...unique.values()]
}

function extractStructuredJapaneseLevel(blocks: DocumentBlock[]): {
  value: string
  sources: DocumentBlock[]
} | null {
  const language = blocks.find((block) => block.source.sheet && block.text.normalize('NFKC').trim() === '日本語')
  const languagePosition = language ? spreadsheetCellPosition(language) : null
  if (!language?.source.sheet || !languagePosition) return null
  const dimensions = [
    { label: '読む', output: '読む' },
    { label: '書く', output: '書く' },
    { label: '会話', output: '会話' }
  ]
  const values: string[] = []
  const sources: DocumentBlock[] = [language]
  for (const dimension of dimensions) {
    const header = blocks.find((block) =>
      block.source.sheet === language.source.sheet &&
      block.text.normalize('NFKC').trim() === dimension.label &&
      (spreadsheetCellPosition(block)?.row ?? Number.POSITIVE_INFINITY) < languagePosition.row
    )
    const headerBounds = header ? blockRange(header) : null
    if (!header || !headerBounds) continue
    const value = blocks.find((block) => {
      if (block.source.sheet !== language.source.sheet) return false
      const bounds = blockRange(block)
      const position = spreadsheetCellPosition(block)
      return Boolean(bounds && position && position.row === languagePosition.row &&
        bounds.endColumn >= headerBounds.startColumn && bounds.startColumn <= headerBounds.endColumn)
    })
    if (!value) continue
    values.push(`${dimension.output} ${value.text.normalize('NFKC').trim()}`)
    sources.push(header, value)
  }
  return values.length > 0 ? { value: values.join(' / '), sources: uniqueBlocks(sources) } : null
}

function extractStructuredSpreadsheetProjects(blocks: DocumentBlock[]): CandidateProjectExperienceDraft[] | null {
  const sheetNames = [...new Set(blocks.flatMap((block) => block.source.sheet ? [block.source.sheet] : []))]
  const allRows = spreadsheetRows(blocks)
  for (const sheetName of sheetNames) {
    const rows = [...allRows.entries()]
      .flatMap(([key, row]) => key.startsWith(`${sheetName}\u0000`)
        ? [{ row: Number(key.slice(sheetName.length + 1)), blocks: row }]
        : [])
      .toSorted((left, right) => left.row - right.row)
    const header = rows.find((row) => {
      const values = row.blocks.map((block) => block.text.normalize('NFKC').trim())
      return values.some((value) => /^(?:No|No\.|番号)$/iu.test(value)) && values.includes('期間') &&
        values.some((value) => /(?:システム|案件|業務)/u.test(value)) &&
        values.some((value) => /(?:技術|環境)/u.test(value))
    })
    if (!header) continue
    const headerBlock = (pattern: RegExp) => header.blocks.find((block) => pattern.test(block.text.normalize('NFKC').trim()))
    const numberRange = blockRange(headerBlock(/^(?:No|No\.|番号)$/iu) ?? header.blocks[0]!)
    const periodRange = blockRange(headerBlock(/^期間$/u) ?? header.blocks[0]!)
    const systemRange = blockRange(headerBlock(/(?:システム|案件|業務)/u) ?? header.blocks[0]!)
    const technologyRange = blockRange(headerBlock(/(?:技術|環境)/u) ?? header.blocks[0]!)
    const roleRange = blockRange(headerBlock(/^役割$/u) ?? header.blocks[0]!)
    const assignmentRange = blockRange(headerBlock(/^担当$/u) ?? header.blocks[0]!)
    if (!numberRange || !periodRange || !systemRange || !technologyRange) continue
    const starts = rows.flatMap((row) => {
      if (row.row <= header.row) return []
      const number = row.blocks.find((block) => {
        const position = spreadsheetCellPosition(block)
        return Boolean(position && position.column >= numberRange.startColumn && position.column <= numberRange.endColumn &&
          /^\d{1,2}$/u.test(block.text.normalize('NFKC').trim()))
      })
      return number ? [{ row: row.row, number }] : []
    })
    if (starts.length === 0) continue
    const projects: CandidateProjectExperienceDraft[] = []
    for (const [index, start] of starts.entries()) {
      const mergedEnd = blockRange(start.number)?.endRow ?? start.row
      const endRow = Math.max(mergedEnd, starts[index + 1] ? starts[index + 1]!.row - 1 : mergedEnd)
      const projectBlocks = blocks.filter((block) => {
        const position = spreadsheetCellPosition(block)
        return block.source.sheet === sheetName && Boolean(position && position.row >= start.row && position.row <= endRow)
      })
      const withinColumns = (block: DocumentBlock, range: SpreadsheetRangePosition) => {
        const position = spreadsheetCellPosition(block)
        return Boolean(position && position.column >= range.startColumn && position.column <= range.endColumn)
      }
      const systemBlocks = projectBlocks.filter((block) => withinColumns(block, systemRange))
      const titleBlock = systemBlocks
        .filter((block) => spreadsheetCellPosition(block)?.row === start.row)
        .filter((block) => !/^(?:日本|中国|韓国|台湾|米国|国内|海外)$/u.test(block.text.normalize('NFKC').trim()))
        .toSorted((left, right) => right.text.length - left.text.length)[0] ?? systemBlocks[0]
      const titleLine = titleBlock?.text.normalize('NFKC').split(/\r?\n/u).map((line) => line.trim()).find(Boolean)
      const conciseSystemTitle = titleLine?.match(/^(.{2,80}?システム)(?=における|に関する|の(?:機能|開発|改修)|[、。]|$)/u)?.[1]
      const title = (conciseSystemTitle ?? titleLine)?.slice(0, 160)
      if (!title) continue
      const systemSummaries = systemBlocks.flatMap((block) => {
        const lines = block.text.normalize('NFKC').split(/\r?\n/u).map((line) => line.trim()).filter(Boolean)
        if (block.id !== titleBlock?.id) return lines
        const remainder = conciseSystemTitle && lines[0]
          ? lines[0].slice(conciseSystemTitle.length).replace(/^(?:における|に関する|の)/u, '').trim()
          : ''
        return [...(remainder ? [remainder] : []), ...lines.slice(1)]
      }).filter((line) => !/^(?:日本|中国|韓国|台湾|米国|国内|海外)$/u.test(line))
      const summary = [...new Set(systemSummaries)].join('\n').trim() || title
      const periodBlocks = projectBlocks.filter((block) => withinColumns(block, periodRange))
      const dateInMarkerRow = (marker: '自' | '至') => {
        const markerRow = periodBlocks.find((block) => block.text.normalize('NFKC').trim() === marker)
        const row = markerRow ? spreadsheetCellPosition(markerRow)?.row : null
        if (!row) return null
        return periodBlocks
          .filter((block) => spreadsheetCellPosition(block)?.row === row)
          .map((block) => block.text.normalize('NFKC').trim())
          .find((value) => /^(?:19|20)\d{2}年(?:1[0-2]|0?[1-9])月$/u.test(value)) ?? null
      }
      const startDate = dateInMarkerRow('自')
      const endDate = dateInMarkerRow('至')
      const durationText = periodBlocks
        .filter((block) => spreadsheetCellPosition(block)?.row === start.row)
        .map((block) => block.text.normalize('NFKC').replaceAll(' ', ''))
        .join('')
        .match(/(\d{1,3})ヶ月/u)?.[0] ?? null
      const period = startDate && endDate
        ? `${startDate}〜${endDate}${durationText ? `（${durationText}）` : ''}`
        : startDate ?? endDate ?? durationText
      const roleValues = projectBlocks
        .filter((block) => (roleRange && withinColumns(block, roleRange)) || (assignmentRange && withinColumns(block, assignmentRange)))
        .map((block) => block.text.normalize('NFKC').trim().toUpperCase())
        .filter((value) => /^(?:PMO|PM|PL|TL|SL|SE|BSE|PG|TT|SRE)$/u.test(value))
      const role = [...new Set(roleValues)].join(' / ') || null
      const technologyBlocks: DocumentBlock[] = []
      const technologies: string[] = []
      for (const row of rows.filter((candidate) => candidate.row >= start.row && candidate.row <= endRow)) {
        const label = row.blocks.find((block) => withinColumns(block, technologyRange) &&
          /^(?:OS|言語|DB|サーバー|サーバ|FW|Framework|フレームワーク|その他)$/iu.test(block.text.normalize('NFKC').trim()))
        const labelPosition = label ? spreadsheetCellPosition(label) : null
        if (!label || !labelPosition) continue
        const values = row.blocks.filter((block) => {
          const position = spreadsheetCellPosition(block)
          return Boolean(position && position.column > labelPosition.column && position.column <= technologyRange.endColumn)
        })
        for (const value of values) {
          technologies.push(...splitTechnologies(value.text))
          technologyBlocks.push(label, value)
        }
      }
      const normalizedTechnologies = [...new Map(technologies.map((technology) => [
        technology.toLocaleLowerCase('en-US'), technology
      ])).values()]
      const evidence = uniqueBlocks([
        ...(titleBlock ? [titleBlock] : []),
        ...systemBlocks,
        ...periodBlocks.filter((block) => /^(?:自|至|(?:19|20)\d{2}年)/u.test(block.text.normalize('NFKC').trim())),
        ...projectBlocks.filter((block) => roleValues.includes(block.text.normalize('NFKC').trim().toUpperCase())),
        ...technologyBlocks
      ]).slice(0, 100)
      const digest = createHash('sha256').update(`${sheetName}\u0000${start.row}\u0000${title}`).digest('hex')
      projects.push({
        draftId: `project-${digest.slice(0, 20)}`,
        title,
        period,
        role,
        technologies: normalizedTechnologies.slice(0, 40),
        summary: summary.slice(0, 1_500),
        confidence: period && normalizedTechnologies.length > 0 && role ? 0.95 : 0.86,
        sources: evidence.map(toSource)
      })
    }
    if (projects.length > 0) return projects.slice(0, 20)
  }
  return null
}

function projectGroups(blocks: DocumentBlock[]): DocumentBlock[][] {
  const spreadsheetRows = new Map<string, DocumentBlock[]>()
  const textGroups: DocumentBlock[][] = []
  for (const block of blocks) {
    const row = block.source.cell?.match(/(\d+)$/u)?.[1]
    if (block.source.sheet && row) {
      const key = `${block.source.sheet}\u0000${row}`
      const existing = spreadsheetRows.get(key) ?? []
      existing.push(block)
      spreadsheetRows.set(key, existing)
    } else {
      textGroups.push([block])
    }
  }
  return [...spreadsheetRows.values(), ...textGroups]
}

function projectTitle(blocks: DocumentBlock[], text: string, index: number): string {
  const explicit = text.match(/(?:案件名|プロジェクト名|project)\s*[:：]\s*([^\n|/／]{2,160})/iu)?.[1]?.trim()
  if (explicit) return explicit.slice(0, 160)
  for (const block of blocks) {
    const value = block.text.normalize('NFKC').trim()
    if (
      value.length >= 2 && value.length <= 120 &&
      !projectPeriodPattern.test(value) &&
      !/^(?:案件名|プロジェクト|期間|担当|役割|工程|技術|環境|概要|業務内容)$/u.test(value) &&
      !skillVocabulary.some((skill) => value === skill)
    ) return value.slice(0, 160)
  }
  return `プロジェクト経験 ${index + 1}`
}

function extractProjectExperiences(document: DocumentIR, blocks = primaryResumeBlocks(document)): CandidateProjectExperienceDraft[] {
  const structured = extractStructuredSpreadsheetProjects(blocks)
  if (structured) return structured
  const projects: CandidateProjectExperienceDraft[] = []
  const seen = new Set<string>()
  for (const group of projectGroups(blocks)) {
    const text = group.map((block) => block.text.trim()).filter(Boolean).join(' | ').normalize('NFKC')
    if (text.length < 8 || /^(?:案件名|プロジェクト|期間|担当|役割|工程|技術|環境|概要|業務内容)(?:\s*[|／/]\s*(?:案件名|プロジェクト|期間|担当|役割|工程|技術|環境|概要|業務内容))*$/u.test(text)) continue
    const technologies = skillVocabulary.filter((skill) => containsSkill(text, skill))
    const period = text.match(projectPeriodPattern)?.[0] ?? null
    const role = text.match(projectRolePattern)?.[0] ?? null
    const hasKeyword = projectKeywordPattern.test(text)
    const explicitProject = /(?:案件名|プロジェクト名|project)\s*[:：]/iu.test(text)
    if (!(explicitProject || (hasKeyword && (technologies.length > 0 || period || role || text.length >= 30)) || (period && technologies.length > 0))) {
      continue
    }
    const sourceKey = group.map((block) => `${sourceLabel(block)}:${block.text}`).join('\u0000')
    const digest = createHash('sha256').update(sourceKey).digest('hex')
    if (seen.has(digest)) continue
    seen.add(digest)
    projects.push({
      draftId: `project-${digest.slice(0, 20)}`,
      title: projectTitle(group, text, projects.length),
      period,
      role,
      technologies,
      summary: text.slice(0, 1_500),
      confidence: period && technologies.length > 0 && hasKeyword ? 0.82 : 0.68,
      sources: group.map(toSource)
    })
    if (projects.length >= 20) break
  }
  return projects
}

export function extractCandidateDraft(document: DocumentIR, now = new Date()): CandidateExtractionDraft {
  const blocks = primaryResumeBlocks(document)
  const localPersonalDetails = extractLocalCandidatePersonalDetails(document)
  const projectExperiences = extractProjectExperiences(document, blocks)
  const structuredSkills = extractStructuredSkillMatrix(blocks)
  const fallbackSkills = skillVocabulary.filter((skill) =>
    blocks.some((block) => containsSkill(block.text, skill))
  )
  const skillsValue = structuredSkills.length > 0
    ? structuredSkills.map((entry) => `${entry.value}${entry.rating ? ` (${entry.rating})` : ''}`).join(', ')
    : fallbackSkills.length > 0 ? fallbackSkills.join(', ') : null
  const skillSources = structuredSkills.length > 0
    ? uniqueBlocks(structuredSkills.flatMap((entry) => entry.sources))
    : blocks.filter((block) => fallbackSkills.some((skill) => containsSkill(block.text, skill)))

  const labeledExperienceBlock = findSpreadsheetLabelValue(blocks, /^(?:実務経験|経験年数)$/u)
  const labeledExperience = labeledExperienceBlock?.text.normalize('NFKC').trim().match(/^(\d{1,2}(?:\.\d)?)\s*年(?:以上|程度)?$/u)
  const experience = labeledExperience
    ? { block: labeledExperienceBlock!, match: labeledExperience }
    : firstMatchingBlock(
        blocks,
        /(?:経験|experience)?\s*[:：]?\s*(?<!\d)(\d{1,2}(?:\.\d)?)(?!\d)\s*(?:年(?:以上|程度)?|years?)/iu
      )
  const availability = firstMatchingBlock(
    blocks,
    /((?:20\d{2}[年/.\-])?\d{1,2}月(?:から|より)?(?:稼働|参画|開始)(?:可能|可)?|即日(?:稼働|参画)?(?:可能|可)?)/u
  )
  const rate = firstMatchingBlock(
    blocks,
    /((?:\d{2,3}\s*[〜～~-]\s*)?\d{2,3}\s*万円?(?:\/月|月)?)/u
  )
  const structuredJapanese = extractStructuredJapaneseLevel(blocks)
  const japaneseLevel = structuredJapanese
    ? null
    : firstMatchingBlock(blocks, /\b(N[1-5])\b|日本語\s*[:：]?\s*(ネイティブ|ビジネス|日常会話)/iu)
  const workStyle = firstMatchingBlock(
    blocks,
    /(フルリモート|完全在宅|週\s*\d\s*日(?:まで)?リモート|リモート(?:可|可能)|常駐|出社)/u
  )
  const structuredRole = projectExperiences[0]?.role ?? null
  const structuredRoleSources = structuredRole
    ? blocks.filter((block) => projectExperiences[0]?.sources.some((source) => source.blockId === block.id) &&
        structuredRole.split(' / ').includes(block.text.normalize('NFKC').trim().toUpperCase()))
    : []
  const role = structuredRole
    ? null
    : firstMatchingBlock(
        blocks,
        /(?:役割|role)\s*[:：]?\s*(PMO|PM|PL|SE|PG|TL|SL|BSE)|\b(PMO|PM|PL|SE|PG|TL|SL|BSE)\b/iu
      )
  const preferredLocation = firstMatchingBlock(
    blocks,
    /(?:希望勤務地|勤務希望地|勤務地希望|通勤可能(?:エリア|範囲))\s*[:：]?\s*([^\n|｜]{2,80}?)(?=\s+(?:就労資格|在留資格|就労可否|ビザ)\s*[:：]|$)/u
  )
  const workAuthorization = firstMatchingBlock(
    blocks,
    /(?:就労資格|在留資格|就労可否|ビザ)\s*[:：]?\s*([^\n|｜]{2,80})/u
  )
  const normalizedWorkAuthorization = workAuthorization?.match[1]
    ? normalizeCandidateWorkAuthorization(workAuthorization.match[1])
    : null

  return candidateExtractionDraftSchema.parse({
    version: 'candidate-extraction-v5',
    documentId: document.documentId,
    extractor: 'deterministic-local-v4',
    localPersonalDetails,
    requiresReview: true,
    createdAt: now.toISOString(),
    projectExperiences,
    fields: [
      field('skills', 'スキル', skillsValue, structuredSkills.length > 0 ? 0.95 : 0.9, skillSources),
      field(
        'experience_years',
        '経験年数',
        experience?.match[1] ? `${experience.match[1]}年` : null,
        0.72,
        experience ? [experience.block] : []
      ),
      field('availability', '稼働時期', availability?.match[1] ?? null, 0.78, availability ? [availability.block] : []),
      field('rate', '希望単価', rate?.match[1] ?? null, 0.75, rate ? [rate.block] : []),
      field(
        'japanese_level',
        '日本語レベル',
        structuredJapanese?.value ?? (japaneseLevel ? japaneseLevel.match[1] ?? japaneseLevel.match[2] ?? null : null),
        structuredJapanese ? 0.9 : 0.8,
        structuredJapanese?.sources ?? (japaneseLevel ? [japaneseLevel.block] : [])
      ),
      field('work_style', '勤務形態', workStyle?.match[1] ?? null, 0.78, workStyle ? [workStyle.block] : []),
      field(
        'role',
        '役割',
        structuredRole ?? (role ? role.match[1] ?? role.match[2] ?? null : null),
        structuredRole ? 0.9 : 0.72,
        structuredRole ? structuredRoleSources : role ? [role.block] : []
      ),
      field('location', '希望勤務地・通勤範囲', preferredLocation?.match[1]?.trim() ?? null, 0.72, preferredLocation ? [preferredLocation.block] : []),
      field(
        'work_authorization',
        '就労資格（国籍は保存しない）',
        normalizedWorkAuthorization,
        normalizedWorkAuthorization ? 0.68 : 0,
        workAuthorization ? [workAuthorization.block] : []
      )
    ]
  })
}
