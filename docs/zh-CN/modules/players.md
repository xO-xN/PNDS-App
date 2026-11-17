# 演奏者身份

## 默认身份

新建 Blank 已接好 `modules/pnds-players/`。`players/policy.js` 使用随机 claim 与独立演奏者 UUID，身份与声道、voice、选谱序号分别表达。浏览器按 Host／工程作用域保存 claim，测试窗口各有独立后缀；存储失败明确报错。

## 连接与事件

服务端 `attachPlayers` 接受工程定义的接纳、控制、动作、释放与快照政策。浏览器 `PNDSPlayers.connectPlayer` 提供演奏者连接，`connectObserver` 只观察；完整参数见工程 `modules/pnds-players/README.md`。

Blank 页面已经提供 `PNDS_PLAYER`：`identity.id` 为当前身份，`sendControls` 发送连续输入，`sendAction` 发送离散动作，`onChange` 订阅连接与接纳状态。连续值过滤 `continuousFilter` 按需启用，离散动作保留重复载荷。

服务端先核对当前连接拥有者，再转交共同现场／回放业务入口。作品状态与效果的修改位置见工程 `docs/implementation.md` 和[音频作品层](./audio.md)。monitor 不分配演奏者身份。

## 恢复与释放

`.pnds-creation/players.json` 只持久保存 claim→UUID；控制与作品状态每场重置。同工程、同 claim 的新连接接管旧连接，旧控制、动作或断开不能修改后继连接；页面关闭时清理自己拥有的输入和连接。

身份恢复不代替每场演出的明确进入，也不转移摄像头／麦克风所有权。存储、复制与分发边界见[私有创作数据](../reference/structure.md#工程内的私有创作数据)，接入授权见[运行契约](../reference/runtime-contract.md)。
