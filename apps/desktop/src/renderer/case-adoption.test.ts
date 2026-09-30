import { expect, it, vi } from 'vitest'
import { joinCreatedCases, revealCreatedCases } from './case-adoption'

it('adds each created case to my cases once and reports whether all of them joined', async () => {
  const add = vi.fn(async () => undefined)
  expect(await joinCreatedCases(['a', 'b', 'a'], add)).toBe(true)
  expect(add.mock.calls).toEqual([['a'], ['b']])
  expect(await joinCreatedCases(['c'], async () => Promise.reject(new Error('ended')))).toBe(false)
  expect(await joinCreatedCases([], add)).toBe(false)
})

it('announces created cases to the case list, and nothing when none were created', () => {
  const listener = vi.fn()
  window.addEventListener('ses-cases-imported', listener)
  revealCreatedCases([], true)
  expect(listener).not.toHaveBeenCalled()
  revealCreatedCases(['a'], true)
  expect((listener.mock.calls[0]![0] as CustomEvent).detail).toEqual({ reviewIds: ['a'], working: true })
  window.removeEventListener('ses-cases-imported', listener)
})
