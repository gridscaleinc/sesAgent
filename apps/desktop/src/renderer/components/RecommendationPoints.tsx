import { useEffect, useRef, useState } from 'react'
import type { RecommendationPoint, RecommendationPointsView } from '@shared'
import { aiServiceProblem, localizedIpcError, requestAiSignIn, useLocaleText } from '../i18n'
import { tokyoDateTime } from './use-case-resume-assessments'
import { AiWorking } from './AiWorking'
import './recommendation-points.css'

/**
 * 推荐要点 of one person and case: the stored view, re-read whenever the pair changes, and on-demand generation.
 * `points` holds only points written for the current profile and case version.
 */
export function useRecommendationPoints(documentId: string, reviewId: string | null | undefined) {
  const { locale, t } = useLocaleText()
  const [view, setView] = useState<RecommendationPointsView | null>(null)
  const [loading, setLoading] = useState(false)
  const [generating, setGenerating] = useState(false)
  const [error, setError] = useState<{ message: string; action: 'read' | 'generate'; signIn: boolean } | null>(null)
  const pair = `${documentId}:${reviewId ?? ''}`
  const current = useRef(pair)
  current.current = pair
  const read = () => {
    const request = pair
    setError(null)
    if (!reviewId || !window.sesAgent.getRecommendationPoints) return () => undefined
    let active = true
    setLoading(true)
    Promise.resolve(window.sesAgent.getRecommendationPoints({ documentId, reviewId }))
      .then((value) => {
        if (active && current.current === request) setView(value)
      })
      .catch((cause) => {
        if (active && current.current === request)
          setError({
            message: localizedIpcError(locale, cause, t('无法读取推荐要点。', '推薦ポイントを読み込めませんでした。')),
            action: 'read',
            signIn: false
          })
      })
      .finally(() => {
        if (active && current.current === request) setLoading(false)
      })
    return () => {
      active = false
    }
  }
  useEffect(() => {
    setView(null)
    setGenerating(false)
    return read()
  }, [pair])
  /** Returns true when the points were written, so a caller can clear what HR asked for. */
  const generate = async (operatorRequest?: string) => {
    if (!reviewId || generating || !window.sesAgent.generateRecommendationPoints) return false
    const request = pair
    setGenerating(true)
    setError(null)
    try {
      const value = await window.sesAgent.generateRecommendationPoints({
        documentId,
        reviewId,
        ...(operatorRequest?.trim() ? { request: operatorRequest.trim() } : {})
      })
      if (current.current === request) setView(value)
      return true
    } catch (cause) {
      if (current.current === request)
        setError({
          message: localizedIpcError(
            locale,
            cause,
            t('推荐要点生成失败，请重试。', '推薦ポイントを生成できませんでした。もう一度お試しください。')
          ),
          action: 'generate',
          signIn: aiServiceProblem(cause) === 'sign-in'
        })
    } finally {
      if (current.current === request) setGenerating(false)
    }
    return false
  }
  const record = view?.record ?? null
  return {
    record,
    stale: Boolean(view?.stale),
    points: record && !view?.stale ? record.points : [],
    loading,
    generating,
    error,
    generate,
    retry: () => (error?.action === 'read' ? void read() : void generate()),
    available: Boolean(window.sesAgent.generateRecommendationPoints)
  }
}

function PointSource({ point }: { point: RecommendationPoint }) {
  const { t } = useLocaleText()
  return (
    <small className="recommendation-point-source">
      {t('依据', '根拠')}：{point.project ? `${point.project} · ` : ''}「{point.quote}」
    </small>
  )
}

function PointsError({ state }: { state: ReturnType<typeof useRecommendationPoints> }) {
  const { t } = useLocaleText()
  if (!state.error) return null
  return (
    <div className="recommendation-points-error" role="alert">
      <p>{state.error.message}</p>
      {state.error.signIn ? (
        <button type="button" onClick={requestAiSignIn}>
          {t('去登录', 'ログインする')}
        </button>
      ) : null}
      <button type="button" disabled={state.generating} onClick={state.retry}>
        {t('重试', '再試行')}
      </button>
    </div>
  )
}

