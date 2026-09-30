import type { GmailSyncState } from '@shared'
import './gmail-sync-feedback.css'
import { localeText } from '../i18n'

/** Keep receiving and business intake visible as separate outcomes. */
export function GmailSyncFeedback({ state, zh }: { state: GmailSyncState; zh: boolean }) {
  const t = localeText(zh)

  const run = state.lastRun
  const intake = run?.intake
  const pending = (intake?.pendingCases ?? 0) + (intake?.pendingPersonnel ?? 0)
  const failures = (intake?.casesFailed ?? 0) + (intake?.personnelFailed ?? 0)
  const errorText =
    state.lastError === 'GOOGLE_REAUTH_REQUIRED' || state.lastError === 'GMAIL_HTTP_401'
      ? t('邮箱授权已失效，请重新连接 Google 邮箱。', 'メールの認証が失効しました。Google メールを再接続してください。')
      : state.lastError === 'GMAIL_HTTP_403'
        ? t(
            'Google 拒绝了邮件读取，请检查账号权限或联系邮箱管理员。',
            'Google がメールの読み取りを拒否しました。権限を確認するかメール管理者に連絡してください。'
          )
        : state.lastError === 'SYNC_SCOPE_TOO_BROAD'
          ? t(
              '邮件范围暂时无法分批读取，请联系软件提供方检查同步配置。',
              '対象メールを分割して取得できません。提供元に同期設定の確認を依頼してください。'
            )
          : t(
              '本次邮件收取未完成，已保存的资料会保留。系统将自动重试，也可点击立即同步。',
              '今回のメール取得は未完了です。保存済みの資料を保持して自動再試行します。「今すぐ同期」でも再試行できます。'
            )
  return (
    <div className="gmail-sync-feedback" aria-live="polite">
      <p className="integration-settings-note">
        {t(
          `同步范围：最近 ${state.lookbackDays ?? 30} 天的业务邮件；应用启动后自动检查，运行期间约每 ${state.intervalMinutes ?? 1} 分钟收取一次。`,
          `同期対象：直近 ${state.lookbackDays ?? 30} 日の業務メール。起動後に確認し、起動中は約 ${state.intervalMinutes ?? 1} 分ごとに取得します。`
        )}
      </p>
      {run ? (
        <p>
          {t(
            `本批保存邮件 ${run.imported} 封，重复 ${run.duplicates} 封，范围外 ${run.filtered} 封，收取失败 ${run.failed} 封。`,
            `今回保存 ${run.imported}件、重複 ${run.duplicates}件、対象外 ${run.filtered}件、取得失敗 ${run.failed}件。`
          )}
        </p>
      ) : null}
      {intake ? (
        <p>
          {t(
            `本批新增有效案件 ${intake.casesConfirmed} 件、新增人员 ${intake.personnelCreated} 名；案件待处理 ${intake.casesNeedAttention} 件、入库失败 ${failures} 项。`,
            `今回の有効案件 ${intake.casesConfirmed}件、人材 ${intake.personnelCreated}名。案件の要確認 ${intake.casesNeedAttention}件、取込失敗 ${failures}件。`
          )}
        </p>
      ) : null}
      {run?.moreAvailable || pending > 0 ? (
        <p role="status">
          {t('还有邮件或资料待处理', '処理待ちのメール・資料があります')}
          {pending ? t(`（已收取待入库 ${pending} 封）`, `（取得済み・取込待ち ${pending}件）`) : ''}
          {t('，系统将继续分批处理。', '。引き続き分割して処理します。')}
        </p>
      ) : null}
      {state.status === 'error' ? <p role="alert">{errorText}</p> : null}
      {failures > 0 || (state.personnelIntake?.warnings ?? 0) > 0 || (intake?.casesNeedAttention ?? 0) > 0 ? (
        <p role="status">
          {t(
            '需要处理的案件可在案件列表查看；附件失败会自动重试。不支持的附件请转换为 PDF、DOCX 或 Excel 后导入，详情可在数据与隐私中查看。',
            '要確認の案件は案件一覧で確認できます。添付の失敗は自動再試行します。未対応の添付は PDF・DOCX・Excel に変換してください。詳細はデータとプライバシーで確認できます。'
          )}
        </p>
      ) : null}
    </div>
  )
}
