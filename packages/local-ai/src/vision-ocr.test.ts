// @vitest-environment node
import type { DocumentIR } from '@parsers'
import {
  collectLocalPersonNameCandidates,
  createLocalAiRuntime,
  mergeLocalOcr,
  parseLocalHelperJson,
  mergeVisionOcr,
  nameDetectionResultSchema,
  visionOcrResultSchema,
  windowsOcrResultSchema
} from './vision-ocr'

const scannedDocument: DocumentIR = {
  version: 'document-ir-v1',
  documentId: 'df11b3fe-7ca6-4079-9558-c7b2331e9974',
  source: { name: 'scan.pdf', format: 'pdf', sha256: 'a'.repeat(64), size: 1024 },
  blocks: [],
  warnings: [{ code: 'PAGE_REQUIRES_OCR', message: 'OCR required', source: { page: 1 } }],
  requiresLocalOcr: true,
  statistics: { pages: 1, sheets: 0, blocks: 0, characters: 0 },
  security: { externalContentLoaded: false, macrosExecuted: false, rawFileCloudEligible: false }
}

describe('mergeVisionOcr', () => {
  it('adds page-linked OCR text and preserves fail-closed media review evidence', () => {
    const ocr = visionOcrResultSchema.parse({
      version: 'vision-ocr-v1',
      engine: 'apple-vision',
      networkAccess: false,
      pages: [
        {
          page: 1,
          width: 500,
          height: 700,
          textBlocks: [
            {
              text: 'Phone 090-1234-5678',
              confidence: 0.99,
              boundingBox: { x: 0.1, y: 0.8, width: 0.4, height: 0.04 }
            }
          ],
          faceRegions: [{ x: 0.7, y: 0.7, width: 0.2, height: 0.2 }],
          barcodeRegions: []
        }
      ],
      warnings: ['SIGNATURE_DETECTION_REQUIRES_HUMAN_REVIEW'],
      coverage: {
        textRecognition: 'ja-JP+en-US-accurate',
        faceDetection: 'vision-face-rectangles',
        qrCodeDetection: 'vision-barcodes',
        signatureDetection: 'human-review-required'
      }
    })

    const merged = mergeVisionOcr(scannedDocument, ocr)
    expect(merged.requiresLocalOcr).toBe(false)
    expect(merged.blocks[0]).toMatchObject({ text: 'Phone 090-1234-5678', source: { page: 1 } })
    expect(merged.warnings).toContainEqual(expect.objectContaining({ code: 'FACE_REGION_DETECTED' }))
    expect(merged.warnings).toContainEqual(expect.objectContaining({ code: 'SIGNATURE_REVIEW_REQUIRED' }))
    expect(merged.ocr).toEqual({
      engine: 'apple-vision',
      processedPages: 1,
      faceRegions: 1,
      barcodeRegions: 0,
      signatureReviewRequired: true
    })
  })

  it('accepts the same fail-closed evidence contract from a verified Windows OCR helper', () => {
    const ocr = windowsOcrResultSchema.parse({
      version: 'windows-ocr-v1',
      engine: 'windows-media-ocr',
      networkAccess: false,
      pages: [{
        page: 1,
        width: 500,
        height: 700,
        textBlocks: [{ text: '氏名：山田 太郎', confidence: 0.97, boundingBox: { x: 0.1, y: 0.8, width: 0.4, height: 0.04 } }],
        faceRegions: [],
        barcodeRegions: []
      }],
      warnings: ['SIGNATURE_DETECTION_REQUIRES_HUMAN_REVIEW'],
      coverage: {
        textRecognition: 'windows-ja-JP',
        faceDetection: 'not-available-requires-human-review',
        qrCodeDetection: 'not-available-requires-human-review',
        signatureDetection: 'human-review-required'
      }
    })
    const merged = mergeLocalOcr(scannedDocument, ocr)
    expect(merged.requiresLocalOcr).toBe(false)
    expect(merged.ocr?.engine).toBe('windows-media-ocr')
    expect(merged.blocks[0]?.text).toBe('氏名：山田 太郎')
    expect(merged.warnings).toContainEqual(expect.objectContaining({ code: 'SIGNATURE_REVIEW_REQUIRED' }))
  })
})

