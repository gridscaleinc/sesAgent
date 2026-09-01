import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  broadcastPreviewSample,
  broadcastTemplateFieldKeys,
  generateBroadcastText,
  jobCaseFieldCanonicalLabels,
  type BroadcastLanguage,
  type BroadcastRatePolicy,
  type BroadcastTemplate,
  type BroadcastTemplateDraft,
  type BroadcastTemplateFieldKey,
  type BroadcastTemplateLine,
  type BroadcastWorkspace,
  type CreateBroadcastTemplateInput,
  type DeleteBroadcastTemplateInput,
  type UpdateBroadcastTemplateInput
} from '@shared'
import { useUiLocale } from '../i18n'
import { Icon } from './Icon'

/** Everything the 配信 settings area needs from the main process. */
export interface BroadcastSettingsActions {
  loadWorkspace(): Promise<BroadcastWorkspace>
  createTemplate(input: CreateBroadcastTemplateInput): Promise<BroadcastTemplate[]>
  updateTemplate(input: UpdateBroadcastTemplateInput): Promise<BroadcastTemplate[]>
  deleteTemplate(input: DeleteBroadcastTemplateInput): Promise<BroadcastTemplate[]>
}

function draftOf(template: BroadcastTemplate): BroadcastTemplateDraft {
  const { id: _id, revision: _revision, createdAt: _createdAt, updatedAt: _updatedAt, ...draft } = template
  return { ...draft, lines: draft.lines.map((line) => ({ ...line })) }
}

/** A template draft rendered through the real generator, on a fabricated case. */
function previewOf(draft: BroadcastTemplateDraft, lang: BroadcastLanguage): string {
  const sample = broadcastPreviewSample()
  const template: BroadcastTemplate = { ...draft, id: 'preview', revision: 1, createdAt: '', updatedAt: '' }
  return generateBroadcastText(sample.fields, sample.title, template, lang)
}

function moved<T>(items: T[], index: number, delta: number): T[] {
  const target = index + delta
  if (target < 0 || target >= items.length) return items
  const next = [...items]
  const [line] = next.splice(index, 1)
  next.splice(target, 0, line)
  return next
}

