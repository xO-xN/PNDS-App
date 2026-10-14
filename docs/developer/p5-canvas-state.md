# p5 2 与 Canvas 状态配对

作品混用 p5 绘制与裸 `drawingContext` 时，必须让 p5 的状态缓存和 Canvas 的状态堆栈一起恢复。用 p5 `push()` / `pop()` 包围视口变换、裁剪和作品绘制；裁剪路径仍可使用 `drawingContext.beginPath()` / `rect()` / `clip()`。不要用裸 `drawingContext.restore()` 恢复由 p5 管理的 fill、stroke 或 transform，而把 p5 的缓存留在另一状态。

Inarticulate IV 的原裁剪帧在 p5 1 下保存／恢复裸 Canvas 上下文；换 p5 2.3.4 后，缓存仍记住上帧末的 fill，而 Canvas 已恢复先前的白色。下一帧同色 fill 被缓存省略，实际背景从原 `[242,242,242,255]` 变成白色。以 p5 push/pop 配对完整帧后，原灰色和裁剪都恢复，音乐、时间公式、几何与配色数值不变。具体输入与受控证据见 [#219 记录](../acceptance/219-inarticulate-iv-shared-libraries.md)。

图片加载也需按 p5 2 的公开异步接口适配：`async setup()` 中等待工程资产，再绘制并连接控制通道。加载失败提供可读提示，停止该失败画布；资产恢复后刷新重试。模型、图片、谱面与声音仍属于工程，不能为通过测试换成假资源。

真实浏览器回归应观察实际图片绘制和已知背景像素，并在刷新后等待完整帧。原画面若通过圆角 rect 覆盖而未清除透明外缘，其抗锯齿可能逐帧累积；画面内的暂停／时间验证要避开该外缘，保留原绘画策略。浏览器通过不代表 WKWebView、实体手机、投影或声音设备通过。
