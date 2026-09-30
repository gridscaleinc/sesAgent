import type { ApplicationLocale, CandidateFieldKey, JobCaseFieldKey } from '@shared'
import { jobCaseFieldCanonicalLabels } from '@shared'

/**
 * Main, the workers and the shared packages write operator-facing text in
 * Japanese only (task plans and messages, job progress, status and field
 * labels, error messages). Renderer copy never goes through this module: it is
 * written inline as t('中文', '日本語'). This catalog is the one explicit place
 * where Main-originated Japanese is shown in Simplified Chinese. Lookups are
 * exact (after whitespace normalisation) so candidate, case and user-authored
 * text is never rewritten; unknown text is returned unchanged.
 */
const mainMessageZh = new Map<string, string>([
  ['[送信前に記入]', '[发送前填写]'],
  ['コア情報の補足が必要', '核心信息待补充'],
  ['完了', '已完成'],
  ['開始', '开始'],
  ['稼働可能時期', '可入场时间'],
  ['希望勤務地', '期望工作地点'],
  ['開始待ち', '待开始'],
  ['進行中', '进行中'],
  ['件', '项'],
  ['要員情報', '人员资料'],
  ['案件情報', '案件资料'],
  ['要員紹介', '人员推广'],
  ['言語', '语言'],
  ['日本語', '日文'],
  ['回', '次'],
  ['経験年数', '经验年限'],
  ['稼働開始', '可入场时间'],
  ['勤務形態', '工作方式'],
  ['就労資格', '工作资格'],
  ['削除', '删除'],
  [' 面談', ' 面试'],
  ['案件', '案件'],
  ['スキル', '技能'],
  ['プロジェクト経験', '项目经历'],
  ['メール', '邮件'],
  ['手動案件の草稿を作成できませんでした。', '无法创建手工案件草稿。'],
  ['案件レビュー', '案件审核'],
  ['現在のローカルデータは再起動時に置き換えられます。', '当前本地数据将在重启时被替换。'],
  ['提案パッケージを書き出せませんでした。', '无法导出提案包。'],
  ['プロジェクト', '项目'],
  ['履歴書', '简历'],
  ['職務経歴書', '工作经历表'],
  ['人材', '人员'],
  ['経験', '经验'],
  ['単価', '单价'],
  ['稼働', '入场时间'],
  ['勤務', '工作方式'],
  ['勤務地', '工作地点'],
  ['復元', '恢复'],
  ['標準', '标准'],
  ['期間未記載', '未填写期间'],
  ['役割未記載', '未填写角色'],
  ['一致：', '匹配：'],
  ['対象', '对象'],
  ['人が確認した候補者プロフィールのみ', '仅使用人工确认的人员档案'],
  ['選択したローカルファイル', '选定的本地文件'],
  ['暗号化保管庫に安全に取り込んだファイルのみ', '仅使用安全导入加密存储库的文件'],
  ['選択した Gmail メッセージ', '选定的 Gmail 邮件'],
  ['ユーザーが明示的に選択したメッセージのみ', '仅使用用户明确选择的邮件'],
  ['選択した案件', '选定的案件'],
  ['現在の作業に明示的に紐づけた案件のみ', '仅使用与当前任务明确关联的案件'],
  ['ファイルを安全に解析', '安全解析文件'],
  ['形式、サイズ、ハッシュを確認します', '检查格式、大小和哈希'],
  ['個人識別情報をローカル処理', '在本机处理个人标识信息'],
  ['PII検出・置換・DLP再検査を行います', '执行 PII 检测、替换与 DLP 复检'],
  ['候補者プロフィールを抽出', '提取人员档案'],
  ['構造化結果と出典を作成します', '生成结构化结果与来源'],
  ['人の確認を待つ', '等待人工确认'],
  ['確認後のみ候補者プールへ登録します', '仅在确认后登记到人员库'],
  ['入力内容を整理', '整理输入内容'],
  ['メール署名と直接識別子をローカルで除去します', '在本机移除邮件签名与直接标识符'],
  ['案件項目を抽出', '提取案件字段'],
  ['技術・単価・精算・勤務地を構造化します', '结构化技术、单价、结算和工作地点'],
  ['重複を確認', '检查重复项'],
  ['既存案件とMessage/業務指紋を比較します', '与现有案件及消息/业务指纹进行比较'],
  ['低信頼項目を人が確認します', '由人工确认低置信度字段'],
  ['確認済み情報を収集', '收集已确认信息'],
  ['許可された案件・候補者だけを参照します', '仅引用获准的案件与人员'],
  ['脱敏コンテキストを作成', '创建脱敏上下文'],
  ['クラウド前にPII/DLPゲートを通します', '发送到云端前必须通过 PII/DLP 门'],
  ['提案下書きを生成', '生成提案草稿'],
  ['自動送信は行いません', '不会自动发送'],
  ['送信前レビュー', '发送前审核'],
  ['宛先・本文・添付の承認を待ちます', '等待收件人、正文与附件审批'],
  ['検索条件を解析', '解析搜索条件'],
  ['必須条件と不明点を分離します', '区分必备条件与未知项'],
  ['候補者プールを検索', '搜索人员库'],
  ['候補者を比較', '比较人员'],
  ['一致・不足・リスクを根拠付きで整理します', '基于依据整理匹配项、不足与风险'],
  ['提案対象は営業担当が決定します', '提案对象由销售负责人决定'],
  ['許可されたデータ範囲と統制ポリシーを確認しました。以下の計画で作業します。', '已确认获准的数据范围与治理策略，将按以下计划执行任务。'],
  ['確認済みプレビューと同じデータ範囲でローカルタスクを作成しました。', '已按确认后的预览范围创建本地任务。'],
  ['検索条件を構造化できませんでした。条件を追加してから再実行してください。', '无法结构化搜索条件，请补充条件后重新执行。'],
  ['構造化検索条件がないため候補者検索を開始しませんでした。', '由于没有结构化搜索条件，未开始人员搜索。'],
  [
    '前回の実行が完了前に終了しました。自動で外部処理を再実行せず、確認待ちとして復元しました。',
    '上次执行在完成前结束；未自动重试外部处理，已恢复为等待确认状态。'
  ],
  ['中断した実行を自動再送せず、確認可能な状態へ復元しました。', '未自动重新发送中断的执行，已恢复为可确认状态。'],
  ['この作業はキャンセルできません。', '此任务无法取消。'],
  ['この作業をキャンセルしました。既に確認・保存された元データは削除していません。', '已取消此任务；已确认并保存的原始数据未被删除。'],
  ['未完了ステップを停止し、既存の受管データは保持しました。', '已停止未完成步骤，并保留现有受管数据。'],
  ['キャンセル済みまたは失敗した作業だけを再実行できます。', '仅可重新执行已取消或失败的任务。'],
  [
    '同じデータ範囲とプライバシーポリシーで再実行を準備しました。外部副作用はまだありません。',
    '已按相同数据范围和隐私策略准备重新执行；尚未产生外部操作。'
  ],
  ['元の確認済みデータ範囲を拡大せず、ローカル再実行を準備しました。', '已在不扩大原确认数据范围的情况下准备本地重新执行。'],
  [
    '端末内テンプレートで提案下書きを作成しました。宛先・本文・匿名添付を確認してください。',
    '已使用本机模板创建提案草稿，请确认收件人、正文及匿名附件。'
  ],
  ['確認済み案件と匿名候補者フィールドだけでローカル下書きを生成しました。', '仅使用已确认案件和匿名人员字段生成本地草稿。'],
  ['現在の内容ハッシュに対する送信前確認を記録しました。自動送信は行いません。', '已记录当前内容哈希的发送前确认；不会自动发送。'],
  [
    '宛先・本文・匿名添付・プライバシー確認を現在の内容ハッシュに固定しました。',
    '已将收件人、正文、匿名附件及隐私确认锁定到当前内容哈希。'
  ],
  ['承認済み提案パッケージをローカルへ書き出しました。メールは送信していません。', '已将批准后的提案包导出到本地；未发送邮件。'],
  ['承認済み提案パッケージ', '已批准的提案包'],
  ['承認済み内容ハッシュと一致するローカル ZIP だけを書き出しました。', '仅导出了与已批准内容哈希一致的本地 ZIP。'],
  ['アプリ外での送信確認', '应用外发送确认'],
  ['先方からの返信', '对方回复'],
  ['原ファイルを端末内で解析し、クラウド経路を使用しませんでした。', '原始文件已在本机解析，未使用云端路径。'],
  ['作業内容を8文字以上で入力してください。', '请输入至少 8 个字符的任务内容。'],
  ['添付ファイル', '附件'],
  ['必須スキル', '必需技能'],
  ['尚可スキル', '加分技能'],
  ['原始ファイルを読み込めませんでした。', '无法读取原始文件。'],
  ['性別', '性别'],
  ['国籍', '国籍'],
  ['登録済みローカル人材プロフィールだけを端末内で検索しました。', '仅在本机搜索了已入库的人员档案。'],
  [
    '硬条件・BM25・ベクトル・端末内AI精査で確認済みローカル人材プロフィールを検索します',
    '通过硬性条件、BM25、向量及本机 AI 复核来搜索已确认的本机人员档案'
  ],
  ['現在の内容でローカル人材プロフィールを登録しました。', '已按当前内容登记本机人员档案。'],
  ['ローカル解析が完了しました。候補者フィールドは任意で確認できます。', '本机解析已完成，人员字段可按需确认。'],
  ['人材プロフィールを暗号化ローカルデータベースへ保存しました。', '人员档案已保存至加密的本机数据库。'],
  ['技術スタック', '技术栈'],
  ['読む', '阅读'],
  ['書く', '书写'],
  ['日本語レベル', '日语能力'],
  ['希望勤務地・通勤範囲', '期望工作地点及通勤范围'],
  ['就労資格（国籍は保存しない）', '工作资格（不保存国籍）'],
  ['職務要約', '职业摘要'],
  ['技術', '技术'],
  ['確認待ち', '待确认'],
  [
    'ローカルのプライバシー品質ゲートを確認できないため、Cloud AI を停止しました。データ安全画面で状態を確認してください。',
    '本机隐私质量检查未通过，云端 AI 已停止。请在“数据安全”中检查状态。'
  ],
  ['プライバシー品質証跡と現在の実装を結び付けられないため、Cloud AI を停止しました。', '隐私质量证据无法与当前实现绑定，云端 AI 已停止。'],
  ['Cloud AI を使うには、ローカルの氏名検出が利用可能である必要があります。', '本机姓名检测当前不可用，因此已停止云端 AI。'],
  ['別の Cloud AI 要求が進行中です。完了後にもう一度実行してください。', '另一个云端 AI 请求正在进行，请等待完成后重试。'],
  ['です。', '。'],
  ['面談を予約', '预约面试'],
  ['記録を見る', '查看记录'],
  ['Zoom会議リンク', 'Zoom 会议链接'],
  ['Google Meetリンク', 'Google Meet 链接'],
  ['新しい会話', '新建会话'],
  ['チャット貼り付け案件', '聊天粘贴案件'],
  ['キャンセル', '已取消'],
  ['候補者プロフィールが存在しないか、現在参照できません。', '人员档案不存在或当前无法读取。'],
  ['ロール', '角色'],
  ['・要補完', '，待补充'],
  ['本文に識別子が残っています（', '文案里还有识别符（'],
  ['自社', '自社'],
  ['非自社', '非自社'],
  // Stored work-authorization values (candidateWorkAuthorizationValues).
  ['就労制限なし', '无就业限制'],
  ['就労資格あり（職種・期限要確認）', '有工作资格（需确认职种与期限）'],
  ['資格外活動のみ（制限あり）', '仅限资格外活动（有限制）'],
  ['就労不可', '不可就业'],
  // Approval gates Main creates for each task preview (requiredApprovals).
  ['提案内容', '提案内容'],
  ['抽出結果', '提取结果'],
  ['参画済み', '已进场'],
  ['次の面談を予約', '安排下一轮面试'],
  ['要員の候補日時', '人员可用时间'],
  ['案件側の候補日時', '案件方可用时间'],
  ['面談結果を記録', '记录面试结果'],
  ['集合時間', '报到时间'],
  ['第', '第'],
  ['対応を再開', '恢复跟进'],
  ['宛先', '收件人'],
  ['担当', '我的'],
  ['推薦済み', '已推荐'],
  ['スキルシート', '技能表'],
  ['開発ビルド・暗号化ローカルDB・サンプルデータ', '开发版本 · 加密本地数据库 · 示例数据'],
  ['候補者', '人员'],
  ['要員', '人员'],
  ['作業内容', '工作内容'],
  ['スキルシート取込', '导入技能表'],
  ['提案下書き', '准备提案草稿'],
  ['要対応', '需处理'],
  ['提案', '提案'],
  ['提案パッケージ', '提案包'],
  ['面談進行', '面谈进行中'],
  ['参画決定', '决定入场'],
  ['見送り', '未通过'],
  ['候補者辞退', '人员辞退'],
  ['役割', '角色'],
  ['プロフィール未設定', '档案未设置'],
  ['管理者設定', '管理员设置'],
  ['確認済み候補者プール', '已确认人员库'],
  ['期間', '期间'],
  ['候補者検索', '人员搜索'],
  ['検索', '搜索'],
  ['候補者比較結果', '人员比较结果'],
  ['稼働時期', '可入场时间'],
  ['希望単価', '期望单价'],
  ['本機ユーザー', '本机用户'],
  ['案件登録', '案件登记'],
  ['入力待ち', '等待输入'],
  ['なし', '无'],
  ['業務', '业务'],
  ['Java / Spring Boot / AWS案件の候補者を照合したい', '匹配 Java / Spring Boot / AWS 案件的人员'],
  ['EC決済基盤案件の提案メール下書きを準備したい', '准备支付平台案件的提案邮件草稿']
])

