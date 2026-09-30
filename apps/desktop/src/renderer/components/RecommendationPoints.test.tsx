import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import type { RecommendationPointsRecord, RecommendationPointsView } from '@shared'
import { RecommendationPointsTab } from './RecommendationPoints'

vi.mock('../i18n', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../i18n')>()
  return {
    ...actual,
    useUiLocale: () => 'zh-CN',
    useLocaleText: () => ({ locale: 'zh-CN' as const, zh: true, t: actual.localeText(true) })
  }
})

const documentId = '11111111-1111-4111-8111-111111111111'
const reviewId = '22222222-2222-4222-8222-222222222222'
const record: RecommendationPointsRecord = {
  documentId,
  reviewId,
  profileVersion: 1,
  jobCaseVersion: 1,
  locale: 'zh-CN',
  points: [
    {
      headline: '损保系统的基本设计经验',
      detail: '在损保契约管理系统刷新中担任 PL，负责基本设计到结合测试。',
      project: '損保向け契約管理システム刷新',
      quote: '基本設計から結合テストまでを担当'
    },
    { headline: '长期 Java 经验', detail: '有 8 年 Java 开发经验。', project: null, quote: 'Java 8年' }
  ],
  emptyReason: null,
  generatedAt: '2026-09-30T01:05:00.000Z',
  modelName: 'GPT-5.6 Luna'
}
const api = (over: Record<string, unknown>) =>
  Object.defineProperty(window, 'sesAgent', {
    configurable: true,
    value: {
      getRecommendationPoints: vi.fn(async (): Promise<RecommendationPointsView> => ({ record: null, stale: false })),
      generateRecommendationPoints: vi.fn(async (): Promise<RecommendationPointsView> => ({ record, stale: false })),
      ...over
    }
  })
afterEach(cleanup)

it('explains the tab and generates on demand, showing progress and then numbered points with their source', async () => {
  let finish: (value: RecommendationPointsView) => void = () => {}
  api({ generateRecommendationPoints: vi.fn(() => new Promise<RecommendationPointsView>((resolve) => (finish = resolve))) })
  render(<RecommendationPointsTab documentId={documentId} reviewId={reviewId} />)
  expect(await screen.findByText(/由 AI 提炼 3–5 条/u)).toBeVisible()
  fireEvent.click(screen.getByRole('button', { name: '生成推荐要点' }))
  expect(window.sesAgent.generateRecommendationPoints).toHaveBeenCalledWith({ documentId, reviewId })
  expect(screen.getByRole('status')).toHaveTextContent('正在结合项目经历与案件内容生成推荐要点')
  expect(screen.getByRole('button', { name: '生成推荐要点' })).toBeDisabled()
  await act(async () => finish({ record, stale: false }))
  const items = within(screen.getByRole('list')).getAllByRole('listitem')
  expect(items).toHaveLength(2)
  expect(within(items[0]!).getByText('损保系统的基本设计经验').tagName).toBe('STRONG')
  expect(items[0]).toHaveTextContent('依据：損保向け契約管理システム刷新 · 「基本設計から結合テストまでを担当」')
  expect(items[1]).toHaveTextContent('依据：「Java 8年」')
  expect(screen.getByText('AI 生成，推荐前请核对')).toBeVisible()
  expect(screen.getByText(/10:05 · GPT-5.6 Luna/u)).toBeVisible()
  expect(screen.getByRole('button', { name: '重新生成' })).toBeEnabled()
})

it('shows stored points with the stale notice and keeps 重新生成 available', async () => {
  api({ getRecommendationPoints: vi.fn(async () => ({ record, stale: true })) })
  render(<RecommendationPointsTab documentId={documentId} reviewId={reviewId} />)
  expect(await screen.findByText('资料或案件已更新，建议重新生成')).toBeVisible()
  expect(screen.getAllByRole('listitem')).toHaveLength(2)
  fireEvent.click(screen.getByRole('button', { name: '重新生成' }))
  await waitFor(() => expect(screen.queryByText('资料或案件已更新，建议重新生成')).not.toBeInTheDocument())
})

it('disables generation with the reason when the person or result is not usable', async () => {
  api({})
  render(<RecommendationPointsTab documentId={documentId} reviewId={reviewId} blocked="此人员当前不可用于提案。" />)
  const button = await screen.findByRole('button', { name: '生成推荐要点' })
  expect(button).toBeDisabled()
  expect(button).toHaveAttribute('title', '此人员当前不可用于提案。')
  expect(screen.getByText('此人员当前不可用于提案。')).toBeVisible()
})

it('shows a localized failure with retry, and an AI sign-in action', async () => {
  const generate = vi
    .fn()
    .mockRejectedValueOnce(new Error("Error invoking remote method 'x': Error: 人员资料不可用。 / 要員情報が利用できません。"))
    .mockRejectedValueOnce(new Error('AiCommerceRequestError: Please sign in to Member Center'))
    .mockResolvedValueOnce({ record, stale: false })
  api({ generateRecommendationPoints: generate })
  render(<RecommendationPointsTab documentId={documentId} reviewId={reviewId} />)
  fireEvent.click(await screen.findByRole('button', { name: '生成推荐要点' }))
  expect(await screen.findByRole('alert')).toHaveTextContent('人员资料不可用。')
  expect(screen.getByRole('alert')).not.toHaveTextContent('要員情報')
  fireEvent.click(screen.getByRole('button', { name: '重试' }))
  expect(await screen.findByRole('button', { name: '去登录' })).toBeVisible()
  fireEvent.click(screen.getByRole('button', { name: '重试' }))
  expect(await screen.findByText('长期 Java 经验')).toBeVisible()
  expect(screen.queryByRole('alert')).not.toBeInTheDocument()
})

it('says so when no grounded point was found', async () => {
  api({
    getRecommendationPoints: vi.fn(async () => ({ record: { ...record, points: [], emptyReason: 'no-grounded-points' }, stale: false }))
  })
  render(<RecommendationPointsTab documentId={documentId} reviewId={reviewId} />)
  expect(await screen.findByText(/未能找到有简历原文依据的推荐要点/u)).toBeVisible()
})
