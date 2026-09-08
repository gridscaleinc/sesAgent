# SES Agent Desktop 文档总览

<!-- ses-current-state package=0.1.0 schema=46 -->

> 文档版本：v0.42
> 更新日期：2026-09-07
> 状态：Agent-first Codex 式核心对话、用户输入复制/编辑分支重发、按完整 Turn 裁剪的受控上下文、会议链接本地隔离、typed block 本地交互、受控对话 Tool 与 A-01 两阶段 Cloud Review 已进入源码；本机回归与构建证据按各节口径分别记录。真实日文专家报告作为非阻断的质量/审计/发布准备度建议证据仍未完成，当前安装包、签名、公证与 Windows x64 实机证据也未完成

产品原则：围绕“案件找人、人员找案件”让 HR 快捷完成业务，非必要不新增步骤。人员导入后即可推广与匹配，无需额外的推广资格、人才库或字段审核确认；资料修正在传统人员管理页面进行。

默认入口是 Agent 工作台：先展示案件和人员的最新动态，底部显示紧凑操作栏，选中具体资料后展开带对象名称的 Agent 输入区；批量整理、人员推广与案件操作在右侧工作区展开。动态按资料版本记录已读，并提供独立的“稍后处理”，同一资料更新后重新显示为未读。实现范围见 [Agent 最新动态工作台](docs/implementation/agent-latest-workspace-v1.md)；基础整理与推广流程见 [信息整理与推广工作区 v1](docs/implementation/business-workbench-v1.md)。

## 1. 项目定义

SES Agent Desktop 是面向日本 SES 公司的桌面业务助手，服务对象是营业员、招聘/人事人员和负责人。

产品首先解决四个高频问题：

1. 将格式各异的日式技能表、简历转换为可检索的候选人资料。
2. 从大量 BP 案件邮件中提取技术、商务与现场条件。
3. 自动找出值得营业员优先审核的候选人，并说明匹配依据。
4. 生成日文提案邮件与脱敏简历，但由人确认后发送。

它不是完整的通用 HRIS。第一阶段不覆盖员工档案全生命周期、工资发放、法定考勤或绩效管理，而是聚焦 SES 招聘资源与案件撮合效率。

## 2. 本次重设计的核心决策

| 决策 | 第一阶段方案 |
|---|---|
| 产品形态 | Electron 桌面应用 |
| 平台顺序 | 首发 macOS；受控试点通过后交付 Windows 同功能版本 |
| 试点主用户 | 单名 SES 营业员；HR 通过文件提供资料，负责人使用本机汇总/导出 |
| 交互模型 | 受限的业务任务工作台；持续任务上下文 + 领域用例，不是通用工具型 Agent |
| 是否必须部署服务器 | 不需要 |
| UI | React + TypeScript |
| 本地后台 | Electron Main + Worker/Utility Process |
| 本地数据 | SQLite + 加密文件库 |
| 检索 | 已实现经验、费率上限、稼动时点、远程频度、日语等级、粗粒度工作地点与就劳资格的三态硬条件 + 加权本地 BM25 + Profile/项目经历 384 维多语向量 + 候选人级聚合 + RRF + 固定日文 Cross-Encoder 本地精排 + 项目来源证据；真实 SES 标注集仍待完成 |
| 文件解析 | SheetJS、PDF.js、Mammoth |
| 本地 AI | 已实现本地 OCR、姓名候选、PII 检测/DLP、字段抽取、任务分类、固定版本多语 Embedding 与日文 Cross-Encoder 精排；小型生成式本地 LLM 仍只做质量 Spike |
| 云端 AI | 已具备受管 AICommerce 接入层；未配置不发起网络请求，启用后也只能发送通过强制脱敏门的占位符载荷 |
| 邮件处理 | 已确认 Google Workspace；使用 Gmail API，连接完成前支持粘贴邮件/导入 `.eml` |
| 邮件发送 | 案件配信文可预填到系统默认邮件客户端，由 HR 确认收件人并最终发送；不申请 Gmail Compose/Send 权限，应用不声称邮件已发送 |
| 团队协作 | 第二阶段增加轻量同步服务 |

逻辑上仍保留“界面层、业务层、数据层”分层，但它们在第一阶段被打包到同一个桌面应用里，不再要求部署 FastAPI、Go 服务或独立 PostgreSQL。

## 3. 文档导航

1. [产品 PRD](./01-product-prd.md)：目标用户、核心场景、功能范围和成功指标。
2. [技术架构](./02-technical-architecture.md)：Electron 进程模型、模块边界、数据模型和未来演进。
3. [简历引擎设计](./03-resume-engine-design.md)：Excel、PDF、Word 解析与结构化提取流程。
4. [安全与数据治理](./04-security-and-data-governance.md)：个人信息、密钥、邮件权限、文档攻击和数据生命周期。
5. [开发周期与交付计划](./05-delivery-roadmap.md)：8 周脱敏演示、16 周 macOS 安全试点、随后 Windows 同功能版本、验收门槛、资源与风险。
6. [密钥丢失与离线恢复手册](./06-key-loss-and-recovery-runbook.md)：Keychain/数据库不可用时的受限恢复模式、禁止操作、IT 取证和签名版演练门槛。
7. [整改与外部能力吸收改造方案](./07-remediation-and-external-adoption-plan.md)：当前系统整改、外部项目吸收边界、微信读取和发布证据状态。
8. [Agent-first 主工作区与对话式匹配方案](./08-conversational-matching-agent-plan.md)：`SES Agent` 是正常启动的主工作区，采用 Codex 式任务列表、紧凑标题、纯文本 Assistant 和底部 Composer；旧工作台保留为业务概览，经典匹配页继续作为受管回退。用户自然语言先经本地 NER/DLP 和硬性出网门发送给所选 AI；模型只能通过严格 `ANSWER/TOOL` 协议直接回答或请求一个白名单 Tool，Main 再校验 Schema、引用、Scope、Actor 并最多执行一个本地 Tool，随后以真实 SSE 整理权威结果。会话上下文按完整 Turn 裁剪并受 20,000 字符硬上限约束，候选人/面谈/匹配/原文档按钮只执行预定义本地动作，路由标识不进入 Cloud。当前 Agent allowlist 包含案件、候选人、匹配、草稿和面谈相关的 8 个受控 Tool；本地写仅允许履历摄取与参数完整的面谈登记，不开放外部发送、提案导出、删除或任意业务写。模型选择包含 GPT-5.6 Luna/Terra/Sol 和 DeepSeek V4 Flash；DeepSeek 复用登录后的 `account_ai_token` 经 AICommerce 原生 SSE 路由，不要求或保存 DeepSeek 原生 API Key。

## 4. 第一阶段边界

### 包含

- 导入 `.xls`、`.xlsx`、`.xlsb`、`.docx` 和 PDF 简历。
- 通过自然语言或快捷操作创建受限业务任务，并持续补充上下文。
- 展示任务的数据范围、执行步骤、产物、证据和人工审批门。
- 简历结构化、人工校对、版本管理和候选人检索。
- 所有云端模型调用前强制删除或占位符化姓名、电话、私人邮箱、住址、生日、照片、证件号等直接标识符；检测失败即阻止上传。
- 本地 OCR、PII 检测、DLP 复检、Embedding 和基础分类；本地模型运行时禁止联网和远程加载模型。
- 手工创建案件、粘贴邮件或导入 `.eml`；安全试点版连接 Google Workspace Gmail API。
- 案件字段提取、去重、分类和待处理队列。
- 基于已确认候选资料的 Hybrid RAG、匹配解释和人工反馈。
- 生成日文提案草稿与脱敏简历。
- 本地数据加密、导出、一致性备份、活动数据删除和备份过期/密钥销毁报告。
- macOS 首发；macOS 试点 Go 后进入 Windows 同功能版本，复用领域逻辑并替换平台 OCR、签名、安装与密钥集成。

### 不包含

- 无人值守自动发送提案邮件。
- 多人实时协同、云端共享候选人库。
- 工资计算、正式考勤、税务和社保。
- 完整 CRM、合同电子签署和会计系统。
- 在应用关闭后持续运行的云端邮件服务。
- 用 AI 自动拒绝候选人或作出雇佣决定。
- 允许模型自由选择任意工具、访问未授权资料或执行通用桌面操作。
- 以用户同意为理由把未脱敏简历、邮件正文、PDF 页面或图片发送给云端模型。

## 5. 前置假设

- 第一批试点用户能够提供至少 50 份脱敏简历和 200 封脱敏案件邮件作为评测集。
- 公司只允许在直接标识符完成本地脱敏且 DLP 校验通过后调用外部大模型 API；云端不可用时不自动降级为上传原文。
- MVP 的目标是验证业务价值与解析质量，不追求第一天支持整个团队实时共享。
- 桌面应用关闭期间不会实时监听邮件，但会在下次启动后从上次检查点补齐。

## 6. 已确认决策与剩余确认项

已确认：

1. 首发 macOS，受控试点通过后开发 Windows 同功能版本。
2. 公司邮箱为 Google Workspace，MVP 只实现 Gmail API。

进入开发前仍需确认：

1. 试点的主操作人是哪一名营业员。
2. 云端模型允许的数据区域、保留策略和已批准用途；未脱敏个人数据无论用户是否确认都不允许上传。
3. 日常候选人数量、每天邮件量和常见文件格式占比。
4. 试点 Mac 的最低芯片、内存和磁盘配置，用于冻结本地 OCR、PII 模型、Embedding 和可选小型 LLM 的资源预算。

## 7. 当前开发切片

当前可运行切片已经覆盖“创建受限业务任务”“安全暂存简历文件”“扫描件本地 OCR/脱敏草稿”以及“人工审批后导出提案包”的主链路：

