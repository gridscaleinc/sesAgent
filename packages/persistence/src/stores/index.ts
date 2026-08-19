import type Database from 'better-sqlite3-multiple-ciphers'

import { ActionRuntimeStore } from './action-runtime-store'
import { AgentConversationStore } from './agent-conversation-store'
import type { StoreContext } from './base'
import { CandidateEvaluationStore } from './candidate-evaluation-store'
import { CandidateInterviewStore } from './candidate-interview-store'
import { CandidateMatchStore } from './candidate-match-store'
import { CandidateStore } from './candidate-store'
import { GmailStore } from './gmail-store'
import { JobCaseStore } from './job-case-store'
import { LocalSettingsStore } from './local-settings-store'
import { MaintenanceStore } from './maintenance-store'
import { PrivacyStore } from './privacy-store'
import { ProcessingJobStore } from './processing-job-store'
import { ProposalStore } from './proposal-store'
import type { StoreRegistry } from './registry'
import { WorkTaskStore } from './work-task-store'

export type { StoreContext } from './base'
export type { StoreRegistry } from './registry'

/**
 * Builds every domain store over one database connection. Stores may call each
 * other, so the registry is attached to the shared context after construction;
 * nothing reads it until a repository method runs.
 */
export function createStoreRegistry(options: {
  database: Database.Database
  databaseKey: Buffer
  mappingKey: Buffer
}): StoreRegistry {
  const context: StoreContext = {
    database: options.database,
    databaseKey: options.databaseKey,
    mappingKey: options.mappingKey,
    stores: undefined as unknown as StoreRegistry
  }

  const stores: StoreRegistry = {
    actionRuntime: new ActionRuntimeStore(context),
    agentConversations: new AgentConversationStore(context),
    candidateEvaluation: new CandidateEvaluationStore(context),
    candidateInterviews: new CandidateInterviewStore(context),
    candidateMatch: new CandidateMatchStore(context),
    candidates: new CandidateStore(context),
    gmail: new GmailStore(context),
    jobCases: new JobCaseStore(context),
    localSettings: new LocalSettingsStore(context),
    maintenance: new MaintenanceStore(context),
    privacy: new PrivacyStore(context),
    processingJobs: new ProcessingJobStore(context),
    proposals: new ProposalStore(context),
    workTasks: new WorkTaskStore(context)
  }

  context.stores = stores
  return stores
}
