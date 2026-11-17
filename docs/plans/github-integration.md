# PNDS App 接入 GitHub 的评估

**2026-11-11 后续决定。** 创作者同步首版以 [ADR-0018](../adr/0018-creator-github-backup.md) 为准，覆盖绑定 GitHub 仓库、备份当前分支、快进更新和在另一台 Mac 克隆工程。`.pnds` 发行由 Agent 与 GitHub Actions 流程处理。从作品仓库直接打开 PNDS App 的入口暂缓。下文保留最初的接入评估与分期建议。

评估日期为 2026-11-11。建议先让演出者从 GitHub 安装公开 `.pnds`，创作者继续用现有打包流程，再根据排练分发和源码协作需求接入账号。GitHub 负责交付和协作，已安装的作品按现有本地流程预检和运行。

## 分期建议

| 阶段            | 用户可以做什么                                                                            | 接入方式                                                                            |
| --------------- | ----------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| 1. 公开工程分发 | 在工程列表粘贴 GitHub 仓库、Release 或 `.pnds` 附件链接，选择版本并安装，按需检查新发行版 | 匿名 GitHub REST API + 现有 `.pnds` 安装器                                          |
| 2. 创作者发布   | 在创作工作台生成 `.pnds`，前往仓库 Releases 上传。后续可在 App 创建草稿、上传、核对并发布 | 现有打包器 + GitHub 网页。内置发布可接 Releases API，固定提交的重复打包可用 Actions |
| 3. 团队私有分发 | 连接 GitHub，安装已授权仓库里的排练或演出版本                                             | GitHub App device flow + `Contents: read`                                           |
| 4. 源工程协作   | 导入可编辑工程，在 Git 版本页获取远端版本、推送指定分支，在浏览器处理 PR                  | 源码快照可独立交付。保留完整历史与双向同步需要原生 Git HTTPS                        |

