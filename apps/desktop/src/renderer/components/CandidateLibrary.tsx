import { useEffect, useRef, useState, type FormEvent } from 'react'
import type {
  PrepareAiCommerceCloudPromptInput,
  AiCommerceCloudPromptResult,
  AiCommerceMembershipState,
  CandidateDeletionPreview,
  CandidateProfileSearchResult,
  CandidateProfileVersionDetail,
  DataDeletionReport,
  DeleteCandidateDataInput,
  ResumeAnalysisSummary,
  OriginalDocumentPreview,
  SearchCandidateProfilesInput,
  UpdateCandidateProfileInput,
  UpdateCandidateProfileResult
} from '@shared'
import { CandidateHardFilterEvidence } from './CandidateHardFilterEvidence'
import { CandidateProfileDetail } from './CandidateProfileDetail'
import { Icon } from './Icon'
import { useRendererUiRefresh, useUiLocale } from '../i18n'
import { summarizeSourceLabels } from '../source-evidence'

interface CandidateLibraryProps {
  profileRequest?: { id: number; documentId: string }
  aiCommerce?: AiCommerceMembershipState
  analyses?: ResumeAnalysisSummary[]
  onImportResume?(): void
  onOpenCloudSettings?(): void
  onSendCloudPrompt?(input: PrepareAiCommerceCloudPromptInput): Promise<AiCommerceCloudPromptResult>
  onUpdateCandidate(input: UpdateCandidateProfileInput): Promise<UpdateCandidateProfileResult>
  onSearch(input: SearchCandidateProfilesInput): Promise<CandidateProfileSearchResult[]>
  onLoadHistory(sourceDocumentId: string): Promise<CandidateProfileVersionDetail[]>
  onLoadOriginalDocument(sourceDocumentId: string): Promise<OriginalDocumentPreview>
  onOpenOriginalDocument(sourceDocumentId: string): Promise<unknown>
  onPreviewDeletion(sourceDocumentId: string): Promise<CandidateDeletionPreview>
  onDeleteCandidate(input: DeleteCandidateDataInput): Promise<{ report: DataDeletionReport }>
}

