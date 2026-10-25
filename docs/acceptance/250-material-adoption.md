# #250：无冲突创作源码采用

实现复用现有 Edit 请求、原生任务 grant、目录与文件 journal；未引入独立执行引擎。

自动化证据：

- `assistant-adoption-replay.test.ts` 从真实 `runAssistantRequest` 进入真实
  `beginAssistantTask`，仅替换系统边界的原生命令。读取当前入口与两份私有源码，
  准备 `public/scores`、采用 Grid／Pattern 并实际接线。运行 fixture 从新保存入口
  逐个求值 Grid → Pattern → monitor，保留原绘画痕迹；首次确实因 palette 路径
  缺失而失败，自动检查结果驱动同任务修复和再次检查，最终资源可达。
- 材料回放拒绝只有部分原文的采用请求，补齐真实范围后才进入任务执行。
- 任务适配器测试覆盖目标及父路径草稿、工程切换后的迟到结果和准确的冲突反馈。
- 原生真实临时工程覆盖私有原件及外部原件保留、资料版本与移除、Discussion、
  工程归属、排除路径、文件／目录符号链接、相同内容复用、适配副本、重启后
  冲突保护及 macOS 大小写别名。碰撞目标不能被同任务通用写入／移除绕过。
- 原生整任务撤回会先拒绝后来创作者修改，逐文件撤回可恢复未冲突入口；原件不变。

本票中的同名不同内容准确阻断并保留双方。逐题选择替换／并存由 #251 补齐，
普通问题回答与资源批准均不构成文件替换授权。

本票 focused 验证：59 个相关 TypeScript 测试、4 个新增原生临时工程测试，
typecheck、lint、ast-grep、Prettier、rustfmt、clippy 通过。完整集成的
`npm run check:all` 由 #242 合并后统一记录，不能将 focused 结果当成完整门禁。

受控模型与 fixture 不证明真实模型的选址／适配判断、真实 macOS App 交互、
视觉或声音效果。这些实际体验仍属于 #172；已有 live runtime 的只读观察也不
证明新保存的代码已加载。
