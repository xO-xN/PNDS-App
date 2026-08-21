# 解析

设计与动机:为什么这套流程长这样。这里没有操作步骤——做事见[任务指南](./how-to.md),查字段见[参考](./reference.md)。

## 创作机与演出机:两种角色,一台零依赖

PNDS 把「创作」和「演出」明确分给两种机器。创作机是装满工具的工作台:Node.js 24(开发与 `npm install`)、SuperCollider(编译 SynthDef 用它的 `sclang`)、npm 与网络,创作期随便用。演出机则相反——**只装 PNDS App,什么都不再需要**:App 自带固定 Node 运行时与 scsynth,`.pnds` 安装与运行全程无网络。

这个分界的动机是演出现场的可靠性:演出机上的变量越少,现场可断言的事情越多。所以 Score Project Specification 把「工程不得依赖宿主安装的 Node.js、SuperCollider、`sclang` 或第三方 UGen」定为硬性要求——工程必须把自己需要的一切(包括 `node_modules`)随身携带。同一逻辑也解释了为什么 Internal 模式只在创作机需要 SuperCollider:演出时 scsynth 是 App 托管的,`sclang` 只在编译环节出现。

## `.pnds`:运输容器,不是运行格式

一个 `.pnds` 是 zip(deflate)归档:恰好一个完整工程的根目录,加一份 `pnds-bundle.json` 运输元数据。它只解决一个问题——**怎么把一个目录变成一个文件**。

App 永远不从压缩包里运行工程:打开时一次性解压安装到数据目录 `bundles/<id>-<version>/`,之后与目录工程走完全相同的流程。压缩格式因此不影响任何运行时行为(进程、health、音频、关闭协议)。反过来,平台自己的两个内置工具(Local Network Diagnostics、Multichannel Signal Generator)发布的 release 同样是 `.pnds`——你分发工程所用的格式,与平台自身工具的发布格式一致。

格式细节(布局规则、zip-slip 防护、覆盖重装语义)由 [`PNDS_PROJECT_BUNDLE_SPECIFICATION.md`](../PNDS_PROJECT_BUNDLE_SPECIFICATION.md) 定义。

## 版本号与安装槽位:为什么内容变更必须升 version

接收方的安装槽位由 **`<id>-<version>`** 决定,且同 `id`+`version` 重复打开**总是覆盖重装**:删掉旧目录,解压刚打开的文件——最后打开的文件获胜。

这个机制本身是善意的(重开即修复,不留脏状态),但它把「区分新旧构建」的责任交给了版本号。假设你改了内容却没升 `version`:新旧两次构建共用同一个文件名 `<name>-<version>.pnds` 和同一个安装槽位,接收方在 App 里**无法分辨**装的是新是旧;他一旦重新打开手头的旧 `.pnds` 副本(下载文件夹、邮件附件里很常见),覆盖写回的就是旧内容——你以为发出了修复,对方演出的仍是旧版。两次构建的 sha256 不同,但 App v1 不校验它,救不回来。

升了版本号则是干净的新槽位、新文件名,新旧互不干扰。这就是「内容变更必须升 `version`」不是风格建议、而是分发纪律的原因。

## 为什么 App 不执行 npm

演出机上没有「装依赖」这个步骤,因为演出机上不该有网络、npm 和「等安装完成」这类不可控变量。代价由创作侧承担:`package.json` 声明了生产依赖的工程,必须把创作机上 `npm install` 好的 `node_modules/` 原样随身携带,打包校验会硬性检查这一点。

两个直接推论:其一,`node_modules` 是「装好的运行资产」而不是可重建的中间产物——不要指望接收方机器帮你恢复它;其二,devDependencies 也会随包(排除清单只做减法、不重排内容),所以 `npm prune --omit=dev` 是发布前自愿但有效的瘦身手段。

## 为什么采样率住在 App,不住在工程里

采样率曾经是 manifest 字段(`audio.scsynth.sampleRate`),v1.2.0 起从 schema 移除:App 托管的 scsynth 一律运行在 App 的全局采样率偏好(设置 → Audio,未设置时 48000)。

原因在音频链路的结构:采样率不是工程的私有属性,而是**整条链路的公共属性**——App、虚拟音频设备(BlackHole 等 loopback)、链路中的 DAW、音频接口必须一致。loopback 设备只搬运原始采样、不做重采样,任何一端不一致不会报错,而是出现周期性咔哒声(实际发生过的现场故障)。把采样率放在每个工程自己的 manifest 里,等于让「这一场用哪个采样率」取决于「最后打开的是哪个工程」——对一个必须全链路一致的参数,这是错误的所有权。收归 App 全局偏好后,操作员在设置里改一处、整条链路对齐一个数。

工程脱离 App standalone 调试时自行决定 scsynth 采样率。完整语义见 [`PNDS_RUNTIME_CONTRACT.md`](../PNDS_RUNTIME_CONTRACT.md) §7.2。

## 为什么 SynthDef 契约要求三处同名

「SynthDef 符号名 = 产物文件名 = manifest 引用」这条契约防的是**静默丢失**:没有它,一个名字写错的 SynthDef 会顺利编译、顺利产出文件、然后在运行时静默缺席——工程能开、health 能 ready,只是那个声音永远不响。现场排查这类问题代价极高。

契约之下,编译完成后 App 逐个点名校验 manifest 引用的产物,缺哪个、这次实际产出了哪些,都精确列出;名字对不上在创作机就会被拦下,而不是在舞台上暴露。带连字符的名字必须写作 `'like-this'` 引号符号形式,是 SuperCollider 语法(裸标识符不允许连字符),不是 PNDS 的额外要求。

同一条思路的另一个体现:`.scd` 是唯一事实源,工程里不再保留旧的构建脚本——产物永远可以由「源码 + App 的编译入口」重新生成,不存在第二份需要人工同步的真相。
