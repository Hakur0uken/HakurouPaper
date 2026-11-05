# 软件更新

从 0.8.6 起接入 Tauri 官方 updater。0.8.5 及更早版本不包含此功能；首次使用需手动安装 0.8.6，之后可在软件内检查、下载和安装更新。

## 用户操作

- 启动完成后延迟 1.5 秒在后台检查一次，只在发现新版时提醒。没有更新或网络失败时不打断写作。
- “帮助 → 检查软件更新”可主动检查，显示最新版、检查失败或可下载的新版本。
- 下载进度显示在弹窗中，可选择“稍后再说”继续写作，再通过帮助菜单回到下载状态。
- 下载通过签名验证后，用户选择“安装并重启”。存在任何未保存文稿、待处理外部文件修改或正在进行的 Git 操作时，禁止安装。
- Windows 安装时会退出应用，由安装器重新启动。更新提示使用原生模态对话框，安装期间禁止关闭提示、触发编辑快捷键或重复安装。
- 旧 Release 没有 latest.json 时，引导到 GitHub 发布页手动下载；签名验证失败不会自动执行未验证安装包。
- 优先读取 GitHub Release 的静态更新清单，不需要用户登录，也不占用 GitHub API 限额。清单不可用时才查询公开 Release API，以兼容尚未提供清单的旧版本；离线或访问受限时，手动检查提供重试和发布页入口。

## 签名与构建

软件内嵌公钥，私钥保存在发布者本机。此工作区首次生成的私钥位于 E:/个人其他/Hakurou/.release-signing.local/updater.key；该目录由 Git 忽略。请单独备份此目录，不要把私钥、私钥内容或密码上传到仓库、Release 或聊天。后续版本必须沿用同一把密钥。

发布前同步 package.json、package-lock.json、src-tauri/Cargo.toml、src-tauri/Cargo.lock、src-tauri/tauri.conf.json 中的应用版本号，并准备 UTF-8 发布说明文件。执行：

```powershell
npm run build:update -- --key 'E:/个人其他/Hakurou/.release-signing.local/updater.key' --notes-file 'release-notes.txt'
```

也可通过 TAURI_SIGNING_PRIVATE_KEY 或 TAURI_SIGNING_PRIVATE_KEY_PATH 提供密钥，通过 TAURI_SIGNING_PRIVATE_KEY_PASSWORD 提供密码。构建脚本不会打印私钥。普通开发使用 npm run tauri dev，无需设置签名密钥。

脚本检查版本一致性，调用官方 Tauri 签名构建，并在 src-tauri/target/release/bundle/nsis/ 生成：

1. HakurouPaper_<版本>_x64-setup.exe
2. 对应 .exe.sig
3. latest.json：版本、说明、发布时间、Windows x64 下载地址、签名内容
4. SHA256SUMS.txt

先创建新版本的 GitHub Release 草稿，上传上述四个文件并核对，再公开为最新正式版本。不要只上传安装包后马上公开，避免检查期间出现不完整清单。下载地址绑定对应版本标签，不会指向本机路径。当前构建辅助脚本只准备 Windows x64；其他平台需要对应构建产物后再添加。

## 验证范围

更新流程单元测试覆盖静默启动、主动检查、并发请求、稍后处理、下载进度、签名失败后的禁止安装、未保存内容保护、安装失败及旧版本回退；发布清单测试覆盖版本与下载地址。界面使用示例更新验证，签名构建在本机验证。真实“旧版 → 新版”的完整安装和重启需在发布带更新功能的首版后，用隔离安装环境验收。

参考：https://v2.tauri.app/plugin/updater/
