# 独立 HTML 交互原型

`docs/prototypes/pnds-ui-prototype.html` 与独立 Performer 测试窗是内存演示，不接入真实工程文件、服务器、模型服务或偏好存储。产品与运行契约仍以正式版本规格为准。

## 文案与切换

英文文案源在 `locales/prototype.en.json` 和 `locales/prototype-performer.en.json`，使用原型的中文展示短语作为键。更新后运行 `npm run prototype:locales`，将 JSON 同步到 HTML 的 `prototype-translations` 数据块，再格式化改动文件。HTML 内的数据块是生成结果，不手动维护；测试核对它与 JSON 源是否一致。嵌入使原型不必通过 fetch 读取翻译，直接打开本地 HTML 也能切换语言。

主原型通过 `state.language` 保存本次会话的选择。展示层记录文本和属性的原文，翻译动态 DOM、标题、提示和下拉标签；观察回调更新时暂时断开观察，避免自身更新再次触发。选择值使用稳定的 `en` / `zh-CN`，语言切换不重建工作台或重置工程。数字状态优先匹配带 `{count}` 的短语。

作品内容不参加界面翻译：编辑输入、README 可编辑正文、源码、路径、作品名称与用户聊天保持原样；额外作者内容使用 `data-ui-content` 标记，手写交接任务记录 `authored: true`。界面翻译不能修改工程源文案或把 README 翻译任务当作 App 语言设置。不要用新增界面文案覆盖用户填写的输入值。

独立 Performer 测试窗通过 URL 的初始语言和演示 BroadcastChannel 的 `previewLanguage` 更新测试控件。这只代表原型测试界面；真实工程的 Performer 主题与语言仍由作品决定。

## 模块演示

原型内固定六项模块，包含用途、依赖、技术边界、示例文件组、接线和验证说明。演示版本、路径和占位内容不能当成正式发行源码。添加前一次性检查整组目标及来源记录是否冲突，全部通过才写入内存文件组、来源记录和交接任务；来源记为 `wiring: pending` / `runtimeVerification: not-run`。App 不从交接任务的完成状态推断模块实际运行情况，也不因加入文件自动启动、重启或修改入口。

## 验证

`src/lib/ui-prototype.test.mjs` 使用 jsdom 执行保存的 HTML 脚本，覆盖设置切换、后续弹窗、下拉标签、草稿与作者内容保留、六个模块的添加与冲突、来源记录和独立测试窗语言更新。弹窗及 BroadcastChannel 使用本地替身，不启动 dev server。

执行 `npm run test:run -- src/lib/ui-prototype.test.mjs` 做集中验证，再执行 `npm run check:all`。jsdom 不做布局测量或真实窗口验收；浏览器视觉与独立窗口通信仍需要本地 HTTP 预览，dev server 由用户启动。

## 1.6 桌面工作台提案

`docs/prototypes/desktop-1.6/index.html` 是独立的新 UI 提案，保留旧原型作为对照；不接入 App、真实音频、工程磁盘或偏好存储。相邻 CSS、JS 和 Performer HTML 必须一起保留，可直接打开本地 HTML，也可通过用户已启动的 Vite 访问 `/docs/prototypes/desktop-1.6/index.html`。

侧栏底部“原型”菜单提供四主题、语言与状态场景；`theme`、`lang`、`scene` 查询参数可用于重复检查。所有工程与编辑状态均在内存中，刷新即重置。独立 Performer 与投影窗口仅通过校验 opener/source 的消息模拟状态。作品内容是演示素材；不代表原工程源码或新增版本能力。

该提案以 `P.t(中文, English)` 就地配对界面文案，作品内容不随界面语言改写。运行配置通过 `applied` 保存快照，区别于下次启动配置；未保存草稿、保存版文件和运行状态分开。文件分组强调 manifest、README 与运行入口，保留真实路径。

执行 `node --test docs/prototypes/desktop-1.6/prototype.test.mjs` 验证核心流程及状态边界，再运行 `npm run check:all`。浏览器检查需覆盖宽/窄桌面、四主题、README/manifest、底部音频面板、模式切换及独立测试窗口；jsdom 不替代布局验收。

1.6 桌面定稿去除顶部栏和侧栏 toggle，侧栏顶行只保留 macOS 红绿灯。创作工程标题下拉承载工程操作；演出保留一个三点菜单，作品操作收在其中。控制台只在创作模式提供入口与快捷键。演出侧栏采用独立悬浮圆角面板（320px、12px 外距），运行时默认隐藏，与沉浸状态解耦；左边缘 14px 悬停或按住 ⌘ 唤出，离开后收回，覆盖 Monitor 而不改变其尺寸。菜单、对话框、模式确认和拖拽期间保持可见；创作仍为常驻文件侧栏。右下角固定尺寸模式按钮沿用斜向色块动画：悬停露角、首击半幅、再次点击后 300ms 完成填充并切换；Brutal／减少动态效果时立即切换。保持同一按钮 DOM，结束后暂停 hover，直到指针离开。普通切换不展示说明浮层，仅未保存文件损失在按钮上方显示一行提示；Esc／外部点击／窗口失焦取消准备状态。模式切换的运行继承与草稿清理规则保持不变。
