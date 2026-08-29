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
  versionManagement: string;
  versionManagementDescription: string;
  versionRequiresSavedDocument: string;
  versionCheckingGit: string;
  versionGitAvailable: (version?: string) => string;
  versionGitUnavailable: string;
  versionGitUnavailableDescription: string;
  getGit: string;
  checkGit: string;
  versionNotEnabled: string;
  versionScope: string;
  versionIncludesMarkdown: (name: string) => string;
  versionIncludesAssets: (name: string) => string;
  enableVersionManagement: string;
  enablingVersionManagement: string;
  versionEnabled: string;
  versionRepository: string;
  versionCurrentBranch: string;
  versionNoHistory: string;
  versionBranchUnavailable: string;
  versionCurrentChanges: string;
  versionShowRevisionChanges: string;
  versionRefresh: string;
  versionNoChanges: string;
  versionNoDocumentChanges: string;
  versionManuscriptChanged: string;
  versionUnsavedContentNotice: string;
  versionChangeModified: string;
  versionChangeAdded: string;
  versionChangeDeleted: string;
  versionChangeRenamed: string;
  versionDiffTitle: string;
  versionDiffComparison: string;
  versionDiffClose: string;
  versionDiffOriginal: string;
  versionDiffWorkingTree: string;
  versionDiffLoading: string;
  versionDiffNoTextChanges: string;
  versionDiffBinary: string;
  versionComparisonTitle: string;
  versionAdvancedMode: string;
  versionExitAdvancedMode: string;
  versionRenderedPreview: string;
  versionAdvancedCompare: string;
  versionRenderedLoading: string;
  versionRenderedFailed: string;
  versionRenderedChangeCount: (count: number) => string;
  versionPreviousChange: string;
  versionNextChange: string;
  versionPreviewUnsavedContent: string;
  versionAdvancedUnsavedNotice: string;
  versionBefore: string;
  versionAfter: string;
  versionSettingsChanged: string;
  versionChangedFiles: string;
  versionFilesChanged: (count: number) => string;
  versionLineSummary: (added: number, removed: number) => string;
  versionShowInternalFiles: string;
  versionLatestRevision: string;
  versionPreviousVersion: string;
  versionCurrentDocument: string;
  versionThisVersion: string;
  versionNotCreatedYet: string;
  versionNoSavedRevision: string;
  versionCreate: string;
  versionDescription: string;
  versionDescriptionHint: string;
  versionDescriptionHelp: string;
  versionCreateVersion: string;
  versionCreatingVersion: string;
  versionCreated: string;
  versionHistory: string;
  versionHistoryEmpty: string;
  versionHistoryLoading: string;
  versionMessageRequired: string;
  versionAuthorInformation: string;
  versionAuthorName: string;
  versionAuthorEmail: string;
  versionSaveAuthor: string;
  versionSavingAuthor: string;
  versionRestoreThis: string;
  versionRestoreTitle: string;
  versionRestoreDescription: (title: string) => string;
  versionRestoreUnsaved: string;
  versionSaveDocumentAndContinue: string;
  versionRestoreProtectionTitle: string;
  versionRestoreProtectionDescription: string;
  versionRestoreSaveFirst: string;
  versionRestoreDiscard: string;
  versionRestoreDiscardWarning: string;
  versionRestoreBeforeMessage: string;
  versionRestoreContinue: string;
  versionRestoring: string;
  versionRestored: string;
  versionAlreadyEquivalent: string;
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
    save: "保存文稿",
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
    unsaved: "尚未保存",
    closeDocumentWithTitle: (title) => `关闭 ${title}`,
    workspaceNavigation: "工作区导航",
    outline: "目录",
    documentList: "文稿列表",
    collapseHeading: "收起此标题下内容",
    expandHeading: "展开此标题下内容",
    editingArea: "文档编辑区",
    unsavedChanges: "尚未保存",
    savedLocally: "已保存",
    localDraft: "本地草稿",
    selectedCount: (count) => `· 已选 ${count} 字`,
    documentStats: (words, characters) => `${words} 字 · ${characters} 字符`,
    documentDelivery: "文稿交付",
    documentDeliveryDescription: "通过 Pandoc 生成交付用 Word 文档；排版由所选 Word 模板决定，不映射编辑器展示设置。",
    versionManagement: "版本管理",
    versionManagementDescription: "在本机记录文稿版本，可随时比较或恢复历史内容。",
    versionRequiresSavedDocument: "请先保存文稿，再启用版本管理。",
    versionCheckingGit: "正在检测 Git…",
    versionGitAvailable: (version) => `Git 已就绪${version ? ` · ${version}` : ""}`,
    versionGitUnavailable: "版本管理不可用",
    versionGitUnavailableDescription: "HakurouPaper 使用标准 Git 进行本地版本管理。安装 Git 后即可使用此功能。",
    getGit: "获取 Git",
    checkGit: "重新检测",
    versionNotEnabled: "当前文稿尚未启用版本管理。",
    versionScope: "版本范围",
    versionIncludesMarkdown: (name) => name,
    versionIncludesAssets: (name) => `assets/${name}`,
    enableVersionManagement: "启用版本管理",
    enablingVersionManagement: "正在启用…",
    versionEnabled: "版本管理已启用",
    versionRepository: "仓库",
    versionCurrentBranch: "当前分支",
    versionNoHistory: "当前尚无历史版本",
    versionBranchUnavailable: "尚未识别分支",
    versionCurrentChanges: "当前修改",
    versionShowRevisionChanges: "显示版本修改",
    versionRefresh: "刷新",
    versionNoChanges: "当前文稿相对于上一个版本没有修改。",
    versionNoDocumentChanges: "当前文稿内容没有修改；资源修改会随创建版本一并保存。",
    versionManuscriptChanged: "文稿及相关资源已修改",
    versionUnsavedContentNotice: "文稿有尚未写入磁盘的修改。Git 修改状态基于最近一次保存内容。",
    versionChangeModified: "已修改",
    versionChangeAdded: "新增",
    versionChangeDeleted: "已删除",
    versionChangeRenamed: "已重命名",
    versionDiffTitle: "比较修改",
    versionDiffComparison: "当前版本 ↔ 工作区",
    versionDiffClose: "退出比较",
    versionDiffOriginal: "当前版本",
    versionDiffWorkingTree: "工作区",
    versionDiffLoading: "正在读取比较内容…",
    versionDiffNoTextChanges: "没有可显示的文本行修改。",
    versionDiffBinary: "二进制文件。本阶段不会读取或传输其内容。",
    versionComparisonTitle: "版本比较",
    versionAdvancedMode: "高级模式",
    versionExitAdvancedMode: "退出高级模式",
    versionRenderedPreview: "修改预览",
    versionAdvancedCompare: "高级比较",
    versionRenderedLoading: "正在生成修改预览…",
    versionRenderedFailed: "无法生成完整文稿预览，请使用高级比较。",
    versionRenderedChangeCount: (count) => `${count} 处修改`,
    versionPreviousChange: "上一处",
    versionNextChange: "下一处",
    versionPreviewUnsavedContent: "包含尚未保存的编辑内容",
    versionAdvancedUnsavedNotice: "当前还有尚未保存的编辑内容，高级比较基于最近一次保存的文件。",
    versionBefore: "修改前",
    versionAfter: "修改后",
    versionSettingsChanged: "文稿设置发生变化",
    versionChangedFiles: "文件变化",
    versionFilesChanged: (count) => `${count} 个文件发生变化`,
    versionLineSummary: (added, removed) => `新增 ${added} 行 · 删除 ${removed} 行`,
    versionShowInternalFiles: "显示内部文件",
    versionLatestRevision: "最新版本",
    versionPreviousVersion: "上一个版本",
    versionCurrentDocument: "当前文稿",
    versionThisVersion: "此版本",
    versionNotCreatedYet: "尚未创建新版本",
    versionNoSavedRevision: "尚无已保存版本",
    versionCreate: "创建版本",
    versionDescription: "版本说明",
    versionDescriptionHint: "简要说明本版本的主要修改（最多 160 字）",
    versionDescriptionHelp: "记录本版本的主要变化，方便以后查找。",
    versionCreateVersion: "创建版本",
    versionCreatingVersion: "正在创建…",
    versionCreated: "已创建版本。",
    versionHistory: "版本历史",
    versionHistoryEmpty: "当前文稿尚无历史版本。",
    versionHistoryLoading: "正在读取版本历史…",
    versionMessageRequired: "请填写版本说明。",
    versionAuthorInformation: "版本作者信息",
    versionAuthorName: "姓名",
    versionAuthorEmail: "邮箱",
    versionSaveAuthor: "保存并继续",
    versionSavingAuthor: "正在保存…",
    versionRestoreThis: "恢复此版本",
    versionRestoreTitle: "恢复此版本？",
    versionRestoreDescription: (title) => `将把“${title}”的内容恢复为当前文稿。现有历史版本不会被删除。`,
    versionRestoreUnsaved: "当前文稿还有尚未保存的修改。",
    versionSaveDocumentAndContinue: "保存文稿并继续",
    versionRestoreProtectionTitle: "恢复前请保护当前修改",
    versionRestoreProtectionDescription: "恢复到旧版本前，当前文稿还有尚未创建版本的修改。",
    versionRestoreSaveFirst: "创建当前版本后恢复",
    versionRestoreDiscard: "放弃当前修改并恢复",
    versionRestoreDiscardWarning: "尚未创建版本的修改将被永久丢弃。",
    versionRestoreBeforeMessage: "恢复前版本说明",
    versionRestoreContinue: "继续恢复",
    versionRestoring: "正在恢复…",
    versionRestored: "已恢复该版本，并创建新的版本记录。",
    versionAlreadyEquivalent: "当前文稿已经与该版本一致。",
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
    save: "Save Document",
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
    unsavedChanges: "Unsaved",
    savedLocally: "Saved",
    localDraft: "Local draft",
    selectedCount: (count) => ` · ${count} selected`,
    documentStats: (words, characters) => `${words} words · ${characters} characters`,
    documentDelivery: "Document Delivery",
    documentDeliveryDescription: "Create a delivery-ready Word document with Pandoc. The selected Word template controls layout; editor display settings are not exported.",
    versionManagement: "Version Management",
    versionManagementDescription: "Record document versions locally, then compare or restore earlier content whenever needed.",
    versionRequiresSavedDocument: "Save the document before enabling version management.",
    versionCheckingGit: "Checking Git…",
    versionGitAvailable: (version) => `Git is ready${version ? ` · ${version}` : ""}`,
    versionGitUnavailable: "Version management is unavailable",
    versionGitUnavailableDescription: "HakurouPaper uses standard Git for local version management. Install Git to use this feature.",
    getGit: "Get Git",
    checkGit: "Check again",
    versionNotEnabled: "Version management is not enabled for this document.",
    versionScope: "Version scope",
    versionIncludesMarkdown: (name) => name,
    versionIncludesAssets: (name) => `assets/${name}`,
    enableVersionManagement: "Enable Version Management",
    enablingVersionManagement: "Enabling…",
    versionEnabled: "Version management is enabled",
    versionRepository: "Repository",
    versionCurrentBranch: "Current branch",
    versionNoHistory: "There is no version history yet",
    versionBranchUnavailable: "No branch identified yet",
    versionCurrentChanges: "Current Changes",
    versionShowRevisionChanges: "Show revision changes",
    versionRefresh: "Refresh",
    versionNoChanges: "The current document has no changes compared with the previous version.",
    versionNoDocumentChanges: "The document content has not changed; asset changes will be saved with the version.",
    versionManuscriptChanged: "The manuscript or its related resources have changed",
    versionUnsavedContentNotice: "This document has changes not yet written to disk. Git status is based on the most recently saved content.",
    versionChangeModified: "Modified",
    versionChangeAdded: "Added",
    versionChangeDeleted: "Deleted",
    versionChangeRenamed: "Renamed",
    versionDiffTitle: "Compare Changes",
    versionDiffComparison: "Current version ↔ Working tree",
    versionDiffClose: "Exit Comparison",
    versionDiffOriginal: "Current version",
    versionDiffWorkingTree: "Working tree",
    versionDiffLoading: "Loading comparison…",
    versionDiffNoTextChanges: "There are no text-line changes to display.",
    versionDiffBinary: "Binary file. Its contents are not read or transferred in this phase.",
    versionComparisonTitle: "Version Comparison",
    versionAdvancedMode: "Advanced mode",
    versionExitAdvancedMode: "Exit Advanced Mode",
    versionRenderedPreview: "Revision Preview",
    versionAdvancedCompare: "Advanced Comparison",
    versionRenderedLoading: "Generating revision preview…",
    versionRenderedFailed: "A complete document preview could not be generated. Use Advanced Comparison instead.",
    versionRenderedChangeCount: (count) => `${count} change${count === 1 ? "" : "s"}`,
    versionPreviousChange: "Previous Change",
    versionNextChange: "Next Change",
    versionPreviewUnsavedContent: "Includes unsaved edits",
    versionAdvancedUnsavedNotice: "This document still has unsaved edits. Advanced Comparison uses the most recently saved file.",
    versionBefore: "Before",
    versionAfter: "After",
    versionSettingsChanged: "Document settings changed",
    versionChangedFiles: "Changed Files",
    versionFilesChanged: (count) => `${count} file${count === 1 ? "" : "s"} changed`,
    versionLineSummary: (added, removed) => `${added} added · ${removed} removed`,
    versionShowInternalFiles: "Show internal files",
    versionLatestRevision: "Latest version",
    versionPreviousVersion: "Previous version",
    versionCurrentDocument: "Current document",
    versionThisVersion: "This version",
    versionNotCreatedYet: "No new version created yet",
    versionNoSavedRevision: "No saved version yet",
    versionCreate: "Create Version",
    versionDescription: "Version description",
    versionDescriptionHint: "Briefly describe the main changes in this version (up to 160 characters)",
    versionDescriptionHelp: "Record the main changes in this version to make it easier to find later.",
    versionCreateVersion: "Create Version",
    versionCreatingVersion: "Creating…",
    versionCreated: "Version created.",
    versionHistory: "Version History",
    versionHistoryEmpty: "This document has no version history yet.",
    versionHistoryLoading: "Loading version history…",
    versionMessageRequired: "Enter a version description.",
    versionAuthorInformation: "Version author information",
    versionAuthorName: "Name",
    versionAuthorEmail: "Email",
    versionSaveAuthor: "Save and continue",
    versionSavingAuthor: "Saving…",
    versionRestoreThis: "Restore This Version",
    versionRestoreTitle: "Restore this version?",
    versionRestoreDescription: (title) => `Restore “${title}” as the current document. Existing version history will not be deleted.`,
    versionRestoreUnsaved: "The current document has unsaved changes.",
    versionSaveDocumentAndContinue: "Save Document and Continue",
    versionRestoreProtectionTitle: "Protect current changes first",
    versionRestoreProtectionDescription: "The current document has changes that do not yet have a version.",
    versionRestoreSaveFirst: "Create a current version, then restore",
    versionRestoreDiscard: "Discard current changes and restore",
    versionRestoreDiscardWarning: "Changes without a version will be permanently discarded.",
    versionRestoreBeforeMessage: "Version description before restoring",
    versionRestoreContinue: "Continue Restoring",
    versionRestoring: "Restoring…",
    versionRestored: "The version was restored and a new version record was created.",
    versionAlreadyEquivalent: "The current document already matches this version.",
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
