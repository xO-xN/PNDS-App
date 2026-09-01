# 创作者 agent 的契约文档通道：Template AGENTS.md 持指针，本地帮助语料优先

PNDS Template 仓库以 `AGENTS.md` 作为创作者 AI-coding agent 的入口：按问题索引平台契约文档，读取顺序**本地优先**——装机语料 `PNDS.app/Contents/Resources/help/<tree>/…`（版本与装机 App 严格一致，版本错位问题自动消失），GitHub `main` 为未装机时的 fallback（main 可能领先装机版本，冲突以本地为准）。文档本体继续住 App 仓库（ADR-0002 分工的延伸），Template 只持指针、不镜像；Template 侧原 creator-guide 同步瘦身为「实现手册」（示例实现规格），其工作流与端口接缝归还本仓文档。

后果：装机语料路径 `help/<tree>/…` 从打包实现细节**升格为对外接口**——已分发创作者工程里的 AGENTS.md 持有该路径，重排资源结构即断链，需按兼容性破坏对待。

## Considered Options

- GitHub URL 为主要通道（否决：依赖网络与抓取工具；main 与装机版本存在错位，tag 钉扎可消错位但给 Template 发版引入升 tag 纪律）。
- 文档快照镜像进 Template（否决：ADR-0002 已否决跨仓镜像——新增同步流程，且各创作者 fork 的副本随 App 发版老化，agent 读到过期契约比读不到更糟）。
- 仓库根 llms.txt（否决：agent 的发现入口就是 Template 的 AGENTS.md，`reference/README.md` 已是 markdown 问题式索引；llms.txt 解决零上下文 agent 抵达文档站的发现问题，现阶段无此场景——将来做公开文档站再议）。
