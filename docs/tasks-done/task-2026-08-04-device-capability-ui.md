# Task 3: 设备通道能力 UI 与多声道音量状态

目标 release：PNDS App `1.1.0`。

规范引用：

- `PNDS_RUNTIME_CONTRACT.md` §7.5、§7.6
- `PNDS_APP_REQUIREMENTS.md` §6.3、§6.4、§8

## 目标

让用户在启动前准确看见设备对当前工程 sample rate/通道数的支持情况，同时允许选择通道不足的设备，并正确表达多声道 master gain 已禁用。

## 依赖与边界

- 前置：Task 2 的结构化设备能力 command、manifest outputChannels 和 session channel plan。
- 不为通道不足显示 toast 或 modal。
- 不添加额外“保险”确认步骤。
- 设备消失时沿用系统默认回退及现有不可用提示；这与“设备通道不足”是不同情况。

## 工作内容

### 1. 结构化设备数据接入

- 更新 tauri-specta bindings、`SettingsCard` 和相关 store/type。
- 设备查询使用当前工程 `audio.scsynth.sampleRate`；非 Internal 或无工程时使用安全的空状态。
- 避免设备请求竞态：快速切换工程时，不得让旧 sample rate 的响应覆盖新工程。
- 系统默认选项显示当前实际默认设备的通道能力。

### 2. 可选但警示的设备项

将现有原生 `<select>` 改为项目已有 Radix Select 模式：

- 每项显示设备名称和 `Hch`；
- 当 `H < N` 时，选项视觉灰显但保持可点击/键盘可选；
- 最右显示红色叉号，并提供屏幕阅读器可理解的“通道不足”文本；
- 不足项不能使用真正的 HTML disabled 状态；
- 选中不足设备后，设置区常驻显示 `Nch → Hch`；
- `H >= N` 时不显示损失提示。

选择仍只是 pending setting，按现有 Load/Change 完整 restart 生效，不做热切换。

### 3. Master gain UI

- Internal 且 `N <= 2`、session ready：保持现有 slider 行为；
- Internal 且 `N > 2`：slider 灰显禁用并显示固定 100%；
- External/None：继续禁用；
- 不改变既有百分比到 dB 曲线；
- 模式、设备 restart 后 selected project、mode 和 pending setting 不得丢失。

### 4. 错误和空状态

- sample rate 无匹配配置或设备能力查询失败时，不伪造通道数；
- Internal Load/Change 按钮保持不可启动，并显示可读的内联错误；
- 不用设备名称（如“BlackHole 16ch”）猜通道数。

## 自动测试

至少覆盖：

- 16ch 工程下 2ch 设备可选、灰显、带红叉；
- 选中后显示 `16ch → 2ch` 且无 toast/modal；
- 足够通道设备不显示红叉；
- 键盘可选择不足设备；
- 旧设备响应不能覆盖新工程；
- N>2 slider 为 100% 且 disabled；
- N<=2 的 80% 默认和变更行为不回归；
- Change restart 后工程选中和设置状态保留；
- 设备消失仍回退系统默认并使用既有提示。

## 手动验收

- 用 16ch manifest 比较 Mac 内建 2ch、BlackHole 16ch 等设备选项。
- 选择 2ch 设备时无弹窗、无 toast，仍可 Load 并达到 ready。
- 使用鼠标和键盘操作 Radix Select，视觉、焦点和可选语义一致。
- 多声道 session 中 slider 明确灰显，系统/下游软件仍可控制监听音量。
- `npm run check:all` 通过。
