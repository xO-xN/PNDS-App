# PNDS 池谱

**中文** | [English](README.md)

🌐 项目主页：https://xo-xn.github.io/PNDS-App/

AI-Coding 时代的电子音乐创作与演奏平台。

PNDS 池谱（Platform for Networked Digital Score）是创作与演奏网络数字乐谱电子音乐的平台，包含 **PNDS App** 与 **PNDS Template** 两部分。

- **PNDS App**——演出现场运行工程的 macOS Host。
- **PNDS Template**——创作起点，复制即得一个可运行的工程。

演出现场只需要一台 Mac 和一个路由器：App 打开工程，就地搭起本地多人演奏系统，演奏者使用手机、平板电脑等设备接入。PNDS 也支持跨网络远程演奏：多台 Mac 各自运行 PNDS、加载同一个支持互联网演奏的工程，搭配 JackTrip 等方案即可实现实时演奏。

![PNDS App - 欢迎界面](./assets/readme_img/pndsapp_starting.png)

## 下载

- **PNDS App**：[Releases](https://github.com/xO-xN/PNDS-App/releases/latest) 的 `.dmg`，需 Apple Silicon（M 系列）Mac。
- **PNDS Template**：[Releases](https://github.com/xO-xN/PNDS-Template/releases/latest)。

## 文档

- [PNDS App 教程](docs/zh-CN/app-tutorial.md)
- [PNDS Template 创作指南](docs/zh-CN/template-guide.md)
- [参考手册](docs/zh-CN/reference/README.md)

## 相关仓库

- [PNDS Template](https://github.com/xO-xN/PNDS-Template) | PNDS 池谱创作模板
- [Local-Network-Diagnostics](https://github.com/xO-xN/Local-Network-Diagnostics) | App 内置的本地网络诊断工具
- [Telematic-Network-Diagnostics](https://github.com/xO-xN/Telematic-Network-Diagnostics) | 远程网络诊断工具
- [Multichannel-Signal-Generator](https://github.com/xO-xN/Multichannel-Signal-Generator) | App 内置的 16 通道验证工具
- [Inarticulate III](https://github.com/xO-xN/inarticulate-iii) | 一个使用 PNDS 池谱创作的作品示例

## 许可证

MIT — 见 [LICENSE.md](LICENSE.md)。随包分发的 SuperCollider（`scsynth`）为 GPL-3.0，以独立进程运行。
