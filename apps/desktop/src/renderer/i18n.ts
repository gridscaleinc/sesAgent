import { createContext, createElement, useContext, useLayoutEffect, useMemo, type ReactNode } from 'react'
import type { ApplicationLocale } from '@shared'
import { zhCnUiCatalog } from './zh-cn-ui-catalog'

const UiLocaleContext = createContext<ApplicationLocale>('ja-JP')

export function UiLocaleProvider({ children, locale }: { children: ReactNode; locale: ApplicationLocale }) {
  return createElement(UiLocaleContext.Provider, { value: locale }, children)
}

export function useUiLocale(): ApplicationLocale {
  return useContext(UiLocaleContext)
}

/**
 * Existing renderer copy was authored in Japanese before a locale contract
 * existed. This strict, allow-listed bridge translates only known UI tokens;
 * it never runs a machine translator and leaves task instructions, candidate
 * data, case data and user-authored notes untouched.
 */
const japaneseToChinese = new Map<string, string>([
  ...zhCnUiCatalog,
  ['RESTRICTED BUSINESS TASK', '受限业务任务'],
  ['ACTIVE WORK', '当前工作'],
  ['開発ビルド', '开发版本'],
  ['開発ビルド・暗号化ローカルDB・サンプルデータ', '开发版本 · 加密本地数据库 · 示例数据'],
  ['macOS 試点ビルド · 暗号化ローカルDB', 'macOS 试点版本 · 加密本地数据库'],
  ['新しい作業', '新建任务'],
  ['メインナビゲーション', '主导航'],
  ['作業', '任务'],
  ['今日', '今日'],
  ['マイタスク', '我的任务'],
  ['案件', '案件'],
  ['候補者', '候选人'],
  ['候補者管理', '候选人管理'],
  ['統制', '治理'],
  ['レビュー', '审核'],
  ['実行の承認を確認', '确认执行审批'],
  ['実行の承認', '执行审批'],
  ['承認状態を更新できませんでした。', '无法更新审批状态。'],
  ['データポリシー', '数据策略'],
  ['表示と言語', '显示与语言'],
  ['表示と言語を設定', '设置显示与语言'],
  ['本機内の操作員プロフィールを設定', '设置本机操作员档案'],
  ['今日の作業', '今日任务'],
  ['案件・候補者・提案を、確認可能な一つの作業として進めます。', '将案件、候选人和提案作为一项可审核的任务推进。'],
  ['データと承認', '数据与审批'],
  ['バックアップ要確認', '需要确认备份'],
  ['データと承認・バックアップ要確認', '数据、审批与备份需要确认'],
  ['コマンドを検索', '搜索命令'],
  ['何を進めますか？', '准备推进什么工作？'],
  ['自然言語で指示すると、実行前にデータ範囲・手順・確認ポイントを表示します。', '输入自然语言目标后，执行前会展示数据范围、步骤和确认点。'],
  ['作業内容', '工作内容'],
  ['スキルシート取込', '导入技能表'],
  ['案件を登録', '登记案件'],
  ['候補者を探す', '查找候选人'],
  ['提案下書き', '准备提案草稿'],
  ['ファイルを添付', '添加文件'],
  ['Gmailを設定', '设置 Gmail'],
  ['Gmail読取専用接続を確認', '确认 Gmail 只读连接'],
  ['Gmail同期を再試行', '重试 Gmail 同步'],
  ['Gmailを同期して案件を確認', '同步 Gmail 并确认案件'],
  ['作業をプレビュー', '预览任务'],
  ['直接識別子はクラウド送信前にローカルで除去', '直接标识符会在发送到云端前于本地移除'],
  ['自動送信なし', '不自动发送'],
  ['進行中の作業', '进行中的任务'],
  ['未評価', '未评估'],
  ['データなし', '暂无数据'],
  ['すべて見る', '查看全部'],
  ['保存済みの作業', '已保存任务'],
  ['保存済みの作業、進捗、証跡と確認待ち状態を一つの一覧から再開できます。', '可在一个列表中恢复已保存任务、进度、证据和待确认状态。'],
  ['作業状態の集計', '任务状态汇总'],
  ['すべて', '全部'],
  ['進行中', '进行中'],
  ['確認待ち', '待确认'],
  ['要対応', '需处理'],
  ['タスクの指示・進捗・証跡は暗号化ローカルDBに保存 · Cloud送信なし', '任务指令、进度和证据保存在加密本地数据库 · 不发送到云端'],
  ['起動に失敗しました', '启动失败'],
  ['安全な作業環境を準備しています…', '正在准备安全的工作环境…'],
  ['今日の作業へ戻る', '返回今日任务'],
  ['完了', '已完成'],
  ['結果と統制', '结果与治理'],
  ['結果と統制の表示', '结果与治理视图'],
  ['提案', '提案'],
  ['証跡', '证据'],
  ['PROPOSAL REVIEW', '提案审核'],
  ['提案草稿', '提案草稿'],
  ['ローカル生成 · 内容ハッシュ承認 · 自動送信なし', '本地生成 · 内容哈希审批 · 不自动发送'],
  ['外部提供前の確認', '对外提供前确认'],
  ['提案パッケージ', '提案包'],
  ['提案後の営業結果', '提案后的销售进展'],
  ['手動記録 · Google Workspaceへの書込なし', '手工记录 · 不写入 Google Workspace'],
  ['未送信', '未发送'],
  ['次の状態', '下一状态'],
  ['アプリ外で送信済み', '已在应用外发送'],
  ['先方から返信あり', '对方已回复'],
  ['面談進行', '面谈进行中'],
  ['参画決定', '决定入场'],
  ['見送り', '未通过'],
  ['候補者辞退', '候选人辞退'],
  ['発生・予定日', '发生/预计日期'],
  ['営業メモ（任意）', '销售备注（选填）'],
  ['営業結果を記録', '记录销售结果'],
  ['営業結果の履歴', '销售结果记录'],
  ['端末内', '仅本机'],
  ['書出済み', '已导出'],
  ['承認済み', '已批准'],
  ['保存済み', '已保存'],
  ['変更を保存', '保存修改'],
  ['キャンセル', '取消'],
  ['保存中…', '保存中…'],
  ['暗号化して保存', '加密保存'],
  ['操作員プロフィール', '操作员档案'],
  ['操作員プロフィールを閉じる', '关闭操作员档案'],
  ['表示名', '显示名称'],
  ['役割', '角色'],
  ['プロフィール未設定', '档案未设置'],
  ['表示と言語の設定', '显示与语言设置'],
  ['表示と言語の設定を閉じる', '关闭显示与语言设置'],
  ['表示言語', '显示语言'],
  ['日本語', '日文'],
  ['中文（简体）', '中文（简体）'],
  ['日本語（日本）', '日文（日本）'],
  ['中文（简体，中国）', '中文（简体，中国）'],
  ['この端末だけに保存', '仅保存在此设备'],
  ['この端末の表示言語を選択できます。切替はすぐに反映されます。', '可选择此设备的显示语言，切换会立即生效。'],
  ['日本語で画面を表示します。', '使用日文显示界面。'],
  ['閉じる', '关闭'],
  ['言語設定はSQLCipher暗号化ローカルDBに保存され、AI・Gmail・Cloudには送信されません。', '语言设置保存于 SQLCipher 加密本地数据库，不会发送到 AI、Gmail 或云端。'],
  ['すぐに反映', '立即生效'],
  ['設定', '设置'],
  ['データと承認を開く', '打开数据与审批'],
  ['Google Workspaceを設定', '设置 Google Workspace'],
  ['Google メール', 'Google 邮箱'],
  ['Google メールを接続', '连接 Google 邮箱'],
  ['接続・同期中…', '正在连接并同步…'],
  ['Google メールデータの利用', 'Google 邮箱数据的使用方式'],
  ['接続すると、件名・送信者・本文・日時・Labelを読み取り、端末内で案件を識別します。添付ファイルは取得しません。Gmail接続処理では原文とTokenを当社サーバーやCloud AIへ送信しません。', '连接后，应用会读取邮件主题、发件人、正文、日期和 Label，并在本机识别案件。不会下载附件；Gmail 连接处理不会把邮件原文或 Token 发送到我们的服务器或 Cloud AI。'],
  ['接続ボタンを押すと、Googleの gmail.readonly 同意画面へ進みます。', '点击连接按钮后，将进入 Google 的 gmail.readonly 授权页面。'],
  ['個人 Gmail または Google Workspace の会社メールから、案件情報を読取専用で取り込みます。', '以只读方式从个人 Gmail 或 Google Workspace 公司邮箱导入案件信息。'],
  ['個人 Gmail または Google Workspace の会社メールを、システムブラウザと PKCE で読取専用接続します。', '通过系统浏览器和 PKCE，以只读方式连接个人 Gmail 或 Google Workspace 公司邮箱。'],
  ['このビルドでは未設定', '此版本尚未配置'],
  ['このビルドには Google メール接続が組み込まれていません。ソフトウェア提供元に連絡してください。', '此版本尚未内置 Google 邮箱连接，请联系软件提供方。'],
  ['Google の認証が失効しました。Google メールアカウントを再接続してください。', 'Google 授权已失效，请重新连接 Google 邮箱账号。'],
  ['Gmail API が認証を拒否しました。Google メールアカウントを再接続してください。', 'Gmail API 拒绝了授权，请重新连接 Google 邮箱账号。'],
  ['Gmail API の利用権限を確認できません。会社アカウントの場合は Workspace 管理者に本製品の許可を依頼してください。', '无法确认 Gmail API 使用权限。如果是公司账号，请让 Workspace 管理员放行本产品。'],
  ['Gmail の読取権限を取得できませんでした。個人アカウントは Gmail が有効な Google アカウントを使用してください。会社アカウントは Workspace 管理者に本製品の許可を依頼してください。', '无法取得 Gmail 读取权限。个人账号请使用已启用 Gmail 的 Google 账号；公司账号请让 Workspace 管理员放行本产品。'],
  ['Google Workspace', 'Google Workspace'],
  ['読取専用', '只读'],
  ['未接続', '未连接'],
  ['管理者設定待ち', '等待管理员设置'],
  ['接続事前診断', '连接前诊断'],
  ['オンライン受入検証', '在线验收验证'],
  ['管理者設定', '管理员设置'],
  ['接続する', '连接'],
  ['接続を解除', '断开连接'],
  ['同期する', '同步'],
  ['同期を再試行', '重试同步'],
  ['データと承認・バックアップ', '数据、审批与备份'],
  ['ローカルデータとCloud送信の境界を確認します。', '确认本地数据与云端发送的边界。'],
  ['ローカルAI', '本地 AI'],
  ['クラウド送信', '云端发送'],
  ['暗号化ローカルDB', '加密本地数据库'],
  ['バックアップを作成', '创建备份'],
  ['パッケージから復元', '从备份包恢复'],
  ['明日再通知', '明日再提醒'],
  ['7日後に再通知', '7 天后再提醒'],
  ['JSONを読み込む', '读取 JSON'],
  ['品質門通過', '质量门通过'],
  ['正式リリース不可', '不可正式发布'],
  ['リリース不可', '不可发布'],
  ['端末内のみ', '仅本机'],
  ['データと承認・バックアップ', '数据、审批与备份'],
  ['LOCAL WORK HISTORY', '本地任务历史'],
  ['入力', '输入'],
  ['データ', '数据'],
  ['最近の作業', '最近任务'],
  ['スキルシートを取り込む', '导入技能表'],
  ['ファイル選択後も実行前プレビューとローカル解析を維持します。', '选择文件后仍保持执行前预览和本地解析。'],
  ['案件を手動で追加', '手工添加案件'],
  ['貼り付けた件名・本文を端末内で脱敏してレビュー草稿にします。', '在设备内对粘贴的主题和正文脱敏，并生成审核草稿。'],
  ['管理者が固定したLabel・期間・上限だけを読取専用同期します。', '只读同步管理员固定的 Label、期间和上限。'],
  ['Desktop OAuth設定とgmail.readonlyの接続状態を確認します。', '确认 Desktop OAuth 设置与 gmail.readonly 连接状态。'],
  ['新しい作業を作成', '创建新任务'],
  ['自然言語で目的を入力し、データ範囲を実行前に確認します。', '输入自然语言目标，并在执行前确认数据范围。'],
  ['マイタスクを開く', '打开我的任务'],
  ['案件レビューを開く', '打开案件审核'],
  ['候補者プールを開く', '打开候选人池'],
  ['確認済み匿名プロフィールを検索・比較・管理します。', '搜索、比较和管理已确认的匿名档案。'],
  ['脱敏、Local AI、Google Workspace、品質門とバックアップを確認します。', '确认脱敏、Local AI、Google Workspace、质量门和备份。'],
  ['業務コマンド', '业务命令'],
  ['業務コマンドを検索', '搜索业务命令'],
  ['許可済みの入力・確認・管理画面だけを開きます。', '只打开已获允许的输入、确认和管理页面。'],
  ['一致する業務コマンドがありません', '没有匹配的业务命令'],
  ['入力内容は保存・送信されません。', '输入内容不会保存或发送。'],
  ['WORK TASKS', '任务'],
  ['RESULT & CONTROL', '结果与治理'],
  ['PERSISTED TASK RECORD', '持久化任务记录'],
  ['暗号化された作業記録', '加密任务记录'],
  ['再起動後も復元される作業記録', '重启后仍可恢复的任务记录'],
  ['データ範囲', '数据范围'],
  ['プライバシー', '隐私'],
  ['確認済み候補者プール', '已确认候选人池'],
  ['脱敏ゲート強制', '强制脱敏门'],
  ['Cloud送信なし', '不发送到云端'],
  ['ローカル処理', '本地处理'],
  ['人の確認', '人工确认'],
  ['対象を確認', '确认对象'],
  ['許可されたデータ範囲を確認', '确认允许的数据范围'],
  ['端末内で候補を整理', '在设备内整理候选人'],
  ['結果と根拠を確認', '确认结果与依据'],
  ['確認済みデータだけを端末内で処理しました。', '仅在本机处理已确认数据。'],
  ['端末内処理を実行しています。', '正在执行本机处理。'],
  ['実行記録', '执行记录'],
  ['メッセージ', '消息'],
  ['承認', '审批'],
  ['成果物', '产物'],
  ['実行監査', '执行审计'],
  ['候補者と根拠の確認', '确认候选人与依据'],
  ['候補者マッチング', '候选人匹配'],
  ['候補者フィールド確認', '候选人字段确认'],
  ['候補者プロフィール確認済み', '候选人档案已确认'],
  ['匿名候補者ID', '匿名候选人 ID'],
  ['直接識別子を含まない確認済みプロフィール', '不含直接标识符的已确认档案'],
  ['未設定', '未设置'],
  ['出典なし', '无来源'],
  ['確認済みプロジェクト経験', '已确认项目经历'],
  ['プロジェクト経験は登録されていません。', '尚未登记项目经历。'],
  ['期間・役割未設定', '期间/角色未设置'],
  ['技術未設定', '技术未设置'],
  ['HR手入力', 'HR 手工输入'],
  ['高信頼度を一括確認', '批量确认高置信度项'],
  ['未検出（空欄のまま確認可）', '未检测到（可保持为空确认）'],
  ['修正理由（3文字以上・必須）', '修改原因（至少 3 个字符，必填）'],
  ['この値と出典を確認', '确认此值与来源'],
  ['プロジェクト経験', '项目经历'],
  ['経験を追加', '添加经历'],
  ['自動検出されたプロジェクト経験はありません。必要な場合はHRが追加してください。', '没有自动检测到的项目经历，必要时请由 HR 添加。'],
  ['削除', '删除'],
  ['案件・プロジェクト名', '案件/项目名称'],
  ['期間', '期间'],
  ['技術（カンマ区切り）', '技术（以逗号分隔）'],
  ['担当内容', '负责内容'],
  ['プロジェクト経験の変更理由', '项目经历修改原因'],
  ['個人・機微情報のレビューを完了', '已完成个人/敏感信息审核'],
  ['匿名プロフィールを確認・保存', '确认并保存匿名档案'],
  ['候補者ライブラリ', '候选人库'],
  ['検索結果', '搜索结果'],
  ['確認済み候補者', '已确认候选人'],
  ['候補者検索', '候选人搜索'],
  ['候補者の状態', '候选人状态'],
  ['利用中', '使用中'],
  ['アーカイブ', '归档'],
  ['クリア', '清除'],
  ['検索中…', '搜索中…'],
  ['検索', '搜索'],
  ['直接識別子 0項目', '直接标识符 0 项'],
  ['確認済みプロフィールのみ', '仅已确认档案'],
  ['アーカイブ済みプロフィール', '已归档档案'],
  ['一致する候補者が見つかりません', '未找到匹配候选人'],
  ['確認済み候補者はまだありません', '尚无已确认候选人'],
  ['履歴と根拠を見る', '查看历史与依据'],
  ['適合スコア', '匹配分数'],
  ['匿名プロフィール · 個人情報なし', '匿名档案 · 无个人信息'],
  ['候補者フィールド草稿', '候选人字段草稿'],
  ['候補者比較結果', '候选人比较结果'],
  ['提案内容と外部提供範囲を確認してください', '请确认提案内容与对外提供范围'],
  ['宛先', '收件人'],
  ['件名', '主题'],
  ['本文', '正文'],
  ['候補者の対外表示名（端末内のみ）', '候选人的对外显示名称（仅本机）'],
  ['確認済みプロジェクト経験', '已确认项目经历'],
  ['スキル', '技能'],
  ['経験年数', '经验年限'],
  ['稼働時期', '可入场时间'],
  ['希望単価', '期望单价'],
  ['勤務形態', '工作方式'],
  ['希望勤務地', '期望工作地点'],
  ['就労資格', '工作资格'],
  ['例：この案件に合う候補者を探して、提案下書きを準備したい', '例如：查找符合此案件的候选人并准备提案草稿'],
  ['⌘ Enter でプレビュー', '⌘ Enter 预览'],
  ['更新', '更新'],
  ['アプリを初期化できませんでした。', '无法初始化应用。'],
  ['操作員プロフィールを保存できませんでした。', '无法保存操作员档案。'],
  ['表示設定を保存できませんでした。', '无法保存显示设置。'],

  // Home and governance panel — these strings are system chrome, not task data.
  ['本機ユーザー', '本机用户'],
  ['案件登録', '案件登记'],
  ['入力待ち', '等待输入'],
  ['開始待ち', '待开始'],
  ['キャンセル', '已取消'],
  ['候補者検索', '候选人搜索'],
  ['TASK CONTROL', '任务控制'],
  ['パネル設定は未提供', '暂不提供面板设置'],
  ['設定は各ガバナンスカードから行います', '请在各治理卡片中完成设置'],
  ['クラウド送信前の脱敏', '云端发送前脱敏'],
  ['強制', '强制'],
  ['姓名・電話・住所に加え、国籍・在留資格・就労資格もローカルで置換し、DLP通過後のみ送信します。', '姓名、电话、住址以及国籍、在留资格和工作资格都会在本机替换；仅在通过 DLP 后才可发送。'],
  ['バイパス不可', '不可绕过'],
  ['固定合成回帰', '固定合成回归'],
  ['日本語専門家評価 未完了', '日语专家评估未完成'],
  ['日本語専門家評価は推奨される品質・監査証跡ですが、Cloud AI の実行や正式リリースを阻止しません。', '日文专家评估是建议保留的质量与审计证据，但不会阻止云端 AI 运行或正式发布。'],
  ['任意の品質証跡', '可选质量证据'],
  ['ローカル AI', '本地 AI'],
  ['隔離検証待ち', '等待隔离验证'],
  ['OCR未搭載', '未配置 OCR'],
  ['OCR・姓名候補・PII/DLP、多言語Vectorと日文Rerankを端末内で実行します。固定モデルはネット接続せず、候補者原文をクラウドへ送りません。', 'OCR、姓名候选、PII/DLP、多语言向量与日文重排均在设备内执行。固定模型不会联网，也不会将候选人原文发送到云端。'],
  ['未許可', '未获许可'],
  ['草稿・送信', '草稿与发送'],
  ['同期範囲', '同步范围'],
  ['Label・業務キーワードの管理者設定待ち', '等待管理员设置 Label 与业务关键词'],
  ['保存', '保存'],
  ['未同期', '未同步'],
  ['管理者設定を開く', '打开管理员设置'],
  ['設定内容', '设置详情'],
  ['ブラウザを起動中…', '正在打开浏览器…'],
  ['読取専用で接続', '以只读方式连接'],
  ['候補者検索の品質門', '候选人搜索质量门'],
  ['脱敏済みの SES 専門家ラベルを端末内で実行し、Hybrid Retrieval の Recall@20・NDCG@20・Project Evidence を検証します。', '在设备内运行已脱敏的 SES 专家标签，验证混合检索的 Recall@20、NDCG@20 与项目证据。'],
  ['専門家ラベルを作成', '创建专家标签'],
  ['暗号化バックアップ', '加密备份'],
  ['要バックアップ', '需要备份'],
  ['SQLCipher の整合スナップショットと暗号化ファイルを、独立した復元パスワードで一つのパッケージにします。', '将 SQLCipher 一致性快照和加密文件通过独立恢复密码封装为一个备份包。'],
  ['ローカルデータのバックアップを確認', '确认本机数据备份'],
  ['保護対象のローカルデータがありますが、まだ復元パッケージがありません。', '存在受保护的本机数据，但尚未创建恢复包。'],
  ['最終バックアップ', '最近备份'],
  ['まだありません', '暂无'],
  ['今は作成しない', '暂不创建'],
  ['7日後', '7 天后'],
  ['人の確認ポイント', '人工确认点'],
  ['候補者の適合性', '候选人匹配度'],
  ['提案内容と添付', '提案内容与附件'],
  ['復元前の対象と置換範囲', '恢复前的对象与替换范围'],
  ['このビルドに自動送信経路はありません。', '此版本不提供自动发送路径。'],
  ['会員と Cloud AI', '会员与 Cloud AI'],
  ['会員と Cloud AI を管理', '管理会员与 Cloud AI'],
  ['データと承認パネルを閉じる', '关闭数据与审批面板'],
  ['件', '项'],
  ['固定回帰 未検証', '固定回归未验证'],
  ['日本語専門家評価', '日语专家评估'],
  ['専門家評価後も姓名の人工確認は必須です。評価データ本文は端末外へ送信・報告しません。', '即使完成专家评估，姓名仍必须由人工确认；评估数据正文不会发送或报告到设备外。'],
  ['未要求・送信実装なし', '未请求且未实现发送功能'],
  ['最終', '最近'],
  ['30–50 件の脱敏済み案件と匿名候補者正解ラベルを含む Benchmark v1 を選択してください。', '请选择包含 30–50 个已脱敏案件和匿名候选人正确标签的 Benchmark v1。'],
  ['選択ファイル', '已选文件'],
  ['安全に取り込んだファイル', '安全导入的文件'],
  ['暗号化保管済み · 実行前', '已加密保存 · 执行前'],
  ['実行前プレビュー', '执行前预览'],
  ['プレビューを閉じる', '关闭预览'],
  ['使用するデータ', '使用的数据'],
  ['適用ポリシー', '适用策略'],
  ['個人識別子をクラウドから遮断', '阻断个人标识符进入云端'],
  ['確認完了まで外部送信なし', '完成确认前不发送到外部'],
  ['修正する', '修改'],
  ['作業はまだありません', '暂无任务'],
  ['新しい作業から、対象と確認手順を先にプレビューできます。', '可从新建任务开始，先预览对象与确认步骤。'],
  ['案件メールの内容から新しい案件を登録したい', '根据案件邮件内容登记新案件'],
  ['JavaとAWS経験がある候補者を探して、根拠付きで比較したい', '查找具有 Java 和 AWS 经验的候选人，并基于依据进行比较'],
  ['選択した候補者で提案メールの下書きを準備したい', '为选定候选人准备提案邮件草稿'],
  ['Java経験5年以上、AWS、8月稼働、週3日リモート可の候補者を探したい', '查找 Java 经验 5 年以上、具备 AWS、8 月可入场且每周可远程 3 天的候选人'],
  ['Gmailを接続', '连接 Gmail'],
  ['Gmail同期中…', '正在同步 Gmail…'],
  ['Gmailから取込', '从 Gmail 导入'],
  ['Google Workspace の管理者設定を開く', '打开 Google Workspace 管理员设置'],
  ['読取専用接続の案内を開く', '打开只读连接说明'],
  ['設定済みの Label・期間・上限で Gmail を読取専用同期する', '按已设置的 Label、期间和上限只读同步 Gmail'],
  ['確認中…', '确认中…'],
  ['作成中…', '创建中…'],
  ['作業プレビューを作成できませんでした。', '无法创建任务预览。'],
  ['作業を開始できませんでした。', '无法开始任务。'],

  // Resource-first HR navigation, import flows and unified settings.
  ['AI マッチング', 'AI 匹配'],
  ['案件条件をもとに、確認済みの人材だけを硬条件・検索・Local AI 精査で比較します。', '根据案件条件，仅比较已确认人才，并经过硬条件、检索和本地 AI 精排。'],
  ['AI は採否を決定しません', 'AI 不决定录用与否'],
  ['資料にない条件は「不明」として保持し、案件ごとの一致根拠・不足条件・出典を表示します。', '资料中没有的条件保持为“未知”，并展示各案件的匹配依据、缺失条件和来源。'],
  ['業務ワークベンチ', '业务工作台'],
  ['履歴書と案件をリソース化し、根拠付きの AI マッチングへ進みます。', '将简历和案件转为标准资源，再进行有依据的 AI 匹配。'],
  ['データセキュリティ', '数据安全'],
  ['3つのステップで最初のマッチングを開始', '三步完成首次匹配'],
  ['初めての方は左から順に進めてください。登録済みデータがある場合は、直接データベースへ移動できます。', '首次使用请按顺序操作；已有数据时可直接进入资源库。'],
  ['履歴書をインポート', '导入简历'],
  ['候補者概要へ戻る', '返回候选人概览'],
  ['取込作業をキャンセルできませんでした。', '无法取消导入任务。'],
  ['今回面談の匿名コンテキスト送信を許可済み', '本轮已允许发送脱敏上下文'],
  ['今回の続きは再確認不要です。候補者または面談回を切り替えると自動で失効します。', '本轮后续提问无需重复确认；切换候选人或面试轮次后会自动失效。'],
  ['今回面談で一度だけ確認', '仅需为本轮确认一次'],
  ['今回だけCloud AIを許可', '允许本轮使用 Cloud AI'],
  ['PDF、Word、Excelから標準プロフィールを作成', '从 PDF、Word、Excel 生成标准档案'],
  ['取込済み', '已导入'],
  ['案件をインポート', '导入案件'],
  ['Gmail、EML、テキストを固定フォーマットへ変換', '将 Gmail、EML 和文本转换为固定格式'],
  ['AI マッチングを実行', '执行 AI 匹配'],
  ['硬条件、検索、Local AI 精査から根拠付き候補を作成', '通过硬条件、检索和本地 AI 精排生成有依据的候选名单'],
  ['現在のリソース', '当前资源'],
  ['確認待ちを開く', '打开待确认项'],
  ['確認済み人材', '已确认人才'],
  ['人材データベース', '人才库'],
  ['案件データベース', '案件库'],
  ['処理履歴と証跡', '处理历史与证据'],
  ['最近のアクティビティ', '最近活动'],
  ['言語と本機ユーザー', '语言与本机用户'],
  ['外部システム', '外部系统'],
  ['データとプライバシー', '数据与隐私'],
  ['外部システムの接続を更新できませんでした。', '无法更新外部系统连接。'],
  ['読取専用で接続済み', '已只读连接'],
  ['接続待ち', '等待连接'],
  ['管理者設定が必要', '需要管理员设置'],
  ['表示、外部システム、データ保護を一つの場所で管理します。', '在一个位置管理显示、外部系统和数据保护。'],
  ['設定を閉じる', '关闭设置'],
  ['設定カテゴリ', '设置类别'],
  ['この端末で使用する表示言語とユーザー情報を設定します。', '设置本机使用的显示语言和用户信息。'],
  ['本機ユーザープロフィール', '本机用户档案'],
  ['表示名と担当ロールを設定します。', '设置显示名称和负责角色。'],
  ['言語とユーザー設定は暗号化ローカルDBに保存され、外部システムへ送信されません。', '语言和用户设置保存在加密本地数据库中，不会发送至外部系统。'],
  ['外部サービスの接続、権限、同期範囲をここで一元管理します。', '在此统一管理外部服务的连接、权限和同步范围。'],
  ['会社 Gmail から案件情報を読取専用で取り込みます。', '以只读方式从公司 Gmail 导入案件信息。'],
  ['アカウント', '账号'],
  ['脱敏済みデータだけを、許可されたクラウド機能へ送信します。', '仅将已脱敏数据发送至获准的云端功能。'],
  ['接続済み', '已连接'],
  ['なし', '无'],
  ['接続と利用状況を管理', '管理连接与使用情况'],
  ['外部接続はこの画面に集約', '外部连接统一在此管理'],
  ['業務ページでは設定済みの接続を選択して使用し、アカウント・権限・同期範囲の変更はここで行います。', '业务页面仅使用已配置连接；账号、权限和同步范围均在此修改。'],
  ['個人情報の脱敏、Local AI、暗号化保存の現在状態を確認します。', '查看个人信息脱敏、本地 AI 和加密存储的当前状态。'],
  ['クラウド送信前脱敏', '云端发送前脱敏'],
  ['強制・バイパス不可', '强制且不可绕过'],
  ['OCR・PII・検索を端末内で実行', 'OCR、PII 和检索均在本机执行'],
  ['データセキュリティの詳細を開く', '打开数据安全详情'],
  ['人の確認を維持', '保留人工确认'],
  ['不明な情報を不適合として扱わず、候補者や案件の確定、外部提供は担当者の確認後に行います。', '未知信息不会被当作不符合；候选人、案件确认和对外提供均需负责人确认。'],
  ['最初の履歴書をインポート', '导入第一份简历'],
  ['Gmail から案件を取り込めませんでした。', '无法从 Gmail 导入案件。'],
  ['Google Workspace、EML、手動入力から案件情報を取り込み、固定フォーマットへ標準化します。', '从 Google Workspace、EML 和手工输入导入案件，并标准化为固定格式。'],
  ['取り込んだ案件候補を確認し、正式案件として検索・管理できる状態にします。', '确认导入的案件候选项，使其成为可搜索和管理的正式案件。'],
  ['Gmail取込エラーを閉じる', '关闭 Gmail 导入错误'],
  ['案件の取込元', '案件导入来源'],
  ['どの経路でも、保存前にローカル脱敏と項目確認を実施', '所有来源在保存前都执行本地脱敏和字段确认'],
  ['姓名、電話、メール、住所などの直接識別子を端末内で置換し、原文を Cloud LLM へ送信しません。', '姓名、电话、邮箱、住址等直接标识符会在本机替换，原文不会发送至云端大模型。'],
  ['会社 Gmail から取り込む', '从公司 Gmail 导入'],
  ['設定済みの Label、期間、キーワード範囲だけを読取専用で同期します。', '仅只读同步已设置的 Label、时间范围和关键词。'],
  ['接続設定が必要', '需要连接设置'],
  ['外部システム設定を開く', '打开外部系统设置'],
  ['Gmail から取り込む', '从 Gmail 导入'],
  ['EML ファイルを取り込む', '导入 EML 文件'],
  ['複数の .eml を隔離・断網環境で解析し、案件メールだけを草稿にします。', '在隔离断网环境中解析多个 .eml，仅将案件邮件生成草稿。'],
  ['端末内で解析', '在本机解析'],
  ['EML を選択', '选择 EML'],
  ['テキストを直接入力', '直接输入文本'],
  ['メールやチャットの案件情報を貼り付け、標準項目のレビュー草稿にします。', '粘贴邮件或聊天中的案件信息，生成标准字段审核草稿。'],
  ['案件情報を入力', '输入案件信息'],
  ['すでに取り込んだ案件を確認', '查看已导入案件'],
  ['件 · 確認済み', '项 · 已确认'],
  ['件 · アーカイブ', '项 · 已归档'],
  ['案件データベースを開く', '打开案件库'],
  ['ワークベンチ', '工作台'],
  ['リソース', '资源'],
  ['案件インポート', '案件导入'],
  ['AI と確認', 'AI 与审核'],
  ['アクティビティ', '活动记录'],
  ['システム設定を開く', '打开系统设置'],
  ['案件と人材をマッチング', '匹配案件与人才'],
  ['案件条件を入力すると、確認済み人材から根拠付きの候補者リストを作成します。', '输入案件条件后，从已确认人才中生成有依据的候选名单。'],
  ['マッチングをプレビュー', '预览匹配'],
  ['HRが確認した匿名プロフィールとプロジェクト経験を、条件・スキル・稼働時期などから根拠付きで検索します。', '基于条件、技能和可入场时间等，有依据地检索经 HR 确认的匿名档案与项目经历。'],
  ['業務', '业务'],
  ['案件候補', '案件候选'],
  ['活動記録', '活动记录'],
  ['一般設定', '常规设置'],
  ['接続・権限・同期', '连接、权限与同步'],
  ['脱敏・Local AI・暗号化', '脱敏、本地 AI 与加密'],
  ['権限', '权限'],
  ['接続設定', '连接设置'],
  ['会員', '会员'],
  ['送信前処理', '发送前处理'],
  ['許可機能', '已授权功能'],
  ['文字', '字'],
  ['最大 100,000 文字', '最多 100,000 字'],
  ['ローカル処理の履歴、進捗、証跡と確認待ち状態を一つの一覧から再開できます。', '可在一个列表中恢复本地处理历史、进度、证据和待确认状态。'],
  ['アクティビティを開く', '打开活动记录'],
  ['処理履歴', '处理历史'],
  ['を状態・進捗・証跡とともに確認します。', '项，并查看其状态、进度和证据。'],
  ['件を状態・進捗・証跡とともに確認します。', '项，并查看其状态、进度和证据。'],
  ['脱敏、Local AI、品質門とバックアップを確認します。', '查看脱敏、本地 AI、质量门和备份。']
])

