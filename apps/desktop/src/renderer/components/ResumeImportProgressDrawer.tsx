import type { StagedLocalFile } from '@shared'
import { Icon } from './Icon'
import { useUiLocale } from '../i18n'

export type ResumeImportProgress = {
  phase: 'choosing' | 'creating' | 'parsing' | 'completed' | 'partial-failed' | 'error'
  taskId: string | null
  files: Array<{ token: string; name: string; status: 'queued' | 'parsing' | 'success' | 'error'; error: string | null }>
  error: string | null
}

interface ResumeImportProgressDrawerProps {
  progress: ResumeImportProgress | null
  onClose(): void
  onOpenCandidates(): void
  onOpenFailures(taskId: string): void
  onOpenReviewCenter(): void
}

export function ResumeImportProgressDrawer({ progress, onClose, onOpenCandidates, onOpenFailures, onOpenReviewCenter }: ResumeImportProgressDrawerProps) {
  const zh = useUiLocale() === 'zh-CN'
  if (!progress) return null
  const parsing = progress.phase === 'choosing' || progress.phase === 'creating' || progress.phase === 'parsing'
  const failed = progress.files.filter((file) => file.status === 'error')
  const succeeded = progress.files.filter((file) => file.status === 'success')
  const title = progress.phase === 'choosing' ? (zh ? '选择简历' : '履歴書を選択')
    : progress.phase === 'creating' ? (zh ? '正在安全创建导入任务' : '安全な取込タスクを作成中')
      : parsing ? (zh ? '正在本机解析简历' : '端末内で履歴書を解析中')
        : progress.phase === 'partial-failed' ? (zh ? '部分文件未能导入' : '一部のファイルを取り込めませんでした')
          : progress.phase === 'error' ? (zh ? '简历导入未完成' : '履歴書取込を完了できませんでした')
            : (zh ? '简历已进入待确认候选人库' : '履歴書を候補者確認待ちに登録しました')
  return <aside aria-label={zh ? '简历导入进度' : '履歴書取込の進捗'} className="resume-import-progress-drawer" role="dialog">
    <header><div><span className="eyebrow">LOCAL RESUME IMPORT</span><h2>{title}</h2><p>{zh ? '原文件加密保存在本机，不会直接上传；如启用 Cloud AI，仅发送脱敏后的必要内容。通过招聘面试前不会进入人才池。' : '原本は暗号化して端末内に保管し直接アップロードしません。Cloud AI を有効にした場合も必要な匿名化済み情報だけを送信し、採用面談通過前は人材プールに入りません。'}</p></div><button aria-label={zh ? '关闭导入进度' : '取込進捗を閉じる'} disabled={parsing} onClick={onClose} type="button">×</button></header>
    <div className="resume-import-progress-summary"><strong>{succeeded.length}/{progress.files.length}</strong><span>{zh ? '已完成本机解析' : '端末内解析を完了'}</span></div>
    {progress.error ? <p className="resume-import-progress-error" role="alert">{progress.error}</p> : null}
    <ol>{progress.files.map((file) => <li className={`is-${file.status}`} key={file.token}><Icon name={file.status === 'success' ? 'check' : file.status === 'error' ? 'alert' : 'file'} size={16} /><div><strong>{file.name}</strong><small>{file.status === 'queued' ? (zh ? '等待解析' : '解析待ち') : file.status === 'parsing' ? (zh ? '正在解析' : '解析中') : file.status === 'success' ? (zh ? '待确认档案' : 'プロフィール確認待ち') : (file.error ?? (zh ? '解析失败' : '解析に失敗しました'))}</small></div></li>)}</ol>
    {!parsing ? <footer>
      {succeeded.length > 0 ? <><button className="is-primary" onClick={onOpenCandidates} type="button">{zh ? '查看新候选人' : '新しい候補者を確認'}<Icon name="chevron-right" size={14} /></button><button onClick={onOpenReviewCenter} type="button">{zh ? '确认档案' : 'プロフィールを確認'}</button></> : null}
      {failed.length > 0 && progress.taskId ? <button onClick={() => onOpenFailures(progress.taskId!)} type="button">{zh ? '查看失败' : '失敗詳細'}</button> : null}
      {failed.length > 0 ? <span>{zh ? `${failed.length} 个文件可在活动记录中查看失败原因。` : `${failed.length} 件の失敗理由はアクティビティで確認できます。`}</span> : null}
      <button onClick={onClose} type="button">{zh ? '关闭' : '閉じる'}</button>
    </footer> : null}
  </aside>
}

export function progressFiles(files: StagedLocalFile[]): ResumeImportProgress['files'] {
  return files.map((file) => ({ token: file.token, name: file.name, status: 'queued', error: null }))
}
