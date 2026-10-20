# Blank {{templateVersion}} 实现说明

App 已完成工程初始化与第一个本地 Git 版本。实施当前用户直接指派的任务；
交接单用于了解背景，其中的待办须经明确指派后再实施。

## 修改位置

| 文件                                           | 用途                                      |
| ---------------------------------------------- | ----------------------------------------- |
| `public/monitor.html`                          | 监视页面结构和脚本入口                    |
| `public/monitor.js`                            | 乐谱绘制、监视交互和参数回调              |
| `public/performer.html`、`public/performer.js` | 演奏者页面与交互                          |
| `public/style.css`                             | 初始共享样式；需要时再按页面拆分          |
| `pnds.preview.json`                            | 可调字面量的精确声明；初始为空            |
| `public/pnds-preview.mjs`                      | App 提供的本地预演协议适配器              |
| `server.js`                                    | HTTP 资源、health、脚本快照和运行生命周期 |
| `audio/controller.js`、`supercollider/`        | 音频与 OSC 实现；初始为静音占位           |

HTML、JavaScript 和 CSS 分别放在对应文件中，共享代码与素材按需添加。
server 只公开 public 目录，提供正确 MIME 和 `Cache-Control: no-store`。
公共文件保存后刷新监视页面加载新版本；修改 Node server 或其导入的音频代码后需重启工程。
刷新和重启由创作者在 App 中主动执行。

初始工程没有生产依赖。实际任务需要时，使用已有本地素材或明确采用 App 的固定共享包，
由助手完成本地路由与导入接线，保持创作与演出可离线运行。
README 是面向演出观众的作品介绍，技术说明写在本页。

## 添加可调参数

监视页的预演基础接线已就绪，初始没有参数和控件。在 edit 模式中，助手完成以下三步，
再展示保存文件中的参数控件。以修改标题字号为例：

1. 在 `public/monitor.js` 中定义实际可变值并应用到画面，将 `previewParameters` 替换为实际回调：

   ```js
   let titleSize = 48 // px
   const renderTitleSize = () => {
     document.querySelector('h1').style.fontSize = `${titleSize}px`
   }
   renderTitleSize()
   const previewParameters = {
     titleSize: {
       kind: 'number',
       limits: { min: 12, max: 120, step: 1 },
       get: () => titleSize,
       set: value => {
         titleSize = value
         renderTitleSize()
       },
     },
   }
   ```

2. 在 `pnds.preview.json` 中登记相同 ID、类型、限制和精确的整行锚点，保留其他参数：

   ```json
   {
     "schemaVersion": 1,
     "parameters": [
       {
         "id": "titleSize",
         "path": "public/monitor.js",
         "prefix": "let titleSize = ",
         "suffix": " // px",
         "kind": "number",
         "limits": { "min": 12, "max": 120, "step": 1 },
         "preview": "live"
       }
     ]
   }
   ```

3. 保存，执行当前可用检查，并展示由原生绑定验证的保存参数。
   新保存的代码需要先刷新一次监视页；拖动控件临时预演，保存参数才持久化并计入任务撤回。
   结束预演恢复运行时基线，不恢复已经流逝的音乐时间。

保留监视页的脚本引用：server 为每次页面加载固定 `public/monitor.js` 的实际字节，
同时传递源码与参数声明摘要。再次保存后，旧页面仍对应自己加载的版本。
若参数移到额外文件，要一并扩展它们的实际加载快照和回调；事后计算磁盘摘要不能证明代码已加载。
回调须修改实际状态，暂停的乐谱需要时主动重绘；音频回调只使用工程已经启用的音频。

演出过程中仍可静态检查。运行时占用会阻止独立运行验证，保留当前工程运行。
画面与声音的实际效果另行验证；平台契约入口见 `AGENTS.md`。
