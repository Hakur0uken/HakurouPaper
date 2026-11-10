# 原文保留、外部合并与运行中 AI 编辑

这些能力从 0.9.0 起随应用提供，Windows 指定场景的验证范围见文末。运行命令需要 Node.js 18+，并在下载的仓库源码目录中使用 scripts/hakurou-agent.mjs。

## 写作时保留 Markdown 原文

编辑器保留原始 Markdown，并将顶层显示块对应到源码范围。编辑某段时只重写发生变化的块，其他块直接沿用原文，包括 Setext 标题、强调符号、引用定义、表格分隔符、空行和换行风格。常规输入不会再整篇序列化。

当前粒度是顶层块。被修改的段落、整个列表或表格内部仍可能按 Milkdown 的规范重新输出，尚不是每个显示字符都直接映射到原文。无法可靠映射的扩展语法使用整篇序列化兼容回退，因此不能声称任意 Markdown 都逐字节保真。

源码变化以紧凑的可逆区间记录进入 ProseMirror 历史，不向文稿写入私有节点或标记，也不为每个按键储存整篇文稿副本。撤销、重做能够恢复原来的源码写法。保存不重建编辑器；切换文稿时从该文稿最新内存内容挂载。

实现入口：`src/editor/sourceMirror.ts`、`sourceEditing.ts`。

## 外部修改的三方合并

打开、加载和成功保存时维护共同磁盘基线。原生监听器同时观察 Markdown 与关联的 `hakurou.json`；未保存时发现外部修改，原有提示中增加“合并双方修改”。

合并使用共同基线、当前内存内容、外部磁盘内容三份快照：

- 不重叠的行修改一起保留；同一行竞争、相同位置插入等歧义要求明确选择。
- 冲突可选择“保留我的”“采用外部”“保留双方”；没有选完不能应用。
- 格式与资源元数据按字段合并，竞争数组作为整体选择，不自动拼接图片资源。
- 应用前再次核对本地编辑代数和磁盘正文、元数据；已变化则要求重新合并。
- 正文和外置格式一起进入一次可撤销编辑。合并不会自动保存或创建 Git 版本。
- 显式保存再次核对磁盘基线，原生写入前也核对 Markdown 原文，发现新变化会拒绝覆盖。

Markdown 与 sidecar 各自原子写入，尚不是跨文件事务，也不对第三方程序的同时写入提供文件锁保证。图片等二进制资源不做内容合并。大范围修改超过对齐计算预算时会呈现较大的冲突区，由用户决策。

实现入口：`src/collaboration/merge.ts`、`ExternalMergeDialog.tsx`、`src/editor/formatRestore.ts`；文件服务通过 `PlatformServices` 使用。

## AI 直接修改当前编辑器

使用内置 Node CLI 即可，不需要专用 Skill 或额外 npm 依赖。需要 Node.js 18+，并启动含本次代码的桌面应用。AI 只要能运行命令，就能列出打开的文稿、读取未保存内容、按精确文字或范围修改。需要先在应用中选中待编辑的文稿。

```powershell
node scripts/hakurou-agent.mjs docs
node scripts/hakurou-agent.mjs get DOCUMENT_ID
node scripts/hakurou-agent.mjs replace DOCUMENT_ID "旧句子" "新句子" --revision REVISION
node scripts/hakurou-agent.mjs apply DOCUMENT_ID patch.json --revision REVISION
node scripts/hakurou-agent.mjs save DOCUMENT_ID --revision REVISION
```

`DOCUMENT_ID` 和 `REVISION` 原样取自 `docs` / `get` / 上次编辑结果；也可用已打开文稿的绝对路径代替 ID。每次修改和保存都必须提供最新 revision。人继续输入、撤销、重做或重载后，旧 revision 会被拒绝，AI 应重新读取再准备修改。

精确替换默认只接受一次命中；有多次命中时拒绝，只有明确传 `--all` 才替换全部。范围编辑的 JSON 是数组，所有范围都对应同一份 `get` 快照，采用 JavaScript UTF-16 偏移：

```json
[{ "start": 0, "end": 3, "text": "新内容" }]
```

范围不能重叠或拆开 emoji 的代理对。程序修改进入当前撤销历史，保留范围外的选区，不抢焦点；输入法正在选字、待处理外部修改、保存或关闭确认期间拒绝编辑。`save` 是单独动作，新文稿须先由人在应用中选择保存位置。读取未激活的已打开文稿不需要切换；修改需要选中该文稿的编辑页。接口不执行 shell、不编辑任意未打开文件、不创建 Git 版本。

本机服务只监听随机 `127.0.0.1` 端口，使用每次启动生成的令牌鉴权。连接信息保存在 Tauri 本机应用目录 `agent-connection.json`，不要提交或分享。默认 Windows 路径为 `%LOCALAPPDATA%\com.hakurou.paper\agent-connection.json`。可用 `--connection FILE` 或 `HAKUROU_AGENT_CONNECTION` 选择独立验证实例。

实现入口：`src-tauri/src/agent.rs`、`src/platform/tauri/agent.ts`、`src/collaboration/agentProtocol.ts`、`scripts/hakurou-agent.mjs`。

## 验证与复现

自动测试：`node --test tests/*.test.mjs`、`npm run build`、`cargo test --lib`。Rust 测试会在临时目录创建 Git 仓库并验证本机能力，受限沙盒可能需要放行临时目录写入。

桌面使用独立应用 ID 和本机数据目录，启动命令：

```powershell
npm run tauri dev -- --config tests/collaboration-desktop.config.json
```

验证连接位于 `%LOCALAPPDATA%\com.hakurou.paper.collaboration-validation\agent-connection.json`。复制 `tests/fixtures/collaboration-paper.md` 到临时目录再打开，避免改动测试基准。修改编辑器底层插件后重启开发实例再验收，避免开发热更新保留旧插件状态。

2026-11-07 的 Windows 实测覆盖：中文及英文人工输入、未保存读取、AI 精确替换及范围编辑、旧 revision 拒绝、一步撤销和重做、独立外部编辑合并、竞争编辑显式选择、sidecar 单独变化检测、三线表及首行缩进应用和撤销、保存读回、重启重开、两份未保存草稿与原稿三次切换、关闭未保存草稿确认。未改动用户 `test/` 文稿或正式安装。

尚未验收 macOS/Linux、所有扩展 Markdown、极长真实论文的完整性能和资源压力。当前没有跨标签页保持撤销历史的新增实现；已验证的是当前编辑器中 AI/合并操作的撤销与重做，以及切换后的内容保留。