1. 用户在明显的自然语言输入区描述工作目标。
2. 应用在本地识别受支持的任务类型，并生成确定性的执行计划。
3. 创建前展示数据范围、脱敏策略、执行步骤和人工审批门。
4. Electron Main 重新校验预览哈希后创建任务，Renderer 不能绕过该校验。
5. 任务详情只展示匿名候选人编号，并明确标示脱敏门与人工决策责任。
6. WorkTask 连同用户/系统消息、上下文、步骤、审批门、匿名产物和 ToolAudit 写入 SQLCipher-compatible SQLite；主密钥由 macOS Keychain 语义保护，应用重启和加密快照后均可恢复。
7. 文件选择在 Electron Main 中执行，只把随机文件令牌与非路径元数据返回 Renderer；文件经过扩展名/Magic Bytes 校验后以 AES-256-GCM 写入本地保管库。
8. 本地确定性 PII 引擎生成稳定占位符，独立 DLP 复检后才产生带品牌的 `RedactedPayload`；Cloud Gateway 还会检查持久化会话、策略、来源版本、哈希、有效期和 HTTPS Endpoint Allowlist。
9. PDF.js、SheetJS、Mammoth 和 PostalMime 在一次一进程的 Parser Worker 中处理不可信文件；简历生成 `DocumentIR v1`，EML 只返回受限正文、哈希身份和非身份域名。
10. Parser Worker 不继承应用密钥或 Provider 环境变量，并安装 Node 网络拒绝守卫；宏、公式和外部链接不执行、不加载。
11. 解析结果、PII 映射、候选人/案件字段草稿、案件字段别名、字段/项目审核审计、匿名 CandidateProfile、Profile/项目分段加密向量缓存、匹配运行/人工反馈、Match Assessment、Match Run 有效性绑定、版本化营业优先级 Projection、专家标注草稿、SES Benchmark/评测报告、JobCase、提案草稿/提案后人工跟进、恢复事件、生命周期、删除报告、Google Workspace 管理配置/在线验收报告、本机操作员档案、本机显示语言偏好、ProcessingJob、Gmail 删除墓碑、同步检查点、Cloud Gate/Ticket 审计绑定、Sales Agent 会话、紹介文模板/案件配信复制记录、案件既読状態和备份修订状态持久化到当前 Schema v46；应用重启后仍能恢复。
12. macOS 原生 Helper 使用 Apple Vision 在本地处理扫描 PDF，输出文字、置信度、坐标、人脸和条码候选区域；进程由系统沙箱禁止联网，原 PDF 不进入云端。
13. Apple Natural Language 处理其可靠覆盖的英文姓名；日文姓名采用保守标签/形式规则生成候选，所有姓名候选都必须人工确认，不把当前实现包装成已经达到发布质量的日文 NER。
14. 技能、经验年数、稼动时间、单价、日语等级、工作方式和角色由确定性本地提取器生成草稿；每个字段显示置信度和页码/Sheet/Cell 来源，缺失项保持 `null`。
15. 姓名、电话、私人邮箱和住址在真实合成扫描件回归中均已替换为稳定占位符；人工确认前固定 `cloudEligible=false`，不会生成 Cloud Payload。
16. HR 可以逐项修改字段、查看脱敏后的页码/Sheet/Cell 来源、勾选确认，并批量确认高置信度字段；修改值必须填写原因。
17. 主进程在保存 Profile 前再次执行直接标识符检查；真实界面回归中，把手机号填入技能字段会被拒绝，Renderer 无法绕过。
18. 审核完成后生成不含直接标识符的匿名 CandidateProfile，记录原值、确认值、修改原因、来源、确认人和乐观修订号；任务进入 100% 完成。重新解析会把旧 Profile 标记为过期并重新开启审核。
19. Google Workspace 桌面 OAuth 基础层使用系统浏览器、随机 `127.0.0.1` Loopback 回调、PKCE S256、`state` 校验和离线 Refresh Token；不使用嵌入式登录页或已废弃的 OOB 复制码。
20. 首次连接只申请 `gmail.readonly`，并在 Token 交换和刷新后要求实际 Scope **恰好只有这一项**、Token Type 为 Bearer、账号属于公司 Workspace 域；任何额外 Scope 都会拒绝保存凭据。
21. OAuth 凭据由 OS Keychain/DPAPI 语义的 `safeStorage` 加密保存在 `0600` 私有文件中；UI 明确显示读权限、草稿权限和“发送方法未实现”。
22. Gmail 首次同步只扫描管理员配置的 Label、业务关键词和回溯天数；后续对每个配置 Label 同时跟踪 `messageAdded + labelAdded`，避免邮件稍后被打上 SES Label 时漏收。使用 `historyId` 增量补齐，检查点过期的 404 只触发相同范围内的有限重扫，范围过宽或消息处理失败时不推进检查点。
23. Gmail 与 EML 的 MIME 解析只读取受限大小的文字正文；Gmail 额外限制 20 层/1000 Part、合计 2 MB 解码文本和严格 Base64URL。HTML 转纯文本，附件不下载或解析后立即清零，远程图片不加载，提示词注入样式文本只作为不可信内容标记。From 显示名、主题与正文经过本地姓名候选、PII 规则和独立 DLP 复检后才写入加密数据库，`cloud_eligible` 固定为 `0`。
24. 同一 Gmail Message ID 与脱敏后业务指纹分别用于技术去重和业务重复标记；同步主进程还使用单飞锁，避免用户连续点击产生并发检查点竞争。
25. 候选人侧边栏已接入真实 active CandidateProfile；支持空条件浏览和本地多关键词检索，返回匿名 ID、确定性适合度分数、命中字段及原始页码/Sheet/Cell 依据。ASCII 技术词使用边界匹配，`Java` 不会误命中 `JavaScript`。
26. 分类为案件的脱敏 Gmail 消息会幂等生成统一 `JobCaseSource` 与 `JobCaseExtraction v2` 草稿，确定性提取案件名、募集角色、必需技能、单价、精算、地点、远程、开始时间、工时、日语、面谈、商流和支付条件；未知值保持 `null`，不做补全猜测。
27. “案件”侧边栏已接入真实审核收件箱。营业员可查看脱敏来源预览、警告、置信度和 Gmail/手动来源，逐项确认并为修改填写原因；全部项目和隐私确认完成后才生成 `JobCase v2`。持久化边界会再次阻止电话、私人邮箱、地址、证件号和 PII 占位符进入正式案件字段。
28. 候选人匹配任务详情已删除 A-024/B-117 静态样例，改为查询真实 active CandidateProfile；自然语言任务先收敛成可解释条件，本地执行字段证据评分，并显示命中条件、未命中条件和页码/Sheet/Cell 来源。经验年限采用数值门槛判断。
29. 候选人卡可按需加载 CandidateProfile 历史版本，展示 Profile Version、Review Revision、active/stale/superseded 状态、确认人、确认时间、字段值和来源；资料重新解析后旧版本保留并明确标记需要重新确认。
30. CandidateProfile 支持可恢复归档。归档状态单独持久化，资料立即退出候选人库搜索和匹配任务；用户可在“アーカイブ”页查看历史并填写原因后恢复。
31. 永久删除采用“影响预览 → 内容哈希绑定 → 输入『削除』二次确认 → 加密文件隔离 → 数据库事务删除 → 文件清除 → 删除报告”的流程。删除覆盖 Profile版本、字段审核、解析结果、PII对应表、受管文件和直接绑定任务；失败时在数据库提交前恢复隔离文件。
32. `DataDeletionReport` 只保存对象哈希、计数、组件状态和警告，不保存姓名、文件名、正文或占位符映射；明确标示应用外导出副本不在控制范围内。若曾创建恢复包，删除报告把备份标为 `expired_pending`，要求创建删除后的新包并安全废弃旧包，不伪称已经远程清理应用外副本。
33. 案件页提供明确的营业员手动输入窗口。件名和正文先经过本地 Apple Natural Language/保守日文姓名候选与确定性 PII 规则，再把姓名、电话、私人邮箱和住址替换成占位符；原始件名与正文不写入案件表，只有加密映射和脱敏来源进入 Schema v9，且固定 `cloudEligible=false`。
34. 本地 AI 已抽象为 `LocalOcrPort` 与 `LocalPersonNameDetectorPort`。macOS 首发绑定 Apple Vision/Natural Language；Windows 已实现固定版本的 Tesseract WASM 7.0.0 日英离线 OCR Worker。微软官方要求 `Windows.Media.Ocr` 的桌面调用具有 Package Identity，与当前 NSIS 路线不兼容，因此不再把它作为默认实现。目标机内核网络隔离未验证前，Windows UI 显示「隔離検証待ち」并保持 OCR 失败关闭。
35. 已确认 JobCase 可以填写原因后打开新的审核 Revision；当前确认值会作为新 Revision 的基线，营业员必须再次确认全部 14 个字段与隐私声明。再次确认生成新的 `JobCase v2` Version，旧 Version 标记为 `superseded`，历史、确认人和字段审计均保留。
36. JobCase 支持可恢复归档与恢复。归档案件退出 active JobCase 集，仍可在案件页的“アーカイブ”页查看历史和治理状态；恢复后重新进入 active 集，归档状态下不允许直接发起改訂。
37. JobCase 永久删除采用“影响预览 → 哈希绑定 → 输入『削除』→ 数据库事务 → 非敏感删除报告”。删除覆盖全部 Version、字段审计、脱敏来源、PII 映射和直接绑定任务；Gmail 来源同时删除本地邮件副本并保留最小墓碑，防止相同 Message ID 在后续同步中复活。
38. 提案工作台只允许选择已确认且处于 active 状态的 JobCase 与 CandidateProfile。日文主题、正文和匿名候选人附件均由本地确定性模板生成，生成过程不调用云端模型、不读取原始简历或邮件正文；收件人和对外署名也固定为本地字段。附件可包含 HR 确认后的项目标题、期间、角色、技术与担当摘要，但不包含 Project ID、原文件名或 Source Label。
39. 提案草稿绑定 JobCase Version、CandidateProfile Version、正文、收件人、署名和附件内容哈希。任何编辑都会增加 Revision、生成新哈希并撤销旧审批，防止“先审批、后静默修改”。
40. 导出前必须由营业员分别确认收件人、正文、匿名附件与隐私声明，再批准当前内容哈希。主进程在导出边界重新校验批准哈希，Renderer 不能绕过。
41. 提案附件由隐藏且沙箱化、禁止联网的 Chromium 窗口渲染为 A4 PDF；生成前对普通字段和全部项目内容再次执行本地直接标识符扫描。ZIP 提案包包含 `message.txt`、匿名候选人 PDF 与非敏感 Manifest，明确记录不含原始简历、原始邮件、直接标识符，且 `deliveryState=exported-not-sent`。
42. 导出采用临时文件、`0600` 权限和原子改名；数据库只保存目标路径哈希，不保存明文导出路径。若应用在文件落盘与状态提交之间中断，下次启动会恢复为 `export_unknown`，不会把不确定状态误报为已发送或已完成。
43. 候选人或案件永久删除的影响预览已包含关联提案草稿；确认删除后由外键级联清除草稿、审批、导出记录和事件。应用外已经导出的 ZIP 副本明确不在本地删除事务的控制范围内。
44. 数据治理侧栏已提供明确的“备份を作成 / パッケージから復元”交互。备份密码必须至少 12 字符并二次输入，密码只在当前操作内存中使用，不写入数据库、日志或 Keychain。
45. `.ses-recovery` 使用 scrypt 派生独立密钥，再以 AES-256-GCM 对整个流式容器认证加密；包内包含应用主密钥材料、SQLCipher 一致性快照、受管文件库对象和 Manifest，但外层密文中不出现恢复密码、主密钥、SQLite Header 或简历原文。
46. 当前 SQLCipher 原生绑定不能把加密源直接备份到默认未加密目标，因此一致性快照在同一数据库连接的 `BEGIN IMMEDIATE` 事务中创建带同一 Cipher/Key 的加密 Attached Database，复制 Schema、数据、索引和数据修订触发器并执行 Integrity Check；不把运行中的数据库主文件直接复制，也不产生磁盘明文 SQLite 中间文件。
47. 恢复采用“两遍流式验证”：第一遍只验证整包 GCM Tag，错误密码或篡改时不落恢复文件；第二遍才校验 Entry Hash、Manifest、Schema、数据库和每个文件库对象的 AES-GCM。缺失对象、符号链接、未知路径或新版本 Schema 均失败关闭。
48. 用户先查看来源平台/架构、Schema、数据量、文件数和排除项，再输入「復元」。确认后只写入受管暂存和 OS 保护的新主密钥，应用重启前不触碰活动数据；下次启动先保留原数据回滚点，再切换数据库、文件库和 Key，验证失败会恢复原状态并重新启动。
49. Google Workspace OAuth Token、Cloud Provider Credential、缓存、日志和应用外导出文件不进入恢复包；成功恢复后本机 Google 凭据会清除，必须重新完成公司 Workspace 只读授权。恢复事件只保存 Backup ID、包哈希、摘要与时间，不保存包路径或密码。
50. 数据治理面板在宽屏中固定展示，在 1260px 以下变为可从顶部、Gmail 或“数据策略”入口打开的响应式抽屉，不再因窗口缩小而丢失备份和隐私控制；抽屉与恢复 Dialog 支持自动聚焦、Tab 循环、Escape 关闭和焦点返回。主页日期改为运行时本地日期，不显示硬编码演示日期。
51. macOS 打包已固定 `jp.sesai.agentdesktop` Bundle ID、macOS 13 最低版本、ASAR、原生模块解包和 Apple Vision/NaturalLanguage Helper 资源路径；Helper 以 macOS 13 deployment target 编译并进入额外二进制签名清单。
52. Apple Silicon 无签名验收 DMG 已完成“挂载、复制安装、包内容审计、arm64 原生模块加载、本地 NER 断网声明、Renderer/Preload 启动、SQLCipher 密文头”自动验证。正式发布配置强制 Developer ID 签名与 Apple 公证；证书或公证凭据缺失时构建前失败，不会生成伪正式包。
53. 案件页已提供 `.eml` 多文件导入：每次最多 20 件、单件 10 MB，MIME 最深 30 层、Header 最多 256 KB、附件最多 100 件。解析进程无网络、无应用密钥或 Provider 凭据；原始 EML、附件、发件地址和 Message-ID 不持久化，Message-ID/Thread 只保存 SHA-256 派生键。
54. EML 在本地先分类为案件、要员/候选者或无关邮件；只有案件进入统一 14 字段审核，其他类型逐文件说明并跳过。同一 EML 重复导入由 Schema v13 的局部唯一索引幂等阻止；姓名、电话、邮箱及敏感个人属性完成本地占位符化后才与来源、草稿、加密映射在单一事务中写入。
55. Schema v14 使用 78 个数据库触发器覆盖 26 张核心业务表，以单调本地修订号判断“从未备份”或“备份后有新变化”；内置 `task-sample-*` 演示任务及其 Outbox 明确排除，避免全新安装误报。提醒只保存在加密数据库并每 60 秒/窗口重新聚焦时刷新；用户可选择明日或 7 日后再提醒，延期期间若出现新数据会立即重新提示。系统不会自动选择路径、保存恢复密码、创建未确认备份或上传数据。
56. 若受保护主密钥无法解密或 SQLCipher 活动数据库无法打开，主进程不再只弹窗退出，而是进入不依赖业务数据库的 `OFFLINE RECOVERY` 模式。该模式只注册启动状态、包验证、确认恢复和重试 IPC；不注册候选人、案件、Gmail、Cloud AI 或普通任务 API。原数据保持不变，正确恢复包通过本地双重验证且用户输入「復元」后，才在重启前执行带回滚点的原子替换。
57. Local AI Retrieval Stage 4 已落地：经验下限、费率上限、稼动时点、远程频度、N1–N5 日语等级、粗粒度希望勤務地与法定就劳资格采用 `tri-state-v3` 三态硬条件。明确不满足者在生成向量前排除；资料缺失或区间重叠者保留为“未确认”并交给 HR，不再把未知误判为不适合。其余通过者使用确认后的匿名 CandidateProfile 与项目经历建立加权 BM25，并分别生成 Profile/ProjectExperience 的 384 维归一化向量。
58. 模型固定为 `Xenova/multilingual-e5-small@761b726dd34fb83930e26aab4e9ac3899aa1fa78`，资源逐文件校验 SHA-256，运行时关闭远程模型加载；macOS 子进程同时使用系统 `deny network*` 沙箱。项目向量文本只包含确认后的标题、期间、角色、技术和担当摘要，不包含 Reviewer、Profile/Document ID 或 Source Label。
59. Profile 向量与项目分段向量保存在当前 SQLCipher Schema v37 中，Float32 使用明确小端编码，删除 Profile 时两类索引均由外键级联清除。候选人向量分数取其 Profile/项目分段的最高值，再与 BM25 Rank 通过 RRF（k=60）融合；结果直接展示命中的项目、语义/词法来源、期间、角色、技术和原始 Sheet/Page 证据。Embedding 不可用时只降级到本地 BM25，不会转发到云端。
60. RRF 前 20 名使用固定 `hotchpotch/japanese-reranker-tiny-v2@ba95175a4d53058816b971f31929f10c5cad8560` qint8 ONNX 在端末内精排。输入只包含已确认且匿名化的业务字段/项目摘要，明确排除就劳资格、Reviewer、Source Label、内部 ID、原文件和 PII Mapping；模型、Tokenizer 和平台 ONNX 均按内置 Manifest/哈希校验，远程加载关闭，macOS 使用系统断网沙箱，Windows 使用零网络 Capability AppContainer。精排失败会保留 RRF 顺序，不调用云端。
61. 每次候选人匹配把 Query、算法版本、Hard Filter Policy、候选人 Version、最终 Rank 和结果哈希保存为不可变 Match Run；结果哈希同时覆盖 RRF 前序 Rank、精排 Rank、Logit 与证据，但不单独复制候选人正文。Schema v19 为历史运行回填 `fail-closed-v1`，Schema v24 支持 `tri-state-v3` 并保留旧 `tri-state-v2`，Schema v25 新增 `hard-filter-hybrid-local-rerank-v1` 且保留旧 RRF Run。营业员必须选择「合適/不合適」和结构化原因后才能保存反馈，编辑使用乐观 Revision，反馈只留在加密本地数据库，不进入向量文本或云端载荷。
61. Match Run 显示反馈 Coverage 和完整评审结果集上的 Judged NDCG@20。系统不会仅凭 Top 20 内反馈冒充 Recall@20；在没有“全量已知相关候选人总数”的真实标注集前，Recall 固定显示未算出。候选人永久删除会级联清除其匹配结果/反馈，并在删除影响预览中明确计数。
62. Schema v18 新增 `ses-candidate-benchmark-v1` 本地质量门。评测集只能引用界面中的匿名候选人编号，必须声明不含直接标识符、原始简历和原始邮件；导入文件限定为普通 `.json`、最大 1 MB，姓名/电话/邮箱/住址和 PII 占位符命中即拒绝。
63. 本地评测使用当前固定 ONNX 模型和完整 Hybrid Retrieval，对每个案件取 Top 20，计算宏平均 Recall@20、NDCG@20 与 Project Evidence Coverage。少于 30 个案件、匿名候选人不存在/歧义或任一指标低于阈值时不会显示质量门通过；报告只保存 Query Hash，不复制 Query 文本。
64. Benchmark 与报告进入 SQLCipher、备份修订和一致性快照；候选人永久删除时，引用该匿名候选人的本地 Benchmark/报告会完整清除，避免匿名 ID 成为删除后的残留关联。格式示例见 `examples/ses-candidate-benchmark-v1.example.json`。真实专家标注集与合成 30-case 回归严格区分，合成通过不能替代试点发布门。
65. Schema v20 提供应用内专家标注主流程：HR 只能从当前已确认案件和匿名 Active CandidateProfile 中选择正例；评价 Query 由确认后的技能、角色、费率、开始时间、远程、日语和粗粒度地点生成，不包含案件标题、商流或支付条件。保存前必须明确确认已检查完整 Active 候选人母集，避免把 Top 20 搜索结果误当成 Recall 分母。
66. 专家标注草稿、Case 与 Label 以规范化外键写入 SQLCipher，并使用乐观 Revision 防止旧窗口覆盖。案件或候选人升级后旧标签显示为需再确认；案件永久删除级联删除对应 Case，候选人永久删除只删除其 Label 并把仍存在的 Case 标为无正例。30 件以下允许端侧试跑但固定显示样本不足；JSON 仅保留为外部多人标注集导入通道。
67. OCR 契约已从 Apple 专用结果扩展为共用 `LocalOcrResult`：macOS Apple Vision 与 Windows `windows-tesseract-wasm` 都进入同一 `DocumentIR → PII/DLP → HR 审核` 链。Windows Worker 在无凭据环境中渲染 PDF，加载固定日英 traineddata，父 Worker 与 Tesseract 子 Worker 均安装 Node 网络拒绝守卫；模型 Manifest 和 27,086,736 bytes 资源逐文件校验 SHA-256。只有额外提供目标机 `windows-kernel-network-verified` 证据时 Adapter 才启用，否则扫描件保持 `requires-local-ocr`，明确阻止云端 OCR 回退。
68. 平台密钥边界已区分 macOS Keychain 与 Windows DPAPI；两者都使用 Electron 异步 `safeStorage` 保护小型主密钥，数据库、映射和文件库继续使用共用 HKDF 派生密钥。UI 不再把 Windows 错写成 OS Keychain；离线 OCR 已打包但内核隔离未验证时显示「隔離検証待ち」。
69. Windows 使用独立 `electron-builder.win.yml`：首版目标为 x64 NSIS，包含 Win32 ONNX Runtime、排除 Darwin Runtime 和 macOS Helper，保留固定模型/许可证资源；正式配置强制可执行文件签名和更新签名校验，内部开发配置明确为 unsigned。卸载不会静默删除加密业务数据。
70. `test:platform:win` 验证 Windows 构建资源、DPAPI 映射、共用 Node 网络拒绝守卫、AppContainer 源码接线和 fail-closed 发布门；`test:package:win` 必须在 Windows x64 上核对 PE 架构、SQLCipher/ONNX 原生模块、Embedding/Reranker 模型哈希、两类隔离证据、Schema v37、Cloud Enforcement Manifest、DPAPI、密文数据库、Renderer 和密钥丢失恢复，并直接从 `win-unpacked` 的真实 `app.asar + Resources` 布局运行 Parser/Embedding/Reranker/OCR。恢复容器已增加 Win32 来源跨平台解包测试，但 Windows 实机 SQLCipher 恢复仍需目标机验收。
Windows AppContainer 补充：OCR、Parser、Embedding 与 Reranker 现在共用原生启动器，但使用独立 Profile。启动器以零网络 Capability 创建子进程，只给安装目录/开发根目录只读执行 ACL；OCR 使用一次性二进制 `stdio`，Parser 使用带长度头的二进制 `stdio`，Embedding/Reranker 使用持久 JSON Lines。Windows 缺少启动器时全部本地 AI Worker 失败关闭，不退回普通子进程。
71. Google Workspace 管理卡已提供应用内设置窗口：管理员只填写 Desktop OAuth Client ID、公司域、Label、业务关键词、初回取得期间和单轮上限，并明确确认只申请 `gmail.readonly`。配置自 SQLCipher Schema v21 起持久化，当前随 Schema v37 使用乐观 Revision；Client Secret 不进入表单或数据库，OAuth Token 继续只由 OS `safeStorage` 保护。环境/受管配置优先且在 UI 只读；已连接账号必须先断开，保存后安全重启再开始只读授权。
72. WorkBuddy 风格任务线程不再临时拼接两条展示文案：WorkTask 现在持久化 `WorkTaskMessage / ApprovalGate / Artifact / ToolAudit`，任务页显示可恢复记录数量、最新领域动作、外部副作用和 Cloud Payload 边界。候选检索、简历确认、提案生成/批准/导出都会追加结构化记录；取消后所有业务操作停止，只有用户明确选择“同じ範囲で再実行”才恢复。启动时发现非样例任务停在 `running`，会转为确认待ち且不自动重放外部动作。
73. Schema v22 新增独立 `ProcessingJob` 队列。候选人匹配与简历分析使用请求指纹和幂等键入队，经过 `queued/running/retry_wait/succeeded/failed/cancelled` 状态、租约、进度、最大试行次数和取消信号；应用重启会把遗留的安全本地作业重新排队。提案 ZIP 写入应用外文件，固定为 `manual-review`、单次试行，进程中断后只允许人工核对而不自动重放。任务页同时显示 WorkTask 与最新 ProcessingJob；同范围重试不会重复生成消息、成果物、Match Run 或审批。
74. 简历流程改为“加密暂存 → 显示数据范围/步骤/审批门 → 创建 WorkTask → 启动本地解析队列”，不再在任务预览前读取文件内容。三类队列结果均只保存最小摘要：候选匹配为 Run ID/结果哈希/数量，简历分析为 Document ID/分析哈希，提案导出为 Export ID/包哈希；不复制候选人正文、Query、简历/邮件正文、文件路径、直接标识符或 OAuth 凭据。
75. 跨任务资源调度使用两条独立 FIFO 车道：`local-ai` 串行化候选向量检索与简历 Parser/OCR/姓名检测，`file-export` 串行化提案 PDF/ZIP 写出；同一车道默认并发为 1，异常也会释放车道，另一车道不被阻塞。ProcessingJob 在等待资源时保持 `queued`，取得车道后才领取租约并进入 `running`；排队期间取消的安全本地作业不会开始读取文件或运行模型。
76. Electron Main 的 `SafeLocalProcessingDispatcher` 每秒只扫描到期的 `safe-local` 作业，应用启动后可主动恢复候选匹配与简历分析，不依赖原 Renderer IPC 继续存活；当前三次试行在前两次失败后分别等待 5 秒、10 秒，通用指数退避最高 5 分钟，达到最大试行次数才进入 failed。Dispatcher 不领取 `manual-review` 提案导出；请求指纹或最小载荷引用变化时失败关闭。Renderer 只在存在 active Job 时每秒刷新本地 Bootstrap，作业结束即停止轮询。
77. Google Workspace 卡新增“接続事前診断”：授权前并行检查管理配置、Desktop Client ID 格式、有界同步范围、`127.0.0.1` 随机端口绑定、Google OAuth/Gmail Discovery HTTPS 可达性和 Keychain/DPAPI Token 保护。报告固定声明 `mailboxAccessed=false / credentialCreated=false`，不读取邮箱、不启动浏览器、不创建 Token；Gmail API 是否启用、Client 类型是否确为 Desktop、同意画面是否为公司内部仍明确要求管理员在 Google Cloud Console 复核。
78. Schema v23 新增 Google Workspace“オンライン受入検証”：连接后由用户显式触发，使用受保护 Token 实时复验 Gmail Profile、唯一 `gmail.readonly` Scope 和公司域，再核对当前 Label/期间/单轮上限对应的最近同步、失败数及每条本地 Gmail 记录的脱敏证据。验收执行本身只读取 Profile 元数据，不读取正文、不调用云端大模型、不发送个人数据；持久报告只含配置哈希、计数和状态，不含邮箱地址、Token、邮件正文、Label 或业务关键词。没有成功有界同步或没有至少一条脱敏记录时固定为 `action-required`。
79. Schema v24 与 `tri-state-v3` 新增粗粒度希望勤務地和法定就劳资格硬条件。候选人侧禁止保存住址、国籍、在留卡号或原始在留资格，只保留希望工作/通勤区域及四种合规分类；案件侧禁止“外国籍不可/日本国籍限定”等国籍条件。就劳资格不进入 Profile Embedding、提案正文、匿名附件或任何 Cloud Payload。
80. `cloud-redaction-v2` 在姓名、电话、邮箱、住址、生日、证件号等直接标识符之外，新增国籍、在留资格与就劳资格的本地占位和独立 DLP 复检。原值只进入加密本地 Mapping；未来任何云端适配器仍只能接收带短时有效证据、策略/来源版本与内容哈希一致的 `RedactedPayload`。
81. `ses-privacy-regression-v1` 把本地脱敏提升为独立发布门：28 个虚构 PII 样本覆盖 30 个预期标识符、6 个非 PII SES 业务样本和 4 个姓名/图片/签名/QR 失败关闭场景；同时实跑 macOS Apple Natural Language 英文姓名识别。当前合成回归 Recall/Precision 为 1.0、残留与安全样本误报为 0，并随安装包携带只读证据。普通 Cloud AI 不再接受 Renderer 提交的姓名确认布尔值：Main 先生成脱敏预览和一次性 Review Ticket，再在原生确认窗口批准后重新执行 NER/脱敏/DLP；省略、伪造、重放、过期、跨 Actor 或 Gate 变化均失败关闭。界面明确标记固定合成回归不替代真实日文姓名专家集；Windows 仍要求全部姓名进入 HR 确认门。
82. `ses-privacy-expert-dataset-v1` 提供真实日文专家评测入口。数据集必须在本地由至少 2 名复核者完成分歧处理，覆盖至少 50 份来源、50 个 PII 用例、20 个安全用例和 20 个姓名标注。v2 聚合报告同时绑定 Privacy Implementation SHA、Cloud Enforcement Source SHA 和报告自身 SHA；构建 Manifest 再逐文件绑定打包后的 Main/Preload JavaScript Runtime Bundle Set。评测进程安装 Node 网络拒绝守卫，原文路径、正文和标注值不写入报告。姓名自动 Recall≥90%、非姓名 Recall=100%、人工确认后总 Recall=100%、Precision≥95%、残留=0、安全文本误报率≤5%是专家质量/审计/发布准备度建议指标；缺报告、报告超过 30 天、复核超过一年、平台/架构不符或任一专家绑定哈希变化时，Bootstrap 的专家状态保持 `not-verified` 并提供失败代码，CloudCallAudit 的可选专家哈希写为 `null`，不单独阻断已通过本地硬性出网门的 Cloud 请求。仓库只提供不可直接通过的模板，不伪造真实专家证据。
83. Google Workspace 契约已收紧为当前版本 **GET-only**：方法白名单只含 Profile、Message list/get 与 History，Draft/Create/Update/Send/Modify/Delete 全部不可达；Desktop Client Secret 路径已删除。Loopback 错误 state 只被拒绝而不终止正确授权，回调限制为随机 `127.0.0.1`、PKCE S256，并添加 no-store/no-referrer 响应头。Access Token 401 只强制刷新并重试一次，并发刷新合并为一次；400/401 invalid grant 清除本地凭据要求重连，Refresh Token Rotation 会原子保存。撤销 Token 改用表单正文，URL/日志不出现 Token。`test:google-workspace-contract` 通过真实 Loopback HTTP 模拟完成授权、刷新、基线同步、Label 后加增量、脱敏证据、验收和撤销，固定证明无 Client Secret、无发送方法、无云端模型。
84. Schema v36 的 Match Run 绑定确认案件 ID/Version、完整候选池指纹、CandidateProfile Versions、算法/Hard Filter Policy、Embedding/Reranker ID/Revision 与结果哈希。Main 将 Run 判定为 `current / stale_job_case / stale_candidate_pool / stale_model / stale_policy / invalidated`；Matching-first 首页只返回 Current Run 的持久化证据快照，不重新运行模型，也不展示 Stale 排名。
85. 首页默认保持正式 Fit Rank；营业优先度是独立的 `business-priority-v1` Projection，只读取案件时机、候选者可用时间、提案状态和人工跟进阶段。每次 Projection 保存规则版本、输入快照哈希、理由与生成时间；手动覆盖必须包含当前 Actor、原因、未来到期时间和乐观 Revision，不改写 Fit、Match Run 或历史证据。
86. 案件来源中心统一 Gmail、EML、手工和一次性聊天粘贴，并显示权限、范围、同步/失败/重複、确认待ち和网络状态。聊天输入提交时先清空 Renderer 状态；Main 只在一次调用中执行本地 NER/脱敏，并原子保存 Redaction Session、脱敏 `JobCaseSource` 和既有 Review Draft。所有来源正文都是不可信数据，不能创建 Tool Call、Scope、Actor、审批或外部副作用。
87. Proposal Workspace 按草稿绑定的 JobCase/CandidateProfile 精确版本回读确认字段、来源标签与项目证据；Renderer 只从同一 Workspace 派生案件证据、候选人证据和提案确认三块视图。1440px 为三栏、1280px 为两栏加详情、1100px 为单栏；草稿变更仍由原有 Revision/Content Hash 使旧批准失效。
88. macOS 微信 B-03-1 已实现。`wechat.visible.read` 只接受用户命令与前台微信单一会话 Scope；Main 原生确认后签发 30 秒、Actor/WebContents 绑定且不可重放的 Token。独立 Swift Helper 校验腾讯 Team ID `5A4RE8SF68`、代码签名、Bundle ID、PID/启动时间、前台应用及 Focused Window/Frame，并在 `sandbox-exec (deny network*)` 下运行；Loopback 与外网探针均以 `EPERM` 被拒绝。真实微信 4.1.5 的 AX Tree 只有 5 个可见节点、0 个文本节点，因此在用户授予屏幕录制权限后只捕获同一个微信窗口，裁剪右侧当前会话可见区域并用 Apple Vision OCR；不捕获音频/光标，不读取数据库/历史，不使用 Apple Events、合成输入或滚动。Capture 与原文不落盘、不进 Renderer/Cloud，只保存本地脱敏后的 `wechat-visible` JobCaseSource。无最终签名包与四方报告时 `npm run test:wechat-gate` 返回 `implemented-release-no-go`，不能据此称为正式发布。
89. 外部对照项目没有 License，且其工作树含未提交改动，因此没有复制外部运行时代码或测试字节。`tests/fixtures/external-adoption/fixture-manifest.json` 绑定本项目从零生成的 TXT/JSON/DOCX/XLSX/ATS CSV 合成资产与 SHA-256；这些资产只用于 Parser/安全回归，不计入隐私专家、Recall@20 或客户试点证据。
84. 首页 HR/营业输入区的 Gmail 入口已接入真实状态机，不再永久禁用：未配置时直接打开只读管理设置，已配置未连接时进入权限说明，连接后按管理员冻结的 Label/期间/单轮上限执行同步。同步完成自动进入案件审核并显示取入、重复、范围外、失败和本地保存数量；提示固定声明正文已在端末内脱敏、Cloud LLM 未使用。同步错误可从同一入口重试，Renderer 仍不能扩大范围或选择写权限。
85. 首页 `⌘/Ctrl+K` 已接入本地业务命令面板，可搜索并打开简历文件选择、手工案件、Google Workspace 状态动作、新任务、任务中心、案件/候选者和数据治理；搜索字符不持久化、不调用模型、不发送外部请求。命令只复用已有领域入口，不能绕过执行前预览、Gmail 冻结范围、PII/DLP 或人工审批。侧栏“マイタスク”和首页“すべて見る”已进入同一任务中心，显示全部/进行中/确认待/失败计数并可恢复任务；单机 MVP 不支持的 Workspace 切换和账号角色按钮改为明确禁用，不再呈现假交互。文件选择、手工案件和 Google 设置使用一次性消费请求，页面重新挂载不会重复弹出。
86. 任务详情的结果区已把占位式“候选人/证据/管控”切换改为三个真实视图：主结果负责 HR/营业判断，证据页展示匿名 Rank、Hard Filter/BM25/Vector/RRF/本地精排链路、来源标签、结果哈希、成果物与 ToolAudit，管控页展示固定数据范围、直接标识符上云禁令、Cloud 执行次数、人工审批门和 ProcessingJob 恢复策略。两个辅助视图只从已加载的加密任务快照派生，不追加 IPC、模型调用或网络请求，也不复制姓名、联系方式、原文件名和路径；Renderer 无法借此扩大 Scope 或绕过 Main 的 Preview Hash、PII/DLP 与审批复检。标签使用标准 `tablist/tab/tabpanel` 语义，1100px 小窗口中左右内容独立可滚动；无实际设置功能的齿轮按钮已明确禁用，不再显示假交互。
87. 侧栏与审计链已删除硬编码示例账号。Schema v26 新增单例 `local_operator_profile`：用户可在侧栏设置真实显示名和角色，稳定 Operator ID 与乐观 Revision 随 SQLCipher、加密快照和恢复包保存；未配置时只使用中立的“本机用户”，不会伪造人员姓名。候选审核、案件确认/生命周期、匹配反馈、专家标注、删除报告和提案创建/修改/批准/导出统一从 Electron Main 读取当前操作员，Renderer 不能提交或伪造审计 Actor。档案明确 `cloudEligible=false`，不进入模型、Gmail、日志、向量或 Cloud Payload；修改显示名不会重写历史审计。侧栏“レビュー”计数也改为当前任务、候选人与案件待确认数，不再硬编码。
88. 侧栏“レビュー”已成为独立的统一审核中心，不再跳转到数据治理设置。页面只从当前已加载的加密 Bootstrap 快照派生作业结果、候选人字段和案件草稿三类人工判断项，不新增 IPC、模型或网络请求；同一简历导入任务与候选人审核不会重复计数。候选人列表不显示原文件名或原文，只显示匿名 Document ID；案件只显示端末内脱敏件名，不复制正文。每项可直达对应 WorkTask 或指定 JobCase Review，并提供类型筛选、更新顺序、空状态和标准无障碍状态。1440×1000 与 1100×800 真实渲染无横向溢出，控制台 Error/Warning 为 0。
89. P0-18 提案生命周期已进入主链。`exported` 固定表示“已导出、未发送”，营业员必须从“应用外发送完成”开始，才能按时间顺序追加“收到回复 → 面谈进行 → 参画决定/见送り/辞退”；终态不可继续推进，同一状态不可重复写入，旧窗口以乐观 Revision 拒绝覆盖。Schema v27 的 `proposal_follow_up_events` 只保存本地人工事件、日期、可选备注和由 Electron Main 绑定的操作员；`cloudEligible=false`，不调用 AI、不写 Gmail、不扩大 `gmail.readonly`。备注命中电话或邮箱等直接标识符时拒绝保存；第一条跟进后锁定提案正文、附件、审批和再次导出，候选人/案件删除继续通过外键级联清除关联记录。
90. 显示与语言设置已支持日文与简体中文。侧栏“表示と言語/显示与语言”打开本机设置，选择后立即更新当前 Renderer 的标准 UI、`html lang` 与中文字体栈；受控翻译只覆盖界面词条，不会机器翻译、改写或上传任务指令、候选人/案件字段、原文、备注和审计记录。Schema v28 的 `local_application_preferences` 使用乐观 Revision、SQLCipher、加密快照和恢复包保存语言偏好，固定 `cloudEligible=false`；保存不刷新 Bootstrap、不调用 AI、Gmail 或任何网络接口。

