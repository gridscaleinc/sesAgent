/**
 * Copies through Main's clipboard when the preload bridge is present — the
 * sandboxed renderer sits behind a deny-all permission handler, so
 * navigator.clipboard rejects there. The browser API remains as the fallback
 * for test environments that stub it.
 */
export async function copyTextToClipboard(text: string): Promise<void> {
  const bridge = window.sesAgent?.copyTextToClipboard
  if (bridge) {
    await bridge.call(window.sesAgent, text)
    return
  }
  if (!navigator.clipboard?.writeText) throw new Error('Clipboard unavailable in this environment.')
  await navigator.clipboard.writeText(text)
}
