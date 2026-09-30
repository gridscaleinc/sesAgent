import { useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type MouseEvent } from 'react'
import { Icon, type IconName } from './Icon'
import { localizedIpcError, useLocaleText } from '../i18n'
import type { ApplicationLocale } from '@shared'

/** Palette copy, written in both languages at the call site. */
export type CommandText = { zh: string; ja: string }

// i18n-ignore: group keys are identifiers; shown through groupLabels
export type BusinessCommandGroup = '業務' | '入力' | '作業' | 'データ' | '統制' | '対象' | '最近の作業'

export interface BusinessCommand {
  id: string
  group: BusinessCommandGroup
  label: CommandText
  description: CommandText
  keywords: string[]
  icon: IconName
  /** Listed only once something is typed, e.g. one entry per case or person for object search. */
  searchOnly?: boolean
  run(): void | Promise<void>
}

interface CommandPaletteProps {
  commands: BusinessCommand[]
  onClose(restoreFocus: boolean): void
}

// i18n-ignore: group keys are identifiers
const groupOrder: BusinessCommandGroup[] = ['業務', '対象', '入力', '作業', 'データ', '統制', '最近の作業']

const groupLabels: Record<BusinessCommandGroup, { zh: string; ja: string }> = {
  // i18n-ignore: group keys are identifiers
  業務: { zh: '业务', ja: '業務' },
  対象: { zh: '案件与人员', ja: '案件・要員' },
  入力: { zh: '导入', ja: '入力' },
  作業: { zh: '工作', ja: '作業' },
  // i18n-ignore: group key is an identifier
  データ: { zh: '数据', ja: 'データ' },
  統制: { zh: '管理', ja: '統制' },
  // i18n-ignore: group key is an identifier
  最近の作業: { zh: '最近的工作', ja: '最近の作業' }
}

export function commandText(locale: ApplicationLocale, text: CommandText): string {
  return locale === 'zh-CN' ? text.zh : text.ja
}

/** Every wording a person might type: the shown text plus the other language, so either works. */
function searchableText(text: CommandText): string[] {
  return [text.zh, text.ja]
}

export function CommandPalette({ commands, onClose }: CommandPaletteProps) {
  const { locale, zh, t } = useLocaleText()
  const [query, setQuery] = useState('')
  const [selectedIndex, setSelectedIndex] = useState(0)
  const [busyCommandId, setBusyCommandId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement | null>(null)
  const dialogRef = useRef<HTMLElement | null>(null)
  const normalizedQuery = query.trim().toLocaleLowerCase('ja-JP')
  // Keyboard order follows the grouped display order.
  const filteredCommands = (
    normalizedQuery
      ? commands.filter((command) =>
          [
            ...searchableText(command.label),
            // An object entry matches on its own name, not on the shared "open in list" wording.
            ...(command.searchOnly ? [] : searchableText(command.description)),
            ...command.keywords
          ]
            .join('\u0000')
            .toLocaleLowerCase('ja-JP')
            .includes(normalizedQuery)
        )
      : commands.filter((command) => !command.searchOnly)
  ).sort((a, b) => groupOrder.indexOf(a.group) - groupOrder.indexOf(b.group))
  const effectiveIndex = filteredCommands.length === 0 ? 0 : Math.min(selectedIndex, filteredCommands.length - 1)
  const groupedCommands = groupOrder.flatMap((group) => {
    const items = filteredCommands.map((command, index) => ({ command, index })).filter((item) => item.command.group === group)
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
      setError(localizedIpcError(locale, cause, t('无法执行命令。', 'コマンドを実行できませんでした。')))
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
    const focusable = [
      ...(dialogRef.current?.querySelectorAll<HTMLElement>(
        'button:not(:disabled), input:not(:disabled), [tabindex]:not([tabindex="-1"])'
      ) ?? [])
    ].filter((element) => element.offsetParent !== null)
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
            <h2 id="command-palette-title">{t('业务命令', '業務コマンド')}</h2>
            <p id="command-palette-description">
              {t('只打开已授权的导入、确认和管理页面。', '許可済みの入力・確認・管理画面だけを開きます。')}
            </p>
          </div>
          <kbd>Esc</kbd>
        </header>
        <label className="command-palette-search">
          <Icon name="search" size={18} />
          <input
            aria-label={t('搜索业务命令', '業務コマンドを検索')}
            autoComplete="off"
            onChange={(event) => {
              setQuery(event.target.value)
              setSelectedIndex(0)
              setError(null)
            }}
            placeholder={t('例如：案件、Gmail、人员、备份', '例：案件、Gmail、要員、バックアップ')}
            ref={inputRef}
            value={query}
          />
          <span>{t(`${filteredCommands.length} 项`, `${filteredCommands.length}件`)}</span>
        </label>
        <div aria-label={t('业务命令候选项', '業務コマンド候補')} className="command-palette-results" role="listbox">
          {groupedCommands.map(({ group, items }) => (
            <section className="command-palette-group" key={group}>
              <h3>{zh ? groupLabels[group].zh : groupLabels[group].ja}</h3>
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
                  <span className="command-palette-icon">
                    <Icon name={command.icon} size={17} />
                  </span>
                  <span>
                    <strong>{commandText(locale, command.label)}</strong>
                    <small>{commandText(locale, command.description)}</small>
                  </span>
                  {busyCommandId === command.id ? <span className="matching-spinner" /> : <Icon name="chevron-right" size={16} />}
                </button>
              ))}
            </section>
          ))}
          {filteredCommands.length === 0 ? (
            <div className="command-palette-empty">
              <Icon name="search" size={20} />
              <strong>{t('没有匹配的业务命令', '一致する業務コマンドがありません')}</strong>
              <p>{t('输入内容不会被保存或发送。', '入力内容は保存・送信されません。')}</p>
            </div>
          ) : null}
        </div>
        {error ? (
          <p className="command-palette-error" role="alert">
            <Icon name="alert" size={15} />
            {error}
          </p>
        ) : null}
        <footer>
          <span>
            <kbd>↑</kbd>
            <kbd>↓</kbd> {t('选择', '選択')}
          </span>
          <span>
            <kbd>Enter</kbd> {t('执行', '実行')}
          </span>
          <span>
            <Icon name="lock" size={13} />
            {t('搜索内容仅保留在本机，不会外发', '検索文字は端末内のみ・外部送信なし')}
          </span>
        </footer>
      </section>
    </div>
  )
}
