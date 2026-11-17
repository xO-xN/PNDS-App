# 给工程写 README

在工程根目录写 `README.md`，作为演出简介。

## 它出现在哪里

主窗口选中工程时显示 README。投影在开演前显示简介，开演后切到 monitor。README 和封面随 `.pnds` 分发。

## 封面页格式

先写顶部元数据，再写二级标题与简介。

```markdown
# 作品名称

title: 作品名称
composer: 创作者
duration: 10 分钟
performers: 四名演奏者
contact: music@example.com
color_palette: [#000000, #C9D8B6, #F1ECC3, #57837B]

## 作品简介

一段适合开演前阅读的作品介绍。
```

元数据按 `key: value` 一行一条，放在正文前，不包进列表或代码块。

| 键                                          | 用途                         | 缺失时                       |
| ------------------------------------------- | ---------------------------- | ---------------------------- |
| `title`                                     | 封面标题                     | 使用一级标题                 |
| `composer`                                  | 作者；显示时移除开头 @       | 显示 —                       |
| `duration`                                  | 时长文字                     | 显示 —                       |
| `performers`                                | 演奏者名单                   | 显示 —                       |
| `contact`                                   | 联系方式文字                 | 显示 —                       |
| `color_palette`                             | 四个配色值                   | 不足四个合法值时使用品牌配色 |
| `composer_url`、`github_url`、`website_url` | 可选 `http(s)://` 链接元数据 | 可省略；封面不显示链接按钮   |

封面只显示首节，内容止于后续章节或首个 `---`；其他说明可放其后。Markdown 链接保留文字，纯链接导航段隐藏。没有封面元数据时按普通文档显示。

## 封面图 cover.png

在工程根目录放置封面。依次查找 `cover.png`、`cover.jpg`、`cover.jpeg`、`cover.webp`，上限 4 MB。

## README 语言变体

用 `README.<locale>.md` 提供语言变体，例如 `README.zh-CN.md`。App 优先读取与界面语言匹配的文件，再回退至 `README.md`。

## 在创作模式中编辑

在文件栏选择 **打开工程 README**。App 标明实际文件名。识别出的封面可编辑字段和首节正文，格式无法识别时可切换到文本编辑。显式保存后可[记录语言同步交接](./app-tutorial.md#记录交接与外部接续)。

## 场地屏上的简介

投影简介按 1200 × 800 构图等比缩放。普通文档格式显示全文，无自动滚动。

## 写作要点

支持 Markdown 和 GFM，原始 HTML 不渲染。

## 与工程结构契约的关系

README 是[工程结构](./reference/structure.md)中的可选文件。
