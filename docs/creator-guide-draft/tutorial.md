# 教程:从模板到你的第一个 `.pnds`

本教程带你在约 30 分钟内走完一次完整创作流程:复制模板创建新工程、编译 SynthDef、在 App 里试运行、打包成单一 `.pnds` 文件,并体验接收方安装。走完之后,你就独立掌握了一次「创建 → 编译 → 试运行 → 打包 → 打开」的闭环,之后的实际创作只是在这条路径上迭代。

教程只保证你**做出来**,不解释为什么——设计动机见[解析](./explanation.md),字段与规则的完整资料见[参考](./reference.md)。

## 你将做出什么

- 一个属于你自己的工程目录(基于 PNDS Template,有独立的 id / name / version);
- 一份编译好的 SynthDef 产物;
- 一个能在 PNDS App 里运行的工程,和一份可在任何装了 PNDS App 的 Mac 上双击安装的 `.pnds` 文件。

## 准备

开始前确认创作机(macOS,Apple Silicon)上有:

1. **PNDS App**——开发、编译、打包都在 App 内完成;
2. **Node.js 24**——只用于开发期 `npm install`(演出机不需要);
3. **SuperCollider**(仅 Internal 音频模式的工程需要)——标准安装到 `/Applications/SuperCollider.app` 即可,App 编译 SynthDef 时会自动找到它的 `sclang`。

工程只做页面与网络(`none` 模式)或使用外置声音引擎(`external` 模式)时,不需要安装 SuperCollider。

## 步骤 1:复制模板

```sh
git clone https://github.com/xO-xN/PNDS-Template.git my-first-score
cd my-first-score
npm install
```

`npm install` 结束后,工程自带可用的 `node_modules/`——App 从不执行 npm,这份目录会一直随工程走。

**你应该看到:** 终端里 `added N packages` 且无 `npm error`。

## 步骤 2:换上你的身份

打开 `manifest.json`,改三个字段:

```json
{
  "id": "my-first-score",
  "name": "My First Score",
  "version": "0.1.0",
  ...
}
```

- `id`:全局唯一、小写连字符,之后永远不要再改(它决定接收方机器上的安装目录);
- `name`:显示名,打包产物文件名由它生成;
- `version`:从 `0.1.0` 开始,以后每次内容变更都递增(原因见[解析:版本号与安装槽位](./explanation.md#版本号与安装槽位为什么内容变更必须升-version))。

端口(`performerPort: 6868` / `monitorPort: 6869`)**保持不动**——这是平台惯例,除非你有明确理由换(见[任务指南:选择或更换端口](./how-to.md#如何选择或更换工程端口))。

**你应该看到:** 保存后 `manifest.json` 仍是合法 JSON(编辑器无红线)。

## 步骤 3:编译 SynthDef

模板的声音源码在 `supercollider/source/template-sine.scd`,编译产物应落在 `supercollider/synthdefs/`:

1. 打开 PNDS App,按 `⌘,` 打开设置;
2. 进入**开发者工具**区,点**「编译 SynthDef」**。

**你应该看到:** 结果面板列出**编译产物**(`template-sine.scsyndef`)与**已验证的 manifest 引用**,以及所用的 `sclang` 路径。

失败了?错误通知会给出 sclang 输出原文与精确原因,对照[任务指南:编译 SynthDef](./how-to.md#如何编译或重新编译-synthdef)的失败排查表处理。

## 步骤 4:在 App 里试运行

1. 关闭设置,在 App 中打开工程目录(`⌘O` 或侧栏 **+**,选中 `my-first-score` 文件夹);
2. 音频模式选 **Internal Synth**,启动;
3. 手机连入同一局域网,扫 monitor 页的 QR 码进入 performer 页面,推两个推子;
4. 结束后正常关闭工程。

**你应该看到:** preflight 通过、工程进入运行状态(状态指示变化);performer 页可操作,推子动、出声音;关闭无报错。

打包前的这次真实运行是硬要求——App 的打包校验只查结构,证明不了行为正确。

## 步骤 5:打包

1. `⌘,` 打开设置 → **开发者工具**;
2. 确认目标工程是 `my-first-score`(不是就用**「浏览…」**选择);
3. 点**「打包工程」**。

**你应该看到:** 成功后结果面板显示**产物路径**(工程同级目录的 `My First Score-0.1.0.pnds`)与 **SHA-256 校验和**,各带复制按钮。源工程目录零改动,全程不执行 npm。

## 步骤 6:体验接收方

把 `.pnds` 文件拷到 U 盘(或直接用这台机器的另一个用户账户模拟「另一台机」),然后**双击**它。

**你应该看到:** PNDS App 校验、安装并直接打开工程——与目录工程体验完全一致,接收方不需要 Node.js、SuperCollider 或网络。

安装发生在 App 数据目录 `bundles/<id>-<version>/`;以后同版本重复打开总是覆盖重装。

## 下一步

- 改声音、改界面、加交互 → 回到工程里迭代,每次重新走「编译 → 试运行」;
- 要分发给演出方 → [任务指南:打包并分发](./how-to.md#如何打包-pnds-并分发);
- 发布修复或新版本 → [任务指南:发布新版本](./how-to.md#如何发布修复版或新版本)(必须升 `version`);
- 想知道这套流程为什么这样设计 → [解析](./explanation.md)。
