import type { BusinessGrowthStore } from './business-growth-store'
import type { QuestionBankStore } from './question-bank-store'
import type { SystemExperienceStore } from './system-experience-store'
import type { WorkRulesStore } from './work-rules-store'
import type { BusinessProgressStore } from './business-progress-store'
import type { PersonnelStore } from './personnel-store'
import type { ActionRuntimeStore } from './action-runtime-store'
import type { AgentConversationStore } from './agent-conversation-store'
import type { BroadcastStore } from './broadcast-store'
import type { CandidateEvaluationStore } from './candidate-evaluation-store'
import type { CandidateInterviewStore } from './candidate-interview-store'
import type { CandidateMatchStore } from './candidate-match-store'
import type { CandidateStore } from './candidate-store'
import type { GmailStore } from './gmail-store'
import type { JobCaseSeenStore } from './job-case-seen-store'
import type { JobCaseStore } from './job-case-store'
import type { LocalSettingsStore } from './local-settings-store'
import type { MaintenanceStore } from './maintenance-store'
import type { PrivacyStore } from './privacy-store'
import type { ProcessingJobStore } from './processing-job-store'
import type { ProposalStore } from './proposal-store'
import type { WorkTaskStore } from './work-task-store'
import type { PersonCaseMatchStore } from './person-case-match-store'
import type { RecommendationPointsStore } from './recommendation-points-store'

export interface StoreRegistry {
  growth: BusinessGrowthStore
  questionBank: QuestionBankStore
  experience: SystemExperienceStore
  workRules: WorkRulesStore
  readonly businessProgress: BusinessProgressStore
  readonly personnel: PersonnelStore
  readonly actionRuntime: ActionRuntimeStore
  readonly agentConversations: AgentConversationStore
  readonly broadcast: BroadcastStore
  readonly candidateEvaluation: CandidateEvaluationStore
  readonly candidateInterviews: CandidateInterviewStore
  readonly candidateMatch: CandidateMatchStore
  readonly candidates: CandidateStore
  readonly gmail: GmailStore
  readonly jobCaseSeen: JobCaseSeenStore
  readonly jobCases: JobCaseStore
  readonly localSettings: LocalSettingsStore
  readonly maintenance: MaintenanceStore
  readonly privacy: PrivacyStore
  readonly processingJobs: ProcessingJobStore
  readonly proposals: ProposalStore
  readonly workTasks: WorkTaskStore
  readonly personCaseMatches: PersonCaseMatchStore
  readonly recommendationPoints: RecommendationPointsStore
}
