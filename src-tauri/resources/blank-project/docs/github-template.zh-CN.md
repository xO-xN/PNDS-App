# 从 GitHub 创建 PNDS Blank 工程

[English](./github-template.en.md)

## 创建自己的仓库

1. 在 GitHub 模板页选择 **Use this template → Create a new repository**。选择所有者、仓库名称和公开性。将 **Include all branches** 保持为未选中，只复制模板默认分支的文件。[GitHub 模板建仓说明](https://docs.github.com/zh/repositories/creating-and-managing-repositories/creating-a-repository-from-a-template)
2. 用 `git clone` 克隆新仓库，再在仓库根目录打开终端。也可在新仓库页面选择 **Code → Codespaces → Create codespace**，使用该 Codespace 的终端。
3. 使用 Node.js 24 和 npm。运行 `node --version` 核对版本。如果已安装 `nvm`，可运行 `nvm install 24` 切换到该版本。[Node.js 下载](https://nodejs.org/zh-cn/download)

## 初始化 Blank

在仓库根目录运行以下命令，换成自己的工程信息。名称必填，作者和简介可省略。

```sh
npm run init:pnds -- --name '潮线' --author '林' --description '双人演奏的数字乐谱'
```

初始化会写入独立的工程 ID 和填写的工程信息。`docs/template-source.json` 记录实际采用的 Blank 来源版本。重复运行会保留已有工程身份和文件。随后可用自己习惯的工具继续创作。[Blank 实现说明](./implementation.md)

如果初始化中断且留下 `.pnds-init/`，先确认初始化命令已经停止。若 `manifest.json` 中仍是 `pnds-blank-template`，先另存中断后做过的修改，再在备份目录存在时运行 `cp -R .pnds-init/backup/. .` 恢复原文件。将 `.pnds-init/` 移出仓库，再运行初始化命令。如果 manifest 已经写入你的工程 ID，移走临时目录即可继续编辑。

用普通 Git 流程检查、提交和推送初始化结果。如果已经安装依赖，可一并提交 npm 锁文件。

```sh
git status --short
git add -A
git diff --cached
git commit -m 'Initialize PNDS Blank project'
git push
```

## 无声预览

```sh
npm install
npm start -- --audio-mode none
```

- 演奏端（performer）在 [http://localhost:6868/](http://localhost:6868/)
- 监视端（monitor）在 [http://localhost:6869/](http://localhost:6869/)

在 Codespaces 中，从 **Ports** 面板转发 `6868` 和 `6869`，再打开各自的转发地址。自己预览时使用私有转发即可。[Codespaces 端口转发说明](https://docs.github.com/zh/codespaces/developing-in-a-codespace/forwarding-ports-in-your-codespace)

在终端按 Ctrl+C 停止预览。需要 Internal 音频时，在 PNDS App 中运行工程，由 Host 提供音频环境。

## 在 PNDS App 继续创作

- Mac 上已有工程目录时，在创作模式选择「打开文件夹工程」，选中包含 `manifest.json` 的目录。
- 从 GitHub 获取时，在创作模式打开「切换其他工程」，选择「从 GitHub 克隆…」。选择已授权的仓库，或用 `所有者/仓库名` 查找公开仓库。选择包含初始化提交的分支，指定保存位置，再点击「克隆并打开」。私有仓库需要先在 PNDS App 登录 GitHub，并向 PNDS GitHub App 授予仓库访问权限。

两种方式都使用已初始化的工程，沿用原工程 ID 和 Git 历史。

## 加入公开工程目录

若仓库已公开且你愿意展示，可在 GitHub 仓库首页打开 **About** 旁的齿轮，在 **Topics** 中添加 `pnds-project` 并保存。已有公开 PNDS 工程也可以补加。[浏览公开 PNDS 工程](https://github.com/search?q=topic%3Apnds-project+is%3Apublic&type=repositories) · [GitHub 主题说明](https://docs.github.com/zh/repositories/managing-your-repositorys-settings-and-features/customizing-your-repository/classifying-your-repository-with-topics)
