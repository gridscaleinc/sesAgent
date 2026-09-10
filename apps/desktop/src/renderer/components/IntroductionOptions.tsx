import { useUiLocale } from '../i18n'

function OptionTabs({ label, options, value, disabled, panelId, onChange }: {
  label: string; options: Array<{ id: string; label: string }>; value: string; disabled: boolean; panelId: string; onChange(value: string): void
}) {
  return <div className="hr-intro-option"><span>{label}</span><div className="hr-option-tabs" role="tablist" aria-label={label}>
    {options.map((option, index) => <button type="button" role="tab" key={option.id} aria-selected={value === option.id} aria-controls={panelId}
      disabled={disabled} tabIndex={value === option.id ? 0 : -1} onClick={() => onChange(option.id)}
      onKeyDown={(event) => {
        let next: number
        if (event.key === 'ArrowRight') next = (index + 1) % options.length
        else if (event.key === 'ArrowLeft') next = (index + options.length - 1) % options.length
        else if (event.key === 'Home') next = 0
        else if (event.key === 'End') next = options.length - 1
        else return
        event.preventDefault()
        onChange(options[next]!.id)
        event.currentTarget.parentElement?.querySelectorAll<HTMLButtonElement>('[role="tab"]')[next]?.focus()
      }}>{option.label}</button>)}
  </div></div>
}

export function IntroductionOptions({ templates, templateId, lang, disabled, panelId, onTemplateChange, onLanguageChange }: {
  templates: Array<{ id: string; label: string }>; templateId: string; lang: 'ja' | 'zh'; disabled: boolean; panelId: string
  onTemplateChange(value: string): void; onLanguageChange(value: 'ja' | 'zh'): void
}) {
  const zh = useUiLocale() === 'zh-CN'
  return <div className="hr-intro-controls">
    <OptionTabs label={zh ? '语言' : '言語'} options={[{ id: 'zh', label: zh ? '中文' : '中国語' }, { id: 'ja', label: zh ? '日文' : '日本語' }]}
      value={lang} disabled={disabled} panelId={panelId} onChange={(value) => onLanguageChange(value as 'ja' | 'zh')} />
    <OptionTabs label={zh ? '文案版本' : '文面の種類'} options={templates} value={templateId} disabled={disabled} panelId={panelId} onChange={onTemplateChange} />
  </div>
}
