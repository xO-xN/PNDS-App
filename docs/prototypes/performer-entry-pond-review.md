# 演奏者入口与工程切换原型

2026-11-10：用户已选择「A 居中留白」，结束三种等待页布局的比较。[独立 HTML 原型](./performer-entry-pond.html)采用该布局，并将切换控件改为 360° 拖拽、松手反向发射。用户随后明确授权将等待页与工程切换一起应用到正式演奏者浏览器入口，生产实现由[浏览器参与规则](../developer/browser-participation.md)约束。

可直接双击 HTML 打开，无需启动 dev server；也可通过用户已启动的本地服务访问 `/docs/prototypes/performer-entry-pond.html`。保留仓库目录关系，以加载本地字体和用户指定的 `assets/pnds-icon.png` 原图。图标保持原有比例和透明边缘，品牌名称统一为「PNDS池谱」。页面中的池主、工程、乐谱和耗时均为演示样例，评审控制区不属于产品界面。

## 已选择的等待页

品牌图标、名称和等待状态居中排列，保存入口收在底部。拉丁文字使用仓库自带的 Manrope／Comfortaa，中文跟随系统字体。Pond 色源为 [`src/theme-variables.css`](../../src/theme-variables.css)：背景 `#f1f5f8`、表面 `#fcfdff`、文字 `#293541`、次级文字 `#495b68`、湖蓝 `#1476cc`、边线 `#bdcbd6`。

「已连接」只表达设备已到达池主入口，不代表工程已接纳演奏者。保存入口仅提供将池主根入口加入书签或主屏幕的简短说明，不模拟安装或保存成功；下次打开仍需明确进入当时显示的工程。

## 场景与参数

| 参数      | 可用值        | 含义                                           |
| --------- | ------------- | ---------------------------------------------- |
| `variant` | `A`           | 固定居中留白；旧 B／C 参数归一为 A。           |
| `scene`   | `waiting`     | 已连接池主，尚无工程可进入。                   |
| `scene`   | `first`       | 首个工程已就绪，等待演奏者明确进入。           |
| `scene`   | `playing`     | 已加载示例乐谱。                               |
| `scene`   | `switch`      | 新工程已到来，显示中央切换手势。               |
| `scene`   | `error`       | 模拟新工程加载失败，保留旧谱并提供重试。       |
| `scene`   | `loading`     | 固定展示灰色底座内的 loading，无自动完成计时。 |
| `loadMs`  | `800`–`10000` | 交互加载模拟耗时，单位 ms，默认 `1500`。       |
| `lang`    | `zh-CN`、`en` | 切换中文或英文。                               |

例如 `performer-entry-pond.html?scene=switch&lang=zh-CN&loadMs=5000`；`?scene=loading` 可持续评审加载态，按 Escape 返回切换场景。参数用于重复打开评审场景，不是会话存储；刷新会重新初始化内存中的示例状态。

## 任意方向拖拽切换

