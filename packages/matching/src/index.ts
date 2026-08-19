import { createHash } from 'node:crypto'
import type {
  BusinessPriorityLevel,
  BusinessPriorityProjection,
  CandidateMatchRunSummary,
  MatchRunValidity,
  ProposalDraftStatus,
  ProposalFollowUpStage
} from '@shared/contracts'

export interface MatchRuntimeIdentity {
  algorithmVersion: CandidateMatchRunSummary['algorithmVersion']
  hardFilterPolicyVersion: CandidateMatchRunSummary['hardFilterPolicyVersion']
  embeddingModelId: string
  embeddingModelRevision: string
  rerankerModelId: string | null
  rerankerModelRevision: string | null
}

export interface MatchRunValidityContext extends MatchRuntimeIdentity {
  jobCaseId: string
  jobCaseVersion: number
  candidatePoolFingerprint: string
  explicitlyInvalidated: boolean
}

export function candidatePoolFingerprint(
  profiles: ReadonlyArray<{ id: string; profileVersion: number }>
): string {
  const identity = profiles
    .map((profile) => ({ id: profile.id, version: profile.profileVersion }))
    .toSorted((left, right) => left.id.localeCompare(right.id) || left.version - right.version)
  return createHash('sha256').update(JSON.stringify(identity)).digest('hex')
}

export function evaluateMatchRunValidity(
  run: CandidateMatchRunSummary,
  context: MatchRunValidityContext
): MatchRunValidity {
  if (context.explicitlyInvalidated || run.binding === null) return 'invalidated'
  if (
    run.binding.jobCaseId !== context.jobCaseId ||
    run.binding.jobCaseVersion !== context.jobCaseVersion
  ) return 'stale_job_case'
  if (run.binding.candidatePoolFingerprint !== context.candidatePoolFingerprint) {
    return 'stale_candidate_pool'
  }
  if (
    run.binding.embeddingModelId !== context.embeddingModelId ||
    run.binding.embeddingModelRevision !== context.embeddingModelRevision ||
    run.binding.rerankerModelId !== context.rerankerModelId ||
    run.binding.rerankerModelRevision !== context.rerankerModelRevision
  ) return 'stale_model'
  const algorithmCurrent = run.algorithmVersion === context.algorithmVersion || (
    context.algorithmVersion === 'hard-filter-hybrid-local-rerank-v1' &&
    run.algorithmVersion === 'hard-filter-hybrid-rrf-v1'
  )
  if (
    run.binding.policyVersion !== 'match-run-validity-v1' ||
    !algorithmCurrent ||
    run.hardFilterPolicyVersion !== context.hardFilterPolicyVersion
  ) return 'stale_policy'
  return 'current'
}

export interface BusinessPriorityInputs {
  caseTiming: string | null
  candidateAvailability: string | null
  proposalStatus: ProposalDraftStatus | null
  followUpStage: ProposalFollowUpStage | null
}

export interface ProjectedBusinessPriority {
  ruleVersion: BusinessPriorityProjection['ruleVersion']
  level: BusinessPriorityLevel
  reasons: string[]
  inputs: BusinessPriorityInputs
  inputSnapshotHash: string
}

function normalized(value: string | null): string {
  return value?.normalize('NFKC').trim().toLocaleLowerCase('ja-JP') ?? ''
}

export function projectBusinessPriority(inputs: BusinessPriorityInputs): ProjectedBusinessPriority {
  const caseTiming = normalized(inputs.caseTiming)
  const availability = normalized(inputs.candidateAvailability)
  const reasons: string[] = []
  let level: BusinessPriorityLevel = 'normal'

  if (inputs.followUpStage && ['accepted', 'declined', 'withdrawn'].includes(inputs.followUpStage)) {
    level = 'paused'
    reasons.push(`TERMINAL_FOLLOW_UP_${inputs.followUpStage.toLocaleUpperCase('en-US')}`)
  } else if (inputs.followUpStage || inputs.proposalStatus === 'exported' || inputs.proposalStatus === 'export_unknown') {
    level = 'follow_up'
    reasons.push(inputs.followUpStage ? 'FOLLOW_UP_IN_PROGRESS' : 'PROPOSAL_EXPORTED_CONFIRM_DELIVERY')
  } else if (/(?:稼働不可|参画不可|募集停止|保留)/u.test(`${caseTiming}\n${availability}`)) {
    level = 'paused'
    reasons.push('AVAILABILITY_OR_CASE_PAUSED')
  } else if (/(?:即日|急募|至急|今月|来月|すぐ)/u.test(caseTiming) || /(?:即日|稼働可|参画可)/u.test(availability)) {
    level = 'high'
    reasons.push('NEAR_TERM_CASE_OR_AVAILABILITY')
  } else {
    reasons.push('STANDARD_FOLLOW_UP_WINDOW')
  }

  if (!caseTiming) reasons.push('CASE_TIMING_UNKNOWN')
  if (!availability) reasons.push('CANDIDATE_AVAILABILITY_UNKNOWN')
  const normalizedInputs: BusinessPriorityInputs = {
    caseTiming: inputs.caseTiming?.trim() || null,
    candidateAvailability: inputs.candidateAvailability?.trim() || null,
    proposalStatus: inputs.proposalStatus,
    followUpStage: inputs.followUpStage
  }
  return {
    ruleVersion: 'business-priority-v1',
    level,
    reasons,
    inputs: normalizedInputs,
    inputSnapshotHash: createHash('sha256').update(JSON.stringify({
      ruleVersion: 'business-priority-v1',
      inputs: normalizedInputs
    })).digest('hex')
  }
}
