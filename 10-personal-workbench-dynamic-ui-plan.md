# SES Agent Desktop 个人工作台动态 UI 最小改造方案

<!-- ses-current-state package=0.1.0 schema=38 -->

> 版本：v0.1
> 日期：2026-08-21
> 状态：实施方案；尚未实施，不代表代码、测试或安装包已经完成
> 当前基线：Package 0.1.0、Schema v38、Electron + React、SQLCipher、Main-owned IPC
> 外部参考：DeepSeek Harness 固定提交 `141eb6fef83422698aef7a981029e843e8161534`
> 核心决策：先交付一个白名单驱动的个人工作台，不建设通用插件系统

## 1. 方案要解决的问题

SES 当前首页的业务模块和顺序由产品代码固定。销售顾问、审核负责人和运营人员虽然使用同一套候选人、案件、审核和任务数据，但每天优先关注的内容不同。

本方案只解决一个问题：

> 让当前本机用户不用改代码，就能把 SES 首页调整成适合自己的业务工作台。

第一版允许用户：

- 选择显示哪些内置业务组件；
- 调整组件的上下顺序；
- 保存个人布局；
- 随时恢复 SES 默认布局。

第一版不允许用户创建新的数据权限、业务工具或外部操作。这里的“动态 UI”是受控组件组合，不是任意代码执行。

## 2. 明确终点

本轮完成后，产品必须达到以下固定状态：

1. 首页增加“编辑工作台”入口。
2. 用户可以配置以下 4 个内置组件，且每种最多出现一次：
   - `matching-overview`：现有匹配业务概览；
   - `resource-overview`：候选人、案件、审核和活动数量；
   - `pending-reviews`：待审核事项摘要及审核中心入口；
   - `recent-activity`：最近 5 条活动记录。
3. 用户只能显示、隐藏和排序这些组件；不配置栅格坐标、尺寸、颜色、任意字段或任意查询。
4. 未配置过的用户看到的首页顺序与当前产品一致：匹配概览 → 资源概览 → 最近活动。
5. 首次使用的三步 onboarding 保持现状；onboarding 阶段不显示编辑入口。
6. 配置保存在本机 SQLCipher 数据库中，重启应用后仍然有效。
7. 用户可以一键恢复默认布局。
8. 配置损坏、版本未知或校验失败时，首页使用默认布局，不能白屏或阻止启动。
9. 组件中的按钮继续调用现有导航和业务入口，不产生一条新的执行旁路。
10. 上述能力通过验收后，本轮结束，不继续扩展为工作流设计器或插件平台。

这个终点验证的是：用户是否真的需要并持续使用“可配置业务工作台”。它不承诺用户已经能开发任意新功能。

## 3. 从 DeepSeek Harness 借鉴什么

DeepSeek Harness 把服务、事件、工具和 UI 作为可组合贡献，并支持通过 Slot 注册设置区域、侧栏、工具卡片等 UI。SES 只借鉴其中三个设计思想：

| Harness 思想 | SES 第一版映射 |
|---|---|
| 通过配置组合产品能力 | 一个声明式 `PersonalWorkbenchDefinition` |
| 通过命名 Slot/Key 渲染 UI | 首页内一个固定容器和 4 个编译期注册组件 |
| 组件只读取所需上下文 | 每个组件只接收自己的最小只读数据和既有回调 |

SES 不复制 Harness 的动态 Host/Client JavaScript、运行时工具注册和 Package 生命周期。Harness 自己也把可接触真实运行时的动态 Cordis 工具作为显式启用能力，而不是默认发布树的一部分。

因此，本方案没有 Cordis、插件进程、VM 沙箱、包管理器或运行时 React 注入。

## 4. 产品行为

### 4.1 默认状态

没有个人配置时，首页保持当前行为：

```text
首页顶部与数据安全入口（固定）
→ 匹配业务概览
→ 资源概览
→ 最近活动
→ 应用页脚（固定）
```

已有用户升级后不会因为本功能改变首页。

### 4.2 编辑状态

