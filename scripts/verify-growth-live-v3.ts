/** Real configured service + production privacy gate; synthetic records only. No business database writes. */
import { app, net } from 'electron'
import { randomBytes, randomUUID } from 'node:crypto'
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import {
  AiCommerceNativeClient,
  loadAiCommerceConfiguration,
  parseAiCommerceNativeCredential,
  parseAiCommercePendingAuthorization
} from '@aicommerce'
import { SafeStorageJsonCredentialVault } from '@platform'
import { EncryptedApplicationRepository } from '@persistence'
import { createLocalAiRuntime } from '@local-ai'
import { defaultAgentChatModelKey, loadAgentChatModelCatalog, resolveAgentChatModel } from '@agent'
import { baseExperienceSkills, experienceInstructions, type ExperienceEvent, type ExperienceInput } from '@shared'
import { AgentCloudNarrativeService } from '../apps/desktop/src/main/agent-cloud-narrative'
import { loadCloudPrivacyGates } from '../apps/desktop/src/main/privacy-gates'
import { validateQuestionTemplate } from '../apps/desktop/src/main/question-bank'
import { validateExperienceProcedure } from '../apps/desktop/src/main/experience-procedure'

app.setName('ses-agent-desktop')
app.setAppPath(process.cwd())
async function main() {
  await app.whenReady()
  console.log('[experience-live] ready')
  const root = process.cwd(),
    directory = await mkdtemp(join(tmpdir(), 'ses-experience-live-'))
  const repository = new EncryptedApplicationRepository({
    path: join(directory, 'live.db'),
    databaseKey: randomBytes(32),
    mappingKey: randomBytes(32)
  })
  const report: Record<string, unknown> = {
    version: 'business-growth-live-v3',
    startedAt: new Date().toISOString(),
    syntheticOnly: true,
    productionPrivacyGate: true,
    callLimit: 12,
    calls: 0,
    status: 'running',
    checks: []
  }
  const reportPath = resolve(root, 'output/system-experience/growth-v3-live-report.json')
  const deadline = AbortSignal.timeout(9 * 60_000)
  const run = async <T>(name: string, operation: () => Promise<T>): Promise<T> => {
    if (Number(report.calls) >= 12) throw new Error('Acceptance call limit reached')
    report.calls = Number(report.calls) + 1
    console.log('[experience-live]', name)
    try {
      const result = await operation()
      ;(report.checks as string[]).push(name)
      return result
    } catch (error) {
      // One fresh request for malformed model JSON; never repair or accept invalid output.
      if (!name.endsWith('-format-retry') && error instanceof Error && /JSON/.test(error.message)) {
        report.formatRetries ??= []
        ;(report.formatRetries as unknown[]).push({ stage: name, error: error.message })
        return run(name + '-format-retry', operation)
      }
      throw error
    }
  }
  try {
    const configuration = loadAiCommerceConfiguration()
    if (!configuration) throw new Error('AI configuration unavailable')
    const credentials = process.env.SES_EXPERIENCE_CREDENTIAL_DIRECTORY ?? join(app.getPath('appData'), 'ses-agent-desktop', 'security')
    const aiCommerce = new AiCommerceNativeClient(configuration, {
      credentialStore: new SafeStorageJsonCredentialVault(
        join(credentials, 'aicommerce-native-credential.v1'),
        parseAiCommerceNativeCredential
      ),
      pendingAuthorizationStore: new SafeStorageJsonCredentialVault(
        join(credentials, 'aicommerce-native-pending-authorization.v1'),
        parseAiCommercePendingAuthorization
      ),
      openExternal: async () => {
        throw new Error('Sign in through the application before live verification')
      },
      fetch: (input, init) => net.fetch(input instanceof URL ? input.toString() : input, init)
    })
    const streamResponses = aiCommerce.streamResponses.bind(aiCommerce)
    aiCommerce.streamResponses = async (input) => {
      const result = await streamResponses(input)
      if (input.operationId?.endsWith('-match-assess')) report.matchingRaw = result.content
      return result
    }
    const state = await aiCommerce.getState()
    if (state.connection !== 'connected') throw new Error('AI service is not connected')
    const localAi = createLocalAiRuntime({ macExecutablePath: join(root, 'build/native/macos/ses-vision-ocr') })
    const gates = () =>
      loadCloudPrivacyGates({
        packaged: false,
        resourcesPath: process.resourcesPath,
        appPath: root,
        sourceRoot: root,
        platform: process.platform,
        arch: process.arch
      })
    const cloud = new AgentCloudNarrativeService({
      repository,
      localNer: localAi.personNameDetector,
      aiCommerce,
      policyVersion: 'cloud-redaction-v2',
      loadGates: gates,
      allowLoopbackHttp: false
    })
    const model = resolveAgentChatModel(loadAgentChatModelCatalog(), defaultAgentChatModelKey)
    report.model = model.key
    const notes = 'Java APIの実装と単体テストは本人が担当。基本設計はリーダーが担当し、本人は設計書のレビューを補助した。'
    const questions = [
      {
        id: randomUUID(),
        text: 'Java APIで担当した実装と単体テストを説明してください。',
        requirement: 'Java API',
        source: 'match' as const,
        sourceLabel: 'Java API',
        selected: true
      },
      {
        id: randomUUID(),
        text: '基本設計を独力で担当した具体例と設計判断を説明してください。',
        requirement: '基本設計',
        source: 'match' as const,
        sourceLabel: '基本設計',
        selected: true
      }
    ]
    const answers = await run('link-recorded-interview-answers', () =>
      cloud.analyzeInterviewAnswers({ source: { notes, questions }, model, signal: deadline })
    )
    if (answers.length !== 2 || answers.some((a) => a.quote && !notes.includes(a.quote)) || !answers.some((a) => a.quote.includes('本人')))
      throw new Error('Interview answer provenance failed')
    report.answers = answers
    const scope = { kind: 'personal' as const, owner: 'fixture', key: 'fixture', label: 'fixture', locale: 'ja-JP' as const }
    const source = {
      id: randomUUID(),
      runId: randomUUID(),
      questionId: randomUUID(),
      text: 'Java APIを設計した経験がある場合、本人の担当範囲、設計の選択理由と検証方法を具体的に説明してください。',
      requirement: 'Java API',
      scope,
      bankId: null,
      createdAt: new Date().toISOString()
    }
    const draft = validateQuestionTemplate(
      await run('draft-revised-question-template', () => cloud.draftQuestionTemplate({ source, model, signal: deadline })),
      source
    )
    const bank = {
      ...draft,
      id: randomUUID(),
      version: 1,
      scope,
      enabled: true,
      locked: false,
      reason: 'fixture',
      createdAt: source.createdAt,
      updatedAt: source.createdAt,
      sources: 3,
      adoptions: 5,
      edits: 5,
      state: 'available' as const,
      text: 'Java APIの経験を説明してください。',
      scoringGuide: '関連経験を確認する。'
    }
    const heldout = [
      { ...source, id: randomUUID(), text: 'Java APIで担当した設計範囲と、選択理由や検証方法を実例で説明してください。' },
      {
        ...source,
        id: randomUUID(),
        text: 'Java APIの設計経験について、本人の判断内容、代替案との比較と検証方法を具体的に説明してください。'
      }
    ]
    const comparison = await run('compare-independent-question-wordings', () =>
      cloud.compareBankQuestions({ current: bank, candidate: draft, sources: heldout, model, signal: deadline })
    )
    report.template = {
      draft,
      comparison,
      eligible: comparison.preferred === 'candidate' && comparison.comparisons.every((r) => !r.regression && r.candidate > r.current)
    }
    const duplicate = await run('verify-semantic-duplicate-protocol', () =>
      cloud.compareBankQuestions({
        current: { ...bank, text: draft.text, scoringGuide: draft.scoringGuide },
        candidate: draft,
        sources: [source],
        model,
        signal: deadline
      })
    )
    if (
      !duplicate.equivalent ||
      duplicate.preferred === 'candidate' ||
      duplicate.comparisons.some((r) => r.regression || r.current !== r.candidate)
    )
      throw new Error('Identical question comparison must tie')
    report.duplicate = duplicate
    report.status = 'passed'
    report.effectiveness = 'Synthetic live integration verified; no claim of production hiring improvement'
  } catch (error) {
    report.status = 'blocked'
    report.error = error instanceof Error ? error.message : 'Verification failed'
    process.exitCode = 1
  } finally {
    report.finishedAt = new Date().toISOString()
    await mkdir(resolve(root, 'output/system-experience'), { recursive: true })
    await writeFile(reportPath, JSON.stringify(report, null, 2) + '\n')
    await writeFile(
      reportPath.replace('growth-v3-live-report.json', `growth-v3-live-${String(report.startedAt).replace(/[:.]/g, '-')}.json`),
      JSON.stringify(report, null, 2) + '\n'
    )
    repository.close()
    await rm(directory, { recursive: true, force: true })
    console.log(
      '[experience-live-result]',
      JSON.stringify({ status: report.status, calls: report.calls, reportPath, error: report.error ?? null })
    )
    app.exit(report.status === 'passed' ? 0 : 1)
  }
}
void main().catch((error) => {
  console.error('[experience-live] startup failed', error instanceof Error ? error.message : 'unknown')
  app.exit(1)
})
