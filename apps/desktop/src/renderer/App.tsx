import { BusinessProgressContext, useBusinessProgressData } from './business-progress-data'
import { BusinessProgressOverview } from './components/BusinessProgressOverview'
import { CaseIntroductionComposer, type CaseIntroductionTarget } from './components/CaseIntroductionComposer'
import type { FollowUpTarget } from './components/HrFollowUps'
import { HrProgressWorkbench } from './components/HrProgressWorkbench'
import { ResumeImportHistory } from './components/ResumeImportHistory'
import { HrObjectList } from './components/HrObjectList'
import { readHrPosition, saveHrPosition, type HrBusinessKind } from './hr-business-navigation'
import { HrMatchingWorkspace, type HrMatchSource, type IntroductionTarget } from './components/HrMatchingWorkspace'
import { IntroductionComposer } from './components/IntroductionComposer'
import { BusinessIntakeWorkspace } from './components/BusinessIntakeWorkspace'
import { CaseMatchingWorkspace } from './components/CaseMatchingWorkspace'
import { PersonnelWorkspace, type PersonnelEditorTarget } from './components/PersonnelWorkspace'
import type { BusinessFeedEntry, TypedAiConversationReference } from '@shared'
import { BusinessWorkbench } from './components/BusinessWorkbench'
import { startTransition, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { SignedWorkTaskPreview, WorkTask } from '@domain'
import type {
  BootstrapPayload,
  AiConversationSnapshot,
  AgentSystemAccessBlock,
  CandidateMatchResult,
  CandidateMatchRunSummary,
  CreateWorkTaskInput,
  JobCaseReviewSnapshot,
  NewJobCaseDigest,
  ProposalMutationResult,
  ProposalWorkspaceSnapshot,
  SubmitCandidateMatchFeedbackInput,
  SubmitCandidateMatchFeedbackResult,
  StartupStatus,
  WorkTaskInput
} from '@shared'
import { GovernancePanel } from './components/GovernancePanel'
import { CandidateLibrary } from './components/CandidateLibrary'
import { CandidatePipeline, type PipelineView } from './components/CandidatePipeline'
import { CandidateDirectoryWorkspace, ClientInterviewWorkspace, RecruitingInterviewWorkspace } from './components/CandidateWorkspaces'
import { ResumeImportProgressDrawer, progressFiles, type ResumeImportProgress } from './components/ResumeImportProgressDrawer'
import { InterviewScheduleCenter, type InterviewScheduleRoute } from './components/InterviewScheduleCenter'
import { CommandPalette, type BusinessCommand } from './components/CommandPalette'
import { JobCaseInbox, type GmailImportNotice } from './components/JobCaseInbox'
import { Icon } from './components/Icon'
import { ApplicationSettingsDialog, type ApplicationSettingsSection } from './components/ApplicationSettingsDialog'
import { AiCommerceMemberDialog } from './components/AiCommerceMemberDialog'
import { LocalOperatorProfileDialog } from './components/LocalOperatorProfileDialog'
import { buildReviewQueue, ReviewCenter } from './components/ReviewCenter'
import { Sidebar, type SidebarView } from './components/Sidebar'
import { TaskComposer } from './components/TaskComposer'
import { TaskList } from './components/TaskList'
import { TaskWorkspace } from './components/TaskWorkspace'
import { MatchingHomeDashboard } from './components/MatchingHomeDashboard'
import { AgentWorkspace } from './components/AgentWorkspace'
import { pushContextAccess } from './context-trail'
import { AgentInterviewSchedulePanel } from './components/AgentInterviewSchedulePanel'
import { AgentBusinessWorkspacePanel } from './components/AgentBusinessWorkspacePanel'
import type { BroadcastPanelActions } from './components/BroadcastWorkspaceView'
import type { BroadcastSettingsActions } from './components/BroadcastSettingsSection'
import { AgentSystemRail } from './components/AgentSystemRail'
import { StartupRecoveryScreen } from './components/StartupRecoveryScreen'
import { localizedWorkDate, UiLocaleProvider, localizedTaskTitle, useLegacyRendererLocalization } from './i18n'

/** What the right workspace shows when nothing else was opened: today's arrivals. */
const defaultAgentContextTrail = (): AgentSystemAccessBlock[] => []

export function App() {
  const [bootstrap, setBootstrap] = useState<BootstrapPayload | null>(null)
  const businessProgress = useBusinessProgressData(bootstrap)
  const [sideProgressTarget, setSideProgressTarget] = useState<FollowUpTarget | null>(null)
  const [progressFocus, setProgressFocus] = useState<{kind: HrBusinessKind; id: string; request: number} | null>(null)
  const [startupRecovery, setStartupRecovery] = useState<Extract<StartupStatus, { mode: 'recovery-required' }> | null>(null)
  const [selectedTask, setSelectedTask] = useState<WorkTask | null>(null)
  const [activeView, setActiveView] = useState<SidebarView>('home')
  const [importHistoryOpen, setImportHistoryOpen] = useState(false)
  const [candidateWorkspaceDetail, setCandidateWorkspaceDetail] = useState<{
    scope: 'candidate' | 'recruiting' | 'client' | 'schedule' | 'entry'
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
  const [aiCommerceOpen, setAiCommerceOpen] = useState(false)
  const [aiCommerceCallbackError, setAiCommerceCallbackError] = useState<string | null>(null)
  const [operatorProfileOpen, setOperatorProfileOpen] = useState(false)
  const [composerFocusRequestId, setComposerFocusRequestId] = useState<number | null>(null)
  const [resumeImportProgress, setResumeImportProgress] = useState<ResumeImportProgress | null>(null)
  const [manualCaseRequestId, setManualCaseRequestId] = useState<number | null>(null)
  const [matchingJobCaseId, setMatchingJobCaseId] = useState<string | null>(null)
  const [agentHistoryReloadToken, setAgentHistoryReloadToken] = useState(0)
  // The right-hand workspace keeps a trail of the screens it opened, so a
  // sub-page can step back to where it came from instead of only closing.
  const [agentHomeRequest, setAgentHomeRequest] = useState(0)
  const [hrKind, setHrKind] = useState<HrBusinessKind>(() => { try { return localStorage.getItem('ses-hr-kind-v2') === 'person' ? 'person' : 'case' } catch { return 'case' } })
  const [hrFollowOpen, setHrFollowOpen] = useState(false)
  const [hrFollowTarget, setHrFollowTarget] = useState<FollowUpTarget | null>(null)
  const [hrSource, setHrSource] = useState<HrMatchSource | null>(null)
  const [hrBusy, setHrBusy] = useState(false)
  useEffect(() => {
    const refresh = () => { void window.sesAgent.getBootstrap().then(setBootstrap) }
    window.addEventListener('ses-business-data-changed', refresh)
    return () => window.removeEventListener('ses-business-data-changed', refresh)
  }, [])
  const [hrChatRequest, setHrChatRequest] = useState(0)
  const [caseIntroductionTarget, setCaseIntroductionTarget] = useState<CaseIntroductionTarget | null>(null)
  const caseIntroductionPrepared = useCallback((review: JobCaseReviewSnapshot) => {
    setBootstrap((current) => current ? { ...current, jobCaseReviews: current.jobCaseReviews.map((item) => item.reviewId === review.reviewId ? review : item) } : current)
    setCaseIntroductionTarget((current) => current?.reviewId === review.reviewId && current.reviewRevision === review.reviewRevision
      ? { reviewId: review.reviewId, reviewRevision: review.reviewRevision, jobCaseVersion: review.jobCase!.version } : current)
  }, [])
  const [introductionTarget, setIntroductionTarget] = useState<IntroductionTarget | null>(null)
  const [agentSideMode, setAgentSideMode] = useState<'intake' | 'personnel' | null>(null)
  const [agentFeedSelection, setAgentFeedSelection] = useState<string | null>(() => readHrPosition(hrKind).selected)
  const [personnelEditorRequest, setPersonnelEditorRequest] = useState<PersonnelEditorTarget & { id: number }>()
  const [personnelProfileRequest, setPersonnelProfileRequest] = useState<{ id: number; documentId: string }>()
  const [personnelMessageEdits, setPersonnelMessageEdits] = useState<Record<string, string>>({})
  const personnelMessageDrafts = { values: personnelMessageEdits, onChange: (key: string, text: string) => setPersonnelMessageEdits((current) => ({ ...current, [key]: text })) }
  const [agentPersonId, setAgentPersonId] = useState<string>()
  const [agentBatchSeed, setAgentBatchSeed] = useState<{ id: number; text: string }>()
  const [agentPersonFocusRequest, setAgentPersonFocusRequest] = useState<{ id: number; documentId: string; section: 'view' | 'match' | 'promote' }>()
  const [caseMatchingId, setCaseMatchingId] = useState<string | null>(null)
  const [caseMatchRequest, setCaseMatchRequest] = useState<{ id: number; jobCaseId: string }>()
  const [caseMatchId, setCaseMatchId] = useState<string>()
  const [personnelMatchingId, setPersonnelMatchingId] = useState<string | null>(null)
  const feedFocusSequence = useRef(0)
  const [caseFocusRequest, setCaseFocusRequest] = useState(0)
  const [agentPersonMatchRequest, setAgentPersonMatchRequest] = useState<{ id: number; documentId: string }>()
  const [agentFocusRequest, setAgentFocusRequest] = useState<{ id: number; caseReference: TypedAiConversationReference | null; candidateDocumentId?: string }>()
  const [agentContextTrail, setAgentContextTrail] = useState<AgentSystemAccessBlock[]>(defaultAgentContextTrail)
  const agentContextAccess = agentContextTrail[agentContextTrail.length - 1] ?? null
  const [agentComposerDraft, setAgentComposerDraft] = useState('')
  const [requestedJobCaseReviewId, setRequestedJobCaseReviewId] = useState<string | null>(null)
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
  const candidateMatchStateRef = useRef(candidateMatch)
  candidateMatchStateRef.current = candidateMatch
  const hasActiveProcessingJobs = bootstrap?.processingJobs.some((job) =>
    ['queued', 'running', 'retry_wait'].includes(job.status)
  ) ?? false
  const activeProcessingJobCount = bootstrap?.processingJobs.filter((job) =>
    ['queued', 'running', 'retry_wait'].includes(job.status)
  ).length ?? 0
  const activeCaseCount = bootstrap?.jobCaseReviews.filter((review) =>
    review.lifecycle === 'active' && review.status === 'completed'
  ).length ?? 0
  const eligibleCandidateCount = bootstrap?.candidateReviews.filter((review) =>
    review.talentPoolStatus === 'eligible'
  ).length ?? 0
  const selectedTaskId = selectedTask?.id ?? null
  const commandPaletteAvailable = bootstrap !== null && startupRecovery === null && loadError === null
  const normalSessionReady = bootstrap !== null && startupRecovery === null
  const locale = bootstrap?.preferences.locale ?? 'ja-JP'
  useLegacyRendererLocalization(locale)
  const reviewQueue = useMemo(() => bootstrap ? buildReviewQueue(
    bootstrap.tasks,
    bootstrap.candidateReviews,
    bootstrap.jobCaseReviews,
    bootstrap.actionApprovals
  ) : [], [bootstrap?.actionApprovals, bootstrap?.candidateReviews, bootstrap?.jobCaseReviews, bootstrap?.tasks])

  const showCommandPalette = () => {
    commandPaletteOpener.current = document.activeElement instanceof HTMLElement ? document.activeElement : null
    setCommandPaletteOpen(true)
  }

  const closeCommandPalette = (restoreFocus: boolean) => {
    setCommandPaletteOpen(false)
    const opener = commandPaletteOpener.current
    commandPaletteOpener.current = null
    if (restoreFocus) requestAnimationFrame(() => opener?.isConnected && opener.focus())
  }

  useEffect(() => {
    if (startupRecovery) return undefined
    let active = true
    void window.sesAgent.getStartupStatus()
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
            setActiveView(payload.featureFlags?.conversationalMatchingEnabled === true ? 'agent' : 'home')
          }
          setBootstrap(payload)
        }
      })
      .catch((cause: unknown) => {
        if (active) setLoadError(cause instanceof Error ? cause.message : 'アプリを初期化できませんでした。')
      })
    return () => {
      active = false
    }
  }, [startupRecovery])

  useEffect(() => {
    if (!commandPaletteAvailable) return undefined
    const handleShortcut = (event: globalThis.KeyboardEvent) => {
      if (!(event.metaKey || event.ctrlKey) || event.key.toLocaleLowerCase('en-US') !== 'k') return
      event.preventDefault()
      if (commandPaletteOpen) {
        closeCommandPalette(true)
      } else {
        showCommandPalette()
      }
    }
    window.addEventListener('keydown', handleShortcut)
    return () => window.removeEventListener('keydown', handleShortcut)
  }, [commandPaletteAvailable, commandPaletteOpen])

  useEffect(() => window.sesAgent.onAiCommerceStateChanged((update) => {
    setBootstrap((current) => current ? { ...current, aiCommerce: update.state } : current)
    setAiCommerceCallbackError(update.error)
  }), [])

  const refreshNewCaseDigest = () => {
    void window.sesAgent.getJobCaseNewDigest()
      .then(setNewCaseDigest)
      .catch(() => { /* The bootstrap error path remains authoritative. */ })
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
    void window.sesAgent.markJobCaseSeen(reviewId)
      .then(() => refreshNewCaseDigest())
      .catch(() => { /* Unread state is a convenience; a failure must not block the screen. */ })
  }

  useEffect(() => {
    if (!normalSessionReady) return
    refreshNewCaseDigest()
  }, [normalSessionReady, bootstrap?.jobCaseReviews])

  useEffect(() => window.sesAgent.onOpenNewCaseBoard(() => {
    setAgentSideMode(null)
    setAgentHomeRequest((current) => current + 1)
    setActiveView('agent')
    setAgentContextTrail(defaultAgentContextTrail())
  }), [])

  useEffect(() => window.sesAgent.onGmailSyncCompleted((completion) => {
    // A scheduled sync in Main imported mail: pick up the new cases and show
    // the same notice as the manual button, from the refreshed checkpoint.
    void window.sesAgent.getBootstrap().then((refreshed) => {
      setBootstrap((current) => current ? refreshed : current)
      if (completion.imported > 0 && refreshed.gmailSync.lastRun && refreshed.gmailSync.lastSyncedAt) {
        setGmailImportNotice({
          syncedAt: refreshed.gmailSync.lastSyncedAt,
          storedMessages: refreshed.gmailSync.storedMessages,
          ...refreshed.gmailSync.lastRun
        })
      }
      if (completion.imported > 0 || (completion.personnelImported ?? 0) > 0) {
        showToast(refreshed.preferences.locale === 'zh-CN'
          ? `Gmail 同步：邮件 ${completion.imported} 封，人员 ${completion.personnelImported ?? 0} 名`
          : `Gmail 同期：メール ${completion.imported}件、人材 ${completion.personnelImported ?? 0}名`)
      }
      refreshNewCaseDigest()
    }).catch(() => { /* The startup/bootstrap error path remains authoritative. */ })
  }), [])

  // Preserve business context while visiting traditional management pages.

  useEffect(() => {
    // The recovery screen deliberately exposes only recovery-safe IPC methods.
    // Do not install the normal-session refresher until Bootstrap is available.
    if (!normalSessionReady) return undefined
    let active = true
    const refreshRecovery = () => {
      void window.sesAgent.getRecoveryState()
        .then((recovery) => {
          if (active) setBootstrap((current) => current ? { ...current, recovery } : current)
        })
        .catch(() => { /* The main bootstrap error path remains authoritative. */ })
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
        const latestJob = selectedTaskId
          ? payload.processingJobs.find((job) => job.workTaskId === selectedTaskId)
          : null
        if (
          selected?.type === 'MATCH_CANDIDATES' &&
          latestJob?.type === 'candidate-match' &&
          latestJob.status === 'succeeded' &&
          candidateMatchStateRef.current.status !== 'ready' &&
          !backgroundHydratedJobIds.current.has(latestJob.id)
        ) {
          backgroundHydratedJobIds.current.add(latestJob.id)
          void window.sesAgent.executeCandidateMatchTask(selected.id).then((result) => {
            if (!active) return
            setSelectedTask((current) => current?.id === result.task.id ? result.task : current)
            setBootstrap((current) => {
              if (!current) return current
              const tasks = new Map(current.tasks.map((task) => [task.id, task]))
              tasks.set(result.task.id, result.task)
              const jobs = new Map(current.processingJobs.map((job) => [job.id, job]))
              jobs.set(result.processingJob.id, result.processingJob)
              return { ...current, tasks: [...tasks.values()], processingJobs: [...jobs.values()] }
            })
            setCandidateMatch((current) => current.taskId === result.task.id ? {
              taskId: result.task.id,
              status: 'ready',
              query: result.query,
              run: result.run,
              results: result.matches,
              error: null
            } : current)
            void window.sesAgent.getBootstrap().then((latest) => {
              if (!active) return
              const tasks = new Map(latest.tasks.map((task) => [task.id, task]))
              tasks.set(result.task.id, result.task)
              const processingJobs = new Map(latest.processingJobs.map((job) => [job.id, job]))
              processingJobs.set(result.processingJob.id, result.processingJob)
              setBootstrap({ ...latest, tasks: [...tasks.values()], processingJobs: [...processingJobs.values()] })
            })
          }).catch(() => {
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
    const interval = window.setInterval(() => { void refreshProcessingJobs() }, 1_000)
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
  const broadcastActions = useMemo<BroadcastPanelActions & BroadcastSettingsActions>(() => ({
    loadWorkspace: () => window.sesAgent.listBroadcastWorkspace(),
    draftBroadcast: (input) => window.sesAgent.draftCaseBroadcast(input),
    draftUpdateNotice: (input) => window.sesAgent.draftCaseUpdateNotice(input),
    recordCopy: (input) => window.sesAgent.recordCaseBroadcastCopy(input),
    openEmail: (input) => window.sesAgent.openCaseBroadcastEmail(input),
    listBroadcasts: (reviewId) => window.sesAgent.listCaseBroadcasts(reviewId),
    createTemplate: (input) => window.sesAgent.createBroadcastTemplate(input),
    updateTemplate: (input) => window.sesAgent.updateBroadcastTemplate(input),
    deleteTemplate: (input) => window.sesAgent.deleteBroadcastTemplate(input)
  }), [])

  if (loadError) {
    return <main className="fatal-state"><Icon name="alert" size={24} /><h1>起動に失敗しました</h1><p>{loadError}</p></main>
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
    return <main className="loading-state"><span className="loading-mark">S</span><p>安全な作業環境を準備しています…</p></main>
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
          setSelectedTask((current) => current?.id === result.task.id ? result.task : current)
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
            error: cause instanceof Error ? cause.message : '候補者を検索できませんでした。'
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
            error: cause instanceof Error ? cause.message : '提案ワークスペースを読み込めませんでした。'
          })
        }
      )
    } else {
      setProposal({ taskId: task.id, status: 'idle', workspace: null, error: null })
    }
    const missingResumeAnalyses = task.type === 'IMPORT_RESUME' && executable
      ? task.contextBindings.filter((binding) =>
          binding.objectType === 'staged-file' &&
          !bootstrap.resumeAnalyses.some((analysis) =>
            analysis.fileToken === binding.objectId && analysis.analysisVersion === 'resume-analysis-v6'
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

  const submitCandidateMatchFeedback = async (
    input: SubmitCandidateMatchFeedbackInput
  ): Promise<SubmitCandidateMatchFeedbackResult> => {
    const result = await window.sesAgent.submitCandidateMatchFeedback(input)
    setCandidateMatch((current) => ({
      ...current,
      run: result.run,
      results: current.results.map((match) => match.matchResultId === result.matchResultId
        ? { ...match, feedback: result.feedback }
        : match)
    }))
    return result
  }

  const applyProposalMutation = (result: ProposalMutationResult) => {
    setSelectedTask((current) => current?.id === result.task.id ? result.task : current)
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
      return { ...current, status: 'ready', workspace: { ...current.workspace, drafts: [result.draft, ...[...drafts.values()].filter((draft) => draft.id !== result.draft.id)] }, error: null }
    })
    void window.sesAgent.getProposalWorkspace(result.task.id).then((workspace) => {
      setProposal((current) => current.taskId === result.task.id
        ? { ...current, status: 'ready', workspace, error: null }
        : current)
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
          setBootstrap((current) => current ? {
            ...current,
            processingJobs: [
              processingJob,
              ...current.processingJobs.filter((job) => job.id !== processingJob.id)
            ]
          } : current)
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
    setBootstrap((current) => current ? { ...current, gmail } : current)
    if (gmail.status !== 'readonly') return
    await window.sesAgent.syncGoogleWorkspace()
    setBootstrap(await window.sesAgent.getBootstrap())
  }

  const diagnoseGoogleWorkspace = () => window.sesAgent.diagnoseGoogleWorkspace()

  const runGoogleWorkspaceOnlineAcceptance = async () => {
    const googleWorkspaceAcceptance = await window.sesAgent.runGoogleWorkspaceOnlineAcceptance()
    setBootstrap((current) => current ? { ...current, googleWorkspaceAcceptance } : current)
    return googleWorkspaceAcceptance
  }

  const disconnectGoogleWorkspace = async () => {
    const gmail = await window.sesAgent.disconnectGoogleWorkspace()
    setBootstrap((current) => current ? { ...current, gmail } : current)
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
    const refreshed = await performGoogleWorkspaceSync()
    const run = refreshed.gmailSync.lastRun
    if (!run || !refreshed.gmailSync.lastSyncedAt) {
      throw new Error('Gmail 同期結果を確認できませんでした。データと承認から同期状態を確認してください。')
    }
    setGmailImportNotice({
      syncedAt: refreshed.gmailSync.lastSyncedAt,
      storedMessages: refreshed.gmailSync.storedMessages,
      ...run
    })
    setGovernanceOpen(false)
    setSelectedTask(null)
    setActiveView('cases')
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
    setBootstrap((current) => current ? { ...current, recovery } : current)
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
    setBootstrap((current) => current ? { ...current, jobCaseFieldAliases: saved } : current)
    return saved
  }

  const createManualJobCaseDraft = async (input: Parameters<typeof window.sesAgent.createManualJobCaseDraft>[0]) => {
    const result = await window.sesAgent.createManualJobCaseDraft(input)
    setBootstrap((current) => {
      if (!current) return current
      const reviews = new Map(current.jobCaseReviews.map((review) => [review.reviewId, review]))
      reviews.set(result.review.reviewId, result.review)
      return { ...current, jobCaseReviews: [result.review, ...[...reviews.values()].filter((review) => review.reviewId !== result.review.reviewId)] }
    })
    setBootstrap(await window.sesAgent.getBootstrap())
    return result
  }

  const createChatPasteJobCaseDraft = async (input: Parameters<typeof window.sesAgent.createChatPasteJobCaseDraft>[0]) => {
    const result = await window.sesAgent.createChatPasteJobCaseDraft(input)
    setBootstrap((current) => {
      if (!current) return current
      const remaining = current.jobCaseReviews.filter((review) => review.reviewId !== result.review.reviewId)
      return { ...current, jobCaseReviews: [result.review, ...remaining] }
    })
    setBootstrap(await window.sesAgent.getBootstrap())
    return result
  }

  const readWechatVisibleMessages = async () => {
    const prepared = await window.sesAgent.prepareWechatVisibleRead()
    if (prepared.status === 'cancelled') return null
    if (prepared.status !== 'ready' || !prepared.scopeToken) {
      throw new Error(`微信读取预检未通过：${prepared.failureCodes.join(', ') || 'UNKNOWN'}`)
    }
    const result = await window.sesAgent.executeWechatVisibleRead({ scopeToken: prepared.scopeToken })
    setBootstrap((current) => {
      if (!current) return current
      const remaining = current.jobCaseReviews.filter((review) => review.reviewId !== result.review.reviewId)
      return { ...current, jobCaseReviews: [result.review, ...remaining] }
    })
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
    const importedReviews = result.items.flatMap((item) => item.review ? [item.review] : [])
    if (importedReviews.length > 0) {
      setBootstrap((current) => {
        if (!current) return current
        const reviews = new Map(current.jobCaseReviews.map((review) => [review.reviewId, review]))
        for (const review of importedReviews) reviews.set(review.reviewId, review)
        return { ...current, jobCaseReviews: [...importedReviews, ...[...reviews.values()].filter((review) => !importedReviews.some((item) => item.reviewId === review.reviewId))] }
      })
    }
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
      setBootstrap((current) => current ? { ...current, candidateEvaluation: result.state } : current)
    }
    return result
  }

  const evaluateCandidateEvaluationDraft = async (
    input: Parameters<typeof window.sesAgent.evaluateCandidateEvaluationDraft>[0]
  ) => {
    const result = await window.sesAgent.evaluateCandidateEvaluationDraft(input)
    setBootstrap((current) => current ? { ...current, candidateEvaluation: result.state } : current)
    return result
  }

  const setWorkTaskLifecycle = async (input: Parameters<typeof window.sesAgent.setWorkTaskLifecycle>[0]) => {
    const task = await window.sesAgent.setWorkTaskLifecycle(input)
    setBootstrap((current) => current ? {
      ...current,
      tasks: current.tasks.map((item) => item.id === task.id ? task : item)
    } : current)
    setSelectedTask((current) => current?.id === task.id ? task : current)
    if (input.action === 'cancel') {
      candidateMatchRequest.current += 1
      proposalRequest.current += 1
      setCandidateMatch((current) => current.taskId === task.id
        ? { taskId: task.id, status: 'idle', query: '', run: null, results: [], error: null }
        : current)
      setProposal((current) => current.taskId === task.id
        ? { taskId: task.id, status: 'idle', workspace: null, error: null }
        : current)
    } else {
      selectTask(task)
    }
    return task
  }

  const saveLocalOperatorProfile = async (input: Parameters<typeof window.sesAgent.saveLocalOperatorProfile>[0]) => {
    const operatorProfile = await window.sesAgent.saveLocalOperatorProfile(input)
    setBootstrap((current) => current ? { ...current, operatorProfile } : current)
    return operatorProfile
  }

  const saveLocalApplicationPreferences = async (input: Parameters<typeof window.sesAgent.saveLocalApplicationPreferences>[0]) => {
    const preferences = await window.sesAgent.saveLocalApplicationPreferences(input)
    setBootstrap((current) => current ? { ...current, preferences } : current)
    return preferences
  }

  const updateAiCommerce = (aiCommerce: BootstrapPayload['aiCommerce']) => {
    setBootstrap((current) => current ? { ...current, aiCommerce } : current)
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
    setBootstrap((current) => current ? { ...current, aiCommerce: { ...current.aiCommerce, wallet: result.wallet } } : current)
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

  const handleCreated = (task: WorkTask) => {
    setBootstrap((current) => current ? { ...current, tasks: [task, ...current.tasks] } : current)
    selectTask(task)
  }

  const openHome = () => {
    setGovernanceOpen(false)
    setSelectedTask(null)
    setActiveView('home')
  }

  const openTaskCenter = () => {
    setImportHistoryOpen(false)
    setGovernanceOpen(false)
    setSelectedTask(null)
    setActiveView('tasks')
  }

  const openReviewCenter = () => {
    setGovernanceOpen(false)
    setSelectedTask(null)
    setActiveView('reviews')
  }

  const openCandidateManagement = () => {
    setGovernanceOpen(false)
    setSelectedTask(null)
    setCandidateWorkspaceDetail(null)
    setActiveView('candidate-management')
  }

  const openCandidateFromAgent = (
    sourceDocumentId: string,
    view: PipelineView = 'overview',
    interviewId: string | null = null,
    interviewKind: 'recruiting' | 'client' = 'recruiting'
  ) => {
    setGovernanceOpen(false)
    setSelectedTask(null)
    setCandidateWorkspaceDetail({
      scope: 'candidate',
      documentId: sourceDocumentId,
      view,
      interviewId,
      interviewKind
    })
    setActiveView('candidate-management')
  }

  const startHrProgress = async (targets: FollowUpTarget[]) => {
    const records = await window.sesAgent.beginBusinessProgress(targets)
    businessProgress.publish(records)
    const first = targets[0]
    if (!first) return
    setHrFollowTarget({ ...first }); setHrFollowOpen(true); setIntroductionTarget(null)
    closeAgentPanel(); returnToHr(); setAgentHomeRequest((value) => value + 1)
    setBootstrap((current) => current ? { ...current, candidateInterviews: [...current.candidateInterviews.filter((row) => !records.some((record) => record.id === row.businessFollowUpId)), ...records.flatMap((record) => record.progress?.rounds ?? [])] } : current)
  }

  const openInterviewSchedule = () => {
    setGovernanceOpen(false)
    setSelectedTask(null)
    setCandidateWorkspaceDetail(null)
    setActiveView('interview-schedule')
  }

  const openInterviewWorkbench = () => {
    setGovernanceOpen(false)
    setSelectedTask(null)
    setCandidateWorkspaceDetail(null)
    setActiveView('interview-workbench')
  }

  const openClientInterviews = () => {
    setGovernanceOpen(false)
    setSelectedTask(null)
    setCandidateWorkspaceDetail(null)
    setActiveView('client-interviews')
  }

  const openEntryPrep = () => {
    setGovernanceOpen(false)
    setSelectedTask(null)
    setCandidateWorkspaceDetail(null)
    setActiveView('entry-prep')
  }

  const openCaseImport = () => {
    setGovernanceOpen(false)
    setSelectedTask(null)
    setActiveView('case-import')
  }

  const openCases = () => {
    setGovernanceOpen(false)
    setSelectedTask(null)
    setRequestedJobCaseReviewId(null)
    setActiveView('cases')
  }

  const openMatching = () => {
    setGovernanceOpen(false)
    setSelectedTask(null)
    setMatchingJobCaseId(bootstrap.matchingHome.selectedJobCaseId)
    setActiveView(bootstrap.featureFlags?.conversationalMatchingEnabled === true ? 'agent' : 'matching')
  }

  const openMatchingForCase = (jobCaseId: string) => {
    setGovernanceOpen(false)
    setSelectedTask(null)
    setMatchingJobCaseId(jobCaseId)
    setActiveView('matching')
  }

  const openAgentSystemAccess = (access: AgentSystemAccessBlock) => {
    setSideProgressTarget(null); setProgressFocus(null)
    if (access.destination === 'broadcast' && access.reviewId) {
      const requestedReviewId = access.reviewId
      const review = bootstrap.jobCaseReviews.find((item) => item.reviewId === requestedReviewId)
      if (review && review.lifecycle === 'active') {
        setCaseIntroductionTarget({ reviewId: review.reviewId, reviewRevision: review.reviewRevision,
          jobCaseVersion: review.status === 'completed' ? review.jobCase?.version ?? null : null })
        return
      }
    }

    if (access.destination === 'matching' && access.jobCaseId) {
      if (hrBusy) return
      const requestedCaseId = access.jobCaseId
      const review = bootstrap.jobCaseReviews.find((item) => item.jobCase?.id === requestedCaseId)
      if (!review) return
      setHrFollowOpen(false)
      setHrKind('case'); setAgentFeedSelection(`case:${review.reviewId}`); saveHrPosition('case', { selected: `case:${review.reviewId}` })
      try { localStorage.setItem('ses-hr-kind-v2', 'case') } catch {}
      setHrSource({ kind: 'case', id: access.jobCaseId, requestId: ++feedFocusSequence.current })
      setAgentHomeRequest((value) => value + 1)
      access = { type: 'system-access', destination: 'case-review', reviewId: review.reviewId }
    }
    setAgentHomeRequest((value) => value + 1)
    const personnel = access.destination === 'candidate' && access.view === 'overview'
    setAgentSideMode(personnel ? 'personnel' : null)
    if (access.destination === 'candidate' && access.view === 'overview') { setAgentPersonId(access.sourceDocumentId); setAgentPersonMatchRequest(undefined) }
    setGovernanceOpen(false)
    setSelectedTask(null)
    setAgentContextTrail((trail) => pushContextAccess(trail, access))
    const caseReview = access.destination === 'case-review' || access.destination === 'broadcast'
      ? bootstrap.jobCaseReviews.find((item) => item.reviewId === access.reviewId)
      : access.destination === 'matching' && access.jobCaseId ? bootstrap.jobCaseReviews.find((item) => item.jobCase?.id === access.jobCaseId) : undefined
    if (caseReview || access.destination === 'candidate' || access.destination === 'original-document') {
      setAgentFocusRequest({ id: Date.now(), ...(access.destination === 'candidate' || access.destination === 'original-document' ? { candidateDocumentId: access.sourceDocumentId } : {}), caseReference: caseReview?.jobCase && caseReview.lifecycle === 'active' ? {
        kind: 'job-case', objectId: caseReview.jobCase.id, objectVersion: caseReview.jobCase.version, resultHash: null, ordinal: null,
        label: caseReview.fields.find((field) => field.key === 'title')?.value ?? caseReview.redactedSubject, target: `job-case:${caseReview.jobCase.id}`
      } : null })
    }
  }
  const closeAgentPanel = () => { setSideProgressTarget(null); setAgentSideMode(null); setAgentContextTrail([]) }
  const openAgentBatch = (text?: string) => {
    setAgentHomeRequest((value) => value + 1)
    if (text) setAgentBatchSeed({ id: Date.now(), text })
    setAgentSideMode('intake'); setAgentContextTrail([]); setActiveView('agent')
  }
  const openAgentPersonnel = (documentId: string, match = false) => {
    openAgentSystemAccess({ type: 'system-access', destination: 'candidate', sourceDocumentId: documentId, view: 'overview' })
    setAgentPersonId(documentId); setAgentSideMode('personnel')
    setAgentPersonMatchRequest(undefined)
    if (match && !hrBusy) { setHrFollowOpen(false); setHrKind('person'); setAgentFeedSelection(`person:${documentId}`); saveHrPosition('person', { selected: `person:${documentId}` }); try { localStorage.setItem('ses-hr-kind-v2', 'person') } catch {}; setHrSource({ kind: 'person', id: documentId, requestId: ++feedFocusSequence.current }); setAgentHomeRequest((value) => value + 1) }
  }
  const openPersonnelEditor = (target: PersonnelEditorTarget) => {
    setPersonnelEditorRequest({ ...target, id: Date.now() })
    setGovernanceOpen(false); setSelectedTask(null); setActiveView('business')
  }
  const openPersonnelProfile = (documentId: string) => {
    if (!bootstrap?.candidateReviews.find((review) => review.documentId === documentId)?.profile) {
      openCandidateFromAgent(documentId, 'resume')
      return
    }
    setPersonnelProfileRequest({ id: Date.now(), documentId })
    setGovernanceOpen(false); setSelectedTask(null); setActiveView('candidates')
  }
  const openLatestEntry = (entry: BusinessFeedEntry, action: 'view' | 'match' | 'promote') => {
    if (action === 'match' && hrBusy) return
    setAgentFeedSelection(`${entry.kind}:${entry.objectId}`)
    saveHrPosition(entry.kind, { selected: `${entry.kind}:${entry.objectId}` })
    if (entry.kind === 'person') {
      openAgentPersonnel(entry.objectId, action === 'match')
      if (action === 'promote') { const person = bootstrap.candidateReviews.find((item) => item.documentId === entry.objectId); if (person?.profile) setIntroductionTarget({ documentId: person.documentId, profileVersion: person.profile.version, matched: [] }) }
      setAgentPersonFocusRequest({ id: ++feedFocusSequence.current, documentId: entry.objectId, section: action })
      return
    }
    if (action !== 'promote') setCaseFocusRequest(++feedFocusSequence.current)
    const review = bootstrap?.jobCaseReviews.find((item) => item.reviewId === entry.objectId)
    if (!review) return
    openAgentSystemAccess(action === 'match' && review.jobCase && review.lifecycle === 'active'
      ? { type: 'system-access', destination: 'matching', jobCaseId: review.jobCase.id }
      : action === 'promote' && review.lifecycle === 'active'
        ? { type: 'system-access', destination: 'broadcast', reviewId: entry.objectId }
        : { type: 'system-access', destination: 'case-review', reviewId: entry.objectId })
  }
  const agentContextBack = agentContextTrail.length > 1
    ? () => {
      const previous = agentContextTrail.at(-2)!
      setAgentContextTrail((trail) => trail.slice(0, -1))
      const personnel = previous.destination === 'candidate' && previous.view === 'overview'
      setAgentSideMode(personnel ? 'personnel' : null)
      if (personnel) setAgentPersonId(previous.sourceDocumentId)
      if (previous.destination === 'matching' && previous.jobCaseId) setCaseMatchId(previous.jobCaseId)
    }
    : undefined

  const openAgentCandidateAccess = (
    sourceDocumentId: string,
    view: PipelineView = 'overview',
    interviewId?: string | null,
    interviewKind?: 'recruiting' | 'client'
  ) => openAgentSystemAccess({
    type: 'system-access',
    destination: 'candidate',
    sourceDocumentId,
    view,
    ...(interviewId !== undefined ? { interviewId } : {}),
    ...(interviewKind ? { interviewKind } : {})
  })

  const openApplicationSettings = (section: ApplicationSettingsSection = 'general') => {
    setApplicationSettingsSection(section)
    setApplicationSettingsOpen(true)
  }

  const openJobCaseReview = (reviewId: string) => {
    setGovernanceOpen(false)
    setSelectedTask(null)
    setRequestedJobCaseReviewId(reviewId)
    setActiveView('cases')
  }

  const startNewTask = () => {
    openMatching()
    setComposerFocusRequestId(1)
  }

  const executeResumeImportTask = async (
    task: WorkTask,
    request: number,
    conversationId?: string
  ): Promise<AiConversationSnapshot | null> => {
    let latestConversation: AiConversationSnapshot | null = null
    const completedTokens = new Set(bootstrap.resumeAnalyses
      .filter((analysis) => analysis.analysisVersion === 'resume-analysis-v6')
      .map((analysis) => analysis.fileToken))
    const bindings = task.contextBindings.filter(
      (binding) => binding.objectType === 'staged-file' && !completedTokens.has(binding.objectId)
    )
    for (const binding of bindings) {
      if (resumeImportRequest.current !== request) return latestConversation
      setResumeImportProgress((current) => current?.taskId === task.id ? {
        ...current,
        files: current.files.map((file) => file.token === binding.objectId ? { ...file, status: 'parsing', error: null } : file)
      } : current)
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
          return { ...current, tasks: [...tasks.values()], processingJobs: [...processingJobs.values()], resumeAnalyses: [...analyses.values()] }
        })
        setResumeImportProgress((current) => current?.taskId === task.id ? {
          ...current,
          files: current.files.map((file) => file.token === binding.objectId ? { ...file, status: 'success', error: null } : file)
        } : current)
      } catch (cause) {
        if (resumeImportRequest.current !== request) return latestConversation
        setResumeImportProgress((current) => current?.taskId === task.id ? {
          ...current,
          files: current.files.map((file) => file.token === binding.objectId ? {
            ...file, status: 'error', error: cause instanceof Error ? cause.message : 'ローカル解析に失敗しました。'
          } : file)
        } : current)
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
          name: analysis?.fileName ?? reviews.get(binding.objectId)?.fileName ?? `${locale === 'zh-CN' ? '候选文件' : '選択ファイル'} ${index + 1}`,
          status: analysis?.analysisVersion === 'resume-analysis-v6' ? 'success' as const : 'queued' as const,
          error: null
        }
      })
  }

  const runResumeImportTask = async (
    task: WorkTask,
    request: number,
    conversationId?: string
  ): Promise<AiConversationSnapshot | null> => {
    try {
      const conversation = await executeResumeImportTask(task, request, conversationId)
      if (resumeImportRequest.current !== request) return conversation
      const refreshed = await window.sesAgent.getBootstrap()
      setBootstrap(refreshed)
      setSelectedTask((current) => refreshed.tasks.find((item) => item.id === current?.id) ?? current)
      setResumeImportProgress((current) => current?.taskId === task.id ? {
        ...current,
        phase: current.files.some((file) => file.status === 'error') ? 'partial-failed' : 'completed'
      } : current)
      return conversation
    } catch (cause) {
      if (resumeImportRequest.current === request) {
        setResumeImportProgress((current) => current ? {
          ...current,
          phase: 'error',
          error: cause instanceof Error ? cause.message : '履歴書を取り込めませんでした。'
        } : current)
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
      setBootstrap((current) => current ? { ...current, tasks: [created.task, ...current.tasks] } : current)
      setResumeImportProgress({ phase: 'parsing', taskId: created.task.id, files: progressFiles(created.files), error: null })
      return await runResumeImportTask(created.task, request, conversationId)
    } catch (cause) {
      if (resumeImportRequest.current === request) {
        setResumeImportProgress((current) => current ? {
          ...current,
          phase: 'error',
          error: cause instanceof Error ? cause.message : '履歴書を取り込めませんでした。'
        } : current)
      }
      if (resumeImportRequest.current === request) resumeImportRequest.current = 0
      return null
    }
  }

  const startManualCase = () => {
    setGovernanceOpen(false)
    setSelectedTask(null)
    setActiveView('case-import')
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

  const gmailCommandLabel = bootstrap.gmail.configuration === 'required' || bootstrap.gmailSync.configuration === 'required'
    ? 'Google Workspaceを設定'
    : bootstrap.gmail.status !== 'readonly'
      ? 'Gmail読取専用接続を確認'
      : bootstrap.gmailSync.status === 'error'
        ? 'Gmail同期を再試行'
        : 'Gmailを同期して案件を確認'
  const businessCommands: BusinessCommand[] = [
    {
      id: 'input-resume', group: '入力', label: 'スキルシートを取り込む', icon: 'upload',
      description: 'ファイル選択後も実行前プレビューとローカル解析を維持します。',
      keywords: ['履歴書', '職務経歴書', 'resume', 'candidate', '候補者', 'ファイル'],
      run: async () => { await startResumeImport() }
    },
    {
      id: 'input-case', group: '入力', label: '案件を手動で追加', icon: 'briefcase',
      description: '貼り付けた件名・本文を端末内で脱敏してレビュー草稿にします。',
      keywords: ['案件', 'メール', '手動', 'paste', 'job'],
      run: startManualCase
    },
    {
      id: 'input-gmail', group: '入力', label: gmailCommandLabel, icon: 'mail',
      description: bootstrap.gmail.status === 'readonly'
        ? '管理者が固定したLabel・期間・上限だけを読取専用同期します。'
        : 'Desktop OAuth設定とgmail.readonlyの接続状態を確認します。',
      keywords: ['gmail', 'google workspace', '同期', 'メール', '案件'],
      run: runGoogleWorkspaceCommand
    },
    {
      id: 'work-new', group: '作業', label: '新しい作業を作成', icon: 'plus',
      description: '自然言語で目的を入力し、データ範囲を実行前に確認します。',
      keywords: ['task', '新規', '指示', 'agent'],
      run: startNewTask
    },
    {
      id: 'work-list', group: '作業', label: 'アクティビティを開く', icon: 'tasks',
      description: locale === 'zh-CN'
        ? `查看 ${bootstrap.tasks.length} 项处理历史及其状态、进度和证据。`
        : `処理履歴 ${bootstrap.tasks.length}件を状態・進捗・証跡とともに確認します。`,
      keywords: ['task', '履歴', '進捗', '再開', '失敗'],
      run: openTaskCenter
    },
    {
      id: 'data-cases', group: 'データ', label: '案件レビューを開く', icon: 'briefcase',
      description: `確認待ち ${bootstrap.jobCaseReviews.filter((review) => review.status === 'awaiting-review').length}件。Gmail・EML・手動入力を同じ流れで確認します。`,
      keywords: ['案件', 'case', 'review', 'eml'],
      run: () => {
        setGovernanceOpen(false)
        setSelectedTask(null)
        setActiveView('cases')
      }
    },
    {
      id: 'data-candidates', group: 'データ', label: '候補者プールを開く', icon: 'users',
      description: '暗号化したローカル人材プロフィールを検索・比較・管理します。',
      keywords: ['候補者', 'candidate', '人材', '検索', 'profile'],
      run: () => {
        setGovernanceOpen(false)
        setSelectedTask(null)
        setActiveView('candidates')
      }
    },
    {
      id: 'control-governance', group: '統制', label: 'データと承認を開く', icon: 'shield',
      description: '脱敏、Local AI、品質門とバックアップを確認します。',
      keywords: ['privacy', 'pii', '脱敏', 'バックアップ', '設定', 'security'],
      run: () => {
        setSelectedTask(null)
        setActiveView('home')
        setGovernanceOpen(true)
      }
    },
    ...bootstrap.tasks.slice(0, 5).map((task): BusinessCommand => ({
      id: `recent-${task.id}`,
      group: '最近の作業',
      label: task.title,
      description: `${task.typeLabel} · ${task.progress}% · 証跡 ${task.evidenceCount}件`,
      keywords: [task.typeLabel, task.status, task.instruction],
      icon: task.type === 'IMPORT_RESUME' ? 'upload' : task.type === 'CREATE_CASE' ? 'briefcase' : task.type === 'MATCH_CANDIDATES' ? 'users' : 'file',
      run: () => selectTask(task)
    }))
  ]

  const saveCandidateInterviewSchedule = async (
    input: Parameters<typeof window.sesAgent.saveCandidateInterviewSchedule>[0]
  ) => {
    const interview = await window.sesAgent.saveCandidateInterviewSchedule(input)
    setBootstrap((current) => current ? {
      ...current,
      candidateInterviews: [interview, ...current.candidateInterviews.filter((item) => item.id !== interview.id)]
    } : current)
    return interview
  }

  const renderCandidatePipelineDetail = (
    detail: NonNullable<typeof candidateWorkspaceDetail>,
    showBackToQueue = true
  ) => <CandidatePipeline
    aiCommerce={bootstrap.aiCommerce}
    analyses={bootstrap.resumeAnalyses}
    initialCandidateId={detail.documentId}
    initialInterviewId={detail.interviewId ?? null}
    interviewKind={detail.interviewKind ?? (detail.scope === 'client' ? 'client' : 'recruiting')}
    interviews={bootstrap.candidateInterviews.filter((row) => !row.businessFollowUpId)}
    matchingHome={bootstrap.matchingHome}
    tasks={bootstrap.tasks}
    onBackToQueue={showBackToQueue ? () => setCandidateWorkspaceDetail(null) : undefined}
    onConfirmCandidateProfile={submitCandidateReview}
    onCreateRound={async (input) => {
      const interview = await window.sesAgent.createCandidateInterviewRound(input)
      setBootstrap((current) => current ? {
        ...current,
        candidateInterviews: [interview, ...current.candidateInterviews.filter((item) => item.id !== interview.id)]
      } : current)
      return interview
    }}
    onImportResume={() => void startResumeImport()}
    onOpenCandidateLibrary={() => setActiveView('candidates')}
    onOpenCloudSettings={() => setAiCommerceOpen(true)}
    onLoadOriginalDocument={(sourceDocumentId) => window.sesAgent.getOriginalDocumentPreview(sourceDocumentId)}
    onOpenOriginalDocument={(sourceDocumentId) => window.sesAgent.openOriginalDocument(sourceDocumentId)}
    onOpenIntegrationSettings={() => openApplicationSettings('integrations')}
    onOpenZoomMeeting={(input) => window.sesAgent.openZoomMeeting(input)}
    onOpenInterviewMeeting={(input) => window.sesAgent.openInterviewMeeting(input)}
    onRecordDecision={async (input) => {
      const interview = await window.sesAgent.recordCandidateInterviewDecision(input)
      setBootstrap((current) => current ? {
        ...current,
        candidateInterviews: [interview, ...current.candidateInterviews.filter((item) => item.id !== interview.id)]
      } : current)
      return interview
    }}
    onSaveNotes={async (input) => {
      const interview = await window.sesAgent.saveCandidateInterviewNotes(input)
      setBootstrap((current) => current ? {
        ...current,
        candidateInterviews: [interview, ...current.candidateInterviews.filter((item) => item.id !== interview.id)]
      } : current)
      return interview
    }}
    onSavePreparation={async (input) => {
      const interview = await window.sesAgent.saveCandidateInterviewPreparation(input)
      setBootstrap((current) => current ? {
        ...current,
        candidateInterviews: [interview, ...current.candidateInterviews.filter((item) => item.id !== interview.id)]
      } : current)
      return interview
    }}
    onSaveSchedule={saveCandidateInterviewSchedule}
    onSendCloudPrompt={runReviewedAiCommerceCloudPrompt}
    onSetTaskLifecycle={setWorkTaskLifecycle}
    onViewChange={(nextView) => setCandidateWorkspaceDetail((current) => current
      ? { ...current, view: nextView }
      : { ...detail, view: nextView })}
    reviews={bootstrap.candidateReviews}
    view={detail.view}
  />

  const openInterviewFromSchedule = (route: InterviewScheduleRoute) => {
    if (route.businessFollowUpId) {
      void window.sesAgent.listBusinessFollowUps().then((rows) => {
        const item = rows.find((row) => row.id === route.businessFollowUpId)
        if (item) { setHrFollowTarget({documentId:item.documentId,reviewId:item.reviewId}); setHrFollowOpen(true); returnToHr(); closeAgentPanel() }
      }).catch((cause) => setLoadError(String(cause)))
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
  const hrNavigation = bootstrap.featureFlags?.conversationalMatchingEnabled === true
  const agentPrimary = activeView === 'agent' && hrNavigation
  const pendingActionApprovals = reviewQueue.filter((item) => item.kind === 'action-approval')
  const resumeImports = bootstrap.tasks.filter((task) => task.type === 'IMPORT_RESUME').sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
  const failedImports = resumeImports.filter((task) => task.status === 'failed')
  const navigationFollows = agentPrimary ? hrFollowOpen : ['interview-schedule', 'interview-workbench', 'client-interviews', 'entry-prep'].includes(activeView) || hrFollowOpen
  const navigationKind = ['cases', 'case-import', 'matching'].includes(activeView) ? 'case'
    : ['candidates', 'candidate-management', 'business'].includes(activeView) ? 'person' : hrKind
  const openHrList = (kind: HrBusinessKind) => {
    setActiveView('agent'); setSelectedTask(null); setGovernanceOpen(false); setHrFollowOpen(false); setHrKind(kind)
    setAgentFeedSelection(readHrPosition(kind).selected); setHrSource(null); closeAgentPanel(); setAgentHomeRequest((value) => value + 1)
    try { localStorage.setItem('ses-hr-kind-v2', kind) } catch {}
  }
  const returnToHr = () => { setActiveView('agent'); setSelectedTask(null); setGovernanceOpen(false) }
  const openHrLibrary = () => {
    const selected = readHrPosition(hrKind).selected?.split(':').slice(1).join(':')
    if (hrKind === 'person') {
      if (selected) openPersonnelProfile(selected)
      else openCandidateManagement()
    } else { setRequestedJobCaseReviewId(selected ?? null); setActiveView('cases') }
  }
  const composerCase = agentContextAccess?.destination === 'case-review' || agentContextAccess?.destination === 'broadcast'
    ? bootstrap.jobCaseReviews.find((review) => review.reviewId === agentContextAccess.reviewId)
    : agentContextAccess?.destination === 'matching' && agentContextAccess.jobCaseId ? bootstrap.jobCaseReviews.find((review) => review.jobCase?.id === agentContextAccess.jobCaseId) : undefined
  const composerPerson = agentContextAccess?.destination === 'candidate' || agentContextAccess?.destination === 'original-document'
    ? bootstrap.candidateReviews.find((review) => review.documentId === agentContextAccess.sourceDocumentId) : undefined
  const composerObject = composerPerson ? {
    kind: 'person' as const, label: composerPerson.localIdentity?.displayName ?? composerPerson.fileName,
    onMatch: composerPerson.recordStatus === 'active' ? () => openAgentPersonnel(composerPerson.documentId, true) : undefined,
    onPromote: composerPerson.recordStatus === 'active' ? () => openAgentPersonnel(composerPerson.documentId) : undefined
  } : composerCase ? {
    kind: 'case' as const, label: composerCase.fields.find((field) => field.key === 'title')?.value ?? composerCase.redactedSubject,
    onMatch: composerCase.lifecycle === 'active' ? () => openAgentSystemAccess(composerCase.jobCase
      ? { type: 'system-access', destination: 'matching', jobCaseId: composerCase.jobCase.id }
      : { type: 'system-access', destination: 'case-review', reviewId: composerCase.reviewId }) : undefined,
    onPromote: composerCase.lifecycle === 'active' ? () => openAgentSystemAccess({ type: 'system-access', destination: composerCase.jobCase ? 'broadcast' : 'case-review', reviewId: composerCase.reviewId }) : undefined
  } : undefined


  const renderBusinessProgress = (kind: HrBusinessKind, id: string) => <BusinessProgressOverview key={`${kind}:${id}`} kind={kind} objectId={id} people={bootstrap.candidateReviews} cases={bootstrap.jobCaseReviews} onAdvance={setSideProgressTarget} focusRequest={progressFocus?.kind === kind && progressFocus.id === id ? progressFocus.request : undefined} />

  return (
    <UiLocaleProvider locale={locale}>
    <BusinessProgressContext.Provider value={businessProgress}>
      <div className={hrNavigation ? 'app-shell is-agent-primary is-hr-navigation' : 'app-shell'}>
      {toasts.length > 0 ? <div className="app-toasts" role="status">
        {toasts.map((toast) => <button className="app-toast" key={toast.id} onClick={() => {
          setToasts((current) => current.filter((item) => item.id !== toast.id))
          setActiveView('agent')
          setAgentContextTrail(defaultAgentContextTrail())
        }} type="button"><Icon name="mail" size={13} />{toast.message}</button>)}
      </div> : null}
      {hrNavigation ? <AgentSystemRail
        businessKind={navigationKind}
        followActive={navigationFollows}
        onFollowUps={() => { returnToHr(); setHrFollowOpen(true); closeAgentPanel(); setAgentHomeRequest((value) => value + 1) }}
        onBusinessCases={() => openHrList('case')}
        onBusinessPeople={() => openHrList('person')}
        caseUnseenCount={newCaseDigest?.unseenCount ?? 0}
        onAgent={() => { returnToHr(); setHrChatRequest((value) => value + 1) }}
        onBusiness={() => openAgentBatch()}
        onCandidates={openCandidateManagement}
        onCases={openCases}
        onInterviews={openInterviewSchedule}
        onReviews={openReviewCenter}
        onSettings={() => openApplicationSettings('general')}
      /> : <Sidebar
        active={activeView}
        agentEnabled={bootstrap.featureFlags?.conversationalMatchingEnabled === true}
        caseCount={activeCaseCount}
        candidateManagementCount={bootstrap.candidateReviews.length}
        candidateCount={eligibleCandidateCount}
        clientInterviewCount={new Set(bootstrap.candidateInterviews.filter((interview) => interview.kind === 'client' && interview.stage !== 'passed' && interview.stage !== 'closed').map((interview) => interview.sourceDocumentId)).size}
        interviewDecisionCount={new Set([
          ...bootstrap.candidateReviews.filter((review) => review.status === 'awaiting-review').map((review) => review.documentId),
          ...bootstrap.candidateInterviews.filter((interview) => interview.kind === 'recruiting' && interview.stage !== 'passed' && interview.stage !== 'closed').map((interview) => interview.sourceDocumentId)
        ]).size}
        interviewScheduleCount={new Set([
          ...bootstrap.candidateReviews.filter((review) => !review.profile).map((review) => review.documentId),
          ...bootstrap.candidateInterviews.filter((interview) => interview.stage !== 'passed' && interview.stage !== 'closed').map((interview) => interview.sourceDocumentId)
        ]).size}
        operatorProfile={bootstrap.operatorProfile}
        reviewCount={reviewQueue.length}
        onCandidates={() => {
          setGovernanceOpen(false)
          setSelectedTask(null)
          setActiveView('candidates')
        }}
        onCandidateManagement={openCandidateManagement}
        onClientInterviews={openClientInterviews}
        onEntryPrep={openEntryPrep}
        onInterviewSchedule={openInterviewSchedule}
        onInterviewWorkbench={openInterviewWorkbench}
        onCases={openCases}
        onCaseImport={openCaseImport}
        onGovernance={() => {
          setSelectedTask(null)
          setGovernanceOpen(true)
        }}
        onBusiness={() => setActiveView('business')}
        onHome={openHome}
        onMatching={openMatching}
        onOperatorProfile={() => setOperatorProfileOpen(true)}
        onResumeImport={() => void startResumeImport()}
        onSettings={() => openApplicationSettings('general')}
        onReviews={openReviewCenter}
        onTasks={openTaskCenter}
        taskCount={bootstrap.tasks.length}
      />}

      <CaseIntroductionComposer target={caseIntroductionTarget} cases={bootstrap.jobCaseReviews} onPrepared={caseIntroductionPrepared} onClose={() => setCaseIntroductionTarget(null)} />
      <IntroductionComposer onFollowUp={(target) => startHrProgress([target])} target={introductionTarget} people={bootstrap.candidateReviews} cases={bootstrap.jobCaseReviews} onClose={() => setIntroductionTarget(null)} />
      <ResumeImportProgressDrawer
        onClose={() => setResumeImportProgress(null)}
        onOpenCandidates={() => {
          setResumeImportProgress(null)
          if (hrNavigation) openHrList('person')
          else openCandidateManagement()
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
        progress={resumeImportProgress}
      />

      <div className={hrNavigation ? 'hr-route-container' : 'legacy-route-container'}>
      {hrNavigation && !agentPrimary ? <nav className="hr-return-bar" aria-label={locale === 'zh-CN' ? '返回业务列表' : '業務一覧へ戻る'}><button type="button" onClick={returnToHr}><Icon name="arrow-left" size={16} />{hrFollowOpen ? (locale === 'zh-CN' ? '返回跟进' : '対応記録に戻る') : hrKind === 'case' ? (locale === 'zh-CN' ? '返回案件列表' : '案件一覧に戻る') : (locale === 'zh-CN' ? '返回人员列表' : '要員一覧に戻る')}</button></nav> : null}
      <div className="business-route" hidden={activeView !== 'business'}>
        <BusinessWorkbench bootstrap={bootstrap} broadcastActions={broadcastActions} personnelRequest={personnelEditorRequest} personnelMessageDrafts={personnelMessageDrafts}
          onRefresh={async () => setBootstrap(await window.sesAgent.getBootstrap())}
          onCaseImport={openCaseImport}
          onCase={(reviewId) => { setRequestedJobCaseReviewId(reviewId); setActiveView('cases') }}
          onProfile={openPersonnelProfile}
          onMatchCase={openMatchingForCase} />
      </div>
      <div className="agent-route" hidden={!agentPrimary}>
        {bootstrap.featureFlags?.conversationalMatchingEnabled === true ? (
        <AgentWorkspace
          businessMatchingBusy={hrBusy}
          businessTitle={hrFollowOpen ? (locale === 'zh-CN' ? '跟进' : '対応記録') : hrSource ? (locale === 'zh-CN' ? '匹配结果' : 'マッチング結果') : hrKind === 'case' ? (locale === 'zh-CN' ? '案件' : '案件') : (locale === 'zh-CN' ? '人员' : '要員')}
          chatRequest={hrChatRequest}
          businessObject={agentFeedSelection ? { kind: agentFeedSelection.startsWith('case:') ? 'case' : 'person', id: agentFeedSelection.slice(agentFeedSelection.indexOf(':') + 1) } : undefined}
          candidateReviews={bootstrap.candidateReviews}
          composerObject={composerObject}
          activeSystemAccess={agentContextAccess}
          cloudConnected={bootstrap.aiCommerce.connection === 'connected'}
          composerDraft={agentComposerDraft}
          latestContent={<div className="hr-board">
            <div className="hr-list-surface" hidden={Boolean(hrSource) || hrFollowOpen}><HrObjectList onOpenProgress={(entry) => { openLatestEntry(entry, 'view'); setProgressFocus({kind: entry.kind, id: entry.objectId, request: ++feedFocusSequence.current}) }} cases={bootstrap.jobCaseReviews} kind={hrKind} reloadToken={bootstrap} candidates={bootstrap.candidateReviews} selectedKey={agentFeedSelection} busy={hrBusy} onOpen={openLatestEntry} onIntake={() => openAgentBatch()} onImportResume={() => void startResumeImport()} onOpenLibrary={openHrLibrary} onImportHistory={hrKind === 'case' ? openCaseImport : () => { openTaskCenter(); setImportHistoryOpen(true) }} onRefresh={async () => setBootstrap(await window.sesAgent.getBootstrap())} /></div>
            <div className="hr-match-surface" hidden={!hrSource || hrFollowOpen}><HrMatchingWorkspace source={hrSource} cases={bootstrap.jobCaseReviews} people={bootstrap.candidateReviews} onBusy={setHrBusy}
              onView={(kind, id) => kind === 'person' ? openAgentPersonnel(id) : openAgentSystemAccess({ type: 'system-access', destination: 'case-review', reviewId: id })}
              onContinue={(target) => { if (hrSource?.kind === 'person') openAgentPersonnel(target.documentId); else openAgentSystemAccess({type: 'system-access', destination: 'case-review', reviewId: target.reviewId}); setSideProgressTarget(target) }} onFollowUp={(target) => startHrProgress([target])} onScheduleMany={startHrProgress}
              onPrepare={setIntroductionTarget} onBack={() => { setHrSource(null); closeAgentPanel() }} /></div>
            <div className="hr-follow-surface" hidden={!hrFollowOpen}><HrProgressWorkbench active={hrFollowOpen} onSchedule={openInterviewSchedule}
              onBackToMatches={hrSource ? () => { setHrFollowOpen(false); closeAgentPanel(); setAgentHomeRequest((value) => value + 1) } : undefined}
              onBrowse={openHrList}
              interviews={bootstrap.candidateInterviews} onUpdated={() => { void window.sesAgent.getBootstrap().then(setBootstrap).catch((cause) => setLoadError(String(cause))) }} target={hrFollowTarget} reloadToken={bootstrap} people={bootstrap.candidateReviews} cases={bootstrap.jobCaseReviews} onView={(kind, id) => kind === 'person' ? openAgentPersonnel(id) : openAgentSystemAccess({ type: 'system-access', destination: 'case-review', reviewId: id })} /></div>
          </div>}

          homeRequestToken={agentHomeRequest}
          focusRequest={agentFocusRequest}
          onOpenBatch={openAgentBatch}
          contextPanelOpen={agentPrimary && Boolean(sideProgressTarget || agentSideMode || agentContextAccess)}
          contextPanel={<>
            {sideProgressTarget ? <HrProgressWorkbench embedded key={`${sideProgressTarget.documentId}:${sideProgressTarget.reviewId}`} onBack={() => setSideProgressTarget(null)} target={sideProgressTarget} reloadToken={bootstrap} people={bootstrap.candidateReviews} cases={bootstrap.jobCaseReviews} interviews={bootstrap.candidateInterviews} onView={(kind, id) => kind === 'person' ? openAgentPersonnel(id) : openAgentSystemAccess({ type: 'system-access', destination: 'case-review', reviewId: id })} onUpdated={() => { void window.sesAgent.getBootstrap().then(setBootstrap).catch((cause) => setLoadError(String(cause))) }} /> : null}
            <div className="hr-object-context" hidden={Boolean(sideProgressTarget)}>
            <div className="agent-business-tools" hidden={agentSideMode === null}>
              <header className="agent-tool-header">{agentSideMode === 'personnel' && agentContextBack ? <button aria-label={locale === 'zh-CN' ? '返回上一级' : '前の画面に戻る'} onClick={agentContextBack} type="button">←</button> : null}<strong>{agentSideMode === 'intake' ? (locale === 'zh-CN' ? '信息整理' : '情報整理') : (locale === 'zh-CN' ? '人员资料' : '要員情報')}</strong><button aria-label={locale === 'zh-CN' ? '关闭业务面板' : '業務パネルを閉じる'} onClick={closeAgentPanel} type="button">×</button></header>
              <div className="business-workbench agent-tool-content">
                <div hidden={agentSideMode !== 'intake'}>{failedImports.length > 0 ? <details className="hr-intake-issues"><summary>{locale === 'zh-CN' ? '导入失败，需要处理' : '対応が必要な取込エラー'} ({failedImports.length})</summary>{failedImports.map((task) => <button key={task.id} type="button" onClick={() => selectTask(task)}>{localizedTaskTitle(locale, task)}<span>{locale === 'zh-CN' ? '查看失败原因' : '失敗理由を確認'}</span></button>)}</details> : null}<BusinessIntakeWorkspace inputSeed={agentBatchSeed} modelKey={bootstrap.defaultAgentChatModelKey ?? 'gpt-5.6-luna'} cases={bootstrap.jobCaseReviews} candidates={bootstrap.candidateReviews}
                  onRefresh={async () => setBootstrap(await window.sesAgent.getBootstrap())}
                  onCase={(reviewId) => openAgentSystemAccess({ type: 'system-access', destination: 'case-review', reviewId })}
                  onPerson={(documentId) => openAgentPersonnel(documentId)} onCaseImport={() => openAgentSystemAccess({ type: 'system-access', destination: 'case-import' })} /></div>
                <div hidden={agentSideMode !== 'personnel'}><PersonnelWorkspace renderBusinessProgress={renderBusinessProgress} compact businessOnly matchingBusy={hrBusy} onMatch={() => openAgentPersonnel(agentPersonId!, true)} onPrepare={() => { const person = bootstrap.candidateReviews.find((item) => item.documentId === agentPersonId); if (person?.profile) setIntroductionTarget({ documentId: person.documentId, profileVersion: person.profile.version, matched: [] }) }} messageDrafts={personnelMessageDrafts} onSelectPerson={(documentId) => openAgentPersonnel(documentId)} initialDocumentId={agentPersonId} matchRequest={agentPersonMatchRequest} focusRequest={agentPersonFocusRequest} onMatchingChange={setPersonnelMatchingId} reviews={bootstrap.candidateReviews}
                  onRefresh={async () => setBootstrap(await window.sesAgent.getBootstrap())}
                  onOpenCase={(reviewId) => openAgentSystemAccess({ type: 'system-access', destination: 'case-review', reviewId })}
                  onOpenProfile={openPersonnelProfile} onOpenEditor={openPersonnelEditor} /></div>
              </div>
            </div>
            <div className="agent-case-matching-panel agent-business-tools" hidden={agentSideMode !== null || agentContextAccess?.destination !== 'matching'}>
              <header className="agent-tool-header">{agentContextBack ? <button aria-label={locale === 'zh-CN' ? '返回上一级' : '前の画面に戻る'} onClick={agentContextBack} type="button">←</button> : null}<strong>{locale === 'zh-CN' ? '案件找人' : '案件の要員検索'}</strong><button aria-label={locale === 'zh-CN' ? '关闭业务面板' : '業務パネルを閉じる'} onClick={closeAgentPanel} type="button">×</button></header>
              <CaseMatchingWorkspace jobCaseId={caseMatchId} request={caseMatchRequest} reviews={bootstrap.jobCaseReviews} candidates={bootstrap.candidateReviews} onMatchingChange={setCaseMatchingId} onOpenPerson={(documentId) => openAgentPersonnel(documentId)} />
            </div>
            <div className="agent-standard-context" hidden={agentSideMode !== null || agentContextAccess?.destination === 'matching'}>{agentContextAccess && agentContextAccess.destination !== 'matching'
            ? agentContextAccess.destination === 'interview-schedule'
              ? <AgentInterviewSchedulePanel
                  access={agentContextAccess}
                  interviews={bootstrap.candidateInterviews.filter((row) => !row.businessFollowUpId)}
                  onBack={agentContextBack}
                  onClose={() => setAgentContextTrail([])}
                  onSave={saveCandidateInterviewSchedule}
                  reviews={bootstrap.candidateReviews}
                />
              : <AgentBusinessWorkspacePanel
                  renderBusinessProgress={renderBusinessProgress}
                  matchingBusy={hrBusy}
                  access={agentContextAccess}
                  focusRequest={caseFocusRequest}
                  broadcastActions={broadcastActions}
                  candidateReviews={bootstrap.candidateReviews}
                  interviews={bootstrap.candidateInterviews.filter((row) => !row.businessFollowUpId)}
                  jobCaseReviews={bootstrap.jobCaseReviews}
                  matchingHome={bootstrap.matchingHome}
                  onBack={agentContextBack}
                  onClose={() => setAgentContextTrail([])}
                  onCreateManualCase={createManualJobCaseDraft}
                  onLoadJobCaseSourceText={(reviewId) => window.sesAgent.getJobCaseSourceText(reviewId)}
                  onLoadOriginalDocument={(sourceDocumentId) => window.sesAgent.getOriginalDocumentPreview(sourceDocumentId)}
                  onOpenAccess={openAgentSystemAccess}
                  onResolveActionApproval={resolveActionApproval}
                  onEditCase={(reviewId) => { setRequestedJobCaseReviewId(reviewId); setActiveView('cases') }}
                  onSubmitJobCaseReview={submitJobCaseReview}
                  newCaseDigest={newCaseDigest}
                  gmailLastSyncedAt={bootstrap.gmail.status === 'readonly' ? bootstrap.gmailSync.lastSyncedAt : null}
                  onMarkSeen={markJobCaseSeen}
                  reviewQueue={pendingActionApprovals}
                  tasks={bootstrap.tasks}
                />
            : null}</div>
            </div>
          </>}
          contextPanelLabel={locale === 'zh-CN' ? '业务工作区' : '業務ワークスペース'}
          newCaseUnseenCount={newCaseDigest?.unseenCount ?? 0}
          onOpenNewCaseBoard={() => setAgentContextTrail(defaultAgentContextTrail())}
          defaultModelKey={bootstrap.defaultAgentChatModelKey}
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
          onOpenCandidatePool={() => openAgentSystemAccess({ type: 'system-access', destination: 'candidate-management' })}
          onOpenCaseImport={() => openAgentSystemAccess({ type: 'system-access', destination: 'case-import' })}
          onOpenBroadcast={() => openAgentSystemAccess({ type: 'system-access', destination: 'broadcast' })}
          onOpenCases={() => openAgentSystemAccess({ type: 'system-access', destination: 'job-cases' })}
          onOpenGovernance={() => setGovernanceOpen(true)}
          onOpenMatching={(jobCaseId) => openAgentSystemAccess({ type: 'system-access', destination: 'matching', jobCaseId })}
          onOpenOriginalDocument={async (sourceDocumentId) => openAgentSystemAccess({ type: 'system-access', destination: 'original-document', sourceDocumentId })}
          onOpenOperatorProfile={() => setOperatorProfileOpen(true)}
          onLocalDataChanged={async () => {
            const refreshed = await window.sesAgent.getBootstrap()
            setBootstrap(refreshed)
          }}
          onOpenSystemAccess={openAgentSystemAccess}
          onOpenTasks={openTaskCenter}
          operatorLabel={bootstrap.operatorProfile.displayName || bootstrap.operatorProfile.operatorId}
          reloadToken={agentHistoryReloadToken}
          status={{
            activeCaseCount,
            eligibleCandidateCount,
            runningJobCount: activeProcessingJobCount,
            backupReminder: bootstrap.recovery.reminder.status
          }}
        />
        ) : null}
      </div>
      {activeView === 'business' || agentPrimary ? null : activeView === 'task' && selectedTask ? (
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
          onBack={() => {
            setSelectedTask(null)
            setActiveView('home')
          }}
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
      ) : activeView === 'tasks' && hrNavigation && importHistoryOpen ? (
        <ResumeImportHistory tasks={resumeImports} onSelect={selectTask} onImport={() => void startResumeImport()} />
      ) : activeView === 'tasks' ? (
        <main className="task-center-page">
          <header className="task-center-header">
            <div><span className="eyebrow">ACTIVITY & EVIDENCE</span><h1>アクティビティ</h1><p>ローカル処理の履歴、進捗、証跡と確認待ち状態を一つの一覧から再開できます。</p></div>
            <button onClick={startNewTask} type="button"><Icon name="sparkles" size={16} />AI マッチング</button>
          </header>
          <section className="task-center-stats" aria-label="作業状態の集計">
            <div><strong>{bootstrap.tasks.length}</strong><span>すべて</span></div>
            <div><strong>{bootstrap.tasks.filter((task) => ['planned', 'running'].includes(task.status)).length}</strong><span>進行中</span></div>
            <div><strong>{bootstrap.tasks.filter((task) => task.status === 'awaiting_review').length}</strong><span>確認待ち</span></div>
            <div><strong>{bootstrap.tasks.filter((task) => task.status === 'failed').length}</strong><span>要対応</span></div>
          </section>
          <TaskList eyebrow="LOCAL WORK HISTORY" onSelect={selectTask} tasks={bootstrap.tasks} title="処理履歴と証跡" />
          <footer className="app-footer">タスクの指示・進捗・証跡は暗号化ローカルDBに保存 · Cloud送信なし</footer>
        </main>
      ) : activeView === 'reviews' ? (
        <ReviewCenter
          items={reviewQueue}
          onOpenCandidate={(_documentId, taskId) => {
            const task = taskId ? bootstrap.tasks.find((item) => item.id === taskId) : null
            if (task) selectTask(task)
            else openTaskCenter()
          }}
          onOpenCase={openJobCaseReview}
          onOpenTask={(taskId) => {
            const task = bootstrap.tasks.find((item) => item.id === taskId)
            if (task) selectTask(task)
          }}
          onResolveActionApproval={resolveActionApproval}
        />
      ) : activeView === 'case-import' ? (
        <JobCaseInbox
          fieldAliases={bootstrap.jobCaseFieldAliases}
          onSaveFieldAliases={saveJobCaseFieldAliases}
          gmailConnected={bootstrap.gmail.status === 'readonly'}
          gmailImportNotice={gmailImportNotice}
          gmailSetupRequired={bootstrap.gmail.configuration === 'required' || bootstrap.gmailSync.configuration === 'required'}
          manualCreateRequestId={manualCaseRequestId}
          mode="import"
          onDelete={deleteJobCaseData}
          onCreateChat={createChatPasteJobCaseDraft}
          onCreateManual={createManualJobCaseDraft}
          onReadWechat={readWechatVisibleMessages}
          onDismissGmailImportNotice={() => setGmailImportNotice(null)}
          onManualCreateRequestHandled={() => setManualCaseRequestId(null)}
          onSelectedReviewRequestHandled={() => setRequestedJobCaseReviewId(null)}
          onImportEml={importEmlJobCaseDrafts}
          onImportGmail={importGmailFromComposer}
          newCaseDigest={newCaseDigest}
          onMarkSeen={markJobCaseSeen}
          onLoadHistory={(reviewId) => window.sesAgent.getJobCaseHistory(reviewId)}
          onLoadSourceText={(reviewId) => window.sesAgent.getJobCaseSourceText(reviewId)}
          onOpenExternalSettings={() => openApplicationSettings('integrations')}
          onOpenLibrary={(reviewId) => {
            setRequestedJobCaseReviewId(reviewId ?? null)
            setActiveView('cases')
          }}
          onPreviewDeletion={(reviewId) => window.sesAgent.previewJobCaseDeletion(reviewId)}
          onReopen={reopenJobCaseReview}
          onSetLifecycle={setJobCaseLifecycle}
          onSubmit={submitJobCaseReview}
          reviews={bootstrap.jobCaseReviews}
          selectedReviewRequestId={requestedJobCaseReviewId}
          wechatVisibleMessage={bootstrap.wechatVisibleMessage}
        />
      ) : activeView === 'cases' ? (
        <JobCaseInbox
          fieldAliases={bootstrap.jobCaseFieldAliases}
          onSaveFieldAliases={saveJobCaseFieldAliases}
          gmailImportNotice={gmailImportNotice}
          manualCreateRequestId={manualCaseRequestId}
          onDelete={deleteJobCaseData}
          onCreateChat={createChatPasteJobCaseDraft}
          onCreateManual={createManualJobCaseDraft}
          onReadWechat={readWechatVisibleMessages}
          onDismissGmailImportNotice={() => setGmailImportNotice(null)}
          onManualCreateRequestHandled={() => setManualCaseRequestId(null)}
          onSelectedReviewRequestHandled={() => setRequestedJobCaseReviewId(null)}
          onImportEml={importEmlJobCaseDrafts}
          onOpenLibrary={(reviewId) => {
            setRequestedJobCaseReviewId(reviewId ?? null)
            setActiveView('cases')
          }}
          newCaseDigest={newCaseDigest}
          onMarkSeen={markJobCaseSeen}
          onLoadHistory={(reviewId) => window.sesAgent.getJobCaseHistory(reviewId)}
          onLoadSourceText={(reviewId) => window.sesAgent.getJobCaseSourceText(reviewId)}
          onPreviewDeletion={(reviewId) => window.sesAgent.previewJobCaseDeletion(reviewId)}
          onReopen={reopenJobCaseReview}
          onSetLifecycle={setJobCaseLifecycle}
          onSubmit={submitJobCaseReview}
          reviews={bootstrap.jobCaseReviews}
          selectedReviewRequestId={requestedJobCaseReviewId}
          wechatVisibleMessage={bootstrap.wechatVisibleMessage}
        />
      ) : activeView === 'agent' && bootstrap.featureFlags?.conversationalMatchingEnabled === true ? (
        null
      ) : activeView === 'matching' || activeView === 'agent' ? (
        <main className="core-workflow-page matching-page">
          <header className="core-workflow-header">
            <div><span className="eyebrow">EVIDENCE-BASED MATCHING</span><h1>AI マッチング</h1><p>案件条件をもとに、確認済みの人材だけを硬条件・検索・Local AI 精査で比較します。</p></div>
            <div className="matching-resource-status"><span><strong>{bootstrap.jobCaseReviews.filter((review) => review.status === 'completed' && review.lifecycle === 'active').length}</strong>案件</span><span><strong>{bootstrap.candidateReviews.filter((review) => review.talentPoolStatus === 'eligible').length}</strong>人材</span></div>
          </header>
          <div className="matching-method-strip"><span>1</span><strong>硬条件</strong><Icon name="chevron-right" size={14} /><span>2</span><strong>BM25 + Vector</strong><Icon name="chevron-right" size={14} /><span>3</span><strong>Local AI 精査</strong><Icon name="chevron-right" size={14} /><span>4</span><strong>HR 確認</strong></div>
          <TaskComposer
            focusRequestId={composerFocusRequestId}
            gmailConnected={false}
            gmailSetupRequired={false}
            gmailSyncStatus="never"
            mode="matching"
            initialJobCaseId={matchingJobCaseId}
            jobCases={bootstrap.jobCaseReviews.flatMap((review) => review.status === 'completed' && review.lifecycle === 'active' && review.jobCase
              ? [{
                  id: review.jobCase.id,
                  version: review.jobCase.version,
                  title: review.fields.find((field) => field.key === 'title')?.value ?? review.redactedSubject,
                  requiredSkills: review.fields.find((field) => field.key === 'required_skills')?.value ?? null,
                  role: review.fields.find((field) => field.key === 'role')?.value ?? null
                }]
              : [])}
            onCreate={(input: CreateWorkTaskInput) => window.sesAgent.createWorkTask(input)}
            onCreated={handleCreated}
            onImportGmail={async () => undefined}
            onFocusRequestHandled={() => setComposerFocusRequestId(null)}
            onOpenGoogleWorkspace={() => undefined}
            onPreview={(input: WorkTaskInput): Promise<SignedWorkTaskPreview> => window.sesAgent.previewWorkTask(input)}
          />
          <section className="matching-explanation"><Icon name="shield" size={18} /><div><strong>AI は採否を決定しません</strong><span>資料にない条件は「不明」として保持し、案件ごとの一致根拠・不足条件・出典を表示します。</span></div></section>
        </main>
      ) : activeView === 'candidate-management' ? (
        candidateWorkspaceDetail?.scope === 'candidate'
          ? renderCandidatePipelineDetail(candidateWorkspaceDetail)
          : <CandidateDirectoryWorkspace
              interviews={bootstrap.candidateInterviews.filter((row) => !row.businessFollowUpId)}
              onImportResume={() => void startResumeImport()}
              onOpenCandidate={(documentId, view, interviewId, interviewKind) => setCandidateWorkspaceDetail({ scope: 'candidate', documentId, view, interviewId, interviewKind })}
              reviews={bootstrap.candidateReviews}
            />
      ) : activeView === 'interview-workbench' ? (
        candidateWorkspaceDetail?.scope === 'recruiting'
          ? renderCandidatePipelineDetail(candidateWorkspaceDetail)
          : <RecruitingInterviewWorkspace
              interviews={bootstrap.candidateInterviews.filter((row) => !row.businessFollowUpId)}
              onImportResume={() => void startResumeImport()}
              onOpenCandidate={(documentId, view, interviewId, interviewKind) => setCandidateWorkspaceDetail({ scope: 'recruiting', documentId, view, interviewId, interviewKind })}
              reviews={bootstrap.candidateReviews}
            />
      ) : activeView === 'client-interviews' ? (
        candidateWorkspaceDetail?.scope === 'client'
          ? renderCandidatePipelineDetail(candidateWorkspaceDetail)
          : <ClientInterviewWorkspace
              interviews={bootstrap.candidateInterviews.filter((row) => !row.businessFollowUpId)}
              onOpenCandidate={(documentId, view, interviewId, interviewKind) => setCandidateWorkspaceDetail({ scope: 'client', documentId, view, interviewId, interviewKind })}
              onOpenMatching={openMatching}
              reviews={bootstrap.candidateReviews}
            />
      ) : activeView === 'interview-schedule' ? (
        candidateWorkspaceDetail?.scope === 'schedule'
          ? renderCandidatePipelineDetail(candidateWorkspaceDetail)
          : <InterviewScheduleCenter cases={bootstrap.jobCaseReviews}
              interviews={bootstrap.candidateInterviews.filter((row) => !row.businessFollowUpId)}
              onOpenInterview={openInterviewFromSchedule}
              reviews={bootstrap.candidateReviews}
            />
      ) : activeView === 'entry-prep' ? (
        candidateWorkspaceDetail?.scope === 'entry'
          ? renderCandidatePipelineDetail(candidateWorkspaceDetail)
          : <ClientInterviewWorkspace
              interviews={bootstrap.candidateInterviews.filter((row) => !row.businessFollowUpId)}
              mode="entry-prep"
              onOpenCandidate={(documentId, view, interviewId, interviewKind) => setCandidateWorkspaceDetail({ scope: 'entry', documentId, view, interviewId, interviewKind })}
              onOpenMatching={openMatching}
              reviews={bootstrap.candidateReviews}
            />
      ) : activeView === 'candidates' ? (
        <CandidateLibrary
          profileRequest={personnelProfileRequest}
          aiCommerce={bootstrap.aiCommerce}
          analyses={bootstrap.resumeAnalyses}
          onImportResume={() => void startResumeImport()}
          onDeleteCandidate={deleteCandidateData}
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
      ) : (
        <div className="home-layout">
          <main className="home-main">
            <header className="home-topbar">
              <div>
                <span className="eyebrow">{localizedWorkDate(locale)}</span>
                <h1>業務ワークベンチ</h1>
                <p>履歴書と案件をリソース化し、根拠付きの AI マッチングへ進みます。</p>
              </div>
              <div className="home-topbar-actions">
                <button
                  aria-label={bootstrap.recovery.reminder.status === 'due' ? 'データと承認・バックアップ要確認' : 'データと承認'}
                  className={`governance-compact-trigger${bootstrap.recovery.reminder.status === 'due' ? ' has-attention' : ''}`}
                  onClick={() => setGovernanceOpen(true)}
                  type="button"
                >
                  <Icon name={bootstrap.recovery.reminder.status === 'due' ? 'alert' : 'shield'} size={17} />
                  {bootstrap.recovery.reminder.status === 'due' ? 'バックアップ要確認' : 'データセキュリティ'}
                </button>
                <button
                  aria-expanded={commandPaletteOpen}
                  aria-haspopup="dialog"
                  className="command-search"
                  onClick={showCommandPalette}
                  type="button"
                >
                  <Icon name="search" size={18} />
                  コマンドを検索
                  <kbd>⌘ K</kbd>
                </button>
              </div>
            </header>

            {bootstrap.matchingHome.state === 'onboarding' ? <section className="onboarding-workflow" aria-labelledby="onboarding-workflow-title">
              <div className="onboarding-workflow-heading">
                <div><span className="eyebrow">CORE WORKFLOW</span><h2 id="onboarding-workflow-title">3つのステップで最初のマッチングを開始</h2><p>初めての方は左から順に進めてください。登録済みデータがある場合は、直接データベースへ移動できます。</p></div>
                <span className="onboarding-progress">{
                  (bootstrap.candidateReviews.some((review) => review.talentPoolStatus === 'eligible') ? 1 : 0) +
                  (bootstrap.jobCaseReviews.some((review) => review.status === 'completed' && review.lifecycle === 'active') ? 1 : 0) +
                  (bootstrap.tasks.some((task) => task.type === 'MATCH_CANDIDATES') ? 1 : 0)
                } / 3</span>
              </div>
              <div className="workflow-step-grid">
                <button onClick={() => void startResumeImport()} type="button">
                  <span className="workflow-step-number">1</span>
                  <span className="workflow-step-icon"><Icon name="upload" size={22} /></span>
                  <span><strong>履歴書をインポート</strong><small>PDF、Word、Excelから標準プロフィールを作成</small></span>
                  <span className="workflow-step-meta">取込済み {bootstrap.candidateReviews.length} 件</span>
                  <Icon name="chevron-right" size={17} />
                </button>
                <button onClick={openCaseImport} type="button">
                  <span className="workflow-step-number">2</span>
                  <span className="workflow-step-icon"><Icon name="briefcase" size={22} /></span>
                  <span><strong>案件をインポート</strong><small>Gmail、EML、テキストを固定フォーマットへ変換</small></span>
                  <span className="workflow-step-meta">案件候補 {bootstrap.jobCaseReviews.length} 件</span>
                  <Icon name="chevron-right" size={17} />
                </button>
                <button className="is-ai-step" onClick={openMatching} type="button">
                  <span className="workflow-step-number">3</span>
                  <span className="workflow-step-icon"><Icon name="sparkles" size={22} /></span>
                  <span><strong>AI マッチングを実行</strong><small>硬条件、検索、Local AI 精査から根拠付き候補を作成</small></span>
                  <span className="workflow-step-meta">AI は採否を決定しません</span>
                  <Icon name="chevron-right" size={17} />
                </button>
              </div>
            </section> : (
              <MatchingHomeDashboard
                onOpenMatching={openMatchingForCase}
                onOverridePriority={async (input) => {
                  const matchingHome = await window.sesAgent.setBusinessPriorityOverride(input)
                  setBootstrap((current) => current ? { ...current, matchingHome } : current)
                }}
                projection={bootstrap.matchingHome}
              />
            )}

            <section className="resource-overview" aria-labelledby="resource-overview-title">
              <div className="resource-overview-heading"><div><span className="eyebrow">RESOURCE OVERVIEW</span><h2 id="resource-overview-title">現在のリソース</h2></div><button onClick={openReviewCenter} type="button">確認待ちを開く<Icon name="chevron-right" size={15} /></button></div>
              <div className="resource-overview-grid">
                <button onClick={() => setActiveView('candidates')} type="button"><span><Icon name="users" size={20} /></span><strong>{bootstrap.candidateReviews.filter((review) => review.talentPoolStatus === 'eligible').length}</strong><small>採用通過済み</small><em>人材プール</em></button>
                <button onClick={() => setActiveView('cases')} type="button"><span><Icon name="briefcase" size={20} /></span><strong>{bootstrap.jobCaseReviews.filter((review) => review.status === 'completed' && review.lifecycle === 'active').length}</strong><small>確認済み案件</small><em>案件データベース</em></button>
                <button onClick={openReviewCenter} type="button"><span><Icon name="shield" size={20} /></span><strong>{reviewQueue.length}</strong><small>確認待ち</small><em>レビューセンター</em></button>
                <button onClick={openTaskCenter} type="button"><span><Icon name="tasks" size={20} /></span><strong>{bootstrap.tasks.length}</strong><small>活動記録</small><em>処理履歴と証跡</em></button>
              </div>
            </section>

            <TaskList eyebrow="RECENT ACTIVITY" onSelect={selectTask} onViewAll={openTaskCenter} tasks={bootstrap.tasks.slice(0, 5)} title="最近のアクティビティ" />
            <footer className="app-footer">SES Agent Desktop v{bootstrap.appVersion} · {bootstrap.environmentLabel}</footer>
          </main>
        </div>
      )}
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
