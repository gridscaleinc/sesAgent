# macOS 微信 B-03-1 实现与发布证据入口

B-03-1 已实现用户触发的“一次读取当前前台微信可见消息”，但实现完成不等于正式发布批准。没有完整目标机报告时，`npm run test:wechat-gate` 应返回 `implemented-release-no-go`；功能可在当前获授权的开发 Mac 上验收，正式签名安装包仍保持发布 No-Go。

## 已实现边界

- `wechat.visible.read` 只接受 `user-command` 与 `frontmost-wechat-visible-conversation` Scope，Replay Policy 为 `never`；
- Main 原生确认后签发 30 秒一次性 Scope Token，绑定 Actor 与 WebContents，消费后立即失效；
- Helper 固定校验微信 Bundle ID `com.tencent.xinWeChat`、腾讯 Team ID `5A4RE8SF68`、代码签名、PID、启动时间、前台应用、Focused Window 与 Frame；
- 先探测 AX Tree。目标微信 4.1.5 的真实探针只发现 5 个 AX 节点、0 个可读文本节点，因此采用窗口级 ScreenCaptureKit 捕获，并只裁剪右侧当前会话可见区域；
- 不捕获鼠标、音频、桌面、其他窗口，不使用 Apple Events、合成键鼠、滚动或历史展开；
- Apple Vision OCR、姓名候选、PII 脱敏和 DLP 全部在本机执行；Capture 图像和微信原文不落盘、不进入 Renderer、日志、Crash Report、恢复包或 Cloud；
- Helper 在 `sandbox-exec` 的 `(deny network*)` 下运行，`--network-probe` 必须证明 Loopback 与外网连接都以 `EPERM/EACCES` 被内核拒绝；
- 只把脱敏后的 `wechat-visible` JobCaseSource、Review Draft 和非敏感 ActionRun 证据写入 SQLCipher Schema v37。

## 正式发布仍需

复制 `wechat-feasibility-report.example.json`，在最终签名、Hardened Runtime、公证候选安装包和目标微信版本上填写真实结果。安全、产品、公司 IT 和法务均为 `go`，并通过独立 Loopback/外网探针后，才可设置：

```bash
SES_WECHAT_FEASIBILITY_EVIDENCE=/absolute/path/to/report.json npm run test:wechat-gate
```

正式 `npm run release:mac` 会额外设置 `SES_WECHAT_RELEASE_REQUIRED=1`；没有同一环境中的完整 `SES_WECHAT_FEASIBILITY_EVIDENCE` 时发布命令失败关闭。开发目录包与普通本机测试不伪造这份批准。

模板中的 `false` 和 `no-go` 是有意的失败关闭值，不得为了让脚本通过而伪造。