const localizableAttributes = ['aria-label', 'placeholder', 'title'] as const
const originalText = new WeakMap<Text, string>()
const originalAttributes = new WeakMap<Element, Map<string, string>>()
let queuedUiRefresh = 0

function translateKnownUiValue(source: string): string | null {
  const direct = japaneseToChinese.get(source) ?? japaneseToChinese.get(source.replace(/\s+/gu, ' ').trim())
  if (direct) return direct

  // These templates are generated solely from controlled task metadata. Keeping
  // them narrow avoids translating a user-authored task title or source text.
  const taskMeta = /^(候補者検索|候補者マッチング|スキルシート取込|提案下書き)\s*·\s*証跡\s*(\d+)件$/u.exec(source)
  if (taskMeta) {
    const type = japaneseToChinese.get(taskMeta[1]) ?? taskMeta[1]
    return `${type} · 证据 ${taskMeta[2]} 项`
  }
  const evidenceTab = /^証跡\s*(\d+)$/u.exec(source)
  if (evidenceTab) return `证据 ${evidenceTab[1]}`
  const candidateResultTab = /^候補者\s*(\d+)$/u.exec(source)
  if (candidateResultTab) return `候选人 ${candidateResultTab[1]}`
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
  if (candidateSearchStarted) return `已启动本机候选人搜索任务（尝试 ${candidateSearchStarted[1]}）。`
  const candidateSearchFailed = /^候補者検索ジョブを完了できませんでした（(.+)）。自動で外部処理は再実行しません。$/u.exec(source)
  if (candidateSearchFailed) return `候选人搜索任务未完成（${candidateSearchFailed[1]}）；不会自动重试外部处理。`
  const candidateSearchStopped = /^候補者検索ジョブを\s*(.+)\s*で停止しました。$/u.exec(source)
  if (candidateSearchStopped) return `候选人搜索任务因 ${candidateSearchStopped[1]} 已停止。`
  const candidateSearchPaused = /^端末内候補者検索を一時停止しました（(.+)）。(.+)\s*以降に同じ範囲で再試行します。$/u.exec(source)
  if (candidateSearchPaused) return `本机候选人搜索已暂停（${candidateSearchPaused[1]}），将在 ${candidateSearchPaused[2]} 之后按相同范围重试。`
  const safeRetryQueued = /^安全な端末内作業だけを\s*(.+)\s*から再試行待ちへ移しました。$/u.exec(source)
  if (safeRetryQueued) return `仅将安全的本机任务从 ${safeRetryQueued[1]} 转为等待重试。`
  const proposalFollowUp = /^(.+)を(.+)が端末内の営業履歴へ記録しました。メール送信や外部更新は実行していません。$/u.exec(source)
  if (proposalFollowUp) return `${proposalFollowUp[2]} 已将“${proposalFollowUp[1]}”记录到本机销售历史；未发送邮件或执行外部更新。`
  const proposalFollowUpAudit = /^(.+)を人工確認済みの営業結果としてローカル記録しました。$/u.exec(source)
  if (proposalFollowUpAudit) return `已将“${proposalFollowUpAudit[1]}”作为人工确认的销售结果记录在本机。`
  const proposalExportStarted = /^承認済み提案パッケージのローカル書き出しを開始しました（試行\s*(\d+)）。$/u.exec(source)
  if (proposalExportStarted) return `已开始在本地导出批准后的提案包（尝试 ${proposalExportStarted[1]}）。`
  const proposalExportFailed = /^提案パッケージの書き出しを確定できませんでした（(.+)）。自動再実行せず、保存先と内容を確認してください。$/u.exec(source)
  if (proposalExportFailed) return `无法确认提案包导出（${proposalExportFailed[1]}）；不会自动重试，请检查保存位置与内容。`
  const proposalExportStopped = /^外部ファイルの重複書き出しを避けるため\s*(.+)\s*で停止し、人工確認へ戻しました。$/u.exec(source)
  if (proposalExportStopped) return `为避免重复导出外部文件，已因 ${proposalExportStopped[1]} 停止并返回人工确认。`
  const resumeAnalysisStarted = /^端末内のスキルシート解析ジョブを開始しました（試行\s*(\d+)）。$/u.exec(source)
  if (resumeAnalysisStarted) return `已启动本机技能表解析任务（尝试 ${resumeAnalysisStarted[1]}）。`
  const resumeAnalysisFailed = /^スキルシートの端末内解析を完了できませんでした（(.+)）。原文をクラウドへ送らず停止しました。$/u.exec(source)
  if (resumeAnalysisFailed) return `技能表本机解析未完成（${resumeAnalysisFailed[1]}）；已停止且未将原文发送到云端。`
  const resumeAnalysisStopped = /^端末内解析ジョブを\s*(.+)\s*で停止し、原文のクラウド回退を禁止しました。$/u.exec(source)
  if (resumeAnalysisStopped) return `本机解析任务因 ${resumeAnalysisStopped[1]} 已停止，并禁止将原文回退到云端。`
  const resumeAnalysisPaused = /^端末内スキルシート解析を一時停止しました（(.+)）。(.+)\s*以降に同じファイルで再試行します。$/u.exec(source)
  if (resumeAnalysisPaused) return `本机技能表解析已暂停（${resumeAnalysisPaused[1]}），将在 ${resumeAnalysisPaused[2]} 之后使用相同文件重试。`
  const localOnlyRetry = /^原文をクラウドへ回退せず、端末内作業だけを\s*(.+)\s*から再試行待ちへ移しました。$/u.exec(source)
  if (localOnlyRetry) return `未将原文回退到云端，仅将本机任务从 ${localOnlyRetry[1]} 转为等待重试。`
  return null
}

