# PNDS 创作指南

[新建 Blank](#新建-blank-工程) → [创作](#2-创作与迭代工作流) → [试运行](#3-试运行自检) → [生成 .pnds](#4-打包与发布)。

## 新建 Blank 工程

在创作首页或工程选择器选择 **Blank**，填工程名称、文件夹名和父目录。可选填创作者、简介与 Git 署名。目标文件夹须不存在。创建后进入工作台，按需启动测试。Blank 初始静音。

## 从 GitHub 开始创作

使用外部编辑器或 Codespaces 创作时，打开 [PNDS 官方模板](https://github.com/xO-xN/PNDS-Template)，选择 **Use this template → Create a new repository**，仅使用默认分支。按新仓库中的说明初始化工程、运行无声预览，也可以在之后用 App 打开该工程。

如果已在 App 中新建 Blank 工程，请按[首次模板备份流程](./app-tutorial.md#为首次备份核验官方模板仓库)操作。

## App 本地版本与历史

在工作台保存、查看或切换[工程版本](./app-tutorial.md#工程版本与历史)。

## 准备工作

App 自带编辑器、Node 与本地 Git。使用内置讨论／工作前[配置模型服务](./app-tutorial.md#配置模型服务)。修改 SynthDef 源码后用 SuperCollider [编译产物](./reference/supercollider.md)。

## 1. 创建与初始化工程

工程的 `docs/implementation.md` 记录文件分工和作品规则，`AGENTS.md` 指向装机契约，根 [README](./readme-guide.md) 写演出简介。Blank 提供默认身份、输入、视图、录制和预演基础。

## 2. 创作与迭代工作流

1. 在[讨论与工作](./app-tutorial.md#讨论与工作)中明确目标，进入工作后执行修改。
2. 按需接入[待处理文档](./app-tutorial.md#待处理文档)或采用[模块与共享包](./app-tutorial.md#添加模块与共享包)。
3. [保存并测试](./app-tutorial.md#草稿保存版与运行内容)，再保存工程版本。需要外部接续时[记录交接](./app-tutorial.md#记录交接与外部接续)。

### 在聊天中接入可选 hub

接线与所需依赖见 [hub](./modules/hub.md)。

### 为作品选择连接协议

普通触屏接入使用 HTTP。浏览器确需安全上下文时，按[可信 HTTPS](./reference/https.md)准备。原生设备输入见[原生媒体](./reference/native-media.md)。

## 3. 试运行自检

用[实时测试](./app-tutorial.md#实时测试与-performer-窗口)启动保存版。改过的 SynthDef 须先编译，再确认已加载。按作品实际需要检查 monitor／投影、手机演奏端和声音。

## 4. 打包与发布

在工作台的作品菜单中选择 **生成 .pnds**，确认保存版后选择输出位置。交付规则见[工程包](./reference/pnds-bundle.md)。

## 讨论、编辑与独立检查

工作台支持[临时预演](./app-tutorial.md#修改建议与临时预演)和[临时副本运行检查](./app-tutorial.md#临时副本运行检查)。

## 默认演奏输入

Blank 已接通身份接纳后的鼠标单点与触屏多点输入。作品反馈和状态写入现场与回放共用的入口，见工程 `docs/implementation.md` 与[演奏记录协议](./reference/performance-recording.md)。
