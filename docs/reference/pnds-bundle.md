# .pnds 工程包

## 定位

`.pnds` 是**运输容器**：一个自包含的 score project 加一份 bundle 元数据，压缩成单一文件，便于拷贝与分发。

- bundle 内的工程目录就是一份普通的、符合 [structure.md](./structure.md) 工程结构规范的目录工程；
- App 永远不从压缩包内运行工程——安装时一次性解压，运行与目录工程完全一致；
- 压缩格式不影响任何运行时行为（进程、health、音频、关闭协议）。

## 文件格式

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
- 工程根目录内的布局、校验与 containment 规则完全由工程结构规范定义，本规范不重复、不放宽；
- 根目录名 SHOULD 为工程显示名（打包时按「打包」一节清洗）；打开端**不得依赖**这个名字定位工程（以唯一根目录 + `manifest.json` 为准）；
- 文件条目应保留 unix 权限位（node_modules 中的可执行文件依赖它）；
- 归档内条目一律使用相对路径、正斜杠分隔；绝对路径、`..` 逃逸与符号链接条目都是非法的（打开端必须拒绝）。

## 打包

入口：**设置（⌘,）→ 开发者工具 →「打包工程」**。默认打包当前选中工程，可「浏览…」换任意文件夹。

打包前置校验（任一失败即拒绝并给出可读错误）：

1. `manifest.json` 通过 App 的完整加载校验（含 manifest 引用的 synthdefs 产物逐个存在）；
2. 依赖校验：`package.json` 声明非空生产依赖（`dependencies` / `optionalDependencies`）时，工程必须已携带 `node_modules/`；
3. 打包过程**不执行任何 npm 命令**、不联网、不改动源工程目录。

staging 与排除清单：

- 复制在系统临时目录的 staging 中进行，源工程目录零改动；
- 排除清单（不进入 bundle）：任意深度的 `.DS_Store` 与 `.git*` 文件/目录；仅工程根目录下的 `docs/`、`test/`、`tests/` 目录（创作期资料，非运行资产）；
- 源工程中的符号链接：目标位于工程目录内的按普通文件物化拷贝；指向工程外的跳过；
- 其余文件原样复制（含 `node_modules/`、`.scd` 源、audio/、public/ 等——排除只做减法，从不重排或改写内容）；
- devDependencies 不影响打包校验，但会随 `node_modules` 原样进包——发布前 `npm prune --omit=dev` 清理可显著减小 `.pnds` 体积。

产物：

- 输出路径：工程同级目录下的 `<name>-<version>.pnds`，其中 `name` 为清洗后的 manifest `name`（替换 `/\:*?"<>|` 为 `-`），`version` 为 manifest `version`；
- 已存在同名文件时，由 UI 层先确认再覆盖（覆盖 = 整体重写）；
- 写入采用同目录临时文件 + 原子 rename；
- 成功后向创作者展示产物路径与文件 sha256（十六进制），供分发后人工校验。v1 的打开端**不强制**校验 sha256。

`pnds-bundle.json`：

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

## 安装

双击 `.pnds`（App 已声明文件关联）或在 ⌘O 对话框选中——把文件拖到 App 窗口或 Dock 图标等同于双击——App：

1. 校验 `pnds-bundle.json`（存在、可解析、`formatVersion` 受支持）；
2. 校验结构（唯一根目录、根目录内有 `manifest.json`）；
3. 一次性同步解压到 App 数据目录 `bundles/<id>-<version>/`（`id`、`version` 取自包内 manifest）；
4. 解压后对安装目录执行完整 manifest 校验；
5. 随即走与目录工程完全相同的 openProject → preflight → session 流程。

工程列表（侧栏与设置 Projects）显示 manifest 的 `name`（App 在每次 preflight 成功后学习并持久化该名字），而非安装目录名 `<id>-<version>`；用户手动改名（⌘R）仍优先。

覆盖重装：

