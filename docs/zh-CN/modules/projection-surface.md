# 投影面

主窗口与投影窗口是独立 monitor 副本。投影副本带 `?surface=venue`，工程据此选择场地画面；协议边界见[运行契约](../reference/runtime-contract.md) §14。

## 未适配 = 镜像 monitor

不读取参数时，投影使用同一 monitor 呈现。参数缺席或未知取值按主窗处理，不猜测窗口大小或全屏状态。

## 分支示例

在 monitor 入口选择实际渲染：

```js
const isVenue = new URLSearchParams(location.search).get('surface') === 'venue'
if (isVenue) renderVenueView()
else renderConductorView()
```

参数随导航固定；两份页面各自响应 resize，主题和语言桥仍适用。主 monitor 负责媒体采集，投影订阅其派生结果，不重复打开摄像头／麦克风，见[原生媒体契约](../reference/native-media.md)。

## 缩放归属声明（页面自拥缩放时）

页面自己处理投影缩放时，在 venue 副本加载后声明：

```js
if (isVenue && window.parent !== window) {
  window.parent.postMessage({ type: 'pnds-projection', zoom: 'page' }, '*')
}
```

App 在本次导航内让出投影框架缩放并回到 100%；重载需重新声明。未声明时由 App 缩放，主 monitor 不参与此握手。页面键位仍遵守[页面交互](../reference/page-interaction.md)边界。
