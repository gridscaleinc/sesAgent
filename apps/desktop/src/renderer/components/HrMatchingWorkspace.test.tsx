import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { beforeEach, expect, it, vi } from 'vitest'
import {
  builtInPersonnelTemplates,
  type CandidateBusinessState,
  type CandidateReviewSnapshot,
  type DesktopApi,
  type JobCaseReviewSnapshot,
  type PersonnelCaseMatchResult
} from '@shared'
import { HrMatchingWorkspace } from './HrMatchingWorkspace'
import { clearPersonCaseMatchCache, hydratePersonCaseMatches, personCaseMatchCount } from '../person-case-match-cache'

const documentId = '11111111-1111-4111-8111-111111111111'
const reviewId = '22222222-2222-4222-8222-222222222222'
const person = {
  documentId,
  fileName: 'Test Engineer',
  fields: [],
  projectExperiences: [],
  reviewRevision: 1,
  recordStatus: 'active',
  profile: { version: 1 },
  isOwnCompany: null
} as unknown as CandidateReviewSnapshot
const job = {
  reviewId,
  redactedSubject: 'Java project',
  fields: [],
  lifecycle: 'active',
  status: 'completed',
  reviewRevision: 1,
  jobCase: { id: '33333333-3333-4333-8333-333333333333', version: 1 }
} as unknown as JobCaseReviewSnapshot
const result: PersonnelCaseMatchResult = {
  documentId,
  profileVersion: 1,
  rulesRevision: 4,
  localMatchCount: 1,
  searchedCount: 3,
  excludedCount: 2,
  excludedRequirements: ['Scala'],
  ownCompanyExcludedCount: 1,
  cloud: { status: 'reviewed', reviewedCount: 1, modelName: 'test-model' },
  items: [
    {
      reviewId,
      jobCaseId: job.jobCase!.id,
      jobCaseVersion: 1,
      title: 'Java project',
      score: 5,
      matched: ['Java'],
      missing: [],
      hardFilters: [],
      qualification: {
        policyVersion: 'technical-language-v5',
        status: 'recommended',
        requirements: [
          {
            requirement: {
              id: 'R1',
              key: 'required_skills',
              label: 'Java',
              category: 'core',
              alternatives: [['Java']],
              minimumYears: null,
              requiresPractice: false
            },
            outcome: 'met',
            evidence: 'Java',
            source: 'Project A'
          }
        ]
      },
      appliedRules: [{ id: 'rule', revision: 4, kind: 'prefer', text: 'Prefer Java' }] as never
    }
  ]
}
const api = (states: CandidateBusinessState[] = []) => {
  const value = {
    getPersonnelWorkspace: vi.fn(async () => ({ templates: builtInPersonnelTemplates(), states, copies: [] })),
    listWorkRules: vi.fn(async () => ({ revision: 4 })),
    onBusinessMatchingProgress: vi.fn(() => () => {}),
    cancelBusinessMatching: vi.fn(async () => {}),
    findCasesForPersonnel: vi.fn(async () => result)
  }
  Object.defineProperty(window, 'sesAgent', { configurable: true, value: value as unknown as Partial<DesktopApi> })
  return value
}
const props = (requestId: number) => ({
  source: { kind: 'person' as const, id: documentId, requestId },
  cases: [job],
  people: [person],
  onView: vi.fn(),
  onPrepare: vi.fn(),
  onBack: vi.fn(),
  onFollowUp: vi.fn()
})
beforeEach(() => clearPersonCaseMatchCache())

it('keeps the result for the next click, reports only this person as busy and exposes the case count', async () => {
  const sesAgent = api()
  const onBusyChange = vi.fn()
  const first = render(<HrMatchingWorkspace {...props(1)} onBusyChange={onBusyChange} />)
  await screen.findByRole('article')
  expect(onBusyChange).toHaveBeenNthCalledWith(1, [documentId])
  expect(onBusyChange).toHaveBeenLastCalledWith([])
  expect(personCaseMatchCount(documentId)).toBe(1)
  expect(personCaseMatchCount(documentId, 2)).toBeNull()
  first.unmount()
  // A new 找案件 click for the same unchanged person shows the kept result instead of re-running.
  render(<HrMatchingWorkspace {...props(2)} onBusyChange={onBusyChange} />)
  expect(screen.getByRole('article')).toBeVisible()
  await waitFor(() => expect(screen.getByRole('button', { name: '案件を再検索' })).toBeEnabled())
  expect(sesAgent.findCasesForPersonnel).toHaveBeenCalledTimes(1)
})

