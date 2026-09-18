/** Request-local UUID aliases keep database identifiers out of model inputs.
 * Alphabetic hex digits also prevent opaque UUID segments looking like postal codes.
 * Business prose is untouched and still passes through the normal privacy gateway.
 */
export function createCloudRecordAliases() {
  const forward = new Map<string, string>()
  const reverse = new Map<string, string>()
  const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu
  const alias = (id: string) => {
    let value = forward.get(id)
    if (!value) {
      const suffix = forward.size.toString(6).padStart(12, '0').replace(/[0-5]/g, digit => 'abcdef'[Number(digit)]!)
      value = `aaaaaaaa-aaaa-4aaa-aaaa-${suffix}`
      forward.set(id, value)
      reverse.set(value, id)
    }
    return value
  }
  const project = (value: unknown): unknown => {
    if (typeof value === 'string') return uuid.test(value) ? alias(value) : value
    if (Array.isArray(value)) return value.map(project)
    if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, project(entry)]))
    return value
  }
  return { alias, project, original: (value: string) => reverse.get(value) }
}
