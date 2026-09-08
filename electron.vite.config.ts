import { fileURLToPath } from 'node:url'
import { resolve } from 'node:path'
import react from '@vitejs/plugin-react'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'

const rootDir = fileURLToPath(new URL('.', import.meta.url))
const alias = {
  '@application': resolve(rootDir, 'packages/application/src/index.ts'),
  '@aicommerce': resolve(rootDir, 'packages/aicommerce/src/index.ts'),
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

// Desktop OAuth Client IDs are public identifiers. Capture product-managed
// Gmail settings in the Main bundle when they are present during packaging so
// a Finder-launched app does not depend on shell environment inheritance.
const googleWorkspaceBuildVariables = [
  'SES_GOOGLE_OAUTH_CLIENT_ID',
  'SES_GOOGLE_OAUTH_CLIENT_SECRET',
  'SES_GOOGLE_WORKSPACE_DOMAIN',
  'SES_GMAIL_LABEL_IDS',
  'SES_GMAIL_QUERY',
  'SES_GMAIL_LOOKBACK_DAYS',
  'SES_GMAIL_MAX_MESSAGES_PER_RUN'
] as const
const mainBuildDefinitions = Object.fromEntries(
  googleWorkspaceBuildVariables.flatMap((name) => process.env[name] === undefined
    ? []
    : [[`process.env.${name}`, JSON.stringify(process.env[name])]])
) as Record<string, string>

export default defineConfig({
  main: {
    define: mainBuildDefinitions,
    plugins: [externalizeDepsPlugin()],
    resolve: { alias },
    build: {
      rollupOptions: {
        input: {
          index: resolve(rootDir, 'apps/desktop/src/main/index.ts'),
          'embedding-worker': resolve(rootDir, 'apps/desktop/src/workers/embedding-worker.ts'),
          'reranker-worker': resolve(rootDir, 'apps/desktop/src/workers/reranker-worker.ts'),
          'parser-worker': resolve(rootDir, 'apps/desktop/src/workers/parser-worker.ts'),
          'windows-ocr-worker': resolve(rootDir, 'apps/desktop/src/workers/windows-ocr-worker.ts'),
          'tesseract-worker': resolve(rootDir, 'apps/desktop/src/workers/tesseract-worker.ts'),
          'windows-network-probe': resolve(rootDir, 'apps/desktop/src/workers/windows-network-probe.ts')
        },
        output: {
          entryFileNames: '[name].js'
        }
      }
    }
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    resolve: { alias },
    build: {
      rollupOptions: {
        input: resolve(rootDir, 'apps/desktop/src/preload/index.ts'),
        output: {
          entryFileNames: '[name].js',
          format: 'cjs'
        }
      }
    }
  },
  renderer: {
    root: resolve(rootDir, 'apps/desktop/src/renderer'),
    resolve: { alias },
    plugins: [react()],
    build: {
      rollupOptions: {
        input: resolve(rootDir, 'apps/desktop/src/renderer/index.html')
      }
    }
  }
})
