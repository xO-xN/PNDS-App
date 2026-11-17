# #240 / #247：本机 SuperCollider 打开 SCD 保存版

2026-10-20。父规格 [#240](https://github.com/xO-xN/PNDS-App/issues/240)，执行票 [#247](https://github.com/xO-xN/PNDS-App/issues/247)。真实 GUI 与发行环境结果汇入 [#172](./172-v1.7.0-creation-workflows.md)，以下自动化不代表实机通过。

## 已实现范围

- 可编辑工程的 SCD 文件动作“在 SuperCollider 中打开保存版”，中英文文案、键盘激活、菜单焦点恢复；保存版提示、进行中／成功／失败反馈和手动重试。
- App 未保存草稿不保存、复制或同步；系统错误不改变草稿或已有演出，切换文件／工程后的迟到结果不污染新编辑器。保存文件消失后仍可保留草稿并重新核验重试。
- 类型安全命令只传受信工程身份与相对目标；原生在派发前核验当前根目录身份、可编辑来源、路径包含关系、普通保存文件及请求／真实目标的 SCD 类型。固定 GUI 标识 `net.sourceforge.supercollider` 通过 macOS Launch Services 定位，收到系统完成回执后才报告打开成功。
- 原生不接收任意应用、外部绝对路径、草稿文本、求值指令或音频环境。不运行编译、代码求值、演出启停、声音服务器连接或安装。
- 外部保存复用现有磁盘变化和冲突流程：干净文本采用磁盘新内容，脏草稿保留双方并提示选择；待编译／重启提示不自动执行。

## 自动化证据

- `CreationSupercolliderWorkflow.test.tsx`：完整 `CreationView` 文件选择、菜单动作与类型安全命令意图；中文及空格路径；草稿保留；缺失 GUI、系统失败、IPC 拒绝及重试；删除目标后重新核验；工程切换的迟到错误；中文键盘及焦点；外部保存的干净更新和双侧冲突。断言无保存、编译、演出启动／停止或 monitor 刷新。
- `project/creation/tests.rs` 的 `supercollider_*`：真实临时工程中的准确保存路径／字节，伪造及失效身份、工程替换、非 SCD、非普通／缺失文件、绝对路径、父目录越界、文件／目录符号链接逃逸、伪装 SCD 链接、保护来源，及失败后重新核验／文件改名／工程关闭。无效目标不能到达注入的系统派发边界。
- 定向业务回归：`npm run test:run -- src/components/creation/CreationSupercolliderWorkflow.test.tsx src/components/creation/CreationEditorWorkflow.test.tsx src/components/creation/CreationView.test.tsx src/store/creation-files-store.changes.test.ts`，4 个文件、45 项通过（本票工作流 12 项）。
- 原生边界：`cargo test supercollider_ -- --nocapture`，4 项通过；类型绑定由 `npm run rust:bindings` 生成。
- `npm run typecheck`、`npm run lint`、`npm run ast:lint`、`npm run format:check`、`npm run rust:fmt:check`、`npm run rust:clippy` 均通过。
- 最终集成门禁 `CARGO_BUILD_BUILD_DIR=/private/tmp/pnds-app-build npm run check:all` 退出码 0：typecheck、lint、ast-grep、Prettier、Rust fmt、clippy、前端及 Rust workspace 测试全部通过。前端 221 个测试文件、2319 项通过，1 个既有文件／测试跳过；Rust 主 crate 660 项通过、7 项既有 ignored，其余 workspace 测试全部通过。
- 首轮完整检查中的回环端口监听受沙箱 `EPERM` 限制，放开本机测试权限后通过。旧 DNS 重启测试缓存嵌入已删除的 #239 临时工作区路径，重建对应测试产物后两项通过；未修改 DNS 源码。最终完整门禁使用修复后的当前工程源码及测试产物。

这些测试不启动真实 SuperCollider，不能证明 GUI 已实际显示目标文件，也不覆盖安装应用／系统实际失败回执。

## 两轴审查后的键盘焦点修复

2026-10-20，Standards 轴无发现；Spec 轴发现一项 P2：键盘聚焦“重试”并按 Enter 后，进行中状态清除了错误及整个重试区域，导致焦点落到 `BODY`，再次失败也未恢复。

已在完整文件工作流以中英文各一条测试先复现，再修复：等待期间保留同一个重试按钮，使用 `aria-disabled` 表达暂不可用并由已有请求门禁阻止重复派发；再次失败保留按钮和焦点。成功移除重试按钮之前，仅当焦点仍在该按钮时明确交回稳定的文件动作按钮。用户已自行移走的焦点不被抢回，旧文件／旧工程请求仍经过原有归属检查，不能移动新编辑器焦点。

新增断言覆盖键盘触发、等待时控件与焦点保留、重复 Enter 不重复派发、再次失败后焦点、随后成功后的稳定焦点及草稿保留；原有菜单键盘焦点和迟到隔离回归同时通过。本票工作流现为 12 项通过，Spec 原审查者独立复核及单文件测试通过，无遗留发现。修复已集成到主工作区 `codex/issue-240`，完整 `check:all` 通过；保留 #238／#239 原有未提交改动，本轮未 commit／push。

## #172 实机待验

由用户启动 App 或开发服务器。每项记录 App 架构／安装产物、macOS、SuperCollider 版本、工程与路径，以及实际结果／截图或录屏。

| 项目                                                       | arm64 | x86_64 |
| ---------------------------------------------------------- | ----- | ------ |
| 中英文文件动作、最小窗口、四主题、键盘与返回 App 的焦点    | 待验  | 待验   |
| 真实 GUI 收到当前工程准确保存文件（中文及含空格名称）      | 待验  | 待验   |
| App 草稿与保存版内容不同，GUI 打开保存版且草稿保留         | 待验  | 待验   |
| SuperCollider 保存后，App 干净文本回读与脏草稿冲突双方保留 | 待验  | 待验   |
| GUI 缺失／系统打开失败后的明确反馈和恢复重试               | 待验  | 待验   |
| 打开期间文件／工程切换、删除目标后恢复，无迟到污染         | 待验  | 待验   |
| 已有演出不中断，不自动刷新、编译、求值或连接 App 音频      | 待验  | 待验   |

`sclang` 编译成功仅表示编译能力，不能勾选 GUI 接收或以上实机项目。#172 保持开放，等待对应环境的真实证据。
