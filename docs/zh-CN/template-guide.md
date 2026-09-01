# PNDS Template 创作指南

本文档将引导你基于 PNDS Template 从零开始创建、开发并发布一个 PNDS 池谱作品。

---

## 准备工作

在开始之前，请确保本地已具备以下环境：

- **PNDS App 最新版**：已安装并可正常运行
- **Node.js 24**：开发期基线（演出机上无需安装，App 自带 Node 运行时）
- **SuperCollider**（仅 Internal 模式需要）：用于编译 SynthDef，标准安装到 `/Applications/SuperCollider.app`
- **Git 与编辑器**：已配置 Git 环境，并安装惯用的 IDE（如 VS Code、Zed 等）
- **AI-Coding Agent**：建议配合 DeepSeek Harness、ZCode (GLM) 等 AI-Coding Agent 使用

---

## 1. 创建与初始化工程

1. **基于模板创建仓库**  
   访问 GitHub 上的 [PNDS Template](https://github.com/xO-xN/PNDS-Template) 仓库，点击右上角的 **Use this template** → **Create a new repository** 生成专属项目仓库。

2. **克隆工程到本地**  
   在新仓库中复制 Git 地址，通过终端或 IDE 将工程克隆至本地：

   ```bash
   git clone <your-repo-url>
   ```

3. **查阅工程文档**  
   用编辑器打开项目：根目录 `README.md` 是概览；`docs/implementation.md`（实现手册）讲模板示例作品的行为规格与「创作时改哪里」；`AGENTS.md` 是 AI-Coding Agent 的入口——agent 会自动读取它，并经它按问题索引平台契约文档（优先读取装机 App 自带的本地帮助语料）。端口在 `manifest.json` 中声明，惯例与选择建议见[参考手册 · manifest](../reference/manifest.md)的「端口」一节。

---

## 2. 创作与迭代工作流

PNDS 推荐采用 **「AI 辅助生成/修改 + PNDS App 实时热载预览」** 的双轨循环迭代模式：

- **AI 驱动开发**  
  将工程目录导入你的 AI-Coding Agent，通过对话引导 AI 理解乐谱的交互逻辑、音频/视觉渲染规则以及通信协议，快速编写或重构代码。工程自带的 `AGENTS.md` 会替 agent 取读平台契约与模块手册，无需手动投喂文档。对刚从模板创建的新工程，对 agent 说规范开始语即可——中文**「开始新作品」**、英文 **“start a new piece”**，说哪句 agent 就用哪种语言工作——它会按工程内置的 `docs/start.md` 完成初始化（作品名 / 作者 / 简介就位、版本归零、安装与测试跑绿）。
- **实时加载与预览**  
  在创作过程中，随时在 PNDS App 中载入本地工程目录，即时测试交互响应、音画表现与多端同步机制；左侧栏右上角的「在默认浏览器打开」与「刷新 monitor 界面」两个按钮可辅助开发调试。
- **持续验证与微调**  
  遵循小步迭代原则，在修改后立即于 App 内验证效果，确保各模块表现符合预期。

---

## 3. 试运行自检

打包前必须完成一次真实运行——App 的打包校验是静态的（结构、产物、依赖齐全），它证明不了工程行为正确：

1. 在 App 中打开工程目录（`⌘ O`、侧栏 `+` 或把目录拖进窗口）；
2. 确认 preflight 通过、session 启动、health 变为 ready；
3. 用手机连入同一局域网扫码进入 performer 页面，确认交互与声音正常；确认 monitor 页面在 App 窗口内正确嵌入、随窗口缩放；
4. 走一遍关闭流程，确认工程释放自己创建的资源。

任一步失败，先修工程再回来打包。

## 4. 打包与发布

当完成一个阶段性版本后，通过以下步骤完成作品交付：

1. **导出 `.pnds` 工程包**  
   打开 App 的 **设置 (Settings)** → **开发者工具 (Developer Tools)**，将当前工程打包导出为 `.pnds` 分发文件。
2. **自动化发布**  
   将本地改动提交并推送到 GitHub 仓库（或创建 Release Tag），触发 Template 内置的 **GitHub Actions** 自动化工作流，完成作品的构建与在线分发。

发布前检查清单：

1. `manifest.json` 通过 App 完整校验（id / name / version 就位，端口、模式、bus 容量合法）；
2. SynthDef 已用开发者工具重新编译，manifest 引用全部验证通过；
3. 工程刚在 App 里完整跑通过一次（health ready、performer 可演奏、monitor 正常、关闭干净）；
4. `npm install` 已完成，`node_modules/` 完整在场；
5. `version` 相对上一次分发的包已递增（内容变更必须升版本，原因见[参考手册 · .pnds 工程包](../reference/pnds-bundle.md)）；
6. 打包成功，记下产物路径与 sha256，连同文件一起分发。
