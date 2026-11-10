# 离线标准模块与外部 Skills（#173）

App 的目录包含客户端连接与身份恢复、monitor 主题、monitor 语言、monitor 视图状态、可选 hub，以及设备运动、设备麦克风、离线 HandPose 三项可选输入，共八项技术模块。实际维护源码在 `PNDS-1.6.2-projects/PNDS Template/modules/<id>/`，与旧的父目录 Template 和示例策略实现分开；外部 Skills 在 pnds-agent-skills 维护。App 使用源码快照，不加载维护者机器目录。

## 固定版本与资料

维护者运行 `node scripts/sync-creation-modules.mjs <Template checkout>` 更新源码、README 和兼容资料。该命令只在开发维护时执行；运行时不联网、不自动复制或升级。`SOURCE.json` 的 revision 为整个文件清单的 SHA-256 内容版本，baseRevision 记录维护基线，避免把未提交源码误记为已有 Git commit。测试核对每个冻结文件与整份清单的哈希。

只采用指定模块时，在 checkout 后传模块 ID，例如 `device-motion device-microphone camera-handpose`。
这会保留其余已认可的 App 快照，再对完整目录重新计算内容版本；不能让维护目录里
无关的旧源码覆盖已经交付的 App 修复。维护源的原有 hub 与 #321 的 App 快照目前
不同，本轮只同步三项传感输入，不以传感模块更新为由回退或改写 hub。

`compatibility.json` 声明模块版本、Host 协议、运行依赖和作品适配条件。Rust 的显式文件清单必须包括它，并由 `include_bytes!` 固定到二进制。资源完整性和版本一致性在 App 检查中验证。新增条目需同时更新源文件 allowlist、真实临时目录添加测试、工作台流程、双语文案和帮助语料。

## 源码归属和旧版记录

手动添加只在 backend-issued 创作身份内独占发布新目录，再追加幂等交接；不改工程入口或 manifest、不安装依赖、不运行工程。聊天采用复用同一来源与发布保护，由当前工作任务记录必要依赖和接线，见下方 Assistant adoption。`pnds-module.json` 的来源哈希记录初始加入事实；作者修改后的源码仍由工程维护，不能用哈希变化判为待自动修复。

读取已加入条目以其实际来源、版本和受认可发行的文件集合为依据，不能要求旧版存在新版文件。v0.1.0 的五项来源记录继续可读，原任务 id 由实际版本派生；补写交接使用原文件和版本。未知来源、缺文件或符号链接逃逸仍拒绝操作。更新 App 后旧条目显示实际已加入版本，升级、移除与合并交给外部 agent，不增加覆盖按钮。

同一模块版本也可能有不同源码快照。`PREVIOUS.json` 显式保留已被工程采用的可信快照元数据和原始文件哈希；读取时先匹配来源仓库、工程版本、源码 revision 与模块版本，再按该快照的文件集合校验记录，不拿当前发行哈希否定旧版或作者修改。新增快照前由维护者归档已采用的旧 `SOURCE.json`，同步脚本仅保留并纳入该清单的哈希，不自动扩充可信来源；无改动同步不改变 revision。既有 v0.1.0 继续使用 `LEGACY.json`，未知 revision 和伪造原始哈希仍是冲突。

## 接线验证与技能资源

添加模块使用「模块列表 → 详情」两步浏览：列表以双列卡片展示各项能力，窄窗口改为单列；详情先展示用途、边界、接线与验证说明，真实版本、兼容信息、来源与文件清单默认收在「版本、来源与文件」中；旧版提示、冲突与操作结果始终可见。窗口标题和操作区固定，正文独立滚动。进入详情聚焦标题，返回列表恢复原卡片焦点，关闭后恢复添加按钮焦点。

首次打开先读取目录，再一次性展示内容；等待期间添加按钮显示忙碌状态并禁止重复请求。不要先展示只有加载文字的短弹窗，再填充卡片，否则居中布局会随高度突变而向上跳动。读取失败同样打开弹窗，保留重新读取入口；迟到结果仍受工程身份和请求代次保护。

「文件已加入」只来自工程来源记录，不表示已经接线或验证；App 不推断交接任务的完成状态。已加入项可打开现有 `docs/creator-handoff.md`，沿用文件编辑器中的未保存草稿，不触发保存、重复添加或运行。冲突项保留详情供检查并禁用添加。

App 的测试使用真实复制结果、来源记录与工作台 typed command。模块运行测试使用同一冻结源码，经实际 HTTP/Socket.IO 公共接口验证；浏览器、App、手机与声音结果分别记录，不能用 none health 或文件复制替代。

hub 配置按 Host 环境变量是否存在判断来源：四项中任一键存在（即使值为空），整组就由 Host 掌管，不用 standalone 值补齐；只有四项键都不存在时才采用工程明确提供的 standalone 配置。通过模块公开的配置解析与启动状态测试这个边界，空值配置报告未配置并保留本地控制自治。

外部 PNDS Skills 是自愿安装的辅助能力。统一入口组合五项独立能力，通用移植先评估和作者确认，CM1 保留显式课程入口。普通任务默认交源工程、决定、验证与交接记录，明确分发才生成工程包；课程要求两者。资料优先读取装机 `help/<tree>/`，版本错位或缺资源如实记录。App 不安装或执行外部 Skills。独立能力的分发目录包含所需资料与工具，分发构建核对声明资源，不能隐式依赖已安装兄弟 Skill。

### Assistant adoption

