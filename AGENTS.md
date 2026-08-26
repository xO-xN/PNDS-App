# AGENTS.md

PNDS App：演出现场运行 PNDS 数字乐谱工程的 macOS（Apple Silicon）桌面 Host。Tauri v2 + React + TypeScript。参考 score project 实现在父目录的 `PNDS Template`。

## 规则

- **只用 npm**（本仓库无 pnpm / yarn）。
- **完成标准：`npm run check:all` 全绿**（typecheck / lint / ast-grep / prettier / clippy / tests）——改动到此才算完成。
- 新业务逻辑随改动带测试。
- dev server 由用户启动并回报结果。
- 只在明确要求时 commit。
- 删除文件一律 `rm -f`。
- 框架资料用 Context7 优先，且只查 Tauri v2；Rust 用现代内插格式 `format!("{variable}")`。
- 新模式沉淀进 `docs/developer/` 对应篇。

## 按任务取读

先读相关文档再动手；`docs/zh-CN/reference/README.md` 是契约层的完整索引：

- 改 manifest / preflight / 工程结构 → `docs/zh-CN/reference/manifest.md`、`docs/zh-CN/reference/structure.md`
- 改进程 / health / 音频 bus / 关停 → `docs/zh-CN/reference/runtime-contract.md`
- 改 `.pnds` 打包 / 安装 → `docs/zh-CN/reference/pnds-bundle.md`
- App 产品行为与验收存疑（session / 窗口 / 侧栏 / 静音 / 全屏 / 错误重试 / 测试覆盖 / DoD）→ `docs/developer/app-behavior.md`
- 写 UI / 状态 / 命令桥 / 快捷键 / i18n → `docs/developer/README.md`（问题式索引）
- 领取与汇报任务 → GitHub issues（`docs/agents/issue-tracker.md`）；领域术语与 ADR 布局 → `docs/agents/domain.md`

## 架构速记

- **状态洋葱**：组件内 `useState`，跨组件 Zustand；持久化只走 `src/lib/preferences.ts`（序列化更新队列），project-store 结构性动作随 commit 一并持久化。
- Zustand 取值只用 selector 语法（`useUIStore(s => s.x)`）；组件解构 store 会被 ast-grep 拦截；回调里取当前值用 `getState()`。
- React Compiler 已启用，memoization 交给它。
- Rust → React：`app.emit` + `listen`；React → Rust：`@/lib/tauri-bindings` 的类型安全 `commands`（tauri-specta）。
- 文案全部进 `/locales/*.json`：组件用 `useTranslation`，非 React 上下文 `i18n.t`；布局用 CSS 逻辑属性（`text-start`）支持 RTL。
