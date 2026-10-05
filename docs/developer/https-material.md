# 可信 HTTPS 证书材料（#139）

Host 侧证书材料的校验、受保护存储与设置区接线的规则层。入口的对外契约（`PNDS_PERFORMER_URL`、`supportsPerformerUrl`、工程身份）在运行契约 §15；操作者视角的准备指南在参考手册 [https.md](../zh-CN/reference/https.md)。TLS 网关本身（#140）不在本页。

## 部件与位置

| 部件                              | 位置                                                                                                                                  |
| --------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| 校验管线 + 受保护存储（纯函数层） | `src-tauri/src/https.rs`（域名校验、PEM 切分、X.509 叶子事实、webpki 链与域名校验、ring 私钥匹配、单文件原子存储）                    |
| 命令（AppHandle 薄封装）          | `src-tauri/src/commands/https.rs`（`load_https_certificate` / `import_https_certificate` / `clear_https_certificate`）                |
| 偏好字段 + 保存边界校验           | `types.rs`（`https_domain` / `https_port` + `validate_https_domain_field` / `validate_https_port_field`，在 `save_preferences` 调用） |
| 设置区 UI                         | `src/components/settings/HttpsSection.tsx`                                                                                            |
| 前端准备流程                      | `src/lib/https-preparation.ts`（操作归属、文件选择、域名保存、摘要重验与异常收尾）                                                    |
| 前端镜像校验                      | `src/lib/https-settings.ts`（`isValidHttpsDomain` / `isValidHttpsPort` / `normalizeHttpsDomain`）                                     |
| i18n 问题码文案                   | `locales/*.json` 的 `settings.https.*`（`problem.<code>` 按码、`local.*` 前端自检、`status.<status>` 状态行）                         |

## 关键决策

- **普通配置与材料分离**：域名 / 端口走既有偏好序列化更新机制（React 可见、可 patch）；证书链 + 私钥只存在后端 `app_data/https/material.pem`，**永不作为 React 偏好回传**，不进工程、manifest、`.pnds` 或日志（与 hub token 同款纪律：日志只出现结果行；指纹与到期日是公开数据可以记，PEM 不行）。
- **单文件原子替换**：链与私钥同住一个 PEM 文件，替换 = 写临时文件（0600）+ rename（目录 0700）——不存在换了一半的证书 / 私钥组合。导入**先全量校验、后落盘**：任何失败保留旧材料字节不变（有测试钉住）。
- **校验顺序**（最先失败的最可行动）：PEM 解析 → 有效期窗口（带真实日期的错误）→ 私钥匹配 → webpki 链（对锚点集合）→ SAN 域名覆盖（单层通配符按 webpki 语义）。`UnknownIssuer` 用叶子事实区分三态：自签 / 私有 CA（issuer 证书在链里）/ 缺中间证书。
- **锚点是接缝**：生产用 `webpki_roots::TLS_SERVER_ROOTS`（Mozilla 根集合）；测试注入 rcgen 生成的 CA 锚点（`import_material` / `summarize_stored` 以锚点与时钟为参数，`SystemTime` 同理可注入）。**「文件合法」≠「手机实际可用」**是产品立场：App 只证明格式、链、域与公有信任；手机端可达以本地 DNS 与真机验收为准（帮助语料如实写明）。
- **私钥匹配的实现**：ring 从私钥派生公钥字节（Ed25519 / EC P-256·P-384 / RSA；PKCS#8 直接解析，PKCS#1 走 `RsaKeyPair::from_der`，SEC1 `EC PRIVATE KEY` 先手工包一层 PKCS#8——`wrap_sec1_as_pkcs8`，参数缺省时按 P-256/P-384 回退），与叶子 SPKI bitstring 比对。不引 RustCrypto 大数栈。
- **到期提醒**：`EXPIRY_REMINDER_DAYS = 30` 折进 `expiringSoon` 状态；summary 始终携带真实 `notAfter` / `daysRemaining`，不写死证书寿命。
- **重装恢复 / 重校验**：`load_https_certificate` 每次打开面板及域名成功保存后重读材料，按**当前保存的域名**与时钟重校验——改域名后状态变 `wrongDomain`，过期后变 `expired`，材料照常显示（摘要 + 问题并排，不隐藏事实）。导入被拒时 UI 同样不丢已存摘要（重读存储 + 附上拒绝原因）；读取失败保留已知摘要与拒绝原因，明确显示需要重验。
- **前端镜像的存在理由**：`updatePreferences` 是整文件 load-modify-write，一个非法字段会让整份偏好写入被后端拒绝——所以 `HttpsSection` 在 blur 提交前用 `isValidHttpsDomain` / `isValidHttpsPort` 拦截（非法值留在输入框等操作者修，不进保存队列）。镜像规则与 Rust 单测互为 parity 钉子。

