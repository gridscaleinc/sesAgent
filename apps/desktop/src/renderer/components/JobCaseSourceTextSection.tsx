import { useEffect, useState } from 'react'
import type { JobCaseReviewSnapshot, JobCaseSourceText } from '@shared'
import { useUiLocale } from '../i18n'
import { Icon } from './Icon'

/**
 * Local redaction stores PII as <PERSON_NAME_001>-style tokens. The reader
 * sees a masked chip text per identifier type instead of the raw token.
 */
const piiPlaceholderPattern = /<([A-Z][A-Z0-9_]*?)_\d{3}>/gu

const maskedPlaceholderLabels: Record<string, readonly [string, string]> = {
  PERSON_NAME: ['〔人名・遮蔽済み〕', '〔人名·已遮蔽〕'],
  PHONE: ['〔電話番号・遮蔽済み〕', '〔电话·已遮蔽〕'],
  PRIVATE_EMAIL: ['〔メール・遮蔽済み〕', '〔邮箱·已遮蔽〕'],
  POSTAL_ADDRESS: ['〔住所・遮蔽済み〕', '〔住址·已遮蔽〕'],
  BIRTH_DATE: ['〔生年月日・遮蔽済み〕', '〔出生日期·已遮蔽〕'],
  GOVERNMENT_ID: ['〔公的番号・遮蔽済み〕', '〔证件号·已遮蔽〕'],
  PERSONAL_ACCOUNT_OR_URL: ['〔個人アカウント・遮蔽済み〕', '〔个人账号·已遮蔽〕']
}

export function maskPiiPlaceholders(text: string, zh: boolean): string {
  return text.replace(piiPlaceholderPattern, (_token, type: string) => {
    const labels = maskedPlaceholderLabels[type]
    if (labels) return labels[zh ? 1 : 0]
    return zh ? '〔已遮蔽〕' : '〔遮蔽済み〕'
  })
}

/**
 * The stored, device-redacted original behind an imported case (Gmail / EML).
 * Collapsed by default; the body is fetched from Main only on first expand
 * and never contains raw identifiers - placeholders render as masked chips.
 */
export function JobCaseSourceTextSection({ review, onLoad }: {
  review: Pick<JobCaseReviewSnapshot, 'reviewId' | 'sourceType'>
  onLoad(reviewId: string): Promise<JobCaseSourceText>
}) {
  const locale = useUiLocale()
  const zh = locale === 'zh-CN'
  const [sourceText, setSourceText] = useState<JobCaseSourceText | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    setSourceText(null)
    setLoading(false)
    setError(null)
  }, [review.reviewId])
  if (review.sourceType !== 'gmail' && review.sourceType !== 'eml') return null
  const load = () => {
    if (sourceText || loading) return
    setLoading(true)
    setError(null)
    void onLoad(review.reviewId).then(
      (value) => {
        setSourceText(value)
        setLoading(false)
      },
      (cause: unknown) => {
        setError(cause instanceof Error ? cause.message : (zh ? '来源原文读取失败。' : '取込元の本文を読み込めませんでした。'))
        setLoading(false)
      }
    )
  }
  return <details className="job-case-source-text" onToggle={(event) => { if (event.currentTarget.open) load() }}>
    <summary>{zh ? '来源原文（本机已脱敏）' : '取込元の本文（端末内で脱敏済み）'}</summary>
    <p className="job-case-source-text-hint"><Icon name="shield" size={12} />{zh ? '姓名与联系方式已在本机替换为遮蔽标记，原文未离开本机。' : '氏名・連絡先はこの端末内で遮蔽済みです。原文は端末外に出ていません。'}</p>
    {loading ? <p className="job-case-source-text-state">{zh ? '正在读取本机脱敏原文…' : '端末内の脱敏済み本文を読込中…'}</p> : null}
    {error ? <p className="job-case-source-text-state is-error" role="alert">{error}</p> : null}
    {sourceText ? <>
      <dl className="job-case-source-text-meta">
        <div><dt>{zh ? '主题' : '件名'}</dt><dd>{maskPiiPlaceholders(sourceText.redactedSubject, zh)}</dd></div>
        <div><dt>{zh ? '发件域名' : '送信元ドメイン'}</dt><dd>{sourceText.fromDomain ?? (zh ? '未记录' : '記録なし')}</dd></div>
        <div><dt>{zh ? '日期' : '日付'}</dt><dd>{new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(sourceText.messageDate))}</dd></div>
      </dl>
      <pre className="job-case-source-text-body">{maskPiiPlaceholders(sourceText.redactedBody, zh)}</pre>
    </> : null}
  </details>
}