91. Agent 的 Tool 权限已按可逆性分层，注册表全覆盖与对模型开放是两个独立决定。只读/计算层（案件检索、案件详情、候选人档案、面试、匹配依据、执行匹配）保持 `approval:'none'`；本地摄取层允许模型请求，但其产物只能是必须经人工逐项确认的草稿；内部状态变更默认须落到审核中心的 `approval:'inbox'` 审批。当前唯一冻结例外是 `candidate.interview.schedule.local`：只有候选人、日期、时间、方式和时长全部由用户明确给出且可唯一解析时，才以 `approval:'none'` 写入与手工表单相同的本地记录；它不发送通知，`replayPolicy:'manual-review'`，并保留 ActionRun 审计。永久删除、提案导出与恢复包激活固定不对模型开放，即使带审批也不开放 —— 这三类的安全价值来自“影响预览 → 哈希绑定 → 手动输入确认”的人工仪式，该仪式不能由一句自然语言代替。
92. 第一个本地摄取写 Tool `resume.analyze.local` 已接入对话。拖入会话的 PDF/Excel/Word 由 Renderer 交出字节而非路径，Electron Main 复用与原生对话框完全相同的暂存校验：扩展名白名单、Magic Bytes 必须与扩展名一致、25 MB 上限、AES-256-GCM 入库；声明文件名只取 basename（`../../` 被中和而非拒绝），格式由字节决定而不是由 Renderer 或模型声明。模型通过 `import_resume` 按**附件序号**请求取込，不能提交令牌或内部 ID；Main 只接受本进程暂存过的令牌，导入任务由暂存文件反查而不采信 Renderer 传来的 Task ID。本轮没有附件时固定回答“没有可导入的附件”，不会伪造导入结果。取込产物仍是 `awaiting-review` 草稿，未经字段人工确认不会成为候选人档案，`cloudEligible=false`。

