# SES Agent Desktop 动作执行可靠性最小优化方案

<!-- ses-current-state package=0.1.0 schema=38 -->

> 版本：v0.5
> 日期：2026-08-21
> 状态：最小实施方案；尚未实施，不代表代码或正式包已经完成
> 当前基线：Package 0.1.0、Schema v38、`DomainToolRegistry`、`ActionRun`、`ActionEvent`、`ApprovalRequest`
> 外部参考：DeepSeek Harness 固定提交 `141eb6fef83422698aef7a981029e843e8161534`
> 核心决策：只吸收追加式轨迹、单调策略守卫和工具终态三项原则，不重建 SES Action Runtime

## 1. 目标

本文只回答一个问题：

> DeepSeek Harness 的三项执行纪律，怎样以最小改动落到 SES 已有 Action Runtime？

本轮只做：

1. ActionRun 状态与 ActionEvent 在同一事务提交。
2. 首次 ActionRun、初始事件和必要的 ApprovalRequest 在同一事务提交。
3. 系统 deny 不能被下游放宽；已确认的 succeeded/blocked 不能被迟到回调覆盖。

本文不是完整状态机重构，也不负责一次性解决 SES 的所有恢复、取消、文件副作用和发布问题。

## 2. 三项借鉴在 SES 中的最小映射

| DeepSeek Harness 原则 | SES 已有基础 | 本轮最小改动 |
|---|---|---|
| 追加式轨迹 | `ActionRun + ActionEvent` | 状态更新与事件追加同事务；事件仍只追加 |
| 单调策略守卫 | `DomainToolRegistry + evaluateActionPolicy()` | 用测试冻结失败关闭；Approval 和 Handler 不能覆盖系统 deny |
| 工具终态 | `ActionRunStatus` | 保护 succeeded/blocked；重复终态幂等；迟到回调不覆盖 |

Proposal 已有的 `export_unknown + manual-review` 是 SES 自己的“不确定结果”实现。本轮把它作为现有能力保留，不借此扩建通用对账系统。

DeepSeek Harness 的插件树、会话 Event Sourcing、审批 seam、通用工具体系和运行时不进入 SES。

## 3. 最小代码改动

### 3.1 首次创建原子化

`ActionOrchestrator.preflight()` 继续先调用 `evaluateActionPolicy()`，但持久化改为一个原子入口：

```text
createActionRunFromPolicy({
  actionRun,
  policyDecision,
  approvalRequest?
})
```

同一个 SQLCipher 事务内完成：

```text
INSERT action_runs
→ APPEND proposed
→ APPEND policy_evaluated 或 blocked
→ 如需审批，INSERT approval_requests
→ 如需审批，APPEND approval_requested
→ COMMIT
```

规则：

- 任一步失败时全部回滚。
- 不能留下 `awaiting_approval` 但没有 ApprovalRequest 的 ActionRun。
- 幂等命中已有 ActionRun 时，只返回已有记录，不重复追加首次事件或审批。
- 初始状态映射保持当前产品行为；本轮不重新设计 native confirmation。
- 不新增表、字段或 migration。

### 3.2 状态与事件原子化

现有 `ActionRuntimeStore.updateActionRun()` 内部改为受约束事务：

```text
读取当前 ActionRun
→ 校验最小终态规则
→ 条件更新 action_runs
→ 追加对应 action_events
→ COMMIT
```

为了减小改动，本轮可以保留现有方法名和 Handler 调用方式，不要求机械重命名全部调用方。

最小终态规则只有四条：

1. 当前状态与目标状态相同，且 processingJobId/resultHash/errorCode 一致时，幂等 no-op，不重复写事件。
2. `succeeded` 不能再被改成 failed/cancelled/running。
3. `blocked` 不能再被普通 Handler 改成其他状态。
4. `failed/cancelled → running` 暂时保留现有 WorkTask retry 行为；本轮不重新设计 retry。

更新使用当前状态作为条件：

```sql
UPDATE action_runs
SET status = ?, ...
WHERE id = ? AND status = ?
```

条件更新失败时重新读取：

- 已经是相同终态且证据一致：按幂等完成。
- 已经是 succeeded/blocked：忽略迟到回调，不覆盖。
- 其他情况：按当前既有行为返回错误，不继续执行新的副作用。

状态更新和 ActionEvent 追加必须一起提交或一起回滚。继续复用现有事件类型，不增加 sequence、schema version 或 reducer。

### 3.3 策略失败关闭

`evaluateActionPolicy()` 继续作为唯一执行前策略入口，不拆成 Guard 插件。

本轮只用测试冻结以下不变量：

- 未注册 Tool 拒绝。
- 输入 Schema 不合法拒绝。
- Origin 或 Scope 不匹配拒绝。
- Actor、Scope ID 或 Scope Fingerprint 缺失拒绝。
- Cloud Invocation 不是 `redacted-only` 时拒绝。
- Approval 不能把以上 deny 改成 allow。
- Handler 不能绕过 preflight 直接执行受控 Tool。

