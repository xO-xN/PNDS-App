# 页面交互升格为对外契约（page-interaction.md 参考篇）

工程页面能依赖哪些交互事件（键盘、指针、右键、触摸），原先只存在于英文开发者文档（`docs/developer/keyboard-shortcuts.md`、`docs/developer/app-behavior.md`），创作者无从知晓——演出场景下键位冲突是事故源，且键盘夺回 / 双门控（#105 / #107）这类行为不写下来就永远是谁碰谁懂。决定：参考手册新增「页面交互」篇（`docs/{zh-CN,en}/reference/page-interaction.md`）把键位边界写成精确承诺——原生菜单加速器永不让位、页面交互期间 web ⌘ 层让位、保留键位逐键列表（表 A 永久保留 / 表 B 条件可用），加指针右键透传、顶部避让区与 performer 触屏要求。两种读者两种书：App 使用者的快捷键速查走教程附录，本篇只服务创作者。

## Consequences

- 保留键位表从此是对外接口：App 改键位必须同步 `page-interaction.md`（两树）与 `docs/developer/keyboard-shortcuts.md`——三处漂移即契约破裂。
- 不加自动化同步测试：三处均为散文表格，brittle 校验的维护成本高于漂移风险，靠评审把关。
- 命名刻意避开 input / channel 词汇（与音频输入 / 通道撞车），术语「页面交互 / page interaction」见 CONTEXT.md。

## Considered Options

- 原则性指导不列键位表（否决：模糊指导让创作者踩坑后归咎 App；精确表有 `keyboard-shortcuts.md` 作单一事实源，同步有锚点）。
- 扩写 `runtime-contract.md` §10 而非新篇（否决：该篇已承载 manifest / env / 进程契约，输入话题独立成篇才可被帮助中心按节搜索命中）。
- `input-channels.md` 命名（否决：本域 input / channels 是音频词汇，必被误读为音频输入通道）。
