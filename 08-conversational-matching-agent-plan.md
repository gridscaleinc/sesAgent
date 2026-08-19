# SES Agent Desktop 对话式案件匹配 Agent 最小实现方案

<!-- ses-current-state package=0.1.0 schema=38 -->

> 版本：v0.7  
> 日期：2026-08-18  
> 状态：v0.7 AI 规划式单 Tool Agent 已进入源码并通过本机自动测试；生产真实账号端到端 SSE/Tool 选择仍待受控验收，Expert Attestation 作为非阻断质量、审计与发布准备度建议项单独记录  
> 当前主系统：/Users/yk/project/life/ses-agent-desktop  
> 首发平台：macOS  
> 当前运行基线：Package 0.1.0、Schema v38、AI 规划式受控单 Tool Agent  
> 计划目标：用户自然语言先进入所选 AI；AI 只能返回直接回答或一个白名单 Tool 计划；Main 校验并执行本地 Tool，再以真实 SSE 生成最终回答  
> 核心决策：AI 负责理解自然语言和请求 Tool；Main 的 DomainToolRegistry、Schema、Scope、SQLCipher、WorkTask/ProcessingJob 与 Hybrid RAG 仍是权限、执行、恢复、事实和排名的唯一权威。AI 不能直接访问接口，也不能提交内部 ID 或任意 Tool。模型可请求的写操作仅限本地摄取层（当前为会话附件的履历取込），且其产物是必须经人工逐项确认的草稿；外部写、不可逆操作与业务状态变更仍然禁止。

## 1. 文档目的与状态合同

本文档冻结“对话式案件匹配 Agent v0.7”的最小可交付范围、交互合同、AI 规划协议、工具边界、真实 SSE、模型选择、取消、数据生命周期、安全门、灰度方式和验收标准。

本文档不是发布证明。AgentWorkspace、3 个受控 Tool、Sales Agent 会话和 Schema v38 是实现基线；v0.7 的 AI 规划、直接回答、受控 Tool 请求和两阶段 SSE 仍需以源码、单测、真实网络与包级证据验收。

本轮不得改变：

- 当前应用代码和 Package 版本。
- 当前 Schema v38 及其兼容迁移、删除和恢复语义。
- 当前 macOS App。
- 当前 Cloud Expert Attestation 状态（非阻断的质量、审计与发布准备度证据）。
- 当前签名、公证和正式发布状态。

本方案与以下文档共同生效：

- 01-product-prd.md：产品角色、核心场景和非目标。
- 02-technical-architecture.md：Electron、SQLCipher、Hybrid RAG、Cloud AI 和恢复边界。
- 04-security-and-data-governance.md：个人信息、脱敏、DLP、日志和生命周期。
- 07-remediation-and-external-adoption-plan.md：整改、受控执行和发布证据状态。

如果本文与既有安全合同冲突，以更严格的本地优先、最小数据、失败关闭、可恢复执行和人工决定为准。

## 2. v0.3 用户纠正与 supersede 合同

v0.3 明确 supersede v0.2 中以下规范性结论：

- “MVP 完全不调用 Cloud / Provider 调用固定为 0”。
- “MVP 不增加流式 Event Channel”。
- “取消不涉及 Provider 取消或计费”。
- “Cloud 总结只属于未来独立 Gate”。
- “Assistant 只做本地确定性模板且最终一次性返回”。

替代合同如下：

| v0.2 旧结论 | v0.3 最终合同 |
|---|---|
| 本地模板一次性返回 | Tool 成功后先持久化权威本地结果，再通过 AICommerce 原生协议 SSE 流式整理安全证据；GPT 使用 Responses，DeepSeek 使用 Chat Completions |
| 无 Cloud | 只允许 account_ai_token 经现有 CloudRedactionGateway 单一出口调用 AICommerce；本地隐私/出网硬门失败关闭，Expert Attestation 不作为运行时硬门 |
| 无 SSE IPC | Main 接收真实网络 SSE，并向唯一发起 Renderer 发送 typed started/delta/completed/failed/cancelled 事件 |
| 无模型选择 | Main 受控 allowlist：gpt-5.6-luna、gpt-5.6-terra、gpt-5.6-sol、deepseek-v4-flash；Renderer 只传 model key |
| Stop 只取消本地匹配 | Stop 先中止本地读取/展示，再独立请求 AICommerce client-request cancel；不保证零成本或退款 |
| Cloud 失败不影响本地 MVP | Cloud 失败时明确显示失败，保留已持久化 typed blocks 和本地确定性 narrative，不伪造流式 |

v0.7 supersede“本地关键词 Planner 决定 Intent”的旧实现。保留的收缩边界是：一轮最多一个本地 Tool、固定白名单 Tool（当前 7 个：6 个只读/计算 + 1 个本地摄取写）、严格 ANSWER/TOOL 协议、Main 白名单与参数校验、不做任意 Tool、多 Tool 循环或外部写操作、不新增 Agent 专用表、不改变本地 Rank。

最小实现验证三个业务闭环：

1. 用户问“最近有什么案件？”
2. 用户问“这个案件有什么合适的人选？”
3. 用户问“为什么这个人排第一？”

## 3. 当前基线与复用边界

截至 2026-08-18，当前工作区和本机 App 已具备：

| 能力 | 当前状态 | v0.2 处理 |
|---|---|---|
| JobCase 与 Eligible Talent Pool | 已进入 SQLCipher 主链 | 复用 |
| candidate.match.local | 已注册并接入 Main | 原样复用 |
| WorkTask / ProcessingJob | 已有 Preview、指纹、Lease、取消、重试和恢复 | 原样复用 |
| Hybrid RAG | 已实现硬条件、BM25、Profile/Project Vector、RRF、本地 Reranker | 保持排名权威 |
| Match Run | 已绑定案件版本、候选池指纹、模型、策略和 Result Hash | 保持结果权威 |
| Matching-first 详情页 | 已有结构化结果和人工反馈 | 继续保留 |
| AI Conversation | 已支持 candidate-profile / interview、Revision 和历史 | 扩展 sales-agent |
| Action Runtime | 已有 Registry、ActionRun、ActionEvent、Effect、Scope 和未知工具拒绝 | 扩展工具名和会话关联 |
| AICommerce | 已有 account_ai_token、原生客户端和文本请求 | 扩展受控 Responses SSE 与独立 cancel；凭证只留在 Main 客户端内部 |
| Cloud 出网硬门与专家证据 | 合成质量门、CloudRedactionGateway、本地 NER/脱敏/DLP、匿名安全投影和 Endpoint Allowlist 是失败关闭硬门；Expert Attestation 只提供质量/审计/发布证据 | Agent egress 必须复用硬门，不得放宽或绕过；专家证据可选但不得伪造 |
| 本地 ONNX | Embedding/Reranker，不是生成式聊天模型 | 只做现有匹配 |

当前已存在：全局 Sales Agent 会话、job-case.search.local、candidate.match.local、match-run.read.local、resume.analyze.local（会话附件取込）、AgentWorkspace、typed blocks、AI 规划协议、Main 受控执行器和 Schema v38。

本轮 v0.3 已实现：Responses SSE 客户端、模型 allowlist、AgentTurnEvent、流式 UI、Cloud 两阶段持久化与远端 cancel；正式 Cloud 可用仍受本地硬性出网门、账号凭证和真实受控网络验收约束。Expert Attestation 缺失或过期只降低质量/审计/发布准备度，不阻断满足硬门的 Cloud narrative。

