# V1.2: sclang SynthDef converter（一键 scd → scsyndef）

> 状态：**未优先化**（`x`），V1.2 候选需求。
> 来源：创作者工作流反馈（PNDS Template 创作指南），2026-08-05 记录。

## 需求

创作者编辑 `supercollider/source/*.scd` 后，需要把 SynthDef 编译为运行时 artifact
`supercollider/synthdefs/*.scsyndef`（Internal 模式只加载编译产物，`.scd` 只是创作期
源码）。目前必须手动运行 `sclang` 编译脚本，创作者希望 **App 内一键完成**。

## 已定方案路径

**App 调用系统安装的 SuperCollider `sclang`**（不随包 sclang）。

理由：

- App 当前不是 sclang runner，规范明确 App 不是 SuperCollider IDE 或 `sclang` runner；
- 随包 sclang 会增加体积与许可维护面；
- 目标用户（PNDS 创作者）是声音设计者，系统通常已装 SuperCollider；
- 该能力属于创作期工具，不属于演出运行时，对现场可靠性无影响。

## 相关现状（2026-08-05）

- 模板工程已建立命名契约：`supercollider/source/template-sine.scd` →
  `supercollider/synthdefs/template-sine.scsyndef`（同名一一对应）；
- 模板自带编译脚本 `supercollider/source/build-synthdef.scd` 与 npm script
  `build:synthdef`，App 一键转换可直接调用同一脚本；
- 编译脚本已验证可在 `sclang 3.14.1`（macOS）下工作，产物可被 App Internal 模式加载。

## 待办要点（实施时展开）

- [ ] App 内入口：工程打开/编辑器场景下提供"编译 SynthDef"按钮
- [ ] 检测系统 `sclang`：`/Applications/SuperCollider.app/Contents/MacOS/sclang`
      （及 PATH 回退）
- [ ] 未安装 SuperCollider 时的可读错误与引导文案
- [ ] 编译失败时透出 sclang stderr
- [ ] 产物路径与 manifest `audio.synthdefs` 的一致性校验
- [ ] 需求文档（`PNDS_APP_REQUIREMENTS.md`）同步：从"当前不要求"移入范围
