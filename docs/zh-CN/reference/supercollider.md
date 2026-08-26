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
- 编译入口在 **App → 设置（⌘,）→ 开发者工具 →「编译 SynthDef」**，默认作用于当前选中工程，也可「浏览…」选择任意文件夹；
- App 依次查找 `/Applications/SuperCollider.app/Contents/MacOS/sclang` 与 `PATH` 中的 `sclang`；
- 编译完成后 App 逐个点名校验 manifest 引用的产物：缺哪个、这次实际产出了哪些，都会精确列出；
- 常见失败形态：
  - **未装 SuperCollider** → 提示安装地址（https://supercollider.github.io/downloads），或把 `sclang` 放进 `PATH`；
  - **`supercollider/source/` 缺失或没有 `.scd`** → 明确报错，没有东西可编译；
  - **源码编译错误** → 错误通知显示 sclang 输出原文（类库横幅已裁掉），据此定位是代码问题还是环境问题；
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
