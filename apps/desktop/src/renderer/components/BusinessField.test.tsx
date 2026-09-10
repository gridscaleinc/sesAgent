import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { expect, it, vi } from 'vitest'
import { BusinessField } from './BusinessField'
it('saves on blur once, retains failed input and retries without losing the baseline', async () => {
  let reject: (error: Error) => void = () => {}
  const save = vi.fn().mockImplementationOnce(() => new Promise((_, no) => { reject = no })).mockResolvedValue({ version: 2 })
  Object.defineProperty(window, 'sesAgent', { configurable: true, value: { saveBusinessField: save } })
  render(<BusinessField kind="case" id="a" version={1} field="rate" value="60万" label="単価" />)
  fireEvent.click(screen.getByRole('button', { name: '編集 単価' }))
  fireEvent.change(screen.getByRole('textbox'), { target: { value: '70万' } })
  fireEvent.blur(screen.getByRole('textbox'))
  fireEvent.blur(screen.getByRole('textbox'))
  expect(save).toHaveBeenCalledTimes(1)
  await act(async () => reject(new Error('offline')))
  expect(screen.getByRole('textbox')).toHaveValue('70万')
  fireEvent.click(screen.getByRole('button', { name: '再保存' }))
  await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('保存済み'))
  expect(save).toHaveBeenLastCalledWith(expect.objectContaining({ previousValue: '60万', value: '70万', version: 1 }))
})
it('never saves an old object draft into a newly selected object', async () => {
  const save = vi.fn().mockResolvedValue({ version: 2 })
  Object.defineProperty(window, 'sesAgent', { configurable: true, value: { saveBusinessField: save } })
  const view = render(<BusinessField kind="case" id="one" version={1} field="rate" value="60万" label="単価" />)
  fireEvent.click(screen.getByRole('button', { name: '編集 単価' }))
  fireEvent.change(screen.getByRole('textbox'), { target: { value: '70万' } })
  view.rerender(<BusinessField kind="case" id="two" version={1} field="rate" value="60万" label="単価" />)
  expect(screen.queryByRole('textbox')).not.toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: '編集 単価' }))
  expect(screen.getByRole('textbox')).toHaveValue('60万')
  fireEvent.blur(screen.getByRole('textbox'))
  expect(save).not.toHaveBeenCalled()
})
