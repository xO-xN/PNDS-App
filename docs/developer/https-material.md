# 可信 HTTPS 证书材料（#139）

Host 侧证书材料的校验、受保护存储与设置区接线的规则层。入口的对外契约（`PNDS_PERFORMER_URL`、`supportsPerformerUrl`、工程身份）在运行契约 §15；操作者视角的准备指南在参考手册 [https.md](../zh-CN/reference/https.md)。TLS 网关本身（#140）不在本页。

## 部件与位置

| 部件                              | 位置                                                                                                                                  |
| --------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| 校验管线 + 受保护存储（纯函数层） | `src-tauri/src/https.rs`（域名校验、PEM 切分、X.509 叶子事实、webpki 链与域名校验、ring 私钥匹配、单文件原子存储）                    |
| 命令（AppHandle 薄封装）          | `src-tauri/src/commands/https.rs`（`load_https_certificate` / `import_https_certificate` / `clear_https_certificate`）                |
| 偏好字段 + 保存边界校验           | `types.rs`（`https_domain` / `https_port` + `validate_https_domain_field` / `validate_https_port_field`，在 `save_preferences` 调用） |
| 设置区 UI                         | `src/components/settings/HttpsSection.tsx`                                                                                            |
| 前端镜像校验                      | `src/lib/https-settings.ts`（`isValidHttpsDomain` / `isValidHttpsPort` / `normalizeHttpsDomain`）                                     |
| i18n 问题码文案                   | `locales/*.json` 的 `settings.https.*`（`problem.<code>` 按码、`local.*` 前端自检、`status.<status>` 状态行）                         |

## 关键决策

- **普通配置与材料分离**：域名 / 端口走既有偏好序列化更新机制（React 可见、可 patch）；证书链 + 私钥只存在后端 `app_data/https/material.pem`，**永不作为 React 偏好回传**，不进工程、manifest、`.pnds` 或日志（与 hub token 同款纪律：日志只出现结果行；指纹与到期日是公开数据可以记，PEM 不行）。
- **单文件原子替换**：链与私钥同住一个 PEM 文件，替换 = 写临时文件（0600）+ rename（目录 0700）——不存在换了一半的证书 / 私钥组合。导入**先全量校验、后落盘**：任何失败保留旧材料字节不变（有测试钉住）。
- **校验顺序**（最先失败的最可行动）：PEM 解析 → 有效期窗口（带真实日期的错误）→ 私钥匹配 → webpki 链（对锚点集合）→ SAN 域名覆盖（单层通配符按 webpki 语义）。`UnknownIssuer` 用叶子事实区分三态：自签 / 私有 CA（issuer 证书在链里）/ 缺中间证书。
- **锚点是接缝**：生产用 `webpki_roots::TLS_SERVER_ROOTS`（Mozilla 根集合）；测试注入 rcgen 生成的 CA 锚点（`import_material` / `summarize_stored` 以锚点与时钟为参数，`SystemTime` 同理可注入）。**「文件合法」≠「手机实际可用」**是产品立场：App 只证明格式、链、域与公有信任；手机端可达以本地 DNS 与真机验收为准（帮助语料如实写明）。
- **私钥匹配的实现**：ring 从私钥派生公钥字节（Ed25519 / EC P-256·P-384 / RSA；PKCS#8 直接解析，PKCS#1 走 `RsaKeyPair::from_der`，SEC1 `EC PRIVATE KEY` 先手工包一层 PKCS#8——`wrap_sec1_as_pkcs8`，参数缺省时按 P-256/P-384 回退），与叶子 SPKI bitstring 比对。不引 RustCrypto 大数栈。
- **到期提醒**：`EXPIRY_REMINDER_DAYS = 30` 折进 `expiringSoon` 状态；summary 始终携带真实 `notAfter` / `daysRemaining`，不写死证书寿命。
- **重装恢复 / 重校验**：`load_https_certificate` 每次打开面板重读材料，按**当前保存的域名**与时钟重校验——改域名后状态变 `wrongDomain`，过期后变 `expired`，材料照常显示（摘要 + 问题并排，不隐藏事实）。导入被拒时 UI 同样不丢已存摘要（重读存储 + 附上拒绝原因）。
- **前端镜像的存在理由**：`updatePreferences` 是整文件 load-modify-write，一个非法字段会让整份偏好写入被后端拒绝——所以 `HttpsSection` 在 blur 提交前用 `isValidHttpsDomain` / `isValidHttpsPort` 拦截（非法值留在输入框等操作者修，不进保存队列）。镜像规则与 Rust 单测互为 parity 钉子。

## 测试面

- `https.rs` 内嵌单测：rcgen 造 CA→中间→叶子链，覆盖 happy path、通配符、域名不匹配（错误列出实际 SAN）、缺中间 / 自签 / 私有 CA 三态、私钥不匹配、过期 / 未生效、提醒窗口、PEM 噪声容忍、SEC1 包装（从 rcgen PKCS#8 里抠出 SEC1 再走 ring 验证）、存储权限（0700/0600）、失败替换不动旧材料、成功替换换指纹、重校验 wrongDomain、非法域名不落盘。
- `types.rs`：偏好字段旧文件兼容、round-trip、保存边界校验错误文案。
- `HttpsSection.test.tsx`：行渲染、合法提交（含规范化大小写 / 尾点）、非法拦截、状态与提醒渲染、问题本地化 + 细节、导入流（双 picker + 命令参数）、拒绝时保留旧状态、清除、hint 时序、DNS 提示含当前 LAN 地址。
- `https-settings.test.ts`：镜像 parity。

## 后续接口（#140 网关将消费）

- `https.rs` 的 `load_material_pem` / `public_trust_anchors` / summary 结构即网关的证书供给面；域名的“下次启动生效”语义由网关在 session start 时读取偏好实现。
- `PNDS_PERFORMER_URL` 注入与入口状态机见运行契约 §3 / §15（#138 已冻结）。
