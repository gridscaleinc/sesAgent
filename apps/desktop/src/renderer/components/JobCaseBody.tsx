import { useEffect, useRef, useState } from 'react'
import type { JobCaseReviewSnapshot, JobCaseSourceText } from '@shared'
import { maskPiiPlaceholders } from './JobCaseSourceTextSection'
import './job-case-body.css'

type BodyBlock = { kind: 'paragraph' | 'heading' | 'list' | 'rule'; lines: string[] }

// Only interpret explicit plain-text structure; never rewrite or infer case requirements.
function bodyBlocks(text: string): BodyBlock[] {
  const blocks: BodyBlock[] = []
  let paragraph: string[] = []
  const flush = () => { if (paragraph.length) blocks.push({ kind: 'paragraph', lines: paragraph }); paragraph = [] }
  for (const line of text.replace(/\r\n?/gu, '\n').split('\n')) {
    const trimmed = line.trim()
    if (!trimmed) { flush(); continue }
    if (/^[─━―—_=\-－ー]{3,}$/u.test(trimmed)) { flush(); blocks.push({ kind: 'rule', lines: [] }); continue }
    if (/^(?:[■◆▼]\s*.{1,60}|【[^】]{1,30}】|仕事内容|業務内容|案件情報|人材要件|必須スキル|尚可スキル|勤務条件|工作内容|必需技能|加分技能)$/u.test(trimmed)) {
      flush(); blocks.push({ kind: 'heading', lines: [trimmed] }); continue
    }
    const bullet = trimmed.match(/^(?:[・●•]\s*|[-*]\s+)(.+)$/u)
    if (bullet) {
      flush()
      const previous = blocks.at(-1)
      if (previous?.kind === 'list') previous.lines.push(bullet[1]!)
      else blocks.push({ kind: 'list', lines: [bullet[1]!] })
      continue
    }
    paragraph.push(line)
  }
  flush()
  return blocks
}

export function FormattedCaseBody({ text, zh }: { text: string; zh: boolean }) {
  return <div className="case-body-text">{bodyBlocks(maskPiiPlaceholders(text, zh)).map((block, index) => {
    if (block.kind === 'rule') return <hr key={index} />
    if (block.kind === 'heading') return <h4 key={index}>{block.lines[0]}</h4>
    if (block.kind === 'list') return <ul key={index}>{block.lines.map((line, item) => <li key={item}>{line}</li>)}</ul>
    return <p key={index}>{block.lines.join('\n')}</p>
  })}</div>
}

/** Fetch the complete local, redacted body instead of the 4,000-character inbox preview. */
export function JobCaseBody({ review, onLoad, zh }: {
  review: Pick<JobCaseReviewSnapshot, 'reviewId' | 'redactedPreview'>
  onLoad?(reviewId: string): Promise<JobCaseSourceText>
  zh: boolean
}) {
  const [source, setSource] = useState<JobCaseSourceText | null>(null)
  const [error, setError] = useState(false)
  const [attempt, setAttempt] = useState(0)
  const loader = useRef(onLoad)
  useEffect(() => { loader.current = onLoad }, [onLoad])
  const canLoad = Boolean(onLoad)
  useEffect(() => {
    let active = true
    setSource(null); setError(false)
    const load = loader.current
    if (load) void (async () => {
      try {
        const value = await load(review.reviewId)
        if (!value) throw new Error('Missing case source')
        if (active) setSource(value)
      } catch { if (active) setError(true) }
    })()
    return () => { active = false }
  }, [review.reviewId, canLoad, attempt])
  return <section className="case-body-reader" aria-label={zh ? '案件正文' : '案件本文'}>
    <header><h3>{zh ? '案件正文' : '案件本文'}</h3><small>{zh ? '已脱敏' : '脱敏済み'}</small></header>
    {source ? (source.redactedBody.trim() ? <FormattedCaseBody text={source.redactedBody} zh={zh} /> : <p>{zh ? '此案件没有正文内容。' : 'この案件には本文がありません。'}</p>) : error ? <div role="alert" className="case-body-load-state">
      <span>{zh ? '案件正文读取失败，请重试。' : '案件本文の読込に失敗しました。再試行してください。'}</span>
      <button onClick={() => setAttempt((value) => value + 1)} type="button">{zh ? '重试' : '再試行'}</button>
    </div> : canLoad ? <p role="status">{zh ? '正在读取案件正文…' : '案件本文を読込中…'}</p> : <>
      <p className="case-body-preview-note">{zh ? '当前仅显示正文预览。' : '現在は本文のプレビューのみ表示しています。'}</p>
      <FormattedCaseBody text={review.redactedPreview} zh={zh} />
    </>}
  </section>
}