## 前端准备流程

`attachHttpsPreparation(onState)` 是面板的共享操作入口。返回 `editDomain` / `commitDomain` / `importMaterial` / `clearMaterial` / `dispose`；组件在 mount 时 attach、卸载时 dispose，只负责输入、公共摘要与本地化问题的展示。端口与启用开关继续使用普通偏好队列。证书解析、信任链验证和受保护文件写入仍全部在 Rust。

- **域名与摘要归属**：输入改动立即使旧摘要的校验状态失效。合法 blur 先等待 `updatePreferences` 明确返回 `true`，再读取保存的域名与材料；`false` 提示保存失败，不用旧偏好重验并宣称新域名准备成功。空值按 `null` 保存并重验，非法值留在输入框。摘要携带本次读取对应的规范化保存域名，只有与当前输入一致时才展示 valid / expiringSoon 等状态；否则保留主题、指纹和日期，显示「需要重新校验」。
- **操作互斥**：导入从校验域名通过后、任何 await 之前进入 busy，直到保存域名、两次 picker、导入及必要的拒绝重读全部落定。域名行、导入及清除按钮在操作期间禁用；模块内部也拦重复调用。导入先保存捕获的域名，保证导入与后续重读针对同一配置。清除共用该互斥规则。
- **异常收尾**：picker 取消、返回 Result 错误和 Promise 拒绝都必须释放 busy。取消会重读材料，不丢失被操作取代的初始读取；失败展示本地化重试提示并记录一次结果日志。加载失败保留已知事实并撤下就绪声明，没有已知材料时不把读取失败描述成「没有证书」。拒绝导入不置材料改动标记，成功导入与清除才置位。
- **迟到结果**：每次域名编辑、保存及材料操作都有请求版本。旧读取不能覆盖较新的重验、导入或清除；A→B→A 的文本复用也不会恢复旧请求。卸载后回调无效，未发出的 picker / 导入步骤停止。已发出的后端写入允许完成，不尝试撤销。
- **关闭后重开**：材料导入和清除通过模块内的 App 级队列串行执行，新面板读取等候已发出的材料操作和域名保存。旧面板响应不进入新面板，新面板按操作结束后的存储事实重验。域名保存仍只通过既有 `preferences.ts` 队列，材料队列不接管偏好文件。

所有准备改动仍只影响下一次启动；流程不发 Stop / Start，不替换运行中入口使用的材料。测试从上述同一个 interface 调用真实流程，以 deferred IPC / picker 制造交错；UI 测试验证禁用、错误提示和摘要状态实际呈现。

## 测试面

- `https.rs` 内嵌单测：rcgen 造 CA→中间→叶子链，覆盖 happy path、通配符、域名不匹配（错误列出实际 SAN）、缺中间 / 自签 / 私有 CA 三态、私钥不匹配、过期 / 未生效、提醒窗口、PEM 噪声容忍、SEC1 包装（从 rcgen PKCS#8 里抠出 SEC1 再走 ring 验证）、存储权限（0700/0600）、失败替换不动旧材料、成功替换换指纹、重校验 wrongDomain、非法域名不落盘。
- `types.rs`：偏好字段旧文件兼容、round-trip、保存边界校验错误文案。
- `HttpsSection.test.tsx`：行渲染、合法提交（含规范化大小写 / 尾点）、非法拦截、状态与提醒渲染、问题本地化 + 细节、导入流（双 picker + 命令参数）、拒绝时保留旧状态、清除、hint 时序、DNS 提示含当前 LAN 地址。
- `https-preparation.test.ts`：连续域名提交与同文本复用、保存失败阻止导入、拒绝重读失败保留事实、取消恢复读取、操作锁覆盖拒绝重验、卸载期间 picker / 写入、重开等待材料操作和域名保存、迟到读取不恢复已清除材料、Result 错误与 Promise 拒绝收尾。
- `https-settings.test.ts`：镜像 parity。

## 后续接口（#140 网关将消费）

- `https.rs` 的 `load_material_pem` / `public_trust_anchors` / summary 结构即网关的证书供给面；域名的“下次启动生效”语义由网关在 session start 时读取偏好实现。
- `PNDS_PERFORMER_URL` 注入与入口状态机见运行契约 §3 / §15（#138 已冻结）。