export function translateUiText(locale: ApplicationLocale, source: string): string {
  return locale === 'zh-CN' ? translateKnownUiValue(source) ?? source : source
}

const ipcInvokeErrorPrefix = /^Error invoking remote method '[^']+': Error:\s*/u

export function localizedIpcError(
  locale: ApplicationLocale,
  cause: unknown,
  fallback: string
): string {
  const fallbackText = translateUiText(locale, fallback)
  if (!(cause instanceof Error)) return fallbackText
  const normalized = cause.message.replace(ipcInvokeErrorPrefix, '').trim()
  if (!normalized) return fallbackText
  const translated = translateUiText(locale, normalized)
  if (translated !== normalized) return translated
  if (locale === 'zh-CN' && /[\u3040-\u30ff]/u.test(normalized)) return fallbackText
  return normalized
}

const simplifiedChineseSampleTaskTitles: Readonly<Record<string, string>> = {
  'task-sample-001': '匹配 Java / Spring Boot / AWS 案件的候选人',
  'task-sample-002': '准备支付平台案件的提案邮件草稿'
}

const simplifiedChineseBuiltInTaskTemplates: ReadonlyArray<readonly [string, string]> = [
  ['Java経験5年以上、AWS、8月稼働、週3日リモート可の候補者を探したい', '查找 Java 经验 5 年以上、具备 AWS、8 月可入场且每周可远程 3 天的候选人'],
  ['選択したスキルシートを安全に取り込み、候補者プロフィールを作成したい', '安全导入选定的技能表并创建候选人档案'],
  ['Java / Spring Boot / AWS案件の候補者を照合したい', '匹配 Java / Spring Boot / AWS 案件的候选人'],
  ['EC決済基盤案件の提案メール下書きを準備したい', '准备支付平台案件的提案邮件草稿']
]

