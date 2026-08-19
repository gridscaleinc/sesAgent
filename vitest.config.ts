import { fileURLToPath } from 'node:url'
import { resolve } from 'node:path'
import { defineConfig } from 'vitest/config'

const rootDir = fileURLToPath(new URL('.', import.meta.url))

export default defineConfig({
  resolve: {
    alias: {
      '@application': resolve(rootDir, 'packages/application/src/index.ts'),
      '@agent': resolve(rootDir, 'packages/agent/src/index.ts'),
      '@action-runtime': resolve(rootDir, 'packages/action-runtime/src/index.ts'),
      '@domain': resolve(rootDir, 'packages/domain/src/index.ts'),
      '@files': resolve(rootDir, 'packages/files/src/index.ts'),
      '@mail': resolve(rootDir, 'packages/mail/src/index.ts'),
      '@job-cases': resolve(rootDir, 'packages/job-cases/src/index.ts'),
      '@local-ai': resolve(rootDir, 'packages/local-ai/src/index.ts'),
      '@matching': resolve(rootDir, 'packages/matching/src/index.ts'),
      '@persistence': resolve(rootDir, 'packages/persistence/src/index.ts'),
      '@parsers/worker-client': resolve(rootDir, 'packages/parsers/src/worker-client.ts'),
      '@parsers': resolve(rootDir, 'packages/parsers/src/index.ts'),
      '@platform/keys': resolve(rootDir, 'packages/platform/src/keys.ts'),
      '@platform': resolve(rootDir, 'packages/platform/src/index.ts'),
      '@privacy': resolve(rootDir, 'packages/privacy/src/index.ts'),
      '@proposals': resolve(rootDir, 'packages/proposals/src/index.ts'),
      '@recovery': resolve(rootDir, 'packages/recovery/src/index.ts'),
      '@resume': resolve(rootDir, 'packages/resume/src/index.ts'),
      '@shared/contracts': resolve(rootDir, 'packages/shared/src/contracts.ts'),
      '@shared': resolve(rootDir, 'packages/shared/src/index.ts'),
      '@renderer': resolve(rootDir, 'apps/desktop/src/renderer')
    }
  },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./tests/setup.ts'],
    include: ['**/*.test.{ts,tsx}'],
    restoreMocks: true
  }
})
