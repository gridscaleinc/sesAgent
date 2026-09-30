import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, expect, it } from 'vitest'
import { cloudFailureReason, type CasePersonAssessment } from '@shared'
import { AssessmentEvaluationStatus } from './AssessmentEvaluationStatus'
afterEach(cleanup)
const value = (cloud: Partial<CasePersonAssessment['cloud']>, assessed = false) =>
  ({
    result: { assessment: assessed ? {} : undefined },
    cloud: { status: 'unavailable', reviewedCount: 0, modelName: null, ...cloud }
  }) as CasePersonAssessment
it.each([
  [value({ reason: 'policy-refresh' }), '已按新规则完成本地重算'],
  [value({ reason: 'service-unavailable' }), 'AI 服务暂不可用'],
  [value({ status: 'failed', reason: 'request-failed' }), '云端 AI 评估未成功'],
  [value({ status: 'failed', reason: 'insufficient-credits' }), 'AI 额度不足'],
  [value({ status: 'failed', reason: 'sign-in-required' }), 'AI 未登录'],
  [value({ status: 'partial', reason: 'no-valid-result' }), '云端未返回此人的有效评估'],
  [value({}), '未记录本次有效的云端 AI 评估']
] as const)('states what actually happened without implying a pending background request', (assessment, label) => {
  render(<AssessmentEvaluationStatus value={assessment} zh />)
  expect(screen.getByText(new RegExp(label))).toBeInTheDocument()
  expect(screen.queryByText(/AI 评估尚未完成/)).not.toBeInTheDocument()
})
it('shows the individual reviewed result even when other people in its batch lack responses', () => {
  render(<AssessmentEvaluationStatus value={value({ status: 'partial', reason: 'no-valid-result', modelName: 'Test model' }, true)} zh />)
  expect(screen.getByText(/^已完成云端 AI 评估 · Test model · /)).toBeInTheDocument()
  expect(screen.queryByText(/未返回/)).not.toBeInTheDocument()
})

it('names the gateway failures an operator can act on', () => {
  expect(cloudFailureReason(new Error('AiCommerceRequestError: There are not enough available AI credits.'))).toBe('insufficient-credits')
  expect(cloudFailureReason(new Error('Please sign in to Member Center first.'))).toBe('sign-in-required')
  expect(cloudFailureReason(new Error('offline'))).toBe('request-failed')
})
