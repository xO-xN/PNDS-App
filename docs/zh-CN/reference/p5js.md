# 使用 P5.js 创作数字乐谱

[p5.js](https://p5js.org) 是一个专为艺术家、设计师和教育者打造的开源 JavaScript 创意编程库，延续了 Processing 易学易用的设计哲学。它将 Web 浏览器视作交互式数字画布，通过直观的 API 封装了 Canvas 与 WebGL 能力，让创作者能够轻松构建生成式艺术、动态视觉与多媒体交互作品。

PNDS 池谱将 p5.js 作为数字乐谱的基础创作工具。sketch 运行在工程自己的 performer / monitor 浏览器页面中（页面要求见 [runtime-contract.md](./runtime-contract.md) §10）：演奏者在页面上的交互经工程的实时链路驱动声音引擎；PNDS App 只以 iframe 嵌入 monitor 页，不参与乐谱逻辑。数字乐谱的概念见 [digital-score.md](./digital-score.md)。

sketch 的具体写法与模板工程的结构由 [PNDS-Template](https://github.com/xO-xN/PNDS-Template) 仓库维护。
