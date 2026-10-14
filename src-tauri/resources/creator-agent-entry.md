## Creation handoff / 创作交接

Before continuing creation, read docs/creator-handoff.md if present. Preserve existing tasks and agent status; record actual implementation and verification evidence when updating a task.
接续创作前读取 docs/creator-handoff.md（若存在）。保留既有任务与 agent 状态，更新任务时记录实际实现和验证证据。

Platform contracts: /Applications/PNDS.app/Contents/Resources/help/en/reference/README.md (Chinese: help/zh-CN/reference/README.md). Use the installed App's corpus first; fallback: https://github.com/xO-xN/PNDS-App/blob/main/docs/en/reference/README.md.
平台契约优先读取已安装 App 的 help/zh-CN/reference/README.md；未安装时回落到 https://github.com/xO-xN/PNDS-App/blob/main/docs/zh-CN/reference/README.md。

Phone interaction, QR or connection changes: read reference/manifest.md (needsHttps and supportsPerformerUrl) and reference/runtime-contract.md §15, then inspect the browser APIs actually used. Ordinary projects default to HTTP; declare needsHttps: true only for secure-context APIs. Consume the Host-selected URL and record the reason and verification in the handoff.
修改手机交互、QR 或连接时，先读 reference/manifest.md 的 needsHttps／supportsPerformerUrl 与 reference/runtime-contract.md §15，再检查实际使用的浏览器 API。普通工程默认 HTTP；仅安全上下文 API 声明 needsHttps: true。消费 Host 选择的网址，在交接中记录判断依据与验证结果。
