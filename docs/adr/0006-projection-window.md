# 投影窗口：同 App 第二窗口与 App 级开演门

v1.5 把侧栏「用默认浏览器打开」替换为投影窗口：一个同 App 多页前端加载出的独立 webview 窗口（照帮助中心 v1.3.0 #56 的窗口模式——固定 label 单例、hidden-create 防闪、事件桥），渲染一个 monitor 专属瘦根组件，而不是裸加载 monitor URL 的远程 webview——裸 webview 会丢掉 reveal 防闪、重载 nonce、主题/语言桥与「与主窗口同 WKWebView 引擎」的一致性，而浏览器入口本就不携带 `?theme=`/`?lang=`，收不到任何桥推送。

「何时把 monitor 给观众看」因此成为 App 级职责：投影开演门（简介 = 工程 README ⇄ monitor，指挥 ▶/⌘⏎ 控制、可反向、session 级重置）放在 App 而非工程页面——不提前暴露乐谱是演出调度行为，不属于作品实现。工程页面仍可自建页内开始流程（如 pnds-cm1 的 START），两者互不排斥。

## Considered Options

- 裸加载 monitor URL 的远程 webview（否决：丢 reveal 防闪、重载 nonce、主题/语言桥与「与主窗口同 WKWebView 引擎」的一致性——首段反面锚点）。
- 保留浏览器入口、投影窗口并存（否决：浏览器入口引擎不受控、无首帧参数、收不到任何桥推送，两套显示一条是死路）。
- 开演门放工程页面实现（否决：何时把 monitor 给观众看是演出调度行为，属 App 职责；工程页自建页内开始流程与 App 级门互不排斥，见第二段）。