本方案不重写匹配算法，也不建立通用 Agent 平台。

## 4. 冻结原则

1. **工具事实优先**：案件、候选人、Rank、Score、Evidence 和 Stale 状态只来自 Main 工具和现有领域模型。
2. **一轮一个动作**：一个用户消息最多解析并执行一个 Tool；复杂任务通过后续对话继续。
3. **AI 理解、Main 执行**：模型先读取经过本地 NER/DLP 的自然语言与最小会话证据，只能返回直接回答或一个受控 Tool 计划；Tool/Rank/typed blocks 仍由 Main 和本地领域模型产生。
4. **模型不直接访问数据库**：模型返回的 Tool 名和业务参数必须由 Main 严格解析、映射和校验；不存在模型直连 SQL、Repository、IPC、URL、文件或桌面工具。
5. **Renderer 不拼 Prompt、不执行 Tool**：Renderer 只提交用户消息、Conversation Revision 和当前可见选择。
6. **复用现有状态机**：不复制 ActionRun、ProcessingJob、MatchRun、取消、重试和恢复语义。
7. **不改变排名**：解释读取已保存 Match Run；条件变化必须产生新 Run。
8. **引用必须唯一**：“这个案件”“第二个”“他”无法唯一解析时先澄清。
9. **不可变 Context 与可变 State 分离**：Sales Agent 类型不随轮次改变；选择和过滤条件可以改变。
10. **历史状态可见**：Deleted/Stale 不能继续冒充 Current。
11. **人工决定**：不自动推荐、录用、淘汰、发送、导出或改变业务状态。
12. **保留旧匹配页**：新入口通过 Feature Flag 灰度，失败时回退现有页面。
13. **外部内容是不可信数据**：邮件、微信、EML、简历和案件文本不能成为 Tool Call、Scope、Actor 或审批。
14. **真实流式**：UI delta 必须来自 AICommerce text/event-stream 网络帧，禁止 setInterval、逐字 reveal 或完整响应后伪流式。
15. **单一出口**：Cloud egress 必须通过现有 CloudRedactionGateway、DLP/本地 NER、合成质量门、匿名安全投影、Endpoint Allowlist 和审计；Expert Attestation 只作为可选质量/审计/发布证据，不能绕过硬门，也不能把缺失当作 Cloud deny。
16. **首发仅 macOS**：不增加 Windows 或独立服务端。

## 5. MVP 范围

### 5.1 必须交付

- 一个 ChatGPT 风格的全局 AgentWorkspace。
- 复用现有会话历史的“新建、切换、单个删除”。
- “最近有什么案件？”本地查询。
- “只看 Java”“第二个详细说一下”等单轮跟进。
- 从案件卡片选择当前案件。
- “这个案件有什么合适的人选？”调用现有 candidate.match.local。
- 展示前 5 名摘要卡片，并进入现有完整匹配详情。
- “为什么第一名排第一？”读取已保存 Match Run。
- “总结一下候选人的整体情况”等追问优先由 AI 使用当前会话的匿名权威证据直接回答，不重新运行匹配。
- Current/Stale/Deleted 状态。
- 本地确定性 Tool 结果先保存；正常 Tool 成功时使用真实 AICommerce SSE 整理 narrative。
- 受控模型选择和历史 model metadata。
- Stop、本地 Abort 与独立远端 cancel 状态说明。
- Feature Flag、旧页面回退、并发限制和包级冒烟。
- Schema v38 迁移与 v37→v38 回归。

### 5.2 明确不包含

- 超出当前案件匹配会话证据的通用自由问答和业务原文处理。
- Provider 任意 Function Calling；本轮只实现固定 ANSWER/TOOL 单动作协议。
- 多 Tool 自主规划或循环。
- Candidate 全局自由搜索。
- 独立 Business Priority Tool。
- 会话重命名和批量删除。
- 右侧 Evidence Drawer。
- 伪造 BM25/Vector/RRF/Reranker 或 Provider 的逐阶段进度。
- 提案、导出、跟进、Gmail、微信或 ATS 写操作。
- Shell、浏览器、任意 HTTP、任意文件、任意 SQL 和桌面自动化。
- Agent 专用恢复平台或新的后台 Scheduler。
- agent_turns、agent_tool_runs、agent_evidence_refs 三张表。
- 新的本地生成式模型、任意 Provider URL 或动态账户模型目录宣称。

## 6. 最小产品交互

### 6.1 页面布局

第一版只包含：

| 区域 | 内容 |
|---|---|
| 左侧 | 复用会话历史、新建、切换、单个删除 |
| 中央 | User/Assistant 消息、澄清、Inline Card 和错误 |
| 底部 | 多行输入、受控模型选择、发送、停止和取消成本说明 |
| 当前选择 | 在消息流顶部显示一个轻量案件 Chip |

不实现独立 Context Bar 和右侧证据抽屉。完整证据继续使用现有匹配详情页。

默认快捷问题只有：

- 最近有什么案件？
- 给当前案件匹配候选人。
- 为什么第一名排第一？

### 6.2 用户可见状态

用户可见状态区分：

- planning：所选 AI 正在理解自然语言，并在“直接回答 / 一个白名单 Tool”之间选择。
- clarifying：需要选择或补充对象，不调用 Cloud。
- running-local-tool：Main 正在执行 AI 请求且已通过校验的本地 Tool。
- connecting-model：本地权威结果已保存，正在连接所选模型整理 Tool 结果。
- streaming：正在接收真实网络 SSE delta。
- stopping：已停止本地读取/显示，正在请求远端取消。
- completed：Cloud narrative 与本地 typed blocks 已一致持久化。
- failed-local-fallback：Cloud 不可用、隐私门阻断或流失败；明确保留本地确定性 Tool 结果。
- cancelled：保留本地权威结果；partial 文本不标为 completed。

不展示模型思维链或虚假百分比。

每轮先显示 AI planning。AI 返回 ANSWER 时直接通过当前网络 SSE 显示回答，不执行 Tool；AI 返回 TOOL 时才进入本地 Tool 阶段，Tool 成功并保存后再次连接同一锁定模型生成最终 SSE 回答。BM25、Vector、RRF 和 Reranker 的分项只在 typed blocks 中显示，不伪造实时埋点。

### 6.3 卡片

案件卡只显示当前查询需要的字段：

- 标题。
- Version。
- 更新时间。
- 技术关键词。
- 单价。
- 工作方式。
- 开始时间。
- 状态。

匹配卡只显示：

- 匿名标签或本机显示名。
- Rank / Fit Score。
- Matched / Missing。
- Hard Filter 状态。
- 一条主要 Project Evidence。
- “查看完整匹配”。
- narrative 所用模型显示名。

卡片数据由 Main 返回；Assistant 文本不作为数据库事实。

## 7. 对话语义

### 7.1 最近案件

“最近”固定解释为：

- 时区：Asia/Tokyo。
- 范围：包含今天在内的最近 30 个自然日；起点为 29 天前 00:00。
- 生命周期：Active。
- 数据状态：已确认、未归档、未删除。
- 排序：updatedAt 倒序。
- 默认和最大返回：20 条。

本地权威 block 必须明确显示“最近 30 天”；Cloud narrative 不得改变日期、数量或案件状态。

“只看 Java”“远程的呢”会再次执行 job-case.search.local，并使用上一轮的日期范围与新关键词。不会在旧结果上由 Renderer 自行过滤。

### 7.2 这个案件

引用优先级：

