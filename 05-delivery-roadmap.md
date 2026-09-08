# 开发周期与交付计划

<!-- ses-current-state package=0.1.0 schema=46 -->

> 版本：v0.7
> 基准计划：8 周完成脱敏数据垂直演示，16 周完成可处理受控真实数据的 macOS Electron MVP
> 人员假设：1 名全职工程师 + 兼职产品/SES 业务人员 + 安全/合规评审支持

## 1. 计划结论

在真实样本能够按时提供的前提下：

- **8 周**交付脱敏数据垂直演示：用户作业任务、简历导入与审核、手工/粘贴案件和基础检索。该版本不处理未脱敏真实个人信息，不作为生产安装包。
- **16 周**交付 macOS 安全试点版：本地 OCR/PII/DLP/Embedding、云端强制脱敏门、Google Workspace Gmail API、Hybrid RAG、提案与脱敏、一致性备份恢复、删除报告、工具审计和签名安装包。
- macOS 试点 Go 后立即进入 **4–6 周 Windows 同功能版本**，复用领域逻辑、数据 Schema、Gmail 和隐私链，替换平台 OCR、密钥、安装、签名与更新集成。
- 如果业务样本、Google OAuth Restricted scope 审核路径或外部模型数据策略未在 Phase 0 确认，16 周 macOS 日历不成立。
- 16 周假设“小型本地 LLM”是通过质量门才启用的增强项；如果要求所有结构化提取和日文生成都必须由本地 LLM 生产化，需增加约 2–4 周或增加一名本地推理工程师。
- Windows、团队共享、云端同步和管理后台不计入这 16 周；Windows 先交付，之后团队协作版另需约 **8–12 周**。

## 2. 示例日历

若从 2026-07-20 开始：

| 阶段 | 周期 | 示例日期 |
|---|---:|---|
| Phase 0 业务确认与样本基线 | 1 周 | 07-20 ～ 07-24 |
| Phase 1 桌面基础与本地数据 | 2 周 | 07-27 ～ 08-07 |
| Phase 2 简历引擎 | 3 周 | 08-10 ～ 08-28 |
| Phase 3 案件入口、邮件语义与 Gmail Spike | 2 周 | 08-31 ～ 09-11 |
| Phase 4 Hybrid RAG 与匹配解释 | 2 周 | 09-14 ～ 09-25 |
| Phase 5 提案、脱敏与 Gmail 生产接入 | 2 周 | 09-28 ～ 10-09 |
| Phase 6 安全、发布与恢复 | 2 周 | 10-12 ～ 10-23 |
| Phase 7 受控试点与修正 | 2 周 | 10-26 ～ 11-06 |
| Phase 8 Windows 同功能版本 | 4–6 周 | 11-09 ～ 12-18 |

安全、测试和评测不是最后阶段才开始，而是从第一周持续执行；Phase 6 是两周的集中验收、恢复演练和发布加固。第 8 周末设置独立 Demo Gate，只允许使用脱敏评测数据。

## 3. Phase 0：业务确认与评测基线

### 目标

在写主流程代码前确认真实输入、业务真值和数据政策，避免技术完成后才发现无法使用真实数据。

### 工作

- 访谈 2–3 名营业员和招聘/人事用户。
- 确认一名 MVP 主操作营业员，并绘制 HR 资料输入和负责人报告导出的应用外交接路径。
- 收集并脱敏 50 份简历、200 封案件/非案件邮件。
- 统计文件格式、模板类型、扫描件比例、Gmail Label/业务 Query 和邮箱代理/共享使用方式。
- 业务人员标注关键字段与 30–50 组案件—候选人匹配判断。
- 确认模型 Provider、数据保留、处理区域和公司批准边界。
- 邮箱已确认为 Google Workspace；冻结首发唯一 `gmail.readonly`、GET-only 方法白名单、无 Client Secret、凭据刷新/撤销策略。草稿能力不进入首发范围。
- 确认 Google OAuth 应用是 Internal 还是 External，评估 Restricted scope Verification、安全评估、隐私政策和试点账号白名单所需时间。
- 完成 `.xls`、日文 PDF、本地 Embedding 和 Electron 打包 Spike。
- 完成 SQLCipher/等价全库加密、`safeStorage` 异步 API、SQLite 一致性备份和独立解析辅助进程 Spike。
- 冻结“云端零直接标识符”策略：姓名、电话、私人邮箱、住址、生日、照片/人脸、签名、证件号、个人账号/URL 和识别性二维码。
- 使用 macOS Vision、本地日文 NER/PII 候选模型和 DLP 规则跑假名化数据 Spike，记录各字段 Recall/Precision。
- 在目标最低配置 Mac 上测试 Transformers.js/ONNX 与 `llama.cpp` 候选的模型体积、冷启动、峰值内存、日文提取准确率和签名打包。

