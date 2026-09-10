const consumed = new WeakSet<object>()
export function consumeMatchingIntent(intent: object): boolean {
  if (consumed.has(intent)) return false
  consumed.add(intent)
  return true
}
