# 导出 Blank GitHub 模板

在 App 仓库根目录运行以下命令，将快照导出到一个尚不存在的目录。命令完成后会输出该快照的 Git 标签。

```sh
cargo run --manifest-path src-tauri/Cargo.toml --features blank-template-export --bin blank-template-export -- ../PNDS-Blank-candidate
```

导出复用 App 新建 Blank 的工程生成器，并加入初始化命令和双语使用说明。模板包含固定的 `pnds-blank-template` 占位 ID。从模板建出的仓库通过 `npm run init:pnds` 生成独立 ID。App 新建工程继续在创建时生成 ID，并建立本地 Git 历史。

## 快照标签与核验

标签采用 `pnds-blank-v<version>`，其中 `<version>` 取自导出快照内 `docs/template-source.json` 的 Blank `version`。本次版本为 `pnds-blank-v1.7.0`。候选仓与正式仓使用同一规则，并保留每个已发布标签所指向的文件树。需要发布不同的文件树时，先更新 Blank 来源版本，再导出和打标。初始化会保留该来源记录。

在候选仓提交导出的完整文件树，并在该提交上打上导出命令给出的标签。通过 GitHub 的 **Use this template** 建仓时选择默认分支。对建出的初始提交和标签分别运行 `git rev-parse '<ref>^{tree}'`，两次结果应相同。比较涵盖全部 Git 路径、内容和文件模式。

随 App 测试运行的 `blank_github_tests` 用临时 Git 仓、Node 24 和 App 的共享依赖测试资产验证快照、初始化、推送、克隆、打开和无声预览。候选仓的实际 GitHub 建仓与正式仓切换见发布验收票。[规格 #327](https://github.com/xO-xN/PNDS-App/issues/327) · [发布验收 #332](https://github.com/xO-xN/PNDS-App/issues/332)

## 在独立工作树运行发布验收

从包含导出、首次备份与目录提示的集成工作树启动 App。新工作树需准备 npm 依赖和本机打包资源。可以按[发行准备](./releases.md)生成资源，也可以复用同一架构下已经准备好的资源。若复用资源，分别在集成工作树链接 `node_modules`、`src-tauri/binaries`、`src-tauri/plugins`、`src-tauri/Frameworks`、`src-tauri/resources/shared-libraries`、`src-tauri/resources/utilities` 和 `src-tauri/resources/synthdefs/pndsMaster.scsyndef`。这些本机链接只用于构建。

由验收者从集成工作树运行以下命令。命令从 GitHub Actions 仓库变量读取 PNDS GitHub App 的公共配置。也可使用 [GitHub 同步设置](./github-sync.md#github-app-registration)中的配置值直接启动。

```sh
PNDS_GITHUB_CLIENT_ID="$(gh variable get PNDS_GITHUB_CLIENT_ID --repo xO-xN/PNDS-App)" \
PNDS_GITHUB_APP_SLUG="$(gh variable get PNDS_GITHUB_APP_SLUG --repo xO-xN/PNDS-App)" \
npm run tauri:dev
```

在 App 的 GitHub 账号设置确认连接状态，按需在浏览器完成设备授权，并把专用测试仓加入 PNDS GitHub App 的安装范围。App 首次备份与从 GitHub 初始化的工程分别验收。把仓库主题保存与搜索收录记录为两次观测。
