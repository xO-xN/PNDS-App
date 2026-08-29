# PNDS 池谱 · 项目主页（GitHub Pages）

`site/` 是发布到 GitHub Pages 的纯静态站：无构建、无依赖，`index.html` + `styles.css` + `app.js` 三件套加 `assets/`。

## 结构

页面本身就是产品的展示：左侧一条安静的窄栏（左上 logo、左下下载/语言/链接，参考 atelier-anchor），中间浮起一个**仿 PNDS App 窗口**（真实 App 无 titlebar，红绿灯在侧栏顶部条内）。

- **开场**：仿 App 的 welcome 页是内容滚动的**第一页**（`page-welcome`）。welcome 态（`html.at-welcome`，head 脚本在无章节 hash 时挂上）：外栏收起、仿 App 窗口放大并在浏览器视口居中、内部侧栏入睡；向下滚动进入章节时，rail 宽度 / 窗口 max-width / max-height / 侧栏透明度一起 480ms 过渡回工作布局（纯 CSS 状态机，无 JS 测位）。滚动区开了 `scroll-snap: y proximity` 轻吸附；scroll-spy 在 welcome 与三章节间驱动卡片与 hash。
- **内容**：三个章节按叙事顺序排在窗口内的单一滚动区；滚动位置驱动侧栏工程卡（scroll-spy + 白色药丸滑动 + 左缘强调条），点卡片平滑跳转，hash 同步（`#/structure` `#/anatomy` `#/network`）。
- **内容来源**：每章只取 `presentation/platform-intro/pnds-*.html`（仓库外）的**主副标题 + 中部结构图表**；底部信息卡与页脚不进站。图表润色后需手动同步（SVG 内联在 `index.html`，节点卡带 `class="node-hit"`，悬停按填充色分组高亮）。
- **语言**：全局中英切换（`<html lang>` 驱动 `.l-zh` / `.l-en`，含 SVG 内文本），localStorage 记忆，默认跟随浏览器。
- **窗口尺寸**：`.app-window` 工作态 `max-width 1200 / max-height 800`，welcome 态 `1268 / 868`。图表按窗口宽度等比缩放（桌面无横向滚动）；窄屏保留 `min-width 640px` 走横向滚动以免缩到不可读。刷新必须回到 welcome 页——`history.scrollRestoration = 'manual'` 之外，app.js 还在 `pageshow` 与 350ms 兜底处把内层滚动归零（该内核的 reload 仍会恢复嵌套滚动位置）。

## 本地预览

```sh
python3 -m http.server -d site 4173
# http://127.0.0.1:4173
```

（直接开 file:// 也能看，但建议走 http。）

## 发布

`.github/workflows/site-deploy.yml` 在 `site/**` 变更时部署。仓库 Settings → Pages → Source 选 **GitHub Actions**（一次性），之后地址为
`https://xO-xn.github.io/PNDS-App/`。所有资源用相对路径，适配子路径部署。