export function localizedTaskTitle(locale: ApplicationLocale, task: { id: string; title: string }): string {
  if (locale !== 'zh-CN') return task.title
  const sampleTitle = simplifiedChineseSampleTaskTitles[task.id]
  if (sampleTitle) return sampleTitle
  const builtInTitle = simplifiedChineseBuiltInTaskTemplates.find(([source]) =>
    task.title === source || (task.title.endsWith('…') && source.startsWith(task.title.slice(0, -1)))
  )
  return builtInTitle?.[1] ?? task.title
}

export function useUiText(): (source: string) => string {
  const locale = useUiLocale()
  return useMemo(() => (source: string) => translateUiText(locale, source), [locale])
}

function translatedValue(value: string, locale: ApplicationLocale): string | null {
  const match = /^(\s*)(.*?)(\s*)$/su.exec(value)
  if (!match) return null
  const [, prefix, source, suffix] = match
  const translated = locale === 'zh-CN' ? translateKnownUiValue(source) : source
  return translated && translated !== source ? `${prefix}${translated}${suffix}` : null
}

function localizeTextNode(node: Text, locale: ApplicationLocale): void {
  const known = originalText.get(node)
  const expectedTranslation = known ? translatedValue(known, 'zh-CN') : null
  if (known && node.data !== known && node.data !== expectedTranslation) originalText.delete(node)
  const source = originalText.get(node) ?? node.data
  const translation = translatedValue(source, locale)
  if (!translation && source === node.data) return
  if (translation || translateKnownUiValue(source.trim())) {
    originalText.set(node, source)
    node.data = translation ?? source
  }
}

