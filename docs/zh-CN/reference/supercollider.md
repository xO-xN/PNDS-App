# 使用 SuperCollider 作为声音引擎

## SynthDef 编译契约

**契约：SynthDef 符号名 = 产物文件名 = manifest 引用。** 三处必须写同一个名字：

```text
supercollider/source/voice.scd          SynthDef('my-voice', { ... }).add;
                     ↓ 编译
supercollider/synthdefs/my-voice.scsyndef
                     ↓ 引用
manifest.json         "synthdefs": ["supercollider/synthdefs/my-voice.scsyndef"]
```

- `.scd` 源码放 `supercollider/source/`，是**唯一事实源**——不要手改 `.scsyndef`，不要在工程里保留旧的构建脚本；
- 带连字符的名字必须用引号符号写法 `SynthDef('my-voice', …)`（裸标识符不允许连字符）；
- 在**创作模式**打开可编辑的文件夹工程，查看任意 `.scd` 文件时点击工具栏的**「编译 SynthDef」**。它编译当前工程已保存的全部 `supercollider/source/*.scd`，与当前选中的文件无关。演出包安装目录、内置工具和只读文件夹不可编译；
- 先保存或重新载入全部 SCD 和根 manifest 草稿；未解决的磁盘冲突、正在保存的文件也会阻止编译。符合 schema 的 manifest 可先保存缺失的产物引用，再编译补齐。编译中不可重复提交；
- App 依次查找 `/Applications/SuperCollider.app/Contents/MacOS/sclang` 与 `PATH` 中的 `sclang`；
- 控制台显示本次使用的编译器、产物、编译器输出和每一条 `audio.synthdefs` 引用，External、None 模式也全部核对。App 按 [SynthDef 文件头契约](https://doc.sccode.org/Reference/Synth-Definition-File-Format.html) 比对内嵌符号名与文件名；缺失、无效和未核对的引用均会列出；
- 编译先写临时目录，写回前再次核对工程身份及已保存的输入；期间输入或产物变化，请保存或重新载入后再次编译。写回成功更新文件树，并保留重启待办。**请手动重启**应用产物；编译不会刷新页面、启动 session 或替换当前运行版本；
- 常见失败形态：
  - **未装 SuperCollider** → 提示安装地址（https://supercollider.github.io/downloads），或把 `sclang` 放进 `PATH`；
  - **`supercollider/source/` 缺失或没有 `.scd`** → 明确报错，没有东西可编译；
  - **源码编译错误** → 控制台显示 sclang 输出原文（类库横幅已裁掉），据此定位是代码问题还是环境问题；
  - **sclang 超时被终止** → SuperCollider 可能在弹窗等待，关掉其对话框后重试；
  - **名字对不上** → 契约报错，点名缺失的产物与实际产物，改三处中的任意一处对齐即可。

`.scd` 与 `.scsyndef` 的角色划分：`.scd` 只属于创作与调试；App 托管运行时只加载已编译的 `.scsyndef`。

## External Debug Bridge

工程可以提供创作期 `.scd` debug bridge，由创作者手动使用 `sclang` 运行并接收 external 模式的作品自定义 OSC。

该 bridge：

- 不由 PNDS App 启动、管理或打包；
- 不构成平台 OSC 标准；
- 不能替代正式 Internal runtime 的 `.scsyndef`；
- 可以包含作品专属 helper、OSCdef 和声音设计工具。
