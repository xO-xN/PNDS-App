# Agent harness 架构与 PNDS 创作助手

调查日期：2026-10-18。只核对官方文档、源码与测试，未安装或运行外部项目，也没有同任务性能对比。Pi 来源为调查时的 `main`，DeepSeek Harness 来源为 `master`；未取得可统一核验的 commit，链接没有固定版本。本文是研究笔记，不构成实施决定。

## Pi：已确认的设计

当前分层包括统一模型接口 `pi-ai`、工具循环与状态 `pi-agent-core`、编码 CLI `pi-coding-agent` 和终端 UI `pi-tui`；另有 `chord`、遥测包和实验性的 `pi-durable`。CLI、JSON、RPC、SDK 是不同接入方式。[包清单](https://github.com/earendil-works/pi#packages)

核心循环使用应用级 `AgentMessage`，在模型边界通过可选的 `transformContext` 和 `convertToLlm` 整理上下文、转换或过滤应用消息；过滤规则由接入方实现。`prepareRequest` 统一准备每轮请求；`finishTurn` 明确决定结束或继续，已有工具结果/队列触发继续时不会多发一次请求。[循环实现](https://github.com/earendil-works/pi/blob/main/packages/agent/src/agent-loop.ts)

工具用 schema 定义输入；结果区分模型读取的 `content`、界面详情 `details`、程序结果 `structuredContent`，失败有明确标识。执行有开始/更新/完成事件及耗时，可按工具选择串行；并行批的完成事件按实际顺序发送，持久化结果仍按模型调用顺序排列。[工具与事件类型](https://github.com/earendil-works/pi/blob/main/packages/agent/src/types.ts)

`continue` 从已有上下文继续，`steer` 在当前工具批完成后插入更正，`followUp` 等原任务准备结束时追加。这些语义不意味着工具执行一半可以自动回滚。[队列与接续](https://github.com/earendil-works/pi/blob/main/packages/agent/README.md#steering-and-follow-up)

CLI 会话存为 JSONL 树，保留分支；模型只接收活动分支的投影。压缩追加摘要和保留边界，不删除原始记录，摘要保留目标、约束、进度及文件清单。Pi 仍管理模型上下文窗口，并非无限输入。会话分支也不是文件/Git 回滚。[会话格式](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/session-format.md)、[压缩参考](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/compaction.md)

`pi-durable` 先提交工具意图，再执行；中断后只自动重放声明安全的工具，其他调用返回 interrupted。它明确标为实验性，不能据此推断编码 CLI 已全面采用，也不能推断文件写入自动幂等。[Durable 说明](https://github.com/earendil-works/pi/blob/main/packages/durable/README.md)

扩展有启动/关闭钩子及状态归属；核心测试以模拟模型流验证事件、工具边界、队列和结束决策，不依赖每次调用真实模型。扩展与进程同权，Pi 本身没有内置文件/进程/网络权限系统。[生命周期](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/extensions.md#understand-the-lifecycle)、[循环测试](https://github.com/earendil-works/pi/blob/main/packages/agent/test/agent-loop.test.ts)、[权限说明](https://github.com/earendil-works/pi#permissions--containerization)

## Pi 对 PNDS 的启示（推论）

优先稳定任务状态、模型上下文、界面展示三个边界；为工具建立统一的简报/详情/机器结果及错误契约；区分继续、更正、追加；为写入和检查保留操作回执、重试策略与明确结束条件。把 runes-pnds 任务做成回放评测，统计成功率、轮次、重复检查与恢复后的目标一致性。

这些机制有望减少当前的重复尝试和目标漂移，但效果需要实测。PNDS 的本地依赖接线、演出生命周期、即时预览和任务撤回仍适合由宿主掌握，不宜直接照搬任意 shell/插件权限，也无需因此立即引入整套 durable/chord。

## DeepSeek Harness：已确认的设计

官方实现为 [deepseek-ai/deepseek-harness](https://github.com/deepseek-ai/deepseek-harness)，当前标注 developer preview。Cordis 提供服务依赖、类型事件和可撤销的注册；模型适配、工具、会话日志、agent 循环都是插件，按 profile/bundle 组合。插件卸载撤销其注册与副作用；这种作用域是软件组合机制，不能代替文件或进程权限边界。[架构](https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/architecture.md)、[项目状态](https://github.com/deepseek-ai/deepseek-harness#developer-preview)

持久 `SessionEvent` 日志记录输入、模型请求、工具调用与结果。模型上下文由日志投影，UI 从同一来源展示；已结算的失败尝试可以记录而不进入有效模型历史。实时流与持久事实有独立事件，结算前硬崩溃仍可能丢失部分流式记录。一个用户任务 turn 包含多个模型请求 step，重试与用户输入接纳有明确边界。[会话与主循环](https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/architecture.md#session-log)、[循环细节](https://github.com/deepseek-ai/deepseek-harness/blob/master/packages/core/agent-loop/README.md)

工具定义约束参数和成功输出，并把执行时的 canonical value、模型读取的 content、界面使用的 meta/card 分开。canonical value 不自动持久化，回放不能据日志重建所有执行中间值。并发需要工具显式声明安全；未知或独占工具形成排序屏障。参数校验、前置策略、执行、后置策略和结果规范化有统一入口。[工具契约](https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/subsystems/tools.md)

上下文管理区分正常压力与服务确认的溢出；可先裁剪冗长工具结果，再摘要。调用与结果必须保持配对，失败恢复只有模型可见上下文实际推进后才请求重试，避免原样空转。[压缩设计](https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/subsystems/compaction.md)

## PNDS 的现有基础与建议顺序

以下是结合本地实现的判断，不是两个上游对 PNDS 的结论。

PNDS 已有 Rust 模型传输和原生写入边界、TypeScript 请求循环、工具适配与 React 展示的分层雏形；也已有模式固定、内存接续、版本校验、持久文件恢复记录、检查去重、上下文压缩和独立工作过程展示。不能把这些已有能力列为尚未实现。[当前助手契约](../developer/creation-assistant.md)、[循环](../../src/lib/assistant-flow.ts)、[工具适配](../../src/lib/assistant-task-tools.ts)、[原生恢复](../../src-tauri/src/project/creation/assistant_tasks.rs)

当前完整执行接续仍在内存中；聊天历史与文件恢复记录各自持久化。总控还集中处理较多模式、错误恢复、读写覆盖、检查和展示回调。下一步适合收拢状态与接口，减少依赖长提示词维持正确行为。

| 顺序 | 建议                                                                                                   | 对应近期观察                                 |
| ---- | ------------------------------------------------------------------------------------------------------ | -------------------------------------------- |
| 1    | 统一工具 schema、错误分类与模型/UI 结果投影；让工具引用已读文件记录，由 App 保管实际版本并继续原生校验 | 参数 JSON 与代码路径混淆、重复试错、冗长说明 |
| 2    | 明确任务目标、已完成操作、待检查项、控件状态和停止原因；在现有恢复日志上补齐可持久接续状态             | 暂停/重启后目标与进度一致性                  |
| 3    | 将接续、用户更正、排队追加分开；由运行时协调检查和收尾                                                 | “继续”被解释为新工作、重复检查               |
| 4    | 复用本地预演接线与模板能力；让模型填写实际参数与更新逻辑，宿主生成确定的协议和 UI 结构                 | 简单调参任务重复学习、手写相同接线           |
| 5    | 按需提供文件片段与文档；独立只读调用可有限并发，写入及依赖变更保持顺序                                 | 大文件上下文、串行轮次过多                   |
| 6    | 在现有模拟测试之外固定真实需求回放与真实服务验收，测量结果正确性和有效往返                             | 单元测试通过，但任务仍用 21 轮且粒度偏离需求 |

回放至少覆盖：初始工程接入 p5、空心数字及字号推子、逐演奏者尺寸控制、运行中静态检查、暂停/超时接续、参数保存及任务撤回。除成功率外记录模型调用数、工具拒绝数、重复读取/检查次数、恢复后是否重复副作用。工程检查通过与用户要求实现需分别判定。

优先采用可独立验证的小范围改动，保留 Tauri/React/Rust 和本地依赖约束；无需为了借鉴而先迁移整套引擎、开放 shell、引入多 agent 或插件市场。Pi 的实验 durable API 与 DeepSeek 的快速迭代也不适合直接当作稳定嵌入契约。
