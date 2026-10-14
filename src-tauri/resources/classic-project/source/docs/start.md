# 开始一件新作品（初始化流程）

触发：创作者说规范开始语——中文「开始新作品」、英文 "start a new piece"（**短语即语言**，对话跟随短语语言）——或裸触发词「开始 / 开始工作 / start / 新建作品」。本流程做**身份转正与骨架验证**，不删示例代码——示例在创作中被逐步替换，期间的参照与运行价值保留（开始后仍可 `npm run dev:none` 试跑示例）。

作者名落在 `package.json` 的 `author`（npm 标准字段）：`manifest.json` 的 schema 由 PNDS App 校验，当前没有 author 字段，不自行添加。

## 0. 前置检查：本工程尚未初始化

看 `manifest.json` 的 `id`：

- `pnds-template` → 崭新模板，继续第 1 步。
- 其他值 → 工程已转正，**不走本流程**：「开始」在这里是普通对话——告知创作者本工程已初始化（报名作品名），问今天要做什么。改名 / 改简介 / 换 `tokenKey` 随时可单独改字段。重跑本流程的代价：`version` 归零（破坏「内容变更必须升版本」纪律）、`tokenKey` 更换（已演奏过的设备失去座位记录）、已成长的作品规格被占位覆盖。

完成判据：确认 `id` 为 `pnds-template` 才进入第 1 步；否则本轮以澄清对话收尾，不改动任何文件。

## 1. 采集作品身份

向创作者要三样：**作品名**、**作者名**、**一句话简介**；顺带问创作构想（可空，占位即可）。

完成判据：作品名与作者名在手。

## 2. 身份转正（一次改全）

- `manifest.json`：`id`（kebab-case，与作品名对应）、`name`、`description`、`version` 重置为 `0.1.0`。字段规则见 AGENTS.md 指针表的 manifest.md。
- `package.json`：`name`、`description`、`author`、`version` 同步归零 `0.1.0`（与 manifest 一致；`package-lock.json` 的名称字段由第 4 步 install 刷新）。
- 其余身份位由 grep 兜底发现，常见命中：`LICENSE` 版权行、`public/index.html` 的 `<title>`、各源文件头注释、`.github/bundle/README.md`——一并转正。
- `public/shared.js`：`tokenKey` 改为与 `id` 一致（如 `"<id>-token"`），避免不同工程共用 localStorage 键。
- `README.md` 与 `README.zh-CN.md`：封面区换成本作品——一级标题与 `title` 元数据、`composer`（作者）、首节简介；`github_url` 换成新仓库（没有就删行）；顶部 AI 引导块删去「开始」子句、只留「先读 AGENTS.md」——初始化只发生一次，触发引导随转正失效。单语作品删掉多余变体，语言切换行收成单侧。封面图 `cover.png` 换成本作品画面（没有就删除）。`.github/bundle/README.md` 的封面区同步转正（`---` 之后的演出步骤保留）。
- `AGENTS.md` 与 `docs/implementation.md` 导语中的「PNDS Template」字样换成作品名（指针表、骨架不变量原样保留）。

`.github/workflows/package.yml` 的发布身份（BUNDLE 目录名、产物名）**此刻不改**——发布前再改，见第 5 步。

完成判据：上列位置均已指向新作品；repo 级身份残留复核放在第 4 步安装之后。

## 3. 文档转正

- `docs/implementation.md`：「作品规格」节替换为创作者构想；没有构想就写「初始规格待定——与创作者共同定义后回填」占位，别保留示例规格冒充当前规格。若作品层已被大改（跳过「开始」直接开工的情况），规格从当前代码的实际行为回填，别用占位。
- `AGENTS.md`「示例的决策记录」横幅已在，无需逐条清理——随作品分叉自然改写。
- 手机交互与连接：按 AGENTS.md 的「手机 API / QR 协议 / 完整连接网址」指针读取契约，检查作品实际使用的浏览器 API；在作品规格中记录 HTTPS 需求判断。普通触摸与扫码默认 HTTP，实际安全上下文需求才声明 `needsHttps: true`，不因继承完整 URL 适配而启用 HTTPS。

完成判据：implementation.md 不再把双推子示例描述为本作品的规格；连接需求与 manifest 声明一致，尚未实现的构想不冒充已验证的 API 需求。

## 4. 安装与验证

```sh
npm install
npm run check
npm test
```

完成判据：三条命令零失败（模板不预装 `node_modules/`，PNDS App 也不执行安装）；随后 `grep -ri "pnds-template\|PNDS Template" --exclude-dir=node_modules --exclude-dir=.git .` 的命中仅限 `.github/workflows/package.yml`（推迟到发布前）与 `AGENTS.md`、`CLAUDE.md`、`docs/`（agent 文档对模板身份与门禁的自指）。

## 5. 交接

请创作者在 PNDS App 里 **Open** 本目录，确认 preflight 通过、health ready（真机验证由创作者做）。汇报：改了哪些身份位置、作品规格现状（占位 / 初稿）、建议下一步——从 implementation.md「创作时改什么」表入手，或先定 `manifest.json` 的 `audio.outputChannels`。

发布前再回来：把 `.github/workflows/package.yml` 里的 BUNDLE 目录名与产物名改为作品名（发布流程与检查清单见创作指南）。
