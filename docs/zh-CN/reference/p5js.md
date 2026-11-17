# 使用 P5.js 创作数字乐谱

[p5.js](https://p5js.org) 是可选的 JavaScript 创意编程库，提供 Canvas 与 WebGL 绘图。Blank 不默认加入 p5；按创作任务选择视觉方案。

sketch 运行在工程的 performer／monitor 页面，交互与声音映射由工程定义；页面职责见[运行契约](./runtime-contract.md#1-参与者与所有权)。数字乐谱的概念见[数字乐谱](./digital-score.md)。

## 从 App 共享包同源加载 p5

采用入口见[添加模块与共享包](../app-tutorial.md#添加模块与共享包)。
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
<script src="./shared/p5.js"></script>
```

Express 的 `app` 由工程创建；本片段不创建或安装依赖。使用 Node 标准库也可读取该入口后返回
JavaScript。手机不能读取 Mac 的绝对文件路径，
也不应使用 `file://` 或 CDN。相对 URL 保留[浏览器确认前缀](./runtime-contract.md#浏览器演奏接入协议-1295)；动态资源使用 `PNDS_PARTICIPATION.resource(relative)`。可信 HTTPS 网关沿用工程路由。

p5 2.3.4 是当前确切共享版本。旧 sketch 的加载、图片、输入与时序需要作者验证并适配；
加入引用不会修改 sketch。断公网冷打开后须确认实际绘制与输入，再检查刷新、重启、关停
和工程包安装往返。HTTP 200 或 health ready 不能证明浏览器执行和画面通过。模型不属于共享 p5。
