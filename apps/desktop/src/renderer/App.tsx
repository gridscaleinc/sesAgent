import { isInactiveProgressStage, matchFollowUpLabels } from '@shared'
import { CaseResumeAssessmentPanel } from './components/CaseResumeAssessmentPanel'
import { useCaseResumeAssessments } from './components/use-case-resume-assessments'
import {
  MatchingOpportunitiesBanner,
  MatchingOpportunitiesPage,
  useMatchingOpportunities,
  type OpportunityGrouping
} from './components/MatchingOpportunities'
import { setActiveCaseVersions, usePersonCaseMatchCounts } from './person-case-match-cache'
import { BusinessProgressContext, progressPairKey, useBusinessProgressData } from './business-progress-data'
import { BusinessProgressOverview } from './components/BusinessProgressOverview'
import { CaseIntroductionComposer, type CaseIntroductionTarget } from './components/CaseIntroductionComposer'
import type { FollowUpTarget } from './components/follow-up-target'
import { HrProgressWorkbench } from './components/HrProgressWorkbench'
import { ResumeImportHistory } from './components/ResumeImportHistory'
import { HrObjectList } from './components/HrObjectList'
import { readHrPosition, saveHrPosition, type HrBusinessKind, type HrListFilter } from './hr-business-navigation'
import { HrMatchingWorkspace, type HrMatchSource, type IntroductionTarget } from './components/HrMatchingWorkspace'
import { IntroductionComposer } from './components/IntroductionComposer'
import { BusinessIntakeWorkspace } from './components/BusinessIntakeWorkspace'
import { CaseTextImport } from './components/CaseTextImport'
import { PersonnelWorkspace } from './components/PersonnelWorkspace'
import { CandidateProfilePanel } from './components/CandidateProfilePanel'
import './components/business-workbench.css'
import type { BusinessFeedEntry, MatchingOpportunity, TrayNavigation, TypedAiConversationReference } from '@shared'
import { startTransition, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { WorkTask } from '@domain'
import type {
  BootstrapPayload,
  AiConversationSnapshot,
  AgentSystemAccessBlock,
  CandidateMatchResult,
  CandidateMatchRunSummary,
  CandidateReviewSnapshot,
  JobCaseReviewSnapshot,
  NewJobCaseDigest,
  ProposalMutationResult,
  ProposalWorkspaceSnapshot,
  SubmitCandidateMatchFeedbackInput,
  SubmitCandidateMatchFeedbackResult,
  StartupStatus
} from '@shared'
import { GovernancePanel } from './components/GovernancePanel'
import { CandidatePipeline, type PipelineView } from './components/CandidatePipeline'
import { RecruitingInterviewWorkspace } from './components/CandidateWorkspaces'
import { ResumeImportProgressDrawer, progressFiles, type ResumeImportProgress } from './components/ResumeImportProgressDrawer'
import { InterviewScheduleCenter, type InterviewScheduleRoute } from './components/InterviewScheduleCenter'
import { CommandPalette, type BusinessCommand, type CommandText } from './components/CommandPalette'
import { JobCaseInbox, type GmailImportNotice } from './components/JobCaseInbox'
import { Icon } from './components/Icon'
import { ApplicationSettingsDialog, type ApplicationSettingsSection } from './components/ApplicationSettingsDialog'
import { AiCommerceMemberDialog } from './components/AiCommerceMemberDialog'
import { LocalOperatorProfileDialog } from './components/LocalOperatorProfileDialog'
import { buildReviewQueue, ReviewCenter } from './components/ReviewCenter'
import type { AppView } from './app-view'
import { TaskList, workTaskTypeLabel } from './components/TaskList'
import { TaskWorkspace } from './components/TaskWorkspace'
import { AgentWorkspace } from './components/AgentWorkspace'
import { pushContextAccess } from './context-trail'
import { AgentInterviewSchedulePanel } from './components/AgentInterviewSchedulePanel'
import { AgentBusinessWorkspacePanel } from './components/AgentBusinessWorkspacePanel'
import type { BroadcastPanelActions } from './components/BroadcastWorkspaceView'
import type { BroadcastSettingsActions } from './components/BroadcastSettingsSection'
import { AgentSystemRail } from './components/AgentSystemRail'
import { TodayOverview, useTodaySummary } from './components/TodayOverview'
import { StartupRecoveryScreen } from './components/StartupRecoveryScreen'
import { aiSignInRequestEvent, localeText, localizedIpcError, UiLocaleProvider, localizedTaskTitle, localizedMainText } from './i18n'
import { joinCreatedCases, revealCreatedCases } from './case-adoption'
import { HeldDeletionsNotice } from './components/HeldDeletionsNotice'
import { notifyBusinessDataChanged } from './business-data-events'

/** What the right workspace shows when nothing else was opened: today's arrivals. */
const defaultAgentContextTrail = (): AgentSystemAccessBlock[] => []

export function App() {
  const [bootstrap, setBootstrap] = useState<BootstrapPayload | null>(null)
  const businessProgress = useBusinessProgressData(bootstrap)
  const caseResumes = useCaseResumeAssessments(bootstrap?.preferences.locale ?? 'ja-JP')
  const personCaseMatches = usePersonCaseMatchCounts()
  const [assessmentReviewId, setAssessmentReviewId] = useState<string | null>(null)
  // 找人 results replace the case list in the main area; the list stays mounted underneath to keep its place.
  const [casePeopleOpen, setCasePeopleOpen] = useState(false)
  // While 找案件 results show, the side panel stays closed until something on the results page opens it.
  const [matchPanelHidden, setMatchPanelHidden] = useState(false)
  const [assessmentFocus, setAssessmentFocus] = useState<string | null>(null)
  const [sideProgressTarget, setSideProgressTarget] = useState<FollowUpTarget | null>(null)
  const [progressFocus, setProgressFocus] = useState<{ kind: HrBusinessKind; id: string; request: number } | null>(null)
  const [startupRecovery, setStartupRecovery] = useState<Extract<StartupStatus, { mode: 'recovery-required' }> | null>(null)
  const [selectedTask, setSelectedTask] = useState<WorkTask | null>(null)
  const [activeView, setActiveView] = useState<AppView>('agent')
  const [importHistoryOpen, setImportHistoryOpen] = useState(false)
  const [candidateWorkspaceDetail, setCandidateWorkspaceDetail] = useState<{
    scope: 'recruiting' | 'schedule'
    documentId: string
    view: PipelineView
    interviewId?: string | null
    interviewKind?: 'recruiting' | 'client'
  } | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [governanceOpen, setGovernanceOpen] = useState(false)
  const [gmailImportNotice, setGmailImportNotice] = useState<GmailImportNotice | null>(null)
  const [commandPaletteOpen, setCommandPaletteOpen] = useState(false)
  const [applicationSettingsOpen, setApplicationSettingsOpen] = useState(false)
  const [applicationSettingsSection, setApplicationSettingsSection] = useState<ApplicationSettingsSection>('general')
  const [applicationSettingsRequest, setApplicationSettingsRequest] = useState(0)
  const [aiCommerceOpen, setAiCommerceOpen] = useState(false)
  const [aiCommerceCallbackError, setAiCommerceCallbackError] = useState<string | null>(null)
  const [operatorProfileOpen, setOperatorProfileOpen] = useState(false)
  const [resumeImportProgress, setResumeImportProgress] = useState<ResumeImportProgress | null>(null)
  const [manualCaseRequestId, setManualCaseRequestId] = useState<number | null>(null)
  const [agentHistoryReloadToken, setAgentHistoryReloadToken] = useState(0)
  // The right-hand workspace keeps a trail of the screens it opened, so a
  // sub-page can step back to where it came from instead of only closing.
  const [agentHomeRequest, setAgentHomeRequest] = useState(0)
  const [hrKind, setHrKind] = useState<HrBusinessKind>(() => {
    try {
      return localStorage.getItem('ses-hr-kind-v2') === 'person' ? 'person' : 'case'
    } catch {
      return 'case'
    }
  })
  const [hrFollowOpen, setHrFollowOpen] = useState(false)
  const [hrFollowTarget, setHrFollowTarget] = useState<FollowUpTarget | null>(null)
  // Pairs a batch 「开始跟进」 created; the follow-up view opens the first and this notice lists every one.
  const [hrBatchStarted, setHrBatchStarted] = useState<FollowUpTarget[] | null>(null)
  const [hrSource, setHrSource] = useState<HrMatchSource | null>(null)
  // People whose 「找案件」 is running; only their cards and actions are locked, never the whole list.
  const [hrBusyIds, setHrBusyIds] = useState<string[]>([])
  useEffect(() => {
    // A burst of changes (a batch of 20 résumés, a case ended with its follow-ups) is one reload, not one per change.
    let timer: number | undefined,
      latest = 0
    const refresh = () => {
      window.clearTimeout(timer)
      timer = window.setTimeout(() => {
        // Only the newest read lands: a slow earlier one never overwrites fresher data.
        const request = ++latest
        void window.sesAgent
          .getBootstrap()
          .then((value) => {
            if (request === latest) setBootstrap(value)
          })
          .catch(() => undefined)
      }, 200)
    }
    window.addEventListener('ses-business-data-changed', refresh)
    return () => {
      window.clearTimeout(timer)
      window.removeEventListener('ses-business-data-changed', refresh)
    }
  }, [])
  // Badges 「查看案件 (n)」 count only cases still active at the version the run saw.
  useEffect(() => {
    if (!bootstrap) return
    setActiveCaseVersions(
      new Map(
        bootstrap.jobCaseReviews.flatMap((job) =>
          job.lifecycle === 'active' && job.jobCase ? [[job.jobCase.id, job.jobCase.version] as const] : []
        )
      )
    )
  }, [bootstrap?.jobCaseReviews])
  // Any AI surface can ask for the AI member sign-in (e.g. 「去登录」 after "AI 未登录").
  useEffect(() => {
    const open = () => setAiCommerceOpen(true)
    window.addEventListener(aiSignInRequestEvent, open)
    return () => window.removeEventListener(aiSignInRequestEvent, open)
  }, [])
  const [hrChatRequest, setHrChatRequest] = useState(0)
  // ⌘K 「创建新任务」 starts a fresh conversation instead of reopening the last one.
  const [hrNewChatRequest, setHrNewChatRequest] = useState(0)
  const [trayNavigation, setTrayNavigation] = useState<TrayNavigation | null>(null)
  const trayNavigationHandled = useRef(new Set<string>())
  const trayNavigationHandler = useRef<((navigation: TrayNavigation) => void) | null>(null)
  const [hrListFilterRequest, setHrListFilterRequest] = useState<{ kind: HrBusinessKind; filter: HrListFilter; id: number } | null>(null)
  // 新匹配机会 is a page of the section it was opened from; results opened from it return to it.
  const [opportunitiesOpen, setOpportunitiesOpen] = useState(false)
  const [opportunitiesSection, setOpportunitiesSection] = useState<HrBusinessKind>('case')
  const [opportunityReturn, setOpportunityReturn] = useState<{ kind: HrBusinessKind; id: string } | null>(null)
  const opportunities = useMatchingOpportunities(
    bootstrap !== null && activeView === 'agent' && !hrFollowOpen,
    bootstrap?.preferences.locale ?? 'ja-JP'
  )
  // 今天 is where the app opens; it stays underneath the results it opens, which return to it.
  const [todayOpen, setTodayOpen] = useState(false)
  const today = useTodaySummary(bootstrap !== null && startupRecovery === null, bootstrap?.preferences.locale ?? 'ja-JP')
  const [followUpFilterRequest, setFollowUpFilterRequest] = useState<{ filter: 'today' | 'active' | 'coordinating'; id: number } | null>(
    null
  )
  const [caseIntroductionTarget, setCaseIntroductionTarget] = useState<CaseIntroductionTarget | null>(null)
  const caseIntroductionPrepared = useCallback((review: JobCaseReviewSnapshot) => {
    setBootstrap((current) =>
      current
        ? { ...current, jobCaseReviews: current.jobCaseReviews.map((item) => (item.reviewId === review.reviewId ? review : item)) }
        : current
    )
    setCaseIntroductionTarget((current) =>
      current?.reviewId === review.reviewId && current.reviewRevision === review.reviewRevision
        ? { reviewId: review.reviewId, reviewRevision: review.reviewRevision, jobCaseVersion: review.jobCase!.version }
        : current
    )
  }, [])
  const [introductionTarget, setIntroductionTarget] = useState<IntroductionTarget | null>(null)
  const [agentSideMode, setAgentSideMode] = useState<'intake' | 'personnel' | 'profile' | null>(null)
  const [agentProfileId, setAgentProfileId] = useState<string | null>(null)
  const [agentFeedSelection, setAgentFeedSelection] = useState<string | null>(() => readHrPosition(hrKind).selected)
  const [agentPersonId, setAgentPersonId] = useState<string>()
  const [agentBatchSeed, setAgentBatchSeed] = useState<{ id: number; text: string }>()
  const [agentPersonFocusRequest, setAgentPersonFocusRequest] = useState<{
    id: number
    documentId: string
    section: 'view' | 'match' | 'promote'
  }>()
  const feedFocusSequence = useRef(0)
  const [caseFocusRequest, setCaseFocusRequest] = useState(0)
  const [agentFocusRequest, setAgentFocusRequest] = useState<{
    id: number
    caseReference: TypedAiConversationReference | null
    candidateDocumentId?: string
  }>()
  const [agentContextTrail, setAgentContextTrail] = useState<AgentSystemAccessBlock[]>(defaultAgentContextTrail)
  const agentContextAccess = agentContextTrail[agentContextTrail.length - 1] ?? null
  const [agentComposerDraft, setAgentComposerDraft] = useState('')
  const [newCaseDigest, setNewCaseDigest] = useState<NewJobCaseDigest | null>(null)
  // Short-lived, non-blocking notices; they disappear on their own.
  const [toasts, setToasts] = useState<Array<{ id: number; message: string }>>([])
  const [candidateMatch, setCandidateMatch] = useState<{
    taskId: string | null
    status: 'idle' | 'loading' | 'ready' | 'error'
    query: string
    run: CandidateMatchRunSummary | null
    results: CandidateMatchResult[]
    error: string | null
  }>({ taskId: null, status: 'idle', query: '', run: null, results: [], error: null })
  const [proposal, setProposal] = useState<{
    taskId: string | null
    status: 'idle' | 'loading' | 'ready' | 'error'
    workspace: ProposalWorkspaceSnapshot | null
    error: string | null
  }>({ taskId: null, status: 'idle', workspace: null, error: null })
  const candidateMatchRequest = useRef(0)
  const proposalRequest = useRef(0)
  const backgroundHydratedJobIds = useRef(new Set<string>())
  const resumeImportRequest = useRef(0)
  const initialRouteApplied = useRef(false)
  const commandPaletteOpener = useRef<HTMLElement | null>(null)
  /** Mirrors commandPaletteOpen synchronously so ⌘K right after a command closes the palette never reads a stale value. */
  const commandPaletteOpenRef = useRef(false)
  // ⌘1–5 (Ctrl on Windows) open the rail items 今天/案件/人员/跟进/Agent; refreshed each render so they act on current state.
  const railShortcuts = useRef<Array<() => void>>([])
  const candidateMatchStateRef = useRef(candidateMatch)
  candidateMatchStateRef.current = candidateMatch
  const hasActiveProcessingJobs = bootstrap?.processingJobs.some((job) => ['queued', 'running', 'retry_wait'].includes(job.status)) ?? false
  const activeProcessingJobCount =
    bootstrap?.processingJobs.filter((job) => ['queued', 'running', 'retry_wait'].includes(job.status)).length ?? 0
  const activeCaseCount =
    bootstrap?.jobCaseReviews.filter((review) => review.lifecycle === 'active' && review.status === 'completed').length ?? 0
  const eligibleCandidateCount = bootstrap?.candidateReviews.filter((review) => review.talentPoolStatus === 'eligible').length ?? 0
  const selectedTaskId = selectedTask?.id ?? null
  const commandPaletteAvailable = bootstrap !== null && startupRecovery === null && loadError === null
  const normalSessionReady = bootstrap !== null && startupRecovery === null
  const locale = bootstrap?.preferences.locale ?? 'ja-JP'
  // The Agent chat and the 批量 intake start on the 批量核对 model; the saved setting applies without a reload.
  const checkingModelChoice = bootstrap?.preferences.aiModels?.checking
  const agentDefaultModelKey =
    checkingModelChoice && bootstrap?.agentChatModels?.some((model) => model.key === checkingModelChoice)
      ? checkingModelChoice
      : bootstrap?.defaultAgentChatModelKey
  const t = useMemo(() => localeText(locale === 'zh-CN'), [locale])
  useLayoutEffect(() => {
    document.documentElement.lang = locale
    document.documentElement.dataset.locale = locale
  }, [locale])
  const reviewQueue = useMemo(
    () =>
      bootstrap
        ? buildReviewQueue(bootstrap.tasks, bootstrap.candidateReviews, bootstrap.jobCaseReviews, bootstrap.actionApprovals, t)
        : [],
    [bootstrap?.actionApprovals, bootstrap?.candidateReviews, bootstrap?.jobCaseReviews, bootstrap?.tasks, t]
  )

  const showCommandPalette = () => {
    commandPaletteOpener.current = document.activeElement instanceof HTMLElement ? document.activeElement : null
    commandPaletteOpenRef.current = true
    setCommandPaletteOpen(true)
  }

  const closeCommandPalette = (restoreFocus: boolean) => {
    commandPaletteOpenRef.current = false
    setCommandPaletteOpen(false)
    const opener = commandPaletteOpener.current
    commandPaletteOpener.current = null
    if (restoreFocus) requestAnimationFrame(() => opener?.isConnected && opener.focus())
  }

  useEffect(() => {
    if (startupRecovery) return undefined
    let active = true
    void window.sesAgent
      .getStartupStatus()
      .then(async (status) => {
        if (!active) return
        if (status.mode === 'recovery-required') {
          setStartupRecovery(status)
          return
        }
        const payload = await window.sesAgent.getBootstrap()
        if (active) {
          // Commit the first route with the first bootstrap payload. This keeps a
          // normal launch from painting the legacy dashboard before AgentWorkspace.
          if (!initialRouteApplied.current) {
            initialRouteApplied.current = true
            setActiveView('agent')
            // Launch lands on 今天 (when this build's bridge can read it), not on the last section.
            setTodayOpen(Boolean(window.sesAgent.getTodaySummary))
          }
          setBootstrap(payload)
        }
      })
      .catch((cause: unknown) => {
        if (active) setLoadError(localizedIpcError(locale, cause, t('无法初始化应用。', 'アプリを初期化できませんでした。')))
      })
    return () => {
      active = false
    }
  }, [startupRecovery])

  useEffect(() => {
    if (!commandPaletteAvailable) return undefined
    const handleShortcut = (event: globalThis.KeyboardEvent) => {
      if (!(event.metaKey || event.ctrlKey)) return
      const railIndex = ['1', '2', '3', '4', '5'].indexOf(event.key)
      if (railIndex >= 0 && !event.altKey && !event.shiftKey) {
        const open = railShortcuts.current[railIndex]
        if (!open) return
        event.preventDefault()
        if (commandPaletteOpenRef.current) closeCommandPalette(false)
        open()
        return
      }
      if (event.key.toLocaleLowerCase('en-US') !== 'k') return
      event.preventDefault()
      if (commandPaletteOpenRef.current) {
        closeCommandPalette(true)
      } else {
        showCommandPalette()
      }
    }
    window.addEventListener('keydown', handleShortcut)
    return () => window.removeEventListener('keydown', handleShortcut)
  }, [commandPaletteAvailable])

  useEffect(
    () =>
      window.sesAgent.onAiCommerceStateChanged((update) => {
        setBootstrap((current) => (current ? { ...current, aiCommerce: update.state } : current))
        setAiCommerceCallbackError(update.error)
      }),
    []
  )

  const refreshNewCaseDigest = () => {
    void window.sesAgent
      .getJobCaseNewDigest()
      .then(setNewCaseDigest)
      .catch(() => {
        /* The bootstrap error path remains authoritative. */
      })
  }

  const showToast = (message: string) => {
    const id = Date.now() + Math.random()
    setToasts((current) => [...current, { id, message }])
    window.setTimeout(() => setToasts((current) => current.filter((toast) => toast.id !== id)), 5_000)
  }

  // Seen means the workspace actually showed the case, whichever path opened it:
  // the board, a chat card, the review center, or the broadcast queue.
  useEffect(() => {
    if (!agentContextAccess) return
    if (agentContextAccess.destination === 'case-review') markJobCaseSeen(agentContextAccess.reviewId)
    else if (agentContextAccess.destination === 'broadcast' && agentContextAccess.reviewId) markJobCaseSeen(agentContextAccess.reviewId)
  }, [agentContextAccess])

  const markJobCaseSeen = (reviewId: string) => {
    void window.sesAgent
      .markJobCaseSeen(reviewId)
      .then(() => refreshNewCaseDigest())
      .catch(() => {
        /* Unread state is a convenience; a failure must not block the screen. */
      })
  }

  useEffect(() => {
    if (!normalSessionReady) return
    refreshNewCaseDigest()
  }, [normalSessionReady, bootstrap?.jobCaseReviews])

  useEffect(
    () =>
      window.sesAgent.onOpenNewCaseBoard(() => {
        setAgentSideMode(null)
        setAgentHomeRequest((current) => current + 1)
        setActiveView('agent')
        setAgentContextTrail(defaultAgentContextTrail())
      }),
    []
  )

  useEffect(
    () =>
      window.sesAgent.onGmailSyncCompleted((completion) => {
        // A scheduled sync in Main imported mail: pick up the new cases and show
        // the same notice as the manual button, from the refreshed checkpoint.
        void window.sesAgent
          .getBootstrap()
          .then((refreshed) => {
            setBootstrap((current) => (current ? refreshed : current))
            if (completion.imported > 0 && refreshed.gmailSync.lastRun && refreshed.gmailSync.lastSyncedAt) {
              setGmailImportNotice({
                syncedAt: refreshed.gmailSync.lastSyncedAt,
                storedMessages: refreshed.gmailSync.storedMessages,
                ...refreshed.gmailSync.lastRun
              })
            }
            if (completion.imported > 0 || (completion.personnelImported ?? 0) > 0) {
              showToast(
                localeText(refreshed.preferences.locale === 'zh-CN')(
                  `Gmail 同步：邮件 ${completion.imported} 封，人员 ${completion.personnelImported ?? 0} 名`,
                  `Gmail 同期：メール ${completion.imported}件、人材 ${completion.personnelImported ?? 0}名`
                )
              )
            }
            refreshNewCaseDigest()
          })
          .catch(() => {
            /* The startup/bootstrap error path remains authoritative. */
          })
      }),
    []
  )

  // Preserve business context while visiting traditional management pages.

  useEffect(() => {
    // The recovery screen deliberately exposes only recovery-safe IPC methods.
    // Do not install the normal-session refresher until Bootstrap is available.
    if (!normalSessionReady) return undefined
    let active = true
    const refreshRecovery = () => {
      void window.sesAgent
        .getRecoveryState()
        .then((recovery) => {
          if (active) setBootstrap((current) => (current ? { ...current, recovery } : current))
        })
        .catch(() => {
          /* The main bootstrap error path remains authoritative. */
        })
    }
    const interval = window.setInterval(refreshRecovery, 60_000)
    window.addEventListener('focus', refreshRecovery)
    return () => {
      active = false
      window.clearInterval(interval)
      window.removeEventListener('focus', refreshRecovery)
    }
  }, [normalSessionReady])

  useEffect(() => {
    if (!hasActiveProcessingJobs) return
    let active = true
    let refreshing = false
    const refreshProcessingJobs = async () => {
      if (!active || refreshing || document.visibilityState === 'hidden') return
      refreshing = true
      try {
        const payload = await window.sesAgent.getBootstrap()
        if (!active) return
        setBootstrap(payload)
        setSelectedTask((current) => payload.tasks.find((task) => task.id === current?.id) ?? current)

        const selected = selectedTaskId ? payload.tasks.find((task) => task.id === selectedTaskId) : null
        const latestJob = selectedTaskId ? payload.processingJobs.find((job) => job.workTaskId === selectedTaskId) : null
        if (
          selected?.type === 'MATCH_CANDIDATES' &&
          latestJob?.type === 'candidate-match' &&
          latestJob.status === 'succeeded' &&
          candidateMatchStateRef.current.status !== 'ready' &&
          !backgroundHydratedJobIds.current.has(latestJob.id)
        ) {
          backgroundHydratedJobIds.current.add(latestJob.id)
          void window.sesAgent
            .executeCandidateMatchTask(selected.id)
            .then((result) => {
              if (!active) return
              setSelectedTask((current) => (current?.id === result.task.id ? result.task : current))
              setBootstrap((current) => {
                if (!current) return current
                const tasks = new Map(current.tasks.map((task) => [task.id, task]))
                tasks.set(result.task.id, result.task)
                const jobs = new Map(current.processingJobs.map((job) => [job.id, job]))
                jobs.set(result.processingJob.id, result.processingJob)
                return { ...current, tasks: [...tasks.values()], processingJobs: [...jobs.values()] }
              })
              setCandidateMatch((current) =>
                current.taskId === result.task.id
                  ? {
                      taskId: result.task.id,
                      status: 'ready',
                      query: result.query,
                      run: result.run,
                      results: result.matches,
                      error: null
                    }
                  : current
              )
              void window.sesAgent.getBootstrap().then((latest) => {
                if (!active) return
                const tasks = new Map(latest.tasks.map((task) => [task.id, task]))
                tasks.set(result.task.id, result.task)
                const processingJobs = new Map(latest.processingJobs.map((job) => [job.id, job]))
                processingJobs.set(result.processingJob.id, result.processingJob)
                setBootstrap({ ...latest, tasks: [...tasks.values()], processingJobs: [...processingJobs.values()] })
              })
            })
            .catch(() => {
              backgroundHydratedJobIds.current.delete(latestJob.id)
            })
        }
      } catch {
        // The startup/bootstrap error path remains authoritative; the next interval retries locally.
      } finally {
        refreshing = false
      }
    }
    void refreshProcessingJobs()
    const interval = window.setInterval(() => {
      void refreshProcessingJobs()
    }, 1_000)
    return () => {
      active = false
      window.clearInterval(interval)
    }
  }, [hasActiveProcessingJobs, selectedTaskId])

  /**
   * The single place 案件配信 reaches the main process. It is stable across
   * renders so the broadcast screen does not reload its queue on every keystroke
   * elsewhere in the app.
   */
  const broadcastActions = useMemo<BroadcastPanelActions & BroadcastSettingsActions>(
    () => ({
      loadWorkspace: () => window.sesAgent.listBroadcastWorkspace(),
      draftBroadcast: (input) => window.sesAgent.draftCaseBroadcast(input),
      draftUpdateNotice: (input) => window.sesAgent.draftCaseUpdateNotice(input),
      validateCopy: (input) => window.sesAgent.validateCaseBroadcastMessage(input),
      recordCopy: (input) => window.sesAgent.recordCaseBroadcastCopy(input),
      openEmail: (input) => window.sesAgent.openCaseBroadcastEmail(input),
      listBroadcasts: (reviewId) => window.sesAgent.listCaseBroadcasts(reviewId),
      createTemplate: (input) => window.sesAgent.createBroadcastTemplate(input),
      updateTemplate: (input) => window.sesAgent.updateBroadcastTemplate(input),
      deleteTemplate: (input) => window.sesAgent.deleteBroadcastTemplate(input)
    }),
    []
  )

  // The menu-bar panel asks for a place in this window; it is applied once the normal session is ready.
  useEffect(
    () =>
      window.sesAgent.onTrayNavigate?.((navigation) => {
        if (!trayNavigationHandled.current.has(navigation.id)) setTrayNavigation(navigation)
      }),
    []
  )
  useEffect(() => {
    if (!trayNavigation || !normalSessionReady || !trayNavigationHandler.current) return
    trayNavigationHandled.current.add(trayNavigation.id)
    setTrayNavigation(null)
    trayNavigationHandler.current(trayNavigation)
  }, [trayNavigation, normalSessionReady])

  if (loadError) {
    return (
      <main className="fatal-state">
        <Icon name="alert" size={24} />
        <h1>{t('启动失败', '起動に失敗しました')}</h1>
        <p>{loadError}</p>
      </main>
    )
  }

  if (startupRecovery) {
    return (
      <StartupRecoveryScreen
        onConfirmRecovery={(input) => window.sesAgent.confirmRecovery(input)}
        onPreviewRecovery={(input) => window.sesAgent.previewRecoveryPackage(input)}
        onRestart={() => window.sesAgent.restartApplication()}
        status={startupRecovery}
      />
    )
  }

  if (!bootstrap) {
    return (
      <main className="loading-state">
        <span className="loading-mark">S</span>
        <p>{t('正在准备安全的工作环境…', '安全な作業環境を準備しています…')}</p>
      </main>
    )
  }

  const selectTask = (task: WorkTask) => {
    startTransition(() => setSelectedTask(task))
    setActiveView('task')
    const executable = task.status !== 'cancelled' && task.status !== 'failed'
    const matchRequest = ++candidateMatchRequest.current
    if (task.type === 'MATCH_CANDIDATES' && executable) {
      setCandidateMatch({ taskId: task.id, status: 'loading', query: '', run: null, results: [], error: null })
      void window.sesAgent.executeCandidateMatchTask(task.id).then(
        (result) => {
          if (candidateMatchRequest.current !== matchRequest) return
          setSelectedTask((current) => (current?.id === result.task.id ? result.task : current))
          setBootstrap((current) => {
            if (!current) return current
            const tasks = new Map(current.tasks.map((item) => [item.id, item]))
            tasks.set(result.task.id, result.task)
            const processingJobs = new Map(current.processingJobs.map((item) => [item.id, item]))
            processingJobs.set(result.processingJob.id, result.processingJob)
            return { ...current, tasks: [...tasks.values()], processingJobs: [...processingJobs.values()] }
          })
          setCandidateMatch({
            taskId: task.id,
            status: 'ready',
            query: result.query,
            run: result.run,
            results: result.matches,
            error: null
          })
          void window.sesAgent.getBootstrap().then((latest) => {
            const tasks = new Map(latest.tasks.map((item) => [item.id, item]))
            tasks.set(result.task.id, result.task)
            const processingJobs = new Map(latest.processingJobs.map((item) => [item.id, item]))
            processingJobs.set(result.processingJob.id, result.processingJob)
            setBootstrap({ ...latest, tasks: [...tasks.values()], processingJobs: [...processingJobs.values()] })
          })
        },
        (cause: unknown) => {
          if (candidateMatchRequest.current !== matchRequest) return
          setCandidateMatch({
            taskId: task.id,
            status: 'error',
            query: '',
            run: null,
            results: [],
            error: localizedIpcError(locale, cause, t('无法搜索人员。', '候補者を検索できませんでした。'))
          })
        }
      )
    } else {
      setCandidateMatch({ taskId: task.id, status: 'idle', query: '', run: null, results: [], error: null })
    }
    const currentProposalRequest = ++proposalRequest.current
    if (task.type === 'GENERATE_PROPOSAL' && executable) {
      setProposal({ taskId: task.id, status: 'loading', workspace: null, error: null })
      void window.sesAgent.getProposalWorkspace(task.id).then(
        (workspace) => {
          if (proposalRequest.current !== currentProposalRequest) return
          setProposal({ taskId: task.id, status: 'ready', workspace, error: null })
        },
        (cause: unknown) => {
          if (proposalRequest.current !== currentProposalRequest) return
          setProposal({
            taskId: task.id,
            status: 'error',
            workspace: null,
            error: localizedIpcError(locale, cause, t('无法读取提案工作区。', '提案ワークスペースを読み込めませんでした。'))
          })
        }
      )
    } else {
      setProposal({ taskId: task.id, status: 'idle', workspace: null, error: null })
    }
    const missingResumeAnalyses =
      task.type === 'IMPORT_RESUME' && executable
        ? task.contextBindings.filter(
            (binding) =>
              binding.objectType === 'staged-file' &&
              !bootstrap.resumeAnalyses.some(
                (analysis) => analysis.fileToken === binding.objectId && analysis.analysisVersion === 'resume-analysis-v6'
              )
          )
        : []
    if (missingResumeAnalyses.length > 0 && resumeImportRequest.current === 0) {
      const request = Date.now()
      resumeImportRequest.current = request
      setResumeImportProgress({
        phase: 'parsing',
        taskId: task.id,
        files: resumeImportProgressFiles(task),
        error: null
      })
      void runResumeImportTask(task, request)
    }
  }

  const submitCandidateReview = async (input: Parameters<typeof window.sesAgent.submitCandidateReview>[0]) => {
    const result = await window.sesAgent.submitCandidateReview(input)
    setBootstrap((current) => {
      if (!current) return current
      const reviews = new Map(current.candidateReviews.map((review) => [review.documentId, review]))
      reviews.set(result.review.documentId, result.review)
      const tasks = new Map(current.tasks.map((task) => [task.id, task]))
      for (const task of result.updatedTasks) tasks.set(task.id, task)
      return { ...current, candidateReviews: [...reviews.values()], tasks: [...tasks.values()] }
    })
    setSelectedTask((current) => result.updatedTasks.find((task) => task.id === current?.id) ?? current)
    return result
  }

  const submitCandidateMatchFeedback = async (input: SubmitCandidateMatchFeedbackInput): Promise<SubmitCandidateMatchFeedbackResult> => {
    const result = await window.sesAgent.submitCandidateMatchFeedback(input)
    setCandidateMatch((current) => ({
      ...current,
      run: result.run,
      results: current.results.map((match) =>
        match.matchResultId === result.matchResultId ? { ...match, feedback: result.feedback } : match
      )
    }))
    return result
  }

  const applyProposalMutation = (result: ProposalMutationResult) => {
    setSelectedTask((current) => (current?.id === result.task.id ? result.task : current))
    setBootstrap((current) => {
      if (!current) return current
      const tasks = new Map(current.tasks.map((task) => [task.id, task]))
      tasks.set(result.task.id, result.task)
      return { ...current, tasks: [...tasks.values()] }
    })
    setProposal((current) => {
      if (current.taskId !== result.task.id || !current.workspace) return current
      const drafts = new Map(current.workspace.drafts.map((draft) => [draft.id, draft]))
      drafts.set(result.draft.id, result.draft)
      return {
        ...current,
        status: 'ready',
        workspace: {
          ...current.workspace,
          drafts: [result.draft, ...[...drafts.values()].filter((draft) => draft.id !== result.draft.id)]
        },
        error: null
      }
    })
    void window.sesAgent.getProposalWorkspace(result.task.id).then((workspace) => {
      setProposal((current) => (current.taskId === result.task.id ? { ...current, status: 'ready', workspace, error: null } : current))
    })
    void window.sesAgent.getBootstrap().then(setBootstrap)
  }

  const createProposalDraft = async (input: Parameters<typeof window.sesAgent.createProposalDraft>[0]) => {
    const result = await window.sesAgent.createProposalDraft(input)
    applyProposalMutation(result)
    return result
  }

  const updateProposalDraft = async (input: Parameters<typeof window.sesAgent.updateProposalDraft>[0]) => {
    const result = await window.sesAgent.updateProposalDraft(input)
    applyProposalMutation(result)
    return result
  }

  const approveProposalDraft = async (input: Parameters<typeof window.sesAgent.approveProposalDraft>[0]) => {
    const result = await window.sesAgent.approveProposalDraft(input)
    applyProposalMutation(result)
    return result
  }

  const exportProposalPackage = async (input: Parameters<typeof window.sesAgent.exportProposalPackage>[0]) => {
    try {
      const result = await window.sesAgent.exportProposalPackage(input)
      if (!result.cancelled) {
        applyProposalMutation(result)
        if (result.processingJob) {
          const processingJob = result.processingJob
          setBootstrap((current) =>
            current
              ? {
                  ...current,
                  processingJobs: [processingJob, ...current.processingJobs.filter((job) => job.id !== processingJob.id)]
                }
              : current
          )
        }
      }
      return result
    } catch (cause) {
      const refreshed = await window.sesAgent.getBootstrap()
      setBootstrap(refreshed)
      setSelectedTask((current) => refreshed.tasks.find((task) => task.id === current?.id) ?? current)
      throw cause
    }
  }

  const recordProposalFollowUp = async (input: Parameters<typeof window.sesAgent.recordProposalFollowUp>[0]) => {
    const result = await window.sesAgent.recordProposalFollowUp(input)
    applyProposalMutation(result)
    return result
  }

  const connectGoogleWorkspace = async () => {
    const gmail = await window.sesAgent.connectGoogleWorkspace()
    setBootstrap((current) => (current ? { ...current, gmail } : current))
    if (gmail.status !== 'readonly') return
    await window.sesAgent.syncGoogleWorkspace()
    setBootstrap(await window.sesAgent.getBootstrap())
  }

  const diagnoseGoogleWorkspace = () => window.sesAgent.diagnoseGoogleWorkspace()

  const runGoogleWorkspaceOnlineAcceptance = async () => {
    const googleWorkspaceAcceptance = await window.sesAgent.runGoogleWorkspaceOnlineAcceptance()
    setBootstrap((current) => (current ? { ...current, googleWorkspaceAcceptance } : current))
    return googleWorkspaceAcceptance
  }

  const disconnectGoogleWorkspace = async () => {
    const gmail = await window.sesAgent.disconnectGoogleWorkspace()
    setBootstrap((current) => (current ? { ...current, gmail } : current))
  }

  const performGoogleWorkspaceSync = async (): Promise<BootstrapPayload> => {
    await window.sesAgent.syncGoogleWorkspace()
    const refreshed = await window.sesAgent.getBootstrap()
    setBootstrap(refreshed)
    return refreshed
  }

  const syncGoogleWorkspace = async () => {
    await performGoogleWorkspaceSync()
  }

  const importGmailFromComposer = async () => {
    const known = new Set(bootstrap?.jobCaseReviews.map((review) => review.reviewId))
    const refreshed = await performGoogleWorkspaceSync()
    // Cases this sync created are HR's own new cases: they join my cases like any other import.
    const createdIds = refreshed.jobCaseReviews.filter((review) => !known.has(review.reviewId)).map((review) => review.reviewId)
    revealCreatedCases(createdIds, await joinCreatedCases(createdIds))
    const run = refreshed.gmailSync.lastRun
    if (!run || !refreshed.gmailSync.lastSyncedAt) {
      throw new Error(
        t(
          '无法确认 Gmail 同步结果，请在“数据与审批”中检查同步状态。',
          'Gmail 同期結果を確認できませんでした。データと承認から同期状態を確認してください。'
        )
      )
    }
    setGmailImportNotice({
      syncedAt: refreshed.gmailSync.lastSyncedAt,
      storedMessages: refreshed.gmailSync.storedMessages,
      ...run
    })
    openSubpage('case-import', 'case')
  }

  const createRecoveryPackage = async (input: Parameters<typeof window.sesAgent.createRecoveryPackage>[0]) => {
    const result = await window.sesAgent.createRecoveryPackage(input)
    if (!result.cancelled && result.summary) {
      const refreshed = await window.sesAgent.getBootstrap()
      setBootstrap(refreshed)
    }
    return result
  }

  const snoozeRecoveryReminder = async (input: Parameters<typeof window.sesAgent.snoozeRecoveryReminder>[0]) => {
    const recovery = await window.sesAgent.snoozeRecoveryReminder(input)
    setBootstrap((current) => (current ? { ...current, recovery } : current))
  }

  const submitJobCaseReview = async (input: Parameters<typeof window.sesAgent.submitJobCaseReview>[0]) => {
    const result = await window.sesAgent.submitJobCaseReview(input)
    setBootstrap((current) => {
      if (!current) return current
      const reviews = new Map(current.jobCaseReviews.map((review) => [review.reviewId, review]))
      reviews.set(result.review.reviewId, result.review)
      return { ...current, jobCaseReviews: [...reviews.values()] }
    })
    return result
  }

  const saveJobCaseFieldAliases = async (input: Parameters<typeof window.sesAgent.saveJobCaseFieldAliases>[0]) => {
    const saved = await window.sesAgent.saveJobCaseFieldAliases(input)
    setBootstrap((current) => (current ? { ...current, jobCaseFieldAliases: saved } : current))
    return saved
  }

  // The same case already in the list: nothing new joins 负责中; HR is told and taken to the case that exists.
  const showExistingCase = (reviewId: string) => {
    showToast(t('相同案件已存在，已打开原有案件。', '同じ案件は登録済みです。既存の案件を開きました。'))
    openHrObject('case', reviewId)
  }

  const createManualJobCaseDraft = async (input: Parameters<typeof window.sesAgent.createManualJobCaseDraft>[0]) => {
    const result = await window.sesAgent.createManualJobCaseDraft(input)
    if (result.outcome === 'existing') {
      showExistingCase(result.review.reviewId)
      return result
    }
    const working = await joinCreatedCases([result.review.reviewId])
    setBootstrap((current) => {
      if (!current) return current
      const reviews = new Map(current.jobCaseReviews.map((review) => [review.reviewId, review]))
      reviews.set(result.review.reviewId, result.review)
      return {
        ...current,
        jobCaseReviews: [result.review, ...[...reviews.values()].filter((review) => review.reviewId !== result.review.reviewId)]
      }
    })
    setBootstrap(await window.sesAgent.getBootstrap())
    revealCreatedCases([result.review.reviewId], working)
    return result
  }

  const createChatPasteJobCaseDraft = async (input: Parameters<typeof window.sesAgent.createChatPasteJobCaseDraft>[0]) => {
    const result = await window.sesAgent.createChatPasteJobCaseDraft(input)
    if (result.outcome && result.outcome !== 'created') {
      showExistingCase(result.review.reviewId)
      return result
    }
    const working = await joinCreatedCases([result.review.reviewId])
    setBootstrap((current) => {
      if (!current) return current
      const remaining = current.jobCaseReviews.filter((review) => review.reviewId !== result.review.reviewId)
      return { ...current, jobCaseReviews: [result.review, ...remaining] }
    })
    setBootstrap(await window.sesAgent.getBootstrap())
    revealCreatedCases([result.review.reviewId], working)
    return result
  }

  const readWechatVisibleMessages = async () => {
    const prepared = await window.sesAgent.prepareWechatVisibleRead()
    if (prepared.status === 'cancelled') return null
    if (prepared.status !== 'ready' || !prepared.scopeToken) {
      throw new Error(`${t('微信读取预检未通过：', '微信の読取事前確認に失敗しました：')}${prepared.failureCodes.join(', ') || 'UNKNOWN'}`)
    }
    const result = await window.sesAgent.executeWechatVisibleRead({ scopeToken: prepared.scopeToken })
    if (result.outcome === 'existing') {
      showExistingCase(result.review.reviewId)
      return result
    }
    const working = await joinCreatedCases([result.review.reviewId])
    setBootstrap((current) => {
      if (!current) return current
      const remaining = current.jobCaseReviews.filter((review) => review.reviewId !== result.review.reviewId)
      return { ...current, jobCaseReviews: [result.review, ...remaining] }
    })
    // Confirmed at once like manual and paste intake: the active cases, digest and counts are read again.
    setBootstrap(await window.sesAgent.getBootstrap())
    revealCreatedCases([result.review.reviewId], working)
    return result
  }

  const importAtsCsvCandidates = async () => {
    const result = await window.sesAgent.importAtsCsvCandidates()
    if (!result.cancelled && result.rowCount > 0) {
      const refreshed = await window.sesAgent.getBootstrap()
      setBootstrap(refreshed)
    }
    return result
  }

  const importEmlJobCaseDrafts = async () => {
    const result = await window.sesAgent.importEmlJobCaseDrafts()
    const importedReviews = result.items.flatMap((item) => (item.review ? [item.review] : []))
    const createdIds = result.items.flatMap((item) => (item.status === 'imported' && item.review ? [item.review.reviewId] : []))
    const working = await joinCreatedCases(createdIds)
    if (importedReviews.length > 0) {
      setBootstrap((current) => {
        if (!current) return current
        const reviews = new Map(current.jobCaseReviews.map((review) => [review.reviewId, review]))
        for (const review of importedReviews) reviews.set(review.reviewId, review)
        return {
          ...current,
          jobCaseReviews: [
            ...importedReviews,
            ...[...reviews.values()].filter((review) => !importedReviews.some((item) => item.reviewId === review.reviewId))
          ]
        }
      })
      // Confirmed at once like manual and paste intake: the active cases, digest and counts are read again.
      setBootstrap(await window.sesAgent.getBootstrap())
    }
    revealCreatedCases(createdIds, working)
    return result
  }

  const updateJobCaseReview = (review: BootstrapPayload['jobCaseReviews'][number]) => {
    setBootstrap((current) => {
      if (!current) return current
      const reviews = new Map(current.jobCaseReviews.map((item) => [item.reviewId, item]))
      reviews.set(review.reviewId, review)
      return { ...current, jobCaseReviews: [...reviews.values()] }
    })
  }

  const setJobCaseLifecycle = async (input: Parameters<typeof window.sesAgent.setJobCaseLifecycle>[0]) => {
    const result = await window.sesAgent.setJobCaseLifecycle(input)
    updateJobCaseReview(result.review)
    // Follow-ups ended or brought back with the case: 跟进, 今天 and the lists re-read them.
    notifyBusinessDataChanged()
    return result
  }

  const reopenJobCaseReview = async (input: Parameters<typeof window.sesAgent.reopenJobCaseReview>[0]) => {
    const result = await window.sesAgent.reopenJobCaseReview(input)
    updateJobCaseReview(result.review)
    return result
  }

  const deleteJobCaseData = async (input: Parameters<typeof window.sesAgent.deleteJobCaseData>[0]) => {
    const result = await window.sesAgent.deleteJobCaseData(input)
    const refreshed = await window.sesAgent.getBootstrap()
    setBootstrap(refreshed)
    setAgentHistoryReloadToken((current) => current + 1)
    return result
  }

  const deleteCandidateData = async (input: Parameters<typeof window.sesAgent.deleteCandidateData>[0]) => {
    const result = await window.sesAgent.deleteCandidateData(input)
    const refreshed = await window.sesAgent.getBootstrap()
    setBootstrap(refreshed)
    setAgentHistoryReloadToken((current) => current + 1)
    return result
  }

  const importCandidateEvaluationBenchmark = async () => {
    const result = await window.sesAgent.importCandidateEvaluationBenchmark()
    if (!result.cancelled) {
      setBootstrap((current) => (current ? { ...current, candidateEvaluation: result.state } : current))
    }
    return result
  }

  const evaluateCandidateEvaluationDraft = async (input: Parameters<typeof window.sesAgent.evaluateCandidateEvaluationDraft>[0]) => {
    const result = await window.sesAgent.evaluateCandidateEvaluationDraft(input)
    setBootstrap((current) => (current ? { ...current, candidateEvaluation: result.state } : current))
    return result
  }

  const setWorkTaskLifecycle = async (input: Parameters<typeof window.sesAgent.setWorkTaskLifecycle>[0]) => {
    const task = await window.sesAgent.setWorkTaskLifecycle(input)
    setBootstrap((current) =>
      current
        ? {
            ...current,
            tasks: current.tasks.map((item) => (item.id === task.id ? task : item))
          }
        : current
    )
    setSelectedTask((current) => (current?.id === task.id ? task : current))
    if (input.action === 'cancel') {
      candidateMatchRequest.current += 1
      proposalRequest.current += 1
      setCandidateMatch((current) =>
        current.taskId === task.id ? { taskId: task.id, status: 'idle', query: '', run: null, results: [], error: null } : current
      )
      setProposal((current) => (current.taskId === task.id ? { taskId: task.id, status: 'idle', workspace: null, error: null } : current))
    } else {
      selectTask(task)
    }
    return task
  }

  const saveLocalOperatorProfile = async (input: Parameters<typeof window.sesAgent.saveLocalOperatorProfile>[0]) => {
    const operatorProfile = await window.sesAgent.saveLocalOperatorProfile(input)
    setBootstrap((current) => (current ? { ...current, operatorProfile } : current))
    return operatorProfile
  }

  const saveLocalApplicationPreferences = async (input: Parameters<typeof window.sesAgent.saveLocalApplicationPreferences>[0]) => {
    const preferences = await window.sesAgent.saveLocalApplicationPreferences(input)
    setBootstrap((current) => (current ? { ...current, preferences } : current))
    return preferences
  }

  const updateAiCommerce = (aiCommerce: BootstrapPayload['aiCommerce']) => {
    setBootstrap((current) => (current ? { ...current, aiCommerce } : current))
    return aiCommerce
  }

  const connectAiCommerce = async () => {
    setAiCommerceCallbackError(null)
    return updateAiCommerce(await window.sesAgent.connectAiCommerce())
  }
  const refreshAiCommerce = async () => updateAiCommerce(await window.sesAgent.getAiCommerceDashboard())
  const disconnectAiCommerce = async () => updateAiCommerce(await window.sesAgent.disconnectAiCommerce())
  const resetAiCommerceToken = async () => updateAiCommerce(await window.sesAgent.resetAiCommerceToken())
  const runReviewedAiCommerceCloudPrompt = async (input: Parameters<typeof window.sesAgent.prepareAiCommerceCloudPrompt>[0]) => {
    const prepared = await window.sesAgent.prepareAiCommerceCloudPrompt(input)
    const result = await window.sesAgent.executeAiCommerceCloudPrompt({ reviewTicket: prepared.reviewTicket })
    setBootstrap((current) => (current ? { ...current, aiCommerce: { ...current.aiCommerce, wallet: result.wallet } } : current))
    return result
  }
  const resolveActionApproval = async (approvalId: string, decision: 'approve' | 'deny') => {
    const resolved = await window.sesAgent.resolveActionApproval({ approvalId, decision })
    const payload = await window.sesAgent.getBootstrap()
    setBootstrap(payload)
    if (decision === 'approve' && resolved.toolName === 'proposal.export' && resolved.workTaskId) {
      const task = payload.tasks.find((item) => item.id === resolved.workTaskId)
      if (task) selectTask(task)
    }
  }

  /**
   * Opens a page that is not the HR shell as a sub-page of an HR section: the rail keeps that section
   * highlighted and the return bar goes back to it. Without a section the page belongs to the section
   * it was opened from (activity, a task, the review center).
   */
  const openSubpage = (view: Exclude<AppView, 'agent'>, section?: HrBusinessKind | 'follow') => {
    setGovernanceOpen(false)
    if (view !== 'task') setSelectedTask(null)
    // Entering another section's sub-page leaves the current section like the rail does, so the
    // return lands on that section's own list and selection, not on a panel of the previous one.
    const switching = section === 'follow' ? !hrFollowOpen : Boolean(section) && (section !== hrKind || hrFollowOpen)
    if (switching) {
      closeAgentPanel()
      setHrSource(null)
      setCasePeopleOpen(false)
      setOpportunitiesOpen(false)
      setOpportunityReturn(null)
      setHrBatchStarted(null)
      if (section !== 'follow') setAgentFeedSelection(readHrPosition(section!).selected)
    }
    // A section's sub-page belongs to that section, not to 今天 underneath.
    if (section) setTodayOpen(false)
    if (section === 'follow') setHrFollowOpen(true)
    else if (section) {
      setHrFollowOpen(false)
      setHrKind(section)
      try {
        localStorage.setItem('ses-hr-kind-v2', section)
      } catch {}
    }
    setActiveView(view)
  }

  const openTaskCenter = () => {
    setImportHistoryOpen(false)
    openSubpage('tasks')
  }

  const openResumeImportHistory = () => {
    setImportHistoryOpen(true)
    openSubpage('tasks', 'person')
  }

  const openReviewCenter = () => openSubpage('reviews')

  /** 人员 → 招聘面试; with a person, straight to their recruiting pipeline (e.g. confirming an imported resume). */
  const openRecruiting = (sourceDocumentId?: string, view: PipelineView = 'overview') => {
    setCandidateWorkspaceDetail(
      sourceDocumentId ? { scope: 'recruiting', documentId: sourceDocumentId, view, interviewKind: 'recruiting' } : null
    )
    openSubpage('interview-workbench', 'person')
  }

  const startHrProgress = async (targets: FollowUpTarget[]) => {
    const records = await window.sesAgent.beginBusinessProgress(targets)
    businessProgress.publish(records)
    const first = targets[0]
    if (!first) return
    setHrBatchStarted(targets.length > 1 ? targets : null)
    setHrFollowTarget({ ...first })
    setHrFollowOpen(true)
    setIntroductionTarget(null)
    closeAgentPanel()
    returnToHr()
    setAgentHomeRequest((value) => value + 1)
    setBootstrap((current) =>
      current
        ? {
            ...current,
            candidateInterviews: [
              ...current.candidateInterviews.filter((row) => !records.some((record) => record.id === row.businessFollowUpId)),
              ...records.flatMap((record) => record.progress?.rounds ?? [])
            ]
          }
        : current
    )
  }

  const openInterviewSchedule = () => {
    setCandidateWorkspaceDetail(null)
    openSubpage('interview-schedule', 'follow')
  }

  const openCaseImport = () => openSubpage('case-import', 'case')

  const openAgentSystemAccess = (access: AgentSystemAccessBlock) => {
    setMatchPanelHidden(false)
    setSideProgressTarget(null)
    setProgressFocus(null)
    if (access.destination === 'broadcast' && access.reviewId) {
      const requestedReviewId = access.reviewId
      const review = bootstrap.jobCaseReviews.find((item) => item.reviewId === requestedReviewId)
      if (review && review.lifecycle === 'active') {
        setCaseIntroductionTarget({
          reviewId: review.reviewId,
          reviewRevision: review.reviewRevision,
          jobCaseVersion: review.status === 'completed' ? (review.jobCase?.version ?? null) : null
        })
        return
      }
    }

    // 找人 for a case always opens the case's results page in the main area; without a case it opens the case list.
    if (access.destination === 'matching') {
      const review = access.jobCaseId ? bootstrap.jobCaseReviews.find((item) => item.jobCase?.id === access.jobCaseId) : undefined
      if (review) openCasePeople(review)
      else openHrList('case')
      return
    }
    setAgentHomeRequest((value) => value + 1)
    const personnel = access.destination === 'candidate' && access.view === 'overview'
    setAgentSideMode(personnel ? 'personnel' : null)
    if (access.destination === 'candidate' && access.view === 'overview') {
      setAgentPersonId(access.sourceDocumentId)
    }
    setGovernanceOpen(false)
    setSelectedTask(null)
    setAgentContextTrail((trail) => pushContextAccess(trail, access))
    const caseReview =
      access.destination === 'case-review' || access.destination === 'broadcast'
        ? bootstrap.jobCaseReviews.find((item) => item.reviewId === access.reviewId)
        : undefined
    if (caseReview || access.destination === 'candidate' || access.destination === 'original-document') {
      setAgentFocusRequest({
        id: Date.now(),
        ...(access.destination === 'candidate' || access.destination === 'original-document'
          ? { candidateDocumentId: access.sourceDocumentId }
          : {}),
        caseReference:
          caseReview?.jobCase && caseReview.lifecycle === 'active'
            ? {
                kind: 'job-case',
                objectId: caseReview.jobCase.id,
                objectVersion: caseReview.jobCase.version,
                resultHash: null,
                ordinal: null,
                label: caseReview.fields.find((field) => field.key === 'title')?.value ?? caseReview.redactedSubject,
                target: `job-case:${caseReview.jobCase.id}`
              }
            : null
      })
    }
  }
  const closeAgentPanel = () => {
    setMatchPanelHidden(false)
    setSideProgressTarget(null)
    setAgentSideMode(null)
    setAgentContextTrail([])
  }
  const openAgentBatch = (text?: string) => {
    setMatchPanelHidden(false)
    setAgentHomeRequest((value) => value + 1)
    if (text) setAgentBatchSeed({ id: Date.now(), text })
    setAgentSideMode('intake')
    setAgentContextTrail([])
    setActiveView('agent')
  }
  const openAgentPersonnel = (documentId: string, match = false, selectReviewId?: string) => {
    openAgentSystemAccess({ type: 'system-access', destination: 'candidate', sourceDocumentId: documentId, view: 'overview' })
    setAgentPersonId(documentId)
    setAgentSideMode('personnel')
    // A person already being matched is only shown again; the matching workspace never starts a second run for them.
    // The results take the main area; the person's panel opens again from 「查看人员资料」.
    if (match) {
      setMatchPanelHidden(true)
      setCasePeopleOpen(false)
      setHrFollowOpen(false)
      setHrKind('person')
      setAgentFeedSelection(`person:${documentId}`)
      saveHrPosition('person', { selected: `person:${documentId}` })
      try {
        localStorage.setItem('ses-hr-kind-v2', 'person')
      } catch {}
      setHrSource({
        kind: 'person',
        id: documentId,
        requestId: ++feedFocusSequence.current,
        ...(selectReviewId ? { selectReviewId } : {})
      })
      setAgentHomeRequest((value) => value + 1)
    }
  }
  const openPersonnelProfile = (documentId: string) => {
    if (!bootstrap?.candidateReviews.find((review) => review.documentId === documentId)?.profile) {
      openRecruiting(documentId, 'resume')
      return
    }
    // The full profile opens in the right panel beside the list; the talent-pool page stays a library.
    setMatchPanelHidden(false)
    setAgentProfileId(documentId)
    setAgentSideMode('profile')
    setGovernanceOpen(false)
    setSelectedTask(null)
    setActiveView('agent')
  }
  /** Opens a case's 找人 results in the main area in place of the case list, with the side panel closed. */
  const openCasePeople = (review: JobCaseReviewSnapshot, files?: File[]) => {
    setMatchPanelHidden(false)
    setCasePeopleOpen(true)
    setAssessmentReviewId(review.reviewId)
    setAgentFeedSelection(`case:${review.reviewId}`)
    saveHrPosition('case', { selected: `case:${review.reviewId}` })
    setHrSource(null)
    setHrFollowOpen(false)
    setHrKind('case')
    setActiveView('agent')
    setSideProgressTarget(null)
    setAgentContextTrail([])
    setAgentSideMode(null)
    setAgentHomeRequest((value) => value + 1)
    if (files?.length) {
      try {
        setAssessmentFocus(caseResumes.enqueue(review, files))
      } catch (cause) {
        showToast(localizedIpcError(locale, cause, t('无法评估简历。', '履歴書を評価できませんでした。')))
      }
    } else {
      setAssessmentFocus(null)
      void caseResumes.search(review)
    }
  }
  const openCaseResumeAssessment = (entry: BusinessFeedEntry, files?: File[]) => {
    const review = bootstrap.jobCaseReviews.find((job) => job.reviewId === entry.objectId)
    if (review) openCasePeople(review, files)
  }
  const openLatestEntry = (entry: BusinessFeedEntry, action: 'view' | 'match' | 'promote') => {
    setAgentFeedSelection(`${entry.kind}:${entry.objectId}`)
    saveHrPosition(entry.kind, { selected: `${entry.kind}:${entry.objectId}` })
    if (entry.kind === 'person') {
      openAgentPersonnel(entry.objectId, action === 'match')
      if (action === 'promote') {
        const person = bootstrap.candidateReviews.find((item) => item.documentId === entry.objectId)
        if (person?.profile) setIntroductionTarget({ documentId: person.documentId, profileVersion: person.profile.version, matched: [] })
      }
      setAgentPersonFocusRequest({ id: ++feedFocusSequence.current, documentId: entry.objectId, section: action })
      return
    }
    if (action !== 'promote') setCaseFocusRequest(++feedFocusSequence.current)
    const review = bootstrap?.jobCaseReviews.find((item) => item.reviewId === entry.objectId)
    if (!review) return
    if (action === 'match') {
      openCasePeople(review)
      return
    }
    openAgentSystemAccess(
      action === 'promote' && review.lifecycle === 'active'
        ? { type: 'system-access', destination: 'broadcast', reviewId: entry.objectId }
        : { type: 'system-access', destination: 'case-review', reviewId: entry.objectId }
    )
  }
  const agentContextBack =
    agentContextTrail.length > 1
      ? () => {
          const previous = agentContextTrail.at(-2)!
          setAgentContextTrail((trail) => trail.slice(0, -1))
          const personnel = previous.destination === 'candidate' && previous.view === 'overview'
          setAgentSideMode(personnel ? 'personnel' : null)
          if (personnel) setAgentPersonId(previous.sourceDocumentId)
        }
      : undefined

  const openAgentCandidateAccess = (
    sourceDocumentId: string,
    view: PipelineView = 'overview',
    interviewId?: string | null,
    interviewKind?: 'recruiting' | 'client'
  ) =>
    // Booking and preparing happen in the recruiting pipeline; the side panel only shows the person and résumé.
    view === 'schedule' || view === 'prepare' || view === 'workbench' || view === 'decision'
      ? openRecruiting(sourceDocumentId, view)
      : openAgentSystemAccess({
          type: 'system-access',
          destination: 'candidate',
          sourceDocumentId,
          view,
          ...(interviewId !== undefined ? { interviewId } : {}),
          ...(interviewKind ? { interviewKind } : {})
        })

  const openApplicationSettings = (section: ApplicationSettingsSection = 'general') => {
    setApplicationSettingsSection(section)
    setApplicationSettingsRequest((request) => request + 1)
    setApplicationSettingsOpen(true)
  }

  const executeResumeImportTask = async (
    task: WorkTask,
    request: number,
    conversationId?: string
  ): Promise<AiConversationSnapshot | null> => {
    let latestConversation: AiConversationSnapshot | null = null
    const completedTokens = new Set(
      bootstrap.resumeAnalyses.filter((analysis) => analysis.analysisVersion === 'resume-analysis-v6').map((analysis) => analysis.fileToken)
    )
    const bindings = task.contextBindings.filter(
      (binding) => binding.objectType === 'staged-file' && !completedTokens.has(binding.objectId)
    )
    for (const binding of bindings) {
      if (resumeImportRequest.current !== request) return latestConversation
      setResumeImportProgress((current) =>
        current?.taskId === task.id
          ? {
              ...current,
              files: current.files.map((file) => (file.token === binding.objectId ? { ...file, status: 'parsing', error: null } : file))
            }
          : current
      )
      try {
        const execution = await window.sesAgent.analyzeResumeFile({
          fileToken: binding.objectId,
          taskId: task.id,
          ...(conversationId ? { conversationId } : {})
        })
        if (execution.conversation) latestConversation = execution.conversation
        if (resumeImportRequest.current !== request) return latestConversation
        setBootstrap((current) => {
          if (!current) return current
          const tasks = new Map(current.tasks.map((item) => [item.id, item]))
          tasks.set(execution.task.id, execution.task)
          const processingJobs = new Map(current.processingJobs.map((job) => [job.id, job]))
          processingJobs.set(execution.processingJob.id, execution.processingJob)
          const analyses = new Map(current.resumeAnalyses.map((analysis) => [analysis.fileToken, analysis]))
          analyses.set(execution.analysis.fileToken, execution.analysis)
          return {
            ...current,
            tasks: [...tasks.values()],
            processingJobs: [...processingJobs.values()],
            resumeAnalyses: [...analyses.values()]
          }
        })
        setResumeImportProgress((current) =>
          current?.taskId === task.id
            ? {
                ...current,
                files: current.files.map((file) => (file.token === binding.objectId ? { ...file, status: 'success', error: null } : file))
              }
            : current
        )
      } catch (cause) {
        if (resumeImportRequest.current !== request) return latestConversation
        // 该人员已入库 is a skip, not a failure: the file is shown as skipped with who the person already is.
        const alreadyImported = cause instanceof Error && /该人员已入库|登録済み/u.test(cause.message)
        setResumeImportProgress((current) =>
          current?.taskId === task.id
            ? {
                ...current,
                files: current.files.map((file) =>
                  file.token === binding.objectId
                    ? {
                        ...file,
                        status: alreadyImported ? 'skipped' : 'error',
                        error: localizedIpcError(locale, cause, t('本机解析失败。', 'ローカル解析に失敗しました。'))
                      }
                    : file
                )
              }
            : current
        )
      }
    }
    return latestConversation
  }

  const resumeImportProgressFiles = (task: WorkTask): ResumeImportProgress['files'] => {
    const analyses = new Map(bootstrap.resumeAnalyses.map((analysis) => [analysis.fileToken, analysis]))
    const reviews = new Map(bootstrap.candidateReviews.map((review) => [review.documentId, review]))
    return task.contextBindings
      .filter((binding) => binding.objectType === 'staged-file')
      .map((binding, index) => {
        const analysis = analyses.get(binding.objectId)
        return {
          token: binding.objectId,
          name: analysis?.fileName ?? reviews.get(binding.objectId)?.fileName ?? `${t('候选文件', '選択ファイル')} ${index + 1}`,
          status: analysis?.analysisVersion === 'resume-analysis-v6' ? ('success' as const) : ('queued' as const),
          error: null
        }
      })
  }

  const runResumeImportTask = async (task: WorkTask, request: number, conversationId?: string): Promise<AiConversationSnapshot | null> => {
    try {
      const conversation = await executeResumeImportTask(task, request, conversationId)
      if (resumeImportRequest.current !== request) return conversation
      const refreshed = await window.sesAgent.getBootstrap()
      setBootstrap(refreshed)
      setSelectedTask((current) => refreshed.tasks.find((item) => item.id === current?.id) ?? current)
      setResumeImportProgress((current) =>
        current?.taskId === task.id
          ? {
              ...current,
              phase: current.files.some((file) => file.status === 'error') ? 'partial-failed' : 'completed'
            }
          : current
      )
      return conversation
    } catch (cause) {
      if (resumeImportRequest.current === request) {
        setResumeImportProgress((current) =>
          current
            ? {
                ...current,
                phase: 'error',
                error: localizedIpcError(locale, cause, t('无法导入简历。', '履歴書を取り込めませんでした。'))
              }
            : current
        )
      }
      return null
    } finally {
      if (resumeImportRequest.current === request) resumeImportRequest.current = 0
    }
  }

  const startResumeImport = async (conversationId?: string): Promise<AiConversationSnapshot | null> => {
    if (resumeImportRequest.current !== 0) return null
    const request = Date.now()
    resumeImportRequest.current = request
    setResumeImportProgress({ phase: 'choosing', taskId: null, files: [], error: null })
    try {
      const created = await window.sesAgent.beginResumeImport()
      if (resumeImportRequest.current !== request) return null
      if (created.cancelled) {
        setResumeImportProgress(null)
        resumeImportRequest.current = 0
        return null
      }
      // Files of people already in the system were given up; the rest import as usual.
      for (const item of created.skipped ?? [])
        showToast(
          item.addedToLibrary
            ? t(
                `${item.fileName}：该人员已有资料（${item.existingName}），已加入人员库，本次未重复导入。`,
                `${item.fileName}：この要員の情報は登録済みです（${item.existingName}）。要員一覧に追加し、重複して取り込んでいません。`
              )
            : t(
                `${item.fileName}：该人员已入库（${item.existingName}），本次导入已放弃。`,
                `${item.fileName}：この要員は登録済みです（${item.existingName}）。取り込みを取り消しました。`
              )
        )
      setBootstrap((current) => (current ? { ...current, tasks: [created.task, ...current.tasks] } : current))
      setResumeImportProgress({ phase: 'parsing', taskId: created.task.id, files: progressFiles(created.files), error: null })
      return await runResumeImportTask(created.task, request, conversationId)
    } catch (cause) {
      if (resumeImportRequest.current === request) {
        setResumeImportProgress((current) =>
          current
            ? {
                ...current,
                phase: 'error',
                error: localizedIpcError(locale, cause, t('无法导入简历。', '履歴書を取り込めませんでした。'))
              }
            : current
        )
      }
      if (resumeImportRequest.current === request) resumeImportRequest.current = 0
      return null
    }
  }

  const startManualCase = () => {
    openCaseImport()
    setManualCaseRequestId(1)
  }

  const openGoogleWorkspaceControl = () => {
    openApplicationSettings('integrations')
  }

  const runGoogleWorkspaceCommand = async () => {
    if (
      bootstrap.gmail.configuration === 'required' ||
      bootstrap.gmailSync.configuration === 'required' ||
      bootstrap.gmail.status !== 'readonly'
    ) {
      openGoogleWorkspaceControl()
      return
    }
    await importGmailFromComposer()
  }

  const gmailCommandLabel: CommandText =
    bootstrap.gmail.configuration === 'required' || bootstrap.gmailSync.configuration === 'required'
      ? { zh: '设置 Google Workspace', ja: 'Google Workspaceを設定' }
      : bootstrap.gmail.status !== 'readonly'
        ? { zh: '确认 Gmail 只读连接', ja: 'Gmail読取専用接続を確認' }
        : bootstrap.gmailSync.status === 'error'
          ? { zh: '重试 Gmail 同步', ja: 'Gmail同期を再試行' }
          : { zh: '同步 Gmail 并确认案件', ja: 'Gmailを同期して案件を確認' }
  const caseTitleOf = (review: JobCaseReviewSnapshot) =>
    review.fields.find((field) => field.key === 'title')?.value?.trim() || review.redactedSubject
  const personNameOf = (person: CandidateReviewSnapshot) => person.localIdentity?.displayName ?? person.fileName
  // 找人/找案件 act on the object selected in its HR list, so the palette works from anywhere without a second click.
  const selectedHrObject = (kind: HrBusinessKind) => {
    const key = agentFeedSelection?.startsWith(`${kind}:`) ? agentFeedSelection : readHrPosition(kind).selected
    return key?.startsWith(`${kind}:`) ? key.slice(kind.length + 1) : null
  }
  const paletteCase = (() => {
    const id = selectedHrObject('case')
    const review = id ? bootstrap.jobCaseReviews.find((item) => item.reviewId === id) : undefined
    return review?.lifecycle === 'active' && review.status === 'completed' ? review : undefined
  })()
  const palettePerson = (() => {
    const id = selectedHrObject('person')
    const person = id ? bootstrap.candidateReviews.find((item) => item.documentId === id) : undefined
    return person?.recordStatus === 'active' ? person : undefined
  })()
  const openHrObject = (kind: HrBusinessKind, id: string) => {
    openHrList(kind)
    setAgentFeedSelection(`${kind}:${id}`)
    saveHrPosition(kind, { selected: `${kind}:${id}` })
    if (kind === 'person') openAgentPersonnel(id)
    else openAgentSystemAccess({ type: 'system-access', destination: 'case-review', reviewId: id })
  }
  const businessCommands: BusinessCommand[] = [
    {
      id: 'hr-find-people',
      group: '業務',
      label: { zh: '找人', ja: '要員を探す' },
      description: paletteCase
        ? { zh: `为「${caseTitleOf(paletteCase)}」找人`, ja: `「${caseTitleOf(paletteCase)}」の要員を探します。` }
        : { zh: '未选择案件，打开案件列表后选择。', ja: '案件が選択されていません。案件一覧から選びます。' },
      // i18n-ignore: search keywords match either language
      keywords: ['找人', '要員を探す', 'matching', 'マッチング', '案件'],
      icon: 'search',
      run: () => {
        if (paletteCase) openCasePeople(paletteCase)
        else openHrList('case')
      }
    },
    {
      id: 'hr-find-cases',
      group: '業務',
      label: { zh: '找案件', ja: '案件を探す' },
      description: palettePerson
        ? { zh: `为「${personNameOf(palettePerson)}」找案件`, ja: `「${personNameOf(palettePerson)}」の案件を探します。` }
        : { zh: '未选择人员，打开人员列表后选择。', ja: '要員が選択されていません。要員一覧から選びます。' },
      // i18n-ignore: search keywords match either language
      keywords: ['找案件', '案件を探す', 'matching', 'マッチング', '要員', '人员'],
      icon: 'search',
      run: () => {
        if (palettePerson) openAgentPersonnel(palettePerson.documentId, true)
        else openHrList('person')
      }
    },
    {
      id: 'hr-cases',
      group: '業務',
      label: { zh: '打开案件列表', ja: '案件一覧を開く' },
      description: {
        zh: `导入后待逐项确认的案件 ${bootstrap.jobCaseReviews.filter((review) => review.lifecycle === 'active' && review.status === 'awaiting-review').length} 件。`,
        ja: `取込後の項目確認待ち案件 ${bootstrap.jobCaseReviews.filter((review) => review.lifecycle === 'active' && review.status === 'awaiting-review').length}件。`
      },
      // i18n-ignore: search keywords match either language
      keywords: ['案件', 'case', 'review', '案件レビュー', 'eml'],
      icon: 'briefcase',
      run: () => openHrList('case')
    },
    {
      id: 'hr-opportunities',
      group: '業務',
      label: { zh: '查看新匹配机会', ja: '新しいマッチング候補を見る' },
      description: {
        zh: `后台发现的新组合 ${opportunities.newCount} 个。`,
        ja: `バックグラウンドで見つけた新しい組み合わせ ${opportunities.newCount}件。`
      },
      // i18n-ignore: search keywords match either language
      keywords: ['新匹配机会', 'マッチング候補', 'opportunity', 'matching', 'マッチング', '机会'],
      icon: 'sparkles',
      run: () => openOpportunities()
    },
    {
      id: 'hr-people',
      group: '業務',
      label: { zh: '打开人员列表', ja: '要員一覧を開く' },
      description: { zh: '查看和管理本机加密的人员资料。', ja: '暗号化したローカル要員情報を確認・管理します。' },
      // i18n-ignore: search keywords match either language
      keywords: ['人员', '要員', '候補者', '候補者プール', 'candidate', '人材', 'profile'],
      icon: 'users',
      run: () => openHrList('person')
    },
    {
      id: 'hr-follow-ups',
      group: '業務',
      label: { zh: '打开跟进', ja: '対応記録を開く' },
      description: { zh: '查看已开始跟进的人员与案件组合。', ja: '対応中の要員と案件の組み合わせを確認します。' },
      // i18n-ignore: search keywords match either language
      keywords: ['跟进', '対応', 'follow', '面談', 'interview'],
      icon: 'tasks',
      run: () => openFollowUps()
    },
    {
      id: 'hr-case-import',
      group: '業務',
      label: { zh: '批量导入案件', ja: '案件を一括取込' },
      description: { zh: '案件 → 批量导入：Gmail、EML、微信和手动输入。', ja: '案件 → 一括取込：Gmail・EML・WeChat・手入力。' },
      // i18n-ignore: search keywords match either language
      keywords: ['批量导入', '一括取込', 'gmail', 'eml', 'wechat', '微信', '案件', 'import'],
      icon: 'upload',
      run: openCaseImport
    },
    {
      id: 'hr-broadcast',
      group: '業務',
      label: { zh: '群发案件', ja: '案件を配信' },
      description: paletteCase
        ? { zh: `群发「${caseTitleOf(paletteCase)}」`, ja: `「${caseTitleOf(paletteCase)}」を配信します。` }
        : { zh: '在案件列表旁打开群发。', ja: '案件一覧の横で配信を開きます。' },
      // i18n-ignore: search keywords match either language
      keywords: ['群发', '群发案件', '配信', 'broadcast', '案件'],
      icon: 'mail',
      run: () => {
        openHrList('case')
        openAgentSystemAccess(
          paletteCase
            ? { type: 'system-access', destination: 'broadcast', reviewId: paletteCase.reviewId }
            : { type: 'system-access', destination: 'broadcast' }
        )
      }
    },
    {
      id: 'hr-recruiting',
      group: '業務',
      label: { zh: '招聘面试', ja: '採用面談' },
      description: { zh: '人员 → 招聘面试：初面、复试和招聘结论。', ja: '要員 → 採用面談：一次面談・再面談・採用結論。' },
      // i18n-ignore: search keywords match either language
      keywords: ['招聘面试', '採用面談', '招聘', '採用', 'recruiting', 'interview', '人员', '要員'],
      icon: 'phone',
      run: () => openRecruiting()
    },
    {
      id: 'hr-interview-schedule',
      group: '業務',
      label: { zh: '面试日程', ja: '面談日程' },
      description: { zh: '跟进 → 面试日程：所有已预约的面试。', ja: '対応記録 → 面談日程：予約済みの面談の一覧。' },
      // i18n-ignore: search keywords match either language
      keywords: ['面试日程', '面談日程', 'schedule', 'interview', '跟进', '日程'],
      icon: 'clock',
      run: openInterviewSchedule
    },
    {
      id: 'hr-new-case',
      group: '業務',
      label: { zh: '新增案件', ja: '案件を追加' },
      description: { zh: '粘贴案件信息，整理后加入案件列表。', ja: '案件情報を貼り付けて整理し、案件一覧に追加します。' },
      // i18n-ignore: search keywords match either language
      keywords: ['新增', '追加', '案件', 'paste', 'case'],
      icon: 'plus',
      run: () => {
        openHrList('case')
        openAgentBatch()
      }
    },
    {
      id: 'hr-import-people',
      group: '業務',
      label: { zh: '导入人员', ja: '要員を取り込む' },
      description: { zh: '粘贴人员介绍，整理后加入人员列表。', ja: '要員紹介を貼り付けて整理し、要員一覧に追加します。' },
      // i18n-ignore: search keywords match either language
      keywords: ['导入', '取り込む', '要員', '人员', 'paste', 'candidate'],
      icon: 'upload',
      run: () => {
        openHrList('person')
        openAgentBatch()
      }
    },
    {
      id: 'input-resume',
      group: '入力',
      label: { zh: '导入技能表', ja: 'スキルシートを取り込む' },
      icon: 'file',
      description: { zh: '选择文件后仍保持执行前预览和本地解析。', ja: 'ファイル選択後も実行前プレビューとローカル解析を維持します。' },
      // i18n-ignore: search keywords match either language
      keywords: ['履歴書', '職務経歴書', 'resume', 'candidate', '候補者', 'ファイル'],
      run: async () => {
        await startResumeImport()
      }
    },
    {
      id: 'input-case',
      group: '入力',
      label: { zh: '手工添加案件', ja: '案件を手動で追加' },
      icon: 'edit',
      description: {
        zh: '在设备内对粘贴的主题和正文脱敏，并生成审核草稿。',
        ja: '貼り付けた件名・本文を端末内で脱敏してレビュー草稿にします。'
      },
      // i18n-ignore: search keywords match either language
      keywords: ['案件', 'メール', '手動', 'paste', 'job'],
      run: startManualCase
    },
    {
      id: 'input-gmail',
      group: '入力',
      label: gmailCommandLabel,
      icon: 'mail',
      description:
        bootstrap.gmail.status === 'readonly'
          ? { zh: '只读同步管理员固定的 Label、期间和上限。', ja: '管理者が固定したLabel・期間・上限だけを読取専用同期します。' }
          : { zh: '确认 Desktop OAuth 设置与 gmail.readonly 连接状态。', ja: 'Desktop OAuth設定とgmail.readonlyの接続状態を確認します。' },
      // i18n-ignore: search keywords match either language
      keywords: ['gmail', 'google workspace', '同期', 'メール', '案件'],
      run: runGoogleWorkspaceCommand
    },
    {
      id: 'work-new',
      group: '作業',
      label: { zh: '创建新任务', ja: '新しい作業を作成' },
      icon: 'plus',
      description: { zh: '输入自然语言目标，并在执行前确认数据范围。', ja: '自然言語で目的を入力し、データ範囲を実行前に確認します。' },
      // i18n-ignore: search keywords match either language
      keywords: ['task', '新規', '指示', 'agent'],
      run: () => {
        openAgentChat()
        setHrNewChatRequest((value) => value + 1)
      }
    },
    {
      id: 'work-list',
      group: '作業',
      label: { zh: '打开活动记录', ja: 'アクティビティを開く' },
      icon: 'file',
      description: {
        zh: `查看 ${bootstrap.tasks.length} 项处理历史及其状态、进度和证据。`,
        ja: `処理履歴 ${bootstrap.tasks.length}件を状態・進捗・証跡とともに確認します。`
      },
      // i18n-ignore: search keywords match either language
      keywords: ['task', '履歴', '進捗', '再開', '失敗'],
      run: openTaskCenter
    },
    {
      id: 'control-reviews',
      group: '統制',
      label: { zh: '打开审核中心', ja: 'レビューセンターを開く' },
      icon: 'check',
      description: {
        zh: `待确认 ${reviewQueue.length} 项（案件、简历、审批）待处理。`,
        ja: `確認待ち ${reviewQueue.length} 件（案件・履歴書・承認）を確認します。`
      },
      // i18n-ignore: search keywords match either language
      keywords: ['review', 'approval', '確認', '承認', 'レビュー', '审核'],
      run: openReviewCenter
    },
    {
      id: 'control-governance',
      group: '統制',
      label: { zh: '打开数据与审批', ja: 'データと承認を開く' },
      icon: 'database',
      description: { zh: '查看脱敏、本地 AI、质量门和备份。', ja: '脱敏、Local AI、品質門とバックアップを確認します。' },
      // i18n-ignore: search keywords match either language
      keywords: ['privacy', 'pii', '脱敏', 'バックアップ', '設定', 'security'],
      run: () => {
        setSelectedTask(null)
        setGovernanceOpen(true)
      }
    },
    ...bootstrap.jobCaseReviews
      .filter((review) => review.lifecycle === 'active')
      .map((review): BusinessCommand => ({
        id: `object-case-${review.reviewId}`,
        group: '対象',
        label: { zh: caseTitleOf(review), ja: caseTitleOf(review) },
        description: { zh: '在案件列表中打开', ja: '案件一覧で開く' },
        keywords: [caseTitleOf(review), review.redactedSubject],
        icon: 'briefcase',
        searchOnly: true,
        run: () => openHrObject('case', review.reviewId)
      })),
    ...bootstrap.candidateReviews
      .filter((person) => person.recordStatus === 'active')
      .map((person): BusinessCommand => ({
        id: `object-person-${person.documentId}`,
        group: '対象',
        label: { zh: personNameOf(person), ja: personNameOf(person) },
        description: { zh: '在人员列表中打开', ja: '要員一覧で開く' },
        keywords: [personNameOf(person), person.fileName],
        icon: 'users',
        searchOnly: true,
        run: () => openHrObject('person', person.documentId)
      })),
    ...bootstrap.tasks.slice(0, 5).map((task): BusinessCommand => ({
      id: `recent-${task.id}`,
      // i18n-ignore: group identifier
      group: '最近の作業',
      label: { zh: localizedTaskTitle('zh-CN', task), ja: task.title },
      description: {
        zh: `${workTaskTypeLabel(task, localeText(true))} · ${task.progress}% · 证据 ${task.evidenceCount} 项`,
        ja: `${task.typeLabel} · ${task.progress}% · 証跡 ${task.evidenceCount}件`
      },
      keywords: [task.typeLabel, task.status, task.instruction],
      icon:
        task.type === 'IMPORT_RESUME'
          ? 'upload'
          : task.type === 'CREATE_CASE'
            ? 'briefcase'
            : task.type === 'MATCH_CANDIDATES'
              ? 'users'
              : 'file',
      run: () => selectTask(task)
    }))
  ]

  const saveCandidateInterviewSchedule = async (input: Parameters<typeof window.sesAgent.saveCandidateInterviewSchedule>[0]) => {
    const interview = await window.sesAgent.saveCandidateInterviewSchedule(input)
    setBootstrap((current) =>
      current
        ? {
            ...current,
            candidateInterviews: [interview, ...current.candidateInterviews.filter((item) => item.id !== interview.id)]
          }
        : current
    )
    return interview
  }
  const cancelCandidateInterviewSchedule = async (input: { interviewId: string; sourceDocumentId: string }) => {
    const interview = await window.sesAgent.cancelCandidateInterviewSchedule(input)
    setBootstrap((current) =>
      current
        ? { ...current, candidateInterviews: [interview, ...current.candidateInterviews.filter((item) => item.id !== interview.id)] }
        : current
    )
    return interview
  }

  const renderCandidatePipelineDetail = (detail: NonNullable<typeof candidateWorkspaceDetail>, showBackToQueue = true) => (
    <CandidatePipeline
      aiCommerce={bootstrap.aiCommerce}
      analyses={bootstrap.resumeAnalyses}
      initialCandidateId={detail.documentId}
      initialInterviewId={detail.interviewId ?? null}
      interviewKind={detail.interviewKind ?? 'recruiting'}
      interviews={bootstrap.candidateInterviews.filter((row) => !row.businessFollowUpId)}
      matchingHome={bootstrap.matchingHome}
      tasks={bootstrap.tasks}
      onBackToQueue={showBackToQueue ? () => setCandidateWorkspaceDetail(null) : undefined}
      onConfirmCandidateProfile={submitCandidateReview}
      onCreateRound={async (input) => {
        const interview = await window.sesAgent.createCandidateInterviewRound(input)
        setBootstrap((current) =>
          current
            ? {
                ...current,
                candidateInterviews: [interview, ...current.candidateInterviews.filter((item) => item.id !== interview.id)]
              }
            : current
        )
        return interview
      }}
      onImportResume={() => void startResumeImport()}
      onOpenCandidateLibrary={(documentId) => (documentId ? openHrObject('person', documentId) : openHrList('person'))}
      onOpenCloudSettings={() => setAiCommerceOpen(true)}
      onLoadOriginalDocument={(sourceDocumentId) => window.sesAgent.getOriginalDocumentPreview(sourceDocumentId)}
      onOpenOriginalDocument={(sourceDocumentId) => window.sesAgent.openOriginalDocument(sourceDocumentId)}
      onOpenIntegrationSettings={() => openApplicationSettings('integrations')}
      onOpenZoomMeeting={(input) => window.sesAgent.openZoomMeeting(input)}
      onOpenInterviewMeeting={(input) => window.sesAgent.openInterviewMeeting(input)}
      onRecordDecision={async (input) => {
        const interview = await window.sesAgent.recordCandidateInterviewDecision(input)
        setBootstrap((current) =>
          current
            ? {
                ...current,
                candidateInterviews: [interview, ...current.candidateInterviews.filter((item) => item.id !== interview.id)]
              }
            : current
        )
        return interview
      }}
      onCorrectDecision={async (input) => {
        const interview = await window.sesAgent.correctCandidateInterviewDecision(input)
        setBootstrap((current) =>
          current
            ? {
                ...current,
                candidateInterviews: [interview, ...current.candidateInterviews.filter((item) => item.id !== interview.id)]
              }
            : current
        )
        return interview
      }}
      onSaveNotes={async (input) => {
        const interview = await window.sesAgent.saveCandidateInterviewNotes(input)
        setBootstrap((current) =>
          current
            ? {
                ...current,
                candidateInterviews: [interview, ...current.candidateInterviews.filter((item) => item.id !== interview.id)]
              }
            : current
        )
        return interview
      }}
      onSavePreparation={async (input) => {
        const interview = await window.sesAgent.saveCandidateInterviewPreparation(input)
        setBootstrap((current) =>
          current
            ? {
                ...current,
                candidateInterviews: [interview, ...current.candidateInterviews.filter((item) => item.id !== interview.id)]
              }
            : current
        )
        return interview
      }}
      onSaveSchedule={saveCandidateInterviewSchedule}
      onCancelSchedule={cancelCandidateInterviewSchedule}
      onSendCloudPrompt={runReviewedAiCommerceCloudPrompt}
      onSetTaskLifecycle={setWorkTaskLifecycle}
      onViewChange={(nextView) =>
        setCandidateWorkspaceDetail((current) => (current ? { ...current, view: nextView } : { ...detail, view: nextView }))
      }
      reviews={bootstrap.candidateReviews}
      view={detail.view}
    />
  )

  const openFollowUpById = (followUpId: string) => {
    void window.sesAgent
      .listBusinessFollowUps()
      .then((rows) => {
        const item = rows.find((row) => row.id === followUpId)
        if (item) {
          setHrFollowTarget({ documentId: item.documentId, reviewId: item.reviewId })
          setHrFollowOpen(true)
          returnToHr()
          closeAgentPanel()
        }
      })
      .catch((cause) => setLoadError(localizedIpcError(locale, cause, t('无法读取跟进记录。', '対応記録を読み込めませんでした。'))))
  }
  const openInterviewFromSchedule = (route: InterviewScheduleRoute) => {
    if (route.businessFollowUpId) {
      openFollowUpById(route.businessFollowUpId)
      return
    }
    setCandidateWorkspaceDetail({
      scope: 'schedule',
      documentId: route.sourceDocumentId,
      interviewId: route.interviewId,
      interviewKind: route.kind,
      view: route.view
    })
  }
  const agentPrimary = activeView === 'agent'
  const pendingActionApprovals = reviewQueue.filter((item) => item.kind === 'action-approval')
  const resumeImports = bootstrap.tasks
    .filter((task) => task.type === 'IMPORT_RESUME')
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
  const failedImports = resumeImports.filter((task) => task.status === 'failed')
  const openHrList = (kind: HrBusinessKind) => {
    setTodayOpen(false)
    setActiveView('agent')
    setSelectedTask(null)
    setGovernanceOpen(false)
    setHrFollowOpen(false)
    setHrBatchStarted(null)
    setHrKind(kind)
    setAgentFeedSelection(readHrPosition(kind).selected)
    setHrSource(null)
    setCasePeopleOpen(false)
    setOpportunitiesOpen(false)
    setOpportunityReturn(null)
    closeAgentPanel()
    setAgentHomeRequest((value) => value + 1)
    try {
      localStorage.setItem('ses-hr-kind-v2', kind)
    } catch {}
  }
  const openOpportunities = (section: HrBusinessKind = hrFollowOpen ? 'case' : hrKind) => {
    openHrList(section)
    setOpportunitiesSection(section)
    setOpportunitiesOpen(true)
    opportunities.reload()
  }
  const returnToHr = () => {
    setActiveView('agent')
    setSelectedTask(null)
    setGovernanceOpen(false)
  }
  const openFollowUps = () => {
    setTodayOpen(false)
    returnToHr()
    setHrFollowOpen(true)
    setHrBatchStarted(null)
    closeAgentPanel()
    setAgentHomeRequest((value) => value + 1)
  }
  const openAgentChat = () => {
    returnToHr()
    setHrChatRequest((value) => value + 1)
  }
  /** 今天 in place of the section's list, panels and results closed. */
  const openToday = () => {
    openHrList(hrKind)
    setTodayOpen(true)
    today.reload()
  }
  railShortcuts.current = [openToday, () => openHrList('case'), () => openHrList('person'), openFollowUps, openAgentChat]
  // Each menu-bar panel link opens the screen its number came from.
  trayNavigationHandler.current = (navigation) => {
    setCommandPaletteOpen(false)
    switch (navigation.route) {
      case 'cases':
        openHrList('case')
        if (navigation.caseView === 'unseen') setHrListFilterRequest({ kind: 'case', filter: 'unseen', id: Date.now() })
        if (navigation.caseView === 'opportunities') openOpportunities('case')
        return
      case 'cases:new':
        openHrList('case')
        openAgentBatch()
        return
      case 'people:import':
        openHrList('person')
        void startResumeImport()
        return
      case 'followups':
        openFollowUps()
        if (navigation.followUpFilter) setFollowUpFilterRequest({ filter: navigation.followUpFilter, id: Date.now() })
        return
      case 'interview-schedule':
        openInterviewSchedule()
        return
      case 'agent':
        openAgentChat()
        // Prefilled only: the operator reads and sends it.
        if (navigation.text) setAgentComposerDraft(navigation.text)
        return
      case 'ai-member':
        setApplicationSettingsOpen(false)
        setAiCommerceOpen(true)
        return
      case 'settings:models':
        setAiCommerceOpen(false)
        openApplicationSettings('models')
        return
      case 'settings:integrations':
        openApplicationSettings('integrations')
        return
    }
  }
  // 完整人员资料 opens the selected person's full profile beside the list; a case's full record is its detail panel.
  const hrLibraryPerson = hrKind === 'person' ? selectedHrObject('person') : null
  // Person list entries use the person's documentId as objectId; only a result for the current profile counts.
  const personMatchCounts: Record<string, number> = {}
  for (const person of bootstrap.candidateReviews) {
    const count = personCaseMatches.count(person.documentId, person.profile?.version)
    if (count !== null) personMatchCounts[person.documentId] = count
  }
  const assessmentJob = bootstrap.jobCaseReviews.find((job) => job.reviewId === assessmentReviewId)
  const caseResultsOpen = casePeopleOpen && hrKind === 'case' && Boolean(assessmentJob) && !hrSource
  // Results opened from 新匹配机会 go back there; the same results opened another way go back to the list.
  const caseFromOpportunities = opportunitiesOpen && opportunityReturn?.kind === 'case' && opportunityReturn.id === assessmentJob?.reviewId
  const personFromOpportunities = opportunitiesOpen && opportunityReturn?.kind === 'person' && opportunityReturn.id === hrSource?.id
  // Results opened while 今天 is the page go back to it (closing them uncovers it).
  const todayVisible = todayOpen && !hrSource && !caseResultsOpen && !hrFollowOpen && !opportunitiesOpen
  const caseFromToday = todayOpen && caseResultsOpen && !caseFromOpportunities
  // The case and person lists are on screen (not 今天, 跟进, results or 新匹配机会 covering them).
  const listSurfaceVisible = agentPrimary && !todayVisible && !hrSource && !caseResultsOpen && !hrFollowOpen && !opportunitiesOpen
  const businessContextOpen =
    agentPrimary && !(matchPanelHidden && hrSource) && Boolean(sideProgressTarget || agentSideMode || agentContextAccess)
  // Over the lists, an object's detail is the right pane of the list surface; the shell's side panel only serves
  // the other pages. The panels stay where they are while closed so their state survives until they open elsewhere.
  const detailInList = !(businessContextOpen && !listSurfaceVisible)
  const personFromToday = todayOpen && Boolean(hrSource) && !personFromOpportunities
  const returnToOpportunities = () => {
    setOpportunityReturn(null)
    setHrKind(opportunitiesSection)
    setAgentFeedSelection(readHrPosition(opportunitiesSection).selected)
    setAgentHomeRequest((value) => value + 1)
    try {
      localStorage.setItem('ses-hr-kind-v2', opportunitiesSection)
    } catch {}
  }
  /** 按案件 opens the case's 找人 results with this person selected; 按人员 opens the person's 找案件 with this case. */
  const openOpportunity = (item: Pick<MatchingOpportunity, 'documentId' | 'reviewId' | 'jobCaseId'>, grouping: OpportunityGrouping) => {
    const person = bootstrap.candidateReviews.find((entry) => entry.documentId === item.documentId)
    if (!person) return
    if (grouping === 'person') {
      openAgentPersonnel(item.documentId, true, item.reviewId)
      setOpportunityReturn({ kind: 'person', id: item.documentId })
      return
    }
    const review =
      bootstrap.jobCaseReviews.find((job) => job.reviewId === item.reviewId) ??
      bootstrap.jobCaseReviews.find((job) => job.jobCase?.id === item.jobCaseId)
    if (!review) return
    openCasePeople(review)
    setOpportunityReturn({ kind: 'case', id: review.reviewId })
    // A pair assessed before opens on its saved result; only a missing or outdated one is assessed again.
    void caseResumes.openPerson(review, person).then(setAssessmentFocus)
  }
  // The card counts exactly the people the panel would show; before the panel has data, the saved count from Main.
  const resumeStates = caseResumes.cardStates(bootstrap.candidateReviews, (task) =>
    Boolean(
      task.documentId && businessProgress.indexes.pairs.get(progressPairKey({ documentId: task.documentId, reviewId: task.reviewId }))
    )
  )
  const composerCase =
    agentContextAccess?.destination === 'case-review' || agentContextAccess?.destination === 'broadcast'
      ? bootstrap.jobCaseReviews.find((review) => review.reviewId === agentContextAccess.reviewId)
      : undefined
  const composerPerson =
    agentContextAccess?.destination === 'candidate' || agentContextAccess?.destination === 'original-document'
      ? bootstrap.candidateReviews.find((review) => review.documentId === agentContextAccess.sourceDocumentId)
      : undefined
  const composerObject = composerPerson
    ? {
        kind: 'person' as const,
        label: composerPerson.localIdentity?.displayName ?? composerPerson.fileName,
        onMatch: composerPerson.recordStatus === 'active' ? () => openAgentPersonnel(composerPerson.documentId, true) : undefined,
        onPromote: composerPerson.recordStatus === 'active' ? () => openAgentPersonnel(composerPerson.documentId) : undefined
      }
    : composerCase
      ? {
          kind: 'case' as const,
          label: composerCase.fields.find((field) => field.key === 'title')?.value ?? composerCase.redactedSubject,
          onMatch:
            composerCase.lifecycle === 'active'
              ? () =>
                  openAgentSystemAccess(
                    composerCase.jobCase
                      ? { type: 'system-access', destination: 'matching', jobCaseId: composerCase.jobCase.id }
                      : { type: 'system-access', destination: 'case-review', reviewId: composerCase.reviewId }
                  )
              : undefined,
          onPromote:
            composerCase.lifecycle === 'active'
              ? () =>
                  openAgentSystemAccess({
                    type: 'system-access',
                    destination: composerCase.jobCase ? 'broadcast' : 'case-review',
                    reviewId: composerCase.reviewId
                  })
              : undefined
        }
      : undefined

  const renderBusinessProgress = (kind: HrBusinessKind, id: string) => (
    <BusinessProgressOverview
      key={`${kind}:${id}`}
      kind={kind}
      objectId={id}
      people={bootstrap.candidateReviews}
      cases={bootstrap.jobCaseReviews}
      onAdvance={setSideProgressTarget}
      focusRequest={progressFocus?.kind === kind && progressFocus.id === id ? progressFocus.request : undefined}
    />
  )

  // One business side panel: the list surface's right pane over the lists, the shell's side panel elsewhere.
  const businessContextPanel = (
    <>
      {sideProgressTarget ? (
        <HrProgressWorkbench
          embedded
          key={`${sideProgressTarget.documentId}:${sideProgressTarget.reviewId}`}
          onBack={() => setSideProgressTarget(null)}
          target={sideProgressTarget}
          reloadToken={bootstrap}
          people={bootstrap.candidateReviews}
          cases={bootstrap.jobCaseReviews}
          interviews={bootstrap.candidateInterviews}
          onView={(kind, id) =>
            kind === 'person'
              ? openAgentPersonnel(id)
              : openAgentSystemAccess({ type: 'system-access', destination: 'case-review', reviewId: id })
          }
          onUpdated={() => {
            caseResumes.refreshAvailability()
            void window.sesAgent
              .getBootstrap()
              .then(setBootstrap)
              .catch((cause) =>
                setLoadError(localizedIpcError(locale, cause, t('无法读取最新数据。', '最新の情報を読み込めませんでした。')))
              )
          }}
        />
      ) : null}
      <div className="hr-object-context" hidden={Boolean(sideProgressTarget)}>
        <div className="agent-business-tools" hidden={agentSideMode !== 'intake' && agentSideMode !== 'personnel'}>
          <header className="agent-tool-header">
            {agentSideMode === 'personnel' && agentContextBack ? (
              <button aria-label={t('返回上一级', '前の画面に戻る')} onClick={agentContextBack} type="button">
                ←
              </button>
            ) : null}
            <strong>
              {agentSideMode === 'intake'
                ? hrKind === 'case'
                  ? t('新增案件', '案件を追加')
                  : t('信息整理', '情報整理')
                : t('人员资料', '要員情報')}
            </strong>
            <button aria-label={t('关闭业务面板', '業務パネルを閉じる')} onClick={closeAgentPanel} type="button">
              ×
            </button>
          </header>
          <div className="business-workbench agent-tool-content">
            <div hidden={agentSideMode !== 'intake'}>
              <div hidden={hrKind !== 'case'}>
                <CaseTextImport
                  inputSeed={hrKind === 'case' ? agentBatchSeed : undefined}
                  cases={bootstrap.jobCaseReviews}
                  onRefresh={async () => setBootstrap(await window.sesAgent.getBootstrap())}
                  onFindPeople={(reviewId) => {
                    const review = bootstrap.jobCaseReviews.find((item) => item.reviewId === reviewId)
                    if (review) openCasePeople(review)
                  }}
                  onOpenCase={(reviewId) => openAgentSystemAccess({ type: 'system-access', destination: 'case-review', reviewId })}
                  onShowInList={closeAgentPanel}
                  onOpenPersonImport={(text) => {
                    openHrList('person')
                    openAgentBatch(text)
                  }}
                />
              </div>
              <div hidden={hrKind === 'case'}>
                {failedImports.length > 0 ? (
                  <details className="hr-intake-issues">
                    <summary>
                      {t('导入失败，需要处理', '対応が必要な取込エラー')} ({failedImports.length})
                    </summary>
                    {failedImports.map((task) => (
                      <button key={task.id} type="button" onClick={() => selectTask(task)}>
                        {localizedTaskTitle(locale, task)}
                        <span>{t('查看失败原因', '失敗理由を確認')}</span>
                      </button>
                    ))}
                  </details>
                ) : null}
                <BusinessIntakeWorkspace
                  inputSeed={agentBatchSeed}
                  modelKey={agentDefaultModelKey ?? 'gpt-5.6-luna'}
                  cases={bootstrap.jobCaseReviews}
                  candidates={bootstrap.candidateReviews}
                  onRefresh={async () => setBootstrap(await window.sesAgent.getBootstrap())}
                  onCase={(reviewId) => openAgentSystemAccess({ type: 'system-access', destination: 'case-review', reviewId })}
                  onPerson={(documentId) => openAgentPersonnel(documentId)}
                  onCaseImport={() => openAgentSystemAccess({ type: 'system-access', destination: 'case-import' })}
                />
              </div>
            </div>
            <div hidden={agentSideMode !== 'personnel'}>
              <PersonnelWorkspace
                renderBusinessProgress={renderBusinessProgress}
                onMatch={() => openAgentPersonnel(agentPersonId!, true)}
                onPrepare={() => {
                  const person = bootstrap.candidateReviews.find((item) => item.documentId === agentPersonId)
                  if (person?.profile)
                    setIntroductionTarget({
                      documentId: person.documentId,
                      profileVersion: person.profile.version,
                      matched: []
                    })
                }}
                initialDocumentId={agentPersonId}
                focusRequest={agentPersonFocusRequest}
                reviews={bootstrap.candidateReviews}
                onRefresh={async () => setBootstrap(await window.sesAgent.getBootstrap())}
                onOpenProfile={openPersonnelProfile}
                onOpenRecruiting={(documentId) => openRecruiting(documentId)}
              />
            </div>
          </div>
        </div>
        <div className="agent-business-tools" hidden={agentSideMode !== 'profile'}>
          <header className="agent-tool-header">
            {agentPersonId ? (
              <button aria-label={t('返回人员资料', '要員情報に戻る')} onClick={() => setAgentSideMode('personnel')} type="button">
                ←
              </button>
            ) : null}
            <strong>{t('完整人员档案', '要員プロフィール')}</strong>
            <button aria-label={t('关闭业务面板', '業務パネルを閉じる')} onClick={closeAgentPanel} type="button">
              ×
            </button>
          </header>
          <div className="agent-tool-content">
            {agentSideMode === 'profile' && agentProfileId ? (
              <CandidateProfilePanel
                documentId={agentProfileId}
                aiCommerce={bootstrap.aiCommerce}
                analyses={bootstrap.resumeAnalyses}
                onClose={() => setAgentSideMode(agentPersonId ? 'personnel' : null)}
                onDeleteCandidate={async (input) => {
                  const result = await deleteCandidateData(input)
                  setAgentPersonId(undefined)
                  return result
                }}
                onLoadHistory={(sourceDocumentId) => window.sesAgent.getCandidateProfileHistory(sourceDocumentId)}
                onLoadOriginalDocument={(sourceDocumentId) => window.sesAgent.getOriginalDocumentPreview(sourceDocumentId)}
                onOpenOriginalDocument={(sourceDocumentId) => window.sesAgent.openOriginalDocument(sourceDocumentId)}
                onOpenCloudSettings={() => setAiCommerceOpen(true)}
                onPreviewDeletion={(sourceDocumentId) => window.sesAgent.previewCandidateDeletion(sourceDocumentId)}
                onSearch={(input) => window.sesAgent.searchCandidateProfiles(input)}
                onSendCloudPrompt={runReviewedAiCommerceCloudPrompt}
                onUpdateCandidate={async (input) => {
                  const result = await window.sesAgent.updateCandidateProfile(input)
                  setBootstrap(await window.sesAgent.getBootstrap())
                  return result
                }}
              />
            ) : null}
          </div>
        </div>
        <div className="agent-standard-context" hidden={agentSideMode !== null}>
          {agentContextAccess && agentContextAccess.destination !== 'matching' ? (
            agentContextAccess.destination === 'interview-schedule' ? (
              <AgentInterviewSchedulePanel
                access={agentContextAccess}
                // Client interviews the Agent books live on 跟进: they are listed too and changed there. A round whose
                // follow-up ended, paused or went back to 待约面 before it took place holds no time and is left out.
                interviews={bootstrap.candidateInterviews.filter((row) => {
                  const follow = row.businessFollowUpId
                    ? businessProgress.rows.find((item) => item.id === row.businessFollowUpId)
                    : undefined
                  const stage = follow?.progress?.stage
                  return !follow || row.decision || !(isInactiveProgressStage(stage) || stage === 'coordinating')
                })}
                onBack={agentContextBack}
                onClose={() => setAgentContextTrail([])}
                onOpenFollowUp={openFollowUpById}
                onCancel={cancelCandidateInterviewSchedule}
                onSave={saveCandidateInterviewSchedule}
                reviews={bootstrap.candidateReviews}
              />
            ) : (
              <AgentBusinessWorkspacePanel
                renderBusinessProgress={renderBusinessProgress}
                onFindPeople={openCasePeople}
                access={agentContextAccess}
                focusRequest={caseFocusRequest}
                broadcastActions={broadcastActions}
                candidateReviews={bootstrap.candidateReviews}
                interviews={bootstrap.candidateInterviews.filter((row) => !row.businessFollowUpId)}
                jobCaseReviews={bootstrap.jobCaseReviews}
                onBack={agentContextBack}
                onClose={() => setAgentContextTrail([])}
                onCreateManualCase={createManualJobCaseDraft}
                onLoadJobCaseSourceText={(reviewId) => window.sesAgent.getJobCaseSourceText(reviewId)}
                onLoadOriginalDocument={(sourceDocumentId) => window.sesAgent.getOriginalDocumentPreview(sourceDocumentId)}
                onOpenAccess={openAgentSystemAccess}
                onResolveActionApproval={resolveActionApproval}
                caseManagement={{
                  onSubmit: submitJobCaseReview,
                  fieldAliases: bootstrap.jobCaseFieldAliases,
                  onSaveFieldAliases: saveJobCaseFieldAliases,
                  onSetLifecycle: setJobCaseLifecycle,
                  onReopen: reopenJobCaseReview,
                  onLoadHistory: (reviewId) => window.sesAgent.getJobCaseHistory(reviewId),
                  onPreviewDeletion: (reviewId) => window.sesAgent.previewJobCaseDeletion(reviewId),
                  onDelete: deleteJobCaseData,
                  onDeleted: () => setAgentContextTrail([])
                }}
                onSubmitJobCaseReview={submitJobCaseReview}
                newCaseDigest={newCaseDigest}
                gmailLastSyncedAt={bootstrap.gmail.status === 'readonly' ? bootstrap.gmailSync.lastSyncedAt : null}
                onMarkSeen={markJobCaseSeen}
                reviewQueue={pendingActionApprovals}
                tasks={bootstrap.tasks}
              />
            )
          ) : null}
        </div>
      </div>
    </>
  )

  return (
    <UiLocaleProvider locale={locale}>
      <BusinessProgressContext.Provider value={businessProgress}>
        <div className="app-shell is-agent-primary is-hr-navigation">
          <HeldDeletionsNotice />
          {toasts.length > 0 ? (
            <div className="app-toasts" role="status">
              {toasts.map((toast) => (
                <button
                  className="app-toast"
                  key={toast.id}
                  onClick={() => {
                    setToasts((current) => current.filter((item) => item.id !== toast.id))
                    setActiveView('agent')
                    setAgentContextTrail(defaultAgentContextTrail())
                  }}
                  type="button"
                >
                  <Icon name="mail" size={13} />
                  {toast.message}
                </button>
              ))}
            </div>
          ) : null}
          <AgentSystemRail
            todayActive={todayOpen && !hrFollowOpen && !opportunitiesOpen}
            onToday={openToday}
            todayCount={today.summary?.status === 'ready' ? today.summary.followUpsDueToday : 0}
            businessKind={hrKind}
            followActive={hrFollowOpen}
            onFollowUps={openFollowUps}
            onBusinessCases={() => openHrList('case')}
            onBusinessPeople={() => openHrList('person')}
            // The same unread rule as the case list, 今天 and the menu bar (per revision, no time window).
            caseUnseenCount={today.summary?.status === 'ready' ? today.summary.cases.unseen : (newCaseDigest?.unseenCount ?? 0)}
            onAgent={openAgentChat}
            onSettings={() => openApplicationSettings('general')}
            onCommandPalette={showCommandPalette}
          />

          <CaseIntroductionComposer
            target={caseIntroductionTarget}
            cases={bootstrap.jobCaseReviews}
            onPrepared={caseIntroductionPrepared}
            onClose={() => setCaseIntroductionTarget(null)}
          />
          <IntroductionComposer
            onFollowUp={(target) => startHrProgress([target])}
            target={introductionTarget}
            people={bootstrap.candidateReviews}
            cases={bootstrap.jobCaseReviews}
            onClose={() => setIntroductionTarget(null)}
          />
          <ResumeImportProgressDrawer
            onClose={() => setResumeImportProgress(null)}
            onOpenCandidates={() => {
              setResumeImportProgress(null)
              openHrList('person')
            }}
            onOpenFailures={(taskId) => {
              setResumeImportProgress(null)
              const task = bootstrap.tasks.find((item) => item.id === taskId)
              if (task) selectTask(task)
              else openTaskCenter()
            }}
            onOpenReviewCenter={() => {
              setResumeImportProgress(null)
              openReviewCenter()
            }}
            onFindCases={(documentId) => {
              setResumeImportProgress(null)
              openAgentPersonnel(documentId, true)
            }}
            onOpenPerson={(documentId) => {
              setResumeImportProgress(null)
              openAgentPersonnel(documentId)
            }}
            progress={resumeImportProgress}
          />

          <div className="hr-route-container">
            {!agentPrimary ? (
              <nav className="hr-return-bar" aria-label={t('返回业务列表', '業務一覧へ戻る')}>
                <button type="button" onClick={returnToHr}>
                  <Icon name="arrow-left" size={16} />
                  {hrFollowOpen
                    ? t('返回跟进', '対応記録に戻る')
                    : todayOpen
                      ? t('返回今天', '今日に戻る')
                      : hrKind === 'case'
                        ? t('返回案件', '案件に戻る')
                        : t('返回人员', '要員に戻る')}
                </button>
              </nav>
            ) : null}
            <div className="agent-route" hidden={!agentPrimary}>
              <AgentWorkspace
                businessMatchingBusy={composerPerson ? hrBusyIds.includes(composerPerson.documentId) : false}
                businessTitle={
                  todayVisible
                    ? t('今天', '今日')
                    : hrFollowOpen
                      ? t('跟进', '対応記録')
                      : hrSource
                        ? t('为此人员找案件', 'この要員の案件を探す')
                        : caseResultsOpen
                          ? t('为此案件找人', 'この案件の要員を探す')
                          : opportunitiesOpen
                            ? t('新匹配机会', '新しいマッチング候補')
                            : hrKind === 'case'
                              ? t('案件', '案件')
                              : t('人员', '要員')
                }
                chatRequest={hrChatRequest}
                newChatRequest={hrNewChatRequest}
                businessObject={
                  agentFeedSelection
                    ? {
                        kind: agentFeedSelection.startsWith('case:') ? 'case' : 'person',
                        id: agentFeedSelection.slice(agentFeedSelection.indexOf(':') + 1)
                      }
                    : undefined
                }
                candidateReviews={bootstrap.candidateReviews}
                composerObject={composerObject}
                activeSystemAccess={agentContextAccess}
                cloudConnected={bootstrap.aiCommerce.connection === 'connected'}
                composerDraft={agentComposerDraft}
                latestContent={
                  <div className="hr-board">
                    <div className="hr-today-surface" hidden={!todayVisible}>
                      <TodayOverview
                        state={today}
                        onOpenRecruitingInterview={(documentId) => openRecruiting(documentId, 'schedule')}
                        onOpenFollowUp={(target) => {
                          openFollowUps()
                          setHrFollowTarget({ documentId: target.documentId, reviewId: target.reviewId })
                        }}
                        onOpenFollowUps={() => {
                          openFollowUps()
                          setFollowUpFilterRequest({ filter: 'today', id: Date.now() })
                        }}
                        onOpenCoordinating={() => {
                          openFollowUps()
                          setFollowUpFilterRequest({ filter: 'coordinating', id: Date.now() })
                        }}
                        onOpenOpportunity={async (item) => {
                          // Marked seen first, as the 新匹配机会 page does; a row not loaded yet is read before opening.
                          const row =
                            opportunities.rows.find((entry) => entry.id === item.id) ??
                            (await window.sesAgent.listMatchingOpportunities?.().catch(() => []))?.find((entry) => entry.id === item.id)
                          if (!row || (await opportunities.control(row, 'seen'))) openOpportunity(item, 'case')
                        }}
                        onOpenOpportunities={() => openOpportunities('case')}
                        onOpenCase={(reviewId) => openHrObject('case', reviewId)}
                        onOpenUnseenCases={() => {
                          openHrList('case')
                          setHrListFilterRequest({ kind: 'case', filter: 'unseen', id: Date.now() })
                        }}
                        onNavigate={(route, payload) =>
                          trayNavigationHandler.current?.({ id: crypto.randomUUID(), route, ...(payload ?? {}) })
                        }
                        onAsk={(text) => {
                          openAgentChat()
                          // Prefilled only, as from the menu-bar panel: the operator reads and sends it.
                          setAgentComposerDraft(text)
                        }}
                      />
                    </div>
                    <div
                      className="hr-list-surface"
                      hidden={todayVisible || Boolean(hrSource) || caseResultsOpen || hrFollowOpen || opportunitiesOpen}
                    >
                      <MatchingOpportunitiesBanner
                        count={opportunities.newCount}
                        recommended={opportunities.newRecommendedCount}
                        proposable={opportunities.proposableCount}
                        onOpen={() => openOpportunities(hrKind)}
                      />
                      <HrObjectList
                        filterRequest={hrListFilterRequest ?? undefined}
                        active={agentPrimary}
                        onAssessResumes={openCaseResumeAssessment}
                        resumeStates={resumeStates}
                        onDeleted={async (entry) => {
                          if (agentFeedSelection === `${entry.kind}:${entry.objectId}`) setAgentFeedSelection(null)
                          setAgentHistoryReloadToken((current) => current + 1)
                          setBootstrap(await window.sesAgent.getBootstrap())
                        }}
                        onOpenProgress={(entry) => {
                          openLatestEntry(entry, 'view')
                          setProgressFocus({ kind: entry.kind, id: entry.objectId, request: ++feedFocusSequence.current })
                        }}
                        onOpenFollowUp={(target) => {
                          openFollowUps()
                          setHrFollowTarget({ documentId: target.documentId, reviewId: target.reviewId })
                        }}
                        cases={bootstrap.jobCaseReviews}
                        kind={hrKind}
                        reloadToken={bootstrap}
                        candidates={bootstrap.candidateReviews}
                        selectedKey={agentFeedSelection}
                        busyObjectIds={hrKind === 'person' ? hrBusyIds : []}
                        personMatchCounts={personMatchCounts}
                        onOpen={openLatestEntry}
                        onIntake={() => openAgentBatch()}
                        onImportResume={() => void startResumeImport()}
                        onOpenLibrary={hrLibraryPerson ? () => openPersonnelProfile(hrLibraryPerson) : undefined}
                        onImportHistory={hrKind === 'case' ? openCaseImport : openResumeImportHistory}
                        extraActions={[
                          ...(hrKind === 'person'
                            ? [{ id: 'recruiting', label: t('招聘面试', '採用面談'), onSelect: () => openRecruiting() }]
                            : []),
                          {
                            id: 'reviews',
                            label: t('审核中心', 'レビューセンター'),
                            onSelect: openReviewCenter,
                            overflow: true
                          },
                          {
                            id: 'activity',
                            label: t('活动记录', 'アクティビティ'),
                            onSelect: openTaskCenter,
                            overflow: true
                          }
                        ]}
                        onRefresh={async () => setBootstrap(await window.sesAgent.getBootstrap())}
                        detail={detailInList ? businessContextPanel : undefined}
                        detailOpen={businessContextOpen && listSurfaceVisible}
                        detailLabel={t('业务工作区', '業務ワークスペース')}
                        onCloseDetail={closeAgentPanel}
                      />
                    </div>
                    <div
                      className="hr-opportunities-surface"
                      hidden={!opportunitiesOpen || Boolean(hrSource) || caseResultsOpen || hrFollowOpen}
                    >
                      <MatchingOpportunitiesPage
                        state={opportunities}
                        visible={opportunitiesOpen && !hrSource && !caseResultsOpen && !hrFollowOpen && agentPrimary}
                        defaultGrouping={opportunitiesSection}
                        backLabel={
                          opportunitiesSection === 'case' ? t('返回案件列表', '案件一覧に戻る') : t('返回人员列表', '要員一覧に戻る')
                        }
                        cases={bootstrap.jobCaseReviews}
                        people={bootstrap.candidateReviews}
                        onBack={() => openHrList(opportunitiesSection)}
                        onOpen={openOpportunity}
                      />
                    </div>
                    <div className="hr-match-surface" hidden={!caseResultsOpen || hrFollowOpen}>
                      {assessmentJob ? (
                        <CaseResumeAssessmentPanel
                          job={assessmentJob}
                          people={bootstrap.candidateReviews}
                          controller={caseResumes}
                          focusTaskId={assessmentFocus}
                          backLabel={
                            caseFromOpportunities
                              ? t('返回新匹配机会', '新しいマッチング候補に戻る')
                              : caseFromToday
                                ? t('返回今天', '今日に戻る')
                                : undefined
                          }
                          onBack={() => {
                            setCasePeopleOpen(false)
                            closeAgentPanel()
                            if (caseFromOpportunities) returnToOpportunities()
                            else {
                              setOpportunitiesOpen(false)
                              setOpportunityReturn(null)
                            }
                          }}
                          onPerson={(documentId) => openAgentPersonnel(documentId)}
                          onOpenPersonImport={() => {
                            openHrList('person')
                            openAgentBatch()
                          }}
                          onSchedule={async (values) => {
                            await startHrProgress(
                              values.map((value) => ({
                                documentId: value.documentId,
                                reviewId: assessmentJob.reviewId,
                                pendingConditions: matchFollowUpLabels(
                                  value.result.qualification,
                                  value.appliedRules.filter((rule) => rule.kind === 'confirm').map((rule) => rule.text),
                                  locale === 'zh-CN'
                                )
                              }))
                            )
                          }}
                          onOriginal={(documentId) => {
                            openAgentSystemAccess({
                              type: 'system-access',
                              destination: 'original-document',
                              sourceDocumentId: documentId
                            })
                          }}
                          onPrepare={(value) =>
                            setIntroductionTarget({
                              documentId: value.documentId,
                              reviewId: assessmentJob.reviewId,
                              profileVersion: value.profileVersion,
                              jobCaseVersion: value.jobCaseVersion,
                              assessment: value.result.assessment,
                              matched: value.result.matched,
                              pendingConditions: matchFollowUpLabels(
                                value.result.qualification,
                                value.appliedRules.filter((rule) => rule.kind === 'confirm').map((rule) => rule.text),
                                locale === 'zh-CN'
                              )
                            })
                          }
                          onFollowUp={(value) => {
                            setAgentSideMode(null)
                            setMatchPanelHidden(false)
                            setSideProgressTarget({
                              documentId: value.documentId,
                              reviewId: assessmentJob.reviewId,
                              pendingConditions: matchFollowUpLabels(
                                value.result.qualification,
                                value.appliedRules.filter((rule) => rule.kind === 'confirm').map((rule) => rule.text),
                                locale === 'zh-CN'
                              )
                            })
                          }}
                        />
                      ) : null}
                    </div>
                    <div className="hr-match-surface" hidden={!hrSource || hrFollowOpen}>
                      <HrMatchingWorkspace
                        source={hrSource}
                        cases={bootstrap.jobCaseReviews}
                        people={bootstrap.candidateReviews}
                        onBusyChange={(ids) => setHrBusyIds(ids)}
                        onView={(kind, id) =>
                          kind === 'person'
                            ? openAgentPersonnel(id)
                            : openAgentSystemAccess({ type: 'system-access', destination: 'case-review', reviewId: id })
                        }
                        onContinue={(target) => {
                          openAgentPersonnel(target.documentId)
                          setSideProgressTarget(target)
                        }}
                        onFollowUp={(target) => startHrProgress([target])}
                        onScheduleMany={startHrProgress}
                        onPrepare={setIntroductionTarget}
                        backLabel={
                          personFromOpportunities
                            ? t('返回新匹配机会', '新しいマッチング候補に戻る')
                            : personFromToday
                              ? t('返回今天', '今日に戻る')
                              : undefined
                        }
                        onBack={() => {
                          setHrSource(null)
                          closeAgentPanel()
                          if (personFromOpportunities) returnToOpportunities()
                          else {
                            setOpportunitiesOpen(false)
                            setOpportunityReturn(null)
                          }
                        }}
                      />
                    </div>
                    <div className="hr-follow-surface" hidden={!hrFollowOpen}>
                      {hrBatchStarted ? (
                        <section aria-label={t('批量开始跟进', '一括で対応を開始')} className="hr-batch-started" role="status">
                          <header>
                            <strong>
                              {t(
                                `已为 ${hrBatchStarted.length} 个组合开始跟进`,
                                `${hrBatchStarted.length} 件の組み合わせで対応を開始しました`
                              )}
                            </strong>
                            <button aria-label={t('关闭提示', 'お知らせを閉じる')} onClick={() => setHrBatchStarted(null)} type="button">
                              ×
                            </button>
                          </header>
                          <ul>
                            {hrBatchStarted.map((target) => {
                              const person = bootstrap.candidateReviews.find((item) => item.documentId === target.documentId)
                              const review = bootstrap.jobCaseReviews.find((item) => item.reviewId === target.reviewId)
                              const label = `${person?.localIdentity?.displayName ?? person?.fileName ?? target.documentId} · ${
                                review?.fields.find((field) => field.key === 'title')?.value ?? review?.redactedSubject ?? target.reviewId
                              }`
                              return (
                                <li key={`${target.documentId}:${target.reviewId}`}>
                                  <button
                                    aria-current={
                                      hrFollowTarget?.documentId === target.documentId && hrFollowTarget.reviewId === target.reviewId
                                        ? 'true'
                                        : undefined
                                    }
                                    onClick={() => setHrFollowTarget({ ...target })}
                                    type="button"
                                  >
                                    {label}
                                  </button>
                                </li>
                              )
                            })}
                          </ul>
                        </section>
                      ) : null}
                      <HrProgressWorkbench
                        filterRequest={followUpFilterRequest ?? undefined}
                        active={hrFollowOpen}
                        onSchedule={openInterviewSchedule}
                        onBackToMatches={
                          hrFollowTarget?.reviewId === assessmentReviewId && !hrSource
                            ? () => {
                                setHrFollowOpen(false)
                                setHrKind('case')
                                setCasePeopleOpen(true)
                                closeAgentPanel()
                                setAgentHomeRequest((value) => value + 1)
                              }
                            : hrSource
                              ? () => {
                                  setHrFollowOpen(false)
                                  closeAgentPanel()
                                  setAgentHomeRequest((value) => value + 1)
                                }
                              : undefined
                        }
                        onBrowse={openHrList}
                        interviews={bootstrap.candidateInterviews}
                        onUpdated={() => {
                          caseResumes.refreshAvailability()
                          void window.sesAgent
                            .getBootstrap()
                            .then(setBootstrap)
                            .catch((cause) =>
                              setLoadError(localizedIpcError(locale, cause, t('无法读取最新数据。', '最新の情報を読み込めませんでした。')))
                            )
                        }}
                        target={hrFollowTarget}
                        reloadToken={bootstrap}
                        people={bootstrap.candidateReviews}
                        cases={bootstrap.jobCaseReviews}
                        onView={(kind, id) =>
                          kind === 'person'
                            ? openAgentPersonnel(id)
                            : openAgentSystemAccess({ type: 'system-access', destination: 'case-review', reviewId: id })
                        }
                      />
                    </div>
                  </div>
                }

                homeRequestToken={agentHomeRequest}
                focusRequest={agentFocusRequest}
                onOpenBatch={openAgentBatch}
                contextPanelOpen={businessContextOpen && !detailInList}
                businessHeaderInline={listSurfaceVisible}
                hideAskAgent={todayVisible}
                contextPanel={detailInList ? undefined : businessContextPanel}
                contextPanelLabel={t('业务工作区', '業務ワークスペース')}
                newCaseUnseenCount={newCaseDigest?.unseenCount ?? 0}
                onOpenNewCaseBoard={() => setAgentContextTrail(defaultAgentContextTrail())}
                defaultModelKey={agentDefaultModelKey}
                jobCaseReviews={bootstrap.jobCaseReviews}
                models={bootstrap.agentChatModels}
                onComposerDraftChange={setAgentComposerDraft}
                onDeleteJobCase={deleteJobCaseData}
                onPreviewJobCaseDeletion={(reviewId) => window.sesAgent.previewJobCaseDeletion(reviewId)}
                onConnectCloud={() => setAiCommerceOpen(true)}
                onCloseContextPanel={closeAgentPanel}
                onImportAtsCsv={importAtsCsvCandidates}
                onImportResume={(conversationId) => startResumeImport(conversationId)}
                onOpenCandidate={openAgentCandidateAccess}
                onOpenCaseImport={() => openAgentSystemAccess({ type: 'system-access', destination: 'case-import' })}
                onOpenBroadcast={() => openAgentSystemAccess({ type: 'system-access', destination: 'broadcast' })}
                onOpenCases={(jobCaseId) => {
                  // The conversation's case opens itself; without one, the case list.
                  const reviewId = jobCaseId
                    ? bootstrap.jobCaseReviews.find((review) => review.jobCase?.id === jobCaseId)?.reviewId
                    : undefined
                  openAgentSystemAccess(
                    reviewId
                      ? { type: 'system-access', destination: 'case-review', reviewId }
                      : { type: 'system-access', destination: 'job-cases' }
                  )
                }}
                onOpenMatching={(jobCaseId) => openAgentSystemAccess({ type: 'system-access', destination: 'matching', jobCaseId })}
                onOpenOriginalDocument={async (sourceDocumentId) =>
                  openAgentSystemAccess({ type: 'system-access', destination: 'original-document', sourceDocumentId })
                }
                onOpenOperatorProfile={() => setOperatorProfileOpen(true)}
                onLocalDataChanged={async () => {
                  const refreshed = await window.sesAgent.getBootstrap()
                  setBootstrap(refreshed)
                  // What the Agent changed also reaches 今天, 跟进 and 新匹配机会.
                  window.dispatchEvent(new Event('ses-business-data-changed'))
                }}
                onOpenSystemAccess={openAgentSystemAccess}
                operatorLabel={localizedMainText(locale, bootstrap.operatorProfile.displayName) || bootstrap.operatorProfile.operatorId}
                reloadToken={agentHistoryReloadToken}
                status={{
                  activeCaseCount,
                  eligibleCandidateCount,
                  runningJobCount: activeProcessingJobCount,
                  backupReminder: bootstrap.recovery.reminder.status
                }}
              />
            </div>
            {agentPrimary ? null : activeView === 'task' && selectedTask ? (
              <TaskWorkspace
                aiCommerce={bootstrap.aiCommerce}
                analyses={bootstrap.resumeAnalyses.filter((analysis) =>
                  selectedTask.contextBindings.some(
                    (binding) => binding.objectType === 'staged-file' && binding.objectId === analysis.fileToken
                  )
                )}
                candidateReviews={bootstrap.candidateReviews.filter((review) =>
                  selectedTask.contextBindings.some(
                    (binding) => binding.objectType === 'staged-file' && binding.objectId === review.documentId
                  )
                )}
                candidateMatchError={candidateMatch.taskId === selectedTask.id ? candidateMatch.error : null}
                candidateMatches={candidateMatch.taskId === selectedTask.id ? candidateMatch.results : []}
                candidateMatchQuery={candidateMatch.taskId === selectedTask.id ? candidateMatch.query : ''}
                candidateMatchRun={candidateMatch.taskId === selectedTask.id ? candidateMatch.run : null}
                candidateMatchStatus={candidateMatch.taskId === selectedTask.id ? candidateMatch.status : 'idle'}
                onApproveProposal={approveProposalDraft}
                onBack={returnToHr}
                onCreateProposal={createProposalDraft}
                onExportProposal={exportProposalPackage}
                onLoadOriginalDocument={(sourceDocumentId) => window.sesAgent.getOriginalDocumentPreview(sourceDocumentId)}
                onOpenCloudSettings={() => setAiCommerceOpen(true)}
                onOpenOriginalDocument={(sourceDocumentId) => window.sesAgent.openOriginalDocument(sourceDocumentId)}
                onRecordProposalFollowUp={recordProposalFollowUp}
                onSubmitCandidateReview={submitCandidateReview}
                onSubmitCandidateMatchFeedback={submitCandidateMatchFeedback}
                onSetTaskLifecycle={setWorkTaskLifecycle}
                onSendCloudPrompt={runReviewedAiCommerceCloudPrompt}
                onUpdateProposal={updateProposalDraft}
                proposalError={proposal.taskId === selectedTask.id ? proposal.error : null}
                proposalStatus={proposal.taskId === selectedTask.id ? proposal.status : 'idle'}
                proposalWorkspace={proposal.taskId === selectedTask.id ? proposal.workspace : null}
                processingJob={bootstrap.processingJobs.find((job) => job.workTaskId === selectedTask.id) ?? null}
                task={selectedTask}
              />
            ) : activeView === 'tasks' && importHistoryOpen ? (
              <ResumeImportHistory
                reviews={bootstrap.candidateReviews}
                tasks={resumeImports}
                onSelect={selectTask}
                onImport={() => void startResumeImport()}
              />
            ) : activeView === 'tasks' ? (
              <main className="task-center-page">
                <header className="task-center-header">
                  <div>
                    <h1>{t('活动记录', 'アクティビティ')}</h1>
                    <p>
                      {t(
                        '可在一个列表中恢复本地处理历史、进度、证据和待确认状态。',
                        'ローカル処理の履歴、進捗、証跡と確認待ち状態を一つの一覧から再開できます。'
                      )}
                    </p>
                  </div>
                  <button onClick={openAgentChat} type="button">
                    <Icon name="sparkles" size={16} />
                    {t('AI 匹配', 'AI マッチング')}
                  </button>
                </header>
                <section className="task-center-stats" aria-label={t('任务状态汇总', '作業状態の集計')}>
                  <div>
                    <strong>{bootstrap.tasks.length}</strong>
                    <span>{t('全部', 'すべて')}</span>
                  </div>
                  <div>
                    <strong>{bootstrap.tasks.filter((task) => ['planned', 'running'].includes(task.status)).length}</strong>
                    <span>{t('进行中', '進行中')}</span>
                  </div>
                  <div>
                    <strong>{bootstrap.tasks.filter((task) => task.status === 'awaiting_review').length}</strong>
                    <span>{t('待确认', '確認待ち')}</span>
                  </div>
                  <div>
                    <strong>{bootstrap.tasks.filter((task) => task.status === 'failed').length}</strong>
                    <span>{t('需处理', '要対応')}</span>
                  </div>
                </section>
                <TaskList onSelect={selectTask} tasks={bootstrap.tasks} title={t('处理记录与证据', '処理履歴と証跡')} />
                <footer className="app-footer">
                  {t(
                    '任务指令、进度和证据保存在加密本地数据库 · 不发送到云端',
                    'タスクの指示・進捗・証跡は暗号化ローカルDBに保存 · Cloud送信なし'
                  )}
                </footer>
              </main>
            ) : activeView === 'reviews' ? (
              <ReviewCenter
                items={reviewQueue}
                onOpenCandidate={(documentId, taskId) => {
                  const task = taskId ? bootstrap.tasks.find((item) => item.id === taskId) : null
                  if (task) selectTask(task)
                  else openHrObject('person', documentId)
                }}
                onOpenCase={(reviewId) => openHrObject('case', reviewId)}
                onOpenTask={(taskId) => {
                  const task = bootstrap.tasks.find((item) => item.id === taskId)
                  if (task) selectTask(task)
                }}
                onResolveActionApproval={resolveActionApproval}
              />
            ) : activeView === 'case-import' ? (
              <JobCaseInbox
                gmailConnected={bootstrap.gmail.status === 'readonly'}
                gmailImportNotice={gmailImportNotice}
                gmailSetupRequired={bootstrap.gmail.configuration === 'required' || bootstrap.gmailSync.configuration === 'required'}
                manualCreateRequestId={manualCaseRequestId}
                onDelete={deleteJobCaseData}
                onCreateChat={createChatPasteJobCaseDraft}
                onCreateManual={createManualJobCaseDraft}
                onReadWechat={readWechatVisibleMessages}
                onDismissGmailImportNotice={() => setGmailImportNotice(null)}
                onManualCreateRequestHandled={() => setManualCaseRequestId(null)}
                onImportEml={importEmlJobCaseDrafts}
                onImportGmail={importGmailFromComposer}
                onOpenExternalSettings={() => openApplicationSettings('integrations')}
                onOpenLibrary={(reviewId) => (reviewId ? openHrObject('case', reviewId) : openHrList('case'))}
                onPreviewDeletion={(reviewId) => window.sesAgent.previewJobCaseDeletion(reviewId)}
                reviews={bootstrap.jobCaseReviews}
                wechatVisibleMessage={bootstrap.wechatVisibleMessage}
              />
            ) : activeView === 'interview-workbench' ? (
              candidateWorkspaceDetail?.scope === 'recruiting' ? (
                renderCandidatePipelineDetail(candidateWorkspaceDetail)
              ) : (
                <RecruitingInterviewWorkspace
                  interviews={bootstrap.candidateInterviews.filter((row) => !row.businessFollowUpId)}
                  onImportResume={() => void startResumeImport()}
                  onOpenCandidate={(documentId, view, interviewId, interviewKind) =>
                    setCandidateWorkspaceDetail({ scope: 'recruiting', documentId, view, interviewId, interviewKind })
                  }
                  reviews={bootstrap.candidateReviews}
                />
              )
            ) : activeView === 'interview-schedule' ? (
              candidateWorkspaceDetail?.scope === 'schedule' ? (
                renderCandidatePipelineDetail(candidateWorkspaceDetail)
              ) : (
                <InterviewScheduleCenter
                  cases={bootstrap.jobCaseReviews}
                  // Every interview, client rounds booked on 跟进 included; those open their follow-up.
                  interviews={bootstrap.candidateInterviews}
                  onOpenInterview={openInterviewFromSchedule}
                  reviews={bootstrap.candidateReviews}
                />
              )
            ) : null}
          </div>
          <GovernancePanel
            bootstrap={bootstrap}
            onConfirmRecovery={(input) => window.sesAgent.confirmRecovery(input)}
            onConnectGoogleWorkspace={connectGoogleWorkspace}
            onDiagnoseGoogleWorkspace={diagnoseGoogleWorkspace}
            onRunGoogleWorkspaceOnlineAcceptance={runGoogleWorkspaceOnlineAcceptance}
            onSaveGoogleWorkspaceAdminConfiguration={(input) => window.sesAgent.saveGoogleWorkspaceAdminConfiguration(input)}
            onCreateRecovery={createRecoveryPackage}
            onDisconnectGoogleWorkspace={disconnectGoogleWorkspace}
            onGetCandidateEvaluationAuthoringWorkspace={() => window.sesAgent.getCandidateEvaluationAuthoringWorkspace()}
            onCreateCandidateEvaluationDraft={(input) => window.sesAgent.createCandidateEvaluationDraft(input)}
            onSaveCandidateEvaluationDraftCase={(input) => window.sesAgent.saveCandidateEvaluationDraftCase(input)}
            onDeleteCandidateEvaluationDraftCase={(input) => window.sesAgent.deleteCandidateEvaluationDraftCase(input)}
            onEvaluateCandidateEvaluationDraft={evaluateCandidateEvaluationDraft}
            onImportCandidateEvaluationBenchmark={importCandidateEvaluationBenchmark}
            onPreviewRecovery={(input) => window.sesAgent.previewRecoveryPackage(input)}
            onSnoozeRecoveryReminder={snoozeRecoveryReminder}
            onSyncGoogleWorkspace={syncGoogleWorkspace}
            onClose={() => setGovernanceOpen(false)}
            responsiveOpen={governanceOpen}
            showExternalSystems={false}
          />
          {operatorProfileOpen ? (
            <LocalOperatorProfileDialog
              onClose={() => setOperatorProfileOpen(false)}
              onSave={saveLocalOperatorProfile}
              profile={bootstrap.operatorProfile}
            />
          ) : null}
          {applicationSettingsOpen ? (
            <ApplicationSettingsDialog
              bootstrap={bootstrap}
              broadcastActions={broadcastActions}
              initialSection={applicationSettingsSection}
              sectionRequest={applicationSettingsRequest}
              fieldAliases={bootstrap.jobCaseFieldAliases}
              onSaveFieldAliases={saveJobCaseFieldAliases}
              onConnectGoogleWorkspace={connectGoogleWorkspace}
              onClose={() => setApplicationSettingsOpen(false)}
              onDisconnectGoogleWorkspace={disconnectGoogleWorkspace}
              onOpenAiCommerce={() => {
                setApplicationSettingsOpen(false)
                setAiCommerceOpen(true)
              }}
              onOpenDataSecurity={() => {
                setApplicationSettingsOpen(false)
                setGovernanceOpen(true)
              }}
              onOpenOperatorProfile={() => {
                setApplicationSettingsOpen(false)
                setOperatorProfileOpen(true)
              }}
              onOpenZoomTestMeeting={() => window.sesAgent.openZoomTestMeeting()}
              onSave={saveLocalApplicationPreferences}
              onTestAiModel={(modelKey) => window.sesAgent.testAiModel({ modelKey })}
              onSyncGoogleWorkspace={syncGoogleWorkspace}
              preferences={bootstrap.preferences}
            />
          ) : null}
          {aiCommerceOpen ? (
            <AiCommerceMemberDialog
              callbackError={aiCommerceCallbackError}
              onClose={() => setAiCommerceOpen(false)}
              onConnect={connectAiCommerce}
              onDisconnect={disconnectAiCommerce}
              onOpenMemberCenter={() => window.sesAgent.openAiCommerceMemberCenter()}
              onRefresh={refreshAiCommerce}
              onResetToken={resetAiCommerceToken}
              onSendPrompt={runReviewedAiCommerceCloudPrompt}
              privacy={bootstrap.privacy}
              state={bootstrap.aiCommerce}
            />
          ) : null}
          {commandPaletteOpen ? <CommandPalette commands={businessCommands} onClose={closeCommandPalette} /> : null}
        </div>
      </BusinessProgressContext.Provider>
    </UiLocaleProvider>
  )
}
