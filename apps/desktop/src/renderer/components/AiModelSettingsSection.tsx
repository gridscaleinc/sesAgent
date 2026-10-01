import { useState } from 'react'
import type {
  AgentChatModelOption,
  ApplicationAiModels,
  ApplicationAiModelSlot,
  LocalApplicationPreferences,
  SaveLocalApplicationPreferencesInput,
  TestAiModelResult
} from '@shared'
import { aiServiceProblem, localizedAiServiceProblem, localizedIpcError, useLocaleText } from '../i18n'
import { Icon } from './Icon'

type LocaleText = (cn: string, ja: string) => string

// Same default as the Main catalog; a saved key the catalog no longer lists is shown (and used) as this one.
const defaultModelKey = 'gpt-5.6-luna'

const slots: ApplicationAiModelSlot[] = ['checking', 'writing']

function slotLabel(t: LocaleText, slot: ApplicationAiModelSlot): string {
  return slot === 'checking'
    ? t('批量核对（找人评估、案件识别、邮件处理）', '一括確認（要員評価・案件識別・メール処理）')
    : t('文案与分析（推荐要点、介绍文、面试问题）', '文章と分析（推薦ポイント・紹介文・面談質問）')
}

function tierLabel(t: LocaleText, tier: AgentChatModelOption['tier']): string | null {
  if (tier === 'fast') return t('快 · 省', '高速・低コスト')
  if (tier === 'balanced') return t('均衡', 'バランス')
  if (tier === 'strong') return t('强', '高性能')
  if (tier === 'strongest') return t('最强，但慢且贵', '最高性能・低速・高コスト')
  return null
}

/** The model a slot really uses: the same fallback as Main, so a model the gateway does not offer yet shows the default. */
function effectiveChoice(models: AgentChatModelOption[], chosen: string | undefined): string {
  if (chosen && models.some((model) => model.key === chosen && !model.unavailable)) return chosen
  return models.some((model) => model.key === defaultModelKey) ? defaultModelKey : (models[0]?.key ?? defaultModelKey)
}

type TestState = { status: 'testing' } | { status: 'available'; latencyMs: number } | { status: 'failed'; message: string; signIn: boolean }

interface AiModelSettingsSectionProps {
  models: AgentChatModelOption[]
  preferences: LocalApplicationPreferences
  disabled: boolean
  onSave(input: SaveLocalApplicationPreferencesInput): Promise<LocalApplicationPreferences>
  onTestAiModel?(modelKey: string): Promise<TestAiModelResult>
  onOpenAiCommerce(): void
}

