export type UiLanguage = "zh" | "en";

export type UiText = {
  file: string;
  edit: string;
  view: string;
  window: string;
  help: string;
  newDocument: string;
  openDocument: string;
  openMarkdownDocument: string;
  saveMarkdownDocument: string;
  markdown: string;
  untitledDocument: string;
  recentFiles: string;
  noRecentFiles: string;
  save: string;
  sharePackage: string;
  chooseSharePackageDestination: string;
  sharePackageRequiresSave: string;
  sharePackageCreated: (path: string) => string;
  closeDocument: string;
  undo: string;
  redo: string;
  cut: string;
  copy: string;
  paste: string;
  documentPanel: string;
  documentFont: string;
  documentTable: string;
  documentIndent: string;
  defaultFont: string;
  defaultTable: string;
  defaultIndent: string;
  elegant: string;
  modern: string;
  standard: string;
  custom: string;
  standardTable: string;
  threeLineTable: string;
  noIndent: string;
  firstLineIndentTwoCharacters: string;
  customDocumentFont: string;
  customApplicationFont: string;
  customFontDescription: string;
  chineseFont: string;
  latinFont: string;
  fontWeight: string;
  fontWeightNote: string;
  fontWeightLight: string;
  fontWeightRegular: string;
  fontWeightMedium: string;
  fontWeightSemibold: string;
  fontWeightBold: string;
  chineseFontPreview: string;
  latinFontPreview: string;
  apply: string;
  cancel: string;
  minimize: string;
  maximize: string;
  close: string;
  about: string;
  aboutMessage: string;
  language: string;
  applicationMenu: string;
  recentFilesList: string;
  openedDocuments: string;
  unsaved: string;
  closeDocumentWithTitle: (title: string) => string;
  workspaceNavigation: string;
  outline: string;
  documentList: string;
  collapseHeading: string;
  expandHeading: string;
  editingArea: string;
  unsavedChanges: string;
  savedLocally: string;
  localDraft: string;
  selectedCount: (count: number) => string;
  documentStats: (words: number, characters: number) => string;
  documentDelivery: string;
  documentDeliveryDescription: string;
  pandocChecking: string;
  pandocReady: (version: string | undefined) => string;
  pandocUnavailable: string;
  checkPandoc: string;
  downloadPandoc: string;
  wordDocument: string;
  wordTemplate: string;
  formulaExport: string;
  wordNativeFormulas: string;
  wordNativeFormulasDescription: string;
  mathTypeFormulas: string;
  mathTypeFormulasDescription: string;
  mathTypeChecking: string;
  mathTypeReady: string;
  mathTypeUnavailable: string;
  checkMathType: string;
  katexPreviewFormulas: string;
  katexPreviewFormulasDescription: string;
  chooseWordTemplate: string;
  chooseDocxTemplate: string;
  clearWordTemplate: string;
  useLastWordTemplate: string;
  noLastWordTemplate: string;
  noWordTemplate: string;
  exportDocument: string;
  docxExportDescription: string;
  docxExportRequiresSavedDocument: string;
  chooseDocxDestination: string;
  exportDocx: string;
  exportingDocx: string;
  docxProgressPreparing: string;
  docxProgressGenerating: string;
  docxProgressAwaitingMathTypeConvertDialog: string;
  docxProgressMathTypeConvertDialogReady: string;
  docxProgressManualMathTypeConvertNeeded: string;
  docxProgressWaitingForMathType: string;
  docxProgressFormattingMathType: string;
  docxProgressAwaitingMathTypeFormatDialog: string;
  docxProgressMathTypeFormatDialogReady: string;
  docxProgressManualMathTypeFormatNeeded: string;
  docxProgressMathTypeFormattingSkipped: string;
  docxConfirmManualMathTypeStep: string;
  docxProgressStartingMathTypeBatch: (batch: number, batches: number) => string;
  docxProgressRenderingMathType: (completed: number, total: number, batch: number | null, batches: number | null) => string;
  docxProgressSaving: string;
  docxExported: (path: string) => string;
  docxExportedWithPreviewFallback: (path: string, count: number) => string;
  docxExportFailed: string;
  unsavedDocuments: string;
  unsavedDocument: string;
  confirmCloseApplication: string;
  confirmCloseDocument: (title: string) => string;
  returnToEditing: string;
  discardAndClose: string;
  imageOperations: string;
  tableOperations: string;
  leftAlign: string;
  centerAlign: string;
  rightAlign: string;
  delete: string;
  selectTable: string;
  convertThreeLineTable: string;
  setTitleRow: string;
  setTitleColumn: string;
  insertContent: string;
  table: string;
  tableDimensions: (rows: number, columns: number) => string;
  chooseTableDimensions: string;
  tableCell: (row: number, column: number) => string;
  divider: string;
  blockMenu: string;
  body: string;
  bodyTooltip: string;
  headingTooltip: (level: number) => string;
  bulletList: string;
  bulletListTooltip: string;
  orderedList: string;
  orderedListTooltip: string;
  codeBlock: string;
  codeBlockTooltip: string;
  boldTooltip: string;
  italicTooltip: string;
  strikethroughTooltip: string;
  alignmentAndIndent: string;
  inlineCodeTooltip: string;
  firstLineIndent: string;
  twoCharacters: string;
};

