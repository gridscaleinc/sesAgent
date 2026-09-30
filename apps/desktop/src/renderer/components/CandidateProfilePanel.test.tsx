import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { expect, it, vi } from 'vitest'
import type { CandidateProfileSearchResult, CandidateProfileVersionDetail } from '@shared'
import { CandidateProfilePanel } from './CandidateProfilePanel'

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
  retrieval: {
    strategy: 'hard-filter-bm25-v1',
    hardFilterPolicyVersion: 'tri-state-v3',
    bm25Score: null,
    vectorScore: null,
    fusionScore: null,
    rerankerScore: null,
    bm25Rank: null,
    vectorRank: null,
    preRerankRank: null,
    rerankerRank: null,
    rank: null,
    termCoverage: null,
    indexedFieldCount: 1,
    hardFilters: []
  }
}

const history: CandidateProfileVersionDetail[] = [
  {
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
  }
]

const props = () => ({
  documentId: candidate.sourceDocumentId,
  onClose: vi.fn(),
  onSearch: vi.fn(async () => [candidate]),
  onLoadHistory: vi.fn(async () => history),
  onUpdateCandidate: vi.fn(),
  onLoadOriginalDocument: vi.fn(),
  onOpenOriginalDocument: vi.fn(),
  onPreviewDeletion: vi.fn(),
  onDeleteCandidate: vi.fn()
})

it('loads the full profile for one person into the panel and closes through its back action', async () => {
  const value = props()
  render(<CandidateProfilePanel {...value} />)
  fireEvent.click(await screen.findByRole('button', { name: 'プロフィールを編集' }))
  expect(value.onSearch).toHaveBeenCalledWith({ query: '', sourceDocumentId: candidate.sourceDocumentId, maxResults: 1 })
  expect(value.onLoadHistory).toHaveBeenCalledWith(candidate.sourceDocumentId)
  expect(screen.getByRole('textbox', { name: 'スキル' })).toBeEnabled()
})

it('shows a readable error instead of an empty panel when the person no longer exists', async () => {
  render(<CandidateProfilePanel {...props()} onSearch={vi.fn(async () => [])} />)
  expect(await screen.findByRole('alert')).toHaveTextContent('要員情報が見つからないか無効です。')
})

it('reloads when another person is opened in the same panel', async () => {
  const value = props()
  const view = render(<CandidateProfilePanel {...value} />)
  await screen.findByRole('button', { name: 'プロフィールを編集' })
  view.rerender(<CandidateProfilePanel {...value} documentId="7f3c3c1e-0000-4000-8000-000000000001" />)
  await waitFor(() =>
    expect(value.onSearch).toHaveBeenLastCalledWith({ query: '', sourceDocumentId: '7f3c3c1e-0000-4000-8000-000000000001', maxResults: 1 })
  )
})
