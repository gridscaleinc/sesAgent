import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { expect, it, vi } from 'vitest'
import type { AiCommerceMembershipState, LocalOperatorProfile } from '@shared'
import { AccountMenu } from './AccountMenu'

const operator: LocalOperatorProfile = {
  version: 'local-operator-profile-v1',
  operatorId: 'op-1',
  displayName: '高橋 遥',
  roleLabel: 'SES営業担当',
  configured: true,
  revision: 1,
  updatedAt: null,
  cloudEligible: false
}
const member = (change: Partial<AiCommerceMembershipState> = {}): AiCommerceMembershipState => ({
  configuration: 'ready',
  connection: 'not-connected',
  productCode: null,
  billingMode: null,
  memberDisplayName: null,
  accountId: null,
  accountAiTokenExpiresAt: null,
  wallet: null,
  capabilities: [],
  refreshedAt: null,
  ...change
})
const handlers = () => ({
  onEditProfile: vi.fn(),
  onOpenSettings: vi.fn(),
  onOpenAiMember: vi.fn(),
  onAddCredits: vi.fn().mockResolvedValue({ opened: true }),
  onSignIn: vi.fn().mockResolvedValue(member({ connection: 'authorizing' })),
  onSignOut: vi.fn().mockResolvedValue(member()),
  onOpenVendorSite: vi.fn().mockResolvedValue({ opened: true })
})
const open = () => {
  fireEvent.click(screen.getByRole('button', { name: /^アカウント：高橋 遥/u }))
  return screen.getByRole('dialog', { name: 'アカウント' })
}

it('shows who is operating at the top right and signs in to the AI member from the account menu', async () => {
  const on = handlers()
  render(<AccountMenu aiMember={member()} operator={operator} {...on} />)
  expect(screen.getByRole('button', { name: 'アカウント：高橋 遥（AI会員 未ログイン）' })).toHaveTextContent('高橋 遥')
  const panel = open()
  expect(within(panel).getByText('SES営業担当')).toBeInTheDocument()
  expect(within(panel).getByText('未ログイン')).toBeInTheDocument()
  expect(within(panel).queryByRole('button', { name: 'ログアウト（AI会員）' })).not.toBeInTheDocument()
  fireEvent.click(within(panel).getByRole('button', { name: 'ログイン（AI会員）' }))
  await waitFor(() => expect(on.onSignIn).toHaveBeenCalledOnce())
  fireEvent.click(within(panel).getByRole('button', { name: 'プロフィールを編集' }))
  expect(on.onEditProfile).toHaveBeenCalledOnce()
  expect(screen.queryByRole('dialog', { name: 'アカウント' })).not.toBeInTheDocument()
})

it('gathers the balance, adding credits, settings and sign-out for a signed-in member', async () => {
  const on = handlers()
  render(
    <AccountMenu
      aiMember={member({ connection: 'connected', memberDisplayName: 'gridscale', wallet: { balanceCredits: 1280, reservedCredits: 40 } })}
      operator={operator}
      {...on}
    />
  )
  let panel = open()
  expect(within(panel).getByText('1,240 クレジット')).toBeInTheDocument()
  fireEvent.click(within(panel).getByRole('button', { name: '残高を確認' }))
  expect(on.onOpenAiMember).toHaveBeenCalledOnce()
  panel = open()
  fireEvent.click(within(panel).getByRole('button', { name: 'クレジットを追加' }))
  await waitFor(() => expect(on.onAddCredits).toHaveBeenCalledOnce())
  panel = open()
  fireEvent.click(within(panel).getByRole('button', { name: '設定' }))
  expect(on.onOpenSettings).toHaveBeenCalledOnce()
  panel = open()
  fireEvent.click(within(panel).getByRole('button', { name: 'ログアウト（AI会員）' }))
  await waitFor(() => expect(on.onSignOut).toHaveBeenCalledOnce())
})

it('links to Gridscale and AppShelf, and closes on Escape', async () => {
  const on = handlers()
  render(<AccountMenu aiMember={member()} operator={operator} {...on} />)
  const panel = open()
  fireEvent.click(within(panel).getByRole('button', { name: /www\.gridscale\.com/u }))
  await waitFor(() => expect(on.onOpenVendorSite).toHaveBeenCalledWith('gridscale'))
  fireEvent.keyDown(open(), { key: 'Escape' })
  expect(screen.queryByRole('dialog', { name: 'アカウント' })).not.toBeInTheDocument()
  // Also when focus is not inside the menu (still on the trigger).
  open()
  fireEvent.keyDown(document.body, { key: 'Escape' })
  expect(screen.queryByRole('dialog', { name: 'アカウント' })).not.toBeInTheDocument()
  fireEvent.click(within(open()).getByRole('button', { name: /AppShelf/u }))
  await waitFor(() => expect(on.onOpenVendorSite).toHaveBeenCalledWith('appshelf'))
})

it('fetches the current balance when opened with an unknown or old one, not with a fresh one', async () => {
  const on = handlers()
  const onRefreshAiMember = vi.fn().mockResolvedValue(undefined)
  const { rerender } = render(
    <AccountMenu aiMember={member({ connection: 'connected' })} operator={operator} {...on} onRefreshAiMember={onRefreshAiMember} />
  )
  expect(within(open()).getByText('読み込み中…')).toBeInTheDocument()
  await waitFor(() => expect(onRefreshAiMember).toHaveBeenCalledOnce())
  fireEvent.keyDown(screen.getByRole('dialog', { name: 'アカウント' }), { key: 'Escape' })
  rerender(
    <AccountMenu
      aiMember={member({
        connection: 'connected',
        wallet: { balanceCredits: 10, reservedCredits: 0 },
        refreshedAt: new Date().toISOString()
      })}
      operator={operator}
      {...on}
      onRefreshAiMember={onRefreshAiMember}
    />
  )
  open()
  expect(onRefreshAiMember).toHaveBeenCalledOnce()
})
