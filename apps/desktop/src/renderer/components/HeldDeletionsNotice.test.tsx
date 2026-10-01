import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { DesktopApi, HeldDeletion } from '@shared'
import { UiLocaleProvider } from '../i18n'
import { HeldDeletionsNotice } from './HeldDeletionsNotice'

const held: HeldDeletion = {
  id: '11111111-1111-4111-8111-111111111111',
  entityType: 'candidate',
  label: '山田太郎',
  reason: '这个人员还处于已进场，请先在跟进中记录退场或撤销进场，再删除。 / この要員は参画中です。',
  deletedAt: '2026-09-20T00:00:00.000Z'
}

describe('HeldDeletionsNotice', () => {
  const original = window.sesAgent
  afterEach(() => Object.defineProperty(window, 'sesAgent', { configurable: true, value: original }))

  it('asks HR to delete or keep what a restore brought back and could not delete again', async () => {
    const resolveHeldDeletion = vi.fn(async () => [])
    Object.defineProperty(window, 'sesAgent', {
      configurable: true,
      value: { ...original, listHeldDeletions: vi.fn(async () => [held]), resolveHeldDeletion } as unknown as DesktopApi
    })
    render(
      <UiLocaleProvider locale="zh-CN">
        <HeldDeletionsNotice />
      </UiLocaleProvider>
    )
    expect(await screen.findByText('人员 · 山田太郎')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '保留' }))
    await waitFor(() => expect(resolveHeldDeletion).toHaveBeenCalledWith({ id: held.id, action: 'keep' }))
    await waitFor(() => expect(screen.queryByText('人员 · 山田太郎')).not.toBeInTheDocument())
  })

  it('shows nothing when no deletion waits for a decision', async () => {
    Object.defineProperty(window, 'sesAgent', {
      configurable: true,
      value: { ...original, listHeldDeletions: vi.fn(async () => []) } as unknown as DesktopApi
    })
    const { container } = render(
      <UiLocaleProvider locale="zh-CN">
        <HeldDeletionsNotice />
      </UiLocaleProvider>
    )
    await waitFor(() => expect(container).toBeEmptyDOMElement())
  })
})