### 交付物

- 冻结的 Candidate 与 JobCase Schema v1。
- 冻结的 WorkTask、TaskStep、ContextBinding、Artifact、ApprovalGate 和 ToolAudit Schema v1。
- 冻结 RedactionSession、LocalPiiMapping、RedactedPayload、CloudCallAudit 和 LocalModelManifest Schema v1。
- 样本目录、脱敏说明和评测真值。
- 业务流程现状与目标耗时。
- 数据处理决策与禁止事项。
- 技术 Spike 报告和关键库可行性结论。

### 退出门槛

- 评测样本可合法用于开发。
- 三类主要简历模板均有样本。
- Google Workspace Gmail API 接入路径与 macOS 首发、Windows 次发顺序确认。
- 不存在“开发完成后再决定能否调用模型”的关键悬而未决项。
- 固定虚构 PII 回归集、DLP 发布阈值和本地模型清单已进入自动发布门；真实日文姓名专家集作为质量/审计/发布准备度建议证据仍需补齐，试点 Mac 最低硬件仍需确认。
- 若本地小型 LLM 未达到日文准确率/资源门槛，明确冻结为非关键路径，不阻塞 OCR、PII、Embedding 和云端脱敏方案。
- 不存在“开发完成后再决定 Gmail OAuth 审核方式”或“同一单机 MVP 同时支持多个登录角色”的关键悬而未决项。

## 4. Phase 1：桌面基础与本地数据

> 当前进度（2026-07-20）：WorkTask 的消息、上下文、步骤、审批门、匿名产物和 ToolAudit 已进入加密持久化、快照、恢复包和任务 UI。Schema v22 已提供独立 ProcessingJob 状态机、租约、进度、指数退避、取消请求、结果哈希和启动恢复；候选人匹配与简历分析作为 `safe-local` 作业真实入队，并由 Electron Main Dispatcher 在启动和到期时主动领取。提案导出作为 `manual-review/maxAttempts=1` 作业入队，中断后不自动重复写外部文件。本地 AI 与文件导出已有独立 FIFO 并发车道，等待资源时保持 queued。独立 Utility Process Dispatcher 属于后续纵深加固。

> 主交互进度（v0.37 / Schema v37）：首页 `⌘/Ctrl+K` 已成为本地允许动作索引，任务、输入、数据和治理入口均可键盘访问；有确认案件和人材时首页切换为 Main 判定的 Matching-first 状态，Stale Run 不返回旧排名，Fit 与营业优先级保持两个独立排序视图。案件来源中心统一 Gmail、EML、手工、一次性聊天粘贴和受控 macOS 微信可见消息读取；微信卡片在本机预检通过后可执行，正式发布证据不足时仍明确标记 Release No-Go。提案确认按绑定版本显示案件证据、候选人/项目证据和提案内容，1440/1280/1100 分别使用三栏、两栏和单栏。侧栏新增“表示と言語/显示与语言”本机设置，日文与简体中文选择后立即更新允许列表中的 UI 文案、`html lang` 与中文字体栈，不翻译业务记录或触发网络；语言偏好由 Schema v28 引入，当前随 Schema v37 使用乐观 Revision、SQLCipher、快照与恢复包保存。任务详情的主结果、证据和管控继续复用既有状态；视图切换不产生模型或网络请求。侧栏硬编码示例账号已替换为 Schema v26 引入、当前 Schema v37 持久化的加密本机操作员档案，新审核/删除/反馈/提案审计由 Main 统一绑定当前 Actor。

> 微信平台进度（2026-08-18）：B-03 为 macOS-only，不规划 Windows 微信连接器。B-03-1 已实现 Swift Helper、ToolSpec、两阶段 IPC、30 秒一次性 Scope Token、前台/签名/进程/窗口绑定、窗口级 ScreenCaptureKit + Apple Vision OCR、本地脱敏、Schema v37 来源与断网探针。微信 4.1.5 AX 实测为 0 个文本节点；替代捕获只处理前台微信单一窗口右侧可见会话，不捕获音频/光标，不使用 Apple Events、AppleScript、合成输入、滚动或历史展开。开发机验收完成；最终签名/Hardened Runtime/公证候选包、撤权/升级负向测试和安全/产品/IT/法务 Go 仍未完成。

