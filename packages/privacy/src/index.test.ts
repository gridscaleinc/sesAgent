import {
  CloudRedactionGateway,
  detectDirectIdentifiers,
  evaluatePrivacyExpertDataset,
  redactTextForCloud,
  type CloudCallAuditRecord,
  type RedactionEvidenceStore,
  type RedactionSessionEvidence
} from './index'

class MemoryEvidenceStore implements RedactionEvidenceStore {
  sessions = new Map<string, RedactionSessionEvidence>()
  audits: CloudCallAuditRecord[] = []

  getRedactionSession(id: string): RedactionSessionEvidence | null {
    return this.sessions.get(id) ?? null
  }

  appendCloudCallAudit(record: CloudCallAuditRecord): void {
    this.audits.push(record)
  }
}

describe('local redaction and DLP', () => {
  it('detects direct identifiers and redaction placeholders before profile storage', () => {
    expect(detectDirectIdentifiers('skills: Java\ncontact: 090-1234-5678')).toEqual(['phone'])
    expect(detectDirectIdentifiers('role: 山田太郎', ['山田太郎'])).toEqual(['person_name'])
    expect(detectDirectIdentifiers('skills: <PRIVATE_EMAIL_001>')).toEqual(['private_email'])
  })

  it('replaces direct identifiers with stable placeholders', () => {
    const result = redactTextForCloud(
      '山田太郎です。連絡先は 090-1234-5678 / taro@example.com。担当は山田太郎です。',
      {
        sourceVersion: 'resume:sha256:001',
        knownPersonNames: ['山田太郎'],
        personNameReviewCompleted: true,
        sessionId: '4a4e4318-ab28-4d63-b49d-95f44fbcbe9f',
        now: new Date('2026-07-17T00:00:00.000Z')
      }
    )

    expect(result.session.status).toBe('passed')
    expect(result.payload?.content).toBe(
      '<PERSON_NAME_001>です。連絡先は <PHONE_001> / <PRIVATE_EMAIL_001>。担当は<PERSON_NAME_001>です。'
    )
    expect(result.mappings).toHaveLength(3)
    expect(result.payload?.removedTypes).toEqual(['person_name', 'phone', 'private_email'])
  })

  it('detects and redacts common full-width Japanese contact formats', () => {
    const result = redactTextForCloud(
      '電話：０９０－１２３４－５６７８\nメール：taro＠example．com\n〒１５０－０００１ 東京都渋谷区\n生年月日：１９９０年１月２日',
      { sourceVersion: 'resume:sha256:full-width', personNameReviewCompleted: true }
    )

    expect(result.session.status).toBe('passed')
    expect(result.payload?.removedTypes).toEqual(['phone', 'private_email', 'postal_address', 'birth_date'])
    expect(result.payload?.content).not.toMatch(/[０-９]{3}[ー－][０-９]{4}/u)
    expect(result.payload?.content).not.toContain('taro＠example．com')
  })

  it('keeps digit ranges out of the residual postal-code check while a bare postal code still fails closed', () => {
    const passed = redactTextForCloud(
      '単価：5500-65000円/h\n案件番号：20250-8251\n精算：140-180h',
      { sourceVersion: 'case:sha256:digit-ranges', personNameReviewCompleted: true }
    )
    expect(passed.session.status).toBe('passed')
    expect(passed.blockedReasons).toEqual([])

    const blocked = redactTextForCloud(
      '勤務地：150-0001 東京都渋谷区',
      { sourceVersion: 'case:sha256:bare-postal', personNameReviewCompleted: true }
    )
    expect(blocked.session.status).toBe('failed')
    expect(blocked.blockedReasons).toContain('residual:postal_address')
  })

  it('removes nationality, residence status and work authorization before any cloud payload', () => {
    const result = redactTextForCloud(
      '国籍: 日本\n在留資格: 技術・人文知識・国際業務\n就労資格: 就労制限なし\nスキル: Java',
      { sourceVersion: 'resume:sha256:sensitive-attributes', personNameReviewCompleted: true }
    )

    expect(result.session).toMatchObject({ status: 'passed', policyVersion: 'cloud-redaction-v2' })
    expect(result.payload?.content).toBe(
      '国籍: <NATIONALITY_001>\n在留資格: <RESIDENCE_STATUS_001>\n就労資格: <WORK_AUTHORIZATION_001>\nスキル: Java'
    )
    expect(result.payload?.removedTypes).toEqual(['nationality', 'residence_status', 'work_authorization'])
    expect(detectDirectIdentifiers(result.payload?.content ?? '')).toEqual([
      'nationality',
      'residence_status',
      'work_authorization'
    ])
  })

  it('fails closed when image identity regions have not been redacted', () => {
    const result = redactTextForCloud('Java 8年、AWS 4年', {
      sourceVersion: 'resume:sha256:002',
      personNameReviewCompleted: true,
      mediaRisks: ['face_or_photo']
    })

    expect(result.session.status).toBe('uncertain')
    expect(result.payload).toBeNull()
    expect(result.blockedReasons).toContain('unredacted-media:face_or_photo')
  })

  it('fails closed until a local person-name review is explicitly completed', () => {
    const result = redactTextForCloud('Java 8年、AWS 4年', {
      sourceVersion: 'resume:sha256:name-review-default'
    })

    expect(result.session.status).toBe('uncertain')
    expect(result.payload).toBeNull()
    expect(result.blockedReasons).toEqual(['coverage:person_name_review_required'])
  })
})

