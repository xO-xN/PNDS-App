# Monitor theme following / monitor 主题跟随

Frozen source: PNDS Template commit `e3f4769537d6aeb2016b76610e80dea7b639384f`, package version 0.5.1. Module delivery version 0.1.0.

No dependencies. Serve theme-follow.js and load it only in monitor. Set PNDS_THEME_OPTIONS before loading to map CSS variables or supply onTheme for custom drawing. First frame reads ?theme; later Host messages are idempotent. Use the installed runtime contract. / 无依赖。提供 theme-follow.js 并只在 monitor 加载；提前设置 PNDS_THEME_OPTIONS 可映射 CSS 变量或通过 onTheme 更新自绘画面。首帧读取 ?theme，之后幂等应用 Host 消息。遵守装机运行契约。

Files added only / 仅加入文件：wiring and runtime validation are pending / 接线与运行验证待完成。The App never edits entries, installs dependencies or Skills, or starts the project / App 不改入口、不安装依赖或 Skills、不启动工程。

Keep project-specific changes. This is not an upgrade or removal tool. Review `docs/creator-handoff.md` and the installed `help/<tree>/reference/runtime-contract.md` before wiring. / 保留作品定制；此操作不是升级或移除工具。接线前阅读创作交接单与装机运行契约。