> Google Workspace 状态：授权前的本机 Loopback、固定 Google HTTPS 端点、配置范围与 OS Token 保护诊断已进入治理面板，且不会读取邮箱或创建 Token。首页主输入区已接通管理设置、只读连接说明、有界同步和案件审核结果，HR/营业员不再需要先理解治理侧栏才能导入邮件。连接后的 Profile/Scope/公司域实时复验、当前范围同步核对、逐条脱敏证据聚合和 Schema v23 最小化验收报告也已进入主链。真实公司 Client ID、Internal Consent、Gmail API 项目开关及公司账号执行仍是外部试点门。

### 目标

建立安全的 Electron 骨架、数据库、任务队列和可发布的最小应用。

### 工作

- Electron Main、Preload、Renderer 分层。
- Context Isolation、Sandbox、CSP 和 IPC 白名单。
- SQLite Schema、迁移、事务与 Repository。
- 本地加密数据库、文件库和操作系统密钥链。
- 持久任务队列、进度、取消、重试和崩溃恢复。
- WorkTask、WorkTaskMessage、TaskStep、ContextBinding、Artifact、ApprovalGate 和 ToolAudit 的持久化与状态机。
- 受限意图路由与任务预览；首版使用规则/Mock，不把不可控模型路由作为基础架构前置。
- `CloudRedactionGateway` 唯一云端出口、类型隔离、Endpoint Allowlist 和网络旁路测试骨架。
- RedactionSession、LocalPiiMapping、CloudCallAudit 与 LocalModelManifest 的加密持久化。
- 本地模型安装/升级流程、哈希验证、固定模型目录和推理时禁用远程加载。
- 作业、今日、候选人、案件、审核中心和设置的基础路由。
- 稳定 UUID、Revision、Tombstone 和只写本地的变更 Outbox。
- 本地日志脱敏与错误码框架。
- macOS 开发签名和 CI 冒烟流程。

### 交付物

- 可安装的空壳应用。
- 数据库迁移 v1。
- 任务恢复演示。
- IPC 和安全配置自动化测试。

### 退出门槛

- Renderer 无文件系统和 Node 权限。
- 应用退出后队列可以恢复。
- 应用退出后，`awaiting_input/running/awaiting_review` 的用户任务可以恢复消息、上下文、步骤和审批状态。
- 数据库和测试文件加密验证通过。
- 未经 `dlpStatus=passed` 的测试载荷无法调用 Cloud Provider Mock，任何直接 Provider 调用都会被测试阻止。

## 5. Phase 2：简历引擎

### 目标

完成“导入 → 本地解析 → AI 提取 → 校验 → 人工确认 → 候选人库”的完整闭环。

### 第 1 周：解析器与 DocumentIR

- 文件类型、哈希、重复和输入限制。
- SheetJS 解析 `.xls/.xlsx/.xlsb`。
- Mammoth 解析 `.docx`。
- PDF.js 文本与页面解析。
- DocumentIR、来源引用、解析警告和隔离 Worker。
- macOS Vision 本地 OCR、文字坐标、照片/人脸、签名和二维码候选区域识别。

### 第 2 周：AI 提取与验证

- Candidate JSON Schema。
- Provider Adapter、Prompt v1、结构化输出。
- 本地 PII 规则/词典/NER、稳定占位符、加密映射和独立 DLP 复检。
- 本地分类/首轮提取；质量不足时只允许把 `RedactedDocumentIR` 交给 Cloud Provider。
- 程序格式校验、一致性校验和审核任务。
- 扫描 PDF 本地 OCR 与遮盖流程；无法可靠处理时转人工，不上传原 PDF/页面。
- 成本、Token 和耗时记录。

### 第 3 周：审核与候选人库

- 原文与字段对照审核界面。
- 候选人搜索、筛选、详情与版本。
- 重复候选人提示与人工合并。
- 用户修正记录。
- 本地 Embedding 与索引重建。
- 跑 50 份样本并修正主要模板问题。

### 交付物

- 可用于真实脱敏样本的简历导入流程。
- 简历评测报告 v1。
- 解析失败分类和人工兜底路径。

