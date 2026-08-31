# HakurouPaper

[English](README_EN.md)

**让 AI 像处理代码一样理解和修改文稿，让人像编辑 Word 一样自然写作。**

HakurouPaper 是一个为 **人与 AI 共同写作** 而设计的本地优先学术写作空间。

底层是清晰、开放的 Markdown、结构化资源与 Git 版本历史；你面对的则是熟悉的可视化文档编辑体验。

无需学习 Markdown，也无需先学会 Git。自己写、让 AI 起草或修改、检查变化、恢复版本，最后再交付为 Word。

[下载 Windows 版本](https://github.com/Hakur0uken/HakurouPaper/releases/latest) · [查看全部发布版本](https://github.com/Hakur0uken/HakurouPaper/releases)

---


![HakurouPaper 主工作区：可视化文稿编辑](.github/images/workspace.png)

## 人和 AI，在同一个写作空间

AI 擅长处理结构化纯文本，程序员也早已有 Git 来查看修改、记录版本和随时撤回。

HakurouPaper 把这套能力带到普通文稿中：

* **对人**：像普通文档软件一样直接编辑；
* **对 AI**：底层始终是清晰、开放的 Markdown；
* **对协作**：每次修改都可以被查看、比较和恢复。


## 修改有迹可循

创建一个版本后继续写作，新增、修改和删除的位置会直接显示在文稿中。

查看修改时，正文仍然是正文，公式仍然是公式，图片仍然是图片。需要时，也可以进入高级模式查看精确的 Markdown Diff。


![HakurouPaper 修改标记](.github/images/revision-markers.png)

![HakurouPaper 排版后的版本比较](.github/images/rendered-revision-preview.png)

![HakurouPaper 高级 Markdown Diff](.github/images/advanced-diff.png)

> **Give documents the same AI collaboration safety net that code already has.**

## 从写作到 Word 交付

Markdown 是写作、AI 协作和版本管理的开放底层；当需要交付时，文稿可以继续以可编辑 Word 的形式流转。

Word 交付支持：

* 按 HakurouPaper 当前样式导出可编辑 Word
* 使用 Word 参考模板控制字体、标题和段落样式
* Word 原生公式 / MathType 可编辑公式
* 表格、本地图片与 PowerPoint EMF 矢量资源
* 实验性的精确 Word 模板交付


![HakurouPaper Word 文稿交付](.github/images/word-delivery.png)

## 本地、开放、轻量

HakurouPaper 基于 Tauri 构建，保持较小的安装体积和较低的硬件要求。

正文和公式保留在标准 Markdown 中，图片等资源保存在文稿附近，版本历史由标准 Git 管理。

即使以后换用其他支持 Markdown 的工具，你仍然可以继续打开和修改自己的文稿。

**你的文稿始终属于你。**

## 面向 AI / Agent 的 Word 交付 Skills

HakurouPaper 不绑定某一种 AI，也不要求你使用内置 Agent。你可以继续使用自己熟悉的 AI 或 Agent 进行写作与协作。

现已提供两项面向 Agent 的 Word 交付 Skill，分别覆盖精确模板导出与 MathType 公式转换：

* **`hakurou-word-template-export`**：将 HakurouPaper Markdown 文稿按明确的映射填入指定 Word 模板，保留模板的 OOXML 结构，并进行包级验证，适用于高保真的学术 Word 模板交付。
* **`hakurou-mathtype-batch`**：将已经导出、含 Word 原生公式（OMML）的 DOCX 转换为独立的 MathType 版本，公式保留为可编辑的 MathType OLE 对象；需安装 Microsoft Word 与 MathType 加载项。

这让 Agent 可以负责理解模板与文稿、制定映射和检查结果，而 Hakurou Skill 负责确定性的导出与转换。更多面向 Agent 的文稿工具仍在持续完善。

## 下载

目前提供 Windows 版本：

**[前往 Releases 下载 HakurouPaper](https://github.com/Hakur0uken/HakurouPaper/releases/latest)**

## Roadmap

* Hakurou Skills / 面向 Agent 的文稿工具
* 精确 Word 模板与学术交付完善
* Remote Git / GitHub 协作
* 长文档性能优化
* 跨平台支持
