# 安全与数据治理设计

<!-- ses-current-state package=0.1.0 schema=46 -->

> 版本：v0.7
> 适用范围：桌面 MVP、本地简历库、案件邮件、模型调用和提案草稿
> 原则：默认最小权限、最小数据、云端零直接标识符、明确外发、可追溯、可删除

## 1. 为什么安全是产品功能

系统处理的不是普通办公文本，而是候选人个人信息、技能经历、费率、邮箱内容和客户案件。一旦数据泄露、误发原始简历或模型被邮件正文诱导执行操作，会直接造成业务和合规风险。

因此安全能力必须进入 MVP 验收，不作为上线后的补丁。

## 2. 数据分类

| 等级 | 数据 | 示例 | 基本控制 |
|---|---|---|---|
| S0 密钥 | 无法替代的访问凭据 | 邮箱 Token、模型 API Key、主密钥 | 只进 OS Keychain，永不记录 |
| S1 个人敏感数据 | 可识别或刻画候选人的资料 | 姓名、电话、邮箱、住址、照片、国籍、在留资格、就劳资格、简历原件 | 加密、最小展示、严格删除 |
| S2 业务机密 | SES 经营与客户数据 | 费率、案件原文、商流、客户限制 | 加密、审计、限制外发 |
| S3 派生资料 | 结构化与模型产物 | 技能标签、Embedding、匹配解释 | 版本化、随源数据删除 |
| S4 诊断数据 | 运行状态 | 错误码、耗时、任务 ID | 脱敏，不含正文 |

## 3. 威胁模型

### 3.1 主要威胁

- 恶意或损坏的 Excel、Word、PDF 触发解析器漏洞、资源耗尽或路径读取。
- 简历或邮件正文包含 Prompt Injection，诱导模型泄露数据或执行工具。
- Renderer 出现 XSS 后访问本地文件、数据库或密钥。
- API 密钥、邮箱 Token、简历正文进入日志、崩溃报告或备份明文。
- 营业员误把原始简历或未充分脱敏附件发送给客户。
- 设备丢失、磁盘复制或本地用户越权读取数据目录。
- 邮箱权限过大，应用可以删除邮件或任意发信。
- 第三方模型对请求内容的保留、训练或跨区域处理不符合公司政策。
- 原始简历、邮件、用户输入、扫描页面或占位符映射绕过脱敏网关进入云端模型。
- PII 检测漏掉 OCR 错字、日文姓名变体、签名、二维码或多个准标识符组合，导致个人可被重新识别。
- 本地模型在推理时联网下载模型、发送 Telemetry，或被替换为未经验证的模型文件。
- 更新包或依赖被篡改，取得桌面应用的本地权限。
- 用户的自由文本输入、邮件或文件诱导意图分类器扩大数据范围、选择未授权工具或绕过人工确认。
- 第三方解析器在未沙箱化的 Node 进程中被利用，读取用户文件、密钥或发起网络请求。

### 3.2 MVP 不承诺防御

- 已完全控制用户操作系统和用户账户的攻击者。
- 企业未部署的终端管理、DLP 或远程擦除能力。
- 用户主动复制并外泄其有权限查看的数据。

这些风险需由公司设备管理、账号管理和内部制度共同控制。

## 4. Electron 安全边界

必须启用：

- Renderer Sandbox
- Context Isolation
- 禁用 Node Integration
- 限制导航和新窗口
- 严格 CSP，仅加载随应用发布的本地代码
- IPC Sender 校验
- 每个 IPC 方法独立暴露，参数和返回值经过 Schema 校验
- 禁止 Renderer 获得数据库句柄、真实密钥和任意文件读取能力
- 生产构建使用自定义应用协议而不是宽泛 `file://` 权限，并根据实际运行需求关闭不需要的 Electron Fuses

禁止：

- 在 Renderer 中使用 `require()`。
- 把 `ipcRenderer` 原样暴露给页面。
- 使用 `eval`、远程脚本或任意远程页面承载主 UI。
- 将邮件 HTML 直接注入页面。
- 对不可信 URL 直接调用 `shell.openExternal`。

邮件正文、DOCX 转换结果和模型生成内容都必须作为纯文本或经过严格 Sanitization 的受限标记展示。

## 5. 密钥与本地加密

### 5.1 密钥层级

```text
OS Keychain
  └── Application Master Key
        ├── Database Key
        ├── File Vault Key
        └── Backup Wrapping Key
```

- 主密钥由安全随机数生成，不由 API Key 派生。
- 主密钥通过操作系统密钥链保护。
- 子密钥使用标准 KDF 派生并带不同用途标签。
- 每个文件使用唯一 nonce，通过 AES-256-GCM 或等价 AEAD 加密。
- 数据库使用 SQLCipher 或经过验证的等价全库加密方案。
- Electron `safeStorage` 只用于加密小型主密钥 Blob，不直接加密数据库、简历或备份。首发 macOS 实现使用异步 API，处理加密不可用、暂时不可用与需重新加密状态；Windows 次发验证 DPAPI 后端，并明确它不能防御同一用户会话内已经取得执行权限的其他恶意应用。

### 5.2 凭据存储

- 邮箱 Token、模型 API Key 只存密钥链。
- 数据库只保存凭据引用、Provider 类型和最后验证时间。
- UI 默认遮挡凭据，不提供“显示完整密钥”。
- 日志、异常对象和 IPC 返回值必须在进入通用记录器前脱敏。

