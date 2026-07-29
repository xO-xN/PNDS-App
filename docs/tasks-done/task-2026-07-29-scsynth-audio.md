# Task 4: 内置 scsynth、private bus 与 Master Synth

对应 Phase 4。需求引用：§6.1–§6.4、§8.1（启动顺序）。

## 目标

Internal 模式下 App 启动内置 scsynth，工程输出经 private bus 进入 App Master Synth，音量控制生效。

## 决策记录（2026-07-29 确认）

- scsynth 来源：本机 SuperCollider **3.13.0**（universal 二进制），`lipo -thin arm64` 提取 arm64 slice 打包；随包附 GPL-3.0 许可文本与源码地址（mere aggregation，App 保持 MIT）
- 启动参数补充 **`-B 127.0.0.1`**（§6.2 已更新）：OSC 仅监听本机回路
- Master Synth `pndsMaster` 编译已自动化：`npm run synthdefs:build`（`scripts/build-synthdefs.sh` + `src-tauri/resources/synthdefs/source/pnds-master.scd`，开发期依赖本机 sclang）
- 音量曲线：**dB 线性插值**，`100% = 0 dB`、`80% = -6 dB`（默认、每 session 固定）、`0%` 静音；仅 Internal 可用

## 工作内容

- scsynth 进程管理：按 §6.2 参数启动（`-i 0 -o 2 -r -z -a -u <动态端口> -B 127.0.0.1`），等待 `/status` 应答
- 动态 UDP 端口分配；注入 `PNDS_OSC_TARGET=127.0.0.1:<port>`、`PNDS_AUDIO_OUTPUT_BUS=2`、`PNDS_AUDIO_OUTPUT_CHANNELS=2`
- App Master Synth：health ready 后创建（§8.1 步骤 7，保证在工程 group 之后），应用默认 80% 音量；停止时先释放 master synth 再终止 scsynth
- 音量控制：侧栏 slider → master synth `gain`（短时平滑防爆音）

## 验收（含打包 spike #2）

- §13：音量映射测试（0% 静音 / 80% = -6 dB / 100% = 0 dB）
- Inarticulate III Internal 模式端到端发声；音量 slider 实时生效
- **打包 spike**：dmg 内 scsynth（arm64 slice）在干净环境启动并通过 `/status` 验证
