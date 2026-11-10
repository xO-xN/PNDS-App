# 动作色环 HTML 原型

状态：2026-11-09「统一出现动画」最终独立 filter alpha 包络的浏览器核对、生产构建与完整检查均通过。此前 9 秒低速与材质修订、11 月 8 日原型与首次接入记录保留为历史依据，不能代表当前标签、速度或材质；原生 App 视觉仍待用户常规启动核对。

## 2026-11-08 原型（历史视觉依据）

[打开原型](./semantic-action-rings.html)。保留仓库目录关系，可直接打开本地文件，也可通过静态 HTTP 预览。页面引用真实四主题 palette、按钮玻璃 CSS，并内嵌从生产 `liquid-glass-rim.ts` 转出的同一边缘折射引擎，保留 MIT 许可。没有启动开发服务器。

原型比较同一按钮的动作色，不改变 App 布局。上方是并排色环，下方是简化的演出底栏上下文。原型按钮为 112 × 30px，底栏高 50px；玻璃主体与文字保持主题中性色，单条 1.1px 环、外扩 2px／4.5px 模糊柔光沿用已有材质。放大只作用于上方样品，不改变底栏按钮尺寸；生产沿用自身现有按钮几何，不因样品宽度重排布局。

| 动作     | 色环                            | 默认动态                         |
| -------- | ------------------------------- | -------------------------------- |
| 加载     | 生产原版七色彩虹                | 中性静态细边；仅悬停显示流动彩虹 |
| 关闭     | `#b80f1c`、`#ed1c2e`、`#ff4b59` | 完整正红细边；仅悬停后流动       |
| 重新打开 | 与加载相同的生产原版七色彩虹    | 中性静态细边；仅悬停显示流动彩虹 |
| 设置节点 | `#ca6711`、`#f49b25`、`#ffca58` | 完整金橙细边；仅悬停后流动       |
| 不可用   | 中性轮廓，无彩环与柔光          | 静止                             |

用户已明确加载和重新打开都使用原版彩虹环，已移除旧 A／B 配色对照与方向键切换。柔光、静止查看及放大细节仍可独立对照。Pond、Sand、Stage 使用玻璃；Brutal 保留方角与硬边，使用静态描边。减少动态时去掉光谱动画并立即显示静态边线，减少透明度／提高对比度时使用不透明中性面；强制颜色尊重系统按钮色。

四个按钮统一只在可用且鼠标悬停时转动；键盘聚焦保留清晰焦点描边，不启动动画。忙碌与禁用同样静止，等待靠真实动作名称的原型模拟文案表达。静止态使用固定完整细边、无柔光；悬停时交叉淡入流动光谱与柔光，离开后停住当前相位，用相同的 180ms ease 交接到静态线。装饰中的暂停轨道完全隐去，下一次悬停继续原相位，不再归零或瞬间切断。镜片在普通／悬停／键盘聚焦时使用同一底色，避免退出时混白。静态线在减少动态效果时立即接管，不淡入等待。已移除“关闭环常转”和对应参数。

## 速度核对与本轮修订

用户指出速度／加速度观感有差异。程序比较原 C 的 `rainbow-orbit` 与生产 `desktop-rainbow-orbit`：41 个关键帧的相位值完全相同，均为 3 秒、正向、linear 采样。解析速度为 `120 × [1 + 0.2 sin(2πt/3)]` 度／秒，平均 120、范围 96–144；采样造成的实际区间约 96.10–143.90。上一轮加载和重新打开默认已在旋转，只有关闭与节点暂停；三阶同色谱也比七彩谱少了运动参照，后一点只是观感差异的推断。

上一轮曾在移开时将 `animation-name` 设为 `none`、即时隐藏彩环，再以 180ms 淡入静态线。用户指出退场会白一下；浏览器确认退出动态层为 `0s`、静态层为 `0.18s`，镜片背景也从白色 12% 变为 7.5%。本轮保留原关键帧、时长和插值，只切换 `animation-play-state` 来暂停／继续，动态和静态层统一为 `0.18s ease`，镜片背景保持不变。正红高光继续使用饱和的 `#ff4b59`。紫罗兰／靛蓝候选已经撤下，加载与重新打开都回到原七彩。

## 操作与参数

`theme=pond|sand|stage|brutal`、`lang=zh-CN|en`、`scene=selected|running|pending|node|empty|loading|stopping|restarting` 指定初始状态。其余开关为 `motion=off`、`glow=off`、`detail=large`。评审控件更新 URL，旧 `variant` 参数自动移除。所有演示状态仅在内存中；刷新按当前 URL 重置，没有工程或偏好存储。