/** Chinese labels for the built-in job-case fields; Main writes these fields under jobCaseFieldCanonicalLabels. */
const jobCaseFieldLabelsZh: Record<JobCaseFieldKey, string> = {
  title: '案件名称',
  role: '招聘角色',
  industry: '行业',
  required_skills: '必需技能',
  preferred_skills: '加分技能',
  rate: '单价',
  settlement: '结算',
  location: '工作地点',
  remote: '远程',
  start_date: '入场时间',
  working_hours: '工作时间',
  japanese_level: '日语能力',
  interview: '面试次数',
  headcount: '招聘人数',
  contract_chain: '商流',
  payment_terms: '付款周期',
  work_authorization: '工作资格',
  notes: '备注'
}

/** Chinese labels for the candidate profile fields Main extracts from a résumé. */
const candidateFieldLabelsZh: Record<CandidateFieldKey, string> = {
  skills: '技能',
  experience_years: '经验年限',
  availability: '可入场时间',
  rate: '期望单价',
  japanese_level: '日语能力',
  work_style: '工作方式',
  role: '角色',
  location: '期望工作地点及通勤范围',
  work_authorization: '工作资格（不保存国籍）'
}

for (const [key, label] of Object.entries(jobCaseFieldCanonicalLabels) as Array<[JobCaseFieldKey, string]>) {
  if (!mainMessageZh.has(label)) mainMessageZh.set(label, jobCaseFieldLabelsZh[key])
}

