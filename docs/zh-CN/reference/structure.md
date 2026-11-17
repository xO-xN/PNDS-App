# PNDS 工程结构

## 工程定义

数字乐谱工程是一个本地目录，拥有 performer、monitor、乐谱服务器、OSC 控制、生产依赖和静态资产。页面接入与消息职责见[运行契约](./runtime-contract.md)。

## 目录结构

根目录须有 `manifest.json` 和它声明的服务器入口。按作品需要加入以下文件。

| 文件或目录                           | 用途                                           |
| ------------------------------------ | ---------------------------------------------- |
| `public/`                            | performer 和 monitor 页面资源                  |
| `package.json`、`node_modules/`      | 生产依赖                                       |
| `supercollider/synthdefs/*.scsyndef` | Internal 音频产物                              |
| `pnds.recording.json`、适配器        | [演奏记录](./performance-recording.md)运行资产 |
| `README.md`、`cover.png`             | 演出简介与封面                                 |

运行依赖随工程携带，或由确切的 App 共享引用满足。App 提供 Node 与 scsynth，运行期间不安装依赖。

## 工程内的私有创作数据

`.pnds-creation/` 保存工程聊天、待处理文档、接入恢复记录和演奏记录。完整复制工程（含隐藏目录）可携带这些数据。文件工具、Git、默认 `.pnds` 和临时运行检查排除整个私有目录及其别名。复制不携带本机密钥与任务执行授权。

演奏记录的目录与恢复方式见[使用教程](../app-tutorial.md#携带与恢复演奏记录)。

## 工程自述 README.md（可选）

根 `README.md` 随工程包分发。封面格式、语言变体和编辑操作见 [README 指南](../readme-guide.md)。

## 工程合规清单

静态校验见 [manifest](./manifest.md)，运行检查见[运行契约](./runtime-contract.md)。

## App 共享包

`manifest.sharedLibraries` 仅覆盖同包名、同确切版本的生产依赖。其余依赖须由工程携带。字段和版本校验见 [manifest](./manifest.md)，浏览器资源接线见 [p5.js](./p5js.md)。

## App 新建工程的来源

App 以 [Blank](../template-guide.md#新建-blank-工程)创建独立工程身份和初始 Git 版本。`docs/template-source.json` 记录来源，`docs/implementation.md` 描述工程文件。
