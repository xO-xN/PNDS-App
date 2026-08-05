# Task 6: Retry 修复与 V1.1.0 release validation

目标 release：PNDS App `1.1.0`。

规范引用：

- `PNDS_APP_REQUIREMENTS.md` §9、§12、§13
- `PNDS_RUNTIME_CONTRACT.md` §8、§11、§12
- `docs/developer/releases.md`

## 目标

修复 error 状态无法真正 Retry 的根因，完成 V1.1.0 全量回归、版本收尾和 macOS ARM64 release artifact 验证。

## 依赖与边界

- Release gate 前置：Task 1–5 全部完成。
- Retry 不先执行无意义 stop；Rust session manager 仍是运行状态真源。
- 不在本任务加入 `.pnds`、Creator Guide、字体或新 icon 功能。
- 用户提供的多声道《失语III》是额外真实工程验收材料，不替代 `examples/multichannel-tone-test`。

## 工作内容

### 1. Retry 根因修复

调整 `src/lib/session-flow.ts` 与相关按钮/错误页：

- `canStart()` 接受 `idle` 和 `error`；
- error 状态下侧栏主按钮仍显示 `Load`；
- Error Page 的 Retry 与侧栏 Load 调用同一 start flow；
- 不先调用 `stopProject()`；
- 同一次点击防重复提交；
- Rust 在对外进入 `error` 前完成失败 generation 的 Node/master/scsynth 清理并清空句柄；
- 若强杀未确认，registry 保留归属记录，start 在端口 preflight 前执行该 generation 的定向 orphan cleanup；
- Rust start 增加 generation、清空旧 error/health/output run state，并立即发出新的 `starting` snapshot；
- 旧 supervisor/output reader 不能覆盖新 generation；
- 新 loading session 从第一阶段开始并使用新的随机颜色；
- 同步处理同步 command error 和异步 supervisor error。

### 2. 回归测试

自动测试至少覆盖：

- `idle -> starting -> ready`；
- `error -> starting -> ready`；
- retry 再次失败并显示新错误；
- 双击 Retry 只启动一次；
- Retry 不调用公开 stop flow，但失败 generation 的定向清理会执行；
- health timeout、非法 health、明确 health error、Node/scsynth 提前退出都在 `error` snapshot 前完成资源清理；
- 清理未确认时 Retry 先完成定向 orphan cleanup，再检查端口并启动；
- Error Page 与侧栏 Load 语义一致；
- Back/Close 回 Welcome，不自动启动；
- stale generation 事件不污染新 session；
- retry loading 第一、等待、第二阶段动画时序不跳帧。

### 3. V1.1 功能矩阵

完成自动与真实环境验证：

- Node sidecar `24.18.1`；
- 零依赖工程 preflight；
- 《Inarticulate III》Internal/External/None；
- `examples/multichannel-tone-test` 16ch → BlackHole/DAW；
- 16ch → 2ch 仍 ready，UI 显示 `16ch → 2ch`；
- mode/device/External target restart 保留选中工程和 pending setting；
- 全屏 resize 不 reload iframe、不 reconnect Socket.IO；
- red close、Dock reopen、`⌘Q` cleanup；
- 强制端口、SynthDef、设备能力和 health 错误后的 Retry；
- 退出后无残留 Node/scsynth，session log 轮转正常。

### 4. 文档与版本收尾

- 清理源码中指向旧单文档/旧章节的注释；
- 核对三份 evergreen spec 与实现一致；
- README 只在功能实际完成后更新用户可见的 V1.1 能力描述；
- 使用 release 工具将所有版本源同步到 `1.1.0`；
- 更新 release notes，明确 Node 24、多声道离散输出、设备降级 UI、全屏/窗口动画和 Retry；
- 不把 V1.2 `.pnds` 能力写成已实现。

### 5. Release artifact

- 运行 `npm run check:all`；
- 构建 ad-hoc signed macOS Apple Silicon `.app`、`.dmg` 与 updater artifact；
- 核对随包 Node/scsynth/plugins/SynthDef、许可文件和架构；
- 在干净 Apple Silicon Mac 上安装、Open Anyway、启动、更新和完整退出；
- 检查 Dock 中只有一个 PNDS 图标；
- 检查 updater minisign 和 `latest.json`；
- 只有用户明确要求时才创建 tag/commit/publish GitHub Release。

## Definition of Done

- 三份 evergreen spec 的所有当前要求都有实现或明确的人工验证记录。
- 六个 V1.1 task 全部可用 `npm run task:complete -- <number>` 归档。
- `npm run check:all` 通过，release build 成功。
- 干净机安装与 updater 验证通过。
- 真实工程和 tone-test 示例的现场矩阵通过。
- V1.1.0 无已知 blocker，且未混入 V1.2 Project Bundle 范围。

---

## 完成记录（2026-08-05）

### 1. Retry 根因修复（已实现 + 已测试）

