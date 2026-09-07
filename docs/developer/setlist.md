# setlist 导入导出（演出文件夹）

v1.4.0（#59 导出、#63 导入，spec #57）。演出文件夹的移交机制：导出为可整拷目录，另一台 Mac 导入后工程全部安装、文件夹编组与顺序、显示名完整重建。

## 交换格式（钉死）

导出目录布局：

```text
<导出目录>/
├── <name>-<version>.pnds   # 每个成员工程一份，文件名与 .pnds 打包规则一致
├── …
├── set.json                # 演出描述（人可读、可手改）
└── README.txt              # 导入说明（按导出机界面语言生成）
```

`set.json` 的 schema 唯一权威是 `src/lib/setlist.ts` 的模块注释（序列化 + 解析同一处）；字段变更必须升 `formatVersion`。要点：

- **身份键 = manifest `id` + `version`，绝不是绝对路径**——`.pnds` 安装落在每台机器自己的数据目录，路径键活不过换机（`project-store.ts` 的 `replaceProjectIndex` 注释是这条决策的原始记录）；
- `projects` 数组顺序即演出顺序；`file` 字段是提示性的（手改文件名不破坏导入匹配）；
- 记录显示名、默认音频模式、External OSC target；**不含**设备、采样率、主题、节点配置等本机偏好——设备是本机偏好，契约不变；
- `oscTarget` 省略 = 从未设置（不写默认值 `127.0.0.1:3333`，手改者读「缺省」为「未设置」）；
- 解析（`parseSetlist`，导入侧消费）：非法 JSON、不认识的 `formatVersion`、空 `name`/`id`/`version`、同一身份出现两次——可读错误拒绝；未知字段忽略。

## 导出链路

```
侧栏文件夹 segment 右键 →「导出演出文件夹…」（Sidebar 上下文菜单）
  └─ src/lib/setlist-export.ts   exportSetlistFolder(folderId)
       ├─ plugin-dialog 选目录（取消 = 什么都不发生）
       ├─ commands.getSetlistExportInfo(paths)   ← 描述即打包性预检（Rust）
       ├─ 重复身份检查（duplicateSetlistIdentity）→ 拒绝
       ├─ 包文件名查重（`.pnds` 名源自 name+version，不同工程同名同版本
       │   会静默互相覆盖）→ 拒绝
       ├─ 组装 + serializeSetlist（显示名走 display-names 的唯一命名规则；
       │   oscTarget 来自 preferences.oscTargets[manifest id]）
       ├─ commands.exportSetlist(destDir, setlistJson, readme, paths)（Rust）
       │    ← 每个工程打包前发 pnds:setlist-export-progress 事件
       │      （{ done, total, fileName }，done 0 基）
       └─ flow toast：loading 逐工程走查 → 成功/失败就地翻转（见
          notifications.md 的 Flow toasts）+ plugin-opener revealItemInDir
```

- UI 门控：空文件夹与「工具」文件夹的菜单项禁用并显示原因（沿用禁用项必给原因的既有模式）；
- Rust 侧 `src-tauri/src/project/setlist.rs`（path-based，tempdir 可测）：`describe_projects` 逐个过 `validate_packable`（与打包同一道门）；`export_setlist` 逐个 `pack_project_to`（`project/bundle.rs` 提取出的显式输出路径 pack 核心，staging 隔离同打包），文本文件最后写（`set.json` 落盘即代表它描述的产物已就位），**任一步失败移除本次写入的全部产物**——不留「看起来完整」的半成品目录；
- 同名产物（重导出到同一目录）覆盖——重导出拥有该目录的自己产物。

## 导入链路（#63）

入口是**既有开放手势的智能路由**，没有新菜单：⌘O（`promptOpenProject`）与 Finder 拖拽（`handleDroppedPaths`）对目录先问 `readSetlist`——有 `set.json` 即演出导出目录，整目录导入；没有则照旧走 `openProject`。接收方操作者「打开这个目录」的自然手势就是导入。

```
src/lib/setlist-import.ts   importSetlistDirectory(dir) → boolean
  ├─ commands.readSetlist(dir)（Rust）   ← Err = 无 set.json，路由回落 openProject
  ├─ parseSetlist（纯逻辑缝校验 set.json）→ 可读错误
  ├─ matchSetlistBundles（纯逻辑缝）      ← 身份匹配，缺包点名拒绝
  ├─ 逐个 commands.installBundle(file)    ← 现有安装管线，绝不第三种安装行为；
  │                                        失败即中止在索引重建之前
  ├─ replaceProjectIndex(paths, folders, names)（v1.3.2 预留缝，见
  │   state-management.md——批量即加载、绕过每目录上限、App 内容随行）
  ├─ 逐工程 updateOscTarget（唯一随行设置；手改垃圾值经 isValidOscTarget 拒收）
  └─ setActiveFolderView(新文件夹)        ← 落地即见重建后的演出顺序
```

- Rust `read_setlist`（`project/setlist.rs`）：`set.json` **原文**返回（校验在前端解析缝）；旁扫每个 `.pnds` 的 manifest 身份（宽松打探——坏包跳过，安装才是校验门），按文件名排序保证重名身份确定性；
- 重建语义 = `replaceProjectIndex` 的既有决策（do not relitigate）：导入即加载，接收机原有非工具工程让位；Utilities 与本轮工具随行、底部钉扎；显示名按**本机安装路径**建覆盖；
- 默认音频模式不落盘：App 模型里它来自 manifest，预取时重置（导出侧本就取自 manifest）；`set.json` 的 `audioMode` 是给人读的演出配置记录；
- 安装中途失败：已装产物留在 `bundles/`（幂等，重跑导入即治愈），索引不重建——不出现半个演出文件夹。
