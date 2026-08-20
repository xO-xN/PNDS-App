# Task Management

## Overview

Task tracking lives in [GitHub issues](https://github.com/xO-xN/PNDS-App/issues):

- Work is grouped by milestone (e.g. `v1.2.0`); each milestone's scope is defined in its parent spec issue.
- Issues labeled `ready-for-agent` are ready to be picked up by an implementing agent.
- Child issues are created and closed as work completes; this file only keeps a release-history summary.

The former local task folders (`docs/tasks-todo/`, `docs/tasks-done/`) and the `task:complete` script were removed during v1.2.0 planning (2026-08-16); their content remains in git history.

## Release History

### V1.2.2 — UI 打磨：元素互相匹配（未发版）

Scope locked by spec issue [#27](https://github.com/xO-xN/PNDS-App/issues/27), implemented in child issues T1–T6（#28–#33）。版本节奏：v1.2.1（文件夹 switch 批次 #25/#26/#23）始终未单独发版，经确认与本轮打磨合并为 v1.2.2 一个版本号发布。

要点：文件夹 switch 融入侧栏（track 撑满 + 白 pill 滑动、右键菜单管理、tab 语义与 ←/→ 键切换）；工程列表打磨（导入尾置、运行 accent 竖条、静态边界淡出与键盘/鼠标同权的避让滚动、卡片级白 pill 选中滑动）；设置卡音频对（喇叭点击静音/恢复——仅会话内有效，音量滑杆重绘为细槽 + accent 填充 + 白旋钮）；⌘M 静音（与滑杆共用 volume-control 单一门控），⌘←/⌘→ 在发布前从 12.5% 音量步进改派为文件夹视图切换（两端钳制，与 ⌘↑/⌘↓ 统一为方向键网格，经段点击同一入口）；全局一致性清查（箭头指针、共享 accent 焦点环、按压反馈、prefers-reduced-motion）。Welcome 屏中央导入主按钮（#31）在发布前移除——首用引导交回提示文案。

对 v1.1.2 spec issues 的行为变更注记：

- [#4](https://github.com/xO-xN/PNDS-App/issues/4)：文件夹管理从行内按钮改为分段控件右键菜单（新建/重命名/删除）；侧栏头部的导入 "+" 移到工程列表末尾（另有 Welcome CTA 与 ⌘O）。
- [#7](https://github.com/xO-xN/PNDS-App/issues/7)：文件夹钻入视图（面包屑）由分段控件取代；文件夹视图内 ⌘ 序号仍只编该视图成员；新导入落点规则不变（统一在 `openProject`）。
- [#9](https://github.com/xO-xN/PNDS-App/issues/9)：拖拽入夹/移出落在分段 track 上（拖到文件夹段入夹、拖到未分组段返回）；面包屑移出随钻入视图退役；文件夹仍靠拖拽排序。
- [#11](https://github.com/xO-xN/PNDS-App/issues/11)：⌘↑/↓ 的钳制与自动钻入语义不变；选中的避让滚动升级为键盘与鼠标同权。

### V1.1.2 — 优化左侧栏的使用 (2026-08-16)

Scope was locked by spec issue [#4](https://github.com/xO-xN/PNDS-App/issues/4)（Cmd+数字选中与序号徽标、Cmd 唤出侧栏、Cmd+↑/↓、拖拽视觉重做、演出文件夹、自定义显示名）, implemented in child issues T1–T7（#5–#11）.

### V1.1.1 (2026-08-13)

Window shortcuts & monitor controls (zoom + reload + ⌘W close), 16px corner alignment, regenerated app icon, version bump. Highlights: View menu (⌘= / ⌘- / ⌘0 / ⌘⇧R) with browser-style monitor zoom — fixed to scale via compositing transform (CSS `zoom` can't scale the cross-origin OOPIF in WKWebView); custom ⌘W / red-light close flow with an app-styled confirm dialog (no native alert); 16px native window corners via the content-view backing layer; icons regenerated from the full-bleed 1024² master.

### V1.1.0 (2026-08-05)

task-1-node24-and-preflight, task-2-multichannel-runtime, task-3-device-capability-ui, task-4-multichannel-tone-test, task-5-fullscreen-and-window-animation, task-6-retry-and-release-validation. Task 6 was the release gate: Retry 根因修复完成，`check:all` 通过，release artifact（app/dmg/updater）构建并验证。真实现场矩阵（真实工程、BlackHole/DAW、干净机安装与 updater）与提交/发布由人工在真实环境执行。
