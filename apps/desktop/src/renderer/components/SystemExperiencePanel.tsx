import { CustomerIdentitiesPanel } from './CustomerIdentitiesPanel'
import { QuestionBankPanel } from './QuestionBankPanel'
import { ExperienceTrends } from './ExperienceTrends'
import { useEffect, useRef, useState } from 'react'
import { experienceMethods, type DesktopApi, type ExperienceControl, type SystemExperience, type SystemExperienceSnapshot } from '@shared'
import { localizedIpcError, useUiLocale, localeText } from '../i18n'
import './ai-work-rules.css'

type Details = Awaited<ReturnType<DesktopApi['getSystemExperienceDetails']>>
export function SystemExperiencePanel({ active = true }: { active?: boolean }) {
  const locale = useUiLocale()
  const zh = locale === 'zh-CN'
  const t = localeText(zh)
  const [snapshot, setSnapshot] = useState<SystemExperienceSnapshot | null>(null)
  const [scopeFilter, setScopeFilter] = useState('all')
  const [details, setDetails] = useState<Details | null>(null)
  const [budget, setBudget] = useState('16'),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false)
  const lock = useRef(false)
  const refresh = async () => {
    const value = await window.sesAgent.getSystemExperience()
    setSnapshot(value)
    setBudget(String(value.settings.dailyCallLimit))
  }
  useEffect(() => {
    if (!active || !window.sesAgent.getSystemExperience) return
    let live = true
    void window.sesAgent
      .getSystemExperience()
      .then((value) => {
        if (live) {
          setSnapshot(value)
          setBudget(String(value.settings.dailyCallLimit))
          setError('')
        }
      })
      .catch((cause) => {
        if (live) setError(localizedIpcError(locale, cause, t('无法读取系统经验。', 'システムの経験を読み込めませんでした。')))
      })
    return () => {
      live = false
    }
  }, [active])
  const operation = async (work: () => Promise<void>) => {
    if (lock.current) return
    lock.current = true
    setBusy(true)
    setError('')
    try {
      await work()
    } catch (cause) {
      setError(localizedIpcError(locale, cause, t('操作失败，请重试。', '操作に失敗しました。もう一度お試しください。')))
    } finally {
      lock.current = false
      setBusy(false)
    }
  }
  const control = (input: ExperienceControl) =>
    operation(async () => {
      setSnapshot(await window.sesAgent.controlSystemExperience(input))
      if ('id' in input && details?.history[0]?.id === input.id) setDetails(await window.sesAgent.getSystemExperienceDetails(input.id))
    })
  const names: Record<SystemExperience['state'], string> = {
    validating: t('验证中', '検証中'),
    trial: t('观察效果中', '効果を確認中'),
    active: t('使用中', '利用中'),
    rejected: t('保留原有方法', '現行手順を維持'),
    paused: t('已停用', '無効'),
    withdrawn: t('已撤回', '撤回済み')
  }
  const date = (value: string) => new Date(value).toLocaleString(zh ? 'zh-CN' : 'ja-JP')
  return (
    <section className="ai-work-rules system-experience" aria-label={t('系统经验', 'システムの経験')}>
      <header>
        <h3>{t('系统经验', 'システムの経験')}</h3>
        <p>
          {t(
            '系统从日常判断、面试记录和后续反馈中整理核实方法，验证后用于相似案件。无需填写提示词。',
            '日々の判断・面談記録・フィードバックから確認方法を整理し、検証後に似た案件で活用します。プロンプトの入力は不要です。'
          )}
        </p>
      </header>
      {error ? <p role="alert">{error}</p> : null}
      <div className="work-rule-actions">
        <button disabled={busy} onClick={() => void operation(refresh)}>
          {t('刷新', '更新')}
        </button>
      </div>
      {!snapshot && !error ? <p role="status">{t('正在加载…', '読み込み中…')}</p> : null}
      {snapshot ? (
        <>
          <article className="work-rule-card">
            <header>
              <strong>{t('后台学习', 'バックグラウンド学習')}</strong>
              <span>{snapshot.settings.enabled ? t('已开启', '有効') : t('已暂停', '一時停止')}</span>
            </header>
            <p>
              {t(
                '仅在应用打开且空闲时整理，开始工作后会让出资源。暂停学习后，已有经验仍可单独管理。',
                'アプリ起動中の待機時に整理し、操作を再開すると中断します。学習停止後も既存の経験は個別に管理できます。'
              )}
            </p>
            <button
              disabled={busy}
              onClick={() =>
                void control({ action: 'learning', enabled: !snapshot.settings.enabled, expectedRevision: snapshot.settings.revision })
              }
            >
              {snapshot.settings.enabled ? t('暂停学习', '学習を一時停止') : t('恢复学习', '学習を再開')}
            </button>
            <p>
              {t('今日学习调用', '本日の学習呼び出し')} {snapshot.settings.callsToday}/{snapshot.settings.dailyCallLimit} ·{' '}
              {t('待整理记录', '整理待ちの記録')} {snapshot.pendingCount}
            </p>
            {snapshot.settings.lastError ? (
              <p role="status">{snapshot.settings.lastError.split(' / ')[zh ? 0 : 1] ?? snapshot.settings.lastError}</p>
            ) : snapshot.settings.lastCompleted ? (
              <small>
                {t('最近整理', '最終整理')}：{date(snapshot.settings.lastCompleted)}
              </small>
            ) : null}
            <details>
              <summary>{t('学习用量设置', '学習の利用量設定')}</summary>
              <p>
                {t(
                  '后台学习使用当前已配置的云端 AI 和隐私处理。调用计入现有服务用量；每天按 UTC 重置。',
                  '設定済みのクラウドAIとプライバシー処理を使用し、既存サービスの利用量に含まれます。上限はUTC日付でリセットします。'
                )}
              </p>
              <label>
                {t('每日最多调用次数', '1日の呼び出し上限')}{' '}
                <input
                  type="number"
                  min={0}
                  max={60}
                  step={1}
                  value={budget}
                  disabled={busy}
                  onChange={(event) => setBudget(event.target.value)}
                />
              </label>
              <button
                disabled={
                  busy ||
                  budget.trim() === '' ||
                  !Number.isInteger(Number(budget)) ||
                  Number(budget) < 0 ||
                  Number(budget) > 60 ||
                  (Number(budget) > 0 && Number(budget) < 3)
                }
                onClick={() =>
                  void control({ action: 'budget', dailyCallLimit: Number(budget), expectedRevision: snapshot.settings.revision })
                }
              >
                {t('保存上限', '上限を保存')}
              </button>
            </details>
          </article>
          <article className="work-rule-card">
            <strong>{t('始终采用的基本方法', '基本の確認方法')}</strong>
            <ul>
              <li>
                {t(
                  '匹配：逐项核对案件要求与简历证据，区分符合、冲突和待确认。',
                  'マッチング：案件の要件と履歴書の根拠を照合し、一致・不一致・要確認を区別します。'
                )}
              </li>
              <li>
                {t(
                  '面试：围绕案件要求和实际项目提问，根据已有回答追问未解决事项。',
                  '面談：案件の要件と実際のプロジェクトに沿って質問し、記録済みの回答から未解決事項を深掘りします。'
                )}
              </li>
              <li>
                {t(
                  '介绍文：沿用已验证的表达习惯，保留全部业务事实和待确认事项。',
                  '紹介文：検証した表現の習慣を適用し、業務上の事実と要確認事項を保持します。'
                )}
              </li>
            </ul>
            <small>
              {t(
                '自动经验优化核实、同级推荐顺序和表达；明确的案件条件和 AI 工作规则始终优先。',
                '自動整理した経験で確認方法・同じ適合段階の推薦順・表現を改善し、明示された案件条件とAI業務ルールを優先します。'
              )}
            </small>
          </article>
          <details>
            <summary>{t('使用效果', '利用効果')}</summary>
            <p>
              {t(
                '比较采用文案后的修改频率和修改幅度。样本来自日常操作，不能单独证明招聘效果提高。',
                '採用した文面の修正頻度と変更量を比較します。日々の操作の集計であり、採用成果の改善を直接示すものではありません。'
              )}
            </p>
            {(snapshot.metrics ?? []).map((metric) => (
              <article className="experience-method" key={metric.task}>
                <strong>
                  {metric.task === 'matching'
                    ? t('匹配核对', 'マッチング確認')
                    : metric.task === 'interview'
                      ? t('面试问题', '面談質問')
                      : t('介绍文', '紹介文')}
                </strong>
                <table className="experience-metrics">
                  <thead>
                    <tr>
                      <th>{t('生成方法', '生成方法')}</th>
                      <th>{t('反馈记录', 'フィードバック記録')}</th>
                      <th>{t('采用次数', '採用回数')}</th>
                      <th>{t('修改比例', '修正割合')}</th>
                      <th>{t('平均修改幅度', '平均変更量')}</th>
                      <th>{t('重复问题比例', '重複質問の割合')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(['baseline', 'assisted'] as const).map((key) => {
                      const m = metric[key]
                      return (
                        <tr key={key}>
                          <td>{key === 'baseline' ? t('基本方法', '基本手順') : t('采用经验', '経験を適用')}</td>
                          <td>{m.feedback}</td>
                          <td>{metric.task === 'matching' ? '—' : m.adopted}</td>
                          <td>{m.adopted ? `${Math.round((m.edited / m.adopted) * 100)}%` : '—'}</td>
                          <td>{m.editRatio === null ? '—' : `${Math.round(m.editRatio * 100)}%`}</td>
                          <td>{m.duplicateQuestionRate === null ? '—' : `${Math.round(m.duplicateQuestionRate * 100)}%`}</td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
                <small>
                  {metric.enoughData
                    ? t('已具备初步比较样本，仍需结合案件差异判断。', '比較用の記録が集まりました。案件の違いを考慮して判断してください。')
                    : t('样本不足，暂不判断是否改善。', '記録が不足しているため、改善の判断は保留します。')}{' '}
                  · {t('反馈记录', 'フィードバック記録')} {metric.baseline.feedback}/{metric.assisted.feedback}
                </small>
              </article>
            ))}
          </details>
          <ExperienceTrends rows={snapshot.trends ?? []} zh={zh} />
          <CustomerIdentitiesPanel active={active} />
          <QuestionBankPanel active={active} />
          <label>
            {t('查看适用范围', '適用範囲を表示')}{' '}
            <select value={scopeFilter} onChange={(event) => setScopeFilter(event.target.value)}>
              <option value="all">{t('全部', 'すべて')}</option>
              <option value="personal">{t('个人习惯', '個人の習慣')}</option>
              <option value="customer">{t('客户经验', '顧客の経験')}</option>
              <option value="category">{t('案件类型', '案件の種類')}</option>
            </select>
          </label>
          <h4>
            {t('自动整理的经验', '自動整理した経験')} ({snapshot.experiences.length})
          </h4>
          {!snapshot.experiences.length ? (
            <p>
              {t(
                '目前还没有经过验证的经验。继续正常工作即可；记录不足时会保持原有方法。',
                '検証した経験はまだありません。通常どおりご利用ください。記録が不足している間は基本の手順を維持します。'
              )}
            </p>
          ) : null}
          {snapshot.experiences
            .filter((skill) => scopeFilter === 'all' || skill.scope?.kind === scopeFilter)
            .map((skill) => (
              <article className="work-rule-card" key={skill.id}>
                <header>
                  <strong>{skill.procedure?.title ?? experienceMethods[skill.method][zh ? 'zh' : 'ja']}</strong>
                  <span>
                    {names[skill.state]} · v{skill.version}
                  </span>
                </header>
                <p>
                  {skill.task === 'matching'
                    ? t('用于匹配核对', 'マッチング確認に適用')
                    : skill.task === 'introduction'
                      ? t('用于介绍文', '紹介文に適用')
                      : t('用于面试问题', '面談質問に適用')}{' '}
                  · {t('案件要求包含', '案件の要件に含む')}「{skill.keyword}」
                </p>
                {skill.scope ? (
                  <p>
                    {skill.scope.kind === 'customer'
                      ? t('客户经验', '顧客の経験')
                      : skill.scope.kind === 'category'
                        ? t('案件类型', '案件の種類')
                        : t('个人习惯', '個人の習慣')}
                    ：{skill.scope.label.split(' / ')[zh ? 0 : 1] ?? skill.scope.label} · {skill.scope.locale}
                    {skill.scope.style ? ` · ${skill.scope.style === 'brief' ? t('简洁', '簡潔') : t('标准', '標準')}` : ''}
                  </p>
                ) : (
                  <small>{t('历史通用经验', '従来の共通経験')}</small>
                )}
                {skill.servingVersion && skill.servingVersion !== skill.version ? (
                  <p>
                    {t('验证期间继续使用', '検証中も継続して使用')} v{skill.servingVersion}
                  </p>
                ) : null}
                {skill.procedure ? (
                  <div className="experience-method">
                    <strong>{t('具体方法', '具体的な手順')}</strong>
                    <ol>
                      {skill.procedure.steps.map((step, i) => (
                        <li key={i}>{step}</li>
                      ))}
                    </ol>
                    {skill.procedure.avoid.length ? (
                      <p>
                        {t('注意事项', '注意事項')}：{skill.procedure.avoid.join('；')}
                      </p>
                    ) : null}
                  </div>
                ) : null}
                <p>{skill.reason.split(' / ')[zh ? 0 : 1] ?? skill.reason}</p>
                <small>
                  {t('依据记录', '根拠の記録')} {skill.support.length} · {t('比较案例', '比較ケース')} {skill.evaluations.length} ·{' '}
                  {t('用于生成', '生成への適用')} {skill.uses}
                </small>
                <div className="work-rule-actions">
                  {['trial', 'active', 'paused'].includes(skill.state) || skill.servingVersion ? (
                    <button
                      disabled={busy}
                      onClick={() =>
                        void control({
                          action: 'enable',
                          id: skill.id,
                          expectedVersion: skill.version,
                          enabled: !(skill.enabled || skill.servingVersion)
                        })
                      }
                    >
                      {skill.enabled || skill.servingVersion ? t('停用这条经验', 'この経験を無効にする') : t('恢复使用', '利用を再開')}
                    </button>
                  ) : null}
                  <button
                    disabled={busy}
                    onClick={() => void operation(async () => setDetails(await window.sesAgent.getSystemExperienceDetails(skill.id)))}
                  >
                    {t('依据与版本记录', '根拠と変更履歴')}
                  </button>
                </div>
                {details?.history[0]?.id === skill.id ? (
                  <div className="experience-details">
                    <h4>{t('业务记录依据', '業務記録の根拠')}</h4>
                    {details.evidence.length ? (
                      details.evidence.map((item) => (
                        <blockquote key={item.id}>
                          <p>{item.text}</p>
                          <small>{date(item.createdAt)}</small>
                        </blockquote>
                      ))
                    ) : (
                      <p>{t('原始依据已更新或删除。', '元の根拠は更新または削除されました。')}</p>
                    )}
                    <h4>{t('版本记录', '変更履歴')}</h4>
                    <ol className="work-rule-history">
                      {details.history.map((version) => (
                        <li key={version.version}>
                          <span>
                            v{version.version} · {names[version.state]} · {date(version.createdAt)}
                          </span>
                          <p>{version.reason.split(' / ')[zh ? 0 : 1] ?? version.reason}</p>
                          {version.evaluations.length ? (
                            <p>
                              {t('独立比较通过', '独立比較を通過')}{' '}
                              {version.evaluations.filter((e) => e.grounded && !e.regression && e.candidate > e.baseline).length}/
                              {version.evaluations.length}
                            </p>
                          ) : null}
                          {version.version !== skill.version && ['trial', 'active'].includes(version.state) ? (
                            <button
                              disabled={busy}
                              onClick={() =>
                                void control({ action: 'restore', id: skill.id, expectedVersion: skill.version, version: version.version })
                              }
                            >
                              {t('恢复此版本', 'この版を復元')}
                            </button>
                          ) : null}
                        </li>
                      ))}
                    </ol>
                    <p>
                      {t(
                        '比较结果来自独立案例回放与模型评审，真实效果仍需后续业务记录验证。',
                        '比較は独立ケースの再実行とモデル評価に基づきます。実際の効果は後続の業務記録で確認します。'
                      )}
                    </p>
                  </div>
                ) : null}
              </article>
            ))}
        </>
      ) : null}
    </section>
  )
}
