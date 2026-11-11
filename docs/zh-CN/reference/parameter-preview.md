# 临时参数预演

## 可选临时参数预演（协议 1）

工程根目录的 `pnds.preview.json` 声明 `schemaVersion: 1` 和 `parameters`。每项含已有相对文本 `path`、唯一 `id`、包围 JSON 基本字面值的完整行 `prefix`／`suffix`、`kind`（`number`、`boolean`、`text`、`color`、`option`）、适用的 `limits`（`min`、`max`、`step`、`options`、`maxLength`）及 `preview`（`live`、`refresh`、`restart`、`unsupported`）。实时绑定要求定位唯一、声明兼容且版本一致。

Blank 已预置空声明和适配器。其他工程可接入 `PNDS.app/Contents/Resources/preview/adapter.mjs`。`installPreviewAdapter({hostOrigin, sources, contractDigest, parameters})` 使用实际加载的源码和声明的固定 `sha256:<hex>` 摘要，以及工程定义的 get/set 回调。Host origin 由工程配置，不能从消息中取得。

消息携带 `pnds.preview`、版本 1、新 session 和递增 sequence。两端核对 origin 与窗口。Host 发送 `hello`（参数 ID）、`set`（基本值）或 `restore`。页面返回 `ready`（摘要、支持项与基准）、`applied`／`restored`（实际回读）或 `error`。setter 串行执行，跳过过时更新，只恢复已触及参数。

实时预演要求同一就绪运行、保存版本和已加载摘要匹配。来源变化撤销旧授权。失败、超时和未确认恢复显示在 App 中。声音预演使用已开启的音频。参数预演不保存文件或刷新、重启工程，只能恢复参数值。保存版代码需刷新或重启后加载。

## 创作预演 Host origin

主 monitor URL 的 `pndsHostOrigin=<origin>` 可为适配器提供导航时的宿主 origin。该参数可能缺席，接入仍须通过保存版和运行校验。
