# QR joining / QR 加入

Frozen source: PNDS Template commit `e3f4769537d6aeb2016b76610e80dea7b639384f`, package version 0.5.1. Module delivery version 0.1.0.

Requires qrcode. Pass the resolved full performer URL to qrHandler(url), serve its PNG from your monitor server and display it in your own monitor UI. / 需要 qrcode。将解析后的完整 performer 地址传给 qrHandler(url)，由 monitor server 提供 PNG，再接入作品页面。

Files added only / 仅加入文件：wiring and runtime validation are pending / 接线与运行验证待完成。The App never edits entries, installs dependencies or Skills, or starts the project / App 不改入口、不安装依赖或 Skills、不启动工程。

Keep project-specific changes. This is not an upgrade or removal tool. Review `docs/creator-handoff.md` and the installed `help/<tree>/reference/runtime-contract.md` before wiring. / 保留作品定制；此操作不是升级或移除工具。接线前阅读创作交接单与装机运行契约。
