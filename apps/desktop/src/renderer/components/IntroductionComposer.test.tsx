import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, expect, it, vi } from 'vitest'
import {
  builtInPersonnelTemplates,
  type BusinessFollowUp,
  type CandidateReviewSnapshot,
  type DesktopApi,
  type JobCaseReviewSnapshot
} from '@shared'
import { IntroductionComposer } from './IntroductionComposer'

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
const recommended = {
  id: '44444444-4444-4444-8444-444444444444',
  documentId,
  reviewId,
  revision: 1,
  status: 'interview',
  note: '已推荐给案件方',
  nextStep: '',
  updatedAt: '2026-09-30T01:05:00.000Z',
  recordedBy: 'HR',
  events: [],
  progress: {
    stage: 'recommended',
    recommendedAt: '2026-09-30T01:05:00.000Z',
    candidateAvailability: '',
    clientAvailability: '',
    pendingConditions: [],
    entry: {} as never,
    rounds: []
  }
} as BusinessFollowUp

beforeEach(() => {
  Object.defineProperty(window, 'sesAgent', {
    configurable: true,
    value: {
      getPersonnelWorkspace: vi.fn(async () => ({ templates: builtInPersonnelTemplates(), states: [], copies: [] })),
      listPersonnelIntroductionDrafts: vi.fn(async () => [
        { caseReviewId: reviewId, jobCaseVersion: 1, style: 'standard', lang: 'ja', text: 'Saved intro', experienceRunId: null },
        { caseReviewId: reviewId, jobCaseVersion: 1, style: 'standard', lang: 'zh', text: '已保存介绍', experienceRunId: null }
      ]),
      regenerateIntroduction: vi.fn(),
      validatePersonnelMessage: vi.fn(async (input) => input),
      recordPersonnelCopy: vi.fn(),
      openPersonnelEmail: vi.fn(async () => ({ opened: true as const, recipientPrefilled: true })),
      copyTextToClipboard: vi.fn(async () => {}),
      advanceBusinessProgress: vi.fn(async () => recommended),
      openOriginalDocument: vi.fn(async () => ({ opened: true, fileName: 'resume.pdf', cleanup: 'scheduled' })),
      exportSkillSheet: vi.fn(async () => ({ cancelled: false as const, fileName: 'skill-sheet-11111111.pdf' }))
    } as unknown as Partial<DesktopApi>
  })
})

const renderComposer = (withCase = true, onFollowUp = vi.fn()) =>
  render(
    <IntroductionComposer
      target={
        withCase
          ? { documentId, profileVersion: 1, reviewId, jobCaseVersion: 1, matched: [] }
          : { documentId, profileVersion: 1, matched: [] }
      }
      people={[person]}
      cases={[job]}
      onClose={vi.fn()}
      onFollowUp={onFollowUp}
    />
  )

it('asks whether the introduction was sent after copying and records the recommendation explicitly', async () => {
  const onFollowUp = vi.fn()
  renderComposer(true, onFollowUp)
  expect(screen.getByRole('dialog', { name: '紹介を準備' })).toBeVisible()
  expect(screen.queryByText(/送信済みになりません/)).not.toBeInTheDocument()
  expect(screen.getByRole('button', { name: '対応を開始' })).toBeVisible()
  await waitFor(() => expect(screen.getByRole('textbox', { name: '紹介文' })).toHaveValue('Saved intro'))
  fireEvent.click(screen.getByRole('button', { name: '紹介文をコピー' }))
  expect(await screen.findByText('送信しましたか？')).toBeVisible()
  fireEvent.click(screen.getByRole('button', { name: '推薦済みにする' }))
  await waitFor(() =>
    expect(window.sesAgent.advanceBusinessProgress).toHaveBeenCalledWith(
      expect.objectContaining({ documentId, reviewId, expectedRevision: 0, action: 'recommend' })
    )
  )
  // 01:05 UTC is 10:05 in Tokyo.
  expect(await screen.findByText(/推薦済み · .*10:05/u)).toBeVisible()
  expect(screen.queryByRole('button', { name: '推薦済みにする' })).not.toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: '対応を見る' }))
  expect(onFollowUp).toHaveBeenCalledWith({ documentId, reviewId })
})

it('uses a distinct title for personnel promotion without a case and offers no recommendation', async () => {
  renderComposer(false)
  expect(screen.getByRole('dialog', { name: '要員を紹介' })).toBeVisible()
  expect(screen.queryByRole('button', { name: '推薦済みにする' })).not.toBeInTheDocument()
  expect(screen.queryByRole('button', { name: '対応を開始' })).not.toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: '履歴書の原本を開く' }))
  expect(window.sesAgent.openOriginalDocument).toHaveBeenCalledWith(documentId)
})