export const uiText: Record<UiLanguage, UiText> = {
  zh: {
    file: "文件",
    edit: "编辑",
    view: "查看",
    window: "窗口",
    help: "帮助",
    newDocument: "新建",
    openDocument: "打开…",
    openMarkdownDocument: "打开 Markdown 文稿",
    saveMarkdownDocument: "保存 Markdown 文稿",
    markdown: "Markdown",
    untitledDocument: "未命名文稿",
    recentFiles: "最近打开的文件",
    noRecentFiles: "暂无最近打开的文稿",
    save: "保存",
    sharePackage: "创建分享包…",
    chooseSharePackageDestination: "选择分享包保存位置",
    sharePackageRequiresSave: "请先保存文稿，再创建分享包。",
    sharePackageCreated: (path) => `已创建分享包：\n${path}`,
    closeDocument: "关闭文稿",
    undo: "撤销",
    redo: "重做",
    cut: "剪切",
    copy: "复制",
    paste: "粘贴",
    documentPanel: "文档面板",
    documentFont: "文档字体",
    documentTable: "文档表格",
    documentIndent: "文档缩进",
    defaultFont: "默认字体",
    defaultTable: "默认表格",
    defaultIndent: "默认缩进",
    elegant: "优雅",
    modern: "现代",
    standard: "标准",
    custom: "自定义…",
    standardTable: "普通表格",
    threeLineTable: "三线表",
    noIndent: "无缩进",
    firstLineIndentTwoCharacters: "首行缩进",
    customDocumentFont: "自定义文档字体",
    customApplicationFont: "自定义默认字体",
    customFontDescription: "输入本机已安装的字体名称；中文与英文会分别使用对应字体。",
    chineseFont: "中文字体",
    latinFont: "英文字体",
    fontWeight: "正文字体粗细",
    fontWeightNote: "仅作用于正文，不影响标题。",
    fontWeightLight: "细体（300）",
    fontWeightRegular: "常规（400）",
    fontWeightMedium: "中等（500）",
    fontWeightSemibold: "半粗（600）",
    fontWeightBold: "粗体（700）",
    chineseFontPreview: "中文预览：白露为霜",
    latinFontPreview: "English preview: HakurouPaper",
    apply: "应用",
    cancel: "取消",
    minimize: "最小化",
    maximize: "最大化",
    close: "关闭",
    about: "关于 HakurouPaper",
    aboutMessage: "HakurouPaper\n本地优先的 Markdown 写作空间。",
    language: "界面语言",
    applicationMenu: "应用菜单",
    recentFilesList: "最近打开的文件",
    openedDocuments: "已打开文稿",
    unsaved: "未保存",
    closeDocumentWithTitle: (title) => `关闭 ${title}`,
    workspaceNavigation: "工作区导航",
    outline: "目录",
    documentList: "文稿列表",
    collapseHeading: "收起此标题下内容",
    expandHeading: "展开此标题下内容",
    editingArea: "文档编辑区",
    unsavedChanges: "未保存修改",
    savedLocally: "已保存在本地",
    localDraft: "本地草稿",
    selectedCount: (count) => `· 已选 ${count} 字`,
    documentStats: (words, characters) => `${words} 字 · ${characters} 字符`,
    documentDelivery: "文稿交付",
    documentDeliveryDescription: "通过 Pandoc 生成交付用 Word 文档；排版由所选 Word 模板决定，不映射编辑器展示设置。",
    pandocChecking: "正在检测 Pandoc…",
    pandocReady: (version) => `Pandoc 已就绪${version ? ` · ${version}` : ""}`,
    pandocUnavailable: "未检测到 Pandoc",
    checkPandoc: "重新检测",
    downloadPandoc: "下载 Pandoc",
    wordDocument: "Word 文档",
    wordTemplate: "Word 模板",
    formulaExport: "公式交付",
    wordNativeFormulas: "Word 原生公式",
    wordNativeFormulasDescription: "按所选 Word 模板生成原生公式；公式字体与样式完全由模板决定。",
    mathTypeFormulas: "MathType 可编辑公式",
    mathTypeFormulasDescription: "由 MathType 官方插件转换公式。转换时会打开 Word，需要等待一段时间。",
    mathTypeChecking: "正在检测 MathType 环境…",
    mathTypeReady: "MathType 环境已就绪",
    mathTypeUnavailable: "需要配置 MathType 环境",
    checkMathType: "重新检测 MathType",
    katexPreviewFormulas: "兼容预览公式（旧版）",
    katexPreviewFormulasDescription: "旧版 KaTeX PNG 预览路径；不用于高保真 MathType 交付。",
    chooseWordTemplate: "选择 Word 模板…",
    chooseDocxTemplate: "选择 Word 模板",
    clearWordTemplate: "不使用模板",
    useLastWordTemplate: "使用上次模板",
    noLastWordTemplate: "暂无上次使用的模板",
    noWordTemplate: "使用 Pandoc 默认样式",
    exportDocument: "当前文稿",
    docxExportDescription: "使用当前编辑内容与文稿资源创建 .docx。",
    docxExportRequiresSavedDocument: "请先保存文稿，再导出 Word 文档。",
    chooseDocxDestination: "选择 Word 文档保存位置",
    exportDocx: "导出 Word 文档…",
    exportingDocx: "正在导出…",
    docxProgressPreparing: "正在准备导出…",
    docxProgressGenerating: "正在生成 Word 文档…",
    docxProgressAwaitingMathTypeConvertDialog: "正在等待 MathType 的“转换公式”窗口…",
    docxProgressMathTypeConvertDialogReady: "“转换公式”窗口已出现：请点击“转换”，或等待自动化程序操作…",
    docxProgressManualMathTypeConvertNeeded: "无法自动操作“转换”按钮；请手工点击“转换”，完成后将继续导出。",
    docxProgressWaitingForMathType: "正在等待 MathType 处理整篇文档…",
    docxProgressFormattingMathType: "正在由 MathType 格式化整篇文档…",
    docxProgressAwaitingMathTypeFormatDialog: "正在等待 MathType 的“格式化公式”窗口…",
    docxProgressMathTypeFormatDialogReady: "“格式化公式”窗口已出现：正在应用 MathType 公式预置…",
    docxProgressManualMathTypeFormatNeeded: "无法自动操作“格式化公式”；请手工点击“确定”，完成后将继续保存。",
    docxProgressMathTypeFormattingSkipped: "未捕获“格式化公式”窗口；保留已转换的公式并继续保存…",
    docxConfirmManualMathTypeStep: "我已完成 MathType 操作，继续导出",
    docxProgressStartingMathTypeBatch: (batch, batches) => `正在启动 MathType · 第 ${batch}/${batches} 批`,
    docxProgressRenderingMathType: (completed, total, batch, batches) => batch && batches
      ? `MathType 正在渲染公式 ${completed}/${total} · 第 ${batch}/${batches} 批`
      : `MathType 正在渲染公式 ${completed}/${total}`,
    docxProgressSaving: "正在保存 Word 文档…",
    docxExported: (path) => `已导出 Word 文档：\n${path}`,
    docxExportedWithPreviewFallback: (path, count) => `已导出 Word 文档：\n${path}\n\n其中 ${count} 个 EMF 图元已改用 PNG 预览，以保证 Word 兼容性。`,
    docxExportFailed: "无法导出 Word 文档：",
    unsavedDocuments: "存在未保存文稿",
    unsavedDocument: "文稿尚未保存",
    confirmCloseApplication: "存在未保存的修改。确定不保存并关闭 HakurouPaper 吗？",
    confirmCloseDocument: (title) => `“${title}”的修改尚未保存。确定不保存并关闭此文稿吗？`,
    returnToEditing: "返回编辑",
    discardAndClose: "不保存并关闭",
    imageOperations: "图片操作",
    tableOperations: "表格操作",
    leftAlign: "左对齐",
    centerAlign: "居中对齐",
    rightAlign: "右对齐",
    delete: "删除",
    selectTable: "全选表格",
    convertThreeLineTable: "转换为三线表",
    setTitleRow: "设置标题行",
    setTitleColumn: "设置标题列",
    insertContent: "插入内容",
    table: "表格",
    tableDimensions: (rows, columns) => `${rows} × ${columns} 表格`,
    chooseTableDimensions: "选择表格行列",
    tableCell: (row, column) => `${row} 行 ${column} 列`,
    divider: "分隔线",
    blockMenu: "块菜单",
    body: "正文",
    bodyTooltip: "正文｜Markdown：普通段落",
    headingTooltip: (level) => `${["一", "二", "三"][level - 1] ?? level}级标题｜Markdown：${"#".repeat(level)} 标题｜再次点击还原正文`,
    bulletList: "• 列表",
    bulletListTooltip: "项目符号列表｜Markdown：- 内容｜再次点击还原正文",
    orderedList: "1. 列表",
    orderedListTooltip: "编号列表｜Markdown：1. 内容｜再次点击还原正文",
    codeBlock: "代码",
    codeBlockTooltip: "代码块｜Markdown：```｜再次点击还原正文",
    boldTooltip: "加粗｜Ctrl+B｜Markdown：**文字**",
    italicTooltip: "斜体｜Ctrl+I｜Markdown：*文字*",
    strikethroughTooltip: "删除线｜Markdown：~~文字~~",
    alignmentAndIndent: "对齐和首行缩进",
    inlineCodeTooltip: "行内代码｜Markdown：`代码`",
    firstLineIndent: "首行缩进",
    twoCharacters: "2 字符",
  },
  en: {
    file: "File",
    edit: "Edit",
    view: "View",
    window: "Window",
    help: "Help",
    newDocument: "New",
    openDocument: "Open…",
    openMarkdownDocument: "Open Markdown document",
    saveMarkdownDocument: "Save Markdown document",
    markdown: "Markdown",
    untitledDocument: "Untitled document",
    recentFiles: "Recent Files",
    noRecentFiles: "No recently opened documents",
    save: "Save",
    sharePackage: "Create Share Package…",
    chooseSharePackageDestination: "Choose where to save the share package",
    sharePackageRequiresSave: "Save the document before creating a share package.",
    sharePackageCreated: (path) => `Share package created:\n${path}`,
    closeDocument: "Close Document",
    undo: "Undo",
    redo: "Redo",
    cut: "Cut",
    copy: "Copy",
    paste: "Paste",
    documentPanel: "Document Panel",
    documentFont: "Document Font",
    documentTable: "Document Table",
    documentIndent: "Document Indent",
    defaultFont: "Default Font",
    defaultTable: "Default Table",
    defaultIndent: "Default Indent",
    elegant: "Elegant",
    modern: "Modern",
    standard: "Standard",
    custom: "Custom…",
    standardTable: "Standard table",
    threeLineTable: "Three-line table",
    noIndent: "No indent",
    firstLineIndentTwoCharacters: "First-line indent",
    customDocumentFont: "Custom Document Font",
    customApplicationFont: "Custom Default Font",
    customFontDescription: "Enter locally installed font family names. Chinese and Latin text use their respective font.",
    chineseFont: "Chinese font",
    latinFont: "Latin font",
    fontWeight: "Body text weight",
    fontWeightNote: "Applies to body text only; headings are unchanged.",
    fontWeightLight: "Light (300)",
    fontWeightRegular: "Regular (400)",
    fontWeightMedium: "Medium (500)",
    fontWeightSemibold: "Semibold (600)",
    fontWeightBold: "Bold (700)",
    chineseFontPreview: "Chinese preview: 白露为霜",
    latinFontPreview: "English preview: HakurouPaper",
    apply: "Apply",
    cancel: "Cancel",
    minimize: "Minimize",
    maximize: "Maximize",
    close: "Close",
    about: "About HakurouPaper",
    aboutMessage: "HakurouPaper\nA local-first Markdown writing workspace.",
    language: "Interface language",
    applicationMenu: "Application menu",
    recentFilesList: "Recently opened files",
    openedDocuments: "Open documents",
    unsaved: "Unsaved",
    closeDocumentWithTitle: (title) => `Close ${title}`,
    workspaceNavigation: "Workspace navigation",
    outline: "Outline",
    documentList: "Document list",
    collapseHeading: "Collapse this section",
    expandHeading: "Expand this section",
    editingArea: "Document editor",
    unsavedChanges: "Unsaved changes",
    savedLocally: "Saved locally",
    localDraft: "Local draft",
    selectedCount: (count) => ` · ${count} selected`,
    documentStats: (words, characters) => `${words} words · ${characters} characters`,
    documentDelivery: "Document Delivery",
    documentDeliveryDescription: "Create a delivery-ready Word document with Pandoc. The selected Word template controls layout; editor display settings are not exported.",
    pandocChecking: "Checking Pandoc…",
    pandocReady: (version) => `Pandoc is ready${version ? ` · ${version}` : ""}`,
    pandocUnavailable: "Pandoc was not found",
    checkPandoc: "Check again",
    downloadPandoc: "Download Pandoc",
    wordDocument: "Word document",
    wordTemplate: "Word template",
    formulaExport: "Formula delivery",
    wordNativeFormulas: "Native Word equations",
    wordNativeFormulasDescription: "Creates native Word equations with fonts and styling controlled entirely by the selected Word template.",
    mathTypeFormulas: "Editable MathType equations",
    mathTypeFormulasDescription: "Uses MathType’s official add-in to convert equations. Word opens during conversion and may take a while.",
    mathTypeChecking: "Checking the MathType environment…",
    mathTypeReady: "MathType environment is ready",
    mathTypeUnavailable: "MathType setup is required",
    checkMathType: "Check MathType again",
    katexPreviewFormulas: "Legacy preview equations",
    katexPreviewFormulasDescription: "Legacy KaTeX PNG preview path; not used for high-fidelity MathType delivery.",
    chooseWordTemplate: "Choose Word template…",
    chooseDocxTemplate: "Choose Word template",
    clearWordTemplate: "Use no template",
    useLastWordTemplate: "Use last template",
    noLastWordTemplate: "No previously used template",
    noWordTemplate: "Use Pandoc default styles",
    exportDocument: "Current document",
    docxExportDescription: "Creates a .docx from the current editing content and document assets.",
    docxExportRequiresSavedDocument: "Save the document before exporting a Word document.",
    chooseDocxDestination: "Choose where to save the Word document",
    exportDocx: "Export Word document…",
    exportingDocx: "Exporting…",
    docxProgressPreparing: "Preparing export…",
    docxProgressGenerating: "Generating Word document…",
    docxProgressAwaitingMathTypeConvertDialog: "Waiting for MathType’s Convert Equations dialog…",
    docxProgressMathTypeConvertDialogReady: "The Convert Equations dialog is ready: click Convert, or wait for automation…",
    docxProgressManualMathTypeConvertNeeded: "Automation could not operate Convert. Click Convert manually; export will continue when conversion finishes.",
    docxProgressWaitingForMathType: "Waiting for MathType to process the whole document…",
    docxProgressFormattingMathType: "MathType is formatting the whole document…",
    docxProgressAwaitingMathTypeFormatDialog: "Waiting for MathType’s Format Equations dialog…",
    docxProgressMathTypeFormatDialogReady: "The Format Equations dialog is ready: applying MathType’s equation preset…",
    docxProgressManualMathTypeFormatNeeded: "Automation could not operate Format Equations. Click OK manually; saving will continue when formatting finishes.",
    docxProgressMathTypeFormattingSkipped: "The Format Equations dialog was not observed; preserving converted equations and saving…",
    docxConfirmManualMathTypeStep: "I completed the MathType step — continue export",
    docxProgressStartingMathTypeBatch: (batch, batches) => `Starting MathType · batch ${batch}/${batches}`,
    docxProgressRenderingMathType: (completed, total, batch, batches) => batch && batches
      ? `MathType is rendering equations ${completed}/${total} · batch ${batch}/${batches}`
      : `MathType is rendering equations ${completed}/${total}`,
    docxProgressSaving: "Saving Word document…",
    docxExported: (path) => `Word document exported:\n${path}`,
    docxExportedWithPreviewFallback: (path, count) => `Word document exported:\n${path}\n\n${count} EMF graphic(s) used PNG previews for Word compatibility.`,
    docxExportFailed: "Could not export the Word document:",
    unsavedDocuments: "Unsaved documents",
    unsavedDocument: "Document not saved",
    confirmCloseApplication: "There are unsaved changes. Close HakurouPaper without saving them?",
    confirmCloseDocument: (title) => `“${title}” has unsaved changes. Close this document without saving?`,
    returnToEditing: "Keep Editing",
    discardAndClose: "Discard and Close",
    imageOperations: "Image actions",
    tableOperations: "Table actions",
    leftAlign: "Align left",
    centerAlign: "Align center",
    rightAlign: "Align right",
    delete: "Delete",
    selectTable: "Select table",
    convertThreeLineTable: "Convert to three-line table",
    setTitleRow: "Set title row",
    setTitleColumn: "Set title column",
    insertContent: "Insert content",
    table: "Table",
    tableDimensions: (rows, columns) => `${rows} × ${columns} table`,
    chooseTableDimensions: "Choose table dimensions",
    tableCell: (row, column) => `Row ${row}, column ${column}`,
    divider: "Divider",
    blockMenu: "Block menu",
    body: "Body",
    bodyTooltip: "Body text｜Markdown: paragraph",
    headingTooltip: (level) => `Heading ${level}｜Markdown: ${"#".repeat(level)} heading｜Click again to return to body text`,
    bulletList: "• List",
    bulletListTooltip: "Bulleted list｜Markdown: - item｜Click again to return to body text",
    orderedList: "1. List",
    orderedListTooltip: "Numbered list｜Markdown: 1. item｜Click again to return to body text",
    codeBlock: "Code",
    codeBlockTooltip: "Code block｜Markdown: ```｜Click again to return to body text",
    boldTooltip: "Bold｜Ctrl+B｜Markdown: **text**",
    italicTooltip: "Italic｜Ctrl+I｜Markdown: *text*",
    strikethroughTooltip: "Strikethrough｜Markdown: ~~text~~",
    alignmentAndIndent: "Alignment and first-line indent",
    inlineCodeTooltip: "Inline code｜Markdown: `code`",
    firstLineIndent: "First-line indent",
    twoCharacters: "2 characters",
  },
};
