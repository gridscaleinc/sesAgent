import type {
  AgentSystemAccessBlock,
  JobCaseFieldKey,
  JobCaseSourceType,
  NewJobCaseDigest,
  NewJobCaseDigestDay,
  NewJobCaseDigestEntry
} from '@shared'
import { Icon } from './Icon'
import { localeText, useUiLocale, localizedJobCaseFieldLabel } from '../i18n'

interface NewCaseDigestCardProps {
  digest: NewJobCaseDigest | null
  /** From the bootstrap snapshot; null when Gmail is not connected. */
  gmailLastSyncedAt?: string | null
  onMarkSeen(reviewId: string): void
  onOpenAccess(access: AgentSystemAccessBlock): void
}

function fieldLabel(key: JobCaseFieldKey, zh: boolean): string {
  return localizedJobCaseFieldLabel(zh ? 'zh-CN' : 'ja-JP', key)
}

function sourceLabel(sourceType: JobCaseSourceType, zh: boolean): string {
  const t = localeText(zh)

  if (sourceType === 'gmail') return 'Gmail'
  if (sourceType === 'eml') return 'EML'
  if (sourceType === 'chat-paste') return t('微信粘贴', '貼付')
  if (sourceType === 'wechat-visible') return t('微信读取', '微信')
  return t('手动', '手動')
}

function dayLabel(day: NewJobCaseDigestDay, zh: boolean): string {
  const t = localeText(zh)

  if (day === 'today') return t('今天', '本日')
  if (day === 'yesterday') return t('昨天', '昨日')
  return t('更早', 'それ以前')
}

/** Arrival and sync times are read in the operator's business day, like every other date here. */
function clockTime(value: string, locale: string): string {
  return new Intl.DateTimeFormat(locale, {
    timeZone: 'Asia/Tokyo',
    hour: '2-digit',
    minute: '2-digit'
  }).format(new Date(value))
}

function DigestRow({
  entry,
  locale,
  zh,
  onMarkSeen,
  onOpenAccess
}: {
  entry: NewJobCaseDigestEntry
  locale: string
  zh: boolean
  onMarkSeen(reviewId: string): void
  onOpenAccess(access: AgentSystemAccessBlock): void
}) {
  const t = localeText(zh)

  // Any of the three actions counts as having looked at the case.
  const open = (access: AgentSystemAccessBlock) => {
    onMarkSeen(entry.reviewId)
    onOpenAccess(access)
  }
  return (
    <li className={entry.unseen ? 'new-case-digest-row is-unseen' : 'new-case-digest-row'}>
      <div className="new-case-digest-row-head">
        <span className="new-case-digest-source">{sourceLabel(entry.sourceType, zh)}</span>
        <strong>{entry.title}</strong>
        {entry.unseen ? <span className="new-case-digest-new">{t('新', '新')}</span> : null}
        <time>{clockTime(entry.arrivedAt, locale)}</time>
      </div>
      {entry.highlights.length > 0 ? (
        <p className="new-case-digest-fields">
          {entry.highlights.map((highlight) => (
            <span key={highlight.key}>
              <small>{fieldLabel(highlight.key, zh)}</small>
              {highlight.value}
            </span>
          ))}
        </p>
      ) : null}
      <div className="new-case-digest-row-foot">
        <span className={entry.status === 'ready' ? 'new-case-digest-chip is-ready' : 'new-case-digest-chip'}>
          {entry.status === 'ready'
            ? t('有效', '有効')
            : entry.missingFieldKeys.length > 0
              ? `${t('待补充', '要補完')}：${entry.missingFieldKeys.map((key) => fieldLabel(key, zh)).join('・')}`
              : t('待补充', '要補完')}
        </span>
        <button onClick={() => open({ type: 'system-access', destination: 'case-review', reviewId: entry.reviewId })} type="button">
          {t('详情', '詳細')}
        </button>
        <button onClick={() => open({ type: 'system-access', destination: 'broadcast', reviewId: entry.reviewId })} type="button">
          {t('群发文案', '配信文')}
        </button>
        {entry.jobCaseId ? (
          <button
            className="is-primary"
            onClick={() => open({ type: 'system-access', destination: 'matching', jobCaseId: entry.jobCaseId! })}
            type="button"
          >
            {t('匹配', 'マッチング')}
          </button>
        ) : null}
      </div>
    </li>
  )
}

/**
 * 今日新着案件 on the conversation home: what arrived today, yesterday and in
 * the past week, whichever route brought it in, and which of it is still
 * unread. Every count comes from the one digest the main process derives.
 */
export function NewCaseDigestCard({ digest, gmailLastSyncedAt = null, onMarkSeen, onOpenAccess }: NewCaseDigestCardProps) {
  const locale = useUiLocale()
  const zh = locale === 'zh-CN'
  const t = localeText(zh)
  if (!digest) return null
  return (
    <section aria-label={t('今日新案件', '本日の新規案件')} className="new-case-digest">
      <header>
        <span className="new-case-digest-mark">
          <Icon name="briefcase" size={15} />
        </span>
        <strong>{t('今日新案件', '今日の新着案件')}</strong>
        {digest.unseenCount > 0 ? (
          <span className="new-case-digest-unseen">{t(`${digest.unseenCount} 未读`, `未読 ${digest.unseenCount} 件`)}</span>
        ) : null}
      </header>
      {digest.newCasesToday === 0 ? (
        <p className="new-case-digest-empty" role="status">
          {t('今天暂无新案件。', '本日の新規案件はありません。')}
          {gmailLastSyncedAt
            ? t(`上次 Gmail 同步 ${clockTime(gmailLastSyncedAt, locale)}`, `前回の Gmail 同期 ${clockTime(gmailLastSyncedAt, locale)}`)
            : null}
        </p>
      ) : null}
      {digest.groups.map((group) => (
        <div className="new-case-digest-group" key={group.day}>
          <h3>
            {dayLabel(group.day, zh)}
            <small>
              {t(`${group.count} 件`, `${group.count}件`)}
              {group.unseenCount > 0 ? t(` · ${group.unseenCount} 未读`, ` · 未読${group.unseenCount}件`) : ''}
            </small>
          </h3>
          <ul>
            {group.entries.map((entry) => (
              <DigestRow entry={entry} key={entry.reviewId} locale={locale} onMarkSeen={onMarkSeen} onOpenAccess={onOpenAccess} zh={zh} />
            ))}
          </ul>
        </div>
      ))}
    </section>
  )
}