describe('collectLocalPersonNameCandidates', () => {
  it('combines Apple English NER with conservative Japanese label and honorific candidates', () => {
    const appleResult = nameDetectionResultSchema.parse({
      version: 'apple-nl-ner-v1',
      engine: 'apple-natural-language',
      networkAccess: false,
      requiresHumanConfirmation: true,
      entities: [{ text: 'Tim Cook', startUtf16: 0, endUtf16: 8, tag: 'personalName' }]
    })
    const candidates = collectLocalPersonNameCandidates(
      'Candidate: Yamada Taro\n氏名：山田 太郎\n佐藤様より連絡\n担当：鈴木一郎',
      appleResult
    )

    expect(candidates).toEqual(expect.arrayContaining(['Tim Cook', 'Yamada Taro', '山田 太郎', '佐藤', '鈴木一郎']))
    // A labeled name followed by a list is still the name alone.
    expect(collectLocalPersonNameCandidates('担当：高橋健、Java 経験者（東京）')).toEqual(['高橋健'])
  })

  it('does not let the tagger turn a technology into a person', () => {
    const line = '案件2️⃣：COBOL／Java｜AWS（Aurora）、Shell、JCL、常駐、日本語流暢\nPerl／Ruby、Jenkins 経験\n担当：Tim Cook'
    const appleResult = nameDetectionResultSchema.parse({
      version: 'apple-nl-ner-v1',
      engine: 'apple-natural-language',
      networkAccess: false,
      requiresHumanConfirmation: true,
      entities: [
        { text: 'Aurora', startUtf16: 20, endUtf16: 26, tag: 'personalName' },
        { text: 'Ruby', startUtf16: 48, endUtf16: 52, tag: 'personalName' },
        { text: 'Jenkins', startUtf16: 54, endUtf16: 61, tag: 'personalName' },
        // A single Latin word written like a technology - Shell／Bash - but unknown to the list.
        { text: 'Zorp', startUtf16: 0, endUtf16: 4, tag: 'personalName' },
        { text: 'Tim Cook', startUtf16: 70, endUtf16: 78, tag: 'personalName' }
      ]
    })
    expect(collectLocalPersonNameCandidates(`${line}\nZorp／Bash`, appleResult)).toEqual(['Tim Cook'])
    // Listed between other technologies - the Spark-next-to-Scala shape - even when unknown to the list.
    expect(collectLocalPersonNameCandidates('③ 9月〜長期、SE 2名、英語、日本語、Zorp，Spark，現場常駐。', nameDetectionResultSchema.parse({
      version: 'apple-nl-ner-v1', engine: 'apple-natural-language', networkAccess: false, requiresHumanConfirmation: true,
      entities: [{ text: 'Zorp', startUtf16: 18, endUtf16: 22, tag: 'personalName' }]
    }))).toEqual([])
    // The same single word stays a name when nothing marks it as a technology.
    expect(collectLocalPersonNameCandidates('担当は Zorp です', nameDetectionResultSchema.parse({
      version: 'apple-nl-ner-v1', engine: 'apple-natural-language', networkAccess: false, requiresHumanConfirmation: true,
      entities: [{ text: 'Zorp', startUtf16: 4, endUtf16: 8, tag: 'personalName' }]
    }))).toEqual(['Zorp'])
  })

  it('does not treat common two-column SES headings or role descriptions as person names', () => {
    expect(collectLocalPersonNameCandidates([
      '案件 概要',
      '必須 スキル',
      '担当：バックエンド開発',
      'クラウド基盤の設計・構築を担当'
    ].join('\n'))).toEqual([])
  })

  it('preserves SAP technology names in mixed Chinese/Japanese requirements while still finding the contact', () => {
    const text = '日语流畅的FI 中上级SE+会BTP或者Fiori或者Cdsview 至少一个熟悉\nBTP or Fiori or Cdsviewの活用を前提とした設計経験\nABAP開発\n担当：山田太郎'
    const appleResult = nameDetectionResultSchema.parse({
      version: 'apple-nl-ner-v1', engine: 'apple-natural-language', networkAccess: false, requiresHumanConfirmation: true,
      entities: ['BTP', 'Fiori', 'Cdsview', 'ABAP'].map(name => ({ text: name, startUtf16: text.indexOf(name), endUtf16: text.indexOf(name) + name.length, tag: 'personalName' }))
    })
    expect(collectLocalPersonNameCandidates(text, appleResult)).toEqual(['山田太郎'])
  })
})

