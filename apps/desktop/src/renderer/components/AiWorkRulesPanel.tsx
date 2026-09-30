import { useEffect, useRef, useState } from 'react'
import type { JobCaseReviewSnapshot, WorkRuleLibrary, WorkRulePreview, WorkRuleRecord, WorkRuleScope } from '@shared'
import { localizedIpcError, useUiLocale, localeText } from '../i18n'
import './ai-work-rules.css'

export const workRulesChangedEvent = 'ses-ai-work-rules-changed'
export function AiWorkRulesPanel({
  cases = [],
  jobCaseId,
  active = true
}: {
  cases?: JobCaseReviewSnapshot[]
  jobCaseId?: string
  active?: boolean
}) {
  const locale = useUiLocale()
  const zh = locale === 'zh-CN'
  const t = localeText(zh)
  const defaultCaseRef = cases.find((job) => job.jobCase?.id === jobCaseId)?.reviewId ?? jobCaseId
  const [library, setLibrary] = useState<WorkRuleLibrary | null>(null)
  const [text, setText] = useState('')
  const [scopeKind, setScopeKind] = useState<WorkRuleScope['kind']>(jobCaseId ? 'case' : 'global')
  const [scopeValue, setScopeValue] = useState(defaultCaseRef ?? '')
  const [editing, setEditing] = useState<WorkRuleRecord | null>(null)
  const [preview, setPreview] = useState<WorkRulePreview | null>(null)
  const [busy, setBusy] = useState(false)
  const lock = useRef(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [history, setHistory] = useState<WorkRuleRecord[]>([])
  const generation = useRef(0)
  useEffect(() => {
    if (!active) return
    let live = true
    if (!window.sesAgent.listWorkRules) return
    void window.sesAgent
      .listWorkRules()
      .then((value) => {
        if (live) {
          setLibrary(value)
          setError('')
        }
      })
      .catch((cause) => {
        if (live) setError(localizedIpcError(locale, cause, t('无法读取 AI 工作规则。', 'AIの作業ルールを読み込めませんでした。')))
      })
    return () => {
      live = false
    }
  }, [active])
  const scope: WorkRuleScope = scopeKind === 'global' ? { kind: 'global' } : { kind: scopeKind, value: scopeValue }
  const names = {
    required: t('必需条件', '必須条件'),
    preferred: t('优先考虑', '優先条件'),
    confirm: t('待确认', '確認事項'),
    interview: t('面试要求', '面談方針'),
    presentation: t('结果呈现', '表示方針')
  }
  const scopeLabel = (value: WorkRuleScope) =>
    value.kind === 'global'
      ? t('通用规则', '共通ルール')
      : value.kind === 'case'
        ? `${t('案件', '案件')}：${cases.find((job) => job.reviewId === value.value)?.fields.find((f) => f.key === 'title')?.value ?? t('指定案件', '指定案件')}`
        : `${value.kind === 'customer' ? t('客户关键词', '顧客キーワード') : t('案件关键词', '案件キーワード')}：${value.value}`
  const invalidate = () => {
    generation.current++
    setPreview(null)
    setNotice('')
  }
  const operation = async (action: () => Promise<void>) => {
    if (lock.current) return
    lock.current = true
    setBusy(true)
    setError('')
    setNotice('')
    try {
      await action()
    } catch (cause) {
      setError(localizedIpcError(locale, cause, t('操作失败，请重试。', '操作に失敗しました。もう一度お試しください。')))
    } finally {
      lock.current = false
      setBusy(false)
    }
  }
  const reload = async () => {
    window.dispatchEvent(new Event(workRulesChangedEvent))
    setLibrary(await window.sesAgent.listWorkRules())
  }
  const analyze = () =>
    operation(async () => {
      const revision = generation.current
      const result = await window.sesAgent.analyzeWorkRule({ text, scope })
      if (revision === generation.current) setPreview(result)
    })
  const save = () =>
    operation(async () => {
      if (!preview) return
      await window.sesAgent.saveWorkRule({ token: preview.token, id: editing?.id, expectedRevision: editing?.revision ?? 0 })
      setEditing(null)
      setPreview(null)
      setText('')
      setHistory([])
      await reload()
      setNotice(t('已保存并应用。新的匹配和面试问题将使用此规则。', '保存しました。次回のマッチングと面談質問に適用されます。'))
    })
  const edit = (rule: WorkRuleRecord) => {
    invalidate()
    setEditing(rule)
    setText(rule.text)
    setScopeKind(rule.scope.kind)
    setScopeValue(rule.scope.kind === 'global' ? '' : rule.scope.value)
    setHistory([])
  }
  const visibleRules =
    library?.rules.filter((rule) => !jobCaseId || rule.scope.kind !== 'case' || rule.scope.value === defaultCaseRef) ?? []
  return (
    <section className="ai-work-rules" aria-label={t('AI 工作规则', 'AI業務ルール')}>
      <header>
        <h3>{t('AI 工作规则', 'AI業務ルール')}</h3>
        <p>
          {t(
            '用自然语言告诉 AI：怎样匹配、优先考虑什么、面试要确认什么。',
            'マッチングの条件、優先する経験、面談で確認したいことを自然な言葉で伝えます。'
          )}
        </p>
      </header>
      {error ? (
        <p role="alert">
          {error}{' '}
          <button type="button" disabled={busy} onClick={() => void operation(reload)}>
            {t('重新加载', '再読み込み')}
          </button>
        </p>
      ) : null}
      {notice ? <p role="status">{notice}</p> : null}
      <div className="work-rule-editor">
        <label>
          {t('适用范围', '適用範囲')}
          <select
            disabled={busy}
            value={scopeKind}
            onChange={(e) => {
              invalidate()
              setScopeKind(e.target.value as WorkRuleScope['kind'])
              setScopeValue(defaultCaseRef ?? '')
            }}
          >
            <option value="global">{t('通用规则', '共通ルール')}</option>
            <option value="case">{t('指定案件', '指定案件')}</option>
            <option value="category">{t('案件包含关键词', '案件に含まれるキーワード')}</option>
            <option value="customer">{t('案件资料中的客户关键词', '案件情報内の顧客キーワード')}</option>
          </select>
        </label>
        {scopeKind === 'case' ? (
          <label>
            {t('选择案件', '案件を選択')}
            <select
              value={scopeValue}
              disabled={busy}
              onChange={(e) => {
                invalidate()
                setScopeValue(e.target.value)
              }}
            >
              <option value="">{t('请选择案件', '案件を選んでください')}</option>
              {cases
                .filter((job) => job.jobCase && job.lifecycle === 'active')
                .map((job) => (
                  <option key={job.reviewId} value={job.reviewId}>
                    {job.fields.find((f) => f.key === 'title')?.value ?? job.redactedSubject}
                  </option>
                ))}
            </select>
          </label>
        ) : null}
        {scopeKind === 'category' || scopeKind === 'customer' ? (
          <label>
            {t('关键词（按案件资料匹配）', 'キーワード（案件情報と照合）')}
            <input
              maxLength={120}
              value={scopeValue}
              disabled={busy}
              onChange={(e) => {
                invalidate()
                setScopeValue(e.target.value)
              }}
            />
          </label>
        ) : null}
        <label>
          {editing ? t('修改规则', 'ルールを編集') : t('用一句话教系统', '言葉でルールを伝える')}
          <textarea
            rows={5}
            maxLength={6000}
            disabled={busy}
            value={text}
            onChange={(e) => {
              invalidate()
              setText(e.target.value)
            }}
            placeholder={t(
              '例如：Java 案件优先考虑独立做过基本设计的人；职责不明确时列为待确认，面试重点问本人交付的设计文档。',
              '例：Java案件は基本設計を独力で担当した人を優先。担当範囲が不明なら確認事項にし、面談で本人が作成した設計書を確認する。'
            )}
          />
        </label>
        <div className="work-rule-actions">
          <button
            type="button"
            disabled={busy || !library || text.trim().length < 2 || (scopeKind !== 'global' && !scopeValue.trim())}
            onClick={() => void analyze()}
          >
            {busy ? t('处理中…', '処理中…') : t('AI 整理规则', 'AIでルールを整理')}
          </button>
          {editing ? (
            <button
              type="button"
              disabled={busy}
              onClick={() => {
                invalidate()
                setEditing(null)
                setText('')
              }}
            >
              {t('取消修改', '編集を取消')}
            </button>
          ) : null}
        </div>
        {preview ? (
          <div className="work-rule-preview" aria-label={t('系统理解', 'AIの解釈')}>
            <strong>{t('系统理解', 'AIの解釈')}</strong> · {scopeLabel(preview.scope)}
            {preview.clauses.map((clause, i) => (
              <article key={i}>
                <span>{names[clause.kind]}</span>
                <p>{clause.text}</p>
                {clause.caseKeywords.length ? (
                  <small>
                    {t('仅用于包含以下全部关键词的案件', '次の全キーワードを含む案件のみ')}：{clause.caseKeywords.join('、')}
                  </small>
                ) : null}
                <details>
                  <summary>{t('原文依据', '原文の根拠')}</summary>
                  <p>{clause.sourceQuote}</p>
                </details>
              </article>
            ))}
            {preview.issues.length ? (
              <div role="status">
                <strong>{t('以下内容尚未加入规则', '次の内容はルールに含まれていません')}</strong>
                <ul>
                  {preview.issues.map((issue, i) => (
                    <li key={i}>{issue}</li>
                  ))}
                </ul>
              </div>
            ) : null}
            <button type="button" className="is-primary" disabled={busy || !preview.clauses.length} onClick={() => void save()}>
              {preview.issues.length ? t('保存并应用可用规则', '有効なルールを保存・適用') : t('保存并应用', '保存して適用')}
            </button>
          </div>
        ) : null}
      </div>
      <h4>
        {t('已保存的规则', '保存済みルール')} ({visibleRules.length})
      </h4>
      {!library && !error ? <p role="status">{t('正在加载…', '読み込み中…')}</p> : null}
      {visibleRules.map((rule) => (
        <article className="work-rule-card" key={rule.id}>
          <header>
            <strong>{scopeLabel(rule.scope)}</strong>
            <span>
              v{rule.revision} · {rule.enabled ? t('已启用', '有効') : t('已停用', '無効')}
            </span>
          </header>
          <p>{rule.text}</p>
          <ul>
            {rule.clauses.map((clause, i) => (
              <li key={i}>
                {names[clause.kind]}：{clause.text}
              </li>
            ))}
          </ul>
          <div className="work-rule-actions">
            <button disabled={busy} onClick={() => edit(rule)}>
              {t('修改', '編集')}
            </button>
            <button
              disabled={busy}
              onClick={() =>
                void operation(async () => {
                  await window.sesAgent.changeWorkRule({ id: rule.id, expectedRevision: rule.revision, enabled: !rule.enabled })
                  await reload()
                })
              }
            >
              {rule.enabled ? t('停用', '無効にする') : t('启用', '有効にする')}
            </button>
            <button
              disabled={busy}
              onClick={() => void operation(async () => setHistory(await window.sesAgent.getWorkRuleHistory(rule.id)))}
            >
              {t('版本记录', '変更履歴')}
            </button>
          </div>
          {history[0]?.id === rule.id ? (
            <ol className="work-rule-history">
              {history.map((version) => (
                <li key={version.revision}>
                  <span>
                    v{version.revision} · {new Date(version.updatedAt).toLocaleString()} ·{' '}
                    {version.enabled ? t('启用', '有効') : t('停用', '無効')}
                  </span>
                  <p>{version.text}</p>
                  {version.revision !== rule.revision ? (
                    <button
                      disabled={busy}
                      onClick={() =>
                        void operation(async () => {
                          await window.sesAgent.changeWorkRule({
                            id: rule.id,
                            expectedRevision: rule.revision,
                            restoreRevision: version.revision
                          })
                          await reload()
                          setHistory(await window.sesAgent.getWorkRuleHistory(rule.id))
                        })
                      }
                    >
                      {t('恢复此版本', 'この版を復元')}
                    </button>
                  ) : null}
                </li>
              ))}
            </ol>
          ) : null}
        </article>
      ))}
      {library && !visibleRules.length ? (
        <p>{t('还没有规则，可以从一次具体的匹配经验开始。', 'ルールはまだありません。具体的なマッチング経験から始められます。')}</p>
      ) : null}
    </section>
  )
}