如果主要目标是跨电脑接续创作，可以提前验证 HTTPS clone、fetch、push，再排发布入口。这个路径同步源码和 Git 历史。工程私有聊天、资料、演奏记录以及仓库本地配置中的版本显示名，仍需各自的迁移方式。[工程结构](../zh-CN/reference/structure.md#工程内的私有创作数据) · [本地版本显示名](../developer/local-git.md#editable-display-names-and-name-series-2026-10-21)

## 在 PNDS 中落地

**安装与升级。** 四个内置工具已在构建期按 `repo + tag + asset + SHA-256` 从 GitHub Releases 下载，可以用其中一个验证公开安装。App 里由 Rust 解析来源、限量下载到临时文件、校验摘要和归档，再复用现有原子安装。来源存仓库、Release/asset ID、SHA-256 和包内 manifest 身份。界面显示发布者、版本、预发行状态和下载大小。打开安装结果走现有预检，启动保留显式操作。对网上下载的包补充解压条目数和展开字节上限，校验失败时保留已安装版本。[工具清单](../../utilities.json) · [安装实现](../../src-tauri/src/project/bundle.rs#L607-L638) · [打开流程](../../src/lib/open-project.ts#L71-L117)

**识别作品版本。** GitHub tag 用于定位发行版，`manifest.id` 和 `manifest.version` 决定 PNDS 安装槽位。现有 `version` 是字符串，首版可列出发行版供用户选择，约定 SemVer 后再排序比较。新版本并列安装，保留旧版供回退。同一槽位遇到不同来源、不同工程身份或同版本不同摘要时，先报告冲突，避免远端下载静默覆盖旧内容。[工程包版本契约](../zh-CN/reference/pnds-bundle.md#版本号语义内容变更必须升-version) · [manifest 契约](../zh-CN/reference/manifest.md#必填字段)

**发布审阅。** 现有打包读取磁盘保存版、校验生产依赖和 SynthDef，并给出 SHA-256。工作台已有的成功测试记录仅表示当时的工程可运行。App 内正式发布前，应核对待上传的包内容和仓库可见性，并确认 Git tag 与提交的对应关系。打包排除私有创作目录，当前规则仍可能收进 `.env` 等敏感文件。可以用独立的公开发行仓库分发，包内的运行代码仍随文件提供。如果要声明作品包来自某个源码提交，用该提交的隔离副本打包，或对包的实际来源做等效校验。当前 `pnds` CLI 提供 `check`，Actions 复用 PNDS 打包器需要新增入口。[打包行为](../developer/creation-workspace.md#workspace-bundle-generation-162) · [排除规则](../../src-tauri/src/project/bundle.rs#L341-L352) · [CLI](../../src-tauri/src/bin/pnds.rs)

**源码协作。** “保存当前版本”继续生成本地提交，远端推送由用户选择仓库和分支。首次推送审阅将上传的提交及历史文件。首版显示领先、落后和分叉，提供 fetch、常规 push 和干净工作区下的显式快进。分叉时先在外部工具处理。将网络等待放在工作区锁外，发布本地结果前复核工程身份和目标引用，再沿用现有草稿、暂存、助手任务及运行租约检查。源码归档可能缺少生产依赖或 SynthDef，导入后显示预检缺项，由用户决定后续准备步骤。[本地 Git](../developer/local-git.md) · [版本导航 ADR](../adr/0011-creator-git-version-navigation.md) · [工程结构](../zh-CN/reference/structure.md)

首版验收可用一个已有 `.pnds` 附件的公开仓库，从粘贴链接走到安装、预检和手动运行，再覆盖取消或断线、摘要不符、安装槽冲突和旧版离线加载。接入内置发布时，验证发布失败后按草稿与附件状态恢复。接入账号后，覆盖无权限、权限撤销和令牌刷新。

后续可以在同一安装入口上增加精选作品目录、从网页打开安装预览，以及按固定 commit 创建模板副本。作品反馈、PR 审阅和 Actions 检查结果可先提供网页入口，使用频率足够高再做 App 内视图。

## 上游能力与实现取舍

- **公开下载。** GitHub 允许匿名查询公开 Release 和下载附件。附件 API 返回 `200` 二进制或 `302` 下载重定向，元数据可包含 SHA-256 `digest`。PNDS 可按 Release 和附件 ID 保留来源，流式下载并在存在摘要时核对，再交给现有安装器。公开 REST API 的主限额为每 IP 每小时 60 次，适合按需查询与缓存。[Releases](https://docs.github.com/en/rest/releases/releases#list-releases) · [Release assets](https://docs.github.com/en/rest/releases/assets#get-a-release-asset) · [REST 限额](https://docs.github.com/en/rest/using-the-rest-api/rate-limits-for-the-rest-api)
- **私有下载与登录。** 私有 Release 读取需要 `Contents: read`。用户需授权 GitHub App，安装者可将安装授权限于选定仓库。用户令牌的访问范围由用户权限、安装覆盖范围与 App 注册权限共同约束。无权访问私有仓库也可能收到 `404`。GitHub 将桌面 App 列为 device flow 的用例。App 内置公开 Client ID，引导用户在系统浏览器输入设备码，随后由 Rust 交换令牌。此流程可使用 refresh token 刷新，Web application flow 的令牌交换需要 Client Secret。使用现有 `reqwest` 和 macOS Keychain，界面只读账号状态。GitHub 账号和本地 Git 提交署名分别设置。[安装 GitHub App](https://docs.github.com/en/apps/using-github-apps/installing-a-github-app-from-a-third-party) · [桌面端授权流程](https://docs.github.com/en/apps/creating-github-apps/writing-code-for-a-github-app/building-a-cli-with-a-github-app) · [生成令牌](https://docs.github.com/en/apps/creating-github-apps/authenticating-with-a-github-app/generating-a-user-access-token-for-a-github-app) · [刷新令牌](https://docs.github.com/en/apps/creating-github-apps/authenticating-with-a-github-app/refreshing-user-access-tokens) · [私有资源 404](https://docs.github.com/en/rest/using-the-rest-api/troubleshooting-the-rest-api#404-not-found-for-an-existing-resource) · [PNDS 外部服务](../developer/external-apis.md)
- **发布与权限。** 创建 Release 和上传附件需要写权限，GitHub App 的 `Contents: read` / `Contents: write` 由 App 注册配置控制。若给现有 App 扩权，安装所有者需批准。可先保留只读接入，再评估是否单独注册发布用 GitHub App。启用不可变 Release 时，先建草稿、上传并核对附件，再发布。上传失败可能留下 `starter` 附件，恢复时先检查远端草稿和附件状态，避免重复创建。发布预览应显示仓库可见性、tag 和包版本。[注册权限](https://docs.github.com/en/apps/creating-github-apps/registering-a-github-app/choosing-permissions-for-a-github-app) · [创建 Release](https://docs.github.com/en/rest/releases/releases#create-a-release) · [上传附件](https://docs.github.com/en/rest/releases/assets#upload-a-release-asset) · [不可变 Release](https://docs.github.com/en/code-security/concepts/supply-chain-security/immutable-releases)
- **源码快照与 Git 同步。** GitHub 源码归档可按分支、tag 或 commit 下载，保留来源时优先记下完整 commit SHA。归档只含快照，LFS 默认只含指针。完整克隆、fetch 和 push 可使用 GitHub App 用户令牌做 Git HTTPS 鉴权。PNDS 当前内嵌 Git 禁用了 HTTPS 与 SSH，也不依赖系统 Git。双向协作需要新增 transport，并处理项目作用域、脏工作区、分支保护、分叉和冲突。首个同步版本可限定独立仓库、显式推送和干净工作区下的快进更新。[源码归档](https://docs.github.com/en/repositories/working-with-files/using-files/downloading-source-code-archives) · [LFS 归档](https://docs.github.com/en/repositories/managing-your-repositorys-settings-and-features/managing-git-lfs-objects-in-archives-of-your-repository) · [Git 鉴权](https://docs.github.com/en/apps/creating-github-apps/registering-a-github-app/choosing-permissions-for-a-github-app#choosing-permissions-for-git-access) · [分支与 tag 规则](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-rulesets/available-rules-for-rulesets) · [PNDS Local Git](../developer/local-git.md)
- **Actions。** 可用 tag 触发仓库内的检查和打包，由 workflow 的 `GITHUB_TOKEN` 以 `contents: write` 发 Release。App 若调用 `workflow_dispatch` 触发现有工作流，需要 `Actions: write`。云端校验适合可重复的静态检查和可移植打包，实际演出机运行仍走现有测试和验收流程。[GITHUB_TOKEN](https://docs.github.com/en/actions/tutorials/authenticate-with-github_token) · [触发 workflow](https://docs.github.com/en/rest/actions/workflows#create-a-workflow-dispatch-event)