describe('parseLocalHelperJson', () => {
  it('accepts one frame or one byte-identical duplicate frame only', () => {
    expect(parseLocalHelperJson('{"networkAccess":false}\n')).toEqual({ networkAccess: false })
    expect(parseLocalHelperJson('{"networkAccess":false}\n{"networkAccess":false}\n')).toEqual({ networkAccess: false })
    expect(() => parseLocalHelperJson('{"networkAccess":false}\n{"networkAccess":true}\n')).toThrow(/non-identical/u)
    expect(() => parseLocalHelperJson('{"a":1}\n{"a":1}\n{"a":1}\n')).toThrow(/multiple/u)
  })
})

describe('createLocalAiRuntime', () => {
  it('keeps Windows on the shared privacy rules without pretending macOS OCR is available', () => {
    const runtime = createLocalAiRuntime({
      platform: 'win32',
      macExecutablePath: 'unused-on-windows'
    })

    expect(runtime).toMatchObject({
      platform: 'win32',
      ocr: null,
      personNameDetector: null,
      status: 'pii-rules-active-ocr-unavailable'
    })
    expect(collectLocalPersonNameCandidates('氏名：山田 太郎')).toContain('山田 太郎')
  })

  it('enables the Windows offline adapter only with explicit kernel network evidence', () => {
    const runtime = createLocalAiRuntime({
      platform: 'win32',
      windowsOcrSandboxLauncherPath: 'C:\\Program Files\\SESAI\\resources\\native\\windows\\ocr\\ses-ocr-sandbox.exe',
      windowsOcrWorkerPath: 'C:\\Program Files\\SESAI\\windows-ocr-worker.js',
      windowsTesseractWorkerPath: 'C:\\Program Files\\SESAI\\tesseract-worker.js',
      windowsTessdataPath: 'C:\\Program Files\\SESAI\\resources\\native\\windows\\ocr\\tessdata',
      windowsOcrResourceManifestPath: 'C:\\Program Files\\SESAI\\resources\\native\\windows\\ocr\\resource-manifest.json',
      windowsAppContainerGrantRoots: ['C:\\Program Files\\SESAI'],
      windowsNetworkIsolation: 'windows-kernel-network-verified'
    })
    expect(runtime).toMatchObject({
      platform: 'win32',
      ocr: { engine: 'windows-tesseract-wasm' },
      personNameDetector: null,
      status: 'windows-ocr-and-pii-rules-active'
    })
  })

  it('associates a spreadsheet name label with the next value on the same row', () => {
    expect(collectLocalPersonNameCandidates([
      '[SHEET:履歴書!A5] 氏名',
      '[SHEET:履歴書!D5] 山田太郎',
      '[SHEET:履歴書!J5] 男'
    ].join('\n'))).toContain('山田太郎')
  })

  it('reports a bundled-but-disabled Windows OCR runtime before kernel isolation is verified', () => {
    const runtime = createLocalAiRuntime({
      platform: 'win32',
      windowsOcrSandboxLauncherPath: 'C:\\Program Files\\SESAI\\resources\\native\\windows\\ocr\\ses-ocr-sandbox.exe',
      windowsOcrWorkerPath: 'C:\\Program Files\\SESAI\\windows-ocr-worker.js',
      windowsTesseractWorkerPath: 'C:\\Program Files\\SESAI\\tesseract-worker.js',
      windowsTessdataPath: 'C:\\Program Files\\SESAI\\resources\\native\\windows\\ocr\\tessdata',
      windowsOcrResourceManifestPath: 'C:\\Program Files\\SESAI\\resources\\native\\windows\\ocr\\resource-manifest.json'
    })
    expect(runtime).toMatchObject({
      platform: 'win32',
      ocr: null,
      personNameDetector: null,
      status: 'windows-ocr-bundled-isolation-pending'
    })
  })
})