点击上方样品定位对应场景；底栏按钮演示加载→关闭、关闭→无选择、重新打开→关闭的反馈。关闭完成后点击左侧 runes 重新选择。只有点击按钮才用 1.5 秒模拟操作；从场景下拉直接选忙碌状态则保持等待，方便核对。切场景／重置清理旧计时器，主题／语言切换保留当前动作。设置节点只模拟设置完成，不打开真实设置。

原型保留 11 月 8 日的“重新打开／Reopen”标签；11 月 9 日正式 App 改为“重新加载／Reload”，使用 `sidebar.reloadProject` 和内部 `reload` 动作标识，仍表示重新启动并应用配置。侧栏、乐谱曲线、设备与名称均为展示样例；页面不调用 Tauri、不读取真实工程、不发声。原型证据本身不能证明最初启动黄底问题已在 App 修复。

英文源和中文镜像在 `locales/prototype-semantic-action-rings.*.json`。通过 `npm run prototype:locales` 生成 HTML 内嵌英文，不手改数据块；直接打开本地 HTML 也能切换语言。

## 正式接入范围与验证状态

11 月 9 日生产规则覆盖上方历史原型，仍通过 `.desktop-performance-action` 限定 `SessionActionButton` 的加载、关闭、重新加载与设置节点；`CreationTestControls` 和右侧模式按钮不扩展这些规则。加载／重新加载可用时默认显示低亮的原版七彩，约 9 秒一圈；悬停提高亮度并恢复原 3 秒。CSS 时间轴恒定为 3 秒，用 Web Animations 的 `updatePlaybackRate(1 / 3)`／`updatePlaybackRate(1)` 保相位调速，不改动画时长、不增加逐帧 JavaScript。

