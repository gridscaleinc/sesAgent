import { readFile, readdir } from 'node:fs/promises'
import { basename, join, relative, resolve } from 'node:path'
import { parse } from '@babel/parser'
import traverseModule from '@babel/traverse'

/**
 * Renderer localization contract:
 * - UI copy is written as inline pairs t('中文', '日本語') (or `{ zh, ja }` objects);
 * - text that originates in Main (Japanese-only) is translated by the explicit main-message catalog;
 * - any other Japanese literal must carry a `// i18n-ignore: reason` marker.
 */
const traverse = traverseModule.default ?? traverseModule
const rendererRoot = resolve('apps/desktop/src/renderer')
const mainMessageCatalogFiles = new Set(['main-message-catalog.ts'])
const skippedDirectories = new Set(['node_modules', 'output'])
const japaneseKana = /[ぁ-ゖァ-ヺ]/u
// Kanji-only words that are Japanese UI rather than Chinese (Simplified Chinese spells these differently).
const kanjiOnlyJapanese = /(?:要員|確認|登録|検索|設定|削除|編集|閉|保存済|取込|一覧|詳細|面談|候補者|承認|送信|案件票)/u
const ignoreMarker = /i18n-ignore/u

async function rendererFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true })
  const nested = await Promise.all(
    entries.map(async (entry) => {
      const path = join(directory, entry.name)
      if (entry.isDirectory()) return skippedDirectories.has(entry.name) ? [] : rendererFiles(path)
      if (!/\.tsx?$/u.test(entry.name) || /\.test\.tsx?$/u.test(entry.name) || entry.name.endsWith('.d.ts')) return []
      return [path]
    })
  )
  return nested.flat()
}

function normalized(value) {
  return value.replace(/\s+/gu, ' ').trim()
}

function isJapanese(value) {
  return japaneseKana.test(value) || kanjiOnlyJapanese.test(value)
}

/** `t(...)` or `localeText(...)(...)`. */
function isPairCall(node) {
  if (node?.type !== 'CallExpression') return false
  const callee = node.callee
  if (callee.type === 'Identifier' && callee.name === 't') return true
  return callee.type === 'CallExpression' && callee.callee.type === 'Identifier' && callee.callee.name === 'localeText'
}

function hasIgnoreComment(node) {
  return [...(node.leadingComments ?? []), ...(node.innerComments ?? [])].some((comment) => ignoreMarker.test(comment.value))
}

let checkedFiles = 0
let checkedLiterals = 0
let pairCalls = 0
let jaProperties = 0
let ignoredLiterals = 0
let catalogFiles = 0
const unpaired = []
const kanaInChinese = []

for (const path of await rendererFiles(rendererRoot)) {
  const source = await readFile(path, 'utf8')
  const location = (line) => `${relative(process.cwd(), path)}:${line}`
  const isCatalog = mainMessageCatalogFiles.has(basename(path))
  if (isCatalog) {
    catalogFiles += 1
    continue
  }
  checkedFiles += 1
  const lines = source.split('\n')
  const ignoredLines = new Set()
  lines.forEach((text, index) => {
    // A marker covers its own line and the next one; a statement-level marker covers the whole statement (below).
    if (ignoreMarker.test(text)) {
      ignoredLines.add(index + 1)
      ignoredLines.add(index + 2)
    }
  })
  const ast = parse(source, { sourceType: 'module', plugins: ['typescript', 'jsx'] })

  const allowed = (path) => {
    const line = path.node.loc.start.line
    if (ignoredLines.has(line)) return 'ignored'
    let child = path
    for (let parent = path.parentPath; parent; child = parent, parent = parent.parentPath) {
      const node = parent.node
      if (hasIgnoreComment(child.node)) return 'ignored'
      if (isPairCall(node) && node.arguments[1] === child.node) return 'pair'
      if ((node.type === 'ObjectProperty' || node.type === 'ObjectMethod') && node.value === child.node) {
        const key = node.key.type === 'Identifier' ? node.key.name : node.key.type === 'StringLiteral' ? node.key.value : null
        if (key === 'ja' || key === 'ja-JP') return 'ja'
      }
      // `{/* i18n-ignore */}` immediately before a JSX child.
      if ((node.type === 'JSXElement' || node.type === 'JSXFragment') && child.listKey === 'children') {
        const siblings = node.children
        for (let index = child.key - 1; index >= 0; index -= 1) {
          const sibling = siblings[index]
          if (sibling.type === 'JSXText' && !sibling.value.trim()) continue
          if (
            sibling.type === 'JSXExpressionContainer' &&
            sibling.expression.type === 'JSXEmptyExpression' &&
            hasIgnoreComment(sibling.expression)
          )
            return 'ignored'
          break
        }
      }
      if (parent.isStatement() && hasIgnoreComment(node)) return 'ignored'
    }
    return null
  }

  const inspect = (path, value) => {
    const candidate = normalized(value)
    if (!candidate || !isJapanese(candidate)) return
    checkedLiterals += 1
    const reason = allowed(path)
    if (reason === 'ignored') ignoredLiterals += 1
    if (reason) return
    unpaired.push({ location: location(path.node.loc.start.line), value: candidate })
  }

  traverse(ast, {
    CallExpression(path) {
      if (!isPairCall(path.node)) return
      pairCalls += 1
      const [zhArgument] = path.node.arguments
      if (!zhArgument) return
      const texts = []
      if (zhArgument.type === 'StringLiteral') texts.push(zhArgument.value)
      if (zhArgument.type === 'TemplateLiteral') texts.push(...zhArgument.quasis.map((quasi) => quasi.value.cooked ?? quasi.value.raw))
      if (texts.some((text) => japaneseKana.test(text)))
        kanaInChinese.push({ location: location(zhArgument.loc.start.line), value: normalized(texts.join('…')) })
    },
    ObjectProperty(path) {
      const key = path.node.key
      if ((key.type === 'Identifier' && key.name === 'ja') || (key.type === 'StringLiteral' && key.value === 'ja')) jaProperties += 1
    },
    StringLiteral(path) {
      // Import sources and TypeScript literal types are not displayed text.
      if (path.parentPath.isImportDeclaration() || path.parentPath.isExportDeclaration()) return
      inspect(path, path.node.value)
    },
    JSXText(path) {
      inspect(path, path.node.value)
    },
    TemplateElement(path) {
      inspect(path, path.node.value.cooked ?? path.node.value.raw)
    }
  })
}

for (const { location, value } of unpaired)
  process.stderr.write(`${location}\n  Japanese text outside t(zh, ja) / ja: / i18n-ignore: ${JSON.stringify(value)}\n`)
for (const { location, value } of kanaInChinese)
  process.stderr.write(`${location}\n  Chinese side of t(zh, ja) contains kana: ${JSON.stringify(value)}\n`)
if (unpaired.length > 0 || kanaInChinese.length > 0) {
  throw new Error(
    `Renderer localization contract failed: ${unpaired.length} unpaired Japanese literal(s), ${kanaInChinese.length} t() pair(s) with kana on the Chinese side.`
  )
}

process.stdout.write(
  `${JSON.stringify({
    version: 'renderer-ui-localization-v2',
    rendererFiles: checkedFiles,
    mainMessageCatalogFiles: catalogFiles,
    japaneseLiterals: checkedLiterals,
    unpairedJapaneseLiterals: 0,
    pairCalls,
    jaProperties,
    ignoredJapaneseLiterals: ignoredLiterals,
    chinesePairsWithKana: 0
  })}\n`
)
