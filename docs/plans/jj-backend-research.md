# jj 作为创作工程版本后端的资料评估

状态：研究笔记，未采纳、未实施；不改变现有产品契约。检索日期：2026-10-25。范围是 App 内创作者工程版本管理，不是 PNDS App 源码仓库的开发工作流。

## 结论

**判断：当前不宜直接替换；适合在“并行探索、可撤销历史编辑、多个 agent 独立工作区”成为产品重点时做隔离原型。** jj 的核心收益来自不同的数据模型；若保留当前全部交互与边界，收益会缩小，迁移成本仍在。采用 jj 的 Git backend 也不是放弃 Git 对象格式和 GitHub 生态。

现有约束以 [Local Git](../developer/local-git.md)、[ADR-0011](../adr/0011-creator-git-version-navigation.md) 和 [CONTEXT](../../CONTEXT.md) 为准：工程版本由创作者主动保存；已有版本分叉、历史比较和守卫式切换；聊天、任务恢复和工程版本分别独立；生产操作使用内嵌 git2/libgit2，不启动 Git 可执行程序，也不暴露远程操作。

## 已核实的上游事实及对应影响

| 主题         | 官方事实                                                                                                                                                                                                                                                                                                                                      | 对 PNDS 的判断                                                                                                                                                 |
| ------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 发布状态     | 检索时最新发布为 v0.46.0（2026-10-07）；该版增加以 Git worktree colocate 次级 workspace，并提高 Git 最低版本至 2.42.0、Rust MSRV 至 1.97.1。[发布说明](https://github.com/jj-vcs/jj/releases/tag/v0.46.0)                                                                                                                                     | 必须固定评估版本；“jj 不支持 Git worktree”已不适合作绝对结论。                                                                                                 |
| 工作副本     | 多数命令会将磁盘工作副本更新到 working-copy commit；新文件默认自动跟踪，ignore 与 `snapshot.auto-track` 可限制范围。它不是逐次按键备份，也不能捕获编辑器尚未保存的内存草稿。[Working copy](https://docs.jj-vcs.dev/latest/working-copy/)                                                                                                      | 自动恢复点可能更自然，但查看状态也可能写仓库；“内部快照”必须与主动保存的“工程版本”分开，否则与 ADR-0011 冲突。                                                 |
| 无 index     | jj 没有 Git 式显式暂存区；支持匿名分支，改写祖先后自动 rebase 后代。[README](https://github.com/jj-vcs/jj#features)                                                                                                                                                                                                                           | 可减少底层 index/branch 操作，但 App 已替创作者隐藏大部分 Git 概念，单纯换后端的可见收益有限。                                                                 |
| 操作撤销     | operation log 保存仓库 view（引用、heads、各 workspace 当前提交等），支持 undo、revert 特定操作及恢复旧 view。[Operation log](https://docs.jj-vcs.dev/latest/operation-log/)                                                                                                                                                                  | 更适合提供“撤销刚才的版本操作”。它不是 App 全状态事务：内存草稿、忽略文件、聊天、运行进程和授权仍由 App 管理，也不能把本地 undo 说成撤回远端 push。            |
| 冲突模型     | 冲突可作为提交中的结构化状态保存；rebase 可完成后再解决冲突，修改祖先可传播至后代。[Conflicts](https://docs.jj-vcs.dev/latest/conflicts/)                                                                                                                                                                                                     | 未来 AI 并行尝试与方案整合获益明显；当前产品不包含合并，直接收益小。若开放此能力，需要明确“有冲突但已记录”和“可运行版本”的区别。                               |
| 版本与命名   | bookmark 是命名指针，改写版本时跟随移动，没有当前 checkout bookmark 的概念，和 Git 交互时映射为分支。[Bookmarks](https://docs.jj-vcs.dev/latest/bookmarks/)                                                                                                                                                                                   | 当前分支提示、保存后自动推进路线和稳定版本显示名须由 App 明确实现；不应把 `jj describe` 当成只改显示名，它改写提交。                                           |
| Git 互操作   | colocated 模式共用 `.git` 与工作副本，并自动 import/export；Git staging area 被忽略，HEAD 通常分离。混合写入可能造成分歧，Git 工具难以理解 jj 的冲突提交。[Git compatibility](https://docs.jj-vcs.dev/latest/git-compatibility/)                                                                                                              | 外部 Git agent/IDE 可继续参与，但“兼容”不是原有暂存、分支和冲突行为完全不变。App 仍需保护外部暂存及检查并发修改。                                              |
| 媒体与排除   | 新文件默认快照大小门槛是 1 MiB，可配置，已跟踪文件不受这一门槛限制。[Configuration](https://docs.jj-vcs.dev/latest/config/#maximum-size-for-new-files) 官方兼容表仍列 Git LFS 不支持。[Git compatibility](https://docs.jj-vcs.dev/latest/git-compatibility/#supported-features)                                                               | 不能解决大音频/视频资源历史膨胀；需保留 App 的敏感文件、`.pnds-creation/`、缓存和容量规则，并在首次快照前生效。默认 1 MiB 也不能替代现有总量及已跟踪文件上限。 |
| 嵌入 API     | 架构将 `jj-lib` 与 CLI 分离，库设计面向 GUI/TUI/服务器。[Architecture](https://docs.jj-vcs.dev/latest/technical/architecture/#separation-of-library-from-ui) 官方 FAQ 明说库 API 和 CLI 都尚不稳定。[FAQ](https://docs.jj-vcs.dev/latest/faq/#i-want-to-write-a-tool-which-integrates-with-jujutsu-should-i-use-the-library-or-parse-the-cli) | Rust 内嵌可行；不能由“都是 Rust”推导为低成本替换。需承担固定版本、API 适配和仓库存储升级验证。                                                                 |
| macOS 分发   | v0.46.0 提供 arm64 与 x86_64 macOS 预编译包；压缩包分别约 9.61 MB、10.2 MB。[发布附件](https://github.com/jj-vcs/jj/releases/expanded_assets/v0.46.0) 官方安装文档要求 Git 2.42.0 以上。[Installation](https://docs.jj-vcs.dev/latest/install-and-setup/#runtime-requirements)                                                                | CLI 方案增加二进制分发、签名及环境隔离成本。压缩包大小不等于 App 净增大小；本次未测量。局部内嵌路径能否完全免 Git 进程必须按调用路径验证。                     |
| 并发与工作区 | jj 可维护多个独立工作副本；operation log 支持发现和合并并发操作。官方技术文档也保留 Git backend、分布式文件系统和 colocated 同步的已知风险说明。[Concurrency](https://docs.jj-vcs.dev/latest/technical/concurrency/)                                                                                                                          | 多 agent 的独立 workspace 有价值；同目录并发写文件并不会因此安全，运行租约、预览 token 与文件新鲜度核对仍必要。不能把同步盘容错宣传成无条件安全。              |

## 两条集成路径

**内嵌固定版本 `jj-lib`** 最接近现有原生引擎结构，避免文本输出解析，可由 App 控制事务、配置和错误映射。代价是适配复杂模型与不稳定 API。是否能仅用所需本地能力而不启动 Git 子进程，应由源码审计与断言测试决定，不能套用整个 CLI 的要求，也不能提前保证。

**捆绑固定版本 CLI** 可较快验证体验，但不应依赖用户 PATH 上的任意版本。需固定模板输出、禁用 pager/editor/外部工具、隔离配置与环境，并约束可调用子命令。官方 `--ignore-working-copy` 可跳过快照和更新，但读取的是可能过期的工作副本提交；因此只读历史和实时磁盘差异仍需分别设计。[CLI reference](https://docs.jj-vcs.dev/latest/cli-reference/#jj)

当前已存在的预览确认、敏感路径排除、限量、编辑器同步、任务结束和运行停止边界不会因上述任一方案消失。实现若改变这些约束，需要重开对应产品决策，而不是视作引擎实现细节。

## 对当前实现的具体迁移影响

- **固定工程版本与身份**：jj 改写提交时 change ID 通常不变，commit ID 改变；同一 change 还可能存在分歧。[Glossary](https://docs.jj-vcs.dev/latest/glossary/#rewrite) 因而 change ID 适合串联修改过程，不能独自证明“测试过的工程内容没有变”。主动保存的工程版本应绑定具体 commit/tree 及现有内容证据，并在其上创建新工作 change。jj 提供可配置 immutable heads，但其默认集合不等于全部 PNDS 保存版本，且 CLI 可覆盖保护；App 必须自己限制改写入口。[Immutable commits](https://docs.jj-vcs.dev/latest/config/#set-of-immutable-commits)
- **显示名保持独立**：现有 [`git_version_names.rs`](../../src-tauri/src/project/creation/git_version_names.rs) 用 `pndsVersion.<oid>.display` 保存显示名，不重写内容或父子关系。迁移不能用 `jj describe` 偷换这一语义，也需处理旧显示名和旧版本链接。
- **只读是现有可测试合同**：[`git_tests.rs`](../../src-tauri/src/project/creation/git_tests.rs) 验证检查不会改变对象、index 或工作文件，且不会运行外部 helper。任何默认快照、配置驱动的外部工具或隐式 import 行为都要重新约束。
- **撤回属于不同事务**：现有[助手任务撤回](../developer/creation-assistant.md)核对任务拥有的路径、版本和当前字节，避免覆盖后来编辑；jj 全仓操作撤销不能直接替代它。运行状态、聊天和执行授权也不属于 jj view。
- **`.jj` 元数据必须隔离**：当前 [`bundle.rs`](../../src-tauri/src/project/bundle.rs) 的 `is_excluded` 排除 `.git*`、[`creation.rs`](../../src-tauri/src/project/creation.rs) 的文件树遍历排除 `.git`，两处均未明确排除 `.jj`。迁移应在初始化前补齐打包、工程树、助手扫描和监视器边界，避免将仓库内部记录作为素材或运行产物带出。这是现有代码观察，不是已经修复的事项。

## 验证价值与未决项

若继续探索，建议用一次性工程副本对比三种任务：从旧工程版本分叉继续创作；两个独立 workspace 生成候选方案后采纳；误切换或误改写后的恢复。保留当前用户可见的主动保存语义，让 jj 自动快照仅作为内部恢复记录。成功标准是减少实现复杂度或改善真实创作操作，而非减少 Git 命令数量。

需要验证的未知量包括：真实音频工程的扫描延迟和仓库增长；arm64/x86_64 包体与签名；只读查看是否零写入；外部暂存和外部 Git 写入后的行为；一次性预览失效；中断和磁盘满后的恢复；旧版本 App 打开新格式仓库；普通 Git clone 能保留哪些工程版本及显示名；`.jj` 是否被工程树、文件监视器、打包器和助手材料扫描一致排除。以上均是评估范围，本次没有执行迁移或性能实验。

官方 latest 文档存在滞后：Git compatibility 的 git-worktree 条目与 v0.46.0 发布说明不一致。本文对次级 workspace 能力采用发布说明和 CLI reference，并不把它扩大成任意历史 Git worktree 布局都可无损直接接管。其他有歧义的兼容性结论也应在固定版本原型中确认。