1. 用户当前明确点击的案件卡。
2. 当前 Conversation State 中唯一的 selectedJobCaseRef。
3. 上一条 Assistant Message 中唯一案件。

以下情况必须 clarifying：

- 上一轮存在多个案件但没有选择。
- 同名案件不能唯一确定。
- 案件 Version 已变化。
- 案件已归档或删除。

不通过模糊标题静默猜测。

### 7.3 合适人选

确认案件后：

1. Main 读取当前 JobCase ID/Version。
2. 创建或复用绑定该案件的 MATCH_CANDIDATES WorkTask。
3. 复用现有 Preview、Context Binding、Actor 和 Scope。
4. 调用 candidate.match.local，输入仍为 taskId。
5. 复用现有 ProcessingJob 和 Hybrid RAG。
6. 保存并返回 Match Run。
7. 对话展示前 5 名；完整结果进入原详情页。

不增加第二套 Match Executor。

### 7.4 排名解释

“为什么第一名排第一？”调用 match-run.read.local：

- 不重新运行模型。
- 读取保存的 Result Snapshot。
- 先形成确定性安全证据投影，再由所选模型流式整理 Matched/Missing、Hard Filter 和 Project Evidence；卡片事实不由模型生成。
- 显示 Match Run ID、Result Hash 和 Current/Stale。

## 8. 最小架构

~~~mermaid
flowchart LR
    U["AgentWorkspace"] --> I["executeAgentTurn IPC"]
    I --> C["NER / DLP / CloudRedactionGateway"]
    C --> L["Selected AI: ANSWER or one TOOL plan"]
    L -->|"ANSWER SSE"| E["Main typed AgentTurnEvent"]
    L -->|"TOOL plan"| A["Main schema / allowlist / reference resolver"]
    A --> P["DomainToolRegistry / Action Policy"]
    P --> J["job-case.search.local"]
    P --> M["candidate.match.local"]
    P --> G["match-run.read.local"]
    J --> D["SQLCipher Repository"]
    M --> H["Existing WorkTask / ProcessingJob / Hybrid RAG"]
    G --> D
    H --> D
    D --> B["持久化 Typed Blocks + 本地 Narrative"]
    B --> C2["NER / DLP / CloudRedactionGateway"]
    C2 --> S["同一锁定模型生成最终 SSE"]
    S --> E["Main typed AgentTurnEvent"]
    E --> U
    S --> E
~~~

信任边界：

- Renderer 不可信，只调用高层 IPC。
- Main 是 Tool、Scope、Actor、Conversation 和结果权威。
- Worker 继续只运行固定本地 Embedding/Reranker；生成式模型只在 AICommerce 后方。
- AICommerceNativeClient 持有 account_ai_token；Renderer/Preload/日志看不到 Token、Provider URL 或原始响应。
- CloudRedactionGateway、DLP/本地 NER、合成质量门、匿名安全投影和 Endpoint Allowlist 是唯一硬性 egress 边界，失败时不调用 Provider；Expert Attestation 只进入可选审计/质量状态。

## 9. Agent Turn 合同

### 9.1 输入

executeAgentTurn 接收：

- conversationId。
- message。
- expectedConversationRevision。
- requestId。
- modelKey；只能是 Main 当前 allowlist 中的 key。
- 可选 selectedJobCaseRef，该引用必须来自当前 Renderer 已加载的 Main 返回卡片。

Renderer 不提交：

- Tool Name。
- SQL/过滤对象。
- Candidate IDs 列表。
- Match Rank。
- Conversation 历史全文。
- Provider、模型原始 ID、Endpoint、Header、Token 或 billing mode。

Main 从 SQLCipher 重新读取 Conversation 和当前引用。

### 9.2 一轮生命周期

1. 校验 Trusted Sender、输入长度、Request ID 和 Revision。
2. 检查同一 Conversation 是否已有活动 Turn。
3. 读取不可变 Context 和可变 State。
4. Main 将用户自然语言、最近会话文本和匿名最小证据组成 planning projection，经本地 NER、脱敏、DLP、质量硬门和 Endpoint Allowlist 后发送给锁定模型。
5. AI 只能返回 `ANSWER\n<plain text>` 或 `TOOL\n<strict JSON>`；协议错误、未知 Tool、多 Tool、内部 ID 和越界参数全部失败关闭。
6. 若为 ANSWER，通过同一真实网络 SSE 向唯一 event.sender 增量显示，保存 User/Assistant Message；不执行本地 Tool。
7. 若为 TOOL，Main 映射到固定 AgentPlannedToolAction，并通过 Registry/Schema/Scope/Actor/幂等校验。
8. Main 解析当前对象引用；有歧义则返回 clarifying，不执行 Tool。
9. 执行一个 Tool，生成 Typed AgentAnswerBlock 和本地确定性 narrative。
10. 保存 User/Assistant Message、State、Revision 和 ActionRun 关联；这是可恢复的本地权威检查点。
11. 以当前用户问题和 Tool 的匿名安全结果生成 final projection，并重新执行本地 NER/DLP/硬门复检。
12. 使用同一锁定 modelKey 发起第二段 AICommerce SSE，只向 event.sender 发送最终回答增量。
13. SSE 成功后以 Revision CAS 只替换同一 Assistant Message 的 narrative/mode/model metadata，保留 blocks/references。
14. final 阶段失败、门阻断或取消时保留第 10 步本地结果；planning 阶段失败则不执行任何 Tool。partial 不标为 completed。

一轮不循环、不递归、不自动执行第二个 Tool。

### 9.3 并发

- 同一 Conversation 只允许一个活动 Turn。
- 同一 WorkTask 继续使用现有 withTaskOperation 防并发。
- 本地 ONNX 继续受现有 local-ai Resource Scheduler 限制。
- 案件只读查询可以与其他会话查询并行。
- 两个窗口使用同一 Revision 时，后提交者收到 Revision Conflict，不自动合并。
- 双击发送使用 conversationId+requestId 幂等拒绝重复执行。
- 发送时锁定 modelKey；活动 Turn 期间 Renderer 禁止切换模型。

### 9.4 取消

- 本地 Tool 阶段继续复用 WorkTask/ProcessingJob cancel。
- Cloud 阶段 active turn 持有 AbortController 与当前真实 client_request_id。
- Stop 先立即 abort 本地 response reader、停止向 Renderer 发 delta，再使用独立请求 POST `/v1/ai/client-requests/{id}/cancel`，body 为 app_code/product_code。
- 不仅用户 Stop：任何本地 SSE parser、consumer、onDelta 或 reader 失败，都必须 best-effort cancel response reader、abort 当前请求；若已取得 client_request_id，还必须发起并等待独立远端 cancel 止损，再以 failed-local-fallback 结束，不能伪装为用户 cancelled。
- 窗口关闭或 Agent IPC dispose 时同样 abort；若已取得 client_request_id，至少 best-effort 发起独立远端 cancel。
- cancel_requested 只表示 AICommerce 已受理请求；canceled 表示远端记录已终止；too_late 表示已完成或无法再阻止。
- HTTP 200、客户端断开或 cancel_requested 都不能宣称 Provider 已停止、免费或退款。
- 已完成并持久化的 Match Run 和本地 typed blocks 永远保留。
- partial 文本可在临时 bubble 中显示，但取消后的持久化状态必须明确为 cancelled 或回到本地确定性 narrative。

### 9.5 模型 allowlist 与协议路由

Main 默认只暴露以下受控模型；Provider、Endpoint 和 Token 字段都不能由 Renderer 指定：

