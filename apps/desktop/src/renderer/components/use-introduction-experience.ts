import { useEffect, useRef, useState } from 'react'
import type { RegenerateIntroductionInput } from '@shared'

type Trace = { text: string; experienceRunId?: string }
/** A local draft with optional learned wording applied in the background. Never overwrite an edit. */
export function useIntroductionExperience(key: string, input: RegenerateIntroductionInput | null, initial: string, valid: boolean) {
  const [traces, setTraces] = useState<Record<string, Trace>>({})
  const current = useRef<Record<string, Trace>>({}),
    edited = useRef(new Set<string>()),
    pending = useRef(new Map<string, Promise<Trace | undefined>>())
  const activeKey = useRef<string | null>(null)
  const encoded = JSON.stringify(input)
  useEffect(() => {
    activeKey.current = key
    return () => {
      activeKey.current = null
    }
  }, [key])
  const put = (target: string, value: Trace) => {
    current.current[target] = value
    setTraces((previous) => ({ ...previous, [target]: value }))
  }
  useEffect(() => {
    if (
      !valid ||
      !input ||
      !key ||
      !initial.trim() ||
      !window.sesAgent.beginIntroductionDraft ||
      current.current[key] ||
      pending.current.has(key)
    )
      return
    const request = window.sesAgent
      .beginIntroductionDraft({ ...input, text: initial })
      .then(async (result) => {
        if (!result) return undefined
        if (current.current[key]) return current.current[key]
        const local = { text: initial, experienceRunId: result.experienceRunId }
        put(key, local)
        if (result.hasExperience && !edited.current.has(key) && activeKey.current === key) {
          // Keep the local trace ready for copy/email while background wording runs.
          void window.sesAgent
            .regenerateIntroduction(input)
            .then((generated) => {
              if (activeKey.current === key && !edited.current.has(key) && current.current[key] === local) put(key, generated)
            })
            .catch(() => {})
        }
        return local
      })
      .catch(() => undefined)
      .finally(() => pending.current.delete(key))
    pending.current.set(key, request)
  }, [key, encoded, initial, valid])
  return {
    text: traces[key]?.text ?? initial,
    markEdited: () => edited.current.add(key),
    replace: (value: Trace) => {
      edited.current.delete(key)
      put(key, value)
    },
    runId: async () => {
      edited.current.add(key)
      if (pending.current.has(key)) await pending.current.get(key)
      return current.current[key]?.experienceRunId
    }
  }
}
