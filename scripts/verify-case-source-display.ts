import assert from 'node:assert/strict'
import { randomBytes, randomUUID } from 'node:crypto'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { EncryptedApplicationRepository } from '@persistence'
import { createRedactedManualJobCaseSource, extractJobCaseDraft } from '@job-cases'
import { collectLocalPersonNameCandidates, MacNaturalLanguageNerClient } from '@local-ai'

const directory = await mkdtemp(join(tmpdir(), 'ses-case-source-display-'))
const databaseKey = randomBytes(32), mappingKey = randomBytes(32)
const repository = new EncryptedApplicationRepository({ path: join(directory, 'test.db'), databaseKey, mappingKey })
try {
  const firstBody = '必須スキル：BTP or Fiori or Cdsview\n担当：山田太郎\n連絡先：contact@example.com'
  const create = (body: string, names: string[]) => {
    const processed = createRedactedManualJobCaseSource({ subject: 'SAP FI 案件', body }, randomUUID(), names)
    const draft = extractJobCaseDraft(processed.source, randomUUID())
    repository.saveRedactedJobCaseSourceAndDraft(processed.redaction.session, processed.redaction.mappings, processed.source, draft)
    return draft.reviewId
  }
  // Simulate a historical false positive. Only this source's encrypted mapping restores it.
  const first = create(firstBody, ['Fiori', '山田太郎'])
  const second = create('担当：佐藤花子\n必須スキル：Java', ['佐藤花子'])
  const redacted = repository.getJobCaseSourceText(first)!
  assert.ok(redacted.redactedBody.includes('<PERSON_NAME_'))
  assert.equal(redacted.localDisplay, undefined)
  assert.equal(repository.getJobCaseSourceTextForDisplay(first)!.localDisplay!.body, firstBody)
  assert.equal(repository.getJobCaseSourceTextForDisplay(second)!.localDisplay!.body, '担当：佐藤花子\n必須スキル：Java')
  assert.equal(repository.getJobCaseSourceTextForDisplay(randomUUID()), null)
  assert.deepEqual(repository.getJobCaseSourceText(first), redacted, 'local reading never changes stored redacted source')
  const agent = JSON.stringify(repository.getAgentJobCaseDraftFacts(first, '案件 A'))
  for (const original of ['山田太郎', 'contact@example.com', 'localDisplay']) assert.ok(!agent.includes(original), 'local display data does not enter agent facts')

  let nativeNer = 'not-applicable'
  if (process.platform === 'darwin') {
    const ner = new MacNaturalLanguageNerClient(resolve('build/native/macos/ses-vision-ocr'))
    const text = '日语流畅的FI 中上级SE+会BTP或者Fiori或者Cdsview 至少一个熟悉\nBTP or Fiori or Cdsviewの活用を前提とした設計経験がある方\n担当：山田太郎'
    const names = collectLocalPersonNameCandidates(text, await ner.detectNames(text))
    assert.ok(!names.includes('Fiori'))
    assert.ok(names.includes('山田太郎'))
    const newCase = create(firstBody, names)
    assert.ok(repository.getJobCaseSourceText(newCase)!.redactedBody.includes('BTP or Fiori or Cdsview'))
    assert.ok(repository.getJobCaseReview(newCase)!.fields.find(field => field.key === 'required_skills')!.value!.includes('Fiori'))
    nativeNer = 'passed'
  }
  console.log(JSON.stringify({ localSourceRestoration: 'passed', isolatedMappings: 'passed', redactedCloudReadUnchanged: 'passed', nativeNer, networkAccess: false }))
} finally {
  repository.close(); databaseKey.fill(0); mappingKey.fill(0)
  await rm(directory, { recursive: true, force: true })
}