- 前端：`canStart()` 接受 `idle`/`error`；error 状态下侧栏主按钮仍为 `Load`；Error Page Retry 与侧栏 Load 调用同一 `start()`；不先调用 `stopProject()`；`start()`/`restart()` 增加模块级 in-flight latch，同一次点击只启动一次；session store 增加 `runId`，每次进入 `starting` 递增，`AppShell` 以 `key={runId}` 挂载 LoadingScreen，Retry 的动画从第一阶段重新播放并重新随机取色。
- Rust：`SessionManager::start` 开新 generation 并立即发 `starting` snapshot（stage 1），清空旧 error/health/output；`kill_escalate` 改为返回是否确认收割（SIGTERM→SIGKILL→wait 确认）；`teardown_children` 仅在确认杀死后清除 registry 记录；`cleanup_orphans` 改为定向（pid+marker）清理，SIGKILL 后仍存活的保留记录供下次 start 的 preflight 前重试；所有失败路径（同步 start 失败、health 超时、health `error`、master stage 失败、Node 启动/运行期提前退出）统一走 `fail_generation`：先清理资源再发 `error` snapshot，旧 generation 的迟到失败不覆盖新 session；输出 reader 带 generation 守卫。
- 回归测试：`src/lib/session-flow.test.ts`（idle→starting→ready、error→starting→ready、重试失败显示新错误、双击只启动一次、Retry 不调公开 stop、runId 隔离、stale 事件不污染、restart 仍先 stop）、`src/components/shell/ErrorScreen.test.tsx`（Retry 与侧栏 Load 语义一致、Back 回 Welcome 不自动启动）、`AppShell.test.tsx`（error→starting 重挂载 loading canvas）、Rust `session.rs`/`children.rs` 新增 6 个测试（generation 契约、定向 cleanup、stale generation 不覆盖、失败先清理再发 error）。

### 2. 质量门禁与构建（已验证）

- `npm run check:all` 通过（typecheck / eslint / ast-grep / prettier / clippy / 85 前端测试 / 63 Rust 测试）。
- `npm run tauri build -- --bundles app,dmg` 成功（ad-hoc 签名、未公证，与 V1 策略一致）：
  - `bundle/macos/PNDS.app`（Info.plist 版本 `1.1.0`；pnds-app/node/scsynth 均 arm64；含 26 个 `.scx` plugins、`synthdefs/pndsMaster.scsyndef`、`licenses/` 下 NODE-LICENSE/SC-GPL-3.0/SC-SOURCE 随包）；
  - `bundle/dmg/PNDS_1.1.0_aarch64.dmg`；
  - `bundle/macos/PNDS.app.tar.gz` + `.sig`（updater artifact）。
- 签名验证：`codesign --verify --deep --strict` 通过（adhoc）；updater 签名用与 `tauri-plugin-updater` 完全相同的 `minisign-verify` crate 验证通过（prehashed blake2b，keyid 与 pubkey 一致，tauri.conf.json 内 pubkey 与 `~/.tauri/pnds-updater.key.pub` 逐字节一致）。
- 本机冒烟：`open` 启动 PNDS.app 正常，`quit` 后无残留 pnds-app 进程；构建目录无残留 node/scsynth。

### 3. 版本与文档（已完成）

- 版本源全部同步 `1.1.0`：`package.json`、`package-lock.json`（两处）、`src-tauri/Cargo.toml`、`src-tauri/Cargo.lock`、`src-tauri/tauri.conf.json`。
- 三份 evergreen spec（`PNDS_APP_REQUIREMENTS.md` §9.3/§12/§13、`PNDS_RUNTIME_CONTRACT.md` §8/§11/§12）与实现核对一致；清理 `src/i18n/config.ts` 指向旧章节的注释。
- README/README.zh-CN 的 V1 Scope 更新为已完成的 V1.1 能力（多声道 1–64 路、Node 24、自动更新），`.pnds` 明确保留在后续目标。
- `.github/workflows/release.yml` release notes 增加 V1.1 功能清单（Node 24、多声道离散输出、设备降级 UI、全屏/窗口动画、Retry）。
- 许可合规：`NODE-LICENSE.txt`/`SC-GPL-3.0.txt`/`SC-SOURCE.txt` 加入 `tauri.conf.json` bundle resources（随包 `licenses/`）。

### 4. 仍需要真实环境的人工验证（无法在本机构自动完成）

- 《Inarticulate III》Internal/External/None 现场矩阵；
- `examples/multichannel-tone-test` 16ch → BlackHole/DAW 实际发声与 `16ch → 2ch` 降级显示；
- 干净 Apple Silicon Mac 安装 → Open Anyway → 启动 → updater（需先发布 GitHub draft release）→ 完整退出；Dock 中仅一个 PNDS 图标；
- 全屏 resize 不 reload iframe/Socket.IO 不重连（代码路径已由 Task 5 的窗口动画测试覆盖，现场再复核）。
- 提交/打 tag/发布 GitHub Release 均未执行（按任务要求只在用户明确要求时执行）。
