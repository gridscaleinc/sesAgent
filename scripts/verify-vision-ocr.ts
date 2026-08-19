import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { MacNaturalLanguageNerClient, MacVisionOcrClient } from '@local-ai'

const fixturePath = process.argv[2] ?? '/tmp/ses-agent-ui-verification.pdf'
const bytes = await readFile(fixturePath)
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
assert.equal(ner.entities.some((entity) => entity.text === 'Tim Cook'), true)

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
