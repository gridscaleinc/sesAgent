import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type {
  AiConversationContext,
  AiConversationMessage,
  AiConversationSalesAgentState,
  AiConversationSnapshot
} from '@shared'

interface PersistMessagesOptions {
  conversationId?: string
  salesAgentState?: AiConversationSalesAgentState
}

function createConversationId(): string {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID()
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/gu, (character) => {
    const value = Math.floor(Math.random() * 16)
    return (character === 'x' ? value : (value & 0x3) | 0x8).toString(16)
  })
}

function sortConversations(conversations: AiConversationSnapshot[]): AiConversationSnapshot[] {
  return [...conversations].sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
}

export function useAiConversationHistory(context: AiConversationContext, reloadToken = 0) {
  const contextKey = JSON.stringify(context)
  const stableContext = useMemo(() => context, [contextKey])
  const [conversations, setConversations] = useState<AiConversationSnapshot[]>([])
  const [messages, setMessages] = useState<AiConversationMessage[]>([])
  const [activeConversationId, setActiveConversationId] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const activeConversationRef = useRef<AiConversationSnapshot | null>(null)
  const saveQueueRef = useRef<Promise<void>>(Promise.resolve())
  const pendingSaveCountRef = useRef(0)
  const latestMessageSequenceRef = useRef(0)

  useEffect(() => {
    let active = true
    const messageSequenceAtLoad = latestMessageSequenceRef.current
    setLoading(true)
    setError(null)
    void window.sesAgent.listAiConversations(stableContext).then((items) => {
      if (!active) return
      const ordered = sortConversations(items)
      const latest = ordered[0] ?? null
      if (latestMessageSequenceRef.current === messageSequenceAtLoad) {
        setConversations(ordered)
        latestMessageSequenceRef.current += 1
        activeConversationRef.current = latest
        setActiveConversationId(latest?.id ?? null)
        setMessages(latest?.messages ?? [])
      } else {
        setConversations((current) => sortConversations([
          ...current,
          ...ordered.filter((item) => !current.some((existing) => existing.id === item.id))
        ]))
      }
    }).catch((cause: unknown) => {
      if (!active) return
      setError(cause instanceof Error ? cause.message : String(cause))
      if (latestMessageSequenceRef.current === messageSequenceAtLoad) {
        setConversations([])
        activeConversationRef.current = null
        setActiveConversationId(null)
        setMessages([])
      }
    }).finally(() => {
      if (active) setLoading(false)
    })
    return () => { active = false }
  }, [stableContext, reloadToken])

  const selectConversation = useCallback((conversationId: string) => {
    const selected = conversations.find((item) => item.id === conversationId) ?? null
    if (!selected) return
    latestMessageSequenceRef.current += 1
    activeConversationRef.current = selected
    setActiveConversationId(selected.id)
    setMessages(selected.messages)
  }, [conversations])

  const newConversation = useCallback(() => {
    latestMessageSequenceRef.current += 1
    activeConversationRef.current = null
    setActiveConversationId(null)
    setMessages([])
    setError(null)
  }, [])

  const persistMessages = useCallback(async (
    nextMessages: AiConversationMessage[],
    baseConversation?: AiConversationSnapshot | null,
    options: PersistMessagesOptions = {}
  ): Promise<AiConversationSnapshot> => {
    const boundedMessages = nextMessages.slice(-200)
    const messageSequence = latestMessageSequenceRef.current + 1
    latestMessageSequenceRef.current = messageSequence
    setMessages(boundedMessages)
    pendingSaveCountRef.current += 1
    setSaving(true)
    setError(null)
    const operation = saveQueueRef.current.then(async () => {
      const base = baseConversation === undefined ? activeConversationRef.current : baseConversation
      try {
        const saved = await window.sesAgent.saveAiConversation({
          conversationId: options.conversationId ?? base?.id ?? createConversationId(),
          context: stableContext,
          messages: boundedMessages,
          ...(options.salesAgentState ? { salesAgentState: options.salesAgentState } : {}),
          expectedRevision: base?.revision ?? null
        })
        activeConversationRef.current = saved
        setActiveConversationId(saved.id)
        if (messageSequence === latestMessageSequenceRef.current) setMessages(saved.messages)
        setConversations((current) => sortConversations([
          saved,
          ...current.filter((item) => item.id !== saved.id)
        ]))
        return saved
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : String(cause))
        throw cause
      } finally {
        pendingSaveCountRef.current -= 1
        setSaving(pendingSaveCountRef.current > 0)
      }
    })
    saveQueueRef.current = operation.then(() => undefined, () => undefined)
    return operation
  }, [stableContext])

  const persistSalesAgentState = useCallback(async (
    salesAgentState: AiConversationSalesAgentState
  ): Promise<AiConversationSnapshot | null> => {
    const base = activeConversationRef.current
    if (!base || base.context.assistant !== 'sales-agent' || base.messages.length === 0) return null
    return persistMessages(base.messages, undefined, {
      conversationId: base.id,
      salesAgentState
    })
  }, [persistMessages])

  const deleteConversations = useCallback(async (conversationIds: string[]) => {
    if (conversationIds.length === 0) return
    setError(null)
    try {
      const result = await window.sesAgent.deleteAiConversations({ conversationIds })
      const deleted = new Set(result.deletedConversationIds)
      const remaining = conversations.filter((item) => !deleted.has(item.id))
      if (activeConversationRef.current && deleted.has(activeConversationRef.current.id)) {
        const next = remaining[0] ?? null
        latestMessageSequenceRef.current += 1
        activeConversationRef.current = next
        setActiveConversationId(next?.id ?? null)
        setMessages(next?.messages ?? [])
      }
      setConversations(remaining)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
      throw cause
    }
  }, [conversations])

  const acceptConversation = useCallback((saved: AiConversationSnapshot) => {
    // A late initial-history read must never overwrite a conversation that the
    // Main process has just completed and returned to this renderer.
    latestMessageSequenceRef.current += 1
    activeConversationRef.current = saved
    setActiveConversationId(saved.id)
    setMessages(saved.messages)
    setConversations((current) => sortConversations([
      saved,
      ...current.filter((item) => item.id !== saved.id)
    ]))
  }, [])

  return {
    activeConversationId,
    conversations,
    deleteConversations,
    error,
    loading,
    messages,
    newConversation,
    persistMessages,
    persistSalesAgentState,
    saving,
    selectConversation,
    setMessages,
    acceptConversation
  }
}
