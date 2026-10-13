# Monitor view synchronization / monitor 多窗口视图同步

Frozen source: PNDS Template commit `e3f4769537d6aeb2016b76610e80dea7b639384f`, package version 0.5.1. Module delivery version 0.1.0.

Requires Socket.IO and its browser client. Wire attachMonitorState(io.of(namespace), { events, defaults }) and PNDSClient.connectMonitor({ io, port, events, hostname, monitorNamespace: namespace }). Declare only low-frequency view keys. Wait for viewState snapshot; send setViewState and render broadcasts. State ends with the score server. / 需要 Socket.IO 及浏览器客户端。接入 attachMonitorState 和 PNDSClient.connectMonitor；仅声明低频视图键，等待 viewState 快照，调用 setViewState 后依据广播渲染。状态生命周期止于工程 server 退出。

Files added only / 仅加入文件：wiring and runtime validation are pending / 接线与运行验证待完成。The App never edits entries, installs dependencies or Skills, or starts the project / App 不改入口、不安装依赖或 Skills、不启动工程。

Keep project-specific changes. This is not an upgrade or removal tool. Review `docs/creator-handoff.md` and the installed `help/<tree>/reference/runtime-contract.md` before wiring. / 保留作品定制；此操作不是升级或移除工具。接线前阅读创作交接单与装机运行契约。
