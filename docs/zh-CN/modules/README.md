# 模块手册

逐个讲解 PNDS Template 自带模块的用途与用法，面向基于 Template 创作的创作者。手册随 App 离线分发——排练场、演出机上没有开发环境也能随手查。

术语沿用 App 的统一叫法：座位（代码里是 seat）、claim token（中英文都不译）、performer / monitor（两种页面角色，直接用英文）。

## v1.6.1 离线标准模块

App 提供 QR、客户端连接与身份恢复、monitor 主题、monitor 语言、monitor 视图状态，以及可选 hub 六个独立条目。通过创作模式添加到 `modules/pnds-<id>/`；每项附带实际源码、双语 README、`compatibility.json` 和 `pnds-module.json`。兼容声明分别列出模块版本、Host 协议、运行依赖与作品适配条件，模块版本不同于 App 版本。接线以已加入目录的同版本 README 为准。

首批旧版来源记录继续可读，App 展示实际已加入版本并保留作者源码和原交接任务。不会自动升级、布线、安装依赖或启动工程。来源不明或文件冲突交给外部 agent；文件存在不代表已接线、已验证或可分发。下文对 Template 独占座位、声道和页面的说明仅描述示例作品策略。投影、诊断与音频仍沿用既有基础设施，不增加为可添加模块。

## 篇章

| 篇章                                   | 覆盖文件                                                                      | 一句话                            |
| -------------------------------------- | ----------------------------------------------------------------------------- | --------------------------------- |
| [QR 码](./qr.md)                       | `lib/qr.js`                                                                   | monitor 页上的扫码入口            |
| [乐手身份与座位](./players.md)         | `lib/players.js`、`lib/seats-store.js`、`lib/protocol.js`、`public/client.js` | claim token、座位、Socket.IO 协议 |
| [主题跟随](./theme-follow.md)          | `lib/theme-follow.js`                                                         | monitor 页跟随 App 主题换色       |
| [语言跟随](./locale-follow.md)         | `lib/locale-follow.js`                                                        | monitor 页跟随 App 界面语言       |
| [投影面](./projection-surface.md)      | 页面入口（如 `public/monitor.js`）                                            | monitor 页为场地屏分支渲染        |
| [monitor 视图状态](./monitor-state.md) | `lib/monitor-state.js`、`public/client.js`（monitor 侧）                      | monitor 页多副本视图一致          |
| [音频：三模式与作品层](./audio.md)     | `audio/controller.js`                                                         | 创作者改得最多的文件              |
| [hub](./hub.md)                        | `modules/pnds-hub/`                                                           | 可选远程节点与事件                |

## 与其他文档的分工

- **[Template 仓库的实现手册](https://github.com/xO-xN/PNDS-Template/blob/main/docs/implementation.md)**（体裁分工）：那边讲模板示例工程本身——示例行为规格、目录职责、「创作时改哪里」；本册是按模块查用法的参考手册，排练与演出时回答「座位怎么持久化」「主题变量有哪些」这类问题。开发机上「从零到发布」的工作流指南是帮助中心的[创作指南](../template-guide.md)，与本册的分工同此。
- **[参考手册](../reference/README.md)**（契约分工）：参考手册面向「工程」这一契约层——manifest、运行时行为、`.pnds` 打包、OSC 等 App 与工程之间的接口；本册面向 Template 自带的模块实现——工程内部这些文件怎么用。契约细节一律以参考手册为准，本册只链接、不重述。

## 刻意不收的模块

- `lib/config.js`、`lib/network.js`、`lib/health.js`、`lib/lifecycle.js`、`lib/osc-transport.js`——基础设施，创作者几乎不需要动；契约见参考手册的 [runtime-contract.md](../reference/runtime-contract.md) 与 [osc.md](../reference/osc.md)。
- `public/performer.js`、`public/monitor.js`——示例作品层：真实作品会把它们整体替换，工作流见创作指南。

## 时效

本册跟着 Template 的实现撰写；Template 发版时应同步核对本册，防止实现与手册漂移。
