# Task Management

## Overview

Task tracking lives in [GitHub issues](https://github.com/xO-xN/PNDS-App/issues):

- Work is grouped by milestone (e.g. `v1.2.0`); each milestone's scope is defined in its parent spec issue.
- Issues labeled `ready-for-agent` are ready to be picked up by an implementing agent.
- Child issues are created and closed as work completes; this file only keeps a release-history summary.

The former local task folders (`docs/tasks-todo/`, `docs/tasks-done/`) and the `task:complete` script were removed during v1.2.0 planning (2026-08-16); their content remains in git history.

## Release History

### V1.2.3 — 选择与运行解耦 + 界面主题（未发版）

Scope locked by spec issues [#35](https://github.com/xO-xN/PNDS-App/issues/35)（工程卡选择与运行解耦，T1/T3/T6 = #37/#39/#42）与 [#36](https://github.com/xO-xN/PNDS-App/issues/36)（界面主题系统，T2/T4/T5 = #38/#40/#41），收尾 #43。

要点（Spec A 选择解耦）：Rust preflight 与运行 session 解耦（孤儿清理豁免活跃 session 子进程并保留归属记录、端口检查按占用 PID 归因放行自家占用、第三方占用仍报冲突）；五条选卡路径（点卡/⌘1..9/⌘O/拖放/双击 .pnds）统一为"选中 + preflight"，不再弹切换确认、不重置 session、监视页不回退欢迎页；requestSwitch/pendingSwitchPath 机制删除；运行竖线与文件夹"使用中"点跟随 session 所属工程（与选中无关），白色选中 pill 独立跟随（失败选择保持 pill，卡上显示校验中/错误态）；底部设置卡跟随选中卡（选中运行卡 = Close/Change + 实时音量；选中其他卡 = 该卡启动配置 + Load），live session 下 Load/Enter 经"将先关闭正在运行的工程"确认后停旧自动启新，error 态直接启动；⌘W 停 A 时 B 保持选中且可直接 Load；⌘↑/↓ 只在当前视图内移动（不再自动钻回所选工程所在文件夹）；监视页标题与 iframe/Share 目标锁定运行 session（不受选中影响）；旧 v1.2.3 §8.3 切换确认的时机移至启动动作（验收文档 §4 已同步）。

要点（Spec B 主题系统）：Appearance 设置区（设置面板）+ 主题基建（`data-color-theme` 根属性、偏好持久化与未知值回退 Lavender）；四套实色主题——Lavender（浅，默认）、Sand（中等深度）、Stage（深）、Brutal（Neo-brutalism：方形窗口角与角落遮罩、Archivo 字体、奶白实色侧栏无阴影、黑色平面上的浮起选中、方角 ✕、琥珀 accent；前 Midnight 重命名迁移）。macOS 26 液态玻璃（Glass）在 #41 中实验后放弃（透明管线在目标系统不稳定），未随本版发布；持久化枚举保留 `glass`/`midnight` 值以兼容回退。工程主题跟随（#44，可选契约）：App 经跨域 postMessage 主题桥在 iframe 加载/主题切换/窗口重获焦点时把当前主题（名 + 语义 token 调色板，运行时读自 theme-variables.css 单一真源）推给 monitor 页，工程可选监听消费（契约见 score project spec §5.3）；utilities 两工具均已交付——Local Network Diagnostics（#45，v0.2.0：monitor 页消费 pnds:theme、状态色按明暗推导保证四主题 ≥4.5:1、?theme= 前瞻支持，performer 页不参与）与 Multichannel Signal Generator（#46，v1.1.0：以 `lib/theme-follow.js` 参考实现落地——UMD 模块经 monitor 端口 `GET /__pnds/theme-follow.js` 提供、零配置接线，含 `onTheme`/`derive`/自定义映射等创作者扩展口子，performer 端口保持 health-only）。附带修复：webview 全帧抑制默认右键菜单、音量滑杆 I-beam 光标、⌘-peek 侧栏在指针下不再收回。

### V1.2.2 — UI 打磨：元素互相匹配（2026-08-20 发布）

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