93. 拖入对话的简历**先解析、后决定是否导入**。暂存后立即在本机运行同一条解析管线（Parser Worker → 本地 OCR → 姓名候选 → 确定性 PII 脱敏 → 字段/项目抽取），但**不写入任何持久化**：不创建候选人审核、不创建 WorkTask、不保存 Redaction Session。解析结果只存在于本进程内存，随轮次注入模型上下文，因此“总结一下这个人”不需要任何 Tool 调用即可回答。预览与正式导入共用同一个 `analyzeStagedFileLocally`，脱敏策略不可能在“给你看的”和“存下来的”之间漂移。投影仍只放行 9 类业务字段与项目摘要，Document ID、原文件名和来源单元格标签留在本机；确认导入后才落库并进入字段人工审核。另有只读 Tool `candidate.draft.read.local` 用于读取已导入但未确认的草稿，导入轮次留下 `RESUME_1` 形式的匿名引用供后续轮次按序号解析，模型全程不接触 Document ID。所有草稿回答固定标注“机器抽取、未确认”，界面以警示条重申任何字段经人工确认后才会成为候选人档案。

94. 面谈登记已成为可对话调用的写 Tool `candidate.interview.schedule.local`。模型只能填写营业员**实际说出**的参数，其余一律留 `null`；日期、开始时刻、实施方法、所要时间任一缺失即返回 `INTERVIEW_DETAILS_REQUIRED` 澄清追问，Zoom / Google Meet 还必须由用户提供有效会议链接，**不替用户选择**，因此“帮我安排个面试”这类模糊指令不可能创建记录。候选人按三级回退解析：显式排名 → 本会话内唯一一次导入 → 本机唯一一位可排面试的候选人；都不成立时反问是哪一位。面试记录挂在 `candidate_review_states` 上，因此**导入后即可排面试，不必先完成字段确认** —— 招聘实务本就是先面谈后补全资料。模型全程只提交排名或不提交，不接触内部 ID；时间按 JST 组装为 `YYYY-MM-DDTHH:mm:00+09:00`。会议链接由 Main 从当前消息或待补充面谈的最近本地消息中提取并按 `zoom.us` / `meet.google.com` allowlist 校验，真实 URL 不进入 Planning、Final Narrative、Assistant 回答或 ActionRun，Cloud 只看到“已在本机提供”的占位符，ActionRun 只保存 SHA-256 绑定哈希。写入复用手动表单同一条 `saveCandidateInterviewSchedule` 路径，真实链接仅保存于 SQLCipher 面谈记录，面谈者绑定当前操作员，`replayPolicy` 为 `manual-review`。不发送任何通知邮件，回答固定说明这一点，记录可在面试管理中查看与修改。

