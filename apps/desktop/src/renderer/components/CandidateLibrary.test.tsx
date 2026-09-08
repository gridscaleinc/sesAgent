import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { vi } from 'vitest'
import type { CandidateProfileSearchResult, CandidateProfileVersionDetail, DataDeletionReport, OriginalDocumentPreview } from '@shared'
import { CandidateLibrary } from './CandidateLibrary'

const emptyLocalDetails = {
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
}

const candidate: CandidateProfileSearchResult = {
  id: '38dca6f6-947b-45d5-98bc-c9e6dcd242e9',
  sourceDocumentId: '5e910bbc-7aeb-4087-8130-4ff63ef8bd68',
  version: 1,
  status: 'current',
  confirmedAt: '2026-07-17T00:00:00.000Z',
  confirmedBy: '山田 太郎',
  containsDirectIdentifiers: false,
  anonymousLabel: '候補者 38DCA6F6',
  fields: [{ key: 'skills', label: 'スキル', value: 'Java, AWS', sourceLabels: ['Page 1'] }],
  matchScore: null,
  matchedTerms: [],
  evidence: [],
  projectExperiences: [],
  projectEvidence: null,
  retrieval: { strategy: 'hard-filter-bm25-v1', hardFilterPolicyVersion: 'tri-state-v3', bm25Score: null, vectorScore: null, fusionScore: null, rerankerScore: null, bm25Rank: null, vectorRank: null, preRerankRank: null, rerankerRank: null, rank: null, termCoverage: null, indexedFieldCount: 1, hardFilters: [] }
}

const history: CandidateProfileVersionDetail[] = [{
  id: candidate.id,
  sourceDocumentId: candidate.sourceDocumentId,
  version: 1,
  status: 'current',
  confirmedAt: candidate.confirmedAt,
  confirmedBy: candidate.confirmedBy,
  containsDirectIdentifiers: false,
  reviewRevision: 1,
  fields: candidate.fields,
  projectExperiences: []
}]

const originalPreview: OriginalDocumentPreview = {
  version: 'original-document-preview-v1',
  documentId: candidate.sourceDocumentId,
  fileName: 'candidate.xlsx',
  format: 'xlsx',
  size: 2048,
  sha256: 'a'.repeat(64),
  viewMode: 'spreadsheet',
  previewUrl: null,
  sheets: [{
    name: '履歴書',
    printArea: 'A1:AM30',
    cells: [
      { address: 'A5', text: '氏名', mergedRange: null, inPrintArea: true },
      { address: 'D5', text: '山田 花子', mergedRange: 'D5:I5', inPrintArea: true },
      { address: 'D8', text: '東京工科大学', mergedRange: 'D8:R8', inPrintArea: true },
      { address: 'H18', text: 'Java', mergedRange: null, inPrintArea: true }
    ]
  }],
  pages: [],
  paragraphs: [],
  personalFieldSources: { displayName: ['履歴書!D5'], education: ['履歴書!D8'] },
  storage: 'encrypted-local-vault',
  cloudEligible: false,
  originalFileAvailable: true
}

const report: DataDeletionReport = {
  id: '8055be48-a08f-499d-9d82-c95a36018ad9',
  entityType: 'candidate',
  entityIdHash: 'a'.repeat(64),
  requestedBy: '山田 太郎',
  startedAt: '2026-07-17T01:00:00.000Z',
  completedAt: '2026-07-17T01:00:01.000Z',
  outcome: 'completed',
  components: {
    database: 'deleted',
    fileVault: 'deleted',
    searchIndex: 'deleted',
    cache: 'not_present',
    temporaryFiles: 'not_present',
    backups: 'not_present'
  },
  deletedCounts: { profileVersions: 1, reviewAudits: 7, taskRecords: 1, matchRecords: 0, evaluationRecords: 0, proposalDrafts: 0, piiMappings: 3, searchIndexEntries: 1, encryptedFiles: 1, agentReferences: { conversations: 0, messages: 0 } },
  warningCodes: ['EXTERNAL_EXPORTS_OUTSIDE_SCOPE']
}

