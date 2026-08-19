import { app, BrowserWindow } from 'electron'
import { writeFile } from 'node:fs/promises'

app.commandLine.appendSwitch('disable-gpu')

async function verifyProposalPdf() {
  await app.whenReady()
  const window = new BrowserWindow({
    show: false,
    webPreferences: {
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      webSecurity: true
    }
  })
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))

  try {
    const html = `<!doctype html><html lang="ja"><head><meta charset="utf-8">
      <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'">
      <style>@page{size:A4;margin:16mm}body{font-family:-apple-system,"Hiragino Sans","Yu Gothic",sans-serif;color:#1f2937}h1{color:#255da8}.field{padding:12px;border:1px solid #dce3eb}</style>
      </head><body><h1>匿名候補者プロフィール</h1><div class="field">主要スキル：Java / AWS</div><p>個人識別情報・原本履歴書を含みません。</p></body></html>`
    await window.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`)
    const pdf = await window.webContents.printToPDF({ printBackground: true, pageSize: 'A4' })
    const raw = pdf.toString('latin1')
    if (pdf.subarray(0, 4).toString('ascii') !== '%PDF') throw new Error('Chromium did not return a PDF header.')
    if (pdf.length < 5_000) throw new Error('Generated proposal PDF is unexpectedly small.')
    if (!/\/Type\s*\/Page\b/u.test(raw)) throw new Error('Generated proposal PDF does not contain a page object.')
    const result = JSON.stringify({ pdfHeader: true, pages: 1, bytes: pdf.length, networkAccess: false })
    if (process.env.SES_PROPOSAL_PDF_VERIFY_OUTPUT) {
      await writeFile(process.env.SES_PROPOSAL_PDF_VERIFY_OUTPUT, `${result}\n`, { mode: 0o600 })
    }
  } finally {
    window.destroy()
  }
}

verifyProposalPdf()
  .then(() => app.quit())
  .catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.stack : String(error)}\n`)
    app.exit(1)
  })