用户点击“编辑工作台”后打开一个简单对话框：

- 复选框控制组件显示或隐藏；
- “上移/下移”按钮调整顺序；
- “保存”提交配置；
- “恢复默认”恢复默认组件及顺序；
- “取消”不保存本次编辑。

第一版不使用拖拽排序。上移/下移更容易实现键盘操作，也不需要引入拖拽依赖。

至少保留一个组件，避免产生没有内容的首页。顶部、数据安全入口、命令入口和页脚不属于可配置区域。

### 4.3 一个具体结果

审核负责人可以把首页调整为：

```text
待审核事项
→ 最近活动
→ 匹配业务概览
```

销售顾问可以保留默认顺序，也可以隐藏资源概览。两者仍使用相同的 SES 数据、权限、审核中心和业务执行入口，只是首页关注顺序不同。

## 5. 最小配置合同

第一版配置只包含版本和组件顺序：

```ts
type PersonalWorkbenchWidgetType =
  | 'matching-overview'
  | 'resource-overview'
  | 'pending-reviews'
  | 'recent-activity'

interface PersonalWorkbenchDefinitionV1 {
  version: 'personal-workbench-v1'
  widgets: PersonalWorkbenchWidgetType[]
}

interface PersonalWorkbenchSettings {
  definition: PersonalWorkbenchDefinitionV1
  configured: boolean
  revision: number | null
  updatedAt: string | null
  cloudEligible: false
}
```

输入校验固定为：

- `version` 必须等于 `personal-workbench-v1`；
- `widgets` 长度为 1～4；
- 组件值只能来自固定枚举；
- 同一组件不能重复；
- 拒绝额外字段；
- 序列化配置上限为 4 KB；
- 保存必须携带 `expectedRevision`，避免旧窗口覆盖新配置。

配置里不包含：

- React、HTML、CSS 或 JavaScript；
- Domain Tool 名称和输入；
- SQL、文件路径、URL 或网络权限；
- 候选人、案件、简历、消息正文等业务数据；
- 自定义事件、触发器和定时任务。

## 6. 持久化与 IPC

新增一个用途单一的本地表，而不把配置混入语言偏好：

```text
personal_workbench_settings
  singleton      INTEGER PRIMARY KEY CHECK (singleton = 1)
  definition_json TEXT NOT NULL
  revision        INTEGER NOT NULL
  created_at      TEXT NOT NULL
  updated_at      TEXT NOT NULL
```

实现要求：

- 通过一个增量 Schema migration 创建表和 `local_data_revision` 触发器；
- 继续使用现有 SQLCipher 数据库，不建立单独配置文件；
- 读写逻辑放入现有 `LocalSettingsStore`，不新增 Store 框架；
- Main 读取后使用严格 Schema 解析，再加入 `BootstrapPayload.personalWorkbench`；
- 新增一个 `personal-workbench:save` IPC；
- IPC Handler 继续执行 `assertTrustedSender()`、输入 Schema 校验和 Revision 校验；
- Preload 只暴露 `savePersonalWorkbench()`，不暴露文件、数据库或组件注册 API；
- 一致性快照会自动复制数据库表，但持久化验收需要明确核对该配置可随快照恢复。

默认配置由 Main 中的固定常量产生。Renderer 不自行构造另一个默认版本，避免 Main 与 UI 默认值漂移。

如果已存的 `definition_json` 无法解析，Main 返回默认 Definition，但保留该行的 Revision，使用户下一次保存可以覆盖损坏配置；读取时不静默改写数据库。

## 7. Renderer 设计

Renderer 只增加首页范围内的静态注册表：

```text
PersonalWorkbenchDefinition
→ PersonalWorkbench
→ personalWorkbenchWidgetRegistry
→ 现有或提取后的 React 组件
```

注册表只有 4 个编译期固定 Key。用户配置只能选择 Key，不能注册新的 Renderer。

每个组件的边界如下：

