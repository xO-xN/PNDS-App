# Task 5: macOS 全屏 title bar 与整窗淡入淡出

目标 release：PNDS App `1.1.0`。

规范引用：

- `PNDS_SCORE_PROJECT_SPECIFICATION.md` §5.2
- `PNDS_RUNTIME_CONTRACT.md` §10
- `PNDS_APP_REQUIREMENTS.md` §5、§7、§12

## 目标

实现统一的 macOS 全屏 action、顶部原生 title bar/traffic lights spike，以及原生整窗 opacity 淡入淡出，同时保持 monitor 文档实例和现场 session 不变。

## 依赖与边界

- 可与 Task 2–4 的主体开发并行，但必须在 Task 6 release validation 前完成。
- 不通过 reload iframe 或 restart Node 修复 resize。
- 《Inarticulate III》已有 `windowResized()` 适配并经手测；App 只负责正常触发 viewport resize。
- 不修改侧栏字体或 App icon。

## 工作内容

### 1. 集中式全屏 action

建立唯一 fullscreen toggle action，供以下入口复用：

- macOS Window 菜单；
- `⌃⌘F`；
- 侧栏按钮。

Rust/Tauri 事件与 React command system 保持单向、可测试，三个入口不得各自实现状态切换。

### 2. 原生 title bar spike

在 macOS release-like build 验证首选方案：

- 窗口模式维持当前 PNDS 壳层；
- 进入全屏时启用可靠的 native decorations/title bar；
- 鼠标靠近顶部时由 macOS 显示 unified title bar 和原生 traffic lights；
- 全屏时侧栏自绘 traffic lights 隐藏；
- 顶部热区优先于左侧 sidebar hover，二者不同时出现；
- 退出全屏恢复原窗口装饰状态；
- 连续快速切换不能遗留错误 styleMask、透明背景、阴影或不可拖动状态。

优先使用 Tauri v2 稳定 API；若必须使用 `macOSPrivateApi`/AppKit，封装在 macOS 专用 Rust 模块并记录安全边界。

### 3. 明确 fallback

若动态 native decorations 在支持的 macOS 环境出现不可接受的 WKWebView 抖动、黑边、styleMask 或透明度问题：

- 保持无装饰窗口；
- 顶部 hover 显示自绘 title bar/traffic lights；
- 仍满足顶部与侧栏互斥及三个统一入口；
- 在任务完成记录中写明 spike 证据和采用 fallback 的原因。

不得保留两套用户可配置模式。

### 4. Monitor resize 不 reload

- 全屏切换只改变窗口尺寸和装饰；
- 不调用 `bumpMonitorReload()`；
- 不更改 iframe key/src；
- 不 restart score server；
- 验证 monitor 收到 resize 且 Socket.IO 不 reconnect。

手动 Refresh 继续作为显式恢复操作。

### 5. macOS 原生整窗 opacity

实现可中断、可恢复的窗口动画状态机：

- 首次显示：150–180ms 从透明淡入；
- Dock reopen：show/restore 后 150–180ms 淡入；
- 红灯/Close Window：150–180ms 淡出后 hide；
- `⌘Q` 不等待动画，立即进入现有 child cleanup 和退出；
- reopen、close、fullscreen 快速交错时取消旧动画并恢复确定的最终 opacity；
- 任何错误路径不得留下 opacity 0 但可交互的窗口。

动画作用于 NSWindow/整窗，不只给 React 内容添加 CSS。

## 自动测试

至少覆盖：

- 菜单、快捷键、侧栏按钮调用同一 fullscreen action；
- 全屏状态同步与自绘 traffic lights 可见性；
- 顶部/左侧 hover 互斥；
- fullscreen 不改变 monitor reload generation；
- fade 状态机的 show、hide、reopen、取消与重复事件；
- `⌘Q` 绕过等待并仍执行 session cleanup；
- 动画失败/取消后 opacity 恢复到 1。

## 手动验收

在 development 与 release-like macOS build 中验证：

- 菜单、`⌃⌘F`、侧栏按钮；
- 顶部原生 title bar 行为或有证据的 fallback；
- 左侧栏与顶部 title bar 不同时显示；
- 《Inarticulate III》进入/退出全屏后画面正确，无 iframe reload、Node restart 或 Socket.IO reconnect；
- 红灯淡出/hide、Dock 淡入/reopen、快速反复操作、`⌘Q` 清理；
- `npm run check:all` 通过。
