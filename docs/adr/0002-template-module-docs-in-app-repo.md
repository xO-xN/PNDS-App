# Template 模块文档住 App 仓库，按体裁与 Template 仓库分工

向创作者讲解 PNDS Template 自带模块的「模块手册」落在 App 仓库 `docs/zh-CN/modules/` 并随帮助语料离线分发，而不是镜像 Template 仓库的 creator-guide，也不让文档只住 Template 仓库。理由：帮助中心契约（离线打包、en 镜像树、搜索索引、链接解析）全部假设语料住本仓；且体裁不同——模块手册是按模块查用法的手册（排练场/演出机可查），creator-guide 是跟着走的工作流指南（开发机阅读），两边导语互相指认分工。漂移风险由「Template 发版时检查模块手册」的纪律兜住。

## Considered Options

- App 语料镜像/引进 Template 仓库的 creator-guide（否决：跨仓同步是新流程，且指南体裁不合手册需求，收益配不上成本）。
- 模块文档只住 Template 仓库、帮助中心不收（否决：帮助中心全程离线，排练场/演出机上看不到）。