function renderLibrary(overrides: Partial<Parameters<typeof CandidateLibrary>[0]> = {}) {
  const props = {
    onSearch: vi.fn().mockResolvedValue([candidate]),
    onLoadHistory: vi.fn().mockResolvedValue(history),
    onLoadOriginalDocument: vi.fn().mockResolvedValue(originalPreview),
    onOpenOriginalDocument: vi.fn().mockResolvedValue({ opened: true, fileName: originalPreview.fileName, cleanup: 'scheduled' }),
    onSetLifecycle: vi.fn().mockResolvedValue({}),
    onUpdateCandidate: vi.fn().mockResolvedValue({ candidate, history }),
    onPreviewDeletion: vi.fn(),
    onDeleteCandidate: vi.fn(),
    ...overrides
  }
  render(<CandidateLibrary {...props} />)
  return props
}

describe('CandidateLibrary eligible talent pool', () => {
  it('opens the exact personnel record for editing even when it is outside the default results', async () => {
    const onSearch = vi.fn().mockImplementation(async (input) => input.sourceDocumentId === candidate.sourceDocumentId ? [candidate] : [])
    const props = renderLibrary({ profileRequest: { id: 1, documentId: candidate.sourceDocumentId }, onSearch })
    fireEvent.click(await screen.findByRole('button', { name: 'プロフィールを編集' }))
    expect(onSearch).toHaveBeenCalledWith({ query: '', sourceDocumentId: candidate.sourceDocumentId, maxResults: 1 })
    expect(props.onLoadHistory).toHaveBeenCalledWith(candidate.sourceDocumentId)
    expect(screen.getByRole('button', { name: '変更を保存' })).toBeEnabled()
    expect(screen.getByRole('textbox', { name: 'スキル' })).toBeEnabled()
  })

  it('opens the encrypted original in a full comparison workspace and system application', async () => {
    const sourceCandidate: CandidateProfileSearchResult = {
      ...candidate,
      fields: [{ key: 'skills', label: 'スキル', value: 'Java', sourceLabels: ['履歴書!H18'] }],
      localIdentity: {
        ...emptyLocalDetails,
        displayName: '山田 花子',
        education: '東京工科大学',
        storage: 'encrypted-local-only',
        cloudEligible: false
      }
    }
    const onLoadOriginalDocument = vi.fn().mockResolvedValue(originalPreview)
    const onOpenOriginalDocument = vi.fn().mockResolvedValue({ opened: true, fileName: originalPreview.fileName, cleanup: 'scheduled' })
    renderLibrary({
      onSearch: vi.fn().mockResolvedValue([sourceCandidate]),
      onLoadOriginalDocument,
      onOpenOriginalDocument
    })

    await screen.findByRole('heading', { name: '山田 花子' })
    fireEvent.click(screen.getByRole('button', { name: '完全なプロフィールを見る' }))
    fireEvent.click(await screen.findByRole('tab', { name: '原始資料' }))
    expect(await screen.findByRole('heading', { name: '原本とプロフィールを照合' })).toBeInTheDocument()
    expect(onLoadOriginalDocument).toHaveBeenCalledWith(candidate.sourceDocumentId)
    expect(screen.getByTitle('履歴書!D5')).toHaveClass('is-source-selected')

    fireEvent.focus(screen.getByRole('textbox', { name: 'スキル' }))
    expect(screen.getByTitle('履歴書!H18')).toHaveClass('is-source-selected')
    fireEvent.focus(screen.getByRole('textbox', { name: '学校名・最終学歴' }))
    expect(screen.getByTitle('履歴書!D8')).toHaveClass('is-source-selected')
    fireEvent.click(screen.getByRole('button', { name: /システムアプリで開く/ }))
    await waitFor(() => expect(onOpenOriginalDocument).toHaveBeenCalledWith(candidate.sourceDocumentId))
    expect(await screen.findByText('システムアプリで原始ファイルを開きました。')).toBeInTheDocument()
  })

  it('edits the standard profile beside the original and auto-saves a new version', async () => {
    const sourceCandidate: CandidateProfileSearchResult = {
      ...candidate,
      fields: [{ key: 'skills', label: 'スキル', value: 'Java', sourceLabels: ['履歴書!H18'] }],
      localIdentity: {
        ...emptyLocalDetails,
        displayName: '山田 花子',
        education: '東京工科大学',
        storage: 'encrypted-local-only',
        cloudEligible: false
      }
    }
    const updatedCandidate: CandidateProfileSearchResult = {
      ...sourceCandidate,
      version: 2,
      fields: [{ key: 'skills', label: 'スキル', value: 'Java, AWS', sourceLabels: ['履歴書!H18'] }]
    }
    const onUpdateCandidate = vi.fn().mockResolvedValue({ candidate: updatedCandidate, history: [{ ...history[0]!, version: 2, fields: updatedCandidate.fields }] })
    renderLibrary({ onSearch: vi.fn().mockResolvedValue([sourceCandidate]), onUpdateCandidate })

    await screen.findByRole('heading', { name: '山田 花子' })
    fireEvent.click(screen.getByRole('button', { name: '完全なプロフィールを見る' }))
    fireEvent.click(await screen.findByRole('tab', { name: '原始資料' }))
    const skills = await screen.findByRole('textbox', { name: 'スキル' })
    fireEvent.focus(skills)
    fireEvent.change(skills, { target: { value: 'Java, AWS' } })

    await waitFor(() => expect(onUpdateCandidate).toHaveBeenCalledWith(expect.objectContaining({
      sourceDocumentId: candidate.sourceDocumentId,
      expectedVersion: 1,
      fields: [expect.objectContaining({ key: 'skills', value: 'Java, AWS' })]
    })), { timeout: 2_000 })
    expect(await screen.findByText('保存済み')).toBeInTheDocument()
    expect(screen.getByTitle('履歴書!H18')).toHaveClass('is-source-selected')
  })

  it('lets the operator resize the original and standardized-profile columns', async () => {
    renderLibrary({
      onSearch: vi.fn().mockResolvedValue([{
        ...candidate,
        localIdentity: {
          ...emptyLocalDetails,
          displayName: '山田 花子',
          storage: 'encrypted-local-only',
          cloudEligible: false
        }
      }])
    })

    await screen.findByRole('heading', { name: '山田 花子' })
    fireEvent.click(screen.getByRole('button', { name: '完全なプロフィールを見る' }))
    fireEvent.click(await screen.findByRole('tab', { name: '原始資料' }))
    const divider = await screen.findByRole('separator', { name: '原始ファイルと標準プロフィールの幅を調整' })
    const compare = divider.closest('.original-document-compare') as HTMLDivElement
    Object.defineProperty(compare, 'getBoundingClientRect', {
      configurable: true,
      value: () => ({ bottom: 700, height: 680, left: 100, right: 1100, top: 20, width: 1000, x: 100, y: 20, toJSON: () => ({}) })
    })
    Object.defineProperty(divider, 'setPointerCapture', { configurable: true, value: vi.fn() })
    Object.defineProperty(divider, 'releasePointerCapture', { configurable: true, value: vi.fn() })

    fireEvent.pointerDown(divider, { button: 0, clientX: 700, pointerId: 1 })
    fireEvent.pointerMove(divider, { clientX: 750, pointerId: 1 })
    fireEvent.pointerUp(divider, { clientX: 750, pointerId: 1 })

    await waitFor(() => expect(compare.style.getPropertyValue('--original-document-viewer-width')).toBe('650px'))
    expect(divider).toHaveAttribute('aria-valuenow', '65')
  })

  it('shows and saves local identity, contact details, profile fields, and a new version', async () => {
    const editableFields: CandidateProfileSearchResult['fields'] = [
      { key: 'skills', label: 'スキル', value: 'Java, AWS', sourceLabels: ['Page 1'] },
      { key: 'experience_years', label: '経験年数', value: '8年', sourceLabels: ['Page 1'] },
      { key: 'availability', label: '稼働時期', value: '2026年8月', sourceLabels: ['Page 1'] },
      { key: 'rate', label: '希望単価', value: '80万円', sourceLabels: ['Page 1'] },
      { key: 'japanese_level', label: '日本語力', value: 'N1', sourceLabels: ['Page 1'] },
      { key: 'work_style', label: '勤務形態', value: 'リモート併用', sourceLabels: ['Page 1'] },
      { key: 'role', label: '主力ロール', value: 'SE', sourceLabels: ['Page 1'] },
      { key: 'location', label: '希望勤務地', value: '東京都', sourceLabels: ['Page 1'] },
      { key: 'work_authorization', label: '就労資格', value: '就労制限なし', sourceLabels: ['Page 1'] }
    ]
    const editableCandidate: CandidateProfileSearchResult = {
      ...candidate,
      fields: editableFields,
      localIdentity: {
        ...emptyLocalDetails,
        displayName: '山田 花子',
        gender: '女性',
        birthDate: '1990年4月',
        nationality: '中国',
        phone: '090-1111-2222',
        email: 'hanako@example.jp',
        address: '東京都新宿区',
        education: '東京工科大学',
        major: '情報工学',
        graduationDate: '2013年3月',
        degree: '学士',
        storage: 'encrypted-local-only',
        cloudEligible: false
      }
    }
    const updatedCandidate: CandidateProfileSearchResult = {
      ...editableCandidate,
      version: 2,
      localIdentity: { ...editableCandidate.localIdentity!, displayName: '山田 花子（更新）', email: 'updated@example.jp' }
    }
    const onUpdateCandidate = vi.fn().mockResolvedValue({ candidate: updatedCandidate, history: [{ ...history[0]!, version: 2, fields: editableFields }] })
    renderLibrary({ onSearch: vi.fn().mockResolvedValue([editableCandidate]), onUpdateCandidate })

    await screen.findByRole('heading', { name: '山田 花子' })
    expect(screen.getByText('090-1111-2222')).toBeInTheDocument()
    expect(screen.getByText('hanako@example.jp')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '完全なプロフィールを見る' }))
    await screen.findByRole('main', { name: '人材プロフィール詳細' })
    expect(screen.getAllByText('東京都新宿区')).not.toHaveLength(0)
    expect(screen.getByText('東京工科大学')).toBeInTheDocument()
    expect(screen.getByText('情報工学')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'プロフィールを編集' }))
    fireEvent.change(screen.getByRole('textbox', { name: '姓名' }), { target: { value: '山田 花子（更新）' } })
    fireEvent.change(screen.getByRole('textbox', { name: 'メールアドレス' }), { target: { value: 'updated@example.jp' } })
    const ownCompany = screen.getByRole('combobox', { name: '自社所属' })
    expect(ownCompany).toHaveValue('')
    fireEvent.change(ownCompany, { target: { value: 'false' } })
    expect(ownCompany).toHaveValue('false')
    fireEvent.change(ownCompany, { target: { value: '' } })
    expect(ownCompany).toHaveValue('')
    fireEvent.change(ownCompany, { target: { value: 'true' } })
    fireEvent.click(screen.getByRole('button', { name: '変更を保存' }))

    await waitFor(() => expect(onUpdateCandidate).toHaveBeenCalledTimes(1))
    expect(onUpdateCandidate).toHaveBeenCalledWith(expect.objectContaining({
      sourceDocumentId: candidate.sourceDocumentId,
      expectedVersion: 1,
      isOwnCompany: true,
      identity: expect.objectContaining({ displayName: '山田 花子（更新）', email: 'updated@example.jp', phone: '090-1111-2222' }),
      fields: expect.arrayContaining([expect.objectContaining({ key: 'skills', value: 'Java, AWS' })])
    }))
    expect(await screen.findByRole('heading', { name: '山田 花子（更新）' })).toBeInTheDocument()
  })

  it('opens a full talent profile with standard fields and complete project history', async () => {
    renderLibrary({
      onSearch: vi.fn().mockResolvedValue([{
        ...candidate,
        localIdentity: { ...emptyLocalDetails, displayName: '山田 花子', storage: 'encrypted-local-only', cloudEligible: false },
        fields: [
          ...candidate.fields,
          { key: 'role', label: '主力ロール', value: 'バックエンドエンジニア', sourceLabels: ['Page 1'] },
          { key: 'experience_years', label: '経験年数', value: '8年', sourceLabels: ['Page 1'] },
          { key: 'availability', label: '稼働時期', value: '2026年8月', sourceLabels: ['Page 2'] }
        ],
        projectExperiences: [{
          id: 'project-1',
          title: '決済基盤リニューアル',
          period: '2023/01–2025/06',
          role: 'SE',
          technologies: ['Java', 'AWS'],
          summary: 'API設計、実装、性能改善を担当。',
          sourceLabels: ['Page 2']
        }]
      }])
    })

    expect(await screen.findByRole('heading', { name: '山田 花子' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '完全なプロフィールを見る' }))
    expect(await screen.findByRole('main', { name: '人材プロフィール詳細' })).toBeInTheDocument()
    expect(screen.getAllByText('バックエンドエンジニア')).not.toHaveLength(0)
    fireEvent.click(screen.getByRole('tab', { name: /プロジェクト経験/ }))
    expect(screen.getByText('決済基盤リニューアル')).toBeInTheDocument()
    expect(screen.getByText('API設計、実装、性能改善を担当。')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '人材プールへ戻る' }))
    expect(await screen.findByRole('heading', { name: '人材プール' })).toBeInTheDocument()
  })

  it('requires detail-page consent and omits the local display name from Cloud AI prompts', async () => {
    const onSendCloudPrompt = vi.fn().mockResolvedValue({
      requestId: 'request-1',
      aiRequestId: 'ai-request-1',
      content: 'Java と AWS が主な強みです。',
      usageCredits: 1,
      wallet: null,
      removedIdentifierTypes: [],
      billingModeUsed: 'standard'
    })
    renderLibrary({
      aiCommerce: {
        configuration: 'ready',
        connection: 'connected',
        productCode: 'sesAgent',
        billingMode: 'standard',
        memberDisplayName: 'Tester',
        accountId: 'account-1',
        accountAiTokenExpiresAt: null,
        wallet: null,
        capabilities: [],
        refreshedAt: null
      },
      onSendCloudPrompt,
      onSearch: vi.fn().mockResolvedValue([{ ...candidate, localIdentity: {
        ...emptyLocalDetails,
        displayName: '山田 花子',
        gender: '女性',
        birthDate: '1990年4月',
        nationality: '中国',
        phone: '090-1111-2222',
        email: 'hanako@example.jp',
        address: '東京都新宿区1-2-3',
        education: '東京工科大学',
        major: '情報工学',
        graduationDate: '2013年3月',
        degree: '学士',
        storage: 'encrypted-local-only',
        cloudEligible: false
      } }])
    })

    await screen.findByRole('heading', { name: '山田 花子' })
    fireEvent.click(screen.getByRole('button', { name: '完全なプロフィールを見る' }))
    await screen.findByRole('main', { name: '人材プロフィール詳細' })
    fireEvent.click(screen.getByRole('button', { name: 'Cloud AI分析' }))
    const quickPrompt = screen.getByRole('button', { name: '主な強みは？' })
    expect(quickPrompt).toBeDisabled()
    fireEvent.click(screen.getByRole('checkbox', { name: /脱敏後の匿名プロフィール送信を確認/ }))
    fireEvent.click(quickPrompt)
    await waitFor(() => expect(onSendCloudPrompt).toHaveBeenCalledTimes(1))
    const prompt = onSendCloudPrompt.mock.calls[0]?.[0].content as string
    expect(prompt).not.toContain('山田 花子')
    expect(prompt).not.toContain('090-1111-2222')
    expect(prompt).not.toContain('hanako@example.jp')
    expect(prompt).not.toContain('東京都新宿区1-2-3')
    expect(prompt).not.toContain('1990年4月')
    expect(prompt).not.toContain('中国')
    expect(prompt).not.toContain('東京工科大学')
    expect(prompt).not.toContain('情報工学')
    expect(prompt).toContain('Java, AWS')
  })

  it('shows an encrypted local identity while retaining the anonymous matching ID', async () => {
    renderLibrary({
      onSearch: vi.fn().mockResolvedValue([{
        ...candidate,
        localIdentity: {
          ...emptyLocalDetails,
          displayName: '候補者A',
          storage: 'encrypted-local-only',
          cloudEligible: false
        }
      }])
    })
    expect(await screen.findByRole('heading', { name: '候補者A' })).toBeInTheDocument()
    expect(screen.getByText(new RegExp(candidate.anonymousLabel))).toBeInTheDocument()
    expect(screen.getByText('ローカル暗号化プロフィール · Cloud送信前に脱敏')).toBeInTheDocument()
  })

  it('shows unknown hard conditions as an HR confirmation risk', async () => {
    renderLibrary({
      onSearch: vi.fn().mockResolvedValue([{
        ...candidate,
        matchScore: 70,
        retrieval: {
          ...candidate.retrieval,
          rank: 1,
          hardFilters: [{
            type: 'availability-by',
            requested: '8月',
            actual: null,
            outcome: 'unknown'
          }]
        }
      }])
    })
    expect(await screen.findByText('未確認 · 候補者資料に記載なし')).toBeInTheDocument()
    expect(screen.getByText('硬条件 未確認1件')).toBeInTheDocument()
  })

  it('does not expose the retired archive lifecycle control in the eligible talent list', async () => {
    renderLibrary()
    expect(await screen.findByRole('heading', { name: candidate.anonymousLabel })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '完全なプロフィールを見る' }))
    expect(await screen.findByRole('main', { name: '人材プロフィール詳細' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('tab', { name: /バージョン履歴/ }))
    await screen.findByText('Version 1')
    expect(screen.queryByRole('button', { name: '候補者をアーカイブ' })).not.toBeInTheDocument()
  })

  it('requires an impact preview and typed confirmation before permanent deletion', async () => {
    const onPreviewDeletion = vi.fn().mockResolvedValue({
      sourceDocumentId: candidate.sourceDocumentId,
      anonymousLabel: candidate.anonymousLabel,
      localFileName: 'candidate.pdf',
      counts: report.deletedCounts,
      confirmationHash: 'b'.repeat(64),
      warningCodes: ['EXTERNAL_EXPORTS_OUTSIDE_SCOPE']
    })
    const onDeleteCandidate = vi.fn().mockResolvedValue({ report })
    renderLibrary({ onPreviewDeletion, onDeleteCandidate })
    expect(await screen.findByRole('heading', { name: candidate.anonymousLabel })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '完全なプロフィールを見る' }))
    await screen.findByRole('main', { name: '人材プロフィール詳細' })
    fireEvent.click(screen.getByRole('tab', { name: /バージョン履歴/ }))
    await screen.findByText('Version 1')
    fireEvent.click(screen.getByRole('button', { name: '削除前の影響を確認' }))
    expect(await screen.findByText('暗号化ファイル 1件')).toBeInTheDocument()
    const deleteButton = screen.getByRole('button', { name: '完全に削除' })
    expect(deleteButton).toBeDisabled()
    fireEvent.change(screen.getByLabelText('削除確認'), { target: { value: '削除' } })
    expect(deleteButton).toBeEnabled()
    fireEvent.click(deleteButton)
    expect(onDeleteCandidate).toHaveBeenCalledWith({
      sourceDocumentId: candidate.sourceDocumentId,
      confirmationHash: 'b'.repeat(64),
      confirmationText: '削除'
    })
    expect(await screen.findByLabelText('削除レポート')).toHaveTextContent('DB deleted · File deleted')
  })
})