### 5.3 备份与恢复

- 任何未来自动备份和当前手动恢复包都必须加密。当前版本只做本地变更提醒，不会自动选择路径或创建备份；SQLite 使用 Online Backup API 或等价一致性快照，文件库与数据库通过带哈希的 Manifest 绑定。
- 跨设备恢复包由用户设置的独立恢复密码保护，不能只依赖原设备 Keychain。
- 恢复前验证版本、完整性和空间，恢复过程先写新目录再原子切换。
- 明确告知用户：若没有恢复包且系统密钥链丢失，本地加密数据不可恢复。
- 当前 `.ses-recovery` 使用 scrypt（固定版本参数）和 AES-256-GCM；密码至少 12 字符，只在操作内存中使用。恢复先完成整包认证，再落受限暂存，防止错误密码或篡改内容形成部分恢复文件。
- SQLCipher 快照通过同连接事务写入已配置相同 Cipher/Key 的 Attached Database，不允许先写明文 SQLite 再补加密；Schema、数据、索引、修订触发器和 Integrity Check 任一失败都删除未完成快照。
- 备份提醒只使用单调数据修订号、最后变化时间和用户延期状态，不读取或复制姓名、电话、地址、邮件正文等个人数据。延期只允许 1 天或 7 天，绑定延期时修订号；新业务变化使旧延期失效。
- 包内包含恢复业务数据所需的主密钥材料，因此必须把恢复密码和包文件作为高敏凭据管理；Google OAuth Token、Cloud API Key、缓存、日志和应用外导出明确排除。
- 恢复只在重启前置阶段切换；旧数据库、文件库和 Key 保留为同次恢复的临时回滚点，验证成功后清除，失败时恢复。Google 凭据成功恢复后清除并要求重新授权。
- 如果受保护主密钥或活动 SQLCipher 数据库无法打开，应用进入不依赖业务 Repository 的 `OFFLINE RECOVERY` 页面。主进程只注册恢复所需 IPC，原数据保持不变；候选人、案件、Gmail、Cloud AI 和普通任务 API 均不可用。没有恢复包时不提供删除数据或绕过加密的快捷操作。
- 未确认的恢复预览在下次启动时清理；已确认的预览必须有受限 `pending-restore` 标记才能跨重启保留。详细操作见 `06-key-loss-and-recovery-runbook.md`。

## 6. 文档解析安全

### 6.1 文件处理

- 使用 Magic Bytes 校验实际格式。
- 拒绝超限、加密、异常压缩比和目录穿越条目。
- 不执行宏、公式、脚本、OLE 对象或外部链接。
- 第三方文档解析器必须运行在独立最小权限辅助进程；Worker Thread 只用于不触碰原始不可信字节的纯计算。
- 解析进程不继承邮箱 Token、模型 API Key、数据库密钥或备份密钥，默认无网络，只允许读取隔离目录中的指定输入。
- 输入文件以只读方式复制到隔离目录。
- 解析结果只允许返回 JSON/Buffer，不允许返回可执行代码。
- 临时目录在成功、失败和应用恢复时都执行清理。
- 扫描文档使用本地 OCR 和本地图像检测；原图不能进入具有 Cloud Provider 网络权限的进程。

### 6.2 HTML 与预览

- DOCX 和邮件 HTML 不作为可信 UI 载入。
- 默认渲染纯文本；必须保留格式时使用白名单 Sanitizer。
- 禁止远程图片自动加载，避免追踪像素泄露用户 IP 和打开状态。
- PDF 预览使用受控 Viewer，不向预览上下文暴露 Node 权限。

## 7. Prompt Injection 防护

所有来自简历、邮件和附件的文本都标记为“不可信数据”。

### 7.1 提取调用

- 模型调用没有文件、邮箱、数据库、网络搜索或发送工具。
- 系统指令明确要求忽略输入内容中的命令，只提取定义字段。
- 使用固定 JSON Schema；Schema 外字段被拒绝。
- 输入分隔、长度限制和字段白名单由程序控制。
- 模型输出必须经过 Zod/JSON Schema 和业务校验后才能保存。

### 7.2 任务意图与受限编排

- 任务意图分类调用同样无工具权限，只能返回预定义 `WorkTaskType`、结构化字段和待补充字段。
- 领域用例由程序根据枚举类型白名单映射，不解析模型返回的自由工具名、命令、URL 或路径。
- 每个 `ContextBinding` 绑定对象 ID、版本和授权来源。模型的“需要更多上下文”不构成扩大数据范围的授权。
- 任务预览显示数据范围、计划步骤、可能外发和审批门；扩大范围或新增外部副作用时必须重新确认。
- 工具审计记录计划、允许原因、实际执行、证据、阻止原因和相关审批，但不复制敏感正文。

### 7.3 生成调用

提案邮件和附件生成只使用已经确认的结构化候选人资料、项目经历和案件字段，不直接把整封原始邮件或整份简历放入自由对话上下文。项目经历进入附件前只保留标题、期间、角色、技术与担当摘要，不携带 Project ID、Source Label 或原文件名；普通字段和项目内容在生成边界再次执行本地直接标识符扫描，命中即阻断。

生成模型仍然没有发送工具。创建草稿是单独的应用用例，只有在用户完成预览确认后才可以执行。

RAG 精排只允许检索已经确认且当前用户有权查看的索引记录。进入模型上下文前删除姓名、电话、私人邮箱等无关标识；索引记录被删除或归档后必须同步失效，防止从旧向量索引中继续召回。

