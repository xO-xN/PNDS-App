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

## 工程合规清单

1. manifest 必填、模式、端口、outputChannels 与 bus 容量校验；
2. 所有声明路径的 containment 与存在性校验；
3. 有生产依赖时携带完整 `node_modules`；
4. performer health 按 [runtime-contract.md](./runtime-contract.md) §5 返回 ready；
5. monitor 可嵌入并正确响应 resize；
6. Internal 输出严格遵守 App 注入的 bus 与通道数；
7. SIGINT/SIGTERM 后释放工程拥有的全部资源；
8. 在 App 固定 Node runtime 下完成实际启动验证。
