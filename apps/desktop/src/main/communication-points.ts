import { randomUUID } from 'node:crypto'
import { businessModel } from './business-model'
import {
  communicationPointsQuerySchema,
  generateCommunicationPointsInputSchema,
  type CommunicationPoint,
  type CommunicationPointsQuery,
  type CommunicationPointsRecord,
  type CommunicationPointsView,
  type GenerateCommunicationPointsInput
} from '@shared'
import type { MainIpcContext } from './ipc/context'
import type { CommunicationPointsInput } from './agent-cloud-narrative'
import { effectiveApplicationPreferences } from './app-defaults'
import { withLearningForeground } from './learning-activity'

type Context = Pick<MainIpcContext, 'repository' | 'agentChatModelCatalog'> & {
  agentNarrativeStreamer:
    { generateCommunicationPoints?(input: CommunicationPointsInput): Promise<CommunicationPoint[]> } | null | undefined
}

const staleMessage = '人员或案件资料已更新，请重新生成沟通要点。 / 要員または案件の情報が更新されました。確認事項を再生成してください。'

function versionsOf(context: Pick<Context, 'repository'>, query: CommunicationPointsQuery) {
  const profileVersion = context.repository.getCandidateProfileForAssessment(query.documentId)?.profileVersion ?? null
  const job = context.repository.getJobCaseReview(query.reviewId)
  return { profileVersion, jobCaseVersion: job?.lifecycle === 'active' ? (job.jobCase?.version ?? null) : null }
}

/** The stored points of a pair; stale when the profile or case version changed, or either is gone. */
export function getCommunicationPoints(context: Pick<Context, 'repository'>, raw: CommunicationPointsQuery): CommunicationPointsView {
  const query = communicationPointsQuerySchema.parse(raw)
  const record = context.repository.getCommunicationPoints(query.documentId, query.reviewId)
  if (!record) return { record: null, stale: false }
  const current = versionsOf(context, query)
  return { record, stale: current.profileVersion !== record.profileVersion || current.jobCaseVersion !== record.jobCaseVersion }
}

/**
 * Generates 沟通要点 for one person and case through the redacted cloud path and stores them. The model sees the
 * resume, the case, the requirements the stored check left open and what HR already plans to ask. Concurrent
 * requests for the same pair share one call; points for a profile or case that changed meanwhile are not stored.
 */
export function createCommunicationPointsGenerator(context: Context) {
  const active = new Map<string, Promise<CommunicationPointsView>>()
  return (raw: GenerateCommunicationPointsInput): Promise<CommunicationPointsView> => {
    const query = generateCommunicationPointsInputSchema.parse(raw)
    const key = `${query.documentId}:${query.reviewId}`
    const existing = active.get(key)
    if (existing) return existing
    const promise = withLearningForeground(async () => {
      const profile = context.repository.getCandidateProfileForAssessment(query.documentId)
      if (!profile) throw new Error('人员资料不可用。 / 要員情報が利用できません。')
      const job = context.repository.getJobCaseReview(query.reviewId)
      if (!job || job.lifecycle !== 'active' || !job.jobCase) throw new Error('案件已删除或已停用。 / 案件が削除されたか停止されています。')
      const jobCase = job.jobCase
      const cloud = context.agentNarrativeStreamer
      if (!cloud?.generateCommunicationPoints) throw new Error('请先连接云端 AI。 / Cloud AIに接続してください。')
      const latest = context.repository.listCaseAssessments(jobCase.id).find((item) => item.documentId === query.documentId)
      const confirmations = context.repository.listRequirementConfirmations(query.documentId)
      const asked = confirmations.filter(
        (item) =>
          item.outcome === 'asking' &&
          (item.scope === 'person' || (item.jobCaseId === jobCase.id && item.jobCaseVersion === jobCase.version))
      )
      const model = businessModel(context, 'writing')
      const locale = effectiveApplicationPreferences(context.repository).locale
      const source = context.repository.getJobCaseSourceText(query.reviewId)
      const points = await cloud.generateCommunicationPoints({
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
        openRequirements: (latest?.jobCaseVersion === jobCase.version ? (latest.result.qualification?.requirements ?? []) : []).flatMap(
          (item) => (item.outcome === 'met' ? [] : [{ label: item.requirement.label, outcome: item.outcome }])
        ),
        alreadyListed: [
          ...asked.map((item) => item.question ?? item.requirementLabel),
          ...(latest?.appliedRules ?? []).filter((rule) => rule.kind === 'confirm').map((rule) => rule.text)
        ],
        ...(query.request ? { operatorRequest: query.request } : {})
      })
      const current = versionsOf(context, query)
      if (current.profileVersion !== profile.profileVersion || current.jobCaseVersion !== jobCase.version) throw new Error(staleMessage)
      const record: CommunicationPointsRecord = {
        documentId: query.documentId,
        reviewId: query.reviewId,
        profileVersion: profile.profileVersion,
        jobCaseVersion: jobCase.version,
        locale,
        points,
        request: query.request ?? null,
        generatedAt: new Date().toISOString(),
        modelName: model.displayName
      }
      if (!context.repository.saveCommunicationPoints(record)) throw new Error(staleMessage)
      return { record, stale: false }
    }).finally(() => active.delete(key))
    active.set(key, promise)
    return promise
  }
}