当前 Local AI Retrieval Stage 4 只处理已人工确认且 `containsDirectIdentifiers=false` 的 CandidateProfile 与 ProjectExperience。Profile Embedding/Reranker 文本最小化为 `skills / role / work_style / location`；项目段只包含确认后的标题、期间、角色、技术和担当摘要，不包含 `confirmedBy`、Source Label、Profile/Document/Project ID、原文件、页面原文、脱敏映射或就劳资格。项目新增、删除或编辑必须记录原因，保存前会与普通字段一起执行已知姓名和确定性直接标识符检测。向量与精排由固定版本本地 ONNX 模型在独立子进程中执行，远程模型加载、运行时下载和网络访问均被禁止；Embedding 失败只降级到本地 BM25，Reranker 失败保留 RRF 顺序，均不允许转发云端。

向量缓存只存在于当前 SQLCipher Schema v37：Profile 缓存记录 Profile ID 外键，项目缓存额外记录 Project ID；两者均绑定 Model ID/Revision、内容哈希和 Float32 向量。Reranker Logit 不单独持久化，只被不可变 Match Result 哈希覆盖，不成为新的候选人画像。Profile 向量允许粗粒度希望勤務地，但明确排除就劳资格、国籍、住址、在留资格和在留卡号。Schema v36 的 Match Run 另外绑定 JobCase 版本、候选池指纹、CandidateProfile Versions、算法/策略及本地模型身份；任一变化都使旧 Run 变为 Stale，首页不返回旧排名。归档 Profile 不进入 active 检索，重新审核产生新 Profile/Project ID 与内容哈希，永久删除由外键在同一事务内清除全部关联向量、Match Result 和营业优先级 Projection。删除预览和 `DataDeletionReport` 只记录索引/结果计数与清除状态，不记录向量值或候选人正文。

Windows 平台继续使用同一加密与脱敏门：Electron 异步 `safeStorage` 在 Windows 映射到 DPAPI，只保护 32-byte 主密钥；SQLCipher、PII Mapping 与文件库使用共用 HKDF 派生密钥。DPAPI 只保证同机其他登录用户不能直接解密，并不等价于防止同一用户权限下的恶意进程，因此 Windows 目标机还必须覆盖受管设备策略、恶意软件、文件 ACL 与 Credential Guard/EDR 环境。UI 明确显示 Windows DPAPI，不使用泛化的“OS Keychain”表述。

Windows OCR 输出必须满足与 Apple Vision 相同的结构化 `networkAccess=false` 合同，但 Worker 的自我声明不构成发布证据。当前固定 Tesseract WASM 7.0.0、日英 traineddata、PDF.js 和 Canvas 版本；每次启动 Worker 前核对语言资源 SHA-256，父 Worker 与 Tesseract 子 Worker 均在无凭据环境中安装 Node 网络拒绝守卫。OCR、Parser、Embedding 与 Reranker 已改为由原生启动器创建零网络 Capability 的 AppContainer 子进程，只对明确应用根目录授予读/执行 ACL；Windows 缺少启动器时全部本地 Worker 失败关闭，不回退为普通子进程。Runtime 只有固定资源已打包且 Windows x64 内核网络隔离通过目标机实测时才启用；否则扫描件停在本地 OCR 待处理状态并在 UI 显示「隔離検証待ち」。OCR 与 Parser/Embedding/Reranker 分别生成包含真实任务完成、普通 Loopback 可达、沙箱 Loopback 被拒绝和启动器 SHA-256 的证据；缺少、字段不完整或哈希过期时 `release:check:win` 失败。

营业员匹配反馈只保存在加密本地数据库，不进入 Embedding、Cloud Payload、提案附件或模型上下文。每条反馈绑定不可变结果哈希和 CandidateProfile Version，结构化理由与可选补充使用乐观 Revision 防止旧窗口覆盖；删除 CandidateProfile 时对应 Match Result 和反馈通过外键级联清除，删除预览显示影响数量。反馈补充属于端末内业务记录，界面明确提示不得把它误认为自动学习或自动拒绝候选人的指令。

Benchmark 导入只接受 1 MB 以下普通 JSON，禁止符号链接；Schema 固定声明不含直接标识符、原简历和原邮件。导入边界对数据集名称和全部 Query 再执行确定性 PII 检测，姓名、电话、私人邮箱、住址或 PII 占位符命中时失败关闭。文件路径和文件名不持久化，报告只保存 Query SHA-256。Benchmark/报告只在 SQLCipher、加密备份和本地 UI 中存在，不进入 Cloud Payload；候选人删除会清除包含其匿名编号的整个数据集与报告，删除预览显示影响记录数。

应用内专家标注不接触候选人姓名、原始简历或原始案件邮件：界面只展示匿名 Candidate ID 与 HR 已确认的结构化字段。评价 Query 由当前确认案件字段确定性生成，并再次执行本地 PII/DLP；案件标题、商流、支付条件、Reviewer ID 和原始来源不进入 Query。草稿、Case、Label 全部进入 SQLCipher 和加密备份，不进入 Cloud Payload；案件或候选人版本变化会使旧标签失效，永久删除由规范化外键清除对应关系。

