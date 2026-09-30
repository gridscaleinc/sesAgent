import { useEffect, useState } from 'react'
import type { JobCaseReviewSnapshot, JobCaseSourceText } from '@shared'
import { localeText, localizedIpcError, useUiLocale } from '../i18n'

/**
 * Local redaction stores PII as <PERSON_NAME_001>-style tokens. The reader
 * sees a masked chip text per identifier type instead of the raw token.
 */
const piiPlaceholderPattern = /<([A-Z][A-Z0-9_]*?)_\d{3}>/gu

const maskedPlaceholderLabels: Record<string, { zh: string; ja: string }> = {
  PERSON_NAME: { zh: '〔人名·已遮蔽〕', ja: '〔人名・遮蔽済み〕' },
  PHONE: { zh: '〔电话·已遮蔽〕', ja: '〔電話番号・遮蔽済み〕' },
  PRIVATE_EMAIL: { zh: '〔邮箱·已遮蔽〕', ja: '〔メール・遮蔽済み〕' },
  POSTAL_ADDRESS: { zh: '〔住址·已遮蔽〕', ja: '〔住所・遮蔽済み〕' },
  BIRTH_DATE: { zh: '〔出生日期·已遮蔽〕', ja: '〔生年月日・遮蔽済み〕' },
  GOVERNMENT_ID: { zh: '〔证件号·已遮蔽〕', ja: '〔公的番号・遮蔽済み〕' },
  PERSONAL_ACCOUNT_OR_URL: { zh: '〔个人账号·已遮蔽〕', ja: '〔個人アカウント・遮蔽済み〕' }
}

export function maskPiiPlaceholders(text: string, zh: boolean): string {
  const t = localeText(zh)

  return text.replace(piiPlaceholderPattern, (_token, type: string) => {
    const labels = maskedPlaceholderLabels[type]
    if (labels) return zh ? labels.zh : labels.ja
    return t('〔已遮蔽〕', '〔遮蔽済み〕')
  })
}

/**
 * Local source behind an imported case (Gmail / EML). Main restores the
 * encrypted local mappings only for this reader, on first expand.
 */
export function JobCaseSourceTextSection({
  review,
  onLoad
}: {
  review: Pick<JobCaseReviewSnapshot, 'reviewId' | 'sourceType'>
  onLoad(reviewId: string): Promise<JobCaseSourceText>
}) {
  const locale = useUiLocale()
  const zh = locale === 'zh-CN'
  const t = localeText(zh)
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
        setError(localizedIpcError(locale, cause, t('来源原文读取失败。', '取込元の本文を読み込めませんでした。')))
        setLoading(false)
      }
    )
  }
  return (
    <details
      className="job-case-source-text"
      onToggle={(event) => {
        if (event.currentTarget.open) load()
      }}
    >
      <summary>{t('来源原文', '取込元の本文')}</summary>
      {loading ? <p className="job-case-source-text-state">{t('正在读取原文…', '本文を読込中…')}</p> : null}
      {error ? (
        <p className="job-case-source-text-state is-error" role="alert">
          {error}
        </p>
      ) : null}
      {sourceText ? (
        <>
          <dl className="job-case-source-text-meta">
            <div>
              <dt>{t('主题', '件名')}</dt>
              <dd>{sourceText.localDisplay?.subject ?? maskPiiPlaceholders(sourceText.redactedSubject, zh)}</dd>
            </div>
            <div>
              <dt>{t('发件域名', '送信元ドメイン')}</dt>
              <dd>{sourceText.fromDomain ?? t('未记录', '記録なし')}</dd>
            </div>
            <div>
              <dt>{t('日期', '日付')}</dt>
              <dd>
                {new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(sourceText.messageDate))}
              </dd>
            </div>
          </dl>
          <pre className="job-case-source-text-body">
            {sourceText.localDisplay?.body ?? maskPiiPlaceholders(sourceText.redactedBody, zh)}
          </pre>
        </>
      ) : null}
    </details>
  )
}