/** The 推荐要点 detail tab: material for writing the introduction to this client, each point with its resume source. */
export function RecommendationPointsTab({
  documentId,
  reviewId,
  blocked
}: {
  documentId: string
  reviewId: string
  /** Why generation is unavailable (person unavailable, result outdated); empty when it can be used. */
  blocked?: string
}) {
  const { zh, t } = useLocaleText()
  const state = useRecommendationPoints(documentId, reviewId)
  const { record } = state
  const [request, setRequest] = useState('')
  useEffect(() => setRequest(''), [documentId, reviewId])
  const disabled = state.generating || Boolean(blocked) || !state.available
  const reason = blocked || (!state.available ? t('当前无法使用 AI 生成。', '現在AI生成を利用できません。') : '')
  const generateForm = (label: string, primary = false) => (
    <div className="match-inline-form">
      <textarea
        className="ai-request-input"
        aria-label={t('对 AI 的要求', 'AIへの要望')}
        placeholder={t('例：突出他的金融业务经验', '例：金融業務の経験を強調して')}
        rows={2}
        maxLength={500}
        disabled={disabled}
        value={request}
        onChange={(event) => setRequest(event.target.value)}
      />
      <button
        type="button"
        className={primary ? 'hr-primary' : undefined}
        disabled={disabled}
        title={reason || undefined}
        onClick={() =>
          void state.generate(request).then((written) => {
            if (written) setRequest('')
          })
        }
      >
        {label}
      </button>
    </div>
  )
  return (
    <div className="recommendation-points" aria-busy={state.generating || state.loading}>
      {state.loading && !record ? <p className="match-muted">{t('正在读取推荐要点…', '推薦ポイントを読み込んでいます…')}</p> : null}
      {!state.loading && !record ? (
        <div className="recommendation-points-empty">
          <p>
            {t(
              '根据此人的项目经历和本案件内容，由 AI 提炼 3–5 条向客户推荐时的卖点，每条都附简历原文依据，可在写介绍时使用。',
              'この要員の案件経歴と本案件の内容から、お客様へ推薦する際のアピールポイントをAIが3〜5件まとめます。各ポイントには履歴書の原文根拠が付き、紹介文の作成に使えます。'
            )}
          </p>
          {generateForm(t('生成推荐要点', '推薦ポイントを生成'), true)}
          {reason ? <small className="match-blocked">{reason}</small> : null}
        </div>
      ) : null}
      {record ? (
        <>
          <div className="recommendation-points-header">
            <span className="recommendation-points-label">{t('AI 生成，推荐前请核对', 'AI生成・推薦前に確認してください')}</span>
            <small className="match-muted">
              {tokyoDateTime(record.generatedAt, zh)}
              {record.modelName ? ` · ${record.modelName}` : ''}
            </small>
          </div>
          {generateForm(t('重新生成', '再生成'))}
          {state.stale ? (
            <p role="status" className="recommendation-points-stale">
              {t('资料或案件已更新，建议重新生成', '情報または案件が更新されました。再生成をおすすめします')}
            </p>
          ) : null}
          {reason ? <small className="match-blocked">{reason}</small> : null}
          {record.points.length ? (
            <ol className="recommendation-points-list">
              {record.points.map((point, index) => (
                <li key={index}>
                  <strong>{point.headline}</strong>
                  <p>{point.detail}</p>
                  <PointSource point={point} />
                </li>
              ))}
            </ol>
          ) : (
            <p className="match-muted">
              {t(
                'AI 未能找到有简历原文依据的推荐要点，可重新生成，或先补充人员的项目经历。',
                '履歴書の原文で裏付けられる推薦ポイントが見つかりませんでした。再生成するか、要員の案件経歴を補足してください。'
              )}
            </p>
          )}
        </>
      ) : null}
      {state.generating ? (
        <AiWorking label={t('AI 正在结合项目经历与案件内容生成推荐要点…', 'AIが案件経歴と案件内容から推薦ポイントを生成しています…')} />
      ) : null}
      <PointsError state={state} />
    </div>
  )
}

/** The compact 推荐要点 list of the introduction composer; 「插入」 hands one point to the editor. */
export function RecommendationPointsPicker({
  documentId,
  reviewId,
  disabled,
  onInsert
}: {
  documentId: string
  reviewId: string
  disabled?: boolean
  onInsert(point: RecommendationPoint): void
}) {
  const { t } = useLocaleText()
  const state = useRecommendationPoints(documentId, reviewId)
  if (!state.available) return null
  return (
    <aside className="recommendation-points-picker" aria-label={t('推荐要点', '推薦ポイント')}>
      <strong>{t('推荐要点', '推薦ポイント')}</strong>
      {state.points.length ? (
        <ol>
          {state.points.map((point, index) => (
            <li key={index}>
              <span>
                <b>{point.headline}</b> {point.detail}
              </span>
              <button
                type="button"
                disabled={disabled}
                aria-label={`${t('插入', '挿入')}：${point.headline}`}
                onClick={() => onInsert(point)}
              >
                {t('插入', '挿入')}
              </button>
            </li>
          ))}
        </ol>
      ) : state.loading ? null : (
        <button
          type="button"
          className="recommendation-points-link"
          disabled={disabled || state.generating}
          onClick={() => void state.generate()}
        >
          {state.generating ? t('正在生成推荐要点…', '推薦ポイントを生成中…') : t('先生成推荐要点', '先に推薦ポイントを生成')}
        </button>
      )}
      {state.record && !state.stale && !state.points.length && !state.generating ? (
        <small className="match-muted">{t('未找到有依据的推荐要点。', '根拠のある推薦ポイントが見つかりませんでした。')}</small>
      ) : null}
      <PointsError state={state} />
    </aside>
  )
}
