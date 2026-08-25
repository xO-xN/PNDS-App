# PNDS App 网络音乐演出

工程的两类页面通过不同端口区分，具体端口由工程在 `manifest.json` 中声明：

- 演奏者页面：`performerPort`，供本地网络中的手机 / 平板访问；
- 监视 / 指挥页面：`monitorPort`，由 PNDS App 窗口显示。

例如 `PNDS Template` 使用 `6868` 与 `6869`。

角色由端口确定：

```text
http://<Host-LAN-IP>:<performerPort>/  → performer 页面
http://<Host-LAN-IP>:<monitorPort>/    → monitor/conductor 页面
```

工程可以不提供可演奏的 performer UI，但 performer server 仍必须提供 health endpoint，并可在 `/` 显示说明页面。内置工具 Multichannel Signal Generator 使用这种模式。

## Performer 页面

Performer 页面通常由演奏者的演奏设备（手机、平板电脑、笔记本电脑）连接 App 所设置的本地网络地址打开，用来显示交互界面、乐谱界面。工程负责移动端交互、身份、断线恢复和作品数据协议。

PNDS 不规定 Socket.IO event 名称、客户端 ID、角色数量或 UI 框架。

## Monitor 页面

Monitor 页面通常由 PNDS App 打开，并作为乐谱的指挥或监控界面，可以被投放到演出场地的大型屏幕上供指挥、演奏者或观众观看。

monitor 页面必须：

- 可通过 `http://<Host-LAN-IP>:<monitorPort>/` 加载；
- 允许嵌入 iframe，不发送阻止嵌入的 `X-Frame-Options` 或 CSP `frame-ancestors`；
- 不依赖 Tauri API 或 App DOM；
- 响应 viewport resize，不要求 App 重建 iframe；
- canvas/WebGL/p5 页面在尺寸变化时同步更新内部 drawing buffer 与坐标映射；
- 将持续的交互状态存为相对或归一化坐标，避免窗口尺寸变化后固化在旧像素坐标；
- 在窗口顶部中央为 App 的窗口标题/拖动覆盖区保留无关键交互区域。

进入或退出 macOS 全屏时，App 只改变窗口尺寸与装饰状态，不重启 Node、不重载 monitor iframe。工程必须依靠标准 resize 事件完成适配。参考 Template，用户可以设计 monitor 根据 App 的主题和语言偏好自动切换主题和语言。

## Theme Following（可选）

v1.2.3 起，App 会在 monitor iframe 加载完成、主题切换与窗口重获焦点时，通过跨域 `postMessage` 向 monitor 页面推送当前主题。工程**可选**支持：不监听的工程行为完全不变。

v1.3.0 起，App 加载与重载 monitor 时还会在 iframe 地址上**总是**携带 `?theme=<name>` 首帧参数（语义见下方约定），让跟随主题的页面首帧即正确配色。

消息（App → monitor 页，单向）：

```json
{
  "type": "pnds:theme",
  "version": 1,
  "theme": "lavender",
  "palette": {
    "bg": "#eef0f8",
    "sidebar-bg": "#e2e5f3",
    "card": "#ffffff",
    "pill": "#e8ebf7",
    "accent": "#5a4ff3",
    "accent-hover": "#4a3fe0",
    "accent-foreground": "#ffffff",
    "text": "#171a2b",
    "text-secondary": "#5d6484",
    "danger": "#e11d48",
    "danger-hover": "#c2143c",
    "danger-foreground": "#ffffff",
    "warning": "#ffb020",
    "warning-hover": "#f0a20c",
    "warning-foreground": "#171a2b"
  }
}
```

约定：

- `palette` 是最终颜色值（键名与 App 的语义 token 同名）——大多数工程只消费 palette，无需知道主题概念；App 新增主题时工程零改动自动跟随。`theme` 名留给需要整套设计语言分叉的工程（如按主题切换圆角/字重）。
- 送达语义是 best-effort、“最新值覆盖”：App 不保证恰好一次（挂起的 WebView 可能丢消息，App 在焦点重获时重推）。页面必须幂等地应用消息（把值写入自己的 CSS 变量即可）。
- 页面首帧配色如需避免闪变，可在加载时读取 URL 查询参数 `?theme=<name>` 作为初值。v1.3.0 起 App 加载与重载 monitor 时**总是**携带该参数（值在 iframe 导航时快照——会话中切换主题不会重载页面，更新仍由 postMessage 推送）；工程仍须容忍其缺席（直接在浏览器打开、旧版 App 等）。
- performer 页不参与（不在 App 中打开，永远使用工程自带配色）。
- App 不会注入或改写 monitor 页的任何内容——是否、如何使用推送完全由工程决定。

## Locale Following（可选）

v1.3.0 起，App 以与主题桥相同的机制向 monitor 页面推送当前**解析后的**语言代码：推送触发器完全共用（monitor iframe 加载完成、语言切换、窗口重获焦点、心跳）。工程**可选**支持：不监听的工程行为完全不变。

同一版本起，App 加载与重载 monitor 时还会在 iframe 地址上**总是**携带 `?lang=<code>` 首帧参数（语义与 `?theme=` 一致），让跟随语言的页面首帧即用正确语言渲染。

消息（App → monitor 页，单向）：

```json
{
  "type": "pnds:locale",
  "version": 1,
  "locale": "zh-CN"
}
```

约定：

- `locale` 是**解析后的**语言代码（当前词表：`en` / `zh-CN`），不是 General 设置项——选择“跟随系统”的会话推送系统解析出的代码。App 未来新增语言时只扩词表，消息形状不变。
- 送达语义与主题桥一致：best-effort、“最新值覆盖”，页面必须幂等地应用消息；App 不保证恰好一次。
- 页面首帧如需避免语言闪变，可在加载时读取 URL 查询参数 `?lang=<code>` 作为初值。值在 iframe 导航时快照——会话中切换语言不会重载页面，更新由 postMessage 推送；工程仍须容忍其缺席（直接在浏览器打开、旧版 App 等）。
- 不实现语言跟随的页面完全不受影响：App 不注入或改写 monitor 页的任何内容，`?lang=` 对忽略它的页面只是无害的查询参数。
- performer 页不参与（不在 App 中打开，永远使用工程自带语言）。