### 退出门槛

- 关键字段准确率达到 90%。
- 每个关键字段有来源或明确标记无来源。
- 未确认资料不会进入正式匹配索引。
- 恶意/异常文档测试不会导致应用失控。
- 固定简历 PII 泄漏集中的残留标识符载荷全部被 Cloud Gateway 阻止，原文件和页面图像没有云端路径。

## 6. Phase 3：案件入口、邮件语义与 Gmail Spike

> 当前进度（2026-07-20）：手动案件、Gmail 模拟 Provider/增量检查点、EML 多文件导入和 Google Workspace 应用内管理配置已进入可运行主链。管理员可配置 Client ID、公司域和有界同步范围，Client Secret/Token 不入库，保存后重启进入只读连接；真实 Google Workspace OAuth 在线验收与 200 封业务评测集仍待完成。

### 目标

完成“手工创建/粘贴邮件/`.eml` 导入 → 邮件分类 → 案件提取 → 去重 → 案件列表”，并对 Google Workspace Gmail API 完成 OAuth 和增量同步 Spike。第 8 周垂直演示不以 Gmail 连接成功为前提。

### 第 1 周：手工案件与邮件语义

- 手工录入、粘贴邮件和 `.eml` 导入。
- 邮件正文纯文本化、远程资源阻断和缓存策略。
- 本地清除邮件签名、历史收发件人链与直接标识符，生成 RedactedMailContent 并执行 DLP。
- Message-ID、线程和业务指纹幂等。

### 第 2 周：案件处理与 Gmail Spike

- 案件/人员提案/无关邮件分类。
- JobCase Schema 与 AI 提取。
- 业务特征去重和转发合并。
- 案件审核、列表、详情和原文对照。
- 应用关闭后的下次启动补齐验证。
- Google OAuth 登录、`gmail.readonly`、Label/Query 范围、`historyId` 增量检查点、检查点过期后的有界重扫和重复幂等 Spike。
- 验证 GET-only Gmail 方法 Allowlist；代码不实现 Draft/Send/Modify/Delete，真实 Loopback HTTP 契约必须通过。

### 退出门槛

- 200 封样本分类和关键字段准确率达到 PRD 门槛。
- 同一邮件重复同步不会产生重复案件。
- 手工建案和 `.eml` 导入不依赖邮箱连接。Gmail Spike 给出 OAuth 审核路径、Scope、History 同步、草稿方法白名单和生产计划，不作为第 8 周 Demo Gate 的强制条件。
- 邮件正文中的 Prompt Injection 无法触发工具调用。
- 未脱敏邮件正文和附件无法进入 Cloud Provider，CloudCallAudit 能关联脱敏策略与输入哈希。

## 7. Phase 4：Hybrid RAG 与匹配解释

> 当前进度（2026-07-20）：Stage 4 已实现经验、费率、稼动、远程、日语、粗粒度希望勤務地与法定就劳资格的 `tri-state-v3` 三态硬条件、确认字段/项目经历的加权 BM25、Profile/ProjectExperience 独立 384 维 Embedding、候选人级聚合、RRF 与固定日文 Cross-Encoder 本地精排。Schema v25 保存分段缓存、匹配运行、BM25/Vector/RRF/Rerank Rank、策略版本、反馈、Benchmark 和专家标注草稿。缺失条件不会被当作失败，结果卡要求 HR 确认；就劳资格不进入 Embedding/Reranker、提案或云端载荷。治理面板要求确认完整 Active 候选人母集，并在端末内计算 Recall@20、NDCG@20 和 Project Evidence Coverage。真实 ONNX 的 1,000 Profile、30-case 合成质量门通过，但明确标记 `humanLabeledDataset=false`；真实 30–50 件专家标注集仍待完成。

### 目标

让营业员得到可审核的 Top 3–5 候选人，而不是不可解释的单一分数。

### 工作

#### 第 1 周：检索基线

- 技能同义词与规范化字典。
- 可用时间、费率、粗粒度工作地点、语言和法定就劳资格硬过滤。
- CandidateProfile 与项目经历的 RAG 索引管线。
- 从 JobCase 构造结构化、关键词和语义 Query。
- BM25/关键词召回、本地向量召回及结果融合。

#### 第 2 周：精排、解释与评测

