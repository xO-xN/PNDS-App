# 语言跟随

## 采用

`locale-follow` 按需加入 `modules/pnds-locale-follow/`，不默认启用。它解析 App 的语言并通知 monitor 页面；作品自己维护翻译和文案，不自动翻译工程名、作者或用户正文。完整接口见工程同目录 README。

## 只在 monitor 页加载

服务端从已加入目录提供固定脚本路由，monitor 页面加载：

```html
<script src="./__pnds/locale-follow.js"></script>
```

performer 文案由作品维护。首帧可读 `?lang=`，后续 Host 消息更新语言；协议见[运行契约](../reference/runtime-contract.md) §11。

## 零配置路径：<html lang>

默认把解析后的代码写入 `<html lang>`，不改页面其余文案。没有首帧值或消息时保留页面初始语言。

## locale 解析规则

`PNDS_LOCALE.resolveLocale(code, options)` 依次尝试不区分大小写的精确匹配、基语言匹配及 fallback。返回值始终是支持列表中的原样代码；空输入返回 null。默认支持 `en`／`zh-CN`，回退 `en`。

## 进阶路径：页面字符串表

在脚本加载前设置 `window.PNDS_LOCALE_OPTIONS`：`locales` 声明作品语言，`fallback` 设回退，`onLocale(resolved, raw)` 根据作品字符串表更新画面。`applyLang: false` 可关闭 `<html lang>` 写入。

相同解析结果不重复回调。`PNDS_LOCALE.dispose()` 幂等释放监听，重载先清理原实例，释放后保留当前文案和页面语言。手动接线和解析边界按同版本 README 使用。
