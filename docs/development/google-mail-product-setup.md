# Google 邮箱：产品配置与 HR 使用

HR 只在设置的 Google 邮箱卡片点击“连接 Google 邮箱”，在 Google 页面登录自己的账号并授权读取邮件。连接后同步一次，应用运行期间继续定时收取案件和人员邮件，支持解析人员简历附件。HR 不填写 Client ID、密钥、回调地址或环境变量。

邮箱卡片分别展示本批邮件保存数、有效案件数、人员数、待入库数与失败提示。收取成功不等于全部资料入库成功；后台操作记录也会把收取失败和案件/人员入库失败记录为失败。后台空批次与失败同样刷新界面。

## 开发方一次性配置

使用产品自身的 Google Cloud 项目和 Desktop app OAuth 客户端。Web application 的 OAuth 文件不能直接用于本机动态端口回调。

### 本机单账号私用

源码运行支持单独的私用配置：`userData/security/google-private-client.v1.json`。文件包含 `version: google-private-client-v1`、`accountEmail`，以及 Google 下载 JSON 中的 `installed` 对象；桌面客户端使用动态本机回调。也支持显式配置 `web` 与 `redirectUri`：回调必须与该 Web 客户端已登记地址完全一致，且只能是固定非特权端口的 `http://localhost` 或 `http://127.0.0.1` 地址。两种模式均保留 PKCE、state 校验与精确 `gmail.readonly`，并在保存授权前验证实际邮箱等于配置邮箱。

私用文件位于应用数据目录，不参与构建；macOS/Linux 要求属于当前用户且权限为 `0600`，打包应用忽略该文件。现有 Desktop 产品配置与分发构建要求继续保留。Google 项目仍必须启用 Gmail API；私用不免除该服务要求。授权回调成功后还必须通过 Gmail Profile 验证，才会显示已连接。

本次私用目标是 `app_user01@gridscale.com`。当前使用该账号自己的 `My First Project`（`northern-cubist-507311-k9`），Gmail API 已启用；客户端为 `SES Agent Desktop - app_user01 Private`。Desktop 配置保存在本机应用数据目录中，实际授权、Gmail Profile、首次同步及重启后的同步已验证。旧客户端保持原状。

将 Google 下载的 Desktop app JSON 保存在仓库根目录 `.local/google-oauth-desktop.json`；该目录被 Git 忽略。也可以在 CI 设置 `SES_GOOGLE_OAUTH_CONFIG_FILE` 指向受保护文件，或继续使用 `SES_GOOGLE_OAUTH_CLIENT_ID`、`SES_GOOGLE_OAUTH_CLIENT_SECRET`。CI 显式指定的客户端不会混用本机另一客户端的密钥。

开发启动与构建自动读取产品配置，仅写入 Main 构建，不注入 Renderer。分发构建在缺少产品邮箱配置时失败，防止交付给 HR 一个没有连接入口的版本。不要把下载的 OAuth 文件或密钥提交到仓库。

## 授权范围

继续使用 `gmail.readonly`、PKCE 和本机回调，邮箱登录凭据保存在本机安全存储中。应用不申请 Gmail 发信、修改或删除权限。

Google 项目受众与发布状态决定哪些账号可以登录。内部项目只对所在组织开放；外部测试项目只对测试账号开放。产品面向其他公司的 HR 发布前，需要在 Google 完成适用的外部发布与权限验证。不能仅凭客户端创建成功就声称任意邮箱均可使用。

## 本次联调

从另一邮箱发送带唯一编号的测试案件，核对案件列表新增记录以及技能、单价、地点、开始时间、自社要求和原邮件来源。之后再测试人员邮件及简历附件。应用启动约 5 秒后自动检查，运行期间默认每 1 分钟轮询（每次完成后计时）；`SES_GMAIL_SYNC_INTERVAL_MINUTES` 可配置为 1–60 分钟，设置页显示实际配置的周期。失败会退避重试。手动“立即同步”使用同一条同步与入库路径。后台完成事件包含邮件和人员计数，接收失败或空批次也更新同步时间与结果。

## 分批同步与恢复

默认仍是收件箱、最近 30 天、配置的业务关键词；200 封是每批处理上限。初次同步使用固定时间窗口和 Google 分页位置分批收取，进度保存在加密检查点中；成功的一批若还有邮件或资料待处理，应用运行时约 5 秒后继续下一批。手动同步、连接后首批与自动轮询共用同一执行锁。出错按常规间隔退避，不跳过失败页；退出应用保留进度，重新启动后由轮询继续。

历史增量过多或过期时，在相同业务范围内分批重扫。分页位置失效时从该范围重新开始，依靠消息 ID 和现有业务去重避免重复入库。完整扫描后从扫描开始前的 historyId 补齐期间新来的邮件。分页位置不进入界面、通知和日志。

## 2026-09-11 验证边界

`node scripts/run-electron-tsx.mjs scripts/verify-gmail-intake.ts` 使用模拟 Gmail GET 响应、真实 Parser Worker、加密文件库和 SQLCipher，覆盖分批、每批重开数据库、案件、正文人员、Excel 简历、重复附件与重复案件，以及入库结果/检查点持久化。它不访问真实邮箱，不代替真实 Google 授权及新邮件收取验收。

本次按单账号私用完成绑定，实际邮箱为 `app_user01@gridscale.com`。首次真实同步识别到 5 封已保存邮件并跳过重复，收取与入库失败均为 0；未用新发送的真实邮件验证新增案件/人员。本地模拟邮件验证仍负责覆盖正文人员、简历附件及新增入库链路。