| key | displayName | Provider | AICommerce native endpoint | upstream model | 输出上限 |
|---|---|---|---|---|---:|
| gpt-5.6-luna | GPT-5.6 Luna | openai | `/v1/ai/native/openai/v1/responses` | gpt-5.6-luna | 1,200 |
| gpt-5.6-terra | GPT-5.6 Terra | openai | `/v1/ai/native/openai/v1/responses` | gpt-5.6-terra | 1,200 |
| gpt-5.6-sol | GPT-5.6 Sol | openai | `/v1/ai/native/openai/v1/responses` | gpt-5.6-sol | 1,200 |
| deepseek-v4-flash | DeepSeek V4 Flash | deepseek | `/v1/ai/native/deepseek/v1/chat/completions` | deepseek-v4-flash | 4,096 |

- 默认 key 为 gpt-5.6-luna。
- 可选 `SES_AGENT_CHAT_MODELS_JSON` 只能扩展严格 schema 的 key/displayName/model/maxOutputTokens；Endpoint、Provider 和 Header 不可配置。
- Renderer 只提交 key，Main 每轮重新查 allowlist；未知 key 失败关闭。
- AICommerce 当前没有账户级原生模型发现端点，因此 UI 不宣称动态服务端目录。
- DeepSeek 与 GPT 共用登录后由 Members 签发并存入系统保护区的 `account_ai_token`；它不是 DeepSeek 原生 API Key，应用不新增 BYOK 输入框，也不读取 Clear 的遗留 `deepseekKey`。
- DeepSeek 请求固定使用 `max_tokens`、`stream=true`、`stream_options.include_usage=true`；本地解析 `choices[].delta.content`，忽略仅供模型内部推理的 `reasoning_content`，必须看到 `[DONE]` 且拒绝 `finish_reason=length|max_tokens` 的半截回答。
- 两种协议都复用相同的 AICommerce 计费 Header、client request ID、显式远端 cancel、本地匿名 Projection、DLP 和 Endpoint Allowlist。

## 10. 最小 Tool 目录

### 10.1 job-case.search.local

Effect：

- localRead=true。
- localWrite=false。
- externalRead/write=false。
- cloudInvocation=false。

Scope：active-job-cases。

输入：

- mode：recent 或 by-id。
- caseId：仅 by-id。
- query：可选，最多 200 字符。
- updatedAfter / updatedBefore：由 Main 计算或复用，不信任任意 Renderer 时间。
- lifecycle：固定 active。
- limit：固定最大 20。

输出：

- queryFingerprint。
- dataAsOf。
- normalizedFilters。
- totalMatched。
- JobCase ID/Version 有序引用。
- 本次显示所需的结构化卡片字段。

不返回原始案件正文。

### 10.2 candidate.match.local

复用现有 Tool：

- 输入继续是 taskId。
- Scope 继续是 confirmed-candidate-pool。
- Effect 继续是 localRead + localWrite。
- 继续经过 WorkTask、Preview、ActionRun、Request Fingerprint、Lease、取消、重试和 Result Hash。
- AgentUseCase 只负责将已选择 JobCase 绑定到 WorkTask。

### 10.3 match-run.read.local

Effect：

- localRead=true。
- localWrite=false。
- cloudInvocation=false。

Scope：selected-match-run。

输入：

- runId。
- 可选 resultId 或 rank。

输出：

- Run Validity。
- JobCase Version。
- Candidate Pool Fingerprint。
- Algorithm/Model/Policy Version。
- Result Hash。
- 保存的 Matched/Missing、Hard Filter 和 Project Evidence。

该 Tool 读取 Result Snapshot，不根据当前 Profile 重建历史解释。

### 10.4 延后工具

以下不进入 MVP：

- candidate.search.local。
- business-priority.list.local。
- proposal.create/export。
- Gmail/微信/ATS 写操作。
- 任意 Function Calling Tool。

## 11. 回答数据合同

### 11.1 类型化 Block

Assistant Message 使用：

~~~text
AgentAnswerBlock =
  | TextBlock
  | JobCaseCardsBlock
  | CandidateMatchCardsBlock
  | ClarificationBlock
  | ErrorBlock
~~~

事实字段由 Block 承载，文本只做解释。

Assistant Message 使用可选、向后兼容的 JSON metadata 记录：

- modelKey。
- modelDisplayName。
- narrativeStatus：local / streaming / completed / failed-local-fallback / cancelled。
- clientRequestIdHash 或安全审计引用；不得保存 account token。

不为这些字段做 Schema v39；复用 v38 payload_json 的可选字段并由 Zod 保持旧消息兼容。

### 11.2 类型化引用

Message Reference 至少包含：

- kind：job-case / match-run / match-result。
- objectId。
- objectVersion，可空。
- resultHash，可空。
- label。
- ordinal：用于解析“第二个”。

本机历史只保存引用和最小文本，不保存整个 Tool Result 或 Match Evidence 副本。重新打开历史时，Main 根据引用读取当前对象并计算 Current/Stale/Deleted。

### 11.3 不可变 Context 与可变 State

Sales Agent 的不可变 Context：

~~~json
{
  "assistant": "sales-agent"
}
~~~

可变 State：

~~~json
{
  "selectedJobCaseRef": null,
  "lastMatchRunId": null,
  "lastSearchMessageId": null
}
~~~

日期范围、查询词和有序结果引用绑定在产生它们的 Message Block 上，不进入不可变 context_key。

## 12. Schema v38 最小迁移

Schema v38 仍有必要，但不新增三张 Agent 专用表。

### 12.1 重建 ai_conversations

必须：

- assistant_type 增加 sales-agent。
- candidate_document_id 对 sales-agent 允许 NULL。
- interview 字段对 sales-agent 必须为 NULL。
- candidate-profile / interview 继续保留当前 FK 和合法组合。
- 旧会话 ID、Payload、Revision、创建/更新时间无损迁移。
- context_key 对 sales-agent 固定基于 assistant 类型，不包含可变选择。

合法组合使用数据库 CHECK 和 Zod 判别联合双重校验。

### 12.2 扩展 Conversation Payload

AiConversationSnapshot 增加：

- 可选 salesAgentState。
- Message.turnId。
- 类型化 references。
- 类型化 blocks。

旧 candidate-profile/interview Payload 继续可解析。

### 12.3 重建或调整 action_runs

当前 tool_name 使用硬编码 CHECK。v38 必须：

- 支持 job-case.search.local 和 match-run.read.local。
- 给 action_runs 增加可空 conversation_id 和 turn_id。
- conversation_id 使用 ON DELETE SET NULL，Action Audit 不因用户删除会话而消失。
- Tool 执行合法性继续由 DomainToolRegistry 和 DomainToolName 验证。
- 避免以后每增加一个 Tool 都必须重建整个 action_runs 表；数据库只保留非空、长度和版本约束。

Main 的 preflightAction 参数类型改为 DomainToolName，不再维护第二份手写 Tool Union。

### 12.4 复用现有表

继续复用：

- action_runs / action_events。
- approval_requests。
- processing_jobs。
- candidate_match_runs / candidate_match_results。
- ai_conversations。

不新增：

- agent_turns。
- agent_tool_runs。
- agent_evidence_refs。

只有删除级联性能测试证明解析 Conversation Payload 不足时，才单独提案新增 ai_conversation_entity_refs；不得在 MVP 中预建。

### 12.5 迁移验收

