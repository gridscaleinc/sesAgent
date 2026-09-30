/**
 * Cases HR creates in this app session (any import path) go straight into 我的案件, the case list's default view,
 * and onto the list at once instead of waiting behind 「有更新可查看」.
 */
export async function joinCreatedCases(
  reviewIds: readonly string[],
  addToWorking: (reviewId: string) => Promise<unknown> = (reviewId) => window.sesAgent.setCaseWorking({ reviewId, working: true })
): Promise<boolean> {
  const unique = [...new Set(reviewIds)]
  if (!unique.length) return false
  const joined = await Promise.allSettled(unique.map(async (reviewId) => addToWorking(reviewId)))
  return joined.every((outcome) => outcome.status === 'fulfilled')
}

/** Tells the case list to show the just-created cases where they landed (my cases when they joined it). */
export function revealCreatedCases(reviewIds: readonly string[], working: boolean) {
  if (!reviewIds.length) return
  window.dispatchEvent(new CustomEvent('ses-cases-imported', { detail: { reviewIds: [...reviewIds], working } }))
}
