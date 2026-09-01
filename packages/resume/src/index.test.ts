// @vitest-environment node
import { createHash } from 'node:crypto'
import type { DocumentIR } from '@parsers'
import { parseStagedDocument } from '@parsers'
import * as XLSX from 'xlsx'
import {
  applyLocalRerankerScores,
  candidateProfileEmbeddingText,
  candidateProfileSchema,
  candidateProfileRerankerText,
  evaluateCandidateRetrieval,
  evaluateSesCandidateBenchmark,
  extractCandidateDraft,
  LocalHybridCandidateRetrieval,
  searchConfirmedCandidateProfiles,
  scorableCandidateSearchTerms,
  type CandidateProfile
} from './index'
import type { SesCandidateBenchmark, StagedLocalFile } from '@shared'

async function createMergedSesResumeDocument(): Promise<DocumentIR> {
  const sheet: XLSX.WorkSheet = {}
  const merges: XLSX.Range[] = []
  const set = (address: string, value: string) => {
    sheet[address] = { t: 's', v: value }
  }
  const merge = (range: string) => merges.push(XLSX.utils.decode_range(range))

  set('A1', '技術者経歴書')
  set('AH3', '2026年2月1日')
  set('AB4', '実務経験')
  set('AB5', '19.0年')
  merge('AB4:AE4')
  merge('AB5:AE6')

  set('A11', '語学能力')
  set('M12', '読む')
  set('S12', '書く')
  set('Y12', '会話')
  set('A13', '日本語')
  set('M13', 'C')
  set('S13', 'B')
  set('Y13', 'C')
  merge('A13:D13')
  merge('M12:R12')
  merge('S12:X12')
  merge('Y12:AD12')
  merge('M13:R13')
  merge('S13:X13')
  merge('Y13:AD13')

  set('A17', '技術情報')
  set('A18', 'OS')
  set('H18', 'Linux')
  set('K18', '◎')
  set('A19', '言語関連')
  set('H19', 'Java')
  set('K19', '◎')
  set('L19', 'JavaScript')
  set('O19', '◎')
  set('P19', 'Python')
  set('S19', '△')
  set('T19', 'VBA')
  set('W19', '◎')
  set('A20', 'DB関連')
  set('H20', 'PostgreSQL')
  set('K20', '◎')
  set('A22', 'FrameWork')
  set('H22', 'SpringBoot')
  set('K22', '◎')
  set('A28', '技術履歴')

  set('A29', 'No')
  set('B29', '期間')
  set('G29', 'システム関連')
  set('T29', '技術関連')
  set('AD29', '役割')
  set('AE29', '担当')
  set('AF29', '作業範囲')
  merge('A29:A34')
  merge('B29:F34')
  merge('G29:S34')
  merge('T29:AC34')
  merge('AD29:AD34')
  merge('AE29:AE34')
  merge('AF29:AM29')

  for (let projectNumber = 1; projectNumber <= 9; projectNumber += 1) {
    const startRow = 35 + (projectNumber - 1) * 7
    const endRow = startRow + 6
    const startYear = 2026 - projectNumber
    const title = projectNumber === 1
      ? '匿名会計システム'
      : projectNumber === 2 ? 'SWIFT決済システム' : `匿名業務システム${projectNumber}`
    set(`A${startRow}`, String(projectNumber))
    set(`B${startRow}`, '満')
    set(`C${startRow}`, '13ヶ月')
    set(`G${startRow}`, '日本')
    set(`H${startRow}`, title)
    set(`T${startRow}`, 'OS')
    set(`W${startRow}`, 'Linux')
    set(`AE${startRow}`, projectNumber === 1 ? 'SE' : 'PG')
    set(`B${startRow + 1}`, '自')
    set(`C${startRow + 1}`, `${startYear}年03月`)
    set(`H${startRow + 1}`, 'システム設計・開発・単体テスト・結合テストを担当')
    set(`T${startRow + 1}`, '言語')
    set(`W${startRow + 1}`, projectNumber === 1 ? 'VBA,JAVA' : 'Java')
    set(`T${startRow + 2}`, 'DB')
    set(`W${startRow + 2}`, 'PostgreSQL')
    set(`B${startRow + 4}`, '至')
    set(`C${startRow + 4}`, `${startYear + 1}年03月`)
    set(`T${startRow + 4}`, 'FW')
    set(`W${startRow + 4}`, 'SpringBoot')
    merge(`A${startRow}:A${endRow}`)
  }

  // Validation/helper dictionaries deliberately live outside the printable form.
  set('AZ3', 'PM')
  set('BU3', 'C#')
  set('BU4', 'Swift')
  sheet['!merges'] = merges
  sheet['!ref'] = 'A1:BU97'
  const workbook = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(workbook, sheet, '技術情報経歴書')
  workbook.Workbook = {
    ...workbook.Workbook,
    Names: [{ Name: '_xlnm.Print_Area', Sheet: 0, Ref: "'技術情報経歴書'!$A$1:$AM$90" }]
  }
  const bytes = Buffer.from(XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' }))
  const file: StagedLocalFile = {
    token: 'cf4dd6df-8083-4991-870a-6bd7f8f757c3',
    name: 'synthetic-ses-resume.xlsx',
    format: 'xlsx',
    size: bytes.length,
    sha256: createHash('sha256').update(bytes).digest('hex'),
    createdAt: '2026-07-21T00:00:00.000Z',
    privacyStatus: 'awaiting-local-scan'
  }
  return parseStagedDocument(file, bytes)
}

describe('extractCandidateDraft', () => {
  it('parses a merged-cell SES history sheet without helper-dictionary pollution', async () => {
    const document = await createMergedSesResumeDocument()
    const draft = extractCandidateDraft(document, new Date('2026-07-21T00:00:00.000Z'))

    expect(draft.fields.find((field) => field.key === 'experience_years')?.value).toBe('19.0年')
    expect(draft.fields.find((field) => field.key === 'japanese_level')?.value).toBe('読む C / 書く B / 会話 C')
    expect(draft.fields.find((field) => field.key === 'role')?.value).toBe('SE')
    const skills = draft.fields.find((field) => field.key === 'skills')?.value ?? ''
    expect(skills).toContain('Java (◎)')
    expect(skills).toContain('Python (△)')
    expect(skills).toContain('Spring Boot (◎)')
    expect(skills).not.toContain('C#')
    expect(skills).not.toContain('Swift')
    expect(draft.projectExperiences).toHaveLength(9)
    expect(draft.projectExperiences[0]).toMatchObject({
      title: '匿名会計システム',
      period: '2025年03月〜2026年03月（13ヶ月）',
      role: 'SE',
      technologies: ['Linux', 'VBA', 'Java', 'PostgreSQL', 'Spring Boot']
    })
    expect(draft.projectExperiences[1]?.title).toBe('SWIFT決済システム')
    expect(draft.projectExperiences[8]?.title).toBe('匿名業務システム9')
  })

  it('extracts only evidenced SES fields and keeps missing values null', () => {
    const document: DocumentIR = {
      version: 'document-ir-v1',
      documentId: '5e910bbc-7aeb-4087-8130-4ff63ef8bd68',
      source: { name: 'candidate.xlsx', format: 'xlsx', sha256: 'c'.repeat(64), size: 2048 },
      blocks: [
        { id: 'skill-a2', kind: 'cell', text: 'Java / Spring Boot / AWS', source: { sheet: 'Skills', cell: 'A2' } },
        { id: 'exp-b2', kind: 'cell', text: '経験: 7年', source: { sheet: 'Skills', cell: 'B2' } },
        { id: 'rate-c2', kind: 'cell', text: '希望単価 80〜90万円/月', source: { sheet: 'Skills', cell: 'C2' } },
        { id: 'lang-d2', kind: 'cell', text: '日本語 N2', source: { sheet: 'Skills', cell: 'D2' } },
        { id: 'location-e2', kind: 'cell', text: '希望勤務地：東京都内・品川通勤可', source: { sheet: 'Skills', cell: 'E2' } },
        { id: 'auth-f2', kind: 'cell', text: '在留資格：技術・人文知識・国際業務', source: { sheet: 'Skills', cell: 'F2' } }
      ],
      warnings: [],
      requiresLocalOcr: false,
      statistics: { pages: 0, sheets: 1, blocks: 4, characters: 48 },
      security: { externalContentLoaded: false, macrosExecuted: false, rawFileCloudEligible: false }
    }

    const draft = extractCandidateDraft(document, new Date('2026-07-17T00:00:00.000Z'))
    expect(draft.fields.find((item) => item.key === 'skills')).toMatchObject({
      value: 'Java, Spring Boot, AWS',
      sources: [expect.objectContaining({ sourceLabel: 'Skills!A2' })]
    })
    expect(draft.fields.find((item) => item.key === 'experience_years')?.value).toBe('7年')
    expect(draft.fields.find((item) => item.key === 'rate')?.value).toBe('80〜90万円/月')
    expect(draft.fields.find((item) => item.key === 'availability')).toMatchObject({ value: null, status: 'missing', sources: [] })
    expect(draft.fields.find((item) => item.key === 'location')?.value).toBe('東京都内・品川通勤可')
    expect(draft.fields.find((item) => item.key === 'work_authorization')?.value).toBe('就労資格あり（職種・期限要確認）')
    expect(draft.projectExperiences).toEqual([])
  })

  it('does not infer nested skill names and keeps the complete availability phrase', () => {
    const document: DocumentIR = {
      version: 'document-ir-v1',
      documentId: '8055be48-a08f-499d-9d82-c95a36018ad9',
      source: { name: 'scan.pdf', format: 'pdf', sha256: 'd'.repeat(64), size: 4096 },
      blocks: [
        {
          id: 'page-1',
          kind: 'text',
          text: 'JavaScript / PostgreSQL / 8月から参画可能',
          source: { page: 1 }
        }
      ],
      warnings: [],
      requiresLocalOcr: false,
      statistics: { pages: 1, sheets: 0, blocks: 1, characters: 39 },
      security: { externalContentLoaded: false, macrosExecuted: false, rawFileCloudEligible: false }
    }

    const draft = extractCandidateDraft(document)
    expect(draft.fields.find((item) => item.key === 'skills')?.value).toBe('JavaScript, PostgreSQL')
    expect(draft.fields.find((item) => item.key === 'availability')?.value).toBe('8月から参画可能')
  })

  it('reads an anonymous chat profile whose labels are padded brackets', () => {
    // The shape a WeChat broadcast uses for a person with no name: a gender and
    // age header, then 【…】 labels padded for alignment. The rate is masked in
    // the broadcast itself (6X), so it stays missing rather than guessed.
    const profileDocument = (rateLine: string): DocumentIR => {
      const lines = [
        '◆️男　37歳／中国籍',
        '【IT経験】15年',
        '【日本語】N1流畅 表格3-4',
        rateLine,
        '【スキル】Java、Python、C、SQL、AWSなど',
        '【対応工程】要件定義～',
        '【アピール】',
        '・2013年に日本へ転職してからは12年間にわたり、主に銀行系システムにおけるJava開発プロジェクトに携わってまいりました。'
      ]
      return {
        version: 'document-ir-v1',
        documentId: '0a0b3d0e-4d0f-4a3a-9d5f-2b6f5c9a1e77',
        source: { name: 'agent-paste-1a2b3c4d.txt', format: 'txt', sha256: 'e'.repeat(64), size: 512 },
        blocks: lines.map((text, index) => ({
          id: `L${index + 1}`, kind: 'text' as const, text, source: { paragraph: index + 1 }
        })),
        warnings: [],
        requiresLocalOcr: false,
        statistics: { pages: 0, sheets: 0, blocks: lines.length, characters: lines.join('\n').length },
        security: { externalContentLoaded: false, macrosExecuted: false, rawFileCloudEligible: false }
      }
    }

    const masked = extractCandidateDraft(profileDocument('【单    金】6X＋税'), new Date('2026-08-26T00:00:00.000Z'))
    const maskedByKey = new Map(masked.fields.map((field) => [field.key, field.value]))
    expect(maskedByKey.get('skills')).toContain('Java')
    expect(maskedByKey.get('skills')).toContain('Python')
    expect(maskedByKey.get('skills')).toContain('SQL')
    expect(maskedByKey.get('skills')).toContain('AWS')
    expect(maskedByKey.get('experience_years')).toBe('15年')
    expect(maskedByKey.get('japanese_level')).toBe('N1')
    expect(maskedByKey.get('rate')).toBeNull()

    // The padded 【单    金】 label itself is no obstacle: a stated rate is read.
    const stated = extractCandidateDraft(profileDocument('【单    金】65万＋税'), new Date('2026-08-26T00:00:00.000Z'))
    expect(stated.fields.find((field) => field.key === 'rate')?.value).toBe('65万')
  })

  it('extracts spreadsheet project rows with exact source evidence for HR review', () => {
    const document: DocumentIR = {
      version: 'document-ir-v1',
      documentId: 'b9b5316e-8fe8-44ff-9f82-e664e7acbbaa',
      source: { name: 'projects.xlsx', format: 'xlsx', sha256: 'e'.repeat(64), size: 4096 },
      blocks: [
        { id: 'a2', kind: 'cell', text: '決済基盤刷新プロジェクト', source: { sheet: '経歴', cell: 'A2' } },
        { id: 'b2', kind: 'cell', text: '2022年4月〜2024年3月', source: { sheet: '経歴', cell: 'B2' } },
        { id: 'c2', kind: 'cell', text: 'AWS / Terraform / Kubernetes', source: { sheet: '経歴', cell: 'C2' } },
        { id: 'd2', kind: 'cell', text: 'クラウド基盤の設計・構築・運用を担当', source: { sheet: '経歴', cell: 'D2' } },
        { id: 'e2', kind: 'cell', text: 'PL', source: { sheet: '経歴', cell: 'E2' } }
      ],
      warnings: [],
      requiresLocalOcr: false,
      statistics: { pages: 0, sheets: 1, blocks: 5, characters: 92 },
      security: { externalContentLoaded: false, macrosExecuted: false, rawFileCloudEligible: false }
    }
    const draft = extractCandidateDraft(document)
    expect(draft.version).toBe('candidate-extraction-v5')
    expect(draft.projectExperiences).toEqual([
      expect.objectContaining({
        title: '決済基盤刷新プロジェクト',
        period: '2022年4月〜2024年3月',
        role: 'PL',
        technologies: ['AWS', 'Kubernetes', 'Terraform'],
        confidence: 0.82,
        sources: expect.arrayContaining([
          expect.objectContaining({ sourceLabel: '経歴!A2' }),
          expect.objectContaining({ sourceLabel: '経歴!E2' })
        ])
      })
    ])
  })

  it('extracts local personal details by labels and relative layout instead of fixed cells', () => {
    const printArea = 'A1:AM90'
    const cell = (id: string, text: string, address: string, mergedRange?: string): DocumentIR['blocks'][number] => ({
      id,
      kind: 'cell',
      text,
      source: { sheet: '自由レイアウト', cell: address, printArea, inPrintArea: true, ...(mergedRange ? { mergedRange } : {}) }
    })
    const document: DocumentIR = {
      version: 'document-ir-v1',
      documentId: '05f7656e-f609-43d4-a370-44ac91ffeb64',
      source: { name: 'moved-layout.xlsx', format: 'xlsx', sha256: '9'.repeat(64), size: 4096 },
      blocks: [
        cell('name-label', '名前', 'F20', 'F20:H20'),
        cell('name-value', '楊 凱', 'I20', 'I20:N20'),
        cell('gender-label', '性別', 'P19'),
        cell('gender-value', '男性', 'P20'),
        cell('birth-label', '生年月（西暦）/年齢', 'R19', 'R19:V19'),
        cell('birth-value', '1983年', 'R20', 'R20:V20'),
        cell('nationality-label', '国籍', 'W19'),
        cell('nationality-value', '中国', 'W20'),
        cell('address-label', '現住所', 'Z19', 'Z19:AC19'),
        cell('address-value', '東京都・新宿駅', 'Z20', 'Z20:AC20'),
        cell('education-label', '最終学歴', 'B30', 'B30:G30'),
        cell('education-value', '東京情報大学', 'B31', 'B31:G31'),
        cell('major-label', '専門', 'L30', 'L30:P30'),
        cell('major-value', '情報工学', 'L31', 'L31:P31'),
        cell('graduation-label', '卒業年', 'Q30', 'Q30:T30'),
        cell('graduation-value', '2006年3月', 'Q31', 'Q31:T31'),
        cell('degree-label', '学位', 'U30', 'U30:X30'),
        cell('degree-value', '学士', 'U31', 'U31:X31'),
        cell('email-label', 'メール', 'B35'),
        cell('email-value', 'kai@example.jp', 'C35', 'C35:H35'),
        cell('phone-label', '電話番号', 'B36'),
        cell('phone-value', '090-1234-5678', 'C36', 'C36:H36')
      ],
      warnings: [],
      requiresLocalOcr: false,
      statistics: { pages: 0, sheets: 1, blocks: 22, characters: 150 },
      security: { externalContentLoaded: false, macrosExecuted: false, rawFileCloudEligible: false }
    }

    expect(extractCandidateDraft(document).localPersonalDetails).toEqual({
      displayName: '楊 凱',
      gender: '男性',
      birthDate: '1983年',
      nationality: '中国',
      phone: '090-1234-5678',
      email: 'kai@example.jp',
      address: '東京都・新宿駅',
      education: '東京情報大学',
      major: '情報工学',
      graduationDate: '2006年3月',
      degree: '学士'
    })
  })
})

describe('searchConfirmedCandidateProfiles', () => {
  const baseProfile: CandidateProfile = {
    schemaVersion: 'candidate-profile-v1',
    id: '38dca6f6-947b-45d5-98bc-c9e6dcd242e9',
    sourceDocumentId: '5e910bbc-7aeb-4087-8130-4ff63ef8bd68',
    profileVersion: 1,
    reviewRevision: 1,
    localPersonalDetails: {
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
    },
    fields: [
      { key: 'skills', label: 'スキル', value: 'Java, Spring Boot, AWS', sourceLabels: ['Skills!A2'] },
      { key: 'experience_years', label: '経験年数', value: '7年', sourceLabels: ['Skills!B2'] },
      { key: 'availability', label: '稼働可能時期', value: '8月から参画可能', sourceLabels: ['Skills!C2'] },
      { key: 'rate', label: '希望単価', value: '80〜90万円/月', sourceLabels: ['Skills!D2'] },
      { key: 'japanese_level', label: '日本語', value: 'N2', sourceLabels: ['Skills!E2'] },
      { key: 'work_style', label: '勤務形態', value: '週3日リモート', sourceLabels: ['Skills!F2'] },
      { key: 'role', label: 'ロール', value: 'バックエンドエンジニア', sourceLabels: ['Skills!G2'] },
      { key: 'location', label: '希望勤務地', value: '東京都内・品川通勤可', sourceLabels: ['Skills!H2'] },
      { key: 'work_authorization', label: '就労資格', value: '就労制限なし', sourceLabels: ['Skills!I2'] }
    ],
    projectExperiences: [],
    confirmedAt: '2026-07-17T00:00:00.000Z',
    confirmedBy: '山田 太郎',
    containsDirectIdentifiers: false
  }

  it('accepts personal-data metadata for encrypted local candidate profiles', () => {
    expect(candidateProfileSchema.parse({ ...baseProfile, containsDirectIdentifiers: true }).containsDirectIdentifiers).toBe(true)
  })

  it('ranks locally with field-level evidence and never adds identity fields', () => {
    const results = searchConfirmedCandidateProfiles([baseProfile], 'Java AWS 8月')
    expect(results).toHaveLength(1)
    expect(results[0]).toMatchObject({
      anonymousLabel: '候補者 38DCA6F6',
      matchScore: 88,
      matchedTerms: ['Java', 'AWS', '8月'],
      containsDirectIdentifiers: false
    })
    expect(results[0]?.evidence.map((field) => field.key)).toEqual(['skills', 'availability'])
  })

  it('lets 尚可 terms lift the fit score without gating or ranking on their own', () => {
    const withoutAws: CandidateProfile = {
      ...baseProfile,
      id: '8055be48-a08f-499d-9d82-c95a36018ad9',
      sourceDocumentId: '8055be48-a08f-499d-9d82-c95a36018ad9',
      fields: baseProfile.fields.map((field) => field.key === 'skills' ? { ...field, value: 'Java, Spring Boot' } : field)
    }
    const results = searchConfirmedCandidateProfiles([withoutAws, baseProfile], 'Java "尚可:AWS" "尚可:Docker"')
    expect(results.map((result) => result.id)).toEqual([baseProfile.id, withoutAws.id])
    expect(results[0]).toMatchObject({ matchedTerms: ['Java', '尚可:AWS'] })
    expect(results[1]).toMatchObject({ matchedTerms: ['Java'] })
    expect(results[0]!.matchScore!).toBeGreaterThan(results[1]!.matchScore!)
    // Must-have coverage is unaffected by the plus terms.
    expect(results[0]?.retrieval.termCoverage).toBe(100)
    expect(results[0]?.retrieval.hardFilters).toEqual([])
    // A candidate matching only the nice-to-have term is not a result.
    const awsOnly: CandidateProfile = {
      ...baseProfile,
      id: '9055be48-a08f-499d-9d82-c95a36018ad9',
      fields: baseProfile.fields.map((field) => field.key === 'skills' ? { ...field, value: 'AWS' } : field)
    }
    expect(searchConfirmedCandidateProfiles([awsOnly], 'Python "尚可:AWS"')).toEqual([])
  })

  it('does not confuse Java with JavaScript and supports browsing with an empty query', () => {
    const javascriptProfile: CandidateProfile = {
      ...baseProfile,
      id: '8055be48-a08f-499d-9d82-c95a36018ad9',
      fields: baseProfile.fields.map((field) => field.key === 'skills' ? { ...field, value: 'JavaScript, React' } : field)
    }
    expect(searchConfirmedCandidateProfiles([javascriptProfile], 'Java')).toEqual([])
    expect(searchConfirmedCandidateProfiles([javascriptProfile], '')[0]?.matchScore).toBeNull()
  })

  it('evaluates an explicit minimum-years requirement against the confirmed experience field', () => {
    expect(searchConfirmedCandidateProfiles([baseProfile], '5年以上')[0]).toMatchObject({
      matchScore: 100,
      matchedTerms: ['5年以上'],
      evidence: [expect.objectContaining({ key: 'experience_years', value: '7年' })]
    })
    expect(searchConfirmedCandidateProfiles([baseProfile], '8年以上')).toEqual([])
  })

  it('applies hard filters before BM25 ranking and exposes the local retrieval evidence', () => {
    const juniorProfile: CandidateProfile = {
      ...baseProfile,
      id: '8055be48-a08f-499d-9d82-c95a36018ad9',
      sourceDocumentId: '8055be48-a08f-499d-9d82-c95a36018ad9',
      fields: baseProfile.fields.map((field) => field.key === 'experience_years' ? { ...field, value: '3年' } : field)
    }
    const result = searchConfirmedCandidateProfiles([juniorProfile, baseProfile], 'Java 5年以上')[0]
    expect(result?.sourceDocumentId).toBe(baseProfile.sourceDocumentId)
    expect(result?.retrieval).toMatchObject({
      strategy: 'hard-filter-bm25-v1',
      rank: 1,
      termCoverage: 100,
      hardFilters: [{ type: 'minimum-experience-years', requested: '5年以上', actual: '7年', outcome: 'passed' }]
    })
    expect(result?.retrieval.bm25Score).toBeGreaterThan(0)
  })

  it('keeps missing hard-filter fields as unknown instead of silently rejecting the candidate', () => {
    const unknownProfile: CandidateProfile = {
      ...baseProfile,
      id: 'eecabf8d-1a07-4937-99cc-432dbe81352b',
      sourceDocumentId: 'eecabf8d-1a07-4937-99cc-432dbe81352b',
      fields: baseProfile.fields.map((field) => field.key === 'experience_years' ? { ...field, value: null } : field)
    }
    const results = searchConfirmedCandidateProfiles([unknownProfile, baseProfile], '5年以上')
    expect(results).toHaveLength(2)
    expect(results[0]?.id).toBe(baseProfile.id)
    expect(results[1]).toMatchObject({
      id: unknownProfile.id,
      matchedTerms: [],
      retrieval: {
        hardFilters: [{
          type: 'minimum-experience-years',
          requested: '5年以上',
          actual: null,
          outcome: 'unknown'
        }]
      }
    })
  })

  it('applies conservative rate, availability, remote-work and Japanese hard filters', () => {
    const matched = searchConfirmedCandidateProfiles(
      [baseProfile],
      'Java 5年以上 70〜95万円 8月 週3日リモート N2'
    )[0]
    expect(matched?.retrieval.hardFilters).toEqual([
      { type: 'minimum-experience-years', requested: '5年以上', actual: '7年', outcome: 'passed' },
      { type: 'maximum-rate', requested: '70〜95万円', actual: '80〜90万円/月', outcome: 'passed' },
      { type: 'availability-by', requested: '8月', actual: '8月から参画可能', outcome: 'passed' },
      { type: 'remote-work', requested: '週3日リモート', actual: '週3日リモート', outcome: 'passed' },
      { type: 'japanese-level', requested: 'N2', actual: 'N2', outcome: 'passed' }
    ])
    expect(searchConfirmedCandidateProfiles([baseProfile], '75万円以下')).toEqual([])
    expect(searchConfirmedCandidateProfiles([baseProfile], '7月')).toEqual([])
    expect(searchConfirmedCandidateProfiles([baseProfile], '週4日リモート')).toEqual([])
    expect(searchConfirmedCandidateProfiles([baseProfile], 'N1')).toEqual([])
  })

  it('treats the words partners use for a Japanese level as the same hard filter as a JLPT grade', () => {
    // baseProfile holds N2: fluent / business is N2-equivalent, native and N1 are above it.
    const filterFor = (query: string) => searchConfirmedCandidateProfiles([baseProfile], `Java ${query}`)[0]?.retrieval.hardFilters
      .find((filter) => filter.type === 'japanese-level') ?? null
    expect(filterFor('日本語流暢')).toEqual({ type: 'japanese-level', requested: '日本語流暢', actual: 'N2', outcome: 'passed' })
    expect(filterFor('ビジネスレベル')).toMatchObject({ outcome: 'passed' })
    expect(filterFor('日本語N3可')).toMatchObject({ requested: '日本語N3可', outcome: 'passed' })
    expect(filterFor('日常会話レベル')).toMatchObject({ outcome: 'passed' })
    // Above N2: excluded outright, like N1.
    expect(searchConfirmedCandidateProfiles([baseProfile], 'Java 日本語ネイティブ')).toEqual([])
    expect(searchConfirmedCandidateProfiles([baseProfile], 'Java N1以上')).toEqual([])
    // A bare 日本語 states no level and gates nothing.
    expect(filterFor('日本語')).toBeNull()
    // A candidate whose level is only prose is unknown, never passed.
    const prose = { ...baseProfile, fields: baseProfile.fields.map((field) => field.key === 'japanese_level' ? { ...field, value: '日本語での業務経験あり' } : field) }
    expect(searchConfirmedCandidateProfiles([prose], 'Java 日本語流暢')[0]?.retrieval.hardFilters.find((filter) => filter.type === 'japanese-level'))
      .toMatchObject({ outcome: 'unknown' })
    expect(scorableCandidateSearchTerms('Java 日本語流暢 常駐')).toEqual(['Java'])
  })

  it('marks an overlapping desired-rate range unknown so an HR can decide negotiation fit', () => {
    const result = searchConfirmedCandidateProfiles([baseProfile], '85万円以下')[0]
    expect(result?.retrieval.hardFilters).toEqual([
      { type: 'maximum-rate', requested: '85万円以下', actual: '80〜90万円/月', outcome: 'unknown' }
    ])
  })

  it('applies coarse location and compliance-only work-authorization filters without using nationality', () => {
    const result = searchConfirmedCandidateProfiles(
      [baseProfile],
      '勤務地:品川 就労資格:日本で就労可能'
    )[0]
    expect(result?.retrieval).toMatchObject({
      hardFilterPolicyVersion: 'tri-state-v3',
      hardFilters: [
        { type: 'location', requested: '勤務地:品川', actual: '東京都内・品川通勤可', outcome: 'passed' },
        { type: 'work-authorization', requested: '就労資格:日本で就労可能', actual: '就労制限なし', outcome: 'passed' }
      ]
    })
    expect(searchConfirmedCandidateProfiles([baseProfile], '勤務地:大阪')).toEqual([])

    const limited = {
      ...baseProfile,
      id: 'f9d4aec2-80bf-488e-9940-aa659e2377be',
      sourceDocumentId: 'f9d4aec2-80bf-488e-9940-aa659e2377be',
      fields: baseProfile.fields.map((field) => field.key === 'work_authorization'
        ? { ...field, value: '資格外活動のみ（制限あり）' }
        : field)
    }
    expect(searchConfirmedCandidateProfiles([limited], '就労資格:日本で就労可能')).toEqual([])
  })

  it('uses Japanese character n-grams for BM25 recall without indexing reviewer identity', () => {
    const cloudPlatformProfile: CandidateProfile = {
      ...baseProfile,
      id: 'd580e11d-e367-43cd-8e48-ae33f1e57b46',
      sourceDocumentId: 'd580e11d-e367-43cd-8e48-ae33f1e57b46',
      fields: baseProfile.fields.map((field) => field.key === 'role'
        ? { ...field, value: 'クラウドネイティブ基盤エンジニア' }
        : field)
    }
    const results = searchConfirmedCandidateProfiles([cloudPlatformProfile], 'クラウド基盤')
    expect(results[0]).toMatchObject({
      sourceDocumentId: cloudPlatformProfile.sourceDocumentId,
      matchedTerms: ['クラウド基盤'],
      matchScore: 60,
      retrieval: { rank: 1, termCoverage: 100 }
    })
    expect(searchConfirmedCandidateProfiles([cloudPlatformProfile], '山田')).toEqual([])
  })

  it('returns project-level lexical evidence without exposing reviewer identity', () => {
    const projectProfile: CandidateProfile = {
      ...baseProfile,
      projectExperiences: [{
        id: '2cb2d484-1895-401b-871a-dbe33a00dbb8',
        title: '決済基盤の可観測性改善',
        period: '2023年4月〜2024年3月',
        role: 'SRE',
        technologies: ['Kubernetes', 'Prometheus', 'Grafana'],
        summary: 'メトリクスとアラートを再設計し、障害検知時間を短縮した。',
        sourceLabels: ['経歴!A2', '経歴!D2']
      }]
    }
    const result = searchConfirmedCandidateProfiles([projectProfile], '可観測性 アラート', 20)[0]
    expect(result?.projectEvidence).toMatchObject({
      title: '決済基盤の可観測性改善',
      matchType: 'lexical',
      matchedTerms: ['可観測性', 'アラート']
    })
    expect(JSON.stringify(result?.projectEvidence)).not.toContain(projectProfile.confirmedBy)
  })

  it('reports deterministic Recall@K for a fixed confirmed-profile fixture', () => {
    const pythonProfile: CandidateProfile = {
      ...baseProfile,
      id: 'd580e11d-e367-43cd-8e48-ae33f1e57b46',
      sourceDocumentId: 'd580e11d-e367-43cd-8e48-ae33f1e57b46',
      fields: baseProfile.fields.map((field) => field.key === 'skills' ? { ...field, value: 'Python, AWS, Terraform' } : field)
    }
    expect(evaluateCandidateRetrieval([baseProfile, pythonProfile], [
      { query: 'Java Spring Boot', relevantSourceDocumentIds: [baseProfile.sourceDocumentId] },
      { query: 'Python Terraform', relevantSourceDocumentIds: [pythonProfile.sourceDocumentId] }
    ], 1)).toEqual({
      recallAtK: 1,
      evaluatedCases: 2,
      relevantCandidates: 2,
      retrievedRelevantCandidates: 2
    })
  })

  it('evaluates a 30-case expert benchmark without leaking query text into the report', async () => {
    const benchmark: SesCandidateBenchmark = {
      version: 'ses-candidate-benchmark-v1',
      id: 'd5a8372a-f701-4862-8f5d-4278c116fe3c',
      name: 'Tokyo SES Pilot v1',
      createdAt: '2026-07-20T00:00:00.000Z',
      privacy: { directIdentifiersRemoved: true, rawResumeIncluded: false, rawMailIncluded: false },
      labeling: { method: 'ses-expert', reviewerCount: 2 },
      thresholds: { minimumCases: 30, recallAt20: 0.9, ndcgAt20: 0.75, projectEvidenceCoverageAt20: 0.8 },
      cases: Array.from({ length: 30 }, (_, index) => ({
        id: `java-case-${index + 1}`,
        query: 'Java AWS 5年以上',
        relevantCandidateLabels: ['候補者 38DCA6F6'],
        expectedProjectEvidenceLabels: []
      }))
    }
    const report = await evaluateSesCandidateBenchmark(
      benchmark,
      new Set(['候補者 38DCA6F6']),
      async (query, maxResults) => searchConfirmedCandidateProfiles([baseProfile], query, maxResults),
      { id: 'test/model', revision: 'v1' },
      new Date('2026-07-20T00:01:00.000Z')
    )
    expect(report).toMatchObject({
      status: 'passed',
      networkAccess: false,
      cloudUsed: false,
      metrics: { caseCount: 30, recallAt20: 1, ndcgAt20: 1, missingCandidateReferences: 0 }
    })
    expect(JSON.stringify(report)).not.toContain('Java AWS 5年以上')
    expect(report.cases[0]?.queryHash).toMatch(/^[a-f0-9]{64}$/u)

    const invalid = await evaluateSesCandidateBenchmark(
      { ...benchmark, id: '117ab4b4-545f-478e-a8c1-79c42b2fb92c', cases: [{ ...benchmark.cases[0]!, relevantCandidateLabels: ['候補者 DEADBEEF'] }] },
      new Set(['候補者 38DCA6F6']),
      async () => [],
      { id: 'test/model', revision: 'v1' }
    )
    expect(invalid.status).toBe('invalid-references')
    expect(invalid.metrics.missingCandidateReferences).toBe(1)
  })

  it('builds embedding passages from confirmed business values without reviewer or source identity', () => {
    const passage = candidateProfileEmbeddingText(baseProfile)
    expect(passage).toContain('スキル: Java, Spring Boot, AWS')
    expect(passage).toContain('ロール: バックエンドエンジニア')
    expect(passage).not.toContain('希望単価')
    expect(passage).not.toContain('山田 太郎')
    expect(passage).not.toContain('Skills!A2')
    expect(passage).not.toContain(baseProfile.id)
  })

  it('builds reranker passages from anonymous confirmed data only', () => {
    const passage = candidateProfileRerankerText(baseProfile)
    expect(passage).toContain('スキル: Java, Spring Boot, AWS')
    expect(passage).not.toContain('就労資格')
    expect(passage).not.toContain('山田 太郎')
    expect(passage).not.toContain('Skills!A2')
    expect(passage).not.toContain(baseProfile.id)
  })

  it('applies local reranker scores after RRF while preserving the prior rank', () => {
    const results = searchConfirmedCandidateProfiles(
      [baseProfile, { ...baseProfile, id: 'd580e11d-e367-43cd-8e48-ae33f1e57b46', sourceDocumentId: 'd580e11d-e367-43cd-8e48-ae33f1e57b46' }],
      'Java AWS',
      20,
      new Map([[baseProfile.id, 0.95], ['d580e11d-e367-43cd-8e48-ae33f1e57b46', 0.9]])
    )
    expect(results.map((result) => result.id)).toEqual([baseProfile.id, 'd580e11d-e367-43cd-8e48-ae33f1e57b46'])
    const reranked = applyLocalRerankerScores(results, new Map([
      [baseProfile.id, -1.2],
      ['d580e11d-e367-43cd-8e48-ae33f1e57b46', 2.4]
    ]))
    expect(reranked.map((result) => result.id)).toEqual(['d580e11d-e367-43cd-8e48-ae33f1e57b46', baseProfile.id])
    expect(reranked[0]?.retrieval).toMatchObject({
      strategy: 'hard-filter-hybrid-local-rerank-v1',
      preRerankRank: 2,
      rerankerRank: 1,
      rank: 1,
      rerankerScore: 2.4
    })
  })

  it('retrieves semantic-only candidates with local vectors and reuses the encrypted cache', async () => {
    const terraformProfile: CandidateProfile = {
      ...baseProfile,
      id: 'd580e11d-e367-43cd-8e48-ae33f1e57b46',
      sourceDocumentId: 'd580e11d-e367-43cd-8e48-ae33f1e57b46',
      fields: baseProfile.fields.map((field) => field.key === 'skills'
        ? { ...field, value: 'Terraform, Kubernetes, Argo CD' }
        : field.key === 'role' ? { ...field, value: 'SRE' } : field)
    }
    const stored: Array<{
      profileId: string
      modelId: string
      modelRevision: string
      contentHash: string
      vector: number[]
      updatedAt: string
    }> = []
    let passageBatches = 0
    const retrieval = new LocalHybridCandidateRetrieval({
      embedQueries: async () => [[1, 0]],
      embedPassages: async (texts) => {
        passageBatches += 1
        return texts.map((text) => text.includes('Terraform') ? [1, 0] : [0, 1])
      }
    }, {
      listCandidateProfileEmbeddings: () => stored,
      saveCandidateProfileEmbeddings: (records) => stored.push(...records.map((record) => ({
        ...record,
        updatedAt: '2026-07-20T00:00:00.000Z'
      }))),
      listCandidateProjectEmbeddings: () => [],
      saveCandidateProjectEmbeddings: () => undefined
    }, {
      modelId: 'test/multilingual',
      modelRevision: 'test-revision',
      dimension: 2,
      minimumVectorScore: 0.8
    })
    const first = await retrieval.search([baseProfile, terraformProfile], 'インフラ自動化', 20)
    expect(first).toHaveLength(1)
    expect(first[0]).toMatchObject({
      id: terraformProfile.id,
      matchedTerms: [],
      retrieval: {
        strategy: 'hard-filter-hybrid-rrf-v1',
        bm25Rank: null,
        vectorRank: 1,
        rank: 1,
        vectorScore: 1
      }
    })
    expect(stored).toHaveLength(2)
    await retrieval.search([baseProfile, terraformProfile], 'インフラ自動化', 20)
    expect(passageBatches).toBe(1)
  })

  it('invokes local reranking only after hybrid retrieval and records both ranks', async () => {
    const secondProfile: CandidateProfile = {
      ...baseProfile,
      id: 'd580e11d-e367-43cd-8e48-ae33f1e57b46',
      sourceDocumentId: 'd580e11d-e367-43cd-8e48-ae33f1e57b46',
      fields: baseProfile.fields.map((field) => field.key === 'role'
        ? { ...field, value: 'クラウドアーキテクト' }
        : field)
    }
    const rerankerInputs: Array<{ id: string; text: string }> = []
    const retrieval = new LocalHybridCandidateRetrieval({
      embedQueries: async () => [[1, 0]],
      embedPassages: async () => [[1, 0], [0.99, 0.01]]
    }, {
      listCandidateProfileEmbeddings: () => [],
      saveCandidateProfileEmbeddings: () => undefined,
      listCandidateProjectEmbeddings: () => [],
      saveCandidateProjectEmbeddings: () => undefined
    }, {
      modelId: 'test/model', modelRevision: 'v1', dimension: 2, minimumVectorScore: 0.8
    }, {
      rerank: async (_query, candidates) => {
        rerankerInputs.push(...candidates)
        return new Map(candidates.map((candidate) => [candidate.id, candidate.id === secondProfile.id ? 2 : -2]))
      }
    })
    const results = await retrieval.search([baseProfile, secondProfile], 'Java AWS', 20)
    expect(rerankerInputs).toHaveLength(2)
    expect(rerankerInputs.some((candidate) => candidate.text.includes(baseProfile.id))).toBe(false)
    expect(results[0]).toMatchObject({
      id: secondProfile.id,
      retrieval: {
        strategy: 'hard-filter-hybrid-local-rerank-v1',
        preRerankRank: 2,
        rerankerRank: 1,
        rank: 1
      }
    })
  })

  it('applies hard filters before generating candidate vectors', async () => {
    const juniorProfile: CandidateProfile = {
      ...baseProfile,
      id: '8055be48-a08f-499d-9d82-c95a36018ad9',
      sourceDocumentId: '8055be48-a08f-499d-9d82-c95a36018ad9',
      fields: baseProfile.fields.map((field) => field.key === 'experience_years' ? { ...field, value: '3年' } : field)
    }
    const embeddedPassages: string[] = []
    const retrieval = new LocalHybridCandidateRetrieval({
      embedQueries: async () => [[1, 0]],
      embedPassages: async (texts) => {
        embeddedPassages.push(...texts)
        return texts.map(() => [1, 0])
      }
    }, {
      listCandidateProfileEmbeddings: () => [],
      saveCandidateProfileEmbeddings: () => undefined,
      listCandidateProjectEmbeddings: () => [],
      saveCandidateProjectEmbeddings: () => undefined
    }, { modelId: 'test/model', modelRevision: 'v1', dimension: 2, minimumVectorScore: 0.8 })
    const results = await retrieval.search([baseProfile, juniorProfile], 'クラウド移行 5年以上', 20)
    expect(results.map((result) => result.id)).toEqual([baseProfile.id])
    expect(embeddedPassages).toHaveLength(1)
    expect(embeddedPassages[0]).toContain('スキル: Java, Spring Boot, AWS')
  })
})
