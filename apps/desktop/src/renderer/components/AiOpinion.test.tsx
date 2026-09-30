import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, expect, it } from 'vitest'
import { AiOpinion } from './AiOpinion'
afterEach(cleanup)
it('shows the model wording under an explicit unverified label', () => {
  render(<AiOpinion opinion={{ fit: 'strong', reason: 'Java の決済経験が案件と一致。', gaps: ['AWS'], confirm: ['稼働開始日'] }} zh />)
  expect(screen.getByText('AI 意见，仅供参考，未核实')).toBeVisible()
  expect(screen.getByText(/AI 判断的适合度：较强/)).toBeVisible()
  expect(screen.getByText('Java の決済経験が案件と一致。')).toBeVisible()
  expect(screen.getByText(/AWS/)).toBeVisible()
  expect(screen.getByText(/稼働開始日/)).toBeVisible()
  expect(screen.getByText(/不影响上面的匹配结论/)).toBeVisible()
})
it('renders nothing for records saved before opinions were kept, or with nothing written', () => {
  const { container, rerender } = render(<AiOpinion zh />)
  expect(container).toBeEmptyDOMElement()
  rerender(<AiOpinion opinion={{ fit: 'possible', reason: '', gaps: [], confirm: [] }} zh />)
  expect(container).toBeEmptyDOMElement()
})
