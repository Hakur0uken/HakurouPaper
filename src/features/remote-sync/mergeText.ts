export const remoteMergeZh = {
  open: "比较与合并", title: "比较并合并远程修改", close: "取消并返回", loading: "正在读取版本…", loadFailed: "读取失败，请重新打开比较。",
  scope: "本次操作涉及整个仓库分支。预览和冲突选择不会改动当前文件；确认后才更新工作目录。",
  cached: "比较的是已获取的远程记录。需要最新版本时，请先返回并点击“检查更新”。",
  base: "共同版本", local: "本地版本", remote: "远程版本", commits: "双方的独立版本", files: "文件改动", noFiles: "没有文件差异。",
  localOnly: "本地修改", remoteOnly: "远程修改", bothChanged: "双方修改", conflict: "待处理冲突", resolved: "已处理", automatic: "可自动合并",
  equal: "本地与远程相同。", outgoing: "远程没有待获取的版本，可以返回上传本地版本。", incoming: "本地没有独立提交，确认后直接获取远程更新。", diverged: "双方都有独立提交。确认后创建包含双方历史的合并版本。",
  historyCount: (n: number) => `${n} 个版本`, moreHistory: "此处最多展示最近 100 个独立版本；合并仍包含全部历史。",
  pair: "比较范围", pairBoth: "本地 → 远程", pairLocal: "共同版本 → 本地", pairRemote: "共同版本 → 远程",
  body: "正文差异", source: "源码差异", resolve: "处理冲突", same: "两边内容相同。", missing: "此版本中不存在", binary: "二进制或较大文件", link: "符号链接", submodule: "子模块版本",
  localChoice: "保留本地", remoteChoice: "采用远程", bothChoice: "保留双方", deleteFile: "删除文件", wholeFile: "选择整个文件保留哪一版。",
  groupHelp: "这是一组相关的路径冲突，请整体选择。下面列出的文件会一起采用所选一方的状态。",
  renameConflict: "文件重命名存在冲突", pathConflict: "文件与文件夹路径存在冲突", binaryConflict: "文件内容需要选择", textHelp: "逐项选择冲突，或编辑最终结果。未冲突的修改已经保留。",
  noTextConflicts: "正文可以自动合并，请检查结果后应用。", original: "查看共同版本", finalText: "编辑最终合并结果", useResult: "使用此合并结果", currentResult: "此文件的冲突已处理，仍可继续修改选择。",
  metadata: "格式与资源设置", metadataHelp: "独立设置会一起保留；有竞争的设置逐项选择。资源列表按整体选择。", inspectSettings: "查看合并后的设置", invalidMetadata: "此文件无法作为有效的设置读取，请按普通文本处理。",
  summary: (resolved: number, total: number) => `已处理 ${resolved} / ${total} 组冲突`, message: "合并说明", defaultMessage: (remote: string, branch: string) => `合并来自 ${remote}/${branch} 的修改`,
  apply: "确认合并并创建版本", fastForward: "确认更新工作目录", applying: "正在应用合并…", unsaved: "请先返回，保存并创建本地版本，再重新比较。", refresh: "关闭后重新比较", noImage: "此文件仅比较版本和大小。", bytes: "字节",
};
export type RemoteMergeText = typeof remoteMergeZh;
export const remoteMergeEn: RemoteMergeText = {
  open: "Compare and merge", title: "Compare and merge remote changes", close: "Cancel and return", loading: "Reading versions…", loadFailed: "Unable to load. Reopen the comparison.",
  scope: "This affects the whole repository branch. Previewing and choosing conflicts do not change your files. Files update only after confirmation.", cached: "Comparing previously fetched remote records. Return and Check updates first if you need the latest version.",
  base: "Common version", local: "Local version", remote: "Remote version", commits: "Independent versions", files: "File changes", noFiles: "No file differences.", localOnly: "Local change", remoteOnly: "Remote change", bothChanged: "Both changed", conflict: "Needs a choice", resolved: "Resolved", automatic: "Merges automatically",
  equal: "Local and remote are identical.", outgoing: "No incoming versions. Return to upload local versions.", incoming: "There are no local-only commits. Confirmation directly applies remote updates.", diverged: "Both sides have independent commits. Confirmation creates a merge version retaining both histories.", historyCount: n => `${n} versions`, moreHistory: "Showing up to 100 recent independent versions per side. The merge includes all history.",
  pair: "Compare", pairBoth: "Local → Remote", pairLocal: "Common → Local", pairRemote: "Common → Remote", body: "Document changes", source: "Source changes", resolve: "Resolve conflicts", same: "The contents are identical.", missing: "Absent in this version", binary: "Binary or large file", link: "Symbolic link", submodule: "Submodule version",
  localChoice: "Keep local", remoteChoice: "Take remote", bothChoice: "Keep both", deleteFile: "Delete file", wholeFile: "Choose which complete file to keep.", groupHelp: "These related path conflicts must be resolved together. All listed files will use the selected side's state.", renameConflict: "Conflicting file renames", pathConflict: "Conflicting file and directory paths", binaryConflict: "Choose file contents", textHelp: "Choose each conflict or edit the final text. Independent changes are already retained.", noTextConflicts: "Text can merge automatically. Review and apply the result.", original: "Show common version", finalText: "Edit final merged text", useResult: "Use this merged result", currentResult: "This conflict is resolved. You may still change the selection.",
  metadata: "Formatting and resources", metadataHelp: "Independent settings are retained. Choose competing settings individually. Resource lists are chosen as a whole.", inspectSettings: "Inspect merged settings", invalidMetadata: "This is not valid settings data. Resolve it as ordinary text.", summary: (done,total) => `${done} / ${total} conflict groups resolved`, message: "Merge description", defaultMessage: (remote,branch) => `Merge changes from ${remote}/${branch}`, apply: "Confirm merge and create version", fastForward: "Confirm working directory update", applying: "Applying merge…", unsaved: "Return, save and create local versions, then compare again.", refresh: "Close and compare again", noImage: "Only version and size are compared for this file.", bytes: "bytes",
};
