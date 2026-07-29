# Task 3: 窗口模型、monitor WebView 与侧栏（含模板裁剪）

对应 Phase 3。需求引用：§10.1（窗口模型）、§10.2（侧栏内容）、§10.4（启动行为）、§9.3（monitor 嵌入）、§7（LAN IP 加载）。

## 目标

无边框单 WebView 窗口：Welcome（侧栏常开）→ 加载 → 全屏 monitor + hover 浮出侧栏；错误时显示 Error Page。

## 工作内容

- 窗口：`decorations: false`（macos conf 已具备），单一 WebView；侧栏覆盖式浮出（hover 左边缘），不改变 monitor 布局；侧栏提供窗口拖动、最小化、退出；保留 macOS 菜单栏与 `⌘W`/`⌘Q`/`⌘M`
- **顶部中央标题区**（2026-07-29 新增，§10.1/§9.3）：工程运行中显示「PNDS - \<工程名\>」，整体为窗口 drag region（`data-tauri-drag-region`），覆盖于 monitor 之上、不改变其布局；只含标题文字，无其他控件；Welcome 状态拖动仍由常开侧栏提供
- monitor 以 iframe 嵌入 React 壳（§9.3 工程允许被嵌）；用所选 Host LAN IP 加载（§7）；**放宽 `tauri.conf.json` CSP**：`frame-src` / `connect-src` 允许局域网 HTTP
- Welcome：侧栏常开 + Recent Projects 列表（完整 §4.1 行为在 task-6）；启动不自动运行工程
- Error Page：简明摘要 + Retry + Back/Close；可展开复制的技术详情（工程路径、音频模式、LAN IP、OSC target、输出设备、失败阶段、Node/scsynth stderr 末尾、health payload）
- 视觉：以 Figma [PNDS UI Design](https://www.figma.com/design/gxqwfZbIrsMfXTgrZyabv1/PNDS-UI-Design?node-id=37-46) 为参考（Figma MCP 已配置）；§10.1 列出的旧稿元素不得原样实现；英文 UI

## 模板裁剪（2026-07-29 确认）

- 拆除：quick pane（`Cmd+Shift+.` 浮窗）、命令面板（`Cmd+K`）、模板双侧栏与自定义标题栏、偏好设置对话框、语言切换 UI（V1 仅英文，fr/ar locale 已删）
- 保留：偏好持久化层（Rust 侧，供设备/OSC target/recents 复用）、菜单系统、toast 通知、window-state、updater
- 拆除 crash recovery（PNDS 无未保存数据）

## 验收

- Welcome/加载/演出/Error 四态转换正确（§15-5）
- 演出中窗口只有 monitor；hover 左缘侧栏浮出/移开收起
- 运行中可通过顶部中央标题区拖动窗口；标题随工程名更新
- 强制错误（占用端口、删除 .scsyndef）显示正确 Error Page