| 组件 | 数据来源 | 可执行行为 |
|---|---|---|
| 匹配业务概览 | `bootstrap.matchingHome` | 使用现有“打开匹配”和优先级调整回调 |
| 资源概览 | 当前候选人、案件、审核、活动计数 | 导航到现有人才池、案件库、审核中心、活动记录 |
| 待审核事项 | 已有 `reviewQueue` 按类型汇总的数量 | 打开现有审核中心，不展示详情、不在组件内审批 |
| 最近活动 | `bootstrap.tasks.slice(0, 5)` | 打开现有任务详情或活动记录 |

约束：

- 不把完整 `BootstrapPayload` 直接交给通用插件上下文；
- 每个组件只接收所需的 Projection 和已有回调；
- 工作台配置不能直接调用 `window.sesAgent`；
- 任何已有写操作继续走当前 IPC、策略、确认和 Action Runtime；
- `pending-reviews` 只做摘要和导航，不复制一套审核逻辑；
- 未知组件 Key 不尝试动态加载模块，整份配置回退到默认值。

## 8. 代码改动范围

预计只涉及以下范围：

- `packages/shared/src/contracts.ts`
  - 增加个人工作台合同、Bootstrap 字段、Desktop API 和 IPC Channel。
- `packages/shared/src/schemas.ts`
  - 增加严格配置与保存输入 Schema。
- `packages/persistence/src/schema/migrations.ts`、`schema/apply.ts`、`rows.ts`
  - 增加一个增量表和 Schema 升级。
- `packages/persistence/src/stores/local-settings-store.ts`、`packages/persistence/src/index.ts`
  - 读取、保存和 Revision 冲突处理。
- `apps/desktop/src/main/app-defaults.ts`、`ipc/bootstrap.ts`、`ipc/settings.ts`
  - 默认配置、Bootstrap 输出和受信 IPC 保存。
- `apps/desktop/src/preload/index.ts`
  - 暴露一个窄的保存方法。
- `apps/desktop/src/renderer/App.tsx`
  - 把当前首页业务区交给 `PersonalWorkbench`，保留顶部和 onboarding。
- 新增聚焦组件：
  - `PersonalWorkbench.tsx`；
  - `PersonalWorkbenchEditorDialog.tsx`；
  - 必要时从 `App.tsx` 提取 `ResourceOverview` 和 `PendingReviewSummary`。
- 对应的 Schema、持久化、IPC 和 Renderer 测试。
- Schema 版本变化要求的当前状态标记只做机械更新，不借此改写其他方案文档。

本轮不修改 `packages/action-runtime`、Domain Tool 清单、Proposal、Cloud AI、Google Workspace 或 AICommerce。

## 9. 实施顺序

本功能作为一个纵向改造完成，可拆成两个提交，但不拆成两个长期并行系统：

1. 配置合同、Schema migration、SQLCipher 持久化、Bootstrap 和保存 IPC。
2. 首页组件提取、静态注册表、编辑对话框和 Renderer 验收。

实施前先固定目标源码身份，并避开当前工作区中已有的未提交修改。本文只定义方案，不授权覆盖、提交、打包或发布现有工作区改动。

## 10. 测试与验收

### 10.1 聚焦测试

1. 配置 Schema 接受 1～4 个唯一白名单组件，拒绝未知、重复、空数组、额外字段和超限输入。
2. 首次读取返回默认布局，且不产生数据库写入。
3. 保存后 Revision 增加，旧 Revision 保存被拒绝。
4. 重启 Repository 后配置仍存在；一致性快照中可以恢复。
5. Bootstrap 返回有效配置；数据库中的无效 JSON 不能导致启动白屏，而是使用默认值，并可在下一次保存时被覆盖。
6. Renderer 按配置顺序渲染，隐藏组件不出现，“恢复默认”恢复当前默认顺序。
7. 四个组件的按钮仍进入现有页面；工作台没有新增直接业务写入口。
8. onboarding 状态保持当前三步流程，不出现编辑入口。

### 10.2 验证范围

- 相关 Schema、持久化、IPC 和 Renderer 测试；
- `npm run typecheck`；
- `npm run test:persistence`；
- `npm run test:schema-upgrade`；
- `npm test`；
- 1440、1280、1100 px 下无横向溢出，键盘可以完成编辑、排序、保存和取消。

