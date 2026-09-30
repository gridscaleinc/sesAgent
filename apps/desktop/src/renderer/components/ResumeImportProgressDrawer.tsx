import type { StagedLocalFile } from '@shared'
import { Icon } from './Icon'
import { localeText, useUiLocale } from '../i18n'
import './resume-import-progress.css'

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
  /** 「为此人员找案件」 for one imported person. A staged file's token is the imported person's documentId. */
  onFindCases?(documentId: string): void
  /** Opens this imported person; without it 「查看人员」 falls back to the person list. */
  onOpenPerson?(documentId: string): void
}

export function ResumeImportProgressDrawer({
  progress,
  onClose,
  onOpenCandidates,
  onOpenFailures,
  onFindCases,
  onOpenPerson
}: ResumeImportProgressDrawerProps) {
  const zh = useUiLocale() === 'zh-CN'
  const t = localeText(zh)
  if (!progress) return null
  const parsing = progress.phase === 'choosing' || progress.phase === 'creating' || progress.phase === 'parsing'
  const failed = progress.files.filter((file) => file.status === 'error')
  const succeeded = progress.files.filter((file) => file.status === 'success')
  // One imported person gets the actions in the footer; several get them on each imported row.
  const single = !parsing && succeeded.length === 1 ? succeeded[0]! : null
  const findLabel = t('为此人员找案件', 'この要員の案件を探す')
  const viewLabel = t('查看人员', '要員を見る')
  const title =
    progress.phase === 'choosing'
      ? t('选择简历', '履歴書を選択')
      : progress.phase === 'creating'
        ? t('正在安全创建导入任务', '安全な取込タスクを作成中')
        : parsing
          ? t('正在本机解析简历', '端末内で履歴書を解析中')
          : progress.phase === 'partial-failed'
            ? t('部分文件未能导入', '一部のファイルを取り込めませんでした')
            : progress.phase === 'error'
              ? t('简历导入未完成', '履歴書取込を完了できませんでした')
              : t('人员资料已导入', '要員情報を取り込みました')
  return (
    <aside aria-label={t('简历导入进度', '履歴書取込の進捗')} className="resume-import-progress-drawer" role="dialog">
      <header>
        <div>
          <span className="eyebrow">LOCAL RESUME IMPORT</span>
          <h2>{title}</h2>
          <p>
            {t(
              '导入后可直接找案件或准备介绍；需要补充的内容可在人员资料中修改。',
              '取込後は案件探しや紹介の準備ができます。補足は要員情報から編集できます。'
            )}
          </p>
        </div>
        <button aria-label={t('关闭导入进度', '取込進捗を閉じる')} disabled={parsing} onClick={onClose} type="button">
          ×
        </button>
      </header>
      <div className="resume-import-progress-summary">
        <strong>
          {succeeded.length}/{progress.files.length}
        </strong>
        <span>{t('已完成本机解析', '端末内解析を完了')}</span>
      </div>
      {progress.error ? (
        <p className="resume-import-progress-error" role="alert">
          {progress.error}
        </p>
      ) : null}
      <ol>
        {progress.files.map((file) => (
          <li className={`is-${file.status}`} key={file.token}>
            <Icon name={file.status === 'success' ? 'check' : file.status === 'error' ? 'alert' : 'file'} size={16} />
            <div>
              <strong>{file.name}</strong>
              <small>
                {file.status === 'queued'
                  ? t('等待解析', '解析待ち')
                  : file.status === 'parsing'
                    ? t('正在解析', '解析中')
                    : file.status === 'success'
                      ? t('已导入', '取込済み')
                      : (file.error ?? t('解析失败', '解析に失敗しました'))}
              </small>
            </div>
            {!parsing && !single && file.status === 'success' && (onFindCases || onOpenPerson) ? (
              <span className="resume-import-person-actions">
                {onFindCases ? (
                  <button className="is-primary" onClick={() => onFindCases(file.token)} type="button">
                    {findLabel}
                  </button>
                ) : null}
                {onOpenPerson ? (
                  <button onClick={() => onOpenPerson(file.token)} type="button">
                    {viewLabel}
                  </button>
                ) : null}
              </span>
            ) : null}
          </li>
        ))}
      </ol>
      {!parsing ? (
        <footer>
          {single && onFindCases ? (
            <button className="is-primary" onClick={() => onFindCases(single.token)} type="button">
              {findLabel}
            </button>
          ) : null}
          {succeeded.length > 0 ? (
            <button
              className={single && onFindCases ? undefined : 'is-primary'}
              onClick={single && onOpenPerson ? () => onOpenPerson(single.token) : onOpenCandidates}
              type="button"
            >
              {single || !onOpenPerson ? viewLabel : t('查看人员列表', '要員一覧を見る')}
              <Icon name="chevron-right" size={14} />
            </button>
          ) : null}
          {failed.length > 0 && progress.taskId ? (
            <button onClick={() => onOpenFailures(progress.taskId!)} type="button">
              {t('查看失败', '失敗詳細')}
            </button>
          ) : null}
          {failed.length > 0 ? (
            <span>
              {t(`${failed.length} 个文件可在活动记录中查看失败原因。`, `${failed.length} 件の失敗理由はアクティビティで確認できます。`)}
            </span>
          ) : null}
          <button onClick={onClose} type="button">
            {t('关闭', '閉じる')}
          </button>
        </footer>
      ) : null}
    </aside>
  )
}

export function progressFiles(files: StagedLocalFile[]): ResumeImportProgress['files'] {
  return files.map((file) => ({ token: file.token, name: file.name, status: 'queued', error: null }))
}
