import { StrictMode, type PropsWithChildren } from 'react'
import { act, cleanup, renderHook, waitFor } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { useIntroductionExperience } from './use-introduction-experience'
const input = { kind: 'case' as const, id: 'case', version: 1, lang: 'zh' as const, style: 'brief' as const }
const wrapper = ({ children }: PropsWithChildren) => <StrictMode>{children}</StrictMode>
afterEach(cleanup)
function setup() {
  let finish: (value: any) => void = () => {}
  const begin = vi.fn(async () => ({ text: '初始介绍', experienceRunId: 'local', hasExperience: true }))
  const generate = vi.fn(
    () =>
      new Promise<any>((resolve) => {
        finish = resolve
      })
  )
  Object.defineProperty(window, 'sesAgent', {
    configurable: true,
    value: { beginIntroductionDraft: begin, regenerateIntroduction: generate }
  })
  const hook = renderHook(() => useIntroductionExperience('key', input, '初始介绍', true), { wrapper })
  return { hook, begin, generate, finish: () => finish({ text: '采用经验后的介绍', experienceRunId: 'learned' }) }
}
it('applies learned wording once under StrictMode and binds the generated run', async () => {
  const { hook, begin, generate, finish } = setup()
  await waitFor(() => expect(generate).toHaveBeenCalledTimes(1))
  expect(begin).toHaveBeenCalledTimes(1)
  await act(async () => finish())
  expect(hook.result.current.text).toBe('采用经验后的介绍')
  expect(await hook.result.current.runId()).toBe('learned')
})
it('never replaces a draft after the HR starts editing', async () => {
  const { hook, generate, finish } = setup()
  await waitFor(() => expect(generate).toHaveBeenCalledTimes(1))
  act(() => hook.result.current.markEdited())
  await act(async () => finish())
  expect(hook.result.current.text).toBe('初始介绍')
  expect(await hook.result.current.runId()).toBe('local')
})
it('freezes provenance when copying before background generation completes', async () => {
  const { hook, generate, finish } = setup()
  await waitFor(() => expect(generate).toHaveBeenCalledTimes(1))
  expect(await hook.result.current.runId()).toBe('local')
  await act(async () => finish())
  expect(hook.result.current.text).toBe('初始介绍')
})
it('does not replace a manually regenerated draft with an earlier background result', async () => {
  const { hook, generate, finish } = setup()
  await waitFor(() => expect(generate).toHaveBeenCalledTimes(1))
  act(() => hook.result.current.replace({ text: '主动重新生成', experienceRunId: 'manual' }))
  await act(async () => finish())
  expect(hook.result.current.text).toBe('主动重新生成')
  expect(await hook.result.current.runId()).toBe('manual')
})
