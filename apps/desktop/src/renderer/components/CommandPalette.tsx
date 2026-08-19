import { useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type MouseEvent } from 'react'
import { Icon, type IconName } from './Icon'
import { useRendererUiRefresh } from '../i18n'

export interface BusinessCommand {
  id: string
  group: '入力' | '作業' | 'データ' | '統制' | '最近の作業'
  label: string
  description: string
  keywords: string[]
  icon: IconName
  run(): void | Promise<void>
}

interface CommandPaletteProps {
  commands: BusinessCommand[]
  onClose(restoreFocus: boolean): void
}

const groupOrder: BusinessCommand['group'][] = ['入力', '作業', 'データ', '統制', '最近の作業']

export function CommandPalette({ commands, onClose }: CommandPaletteProps) {
  useRendererUiRefresh()
  const [query, setQuery] = useState('')
  const [selectedIndex, setSelectedIndex] = useState(0)
  const [busyCommandId, setBusyCommandId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement | null>(null)
  const dialogRef = useRef<HTMLElement | null>(null)
  const normalizedQuery = query.trim().toLocaleLowerCase('ja-JP')
  const filteredCommands = normalizedQuery
    ? commands.filter((command) => [command.label, command.description, ...command.keywords]
      .join('\u0000')
      .toLocaleLowerCase('ja-JP')
      .includes(normalizedQuery))
    : commands
  const effectiveIndex = filteredCommands.length === 0 ? 0 : Math.min(selectedIndex, filteredCommands.length - 1)
  const groupedCommands = groupOrder.flatMap((group) => {
    const items = filteredCommands
      .map((command, index) => ({ command, index }))
      .filter((item) => item.command.group === group)
    return items.length > 0 ? [{ group, items }] : []
  })

  useEffect(() => {
    const frame = requestAnimationFrame(() => inputRef.current?.focus())
    return () => cancelAnimationFrame(frame)
  }, [])

  const execute = async (command: BusinessCommand) => {
    if (busyCommandId) return
    setBusyCommandId(command.id)
    setError(null)
    try {
      await command.run()
      onClose(false)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'コマンドを実行できませんでした。')
      setBusyCommandId(null)
    }
  }

  const handleKeyDown = (event: ReactKeyboardEvent<HTMLElement>) => {
    if (event.key === 'Escape' && !busyCommandId) {
      event.preventDefault()
      onClose(true)
      return
    }
    if (event.key === 'ArrowDown' && filteredCommands.length > 0) {
      event.preventDefault()
      setSelectedIndex((current) => (current + 1) % filteredCommands.length)
      return
    }
    if (event.key === 'ArrowUp' && filteredCommands.length > 0) {
      event.preventDefault()
      setSelectedIndex((current) => (current - 1 + filteredCommands.length) % filteredCommands.length)
      return
    }
    if (event.key === 'Enter' && filteredCommands[effectiveIndex] && !busyCommandId) {
      event.preventDefault()
      void execute(filteredCommands[effectiveIndex])
      return
    }
    if (event.key !== 'Tab') return
    const focusable = [...(dialogRef.current?.querySelectorAll<HTMLElement>(
      'button:not(:disabled), input:not(:disabled), [tabindex]:not([tabindex="-1"])'
    ) ?? [])].filter((element) => element.offsetParent !== null)
    if (focusable.length === 0) return
    const first = focusable[0]
    const last = focusable.at(-1)!
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault()
      last.focus()
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault()
      first.focus()
    }
  }

  const dismissFromBackdrop = (event: MouseEvent<HTMLDivElement>) => {
    if (event.target === event.currentTarget && !busyCommandId) onClose(true)
  }

  return (
    <div className="command-palette-backdrop" onMouseDown={dismissFromBackdrop} role="presentation">
      <section
        aria-describedby="command-palette-description"
        aria-labelledby="command-palette-title"
        aria-modal="true"
        className="command-palette-dialog"
        onKeyDown={handleKeyDown}
        ref={dialogRef}
        role="dialog"
      >
        <header>
          <Icon name="search" size={19} />
          <div>
            <h2 id="command-palette-title">業務コマンド</h2>
            <p id="command-palette-description">許可済みの入力・確認・管理画面だけを開きます。</p>
          </div>
          <kbd>Esc</kbd>
        </header>
        <label className="command-palette-search">
          <Icon name="search" size={18} />
          <input
            aria-label="業務コマンドを検索"
            autoComplete="off"
            onChange={(event) => {
              setQuery(event.target.value)
              setSelectedIndex(0)
              setError(null)
            }}
            placeholder="例：案件、Gmail、候補者、バックアップ"
            ref={inputRef}
            value={query}
          />
          <span>{filteredCommands.length}件</span>
        </label>
        <div aria-label="業務コマンド候補" className="command-palette-results" role="listbox">
          {groupedCommands.map(({ group, items }) => (
            <section className="command-palette-group" key={group}>
              <h3>{group}</h3>
              {items.map(({ command, index }) => (
                <button
                  aria-selected={index === effectiveIndex}
                  className={index === effectiveIndex ? 'is-selected' : ''}
                  disabled={busyCommandId !== null}
                  key={command.id}
                  onClick={() => void execute(command)}
                  onMouseMove={() => setSelectedIndex(index)}
                  role="option"
                  type="button"
                >
                  <span className="command-palette-icon"><Icon name={command.icon} size={17} /></span>
                  <span><strong>{command.label}</strong><small>{command.description}</small></span>
                  {busyCommandId === command.id ? <span className="matching-spinner" /> : <Icon name="chevron-right" size={16} />}
                </button>
              ))}
            </section>
          ))}
          {filteredCommands.length === 0 ? (
            <div className="command-palette-empty"><Icon name="search" size={20} /><strong>一致する業務コマンドがありません</strong><p>入力内容は保存・送信されません。</p></div>
          ) : null}
        </div>
        {error ? <p className="command-palette-error" role="alert"><Icon name="alert" size={15} />{error}</p> : null}
        <footer>
          <span><kbd>↑</kbd><kbd>↓</kbd> 選択</span>
          <span><kbd>Enter</kbd> 実行</span>
          <span><Icon name="lock" size={13} />検索文字は端末内のみ・外部送信なし</span>
        </footer>
      </section>
    </div>
  )
}
