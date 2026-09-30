import { useEffect, type RefObject } from 'react'

export function recordExperienceOpened(runId?: string) {
  if (runId && window.sesAgent.recordExperienceExposure)
    void window.sesAgent.recordExperienceExposure({ runId, action: 'opened' }).catch(() => {})
}
/** An offscreen/hidden result is not an impression. Neither impressions nor clicks teach a method. */
export function useExperienceExposure(root: RefObject<HTMLElement | null>, revision: string) {
  useEffect(() => {
    if (!root.current || !window.sesAgent.recordExperienceExposure || typeof IntersectionObserver === 'undefined') return
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting || entry.intersectionRatio < 0.1 || entry.target.closest('[hidden]')) continue
          const element = entry.target as HTMLElement,
            runId = element.dataset.experienceRun
          if (!runId) continue
          void window.sesAgent
            .recordExperienceExposure({ runId, action: 'shown', rank: Number(element.dataset.experienceRank) || 1 })
            .catch(() => {})
          observer.unobserve(element)
        }
      },
      { threshold: 0.1 }
    )
    if (root.current.dataset.experienceRun) observer.observe(root.current)
    root.current.querySelectorAll('[data-experience-run]').forEach((element) => observer.observe(element))
    return () => observer.disconnect()
  }, [root, revision])
}
