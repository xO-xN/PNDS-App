# Task 7: 打包、发布与现场验收

对应 Phase 7。需求引用：§13（测试要求·集成验证）、§15（Definition of Done）。

## 目标

产出可分发、可自动更新的 macOS Apple Silicon 安装包，并用 Inarticulate III 完成真实演出链路验收。

## 决策记录（2026-07-29 确认）

- 无付费 Apple Developer 账号：**ad-hoc 签名、不公证**；用户首次打开走 Gatekeeper「Open Anyway」（右键 → 打开，或 系统设置 → 隐私与安全性）；release notes 已写入该说明
- Tauri updater 的签名是独立的 minisign 密钥对，不依赖 Apple 账号，自动更新可用
- GitHub 仓库：`xO-xN/PNDS-App`（public）

## 工作内容

- 生成 updater 密钥对，配置 GitHub Secrets（`TAURI_PRIVATE_KEY`、`TAURI_SIGNING_PRIVATE_KEY_PASSWORD`），把 pubkey 填入 `tauri.conf.json`（见 `docs/developer/releases.md`）
- ~~替换应用图标~~（已完成 2026-07-29：源文件 `assets/pnds-icon.png`，全套尺寸已生成）
- release workflow（已裁为 macOS-only）完整跑通一次：tag → dmg + app + updater json → draft release
- 干净机器验证：从 dmg 安装、走 Open Anyway、完整运行一次演出
- 现场验收（§13 集成验证 + §15 DoD 逐项）：
  - Inarticulate III Internal 模式端到端发声
  - 手机扫码经 LAN 加入并触发声音（依赖 task-x-project-reconnect-autoid 先完成，否则断连后无法恢复）
  - 音频模式与输出设备切换后正常
  - 强制错误（占用端口、删除 .scsyndef、错误 OSC target）→ 正确 Error Page
  - 退出后无残留 `node`/`scsynth`

## 验收

- §15 Definition of Done 九条逐项通过
