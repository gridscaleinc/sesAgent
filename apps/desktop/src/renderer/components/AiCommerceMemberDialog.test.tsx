import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { AiCommerceMembershipState } from '@shared'
import { UiLocaleProvider } from '../i18n'
import { AiCommerceMemberDialog } from './AiCommerceMemberDialog'

const connectedState: AiCommerceMembershipState = {
  configuration: 'ready',
  connection: 'connected',
  productCode: 'ses-agent-pro',
  billingMode: 'subscription',
  memberDisplayName: '営業担当',
  accountId: 'acct-1',
  accountAiTokenExpiresAt: '2026-12-21T00:00:00.000Z',
  wallet: { balanceCredits: 1200, reservedCredits: 200 },
  capabilities: [{ alias: 'openai-chat', displayName: 'OpenAI Chat', modality: 'text' }],
  refreshedAt: '2026-07-21T00:00:00.000Z'
}

const readyPrivacy = {
  policyVersion: 'cloud-redaction-v2' as const,
  cloudGateway: 'enforced' as const,
  localAi: 'vision-ocr-and-pii-active' as const,
  qualityGate: {
    status: 'passed' as const, datasetVersion: 'ses-privacy-regression-v1' as const, syntheticOnly: true as const,
    caseCount: 28, identifierRecall: 1, redactionPrecision: 1, residualLeakCount: 0,
    safeCaseFalsePositiveCount: 0, appleNerVerified: true, reportHash: 'a'.repeat(64), failureCodes: []
  },
  expertGate: {
    status: 'passed' as const, datasetVersion: 'ses-privacy-expert-dataset-v1' as const, humanLabeledDataset: true as const,
    sourceDocumentCount: 50, caseCount: 60, automaticPersonNameRecall: 0.93,
    postReviewIdentifierRecall: 1, redactionPrecision: 0.98,
    reviewedAt: '2026-08-17T00:00:00.000Z', evaluatedAt: '2026-08-17T01:00:00.000Z',
    reportHash: 'b'.repeat(64), attestationHash: 'c'.repeat(64),
    privacyImplementationSha256: 'd'.repeat(64), cloudEnforcementSha256: 'e'.repeat(64), failureCodes: []
  }
}

describe('AiCommerceMemberDialog', () => {
  it('submits content for a Main-owned redacted preview and native confirmation', async () => {
    const onSendPrompt = vi.fn().mockResolvedValue({
      requestId: 'sesai-12345678', aiRequestId: 'air-1', content: '脱敏済みの回答です。',
      usageCredits: 12, wallet: { balanceCredits: 1188, reservedCredits: 0 },
      removedIdentifierTypes: ['person_name'], billingModeUsed: 'subscription'
    })
    render(
      <AiCommerceMemberDialog
        callbackError={null}
        onClose={vi.fn()}
        onConnect={vi.fn()}
        onDisconnect={vi.fn()}
        onOpenMemberCenter={vi.fn().mockResolvedValue({ opened: true })}
        onRefresh={vi.fn()}
        onResetToken={vi.fn()}
        onSendPrompt={onSendPrompt}
        privacy={readyPrivacy}
        state={connectedState}
      />
    )

    expect(screen.getByText('1,000 credits')).toBeInTheDocument()
    const submit = screen.getByRole('button', { name: '脱敏プレビューを確認' })
    expect(submit).toBeDisabled()
    fireEvent.change(screen.getByLabelText('依頼内容'), { target: { value: '候補者の経験を短く要約してください。' } })
    expect(submit).toBeEnabled()
    fireEvent.click(submit)

    await waitFor(() => expect(onSendPrompt).toHaveBeenCalledWith({
      content: '候補者の経験を短く要約してください。'
    }))
    expect(await screen.findByText('脱敏済みの回答です。')).toBeInTheDocument()
  })

  it('removes Electron IPC details and localizes a blocking synthetic quality error', async () => {
    const onSendPrompt = vi.fn().mockRejectedValue(new Error(
      "Error invoking remote method 'aicommerce:execute-cloud-prompt': Error: ローカルのプライバシー品質ゲートを確認できないため、Cloud AI を停止しました。データ安全画面で状態を確認してください。"
    ))
    render(
      <UiLocaleProvider locale="zh-CN">
        <AiCommerceMemberDialog
          callbackError={null}
          onClose={vi.fn()}
          onConnect={vi.fn()}
          onDisconnect={vi.fn()}
          onOpenMemberCenter={vi.fn().mockResolvedValue({ opened: true })}
          onRefresh={vi.fn()}
          onResetToken={vi.fn()}
          onSendPrompt={onSendPrompt}
          privacy={readyPrivacy}
          state={connectedState}
        />
      </UiLocaleProvider>
    )

    fireEvent.change(screen.getByLabelText('依頼内容'), { target: { value: '匿名プロフィールを要約してください。' } })
    fireEvent.click(screen.getByRole('button', { name: '脱敏プレビューを確認' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('本机隐私质量检查未通过，云端 AI 已停止。请在“数据安全”中检查状态。')
    expect(screen.getByRole('alert')).not.toHaveTextContent('Error invoking remote method')
  })

  it('keeps Cloud AI available when only the optional expert evaluation is missing', () => {
    render(
      <AiCommerceMemberDialog
        callbackError={null}
        onClose={vi.fn()}
        onConnect={vi.fn()}
        onDisconnect={vi.fn()}
        onOpenMemberCenter={vi.fn().mockResolvedValue({ opened: true })}
        onRefresh={vi.fn()}
        onResetToken={vi.fn()}
        onSendPrompt={vi.fn()}
        privacy={{
          ...readyPrivacy,
          expertGate: {
            ...readyPrivacy.expertGate,
            status: 'not-verified', datasetVersion: null, attestationHash: null,
            failureCodes: ['expert:missing']
          }
        }}
        state={connectedState}
      />
    )

    fireEvent.change(screen.getByLabelText('依頼内容'), { target: { value: '匿名プロフィールを要約してください。' } })
    expect(screen.getByText('Cloud AI プライバシー門は有効です')).toBeInTheDocument()
    expect(screen.getByText(/日本語専門家評価は未完了ですが/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '脱敏プレビューを確認' })).toBeEnabled()
  })
})