describe('human-labeled privacy quality evaluation', () => {
  function expertFixture() {
    const names = ['架空 太郎', '検証 花子', '試験 一郎', '匿名 美咲', '評価 健太']
    const cases = Array.from({ length: 50 }, (_, index) => index < 30
      ? {
          id: `name-case-${String(index + 1).padStart(2, '0')}`,
          text: `氏名：${names[index % names.length]}\nスキル：Java`,
          expected: [{ type: 'person_name' as const, value: names[index % names.length]! }]
        }
      : {
          id: `phone-case-${String(index + 1).padStart(2, '0')}`,
          text: `電話：090-${String(index).padStart(4, '0')}-${String(index + 100).padStart(4, '0')}`,
          expected: [{
            type: 'phone' as const,
            value: `090-${String(index).padStart(4, '0')}-${String(index + 100).padStart(4, '0')}`
          }]
        })
    const safeCases = Array.from({ length: 20 }, (_, index) => ({
      id: `safe-case-${String(index + 1).padStart(2, '0')}`,
      text: `Java AWS Terraform 設計構築 経験区分 ${index + 1}`
    }))
    const dataset = {
      version: 'ses-privacy-expert-dataset-v1' as const,
      templateOnly: false as const,
      humanLabeledDataset: true as const,
      syntheticOnly: false as const,
      locale: 'ja-JP' as const,
      review: {
        protocolVersion: 'ses-privacy-human-review-v1' as const,
        sourceDocumentCount: 50,
        independentReviewerCount: 2,
        disagreementsResolved: true as const,
        approvedForLocalEvaluation: true as const,
        personalDataHandling: 'pseudonymized-local-only' as const,
        reviewedAt: '2026-07-20T00:00:00.000Z'
      },
      cases,
      safeCases
    }
    const automaticNamesByCase = Object.fromEntries(
      cases.slice(0, 30).map((testCase) => [testCase.id, [testCase.expected[0]!.value]])
    )
    return { dataset, automaticNamesByCase }
  }

  it('produces only aggregate release evidence for a sufficiently reviewed dataset', () => {
    const { dataset, automaticNamesByCase } = expertFixture()
    const result = evaluatePrivacyExpertDataset(dataset, automaticNamesByCase)

    expect(result).toMatchObject({
      caseCount: 50,
      safeCaseCount: 20,
      expectedIdentifiers: 50,
      expectedPersonNames: 30,
      postReviewIdentifierRecall: 1,
      automaticPersonNameRecall: 1,
      automaticNonNameIdentifierRecall: 1,
      redactionPrecision: 1,
      residualLeakCount: 0,
      safeCaseFalsePositiveCount: 0,
      releaseEligible: true,
      failures: []
    })
    expect(JSON.stringify(result)).not.toContain(dataset.cases[0]!.text)
    expect(JSON.stringify(result)).not.toContain(dataset.cases[0]!.expected[0]!.value)
  })

  it('fails the release gate when automatic Japanese name recall drops below 90 percent', () => {
    const { dataset, automaticNamesByCase } = expertFixture()
    for (const testCase of dataset.cases.slice(0, 4)) delete automaticNamesByCase[testCase.id]

    const result = evaluatePrivacyExpertDataset(dataset, automaticNamesByCase)

    expect(result.automaticPersonNameRecall).toBeCloseTo(26 / 30)
    expect(result.postReviewIdentifierRecall).toBe(1)
    expect(result.releaseEligible).toBe(false)
  })
})

