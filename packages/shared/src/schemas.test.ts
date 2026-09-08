// @vitest-environment node
import { describe, expect, it } from 'vitest'
import {
  googleWorkspaceAdminConfigurationSchema,
  googleWorkspaceOnlineAcceptanceReportSchema,
  executeAiCommerceCloudPromptInputSchema,
  localApplicationPreferencesSchema,
  localOperatorProfileSchema,
  prepareAiCommerceCloudPromptInputSchema,
  submitCandidateReviewInputSchema,
  saveLocalApplicationPreferencesInputSchema,
  saveLocalOperatorProfileInputSchema,
  saveGoogleWorkspaceAdminConfigurationInputSchema,
  updateCandidateProfileInputSchema,
  aiConversationContextSchema,
  aiConversationSnapshotSchema,
  candidateMatchAssessmentSchema,
  saveAiConversationInputSchema,
  executeAgentTurnInputSchema,
  agentTurnEventSchema,
  jobCaseDeletionPreviewSchema,
  jobCaseReviewSnapshotSchema,
  jobCaseSourceTypeSchema,
  jobCaseFieldAliasMapSchema,
  saveJobCaseFieldAliasesInputSchema
} from './schemas'

const validInput = {
  clientId: '1234567890-abcdefghijklmnop.apps.googleusercontent.com',
  workspaceDomain: 'Company.CO.JP',
  labelIds: ['INBOX', 'Label_SES'],
  query: '案件 OR 要員',
  lookbackDays: 30,
  maxMessagesPerRun: 200,
  expectedRevision: null,
  readonlyAcknowledged: true as const
}

describe('Google Workspace administrator configuration schemas', () => {
  it('normalizes the company domain and accepts bounded read-only synchronization settings', () => {
    expect(saveGoogleWorkspaceAdminConfigurationInputSchema.parse(validInput)).toMatchObject({
      workspaceDomain: 'company.co.jp',
      labelIds: ['INBOX', 'Label_SES'],
      query: '案件 OR 要員'
    })
  })

  it('rejects Gmail operators and requires an explicit read-only acknowledgement', () => {
    expect(() => saveGoogleWorkspaceAdminConfigurationInputSchema.parse({
      ...validInput,
      query: 'from:partner@example.co.jp'
    })).toThrow(/業務キーワード/)
    expect(saveGoogleWorkspaceAdminConfigurationInputSchema.safeParse({
      ...validInput,
      readonlyAcknowledged: false
    }).success).toBe(false)
  })

  it('requires a revision for persisted local configuration', () => {
    expect(googleWorkspaceAdminConfigurationSchema.safeParse({
      version: 'google-workspace-admin-config-v1',
      source: 'local-admin',
      editable: true,
      ...validInput,
      revision: null,
      configuredBy: 'ローカル管理者',
      updatedAt: '2026-07-20T05:00:00.000Z'
    }).success).toBe(false)
  })

  it('accepts a product-managed public connector without a fixed customer domain', () => {
    expect(googleWorkspaceAdminConfigurationSchema.parse({
      version: 'google-workspace-admin-config-v1',
      source: 'managed-environment',
      editable: false,
      clientId: validInput.clientId,
      workspaceDomain: null,
      labelIds: ['INBOX'],
      query: '案件 OR 募集',
      lookbackDays: 30,
      maxMessagesPerRun: 200,
      revision: null,
      configuredBy: 'product',
      updatedAt: '2026-09-01T00:00:00.000Z'
    }).workspaceDomain).toBeNull()
  })

  it('continues to read acceptance reports written before account identity replaced company domain', () => {
    const check = (id: string) => ({ id, status: 'passed' as const, label: id, detail: 'verified' })
    expect(googleWorkspaceOnlineAcceptanceReportSchema.safeParse({
      version: 'google-workspace-online-acceptance-v1',
      id: '59d99a84-c5ea-4474-b08a-ddfd8f5eca73',
      checkedAt: '2026-07-20T00:05:00.000Z',
      overall: 'passed',
      configurationFingerprint: 'a'.repeat(64),
      credentialProtection: 'macos-keychain',
      mailboxMetadataAccessed: true,
      messageContentAccessedDuringCheck: false,
      cloudModelUsed: false,
      directIdentifierCloudSent: false,
      checks: [
        check('live-profile'), check('readonly-scope'), check('company-domain'),
        check('credential-protection'), check('bounded-sync'), check('successful-sync'),
        check('local-redaction'), check('no-cloud-model'), check('no-send-path')
      ],
      evidence: {
        grantedScopeCount: 1,
        sync: { status: 'idle', lastSyncedAt: '2026-07-20T00:04:00.000Z', mode: 'baseline', discovered: 1, imported: 1, duplicates: 0, filtered: 0, failed: 0 },
        redaction: { storedMessages: 1, passed: 1, uncertain: 0, blocked: 0 }
      }
    }).success).toBe(true)
  })
})

