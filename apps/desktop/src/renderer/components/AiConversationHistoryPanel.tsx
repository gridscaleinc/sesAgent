import { useEffect, useState } from 'react'
import type { AiConversationSnapshot } from '@shared'
import { localeText, useUiLocale, localizedMainText } from '../i18n'
import { Icon } from './Icon'

type TaskPresentation = {
  title: string
  state: 'active' | 'waiting' | 'done' | 'scheduled' | 'attention'
  stateLabel: string
}

function taskPresentation(conversation: AiConversationSnapshot, zh: boolean): TaskPresentation {
  const t = localeText(zh)
  const conversationTitle = localizedMainText(zh ? 'zh-CN' : 'ja-JP', conversation.title)

  const blocks = conversation.messages.flatMap((message) => message.blocks ?? [])
  const latestAccess = [...blocks].reverse().find((block) => block.type === 'system-access')
  const latestImport = [...blocks].reverse().find((block) => block.type === 'resume-import')
  const hasError = [...blocks].reverse().some((block) => block.type === 'error')
  const hasClarification = [...blocks].reverse().some((block) => block.type === 'clarification')
  const caseLabel = conversation.salesAgentState?.selectedJobCaseRef?.label
  const isInterviewSchedule = latestAccess?.type === 'system-access' && latestAccess.destination === 'interview-schedule'
  const interviewReceipt = isInterviewSchedule ? latestAccess.receipt : undefined
  const candidateLabel =
    interviewReceipt?.candidateLabel ?? (latestImport?.type === 'resume-import' ? latestImport.imported[0]?.label : undefined)

  const title = isInterviewSchedule
    ? `${caseLabel ?? candidateLabel ?? conversationTitle} · ${t('面试安排', '面談設定')}`
    : candidateLabel && caseLabel
      ? `${candidateLabel} · ${caseLabel}`
      : candidateLabel
        ? `${candidateLabel} · ${t('人员跟进', '要員対応')}`
        : caseLabel
          ? `${caseLabel} · ${t('案件任务', '案件タスク')}`
          : conversationTitle

  if (hasError) return { title, state: 'attention', stateLabel: t('需处理', '要対応') }
  if (hasClarification && !latestAccess) return { title, state: 'waiting', stateLabel: t('待补充', '追加入力') }
  if (isInterviewSchedule) return { title, state: 'scheduled', stateLabel: t('已登记', '登録済み') }
  if (latestAccess) return { title, state: 'done', stateLabel: t('已完成', '完了') }
  return { title, state: 'active', stateLabel: t('进行中', '進行中') }
}

interface AiConversationHistoryPanelProps {
  activeConversationId: string | null
  busy: boolean
  conversations: AiConversationSnapshot[]
  error: string | null
  loading: boolean
  onDelete(conversationIds: string[]): Promise<void>
  onNew(): void
  onSelect(conversationId: string): void
}

export function AiConversationHistoryPanel({
  activeConversationId,
  busy,
  conversations,
  error,
  loading,
  onDelete,
  onNew,
  onSelect
}: AiConversationHistoryPanelProps) {
  const locale = useUiLocale()
  const zh = locale === 'zh-CN'
  const t = localeText(zh)
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [deleteConfirmation, setDeleteConfirmation] = useState(false)
  const [deleting, setDeleting] = useState(false)

  useEffect(() => {
    const available = new Set(conversations.map((item) => item.id))
    setSelectedIds((current) => new Set([...current].filter((id) => available.has(id))))
    setDeleteConfirmation(false)
  }, [conversations])

  const toggleSelection = (conversationId: string, checked: boolean) => {
    setSelectedIds((current) => {
      const next = new Set(current)
      if (checked) next.add(conversationId)
      else next.delete(conversationId)
      return next
    })
    setDeleteConfirmation(false)
  }

  const deleteSelected = async () => {
    if (selectedIds.size === 0) return
    if (!deleteConfirmation) {
      setDeleteConfirmation(true)
      return
    }
    setDeleting(true)
    try {
      try {
        await onDelete([...selectedIds])
        setSelectedIds(new Set())
        setDeleteConfirmation(false)
      } catch {
        // The owning history hook exposes the localized persistence error.
      }
    } finally {
      setDeleting(false)
    }
  }

  const dateFormatter = new Intl.DateTimeFormat(locale, {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit'
  })

  return (
    <section className="ai-conversation-history" aria-label={t('会话', '会話')}>
      <div className="ai-conversation-history-toolbar">
        <div>
          <strong>{t('会话', '会話')}</strong>
          <small>{t('对话与业务上下文一起保存在本机', '会話と業務コンテキストを端末内に保存')}</small>
        </div>
        <button className="ai-conversation-new" disabled={busy} onClick={onNew} type="button">
          <Icon name="plus" size={14} />
          {t('新建会话', '新しい会話')}
        </button>
      </div>

      {error ? (
        <p className="ai-conversation-history-error">
          <Icon name="alert" size={13} />
          {error}
        </p>
      ) : null}
      {loading ? <p className="ai-conversation-history-empty">{t('正在读取会话…', '会話を読み込み中…')}</p> : null}
      {!loading && conversations.length === 0 ? (
        <div className="ai-conversation-history-empty">
          <Icon name="database" size={24} />
          <strong>{t('还没有会话', '会話はまだありません')}</strong>
          <span>{t('可以新建会话，或直接发送第一条消息。', '新しい会話を作成するか、そのままメッセージを送信できます。')}</span>
        </div>
      ) : null}

      <div className="ai-conversation-history-list">
        {conversations.map((conversation) => {
          const task = taskPresentation(conversation, zh)
          return (
            <article className={conversation.id === activeConversationId ? 'is-active' : ''} key={conversation.id}>
              <label aria-label={t(`选择 ${localizedMainText(locale, conversation.title)}`, `${conversation.title} を選択`)}>
                <input
                  checked={selectedIds.has(conversation.id)}
                  disabled={busy}
                  onChange={(event) => toggleSelection(conversation.id, event.target.checked)}
                  type="checkbox"
                />
              </label>
              <button disabled={busy} onClick={() => onSelect(conversation.id)} type="button">
                <span className="ai-conversation-task-title">
                  <strong>{task.title}</strong>
                  <small className={`is-${task.state}`}>{task.stateLabel}</small>
                </span>
                <span>
                  {dateFormatter.format(new Date(conversation.updatedAt))}
                  {' · '}
                  {t(`${conversation.messages.length} 条消息`, `${conversation.messages.length}件のメッセージ`)}
                </span>
              </button>
            </article>
          )
        })}
      </div>

      {selectedIds.size > 0 ? (
        <div className={deleteConfirmation ? 'ai-conversation-delete is-confirming' : 'ai-conversation-delete'}>
          <span>{t(`已选择 ${selectedIds.size} 个会话`, `${selectedIds.size}件を選択中`)}</span>
          {deleteConfirmation ? (
            <button onClick={() => setDeleteConfirmation(false)} type="button">
              {t('取消', 'キャンセル')}
            </button>
          ) : null}
          <button disabled={busy || deleting} onClick={() => void deleteSelected()} type="button">
            {deleting ? t('删除中…', '削除中…') : deleteConfirmation ? t('确认删除', '削除を確定') : t('删除所选', '選択項目を削除')}
          </button>
        </div>
      ) : null}
    </section>
  )
}
