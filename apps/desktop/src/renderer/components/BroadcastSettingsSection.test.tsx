import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { builtInBroadcastTemplate, type BroadcastTemplate } from '@shared'
import { UiLocaleProvider } from '../i18n'
import { BroadcastSettingsSection, type BroadcastSettingsActions } from './BroadcastSettingsSection'

const second: BroadcastTemplate = { ...builtInBroadcastTemplate(), id: '55555555-5555-4555-8555-555555555555', name: '短文' }

function actionsWith(templates: BroadcastTemplate[], overrides: Partial<BroadcastSettingsActions> = {}): BroadcastSettingsActions {
  return {
    loadWorkspace: vi.fn().mockResolvedValue({ queue: [], templates }),
    createTemplate: vi.fn().mockResolvedValue(templates),
    updateTemplate: vi.fn().mockResolvedValue(templates),
    deleteTemplate: vi.fn().mockResolvedValue(templates),
    ...overrides
  }
}

/** waitFor only retries when the callback throws, so a missing node must throw. */
async function previewText(): Promise<string> {
  return waitFor(() => {
    const preview = document.querySelector('.broadcast-preview pre')
    if (!preview?.textContent) throw new Error('preview not rendered yet')
    return preview.textContent
  })
}

function renderSection(actions: BroadcastSettingsActions) {
  render(<UiLocaleProvider locale="zh-CN"><BroadcastSettingsSection actions={actions} /></UiLocaleProvider>)
}

describe('BroadcastSettingsSection', () => {
  it('previews the selected template with the real generator', async () => {
    renderSection(actionsWith([builtInBroadcastTemplate()]))
    const preview = await previewText()
    expect(preview).toContain('【案件】Java 業務システム改修')
    expect(preview).toContain('単価：～65万円')
    expect(preview).toContain('ご興味のある方はこのグループでご連絡ください。')
  })

  it('adds a field line and saves the whole template', async () => {
    const actions = actionsWith([builtInBroadcastTemplate()])
    renderSection(actions)
    const before = (await screen.findAllByRole('combobox', { name: '案件字段' })).length

    fireEvent.click(screen.getByRole('button', { name: /添加字段行/u }))
    expect(screen.getAllByRole('combobox', { name: '案件字段' })).toHaveLength(before + 1)

    fireEvent.click(screen.getByRole('button', { name: '保存模板' }))
    await waitFor(() => expect(actions.updateTemplate).toHaveBeenCalledTimes(1))
    expect(vi.mocked(actions.updateTemplate).mock.calls[0][0].lines).toHaveLength(before + 1)
  })

  it('adds a fixed-text line that carries both languages', async () => {
    const actions = actionsWith([builtInBroadcastTemplate()])
    renderSection(actions)
    fireEvent.click(await screen.findByRole('button', { name: /添加固定文本行/u }))
    fireEvent.change(screen.getByRole('textbox', { name: '固定文本' }), { target: { value: '※弊社プロパー限定' } })

    fireEvent.click(screen.getByRole('button', { name: '保存模板' }))
    await waitFor(() => expect(actions.updateTemplate).toHaveBeenCalledTimes(1))
    expect(vi.mocked(actions.updateTemplate).mock.calls[0][0].lines.at(-1))
      .toEqual({ kind: 'text', textJa: '※弊社プロパー限定', textZh: '', on: true })
  })

  it('drops a switched-off line out of the preview without deleting it', async () => {
    renderSection(actionsWith([builtInBroadcastTemplate()]))
    expect(await previewText()).toContain('必須：Java、Spring Boot')
    const toggles = screen.getAllByRole('checkbox', { name: '显示该行' })
    fireEvent.click(toggles[0])
    expect(document.querySelector('.broadcast-preview pre')!.textContent).not.toContain('必須：Java、Spring Boot')
    expect(screen.getAllByRole('checkbox', { name: '显示该行' })).toHaveLength(toggles.length)
  })

  it('offers no way to delete the only remaining template', async () => {
    renderSection(actionsWith([builtInBroadcastTemplate()]))
    expect(await screen.findByRole('button', { name: '删除模板' })).toBeDisabled()
  })

  it('deletes a template once a second one exists', async () => {
    const actions = actionsWith([builtInBroadcastTemplate(), second], { deleteTemplate: vi.fn().mockResolvedValue([second]) })
    renderSection(actions)
    fireEvent.click(await screen.findByRole('button', { name: /短文/u }))
    fireEvent.click(screen.getByRole('button', { name: '删除模板' }))
    await waitFor(() => expect(actions.deleteTemplate).toHaveBeenCalledWith({ id: second.id }))
  })

  it('never offers the chain or the payment terms as a field line', async () => {
    renderSection(actionsWith([builtInBroadcastTemplate()]))
    const select = (await screen.findAllByRole('combobox', { name: '案件字段' }))[0]
    const options = [...select.querySelectorAll('option')].map((option) => option.value)
    expect(options).not.toContain('contract_chain')
    expect(options).not.toContain('payment_terms')
  })

  it('offers nothing about where a message goes - that is the operator\'s own business', async () => {
    renderSection(actionsWith([builtInBroadcastTemplate()]))
    await screen.findByRole('button', { name: '保存模板' })
    expect(screen.queryByText('营业群')).toBeNull()
    expect(screen.queryByRole('button', { name: /添加营业群/u })).toBeNull()
    expect(screen.queryByRole('textbox', { name: /技术标签/u })).toBeNull()
  })
})
