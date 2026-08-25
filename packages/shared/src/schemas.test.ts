// @vitest-environment node
import { describe, expect, it } from 'vitest'
import {
  googleWorkspaceAdminConfigurationSchema,
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
  saveAiConversationInputSchema,
  executeAgentTurnInputSchema,
  agentTurnEventSchema
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

  it('does not allow Sales Agent mutable state on legacy candidate or interview conversations', () => {
    const state = { selectedJobCaseRef: null, lastMatchRunId: null, lastSearchMessageId: null }
    const context = { assistant: 'candidate-profile' as const, candidateDocumentId: '11111111-1111-4111-8111-111111111111', interviewId: null, interviewKind: null, roundNumber: null }
    const message = { id: 'legacy-message', role: 'user' as const, content: '候補者の経験', mode: 'local' as const, createdAt: '2026-08-18T00:00:00.000Z' }
    expect(saveAiConversationInputSchema.safeParse({ conversationId: '22222222-2222-4222-8222-222222222222', context, messages: [message], salesAgentState: state, expectedRevision: null }).success).toBe(false)
    expect(aiConversationSnapshotSchema.safeParse({ id: '22222222-2222-4222-8222-222222222222', context, title: '候補者の経験', messages: [message], salesAgentState: state, revision: 1, createdAt: '2026-08-18T00:00:00.000Z', updatedAt: '2026-08-18T00:00:00.000Z' }).success).toBe(false)
  })
})