it('counts the person as busy from the click until the stored run is read, so 找案件 cannot start twice', async () => {
  let release!: (value: null) => void
  const sesAgent = Object.assign(api(), {
    getPersonnelCaseMatchRun: vi.fn(
      () =>
        new Promise<null>((resolve) => {
          release = resolve
        })
    )
  })
  const onBusyChange = vi.fn()
  render(<HrMatchingWorkspace {...props(1)} onBusyChange={onBusyChange} />)
  await waitFor(() => expect(onBusyChange).toHaveBeenCalledWith([documentId]))
  expect(screen.getByRole('button', { name: '案件を探す' })).toBeDisabled()
  expect(sesAgent.findCasesForPersonnel).not.toHaveBeenCalled()
  release(null)
  await screen.findByRole('article')
  expect(sesAgent.findCasesForPersonnel).toHaveBeenCalledTimes(1)
  expect(onBusyChange).toHaveBeenLastCalledWith([])
})

it('after a restart shows the stored run with 「前回の検索」 instead of re-running, and badges come from stored summaries', async () => {
  const sesAgent = Object.assign(api(), {
    getPersonnelCaseMatchRun: vi.fn(async () => ({
      result,
      searchedAt: '2026-09-30T01:00:00.000Z',
      caseSignature: `${job.jobCase!.id}:1`,
      policyVersion: 'technical-language-v5'
    })),
    listPersonnelCaseMatchRunSummaries: vi.fn(async () => [
      {
        documentId,
        profileVersion: 1,
        rulesRevision: 4,
        policyVersion: 'technical-language-v5',
        caseSignature: `${job.jobCase!.id}:1`,
        searchedAt: '2026-09-30T01:00:00.000Z',
        listedCount: 1
      }
    ])
  })
  render(<HrMatchingWorkspace {...props(10)} />)
  expect(await screen.findByRole('article')).toBeVisible()
  expect(screen.getByText(/前回の検索/)).toBeVisible()
  await waitFor(() => expect(screen.getByRole('button', { name: '案件を再検索' })).toBeEnabled())
  expect(sesAgent.findCasesForPersonnel).not.toHaveBeenCalled()
  expect(sesAgent.getPersonnelCaseMatchRun).toHaveBeenCalledWith(documentId)
  expect(sesAgent.listPersonnelCaseMatchRunSummaries).toHaveBeenCalledTimes(1)
  // 「案件を再検索」 forces a new run.
  fireEvent.click(screen.getByRole('button', { name: '案件を再検索' }))
  await waitFor(() => expect(sesAgent.findCasesForPersonnel).toHaveBeenCalledTimes(1))
})

it('keeps a stored run usable when cases were added or ended since, offering a new search instead of rerunning', async () => {
  const sesAgent = Object.assign(api(), {
    getPersonnelCaseMatchRun: vi.fn(async () => ({
      result,
      searchedAt: '2026-09-30T01:00:00.000Z',
      // A case that has ended since, and the current case missing: one case added, one gone.
      caseSignature: '44444444-4444-4444-8444-444444444444:1',
      policyVersion: 'technical-language-v5'
    }))
  })
  render(<HrMatchingWorkspace {...props(11)} />)
  expect(await screen.findByRole('article', { name: 'Java project' })).toBeInTheDocument()
  expect(screen.getByText('新しい案件があります。案件を探し直せます')).toBeInTheDocument()
  expect(sesAgent.findCasesForPersonnel).not.toHaveBeenCalled()
  // The result stays actionable.
  await waitFor(() => expect(screen.getByRole('button', { name: '紹介を準備' })).toBeEnabled())
})

it('hydrates list badge counts from stored summaries on first use', async () => {
  Object.assign(api(), {
    listPersonnelCaseMatchRunSummaries: vi.fn(async () => [
      {
        documentId,
        profileVersion: 1,
        rulesRevision: 4,
        policyVersion: 'technical-language-v5',
        caseSignature: '',
        searchedAt: '2026-09-30T01:00:00.000Z',
        listedCount: 3,
        // 可提案案件 counts the recommended cases only, from 找案件 and the case pages alike.
        proposableCount: 2
      }
    ])
  })
  await hydratePersonCaseMatches()
  expect(personCaseMatchCount(documentId)).toBe(2)
  expect(personCaseMatchCount(documentId, 2)).toBeNull()
})

