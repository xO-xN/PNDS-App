# 主题跟随

## 采用

`theme-follow` 按需加入 `modules/pnds-theme-follow/`，不默认启用。它把 App 当前主题应用到 monitor 页面；页面自带初始配色，未收到主题时仍可独立显示。完整接口见工程同目录 README。

## 只在 monitor 页加载

服务端从已加入目录提供固定脚本路由，monitor 页面加载：

```html
<script src="./__pnds/theme-follow.js"></script>
```

performer 不自动采用。首帧可读 `?theme=`，后续 Host 消息更新主题；协议见[运行契约](../reference/runtime-contract.md) §11。

## 零配置路径：CSS 变量

脚本默认将 palette 写到页面根元素，样式引用对应变量：

| palette 键       | CSS 变量        |
| ---------------- | --------------- |
| `bg`             | `--bg`          |
| `sidebar-bg`     | `--track`       |
| `card`           | `--card`        |
| `pill`           | `--accent-soft` |
| `text`           | `--text`        |
| `text-secondary` | `--muted`       |
| `accent`         | `--accent`      |
| `danger`         | `--danger`      |

## 进阶路径：PNDS_THEME_OPTIONS

在脚本加载前设置 `window.PNDS_THEME_OPTIONS`：`variables` 改写映射，`derive(palette)` 生成额外变量，`onTheme(name, palette)` 更新自定义绘制。`applyVariables: false` 只执行回调、不写 CSS；回调需要时主动重绘。

模块只对变化值回调，忽略畸形输入。`PNDS_THEME.dispose()` 幂等移除监听，重新加载会先清理原实例。纯函数和手动 `attach` 的参数按同版本 README 使用。
