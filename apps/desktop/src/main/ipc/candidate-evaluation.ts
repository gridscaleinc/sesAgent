import { lstat, readFile } from 'node:fs/promises'
import { extname } from 'node:path'
import { dialog, ipcMain } from 'electron'
import { candidateBenchmarkQueryFromJobCase } from '@job-cases'
import { localEmbeddingModel, localRerankerModel } from '@local-ai'
import { detectDirectIdentifiers } from '@privacy'
import { evaluateSesCandidateBenchmark } from '@resume'
import {
  type CandidateEvaluationAuthoringWorkspace,
  type EvaluateCandidateEvaluationDraftResult,
  type ImportCandidateEvaluationBenchmarkResult,
  type SesCandidateBenchmark,
  candidateEvaluationAuthoringWorkspaceSchema,
  createCandidateEvaluationDraftInputSchema,
  deleteCandidateEvaluationDraftCaseInputSchema,
  evaluateCandidateEvaluationDraftInputSchema,
  ipcChannels,
  saveCandidateEvaluationDraftCaseInputSchema,
  sesCandidateBenchmarkSchema
} from '@shared'
import { assertTrustedSender, type MainIpcContext } from './context'

/** Local SES benchmark authoring, import and quality-gate evaluation. */
export function registerCandidateEvaluationHandlers(context: MainIpcContext) {
  const { repository, candidateRetrieval, localRerankerEnabled, currentOperator } = context
  let candidateEvaluationBusy = false

  const candidateEvaluationAuthoringWorkspace = (): CandidateEvaluationAuthoringWorkspace => {
    const jobCases = repository.listActiveJobCases().flatMap((jobCase) => {
      const query = candidateBenchmarkQueryFromJobCase(jobCase)
      const title = jobCase.fields.find((field) => field.key === 'title')?.value ?? `案件 ${jobCase.id.slice(0, 8)}`
      return query.length >= 2 && detectDirectIdentifiers(`${title}\n${query}`).length === 0
        ? [{ id: jobCase.id, version: jobCase.version, title, query }]
        : []
    })
    const candidates = repository.listEligibleTalentProfiles().map((profile) => ({
      id: profile.id,
      version: profile.profileVersion,
      anonymousLabel: `候補者 ${profile.id.slice(0, 8).toLocaleUpperCase('en-US')}`,
      skills: profile.fields.find((field) => field.key === 'skills')?.value ?? null,
      experienceYears: profile.fields.find((field) => field.key === 'experience_years')?.value ?? null,
      availability: profile.fields.find((field) => field.key === 'availability')?.value ?? null,
      rate: profile.fields.find((field) => field.key === 'rate')?.value ?? null,
      japaneseLevel: profile.fields.find((field) => field.key === 'japanese_level')?.value ?? null,
      workStyle: profile.fields.find((field) => field.key === 'work_style')?.value ?? null,
      role: profile.fields.find((field) => field.key === 'role')?.value ?? null,
      fields: profile.fields,
      projectExperiences: profile.projectExperiences,
      projectExperienceCount: profile.projectExperiences.length
    }))
    return candidateEvaluationAuthoringWorkspaceSchema.parse({
      draft: repository.getCandidateEvaluationDraft(),
      jobCases,
      candidates
    })
  }

  const evaluateCandidateBenchmark = async (benchmark: SesCandidateBenchmark) => {
    const profiles = repository.listEligibleTalentProfiles()
    const candidateLabelCounts = new Map<string, number>()
    for (const profile of profiles) {
      const label = `候補者 ${profile.id.slice(0, 8).toLocaleUpperCase('en-US')}`
      candidateLabelCounts.set(label, (candidateLabelCounts.get(label) ?? 0) + 1)
    }
    const referencedLabels = new Set(benchmark.cases.flatMap((testCase) => testCase.relevantCandidateLabels))
    const ambiguousLabels = [...referencedLabels].filter((label) => (candidateLabelCounts.get(label) ?? 0) > 1)
    if (ambiguousLabels.length > 0) {
      throw new Error('匿名候補者番号が現在の候補者庫で重複しています。評価セットを作り直してください。')
    }
    return evaluateSesCandidateBenchmark(
      benchmark,
      new Set(candidateLabelCounts.keys()),
      (query, maxResults) => candidateRetrieval.search(profiles, query, maxResults),
      localRerankerEnabled
        ? {
            id: `${localEmbeddingModel.id}+${localRerankerModel.id}`,
            revision: `${localEmbeddingModel.revision}+${localRerankerModel.revision}`,
            algorithmVersion: 'hard-filter-hybrid-local-rerank-v1'
          }
        : { id: localEmbeddingModel.id, revision: localEmbeddingModel.revision }
    )
  }

  ipcMain.handle(ipcChannels.getCandidateEvaluationAuthoringWorkspace, (event): CandidateEvaluationAuthoringWorkspace => {
    assertTrustedSender(event)
    return candidateEvaluationAuthoringWorkspace()
  })

  ipcMain.handle(ipcChannels.createCandidateEvaluationDraft, (event, rawInput): CandidateEvaluationAuthoringWorkspace => {
    assertTrustedSender(event)
    const input = createCandidateEvaluationDraftInputSchema.parse(rawInput)
    repository.createCandidateEvaluationDraft(input)
    return candidateEvaluationAuthoringWorkspace()
  })

  ipcMain.handle(ipcChannels.saveCandidateEvaluationDraftCase, (event, rawInput): CandidateEvaluationAuthoringWorkspace => {
    assertTrustedSender(event)
    const input = saveCandidateEvaluationDraftCaseInputSchema.parse(rawInput)
    const operator = currentOperator()
    repository.saveCandidateEvaluationDraftCase(input, operator.operatorId, operator.displayName)
    return candidateEvaluationAuthoringWorkspace()
  })

  ipcMain.handle(ipcChannels.deleteCandidateEvaluationDraftCase, (event, rawInput): CandidateEvaluationAuthoringWorkspace => {
    assertTrustedSender(event)
    const input = deleteCandidateEvaluationDraftCaseInputSchema.parse(rawInput)
    repository.deleteCandidateEvaluationDraftCase(input)
    return candidateEvaluationAuthoringWorkspace()
  })

  ipcMain.handle(
    ipcChannels.evaluateCandidateEvaluationDraft,
    async (event, rawInput): Promise<EvaluateCandidateEvaluationDraftResult> => {
      assertTrustedSender(event)
      const input = evaluateCandidateEvaluationDraftInputSchema.parse(rawInput)
      if (candidateEvaluationBusy) throw new Error('別の候補者評価が進行中です。')
      candidateEvaluationBusy = true
      try {
        const benchmark = repository.buildCandidateEvaluationBenchmark(input.draftId, input.expectedRevision)
        const report = await evaluateCandidateBenchmark(benchmark)
        return {
          workspace: candidateEvaluationAuthoringWorkspace(),
          state: repository.saveCandidateEvaluation(benchmark, report)
        }
      } finally {
        candidateEvaluationBusy = false
      }
    }
  )

  ipcMain.handle(
    ipcChannels.importCandidateEvaluationBenchmark,
    async (event): Promise<ImportCandidateEvaluationBenchmarkResult> => {
      assertTrustedSender(event)
      if (candidateEvaluationBusy) throw new Error('別の候補者評価が進行中です。')
      candidateEvaluationBusy = true
      try {
        const selection = await dialog.showOpenDialog({
          title: '脱敏済み SES 候補者評価セットを選択',
          filters: [{ name: 'SES Candidate Benchmark', extensions: ['json'] }],
          properties: ['openFile', 'dontAddToRecent']
        })
        if (selection.canceled || selection.filePaths.length !== 1) {
          return { cancelled: true, state: repository.getCandidateEvaluationState() }
        }
        const inputPath = selection.filePaths[0]!
        const file = await lstat(inputPath)
        if (!file.isFile() || file.isSymbolicLink()) throw new Error('評価セットは通常の JSON ファイルを選択してください。')
        if (file.size <= 0 || file.size > 1024 * 1024) throw new Error('評価セットは 1 MB 以下である必要があります。')
        if (extname(inputPath).toLocaleLowerCase('en-US') !== '.json') throw new Error('評価セットは .json 形式である必要があります。')
        let raw: unknown
        try {
          raw = JSON.parse(await readFile(inputPath, 'utf8'))
        } catch {
          throw new Error('評価セットの JSON を読み取れませんでした。')
        }
        const benchmark = sesCandidateBenchmarkSchema.parse(raw)
        const privacyText = [benchmark.name, ...benchmark.cases.map((testCase) => testCase.query)].join('\n')
        const identifiers = detectDirectIdentifiers(privacyText)
        if (identifiers.length > 0 || /<(?:PERSON_NAME|PHONE|EMAIL|ADDRESS|PRIVATE_EMAIL)_\d+>/iu.test(privacyText)) {
          throw new Error('評価セットに個人識別情報または PII 占位符が含まれています。脱敏済み条件だけを使用してください。')
        }
        const report = await evaluateCandidateBenchmark(benchmark)
        return {
          cancelled: false,
          state: repository.saveCandidateEvaluation(benchmark, report)
        }
      } finally {
        candidateEvaluationBusy = false
      }
    }
  )
}
