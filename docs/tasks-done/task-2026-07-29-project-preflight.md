# Task 1: 工程选择与 manifest preflight

对应 Phase 1。需求引用：§4（工程与信任模型）、§5（manifest schema）、§7（端口冲突）、§8.2（残留进程清理）。

## 目标

用户能通过文件夹选择器打开本地 PNDS 工程；App 校验全部运行资产并在失败时给出可读错误。

## 工作内容

- 文件夹选择器（Tauri dialog 插件已有）选择工程目录
- 首次打开某路径：确认对话框（"该工程将执行本地 Node.js 代码"），确认后才继续；V1 先内存记录，持久化在 task-6
- manifest 解析与校验（§5）：
  - `schemaVersion === 1`，否则拒绝并提示 unsupported schema version
  - 必填字段、internal 条件必填（`synthdefs` 存在、`scsynth` 三参数齐全）
  - 相对路径校验：拒绝绝对路径、`../` 逃逸、指向工程外的 symlink（解析真实路径后必须仍在工程根内）
  - `node_modules/` 存在性检查，缺失时报 §4 规定的错误文案
- 端口冲突 preflight（§7）：`performerPort` / `monitorPort` 被占用 → 失败并显示具体端口与建议；不改端口、不改 manifest
- 启动前先执行残留清理（§8.2 新增）：检测上次会话留下的 PNDS `node`/`scsynth`（PID 记录 + 命令行匹配确认归属）并终止

## 验收

- §13 要求的 manifest 测试全部覆盖：合法样例、缺字段、错误 schemaVersion、路径逃逸、文件缺失
- 端口占用时 preflight 失败且错误可读
- 信任确认未通过时不启动任何进程