/** 设置 › AI 模型: which catalog model each kind of business AI work uses, with a per-model availability check. */
export function AiModelSettingsSection({
  models,
  preferences,
  disabled,
  onSave,
  onTestAiModel,
  onOpenAiCommerce
}: AiModelSettingsSectionProps) {
  const { locale, t } = useLocaleText()
  const current: ApplicationAiModels = {
    checking: effectiveChoice(models, preferences.aiModels?.checking),
    writing: effectiveChoice(models, preferences.aiModels?.writing)
  }
  // A saved choice the gateway does not offer yet is named, so the shown default is not a surprise.
  const unavailableChoice = (slot: ApplicationAiModelSlot) => {
    const chosen = preferences.aiModels?.[slot]
    return chosen ? models.find((model) => model.key === chosen && model.unavailable) : undefined
  }
  const [saving, setSaving] = useState<ApplicationAiModelSlot | null>(null)
  const [saved, setSaved] = useState<ApplicationAiModelSlot | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [tests, setTests] = useState<Partial<Record<ApplicationAiModelSlot, TestState>>>({})

  const choose = async (slot: ApplicationAiModelSlot, key: string) => {
    if (saving || key === current[slot]) return
    setSaving(slot)
    setSaved(null)
    setError(null)
    setTests((state) => ({ ...state, [slot]: undefined }))
    try {
      await onSave({ locale: preferences.locale, expectedRevision: preferences.revision, aiModels: { ...current, [slot]: key } })
      setSaved(slot)
    } catch (cause) {
      setError(localizedIpcError(locale, cause, t('无法保存 AI 模型设置。', 'AIモデルの設定を保存できませんでした。')))
    } finally {
      setSaving(null)
    }
  }

  const test = async (slot: ApplicationAiModelSlot) => {
    if (!onTestAiModel || tests[slot]?.status === 'testing') return
    setTests((state) => ({ ...state, [slot]: { status: 'testing' } }))
    try {
      const result = await onTestAiModel(current[slot])
      setTests((state) => ({ ...state, [slot]: { status: 'available', latencyMs: result.latencyMs } }))
    } catch (cause) {
      const problem = aiServiceProblem(cause)
      const raw = cause instanceof Error ? cause.message : ''
      const code = /\[([A-Z0-9_]+)\]/u.exec(raw)?.[1]
      const unavailable = t('此模型暂时无法通过 AI 网关使用。', 'このモデルは現在AIゲートウェイで利用できません。')
      const message = problem
        ? localizedAiServiceProblem(locale, problem)
        : /AiCommerce|AICommerce/u.test(raw)
          ? `${unavailable}${code ? ` (${code})` : ''}`
          : localizedIpcError(locale, cause, unavailable)
      setTests((state) => ({ ...state, [slot]: { status: 'failed', message, signIn: problem === 'sign-in' } }))
    }
  }

  return (
    <section aria-labelledby="model-settings-title" className="settings-section">
      <div className="settings-section-heading">
        <h3 id="model-settings-title">{t('AI 模型', 'AIモデル')}</h3>
        <p>
          {t(
            '按工作类型选择云端 AI 模型。快速的模型适合频繁的批量核对，更强的模型适合写文案和分析。更改后下一次 AI 调用立即生效。',
            '作業の種類ごとにクラウドAIモデルを選びます。頻繁な一括確認には高速なモデル、文章作成や分析には高性能なモデルが向いています。変更は次のAI呼び出しから反映されます。'
          )}
        </p>
      </div>
      <div className="settings-model-grid">
        {slots.map((slot) => {
          const state = tests[slot]
          return (
            <div className="settings-model-row" key={slot}>
              <label htmlFor={`settings-model-${slot}`}>{slotLabel(t, slot)}</label>
              {unavailableChoice(slot) ? (
                <small className="settings-model-fallback" role="status">
                  {t(
                    `之前选的 ${unavailableChoice(slot)!.displayName} 暂未开放，现在使用默认模型。`,
                    `以前選んだ ${unavailableChoice(slot)!.displayName} は未提供のため、既定のモデルを使っています。`
                  )}
                </small>
              ) : null}
              <div className="settings-model-controls">
                <select
                  disabled={disabled || saving !== null}
                  id={`settings-model-${slot}`}
                  onChange={(event) => void choose(slot, event.target.value)}
                  value={current[slot]}
                >
                  {models.map((model) => {
                    const hint = tierLabel(t, model.tier)
                    return (
                      <option key={model.key} value={model.key} disabled={model.unavailable}>
                        {model.unavailable
                          ? t(`${model.displayName}（暂未开放）`, `${model.displayName}（未提供）`)
                          : hint
                            ? `${model.displayName} · ${hint}`
                            : model.displayName}
                      </option>
                    )
                  })}
                </select>
                <button
                  aria-label={t(`测试模型：${slotLabel(t, slot)}`, `モデルをテスト：${slotLabel(t, slot)}`)}
                  disabled={!onTestAiModel || state?.status === 'testing' || saving !== null}
                  onClick={() => void test(slot)}
                  type="button"
                >
                  {state?.status === 'testing' ? t('测试中…', 'テスト中…') : t('测试模型', 'モデルをテスト')}
                </button>
              </div>
              {saving === slot ? (
                <small>{t('保存中…', '保存中…')}</small>
              ) : saved === slot ? (
                <small>{t('已保存', '保存しました')}</small>
              ) : null}
              {state?.status === 'available' ? (
                <p className="settings-model-result is-available" role="status">
                  <Icon name="check" size={14} />
                  {t(`可用 · ${state.latencyMs} ms`, `利用可能 · ${state.latencyMs} ms`)}
                </p>
              ) : state?.status === 'failed' ? (
                <div className="settings-model-result is-failed" role="alert">
                  <Icon name="alert" size={14} />
                  <span>{state.message}</span>
                  {state.signIn ? (
                    <button onClick={onOpenAiCommerce} type="button">
                      {t('去登录', 'ログインする')}
                    </button>
                  ) : null}
                </div>
              ) : null}
            </div>
          )
        })}
      </div>
      {error ? (
        <p className="settings-inline-error" role="alert">
          {error}
        </p>
      ) : null}
      <div className="application-settings-policy">
        <Icon name="shield" size={16} />
        <span>
          <strong>{t('测试不含业务数据', 'テストに業務データは含まれません')}</strong>
          {t(
            '「测试模型」只发送一句固定的连通性确认，与业务调用经过同一个脱敏网关，会消耗少量 AI 额度。',
            '「モデルをテスト」は固定の接続確認文だけを、業務の呼び出しと同じ脱敏ゲートウェイ経由で送信します。少量のAIクレジットを使用します。'
          )}
        </span>
      </div>
    </section>
  )
}
