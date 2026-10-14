# 使用 P5.js 创作数字乐谱

[p5.js](https://p5js.org) 是一个专为艺术家、设计师和教育者打造的开源 JavaScript 创意编程库，延续了 Processing 易学易用的设计哲学。它将 Web 浏览器视作交互式数字画布，通过直观的 API 封装了 Canvas 与 WebGL 能力，让创作者能够轻松构建生成式艺术、动态视觉与多媒体交互作品。

PNDS 池谱将 p5.js 作为数字乐谱的基础创作工具。sketch 运行在工程自己的 performer / monitor 浏览器页面中（页面要求见 [runtime-contract.md](./runtime-contract.md) §10）：演奏者在页面上的交互经工程的实时链路驱动声音引擎；PNDS App 只以 iframe 嵌入 monitor 页，不参与乐谱逻辑。数字乐谱的概念见 [digital-score.md](./digital-score.md)。

sketch 的具体写法与模板工程的结构由 [PNDS-Template](https://github.com/xO-xN/PNDS-Template) 仓库维护。

## 从 App 共享包同源加载 p5

在创作模式「模块」栏选择「加入共享包」，采用本 App 的 p5 固定版本并填写新的工程版本。
引用按 [manifest.md](./manifest.md) 保存，资源继续留在 App。下面是作者服务接线片段：

```js
const shared = JSON.parse(process.env.PNDS_SHARED_LIBRARIES || '{}').p5
if (!shared || shared.version !== '2.3.4' || shared.kind !== 'browser') {
  throw new Error('Required shared p5 2.3.4 is unavailable')
}
// 对 monitor 和 performer 服务都安装这条固定路由。
app.get('/shared/p5.js', (_request, response) => response.sendFile(shared.path))
```

浏览器页面使用相对同源路径：

```html
<script src="/shared/p5.js"></script>
```

Express 的 `app` 由工程创建；本片段不创建或安装依赖。使用 Node 标准库也可读取该入口后返回
JavaScript，完整可运行示例在 App 源码 `examples/shared-p5/`。手机不能读取 Mac 的绝对文件路径，
也不应使用 `file://` 或 CDN。可信 HTTPS 网关代理同一路由，页面继续用相对地址。

p5 2.3.4 是 App 1.6.2 的固定输入。旧 sketch 的加载、图片、输入与时序需要作者验证并适配；
加入引用不会修改 sketch。断公网冷打开后须确认真实圆形绘制与输入，再检查刷新、重启、关停
和工程包安装往返。HTTP 200 或 health ready 不能证明浏览器执行和画面通过。模型不属于共享 p5。
