export type SoftwareUpdateText = {
  menu: string; title: string; checking: string; current: (version: string) => string;
  available: (version: string) => string; versions: (current: string, next: string) => string;
  notes: string; noNotes: string; download: string; downloading: string; ready: string;
  install: string; installing: string; later: string; close: string; retry: string;
  releasePage: string; manual: string; installHelp: string; saveFirst: string; busy: string;
  checkFailed: string; downloadFailed: string; installFailed: string; openFailed: string;
};
export const softwareUpdateZh: SoftwareUpdateText = {
  menu: "检查软件更新", title: "软件更新", checking: "正在检查新版本…",
  current: (version) => `当前已是最新版本（${version}）。`,
  available: (version) => `发现新版本 ${version}`,
  versions: (current, next) => `当前版本 ${current} → 新版本 ${next}`,
  notes: "更新说明", noNotes: "此版本未提供更新说明。",
  download: "下载更新", downloading: "正在下载更新…", ready: "更新已下载，等待安装。",
  install: "安装并重启", installing: "正在安装，请稍候…",
  later: "稍后再说", close: "关闭", retry: "重新检查", releasePage: "前往发布页",
  manual: "此版本需要从发布页下载安装包。",
  installHelp: "安装会退出并重新打开软件，请先保存所有文稿。",
  saveFirst: "请先返回编辑并保存所有文稿，处理外部文件修改后再安装。",
  busy: "正在进行版本保存或远程同步，请完成后再安装。",
  checkFailed: "暂时无法检查更新，请检查网络后重试，也可前往发布页。",
  downloadFailed: "更新下载或验证失败，尚未安装。请重试或前往发布页。",
  installFailed: "未能完成安装或重启，请重新下载，也可前往发布页。",
  openFailed: "无法打开发布页，请稍后重试。",
};
export const softwareUpdateEn: SoftwareUpdateText = {
  menu: "Check for Software Updates", title: "Software Update", checking: "Checking for updates…",
  current: (version) => `You're up to date (${version}).`,
  available: (version) => `Version ${version} is available`,
  versions: (current, next) => `Current version ${current} → New version ${next}`,
  notes: "Release notes", noNotes: "No release notes were provided.",
  download: "Download Update", downloading: "Downloading update…", ready: "Update downloaded and ready to install.",
  install: "Install and Restart", installing: "Installing, please wait…",
  later: "Later", close: "Close", retry: "Check Again", releasePage: "Open Releases",
  manual: "Download the installer for this version from the release page.",
  installHelp: "Installation closes and restarts the app. Save all documents first.",
  saveFirst: "Return to editing, save all documents, and resolve external file changes before installing.",
  busy: "Wait for version saving or remote synchronization to finish before installing.",
  checkFailed: "Unable to check for updates. Check your connection and retry, or visit the release page.",
  downloadFailed: "Download or verification failed. Nothing was installed. Retry or visit the release page.",
  installFailed: "Installation or restart failed. Download again or visit the release page.",
  openFailed: "Unable to open the release page. Please try again.",
};
