import { useEffect, useState } from 'react'
import { createRoot } from 'react-dom/client'
import type { CandidateReviewSnapshot, JobCaseReviewSnapshot } from '@shared'
import { IntroductionComposer } from '../../apps/desktop/src/renderer/components/IntroductionComposer'
import type { IntroductionTarget } from '../../apps/desktop/src/renderer/components/HrMatchingWorkspace'
import { HrObjectList } from '../../apps/desktop/src/renderer/components/HrObjectList'
import { CaseResumeAssessmentPanel } from '../../apps/desktop/src/renderer/components/CaseResumeAssessmentPanel'
import { pendingResumeTask, useCaseResumeAssessments } from '../../apps/desktop/src/renderer/components/use-case-resume-assessments'
import { UiLocaleProvider } from '../../apps/desktop/src/renderer/i18n'
import '../../apps/desktop/src/renderer/styles.css'
import '../../apps/desktop/src/renderer/components/agent-latest-workspace.css'
import '../../apps/desktop/src/renderer/components/hr-workbench.css'
import '../../apps/desktop/src/renderer/components/hr-followups.css'

function Fixture() {
  const controller = useCaseResumeAssessments()
  const [introduction, setIntroduction] = useState<IntroductionTarget | null>(null)
  const [cases, setCases] = useState<JobCaseReviewSnapshot[]>([]),
    [people, setPeople] = useState<CandidateReviewSnapshot[]>([])
  const [target, setTarget] = useState<string | null>(null),
    [selected, setSelected] = useState<string | null>(null)
  const [focus, setFocus] = useState<string | null>(null)
  const refresh = async () => {
    const data = await window.sesAgent.getBootstrap()
    setCases(data.jobCaseReviews)
    setPeople(data.candidateReviews)
  }
  useEffect(() => {
    void refresh()
    const reload = () => {
      void refresh()
    }
    window.addEventListener('ses-business-data-changed', reload)
    return () => window.removeEventListener('ses-business-data-changed', reload)
  }, [])
  const job = cases.find((item) => item.reviewId === target)
  const states: Record<string, { pending: number; count: number }> = {}
  for (const task of controller.tasks) {
    const state = (states[task.reviewId] ??= { pending: 0, count: 0 })
    state.count++
    if (pendingResumeTask(task)) state.pending++
  }
  return (
    <div
      style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) 500px', height: '100vh', background: '#f7f9fc' }}
      onDrop={() => {
        document.body.dataset.genericDrop = 'true'
      }}
    >
      <div style={{ padding: 24, minHeight: 0, overflow: 'hidden' }}>
        <h1 style={{ fontSize: 22 }}>案件</h1>
        <HrObjectList
          kind="case"
          candidates={people}
          cases={cases}
          reloadToken={cases}
          busy={false}
          selectedKey={selected}
          resumeStates={states}
          onOpen={() => {}}
          onIntake={() => {}}
          onImportResume={() => {}}
          onRefresh={refresh}
          onAssessResumes={(entry, files) => {
            const item = cases.find((row) => row.reviewId === entry.objectId)!
            setTarget(item.reviewId)
            setSelected(`case:${item.reviewId}`)
            if (files?.length) setFocus(controller.enqueue(item, files))
            else {
              setFocus(null)
              void controller.search(item)
            }
          }}
        />
      </div>
      <div style={{ minHeight: 0, borderLeft: '1px solid #dbe4ef', background: '#fff' }}>
        {job ? (
          <CaseResumeAssessmentPanel
            job={job}
            people={people}
            controller={controller}
            focusTaskId={focus}
            onClose={() => setTarget(null)}
            onOriginal={() => {}}
            onPrepare={(value) =>
              setIntroduction({
                documentId: value.documentId,
                reviewId: job.reviewId,
                profileVersion: value.profileVersion,
                jobCaseVersion: value.jobCaseVersion,
                assessment: value.result.assessment,
                matched: value.result.matched
              })
            }
            onFollowUp={() => {}}
          />
        ) : null}
      </div>
      <IntroductionComposer
        target={introduction}
        people={people}
        cases={cases}
        onClose={() => setIntroduction(null)}
        onFollowUp={async (target) => {
          const rows = await window.sesAgent.beginBusinessProgress([target])
          document.body.dataset.progressId = rows[0]?.id
          setIntroduction(null)
        }}
      />
    </div>
  )
}
createRoot(document.getElementById('root')!).render(
  <UiLocaleProvider locale="zh-CN">
    <Fixture />
  </UiLocaleProvider>
)
