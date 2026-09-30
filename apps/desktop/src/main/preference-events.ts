/** Lets long-lived Main features (the menu-bar icon) follow a saved preference without reaching into the IPC layer. */
const listeners = new Set<() => void>()

export function onApplicationPreferencesSaved(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function applicationPreferencesSaved(): void {
  for (const listener of listeners) {
    try {
      listener()
    } catch {
      /* A listener failure never fails the save that already succeeded. */
    }
  }
}
