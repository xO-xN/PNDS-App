# 共享包候选的体积与作品兼容核查

日期：2026-10-12。只读测量与规划依据；共享首批清单尚未确认，不代表共享包已经实现或工程已经迁移。版本决定见[逐轮讨论](./pre-v1.7-release-grilling.md)。

最新修订：用户选择每项共享库的单一较新版本，先验证三作品兼容，模型由工程自带。下文含模型和多旧版本的 24.60／31.20 MiB 表保留为原方案调查记录，不作为新方案的体积估算。

发行门槛补充：三个作品必须在 v1.6.2 App 发行时可运行，兼容失败由用户更新作品后重验；暂未迁移不能作为放行例外。正式采用的共享版本写回工程引用并更新工程版本。

## ml5 与 HandPose 的关系

当前 Mobile Sensor Meter 的 `ml5.min.js` 为 1.4.0，包含 TFJS 与模型加载代码。HandPose 的 detector／landmark 模型 JSON 和权重是另行保存的文件，并不包含在这个 JS 文件内。工具通过本地模型 URL 使用它们，保证断公网加载；并不是另建一套手势识别系统。

本机来源：[PINNED.json](../../../Mobile-Sensor-Meter/public/vendor/handpose/PINNED.json)、[下载与完整性脚本](../../../Mobile-Sensor-Meter/scripts/fetch-handpose.mjs)、[本地加载逻辑](../../../Mobile-Sensor-Meter/public/handpose-logic.js)。上游 TensorFlow.js [模型 URL 常量](https://github.com/tensorflow/tfjs-models/blob/master/hand-pose-detection/src/tfjs/constants.ts)也将 detector 与 landmark 指向单独的模型地址。

## 候选资源的原始文件体积

按当前锁定生产依赖树排除 dev 包，并按相同包版本及实际内容去重。数值是文件内容字节，未包含共享索引、加载适配、文件系统分配与签名；不是最终安装器体积。

| 内容                                         | 字节       | MiB   |
| -------------------------------------------- | ---------- | ----- |
| p5 2.3.2                                     | 990,372    | 0.94  |
| ml5 1.4.0（含 TFJS）                         | 4,512,403  | 4.30  |
| HandPose 两模型的 JSON 与权重                | 4,133,206  | 3.94  |
| PINNED 来源记录                              | 1,309      | <0.01 |
| 五类 Node 依赖根及完整生产闭包的内容去重集合 | 16,154,635 | 15.41 |
| 合计                                         | 25,791,925 | 24.60 |

五类 Node 根为 Express、qrcode、socket.io、socket.io-client、osc-min。固定版本不能随意统一；表中生产内容集合含 127 个包内容版本。实际可执行的共享目录布局仍须实现与验证，不能仅有这份去重集合就声称 Node 加载已可用。

若同时支持 Inarticulate III／IV 的现有精确依赖，需要补 p5 1.10.0 与九种额外包内容版本，合计增加 6,920,797 字节。候选总量变为 **32,712,722 字节，31.20 MiB**；这些额外包包含锁定生产树中的类型包，不代表新增九种作品功能。

## App 净变化与安装器限制

已安装的 `/Applications/PNDS.app` 为 v1.5.2。其四项工具现有生产依赖及 Mobile Sensor Meter 的 vendor 文件合计 39,160,257 字节，约 37.35 MiB。因此共享目录的总量不能全部计为新增：这些资源已有大量随工具进入 App。

若完成官方工具适配、删除相应重复资源并按上述内容去重，基础候选与现有对应资源的原始文件对照可减少 13,368,332 字节，约 12.75 MiB；再纳入三作品的旧版本后，对照仍可减少约 6.15 MiB。这是候选内容对照，最终目录布局、索引、适配代码、文件系统与后续旧版本保留会改变实际占用。迁移期间若保留原副本，体积会增加。

另对当前 staged 工具资源做 tar/gzip 压缩对照：保留旧工具组与 Mobile 的两套不同锁树时，共享候选原始内容约 28.54 MiB，gzip 约 9.25 MiB；对应现有候选约 37.52 MiB，gzip 约 11.28 MiB。它使用整树快照，统计基线和布局与前述已安装 App 的内容去重集合不同，不能混用相减，也不能当作 DMG 增量。

本次没有构建新的 arm64／x86_64 发行产物，**精确 `.dmg` 净变化未知**。当前本地可见 DMG 为旧 v1.5.0（arm64 58.10 MiB、x86_64 60.33 MiB），不作为本次迁移的发行基线。

## 三个作品的运行依赖

| 工程                            | 当前依赖与覆盖                                               | 必须保留或适配的内容                                                             |
| ------------------------------- | ------------------------------------------------------------ | -------------------------------------------------------------------------------- |
| Inarticulate III 1.3.0          | Express、qrcode、Socket.IO、osc-min；顶层类别均在候选内      | p5 为 1.10.0，不能静默替换为 2.3.2；八种传递版本需保留；作品 SynthDef 仍随工程   |
| Inarticulate IV 0.1.0           | Express、qrcode、Socket.IO；顶层版本匹配 Mobile Sensor Meter | 同样使用 p5 1.10.0；一个类型包版本不同；完整声音链仍需 Ableton／Max 及作品资源   |
| All Sentient Being Sounds 2.0.1 | Express、qrcode、Socket.IO／client；生产内容与 TND 候选一致  | 使用 Preact 的预编译 dist，不使用 p5／ml5；684 张谱面 PNG 为作品内容，继续随工程 |

本机工程来源：[III](../../../Inarticulate%20III/package.json)、[IV](../../../inarticulate-iv/package.json)、[ASBS](../../../All-Sentient-Being-Sounds/package.json)，版本依据各自 lock 与实际运行资源。ASBS 的 `public/libraries` 共 15,649,302 字节，目录名不能作为第三方库分类的依据。

三工程当前均携带 `node_modules`；现有自包含 `.pnds` 已不要求演出机另行 npm 安装。共享机制可让工程不再各自携带被覆盖的第三方运行包，依赖改由指定版本 App 提供。仍须由外部 agent 完成引用、加载与资源路由适配并回归；它不是零依赖运行，也不提供作品音色、Max／Ableton 或构建时 Preact 工具链。

## 单版本与工程自带模型的新方案

模型约 3.94 MiB 不进入共享目录，但继续留在 Mobile Sensor Meter 工程；该工具随 App 分发，因此其模型仍进入安装体积。当前 ml5 1.4.0 JS 约 4.30 MiB，含 TFJS，可以与模型分别提供。

对本机可用的一组较新依赖作容量对照：Mobile 的 Express 4.22.3／Socket.IO 4.8.4 生产树，加 Socket.IO Client 4.8.4 闭包、qrcode、旧 osc-min／binpack、p5 2.3.2、ml5 1.4.0，不含模型，文件内容约 16.155 MiB，tar/gzip 对照约 3.888 MiB。相应当前工具的重复库内容约 33.573 MiB，迁移后的原始内容对照可减少约 17.418 MiB。这个容量样本尚非用户要求的最新稳定依赖组，也未证明运行兼容，不能当作最终 `.dmg` 增量。

第五轮官方 npm latest 查询结果为 p5 2.3.4、Express 5.3.0、ml5 1.4.0、qrcode 1.5.4、socket.io／socket.io-client 4.8.4、osc-min 2.1.2。npm 的 `dist.unpackedSize` 包含整个发行包的内容，不能代替 App 实际选择的运行资源文件量；最终容量在候选版本及生产锁树验证后重测。

三作品先试新版，不把共存 p5 1.10.0 作为默认方案。静态核查发现 III／IV 的 `preload()` 图片流程需要验证 p5 2.x 加载方式、III 双触点和 IV 时间画面需实际浏览器／手机回归；ASBS 无 p5。Express 5 的监听错误回调、新 osc-min 的 ESM 与 DataView 接口是 Node 接线验证点。官方依据：[p5 迁移说明](https://github.com/processing/p5.js-compatibility)、[Express 迁移说明](https://expressjs.com/en/guide/migrating-5/)、[osc-min 新接口](https://github.com/russellmcc/node-osc-min)。此次尚未改作品或执行迁移试验。
