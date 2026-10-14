# #191 · Template 与 Utilities 实测确认

2026-10-14。用户在收到剩余验收清单后明确回复：「template与四个utilities已经测试完成没问题。1.6.1也已经commit，1.6.2可以commit了，没问题。先不做draft release」。本记录确认对应本地共享工程输入的人工验收，并授权提交 App 1.6.2；不生成 draft release。

## 已确认输入

| 工程                          | 版本  | 对应 issue | 结论                                                      |
| ----------------------------- | ----- | ---------- | --------------------------------------------------------- |
| PNDS Template                 | 0.7.0 | #198       | 用户确认测试完成、无问题；#198 已关闭                     |
| Multichannel Signal Generator | 1.3.0 | #214       | 用户确认测试完成、无问题；仍待固定发布产物和正式 registry |
| Local Network Diagnostics     | 0.7.0 | #215       | 用户确认测试完成、无问题；仍待固定发布产物和正式 registry |
| Telematic Network Diagnostics | 0.7.0 | #216       | 用户确认测试完成、无问题；仍待固定发布产物和正式 registry |
| Mobile Sensor Meter           | 0.4.1 | #217       | 用户确认测试完成、无问题；仍待固定发布产物和正式 registry |

输入对应 App 工作树 `.cache/v1.6.2-candidates/inventory.json` 与 `staged-development-utilities.json`。包哈希和已执行的所属仓库检查见 [实施记录](191-v1.6.2-shared-libraries.md) 与 [入口更新](http-default-performer-entry.md)。用户的整体实测确认补齐前次列出的设备与运行条件；没有另外提供设备型号、测试时长或逐步操作日志，不自行补写这些细节。

## 1.6.1 合流及提交范围

App 集成分支 `codex/v1.6.2-shared-libraries` 已合入 `codex/v1.6.1-modules-skills` 的 `bfd761b`，包含 `84a9220` DNS 状态／重启修复与后期创作 UI 收口。合流使用开始实施时的完整快照比对，保留 1.6.2 的共享库界面、引用契约、完整性缓存、HTTP 默认入口及双语文案；两边 locale 修改的 key 不重叠。没有改动原 1.6.1 工作树。共享库选择器同步采用 1.6.1 的 App Select 规范，现有工程采用测试通过真实菜单选择 ml5 并核对保存的确切引用。

提交前 `npm run check:all` 全绿（exit 0）：前端 134 文件／1548 项，App Rust 392 项、DNS 39 项与重启集成测试 2 项通过，Rust 五项保留显式忽略。检查输出保存在 `.cache/v1.6.2-evidence/commit-162-check-all.log`。提交只收录 App 的 1.6.2 实现、契约说明和验收记录；已有跨版本规划修改继续留在工作区，不把它们当成本次实现。Standards／Spec 提交前审查均无遗留问题；本版规格的旧状态及未纳入文档链接已修正。

## 保留的发行条件

#214–217 仍需已有发布流水线生成真实固定工具产物，核对 ID、版本与 SHA-256 后更新正式 `utilities.json`。目前正式清单仍指向旧的已发布工具，`utilities:fetch`／`tauri:build` 会恢复这些输入，因此用户测过的本地暂存不能冒充正式发行接入。

#199 与父票 #191 保持开放：待工具正式输入齐备后冻结唯一共享版本集，核对最终组合，完成 Apple Silicon／Intel 离线安装运行和实际资源／DMG 相对基线的容量比较。本轮不创建 App 或工具 draft release。
