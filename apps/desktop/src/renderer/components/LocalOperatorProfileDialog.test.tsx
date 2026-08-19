import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { LocalOperatorProfile } from '@shared'
import { LocalOperatorProfileDialog } from './LocalOperatorProfileDialog'

const unconfigured: LocalOperatorProfile = {
  version: 'local-operator-profile-v1',
  operatorId: '11111111-1111-4111-8111-111111111111',
  displayName: '本機ユーザー',
  roleLabel: 'プロフィール未設定',
  configured: false,
  revision: null,
  updatedAt: null,
  cloudEligible: false
}

describe('LocalOperatorProfileDialog', () => {
  it('stores only a local display identity and closes after saving', async () => {
    const onClose = vi.fn()
    const saved: LocalOperatorProfile = {
      ...unconfigured,
      displayName: '佐藤 美咲',
      roleLabel: 'SES営業担当',
      configured: true,
      revision: 1,
      updatedAt: '2026-07-20T02:00:00.000Z'
    }
    const onSave = vi.fn().mockResolvedValue(saved)
    render(<LocalOperatorProfileDialog onClose={onClose} onSave={onSave} profile={unconfigured} />)

    expect(screen.getByText(/現在の新規操作は中立名「本機ユーザー」/)).toBeInTheDocument()
    expect(screen.getByText(/プロフィールは送信対象外/)).toBeInTheDocument()
    fireEvent.change(screen.getByLabelText('表示名'), { target: { value: ' 佐藤 美咲 ' } })
    fireEvent.change(screen.getByLabelText('役割'), { target: { value: 'SES営業担当' } })
    fireEvent.click(screen.getByRole('button', { name: '暗号化して保存' }))

    await waitFor(() => expect(onSave).toHaveBeenCalledWith({
      displayName: '佐藤 美咲',
      roleLabel: 'SES営業担当',
      expectedRevision: null
    }))
    expect(onClose).toHaveBeenCalled()
  })

  it('uses optimistic revision when updating a configured profile', async () => {
    const configured: LocalOperatorProfile = {
      ...unconfigured,
      displayName: '田中 翔',
      roleLabel: '採用担当',
      configured: true,
      revision: 3,
      updatedAt: '2026-07-20T02:00:00.000Z'
    }
    const onSave = vi.fn().mockResolvedValue({ ...configured, revision: 4 })
    render(<LocalOperatorProfileDialog onClose={vi.fn()} onSave={onSave} profile={configured} />)
    fireEvent.click(screen.getByRole('button', { name: '暗号化して保存' }))
    await waitFor(() => expect(onSave).toHaveBeenCalledWith({
      displayName: '田中 翔',
      roleLabel: '採用担当',
      expectedRevision: 3
    }))
  })
})
