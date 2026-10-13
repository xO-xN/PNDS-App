# Monitor language following / monitor 语言跟随

Frozen source: PNDS Template commit `e3f4769537d6aeb2016b76610e80dea7b639384f`, package version 0.5.1. Module delivery version 0.1.0.

No dependencies. Serve locale-follow.js and load it only in monitor. Set PNDS_LOCALE_OPTIONS before loading with locales, fallback and onLocale; supply your own string tables. First frame reads ?lang. / 无依赖。提供 locale-follow.js 并只在 monitor 加载；提前配置 PNDS_LOCALE_OPTIONS 的 locales、fallback 和 onLocale，作品自行提供字符串表。首帧读取 ?lang。

Files added only / 仅加入文件：wiring and runtime validation are pending / 接线与运行验证待完成。The App never edits entries, installs dependencies or Skills, or starts the project / App 不改入口、不安装依赖或 Skills、不启动工程。

Keep project-specific changes. This is not an upgrade or removal tool. Review `docs/creator-handoff.md` and the installed `help/<tree>/reference/runtime-contract.md` before wiring. / 保留作品定制；此操作不是升级或移除工具。接线前阅读创作交接单与装机运行契约。