it('exports the redacted skill sheet for the selected case and tells HR to attach it', async () => {
  renderComposer(true)
  expect(screen.getByText(/氏名・連絡先・履歴書の原本は含みません/u)).toBeVisible()
  fireEvent.click(screen.getByRole('button', { name: 'スキルシートを書き出す' }))
  await waitFor(() =>
    expect(window.sesAgent.exportSkillSheet).toHaveBeenCalledWith({
      documentId,
      profileVersion: 1,
      caseContext: { reviewId, version: 1 }
    })
  )
  expect(await screen.findByText(/skill-sheet-11111111\.pdf を書き出し/u)).toBeVisible()
})

it('exports a general skill sheet without a case and stays quiet when the save is cancelled', async () => {
  vi.mocked(window.sesAgent.exportSkillSheet!).mockResolvedValueOnce({ cancelled: true, fileName: null })
  renderComposer(false)
  fireEvent.click(screen.getByRole('button', { name: 'スキルシートを書き出す' }))
  await waitFor(() => expect(window.sesAgent.exportSkillSheet).toHaveBeenCalledWith({ documentId, profileVersion: 1 }))
  expect(screen.queryByText(/を書き出し、Finderで表示しました/u)).not.toBeInTheDocument()
})

const pointsRecord = {
  documentId,
  reviewId,
  profileVersion: 1,
  jobCaseVersion: 1,
  locale: 'ja-JP' as const,
  points: [
    {
      headline: '損保の基本設計経験',
      detail: '契約管理システム刷新でPLとして基本設計を担当。',
      project: '契約管理刷新',
      quote: '基本設計を担当'
    },
    { headline: 'Java 8年', detail: 'Java と Spring Boot で8年の開発経験。', project: null, quote: 'Java 8年' }
  ],
  emptyReason: null,
  generatedAt: '2026-09-30T01:05:00.000Z',
  modelName: null
}

it('inserts a stored 推荐要点 at the end, then at the cursor HR placed', async () => {
  Object.assign(window.sesAgent, {
    getRecommendationPoints: vi.fn(async () => ({ record: pointsRecord, stale: false })),
    generateRecommendationPoints: vi.fn()
  })
  renderComposer()
  const body = screen.getByRole('textbox', { name: '紹介文' }) as HTMLTextAreaElement
  await waitFor(() => expect(body).toHaveValue('Saved intro'))
  const picker = await screen.findByRole('complementary', { name: '推薦ポイント' })
  await waitFor(() => expect(picker).toHaveTextContent('損保の基本設計経験'))
  fireEvent.click(screen.getByRole('button', { name: '挿入：損保の基本設計経験' }))
  expect(body).toHaveValue('Saved intro\n・損保の基本設計経験：契約管理システム刷新でPLとして基本設計を担当。')
  body.setSelectionRange(5, 5)
  fireEvent.select(body)
  fireEvent.click(screen.getByRole('button', { name: '挿入：Java 8年' }))
  expect(body.value.startsWith('Saved\n・Java 8年：Java と Spring Boot で8年の開発経験。\n intro')).toBe(true)
  expect(window.sesAgent.getRecommendationPoints).toHaveBeenCalledWith({ documentId, reviewId })
})

it('offers to generate 推荐要点 in place when none are current', async () => {
  Object.assign(window.sesAgent, {
    getRecommendationPoints: vi.fn(async () => ({ record: { ...pointsRecord, profileVersion: 0 }, stale: true })),
    generateRecommendationPoints: vi.fn(async () => ({ record: pointsRecord, stale: false }))
  })
  renderComposer()
  fireEvent.click(await screen.findByRole('button', { name: '先に推薦ポイントを生成' }))
  expect(window.sesAgent.generateRecommendationPoints).toHaveBeenCalledWith({ documentId, reviewId })
  expect(await screen.findByRole('button', { name: '挿入：Java 8年' })).toBeVisible()
})

it('shows no 推荐要点 section for a general introduction without a case', async () => {
  Object.assign(window.sesAgent, { getRecommendationPoints: vi.fn(), generateRecommendationPoints: vi.fn() })
  renderComposer(false)
  await waitFor(() => expect(window.sesAgent.listPersonnelIntroductionDrafts).toHaveBeenCalled())
  expect(screen.queryByRole('complementary', { name: '推薦ポイント' })).not.toBeInTheDocument()
  expect(window.sesAgent.getRecommendationPoints).not.toHaveBeenCalled()
})
