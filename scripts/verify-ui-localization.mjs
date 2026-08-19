import { readFile, readdir } from 'node:fs/promises'
import { join, relative, resolve } from 'node:path'
import { parse } from '@babel/parser'
import traverseModule from '@babel/traverse'

const traverse = traverseModule.default ?? traverseModule
const rendererRoot = resolve('apps/desktop/src/renderer')
const catalogPaths = [
  resolve('apps/desktop/src/renderer/i18n.ts'),
  resolve('apps/desktop/src/renderer/zh-cn-ui-catalog.ts')
]
const excludedFiles = new Set(catalogPaths)
const japaneseKana = /[ぁ-ゖァ-ヺ]/u

async function rendererFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true })
  const nested = await Promise.all(entries.map(async (entry) => {
    const path = join(directory, entry.name)
    if (entry.isDirectory()) return rendererFiles(path)
    if (!/\.tsx?$/u.test(entry.name) || entry.name.includes('.test.') || excludedFiles.has(path)) return []
    return [path]
  }))
  return nested.flat()
}

function normalized(value) {
  return value.replace(/\s+/gu, ' ').trim()
}

const catalogSource = (await Promise.all(catalogPaths.map((path) => readFile(path, 'utf8')))).join('\n')
const catalogKeys = new Set([...catalogSource.matchAll(/\['([^']*)'\s*,/gu)].map((match) => match[1]))
const missing = new Map()

for (const path of await rendererFiles(rendererRoot)) {
  const source = await readFile(path, 'utf8')
  const ast = parse(source, { sourceType: 'module', plugins: ['typescript', 'jsx'] })
  const inspect = (value, line) => {
    const candidate = normalized(value)
    if (!candidate || !japaneseKana.test(candidate) || catalogKeys.has(candidate)) return
    const locations = missing.get(candidate) ?? []
    locations.push(`${relative(process.cwd(), path)}:${line}`)
    missing.set(candidate, locations)
  }
  traverse(ast, {
    StringLiteral(path) { inspect(path.node.value, path.node.loc.start.line) },
    JSXText(path) { inspect(path.node.value, path.node.loc.start.line) },
    TemplateElement(path) { inspect(path.node.value.raw, path.node.loc.start.line) }
  })
}

if (missing.size > 0) {
  for (const [value, locations] of missing) {
    process.stderr.write(`${locations.join(', ')}\n  Missing zh-CN UI entry: ${JSON.stringify(value)}\n`)
  }
  throw new Error(`Renderer contains ${missing.size} Japanese UI string(s) without a Simplified Chinese catalog entry.`)
}

process.stdout.write(`${JSON.stringify({
  version: 'renderer-ui-localization-v1',
  rendererJapaneseStringsMissingChinese: 0,
  catalogEntries: catalogKeys.size
})}\n`)