function confirmedDate(value: string, locale: 'ja-JP' | 'zh-CN'): string {
  return new Intl.DateTimeFormat(locale, { year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(value))
}

export function CandidateLibrary({
  profileRequest,
  aiCommerce,
  analyses = [],
  onImportResume,
  onOpenCloudSettings,
  onSendCloudPrompt,
  onUpdateCandidate,
  onSearch,
  onLoadHistory,
  onLoadOriginalDocument,
  onOpenOriginalDocument,
  onPreviewDeletion,
  onDeleteCandidate
}: CandidateLibraryProps) {
  useRendererUiRefresh()
  const locale = useUiLocale()
  const [query, setQuery] = useState('')
  const [submittedQuery, setSubmittedQuery] = useState('')
  const [results, setResults] = useState<CandidateProfileSearchResult[]>([])
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading')
  const [error, setError] = useState<string | null>(null)
  const [history, setHistory] = useState<{
    candidate: CandidateProfileSearchResult
    status: 'loading' | 'ready' | 'error'
    versions: CandidateProfileVersionDetail[]
    error: string | null
  } | null>(null)
  const historyRequest = useRef(0)
  const [deletionReport, setDeletionReport] = useState<DataDeletionReport | null>(null)

  const runSearch = async (input: SearchCandidateProfilesInput) => {
    setStatus('loading')
    setError(null)
    try {
      const next = await onSearch(input)
      setResults(next)
      setSubmittedQuery(input.query.trim())
      setStatus('ready')
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '候補者を検索できませんでした。')
      setStatus('error')
    }
  }

  useEffect(() => {
    void runSearch({ query: '', maxResults: 30 })
  }, [])

  const submit = (event: FormEvent) => {
    event.preventDefault()
    void runSearch({ query, maxResults: 30 })
  }

  const openHistory = async (candidate: CandidateProfileSearchResult) => {
    const request = ++historyRequest.current
    setHistory({ candidate, status: 'loading', versions: [], error: null })
    try {
      const versions = await onLoadHistory(candidate.sourceDocumentId)
      if (historyRequest.current !== request) return
      setHistory({ candidate, status: 'ready', versions, error: null })
    } catch (cause) {
      if (historyRequest.current !== request) return
      setHistory({
        candidate,
        status: 'error',
        versions: [],
        error: cause instanceof Error ? cause.message : 'プロフィール履歴を読み込めませんでした。'
      })
    }
  }

  const closeDetail = () => {
    historyRequest.current += 1
    setHistory(null)
  }

  useEffect(() => {
    if (!profileRequest) return
    let active = true
    void onSearch({ query: '', sourceDocumentId: profileRequest.documentId, maxResults: 1 }).then((candidates) => {
      if (!active) return
      if (candidates[0]) void openHistory(candidates[0])
      else setError(locale === 'zh-CN' ? '人员资料不存在或已停用。' : '要員情報が見つからないか無効です。')
    }).catch((cause) => { if (active) setError(String(cause)) })
    return () => { active = false; historyRequest.current += 1 }
  }, [profileRequest])

  if (history) {
    return <CandidateProfileDetail
      aiCommerce={aiCommerce}
      analysis={analyses.find((analysis) => analysis.fileToken === history.candidate.sourceDocumentId)}
      candidate={history.candidate}
      historyError={history.error}
      historyStatus={history.status}
      onBack={closeDetail}
      onDeleteCandidate={async (input) => {
        const result = await onDeleteCandidate(input)
        setDeletionReport(result.report)
        closeDetail()
        await runSearch({ query: submittedQuery, maxResults: 30 })
        return result.report
      }}
      onOpenCloudSettings={onOpenCloudSettings}
      onLoadOriginalDocument={onLoadOriginalDocument}
      onOpenOriginalDocument={onOpenOriginalDocument}
      onPreviewDeletion={onPreviewDeletion}
      onSendCloudPrompt={onSendCloudPrompt}
      onUpdateCandidate={async (input) => {
        const result = await onUpdateCandidate(input)
        setResults((current) => current.map((candidate) => candidate.sourceDocumentId === result.candidate.sourceDocumentId ? result.candidate : candidate))
        setHistory({ candidate: result.candidate, status: 'ready', versions: result.history, error: null })
        return result
      }}
      versions={history.versions}
    />
  }

  return (
    <main className="candidate-library">
      <header className="candidate-library-header">
        <div>
          <span className="eyebrow">TALENT POOL</span>
          <h1>{locale === 'zh-CN' ? '人才池' : '人材プール'}</h1>
          <p>{locale === 'zh-CN' ? '导入的人员可直接用于推广和案件匹配。需要修正资料时，打开人员档案编辑。' : '取り込んだ要員はすぐに紹介と案件マッチングに利用できます。情報の修正はプロフィールを開いて行います。'}</p>
        </div>
        <div className="candidate-library-header-actions">
          {onImportResume ? <button onClick={onImportResume} type="button"><Icon name="upload" size={16} />履歴書をインポート</button> : null}
          <div className="candidate-library-stat" aria-label="候補者プールの状態">
            <strong>{status === 'loading' ? '—' : results.length}</strong>
            <span>{submittedQuery ? (locale === 'zh-CN' ? '搜索结果' : '検索結果') : (locale === 'zh-CN' ? '可推荐人才' : '推薦可能人材')}</span>
          </div>
        </div>
      </header>

      <section className="candidate-search-card" aria-label="候補者検索">
        <form onSubmit={submit} role="search">
          <Icon name="search" size={19} />
          <input
            aria-label="候補者の条件"
            maxLength={200}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="例：Java AWS 8月 リモート"
            value={query}
          />
          {query ? <button className="candidate-search-clear" onClick={() => setQuery('')} type="button">クリア</button> : null}
          <button className="candidate-search-submit" disabled={status === 'loading'} type="submit">
            {status === 'loading' ? '検索中…' : '検索'}
          </button>
        </form>
        <div className="candidate-search-policy">
          <Icon name="lock" size={15} />
          <span>硬条件三態（不明は除外しない）→ BM25 + Profile/Project Vector → RRF → Local AI Rerank</span>
          <span>本人情報は端末内で暗号化</span>
          <span>{locale === 'zh-CN' ? '已确认可参与案件推荐的人员' : '紹介可能と確認済みの要員'}</span>
        </div>
      </section>

      {error ? <div className="candidate-library-error" role="alert"><Icon name="alert" size={17} />{error}</div> : null}

      {status === 'ready' && results.length === 0 ? (
        <section className="candidate-library-empty">
          <span><Icon name="users" size={24} /></span>
          <h2>{submittedQuery ? (locale === 'zh-CN' ? '没有找到匹配的人才' : '一致する人材が見つかりません') : (locale === 'zh-CN' ? '人才池中还没有可推荐人才' : '人材プールにはまだ推薦可能な人材がいません')}</h2>
          <p>{submittedQuery ? (locale === 'zh-CN' ? '请减少条件或更换关键词后重试。' : '条件を減らすか、表記を変えて再検索してください。') : (locale === 'zh-CN' ? '请在人员推广页面确认资料和可推广状态，也可通过原有招聘流程取得推荐资格。' : '要員紹介画面で情報と紹介可否を確認すると表示されます。従来の採用通過でも推薦資格を取得できます。')}</p>
          {!submittedQuery && onImportResume ? <button className="candidate-library-empty-action" onClick={onImportResume} type="button"><Icon name="upload" size={15} />最初の履歴書をインポート</button> : null}
        </section>
      ) : null}

      <section className="candidate-results" aria-live="polite">
        {results.map((candidate) => {
          const displayName = candidate.localIdentity?.displayName ?? null
          const visibleFields = (submittedQuery && candidate.evidence.length > 0
            ? candidate.evidence
            : candidate.fields.filter((field) => field.value)).slice(0, 5)
          const unknownHardFilterCount = candidate.retrieval.hardFilters.filter((filter) => filter.outcome === 'unknown').length
          return (
            <article className="candidate-profile-card" key={candidate.id}>
              <header>
                <div className="candidate-identity">
                  <span className="candidate-monogram">{(displayName ?? candidate.anonymousLabel).slice(-2)}</span>
                  <div>
                    <h2>{displayName ?? candidate.anonymousLabel}</h2>
                    <p><Icon name="check" size={13} />{displayName ? `${candidate.anonymousLabel} · ` : ''}候補者プロフィール確認済み · {confirmedDate(candidate.confirmedAt, locale)} · v{candidate.version} · Project {candidate.projectExperiences.length}</p>
                  </div>
                </div>
                {candidate.matchScore !== null ? (
                  <div className="candidate-score"><strong>{candidate.matchScore}</strong><span>適合スコア</span></div>
                ) : (
                  <span className="candidate-active-pill">ELIGIBLE</span>
                )}
              </header>

              {candidate.localIdentity?.phone || candidate.localIdentity?.email ? (
                <div className="candidate-contact-preview">
                  {candidate.localIdentity.phone ? <span><Icon name="phone" size={12} />{candidate.localIdentity.phone}</span> : null}
                  {candidate.localIdentity.email ? <span><Icon name="mail" size={12} />{candidate.localIdentity.email}</span> : null}
                </div>
              ) : null}

              {candidate.matchedTerms.length > 0 ? (
                <div className="candidate-match-terms" aria-label="一致条件">
                  {candidate.matchedTerms.map((term) => <span key={term}><Icon name="check" size={12} />{term}</span>)}
                </div>
              ) : null}

              <CandidateHardFilterEvidence filters={candidate.retrieval.hardFilters} />

              {candidate.projectEvidence ? (
                <section className="candidate-project-evidence" aria-label="プロジェクト一致根拠">
                  <div><span>PROJECT EVIDENCE · {candidate.projectEvidence.matchType.toUpperCase()}</span><strong>{candidate.projectEvidence.title}</strong></div>
                  <p>{candidate.projectEvidence.summary}</p>
                  <div>
                    {candidate.projectEvidence.period ? <span>{candidate.projectEvidence.period}</span> : null}
                    {candidate.projectEvidence.role ? <span>{candidate.projectEvidence.role}</span> : null}
                    {candidate.projectEvidence.technologies.slice(0, 6).map((technology) => <span key={technology}>{technology}</span>)}
                  </div>
                  <small>{summarizeSourceLabels(candidate.projectEvidence.sourceLabels, locale)}</small>
                </section>
              ) : null}

              {candidate.retrieval.rank !== null ? (
                <div className="candidate-retrieval-meta" aria-label="ローカル検索の根拠">
                  <span>{candidate.retrieval.strategy === 'hard-filter-hybrid-local-rerank-v1'
                    ? 'LOCAL AI RERANK'
                    : candidate.retrieval.strategy === 'hard-filter-hybrid-rrf-v1' ? 'LOCAL HYBRID' : 'LOCAL BM25'}</span>
                  <strong>Rank {candidate.retrieval.rank}</strong>
                  {candidate.retrieval.rerankerRank !== null ? <span>Rerank #{candidate.retrieval.rerankerRank}</span> : null}
                  {candidate.retrieval.preRerankRank !== null ? <span>RRF #{candidate.retrieval.preRerankRank}</span> : null}
                  {candidate.retrieval.bm25Rank !== null ? <span>BM25 #{candidate.retrieval.bm25Rank}</span> : null}
                  {candidate.retrieval.vectorRank !== null ? <span>Vector #{candidate.retrieval.vectorRank}</span> : null}
                  {candidate.retrieval.vectorScore !== null ? <span>類似 {Math.round(candidate.retrieval.vectorScore * 100)}%</span> : null}
                  {candidate.retrieval.termCoverage !== null ? <span>語句 {candidate.retrieval.termCoverage}%</span> : null}
                  {candidate.retrieval.hardFilters.length > 0 ? (
                    <span>{unknownHardFilterCount > 0 ? `硬条件 未確認${unknownHardFilterCount}件` : '硬条件 確認済み'}</span>
                  ) : null}
                </div>
              ) : null}

              <div className="candidate-field-grid">
                {visibleFields.map((field) => (
                  <div key={field.key}>
                    <span>{field.label}</span>
                    <strong>{field.value}</strong>
                    <small>{field.sourceLabels.length > 0 ? summarizeSourceLabels(field.sourceLabels, locale) : '根拠確認済み'}</small>
                  </div>
                ))}
              </div>

              <footer>
                <span><Icon name="shield" size={14} />ローカル暗号化プロフィール · Cloud送信前に脱敏</span>
                <button onClick={() => void openHistory(candidate)} type="button">完全なプロフィールを見る</button>
              </footer>
            </article>
          )
        })}
      </section>

      {deletionReport ? (
        <section className="candidate-deletion-report" aria-label="削除レポート">
          <div><Icon name={deletionReport.outcome === 'completed' ? 'check' : 'alert'} size={18} /><strong>削除レポート</strong></div>
          <p>{deletionReport.outcome === 'completed' ? '候補者のローカルデータを削除しました。' : '一部コンポーネントの削除に失敗しました。'}</p>
          {deletionReport.components.backups === 'expired_pending' ? (
            <p>以前の復元パッケージには削除前データが残る可能性があります。新しいバックアップを作成し、旧パッケージを安全に廃棄してください。</p>
          ) : null}
          <span>Report {deletionReport.id.slice(0, 8)} · DB {deletionReport.components.database} · File {deletionReport.components.fileVault}</span>
          <button aria-label="削除レポートを閉じる" onClick={() => setDeletionReport(null)} type="button">×</button>
        </section>
      ) : null}
    </main>
  )
}