交互视觉参考 [Bencho slingshot，light 主题](https://bencho.dev/?c=slingshot&theme=light)。新工程到来时，旧谱虚化并设为 `inert`，中央出现弹性圆球，下方显示「拖拽松开切换到新工程」。覆盖层阻断旧谱的指针与键盘交互；模糊滤镜仅负责视觉效果。

圆球可向 360° 任意方向拖拽，松手后沿拖拽的反方向发射。原先只能向下、必须达到 88px 的限制已移除。本轮原型用以下参数区分明确拖拽与轻微抖动：

- 距离达到 18 CSS px，松手即可确认。
- 距离达到 8px，且最近 100ms 的释放速度达到 0.22px/ms，轻快甩动也可确认；速度用于模拟力度，不依赖硬件压力值。
- 距离和速度都很小则回弹。`pointercancel`、失焦和 Escape 均取消当前拖拽，不确认、不加载。

箭头静止时朝上。候选控件刚出现时，箭头用 680ms 左右摆动一轮提示拖拽，不持续晃动；开始拖拽立即取消这轮提示，箭头随反向发射方向转动。减少动态效果时不播放提示摆动或弹射，明确松手确认的规则保持。键盘仍可按 Enter 或空格执行等价确认。

确认后，黑色圆球用 420ms 沿反方向发射并淡出，不再返回底座。旧谱、工程名、提示文案和原型控制区用 240ms 淡出；加载态只保留原灰色底座及其内部独立的 loading 转圈，不显示黑球或其他文字、按钮。候选出现、悬浮和拖拽本身均不加载工程。

加载期间旧谱实例仍保留；模拟成功后才交接到新谱。Escape 可取消加载，失败或取消后重新显示候选重试控件，灰色底座内的 loading 隐藏；可操作候选仍在时，同一旧谱实例继续虚化并禁止交互。候选因停止、元数据不可用或不兼容而移除时，旧谱才恢复交互与焦点。`scene=loading` 仅固定展示此画面，不启动自动完成计时。

## Safari 首次拖拽

从原生场景下拉菜单关闭后立即拖拽，Safari 曾出现首拖无效、第二拖才生效。实机事件链为 `mousedown(use) → focusout(select) → pointerup(svg) → mouseup(svg)`，首轮缺少 `pointerdown`。这不是两次拖拽确认设计。

原型保留 Pointer Events 主路径，并为缺失 `pointerdown` 的情况增加 `mousedown` 兼容入口，使用窗口级 `mousemove`／`mouseup` 跟踪。两条路径按模式去重，不会把兼容鼠标事件计为第二次手势；取消后迟到的 `mouseup` 也不能确认。修复后在 Safari 原有复现路径中，关闭下拉菜单后的单次拖拽即可发射。

## 已授权的生产接入

用户已批准将当前等待页与切换交互一起应用到正式演奏者浏览器入口，覆盖旧右下角提示与进入按钮。生产资源位于 `src-tauri/resources/browser-participation/`：`entry.html` 与 `entry-gesture.html` 提供真实模板，`entry.css` 提供 Pond 与淡出样式，`entry-gesture.js` 管理手势，`entry.js` 接入原有发现、三项身份核验、资源准备和退役流程；`participation_host/browser.rs` 负责本地 HTML、图标、字体与脚本路由，文案进入正式 `locales/*.json` 的 `browserEntry.*`。

生产加载等待真实确认和资源准备，不使用原型的 `scene`／`loadMs` 或演示计时。候选仍可操作时，Escape 或失败回到候选重试，原 Document 保留并继续虚化、禁止输入；停止、元数据不可用和不兼容候选移除覆盖层并恢复旧页焦点。原生池客的单击进入 UI 不属于本轮修改。身份、不可变 URL、成功后交接及可验证退役规则继续遵守[浏览器参与协议](../developer/browser-participation.md)。

生产自动化入口为 `src/lib/browser-entry-gesture.test.mjs`、`src/lib/browser-entry-lifecycle.test.mjs` 与 Rust `participation_host::browser_tests`。正式接入的最终 `npm run check:all` 和显式 WebKit 结果待本轮收尾记录；旧原型测试或此前全仓结果不替代本轮生产验证。

## 原型边界与验证

原型只操作内存中的演示状态，不持久化，不调用池主、外部 API 或 Tauri，不读取或改变真实工程，也不启动或关闭演出。页面仅加载同仓库静态字体和图标；所有状态切换及加载耗时均为模拟，不证明真实工程资源就绪、演奏者接纳、音频或网络结果。

以下为接入前 HTML 原型阶段的验证记录：

- 新增 [`src/lib/performer-entry-prototype.test.mjs`](../../src/lib/performer-entry-prototype.test.mjs) 六项回归测试，先红后绿；覆盖 Safari 缺失 `pointerdown` 的首拖、正常指针路径与兼容鼠标事件去重、取消后的迟到鼠标事件、仅底座 loading 与 Escape 恢复、失败保留旧节点、固定加载场景。
- 一次性 jsdom 验证覆盖双语和六场景共 12 个初始化组合，1,594 项断言通过，双语各 60 键与内嵌 JSON 一致。既有八方向反向发射、距离／速度边界、轻拖回弹、取消及迟到回调隔离继续验证。
- 复用用户已经运行的 Vite，未启动 dev server；Safari 原生菜单关闭后的首拖已在原有复现路径实测通过。减少动态路径由自动化和 CSS 核对，不宣称已模拟系统偏好。
- [等待页截图](./performer-entry-pond-waiting.jpg)、[切换页截图](./performer-entry-pond-switch.jpg)、[Safari 加载态截图](./performer-entry-pond-loading.jpg)与[手机加载态截图](./performer-entry-pond-loading-mobile.jpg)用于本轮视觉评审；原型控制区不属于产品界面。Safari 已验证 Escape 恢复，加载态不显示额外文字、黑球或原型控制。

原型阶段的完整前端测试曾有 3,791 项通过，整仓检查当时受并行原生夹具格式改动阻断；这些历史结果不代表本轮生产接入已完成。生产版本最终检查待主任务收尾记录。

为运行全仓检查，对既有 `NativeProjectPage.tsx` 的可选几何值补充 `?? null`，消除原有类型错误；这不接入本轮演奏者 UI 提案。原型验证不替代正式工程资源准备、音频、联网与物理设备验收。