本轮不要求真实 Cloud 调用、生产 canary、签名、公证或安装包发布。这些证据不能用来阻塞本功能的代码完成，也不能由本地测试推断为已完成。

## 11. 明确不做

本轮不做：

- 任意 JavaScript、React、HTML 或 CSS 插件；
- Host Plugin、Client Plugin、Cordis 或其他插件 Runtime；
- 动态 Domain Tool 注册；
- 用户自定义查询、字段表达式、条件规则或业务脚本；
- 工作流编排、触发器、定时任务或 Agent 自动生成工作台；
- 多页面 Slot 系统；
- 组织模板、管理员发布、插件签名和权限授权；
- 插件包导入导出、商店、市场、收费和第三方 SDK；
- 拖拽式栅格、自由尺寸和响应式布局设计器；
- 多个工作台、工作台分享或跨设备同步；
- 新的数据源、新业务写操作或新的外部发送能力；
- 为未来插件系统预建抽象层、兼容层或迁移框架。

如果后续真实用户要求“把多个业务动作组成流程”，应作为独立需求重新设计，不能在本轮实施中顺手加入。

## 12. 风险与最小控制

| 风险 | 本轮控制 |
|---|---|
| 用户隐藏重要业务入口 | 数据安全和侧栏导航固定保留；至少显示一个组件 |
| 配置损坏导致首页不可用 | Main 严格解析，失败后使用默认布局 |
| 动态 UI 形成权限旁路 | 配置只选 Renderer Key；行为由 App 注入现有回调 |
| 组件读取过多 PII | 不提供通用上下文，每个组件只拿所需 Projection |
| Locale 保存覆盖布局 | 使用独立表和独立 Revision |
| 功能不断扩张成平台 | 采用第 13 节的停止条件 |

## 13. 停止条件

以下条件全部满足后，本方案即完成：

- 4 个内置组件可显示、隐藏和排序；
- 保存、重启恢复、恢复默认和损坏回退可用；
- 默认首页及 onboarding 行为没有回归；
- 没有新增任意代码执行、数据权限或业务写入口；
- 第 10 节聚焦测试、类型检查和现有测试通过；
- 1100、1280、1440 px 及键盘操作验收通过。

完成后停止继续抽象。以下事项都不属于遗漏或阻塞项：第五个组件、组件参数、工作流、自然语言生成、组织模板、插件安装和市场。

只有在该版本投入实际使用后，同时出现以下证据，才另行讨论下一阶段：

1. 至少三个真实角色持续使用不同布局；
2. 仅显示、隐藏和排序已无法满足同一类重复需求；
3. 新需求可以继续复用现有 Domain Tools 和权限边界。

即使满足，也只产生一份新的独立方案，不回头扩大本文。

## 14. 外部参考

- [DeepSeek Harness 架构（固定提交）](https://github.com/deepseek-ai/deepseek-harness/blob/141eb6fef83422698aef7a981029e843e8161534/docs/architecture.md)
- [DeepSeek Harness 动态 Cordis 插件开发说明（固定提交）](https://github.com/deepseek-ai/deepseek-harness/blob/141eb6fef83422698aef7a981029e843e8161534/apps/cli/config/agent-presets/cordis/skills/cordis-plugin-development/SKILL.md)
- [DeepSeek Harness 工具目录与动态运行时边界（固定提交）](https://github.com/deepseek-ai/deepseek-harness/blob/141eb6fef83422698aef7a981029e843e8161534/docs/tool-catalog.md)

外部参考只用于提炼“配置组合、命名 UI 插槽和最小上下文”原则。SES 的实施范围、数据边界和完成口径以本文及当前源码为准。

## 15. 修订记录

| 版本 | 日期 | 变更 |
|---|---|---|
| v0.1 | 2026-08-21 | 首版：把动态 UI 收敛为一个个人首页、4 个白名单组件和一个本地声明式配置 |
