# Task Management

## Overview

- **Uncompleted tasks** are in tasks-todo/
  - Named task-NUMBER-name.md where NUMBER indicates priority order
  - The lowest number is the current task
  - If NUMBER is x, the task has not been prioritized yet
- **Completed tasks** are in tasks-done/
  - Named task-YYYY-MM-DD-name.md with completion date

## Active V1.1.0 Plan

Scope is locked by the three evergreen specifications linked from [`README.md`](./README.md). The prioritized implementation tasks are:

_(none — all six V1.1 tasks are archived.)_

Completed: task-1-node24-and-preflight (2026-08-03), task-2-multichannel-runtime (2026-08-04), task-3-device-capability-ui (2026-08-04), task-4-multichannel-tone-test (2026-08-04), task-5-fullscreen-and-window-animation (2026-08-04), task-6-retry-and-release-validation (2026-08-05).

Task 6 was the release gate: Retry 根因修复完成，`check:all` 通过，V1.1.0 release artifact（app/dmg/updater）构建并验证，版本源已同步 `1.1.0`。剩余现场矩阵（真实工程、BlackHole/DAW、干净机安装与 updater）与提交/发布需人工在真实环境执行。

## Completed: V1.1.1 (2026-08-13)

All three V1.1.1 issues (#1 window shortcuts & monitor controls, #2 16px corner alignment, #3 icons & version bump) are implemented, manually run-through, and closed. Highlights: View menu (⌘= / ⌘- / ⌘0 / ⌘⇧R) with browser-style monitor zoom — fixed to scale via compositing transform (CSS `zoom` can't scale the cross-origin OOPIF in WKWebView); custom ⌘W / red-light close flow with an app-styled confirm dialog (no native alert); 16px native window corners via the content-view backing layer (NSWindow.cornerRadius is deprecated/absent on TaoWindow); icons regenerated from the full-bleed 1024² master; version 1.1.1 across npm / Cargo / Tauri config. Signing/notarization/updater release for 1.1.1 remains a human release step.

Project Bundle (`.pnds`), Creator Guide, installation/update metadata, checksum, target-platform checks, and runtime-asset installation are V1.2 scope and must not enter these tasks.

## Active V1.1.2 Plan — 优化左侧栏的使用

Scope is locked by spec issue [#4](https://github.com/xO-xN/PNDS-App/issues/4)（Cmd+数字选中与序号徽标、Cmd 唤出侧栏、Cmd+↑/↓、拖拽视觉重做、演出文件夹、自定义显示名）. Follow the spec's Implementation Decisions; the two existing test seams (store 单测 + Sidebar/AppShell 组件测试) apply as stated there.

## Completing Tasks

When you finish a task, use the completion script.

Usage: npm run task:complete -- TASK_NAME_OR_NUMBER

Examples:
npm run task:complete -- frontend-performance
npm run task:complete -- 2
npm run task:complete -- awesome-feature

The script will:

1. Find the matching task in tasks-todo/
2. Strip the task-NUMBER- prefix
3. Add todays date prefix: task-YYYY-MM-DD-
4. Move it to tasks-done/

Example transformation:
tasks-todo/task-2-frontend-performance-optimization.md
becomes
tasks-done/task-2025-11-01-frontend-performance-optimization.md

### Renaming Existing Completed Tasks

If you have existing completed tasks without dates, rename them using their last modified date:

Usage: npm run task:rename-done