- v37→v38 真实迁移。
- Candidate/Interview 旧会话逐条回读。
- Sales Agent 新会话保存、更新和删除。
- 可变 State 更新不改变 context_key。
- 新 Tool ActionRun 可写入。
- 迁移失败回滚，旧数据库不被部分改写。
- 外键和 Integrity Check 通过。

## 13. 会话删除、保留和备份

### 13.1 本地保存

- User/Assistant Message 只保存于 SQLCipher；Cloud egress 只发送独立构造的安全 Projection，不上传会话历史。
- 普通日志不保存消息全文。
- Tool Result 大对象和 Match Evidence 不复制进 Conversation；Cloud prompt 也只使用有上限的最小安全字段。
- 本机候选人显示名通过引用实时解析，不保存为 Assistant 卡片快照。

### 13.2 领域对象删除

候选人或案件永久删除前：

- 解析 sales-agent Conversation 中的类型化引用。
- 删除预览统计受影响 Conversation/Message。
- 默认事务性删除引用该对象的 Agent 卡片和对应 Assistant 解释。
- 如果用户消息包含该对象的直接标识符，使用现有本地 PII 检测定位，并删除受影响消息或整个会话。
- 删除后重新打开历史只显示 Deleted Tombstone，不重新恢复本机身份。

MVP 数据规模下允许在删除事务前扫描最多 50 个会话、每个最多 200 条消息。只有真实性能证据表明不足时才增加引用索引表。

### 13.3 备份与恢复

- Agent Conversation 随 SQLCipher 一致性备份进入恢复包。
- 当前活动库删除不能证明旧备份中的副本已消失。
- 删除报告必须说明旧备份保留到过期、删除或密钥销毁。
- 恢复旧备份后重新计算 Current/Stale/Deleted，不自动执行历史 Tool。
- 恢复不重放未完成 Turn。

### 13.4 用户删除

- MVP 支持单个会话删除。
- 删除会话不删除 Action Audit、WorkTask 或 Match Run。
- 会话删除后 action_runs.conversation_id 置空，审计仍保留。

## 14. IPC 与模块边界

### 14.1 IPC

保留命令 IPC：

- executeAgentTurn。
- cancelAgentTurn。

新增只读 Main→Renderer 事件通道：

- agentTurnEvent。
- Preload 暴露 `onAgentTurnEvent(listener): unsubscribe`，不暴露通用 `ipcRenderer.on`。
- 事件只发送给发起 executeAgentTurn 的 `event.sender`，不 broadcast 到其他窗口。

会话历史继续复用 listAiConversations / deleteAiConversations；不增加 Agent 专用 list/get/delete IPC。

`AgentTurnEvent` 是严格判别联合：started / delta / completed / failed / cancelled。每个事件包含 conversationId、requestId、严格递增 sequence、modelKey；delta 还受单事件和整轮总字符上限约束。Renderer 只接受当前 conversationId/requestId 且 sequence 大于已接收值的事件，最终 promise 返回后以持久化 conversation 替换临时 bubble。

### 14.2 模块

只增加一个小型领域模块：

- packages/agent：Intent、Reference Resolver、AgentUseCase、Typed Block 和本地 Presenter。
- apps/desktop/src/main/agent-ipc.ts：IPC、Trusted Sender、Repository/Tool Adapter。
- packages/aicommerce：受控 Responses SSE parser、billing fallback、Abort 和独立 cancel。
- apps/desktop/src/renderer/components/AgentWorkspace.tsx：页面入口。

Tool Spec 继续进入 packages/action-runtime；Contract 继续进入 packages/shared。

只有出现第二个独立消费者或独立发布周期时，才把 Agent Runtime 和 Agent Tools 拆成多个 Package。

新增实现优先进入 packages/aicommerce、packages/agent 和 agent-ipc，避免继续扩大 main/index.ts。AgentWorkspace 的模型 selector、流状态和事件 reducer 可拆成同目录小模块。

## 15. Feature Flag、灰度与回滚

### 15.1 Feature Flag

新增受管布尔配置：

- conversationalMatchingEnabled。
- macOS 开发包和正式包默认 true。
- 仅当 Main 读取到 `SES_CONVERSATIONAL_MATCHING_ENABLED=0` 时关闭，`=1` 与未设置都表示开启。
- 不由 Renderer 任意覆盖。

Flag=false：

- 原“AI 匹配”入口继续进入现有匹配页。
- Agent IPC 返回 FEATURE_DISABLED。
- 不创建 Sales Agent 会话。

Flag=true：

- 主入口进入 AgentWorkspace。
- 页面保留“打开经典匹配页”。

### 15.2 Kill Switch

紧急回退时使用 `SES_CONVERSATIONAL_MATCHING_ENABLED=0` 启动；正常 Finder 启动不依赖终端环境变量，默认进入 AgentWorkspace。

以下任一条件触发本地回退：

- v38 迁移失败。
- Agent 初始化失败。
- Conversation Payload 无法校验。
- Registry 缺少核心 Tool。
- AgentWorkspace 运行时异常。

回退只关闭新入口，不禁用已有 JobCase、Candidate、Match Run 和经典匹配页。

### 15.3 灰度

1. 开发环境和内部测试包默认开启。
2. 包级 smoke 验证未设置环境变量时进入 AgentWorkspace。
3. 包级 smoke 另以显式 `=0` 验证经典匹配回退。
4. 本机合成数据验收。
5. 单名营业员脱敏数据试点。
6. 真实业务试点和回退演练通过后保持默认开启。
7. 至少一个稳定版本后再提案删除旧入口分支。

## 16. 安全与数据边界

### 16.1 v0.7 Cloud egress

- 用户自然语言和最近会话文本可以进入 AI planning，但必须先经过本地 NER、脱敏、DLP、长度上限和硬性出网门；简历/案件/邮件/微信原文仍不进入 Cloud。
- 模型可以请求一个固定 Tool 及有限业务参数，但不能指定 Scope、Actor、内部对象 ID、数据库过滤器或 Endpoint；写操作只能请求白名单内已开放的本地摄取 Tool，附件按序号引用而不是令牌。Main 是最终校验与执行权威。
- Planning Prompt 只能由固定 instruction、locale、用户请求、最小会话文本和匿名权威证据组成；Final Prompt 只能由固定 instruction、用户请求和本轮 Tool 的匿名权威 Projection 组成。
- Projection 必须经过 CloudRedactionGateway、DLP/本地 NER、合成质量门、匿名安全投影、Endpoint Allowlist 和审计；任一硬门失败都不发网络请求。Expert Attestation 不属于出网硬门。
- 初次 gates/NER/redaction 完成后，在 CloudRedactionGateway 真正出网前必须再次加载合成质量门、硬性出网控制和当前实现绑定；二次 `requireCloudAiPrivacyRuntime` 必须通过，且 qualityReportHash、privacyImplementationSha256、cloudEnforcementSha256 与初次 hard binding 完全一致。Agent 路径不创建自由文本 Review Ticket，而是生成绑定 Conversation/Request/Content Hash 的确定性 `reviewTicketHash` 作为兼容审计字段。`expertAttestationHash` 可选：缺失、过期、绑定变化或校验失败时写为 `null`，不把 `streamResponses` 置为零调用；Bootstrap 继续用 `expertGate.status/failureCodes` 展示非阻断质量状态。
- account_ai_token 只在 Main 的 AiCommerceNativeClient 内部读取和使用，不进入 Renderer、Preload、Conversation、日志或错误。
- Provider URL、Authorization、Cookie、原始 SSE frame 和内部错误栈禁止记录。
- 经典匹配页不依赖 Cloud；对话式 Agent 的自然语言理解依赖 Cloud planning。Planning 不可用时不猜测 Intent、不执行 Tool；Tool 已成功后的 Final Cloud 失败仍保留本地权威结果。