- 已完成 Top 20 日文 Cross-Encoder 本地精排与固定 Rank/证据 Schema；精排只接受已确认匿名字段/项目摘要，不读取原始候选人资料。
- 真实专家标注集调优；任何未来云端精排仍只允许 RedactedRankingInput，本地 Embedding、BM25 和硬过滤不发送候选人原文。
- 来源引用、索引版本和删除/归档失效机制。
- 满足项、冲突项、未知项和资料过期提示。
- “合适/不合适 + 原因”反馈。
- 30–50 组标注案件的离线评测。

### 退出门槛

- Top 3 获营业员认可率达到 60%。
- 标注集中正确候选人的 Recall@20 达到约定门槛，默认目标 ≥ 90%。
- 推荐理由能引用具体案件和候选人证据。
- 未知字段不会被错误视为不符合。
- 模型精排不能推翻程序硬约束或自动拒绝候选人。

## 8. Phase 5：提案、脱敏与 Gmail 生产接入

> 当前进度（v0.35）：P0-18 已进入可运行主链。提案导出后仍明确显示“未发送”；营业员必须先人工确认应用外发送，才能追加回复、面谈或参画决定/见送り/辞退。Schema v27 以顺序事件保存日期、可选备注和 Main 绑定的操作员，使用乐观 Revision、时间单调校验和终态封闭；开始跟进后冻结正文、附件、审批与再次导出。事件只在 SQLCipher/加密备份中存在，备注命中直接标识符即拒绝，不调用 AI、不写 Gmail、不扩大 `gmail.readonly`。

### 目标

形成可审核、可追踪的提案草稿，但不自动发送。

### 工作

- 日文提案模板、公司术语和语气配置。
- 使用确认后的结构化数据生成邮件。
- 云端提案生成只使用脱敏候选人/案件上下文，真实姓名和收件人由本地在输出校验后插入。
- 标准化脱敏简历 PDF。
- 脱敏附件可呈现 HR 确认后的项目经历；内部 ID、Source Label 和原文件名不得进入附件，全部项目内容在生成边界再次执行直接标识符扫描。
- 收件人、正文、附件和差异统一确认页。
- 复制到剪贴板、打开系统邮件客户端或导出提案包；不创建 Gmail 草稿。
- ProposalDraft 状态、版本和审计事件。
- ProposalDelivery 的 `exported-not-sent`、确认内容哈希和 append-only 人工后续结果记录。
- 完成 Gmail `historyId` 只读增量同步；提案交付继续由人工在应用外完成，不扩大 Gmail Scope。

### 退出门槛

- 原始简历不能被误选为可发送附件。
- 重新生成或修改收件人后，旧确认自动失效。
- 不存在无需用户确认的发送路径。
- `exported` 不会被记为 `sent`；收件人、正文或附件变化会使旧确认失效。
- 跟进第一条只能为 `sent`，日期不能倒退，终态不可继续推进；旧窗口不能覆盖较新 Revision。
- 业务人员抽查日文敬语、字段准确性和脱敏效果。

## 9. Phase 6：安全、发布与恢复

> 当前进度（2026-08-18）：手动加密恢复包、SQLCipher 一致性快照、文件 Manifest、两遍认证验证、启动前切换/回滚、恢复审计和删除后的旧包轮换提示继续存在；v35 增加 Cloud Gate/Attestation/Review Ticket 审计绑定，Schema v36 增加聊天粘贴来源、Match Run 有效性绑定、持久化结果证据和营业优先级 Projection，当前 Schema v37 再增加脱敏微信可见消息来源。普通 Cloud AI 已改为 Main 所有的两阶段协议和本地硬性出网门失败关闭，本机 Schema v13→v37、持久化、单元/边界测试、合成隐私门与生产构建通过。真实日文专家报告仍是质量/审计/发布准备度建议证据，不再单独阻断已满足硬门的 Cloud 请求。2026-07-21 的 Schema v28 Apple Silicon 无签名 DMG 只能作为历史产物，不能证明当前 v37 构建已打包或发布；固定模型大文件、Developer ID 签名/Apple 公证、签名包真人恢复演练和升级回滚仍待完成。

### 目标

将功能版提升为能够处理受控真实数据的签名安装包。

### 工作

