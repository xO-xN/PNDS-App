# #252：按 PNDS 默认规则整理工程

本票只交付默认整理；文字、指定文档／创作资料补充规范及相应冲突由 #253 接入。

已实现的请求入口：

- 助手的「整理工程 / Organize project」以现有 Edit 提交一个明确的默认任务，
  双语规则保存在聊天中的原始目标内。当前输入和未发送选区附件保留且不参与本轮。
- 默认要求读取实际入口、职责和引用，维护移动后加载顺序、路由与资源接线，
  保留既有适合的目录。不能凭文件名删文件或强制迁移到模板。
- 明确保持算法、构成、生成逻辑、艺术参数、声音映射、视觉与演奏交互，
  不引入新依赖、艺术重设计或未指派的性能优化；缺证据或行为将改变时报告阻碍。
- 沿用多文件保存、草稿／版本保护、同任务检查修复与整任务／逐文件撤回；
  活动或可接续任务不会被整理入口静默替换。继续按钮使用原始目标，仍保留未发送想法。

自动化证据：

- `CreationAssistant.test.tsx` 从中英文键盘按钮进入真实 store 和模型请求，核对
  Edit 授权、可见默认任务、未发送输入／附件隔离；网络中断后的继续仍发送原目标。
  准备保存版期间暂停再接续也保留未发送文字／选区，选区不会被发送或消费；
  既有测试继续覆盖输入修改使「继续任务」变成普通发送。
- `assistant-organization-replay.test.ts` 从 `runAssistantRequest` 经真实
  `beginAssistantTask` 读取合成工程的保存版入口、脚本、资源和声音源码，移动脚本并
  更新入口引用。Node VM 从保存后的 module 入口执行，资源相对新脚本的真实 URL
  解析首先产生路径缺失；可修复回放在同一任务内修复、重新检查并恢复原输出。
  首次保存后将 checkpoint 序列化再恢复，后续工具请求仍保持同一默认任务。
  另一回放保留检查失败与部分改动，整任务撤回恢复原文件和目录。
- 独立预期验证种子生成结果 11、脉冲 0.125、颜色、MIDI 48 对应频率及资源内容；
  源码仅改变必要资源引用，声音源码和名为 `unused.js` 的未知用途文件保持原样。
- 原生真实文件和版本边界复用 `assistant_tasks_tests.rs`：
  `structure_edits_refuse_stale_removal_handoff_deletion_and_html_script_names`、
  `removed_files_are_recoverable_after_reopen_and_never_overwrite_recreated_content`、
  `edit_task_recovers_existing_and_new_files_after_reopen_and_refuses_external_changes`、
  `assistant_directory_undo_retains_creator_files_and_later_file_changes` 及
  `coordinated_edit_can_create_more_than_eight_files_and_undo_every_file`。
  本票未新增原生写入通道。脚本回放的 IPC 文件 journal 是系统边界替身，不能替代这些
  原生临时工程测试的真实磁盘证据。

2026-10-20 最终集成验证：`npm run check:all` 全部通过，包含 typecheck、ESLint、
ast-grep、Prettier、Rust fmt、clippy、Vitest 和原生 workspace tests。
前端 227 个测试文件通过、1 个文件跳过，2382 项通过、1 项跳过；
Rust 主套件 693 项通过、7 项按既有条件忽略，其他原生及文档测试均无失败。

## Standards

独立规范审查 0 项实质问题；selector、i18n、既有 Edit 边界、测试和文档符合仓库规则。

## Spec

独立规格审查发现 1 项 P2：准备阶段暂停后接续可能重新捕获未发送附件。
现已在异步准备前固定空附件集，并通过先失败后通过的实际请求回归验证；
复核确认普通已捕获附件仍沿用原校验，0 项遗留问题。最终全量检查在修复合入后运行。

两路审查结论：Standards 0 项；Spec 1 项已修复并复核，无遗留问题。

仍待 #172 实机验收：真实模型是否依据实际工程作合理整理，macOS 键盘／焦点、
窄布局和主题、arm64／x86_64，以及真实画面、声音、演奏交互和艺术效果。
回放的输出相等、格式化或烟雾检查通过均不证明艺术等价；既有 live runtime 的
只读观察不证明新保存源码已加载。需要用户按正常方式启动 dev server 验收。
