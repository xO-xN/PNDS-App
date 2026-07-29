# Task 2: 内置 Node runtime 与 health 状态机

对应 Phase 2。需求引用：§3（运行架构）、§8.1/§8.2（启停顺序）、§9（工程运行契约）。

## 目标

App 用内置 Node.js 启动工程的乐谱服务器，按 health 契约判定就绪，并能优雅停止。

## 决策记录（2026-07-29 确认）

- 内置 **Node 22 LTS (arm64)**，以 Tauri sidecar 形式打包；工程无 `engines` 字段，与本机 v22.14.0 对齐
- 环境变量注入（§6.3、§7）：`PNDS_OSC_TARGET`、`PNDS_AUDIO_OUTPUT_BUS`、`PNDS_AUDIO_OUTPUT_CHANNELS`、`PNDS_HOST_IP`；`none` 模式不注入 OSC target
- `audio.status` 有第四个取值 `disabled`（none 模式，§9.1 已补充），health 状态机必须处理

## 工作内容

- Node sidecar 启动/停止封装（命令：`node <entry> --audio-mode <mode>`，cwd = `workingDirectory`）
- health 轮询（§9.1）：轮询 `http://127.0.0.1:<performerPort>/__pnds/health`，仅以 JSON `status === "ready"` 判定就绪；处理 `starting/ready/error/stopping` 与超时
- 停止（§8.2）：SIGTERM → 等待 graceful shutdown（工程已实现，见 Inarticulate III `PROJECT_HANDSOFF.md` §5）→ 超时强杀
- 捕获 Node stdout/stderr 写入 session 日志（基础版；完整 §11 在 task-6）

## 验收（含打包 spike #1）

- health 各状态与超时路径有测试覆盖（§13）
- 正常停止无残留进程；超时路径强杀成功
- **打包 spike**：产出 ad-hoc 签名 dmg，在干净环境启动后 sidecar `node` 能运行（提前暴露 sidecar/公证问题，不等 Phase 7）