- Electron 安全清单与依赖审计。
- 恶意文档、超大文件、超时和 Prompt Injection 测试。
- 日志与崩溃报告 PII 扫描。
- 全 Cloud Provider 网络路径审计、DLP 绕过测试、占位符映射泄漏扫描和 `CloudCallAudit` 完整性测试。
- 本地模型进程断网、无凭据、固定哈希、禁用远程模型/Telemetry 和资源耗尽测试。
- 数据导出、删除、备份、恢复和密钥丢失演练。
- SQLite 一致性快照、文件库 Manifest/哈希校验和原子恢复。
- 用户任务与工具审计的完整性回归：计划、允许、执行、阻止、证据与审批。
- DataDeletionReport 的活动数据删除、备份过期和密钥销毁演练。
- 数据库迁移失败回滚。
- macOS 签名、公证、安装和升级。
- 使用说明、隐私说明、已知限制和故障恢复手册。

### 退出门槛

- 安全与数据治理文档的发布清单全部通过。
- 备份恢复后数据、索引和版本一致。
- 备份恢复通过数据库快照、文件 Manifest、对象哈希和索引版本的一致性校验。
- 安装、升级、卸载不会泄露临时数据或破坏受管数据。
- 所有真实数据 Cloud AI 调用都有有效脱敏会话和 DLP 通过证据；任何残留直接标识符请求均被阻止。

## 10. Phase 7：受控试点

### 目标

验证真实业务是否愿意持续使用，而不仅是模型 Demo 是否好看。

### 试点范围

- 1 名主操作营业员；另由 1 名 HR 或负责人作为上游资料提供/结果观察者，不登录同一单机工作区。
- 1 个 Google Workspace 账号；若试点使用代理邮箱，必须由管理员明确授权并单独验证 Gmail Delegation 行为。
- 1–2 周内至少处理 100 封真实/脱敏案件和 20 份新简历。
- 所有外发仍在现有邮箱工作流中人工确认。

### 每日观察

- 导入成功率和失败类型。
- 用户修改了哪些字段。
- 推荐被接受或拒绝的原因。
- 从案件到草稿的耗时。
- 是否出现重复、漏信、过期资料和误脱敏。
- 模型成本和等待时间。

### Go/No-Go

进入下一阶段必须同时满足：

- 产品核心指标达到最低门槛。
- 用户每周主动使用至少 3 天。
- 没有高危数据泄露、误发或不可恢复的数据损坏。
- 营业员确认推荐与提案流程节省了实际时间。
- 业务方愿意继续投入样本、反馈和 Windows 同功能版本预算。

## 11. Phase 8：Windows 同功能版本

> 当前进度（2026-07-20）：Windows OCR 已从合同进入可运行 Runtime：NSIS 路线采用固定 Tesseract WASM 7.0.0 + 日英离线 traineddata，完成 PDF 本地渲染、结构化 OCR、27,086,736 bytes 资源 SHA-256 Manifest、双 Worker Node 网络拒绝、功能回归和打包规则；不再依赖要求 Package Identity 的 `Windows.Media.Ocr`。OCR、Parser、Embedding、Reranker 已接入零网络 Capability 的 AppContainer 启动器和各自 `stdio` 协议，Windows 缺少启动器时不允许降级；CI 会实跑 Loopback 拒绝与四类真实任务，并将证据绑定启动器哈希。Adapter 仍要求目标机内核网络隔离证据才启用，证据缺失时 UI 明示「隔離検証待ち」并 fail-closed。DPAPI、x64 NSIS、强制签名正式配置、Win32 ONNX/AVX2 Reranker、目标机包验证器、跨平台恢复和 Windows CI 已存在。Windows x64 原生编译/证据、目录包、签名安装/升级/卸载/恢复仍待完成，Phase 8 尚未达到退出门槛。

### 目标

在不分叉领域逻辑和隐私标准的前提下，把 macOS 试点版适配为可签名、可升级、可恢复的 Windows 版本。

### 工作