### 16.2 Prompt Injection

- 用户消息可以表达业务意图，但 AI 结果必须映射到固定 ANSWER/TOOL 协议和 AgentPlannedToolAction schema。
- 案件、邮件、微信、EML、简历和 Match Evidence 都是数据。
- ignore instructions、system prompt、tool call、execute、导出全部候选人等数据内容不能提升权限。
- Renderer 不能提交 Tool Name。
- 未注册 Tool、畸形参数、多 Tool 或未开放的写操作计划在调用 Domain Tool 前拒绝，执行次数为 0。已开放的摄取写仍须通过 DomainToolRegistry preflight（Scope、Origin、输入 Schema、幂等键）。

### 16.3 人事公平

- 不用性别、年龄、国籍、姓名、照片作为排序特征。
- 法定就劳资格继续由本地硬条件处理。
- Match Score 不是录用概率。
- 本地模板不生成自动录用/淘汰结论。
- 人工反馈不直接在线改变当前排序。

## 17. AICommerce Responses SSE 合同

### 17.1 请求

AiCommerceNativeClient 只向受管 `AICOMMERCE_BASE_URL` 发起：

`POST /v1/ai/native/openai/v1/responses`

Body 至少包含：model、instructions、input、stream=true、max_output_tokens。

Header 内部包含：Authorization Bearer account_ai_token、x-aicommerce-app-code、x-aicommerce-product-code、X-Client-Request-ID 和受控 billing mode。调用方只得到安全的增量文本、状态和 opaque client_request_id，不得到 Token/Header。

### 17.2 双投影

- Display Projection：本机完整 typed blocks/cards。
- LLM Projection：匿名、最小、结构化、经过业务机密政策。

姓名、电话、邮箱、地址、原文、内部路径、Source Label、PII Mapping、就劳资格、性别、年龄和国籍不得进入 Cloud。

客户/公司名称、商流、单价和合同条件属于商业机密，默认也不进入 Cloud；只有受管策略明确允许的字段才能投影。

### 17.3 Prompt 预算

冻结：

- 完整请求最多 12,000 字符。
- Tool Evidence 最多 8,000 字符。
- 最多 5 名候选人。
- 每人最多 1 条 Project Evidence。
- 确定性按 Rank 截断完整记录，不截断 JSON。
- 超限时返回本地结果，不自动上传更多内容。

### 17.4 SSE parser

- 必须验证 Content-Type 为 text/event-stream；JSON/HTML/普通文本 2xx 不能当成功。
- MIME 必须精确为 `text/event-stream`，可以带 `; charset=...` 等参数；`text/event-stream-json` 等前缀相似值仍必须拒绝。
- 支持任意 chunk 边界、CRLF、空行帧边界、注释行和多行 data。
- 支持 response.output_text.delta、response.completed、error、response.failed、response.incomplete。
- delta 只接受字符串并做单事件/总量上限；completed 前断流是失败或 incomplete，不是成功。
- 成功收到 response.completed 后继续读取标准 `[DONE]`、注释和空帧，直到 AICommerce 自然 EOF；成功路径不得主动 `reader.cancel()`、Abort 或提前断开，以免服务端把 disconnect 解释为取消并打断 usage/settlement。
- parser、reader、consumer 或 onDelta 任一异常在 rethrow 前必须 best-effort `await reader.cancel()` 并释放 reader lock；terminal 后额外 data、重复或不一致 terminal 必须失败关闭。
- 只有异常、用户 Stop 或窗口关闭/dispose 才 cancel reader、Abort，并在已有 client_request_id 时发起独立 AICommerce cancel；恶意 completed 后不 EOF 的连接由用户 Stop/外层 Abort 止损，不新增 terminal timeout。
- 不先等待完整 response，再在本地逐字 reveal。

### 17.5 Automatic billing fallback

- 首次 billing mode 为 subscription。
- 只有在未收到任何 SSE 内容前，且错误属于既有 subscription quota fallback 集合，才使用新的 X-Client-Request-ID 重试 standard。
- 一旦收到任何流内容或向 Renderer 发出 delta，禁止 fallback，避免双请求和双计费风险。

### 17.6 Cancel

- AbortController 立即停止当前 response reader；随后使用独立 signal 请求 `POST /v1/ai/client-requests/{id}/cancel`。
- 请求 body 固定 app_code/product_code，使用同一 account token，但 Token 不返回调用方。
- 解析 cancel_requested / canceled / too_late；未知状态失败关闭。
- Stop 是止损，不是免费、退款或 Provider 停止证明。
- 取消文案必须区分“尚未取得 client_request_id”“已有 id 但独立 cancel 网络/解析失败”和三种服务端状态；`remoteCancelStatus=null` 本身不能被解释成未取得 id。

## 18. 失败与恢复

| 场景 | MVP 行为 |
|---|---|
| 没有 Active 案件 | 返回空卡片和案件导入入口 |
| 没有 Eligible 人才 | 返回人才池前置条件 |
| 引用不唯一 | clarifying，不执行 Tool |
| 案件 Version 变化 | Stale，要求重新选择 |
| 案件/候选人已删除 | Deleted Tombstone，不恢复身份 |
| Embedding 失败 | 复用现有安全 BM25/RRF 降级 |
| Reranker 失败 | 保留 RRF 顺序和算法证据 |
| Tool 输入无效 | INVALID_INPUT |
| Tool 未注册 | UNREGISTERED_TOOL |
| Conversation 已有活动 Turn | TURN_ALREADY_RUNNING |
| Revision 冲突 | CONVERSATION_REVISION_CONFLICT |
| 用户取消本地匹配 | 复用 ProcessingJob cancel |
| 隐私/出网硬门阻断 | 不发 Cloud 请求；保留本地 Tool 结果并显示 failed-local-fallback |
| Expert Attestation 缺失/过期/不匹配 | 硬门通过时仍可发 Cloud 请求；记录非阻断的质量/审计/发布准备度提示，不宣称专家质量已通过 |
| AICommerce 非 SSE 2xx | 拒绝伪成功；保留本地 Tool 结果 |
| SSE failed/incomplete/断流 | 停止 delta，保留本地结果；partial 不标 completed |
| subscription quota 预流失败 | 仅在零流内容时用新 request id fallback standard |
| 用户停止 Cloud | Abort reader + 独立 cancel；显示 cancel_requested/canceled/too_late 的准确说明 |
| App 重启 | 恢复安全 ProcessingJob；不自动重放 Agent Turn |
| Feature Flag 关闭 | 回到经典匹配页 |

错误消息不得包含 SQL、Token、绝对业务路径、原始正文或堆栈。

## 19. 审计与可观测性

复用 action_runs / action_events，允许记录：

- conversationId / turnId / requestId。
- Tool 名称/版本。
- Actor、Scope、Input Hash、Result Hash。
- WorkTask / ProcessingJob / Match Run 关联。
- 状态、记录数、耗时和错误码。
- modelKey、安全 request id hash、SSE 事件数/字符数、billing mode 和 cancel outcome。

禁止普通日志记录：

- 用户消息全文。
- Tool Result 正文。
- 姓名、电话、邮箱和地址。
- 原始案件、简历、邮件或微信内容。
- Token、Cookie、密钥和内部错误栈。

