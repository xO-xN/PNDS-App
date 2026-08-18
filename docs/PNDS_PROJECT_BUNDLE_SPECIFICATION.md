# PNDS Project Bundle Specification

本文档定义 `.pnds` bundle 的文件格式、打包规则与安装（打开）规则。它是 bundle 格式的唯一规范来源（初稿随 v1.2.0 issue #16 入库）。

相关规范：

- 目录工程静态格式：[`PNDS_SCORE_PROJECT_SPECIFICATION.md`](./PNDS_SCORE_PROJECT_SPECIFICATION.md)
- 进程/环境变量/health/音频 bus：[`PNDS_RUNTIME_CONTRACT.md`](./PNDS_RUNTIME_CONTRACT.md)
- App 产品行为：[`PNDS_APP_REQUIREMENTS.md`](./PNDS_APP_REQUIREMENTS.md)

---

## 1. 定位

`.pnds` 是**运输容器**：一个自包含的 score project 加一份 bundle 元数据，压缩成单一文件，便于拷贝与分发。

- bundle 内的工程目录就是一份普通的、符合 Score Project Specification 的目录工程；
- App 永远不从压缩包内运行工程——安装时一次性解压，运行与目录工程完全一致；
- 压缩格式不影响任何运行时行为（进程、health、音频、关闭协议）。

## 2. 文件格式

`.pnds` = ZIP 归档（deflate 压缩），顶层布局固定为：

```text
<root>/                     # 恰好一个根目录，内含完整可运行工程
├── manifest.json
├── server.js
├── node_modules/…          # 仅当工程声明生产依赖
└── …                       # 工程其余文件（原始相对结构与权限）
pnds-bundle.json            # bundle 元数据（位于归档顶层，不在工程目录内）
```

规则：

- 顶层必须**恰好存在一个目录条目**，其余顶层条目只允许 `pnds-bundle.json`；
- 工程根目录内的布局、校验与 containment 规则完全由 Score Project Specification 定义，本规范不重复、不放宽；
- 根目录名 SHOULD 为工程显示名（打包时按 §3.2 清洗）；打开端**不得依赖**这个名字定位工程（以唯一根目录 + `manifest.json` 为准）；
- 文件条目应保留 unix 权限位（node_modules 中的可执行文件依赖它）；
- 归档内条目一律使用相对路径、正斜杠分隔；绝对路径、`..` 逃逸与符号链接条目都是非法的（打开端必须拒绝，见 §4.3）。

## 3. 打包（App → `.pnds`）

### 3.1 打包前置校验

打包前必须全部通过，任一失败即拒绝打包并给出可读错误：

1. `manifest.json` 通过 App 的完整加载校验（含 manifest 引用的 synthdefs 产物逐个存在）；
2. 依赖校验：`package.json` 声明非空生产依赖（`dependencies` / `optionalDependencies`）时，工程必须已携带 `node_modules/`；
3. 打包过程**不执行任何 npm 命令**、不联网、不改动源工程目录。

### 3.2 staging 与排除清单

- 复制在系统临时目录的 staging 中进行，源工程目录零改动；
- 排除清单（不进入 bundle）：
  - 任意深度的 `.DS_Store` 与 `.git*` 文件/目录（如 `.git/`、`.gitignore`）；
  - 仅工程根目录下的 `docs/`、`test/`、`tests/` 目录（创作期资料，非运行资产）；
- 源工程中的符号链接：目标位于工程目录内的按普通文件物化拷贝；指向工程外的跳过（在别人机器上本来就是断链）；
- 其余文件原样复制（含 `node_modules/`、`.scd` 源、audio/、public/ 等——排除只做减法，从不重排或改写内容）。

### 3.3 产物

- 输出路径：工程同级目录下的 `<name>-<version>.pnds`，其中 `name` 为清洗后的 manifest `name`（替换 `/\:*?"<>|` 为 `-`），`version` 为 manifest `version`；
- 已存在同名文件时，由 UI 层先确认再覆盖（覆盖 = 整体重写）；
- 写入采用同目录临时文件 + 原子 rename；
- 成功后向创作者展示产物路径与文件 sha256（十六进制），供分发后人工校验。v1 的打开端**不强制**校验 sha256。

### 3.4 `pnds-bundle.json`

```json
{
  "formatVersion": 1,
  "packedWith": "1.2.0",
  "packedAt": "2026-08-17T12:00:00Z",
  "sourcePlatform": "macos-arm64"
}
```

