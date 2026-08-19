import { startTransition, useEffect, useMemo, useRef, useState } from 'react'
import type { SignedWorkTaskPreview, WorkTask } from '@domain'
import type {
  BootstrapPayload,
  CandidateMatchResult,
  CandidateMatchRunSummary,
  CreateWorkTaskInput,
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
import { GoogleWorkspaceSettingsDialog } from './components/GoogleWorkspaceSettingsDialog'
import { LocalOperatorProfileDialog } from './components/LocalOperatorProfileDialog'
import { buildReviewQueue, ReviewCenter } from './components/ReviewCenter'
import { Sidebar, type SidebarView } from './components/Sidebar'
import { TaskComposer } from './components/TaskComposer'
import { TaskList } from './components/TaskList'
import { TaskWorkspace } from './components/TaskWorkspace'
import { MatchingHomeDashboard } from './components/MatchingHomeDashboard'
import { AgentWorkspace } from './components/AgentWorkspace'
import { StartupRecoveryScreen } from './components/StartupRecoveryScreen'
import { localizedWorkDate, UiLocaleProvider, useLegacyRendererLocalization } from './i18n'

export function App() {
  const [bootstrap, setBootstrap] = useState<BootstrapPayload | null>(null)
  const [startupRecovery, setStartupRecovery] = useState<Extract<StartupStatus, { mode: 'recovery-required' }> | null>(null)
  const [selectedTask, setSelectedTask] = useState<WorkTask | null>(null)
  const [activeView, setActiveView] = useState<SidebarView>('home')
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
  const [googleWorkspaceSettingsOpen, setGoogleWorkspaceSettingsOpen] = useState(false)
  const [aiCommerceOpen, setAiCommerceOpen] = useState(false)
  const [aiCommerceCallbackError, setAiCommerceCallbackError] = useState<string | null>(null)
  const [operatorProfileOpen, setOperatorProfileOpen] = useState(false)
  const [composerFocusRequestId, setComposerFocusRequestId] = useState<number | null>(null)
  const [resumeImportProgress, setResumeImportProgress] = useState<ResumeImportProgress | null>(null)
  const [manualCaseRequestId, setManualCaseRequestId] = useState<number | null>(null)
  const [matchingJobCaseId, setMatchingJobCaseId] = useState<string | null>(null)
  const [agentHistoryReloadToken, setAgentHistoryReloadToken] = useState(0)
  const [requestedJobCaseReviewId, setRequestedJobCaseReviewId] = useState<string | null>(null)
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
  const commandPaletteOpener = useRef<HTMLElement | null>(null)
  const candidateMatchStateRef = useRef(candidateMatch)
  candidateMatchStateRef.current = candidateMatch
  const hasActiveProcessingJobs = bootstrap?.processingJobs.some((job) =>
    ['queued', 'running', 'retry_wait'].includes(job.status)
  ) ?? false
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
        if (active) setBootstrap(payload)
      })
      .catch((cause: unknown) => {
        if (active) setLoadError(cause instanceof Error ? cause.message : 'アプリを初期化できませんでした。')
      })
    return () => {
      active = false
    }
  }, [startupRecovery])

  // Agent-first cold start. Applied once, on the first bootstrap: setBootstrap also
  // runs for AICommerce/recovery/task updates, and those must not yank the user
  // back out of whatever page they navigated to.
  const initialRouteApplied = useRef(false)
  useEffect(() => {
    if (!bootstrap || initialRouteApplied.current) return
    initialRouteApplied.current = true
    if (bootstrap.featureFlags?.conversationalMatchingEnabled === true) setActiveView('agent')
  }, [bootstrap])

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

  const createManualJobCaseDraft = async (input: Parameters<typeof window.sesAgent.createManualJobCaseDraft>[0]) => {
    const result = await window.sesAgent.createManualJobCaseDraft(input)
    setBootstrap((current) => {
      if (!current) return current
      const reviews = new Map(current.jobCaseReviews.map((review) => [review.reviewId, review]))
      reviews.set(result.review.reviewId, result.review)
      return { ...current, jobCaseReviews: [result.review, ...[...reviews.values()].filter((review) => review.reviewId !== result.review.reviewId)] }
    })
    return result
  }

  const createChatPasteJobCaseDraft = async (input: Parameters<typeof window.sesAgent.createChatPasteJobCaseDraft>[0]) => {
    const result = await window.sesAgent.createChatPasteJobCaseDraft(input)
    setBootstrap((current) => {
      if (!current) return current
      const remaining = current.jobCaseReviews.filter((review) => review.reviewId !== result.review.reviewId)
      return { ...current, jobCaseReviews: [result.review, ...remaining] }
    })
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

  const executeResumeImportTask = async (task: WorkTask, request: number) => {
    const completedTokens = new Set(bootstrap.resumeAnalyses
      .filter((analysis) => analysis.analysisVersion === 'resume-analysis-v6')
      .map((analysis) => analysis.fileToken))
    const bindings = task.contextBindings.filter(
      (binding) => binding.objectType === 'staged-file' && !completedTokens.has(binding.objectId)
    )
    for (const binding of bindings) {
      if (resumeImportRequest.current !== request) return
      setResumeImportProgress((current) => current?.taskId === task.id ? {
        ...current,
        files: current.files.map((file) => file.token === binding.objectId ? { ...file, status: 'parsing', error: null } : file)
      } : current)
      try {
        const execution = await window.sesAgent.analyzeResumeFile({ fileToken: binding.objectId, taskId: task.id })
        if (resumeImportRequest.current !== request) return
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
        if (resumeImportRequest.current !== request) return
        setResumeImportProgress((current) => current?.taskId === task.id ? {
          ...current,
          files: current.files.map((file) => file.token === binding.objectId ? {
            ...file, status: 'error', error: cause instanceof Error ? cause.message : 'ローカル解析に失敗しました。'
          } : file)
        } : current)
      }
    }
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

  const runResumeImportTask = async (task: WorkTask, request: number) => {
    try {
      await executeResumeImportTask(task, request)
      if (resumeImportRequest.current !== request) return
      const refreshed = await window.sesAgent.getBootstrap()
      setBootstrap(refreshed)
      setSelectedTask((current) => refreshed.tasks.find((item) => item.id === current?.id) ?? current)
      setResumeImportProgress((current) => current?.taskId === task.id ? {
        ...current,
        phase: current.files.some((file) => file.status === 'error') ? 'partial-failed' : 'completed'
      } : current)
    } catch (cause) {
      if (resumeImportRequest.current === request) {
        setResumeImportProgress((current) => current ? {
          ...current,
          phase: 'error',
          error: cause instanceof Error ? cause.message : '履歴書を取り込めませんでした。'
        } : current)
      }
    } finally {
      if (resumeImportRequest.current === request) resumeImportRequest.current = 0
    }
  }

  const startResumeImport = async () => {
    if (resumeImportRequest.current !== 0) return
    const request = Date.now()
    resumeImportRequest.current = request
    setResumeImportProgress({ phase: 'choosing', taskId: null, files: [], error: null })
    try {
      const created = await window.sesAgent.beginResumeImport()
      if (resumeImportRequest.current !== request) return
      if (created.cancelled) {
        setResumeImportProgress(null)
        resumeImportRequest.current = 0
        return
      }
      setBootstrap((current) => current ? { ...current, tasks: [created.task, ...current.tasks] } : current)
      setResumeImportProgress({ phase: 'parsing', taskId: created.task.id, files: progressFiles(created.files), error: null })
      await runResumeImportTask(created.task, request)
    } catch (cause) {
      if (resumeImportRequest.current === request) {
        setResumeImportProgress((current) => current ? {
          ...current,
          phase: 'error',
          error: cause instanceof Error ? cause.message : '履歴書を取り込めませんでした。'
        } : current)
      }
      if (resumeImportRequest.current === request) resumeImportRequest.current = 0
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
      run: startResumeImport
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

  const renderCandidatePipelineDetail = (
    detail: NonNullable<typeof candidateWorkspaceDetail>,
    showBackToQueue = true
  ) => <CandidatePipeline
    aiCommerce={bootstrap.aiCommerce}
    analyses={bootstrap.resumeAnalyses}
    initialCandidateId={detail.documentId}
    initialInterviewId={detail.interviewId ?? null}
    interviewKind={detail.interviewKind ?? (detail.scope === 'client' ? 'client' : 'recruiting')}
    interviews={bootstrap.candidateInterviews}
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
    onSaveSchedule={async (input) => {
      const interview = await window.sesAgent.saveCandidateInterviewSchedule(input)
      setBootstrap((current) => current ? {
        ...current,
        candidateInterviews: [interview, ...current.candidateInterviews.filter((item) => item.id !== interview.id)]
      } : current)
      return interview
    }}
    onSendCloudPrompt={runReviewedAiCommerceCloudPrompt}
    onSetTaskLifecycle={setWorkTaskLifecycle}
    onViewChange={(nextView) => setCandidateWorkspaceDetail((current) => current
      ? { ...current, view: nextView }
      : { ...detail, view: nextView })}
    reviews={bootstrap.candidateReviews}
    view={detail.view}
  />

  const openInterviewFromSchedule = (route: InterviewScheduleRoute) => {
    setCandidateWorkspaceDetail({
      scope: 'schedule',
      documentId: route.sourceDocumentId,
      interviewId: route.interviewId,
      interviewKind: route.kind,
      view: route.view
    })
  }

  return (
    <UiLocaleProvider locale={locale}>
      <div className="app-shell">
      <Sidebar
        active={activeView}
        caseCount={bootstrap.jobCaseReviews.filter((review) => review.lifecycle === 'active' && review.status === 'completed').length}
        candidateManagementCount={bootstrap.candidateReviews.length}
        candidateCount={bootstrap.candidateReviews.filter((review) => review.talentPoolStatus === 'eligible').length}
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
        onCases={() => {
          setGovernanceOpen(false)
          setSelectedTask(null)
          setActiveView('cases')
        }}
        onCaseImport={openCaseImport}
        onGovernance={() => {
          setSelectedTask(null)
          setGovernanceOpen(true)
        }}
        onHome={openHome}
        onMatching={openMatching}
        onOperatorProfile={() => setOperatorProfileOpen(true)}
        onResumeImport={() => void startResumeImport()}
        onSettings={() => openApplicationSettings('general')}
        onReviews={openReviewCenter}
        onTasks={openTaskCenter}
        taskCount={bootstrap.tasks.length}
      />

      <ResumeImportProgressDrawer
        onClose={() => setResumeImportProgress(null)}
        onOpenCandidates={() => {
          setResumeImportProgress(null)
          openCandidateManagement()
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

      {activeView === 'task' && selectedTask ? (
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
          onLoadHistory={(reviewId) => window.sesAgent.getJobCaseHistory(reviewId)}
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
          onLoadHistory={(reviewId) => window.sesAgent.getJobCaseHistory(reviewId)}
          onPreviewDeletion={(reviewId) => window.sesAgent.previewJobCaseDeletion(reviewId)}
          onReopen={reopenJobCaseReview}
          onSetLifecycle={setJobCaseLifecycle}
          onSubmit={submitJobCaseReview}
          reviews={bootstrap.jobCaseReviews}
          selectedReviewRequestId={requestedJobCaseReviewId}
          wechatVisibleMessage={bootstrap.wechatVisibleMessage}
        />
      ) : activeView === 'agent' && bootstrap.featureFlags?.conversationalMatchingEnabled === true ? (
        <AgentWorkspace
          cloudConnected={bootstrap.aiCommerce.connection === 'connected'}
          defaultModelKey={bootstrap.defaultAgentChatModelKey}
          models={bootstrap.agentChatModels}
          onConnectCloud={() => setAiCommerceOpen(true)}
          onOpenMatching={openMatchingForCase}
          onOpenReviews={() => setActiveView('reviews')}
          reloadToken={agentHistoryReloadToken}
          status={{
            eligibleCandidateCount: bootstrap.matchingHome.eligibleCandidateCount,
            pendingReviewCount: reviewQueue.length,
            runningJobCount: bootstrap.processingJobs.filter((job) => job.status === 'running').length,
            backupReminder: bootstrap.recovery.reminder.status
          }}
        />
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
              interviews={bootstrap.candidateInterviews}
              onImportResume={() => void startResumeImport()}
              onOpenCandidate={(documentId, view, interviewId, interviewKind) => setCandidateWorkspaceDetail({ scope: 'candidate', documentId, view, interviewId, interviewKind })}
              reviews={bootstrap.candidateReviews}
            />
      ) : activeView === 'interview-workbench' ? (
        candidateWorkspaceDetail?.scope === 'recruiting'
          ? renderCandidatePipelineDetail(candidateWorkspaceDetail)
          : <RecruitingInterviewWorkspace
              interviews={bootstrap.candidateInterviews}
              onImportResume={() => void startResumeImport()}
              onOpenCandidate={(documentId, view, interviewId, interviewKind) => setCandidateWorkspaceDetail({ scope: 'recruiting', documentId, view, interviewId, interviewKind })}
              reviews={bootstrap.candidateReviews}
            />
      ) : activeView === 'client-interviews' ? (
        candidateWorkspaceDetail?.scope === 'client'
          ? renderCandidatePipelineDetail(candidateWorkspaceDetail)
          : <ClientInterviewWorkspace
              interviews={bootstrap.candidateInterviews}
              onOpenCandidate={(documentId, view, interviewId, interviewKind) => setCandidateWorkspaceDetail({ scope: 'client', documentId, view, interviewId, interviewKind })}
              onOpenMatching={openMatching}
              reviews={bootstrap.candidateReviews}
            />
      ) : activeView === 'interview-schedule' ? (
        candidateWorkspaceDetail?.scope === 'schedule'
          ? renderCandidatePipelineDetail(candidateWorkspaceDetail)
          : <InterviewScheduleCenter
              interviews={bootstrap.candidateInterviews}
              onOpenInterview={openInterviewFromSchedule}
              reviews={bootstrap.candidateReviews}
            />
      ) : activeView === 'entry-prep' ? (
        candidateWorkspaceDetail?.scope === 'entry'
          ? renderCandidatePipelineDetail(candidateWorkspaceDetail)
          : <ClientInterviewWorkspace
              interviews={bootstrap.candidateInterviews}
              mode="entry-prep"
              onOpenCandidate={(documentId, view, interviewId, interviewKind) => setCandidateWorkspaceDetail({ scope: 'entry', documentId, view, interviewId, interviewKind })}
              onOpenMatching={openMatching}
              reviews={bootstrap.candidateReviews}
            />
      ) : activeView === 'candidates' ? (
        <CandidateLibrary
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
          onUpdateCandidate={(input) => window.sesAgent.updateCandidateProfile(input)}
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
          initialSection={applicationSettingsSection}
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
          onOpenGoogleWorkspace={() => {
            setApplicationSettingsOpen(false)
            setGoogleWorkspaceSettingsOpen(true)
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
      {googleWorkspaceSettingsOpen ? (
        <GoogleWorkspaceSettingsDialog
          configuration={bootstrap.googleWorkspaceConfiguration}
          connected={bootstrap.gmail.status !== 'not-connected'}
          onClose={() => setGoogleWorkspaceSettingsOpen(false)}
          onSave={(input) => window.sesAgent.saveGoogleWorkspaceAdminConfiguration(input)}
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
    </UiLocaleProvider>
  )
}