95. `SES Agent` 已升级为应用的默认主工作区和侧栏最醒目的一级入口。第一次 Bootstrap 会把 Feature Flag 与首屏路由作为同一次 React 状态提交，避免真实冷启动先绘制旧 Dashboard 再切换；后续 Bootstrap 刷新不会把用户从当前页面强制拉回 Agent。旧“工作台”降级为可显式进入的“业务概览”，Flag 关闭时仍冷启动旧工作台并保留经典 `AI 匹配`。Agent 顶部状态条与侧栏共用同一组 Bootstrap 派生值，可进入有效案件、可匹配人才、审核中心、活动记录和备份治理；空状态提供本地简历导入、案件导入与审核快捷入口。未连接受管 AICommerce 时不显示必然失败的聊天 Composer，但本地确定性入口继续可用。已连接时可用文件选择或拖放把 PDF/Excel/Word 作为会话附件，预解析后再由用户决定直接导入或交给受控 Tool。结构化案件、人才、审核和活动页面仍是事实与人工决定界面，Agent narrative 不替代这些页面。

96. Agent 对话已经从“一个功能页”升级为核心任务界面。左侧是可新建、切换和删除的任务/会话历史，小窗口改为抽屉；顶部使用紧凑动态标题，Assistant 回答采用无重气泡正文，User 消息弱化，输入框悬浮在底部。每个会话独立保存当前案件与最近 Match Run，历史异步加载、附件预解析和直接导入都绑定启动时的 Conversation ID，迟到结果不会污染已经切换到的新会话。Planning/Direct Answer 最多携带最近 6 个完整 Turn、12 条 Message 和 8 组匿名证据，19,000 字符开始按完整 Turn 自适应压缩，20,000 字符失败关闭；本轮附件优先保留并记录省略计数。相同 requestId 只有完整输入指纹一致时才幂等复用。候选人档案、面谈、匹配解释、导入草稿和原文档卡片提供预定义的本地打开/跳转按钮，普通模型文本不能产生任意 URL、文件路径、IPC 或命令；候选人删除后相关卡片替换为不含旧姓名和路由的墓碑，所有本地 Document/Interview ID 在 Cloud Projection 中被剥离。