describe('local operator profile schemas', () => {
  it('trims a local audit identity and accepts an optimistic revision', () => {
    expect(saveLocalOperatorProfileInputSchema.parse({
      displayName: ' 佐藤 美咲 ',
      roleLabel: ' SES営業担当 ',
      expectedRevision: 2
    })).toEqual({ displayName: '佐藤 美咲', roleLabel: 'SES営業担当', expectedRevision: 2 })
  })

  it('requires coherent configured state and rejects control characters', () => {
    expect(localOperatorProfileSchema.safeParse({
      version: 'local-operator-profile-v1',
      operatorId: '11111111-1111-4111-8111-111111111111',
      displayName: '本機ユーザー',
      roleLabel: 'プロフィール未設定',
      configured: false,
      revision: 1,
      updatedAt: null,
      cloudEligible: false
    }).success).toBe(false)
    expect(saveLocalOperatorProfileInputSchema.safeParse({
      displayName: '佐藤\n美咲', roleLabel: '営業担当', expectedRevision: null
    }).success).toBe(false)
  })
})

describe('local application preferences schemas', () => {
  it('accepts only supported display locales and an optimistic revision', () => {
    expect(saveLocalApplicationPreferencesInputSchema.parse({
      locale: 'zh-CN', expectedRevision: 2
    })).toEqual({ locale: 'zh-CN', expectedRevision: 2 })
    expect(saveLocalApplicationPreferencesInputSchema.safeParse({
      locale: 'en-US', expectedRevision: null
    }).success).toBe(false)
  })

  it('keeps the local-only persistence state coherent', () => {
    expect(localApplicationPreferencesSchema.safeParse({
      version: 'local-application-preferences-v1',
      locale: 'ja-JP',
      configured: false,
      revision: 1,
      updatedAt: null,
      cloudEligible: false
    }).success).toBe(false)
  })
})

describe('Cloud AI two-step review schemas', () => {
  it('accepts only prompt content during preparation', () => {
    expect(prepareAiCommerceCloudPromptInputSchema.parse({
      content: '  Java 案件の要点を整理してください。  '
    })).toEqual({ content: 'Java 案件の要点を整理してください。' })
    expect(prepareAiCommerceCloudPromptInputSchema.safeParse({
      content: 'Java',
      personNameReviewCompleted: true
    }).success).toBe(false)
  })

  it('accepts only an opaque UUID ticket during execution', () => {
    expect(executeAiCommerceCloudPromptInputSchema.parse({
      reviewTicket: '11111111-1111-4111-8111-111111111111'
    })).toEqual({ reviewTicket: '11111111-1111-4111-8111-111111111111' })
    expect(executeAiCommerceCloudPromptInputSchema.safeParse({
      reviewTicket: '11111111-1111-4111-8111-111111111111',
      content: 'Renderer must not resubmit content.'
    }).success).toBe(false)
  })
})

