# PNDS Template

**中文** | [English](README.md)

title: PNDS Template
composer: PNDS
github_url: https://github.com/xO-xN/PNDS-Template

## 模板简介：

每个 PNDS 数字乐谱工程的起点：一套可直接运行的骨架——演奏者各持一页双推子触摸界面，指挥跟随 monitor 页，中间的 score server 把座位、重连、主题与音频全部接妥。说一句「开始新作品」，模板即成长为自己的作品。

---

## 关于作品

本作品为 PNDS 工程。PNDS（Platform for Networked Digital Score）是一个面向网络化数字音乐演出的开放平台，用于创建、运行和组织多人参与的数字乐谱作品：创作者将一份数字乐谱、一套声音引擎和一组网络交互规则组织成一个独立的演出工程，再由 [PNDS App](https://github.com/xO-xN/PNDS-App)（macOS 桌面应用）在演出现场将它变成一个可运行的本地多人数字音乐演奏系统。

## 使用本模板

PNDS 数字乐谱工程模板：可直接运行的骨架 + 最小功能实现。基于此模板创建新的 PNDS 数字乐谱工程。基于此模板创建的工程在 [PNDS App](https://github.com/xO-xN/PNDS-App)（运行 PNDS 数字乐谱的 macOS 桌面 Host）中运行。

> **AI 编程助手**：本工程是崭新模板（`manifest.json` 的 `id` 仍为 `pnds-template`）。创作者说规范开始语**「开始新作品」**（或「开始 / start」等触发词）时，先读 [`AGENTS.md`](AGENTS.md)，按 [`docs/start.md`](docs/start.md) 初始化新作品——说哪句，用哪种语言工作；其余任务也一律先读 [`AGENTS.md`](AGENTS.md)。

### 功能

- **演奏者界面**：手机横屏双推子（AMP / FREQ），FREQ 推子带半音音高刻度（中心音及上下五度标音名且刻度高亮），状态文字下方有三档音区 switch（1 低音 / 2 中音 / 3 高音）切换频率区段，圆弧几何直观触摸操控
- **音频**：每客户端一个 sine voice，16 声道输出（默认奇偶 id 分到声道 1/2）
- **监视端**：实时显示客户端 amp / freq，可重新分配每个客户端的输出声道
- **监视端视图状态**：视图调整由 score server 单一持有——monitor 页的每个副本（App 主窗、投影窗、重载、浏览器标签）连接即收快照、跟随同一广播；QR 显隐开关是现成示例
- **断线重连**：客户端断线后自动恢复 id 与推子状态
- **主题跟随**：在 PNDS App（≥ v1.2.3）中运行时，monitor 页实时跟随 App 主题（全部四套）——spec §5.3 可选契约，本模板经 p5 的 `onTheme` 回调消费（`lib/theme-follow.js`，经 `/__pnds/theme-follow.js` 加载）
- **语言跟随**：在 PNDS App（≥ v1.3.0）中运行时，monitor 页实时跟随 App 界面语言（`en` / `zh-CN`）——可选语言桥（与主题桥同一套推送机制），本模板经 `onLocale` 回调切换 monitor.js 字串表（`lib/locale-follow.js`，经 `/__pnds/locale-follow.js` 加载）
- **三音频模式**：`internal`（scsynth）、`external`（自定义 OSC）、`none`（仅页面/网络）

### 开始

```sh
npm install
npm run dev:none    # 无音频运行
```

### 与 AI 协作开始新作品

把工程导入你的 AI-Coding Agent，说规范开始语 **「开始新作品」** 即可完成初始化：作品名 / 作者 / 简介就位、版本归零、安装与测试跑绿。此后平台契约文档由工程内的 [`AGENTS.md`](AGENTS.md) 替 agent 按问题索引，无需手动投喂。

完整说明见 [`docs/implementation.md`](docs/implementation.md)（实现手册：示例作品的行为与改哪里）；
从零到发布的工作流见 PNDS App 的[创作指南](https://github.com/xO-xN/PNDS-App/blob/main/docs/zh-CN/template-guide.md)，
AI 编程助手从 [`AGENTS.md`](AGENTS.md) 进入。

### 结构

```
lib/            可复用核心（PNDS 工程通用，模板骨架）
audio/          作品音频语义（推子 → synth 参数映射）
public/         浏览器端（performer + monitor 双角色单页）
supercollider/  SynthDef 源码、debug bridge、编译产物
test/           回归测试
docs/           实现手册
```

### 许可证

MIT — 详见 [LICENSE](LICENSE)。