97. Planning 的输出预算已从 2,048 提升并固定到协议允许的 8,192，用于容纳 Responses 推理 token 后仍产出完整的单 Tool JSON；用户可见 Answer/Narrative 继续使用各模型原有的 1,200/4,096 上限。真实回归覆盖“上一轮已给出候选人、日期和时间，本轮只补 30 分钟与 Zoom 链接”：Main 会延续 `INTERVIEW_DETAILS_REQUIRED` 上下文，本地恢复并验证链接，Planner 只看到链接方式和本地占位符，Tool 把真实链接写入 SQLCipher。任一 Cloud Projection、Assistant 内容和 ActionRun 输入都不包含会议 URL 或密码参数；ActionRun 只保存链接 SHA-256，非法、冲突或多个链接继续澄清而不写入。

98. 已发送的 User Message 现在具有 Codex 式消息操作：悬停、键盘聚焦或触屏环境中显示“复制”和“编辑并重新发送”。复制只在明确点击后把该条输入写入系统剪贴板，不调用 Main、模型或网络。编辑在消息原位置显示多行输入、Esc/取消、`⌘/Ctrl+Enter` 和“创建分支并发送”；提交时不破坏性截断原 SQLCipher 会话，而是把目标消息之前的上下文保存为新 Conversation，并以新 requestId 发送编辑内容。原会话、ActionRun、WorkTask、Match Run、简历导入和面谈登记等既有副作用全部保留；无法从前缀 typed blocks 证明的后续案件选择不会混入新分支，附件也不自动复制，需要时由用户重新附加。

99. 简历导入不再只向会话追加“已导入”操作卡。聊天空状态中的“导入简历”卡片会在点击时锁定当前 Conversation ID，并把该 ID 贯穿原生文件选择、全局导入任务和每个文件的 `analyzeResumeFile`；完成时 Main 返回同一会话的最新快照，而不是把它当作与聊天无关的全局候选人导入。Main 会把同一条本地分析产生的未确认字段、技术和项目经历作为 `candidate-draft-facts` 证据块写入该 SQLCipher 会话，导入完成后立即在聊天流中展示并可继续追问。Planning 和 Direct Answer 复用这一持久证据；Cloud Projection 只包含脱敏业务字段和项目摘要，不包含 Document ID、原文件名、姓名、电话、邮箱或 Source Label。已有信任 `resume-import` 卡但缺少事实块的旧会话，仅在本机仍能找到对应分析结果时确定性补全；不从全局候选人库猜测归属。编辑重发分支会同时继承导入关系和这些简历事实，暂存附件仍不自动复制。

