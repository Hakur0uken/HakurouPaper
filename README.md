# HakurouPaper

[中文](#中文) · [English](#english)

## 中文

### 为专注写作而生的本地 Markdown 编辑器

HakurouPaper 是一款面向长文档、论文和日常写作的本地优先 Markdown 编辑器。它把常用排版和对象操作做得像普通文档软件一样直接，同时让你的文稿始终保留为干净、通用的 Markdown 文件。

### 下载与安装

前往 [Releases](https://github.com/Hakur0uken/HakurouPaper/releases) 下载最新的 Windows 安装包。当前版本可下载 `HakurouPaper_0.6.0_x64-setup.exe`，双击安装后即可使用。

### 你可以用它做什么

- 用可视化菜单完成标题、列表、加粗、斜体、删除线和代码等常用 Markdown 排版。
- 直接创建表格，或从 Excel、Google Sheets 复制内容并粘贴为表格。
- 为表格设置标题行、标题列，或切换为适合论文展示的三线表。
- 调整文字和图片的左对齐、居中、右对齐；为正文设置首行缩进。
- 在文档内或为今后打开的文档选择字体、正文字重、默认表格样式与默认缩进。
- 在中文与 English 界面之间切换。
- 粘贴本地图片；图片会随文稿保存在同级资源目录中。
- 从 PowerPoint 粘贴图元时保留原始 EMF，同时用 PNG 预览显示；以后导出 Word 时可继续使用原图元。
- 通过“文件 > 创建分享包…”将当前文稿与对应资源整理为独立文件夹，方便完整发送给他人。
- 使用行内或块级 LaTeX 公式；块级公式默认显示右侧编号，可在公式源码编辑中取消编号。
- 通过“文稿交付”进行稳定的日常 Word 导出：默认按当前文稿样式生成可编辑 DOCX，也可选择自己的 Word 参考模板；公式交付可独立选择 Word 原生或 MathType 可编辑公式。
- 对期刊、学校或单位的复杂 DOCX 模板，可使用“精确 Word 模板（实验）”。它基于显式映射保留模板结构，不会自动猜测内容位置或样式映射。

### 文稿属于你

HakurouPaper 使用标准 Markdown 保存文字，因此文稿可继续用 Typora、VS Code、Pandoc 等工具打开和处理。图片及少量展示设置会保存在文稿旁的 `assets` 资源目录中，不会把私有格式写进 Markdown 正文。

### 写作时的小提示

- 点击空白行左侧的 `+`，可以快速插入标题、列表、代码块、表格或分隔线。
- 将鼠标移到图片或表格上，可显示相应的对象操作入口。
- 在“查看”菜单中可调整当前文档或默认的字体、表格与首行缩进设置。
- 在“文件”菜单选择“创建分享包…”，再选择保存位置；每次都会新建一个不会覆盖旧内容的分享文件夹。

如有建议或问题，欢迎在 [GitHub Issues](https://github.com/Hakur0uken/HakurouPaper/issues) 中告诉我们。

## English

### A local-first Markdown editor for focused writing

HakurouPaper is a local-first Markdown editor for long-form writing, academic work, and everyday notes. It brings familiar document-editing interactions to Markdown while keeping your files clean, portable, and yours.

### Download and install

Visit [Releases](https://github.com/Hakur0uken/HakurouPaper/releases) to download the latest Windows installer. For the current release, download `HakurouPaper_0.6.0_x64-setup.exe` and run it to install the app.

### What you can do

- Format headings, lists, bold, italic, strikethrough, and code with visual menus.
- Create tables directly, or paste table data from Excel and Google Sheets.
- Set a header row or column, and switch tables to a publication-friendly three-line style.
- Align text and images left, center, or right, and apply a first-line indent to body text.
- Choose document or default fonts, body text weight, table style, and indentation.
- Switch the interface between Chinese and English.
- Paste local images; they are stored alongside the document in its resource folder.
- Paste PowerPoint graphics while keeping the original EMF alongside a PNG preview, ready for future Word export.
- Use **File > Create Share Package…** to collect the current document and its resources into a self-contained folder that is ready to send.
- Write inline or display LaTeX equations; display equations show a right-side number by default, which can be disabled in the source editor.
- Use **Document Delivery** for stable everyday Word export: the default current-document style produces an editable DOCX, or you can choose your own Word reference template. Native Word and editable MathType equation delivery remain independent choices.
- For complex DOCX templates from journals, schools, or organizations, use **Precise Word Template (Experimental)**. It preserves the template through explicit mappings and never guesses content locations or style mappings.

### Your documents stay yours

Text is saved as standard Markdown, so it remains usable in Typora, VS Code, Pandoc, and other Markdown tools. Images and a small amount of display information are kept beside the document in its `assets` folder rather than embedded as private syntax in the Markdown text.

### Helpful shortcuts in the editor

- Click the `+` beside an empty line to insert headings, lists, code blocks, tables, or a divider.
- Move the pointer over an image or table to reveal its object controls.
- Use the **View** menu to adjust the font, table style, or first-line indentation for the current document or as a default.
- Choose **File > Create Share Package…**, then select a destination. Each export creates a new folder and never overwrites an earlier package.

Suggestions and bug reports are welcome in [GitHub Issues](https://github.com/Hakur0uken/HakurouPaper/issues).