本地隐私发布门使用 `ses-privacy-regression-v1` 固定虚构数据集，分别计算预期标识符 Recall、Mapping Precision、脱敏后原值残留数和非 PII SES 文本误报数；姓名人工复核、照片、人脸、签名和识别性 QR 的每个覆盖缺口都必须证明 `payload=null / status=uncertain`。`personNameReviewCompleted` 只保留为隐私核心内部状态；Renderer 的准备请求只能提交正文，执行请求只能提交 Main 签发的一次性 Review Ticket。Main 在原生窗口确认当前脱敏预览后，才在第二次 NER/脱敏/DLP 中设置内部完成状态。macOS 门额外通过系统断网沙箱实跑 Apple Natural Language 英文姓名识别；Windows 门不伪装为已有日文 NER，而是验证标签/敬称规则和强制人工复核。报告固定声明 `syntheticOnly=true / humanLabeledDataset=false / cloudDirectIdentifiers=0 / networkAccess=false`，随安装包放入只读 Resources，并在治理面板明确显示“固定合成回归”。任一指标下降、报告缺失或平台/架构不一致都会阻断普通 Cloud 和正式发布；它仍不能替代真实日文 SES 专家标注集。

真实日文 `ses-privacy-expert-quality-report-v2` 是质量、审计和发布准备度证据，不再是普通 Cloud 运行时的硬性调用门。专家数据集只在明确指定的本地路径读取，拒绝目录、符号链接和超过 10 MB 的输入；评测进程在读取后立即安装 Node 网络拒绝守卫。输出报告只含不可逆 Dataset/Privacy Implementation/Cloud Enforcement 哈希、平台/架构、复核规模、聚合指标、日期和非敏感失败代码，固定 `containsCaseContent=false / cloudDirectIdentifiers=0 / networkAccess=false`。构建时再用 `cloud-enforcement-manifest.json` 绑定报告文件 SHA，并逐文件绑定打包后的 Main/Preload JavaScript Runtime Bundle Set。报告本身可随签名安装包作为证据，专家原文、路径和标注值绝不打包。准备与执行阶段可以重新读取同一校验结果；通过时把专家哈希写入 `CloudCallAudit`，未通过时写 `null`。报告缺失、哈希不符、超过 30 天、复核超过一年或专家绑定失效时，Bootstrap 状态保持 `not-verified` 并提供失败代码，只降低质量、审计和发布准备度。只要合成隐私质量门、本地 NER、脱敏、独立 DLP、Endpoint Allowlist 和当前实现安全绑定通过，并且自由文本路径完成内容绑定 Review Ticket、匹配 Agent 路径完成匿名安全 Projection 校验，Provider 不因专家证据缺失而归零。

兼容迁移：Schema v35/v38 的 `expertAttestationHash` 保持可选，旧 CloudCallAudit 记录按历史策略保留和解释；新记录允许该哈希为空，详细的非阻断专家状态继续由 Bootstrap `expertGate.status/failureCodes` 展示。旧的 `expertGate=not-verified`、`expertAttestationBound=false` 或“专家缺失即禁止云端”的发布/运行时判断不得继续作为当前硬门。通用硬门仍由本地 NER、脱敏/DLP、Endpoint Allowlist、Redaction Session 和内容哈希组成；自由文本和匹配 Agent 分别追加 Review Ticket 或匿名安全 Projection 的路径专属证据。

Schema v36 新增的聊天粘贴入口不保存 Renderer 原始输入：提交动作先清空输入状态，Main 只在一次调用内进行本地 NER、直接标识符替换和 DLP，再原子保存 Redaction Session、脱敏 `JobCaseSource` 与既有 Extraction Draft。Gmail、EML、手工和聊天来源全部标记为 `UNTRUSTED_SOURCE_CONTENT`；来源中的 Prompt Injection、Tool Call 或系统指令表达只能形成警告证据，不能创建 Action Run、Scope、Actor、审批、文件写入或网络请求。

macOS 微信已进入 B-03-1 受控开发试点。`wechat.visible.read` 只接受用户命令和前台微信可见会话 Scope，原生确认后签发 30 秒一次性 Token，Replay Policy 为 `never`；Helper 固定校验腾讯 Team ID、代码签名、Bundle ID、PID/启动时间、前台应用、Focused Window/Frame。微信 4.1.5 的 AX Tree 实测不暴露正文，因此在系统屏幕录制权限有效时只捕获绑定微信窗口并裁剪右侧当前会话区域，Apple Vision 在断网 Helper 内 OCR；音频、光标、其他窗口、滚动和历史展开均不进入范围。Capture/原文不落盘、不进入 Renderer/SQLCipher/日志/Cloud，Main 只原子保存脱敏 `wechat-visible` 来源。`scripts/verify-wechat-feasibility-gate.mjs` 无正式签名包和四方报告时返回 `implemented-release-no-go`；开发机可运行不构成正式发布证据。

### 7.4 高风险内容

若输入包含“忽略规则”“发送到某地址”“读取其他文件”等指令模式，系统不需要尝试理解其意图，应标记审计警告并继续按纯数据处理或转人工。

## 8. 邮箱权限

### 8.1 权限分级

