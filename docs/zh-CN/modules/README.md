# 模块手册

按能力查阅工程接线；模块接口以工程实际版本的 README 为准。

## 默认基础与可选能力

| 能力                         | 新建 Blank           | 使用条件                                    |
| ---------------------------- | -------------------- | ------------------------------------------- |
| 演奏者身份                   | 默认接线             | UUID 与声道、选谱分别表达                   |
| monitor 视图                 | 默认接线，初始空声明 | 声明实际低频视图字段后启用                  |
| 公共输入、演奏记录、参数预演 | 默认基础             | 作品效果与可调参数随任务实现                |
| 主题、语言、hub              | 按需采用             | hub 同时采用所需 Node 客户端                |
| 设备运动、设备麦克风         | 按需采用并手动启用   | 不需要 p5/ml5                               |
| 摄像头 HandPose              | 按需采用并手动启用   | 先有兼容 p5，再组合采用 ml5、模块及离线模型 |

## 采用与维护

手动“添加 PNDS 模块”复制源码与来源记录，再记录待接线交接；Blank 默认已接好的模块不重复添加。工作聊天经确认后在同一任务采用所需资源，完成实际作品接线和检查；讨论模式只建议。采用不自动升级作者源码或启动工程。

`pnds-module.json` 记录来源，`compatibility.json` 区分模块版本、Host 协议与适配条件；文件存在不代表已验证。

## 篇章

- 身份与恢复 → [演奏者身份](./players.md)；多份 monitor 视图 → [视图状态](./monitor-state.md)。
- 作品声音与回放接线 → [音频作品层](./audio.md)；远程节点 → [hub](./hub.md)。
- 页面风格与语言 → [主题跟随](./theme-follow.md)、[语言跟随](./locale-follow.md)；场地画面 → [投影面](./projection-surface.md)。
- 设备输入 → [运动](./device-motion.md)、[麦克风](./device-microphone.md)、[HandPose](./camera-handpose.md)。
- 手机邀请 → [二维码](./qr.md)。

## 与其他文档的分工

工程的 `docs/implementation.md` 记录实际作品规则与修改位置；[创作指南](../template-guide.md) 讲工作流，[参考手册](../reference/README.md) 定义 Host／工程契约，本册讲能力接线。

## Device motion input

设备运动的接口与限制见[设备运动输入](./device-motion.md)。

## Device microphone input

设备麦克风的接口与限制见[设备麦克风输入](./device-microphone.md)。

## Camera HandPose sensor

摄像头手势的前置条件、接口与限制见[摄像头 HandPose](./camera-handpose.md)。