100. 面试登记的日期和时间按 JST 理解，但不再把 `YYYY-MM-DDTHH:mm:ss+09:00` 直接交给只接受 UTC ISO 的持久化 Schema。Agent 会在 Tool 执行前校验真实日历日期与 24 小时时刻，再确定性转换成 `...Z`；例如 `2026-08-26 14:00 JST` 保存为 `2026-08-26T05:00:00.000Z`，界面仍按本地时区显示下午 2 点。无效日期/时刻继续澄清而不写入；Main 的持久化异常映射为可理解的本地错误，不再向会话暴露 Zod 正则或原始 Schema 详情。当 Error Block 已与 Assistant 内容相同时，Renderer 只显示一次。

文本型 PDF/Office、扫描 PDF、字段/项目经历人工审核、匿名 Profile、候选人库搜索/版本/归档/删除、Google Workspace 应用内管理配置、Gmail 只读同步、EML/手动案件输入、案件草稿审核/版本/归档/删除、七类三态硬条件 + 本地 BM25/Profile Vector/Project Vector/RRF/日文 Cross-Encoder 精排、项目证据、营业员匹配反馈、应用内专家标注、本地 Benchmark 质量门、提案审批/导出/提案后人工跟进、加密备份恢复和本地变更提醒已进入本地主链路。真实 ONNX 的 1,000 Profile 合成回归中，相关 Rank 为 1/1/1，30-case 质量门 Recall@20/NDCG@20/Project Evidence 均为 1.0；`hardFilterPolicyVersion=tri-state-v3`、`humanLabeledDataset=false`，不能据此宣布达到真实试点门槛。普通 Cloud AI 的本地硬性出网门、两阶段 Review Ticket 和实现绑定已经进入源码并通过本机自动测试；真实日文隐私专家报告尚未生成，只表示质量/审计/发布准备度证据缺失，不再单独阻断满足硬门的 Cloud 请求。真实 30–50 件 SES 检索专家标注集、Developer ID、公证和 Gmail 真实 Workspace 在线验收也仍未完成。

### 本地运行

```bash
npm install
npm run fetch:embedding-model
npm run verify:embedding-model
npm run fetch:reranker-model
npm run verify:reranker-model
npm run dev
```

### 质量检查

```bash
npm run typecheck
npm test
npm run test:persistence
npm run test:schema-upgrade
npm run test:parser-worker
npm run test:eml-worker
npm run test:eml-import
npm run test:parser-network
npm run test:vision-ocr
npm run test:proposal-pdf
npm run test:recovery
npm run test:retrieval
npm run test:embedding
npm run test:embedding-worker
npm run test:reranker-worker
npm run test:privacy-quality-gate
npm run test:privacy-expert -- /absolute/path/to/reviewed.privacy-expert.local.json
npm run test:google-workspace-contract
npm run test:hybrid-retrieval
npm run test:benchmark-example
npm run build
npm run pack:mac:smoke
npm run test:dmg:mac
npm run preview
```

专家隐私数据集必须保存在仓库外或被 `.gitignore` 排除的 `local/privacy-expert/` 中；macOS/Linux 文件权限必须为 `0600`。可从 `examples/ses-privacy-expert-dataset.template.json` 复制结构，但模板刻意设置为不可验收状态；只有真实完成复核后才能改为 `templateOnly=false`。命令只读取该文件一次，输出 `build/privacy-verification/privacy-expert-report.json` 聚合证据，不复制原文。正式发布也可通过 `SES_PRIVACY_EXPERT_DATASET=/absolute/path/...` 提供路径。

### macOS 安装包

当前首发验收目标为 macOS 13+、Apple Silicon。内部无签名验收包通过以下命令生成；它只用于本机/受控开发验收，不应发给外部试点用户：

```bash
npm run pack:mac:unsigned
npm run test:dmg:mac
```

安装包大小、SHA-256、签名和公证状态不在 README 中固定声明，必须读取对应构建生成的 Evidence Manifest。DMG 验证会模拟拖入 Applications 的行为，把应用复制到隔离临时目录后启动，不读取日常用户数据，并核对当前 Schema v37、Cloud Enforcement Manifest、加密操作员档案、本机语言偏好、提案跟进事件、Embedding/Reranker 两套固定模型的逐文件哈希、固定合成隐私证据、可选专家报告与当前实现的绑定状态、Apple Natural Language 姓名识别、ONNX arm64 原生模块与第三方声明；打包前另实跑 Google Workspace GET-only 本地 HTTP 契约。没有固定模型文件、Developer ID 与公证等硬发布证据时，不得把本地 `out/` 构建称为可发布安装包；专家报告缺失只应在 Evidence Manifest 中标记质量/审计/发布准备度不足。

正式发布使用 `npm run release:mac`。该命令先检查 Developer ID Application 身份、`notarytool`、原生 Helper 架构与 macOS 13 deployment target、ICNS，以及以下三种公证凭据之一，再构建签名/公证 DMG 与 ZIP：App Store Connect API Key 三件套、Apple ID/App-specific password/Team ID 三件套，或 `APPLE_KEYCHAIN_PROFILE`。凭据只能通过本机 Keychain 或 CI Secret 注入，不写入仓库。当前机器未配置 Developer ID 和公证凭据，所以正式发布门仍为未通过。

Google 邮箱在线连接采用面向外部用户的产品级 OAuth：软件厂商在 Google Cloud 中启用 Gmail API、创建并维护一个 Desktop OAuth Client，并完成正式发行所需的品牌与 `gmail.readonly` 受限范围审核。普通 HR 不进入 Google Cloud，也不填写 API、Client ID、域名、Label、关键词、密钥或令牌；只在应用内点击“连接 Google 邮箱”，在 Google 系统浏览器中选择个人 Gmail 或任意由 Google Workspace 托管的公司邮箱并同意只读授权。Google 为 Desktop Client 同时签发 Client ID 与 Client Secret；桌面应用属于公共客户端，该 Secret 无法作为真正机密，但当前 Google Token 端点要求提交，因此由软件厂商在构建时一并注入，绝不要求 HR 输入。同步范围使用下列有界默认值：

```bash
SES_GOOGLE_OAUTH_CLIENT_ID="...apps.googleusercontent.com" \
SES_GOOGLE_OAUTH_CLIENT_SECRET="<desktop-client-secret>" \
SES_GMAIL_LABEL_IDS="INBOX" \
SES_GMAIL_QUERY="案件 OR 募集 OR 要件 OR 単価 OR 商流 OR 稼働 OR 参画" \
SES_GMAIL_LOOKBACK_DAYS="30" \
SES_GMAIL_MAX_MESSAGES_PER_RUN="200" \
npm run pack:mac:dir
```

应用内没有 HR 可见的 Client ID 或 Client Secret 配置路径；Token 交换发送 Client ID、构建时注入的 Desktop Client Secret、PKCE 和一次性授权码。Desktop Client Secret 不进入 SQLCipher、Renderer、恢复包或日志；OAuth Token 同样不写入 SQLCipher/恢复包，只由 OS `safeStorage` 保护。公开发行版本不设置 `SES_GOOGLE_WORKSPACE_DOMAIN`，因此同一个 Client ID 可连接个人 Gmail 和不同客户的 Workspace 邮箱；该环境变量只保留给必须限制单一域名的私有发行版。构建未注入 Client ID 时，UI 说明该版本未内置 Google 邮箱连接并阻止登录，不尝试 Gmail 网络访问。默认同步 `INBOX`、上述案件业务词、初回 30 天、每轮最多 200 封，硬上限 500 封；产品管理员仍可用环境变量收窄范围。关键词只支持用 `OR` 分隔的业务词，不接受 `from:` 等 Gmail 操作符。

公司 Workspace 管理策略可能阻止第三方 OAuth 应用。遇到这种情况，普通 HR 不需要配置 Google Cloud，而是由该公司的 Workspace 管理员按产品帮助文档提供的 OAuth Client ID，一次性将本产品设为允许访问 `gmail.readonly`。非 Google 托管邮箱不走此连接器：Microsoft 365 / Outlook 需要独立的 Microsoft OAuth 连接器，其他邮箱的 IMAP 接入留待后续需求验证。

Google OAuth 对外主页、三语隐私政策和利用条款源码位于 `apps/oauth-public-site/`。该站点目前只完成本地构建，尚未公开部署：`gridscale.com` 的 DNS 与 Google Search Console 权限不在当前操作者手中，因此不能把未经域名所有者授权的地址登记为 OAuth Authorized Domain。公开前还必须确认 `gridscale` 是否为客户合同中使用的完整法定运营主体名称。

### AICommerce 会员与 Cloud AI（受管配置）

桌面端采用与 Clear 一致的 Member Center Native PKCE 流程：发起登录前先把 PKCE verifier、`state`、redirect URI 和 10 分钟有效期写入 OS `safeStorage`，再用系统浏览器登录。即使应用在登录途中退出，重新启动后仍能校验同一个 callback；Main 进程必须同时精确匹配 scheme、host、path 和 `state`，才会交换 Native session 与一次性下发的 `account_ai_token`。`accessToken`、轮换式 `refreshToken`、`accountAiToken` 和待完成的 PKCE 状态不会进入 SQLCipher、日志、Renderer、备份或恢复包。普通用户不输入 API Key，也不会调用 Company Payments 或 AI Gateway。

SES Agent Desktop 已使用平台签发的独立身份，不复用 Clear 的 `clear-app` / `clear` 配置。下列值已作为生产默认值内置；后台显示名称为 `sesAgent`，不可编辑的 `app_code` 为小写 `sesagent`，而 `product_code` 为大小写敏感的 `sesAgent`：

```bash
MEMBERS_BASE_URL="https://members.gridscale.com" \
AICOMMERCE_BASE_URL="https://aicommerce.gridscale.com" \
MEMBER_NATIVE_CLIENT_ID="ses-agent" \
AICOMMERCE_APP_CODE="sesagent" \
AICOMMERCE_PRODUCT_CODE="sesAgent" \
MEMBER_NATIVE_REDIRECT_URI="com.gridscale.native.ses-agent://auth/callback" \
AICOMMERCE_BILLING_MODE="automatic" \
npm run dev
```