1. 公司邮箱已确认为 Google Workspace，MVP 只使用 Gmail API。
2. 首次连接只申请 `gmail.readonly`；只在用户配置的 Label、搜索条件和时间窗口内读取。该 Scope 属于 Google Restricted scope，必须完成适用的 OAuth Verification/安全评估确认。
3. 当前版本不实现 Gmail 草稿。若未来确需创建草稿，必须作为新版本重新进行权限与威胁评审；不能用配置开关升级当前凭据。Desktop Installed App 不支持增量授权，且 `gmail.compose` 同时允许发送，不是真正的 Draft-only 权限。
4. 当前网络/API 方法 Allowlist 是 GET-only，只允许 Profile、Message list/get 与 History。Draft create/get/update、Message/Thread Send、Modify 和 Delete 全部不可达；应用代码、Preload API、任务类型和测试 Fixture 中不得存在对应调用。
5. MVP 不申请 `gmail.modify`、`gmail.send`、`https://mail.google.com/`、删除邮件、修改标签/规则或 Domain-wide Delegation。
6. Token 交换和每次刷新都要求 Scope 恰好为单一 `gmail.readonly` 且 Token Type 为 Bearer；出现任何额外 Scope、非 Loopback 回调或非 Bearer Token 时，不保存新凭据。
7. 案件配信的“打开邮件”不调用 Gmail API，也不改变上述只读授权。Main 只接受确认案件 ID、已登记模板、语言、文案种类和有界正文，重新执行直接标识符检测后自行构造无收件人的 `mailto:`；Renderer 不能提供 URL、抄送或密送参数。默认邮件客户端打开后，收件人与最终发送由 HR 确认，应用不记录或声称邮件已经发送。

管理员在应用内只配置 Desktop OAuth Client ID、公司域和有界同步范围。配置自 SQLCipher Schema v21 起持久化，当前随 Schema v37 使用乐观 Revision 并进入加密恢复包；Client Secret、Refresh/Access Token、密码和 Cookie 不进入表单、数据库、ProcessingJob 或恢复包。Token 只由目标 OS 的 `safeStorage` 保护，修改配置前必须先断开当前账号并清除旧凭据。环境/设备管理注入值优先于本地配置，UI 只显示不可编辑状态。

本机操作员档案包含显示名、角色和随机稳定 UUID，属于个人相关数据，只能存在 SQLCipher、加密一致性快照和恢复包。档案固定标记 `cloudEligible=false`，不得进入 CloudRedactionGateway、模型输入、Gmail Query、向量、普通日志或 Telemetry。所有业务 IPC 都由 Electron Main 在执行时读取当前档案并写入 Actor；Renderer 不能在审核、删除、反馈和提案请求中传入任意操作员。显示名变更只影响未来记录，历史审计不得回填或改写。

显示语言偏好只允许 `ja-JP` 与 `zh-CN`，属于非业务的本机显示设置。Schema v28 将其保存到 SQLCipher、加密一致性快照和恢复包，固定 `cloudEligible=false`；不得进入 CloudRedactionGateway、模型、Gmail、Embedding、普通日志或 Telemetry。切换词典是离线且严格允许列表，不调用机器翻译，不能改写候选人/案件/简历/邮件/指令/备注/审计等业务文本；Renderer 只把已校验的 UI 词条显示为选定语言，Main 使用乐观 Revision 拒绝旧设置窗口覆盖。

连接后的在线受入检验必须由用户显式触发。执行时只用受保护 Token 调用固定 `users.getProfile`，不读取 Message/Thread/History；Access Token 失效时可以执行一次受控 Refresh，但不重新打开授权或扩大 Scope。随后仅查询本地同步检查点和 `gmail_messages → redaction_sessions` 计数。Schema v23 报告只允许配置 SHA-256、Scope 数量、同步/脱敏计数、状态与固定说明，不允许邮箱地址、公司域明文、Client ID、Token、邮件正文、Label、业务 Query 或 PII Mapping。报告固定声明 `messageContentAccessedDuringCheck=false / cloudModelUsed=false / directIdentifierCloudSent=false`；没有当前配置下的成功有界同步或没有脱敏记录时不能标记通过。

### 8.2 邮件数据最小化

- 只同步配置文件夹和时间窗口。
- 只同步配置的 Gmail Label、时间窗口和业务 Query，优先保存必要正文摘要、Gmail Message/Thread ID、History ID 和业务字段。
- 无关邮件完成分类后按策略删除正文缓存。
- 附件只有在用户确认导入或业务规则允许时才进入受管文件库。
- 远程图片、跟踪像素和外链不自动加载。
- Gmail 案件邮件和营业员手动输入都只以本地脱敏后的主题/正文生成待审核草稿；手动输入原文不写入案件表，正式 JobCase 不保存发件人地址、原始签名、原始手动正文或占位符映射。
- 手动输入先在主进程调用本地姓名候选和确定性 PII 规则，独立 DLP 发现残留直接识别符时整次拒绝；Renderer 不能直接写入 `JobCaseSource` 或绕过 Schema v9 的来源/脱敏会话约束。
- JobCase 的每个字段必须人工确认，修改必须记录原因；确认时再次检测电话、私人邮箱、地址、证件号、个人 URL 和 PII 占位符，检测到即拒绝持久化。
- JobCase 改訂必须打开新的 Review Revision，不允许直接覆盖已确认版本；归档/恢复/打开改訂均保存理由、处理人、时间和 Revision。
- 永久删除 Gmail 来源案件时，同时删除本地 Gmail 副本并保存只含账号、Message ID、时间和固定原因的加密墓碑。墓碑不含主题、正文、发件人、姓名或占位符映射，只用于阻止同一邮件在增量同步后复活。

## 9. 模型数据治理

### 9.1 调用前提示

设置页必须显示：

