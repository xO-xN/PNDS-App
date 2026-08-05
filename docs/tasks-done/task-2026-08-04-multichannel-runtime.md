# Task 2: 多声道 manifest、设备能力与 Internal runtime

目标 release：PNDS App `1.1.0`。

规范引用：

- `PNDS_SCORE_PROJECT_SPECIFICATION.md` §3、§6
- `PNDS_RUNTIME_CONTRACT.md` §3、§7、§8、§11
- `PNDS_APP_REQUIREMENTS.md` §3、§6、§12

## 目标

实现 1–64 路离散 Internal 输出的后端契约：解析工程声明、按设备能力计算 `N/H/K/B`、以 K 路打开 scsynth，并通过专用 mono master group 桥接到硬件输出。

## 依赖与边界

- 前置：Task 1。
- 本任务包含设备能力的 Rust 数据源和 session 计算；设备选择器视觉交互在 Task 3。
- PNDS 不实现扬声器布局、声道标签、downmix、复制、重排或 PA 校准。
- 通道不足不是错误；无法取得有效设备能力或 `H = 0` 才阻止 Internal 启动。
- 不通过解析 scsynth stdout/stderr 推断设备通道数。

## 工作内容

### 1. Manifest 与 preflight

调整 `src-tauri/src/project/manifest.rs`：

- 为 `audio.outputChannels` 增加向后兼容可选字段，反序列化缺省值为 `2`；
- 只接受整数 `1..=64`；
- schemaVersion 保持 `1`；
- Internal 工程强制 `audio.scsynth.audioBusChannels >= 2 × outputChannels`；
- 错误信息包含字段名、声明值与最低需要值。

重新生成 tauri-specta TypeScript bindings，并更新所有 manifest fixture。

### 2. Sample-rate-aware 设备能力

扩展 `src-tauri/src/project/audio.rs` 与 typed command：

- 使用 CPAL/CoreAudio 的 supported output configs；
- 对指定工程 sample rate 计算每个设备可用输出通道数；
- 返回结构化设备项，而不是只返回名称字符串；
- 明确标识系统默认设备及其能力；
- 同一设备有多个支持该 sample rate 的配置时，取可用最大输出通道数；
- 设备枚举失败、sample rate 不支持或无输出通道时提供可诊断错误。

### 3. `N/H/K/B` session 模型

Internal 启动时计算并保存：

```text
N = manifest.audio.outputChannels
H = selected/default device channels at manifest sampleRate
K = min(N, H)
B = K
```

- scsynth 使用 `-o K`；
- 注入 `PNDS_AUDIO_OUTPUT_BUS=B`；
- 注入 `PNDS_AUDIO_OUTPUT_CHANNELS=N`；
- session snapshot/log 记录 N、H、K、B 和最终设备；
- restart、错误清理和 orphan cleanup 不遗留多声道状态。

### 4. Mono master group

替换当前固定立体声 master：

- `pndsMaster` 改为 mono：`In.ar(in, 1) -> Lag/gain -> Out.ar(out, 1)`；
- 创建一个位于 root group 尾部的专用 master group；
- 在 group 内创建 K 个实例，实例 `i` 从 `B+i` 读、向硬件 `i` 写；
- 使用 Runtime Contract 保留范围 `2147480000..=2147483647` 内的集中管理 group/node ID；
- Runtime Contract 要求工程在 health ready 前创建 audio root group，之后所有动态音频节点只能加入该既有 group 树；
- gain 更新作用于整个 master group；
- 关闭时先释放 master group，再退出 scsynth；
- 任一 SynthDef/group/instance 创建失败都使 session 失败并完整清理。

更新 `src-tauri/resources/synthdefs/source/pnds-master.scd`、编译 artifact 与相关打包配置。

### 5. Master gain 规则

- `N <= 2`：保留既有百分比到 dB 曲线和每 session 80% 默认值；
- `N > 2`：后端固定 `100% / 0 dB`；100% 更新可成功 no-op，非 100% master 更新返回可诊断错误；
- External/None 不创建 master stage。

## 自动测试

至少覆盖：

- outputChannels 缺省、1、2、16、64；
- 0、负数、非整数、65 被拒绝；
- `audioBusChannels = 2N` 通过，`2N-1` 失败；
- sample rate 能力筛选与最大通道选择；
- `K = min(N,H)`、`B = K`，包括 16→2；
- scsynth 参数使用 `-o K`；
- env 注入使用 B 和 N，而不是固定 2；
- K 个 mono master 实例的 in/out 映射；
- group gain 更新、创建失败清理与关闭释放；
- 只有 K 个 master instances 全部确认创建后才发出 `ready` snapshot；
- health ready 后在既有工程 group 内动态创建 synth 时，执行顺序仍早于 master group；
- App 保留 node ID 与工程 node ID 不冲突；
- N>2 固定 unity gain，非 100% command 失败，N<=2 曲线不回归。

## 验收

- 2ch 旧工程不增加 `outputChannels` 也能按原行为启动。
- 16ch 工程在 16ch 设备上创建 16 路硬件桥。
- 16ch 工程在 2ch 设备上仍进入 ready，只桥接前 2 路。
- 工程始终向 B 开始的 N 个 private buses 写信号；App 不 downmix。
- 日志清楚记录设备能力和 `N/H/K/B`，失败可诊断。
- `npm run check:all` 通过。