不新增 Capability、nonce、动态 Guard、`abstain` 或策略聚合框架。

## 4. 代码触点

本轮预计只涉及：

- `packages/persistence/src/stores/action-runtime-store.ts`
  - 原子首次创建；
  - 状态与事件同事务；
  - succeeded/blocked 保护；
  - 同终态幂等。
- `packages/persistence/src/index.ts`
  - 暴露最小持久化入口。
- `packages/action-runtime/src/index.ts`
  - preflight 改用原子首次创建。
- `packages/action-runtime/src/index.test.ts`
  - 策略不变量与首次创建协作测试。
- 新增一个聚焦的 ActionRuntimeStore 持久化测试文件。

Renderer、Proposal Workspace、WorkTask、ProcessingJob、Cloud Agent Turn、AICommerce 和数据库 Schema 不在本轮改动范围。

## 5. 测试

本轮只要求以下 8 类测试：

1. allow/native-confirmation/deny 按当前产品映射创建正确 ActionRun 和首次事件。
2. require-approval 的 ActionRun、ApprovalRequest 和事件全成或全不成。
3. 重复 preflight 不重复创建首次事件或 ApprovalRequest。
4. 状态更新或 ActionEvent 追加失败时整个事务回滚。
5. 重复相同终态和相同证据为 no-op，不重复事件。
6. succeeded/blocked 不被迟到 failure、cancel 或 running 覆盖。
7. 现有 failed/cancelled WorkTask retry 行为保持不变。
8. `evaluateActionPolicy()` 的失败关闭不变量保持通过，事件 detail 不写入正文、路径或凭证。

验证范围：

- 聚焦持久化测试；
- action-runtime 测试；
- TypeScript 类型检查；
- 完整现有测试。

没有 Schema 变化时不增加空 migration。本文完成口径是“本机代码和测试完成”，不是正式发布、生产 canary 或真实业务试点。

## 6. 明确不做

本轮不做：

- 完整 ActionRun 状态转换表重构；
- native confirmation 过期、替换和重启治理；
- safe-local retry 重新建模；
- WorkTask cancel 与 ActionRun 全量同步；
- Proposal hard-crash reconciliation；
- 通用 outcome unknown 状态；
- Event Sourcing、Reducer、Sequence 或 Shadow Ledger；
- Guard 插件、Capability 或通用审批授权系统；
- Review Center 新队列或 Action Timeline；
- CloudCallAudit、AICommerce、Provider 取消或结算改造；
- 新 UI、新 Schema、新发布平台或 Release Checklist。

这些事项即使是现有风险，也不构成本轮阻塞项；只有形成独立产品需求后再单独立项。

## 7. 停止条件

本方案采用以下停止规则，避免审核无限扩张：

- 只审核本轮修改是否满足事务一致、终态保护和策略失败关闭。
- 任何需要新状态、新表、新服务、新 UI 或跨系统改造的建议，默认延期。
- 不因为发现相邻模块的既有边缘问题而扩大当前 PR。
- 上述 8 类测试通过、类型检查和完整测试通过后，本方案即视为完成，不继续追加新的架构目标。

## 8. 实施前提与证据边界

- 当前工作区包含未提交修改；实施前先固定目标源码身份并确认没有覆盖用户改动。
- 本文是方案，不代表代码已经实现。
- 本地测试通过只能证明本轮改动，没有证明正式包、签名、公证、Cloud 或生产链路。
- 实施时如发现必须新增 Schema、服务或跨系统合同，停止当前 PR，另行评估，而不是继续扩张本文。

## 9. 外部参考

- [DeepSeek Harness README.zh（固定提交）](https://github.com/deepseek-ai/deepseek-harness/blob/141eb6fef83422698aef7a981029e843e8161534/README.zh.md)
- [DeepSeek Harness 架构（固定提交）](https://github.com/deepseek-ai/deepseek-harness/blob/141eb6fef83422698aef7a981029e843e8161534/docs/architecture.zh.md)
- [DeepSeek Harness 工具执行管线（固定提交）](https://github.com/deepseek-ai/deepseek-harness/blob/141eb6fef83422698aef7a981029e843e8161534/docs/tool-execution-pipeline.zh.md)
- [DeepSeek Harness 审批子系统（固定提交）](https://github.com/deepseek-ai/deepseek-harness/blob/141eb6fef83422698aef7a981029e843e8161534/docs/subsystems/approval.zh.md)

外部参考只用于提炼执行纪律。SES 的实现与验收始终以当前源码和测试为准。

## 10. 修订记录

| 版本 | 日期 | 变更 |
|---|---|---|
| v0.1-v0.4 | 2026-08-20 至 2026-08-21 | 曾扩展到完整状态、恢复、Proposal 收口和发布边界，后确认超出原始借鉴目标 |
| v0.5 | 2026-08-21 | 重写为最小方案：只保留原子轨迹、策略失败关闭和 succeeded/blocked 终态保护，固定停止条件 |