- 建立 Windows CI、Electron 原生模块重建、代码签名、安装包和自动更新流水线。
- 在 Windows x64 实机验证已实现的 `windows-tesseract-wasm`，形成 OCR Worker 内核网络拒绝和性能证据；不得生成伪造的 `verified=true` 文件。
- 从 `win-unpacked` 真实包布局复跑 Parser、Embedding 与扫描 PDF OCR，核对 AppContainer ACL、ASAR、模型资源和失败关闭状态；正式安装包生成前必须通过。
- 验证 `safeStorage`/DPAPI、SQLCipher、文件库权限、路径长度、文件锁、睡眠恢复、杀毒软件和受管设备策略。
- 验证本地 PII/NER、Embedding 和可选小型 LLM 的 Windows Runtime、量化、峰值内存和模型 Manifest。
- Windows 日本語 NER 不以“模型可下载”视为完成：候选量化模型约 279 MB 且训练域为 Wikipedia，必须先用真实 SES 姓名集验证 Recall、误报、峰值内存、安装包增量和许可证归属；未通过前 UI 只声明规则检测与 HR 必确认。
- 复用 Gmail API、CloudRedactionGateway、领域状态机、Schema、数据库迁移和全部业务 Fixture。
- 适配 Windows 文件选择、通知、系统邮件客户端、字体、键盘、缩放和可访问性。
- 执行 macOS 恢复包到 Windows 的兼容性测试；无法跨平台恢复的内容必须在导出前明确提示。

### 退出门槛

- 签名 Windows 安装包可完成安装、升级、卸载和回滚，数据与密钥生命周期符合安全文档。
- 一次性 Windows CI 的 NSIS 生命周期脚本通过：当前签名包安装/启动/卸载成功，卸载不删除加密业务数据；存在上一版基线时升级哨兵和同一数据库路径保持不变。
- 与 macOS 共用的功能、PII/DLP、Gmail、AI 和业务评测全部达到相同门槛。
- Windows 本地 OCR 无云端回退；原始个人数据不能通过任何平台分支到达 Cloud Provider。
- Gmail 方法 Allowlist 保持 GET-only，代码和网络记录中不存在草稿或发送方法。
- 目标 Windows 设备上的启动、导入、匹配和草稿性能达到单独确认的平台预算。

## 12. 测试策略

### 12.1 自动化测试

- Domain 与校验规则单元测试。
- WorkTask/TaskStep/ContextBinding/ApprovalGate 状态机、恢复、取消和幂等单元/集成测试。
- 受限意图路由与 ToolAudit 完整性测试。
- Parser 使用固定脱敏 Fixture 回归。
- IPC 参数、Sender 和权限测试。
- 数据库迁移和事务集成测试。
- Gmail OAuth、History、Message、Thread 和 Draft 方法 Allowlist 合同测试与录制 Fixture。
- AI Provider 使用 Mock 做错误、限流和格式异常测试。
- CloudRedactionGateway 的类型旁路、过期会话、载荷篡改、DLP 失败、重试和 Endpoint Allowlist 测试。
- 本地模型无网络测试、模型 Manifest/哈希测试和资源上限测试。
- Playwright Electron 端到端关键流程。
- 安装包冷启动、升级和恢复冒烟测试。

### 12.2 AI 评测

- 固定样本和真值不能随 Prompt 调整而偷偷修改。
- 按文件模板、语言和字段分别统计，不只看总平均数。
- 模型/Prompt/Schema 变更生成前后差异报告。
- PII 规则、NER、OCR、DLP 或模型变化都必须重跑各字段 Recall/Precision 和最终 Cloud Payload 零泄漏测试。
- 本地小型 LLM 与云端脱敏路径分别评测字段准确率、延迟和内存，不用同一个总分掩盖退化。
- 业务人员定期抽查高置信度但错误的危险样本。

### 12.3 手工测试

- 文件拖放、批量取消和失败重试。
- 断网、模型超时、Token 过期和磁盘空间不足。
- 应用强制退出后的任务恢复。
- 大字体、键盘操作和审核效率。
- 脱敏文件在外部 PDF 阅读器中的最终效果。

## 13. 人员与职责

| 角色 | 投入 | 责任 |
|---|---:|---|
| 全栈桌面工程师 | 1.0 FTE | Electron、数据、解析、AI、邮箱、发布 |
| 产品/业务负责人 | 0.2–0.3 FTE | 范围、优先级、验收与业务决策 |
| SES 营业专家 | 每周 3–5 小时 | 标注、规则、匹配和提案评审 |
| UI/UX | 全程平均约 0.2 FTE，前 4 周集中 | 信息架构、任务输入、审核、错误恢复、可访问性和试点迭代 |
| 安全/合规 | 关键节点评审 | 数据政策、权限、发布门槛 |

如果无法获得稳定的业务标注投入，工程进度即使按时完成，产品质量也无法验收。

## 14. 主要风险

