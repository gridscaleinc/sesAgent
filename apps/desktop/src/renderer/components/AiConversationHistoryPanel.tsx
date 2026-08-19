import { useEffect, useState } from 'react'
import type { AiConversationSnapshot } from '@shared'
import { useUiLocale } from '../i18n'
import { Icon } from './Icon'

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
    month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit'
  })

  return (
    <section className="ai-conversation-history" aria-label={zh ? '历史会话' : '会話履歴'}>
      <div className="ai-conversation-history-toolbar">
        <div>
          <strong>{zh ? '历史会话' : '会話履歴'}</strong>
          <small>{zh ? '保存在本机加密数据库中' : '端末内の暗号化データベースに保存'}</small>
        </div>
        <button className="ai-conversation-new" disabled={busy} onClick={onNew} type="button">
          <Icon name="plus" size={14} />{zh ? '新建对话' : '新しい会話'}
        </button>
      </div>

      {error ? <p className="ai-conversation-history-error"><Icon name="alert" size={13} />{error}</p> : null}
      {loading ? <p className="ai-conversation-history-empty">{zh ? '正在读取历史会话…' : '会話履歴を読み込み中…'}</p> : null}
      {!loading && conversations.length === 0 ? (
        <div className="ai-conversation-history-empty">
          <Icon name="database" size={24} />
          <strong>{zh ? '还没有历史会话' : '会話履歴はまだありません'}</strong>
          <span>{zh ? '发送第一条消息后会自动保存。' : '最初のメッセージ送信後に自動保存されます。'}</span>
        </div>
      ) : null}

      <div className="ai-conversation-history-list">
        {conversations.map((conversation) => (
          <article className={conversation.id === activeConversationId ? 'is-active' : ''} key={conversation.id}>
            <label aria-label={zh ? `选择 ${conversation.title}` : `${conversation.title} を選択`}>
              <input
                checked={selectedIds.has(conversation.id)}
                disabled={busy}
                onChange={(event) => toggleSelection(conversation.id, event.target.checked)}
                type="checkbox"
              />
            </label>
            <button disabled={busy} onClick={() => onSelect(conversation.id)} type="button">
              <strong>{conversation.title}</strong>
              <span>
                {dateFormatter.format(new Date(conversation.updatedAt))}
                {' · '}
                {zh ? `${conversation.messages.length} 条消息` : `${conversation.messages.length}件のメッセージ`}
              </span>
            </button>
          </article>
        ))}
      </div>

      {selectedIds.size > 0 ? (
        <div className={deleteConfirmation ? 'ai-conversation-delete is-confirming' : 'ai-conversation-delete'}>
          <span>{zh ? `已选择 ${selectedIds.size} 个会话` : `${selectedIds.size}件を選択中`}</span>
          {deleteConfirmation ? (
            <button onClick={() => setDeleteConfirmation(false)} type="button">{zh ? '取消' : 'キャンセル'}</button>
          ) : null}
          <button disabled={busy || deleting} onClick={() => void deleteSelected()} type="button">
            {deleting
              ? (zh ? '删除中…' : '削除中…')
              : deleteConfirmation
                ? (zh ? '确认删除' : '削除を確定')
                : (zh ? '删除所选' : '選択項目を削除')}
          </button>
        </div>
      ) : null}
    </section>
  )
}
