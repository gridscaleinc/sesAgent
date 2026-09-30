import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { expect, it, vi } from 'vitest'
import { CaseTextImport } from './CaseTextImport'
import type { ImportCaseTextBatchResult, JobCaseReviewSnapshot } from '@shared'

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
  const onImport = vi
    .fn()
    .mockRejectedValueOnce(new Error('offline'))
    .mockResolvedValue({ ...saved, created: 3, failed: 1, remainingText: 'AWS案件の本文' })
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
  const onImport = vi.fn(
    () =>
      new Promise<ImportCaseTextBatchResult>((resolve) => {
        finish = resolve
      })
  )
  render(<CaseTextImport cases={[]} onImport={onImport} onRefresh={async () => {}} />)
  submit('形式が決まっていない案件本文')
  fireEvent.submit(screen.getByRole('form'))
  expect(onImport).toHaveBeenCalledOnce()
  finish(saved)
  await waitFor(() => expect(screen.getByRole('textbox')).toBeEnabled())
})
it('tells HR when a pasted passage was a personnel introduction rather than a case', async () => {
  const onImport = vi.fn().mockResolvedValue({ ...saved, created: 0, skippedPersonnel: 1 })
  render(<CaseTextImport cases={[]} onImport={onImport} onRefresh={async () => {}} />)
  submit('💎要員営業 即日～ 💎要件定義～ Leader経験豊富 全出勤可')
  expect(await screen.findByRole('status')).toHaveTextContent('要員紹介（要員営業）が1件あり、案件ではないため取り込んでいません')
})
const review = (reviewId: string, title: string) =>
  ({ reviewId, redactedSubject: title, fields: [{ key: 'title', value: title }] }) as unknown as JobCaseReviewSnapshot
it('adds new cases to my cases and offers finding people or opening each one', async () => {
  const ids = ['c1', 'c2']
  const onImport = vi.fn().mockResolvedValue({ ...saved, created: 2, duplicates: 1, reviewIds: [...ids, 'old'], createdReviewIds: ids })
  const onAddToWorking = vi.fn(async () => undefined)
  const onFindPeople = vi.fn(),
    onOpenCase = vi.fn()
  const imported = vi.fn()
  window.addEventListener('ses-cases-imported', imported)
  render(
    <CaseTextImport
      cases={[review('c1', 'Java案件'), review('c2', 'AWS案件')]}
      onImport={onImport}
      onRefresh={async () => {}}
      onAddToWorking={onAddToWorking}
      onFindPeople={onFindPeople}
      onOpenCase={onOpenCase}
      onShowInList={vi.fn()}
    />
  )
  submit('Java案件とAWS案件')
  const list = within(await screen.findByRole('list', { name: '追加した案件' }))
  expect(onAddToWorking.mock.calls).toEqual([['c1'], ['c2']])
  expect(list.getAllByRole('listitem').map((item) => item.firstChild?.textContent)).toEqual(['Java案件', 'AWS案件'])
  fireEvent.click(list.getByRole('button', { name: '要員を探す：AWS案件' }))
  expect(onFindPeople).toHaveBeenCalledWith('c2')
  fireEvent.click(list.getByRole('button', { name: '表示：Java案件' }))
  expect(onOpenCase).toHaveBeenCalledWith('c1')
  expect(screen.queryByRole('button', { name: /一覧ですべて見る/u })).not.toBeInTheDocument()
  await waitFor(() => expect(imported).toHaveBeenCalledOnce())
  expect((imported.mock.calls[0]![0] as CustomEvent).detail).toEqual({ reviewIds: ids, working: true })
  window.removeEventListener('ses-cases-imported', imported)
})
it('lists the first three new cases, links to the rest in the list and reports cases it could not add to my cases', async () => {
  const ids = ['c1', 'c2', 'c3', 'c4', 'c5']
  const onImport = vi.fn().mockResolvedValue({ ...saved, created: 5, reviewIds: ids, createdReviewIds: ids })
  const onShowInList = vi.fn()
  const onAddToWorking = vi.fn(async (id: string) => {
    if (id === 'c5') throw new Error('offline')
  })
  render(
    <CaseTextImport
      cases={[]}
      onImport={onImport}
      onRefresh={async () => {}}
      onAddToWorking={onAddToWorking}
      onFindPeople={vi.fn()}
      onShowInList={onShowInList}
    />
  )
  submit('五つの案件')
  const list = await screen.findByRole('list', { name: '追加した案件' })
  expect(within(list).getAllByRole('listitem')).toHaveLength(3)
  fireEvent.click(screen.getByRole('button', { name: '一覧ですべて見る（5）' }))
  expect(onShowInList).toHaveBeenCalledOnce()
  expect(screen.getByRole('alert')).toHaveTextContent('担当案件に追加できませんでした')
})
it('sends personnel introductions to the personnel import', async () => {
  const onImport = vi.fn().mockResolvedValue({ ...saved, created: 0, skippedPersonnel: 2 })
  const onOpenPersonImport = vi.fn()
  render(<CaseTextImport cases={[]} onImport={onImport} onRefresh={async () => {}} onOpenPersonImport={onOpenPersonImport} />)
  submit('要員営業')
  fireEvent.click(await screen.findByRole('button', { name: '要員として取り込む' }))
  expect(onOpenPersonImport).toHaveBeenCalledOnce()
})