/** The label of a built-in job-case field in the operator's language. */
export function localizedJobCaseFieldLabel(locale: ApplicationLocale, key: JobCaseFieldKey): string {
  return locale === 'zh-CN' ? jobCaseFieldLabelsZh[key] : jobCaseFieldCanonicalLabels[key]
}

/** A job-case field label sent by Main, named by its key in Chinese; the stored Japanese label is shown as written in ja-JP. */
export function localizedCaseFieldLabel(locale: ApplicationLocale, field: { key: string; label: string }): string {
  if (locale !== 'zh-CN') return field.label
  return jobCaseFieldLabelsZh[field.key as JobCaseFieldKey] ?? localizedMainText(locale, field.label)
}

/** A candidate field label sent by Main, named by its key in Chinese; the stored Japanese label is shown as written in ja-JP. */
export function localizedCandidateFieldLabel(locale: ApplicationLocale, field: { key: string; label: string }): string {
  if (locale !== 'zh-CN') return field.label
  return candidateFieldLabelsZh[field.key as CandidateFieldKey] ?? localizedMainText(locale, field.label)
}

/**
 * Messages Main composes from controlled task / job metadata. Keeping each
 * pattern anchored and narrow avoids translating a user-authored title or
 * source text that merely resembles one.
 */
function translatedMainPattern(source: string): string | null {
  // These templates are generated solely from controlled task metadata. Keeping
  // them narrow avoids translating a user-authored task title or source text.
  const taskMeta = /^(候補者検索|候補者マッチング|スキルシート取込|提案下書き)\s*·\s*証跡\s*(\d+)件$/u.exec(source)
  if (taskMeta) {
    const type = mainMessageZh.get(taskMeta[1]) ?? taskMeta[1]
    return `${type} · 证据 ${taskMeta[2]} 项`
  }
  const evidenceTab = /^証跡\s*(\d+)$/u.exec(source)
  if (evidenceTab) return `证据 ${evidenceTab[1]}`
  const candidateResultTab = /^候補者\s*(\d+)$/u.exec(source)
  if (candidateResultTab) return `人员 ${candidateResultTab[1]}`
  const importResultTab = /^取込\s*(\d+)$/u.exec(source)
  if (importResultTab) return `导入 ${importResultTab[1]}`
  const updatedAt = /^更新\s*(\d{1,2}:\d{2})$/u.exec(source)
  if (updatedAt) return `更新 ${updatedAt[1]}`
  const taskReviewMetadata = /^進捗\s*(\d+)%\s*·\s*証跡\s*(\d+)件$/u.exec(source)
  if (taskReviewMetadata) return `进度 ${taskReviewMetadata[1]}% · 证据 ${taskReviewMetadata[2]} 项`
  const candidateReviewMetadata = /^抽出項目\s*(\d+)件\s*·\s*案件経歴\s*(\d+)件$/u.exec(source)
  if (candidateReviewMetadata) return `提取字段 ${candidateReviewMetadata[1]} 项 · 案件经历 ${candidateReviewMetadata[2]} 项`
  const caseReviewMetadata = /^確認項目\s*(\d+)件\s*·\s*注意\s*(\d+)件$/u.exec(source)
  if (caseReviewMetadata) return `确认项 ${caseReviewMetadata[1]} 项 · 注意 ${caseReviewMetadata[2]} 项`

  const hybridRetrievalCompleted = /^ローカル Hybrid Retrieval が完了しました。(\d+)件の証跡を確認してください。$/u.exec(source)
  if (hybridRetrievalCompleted) return `本地混合检索已完成，请确认 ${hybridRetrievalCompleted[1]} 项证据。`
  const candidateSearchStarted = /^端末内の候補者検索ジョブを開始しました（試行\s*(\d+)）。$/u.exec(source)
  if (candidateSearchStarted) return `已启动本机人员搜索任务（尝试 ${candidateSearchStarted[1]}）。`
  const candidateSearchFailed = /^候補者検索ジョブを完了できませんでした（(.+)）。自動で外部処理は再実行しません。$/u.exec(source)
  if (candidateSearchFailed) return `人员搜索任务未完成（${candidateSearchFailed[1]}）；不会自动重试外部处理。`
  const candidateSearchStopped = /^候補者検索ジョブを\s*(.+)\s*で停止しました。$/u.exec(source)
  if (candidateSearchStopped) return `人员搜索任务因 ${candidateSearchStopped[1]} 已停止。`
  const candidateSearchPaused = /^端末内候補者検索を一時停止しました（(.+)）。(.+)\s*以降に同じ範囲で再試行します。$/u.exec(source)
  if (candidateSearchPaused)
    return `本机人员搜索已暂停（${candidateSearchPaused[1]}），将在 ${candidateSearchPaused[2]} 之后按相同范围重试。`
  const safeRetryQueued = /^安全な端末内作業だけを\s*(.+)\s*から再試行待ちへ移しました。$/u.exec(source)
  if (safeRetryQueued) return `仅将安全的本机任务从 ${safeRetryQueued[1]} 转为等待重试。`
  const proposalFollowUp = /^(.+)を(.+)が端末内の営業履歴へ記録しました。メール送信や外部更新は実行していません。$/u.exec(source)
  if (proposalFollowUp) return `${proposalFollowUp[2]} 已将“${proposalFollowUp[1]}”记录到本机销售历史；未发送邮件或执行外部更新。`
  const proposalFollowUpAudit = /^(.+)を人工確認済みの営業結果としてローカル記録しました。$/u.exec(source)
  if (proposalFollowUpAudit) return `已将“${proposalFollowUpAudit[1]}”作为人工确认的销售结果记录在本机。`
  const proposalExportStarted = /^承認済み提案パッケージのローカル書き出しを開始しました（試行\s*(\d+)）。$/u.exec(source)
  if (proposalExportStarted) return `已开始在本地导出批准后的提案包（尝试 ${proposalExportStarted[1]}）。`
  const proposalExportFailed =
    /^提案パッケージの書き出しを確定できませんでした（(.+)）。自動再実行せず、保存先と内容を確認してください。$/u.exec(source)
  if (proposalExportFailed) return `无法确认提案包导出（${proposalExportFailed[1]}）；不会自动重试，请检查保存位置与内容。`
  const proposalExportStopped = /^外部ファイルの重複書き出しを避けるため\s*(.+)\s*で停止し、人工確認へ戻しました。$/u.exec(source)
  if (proposalExportStopped) return `为避免重复导出外部文件，已因 ${proposalExportStopped[1]} 停止并返回人工确认。`
  const resumeAnalysisStarted = /^端末内のスキルシート解析ジョブを開始しました（試行\s*(\d+)）。$/u.exec(source)
  if (resumeAnalysisStarted) return `已启动本机技能表解析任务（尝试 ${resumeAnalysisStarted[1]}）。`
  const resumeAnalysisFailed = /^スキルシートの端末内解析を完了できませんでした（(.+)）。原文をクラウドへ送らず停止しました。$/u.exec(
    source
  )
  if (resumeAnalysisFailed) return `技能表本机解析未完成（${resumeAnalysisFailed[1]}）；已停止且未将原文发送到云端。`
  const resumeAnalysisStopped = /^端末内解析ジョブを\s*(.+)\s*で停止し、原文のクラウド回退を禁止しました。$/u.exec(source)
  if (resumeAnalysisStopped) return `本机解析任务因 ${resumeAnalysisStopped[1]} 已停止，并禁止将原文回退到云端。`
  const resumeAnalysisPaused = /^端末内スキルシート解析を一時停止しました（(.+)）。(.+)\s*以降に同じファイルで再試行します。$/u.exec(source)
  if (resumeAnalysisPaused)
    return `本机技能表解析已暂停（${resumeAnalysisPaused[1]}），将在 ${resumeAnalysisPaused[2]} 之后使用相同文件重试。`
  const localOnlyRetry = /^原文をクラウドへ回退せず、端末内作業だけを\s*(.+)\s*から再試行待ちへ移しました。$/u.exec(source)
  if (localOnlyRetry) return `未将原文回退到云端，仅将本机任务从 ${localOnlyRetry[1]} 转为等待重试。`
  return null
}

