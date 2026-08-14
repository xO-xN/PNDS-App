# V1.2: 内置工具（Built-in Tools）—— LND 与 Multichannel Signal Generator 随 App 分发

> 状态：**未优先化**（`x`），V1.2 候选需求。
> 来源：用户需求（2026-08-15）：两个自带验证/工具工程在 v1.2.0 并入 App，作为内置 tools。

## 需求

App v1.2.0 内置两个工具工程，开箱即用（不依赖用户手动选择目录）：

1. **Local Network Diagnostics**（`xO-xN/Local-Network-Diagnostics`）—— 局域网网络测试；
2. **Multichannel Signal Generator**（`xO-xN/Multichannel-Signal-Generator`）—— 16 路 Internal 信号工具。

用户在 Welcome/工具面板中直接看到这两个工具，点击后走与普通工程完全相同的 session
流程（preflight → spawn node → health 轮询 → monitor）。内置工具不应有 trust gate。

## 现状（2026-08-15）

- 两个工程都是**独立 GitHub 仓库**，各自带 `.github/workflows/package.yml`，tag `v*`
  时产出可运行 bundle（`dist/<Name>/`：manifest、server.js、lib、public、node_modules；
  MSG 额外含 `supercollider/*.scsyndef` 运行时 artifact，LND 无 audio/supercollider）。
- App 当前只支持**目录工程**：`openProject(path)` → trust gate → preflight → start
  （`src/lib/open-project.ts`、`src/lib/session-flow.ts`）。`.pnds` bundle 格式、
  runtime-asset 安装、checksum、target-platform 检查均为 V1.2 范围（见 `docs/tasks.md`）。
- 本仓库不再跟踪 `examples/multichannel-tone-test`（已改名并独立成仓，
  `examples/` 下两个工程均为嵌套 repo，父仓库不跟踪）。

## 已定方案路径

**内置工具 = 随包分发的预装 bundle，复用现有 session 流程**：

1. **工具注册表**：App 仓库新增 `tools.json`（或 Rust 侧常量）：
   ```json
   {
     "tools": [
       {
         "id": "local-network-diagnostics",
         "name": "Local Network Diagnostics",
         "repo": "xO-xN/Local-Network-Diagnostics",
         "version": "v0.1.0",
         "bundle": "local-network-diagnostics-v0.1.0.zip",
         "sha256": "<checksum>"
       },
       {
         "id": "multichannel-signal-generator",
         "name": "Multichannel Signal Generator",
         "repo": "xO-xN/Multichannel-Signal-Generator",
         "version": "v1.0.0",
         "bundle": "multichannel-signal-generator-v1.0.0.zip",
         "sha256": "<checksum>"
       }
     ]
   }
   ```
2. **构建期拉取 + 校验**：`scripts/fetch-tools.mjs` 在 release 构建时按注册表下载各工具
   的 release artifact，校验 sha256，解包进 `src-tauri/resources/tools/<id>/`
   （离线现场可用，随 App 签名分发）。
3. **首次运行安装**：App 首启（或工具面板首次打开）时把 `resources/tools/<id>/`
   复制到 App 数据目录 `tools/<id>/`（可被后续版本 updater 替换），完成即视为"已安装"。
4. **工具面板**：Welcome 增加 "Tools" 区块（或独立 tab），列出注册表中已安装的工具；
   点击 = `openProject(dataDir/tools/<id>)`，内置工具跳过 trust gate。
5. **升级**：工具新版本 = 工具仓库发新 tag → 更新注册表 version/checksum → App 发版
   （不自动热更工具，保持现场确定性）。

## 相关现状与依赖

- 两个工具仓库的 package.yml 已产出 bundle 且 smoke-test 通过（LND：health ready +
  audioMode none；MSG：health 响应 + audioMode internal + monitor 页内容，CI 无 scsynth
  不要求 ready）。
- MSG 新增 `qrcode` 生产依赖后需随包 node_modules（spec §2），package.yml 已含
  `npm ci --omit=dev`。
- `.pnds` bundle 格式（V1.2 计划内）与内置工具的分发格式建议统一：内置工具直接复用
  同一 bundle 布局，`.pnds` 只是同样的目录打成单文件。
- 真实环境验收：干净 Apple Silicon 机安装 App 后，无需网络即可打开两个工具并发声/测速。

## 未决问题

- Tools 面板入口形态（Welcome 区块 vs 独立 tab）与 i18n；
- 内置工具是否允许用户"复制为普通工程"（导出到用户目录以便修改）；
- 工具 bundle 是否需要在 App 内做版本显示与更新提示。