| 字段             | 类型   | 说明                                                  |
| ---------------- | ------ | ----------------------------------------------------- |
| `formatVersion`  | 正整数 | 本规范版本，当前为 `1`；打开端只支持自己认识的版本    |
| `packedWith`     | 字符串 | 打包 App 版本（仅记录）                               |
| `packedAt`       | 字符串 | 打包时刻，RFC 3339 UTC（仅记录）                      |
| `sourcePlatform` | 字符串 | 打包机平台标识（仅记录；v1 打开端不强制目标平台校验） |

## 4. 安装（`.pnds` → 运行）

### 4.1 入口与流程

双击 `.pnds`（App 已声明文件关联）或在 ⌘O 对话框选中，App：

1. 校验 `pnds-bundle.json`（存在、可解析、`formatVersion` 受支持）；
2. 校验结构（唯一根目录、根目录内有 `manifest.json`）；
3. 一次性同步解压到 App 数据目录 `bundles/<id>-<version>/`（`id`、`version` 取自包内 manifest）；
4. 解压后对安装目录执行完整 manifest 校验；
5. 随即走与目录工程完全相同的 openProject → preflight → session 流程。

列表命名：工程列表（侧栏与设置 Projects）显示 manifest 的 `name`（App 在每次 preflight 成功后学习并持久化该名字），而非安装目录名 `<id>-<version>`；用户手动改名（⌘R）仍优先。Finder 拖拽工程目录或 `.pnds` 文件到 App 窗口等同于 ⌘O 选中；拖到 Dock 图标等同于双击。

### 4.2 覆盖重装

- 安装目录名由 `<id>-<version>` 决定；同 `id`+`version` 重复打开**总是覆盖重装**（先删除旧目录再解压）；
- `id` 与 `version` 必须各自是单一路径段（拒绝包含 `/`、`\` 或 `..` 的值）。

### 4.3 安全

- 解压前逐条目校验：拒绝绝对路径、`..` 逃逸与符号链接条目（zip-slip 防护）；
- bundle 是创作者交付物，但 App 仍不赋予它任何额外能力：安装后的工程与普通目录工程适用同一运行边界。

### 4.4 目录回收

- `bundles/` 是 App 自管区域：从工程历史移除一个安装目录直接位于 `bundles/` 下的工程时，App 顺带删除该解压目录；
- 用户磁盘上的普通工程不受影响（任何 `bundles/` 之外的路径都不会被删除）。

## 5. 内置工具

内置工具(Local Network Diagnostics、Multichannel Signal Generator)的 release 与所有工程一样是 `.pnds`:各工具仓库的 CI 按 §2 布局组装并发布 `.pnds`(`packedWith` 记录该工具的 release tag),这是面向公众的分发格式。随 App 分发则采用**解包后的文件夹形态**:App 构建期按注册表(`utilities.json`,随仓库提交)拉取,sha256 校验失败即构建失败,校验 bundle 布局(单一根目录 + 顶层 `pnds-bundle.json` + manifest id 与注册表一致)后,把工程目录解包到稳定路径 `Contents/Resources/utilities/<id>/`(路径不含版本号;`pnds-bundle.json` 是运输元数据,不进入解包产物)。App 原地运行该目录,不安装到数据目录 `bundles/`;App 更新随包自然携带新版本,Utilities 的工程历史条目因路径稳定而永不过期。此形态为 v1.2.0 #18 定案后的复核修订(原定案:随包携带 .pnds 文件 + 首启装入数据目录)。Utilities 入口细节(定案不变):

- **入口形态**:Utilities 保持既有受保护文件夹(固定底部、不可改名/删除);内置工具以普通工程条目形式列出(路径指向 `Contents/Resources/utilities/<id>/`),点击走标准 preflight → spawn → health → monitor 流程,无独立启动器 UI。
- **复制为普通工程**:不提供。资源目录随 App 包(在 Finder 中显示包内容可达);需要副本时由操作者手动复制。
- **版本显示**:不做专门版本 UI;列表名来自 manifest(App 每次启动解析资源时学习,无需先打开一次),与普通工程一致,版本记录在 manifest 中。
- **成员编辑**:用户从 Utilities 移除某工具后,重启不会自动加回(文件夹仅在缺失时播种)。

## 6. 合规清单

一个 `.pnds` 产物至少应满足：

1. zip(deflate) 归档，顶层 = 唯一工程根目录 + `pnds-bundle.json`；
2. 包内工程通过 Score Project Specification §8 合规清单的前三项（manifest 校验、路径 containment、生产依赖随包）；
3. 排除清单生效（无 `.git`、`.DS_Store` 等非运行文件）；
4. 文件权限位保留；
5. 在另一台机器上安装后可直接 preflight 并启动。