- 安装目录名由 `<id>-<version>` 决定；同 `id`+`version` 重复打开**总是覆盖重装**（先删除旧目录再解压）；
- `id` 与 `version` 必须各自是单一路径段（拒绝包含 `/`、`\` 或 `..` 的值）。

安全：

- 解压前逐条目校验：拒绝绝对路径、`..` 逃逸与符号链接条目（zip-slip 防护）；
- bundle 是创作者交付物，但 App 仍不赋予它任何额外能力：安装后的工程与普通目录工程适用同一运行边界。

目录回收：

- `bundles/` 是 App 自管区域：从工程历史移除一个安装目录直接位于 `bundles/` 下的工程时，App 顺带删除该解压目录；
- 用户磁盘上的普通工程不受影响（任何 `bundles/` 之外的路径都不会被删除）。

## 版本号语义：内容变更必须升 version

接收方的安装槽位由 **`<id>-<version>`** 决定，且同 `id`+`version` 重复打开**总是覆盖重装**（删旧目录再解压，最后打开的文件获胜）。

因此，**任何内容变更都必须递增 `manifest.json` 的 `version`**。不升版本号的后果：

- 新旧两次构建共用同一个文件名 `<name>-<version>.pnds` 和同一个安装槽位，接收方在 App 里**无法分辨**装的是新内容还是旧内容；
- 接收方一旦重新打开手头的旧 `.pnds` 副本（下载文件夹、邮件附件里很常见），覆盖重装写回的就是**旧内容**——你以为发出了修复，对方演出的仍是旧版；
- 两次构建的 sha256 不同，但 App 不校验它，救不回来。

升了版本号则是干净的新槽位、新文件名，新旧互不干扰。注意两点：

- 新版本安装后，接收方列表里的旧版本条目不会自动消失，可手动移除（移除会顺带回收其解压目录）；
- `id` 与 `version` 各自必须是单一路径段（不含 `/`、`\`、`..`），建议 `id` 用小写连字符串、`version` 用 `0.1.2` 这类语义化版本：修复递增 patch，新增能力递增 minor，破坏性变更递增 major。

## 分发

把 `.pnds` 文件发给接收方（网盘、AirDrop、U 盘、邮件皆可），并**连同 sha256 一起发**。接收方需要已安装 PNDS App，但不需要 Node.js、SuperCollider，也不需要网络。

sha256 的用途：确认“发出去的”和“收到的”是同一个文件。接收方在终端执行：

```sh
shasum -a 256 <name>-<version>.pnds
```

与创作者提供的值一致，即传输无损、且是预期的那次构建。

## 创作机与演出机

|               | 创作机（你的 Mac）                     | 演出机（接收方的 Mac）                    |
| ------------- | -------------------------------------- | ----------------------------------------- |
| PNDS App      | 需要                                   | 需要                                      |
| Node.js       | 需要（开发与 `npm install`）           | 不需要（App 自带固定 Node）               |
| SuperCollider | Internal 模式：需要（仅编译 SynthDef） | Internal 模式：不需要（App 自带 scsynth） |
| npm / 网络    | 创作期可用                             | 运行与安装 `.pnds` 均不需要               |

工程在演出机上**不得依赖**宿主安装的 Node.js、SuperCollider、`sclang` 或第三方 UGen。

## 内置工具的形态

内置工具（Local Network Diagnostics、Multichannel Signal Generator、Telematic Network Diagnostics）的 release 与所有工程一样是 `.pnds`：各工具仓库的 CI 按文件格式布局组装并发布。随 App 分发则采用**解包后的文件夹形态**：App 构建期按注册表（`utilities.json`，随仓库提交）拉取，sha256 校验失败即构建失败；校验 bundle 布局（单一根目录 + 顶层 `pnds-bundle.json` + manifest id 与注册表一致）后，把工程目录解包到稳定路径 `Contents/Resources/utilities/<id>/`（路径不含版本号），App 原地运行该目录，不安装到数据目录 `bundles/`。

- 入口形态：Utilities 是受保护文件夹（固定底部、不可改名/删除）；内置工具以普通工程条目形式列出，点击走标准 preflight → spawn → health → monitor 流程，无独立启动器 UI；
- 用户从 Utilities 移除某工具后，重启不会自动加回（文件夹仅在缺失时播种）；
- 不提供「复制为普通工程」；资源目录随 App 包，需要副本时由操作者手动复制。

## 合规清单

一个 `.pnds` 产物至少应满足：

1. zip（deflate）归档，顶层 = 唯一工程根目录 + `pnds-bundle.json`；
2. 包内工程通过 [structure.md](./structure.md) 工程合规清单的前三项（manifest 校验、路径 containment、生产依赖随包）；
3. 排除清单生效（无 `.git`、`.DS_Store` 等非运行文件）；
4. 文件权限位保留；
5. 在另一台机器上安装后可直接 preflight 并启动。
