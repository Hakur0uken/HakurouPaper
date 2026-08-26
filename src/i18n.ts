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
    codeBlock: "‹/› 代码",
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
    codeBlock: "‹/› Code",
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