关闭默认与右侧普通模式按钮共用中性灰镜片边，仅悬停出现正红环；节点保留金橙环。额外静态 span 只在节点显示，加载／重新加载不叠静态线。所有演出动作整钮透明度保持 1，未选工程仍禁用且无彩环，仅文字 secondary，玻璃、高光和阴影完整保留。镜片恢复共享悬停／键盘聚焦的 12% raised 表面、200ms 背景过渡与原阴影，不再固定左侧底色；Brutal 使用中性方角实底与统一 1px 硬描边。色环出现／亮起统一为 `650ms ease`，真正隐藏至 0 保留 `180ms ease`；关闭／节点退出暂停相位，加载／重新加载退出继续低速，亮度回落仍为 650ms。减少动态／透明度、强对比及强制颜色保持相应回退。当前规则归属见[UI 模式](../developer/ui-patterns.md#两种模式共用底栏与按钮材质2026-10-25)。

工程选择、启动门控、替换确认、停止／重启命令及快捷键语义保持原流程。忙碌时暂停并淡出彩环，保留最近稳定的装饰外观并禁用重复提交，重新加载经过 stopping／starting 时不闪成红色关闭样式；文字仍按真实生命周期显示 Starting／Stopping，外部关闭不承诺重新启动。

### 2026-11-09 统一出现动画（最终验证）

用户要求左侧彩环复刻右侧模式按钮的 hover 淡入，避免彩环直出。首次挂载或由隐藏变为显示时，两份动态 rim 和节点 static rim 使用 `650ms ease` 入场，只定义 `from { filter: opacity(0) }`、回到原 filter none、不设置 fill。这个独立 alpha 包络只处理装饰 rim，不影响文字或内部光谱折射；实际 opacity 仍由实时 hover／disabled 状态决定，视觉有效透明度为 opacity 与包络 alpha 的乘积。这样首次 650ms 内改变状态时，不会重新指定入场动画的 opacity 终点。可用 Load／Reload 的常驻态及可用 hover 动态环使用 650ms 过渡，hover 回到常驻 0.72 同样为 650ms；Close／Node 离开或 disabled 时完全隐藏的过渡仍为 180ms。节点新出现的静态线使用 650ms 入场，但之后 hover 淡出／恢复仍为原 180ms。

本轮仅修改 CSS 的出现方式，不改变原旋转关键帧、WAAPI 播放速率、当前相位、镜片或业务流程，未新增 JavaScript／业务逻辑或镜像单测。减少动态规则显式取消入场动画。

最终包络的真实组件静态夹具已核对 Pond、Sand、Stage、Brutal。浏览器记录 `/tmp/pnds-performance-rim-reveal-browser.json` 以实时 opacity 与 filter alpha 的乘积核对视觉有效透明度；关键采样如下，时间为该次采样开始后的毫秒：

| 场景               | 有效透明度采样                                                                                                                                                                                                      |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Load 首次挂载      | `0.2ms: 0 → 88ms: 0.0664 → 251.7ms: 0.4346 → 701.8ms: 0.72`。                                                                                                                                                       |
| Reload 重挂载      | `0ms: 0 → 81.4ms: 0.076 → 251.6ms: 0.4668 → 701.3ms: 0.72`。                                                                                                                                                        |
| 首次入场途中 hover | `0.2ms: 0.013 → 82.1ms: 0.1383 → 250.9ms: 0.617 → 703.3ms: 1`。实时 opacity 为 `0.72 / 0.7495 / 0.895 / 1`，包络 alpha 为 `0.0180623 / 0.184456 / 0.68946 / 1`，末帧 filter 回到 none，连续变化，没有改写入场终点。 |
| Stage 节点静态线   | `0.5ms: 0.0033 → 83ms: 0.0917 → 256.4ms: 0.4595 → 703.3ms: 0.68`。                                                                                                                                                  |

不涉及入场包络变化的 opacity 路径也已核对：Load 从 disabled 恢复为 650ms，Close hover 与右侧模式按钮的动态环 transition 均为 `650ms ease`，Close 离开仍为 180ms 且旋转 paused。Load／Reload 两轨 idle 的播放速率保持 `1 / 3`，原旋转时间轴仍为 3 秒；Brutal 保持方角且不显示玻璃装饰。控制台无警告或错误，IPC 调用数为零，最终截图为本聊天可视化目录的 `performance-rim-reveal-preview.png`。

夹具只导入真实组件／生产 CSS，以替身阻断 IPC 和业务点击，没有启动 dev server 或 App；减少动态与其他系统偏好仅作源码复审，没有切换系统设置。浏览器结果不代替用户常规启动 App 后的原生视觉核对。

最终 filter 版本的 `npm run build` 已退出 0，日志为 `/tmp/pnds-performance-rim-reveal-build.log`。本轮 `npm run check:all` 也退出 0：类型、ESLint、ast-grep、Prettier、Rust fmt、Clippy、前端及 Rust 工作区／集成／文档测试全部通过。前端 312 个文件通过、1 个既有跳过，3,653 项通过、2 项既有跳过；Rust 主 crate 949 项通过、0 项失败、10 项既有忽略，其余工作区／集成／文档测试均通过。完整日志为 `/tmp/pnds-performance-rim-reveal-check-all.log`。下节 9 秒低速与材质检查保留为此次 CSS 修订前的历史结果。

### 2026-11-09 低速彩虹与材质验证（统一出现动画前）

定向测试通过 3 个文件、279 项，新增两条覆盖调速／清理及系统偏好变化的回归；palette 按共享 idle／hover 镜片检查文字与焦点对比度。最终完整检查与生产构建均已通过，结果及复跑记录如下。

`npm run build` 已退出 0，日志为 `/tmp/pnds-performance-actions-nov9-build.log`。首轮完整检查进入 Rust 主 crate 后为 947 项通过、2 项失败、10 项忽略：运行端口用例报告 `participation.errors.runtimePortsOwnership: performer:10240`，录制往返用例报告 `recording.adapterUnavailable: io: Connection reset by peer (os error 54)`。未修改 Rust 源码，使用 `RUST_TEST_THREADS=1` 分别隔离复跑，两项均通过，耗时 11.73 秒／2.50 秒；这些结果尚未说明两项失败的原因。首轮与专项日志分别为 `/tmp/pnds-performance-actions-nov9-check-all.log`、`/tmp/pnds-actions-nov9-runtime-retry.log`。

最终完整检查以 `VITEST_MAX_WORKERS=4 RUST_TEST_THREADS=1` 复跑并退出 0：类型、ESLint、ast-grep、Prettier、Rust fmt、Clippy、前端及 Rust 工作区／集成／文档测试全部通过。前端 312 个文件通过、1 个既有跳过，3,653 项通过、2 项既有跳过；Rust 主 crate 949 项通过、0 项失败、10 项既有忽略，其余工作区与集成组均通过。最终日志为 `/tmp/pnds-performance-actions-nov9-check-all-final.log`；这是本轮全量通过的依据，首轮失败与两项隔离复跑记录保留如上。

静态构建夹具只导入真实组件、生产 CSS 和边缘折射引擎，以替身阻断 IPC 和业务点击。浏览器核对 Pond、Sand、Stage、Brutal：

| 场景         | 核对结果                                                                                                                                               |
| ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Load／Reload | 清晰环与柔光两轨的原生 `playbackRate` 均为 idle `1 / 3`、hover `1`、leave `1 / 3`，等效平均周期分别为 9 秒／3 秒／9 秒；`currentTime` 连续，没有归零。 |
| Close        | idle 的 power 为 0、轨道 paused，保留普通灰镜片；hover 显示红环并使用原 3 秒周期。                                                                     |
| 未选工程     | 按钮 disabled、opacity 为 1、power 为 0、轨道 paused；左右按钮的玻璃 tint、内侧高光与阴影同值。                                                        |
| 忙碌 Reload  | `aria-busy` 与 disabled 生效，显示 `Stopping…`，动作仍为 `reload`；opacity 为 1、power 为 0、轨道 paused。                                             |
| 键盘焦点     | Reload 的 `focus-visible` 为 2px 轮廓，没有 hover 时仍保持 `1 / 3` 速率。                                                                              |
| 节点／Brutal | 节点保留静态金橙；Brutal 两侧均为 1px 方角描边、不显示玻璃装饰。                                                                                       |
| 文案与作用域 | 英文标签为 Reload；模式按钮与创作测试仍保留原规则。                                                                                                    |

控制台无警告或错误，IPC 调用数为零。截图为本聊天可视化目录的 `performance-actions-nov9-reload.png` 与 `performance-actions-nov9-empty.png`。该夹具没有读取工程、启动真实演出、dev server 或 App；浏览器结果不代替原生 WebView 最终视觉，仍需用户常规启动 App 核对。

### 2026-11-08 首次正式接入验证（历史）

11 月 8 日首次正式接入的 `npm run check:all` 全绿：前端 312 个文件通过、1 个既有跳过，3,651 项通过、2 项既有跳过；主 Rust crate 949 项通过、10 项既有忽略，其余工作区／集成／文档测试通过，类型、ESLint、ast-grep、Prettier、Rust fmt 和 Clippy 均通过。`npm run build` 通过。日志为 `/tmp/pnds-performance-actions-app-check-all.log` 和 `/tmp/pnds-performance-actions-app-build.log`。

新增组件回归通过真实 restart／外部 stop 流程核对：commandPending 先于快照、pendingChanges 提前清零、stopping→starting→ready 的门禁和色环外观接续，以及外部关闭的准确忙碌文案。颜色测试覆盖四主题固定镜片及不透明回退的文字／焦点对比度，装饰仍不参与按钮命名。

一次性静态构建夹具引用真实 `SessionActionButton`、`DesktopActionGlass`、`CreationModeButton`、`CreationTestControls`、App CSS 和折射引擎。浏览器核对四主题、中文／英文、加载／关闭／重新打开／节点／禁用／忙碌状态：普通主题是透明玻璃主体与主题文字，Brutal 是中性方角实底及对应描边；按钮保持 100px 最小宽、30px 高。悬停起转与退出暂停的实际周期为 3 秒，两份边线都为 `0.18s`，镜片背景保持一致；退出保持非零相位。键盘焦点显示 2px outline 且不转动，文字滤镜为 none。创作测试和模式按钮未套用性能动作静态环，既有引导规则保留。控制台无错误／警告，IPC 调用数为零；截图为本聊天可视化目录的 `performance-action-app-preview.jpg`。

夹具未读取工程、运行真实演出或启动 dev server，核对后已关闭浏览器夹具与静态服务。减少动态／透明度、强对比及 forced-colors 为源码优先级复审与回退对比度检查，未切换系统偏好；原生 WebView 的实机视觉仍待用户启动 App 核对。以下记录均为接入前的独立原型证据。

## 固定双彩虹与退出修订验证（正式接入前）

独立脚本通过四主题 × 双语 × 八场景共 64 个初始化组合、12,159 项断言，0 脚本错误。加载／重新打开的两组七色色点与生产源完全一致；无旧 A／B 控件、参数或左右键切换，旧 URL 自动清理对照参数。覆盖演出动作、计时器归属、忙碌门禁、英文同步和源级退出规则。

浏览器在 Pond／Sand／Stage 逐项核对悬停与移开：镜片背景前后一致，动态／静态边线都是 `0.18s ease`；退出时光谱仍保留原动画名并为 paused，旋转矩阵保持非零相位，没有归零跳变。加载与重新打开的实际 conic-gradient 完全相同。最终页面无警告或错误，截图为本聊天可视化目录的 `semantic-action-rings-rainbow-preview.jpg`。这些只验证独立原型，不代替 App 接入与原生 WebView 验收。

原型最终一轮 `npm run check:all` 全绿：类型、ESLint、ast-grep、Prettier、Rust fmt、Clippy、前端及 Rust 工作区测试通过。前端 3,643 项通过、2 项既有跳过；主 Rust crate 949 项通过、10 项既有忽略，其余集成／工作区／文档测试通过。最终日志为 `/tmp/pnds-semantic-action-rings-rainbow-check-all-final.log`。此前串行首轮唯一失败为 CLI 夹具临时端口占用，未改源码复跑该组 9 项通过，随后再次完整检查通过；首次日志与专项复跑日志分别为 `/tmp/pnds-semantic-action-rings-rainbow-check-all.log`、`/tmp/pnds-semantic-action-rings-cli-retry.log`。该轮检查发生在正式 App 接入这些原型样式之前。

## 上轮悬停修订验证（暂停交接及固定彩虹前）

独立脚本重跑通过：128 个初始化组合、22,356 项断言、0 脚本错误，覆盖双语、四主题、两方案、八场景及加载／关闭／重开流程。源级检查确认四种动作默认没有动画，忙碌与禁用不转；旧常转开关／参数已经移除，减少动态规则优先于 hover。原 C 与生产动画的 41 个相位样本完全一致。

浏览器在用户当前 371px 预览画幅核对 Pond／Stage 和四种动作：每个样品分别悬停时实测为 `desktop-rainbow-orbit`、`3s`、`linear`，其他按钮仍为 `none`；移开后五个按钮的十份光谱全部为 `none`，动态环透明度为零，恢复固定单色线。最终五个折射实例装载，控制台无错误／警告。截图为本聊天可视化目录的 `semantic-action-rings-hover-preview.jpg`。原型样例的点击会更新底栏场景，没有真实 App 操作。

本轮再次执行 `npm run check:all`，在工作区其他文件的 TypeScript 错误处中断，包括 `src/App.tsx`、创作组件与 store 等，未进入 Rust 检查。本次修改仅涉及原型、文案和说明，未修改这些源码；不能宣称全量检查通过。日志为 `/tmp/pnds-semantic-action-rings-hover-check-all.log`。原型文件的格式检查与 `git diff --check` 通过。

## 首轮验证（上述悬停与配色修订前）

独立 jsdom 复核通过：四主题 × 双语 × 两方案 × 八场景共 128 个初始化组合，22,740 项断言，0 脚本错误。覆盖加载／关闭／重开、重复点击门禁、切场景与重置清理计时器、主题／语言／方案切换保留动作，以及唯一 ID、按钮名称、表单标签、`aria-busy` 和双语源同步。临时脚本为 `/tmp/pnds-semantic-action-review.mjs`，没有新增产品业务测试。

浏览器在 1280px 画幅核对四主题、中文／英文、上方放大样品与下方原尺寸底栏，以及重新打开的进行中门禁和完成状态。底栏按钮实测 112 × 30px，普通主题主体透明、文字没有内容滤镜，Pond 最终五个边缘光学实例均已装载；Brutal 为方角、装饰隐藏、零滤镜。最终控制台无警告或错误。截图 `/tmp/pnds-semantic-action-rings-preview.jpg`，预览使用仅监听回环、只提供本原型及必要 CSS／字体的静态服务，未启动 dev server。系统偏好回退仅核对 CSS，未模拟系统设置；窄窗口未作浏览器验收。

浏览器与脚本检查只说明原型的布局、色环和内存流程，不代替正式 App 或原生 WebView 验收。

本轮 `npm run check:all` 的类型、ESLint、ast-grep、Prettier、Rust fmt、Clippy 与前端测试通过：311 个文件通过、1 个既有跳过，3,630 项通过、2 项既有跳过。Rust 主 crate 为 926 项通过、5 项端口相关失败、10 项忽略；失败涉及现有 preflight／运行端口／录制夹具。用 `RUST_TEST_THREADS=1` 串行复跑完整检查时，工作区的 `session.rs` 已新增 `mod runtime_health`，而对应 `session/runtime_health.rs` 尚不存在，检查因此在 Rust fmt 中断。本次未改 Rust 文件，未修复或覆盖这部分同时发生的修改，不能宣称全量全绿。日志分别为 `/tmp/pnds-semantic-action-rings-check-all.log` 与 `/tmp/pnds-semantic-action-rings-check-all-serial.log`。