The edit assistant discovers the standard catalog with `get_local_resources`,
proposes new modules and shared packages as one creator-confirmed task plan, and
uses `use_local_module` only after confirmation (or for an existing module).
See [Creator-confirmed local resources](./creation-assistant.md#creator-confirmed-local-resources-2026-10-20).
Manual module addition keeps its existing handoff workflow. Assistant adoption
shares frozen assets, provenance and exclusive publication, but records the
entire addition in task recovery/undo and wires it within the original edit goal.
It does not assign itself a handoff TODO. Existing/custom module source is never
replaced by frozen files just because it has an older version.

Hub adoption expands its exact Node `socket.io-client` dependency in native
resource selection. One approval covers the capability and missing dependency;
module adoption records the shared reference and root production declaration in
the same task. Exact existing resources are reused, while differing versions
fail explicitly. The current module loads the verified absolute shared entry;
adding only a manifest reference cannot repair a customized bare import.
The assistant reads and wires actual project events, Host configuration and
shutdown without replacing customized sources. See
[hub adoption rules](./creation-assistant.md#optional-hub-dependency-adoption-321)
and [the #321 evidence](../acceptance/321-hub-resource-adoption.md).

For multiplayer identity and continuous performer/monitor interaction, the App
now preflights local Socket.IO and players at higher priority before edit starts.
It groups missing resources for creator confirmation; current references and
same-task decisions are reused. A working HTTP prototype can be retained by an
explicit creator choice. Pure visual changes do not trigger this migration.

## App 演奏端二维码

QR 已从当前目录和分发文件撤下，保留历史来源记录以读取既有模块来源；工程已有的定制文件不自动删除。当前迁移工程和 Classic 移除自己的 QR 接线，由 App 提供覆盖层。`help/<tree>/modules/qr.md` 及已发布标题保持稳定，内容改为 App 用法与迁移说明。见 [ADR-0013](../adr/0013-app-owned-performer-qr.md)。

## Generated Blank identity foundation (#317)

New Blank projects include the frozen players core with `defaultWiring: true`
in the public resource catalog. Their provenance record says
`wiring: blank-default-v1`, has no handoff task, and retains the original frozen
file hashes. Catalog/adoption are idempotent, do not create a fictional handoff,
and never replace creator edits. Only unchanged shipped default bytes are
excluded from authored-content summaries; an edited module remains visible.
Manual module adoption in existing projects keeps its pending wiring workflow.

The generated `players/policy.js` is a no-seat policy for the common players
protocol. It persists only project-scoped random claim → performer UUID mappings
in private `.pnds-creation/players.json`; no score selection, controls, touches,
sound or channels are restored between server runs. First publication uses an
exclusive private temporary file, fsync, atomic rename and directory sync.
Corruption, wrong project, non-private/link targets and persistence errors fail
explicitly. An uncertain write blocks further admissions until a restart reads
the durable truth. The existing private-directory rules exclude claims from
Git, ordinary source tools, source fingerprints and default `.pnds` bundles;
a complete filesystem copy carries them. HTTP serves the bounded public tree and
only the two explicit default-module client entries. Every project-owned file
route, including monitor HTML, pinned monitor source and preview declarations,
uses the same current canonical containment/hidden-path guard and a held regular
file descriptor. The public tree keeps its narrower boundary; explicit module
entries may resolve safe ordinary project files, but never external or hidden
components such as .pnds-creation/.git, even through an alias. Unsafe/missing or
nonregular entries return 404 for GET/HEAD; normal saved author edits and safe
internal links stay applicable without frozen-content hashes. Preview digests
still identify the actual loaded bytes; a prior valid pin never adopts later
filesystem bytes.

Every effective control/action/release and joined response checks the current
socket owner. A new connection with the same claim retires its old socket;
old queued work, duplicate joins and late disconnects cannot release the new
owner. This changes logical identity only and never transfers camera/microphone
ownership. Monitor sockets do not allocate identities.

The performer uses `PNDS_PARTICIPATION.storageKey` (Host/project scope), never a
performance ID. Standalone uses its own manifest project ID. Existing native
test-window labels (`pndsTestClient`) add independent claim suffixes; display
numbers and physical Mac identity do not become performer IDs. Browser storage
failure is visible and cannot report successful page preparation or restoration.
The Host's explicit entry gate for each new performance remains in force.

Blank's storage adapter tracks read/write failures independently of the generic
connector's transient `connect_error` text. Only configuration, storage and
admission failures close the connector. A transport outage displays feedback
while the same page and connector keep reconnecting; the next accepted join
clears the error. A successful initial preparation is not repeated as a claim
that a later network recovery has already happened.

## Blank monitor defaults (#318)

Generated Blank includes the current frozen monitor-state module with an integrated default source record, not a fabricated handoff TODO. Its editable `public/monitor-view.json` is empty until the work declares actual low-frequency fields. `lib/monitor-view.js` enforces default JSON types, optional choices/numeric limits and delegates full snapshots to the frozen source. The server creates `/monitor-view` only on the monitor HTTP server and only when declarations are nonempty. The monitor exposes `window.PNDSMonitorView`, opens no extra logical connection while empty, renders only complete server snapshots and closes its own view socket on page release. The running schema is served from the startup snapshot; an author save requires a restart. The startup declaration read itself uses the same bounded public-file guard before audio/listeners start. Private/external/hidden or nonregular declaration aliases explicitly fail boot; a valid-looking JSON schema never authorizes caching and publishing those bytes. Safe ordinary internal public aliases remain applicable. Schema validation still fails fast, and a successfully loaded schema remains that run's fixed snapshot after later path edits.

Do not use this path for claim/identity, score time, sound, high-frequency input or App QR/projection state. Keep installed help paths and their existing headings stable. The historical frozen generic README is preserved as source provenance; current Blank guidance supersedes its old project-owned showQr example. Actual main/projector UI acceptance is distinct from public generated-project HTTP/Socket.IO/page-script tests.
