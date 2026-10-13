# Client identity and reconnect / 客户端身份与重连

Frozen source: PNDS Template commit `e3f4769537d6aeb2016b76610e80dea7b639384f`, package version 0.5.1. Module delivery version 0.1.0.

Requires Socket.IO and its browser client. Wire PlayerRegistry, SeatsStore and attachProtocol to your server and PNDSClient.connectPerformer to your performer page. Inject event names and a projectAudio adapter. The Template numeric seats and output routing are examples: agree your identity, persistence and sound policy before adapting. / 需要 Socket.IO 及浏览器客户端。服务端接入 PlayerRegistry、SeatsStore、attachProtocol；performer 接入 PNDSClient.connectPerformer。事件名、音频适配、身份和持久化规则由作品决定；模板数字座位和输出路由仅为示例。

Files added only / 仅加入文件：wiring and runtime validation are pending / 接线与运行验证待完成。The App never edits entries, installs dependencies or Skills, or starts the project / App 不改入口、不安装依赖或 Skills、不启动工程。

Keep project-specific changes. This is not an upgrade or removal tool. Review `docs/creator-handoff.md` and the installed `help/<tree>/reference/runtime-contract.md` before wiring. / 保留作品定制；此操作不是升级或移除工具。接线前阅读创作交接单与装机运行契约。
