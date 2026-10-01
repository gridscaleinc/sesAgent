let pending: ReturnType<typeof setTimeout> | undefined

/**
 * Tells every view that business data changed and should be read again. A burst (20 résumés imported for a case)
 * becomes one event, so the views reload once instead of once per résumé.
 */
export function notifyBusinessDataChanged(delayMs = 300) {
  clearTimeout(pending)
  pending = setTimeout(() => {
    pending = undefined
    window.dispatchEvent(new Event('ses-business-data-changed'))
  }, delayMs)
}
