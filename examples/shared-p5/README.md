# Shared p5 example / 共享 p5 示例

Open this directory in PNDS App, select None, and start it. The example references
candidate p5 2.3.4 and uses only Node standard-library code. App verifies that
exact installed resource and injects `PNDS_SHARED_LIBRARIES`; the score server
serves it at `/shared/p5.js` on both monitor and performer origins. The App HTTPS
entry proxies the same relative route. It never exposes a Mac filesystem path
to phones. All code here belongs to the example, and no library/model is copied
into it.

在 PNDS App 打开本目录，选择 None 并启动。页面应出现绿色圆形并持续变化；
状态应显示实际 p5 版本与 drawn。断公网冷打开、刷新、手机输入、可信 HTTPS 与
关闭后端口释放需要实机验收。自动化 HTTP／health 检查不能替代真实绘图证据。
本工程仅作共享接线示例，未声明声音输出；不代表三个作品完成兼容验收。

The new 2.x candidate must be validated against each work. This example does not
migrate old sketches or claim their image/loading/input behavior remains unchanged.
