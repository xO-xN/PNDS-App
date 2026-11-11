# 创作者 agent 优先读取装机契约

Blank 工程的 `AGENTS.md` 指向装机帮助 `PNDS.app/Contents/Resources/help/<tree>/…`。装机语料与 App 版本一致。未安装时使用 GitHub `main` 上的参考手册。工程自己的 `docs/implementation.md` 记录实际实现。

`help/<tree>/…` 是已经分发到工程的对外路径。保留路径和文档 ID，标题改名按[帮助中心](../developer/help-center.md)规则兼容。

## Considered Options

- 优先读取仓库文档需要网络，且可能领先装机版本。
- 在工程中复制契约会让副本随 App 更新而过期。
