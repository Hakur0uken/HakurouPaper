# HakurouPaper

[中文](#中文) · [English](#english)

## 中文

### 让人自然写作，让 AI 可检查地协作

HakurouPaper 是面向长文档、论文和正式交付的本地优先文稿工作空间。它提供接近普通文档软件的编辑体验，同时把文稿保留为开放、结构清晰的 Markdown。

不需要先学 Markdown 或 Git。你可以直接编辑标题、正文、图片、表格和公式；当 AI 或其他协作者参与修改时，再用版本记录、排版后的改动预览和恢复能力检查每一次变化。

### 核心能力

- **直接写作**：可视化编辑标题、列表、表格、图片与 LaTeX 公式；支持从 Excel、网页和 PowerPoint 粘贴内容。
- **本地版本管理**：创建版本、查看排版后的改动、恢复历史内容，无需把文稿上传到云端。
- **开放文稿**：正文是标准 Markdown，图片等资源保存在文稿旁，未来仍可用其他工具继续处理。
- **Word 交付**：导出可编辑 DOCX；支持 Word 参考模板、原生 Word 公式和 MathType 可编辑公式。
- **复杂模板（实验）**：对期刊、学校或单位的 DOCX 模板，可通过显式映射尽量保留分栏、分节、页眉页脚与版式结构。复杂模板建议由 AI / Agent 调用 Hakurou Skill 完成分析、导出和验证。

### 获取与开始使用

请前往 [Releases](https://github.com/Hakur0uken/HakurouPaper/releases) 下载最新的 Windows 安装包。安装后，新建文稿即可开始写作；应用内的欢迎页也提供了可直接修改的示例。

### 从源码运行

项目使用 Tauri、React 和 TypeScript。安装 Node.js、Rust 与 Tauri 所需的 Windows 构建环境后：

```bash
npm install
npm run tauri dev
```

### 反馈

问题与建议请提交至 [GitHub Issues](https://github.com/Hakur0uken/HakurouPaper/issues)。

## English

### Natural writing, inspectable AI collaboration

HakurouPaper is a local-first writing workspace for long-form documents, academic work, and formal delivery. It offers familiar document editing while keeping manuscripts in open, structured Markdown.

You can edit headings, body text, images, tables, and equations without first learning Markdown or Git. When an AI or another collaborator changes a manuscript, local version history, rendered change previews, and restore points keep each change visible and reviewable.

### Core capabilities

- **Direct writing**: edit headings, lists, tables, images, and LaTeX equations visually; paste content from Excel, the web, and PowerPoint.
- **Local version control**: create versions, inspect rendered changes, and restore earlier content without uploading manuscripts to a cloud service.
- **Open manuscripts**: body text remains standard Markdown and resources stay beside the document, so other tools can continue to use them.
- **Word delivery**: export editable DOCX files with Word reference templates, native Word equations, or editable MathType equations.
- **Complex templates (experimental)**: explicit mappings can preserve a supplied DOCX template's columns, sections, headers, footers, and layout as far as possible. Complex templates are best analyzed, exported, and validated through a Hakurou Skill invoked by an AI / Agent.

### Get started

Download the latest Windows installer from [Releases](https://github.com/Hakur0uken/HakurouPaper/releases). Create a document after installation, or edit the built-in welcome manuscript to explore the workflow.

### Run from source

The project uses Tauri, React, and TypeScript. After installing Node.js, Rust, and the Windows prerequisites required by Tauri:

```bash
npm install
npm run tauri dev
```

### Feedback

Please report issues and ideas through [GitHub Issues](https://github.com/Hakur0uken/HakurouPaper/issues).