function localizeAttributes(element: Element, locale: ApplicationLocale): void {
  for (const attribute of localizableAttributes) {
    const current = element.getAttribute(attribute)
    if (current === null) continue
    const known = originalAttributes.get(element)?.get(attribute)
    const expectedTranslation = known ? translatedValue(known, 'zh-CN') : null
    if (known && current !== known && current !== expectedTranslation) originalAttributes.get(element)?.delete(attribute)
    const source = originalAttributes.get(element)?.get(attribute) ?? current
    const translation = translatedValue(source, locale)
    if (!translation && source === current) continue
    if (translation || translateKnownUiValue(source.trim())) {
      const attributes = originalAttributes.get(element) ?? new Map<string, string>()
      attributes.set(attribute, source)
      originalAttributes.set(element, attributes)
      element.setAttribute(attribute, translation ?? source)
    }
  }
}

function localizeSubtree(root: Node, locale: ApplicationLocale): void {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT)
  let current: Node | null = root
  while (current) {
    if (current.nodeType === Node.TEXT_NODE) localizeTextNode(current as Text, locale)
    if (current.nodeType === Node.ELEMENT_NODE) localizeAttributes(current as Element, locale)
    current = walker.nextNode()
  }
}

function scheduleChineseUiRefresh(): void {
  if (document.documentElement.dataset.locale !== 'zh-CN' || queuedUiRefresh) return
  queuedUiRefresh = requestAnimationFrame(() => {
    queuedUiRefresh = 0
    localizeSubtree(document.getElementById('root') ?? document.body, 'zh-CN')
  })
}