it('puts primary actions first and AI internals in their tab with natural exclusion wording', async () => {
  api()
  const callbacks = props(3)
  render(<HrMatchingWorkspace {...callbacks} />)
  const card = await screen.findByRole('article', { name: 'Java project' })
  const buttons = [...card.querySelectorAll('.match-detail-actions > button')].map((button) => button.textContent)
  expect(buttons).toEqual(['紹介を準備', '対応を開始'])
  fireEvent.click(within(card).getByRole('button', { name: 'その他の操作' }))
  const menu = within(within(card).getByRole('menu'))
  fireEvent.click(menu.getByRole('menuitem', { name: '案件を見る' }))
  expect(callbacks.onView).toHaveBeenLastCalledWith('case', reviewId)
  fireEvent.click(within(card).getByRole('button', { name: 'その他の操作' }))
  fireEvent.click(within(within(card).getByRole('menu')).getByRole('menuitem', { name: '要員情報を見る' }))
  expect(callbacks.onView).toHaveBeenLastCalledWith('person', documentId)
  expect(screen.queryByText(/test-model/)).not.toBeVisible()
  expect(screen.getByText(/Prefer Java/)).not.toBeVisible()
  expect(screen.getByText('自社要員限定のため 1 件を除外')).not.toBeVisible()
  expect(screen.getByText(/除外 2/)).toBeVisible()
  fireEvent.click(within(card).getByRole('tab', { name: 'AIの意見' }))
  expect(screen.getByText(/test-model/)).toBeVisible()
  expect(screen.getByText(/Prefer Java/)).toBeVisible()
  fireEvent.click(screen.getByText('除外 3', { selector: 'summary' }))
  expect(screen.getByText('自社要員限定のため 1 件を除外')).toBeVisible()
})

it('lists one compact row per case beside the selected case, and hides the question tab without a draft', async () => {
  api()
  render(<HrMatchingWorkspace {...props(6)} />)
  const card = await screen.findByRole('article', { name: 'Java project' })
  const row = within(screen.getByRole('list', { name: '案件' })).getByRole('button', { name: /Java project/ })
  expect(row).toHaveAttribute('aria-current', 'true')
  expect(within(row).getByText('提案可能')).toBeInTheDocument()
  expect(within(row).getByText('✓ Java')).toHaveClass('is-met')
  expect(
    within(card)
      .getAllByRole('tab')
      .map((tab) => tab.textContent)
  ).toEqual(['マッチングの根拠', '推薦ポイント', '要相談', 'AIの意見', '記録'])
  expect(within(card).getByRole('table', { name: 'マッチングの根拠' })).toBeVisible()
  expect(screen.getByRole('button', { name: /^概要/ })).toHaveAttribute('aria-haspopup', 'dialog')
})

it('waits for business states, then names why an assigned person cannot be matched', async () => {
  const sesAgent = api([{ documentId, profileVersion: 1, status: 'assigned', confirmedAt: '2026-09-01T00:00:00Z', actorId: 'hr' }])
  const callbacks = props(4)
  render(<HrMatchingWorkspace {...callbacks} />)
  expect(screen.getByText('要員の状態を確認しています…')).toBeVisible()
  // 参画中 with no placement record (set by hand before): the status is adjusted in the profile.
  expect(await screen.findByText(/参画記録がないため/)).toBeVisible()
  fireEvent.click(screen.getByRole('button', { name: '営業状態を変更' }))
  expect(callbacks.onView).toHaveBeenCalledWith('person', documentId)
  expect(sesAgent.findCasesForPersonnel).not.toHaveBeenCalled()
})

it('offers a rules retry without leaving the result permanently stale', async () => {
  const sesAgent = api()
  sesAgent.listWorkRules.mockRejectedValueOnce(new Error('offline'))
  render(<HrMatchingWorkspace {...props(5)} />)
  await screen.findByRole('article')
  expect(screen.getByText(/ルールを読み込めなかった/)).toBeVisible()
  expect(screen.queryByText(/案件を再検索してください/)).not.toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: '再試行' }))
  await waitFor(() => expect(screen.queryByText(/ルールを読み込めなかった/)).not.toBeInTheDocument())
  expect(screen.getByRole('article')).toBeVisible()
})

it('selects the case a request asks for and names the page it goes back to', async () => {
  api()
  const second = {
    ...job,
    reviewId: '44444444-4444-4444-8444-444444444444',
    redactedSubject: 'Go project',
    jobCase: { id: '55555555-5555-4555-8555-555555555555', version: 1 }
  } as unknown as JobCaseReviewSnapshot
  const two = {
    ...result,
    items: [
      result.items[0]!,
      { ...result.items[0]!, reviewId: second.reviewId, jobCaseId: second.jobCase!.id, title: 'Go project', score: 4 }
    ]
  }
  api().findCasesForPersonnel.mockResolvedValue(two)
  const base = props(7)
  const onBack = vi.fn()
  render(
    <HrMatchingWorkspace
      {...base}
      cases={[job, second]}
      source={{ ...base.source, selectReviewId: second.reviewId }}
      backLabel="返回新匹配机会"
      onBack={onBack}
    />
  )
  const list = await screen.findByRole('list', { name: '案件' })
  await waitFor(() => expect(within(list).getByRole('button', { name: /Go project/ })).toHaveAttribute('aria-current', 'true'))
  fireEvent.click(screen.getByRole('button', { name: '← 返回新匹配机会' }))
  expect(onBack).toHaveBeenCalled()
})
