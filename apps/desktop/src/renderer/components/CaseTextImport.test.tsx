import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { expect, it, vi } from 'vitest'
import { CaseTextImport } from './CaseTextImport'
import type { ImportCaseTextBatchResult } from '@shared'

const saved: ImportCaseTextBatchResult = { created: 4, duplicates: 0, failed: 0, remainingText: '', reviewIds: [] }
const submit = (text: string) => {
  fireEvent.change(screen.getByRole('textbox'), { target: { value: text } })
  fireEvent.submit(screen.getByRole('form'))
}
it('submits the entire unformatted batch once and keeps the single input flow', async () => {
  const onImport = vi.fn().mockResolvedValue(saved)
  render(<CaseTextImport cases={[]} onImport={onImport} onRefresh={async () => {}} />)
  const text = 'Javaの案件があります。別案件はAWSでフル在宅です。'
  expect(screen.getAllByRole('textbox')).toHaveLength(1)
  expect(screen.getAllByRole('button')).toHaveLength(1)
  submit(text)
  await screen.findByRole('status')
  expect(onImport).toHaveBeenCalledExactlyOnceWith({ text })
  expect(screen.getByRole('textbox')).toHaveValue('')
  expect(screen.getByRole('status')).toHaveTextContent('4件を追加')
})
it('retains all input after an AI failure and only failed content after a partial save', async () => {
  const onImport = vi.fn().mockRejectedValueOnce(new Error('offline')).mockResolvedValue({ ...saved, created: 3, failed: 1, remainingText: 'AWS案件の本文' })
  render(<CaseTextImport cases={[]} onImport={onImport} onRefresh={async () => {}} />)
  submit('自由形式の案件本文全体')
  await screen.findByRole('alert')
  expect(screen.getByRole('textbox')).toHaveValue('自由形式の案件本文全体')
  expect(screen.getByRole('alert')).toHaveTextContent('保存せず入力を保持')
  fireEvent.submit(screen.getByRole('form'))
  await waitFor(() => expect(screen.getByRole('textbox')).toHaveValue('AWS案件の本文'))
})
it('prevents duplicate submissions while AI is running', async () => {
  let finish!: (result: ImportCaseTextBatchResult) => void
  const onImport = vi.fn(() => new Promise<ImportCaseTextBatchResult>(resolve => { finish = resolve }))
  render(<CaseTextImport cases={[]} onImport={onImport} onRefresh={async () => {}} />)
  submit('形式が決まっていない案件本文')
  fireEvent.submit(screen.getByRole('form'))
  expect(onImport).toHaveBeenCalledOnce()
  finish(saved)
  await waitFor(() => expect(screen.getByRole('textbox')).toBeEnabled())
})
