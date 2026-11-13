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