MVP 聚合指标：

- Turn 完成率。
- 澄清率。
- Tool 失败率。
- Match Run 生成率。
- 经典页面回退率。
- 本地 P50/P95 延迟。
- 首个 SSE delta 延迟、流完成率、Cloud fallback 率和 cancel outcome 分布。

## 20. MVP 验收标准

### 20.1 产品

- Flag=false 时经典匹配页行为不变。
- Flag=true 时用户可以问“最近有什么案件”，得到最近 30 天真实案件卡片。
- 用户可以追加“只看 Java”并得到新的本地查询。
- 用户点击案件后可以问“这个案件有什么合适的人选”。
- 匹配继续使用现有 WorkTask/Hybrid RAG，并显示前 5 名。
- 用户可以打开完整匹配详情。
- “为什么第一名排第一”不重新运行模型。
- 历史会话重新打开时 Current/Stale/Deleted 正确。
- 中文/日文回答跟随当前 Application Locale。
- 用户可以选择 Main allowlist 中的模型，历史消息可识别最终 model key/display name。
- “总结一下候选人的整体情况”等已有证据追问由 planning SSE 直接回答，candidate.match.local 调用次数为 0，不重复显示候选人卡。
- 需要新数据时 AI 只能请求一个白名单 Tool；Main 校验后执行，随后以同一模型生成最终 SSE 回答。
- 正常 Tool 成功后 narrative 由真实 SSE 增量显示；最终 typed blocks/cards 与本地事实一致。
- Cloud 失败时没有伪 delta，并保留本地结果。

### 20.2 运行时

- 一轮最多执行一个 Tool。
- Renderer 不能指定 Tool Name 或数据库过滤对象。
- 未注册 Tool 执行次数为 0。
- 同一 Conversation 不并发执行两个 Turn。
- 重复 requestId 不产生重复 Match Run。
- candidate.match.local 保持现有 Preview、Fingerprint、Lease、取消、重试和持久化。
- Agent 失败可进入经典匹配页。
- Main 只向发起 event.sender 发送 AgentTurnEvent；跨会话、跨 request、旧 sequence 被 Renderer 忽略。
- 每个 Turn 的 sequence 严格递增，delta 单事件/总量受限。
- automatic billing fallback 在首个流内容后永不发生。

### 20.3 数据与删除

- User/Assistant Message 只进入 SQLCipher。
- Conversation 不复制完整 Match Evidence。
- Candidate/JobCase 删除预览包含 Agent 引用。
- 删除后历史不显示本机姓名或旧卡片。
- 恢复旧备份后重新计算 Stale/Deleted。
- 删除会话不删除 Action Audit 和 Match Run。

### 20.4 隐私

- Planning prompt 可以包含经本地 NER/DLP 脱敏的用户请求与最近会话最小文本；Final prompt 包含经同样硬门处理的当前请求和匿名 Tool 证据。两者均不得包含直接标识符、凭证或业务原文大对象。
- account_ai_token、Authorization 和 Provider URL 不进入 Renderer/Preload/日志/错误。
- 本地合成质量门、NER、脱敏/DLP、匿名安全投影、Endpoint Allowlist、当前实现安全绑定或确定性审计哈希等硬门未通过时，AICommerce/Provider 调用次数为 0；Agent 路径不要求自由文本 Review Ticket，Expert Attestation 单独未通过也不触发零调用断言。
- 用户消息和 Tool Result 不进入普通日志。
- Prompt Injection Fixture 不能生成越权 Tool Call。
- 性别、年龄、国籍、姓名和照片不参与排序。

### 20.5 打包

- 真实 macOS app.asar 包含 Agent 模块、Schema 和 Renderer。
- 包内使用真实 SQLCipher、Embedding、Reranker。
- 包级冒烟覆盖 Flag 开关、案件查询、匹配、解释、会话保存、重启、删除引用和旧页回退。
- 受控验收环境覆盖真实 Responses SSE、模型选择、Stop/cancel 和 Cloud 失败本地回退。
- 未签名本机包仍不构成正式发布证据。

## 21. 测试矩阵

MVP 必须覆盖：

1. v37→v38 迁移和旧会话回读。
2. Sales Agent 不可变 Context 与可变 State。
3. 最近 30 天 JST 边界。
4. Java 关键词跟进查询。
5. “这个案件”“第二个”的唯一引用。
6. 歧义引用不执行 Tool。
7. 一轮一个 Tool。
8. Eligible Talent Pool 限定。
9. 真实 ONNX 匹配和安全降级。
10. Match Run 解释不重跑。
11. Current/Stale/Deleted。
12. ActionRun conversationId/turnId 关联。
13. Tool Name CHECK/Registry 新工具。
14. requestId 幂等、双击发送和 Revision 冲突。
15. 同会话并发拒绝。
16. ProcessingJob 取消和 App 重启。
17. Candidate/JobCase 删除与 Conversation 引用清理。
18. 备份恢复后的 Stale/Deleted。
19. Feature Flag 和经典页面回退。
20. Prompt Injection 和未知 Tool。
21. ja-JP / zh-CN。
22. 1440 / 1280 / 1100 宽度和键盘可访问性。
23. 打包后 Main/Preload/Renderer/SQLCipher/ONNX 真实布局。
24. SSE 任意 chunk、CRLF、多行 data、非 SSE、failed/incomplete/error。
25. 模型 allowlist 和环境扩展 schema，拒绝任意 provider/model/endpoint。
26. Authorization/account token 不外泄。
27. subscription→standard 只在预流 quota 错误 fallback，且使用新 request id。
28. cancel_requested/canceled/too_late。
29. AgentTurnEvent sender 隔离、sequence、delta 上限、跨请求/乱序过滤。
30. Renderer selector、发送锁定、progressive delta、Stop 和最终 bubble 去重。
31. Cloud 门阻断/网络失败不产生伪流式且保留本地 typed blocks。
32. 非结束 ReadableStream 在 parser/consumer/onDelta 失败时调用 reader.cancel，Promise 不悬挂；Main 同时 abort 并在有 client_request_id 时独立 cancel，但结果仍为 failed-local-fallback。
33. 出网前二次 hard gates/binding 校验覆盖门降级、binding null 和 `qualityReportHash`/`privacyImplementationSha256`/`cloudEnforcementSha256` 任一变化，`streamResponses` 调用次数为 0；Expert Attestation 缺失或变化只验证可选哈希为 `null`、Bootstrap 状态未误报，不触发零调用。
34. AI planning 的 ANSWER/TOOL 协议支持任意 SSE chunk；ANSWER 前缀不进入 UI，TOOL JSON 不作为用户文本显示。
35. “总结一下候选人的整体情况”返回 ANSWER 并且 candidate.match.local 调用次数为 0；显式“重新匹配候选人”才允许请求 match_candidates。
36. 未知 Tool、额外字段、ordinal/rank 越界、畸形 JSON、混合 ANSWER/TOOL 和 Prompt Injection 全部在本地执行前失败关闭。
37. 直接回答每轮只有 planning 请求；需要 Tool 的轮次是 planning 请求 + final narrative 请求，审计和计费标识可区分 planning/narrative。

Provider 任意 Function Calling、多 Tool 循环、Cloud 业务原文自由问答和外部写操作测试不属于 v0.7。

## 22. 实施顺序