- 使用的模型 Provider 与 Endpoint。
- 本次任务将使用本地模型还是云端模型，以及本地模型的版本和资源占用。
- 云端只会收到哪类脱敏字段、占位符和业务字段；产品不存在“传输完整原文件”的例外开关。
- 本地检测到并删除/替换的 PII 类型与数量，不展示不必要的原值。
- Provider 的数据保留、训练使用和处理区域配置。
- 公司管理员批准的策略版本。

### 9.2 云端强制脱敏门

所有 Cloud AI 调用统一经过 `CloudRedactionGateway`，执行失败关闭（fail closed）：

1. 本地解析或本地 OCR 生成带来源位置的内容。
2. `cloud-redaction-v2` 使用规则、词典和本地 NER 检测姓名、电话、私人邮箱、住址、生日、照片/人脸、签名、证件号、个人 URL/账号、识别性二维码，以及国籍、在留资格和就劳资格等敏感个人属性。
3. 原值进入本地加密 `LocalPiiMapping`，正文使用稳定占位符；图片对应区域不可逆遮盖后才可形成派生图。
4. 使用独立于第一检测器的 DLP 规则再次扫描最终载荷。
5. 只有 `dlpStatus=passed`、策略/来源版本有效且内容哈希匹配时才生成短时有效的 `RedactedPayload`；旧策略载荷不能被 v2 网关接受。
6. Gateway 校验 Endpoint Allowlist 和任务允许范围后调用 Cloud Provider，并产生不含正文的 `CloudCallAudit`。

硬性规则：

- 用户确认、管理员勾选、Provider 不训练承诺或合同条款都不能绕过直接标识符脱敏。
- `failed/uncertain` 只能进入本地处理或人工修正，不能提供“仍然上传”按钮。
- 占位符映射、原始附件、原页面图像和身份字段不进入 Cloud Prompt、响应修复请求、日志、Telemetry 或崩溃报告。
- Cloud Provider Adapter 在类型和运行时都只接受 `RedactedPayload`；任何直接调用都作为高危安全缺陷阻断发布。
- 原始内容变化、策略变化、任务扩大数据范围或重试载荷哈希不一致时，旧脱敏会话立即失效。

### 9.3 发送最小数据

- Excel/Word 只发送通过脱敏门的规范化文本，不发送原文件。
- PDF 使用本地文本解析或本地 OCR；原 PDF 和原页面图像不发送云端。无法可靠识别并遮盖时转人工。
- 匹配精排只发送 Top K 的去标识化摘要。
- 提案生成不发送候选人/收件人的真实姓名、电话、私人邮箱和住址，真实显示值由本地在输出校验后插入。
- Telemetry、日志和错误上报不包含 Prompt、Response、文件或邮件正文。

### 9.4 Provider 管理

- 生产版只允许管理员批准的 HTTPS Endpoint。
- 模型和数据政策变化必须重新确认。
- Provider 不可用时不得偷偷切换到另一个未经批准的服务。
- 每次调用记录任务类型、Provider、模型、时间、Token、策略版本和结果状态，不记录正文。

### 9.5 本地 AI 安全

- 本地 OCR、PII/NER、Embedding、分类和可选小型 LLM 运行在独立无网络进程，不注入邮箱 Token、Cloud API Key 或数据库主密钥。
- 模型文件由批准的安装/更新流程下载，校验来源、许可证、版本和 SHA-256；推理运行时禁用远程模型加载和 Telemetry。
- 本地模型只接收任务范围内的受限输入，不能自行枚举文件、数据库、剪贴板、邮箱或调用工具。
- 本地推理 Runtime 不持久化 Prompt/Response 或生成内容缓存；任务完成后释放输入缓冲和临时派生文件，崩溃恢复清理残留。
- 模型输出仍经过固定 Schema 和业务校验；“本地运行”不等于可信或有执行权限。
- 本地模型不可用、内存不足或质量不达标时，允许人工处理或对已脱敏载荷调用云端，禁止原文静默回退。

### 9.6 ProcessingJob 数据最小化与重放安全

- `ProcessingJob` 只保存枚举作业类型、WorkTask/TaskStep 引用、幂等键、请求指纹、状态、进度、租约、错误码与最小结果摘要；不得保存姓名、电话、地址、私人邮箱、原始 Query、简历/邮件正文、项目证据、PII Mapping、OAuth Token 或 Cloud Credential。
- 请求指纹在端末内从已确认的匿名字段与策略版本生成 SHA-256，只用于判断“是否为同一请求”，不能作为把原文复制进队列的理由。候选匹配完成结果仅保存 Match Run ID、结果集哈希和数量。
- `safe-local` 只用于确定性、无网络、无外部副作用且领域写入幂等的作业；应用重启或租约遗失后可以重新排队。涉及邮件草稿、导出文件、外部 API 写入或无法确认完成状态的作业必须标记 `manual-review`，不得自动重放。
- 作业完成前必须同时验证租约令牌、未收到取消请求、结果大小与结果哈希；取消请求在领域事务提交前再次检查。失败/取消后的用户重试复用原 ContextBinding 和幂等边界，不扩大数据范围。
- 候选检索与简历解析共享并发 1 的 `local-ai` FIFO 车道，提案 PDF/ZIP 使用独立并发 1 的 `file-export` 车道；等待资源的作业保持 `queued`，取得车道后才领取租约并复检取消，避免排队中的文件被提前解密或模型被提前启动。
- 后台 Dispatcher 只领取 `safe-local` 候选检索/简历解析；不领取提案导出或未来外部 API 写作业。重建执行前重新计算请求指纹，并用 Zod 验证随机 File Token；不匹配时写固定错误码并停止，不把异常正文或文件名写入日志。指数退避达到最大试行次数后转人工处理。
- Google Workspace 事前诊断只连接固定 OAuth Metadata/Gmail Discovery 公共端点并测试本机 Loopback 绑定，不携带 OAuth Token、Client Secret、邮件地址、公司域、Label 或查询词；不访问 Gmail Profile/Message/History。诊断结果不写数据库，只在当前 UI 会话显示，并固定标识未读取邮箱、未创建凭据。
- ProcessingJob 进度、错误和恢复属于加密业务状态，进入 SQLCipher、一致性快照与恢复包；诊断日志只写作业 ID、状态和非敏感错误码，不记录载荷或结果正文。

