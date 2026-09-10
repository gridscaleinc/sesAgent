import { useEffect, useRef, useState, type ReactNode } from 'react'
import { candidateWorkAuthorizationValues, type SaveBusinessFieldInput } from '@shared'
import { useUiLocale, useUiText } from '../i18n'
import './business-field.css'

// Keep unsaved edits in memory across pane navigation, never in plaintext browser storage.
const drafts = new Map<string, string>()
type BusinessFieldProps = Omit<SaveBusinessFieldInput, 'previousValue'> & { label: string; children?: ReactNode; disabled?: boolean }
export function BusinessField(props: BusinessFieldProps) {
  return <BusinessFieldEditor key={`${props.kind}:${props.id}:${props.projectId ?? ''}:${props.field}`} {...props} />
}
function BusinessFieldEditor({ kind, id, version, field, projectId, value, label, children, disabled = false }: Omit<SaveBusinessFieldInput, 'previousValue'> & { label: string; children?: ReactNode; disabled?: boolean }) {
  const zh = useUiLocale() === 'zh-CN'
  const t = useUiText()
  const key = `${kind}:${id}:${projectId ?? ''}:${field}`
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(() => drafts.get(key) ?? value ?? '')
  const [saved, setSaved] = useState({ value, version })
  const [state, setState] = useState<'idle' | 'saving' | 'saved' | 'failed'>('idle')
  const [error, setError] = useState('')
  const lock = useRef(false)
  const input = useRef<HTMLTextAreaElement>(null)
  const choices = field === 'work_authorization' ? candidateWorkAuthorizationValues.map((value) => ({ value, label: value })) : field === 'isOwnCompany' ? [{ value: 'true', label: '自社' }, { value: 'false', label: '非自社' }] : null
  useEffect(() => {
    if (!editing && !drafts.has(key)) { setDraft(value ?? ''); setSaved({ value, version }) }
  }, [value, version, key])
  useEffect(() => { if (editing) { input.current?.focus(); input.current?.select() } }, [editing])
  const save = async (replacement = draft) => {
    const next = replacement.trim() || null
    if (lock.current) return
    if (next === saved.value) { drafts.delete(key); setEditing(false); return }
    lock.current = true; setState('saving'); setError('')
    try {
      const result = await window.sesAgent.saveBusinessField({ kind, id, version: saved.version, field, projectId, value: next, previousValue: saved.value })
      drafts.delete(key); setSaved({ value: next, version: result.version }); setDraft(next ?? ''); setState('saved'); setEditing(false)
      window.dispatchEvent(new CustomEvent('ses-business-data-changed', { detail: { kind, id } }))
    } catch (cause) { setState('failed'); setError(cause instanceof Error ? cause.message : String(cause)) }
    finally { lock.current = false }
  }
  const cancel = () => { drafts.delete(key); setDraft(value ?? ''); setSaved({ value, version }); setEditing(false); setState('idle'); setError('') }
  if (disabled || !window.sesAgent.saveBusinessField) return <>{children ?? value ?? '—'}</>
  return <span className={`business-field is-${state}`} onClick={(event) => event.stopPropagation()} onKeyDown={(event) => event.stopPropagation()}>
    {editing && choices ? <select autoFocus onBlur={() => { if (!lock.current && state !== 'failed') setEditing(false) }} onKeyDown={(event) => { if (event.key === 'Escape') { event.preventDefault(); cancel() } }} aria-label={t(label)} value={draft} disabled={state === 'saving'} onChange={(event) => { setDraft(event.target.value); drafts.set(key, event.target.value); void save(event.target.value) }}><option value="">{zh ? '未设置' : '未設定'}</option>{choices.map((item) => <option key={item.value} value={item.value}>{t(item.label)}</option>)}</select> : editing ? <textarea ref={input} aria-label={t(label)} rows={Math.min(8, Math.max(2, draft.split('\n').length))} value={draft} disabled={state === 'saving'}
      onChange={(event) => { setDraft(event.target.value); drafts.set(key, event.target.value); setState('idle') }}
      onBlur={() => void save()} onKeyDown={(event) => {
        if (event.key === 'Escape') { event.preventDefault(); cancel() }
        if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) { event.preventDefault(); void save() }
      }} /> : <button className="business-field-value" type="button" aria-label={`${zh ? '编辑' : '編集'} ${t(label)}`} aria-description={saved.value ?? ''} onClick={() => { setSaved({ value, version }); setEditing(true) }}>
      {saved.value === value && children ? children : (choices?.find((item) => item.value === saved.value)?.label ?? saved.value) || (zh ? '待补充' : '未記入')}<span aria-hidden="true" className="business-field-pencil">✎</span>
    </button>}
    {state === 'saving' ? <small role="status">{zh ? '保存中' : '保存中'}</small> : state === 'saved' ? <small role="status">{zh ? '已保存' : '保存済み'}</small> : null}
    {error ? <small role="alert">{error}<button type="button" onMouseDown={(event) => event.preventDefault()} onClick={() => void save()}>{zh ? '重试保存' : '再保存'}</button></small> : null}
  </span>
}
