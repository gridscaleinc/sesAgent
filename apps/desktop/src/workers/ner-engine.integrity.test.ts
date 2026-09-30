// @vitest-environment node
import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { detectGlinerPersonEntities } from './ner-engine'

// Every file is hash-checked before the tokenizer or ONNX session is created;
// a tampered or foreign model never runs. Only the small files are staged.
const manifestPath = resolve(import.meta.dirname, '../../../../models/knowledgator/gliner-x-small/model-manifest.json')

describe('GLiNER model integrity', () => {
  let directory: string

  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), 'ses-gliner-integrity-'))
  })

  afterEach(async () => {
    await rm(directory, { recursive: true, force: true })
  })

  it('fails closed when a model file does not match its pinned hash', async () => {
    await copyFile(manifestPath, join(directory, 'model-manifest.json'))
    await writeFile(join(directory, 'gliner_config.json'), '{"max_width":12}'.padEnd(3_541, ' '))
    await expect(detectGlinerPersonEntities(directory, '王小明が参加')).rejects.toThrow('MODEL_INTEGRITY_FAILED:gliner_config.json')
  })
})

describe('GLiNER manifest contract', () => {
  it('fails closed when the manifest names another revision', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'ses-gliner-manifest-'))
    try {
      const manifest = JSON.parse(await readFile(manifestPath, 'utf8')) as Record<string, unknown>
      await mkdir(directory, { recursive: true })
      await writeFile(join(directory, 'model-manifest.json'), JSON.stringify({ ...manifest, revision: 'main' }))
      // A fresh module: the engine binds to the first directory it verifies.
      vi.resetModules()
      const engine = await import('./ner-engine')
      await expect(engine.detectGlinerPersonEntities(directory, '王小明が参加')).rejects.toThrow('MODEL_MANIFEST_INVALID')
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
  })
})