describe('CloudRedactionGateway', () => {
  const auditContext = {
    qualityGateReportHash: 'a'.repeat(64),
    expertAttestationHash: 'b'.repeat(64),
    reviewTicketHash: 'c'.repeat(64),
    gatePolicyVersion: 'cloud-redaction-v2'
  }

  it('only invokes an allowlisted provider with matching persisted evidence', async () => {
    const store = new MemoryEvidenceStore()
    const redaction = redactTextForCloud('候補者 山田太郎 / 090-1234-5678', {
      sourceVersion: 'candidate:v1',
      knownPersonNames: ['山田太郎'],
      personNameReviewCompleted: true,
      now: new Date('2026-07-17T00:00:00.000Z')
    })
    store.sessions.set(redaction.session.id, redaction.session)
    const invoke = vi.fn().mockResolvedValue({ ok: true })
    const gateway = new CloudRedactionGateway(
      [{ id: 'approved', endpoint: 'https://api.example.test/v1/messages', invoke }],
      store,
      {
        policyVersion: 'cloud-redaction-v2',
        allowedEndpoints: ['https://api.example.test/v1/messages'],
        now: () => new Date('2026-07-17T00:01:00.000Z')
      }
    )

    await expect(gateway.invoke('approved', 'MATCH_CANDIDATES', redaction.payload!, auditContext)).resolves.toEqual({ ok: true })
    expect(invoke).toHaveBeenCalledWith('MATCH_CANDIDATES', '候補者 <PERSON_NAME_001> / <PHONE_001>')
    expect(store.audits.at(-1)).toMatchObject({
      outcome: 'succeeded',
      inputHash: redaction.session.contentHash,
      reviewTicketStatus: 'confirmed'
    })
  })

  it('blocks forged, expired and non-HTTPS requests before the provider', async () => {
    const store = new MemoryEvidenceStore()
    const redaction = redactTextForCloud('Java 8年', {
      sourceVersion: 'candidate:v2',
      personNameReviewCompleted: true,
      now: new Date('2026-07-17T00:00:00.000Z'),
      ttlMinutes: 1
    })
    store.sessions.set(redaction.session.id, redaction.session)
    const invoke = vi.fn()
    const gateway = new CloudRedactionGateway(
      [{ id: 'unsafe', endpoint: 'http://localhost:9000/model', invoke }],
      store,
      {
        policyVersion: 'cloud-redaction-v2',
        allowedEndpoints: ['http://localhost:9000/model'],
        now: () => new Date('2026-07-17T00:00:30.000Z')
      }
    )

    await expect(gateway.invoke('unsafe', 'MATCH_CANDIDATES', redaction.payload!, auditContext)).rejects.toThrow('endpoint-not-https')
    expect(invoke).not.toHaveBeenCalled()

    const expiredGateway = new CloudRedactionGateway(
      [{ id: 'approved', endpoint: 'https://api.example.test/model', invoke }],
      store,
      {
        policyVersion: 'cloud-redaction-v2',
        allowedEndpoints: ['https://api.example.test/model'],
        now: () => new Date('2026-07-17T00:02:00.000Z')
      }
    )
    await expect(expiredGateway.invoke('approved', 'MATCH_CANDIDATES', redaction.payload!, auditContext)).rejects.toThrow(
      'redaction-session-expired'
    )

    const forged = { ...redaction.payload }
    await expect(expiredGateway.invoke('approved', 'MATCH_CANDIDATES', forged as never, auditContext)).rejects.toThrow(
      'unbranded-payload'
    )
    expect(invoke).not.toHaveBeenCalled()
  })

  it('blocks missing evidence hashes and mismatched gate policies before the provider', async () => {
    const store = new MemoryEvidenceStore()
    const redaction = redactTextForCloud('Java 8年', {
      sourceVersion: 'candidate:v3',
      personNameReviewCompleted: true,
      now: new Date('2026-07-17T00:00:00.000Z')
    })
    store.sessions.set(redaction.session.id, redaction.session)
    const invoke = vi.fn()
    const gateway = new CloudRedactionGateway(
      [{ id: 'approved', endpoint: 'https://api.example.test/model', invoke }],
      store,
      {
        policyVersion: 'cloud-redaction-v2',
        allowedEndpoints: ['https://api.example.test/model'],
        now: () => new Date('2026-07-17T00:01:00.000Z')
      }
    )

    await expect(gateway.invoke('approved', 'MATCH_CANDIDATES', redaction.payload!, {
      ...auditContext,
      expertAttestationHash: 'not-a-hash'
    })).rejects.toThrow('invalid-gate-audit-context')
    await expect(gateway.invoke('approved', 'MATCH_CANDIDATES', redaction.payload!, {
      ...auditContext,
      gatePolicyVersion: 'cloud-redaction-v1'
    })).rejects.toThrow('gate-policy-mismatch')
    expect(invoke).not.toHaveBeenCalled()
  })
})
