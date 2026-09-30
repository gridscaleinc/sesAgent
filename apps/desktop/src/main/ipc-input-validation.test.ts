// @vitest-environment node
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseAst, transformWithEsbuild } from 'vite'
import { describe, expect, it } from 'vitest'

/*
 * Guard: every `ipcMain.handle` that receives renderer input must validate it in the handler itself.
 *
 * Heuristic (static, deliberately simple). Each registration file (agent-ipc.ts, index.ts, ipc/*.ts) has its types
 * stripped with esbuild and is parsed to an ESTree AST, then:
 *  - every `ipcMain.handle(channel, handler)` call is found; `handler` is an inline function, or an identifier bound
 *    in the same file to a function (`const h = (...) => ...` or `function h(...)`);
 *  - parameters after the first (`event`) are renderer input. Handlers without such a parameter, or whose extra
 *    parameters are prefixed with `_` (declared but unused), need no validation;
 *  - each input parameter must appear in an argument of `<schema>.parse(...)` / `.safeParse(...)` or of one of
 *    `namedValidators` somewhere inside the handler body (so `schema.parse(raw ?? {})` and
 *    `schema.parse((raw as { url?: unknown })?.url)` count). A parse further downstream (store, service,
 *    helper closure) does not count: the IPC boundary is where untrusted renderer data must be checked;
 *  - `allowlist` holds `file:channel` exceptions, each with the reason it is justified.
 * Aliasing (`const x = raw; schema.parse(x)`) is not followed on purpose: parse the parameter itself.
 */
const mainDir = fileURLToPath(new URL('.', import.meta.url))
const registrationFiles = [
  'agent-ipc.ts',
  'index.ts',
  ...readdirSync(join(mainDir, 'ipc'))
    .filter((name) => name.endsWith('.ts') && !name.endsWith('.test.ts'))
    .map((name) => `ipc/${name}`)
]

/** Plain functions (not `.parse` methods) that validate their argument with a zod schema. */
const namedValidators = new Set<string>([])

/** `file:channel` -> why the handler may pass renderer input on without a schema parse. */
const allowlist: Record<string, string> = {}

type Node = { type: string; [key: string]: unknown }
const isNode = (value: unknown): value is Node => typeof value === 'object' && value !== null && typeof (value as Node).type === 'string'
const functionTypes = new Set(['ArrowFunctionExpression', 'FunctionExpression', 'FunctionDeclaration'])

function walk(node: Node, visit: (node: Node) => void) {
  visit(node)
  for (const [key, value] of Object.entries(node)) {
    if (key === 'type') continue
    if (Array.isArray(value)) {
      for (const item of value) if (isNode(item)) walk(item, visit)
    } else if (isNode(value)) walk(value, visit)
  }
}

const calleeName = (callee: Node) =>
  callee.type === 'MemberExpression' && isNode(callee.property) && callee.property.type === 'Identifier'
    ? `.${callee.property.name as string}`
    : callee.type === 'Identifier'
      ? (callee.name as string)
      : ''

function mentions(node: Node, name: string) {
  let found = false
  walk(node, (child) => {
    if (child.type === 'Identifier' && child.name === name) found = true
  })
  return found
}

function validates(body: Node, param: string) {
  let ok = false
  walk(body, (node) => {
    if (ok || node.type !== 'CallExpression') return
    if (!(node.arguments as Node[]).some((arg) => mentions(arg, param))) return
    const name = calleeName(node.callee as Node)
    if (name === '.parse' || name === '.safeParse' || namedValidators.has(name)) ok = true
  })
  return ok
}

async function parseFile(file: string) {
  const { code } = await transformWithEsbuild(readFileSync(join(mainDir, file), 'utf8'), file, { loader: 'ts' })
  return parseAst(code) as unknown as Node
}

async function findUnvalidatedIpcHandlers() {
  const problems: string[] = []
  const seen = new Set<string>()
  for (const file of registrationFiles) {
    const ast = await parseFile(file)
    const functions = new Map<string, Node>()
    walk(ast, (node) => {
      if (
        node.type === 'VariableDeclarator' &&
        isNode(node.id) &&
        node.id.type === 'Identifier' &&
        isNode(node.init) &&
        functionTypes.has(node.init.type)
      )
        functions.set(node.id.name as string, node.init)
      if (node.type === 'FunctionDeclaration' && isNode(node.id)) functions.set(node.id.name as string, node)
    })
    walk(ast, (node) => {
      if (node.type !== 'CallExpression') return
      const callee = node.callee as Node
      if (
        callee.type !== 'MemberExpression' ||
        calleeName(callee) !== '.handle' ||
        !isNode(callee.object) ||
        callee.object.name !== 'ipcMain'
      )
        return
      const [channelNode, handlerNode] = node.arguments as Node[]
      const channel =
        channelNode?.type === 'MemberExpression' ? calleeName(channelNode).slice(1) : String(channelNode?.value ?? channelNode?.name ?? '?')
      const key = `${file}:${channel}`
      seen.add(key)
      if (allowlist[key]) return
      const handler =
        handlerNode && functionTypes.has(handlerNode.type)
          ? handlerNode
          : handlerNode?.type === 'Identifier'
            ? functions.get(handlerNode.name as string)
            : undefined
      if (!handler) {
        problems.push(`${key}: handler is not an inline or same-file function`)
        return
      }
      for (const param of (handler.params as Node[]).slice(1)) {
        const name = param.type === 'Identifier' ? (param.name as string) : null
        if (name?.startsWith('_')) continue
        if (!name || !validates(handler.body as Node, name))
          problems.push(`${key}: input \`${name ?? param.type}\` is not passed to a schema .parse/.safeParse in the handler`)
      }
    })
  }
  const stale = Object.keys(allowlist).filter((key) => !seen.has(key))
  return { problems, stale, scanned: seen.size }
}

describe('IPC input validation', () => {
  it('validates renderer input with a schema inside every ipcMain.handle', async () => {
    const { problems, scanned } = await findUnvalidatedIpcHandlers()
    expect(scanned).toBeGreaterThan(100)
    expect(
      problems,
      `Parse renderer input in the handler (schema.parse(raw)) or add a justified allowlist entry:\n${problems.join('\n')}`
    ).toEqual([])
  })

  it('keeps the allowlist free of entries for handlers that no longer exist', async () => {
    expect((await findUnvalidatedIpcHandlers()).stale).toEqual([])
  })

  it('flags an unvalidated handler (heuristic self-check)', () => {
    const [bad, good] = (
      parseAst('f((event, raw) => repo.save(raw)); g((event, raw) => repo.save(schema.parse(raw)))') as unknown as { body: Node[] }
    ).body.map((statement) => ((statement.expression as Node).arguments as Node[])[0]!.body as Node)
    expect(validates(bad!, 'raw')).toBe(false)
    expect(validates(good!, 'raw')).toBe(true)
  })
})