describe('candidate profile compatibility schemas', () => {
  const legacyFields = [
    'skills',
    'experience_years',
    'availability',
    'rate',
    'japanese_level',
    'work_style',
    'role',
    'location'
  ] as const

  it('accepts a legacy review containing fewer than the current nine standard fields', () => {
    expect(submitCandidateReviewInputSchema.safeParse({
      documentId: '11111111-1111-4111-8111-111111111111',
      reviewRevision: 1,
      piiReviewed: true,
      fields: legacyFields.map((key) => ({ key, value: null, confirmed: true as const })),
      projectExperiences: []
    }).success).toBe(true)
  })

  it('allows a legacy partial profile to be edited without inventing missing fields', () => {
    expect(updateCandidateProfileInputSchema.safeParse({
      sourceDocumentId: '11111111-1111-4111-8111-111111111111',
      expectedVersion: 1,
      identity: {
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
      fields: legacyFields.map((key) => ({ key, value: null })),
      projectExperiences: []
    }).success).toBe(true)
  })
})

describe('job case source compatibility schemas', () => {
  it('accepts every persisted job-case source type used by the current schema', () => {
    const sourceTypes = ['gmail', 'manual', 'eml', 'chat-paste', 'wechat-visible']
    expect(sourceTypes.map((sourceType) => jobCaseSourceTypeSchema.parse(sourceType))).toEqual(sourceTypes)
    expect(sourceTypes.map((sourceType) => jobCaseReviewSnapshotSchema.shape.sourceType.parse(sourceType))).toEqual(sourceTypes)
    expect(sourceTypes.map((sourceType) => jobCaseDeletionPreviewSchema.shape.sourceType.parse(sourceType))).toEqual(sourceTypes)
  })

  it('rejects unknown job-case source types', () => {
    expect(jobCaseSourceTypeSchema.safeParse('agent-generated').success).toBe(false)
  })
})

describe('Schema v38 local Agent conversation schemas', () => {
  it('keeps sales-agent context immutable and candidate/interview compatibility strict', () => {
    expect(aiConversationContextSchema.parse({
      assistant: 'sales-agent', candidateDocumentId: null, interviewId: null, interviewKind: null, roundNumber: null
    })).toMatchObject({ assistant: 'sales-agent', candidateDocumentId: null })
    expect(aiConversationContextSchema.safeParse({
      assistant: 'candidate-profile', candidateDocumentId: null, interviewId: null, interviewKind: null, roundNumber: null
    }).success).toBe(false)
  })

  it('accepts only Main-owned turn input and rejects a renderer-supplied tool name', () => {
    const parsed = executeAgentTurnInputSchema.parse({
      conversationId: '11111111-1111-4111-8111-111111111111',
      message: '最近有什么案件？', expectedConversationRevision: null,
      requestId: '22222222-2222-4222-8222-222222222222'
    })
    expect(parsed.message).toBe('最近有什么案件？')
    expect(parsed.modelKey).toBe('gpt-5.6-luna')
    expect(executeAgentTurnInputSchema.safeParse({ ...parsed, toolName: 'proposal.export' }).success).toBe(false)
    expect(executeAgentTurnInputSchema.safeParse({ ...parsed, modelKey: 'https://evil.invalid/model' }).success).toBe(false)
  })

  it('accepts an allowlisted right workspace reference but never on a historical edit branch', () => {
    const activeSystemAccess = {
      type: 'system-access' as const,
      destination: 'candidate' as const,
      sourceDocumentId: '33333333-3333-4333-8333-333333333333',
      view: 'records' as const,
      interviewId: '44444444-4444-4444-8444-444444444444',
      interviewKind: 'recruiting' as const
    }
    const parsed = executeAgentTurnInputSchema.parse({
      conversationId: '11111111-1111-4111-8111-111111111111',
      message: '总结右侧记录', expectedConversationRevision: 2,
      requestId: '22222222-2222-4222-8222-222222222222',
      activeSystemAccess
    })
    expect(parsed.activeSystemAccess).toEqual(activeSystemAccess)
    expect(executeAgentTurnInputSchema.safeParse({
      ...parsed,
      conversationId: '55555555-5555-4555-8555-555555555555',
      expectedConversationRevision: null,
      branchFrom: {
        conversationId: parsed.conversationId,
        messageId: 'old-user-message',
        expectedRevision: 2
      }
    }).success).toBe(false)
  })

  it('accepts bounded typed Agent SSE events and rejects oversized deltas', () => {
    const event = {
      type: 'delta' as const,
      conversationId: '11111111-1111-4111-8111-111111111111',
      requestId: '22222222-2222-4222-8222-222222222222',
      sequence: 3,
      modelKey: 'gpt-5.6-luna',
      modelDisplayName: 'GPT-5.6 Luna',
      text: '案件の要点です。'
    }
    expect(agentTurnEventSchema.parse(event)).toEqual(event)
    expect(agentTurnEventSchema.safeParse({ ...event, text: 'x'.repeat(2_001) }).success).toBe(false)
    expect(agentTurnEventSchema.safeParse({ ...event, sequence: 0 }).success).toBe(false)
  })

  it('accepts job-case field aliases that name exactly one field and rejects colons and cross-field duplicates', () => {
    expect(jobCaseFieldAliasMapSchema.parse({ rate: ['単金', '金額'], start_date: ['稼働'] })).toEqual({ rate: ['単金', '金額'], start_date: ['稼働'] })
    expect(jobCaseFieldAliasMapSchema.parse({})).toEqual({})
    expect(jobCaseFieldAliasMapSchema.safeParse({ rate: ['単金：'] }).success).toBe(false)
    // 単金 cannot mean both the rate and the settlement, even written with different spacing.
    expect(jobCaseFieldAliasMapSchema.safeParse({ rate: ['単金'], settlement: ['単 金'] }).success).toBe(false)
    expect(saveJobCaseFieldAliasesInputSchema.safeParse({ aliases: { rate: ['単金'] }, expectedRevision: null, extra: true }).success).toBe(false)
  })

  it('keeps the intake batch pointer optional so older Sales Agent conversations still parse', () => {
    const context = { assistant: 'sales-agent' as const, candidateDocumentId: null, interviewId: null, interviewKind: null, roundNumber: null }
    const message = { id: 'm1', role: 'user' as const, content: '案件', mode: 'local' as const, createdAt: '2026-08-18T00:00:00.000Z' }
    const base = { id: '22222222-2222-4222-8222-222222222222', context, title: '案件', messages: [message], revision: 1, createdAt: '2026-08-18T00:00:00.000Z', updatedAt: '2026-08-18T00:00:00.000Z' }
    const legacy = aiConversationSnapshotSchema.parse({ ...base, salesAgentState: { selectedJobCaseRef: null, lastMatchRunId: null, lastSearchMessageId: null } })
    expect(legacy.salesAgentState?.lastIntakeBatch).toBeUndefined()
    const batch = { intakeBatchId: '33333333-3333-4333-8333-333333333333', messageId: 'assistant-1', reviewIds: ['44444444-4444-4444-8444-444444444444'] }
    const current = aiConversationSnapshotSchema.parse({
      ...base, salesAgentState: { selectedJobCaseRef: null, lastMatchRunId: null, lastSearchMessageId: null, lastIntakeBatch: batch }
    })
    expect(current.salesAgentState?.lastIntakeBatch).toEqual(batch)
  })

  it('stores the cloud review on a match card only in its protocol shape', () => {
    const assessment = {
      version: 'match-assessment-v1' as const, fit: 'possible' as const,
      met: [{ requirement: 'Java', evidence: 'Java 5年' }], gaps: ['AWS'], confirm: [],
      reason: '主要スキルは一致。', modelKey: 'gpt-5', assessedAt: '2026-08-26T00:00:00.000Z'
    }
    expect(candidateMatchAssessmentSchema.parse(assessment)).toEqual(assessment)
    expect(candidateMatchAssessmentSchema.safeParse({ ...assessment, fit: 'excellent' }).success).toBe(false)
    expect(candidateMatchAssessmentSchema.safeParse({ ...assessment, met: Array.from({ length: 9 }, () => ({ requirement: 'a', evidence: 'b' })) }).success).toBe(false)

    const context = { assistant: 'sales-agent' as const, candidateDocumentId: null, interviewId: null, interviewKind: null, roundNumber: null }
    const card = {
      reference: { kind: 'match-result' as const, objectId: '99999999-9999-4999-8999-999999999999', objectVersion: null, resultHash: 'a'.repeat(64), ordinal: 1, label: 'CANDIDATE_1', target: 'match-result:99999999-9999-4999-8999-999999999999' },
      candidateProfileId: '77777777-7777-4777-8777-777777777777', runId: '88888888-8888-4888-8888-888888888888', rank: 1,
      anonymousLabel: 'CANDIDATE_1', fitScore: 72, matched: ['Java'], missing: [], hardFilterStatus: 'passed' as const, projectEvidence: null, status: 'current' as const
    }
    const block = { type: 'candidate-match-cards' as const, runId: '88888888-8888-4888-8888-888888888888', resultHash: 'a'.repeat(64), cards: [{ ...card, assessment }] }
    const message = { id: 'assistant-1', role: 'assistant' as const, content: '匹配结果。', mode: 'local' as const, createdAt: '2026-08-26T00:00:01.000Z', blocks: [block] }
    const base = {
      id: '22222222-2222-4222-8222-222222222222', context, title: '匹配', revision: 1,
      createdAt: '2026-08-26T00:00:00.000Z', updatedAt: '2026-08-26T00:00:01.000Z',
      salesAgentState: { selectedJobCaseRef: null, lastMatchRunId: null, lastSearchMessageId: null }
    }
    expect(aiConversationSnapshotSchema.parse({ ...base, messages: [message] }).messages[0]?.blocks?.[0]).toMatchObject({ cards: [{ assessment }] })
    // A local-only run has no review at all; older conversations keep parsing.
    const localOnly = aiConversationSnapshotSchema.parse({ ...base, messages: [{ ...message, blocks: [{ ...block, cards: [card] }] }] })
    expect(localOnly.messages[0]?.blocks?.[0]).not.toHaveProperty('cards.0.assessment')
    expect(aiConversationSnapshotSchema.safeParse({ ...base, messages: [{ ...message, blocks: [{ ...block, cards: [{ ...card, assessment: { ...assessment, fit: 'excellent' } }] }] }] }).success).toBe(false)
  })

  it('bounds a drafted message block and keeps pre-sales-group cards readable', () => {
    const context = { assistant: 'sales-agent' as const, candidateDocumentId: null, interviewId: null, interviewKind: null, roundNumber: null }
    const card = (ordinal: number) => ({
      reviewId: '44444444-4444-4444-8444-444444444444',
      jobCaseId: '55555555-5555-4555-8555-555555555555',
      jobCaseVersion: 1,
      ordinal,
      title: 'Java 案件',
      status: 'new' as const,
      templateId: '66666666-6666-4666-8666-666666666666',
      templateRevision: 1,
      textJa: '【案件】Java 案件',
      textZh: '【案件】Java 案件',
      forbiddenJa: [],
      forbiddenZh: []
    })
    const block = {
      type: 'job-case-broadcast-cards' as const,
      cards: [card(1)],
      queue: { new: 1, copied: 0, attention: 0 }
    }
    const message = { id: 'assistant-1', role: 'assistant' as const, content: '群メッセージ', mode: 'local' as const, createdAt: '2026-08-25T00:00:01.000Z', blocks: [block] }
    const base = {
      id: '22222222-2222-4222-8222-222222222222', context, title: '案件配信', revision: 1,
      createdAt: '2026-08-25T00:00:00.000Z', updatedAt: '2026-08-25T00:00:01.000Z',
      salesAgentState: { selectedJobCaseRef: null, lastMatchRunId: null, lastSearchMessageId: null }
    }
    expect(aiConversationSnapshotSchema.parse({ ...base, messages: [message] }).messages[0]?.blocks?.[0]).toMatchObject(block)
    // One turn can never inflate a stored conversation: eight cards, and the
    // message text stays inside a group message's size.
    expect(aiConversationSnapshotSchema.safeParse({
      ...base, messages: [{ ...message, blocks: [{ ...block, cards: Array.from({ length: 9 }, (_unused, index) => card(index + 1)) }] }]
    }).success).toBe(false)
    expect(aiConversationSnapshotSchema.safeParse({
      ...base, messages: [{ ...message, blocks: [{ ...block, cards: [{ ...card(1), textZh: 'x'.repeat(2_001) }] }] }]
    }).success).toBe(false)
    expect(aiConversationSnapshotSchema.safeParse({
      ...base, messages: [{ ...message, blocks: [{ ...block, cards: [{ ...card(1), title: 'x'.repeat(201) }] }] }]
    }).success).toBe(false)
    expect(aiConversationSnapshotSchema.safeParse({
      ...base, messages: [{ ...message, blocks: [{ ...block, queue: { copied: 0 } }] }]
    }).success).toBe(false)
    // A card stored while 案件配信 still tracked sales groups keeps parsing:
    // its group fields are unknown keys and are dropped, and its send-shaped
    // status reads as the copy it always really was.
    const beforeGroupsLeft = {
      ...message,
      id: 'assistant-legacy-groups',
      blocks: [{
        ...block,
        queue: { new: 1, pending: 2, sent: 3, attention: 0 },
        cards: [{
          ...card(1),
          status: 'sent',
          recommendedGroups: [{ id: '77777777-7777-4777-8777-777777777777', name: '関西Javaグループ', lang: 'zh' }]
        }]
      }]
    }
    const migrated = aiConversationSnapshotSchema.parse({ ...base, messages: [beforeGroupsLeft] }).messages[0]?.blocks?.[0]
    expect(migrated).toMatchObject({
      queue: { new: 1, copied: 5, attention: 0 },
      cards: [{ ordinal: 1, status: 'copied' }]
    })
    expect(JSON.stringify(migrated)).not.toContain('関西Javaグループ')
    // The block is one member of the union, so a conversation recorded before
    // it existed still parses unchanged.
    const legacy = { ...message, id: 'assistant-legacy', blocks: [{ type: 'system-access' as const, destination: 'broadcast' as const }] }
    expect(aiConversationSnapshotSchema.parse({ ...base, messages: [legacy] }).messages[0]?.blocks?.[0]).toEqual({ type: 'system-access', destination: 'broadcast' })
  })

  it('does not allow Sales Agent mutable state on legacy candidate or interview conversations', () => {
    const state = { selectedJobCaseRef: null, lastMatchRunId: null, lastSearchMessageId: null }
    const context = { assistant: 'candidate-profile' as const, candidateDocumentId: '11111111-1111-4111-8111-111111111111', interviewId: null, interviewKind: null, roundNumber: null }
    const message = { id: 'legacy-message', role: 'user' as const, content: '候補者の経験', mode: 'local' as const, createdAt: '2026-08-18T00:00:00.000Z' }
    expect(saveAiConversationInputSchema.safeParse({ conversationId: '22222222-2222-4222-8222-222222222222', context, messages: [message], salesAgentState: state, expectedRevision: null }).success).toBe(false)
    expect(aiConversationSnapshotSchema.safeParse({ id: '22222222-2222-4222-8222-222222222222', context, title: '候補者の経験', messages: [message], salesAgentState: state, revision: 1, createdAt: '2026-08-18T00:00:00.000Z', updatedAt: '2026-08-18T00:00:00.000Z' }).success).toBe(false)
  })
})
