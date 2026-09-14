# PNDS Template 的结构

## 工程定义

PNDS score project 是用户明确选择的一个本地目录。工程拥有并实现：

- 乐谱服务器入口；
- performer 页面与 monitor/conductor 页面；
- 工程自己的网络交互与 Socket.IO 协议（如使用）；
- 工程自己的 OSC 地址、参数与声音控制逻辑；
- Internal 模式需要的已编译 `.scsyndef`；
- 生产运行所需的本地依赖和静态资产。

工程不是 PNDS App 插件，也不获得 Tauri API。高频演奏消息必须在客户端、工程 Node 服务器和音频目标之间直接传递，不经过 PNDS App 的 Rust/React 层。

## 目录结构

工程根目录必须包含：

```text
project/
├── manifest.json
└── <scoreServer.entry>
```

根据工程实现，还可以包含：

```text
project/
├── package.json
├── node_modules/                 # 仅在存在生产依赖时需要
├── public/                       # performer / monitor 静态资源
├── audio/                        # 工程音频与 OSC 控制代码
├── README.md                     # 可选的工程自述（见下一节）
├── cover.png                     # 可选封面图（约定见下节）
└── supercollider/
    └── synthdefs/*.scsyndef      # Internal 模式的运行时 artifact
```

以 _Inarticulate III_ 为例：

```text
Inarticulate III/
├── manifest.json
├── server.js
├── node_modules/
├── public/
└── supercollider/
    └── synthdefs/
        └── inarticulate-iii.scsyndef
```

规则：

- App 不执行 `npm install`，运行时不得依赖网络安装；
- `package.json` 声明了非空 `dependencies` 或 `optionalDependencies` 时，工程必须携带可用的 `node_modules/`；没有生产依赖时不要求创建空 `node_modules/`；
- `.scd` 只属于创作与调试阶段，不能作为 App 托管运行时资产；
- 工程不得依赖宿主机器安装 Node.js、SuperCollider、`sclang` 或第三方 UGen；
- 官方工程应在 `package.json` 中声明其开发和验证过的 Node major（如 `">=24 <25"`）。

## 工程自述 README.md（可选）

工程根目录的 `README.md` 是给**演出现场的人**读的自述。App 在主界面选中该工程的卡片时读取并渲染它（v1.5.0 起）；没有这份文件就是空态，**preflight 不检查它**——它是文档，不是合规条件。

约定：

- 纯 markdown，GFM 表格与围栏代码块正常渲染，裸 HTML 一律不渲染；
- 体积保持克制（超大的自述会被 App 拒绝渲染并提示）；
- 它随 `.pnds` 原样旅行（打包排除清单从不清除它），接收方装包后在 App 里看到的就是它。
- 可选语言变体：`README.<locale>.md`（如 `README.zh-CN.md`）——App 按界面语言自适应优先打开对应变体，没有则回落到 `README.md`；
- 可选封面图 `cover.png`：README 面板横带的工程截图（依序探测 `.png` → `.jpg` → `.jpeg` → `.webp`，语言无关，建议 1:1）；与 README.md 一样随 `.pnds` 原样旅行，preflight 同样不检查；
- 封面页格式：README 顶部可携带元数据块（`title` / `composer` / `composer_url` / `github_url` / `color_palette`），App 据此把首个 `##` 小节渲染成设计好的封面页（面板内容止于首个 `---`）；无元数据块的 README 按普通文档渲染，旧工程不受影响。细则见帮助中心《给工程写 README》；

推荐大纲（作品名称、作者、简介、演奏方式，可选技术需求）：

```markdown
# <作品名称>

**作者**：<姓名 / 团队>

## 简介

<这个作品是什么、编制、时长——给演出操作者的一段话>

## 演奏方式

<如何启动与操作：页面分配、交互手势、注意事项>

## 技术需求（可选）

<音频模式、外接设备、网络等演出场地需要准备的东西>
```

写作细则见帮助中心「创作指南」的《给工程写 README》。注意与**演出文件夹自述**区分：那是 App 内表单写的文件夹简介（结构化存储，导出时合成进演出文件夹导出目录的 `README.md`），不是工程的这份文件。

## 工程合规清单

1. manifest 必填、模式、端口、outputChannels 与 bus 容量校验；
2. 所有声明路径的 containment 与存在性校验；
3. 有生产依赖时携带完整 `node_modules`；
4. performer health 按 [runtime-contract.md](./runtime-contract.md) §5 返回 ready；
5. monitor 可嵌入并正确响应 resize；
6. Internal 输出严格遵守 App 注入的 bus 与通道数；
7. SIGINT/SIGTERM 后释放工程拥有的全部资源；
8. 在 App 固定 Node runtime 下完成实际启动验证。