| 风险 | 影响 | 缓解 |
|---|---|---|
| 真实样本迟迟拿不到 | 无法评估解析和匹配 | Phase 0 设为硬门槛 |
| 日式 Excel 模板差异过大 | 解析准确率低 | DocumentIR、模板分组、人工审核 |
| 扫描 PDF 比例高 | 本地 OCR 质量和人工量增加 | Apple Vision/本地 OCR Spike；无法脱敏时转人工，不上传原图 |
| 公司禁止云端处理任何业务内容 | 云端复杂语义能力不可用 | Phase 0 确认；评估本地小型 LLM并保留人工流程 |
| 本地 PII/NER 漏检 | 直接标识符进入云端 | 规则+词典+本地 NER、独立 DLP、失败关闭和固定泄漏评测集 |
| 本地模型资源占用过高 | 老设备卡顿、试点体验差 | 最低硬件基线、模型懒加载、单并发和资源调度；小型 LLM 保持可选 |
| 本地模型供应链或自动联网 | 隐私/完整性风险 | 固定 Manifest/哈希、受控下载、推理时禁止远程模型和 Telemetry |
| Gmail Restricted scope 审核复杂 | 邮件功能延期 | Phase 0 确认 Internal/External、Verification/安全评估；手工案件入口可独立交付 |
| Electron 原生模块打包失败 | 发布延期 | Week 1 完成目标机打包 Spike |
| Windows OCR 与安装形态冲突 | Windows 延期或隐私降级 | 提前比较 MSIX Package Identity 与随包离线 OCR；禁止云端 OCR fallback |
| Windows 安全软件/文件锁差异 | 导入、更新或恢复失败 | 建立受管/非受管设备矩阵，覆盖锁文件、长路径、杀毒和更新回滚 |
| 推荐指标定义不清 | 无法判断好坏 | Phase 0 由业务定义认可标准 |
| 单机数据丢失 | 业务不可接受 | 加密备份、恢复演练、提醒策略 |
| 用户期待关闭应用仍实时监听 | 体验落差 | 产品内明确状态；下次启动补齐 |
| 自然语言任务被误解为通用 Agent | 权限扩大、产品范围失控 | 枚举 WorkTaskType、任务预览、白名单领域用例和 ToolAudit |
| 用户任务与后台 ProcessingJob 混用 | 恢复错误、重复产物或审批 | 独立实体和状态机，通过 taskStepId 关联 |
| 过早建设团队后台 | 延迟核心价值验证 | 协作版必须通过试点 Go/No-Go |

## 15. Windows 之后

### 15.1 团队协作版：预计 8–12 周

- 公司账号、SSO 和角色权限。
- PostgreSQL、对象存储和加密同步 API。
- 离线队列、版本向量和冲突处理。
- 共享候选人、案件状态、反馈和模板。
- 服务端常驻邮件同步与通知。
- 团队审计和管理看板。

### 15.2 流程扩展：预计 6–10 周

- 面试日程草稿与日历联动。
- 合同到期、资料过期和稼动提醒。
- 提案结果与营业漏斗。
- 可配置审批和公司规则。

### 15.3 商业化：预计 12–16 周

- 多租户隔离和许可证。
- 租户配置、套餐、计费与用量限制。
- 管理后台、支持工具和安全运营。
- SLA、监控、灾备和正式合规材料。

商业化周期不能与核心 MVP 简单相加；需要在真实试点数据之后重新估算。

## 16. Definition of Done

一个功能只有在以下条件全部满足时才算完成：

- 用户路径、空状态、失败状态和取消路径可用。
- Domain、集成和关键端到端测试通过。
- 不在日志、错误和 Telemetry 中泄露敏感信息。
- 原始个人数据不能通过任何模型、重试、错误修复或视觉路径到达云端；Cloud 调用必须有有效脱敏/DLP 证据。
- 正式包建议同时具备固定合成隐私回归和当前实现绑定的真实日文专家聚合报告；缺少专家报告时必须在质量/审计/发布准备度中明确标记，但不把它作为普通 Cloud 调用的硬阻断。专家数据集原文不得进入源码、CI Artifact 或安装包。
- 本地模型固定版本和哈希，在无网络、无 Cloud 凭据进程运行，并达到对应任务的质量/资源门槛。
- 数据迁移、删除和恢复行为已定义。
- 用户任务的消息、上下文、步骤、产物、审批和工具审计在崩溃恢复后一致。
- 评测集没有超过阈值的质量退化。
- 文档和已知限制已更新。
- 业务负责人完成验收。
