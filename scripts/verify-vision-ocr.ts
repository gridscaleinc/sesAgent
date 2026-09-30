import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { MacNaturalLanguageNerClient, MacVisionOcrClient } from '@local-ai'

// Synthetic fixture only: an optional PDF path may be passed, otherwise one is rendered with the
// macOS-native cupsfilter (CUPS text-to-PDF) into a private temporary directory.
async function loadFixture(): Promise<Buffer> {
  if (process.argv[2]) return readFile(process.argv[2])
  const directory = await mkdtemp(join(tmpdir(), 'ses-vision-ocr-fixture-'))
  try {
    const textPath = join(directory, 'synthetic-resume.txt')
    await writeFile(textPath, 'Synthetic resume for OCR verification\nTEL: 090-1234-5678\nSkills: Java / SQL / AWS\n', 'utf8')
    const pdf = execFileSync('/usr/sbin/cupsfilter', ['-i', 'text/plain', '-m', 'application/pdf', textPath], {
      stdio: ['ignore', 'pipe', 'ignore'],
      maxBuffer: 16 * 1024 * 1024
    })
    assert.equal(pdf.subarray(0, 5).toString('latin1'), '%PDF-', 'cupsfilter did not produce a PDF fixture')
    return pdf
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
}

const bytes = await loadFixture()
const client = new MacVisionOcrClient({
  executablePath: resolve('build/native/macos/ses-vision-ocr'),
  timeoutMs: 30_000
})
const result = await client.ocrPdf(bytes)
const text = result.pages.flatMap((page) => page.textBlocks.map((block) => block.text)).join('\n')
assert.match(text, /090-1234-5678/u)
assert.equal(result.networkAccess, false)
assert.equal(result.coverage.signatureDetection, 'human-review-required')
const ner = await new MacNaturalLanguageNerClient(resolve('build/native/macos/ses-vision-ocr')).detectNames(
  'Tim Cook met Satya Nadella in Tokyo.'
)
assert.equal(
  ner.entities.some((entity) => entity.text === 'Tim Cook'),
  true
)

process.stdout.write(
  `${JSON.stringify({
    engine: result.engine,
    pages: result.pages.length,
    textBlocks: result.pages.reduce((count, page) => count + page.textBlocks.length, 0),
    networkAccess: result.networkAccess,
    signatureDetection: result.coverage.signatureDetection,
    nameEntities: ner.entities.map((entity) => entity.text)
  })}\n`
)
