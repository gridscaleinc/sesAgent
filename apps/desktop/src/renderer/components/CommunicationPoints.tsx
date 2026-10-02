import { useEffect, useRef, useState } from 'react'
import type { CommunicationPointsView } from '@shared'
import { aiServiceProblem, localizedIpcError, requestAiSignIn, useLocaleText } from '../i18n'
import { AiWorking } from './AiWorking'
import { tokyoDateTime } from './use-case-resume-assessments'

/** 沟通要点 of one person and case: the stored view, re-read when the pair changes, and generation on demand. */
export function useCommunicationPoints(documentId: string, reviewId: string) {
  const { locale, t } = useLocaleText()
  const [view, setView] = useState<CommunicationPointsView | null>(null)
  const [generating, setGenerating] = useState(false)
  const [error, setError] = useState<{ message: string; signIn: boolean } | null>(null)
  const pair = `${documentId}:${reviewId}`
  const current = useRef(pair)
  current.current = pair
  useEffect(() => {
    let active = true
    setView(null)
    setGenerating(false)
    setError(null)
    Promise.resolve(window.sesAgent.getCommunicationPoints?.({ documentId, reviewId }))
      .then((value) => {
        if (active && value) setView(value)
      })
      .catch(() => undefined)
    return () => {
      active = false
    }
  }, [pair])
  /** Returns true when the points were written, so the caller can clear what HR asked for. */
  const generate = async (request: string) => {
    if (generating || !window.sesAgent.generateCommunicationPoints) return false
    const asked = pair
    setGenerating(true)
    setError(null)
    try {
      const value = await window.sesAgent.generateCommunicationPoints({
        documentId,
        reviewId,
        ...(request.trim() ? { request: request.trim() } : {})
      })
      if (current.current === asked) setView(value)
      return true
    } catch (cause) {
      if (current.current === asked)
        setError({
          message: localizedIpcError(
            locale,
            cause,
            t('沟通要点生成失败，请重试。', '確認事項を生成できませんでした。もう一度お試しください。')
          ),
          signIn: aiServiceProblem(cause) === 'sign-in'
        })
      return false
    } finally {
      if (current.current === asked) setGenerating(false)
    }
  }
  const record = view?.record ?? null
  return {
    record,
    stale: Boolean(view?.stale),
    points: record && !view?.stale ? record.points : [],
    generating,
    error,
    generate,
    available: Boolean(window.sesAgent.generateCommunicationPoints)
  }
}

/** The AI part of 需沟通: questions for the person or the client, each with its reason, steerable by a request. */
export function CommunicationPointsSection({
  state,
  disabled,
  onAdopt
}: {
  state: ReturnType<typeof useCommunicationPoints>
  disabled: boolean
  /** Keeps one question as HR's own, so it stays when the AI points are generated again. */
  onAdopt(question: string): void
}) {
  const { zh, t } = useLocaleText()
  const [request, setRequest] = useState('')
  const { record } = state
  const off = disabled || state.generating || !state.available
  return (
    <section className="match-rule-questions communication-points" aria-busy={state.generating}>
      <h4>{t('AI 梳理的沟通要点', 'AIが整理した確認事項')}</h4>
      {record ? (
        <small className="match-muted">
          {t('AI 生成，未和简历原文核对', 'AI生成・履歴書の原文とは未照合')} · {tokyoDateTime(record.generatedAt, zh)}
          {record.modelName ? ` · ${record.modelName}` : ''}
          {record.request ? ` · ${t('按要求：', '要望：')}${record.request}` : ''}
        </small>
      ) : (
        <p className="match-muted">
          {t(
            '结合简历、案件内容和未确认的条件，由 AI 梳理提案或面试前要问本人、问客户的问题。',
            '履歴書・案件内容・未確認の条件から、提案や面談の前に本人やお客様へ確認すべきことをAIが整理します。'
          )}
        </p>
      )}
      {state.stale ? (
        <p role="status">{t('资料或案件已更新，建议重新生成', '情報または案件が更新されました。再生成をおすすめします')}</p>
      ) : null}
      {record && !state.stale ? (
        state.points.length ? (
          <ul>
            {state.points.map((point) => (
              <li key={point.question}>
                <span className={`match-tag${point.audience === 'client' ? ' is-muted' : ''}`}>
                  {point.audience === 'client' ? t('问客户', 'お客様に確認') : t('问本人', '本人に確認')}
                </span>{' '}
                {point.question}
                <button type="button" disabled={disabled} onClick={() => onAdopt(point.question)}>
                  {t('加入我的问题', '自分の質問に追加')}
                </button>
                <small className="match-muted">
                  {point.reason}
                  {point.source ? ` · 「${point.source}」` : ''}
                </small>
              </li>
            ))}
          </ul>
        ) : (
          <p className="match-muted">{t('AI 没有找到需要额外确认的事项。', '追加で確認すべき事項は見つかりませんでした。')}</p>
        )
      ) : null}
      {state.generating ? <AiWorking label={t('AI 正在梳理沟通要点…', 'AIが確認事項を整理しています…')} /> : null}
      <div className="match-inline-form">
        <textarea
          className="ai-request-input"
          aria-label={t('对 AI 梳理沟通要点的要求', '確認事項の整理への要望')}
          placeholder={t('例：重点看入场时间和出社频率', '例：参画開始時期と出社頻度を重点的に')}
          rows={2}
          maxLength={500}
          disabled={off}
          value={request}
          onChange={(event) => setRequest(event.target.value)}
        />
        <button
          type="button"
          disabled={off}
          onClick={() =>
            void state.generate(request).then((written) => {
              if (written) setRequest('')
            })
          }
        >
          {record ? t('重新生成', '再生成') : t('生成沟通要点', '確認事項を生成')}
        </button>
      </div>
      {state.error ? (
        <div role="alert">
          <p>{state.error.message}</p>
          {state.error.signIn ? (
            <button type="button" onClick={requestAiSignIn}>
              {t('去登录', 'ログインする')}
            </button>
          ) : null}
        </div>
      ) : null}
    </section>
  )
}
