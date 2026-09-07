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
       └─ 成功 toast + plugin-opener revealItemInDir
```

- UI 门控：空文件夹与「工具」文件夹的菜单项禁用并显示原因（沿用禁用项必给原因的既有模式）；
- Rust 侧 `src-tauri/src/project/setlist.rs`（path-based，tempdir 可测）：`describe_projects` 逐个过 `validate_packable`（与打包同一道门）；`export_setlist` 逐个 `pack_project_to`（`project/bundle.rs` 提取出的显式输出路径 pack 核心，staging 隔离同打包），文本文件最后写（`set.json` 落盘即代表它描述的产物已就位），**任一步失败移除本次写入的全部产物**——不留「看起来完整」的半成品目录；
- 同名产物（重导出到同一目录）覆盖——重导出拥有该目录的自己产物。

## 导入（#63，未实现）

导入编排复用两条既有缝：`installBundle`（现有 `.pnds` 安装管线，`<id>-<version>` 槽位与覆盖重装语义不变）+ `replaceProjectIndex`（见 [state-management.md](./state-management.md)——批量重建绕过每目录上限，App 内容原样随行）。
