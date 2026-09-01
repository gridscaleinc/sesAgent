import { readFile } from 'node:fs/promises'
import { basename } from 'node:path'
import { BrowserWindow, dialog, ipcMain, type OpenDialogOptions } from 'electron'
import { ipcChannels, type AtsCsvImportItemResult, type ImportAtsCsvCandidatesResult } from '@shared'
import { atsCsvToCandidateTexts, decodeCsvBytes } from '../ats-csv'
import { importPastedCandidateText } from '../business-text-intake'
import { assertTrustedSender, type MainIpcContext } from './context'

/**
 * ATS CSV import: one candidate draft per row through the pasted-person-text
 * path. Rows are processed one by one so a bad row never aborts the file, and
 * the result carries counts and outcomes only - no cell values.
 */
export function registerAtsImportHandlers(context: MainIpcContext) {
  const { repository, fileVault, localNer } = context
  ipcMain.handle(ipcChannels.importAtsCsvCandidates, async (event): Promise<ImportAtsCsvCandidatesResult> => {
    assertTrustedSender(event)
    const owner = BrowserWindow.fromWebContents(event.sender)
    const options: OpenDialogOptions = {
      title: 'ATS CSV を選択',
      buttonLabel: '安全に取り込む',
      properties: ['openFile', 'dontAddToRecent'],
      filters: [{ name: 'ATS CSV', extensions: ['csv', 'txt'] }]
    }
    const selection = owner ? await dialog.showOpenDialog(owner, options) : await dialog.showOpenDialog(options)
    const path = selection.filePaths[0]
    if (selection.canceled || !path) {
      return { cancelled: true, fileName: null, rowCount: 0, importedCount: 0, duplicateCount: 0, skippedCount: 0, failedCount: 0, items: [] }
    }
    const bytes = await readFile(path)
    if (bytes.length > 5 * 1024 * 1024) throw new Error('CSV は 5MB までです。')
    const { text } = decodeCsvBytes(bytes)
    const { rows, skipped } = atsCsvToCandidateTexts(text)
    const items: AtsCsvImportItemResult[] = []
    for (const row of rows) {
      try {
        const imported = await importPastedCandidateText({ repository, fileVault, localNer }, row.text)
        items.push({ row: row.row, outcome: imported.outcome, documentId: imported.review.documentId })
      } catch (error) {
        // Row numbers only: the failure log never carries a cell value.
        console.warn('[ats-csv-import-row-failed]', { row: row.row, reason: error instanceof Error ? error.name : 'unknown' })
        items.push({ row: row.row, outcome: 'failed', documentId: null })
      }
    }
    return {
      cancelled: false,
      fileName: basename(path),
      rowCount: rows.length,
      importedCount: items.filter((item) => item.outcome === 'created').length,
      duplicateCount: items.filter((item) => item.outcome === 'existing-review' || item.outcome === 'already-imported' || item.outcome === 'archived').length,
      skippedCount: skipped,
      failedCount: items.filter((item) => item.outcome === 'failed').length,
      items
    }
  })
}
