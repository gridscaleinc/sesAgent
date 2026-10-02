import { randomUUID } from 'node:crypto'
import { businessModel } from './business-model'
import {
  recommendationPointsQuerySchema,
  generateRecommendationPointsInputSchema,
  type GenerateRecommendationPointsInput,
  type RecommendationPointsQuery,
  type RecommendationPointsRecord,
  type RecommendationPointsView
} from '@shared'
import type { MainIpcContext } from './ipc/context'
import type { RecommendationPointsInput, RecommendationPointsResult } from './agent-cloud-narrative'
import { effectiveApplicationPreferences } from './app-defaults'
import { withLearningForeground } from './learning-activity'

type Context = Pick<MainIpcContext, 'repository' | 'agentChatModelCatalog'> & {
  agentNarrativeStreamer:
    { generateRecommendationPoints?(input: RecommendationPointsInput): Promise<RecommendationPointsResult> } | null | undefined
}

const staleMessage = '人员或案件资料已更新，请重新生成推荐要点。 / 要員または案件の情報が更新されました。推薦ポイントを再生成してください。'

/** The person's current profile and the active, confirmed case of one pair; throws when either is not usable. */
function load(context: Context, query: RecommendationPointsQuery) {
  const profile = context.repository.getCandidateProfileForAssessment(query.documentId)
  if (!profile) throw new Error('人员资料不可用。 / 要員情報が利用できません。')
  const job = context.repository.getJobCaseReview(query.reviewId)
  if (!job || job.lifecycle !== 'active' || !job.jobCase) throw new Error('案件已删除或已停用。 / 案件が削除されたか停止されています。')
  return { profile, job, jobCaseVersion: job.jobCase.version }
}

function versionsOf(context: Context, query: RecommendationPointsQuery) {
  const profileVersion = context.repository.getCandidateProfileForAssessment(query.documentId)?.profileVersion ?? null
  const job = context.repository.getJobCaseReview(query.reviewId)
  return { profileVersion, jobCaseVersion: job?.lifecycle === 'active' ? (job.jobCase?.version ?? null) : null }
}

/** The stored points of a pair; stale when the profile or case version changed, or either is gone. */
export function getRecommendationPoints(context: Pick<Context, 'repository'>, raw: RecommendationPointsQuery): RecommendationPointsView {
  const query = recommendationPointsQuerySchema.parse(raw)
  const record = context.repository.getRecommendationPoints(query.documentId, query.reviewId)
  if (!record) return { record: null, stale: false }
  const current = versionsOf(context as Context, query)
  return { record, stale: current.profileVersion !== record.profileVersion || current.jobCaseVersion !== record.jobCaseVersion }
}

/**
 * Generates 推荐要点 for one person and case through the redacted cloud path and stores them. Concurrent requests
 * for the same pair share one call. Points written for a profile or case that changed meanwhile are not stored.
 */
export function createRecommendationPointsGenerator(context: Context) {
  const active = new Map<string, Promise<RecommendationPointsView>>()
  return (raw: GenerateRecommendationPointsInput): Promise<RecommendationPointsView> => {
    const query = generateRecommendationPointsInputSchema.parse(raw)
    const key = `${query.documentId}:${query.reviewId}`
    const existing = active.get(key)
    if (existing) return existing
    const promise = withLearningForeground(async () => {
      const { profile, job, jobCaseVersion } = load(context, query)
      const cloud = context.agentNarrativeStreamer
      if (!cloud?.generateRecommendationPoints) throw new Error('请先连接云端 AI。 / Cloud AIに接続してください。')
      const model = businessModel(context, 'writing')
      const locale = effectiveApplicationPreferences(context.repository).locale
      const source = context.repository.getJobCaseSourceText(query.reviewId)
      const generated = await cloud.generateRecommendationPoints({
        conversationId: randomUUID(),
        requestId: randomUUID(),
        locale,
        model,
        signal: AbortSignal.timeout(90_000),
        onClientRequestId: () => undefined,
        person: {
          facts: profile.fields.flatMap((field) => (field.value ? [{ label: field.label, value: field.value }] : [])),
          projects: profile.projectExperiences.map(({ title, period, role, technologies, summary }) => ({
            title,
            period,
            role,
            technologies,
            summary
          }))
        },
        jobCase: {
          title: job.fields.find((field) => field.key === 'title')?.value ?? job.redactedSubject,
          // Business facts only: database IDs, sender domain and source metadata stay local.
          fields: job.fields.flatMap((field) =>
            field.value && field.status !== 'missing' ? [{ label: field.label, value: field.value }] : []
          ),
          body: source?.redactedBody ?? null
        },
        ...(query.request ? { operatorRequest: query.request } : {})
      })
      const current = versionsOf(context, query)
      if (current.profileVersion !== profile.profileVersion || current.jobCaseVersion !== jobCaseVersion) throw new Error(staleMessage)
      const record: RecommendationPointsRecord = {
        documentId: query.documentId,
        reviewId: query.reviewId,
        profileVersion: profile.profileVersion,
        jobCaseVersion,
        locale,
        points: generated.points,
        emptyReason: generated.emptyReason,
        generatedAt: new Date().toISOString(),
        modelName: model.displayName
      }
      if (!context.repository.saveRecommendationPoints(record)) throw new Error(staleMessage)
      return { record, stale: false }
    }).finally(() => active.delete(key))
    active.set(key, promise)
    return promise
  }
}
