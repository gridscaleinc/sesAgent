(() => {
  const now = '2026-07-19T10:00:00.000Z'
  const fixtureName = new URLSearchParams(window.location.search).get('fixture')
  const onlineAcceptanceMode = fixtureName === 'google-online-acceptance'
  const policy = {
    policyVersion: 'cloud-redaction-v2',
    cloudDirectIdentifiers: 'blocked',
    cloudPayload: 'redacted-only',
    automaticSending: false
  }
  const scope = {
    id: 'confirmed-candidate-pool',
    label: '確認済み候補者プール',
    detail: '匿名化・確認済みの候補者プロフィールのみ'
  }
  const task = (id, type, title, typeLabel, status, progress, evidenceCount, updatedAt) => ({
    id,
    type,
    typeLabel,
    title,
    instruction: title,
    scope,
    steps: [
      { id: `${id}-1`, title: '対象を確認', description: '許可されたデータ範囲を確認', status: 'completed' },
      { id: `${id}-2`, title: 'ローカル処理', description: '端末内で候補を整理', status: status === 'running' ? 'running' : 'completed' },
      { id: `${id}-3`, title: '人の確認', description: '結果と根拠を確認', status: status === 'awaiting_review' ? 'blocked' : 'pending' }
    ],
    requiredApprovals: ['候補者と根拠の確認'],
    privacy: policy,
    contextBindings: [],
    status,
    progress,
    createdAt: now,
    updatedAt,
    evidenceCount,
    messages: [
      { id: `${id}-message-1`, role: 'user', kind: 'instruction', content: title, createdAt: now },
      { id: `${id}-message-2`, role: 'assistant', kind: 'plan', content: '許可されたデータ範囲と統制ポリシーを確認しました。以下の計画で作業します。', createdAt: now },
      { id: `${id}-message-3`, role: 'system', kind: status === 'awaiting_review' ? 'review' : 'status', content: status === 'awaiting_review' ? 'ローカル処理が完了しました。結果と根拠を確認してください。' : '端末内処理を実行しています。', createdAt: updatedAt }
    ],
    approvalGates: [{ id: `${id}-approval-1`, label: '候補者と根拠の確認', status: 'required', approvedBy: null, approvedAt: null }],
    artifacts: status === 'awaiting_review' ? [{
      id: `${id}-artifact-1`,
      kind: type === 'IMPORT_RESUME' ? 'candidate-profile' : type === 'GENERATE_PROPOSAL' ? 'proposal-draft' : 'candidate-match-results',
      label: type === 'IMPORT_RESUME' ? '候補者フィールド草稿' : type === 'GENERATE_PROPOSAL' ? '提案下書き' : '候補者比較結果',
      status: 'available',
      objectId: id,
      contentHash: 'c'.repeat(64),
      containsDirectIdentifiers: false,
      createdAt: updatedAt
    }] : [],
    toolAudits: [
      { id: `${id}-audit-1`, action: 'task.create', decision: 'executed', dataScopeId: scope.id, externalSideEffect: 'local-write', cloudPayload: 'none', evidenceCount: 0, reason: '確認済みプレビューからローカルタスクを作成しました。', createdAt: now },
      { id: `${id}-audit-2`, action: type === 'IMPORT_RESUME' ? 'resume.local-parse' : type === 'GENERATE_PROPOSAL' ? 'proposal.draft' : 'candidate.search', decision: 'executed', dataScopeId: scope.id, externalSideEffect: 'local-write', cloudPayload: 'none', evidenceCount, reason: '確認済みデータだけを端末内で処理しました。', createdAt: updatedAt }
    ]
  })
  const recoverySummary = {
    version: 'ses-recovery-v1',
    backupId: '16e2a4d9-bd69-4d64-9dad-a9f6d238f8c1',
    createdAt: '2026-07-19T10:15:00.000Z',
    sourcePlatform: 'darwin',
    sourceArch: 'arm64',
    schemaVersion: 28,
    databaseBytes: 8388608,
    vaultObjectCount: 24,
    vaultBytes: 14680064,
    totalBytes: 23068672,
    googleWorkspaceCredentialIncluded: false,
    cloudDataIncluded: false
  }
  const emlFieldValues = {
    title: 'Java / AWS 決済基盤案件',
    role: 'バックエンドエンジニア',
    required_skills: 'Java / Spring Boot / AWS',
    rate: '90万円/月',
    settlement: '140-180h',
    location: '品川',
    remote: '週3日リモート',
    start_date: '8月',
    working_hours: '9:00-18:00',
    japanese_level: 'N1相当',
    interview: '2回',
    contract_chain: 'エンド→元請→当社',
    payment_terms: '40日',
    work_authorization: '日本で就労可能'
  }
  const emlLabels = {
    title: '案件名', role: '募集ロール', required_skills: '必須スキル', rate: '単価', settlement: '精算',
    location: '勤務地', remote: 'リモート', start_date: '開始時期', working_hours: '勤務時間',
    japanese_level: '日本語', interview: '面談', contract_chain: '契約・商流', payment_terms: '支払条件',
    work_authorization: '就労資格'
  }
  const emlReview = {
    reviewId: 'd18d7344-15c9-457f-a338-c6d0c47652c1',
    sourceId: 'fb81df82-86c1-438f-a133-491a60a97c18',
    sourceType: 'eml',
    providerMessageId: `eml_${'a'.repeat(64)}`,
    threadId: `emlt_${'b'.repeat(64)}`,
    fromDomain: 'partner.example.jp',
    messageDate: '2026-07-19T09:35:00.000Z',
    redactedSubject: 'Java / AWS 決済基盤案件 <PERSON_NAME_001>',
    redactedPreview: 'Java / AWS 決済基盤案件 <PERSON_NAME_001>\n\n必須スキル：Java / Spring Boot / AWS\n電話：<PHONE_001>',
    reviewRevision: 1,
    status: 'awaiting-review',
    privacyReviewed: false,
    fields: Object.entries(emlFieldValues).map(([key, value]) => ({
      key,
      label: emlLabels[key],
      originalValue: value,
      value,
      confidence: key === 'title' ? 0.98 : 0.9,
      status: 'needs_review',
      sourceLabels: [key === 'title' ? 'EML Subject' : 'EML Body'],
      changed: false,
      changeReason: null
    })),
    warningCodes: ['EML_SOURCE_LOCAL_PARSE', 'EML_SOURCE_LOCAL_REDACTION', 'EML_ATTACHMENTS_IGNORED', 'SOURCE_CONTAINS_PII_PLACEHOLDERS', 'DETERMINISTIC_EXTRACTION_REQUIRES_REVIEW'],
    completedAt: null,
    reviewerDisplayName: null,
    jobCase: null,
    lifecycle: 'active',
    cloudEligible: false
  }
  const candidateResult = {
    id: '38dca6f6-947b-45d5-98bc-c9e6dcd242e9',
    sourceDocumentId: '5e910bbc-7aeb-4087-8130-4ff63ef8bd68',
    version: 2,
    status: 'active',
    confirmedAt: '2026-07-19T08:45:00.000Z',
    confirmedBy: '山田 太郎',
    containsDirectIdentifiers: false,
    anonymousLabel: '候補者 38DCA6F6',
    localIdentity: { displayName: '候補者A', phone: '090-1234-5678', email: 'candidate@example.jp', address: '東京都新宿区', storage: 'encrypted-local-only', cloudEligible: false },
    fields: [
      { key: 'skills', label: 'スキル', value: 'Java, Spring Boot, AWS, Kubernetes', sourceLabels: ['Skills!A2'] },
      { key: 'experience_years', label: '経験年数', value: '8年', sourceLabels: ['Skills!B2'] },
      { key: 'availability', label: '稼働時期', value: null, sourceLabels: [] },
      { key: 'rate', label: '希望単価', value: '85〜95万円/月', sourceLabels: ['Skills!D2'] },
      { key: 'japanese_level', label: '日本語', value: 'N1', sourceLabels: ['Skills!E2'] },
      { key: 'work_style', label: '勤務形態', value: '週3日リモート', sourceLabels: ['Skills!F2'] },
      { key: 'role', label: '役割', value: 'バックエンドエンジニア', sourceLabels: ['Skills!G2'] },
      { key: 'location', label: '希望勤務地', value: '東京都内・品川通勤可', sourceLabels: ['Skills!H2'] },
      { key: 'work_authorization', label: '就労資格', value: '就労制限なし', sourceLabels: ['Skills!I2'] }
    ],
    matchScore: 95,
    matchedTerms: ['Java', 'AWS', '5年以上', '80〜100万円', '週3日リモート'],
    evidence: [
      { key: 'skills', label: 'スキル', value: 'Java, Spring Boot, AWS, Kubernetes', sourceLabels: ['Skills!A2'] },
      { key: 'experience_years', label: '経験年数', value: '8年', sourceLabels: ['Skills!B2'] },
      { key: 'work_style', label: '勤務形態', value: '週3日リモート', sourceLabels: ['Skills!F2'] }
    ],
    projectExperiences: [{
      id: '2cb2d484-1895-401b-871a-dbe33a00dbb8',
      title: '決済基盤クラウド移行',
      period: '2023年4月〜2025年3月',
      role: 'PL',
      technologies: ['Java', 'AWS', 'Kubernetes'],
      summary: '決済基盤のAWS移行で設計・構築と運用改善を担当。',
      sourceLabels: ['Projects!A2', 'Projects!D2']
    }],
    projectEvidence: {
      id: '2cb2d484-1895-401b-871a-dbe33a00dbb8',
      title: '決済基盤クラウド移行',
      period: '2023年4月〜2025年3月',
      role: 'PL',
      technologies: ['Java', 'AWS', 'Kubernetes'],
      summary: '決済基盤のAWS移行で設計・構築と運用改善を担当。',
      sourceLabels: ['Projects!A2', 'Projects!D2'],
      matchType: 'hybrid',
      matchedTerms: ['Java', 'AWS'],
      vectorScore: 0.9321
    },
    matchResultId: 'c605a5ee-7c9b-401c-8546-ae18c02b3a9f',
    matchResultHash: 'd'.repeat(64),
    feedback: null,
    retrieval: {
      strategy: 'hard-filter-hybrid-local-rerank-v1',
      hardFilterPolicyVersion: 'tri-state-v3',
      bm25Score: 7.214,
      vectorScore: 0.9142,
      fusionScore: 0.032787,
      rerankerScore: 3.2841,
      bm25Rank: 1,
      vectorRank: 1,
      preRerankRank: 2,
      rerankerRank: 1,
      rank: 1,
      termCoverage: 83,
      indexedFieldCount: 9,
      hardFilters: [
        { type: 'minimum-experience-years', requested: '5年以上', actual: '8年', outcome: 'passed' },
        { type: 'maximum-rate', requested: '80〜100万円', actual: '85〜95万円/月', outcome: 'passed' },
        { type: 'availability-by', requested: '8月', actual: null, outcome: 'unknown' },
        { type: 'location', requested: '勤務地:品川', actual: '東京都内・品川通勤可', outcome: 'passed' },
        { type: 'work-authorization', requested: '就労資格:日本で就労可能', actual: '就労制限なし', outcome: 'passed' }
      ]
    }
  }
  const candidateMatchRun = {
    id: 'b39fd0c0-7c50-42a9-9f13-bb3a8ca17bf0',
    taskId: 'task-1',
    query: 'required_skills: Java Spring Boot AWS | role: バックエンド | rate: 90万円/月',
    algorithmVersion: 'hard-filter-hybrid-local-rerank-v1',
    hardFilterPolicyVersion: 'tri-state-v3',
    resultSetHash: 'c'.repeat(64),
    binding: {
      jobCaseId: '9d774305-d8e5-4300-9a7a-4d3d6804ddf2',
      jobCaseVersion: 1,
      candidatePoolFingerprint: 'e'.repeat(64),
      candidateProfileVersions: [{ id: candidateResult.id, version: candidateResult.version }],
      embeddingModelId: 'multilingual-e5-small',
      embeddingModelRevision: 'local-fixture-v1',
      rerankerModelId: 'bge-reranker-v2-m3',
      rerankerModelRevision: 'local-fixture-v1',
      policyVersion: 'match-run-validity-v1'
    },
    createdAt: now,
    evaluation: {
      resultCount: 1,
      feedbackCount: 0,
      suitableCount: 0,
      unsuitableCount: 0,
      coveragePercent: 0,
      judgedNdcgAt20: null,
      recallAt20: null,
      recallStatus: 'requires-known-relevant-total'
    }
  }
  const resumeDocumentId = 'f2af4f10-92d9-49ec-9c32-f2873a9c017f'
  const candidateReviewFields = [
    ['skills', 'スキル', 'Java, Spring Boot, AWS, Kubernetes', 0.94],
    ['experience_years', '経験年数', '8年', 0.86],
    ['availability', '稼働時期', '8月から参画可能', 0.82],
    ['rate', '希望単価', '85〜95万円/月', 0.8],
    ['japanese_level', '日本語レベル', 'N1', 0.88],
    ['work_style', '勤務形態', '週3日リモート', 0.79],
    ['role', '役割', 'バックエンドエンジニア', 0.91],
    ['location', '希望勤務地・通勤範囲', '東京都内・品川通勤可', 0.79],
    ['work_authorization', '就労資格（国籍は保存しない）', '就労制限なし', 0.72]
  ].map(([key, label, value, confidence]) => ({
    key, label, originalValue: value, value, confidence, status: 'needs_review',
    sourceLabels: ['Skills!A2'], changed: false, changeReason: null
  }))
  const candidateReview = {
    documentId: resumeDocumentId,
    fileName: 'candidate-skill-sheet.xlsx',
    reviewRevision: 1,
    status: 'awaiting-review',
    piiReviewed: false,
    localIdentity: { displayName: '候補者A', storage: 'encrypted-local-only', cloudEligible: false },
    fields: candidateReviewFields,
    projectExperiences: [{
      draftId: 'project-001',
      title: '決済基盤クラウド移行',
      period: '2023年4月〜2025年3月',
      role: 'PL',
      technologies: ['Java', 'AWS', 'Kubernetes'],
      summary: '決済基盤のAWS移行で設計・構築と運用改善を担当。',
      confidence: 0.86,
      sourceLabels: ['Projects!A2', 'Projects!D2'],
      changed: false,
      changeReason: null
    }],
    completedAt: null,
    reviewerDisplayName: null,
    profile: null
  }
  const initialInterview = {
    id: 'c8459a54-6e29-4f44-8c53-799ff2c12601',
    sourceDocumentId: resumeDocumentId,
    kind: 'recruiting',
    roundNumber: 1,
    parentInterviewId: null,
    stage: fixtureName === 'recruiting-prepare' ? 'scheduled' : 'awaiting-decision',
    scheduledAt: '2026-07-22T05:00:00.000Z',
    durationMinutes: 60,
    meetingMethod: 'zoom',
    meetingUrl: 'https://company.zoom.us/j/1234567890',
    interviewer: '李娜',
    contactNote: '候选人已确认 Zoom 面试时间',
    interviewGoal: '确认技术基础、项目职责和求职动机。',
    questionPlan: fixtureName === 'recruiting-prepare' ? [] : [
      { id: 'standard-1', text: '请介绍一次你主导或深度参与的项目。', source: 'standard', sourceLabel: '公司固定题', selected: true }
    ],
    interviewNotes: '候选人基础扎实，编码能力良好；系统设计思路清晰，沟通表达流畅。',
    unresolvedItems: ['高并发场景设计能力', '微服务治理经验', '团队协作与影响力'],
    decision: fixtureName === 'recruiting-decision' ? 'next-round' : null,
    decisionReason: fixtureName === 'recruiting-decision' ? '需要通过复试确认架构设计深度。' : null,
    decidedAt: fixtureName === 'recruiting-decision' ? '2026-07-22T06:00:00.000Z' : null,
    decidedBy: fixtureName === 'recruiting-decision' ? '李娜' : null,
    createdAt: '2026-07-21T08:00:00.000Z',
    updatedAt: '2026-07-22T06:00:00.000Z',
    updatedBy: '李娜',
    cloudEligible: false
  }
  const followUpInterview = {
    ...initialInterview,
    id: '0a23aab4-8639-4aac-bda5-3a3a3f42d750',
    roundNumber: 2,
    parentInterviewId: initialInterview.id,
    stage: 'awaiting-decision',
    scheduledAt: '2026-07-29T05:00:00.000Z',
    interviewer: '王强',
    questionPlan: [
      { id: 'inherited-1', text: '请结合实际项目说明高并发场景的系统设计。', source: 'inherited', sourceLabel: '继承自初面', selected: true },
      { id: 'inherited-2', text: '请说明微服务治理中的可观测性与故障处理。', source: 'inherited', sourceLabel: '继承自初面', selected: true }
    ],
    interviewNotes: '高并发方案能够覆盖限流、异步化和容量规划；微服务治理经验仍以小规模项目为主。',
    unresolvedItems: ['高并发场景设计能力', '微服务治理经验', '团队协作与影响力'],
    decision: null,
    decisionReason: null,
    decidedAt: null,
    decidedBy: null,
    createdAt: '2026-07-23T08:00:00.000Z',
    updatedAt: '2026-07-29T06:00:00.000Z'
  }
  const resumeAnalysis = {
    analysisVersion: 'resume-analysis-v6',
    fileToken: resumeDocumentId,
    fileName: candidateReview.fileName,
    status: 'requires-pii-review',
    cloudEligible: false,
    statistics: { pages: 0, sheets: 3, blocks: 24, characters: 1820 },
    detectedIdentifiers: [{ type: 'person_name', count: 1 }, { type: 'phone', count: 1 }],
    localProcessing: { ocr: 'not-required', ocrPages: 0, personNameCandidates: 1, networkAccess: false },
    extractedFields: candidateReviewFields.map(({ key, label, value, confidence, sourceLabels }) => ({ key, label, value, confidence, status: 'needs_review', sourceLabels })),
    extractedProjectExperiences: candidateReview.projectExperiences.map(({ changed, changeReason, ...project }) => project),
    warningCodes: ['PERSON_NAME_REVIEW_REQUIRED'],
    redactedPreview: '[SHEET:Skills] 氏名: <PERSON_NAME_001>\n[SHEET:Skills] Java / AWS / Kubernetes\n[SHEET:Projects] 決済基盤クラウド移行 · PL',
    analyzedAt: now
  }
  const proposalDraft = {
    schemaVersion: 'proposal-draft-v1',
    id: 'a86b564b-34ad-4632-927e-47db14c56aaf',
    taskId: 'task-2',
    jobCaseId: '9d774305-d8e5-4300-9a7a-4d3d6804ddf2',
    jobCaseVersion: 1,
    candidateProfileId: candidateResult.id,
    candidateProfileVersion: candidateResult.version,
    recipientTo: 'partner@example.co.jp',
    recipientCc: [],
    candidateDisplayName: '候補者A',
    subject: '【人材ご提案】決済基盤刷新 / 候補者A',
    body: 'いつもお世話になっております。\n\n決済基盤刷新のご要件に関連し、候補者Aをご提案いたします。\n\n詳細は脱敏済み添付資料をご確認ください。',
    attachment: {
      fileName: 'candidate-38dca6f6-profile.pdf',
      mimeType: 'application/pdf',
      redacted: true,
      sourceDocumentIncluded: false,
      anonymousCandidateLabel: candidateResult.anonymousLabel,
      fields: candidateResult.fields,
      projectExperiences: candidateResult.projectExperiences.map(({ id, sourceLabels, ...project }) => project),
      contentHash: 'a'.repeat(64)
    },
    tone: 'standard',
    status: 'exported',
    revision: 1,
    contentHash: 'b'.repeat(64),
    approvedContentHash: 'b'.repeat(64),
    approvedAt: '2026-07-19T09:45:00.000Z',
    approvedBy: '高橋 遥',
    exportedAt: '2026-07-19T09:46:00.000Z',
    exportPackageHash: 'c'.repeat(64),
    followUp: { revision: 0, stage: null, events: [], cloudEligible: false },
    generation: { mode: 'deterministic-local-v1', cloudUsed: false, rawResumeUsed: false, rawMailUsed: false, recipientAndDisplayNameCloudEligible: false },
    createdAt: now,
    updatedAt: now
  }
  const proposalJobCaseOption = {
    id: proposalDraft.jobCaseId,
    reviewId: 'd18d7344-15c9-457f-a338-c6d0c47652c1',
    version: 1,
    title: '決済基盤刷新',
    role: 'バックエンド',
    requiredSkills: 'Java / AWS',
    rate: '90万円/月',
    fields: emlReview.fields.map((field) => ({ key: field.key, label: field.label, value: field.value, sourceLabels: field.sourceLabels }))
  }
  const proposalCandidateOption = {
    id: candidateResult.id,
    version: candidateResult.version,
    anonymousLabel: candidateResult.anonymousLabel,
    skills: 'Java / AWS / Kubernetes',
    experienceYears: '8年',
    availability: '8月',
    rate: '85〜95万円/月',
    japaneseLevel: 'N1',
    workStyle: '週3日リモート',
    role: 'バックエンドエンジニア',
    fields: candidateResult.fields,
    projectExperiences: candidateResult.projectExperiences
  }
  const googleAcceptanceReport = {
    version: 'google-workspace-online-acceptance-v1',
    id: '59d99a84-c5ea-4474-b08a-ddfd8f5eca73',
    checkedAt: now,
    overall: 'passed',
    configurationFingerprint: 'a'.repeat(64),
    credentialProtection: 'macos-keychain',
    mailboxMetadataAccessed: true,
    messageContentAccessedDuringCheck: false,
    cloudModelUsed: false,
    directIdentifierCloudSent: false,
    checks: [
      { id: 'live-profile', status: 'passed', label: 'Gmail Profile のオンライン確認', detail: '保存済み Token で Profile を再取得しました。メール本文は取得していません。' },
      { id: 'readonly-scope', status: 'passed', label: '読取専用 Scope', detail: '付与 Scope は gmail.readonly のみです。' },
      { id: 'account-identity', status: 'passed', label: 'Google アカウント本人確認', detail: '接続先とオンラインアカウントが一致しました。アドレスは報告に保存しません。' },
      { id: 'credential-protection', status: 'passed', label: 'OAuth Token の端末保護', detail: 'macos-keychain で保護されています。' },
      { id: 'bounded-sync', status: 'passed', label: '管理者指定の同期範囲', detail: '最近の同期は現在の Label・期間・件数上限と一致します。' },
      { id: 'successful-sync', status: 'passed', label: 'Gmail の有界同期', detail: '最終同期: 取得候補 8件、保存 6件、失敗 0件。' },
      { id: 'local-redaction', status: 'warning', label: 'ローカル脱敏証跡', detail: '5件通過、1件は要確認として端末内に留めています。' },
      { id: 'no-cloud-model', status: 'passed', label: 'クラウド大模型未使用', detail: 'Google API と端末内処理だけで実行されました。' },
      { id: 'no-send-path', status: 'passed', label: '送信経路なし', detail: 'Gmail 草稿・送信 Scope と送信 API は実装されていません。' }
    ],
    evidence: {
      grantedScopeCount: 1,
      sync: { status: 'idle', lastSyncedAt: now, mode: 'baseline', discovered: 8, imported: 6, duplicates: 1, filtered: 1, failed: 0 },
      redaction: { storedMessages: 6, passed: 5, uncertain: 1, blocked: 0 }
    }
  }
  const matchingHomeResult = (suffix, rank, priority, reasons) => ({
    matchResultId: `${suffix}05a5ee-7c9b-401c-8546-ae18c02b3a9f`,
    matchResultHash: suffix.repeat(64),
    candidateProfileId: `${suffix}8dca6f6-947b-45d5-98bc-c9e6dcd242e9`,
    candidateProfileVersion: rank,
    anonymousLabel: `候補者 ${suffix.toUpperCase().repeat(8)}`,
    fit: {
      rank,
      matchScore: 96 - rank * 4,
      matchedTerms: rank === 1 ? ['Java', 'AWS', 'Spring Boot', '品川'] : ['Java', 'AWS'],
      termCoverage: rank === 1 ? 88 : rank === 2 ? 72 : 61,
      hardFilterUnknownCount: rank - 1,
      evidence: candidateResult.evidence,
      projectEvidence: candidateResult.projectEvidence
    },
    feedback: null,
    businessPriority: {
      id: `${suffix}98f15d8-f63f-48c7-b2b4-fc9db655e31a`,
      matchResultId: `${suffix}05a5ee-7c9b-401c-8546-ae18c02b3a9f`,
      runId: candidateMatchRun.id,
      candidateProfileId: `${suffix}8dca6f6-947b-45d5-98bc-c9e6dcd242e9`,
      ruleVersion: 'business-priority-v1',
      level: priority,
      effectiveLevel: priority,
      reasons,
      inputs: {
        caseTiming: '8月開始',
        candidateAvailability: rank === 1 ? '即日' : rank === 2 ? '8月' : '9月',
        proposalStatus: rank === 2 ? 'exported' : null,
        followUpStage: rank === 2 ? 'reply_received' : null
      },
      inputSnapshotHash: suffix.repeat(64),
      generatedAt: now,
      manualOverride: null
    }
  })
  const matchingHomeCurrent = {
    state: 'current-results',
    eligibleCandidateCount: 4,
    selectedJobCaseId: proposalDraft.jobCaseId,
    jobCases: [
      { id: proposalDraft.jobCaseId, version: 1, title: '決済基盤刷新 Java / AWS', validity: 'current', lastRunCreatedAt: now },
      { id: '24ca5a5b-e92e-42e0-99cb-6760c3fa832a', version: 2, title: '物流 SaaS バックエンド', validity: 'stale_candidate_pool', lastRunCreatedAt: '2026-07-18T04:00:00.000Z' }
    ],
    currentRun: {
      run: candidateMatchRun,
      validity: 'current',
      results: [
        matchingHomeResult('a', 1, 'normal', ['開始時期と稼働時期を確認', '提案未作成']),
        matchingHomeResult('b', 2, 'follow_up', ['返信受領済み', '次回連絡を確認']),
        matchingHomeResult('c', 3, 'high', ['案件開始が近い', '候補者は即日稼働可能'])
      ]
    }
  }
  const bootstrap = {
    appVersion: '0.1.0',
    environmentLabel: 'macOS 試点ビルド · 暗号化ローカルDB',
    operatorProfile: {
      version: 'local-operator-profile-v1',
      operatorId: '71f91b43-7d84-4ed7-b7c7-1ae5d25d7276',
      displayName: '高橋 遥',
      roleLabel: 'SES営業担当',
      configured: true,
      revision: 2,
      updatedAt: now,
      cloudEligible: false
    },
    preferences: {
      version: 'local-application-preferences-v1',
      locale: fixtureName?.startsWith('recruiting-') ? 'zh-CN' : 'ja-JP',
      configured: false,
      revision: null,
      updatedAt: null,
      cloudEligible: false
    },
    tasks: [
      {
        ...task('task-0', 'IMPORT_RESUME', 'スキルシートの項目とプロジェクト経験を確認', 'スキルシート取込', 'awaiting_review', 88, 12, '2026-07-19T09:58:00.000Z'),
        scope: { id: 'selected-files', label: '選択したファイル', detail: 'HRが明示的に選択したスキルシートのみ' },
        contextBindings: [{ objectType: 'staged-file', objectId: resumeDocumentId, version: '1' }]
      },
      task('task-1', 'MATCH_CANDIDATES', 'Java / AWS案件の候補者を根拠付きで比較', '候補者マッチング', 'running', 65, 8, '2026-07-19T09:52:00.000Z'),
      task('task-2', 'GENERATE_PROPOSAL', 'EC決済基盤案件の提案内容を確認', '提案下書き', 'completed', 100, 6, '2026-07-19T09:46:00.000Z')
    ],
    processingJobs: [{
      id: 'c54de2d7-36b1-4d3a-ac63-21636ac39bb0',
      type: 'candidate-match',
      workTaskId: 'task-1',
      taskStepId: 'task-1-2',
      status: 'running',
      replayPolicy: 'safe-local',
      progress: 65,
      attemptCount: 1,
      maxAttempts: 3,
      nextRetryAt: null,
      leaseExpiresAt: '2026-07-19T10:05:00.000Z',
      cancelRequestedAt: null,
      errorCode: null,
      createdAt: '2026-07-19T09:52:00.000Z',
      updatedAt: '2026-07-19T09:52:30.000Z'
    }],
    resumeAnalyses: [resumeAnalysis],
    candidateReviews: [candidateReview],
    candidateInterviews: fixtureName === 'recruiting-decision'
      ? [initialInterview, followUpInterview]
      : fixtureName?.startsWith('recruiting-') ? [initialInterview] : [],
    jobCaseReviews: [emlReview],
    matchingHome: fixtureName === 'matching-home'
      ? matchingHomeCurrent
      : { state: 'onboarding', eligibleCandidateCount: 1, selectedJobCaseId: null, jobCases: [], currentRun: null },
    wechatVisibleMessage: {
      phase: 'B-03-1', gateStatus: 'go', platform: 'darwin', featureFlagEnabled: true,
      userFeatureAvailable: true, accessibilityTrusted: true, screenCaptureTrusted: true,
      rawTextNetworkIsolationVerified: true, evidenceVerified: false, targetVersion: '4.1.5',
      failureCodes: ['RELEASE_EVIDENCE_PENDING']
    },
    privacy: {
      policyVersion: 'cloud-redaction-v2',
      cloudGateway: 'enforced',
      localAi: 'vision-ocr-and-pii-active',
      qualityGate: {
        status: 'passed', datasetVersion: 'ses-privacy-regression-v1', syntheticOnly: true,
        caseCount: 28, identifierRecall: 1, redactionPrecision: 1,
        residualLeakCount: 0, safeCaseFalsePositiveCount: 0, appleNerVerified: true,
        reportHash: 'a'.repeat(64), failureCodes: []
      },
      expertGate: {
        status: 'not-verified', datasetVersion: null, humanLabeledDataset: true,
        sourceDocumentCount: 0, caseCount: 0, automaticPersonNameRecall: null,
        postReviewIdentifierRecall: null, redactionPrecision: null, reviewedAt: null, evaluatedAt: null,
        reportHash: null, attestationHash: null, privacyImplementationSha256: null,
        cloudEnforcementSha256: null, failureCodes: ['expert-report:missing']
      }
    },
    storage: {
      status: 'encrypted',
      engine: 'sqlcipher-compatible',
      keyProtection: 'macos-keychain',
      schemaVersion: 37
    },
    aiCommerce: {
      configuration: 'required',
      connection: 'not-connected',
      productCode: null,
      billingMode: null,
      memberDisplayName: null,
      accountId: null,
      accountAiTokenExpiresAt: null,
      wallet: null,
      capabilities: [],
      refreshedAt: null
    },
    gmail: onlineAcceptanceMode ? {
      provider: 'google-workspace',
      status: 'readonly',
      configuration: 'connected',
      workspaceDomain: 'example.co.jp',
      accountEmail: 'hr@example.co.jp',
      grantedScopes: ['https://www.googleapis.com/auth/gmail.readonly'],
      readAccess: true,
      draftAccess: 'not-requested',
      sendMethod: 'not-implemented'
    } : {
      provider: 'google-workspace',
      status: 'not-connected',
      configuration: 'required',
      workspaceDomain: 'example.co.jp',
      accountEmail: null,
      grantedScopes: [],
      readAccess: false,
      draftAccess: 'not-requested',
      sendMethod: 'not-implemented'
    },
    googleWorkspaceConfiguration: onlineAcceptanceMode ? {
      version: 'google-workspace-admin-config-v1', source: 'local-admin', editable: true,
      clientId: '1234567890-abcdefghijklmnop.apps.googleusercontent.com', workspaceDomain: 'example.co.jp',
      labelIds: ['Label_SES'], query: '案件 OR 要員', lookbackDays: 30, maxMessagesPerRun: 200,
      revision: 1, configuredBy: 'ローカル管理者', updatedAt: now
    } : null,
    googleWorkspaceAcceptance: null,
    gmailSync: onlineAcceptanceMode ? {
      configuration: 'ready', status: 'idle', labelIds: ['Label_SES'], query: '案件 OR 要員', lookbackDays: 30,
      checkpointHistoryId: '120', storedMessages: 6, lastSyncedAt: now,
      lastRun: { mode: 'baseline', discovered: 8, imported: 6, duplicates: 1, filtered: 1, failed: 0 },
      lastError: null
    } : {
      configuration: 'required',
      status: 'never',
      labelIds: [],
      query: null,
      lookbackDays: 30,
      checkpointHistoryId: null,
      storedMessages: 0,
      lastSyncedAt: null,
      lastRun: null,
      lastError: null
    },
    recovery: {
      format: 'ses-recovery-v1',
      encryption: 'scrypt-aes-256-gcm',
      lastBackupAt: null,
      lastRestoreAt: null,
      pendingRestore: false,
      reminder: {
        status: 'due',
        reason: 'no-backup',
        currentDataRevision: 8,
        lastBackupDataRevision: null,
        latestDataChangedAt: '2026-07-19T09:42:00.000Z',
        snoozedUntil: null
      }
    },
    candidateEvaluation: {
      dataset: {
        id: 'd5a8372a-f701-4862-8f5d-4278c116fe3c',
        name: 'Tokyo SES Pilot v1',
        datasetHash: 'e'.repeat(64),
        caseCount: 30,
        relevantCandidates: 36,
        reviewerCount: 2,
        importedAt: now
      },
      latestReport: {
        version: 'candidate-evaluation-report-v1',
        id: '1f7d8d53-2ced-4f90-8de4-2711a6af95aa',
        datasetId: 'd5a8372a-f701-4862-8f5d-4278c116fe3c',
        datasetHash: 'e'.repeat(64),
        status: 'passed',
        algorithmVersion: 'hard-filter-hybrid-local-rerank-v1',
        hardFilterPolicyVersion: 'tri-state-v3',
        modelId: 'Xenova/multilingual-e5-small+hotchpotch/japanese-reranker-tiny-v2',
        modelRevision: '761b726dd34fb83930e26aab4e9ac3899aa1fa78+ba95175a4d53058816b971f31929f10c5cad8560',
        evaluatedAt: now,
        networkAccess: false,
        cloudUsed: false,
        metrics: { caseCount: 30, relevantCandidates: 36, retrievedRelevantCandidates: 34, recallAt20: 0.9444, ndcgAt20: 0.8123, expectedProjectEvidence: 20, matchedProjectEvidence: 18, projectEvidenceCoverageAt20: 0.9, missingCandidateReferences: 0 },
        thresholds: { minimumCases: 30, recallAt20: 0.9, ndcgAt20: 0.75, projectEvidenceCoverageAt20: 0.8 },
        cases: [{ caseId: 'visual-case-1', queryHash: 'f'.repeat(64), relevantCandidates: 1, retrievedRelevantCandidates: 1, recallAt20: 1, ndcgAt20: 1, expectedProjectEvidence: 1, matchedProjectEvidence: 1, missingCandidateLabels: [] }]
      }
    }
  }
  const authoringWorkspace = {
    draft: {
      id: '4d6f299a-8ea9-493e-869e-369bcbba7086',
      name: 'Tokyo SES Expert Pilot',
      revision: 4,
      caseCount: 1,
      readyCaseCount: 1,
      reviewerCount: 1,
      createdAt: now,
      updatedAt: now,
      cases: [{
        id: '850c3a75-0a15-4919-8269-04d6e9012cc6',
        jobCaseId: proposalDraft.jobCaseId,
        jobCaseVersion: 1,
        jobCaseTitle: '決済基盤刷新 Java / AWS',
        query: 'required_skills: Java Spring Boot AWS | role: バックエンド | rate: 90万円/月',
        poolReviewed: true,
        reviewerDisplayName: '山田 太郎',
        reviewedAt: now,
        status: 'ready',
        relevantCandidates: [{
          profileId: candidateResult.id,
          profileVersion: candidateResult.version,
          anonymousLabel: candidateResult.anonymousLabel,
          expectedProjectEvidence: true,
          status: 'active'
        }]
      }]
    },
    jobCases: [{
      id: proposalDraft.jobCaseId,
      version: 1,
      title: '決済基盤刷新 Java / AWS',
      query: 'required_skills: Java Spring Boot AWS | role: バックエンド | rate: 90万円/月'
    }],
    candidates: [
      { id: candidateResult.id, version: candidateResult.version, anonymousLabel: candidateResult.anonymousLabel, skills: 'Java / AWS / Kubernetes', experienceYears: '8年', availability: '8月', rate: '85〜95万円/月', japaneseLevel: 'N1', workStyle: '週3日リモート', role: 'バックエンドエンジニア', projectExperienceCount: 3 },
      { id: '5b809302-ed03-4ba4-b957-7d5d42090238', version: 1, anonymousLabel: '候補者 5B809302', skills: 'Java / Spring Boot / GCP', experienceYears: '6年', availability: '即日', rate: '80〜90万円/月', japaneseLevel: 'N1', workStyle: '常駐可', role: 'バックエンドエンジニア', projectExperienceCount: 2 },
      { id: 'a63b1a61-4a93-43bf-a690-7492352412b2', version: 2, anonymousLabel: '候補者 A63B1A61', skills: 'Python / AWS / Terraform', experienceYears: '5年', availability: '9月', rate: '75〜85万円/月', japaneseLevel: 'N2', workStyle: '週4リモート', role: 'クラウドエンジニア', projectExperienceCount: 2 },
      { id: '3f226fb4-11a2-4431-bada-747c3eadf929', version: 1, anonymousLabel: '候補者 3F226FB4', skills: 'Java / Oracle / Linux', experienceYears: '10年', availability: '8月', rate: '90〜100万円/月', japaneseLevel: '母語', workStyle: 'ハイブリッド', role: 'PL', projectExperienceCount: 4 }
    ]
  }
  const unavailable = async () => { throw new Error('Playwright visual fixture: unavailable action') }
  Object.defineProperty(window, 'sesAgent', {
    configurable: true,
    value: {
      getStartupStatus: async () => new URLSearchParams(window.location.search).has('startupRecovery')
        ? {
            mode: 'recovery-required',
            reason: 'local-storage-unavailable',
            activeDataPreserved: true,
            networkAccess: false,
            message: '暗号化されたローカルデータを現在の OS 保護鍵で開けません。元データは変更せず保持しています。'
          }
        : { mode: 'normal' },
      getBootstrap: async () => bootstrap,
      saveLocalOperatorProfile: async (input) => {
        bootstrap.operatorProfile = {
          ...bootstrap.operatorProfile,
          displayName: input.displayName,
          roleLabel: input.roleLabel,
          configured: true,
          revision: (bootstrap.operatorProfile.revision ?? 0) + 1,
          updatedAt: new Date().toISOString(),
          cloudEligible: false
        }
        return bootstrap.operatorProfile
      },
      saveLocalApplicationPreferences: async (input) => {
        bootstrap.preferences = {
          ...bootstrap.preferences,
          locale: input.locale,
          configured: true,
          revision: (bootstrap.preferences.revision ?? 0) + 1,
          updatedAt: new Date().toISOString(),
          cloudEligible: false
        }
        return bootstrap.preferences
      },
      connectAiCommerce: unavailable,
      getAiCommerceDashboard: async () => bootstrap.aiCommerce,
      disconnectAiCommerce: async () => bootstrap.aiCommerce,
      resetAiCommerceToken: async () => bootstrap.aiCommerce,
      openAiCommerceMemberCenter: async () => ({ opened: true }),
      prepareAiCommerceCloudPrompt: unavailable,
      executeAiCommerceCloudPrompt: unavailable,
      listAiConversations: async () => [],
      saveAiConversation: async (input) => {
        const timestamp = new Date().toISOString()
        return {
          id: input.conversationId,
          context: input.context,
          title: input.messages.find((message) => message.role === 'user')?.content.slice(0, 60) || 'New conversation',
          messages: input.messages,
          revision: (input.expectedRevision || 0) + 1,
          createdAt: timestamp,
          updatedAt: timestamp
        }
      },
      deleteAiConversations: async (input) => ({ deletedConversationIds: input.conversationIds }),
      onAiCommerceStateChanged: () => () => {},
      beginResumeImport: async () => ({ cancelled: true, task: null, files: [] }),
      analyzeResumeFile: unavailable,
      getCandidateReview: async () => candidateReview,
      submitCandidateReview: unavailable,
      createCandidateInterviewRound: unavailable,
      saveCandidateInterviewSchedule: unavailable,
      saveCandidateInterviewPreparation: unavailable,
      saveCandidateInterviewNotes: unavailable,
      recordCandidateInterviewDecision: unavailable,
      openZoomMeeting: async () => ({ opened: true }),
      openInterviewMeeting: async () => ({ opened: true }),
      openZoomTestMeeting: async () => ({ opened: true }),
      createManualJobCaseDraft: unavailable,
      createChatPasteJobCaseDraft: unavailable,
      prepareWechatVisibleRead: async () => ({
        status: 'cancelled', scopeToken: null, expiresAt: null, countdownSeconds: 5,
        targetVersion: '4.1.5', failureCodes: []
      }),
      executeWechatVisibleRead: unavailable,
      importEmlJobCaseDrafts: async () => ({
        cancelled: false,
        importedCount: 1,
        duplicateCount: 0,
        skippedCount: 1,
        failedCount: 1,
        items: [
          { fileName: 'java-aws-case.eml', status: 'imported', classification: 'job-case', errorCode: null, review: emlReview },
          { fileName: 'candidate-introduction.eml', status: 'skipped', classification: 'candidate-proposal', errorCode: null, review: null },
          { fileName: 'broken-message.eml', status: 'failed', classification: null, errorCode: 'PARSE_FAILED', review: null }
        ]
      }),
      submitJobCaseReview: unavailable,
      getJobCaseHistory: async () => [],
      setJobCaseLifecycle: unavailable,
      reopenJobCaseReview: unavailable,
      previewJobCaseDeletion: unavailable,
      deleteJobCaseData: unavailable,
      getProposalWorkspace: async () => ({
        options: {
          jobCases: [proposalJobCaseOption],
          candidates: [proposalCandidateOption]
        },
        drafts: [proposalDraft],
        evidence: [{ draftId: proposalDraft.id, jobCase: proposalJobCaseOption, candidate: proposalCandidateOption }]
      }),
      createProposalDraft: unavailable,
      updateProposalDraft: unavailable,
      approveProposalDraft: unavailable,
      exportProposalPackage: unavailable,
      recordProposalFollowUp: async (input) => {
        const recordedAt = new Date().toISOString()
        const event = {
          id: 'a3e4dbac-2a0f-41d5-aa89-54b9a3a3f56e',
          draftId: proposalDraft.id,
          revision: proposalDraft.followUp.revision + 1,
          stage: input.stage,
          occurredOn: input.occurredOn,
          note: input.note ?? null,
          recordedBy: bootstrap.operatorProfile.displayName,
          recordedAt,
          cloudEligible: false
        }
        proposalDraft.followUp = {
          revision: event.revision,
          stage: event.stage,
          events: [...proposalDraft.followUp.events, event],
          cloudEligible: false
        }
        proposalDraft.updatedAt = recordedAt
        return { draft: proposalDraft, task: bootstrap.tasks.find((item) => item.id === proposalDraft.taskId) }
      },
      searchCandidateProfiles: async ({ lifecycle, query }) => lifecycle === 'archived' ? [] : [{
        ...candidateResult,
        matchScore: query ? candidateResult.matchScore : null,
        matchedTerms: query ? candidateResult.matchedTerms : [],
        evidence: query ? candidateResult.evidence : [],
        retrieval: query ? candidateResult.retrieval : {
          ...candidateResult.retrieval,
          bm25Score: null,
          rank: null,
          termCoverage: null,
          hardFilters: []
        }
      }],
      executeCandidateMatchTask: async () => {
        const processingJob = bootstrap.processingJobs[0]
        Object.assign(processingJob, { status: 'succeeded', progress: 100, leaseExpiresAt: null, updatedAt: now })
        const sourceTask = bootstrap.tasks.find((item) => item.id === 'task-1')
        const updatedTask = {
          ...sourceTask,
          status: 'awaiting_review',
          progress: 85,
          evidenceCount: 3,
          updatedAt: now,
          steps: sourceTask.steps.map((step, index) => ({ ...step, status: index < sourceTask.steps.length - 1 ? 'completed' : 'blocked' })),
          messages: [...sourceTask.messages, { id: 'task-1-message-result', role: 'system', kind: 'review', content: 'ローカル Hybrid Retrieval が完了しました。3件の証跡を確認してください。', createdAt: now }],
          artifacts: [{ id: 'task-1-artifact-result', kind: 'candidate-match-results', label: '候補者比較結果', status: 'available', objectId: candidateMatchRun.id, contentHash: candidateMatchRun.resultSetHash, containsDirectIdentifiers: false, createdAt: now }],
          toolAudits: [...sourceTask.toolAudits, { id: 'task-1-audit-result', action: 'candidate.search', decision: 'executed', dataScopeId: sourceTask.scope.id, externalSideEffect: 'local-write', cloudPayload: 'none', evidenceCount: 3, reason: '確認済み匿名プロフィールだけを端末内で検索しました。', createdAt: now }]
        }
        bootstrap.tasks = bootstrap.tasks.map((item) => item.id === updatedTask.id ? updatedTask : item)
        return {
          task: updatedTask,
          query: 'Java AWS 5年以上 80〜100万円 8月 週3日リモート',
          run: candidateMatchRun,
          matches: [candidateResult],
          processingJob
        }
      },
      submitCandidateMatchFeedback: async (input) => {
        const feedback = {
          decision: input.decision,
          reasonCode: input.reasonCode,
          note: input.note ?? null,
          reviewerDisplayName: bootstrap.operatorProfile.displayName,
          revision: input.expectedRevision + 1,
          reviewedAt: now
        }
        candidateResult.feedback = feedback
        candidateMatchRun.evaluation = {
          ...candidateMatchRun.evaluation,
          feedbackCount: 1,
          suitableCount: input.decision === 'suitable' ? 1 : 0,
          unsuitableCount: input.decision === 'unsuitable' ? 1 : 0,
          coveragePercent: 100,
          judgedNdcgAt20: input.decision === 'suitable' ? 1 : null
        }
        return { run: candidateMatchRun, matchResultId: input.matchResultId, feedback }
      },
      setBusinessPriorityOverride: async () => bootstrap.matchingHome,
      importCandidateEvaluationBenchmark: async () => ({ cancelled: false, state: bootstrap.candidateEvaluation }),
      getCandidateEvaluationAuthoringWorkspace: async () => authoringWorkspace,
      createCandidateEvaluationDraft: async () => authoringWorkspace,
      saveCandidateEvaluationDraftCase: async () => authoringWorkspace,
      deleteCandidateEvaluationDraftCase: async () => authoringWorkspace,
      evaluateCandidateEvaluationDraft: async () => ({ workspace: authoringWorkspace, state: bootstrap.candidateEvaluation }),
      getCandidateProfileHistory: async () => [],
      updateCandidateProfile: unavailable,
      setCandidateLifecycle: unavailable,
      previewCandidateDeletion: unavailable,
      deleteCandidateData: unavailable,
      listDataDeletionReports: async () => [],
      saveGoogleWorkspaceAdminConfiguration: async (input) => ({
        configuration: {
          version: 'google-workspace-admin-config-v1',
          source: 'local-admin',
          editable: true,
          clientId: input.clientId,
          workspaceDomain: input.workspaceDomain,
          labelIds: input.labelIds,
          query: input.query,
          lookbackDays: input.lookbackDays,
          maxMessagesPerRun: input.maxMessagesPerRun,
          revision: 1,
          configuredBy: bootstrap.operatorProfile.displayName,
          updatedAt: new Date().toISOString()
        },
        restarting: true
      }),
      connectGoogleWorkspace: unavailable,
      diagnoseGoogleWorkspace: async () => ({
        version: 'google-workspace-readiness-v1',
        checkedAt: now,
        overall: 'ready',
        networkAccess: true,
        mailboxAccessed: false,
        credentialCreated: false,
        checks: [
          { id: 'configuration', status: 'passed', label: '管理者設定', detail: 'Client ID・会社ドメイン・同期範囲を暗号化設定から読み込みました。' },
          { id: 'desktop-client-format', status: 'passed', label: 'Desktop OAuth Client ID', detail: 'Installed/Desktop Client ID の形式です。' },
          { id: 'bounded-sync-scope', status: 'passed', label: '同期データ範囲', detail: 'Label・業務キーワード・期間・件数に上限があります。' },
          { id: 'loopback-callback', status: 'passed', label: 'ローカル OAuth コールバック', detail: '127.0.0.1 のランダムポートを安全にバインドできます。' },
          { id: 'google-oauth-reachability', status: 'passed', label: 'Google OAuth 到達性', detail: 'Google OAuth 公開メタデータへ HTTPS 接続できました。' },
          { id: 'gmail-api-reachability', status: 'passed', label: 'Gmail API 到達性', detail: 'Gmail API Discovery へ HTTPS 接続できました。メールボックスは読んでいません。' },
          { id: 'credential-protection', status: 'passed', label: 'OAuth Token 保護', detail: 'macos-keychain による端末保護を使用できます。' },
          { id: 'admin-console-confirmation', status: 'warning', label: 'Google Cloud 管理者確認', detail: 'Gmail API と社内向け同意画面を管理者が確認してください。' }
        ]
      }),
      runGoogleWorkspaceOnlineAcceptance: async () => googleAcceptanceReport,
      disconnectGoogleWorkspace: unavailable,
      syncGoogleWorkspace: async () => {
        const gmailReview = {
          ...emlReview,
          reviewId: '62455ca8-e231-48c5-905d-5e9bc157509c',
          sourceId: '8657bd82-fbc9-45f1-8c35-fea99d2062d5',
          sourceType: 'gmail',
          providerMessageId: 'gmail_message_001',
          threadId: 'gmail_thread_001',
          warningCodes: ['SOURCE_CONTAINS_PII_PLACEHOLDERS', 'DETERMINISTIC_EXTRACTION_REQUIRES_REVIEW']
        }
        bootstrap.jobCaseReviews = [gmailReview]
        bootstrap.gmailSync = {
          ...bootstrap.gmailSync,
          status: 'idle',
          checkpointHistoryId: '128',
          storedMessages: 7,
          lastSyncedAt: new Date().toISOString(),
          lastRun: { mode: 'incremental', discovered: 2, imported: 1, duplicates: 1, filtered: 0, failed: 0 },
          lastError: null
        }
        return bootstrap.gmailSync
      },
      getRecoveryState: async () => bootstrap.recovery,
      createRecoveryPackage: async () => ({
        cancelled: false,
        fileName: 'ses-agent-2026-07-19.ses-recovery',
        packageHash: 'a'.repeat(64),
        summary: recoverySummary
      }),
      snoozeRecoveryReminder: async ({ days }) => {
        bootstrap.recovery.reminder = {
          ...bootstrap.recovery.reminder,
          status: 'snoozed',
          snoozedUntil: new Date(Date.now() + days * 86_400_000).toISOString()
        }
        return bootstrap.recovery
      },
      previewRecoveryPackage: async () => ({
        cancelled: false,
        restoreToken: 'b2a56ae6-da51-4cb5-a82c-0fd350558e72',
        confirmationHash: 'b'.repeat(64),
        expiresAt: '2026-07-19T10:25:00.000Z',
        summary: recoverySummary,
        warnings: [
          '現在のローカルデータは再起動時に置き換えられます。',
          'Google Workspace の認証情報は復元されず、再接続が必要です。',
          'アプリ外へ書き出したファイルは復元対象外です。'
        ]
      }),
      confirmRecovery: async () => ({ scheduled: true, restartRequired: true }),
      restartApplication: async () => ({ restarting: true }),
      previewWorkTask: unavailable,
      createWorkTask: unavailable,
      setWorkTaskLifecycle: async (input) => {
        const selected = bootstrap.tasks.find((item) => item.id === input.taskId)
        if (!selected) throw new Error('作業が見つかりません。')
        selected.status = input.action === 'cancel' ? 'cancelled' : 'planned'
        selected.updatedAt = new Date().toISOString()
        selected.steps = selected.steps.map((step) => input.action === 'cancel' && step.status !== 'completed'
          ? { ...step, status: 'blocked' }
          : input.action === 'retry' ? { ...step, status: 'pending' } : step)
        selected.messages.push({
          id: `${selected.id}-message-${selected.messages.length + 1}`,
          role: 'system',
          kind: 'status',
          content: input.action === 'cancel' ? 'この作業をキャンセルしました。' : '同じ範囲で再実行を準備しました。',
          createdAt: selected.updatedAt
        })
        selected.toolAudits.push({
          id: `${selected.id}-audit-${selected.toolAudits.length + 1}`,
          action: input.action === 'cancel' ? 'task.cancel' : 'task.retry',
          decision: 'executed',
          dataScopeId: selected.scope.id,
          externalSideEffect: 'local-write',
          cloudPayload: 'none',
          evidenceCount: selected.evidenceCount,
          reason: input.action === 'cancel' ? '未完了ステップを停止し、既存の受管データは保持しました。' : '元の確認済みデータ範囲を拡大せず、ローカル再実行を準備しました。',
          createdAt: selected.updatedAt
        })
        if (input.action === 'retry' && selected.type === 'IMPORT_RESUME') {
          selected.status = 'awaiting_review'
          selected.progress = 75
          selected.steps = selected.steps.map((step, index) => ({ ...step, status: index < selected.steps.length - 1 ? 'completed' : 'blocked' }))
          selected.messages.push({
            id: `${selected.id}-message-${selected.messages.length + 1}`,
            role: 'system',
            kind: 'review',
            content: '保存済みのローカル解析結果を復元しました。候補者フィールドを確認してください。',
            createdAt: selected.updatedAt
          })
          selected.toolAudits.push({
            id: `${selected.id}-audit-${selected.toolAudits.length + 1}`,
            action: 'resume.local-parse',
            decision: 'executed',
            dataScopeId: selected.scope.id,
            externalSideEffect: 'local-write',
            cloudPayload: 'none',
            evidenceCount: selected.evidenceCount,
            reason: '保存済みの端末内解析結果を復元し、クラウド経路を使用しませんでした。',
            createdAt: selected.updatedAt
          })
        }
        return selected
      }
    }
  })
})()