`AICOMMERCE_BILLING_MODE` 支持 `automatic`、`subscription` 和 `standard`，未填写时按 Clear 的行为使用 `automatic`。`automatic` 先尝试包月，仅当 AICommerce 明确返回 `SUBSCRIPTION_QUOTA_POLICY_NOT_FOUND`、`SUBSCRIPTION_QUOTA_POLICY_NOT_CONFIGURED` 或 `SUBSCRIPTION_QUOTA_EXCEEDED` 时才改用普通钱包；认证、权限、网络和其他服务错误不会触发扣钱包。`subscription` 与 `standard` 则固定使用各自的计费池。

桌面端通过 `/v1/wallet` 和 `/v1/ai/capabilities` 读取普通钱包与当前产品能力，自动选择第一个 active 的 chat/text 能力，不让用户猜 capability alias；统一调用 `/v1/ai/requests`，为一次业务操作在各计费池生成稳定且彼此区分的 `request_id`。401 时通过 Native refresh/reset 单飞安全换 token，202 最多轮询 60 秒。设置页可刷新会员状态、手动重发 AI Token、打开 Member Center 或退出登录。Member Center 的套餐、充值、账单和 Stripe Portal 是 cookie BFF，因此从应用打开已登录的系统浏览器页面管理，不用 Native JWT 伪造 BFF 请求。环境变量的优先级高于内置生产值，可用于本地联调；旧的 `SES_*` 变量暂时作为兼容别名读取。

普通 Cloud AI 采用失败关闭的两阶段协议。`prepareAiCommerceCloudPrompt` 只在 Main 重新验证合成质量门、本地 NER、当前实现安全绑定和其他硬性出网控制后生成脱敏预览与最长 10 分钟的一次性 Review Ticket，不创建 Provider 请求；`executeAiCommerceCloudPrompt` 只接受 Ticket，并在 Main 原生窗口确认后再次复核 Endpoint、Actor、内容/检测摘要/预览哈希、Redaction Session 与 DLP，随后才进入 allowlisted `CloudRedactionGateway`。匹配 Agent 使用独立的受控 planning/final 路径：经本地 NER/DLP 处理的用户请求、最小会话文本和匿名证据可用于 AI 选择 `ANSWER` 或一个白名单 `TOOL`；模型不能直接访问本地接口，Main 会严格拒绝未知 Tool、越界参数、内部 ID、多 Tool，以及不在 Agent allowlist 中的写操作。当前只开放本地履历摄取与参数完整的本地面谈登记，不开放外部发送、提案导出、删除或任意业务写。真实日文专家 Attestation 若存在只进入质量/审计/发布准备度状态，缺失或过期不单独阻断满足硬门的请求。登录成功、钱包可用或 Renderer 布尔值都不能启用 Cloud。原始简历、邮件、图片、Token、Ticket Secret 和服务端内部密钥不会离开设备。`com.gridscale.native.ses-agent` 已静态注册到 macOS `CFBundleURLTypes` 和 Windows NSIS 安装协议；上线验收仍需在已签名安装包上实测冷启动 callback、PKCE 登录、会员权益、自动能力发现、三类包月回退错误、402 充值引导和生产 202 完整链路。

已有会员登录凭证的测试设备可用 `SES_AICOMMERCE_PRODUCTION_PROBE=1` 启动打包应用。该模式不打开窗口、不读取任何业务数据，只发送代码内固定文本“请只回复 OK。”，核对钱包、能力发现、自动计费和 AI 响应后立即退出；日志只输出请求/计费元数据、`diagnosticOnly=true` 和固定的 `privacyGateExemption=fixed-synthetic-connectivity-probe`，不输出 Token 或响应正文。它是与普通业务入口隔离的固定合成连接诊断，因此不进入业务正文的 NER/脱敏/Review Ticket 流程；该豁免不能用于用户数据，也不会改变普通 Cloud AI 的硬门、专家质量提示或正式发布状态。

`test:persistence` 在 Electron 自身的 Node ABI 下验证数据库密文头、错误密钥拒绝、任务消息/审批/产物/审计的重启与快照恢复、操作员档案与本机语言偏好的密文/稳定 Revision/快照恢复、ProcessingJob 幂等入队/租约/进度/取消/安全重放/人工复核/结果哈希、PII 映射、字段/项目审核、住址/国籍/就劳资格合规门、Profile/项目向量缓存、Match Run 幂等、三态 Hard Filter Policy、反馈 Revision、Recall 不误报、应用内专家标注草稿/失效/删除级联、Google Workspace 管理配置与最小化在线验收报告、Benchmark/报告绑定与删除级联、候选人和 JobCase 生命周期、删除报告、Gmail/EML 去重、提案审批/导出/跟进顺序/终态/备注 PII 拒绝/删除级联、备份提醒与恢复审计。`test:schema-upgrade` 从真实 Schema v13 升级到当前 v38，并单独验证已有 `tri-state-v2` Match Run 在后续重建中完整保留，同时核对 139 个修订触发器、Cloud Gate/Ticket 审计列、Matching-first/营业优先级/聊天来源结构和外键；`test:schema-v37-agent` 使用真实 v37 表结构保留旧 candidate/interview Conversation 与 ActionRun/ActionEvent，再验证 v38 重建复制、新 Tool 写入和 Conversation 删除后的 SET NULL；`test:hybrid-retrieval` 在固定 Embedding/Reranker 模型文件已安装时，才会在系统断网沙箱内对 1,000 Profile + 项目段运行真实多语 ONNX 模型、候选人级聚合、余弦召回、RRF、项目证据和 30-case 合成质量门；模型缺失时按设计失败关闭。

Windows 目标机开发验收使用以下命令。由于 SQLCipher 原生模块不能由当前 node-gyp 从 macOS 交叉编译，构建脚本会在非 Windows x64 主机提前失败；`.github/workflows/windows-development.yml` 固定在 Windows runner 运行同一流程：

```bash
npm run test:platform:win
npm run test:windows-ocr
npm run test:windows-local-workers
npm run pack:win:dir
npm run test:package:win
npm run pack:win:unsigned
npm run test:installer:win -- --development
```

`npm run test:windows-ocr` 已能在断网守卫下对扫描 PDF 运行固定 Tesseract WASM 日英模型，并核对识别结果、资源哈希和 `networkAccess=false`。`npm run test:windows-local-workers` 会在 Windows x64 上通过同一个零网络 Capability AppContainer 实跑 Parser、Embedding 和 Loopback 拒绝探针，产出绑定启动器 SHA-256 的证据。`npm run test:package:win` 随后从打包目录再次运行三类 Worker，防止打包路径、ASAR、ACL 或模型资源错误被打包前测试掩盖。`npm run release:check:win` 会继续失败关闭，直到包后自检、两类目标机证据、代码签名凭据和功能证据全部存在。

`test:installer:win` 只能在一次性 Windows CI 或明确设置 `SES_ALLOW_WINDOWS_INSTALLER_TEST=1` 的专用验收机运行，因为 NSIS 会写入当前用户的安装注册信息。它在隔离的 `%APPDATA%` 下静默安装并启动应用，验证 Schema v37、Cloud Gate 失败关闭状态、DPAPI 和密文数据库，然后静默卸载并确认业务数据仍保留；提供 `SES_WINDOWS_PREVIOUS_INSTALLER` 时还会先安装上一版并验证升级保留。正式 `release:win` 要求 Authenticode 有效后执行同一流程。

Playwright 真实渲染验收覆盖 1440px 工作台、`⌘K` 本地业务命令/键盘执行、任务中心、统一审核中心、候选人/案件精确直达、操作员档案保存与侧栏即时更新、命令直达手工案件、Google Workspace 管理设置、授权前连接诊断与连接后在线受入检验、持久任务记录/取消/同范围重试、ProcessingJob 完成状态、简历“加密暂存但执行前不解析”的任务入口、备份到期/延期状态、恢复确认、EML 审核来源、Local AI Stage 4 项目证据/精排 Rank、任务证据/管控三视图、匿名来源与哈希、人工审批边界、提案后人工跟进时间线、营业员反馈、候选人质量门、应用内专家标注、日文/简体中文切换，以及 1100/1280px 治理抽屉和焦点返回；1100px 任务页、审核中心、提案跟进、操作员和显示语言窗口已实测无横向溢出。外部吸收改造另实测 Matching-first 首页、五类案件来源卡和 Proposal Workspace：1440/1280/1100 分别为三栏/两栏/单栏，页面与提案容器均无横向溢出，微信卡展示 Accessibility、屏幕录制、单窗口范围、断网 Helper 与本次读取状态；真实原生确认和窗口捕获由 macOS 目标机验收覆盖。可复用视觉 Fixture 位于 `scripts/playwright-renderer-mock.js`；本次截图写入 `output/playwright/external-adoption/`，控制台 Errors/Warnings 均为 0。

下一开发切片先关闭本地硬性出网与 P0 发布证据：固定模型文件、macOS 目录包/签名包失败关闭验收、A-02 文档自动校验，以及后续真实受控网络链路。仓库外至少 50 份来源、双评审的日文隐私专家数据集和与当前源码绑定的 v2 报告仍建议补齐，用于质量、审计和发布准备度，不再作为普通 Cloud 调用的单独阻断项。匹配质量门另需 30–50 个真实 SES 案件。Windows 侧仍必须在 x64 目标机编译原生启动器并运行 CI/首个目录包，取得 OCR 与 Parser/Embedding/Reranker 的真实 AppContainer 证据，再完成代码签名、安装升级和实机恢复。当前只能称为 A-01 本机实现与构建验证完成，不能称为可发布版本。
