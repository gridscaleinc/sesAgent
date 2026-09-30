let foreground = 0
export function isLearningForegroundBusy() {
  return foreground > 0
}
export async function withLearningForeground<T>(operation: () => Promise<T>): Promise<T> {
  foreground++
  try {
    return await operation()
  } finally {
    foreground--
  }
}
