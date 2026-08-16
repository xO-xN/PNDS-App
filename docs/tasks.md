# Task Management

## Overview

Task tracking lives in [GitHub issues](https://github.com/xO-xN/PNDS-App/issues):

- Work is grouped by milestone (e.g. `v1.2.0`); each milestone's scope is defined in its parent spec issue.
- Issues labeled `ready-for-agent` are ready to be picked up by an implementing agent.
- Child issues are created and closed as work completes; this file only keeps a release-history summary.

The former local task folders (`docs/tasks-todo/`, `docs/tasks-done/`) and the `task:complete` script were removed during v1.2.0 planning (2026-08-16); their content remains in git history.

## Release History

### V1.1.2 — 优化左侧栏的使用 (2026-08-16)

Scope was locked by spec issue [#4](https://github.com/xO-xN/PNDS-App/issues/4)（Cmd+数字选中与序号徽标、Cmd 唤出侧栏、Cmd+↑/↓、拖拽视觉重做、演出文件夹、自定义显示名）, implemented in child issues T1–T7（#5–#11）.

### V1.1.1 (2026-08-13)

Window shortcuts & monitor controls (zoom + reload + ⌘W close), 16px corner alignment, regenerated app icon, version bump. Highlights: View menu (⌘= / ⌘- / ⌘0 / ⌘⇧R) with browser-style monitor zoom — fixed to scale via compositing transform (CSS `zoom` can't scale the cross-origin OOPIF in WKWebView); custom ⌘W / red-light close flow with an app-styled confirm dialog (no native alert); 16px native window corners via the content-view backing layer; icons regenerated from the full-bleed 1024² master.

### V1.1.0 (2026-08-05)

task-1-node24-and-preflight, task-2-multichannel-runtime, task-3-device-capability-ui, task-4-multichannel-tone-test, task-5-fullscreen-and-window-animation, task-6-retry-and-release-validation. Task 6 was the release gate: Retry 根因修复完成，`check:all` 通过，release artifact（app/dmg/updater）构建并验证。真实现场矩阵（真实工程、BlackHole/DAW、干净机安装与 updater）与提交/发布由人工在真实环境执行。