## 10. 脱敏与外发控制

### 10.1 脱敏策略

脱敏规则以公司策略版本管理：

- 姓名替换方式
- 电话、私人邮箱、住址、照片
- 年龄、生日和国籍默认删除；例外保留的必要用途、权限与审批依据
- 当前所属公司和客户名
- 项目中的真实终端客户信息

规则执行后必须重新扫描生成文件，验证目标字段不存在。

### 10.2 外发确认门

确认页必须同时展示：

- 收件人和抄送人
- 邮件主题和正文
- 候选人身份映射
- 每个附件的名称、格式与脱敏状态
- 脱敏差异摘要

任何附件发生变化、收件人变化或草稿重新生成后，之前的确认失效，需要重新确认。

确认记录绑定收件人、主题、正文和附件哈希的内容集合，不只保存一个布尔字段。系统必须区分：

- `approved`：当前内容集合已由用户确认。
- `exported`：已生成可供外部使用的提案包，但固定不代表已发送。
- `sent/replied/interview/accepted/declined/withdrawn`：当前只能由用户手工记录；现有 Gmail GET-only Provider 不写草稿、不发送、不自动设置结果。

提案后跟进属于本地业务记录，而不是 Cloud AI 上下文。Schema v27 的事件固定 `cloudEligible=false`，只进入 SQLCipher、加密快照和恢复包；不得进入 Gmail Query、Embedding、Prompt、Cloud Payload、Telemetry 或普通日志。第一条事件必须为 `sent`，事件日期不能倒退，`accepted/declined/withdrawn` 为不可继续推进的终态。备注保存前执行直接标识符检测，电话、邮箱等命中即整体拒绝；Renderer 只能提交状态、日期和备注，Actor 由 Electron Main 读取本机操作员档案后写入。开始跟进后提案正文、附件、审批和再次导出全部冻结，防止业务时间线引用被静默改写的内容。

复制到剪贴板、打开系统邮件客户端或导出文件后，数据已离开受管边界。UI 必须明确提示，临时导出文件设置过期时间并在可能时清理，但不宣称能撤回应用外的副本。

## 11. 日志与审计

### 11.1 普通日志允许内容

- 时间、级别、模块、错误码
- 任务 ID、文件类型、页数、耗时
- Provider、模型、Token 和 HTTP 状态类别
- 经过聚合的数量和成功率

### 11.2 禁止记录

- API Key、OAuth Token、Cookie
- 姓名、电话、邮箱和住址
- 简历全文、邮件正文和附件内容
- 完整 Prompt 与模型 Response
- 数据库加密密钥和备份密码

### 11.3 审计事件

应记录但不记录敏感正文的事件：

- 邮箱连接、断开和权限变化
- Gmail OAuth Scope 申请/撤销、History 检查点重建、草稿创建与发送方法阻止事件
- 模型 Provider 或数据政策变化
- 简历导入、导出、删除和恢复
- 候选人合并与人工字段修改
- 脱敏文件生成与确认
- 邮件草稿创建或打开系统邮件客户端
- 备份创建、恢复和失败
- 用户作业任务创建、取消、继续、数据范围变更和归档
- 领域用例计划、允许、阻止、实际执行与产物证据链接
- 脱敏会话创建/失效、PII 类型计数、DLP 通过/失败、Cloud Gateway 阻止和不含正文的 Cloud 调用证据
- 本地模型安装、校验、启用、升级、回滚和评测版本变化

当前 WorkTask ToolAudit 仅保存动作枚举、Task 数据范围、`none/local-write/file-export` 副作用、`none/redacted-only` Cloud Payload 边界、证据数量和固定非敏感原因；不复制用户消息、简历、邮件、提案正文或占位符映射。任务取消与同 Task ID 执行互斥，取消/失败后领域用例在主进程再次拒绝；中断的 `running` 任务启动时只恢复到确认状态，不自动重放文件导出或未来的 Provider 副作用。

MVP 的审计事件用于本机追溯、诊断和试点复盘，不是不可篡改的合规审计账本。可以通过事件链哈希和备份 Manifest 发现部分意外损坏，但不能对拥有设备与密钥控制权的本机管理员提供强防篡改保证；团队版需要由独立服务端接收和保存不可由普通客户端修改的审计副本。

## 12. 数据生命周期

```text
导入 → 解析缓存 → 人工确认 → 可匹配 → 归档 → 删除
```

