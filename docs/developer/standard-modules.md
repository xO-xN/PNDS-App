# 离线标准模块与外部 Skills（#173）

App 的目录只包含 客户端连接与身份恢复、monitor 主题、monitor 语言、monitor 视图状态，以及可选 hub 五项技术模块。实际维护源码在 PNDS Template 的 `modules/<id>/`，与原 Template 的示例策略实现分开；外部 Skills 在 pnds-agent-skills 维护。App 使用源码快照，不加载维护者机器目录。

## 固定版本与资料

维护者运行 `node scripts/sync-creation-modules.mjs <Template checkout>` 更新源码、README 和兼容资料。该命令只在开发维护时执行；运行时不联网、不自动复制或升级。`SOURCE.json` 的 revision 为整个文件清单的 SHA-256 内容版本，baseRevision 记录维护基线，避免把未提交源码误记为已有 Git commit。测试核对每个冻结文件与整份清单的哈希。

`compatibility.json` 声明模块版本、Host 协议、运行依赖和作品适配条件。Rust 的显式文件清单必须包括它，并由 `include_bytes!` 固定到二进制。资源完整性和版本一致性在 App 检查中验证。新增条目需同时更新源文件 allowlist、真实临时目录添加测试、工作台流程、双语文案和帮助语料。

## 源码归属和旧版记录

App 只在 backend-issued 创作身份内独占发布新目录，再追加幂等交接。添加不改工程入口或 manifest、不安装依赖、不运行工程。`pnds-module.json` 的来源哈希记录初始加入事实；作者修改后的源码仍由工程维护，不能用哈希变化判为待自动修复。

读取已加入条目以其实际来源、版本和受认可发行的文件集合为依据，不能要求旧版存在新版文件。v0.1.0 的五项来源记录继续可读，原任务 id 由实际版本派生；补写交接使用原文件和版本。未知来源、缺文件或符号链接逃逸仍拒绝操作。更新 App 后旧条目显示实际已加入版本，升级、移除与合并交给外部 agent，不增加覆盖按钮。

同一模块版本也可能有不同源码快照。`PREVIOUS.json` 显式保留已被工程采用的可信快照元数据和原始文件哈希；读取时先匹配来源仓库、工程版本、源码 revision 与模块版本，再按该快照的文件集合校验记录，不拿当前发行哈希否定旧版或作者修改。新增快照前由维护者归档已采用的旧 `SOURCE.json`，同步脚本仅保留并纳入该清单的哈希，不自动扩充可信来源；无改动同步不改变 revision。既有 v0.1.0 继续使用 `LEGACY.json`，未知 revision 和伪造原始哈希仍是冲突。

## 接线验证与技能资源

添加模块使用「模块列表 → 详情」两步浏览：列表以双列卡片展示五项能力，窄窗口改为单列；详情先展示用途、边界、接线与验证说明，真实版本、兼容信息、来源与文件清单默认收在「版本、来源与文件」中；旧版提示、冲突与操作结果始终可见。窗口标题和操作区固定，正文独立滚动。进入详情聚焦标题，返回列表恢复原卡片焦点，关闭后恢复添加按钮焦点。

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

For multiplayer identity and continuous performer/monitor interaction, the App
now preflights local Socket.IO and players at higher priority before edit starts.
It groups missing resources for creator confirmation; current references and
same-task decisions are reused. A working HTTP prototype can be retained by an
explicit creator choice. Pure visual changes do not trigger this migration.

## App 演奏端二维码

QR 已从当前目录和分发文件撤下，保留历史来源记录以读取既有模块来源；工程已有的定制文件不自动删除。当前迁移工程和 Classic 移除自己的 QR 接线，由 App 提供覆盖层。`help/<tree>/modules/qr.md` 及已发布标题保持稳定，内容改为 App 用法与迁移说明。见 [ADR-0013](../adr/0013-app-owned-performer-qr.md)。
