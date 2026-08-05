# Task 1: Node 24.18.1 与工程依赖 preflight

目标 release：PNDS App `1.1.0`。

规范引用：

- `PNDS_SCORE_PROJECT_SPECIFICATION.md` §2
- `PNDS_RUNTIME_CONTRACT.md` §2
- `PNDS_APP_REQUIREMENTS.md` §2、§3、§12

## 目标

将 App 随包 score-project runtime 固定为 ARM64 Node.js `24.18.1`，并允许零生产依赖工程在没有 `node_modules/` 的情况下通过 preflight。

## 依赖与边界

- 本任务是 V1.1 实现起点，无前置任务。
- App 不执行 `npm install`。
- App 暂不解析或强制执行 `package.json#engines`；runtime compatibility 检查留到 V1.2 Project Bundle。
- 不实现 `.pnds`、runtime asset 下载或在线安装。

## 工作内容

### 1. 固定 Node runtime

- 将 `scripts/fetch-node.sh` 默认版本和示例更新为 `24.18.1`。
- 更新脚本中的规范引用和过时 task 编号。
- 重新获取 ARM64 sidecar，并验证二进制版本、官方 checksum 与许可文件。
- 将 release workflow 的构建 Node 固定在 Node 24 系列；避免 `lts/*` 随时间漂移。
- 评估并同步根 `package.json#engines`，使本仓库开发/CI 基线不与 release workflow 冲突。
- 验证 `src-tauri/tauri.conf.json` 的 `externalBin` 仍正确打包 sidecar。

### 2. 条件依赖检查

调整 `src-tauri/src/project/preflight.rs`：

- 不存在 `package.json`：视为零生产依赖，不要求 `node_modules/`。
- `dependencies` 与 `optionalDependencies` 都为空或缺失：不要求 `node_modules/`。
- 任一生产依赖集合非空：要求工程根目录存在可用的 `node_modules/`。
- `package.json` 存在但不是合法 JSON或相关字段类型错误：返回可读、带路径的 preflight 错误。
- 不检查 `devDependencies`，不运行 npm，不联网。

同步 manifest/preflight 测试 fixture，避免所有测试工程无条件创建空 `node_modules/`。

### 3. 官方工程兼容性收尾

在配套 release 准备中验证《Inarticulate III》：

- `package.json` 声明 `"node": ">=24 <25"`；
- `package.json` 与 `package-lock.json` 根版本同步，`npm ci` 可执行；
- Node `24.18.1` 下测试、语法检查与实际 health 启动通过；
- 不修改作品逻辑或借此引入多声道版本。

## 自动测试

至少覆盖：

- 无 `package.json` 且无 `node_modules/` 通过；
- 空 dependencies 通过；
- 只有 devDependencies 通过；
- 非空 dependencies 缺少 `node_modules/` 失败；
- 非空 optionalDependencies 缺少 `node_modules/` 失败；
- 依赖存在且 `node_modules/` 存在通过；
- 非法 `package.json` 返回可诊断错误；
- 缺失、兼容、不兼容或非标准格式的 `engines.node` 都不改变 preflight 结果；
- sidecar 执行 `--version` 输出 `v24.18.1`。

## 验收

- `npm run node:fetch` 获取并校验 Node `24.18.1` ARM64。
- release-like App 实际使用随包 Node，而非系统 Node。
- 零依赖工程无需伪造空 `node_modules/`。
- 有生产依赖的工程仍在启动前阻止缺失依赖。
- 《Inarticulate III》在固定 runtime 下完成实际启动验证。
- 更新受到影响的开发文档和源码规范引用。