| Stage | 范围 | 退出门槛 |
|---|---|---|
| Stage 0 v0.3 文档冻结 | supersede 无 Cloud/无 SSE，冻结数据与计费边界 | 无阻断问题 |
| Stage 1 本地权威基线 | v38、3 个 Tool、AgentWorkspace、经典页回退、两阶段本地检查点 | 现有回归保持通过 |
| Stage 2 受控 Responses SSE | 模型 allowlist、真实 SSE、事件 IPC、取消、两阶段 narrative | 第 20/21 节新增项通过 |

Function Calling 和受控写操作不作为本文件的实施 Stage，仅保留为未来扩展方向；需要时单独形成范围冻结文档。

## 23. 计划代码触点

新增：

- packages/agent。
- apps/desktop/src/main/agent-ipc.ts。
- apps/desktop/src/renderer/components/AgentWorkspace.tsx 及同目录小组件。
- packages/aicommerce 的 Responses SSE / cancel 模块。

修改：

- packages/action-runtime：新增 2 个 Tool Spec。
- packages/shared：Context、State、Typed Block、Reference、IPC。
- packages/persistence：v38 表重建和 Conversation/ActionRun 关联。
- apps/desktop/src/preload：保留 execute/cancel，并新增受限 onAgentTurnEvent 订阅。
- apps/desktop/src/renderer/App.tsx / AgentWorkspace：Feature Flag、模型选择、临时流 bubble、状态和经典页回退。

复用：

- packages/job-cases。
- packages/resume。
- packages/matching。
- processing_jobs。
- candidate_match_runs。
- 现有 AI Conversation 历史组件。

不得在 MVP 中新增第二套 Tool Executor、第二套 ProcessingJob 或第二套 Match Run。

## 24. 完成口径

### 24.1 v0.3 Agent 完成

只有以下条件全部满足，才能称为“本地对话式案件匹配 Agent 已实现”：

- Stage 1 代码完成。
- v38 迁移和旧数据回读通过。
- 3 个本地 Tool 和一轮一个 Tool 合同通过。
- 安全 Projection 不含用户原文和直接标识符，且通过现有 CloudRedactionGateway/门。
- Responses SSE 是真实网络流，parser、fallback、cancel 和 event sender 隔离通过。
- 模型 allowlist、metadata 和 UI selector 通过。
- Cloud 失败时本地 typed blocks 可恢复且没有伪流式。
- 删除、备份、并发、回退通过。
- 包级真实 SQLCipher/ONNX 冒烟通过。
- 当前构建证据可定位。

### 24.2 Cloud 可用口径

只有第 16/17 节的本地硬性隐私/出网门、真实 SSE、billing fallback、cancel 和真实受控账号证据通过，才能称 Agent narrative Cloud 可用；Expert Attestation 作为质量/审计/发布准备度建议项单独披露。本地 Agent 与经典匹配能力不因此自动获得正式发布状态。

### 24.3 正式发布完成

还必须满足：

- 真实日文隐私专家评审/Attestation（非阻断建议项；缺失时在质量、审计和发布准备度中明确披露）。
- 真实 SES 匹配专家质量门。
- Developer ID 签名和 Notary 公证。
- 当前来源和构建 Evidence。
- 目标 Mac 真实业务试点。
- 隐私、性能、恢复和升级验收。

对话 UI、自动测试或未签名 App 可运行均不能单独构成正式发布完成。

## 25. 已冻结决策

- AI 负责自然语言理解并返回 ANSWER 或一个白名单 TOOL 计划；Main 负责计划校验、引用解析、Tool、Rank、typed blocks、Scope、Actor 和业务状态。
- 核心场景只有最近案件、当前案件匹配、排名解释。
- 一轮只执行一个 Tool。
- Tool 只有 job-case.search.local、candidate.match.local、match-run.read.local。
- 现有匹配详情继续保留。
- 最近定义为 Asia/Tokyo 最近 30 个自然日，最多 20 条。
- 匹配对话展示前 5 名，完整结果进入旧详情。
- Sales Agent Context 不包含可变选择。
- 不新增三张 Agent 专用表。
- v38 重建 ai_conversations 和 action_runs，复用现有审计/任务/匹配表。
- Agent 命令 IPC 为 execute/cancel；Main→Renderer 另有受限 typed event channel。
- Feature Flag 在 macOS 包中默认开启；显式 `SES_CONVERSATIONAL_MATCHING_ENABLED=0` 时保留经典页回退。
- 同一 Conversation 只允许一个活动 Turn。
- LLM 可以请求一个 Tool，但不能直接执行、扩展 Tool 目录、改变 Rank/Scope/Actor 或业务状态；模型由 Main allowlist 控制。
- 默认模型 gpt-5.6-luna，可选 terra/sol/DeepSeek V4 Flash；不宣称动态账户模型目录。
- 真实 SSE，禁止本地 reveal 冒充。
- Stop 是止损，不保证免费/退款。
- Provider 任意 Function Calling、多 Tool 循环和写操作另行立项；当前只支持固定 ANSWER/TOOL 单动作协议。
- 首发只做 macOS。

## 26. 待项目方指定但不改变范围

- Product Owner、Security Owner 和试点 Owner。
- Stage 1 目标版本与排期。
- 工作台显示名采用“SES Agent”或“案件匹配 Agent”。
- Feature Flag 的受管配置来源。
- 首批脱敏试点数据和试点账号。
- 真实专家评审安排（质量/审计/发布准备度建议项，不改变 Cloud 硬门范围）。

这些事项影响排期、品牌和外部验收，不授权扩大 Tool、平台、数据或自动化范围。

## 27. 修订记录

| 版本 | 日期 | 说明 |
|---|---|---|
| v0.1 | 2026-08-18 | 初版，覆盖完整对话 Agent、Cloud、Function Calling 和未来写操作 |
| v0.2 | 2026-08-18 | 按最小实现原则收缩为本地 MVP；复用现有状态机，修正 Context、Schema、删除、并发、Feature Flag、Cloud 取消/预算和完成口径 |
| v0.3 | 2026-08-18 | 用户纠正：supersede“无 Cloud/无 SSE”；保留本地单 Tool 权威，新增 AICommerce Responses 真实 SSE、模型 allowlist、typed 增量 IPC、两阶段持久化和显式远端 cancel |
| v0.4 | 2026-08-18 | 策略迁移：真实专家 Attestation 从 Cloud 调用硬门降为非阻断质量/审计/发布准备度证据；保留本地 NER、脱敏、DLP、匿名安全投影、Endpoint Allowlist 和确定性审计哈希等 Agent 出网硬门，并补充旧审计字段兼容说明 |
| v0.5 | 2026-08-18 | macOS 默认入口修正：未设置 Feature Flag 时直接进入 AgentWorkspace；仅显式 `SES_CONVERSATIONAL_MATCHING_ENABLED=0` 回退经典匹配页，并把两种启动路径纳入包级 smoke |
| v0.6 | 2026-08-18 | 参考 Clear 的账户模型路由接入 DeepSeek V4 Flash：复用 account_ai_token，经 AICommerce `/native/deepseek/.../chat/completions` SSE 调用，不新增 DeepSeek 原生 Key；增加协议专属解析、输出完整性检查、取消与包级静态验收 |
| v0.7 | 2026-08-18 | 用户纠正 Agent 语义：删除关键词 Intent 作为 Tool 主路由；用户自然语言先经 NER/DLP 送入锁定模型，模型通过严格 ANSWER/TOOL 协议直接回答或请求一个白名单 Tool，Main 校验执行后再以 SSE 生成最终回答；已有证据总结不再重跑匹配 |