function translatedMainText(source: string): string | null {
  return mainMessageZh.get(source) ?? mainMessageZh.get(source.replace(/\s+/gu, ' ').trim()) ?? translatedMainPattern(source)
}

/** Main-originated Japanese text in the operator's language; unknown text (including user data) is returned unchanged. */
export function localizedMainText(locale: ApplicationLocale, text: string): string {
  if (locale !== 'zh-CN' || !text) return text
  const match = /^(\s*)(.*?)(\s*)$/su.exec(text)
  if (!match) return text
  const [, prefix, source, suffix] = match
  const translated = translatedMainText(source)
  return translated ? `${prefix}${translated}${suffix}` : text
}

/** Whether Main-originated text has a Chinese rendering (used to decide between a Main message and a generic fallback). */
export function hasLocalizedMainText(text: string): boolean {
  return translatedMainText(text.trim()) !== null
}

const simplifiedChineseSampleTaskTitles: Readonly<Record<string, string>> = {
  'task-sample-001': '匹配 Java / Spring Boot / AWS 案件的人员',
  'task-sample-002': '准备支付平台案件的提案邮件草稿'
}

/** Built-in task instructions Main uses as task titles (sample data and command templates). */
const simplifiedChineseBuiltInTaskTemplates: ReadonlyArray<readonly [string, string]> = [
  [
    'Java経験5年以上、AWS、8月稼働、週3日リモート可の候補者を探したい',
    '查找 Java 经验 5 年以上、具备 AWS、8 月可入场且每周可远程 3 天的人员'
  ],
  ['選択したスキルシートを安全に取り込み、候補者プロフィールを作成したい', '安全导入选定的技能表并创建人员档案'],
  ['Java / Spring Boot / AWS案件の候補者を照合したい', '匹配 Java / Spring Boot / AWS 案件的人员'],
  ['EC決済基盤案件の提案メール下書きを準備したい', '准备支付平台案件的提案邮件草稿']
]

/** A Main-provided task title in the operator's language; operator-written titles are left as written. */
export function localizedTaskTitle(locale: ApplicationLocale, task: { id: string; title: string }): string {
  if (locale !== 'zh-CN') return task.title
  const sampleTitle = simplifiedChineseSampleTaskTitles[task.id]
  if (sampleTitle) return sampleTitle
  const builtInTitle = simplifiedChineseBuiltInTaskTemplates.find(
    ([source]) => task.title === source || (task.title.endsWith('…') && source.startsWith(task.title.slice(0, -1)))
  )
  return builtInTitle?.[1] ?? task.title
}
