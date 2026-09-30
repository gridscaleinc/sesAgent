import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { expect, it } from 'vitest'
import { productionContentSecurityPolicy } from './production-csp'

const html = readFileSync(resolve(process.cwd(), 'apps/desktop/src/renderer/index.html'), 'utf8')

it('removes localhost connections from the packaged renderer CSP only', () => {
  const plugin = productionContentSecurityPolicy()
  expect(plugin.apply).toBe('build')
  const built = plugin.transformIndexHtml(html)
  expect(html).toMatch(/connect-src 'self' ws:\/\/localhost:\* http:\/\/localhost:\*/)
  expect(built).toMatch(/connect-src 'self';/)
  expect(built).not.toContain('localhost')
})

it('fails the build instead of shipping a CSP it no longer understands', () => {
  expect(() => productionContentSecurityPolicy().transformIndexHtml('<meta content="connect-src *">')).toThrow(/dev-server connect sources/)
})
