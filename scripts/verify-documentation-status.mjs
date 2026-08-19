import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'

const root = resolve(import.meta.dirname, '..')
const packageManifest = JSON.parse(await readFile(resolve(root, 'package.json'), 'utf8'))
const persistenceSource = await readFile(resolve(root, 'packages/persistence/src/schema/migrations.ts'), 'utf8')
const schemaVersion = Number(persistenceSource.match(/export const currentSchemaVersion = (\d+)/u)?.[1])
if (!Number.isInteger(schemaVersion) || schemaVersion <= 0) {
  throw new Error('Unable to read currentSchemaVersion from the persistence source.')
}

const marker = `<!-- ses-current-state package=${packageManifest.version} schema=${schemaVersion} -->`
const currentDocuments = [
  'README.md',
  '02-technical-architecture.md',
  '04-security-and-data-governance.md',
  '05-delivery-roadmap.md',
  '06-key-loss-and-recovery-runbook.md',
  '07-remediation-and-external-adoption-plan.md'
]
const failures = []
for (const document of currentDocuments) {
  const source = await readFile(resolve(root, document), 'utf8')
  if (!source.includes(marker)) failures.push(`${document}:current-state-marker`)
}

const readme = await readFile(resolve(root, 'README.md'), 'utf8')
if (!readme.includes('普通 Cloud AI 采用失败关闭的两阶段协议')) failures.push('README.md:cloud-two-stage-contract')
if (!readme.includes('当前 Schema v38')) failures.push('README.md:current-schema-statement')
if (readme.includes('当前验收产物为')) failures.push('README.md:stale-build-artifact-claim')

const expertEvidenceSource = await readFile(resolve(root, 'scripts/privacy-expert-evidence.mjs'), 'utf8')
if (!expertEvidenceSource.includes("privacyExpertReportVersion = 'ses-privacy-expert-quality-report-v2'")) {
  failures.push('privacy-expert-evidence:report-version')
}
const sharedContracts = await readFile(resolve(root, 'packages/shared/src/contracts.ts'), 'utf8')
if (sharedContracts.includes("sendAiCommerceCloudPrompt") || sharedContracts.includes("aicommerce:send-cloud-prompt")) {
  failures.push('shared-contracts:legacy-cloud-entrypoint')
}
if (!sharedContracts.includes('prepareAiCommerceCloudPrompt') || !sharedContracts.includes('executeAiCommerceCloudPrompt')) {
  failures.push('shared-contracts:two-stage-cloud-entrypoint')
}

const [embeddingManifest, rerankerManifest] = await Promise.all([
  readFile(resolve(root, 'models/Xenova/multilingual-e5-small/model-manifest.json'), 'utf8').then(JSON.parse),
  readFile(resolve(root, 'models/hotchpotch/japanese-reranker-tiny-v2/model-manifest.json'), 'utf8').then(JSON.parse)
])
if (!embeddingManifest.modelId || !embeddingManifest.revision) failures.push('embedding-manifest:model-identity')
if (!rerankerManifest.modelId || !rerankerManifest.revision) failures.push('reranker-manifest:model-identity')

if (failures.length > 0) {
  throw new Error(`Documentation status verification failed:\n${failures.join('\n')}`)
}

process.stdout.write(JSON.stringify({
  version: 'ses-documentation-status-v1',
  packageVersion: packageManifest.version,
  schemaVersion,
  documents: currentDocuments.length,
  cloudContract: 'main-owned-two-stage-review-v1',
  privacyExpertReportVersion: 'ses-privacy-expert-quality-report-v2',
  embeddingModel: `${embeddingManifest.modelId}@${embeddingManifest.revision}`,
  rerankerModel: `${rerankerManifest.modelId}@${rerankerManifest.revision}`
}) + '\n')
