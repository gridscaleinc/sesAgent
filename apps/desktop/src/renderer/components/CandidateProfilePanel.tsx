import { useEffect, useRef, useState } from 'react'
import type {
  AiCommerceCloudPromptResult,
  AiCommerceMembershipState,
  CandidateDeletionPreview,
  CandidateProfileSearchResult,
  CandidateProfileVersionDetail,
  DataDeletionReport,
  DeleteCandidateDataInput,
  OriginalDocumentPreview,
  PrepareAiCommerceCloudPromptInput,
  ResumeAnalysisSummary,
  SearchCandidateProfilesInput,
  UpdateCandidateProfileInput,
  UpdateCandidateProfileResult
} from '@shared'
import { localeText, localizedIpcError, useUiLocale } from '../i18n'
import { CandidateProfileDetail } from './CandidateProfileDetail'
import './candidate-profile-panel.css'

export interface CandidateProfilePanelActions {
  aiCommerce?: AiCommerceMembershipState
  analyses?: ResumeAnalysisSummary[]
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

type ProfileState = {
  candidate: CandidateProfileSearchResult
  status: 'loading' | 'ready' | 'error'
  versions: CandidateProfileVersionDetail[]
  error: string | null
}

/** The full personnel profile (edit, history, original resume, deletion) in the right panel, so HR never leaves the list for it. */
export function CandidateProfilePanel({
  documentId,
  onClose,
  onDeleteCandidate,
  onUpdateCandidate,
  onSearch,
  onLoadHistory,
  analyses = [],
  ...rest
}: CandidateProfilePanelActions & { documentId: string; onClose(): void }) {
  const locale = useUiLocale(),
    zh = locale === 'zh-CN'
  const t = localeText(zh)
  const [profile, setProfile] = useState<ProfileState | null>(null)
  const [error, setError] = useState<string | null>(null)
  const request = useRef(0)
  useEffect(() => {
    const id = ++request.current
    setProfile(null)
    setError(null)
    void (async () => {
      try {
        const [candidate] = await onSearch({ query: '', sourceDocumentId: documentId, maxResults: 1 })
        if (id !== request.current) return
        if (!candidate) {
          setError(t('人员资料不存在或已停用。', '要員情報が見つからないか無効です。'))
          return
        }
        setProfile({ candidate, status: 'loading', versions: [], error: null })
        try {
          const versions = await onLoadHistory(candidate.sourceDocumentId)
          if (id === request.current) setProfile({ candidate, status: 'ready', versions, error: null })
        } catch (cause) {
          if (id === request.current)
            setProfile({
              candidate,
              status: 'error',
              versions: [],
              error: localizedIpcError(locale, cause, t('无法读取资料历史。', 'プロフィール履歴を読み込めませんでした。'))
            })
        }
      } catch (cause) {
        if (id === request.current) setError(localizedIpcError(locale, cause, t('无法读取人员资料。', '要員情報を読み込めませんでした。')))
      }
    })()
    return () => {
      request.current += 1
    }
  }, [documentId])
  if (error)
    return (
      <p className="candidate-profile-status" role="alert">
        {error}
      </p>
    )
  if (!profile)
    return (
      <p className="candidate-profile-status" role="status">
        {t('正在读取人员资料…', '要員情報を読み込み中…')}
      </p>
    )
  return (
    <div className="candidate-profile-panel">
      <CandidateProfileDetail
        {...rest}
        analysis={analyses.find((analysis) => analysis.fileToken === profile.candidate.sourceDocumentId)}
        candidate={profile.candidate}
        versions={profile.versions}
        historyStatus={profile.status}
        historyError={profile.error}
        onBack={onClose}
        onDeleteCandidate={async (input) => {
          const result = await onDeleteCandidate(input)
          onClose()
          return result.report
        }}
        onUpdateCandidate={async (input) => {
          const result = await onUpdateCandidate(input)
          setProfile({ candidate: result.candidate, status: 'ready', versions: result.history, error: null })
          return result
        }}
      />
    </div>
  )
}