export function BroadcastSettingsSection({ actions }: { actions: BroadcastSettingsActions }) {
  const zh = useUiLocale() === 'zh-CN'
  const [templates, setTemplates] = useState<BroadcastTemplate[]>([])
  const [activeTemplateId, setActiveTemplateId] = useState<string | null>(null)
  const [draft, setDraft] = useState<BroadcastTemplateDraft | null>(null)
  const [editLang, setEditLang] = useState<BroadcastLanguage>('ja')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState<string | null>(null)

  const apply = useCallback((nextTemplates: BroadcastTemplate[]) => {
    setTemplates(nextTemplates)
    setActiveTemplateId((current) => {
      const keep = current && nextTemplates.some((template) => template.id === current) ? current : nextTemplates[0]?.id ?? null
      setDraft(nextTemplates.find((template) => template.id === keep) ? draftOf(nextTemplates.find((template) => template.id === keep)!) : null)
      return keep
    })
  }, [])

  useEffect(() => {
    let active = true
    void actions.loadWorkspace()
      .then((workspace) => { if (active) apply(workspace.templates) })
      .catch((cause: unknown) => { if (active) setError(cause instanceof Error ? cause.message : String(cause)) })
    return () => { active = false }
  }, [actions, apply])

  const run = async (id: string, operation: () => Promise<void>) => {
    if (busy) return
    setBusy(true)
    setError(null)
    setSaved(null)
    try {
      await operation()
      setSaved(id)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setBusy(false)
    }
  }

  const selectTemplate = (id: string) => {
    const template = templates.find((item) => item.id === id)
    if (!template) return
    setActiveTemplateId(id)
    setDraft(draftOf(template))
    setSaved(null)
  }

  const editLine = (index: number, patch: Partial<BroadcastTemplateLine>) => {
    setDraft((current) => current
      ? { ...current, lines: current.lines.map((line, position) => (position === index ? { ...line, ...patch } as BroadcastTemplateLine : line)) }
      : current)
  }

  const preview = useMemo(() => (draft ? previewOf(draft, editLang) : ''), [draft, editLang])
  const stored = templates.find((template) => template.id === activeTemplateId) ?? null

  return <div className="broadcast-settings">
    <section>
      <h4>{zh ? '文案模板' : '紹介文テンプレート'}</h4>
      <div className="broadcast-template-switch" role="group">
        {templates.map((template) => <button
          className={template.id === activeTemplateId ? 'is-active' : ''}
          key={template.id}
          onClick={() => selectTemplate(template.id)}
          type="button"
        >{template.name}{template.id === templates[0]?.id ? <em>{zh ? '默认' : '既定'}</em> : null}</button>)}
        <button
          disabled={busy}
          onClick={() => void run('template-add', async () => {
            const base = draft ?? (templates[0] ? draftOf(templates[0]) : null)
            if (!base) return
            apply(await actions.createTemplate({ ...base, name: `${base.name} ${zh ? '副本' : '複製'}` }))
          })}
          type="button"
        ><Icon name="plus" size={13} />{zh ? '复制模板' : 'テンプレートを複製'}</button>
        <button
          disabled={busy || templates.length <= 1 || !activeTemplateId}
          onClick={() => void run('template-delete', async () => {
            if (!activeTemplateId) return
            apply(await actions.deleteTemplate({ id: activeTemplateId }))
          })}
          type="button"
        >{zh ? '删除模板' : 'テンプレートを削除'}</button>
      </div>

      {draft ? <div className="broadcast-template-editor">
        <label className="broadcast-field">
          <span>{zh ? '模板名称' : 'テンプレート名'}</span>
          <input
            aria-label={zh ? '模板名称' : 'テンプレート名'}
            onChange={(event) => setDraft({ ...draft, name: event.target.value })}
            value={draft.name}
          />
        </label>

        <div className="broadcast-lang-tabs" role="group">
          <button className={editLang === 'ja' ? 'is-active' : ''} onClick={() => setEditLang('ja')} type="button">{zh ? '日文版' : '日本語版'}</button>
          <button className={editLang === 'zh' ? 'is-active' : ''} onClick={() => setEditLang('zh')} type="button">{zh ? '中文版' : '中国語版'}</button>
        </div>

        <label className="broadcast-field">
          <span>{zh ? '开头' : 'ヘッダー'}</span>
          <input
            aria-label={zh ? '开头' : 'ヘッダー'}
            onChange={(event) => setDraft(editLang === 'ja' ? { ...draft, headerJa: event.target.value } : { ...draft, headerZh: event.target.value })}
            value={editLang === 'ja' ? draft.headerJa : draft.headerZh}
          />
        </label>

        <ul className="broadcast-line-editor">
          {draft.lines.map((line, index) => <li key={`${line.kind}-${index}`}>
            <input
              aria-label={zh ? '显示该行' : 'この行を表示'}
              checked={line.on}
              onChange={(event) => editLine(index, { on: event.target.checked })}
              type="checkbox"
            />
            {line.kind === 'field' ? <>
              <select
                aria-label={zh ? '案件字段' : '案件項目'}
                onChange={(event) => editLine(index, { field: event.target.value as BroadcastTemplateFieldKey })}
                value={line.field}
              >
                {broadcastTemplateFieldKeys.map((key) => <option key={key} value={key}>{jobCaseFieldCanonicalLabels[key]}</option>)}
              </select>
              <input
                aria-label={zh ? '行标签' : '行ラベル'}
                onChange={(event) => editLine(index, editLang === 'ja' ? { labelJa: event.target.value } : { labelZh: event.target.value })}
                value={editLang === 'ja' ? line.labelJa : line.labelZh}
              />
            </> : <input
              aria-label={zh ? '固定文本' : '固定文'}
              className="broadcast-line-text"
              onChange={(event) => editLine(index, editLang === 'ja' ? { textJa: event.target.value } : { textZh: event.target.value })}
              value={editLang === 'ja' ? line.textJa : line.textZh}
            />}
            <button aria-label={zh ? '上移' : '上へ'} onClick={() => setDraft({ ...draft, lines: moved(draft.lines, index, -1) })} type="button">↑</button>
            <button aria-label={zh ? '下移' : '下へ'} onClick={() => setDraft({ ...draft, lines: moved(draft.lines, index, 1) })} type="button">↓</button>
            <button aria-label={zh ? '删除该行' : 'この行を削除'} onClick={() => setDraft({ ...draft, lines: draft.lines.filter((_, position) => position !== index) })} type="button">×</button>
          </li>)}
        </ul>

        <div className="broadcast-line-add">
          <button
            onClick={() => setDraft({
              ...draft,
              lines: [...draft.lines, { kind: 'field', field: broadcastTemplateFieldKeys[0], labelJa: jobCaseFieldCanonicalLabels[broadcastTemplateFieldKeys[0]], labelZh: jobCaseFieldCanonicalLabels[broadcastTemplateFieldKeys[0]], on: true }]
            })}
            type="button"
          ><Icon name="plus" size={13} />{zh ? '添加字段行' : '項目行を追加'}</button>
          <button
            onClick={() => setDraft({ ...draft, lines: [...draft.lines, { kind: 'text', textJa: '', textZh: '', on: true }] })}
            type="button"
          ><Icon name="plus" size={13} />{zh ? '添加固定文本行' : '固定文の行を追加'}</button>
        </div>

        <label className="broadcast-field">
          <span>{zh ? '结尾' : 'フッター'}</span>
          <input
            aria-label={zh ? '结尾' : 'フッター'}
            onChange={(event) => setDraft(editLang === 'ja' ? { ...draft, footerJa: event.target.value } : { ...draft, footerZh: event.target.value })}
            value={editLang === 'ja' ? draft.footerJa : draft.footerZh}
          />
        </label>

        <fieldset className="broadcast-rate-policy">
          <legend>{zh ? '单价公开口径' : '単価の公開口径'}</legend>
          {([
            ['raw', zh ? '原样' : '原値のまま'],
            ['cap', zh ? '只写上限' : '上限だけ'],
            ['negotiable', zh ? '面议' : '応相談']
          ] as Array<[BroadcastRatePolicy, string]>).map(([policy, label]) => <label key={policy}>
            <input
              checked={draft.ratePublic === policy}
              name="broadcast-rate-policy"
              onChange={() => setDraft({ ...draft, ratePublic: policy })}
              type="radio"
            />
            <span>{label}</span>
          </label>)}
        </fieldset>

        <div className="broadcast-preview">
          <strong>{zh ? '预览' : 'プレビュー'}</strong>
          <pre>{preview}</pre>
        </div>

        <div className="broadcast-settings-actions">
          <button
            className="is-primary"
            disabled={busy || !activeTemplateId}
            onClick={() => void run('template-save', async () => {
              if (!activeTemplateId) return
              apply(stored
                ? await actions.updateTemplate({ id: activeTemplateId, ...draft })
                : await actions.createTemplate(draft))
            })}
            type="button"
          >{busy ? (zh ? '保存中…' : '保存中…') : (zh ? '保存模板' : 'テンプレートを保存')}</button>
          {saved?.startsWith('template') ? <small>{zh ? '已保存' : '保存しました'}</small> : null}
        </div>
      </div> : null}
    </section>

    {error ? <p className="settings-inline-error" role="alert">{error}</p> : null}
  </div>
}