/**
 * Some independently stateful legacy panels finish rendering after App has
 * committed. They opt into one shared, frame-batched refresh instead of each
 * panel creating a broad MutationObserver or a polling loop.
 */
export function useRendererUiRefresh(): void {
  useLayoutEffect(() => {
    // Descendant layout effects run before App's locale effect. Defer one turn
    // so the selected locale is already reflected on <html>.
    const timer = window.setTimeout(scheduleChineseUiRefresh, 0)
    return () => window.clearTimeout(timer)
  })
}

export function useLegacyRendererLocalization(locale: ApplicationLocale): void {
  // React legitimately recreates screen subtrees during navigation. Reapply the
  // current locale after each App commit so a Japanese source node cannot leak
  // back into the selected Chinese UI between MutationObserver batches.
  useLayoutEffect(() => {
    const root = document.getElementById('root') ?? document.body
    document.documentElement.lang = locale
    document.documentElement.dataset.locale = locale
    localizeSubtree(root, locale)
    let frame = 0
    let settlingPasses = 0
    const scheduleLocalization = () => {
      if (frame) return
      frame = requestAnimationFrame(() => {
        frame = 0
        // React can replace a whole branch between observer batches. Rescanning
        // the mounted root is deliberate: it observes the latest branch rather
        // than losing a later mutation while an earlier frame is pending.
        localizeSubtree(root, locale)
        if (settlingPasses < 6) {
          settlingPasses += 1
          scheduleLocalization()
        }
      })
    }
    // Child effects may finish after the App commit that selects the locale.
    // A short, bounded settle pass covers that initial render without polling.
    scheduleLocalization()
    const observer = new MutationObserver(scheduleLocalization)
    observer.observe(root, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: [...localizableAttributes] })
    return () => {
      observer.disconnect()
      if (frame) cancelAnimationFrame(frame)
    }
  })
}

export function localizedWorkDate(locale: ApplicationLocale, now = new Date()): string {
  const parts = new Intl.DateTimeFormat(locale, { year: 'numeric', month: '2-digit', day: '2-digit', weekday: 'long' })
    .formatToParts(now)
  const values = new Map(parts.map((part) => [part.type, part.value]))
  if (locale === 'zh-CN') return `${values.get('year')}.${values.get('month')}.${values.get('day')} · ${values.get('weekday')}`
  return `${(values.get('weekday') ?? '').toLocaleUpperCase('en-US')} · ${values.get('year')}.${values.get('month')}.${values.get('day')}`
}