- 原始文件和派生数据分别设置保留策略。
- 无关邮件正文缓存应在短周期内清理。
- 归档不等于删除；归档数据仍受同等安全控制。
- 删除候选人时，删除活动主记录、版本、隔离的敏感字段、受管原文件、派生文本、Embedding、匹配缓存和未使用附件。
- 加密备份无法逐条物理修改时，使用备份过期、备份包密钥销毁或等价加密删除策略，并确保删除后的记录不能进入新备份。
- 当前手动恢复包位于应用控制边界外，应用不保存明文路径也不能远程撤回。若曾创建恢复包，删除报告将备份标记为 `expired_pending`；用户必须创建删除后的新包并安全废弃旧包。
- 每次删除生成 `DataDeletionReport`，列出数据库、文件库、索引、缓存、临时文件和各备份的 `deleted/not_present/expired_pending/crypto_erased/failed` 状态。
- 产品文案不宣称能对 SSD、系统快照或已导出到应用外的副本进行可验证的逐字节物理擦除。
- 提供机器可读导出和用户可读导出。

## 13. 合规工作项

本设计需要结合日本《个人信息保护法》（APPI）和公司内部规则做正式审查，至少确认：

- 个人信息使用目的与通知方式。
- 从业务伙伴取得简历后的处理依据。
- 向外部模型服务传输是否构成第三方提供或跨境处理。
- 数据最小化、保留期限、访问、更正和删除流程。
- 委托处理方协议、数据区域和事故通知要求。
- 年龄、国籍等敏感或高风险字段的必要性与使用边界。

本文档是产品与工程设计，不代替法律意见。

## 14. 发布前安全验收

> 当前实现证据（2026-07-19）：无签名 Apple Silicon 验收包已经自动检查 ASAR 根目录不含项目源码/测试/`.env`、包内原生模块均为 arm64、Apple 本地 NER 声明 `networkAccess=false`、Renderer 只通过 Preload 桥接、首次数据库为 SQLCipher 密文。EML 额外验证无凭据断网解析、远程内容不加载、附件/原文件不持久化、姓名/电话/邮箱脱敏、哈希去重和 Schema v12→v13 数据保全。Developer ID 签名、公证、Gatekeeper、升级签名与真实试点设备矩阵仍是正式发布阻断项。

- 完成 Electron 安全配置自动化检查。
- IPC 白名单、Sender 和参数校验测试通过。
- 恶意文件、超大文件、压缩炸弹和超时样本测试通过。
- 解析辅助进程中不存在邮箱 Token、模型 API Key、数据库密钥和可用网络凭据。
- 本地 OCR/PII/Embedding/小型 LLM 推理进程无法联网，远程模型加载和 Telemetry 已关闭，模型哈希与 Manifest 一致。
- Cloud Provider SDK/API Key 只存在于 Gateway/Adapter 边界，静态依赖和运行时网络测试都不能发现旁路调用。
- 原始简历、邮件、用户输入、PDF/图片和占位符映射不能到达 Cloud Provider；所有云端调用均绑定 `dlpStatus=passed` 的有效脱敏会话。
- 固定 PII 泄漏集覆盖日文姓名变体、电话、邮箱、住址、生日、证件号、照片/人脸、签名、二维码和 OCR 错字；含残留标识符载荷全部被阻止。
- 真实日文专家隐私报告满足最小覆盖、双人复核、实现哈希及时效要求时，作为质量/审计/发布准备度建议证据；缺失时必须如实披露，固定合成回归仍是运行时硬门，不能用专家报告替代本地 NER、脱敏、DLP、匿名安全投影或 Endpoint Allowlist。
- Prompt Injection 样本不能触发任何工具或外发动作。
- 自由文本输入只能创建白名单 `WorkTaskType`，且扩大数据范围会触发新的任务预览与确认。
- 工具审计能检测计划但未执行、执行但未登记、被阻止、缺失证据和绕过审批的用例调用。
- 日志扫描确认不存在密钥和个人正文。
- 数据库、文件库和备份均为加密状态。
- 备份恢复必须验证数据库快照、文件 Manifest、对象哈希和索引版本的一致性。
- 密钥轮换、备份恢复、活动数据删除与备份过期/密钥销毁演练通过。
- Gmail 授权固定为唯一 `gmail.readonly`；当前方法 Allowlist 为 GET-only，草稿、修改、删除和发送均不可达。
- Gmail Restricted scope 的 OAuth Verification/安全评估路径已经确认；实际 Token Scope 与 UI 展示一致。
- 代码、依赖调用图和网络测试中不存在 Draft/Send/Modify/Delete 方法；本地 HTTP 契约测试覆盖授权、刷新、同步、脱敏验收和撤销。
- 提案确认门的端到端测试不能被 UI 跳转或重试绕过。
- 收件人、正文或附件变化会使已确认的内容哈希失效；`exported` 不会被记为 `sent`。
- 删除演练产生完整 `DataDeletionReport`，并能处理备份待过期和部分失败状态。
- 安装包签名、公证和更新签名校验通过。
- Windows 次发必须复跑本清单，并额外验证 DPAPI、SQLCipher 原生绑定、MSIX/安装包身份、文件 ACL、杀毒软件干预、签名和更新回滚。

## 15. 安全事件处理

发现疑似泄露或误发时：

1. 立即暂停邮箱同步、模型调用和草稿创建。
2. 保留不含正文的审计记录，记录影响时间与对象 ID。
3. 撤销邮箱 Token 和模型密钥。
4. 判断受影响的候选人、客户、文件和 Provider。
5. 按公司及适用法律流程通知负责人并评估通报义务。
6. 修复后重新跑安全回归和数据完整性检查，再恢复功能。
