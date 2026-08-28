# 公式交付：当前正式技术路径

本文是 HakurouPaper 公式导出的唯一正式设计说明。它描述当前会随应用交付、需要持续回归的路径；历史上验证过但未作为默认交付的方案见 [MathType 实验归档](../archive/mathtype-experiments.md)。

## 目标与边界

- Markdown 始终保留标准 LaTeX 数学语法；不写入私有公式格式。
- 导出的 `.docx` 中，用户选择 MathType 时公式必须是可双击编辑的 MathType OLE，而不是 PNG。
- 公式显示由 MathType 自身生成，避免浏览器 PNG 在缩放和打印时变糊。
- 编辑、输入和确认公式时不启动 MathType；MathType 只在用户请求导出时运行。
- 本链路是 Windows 桌面能力：需要 Microsoft Word、MathType 7、MathType 的 Office Support 组件，以及 Python 3、`pywin32`、`pywinauto`。

## 正式链路

```text
Markdown（LaTeX）
    │
    ├─ Pandoc 生成 Word OMML
    │
    ├─ 块公式编号布局：居中制表位 + 右对齐制表位
    │
    ├─ Word 打开临时 DOCX
    │
    ├─ MathType 官方 Word 插件：整篇 OMML → Equation.DSMT4 OLE
    │
    └─ 复制完成的 DOCX 到用户选择的位置
```

正式 UI 只有两种公式交付选择：

| 选择 | 结果 | 依赖 |
| --- | --- | --- |
| Word 原生公式 | Pandoc 的 OMML | Pandoc |
| MathType 可编辑公式 | 官方插件转换出的 `Equation.DSMT4` OLE + MathType WMF 显示层 | Pandoc、Word、MathType |

`MathType 可编辑公式` 被选中时，应用先检测 `MathType.exe`、`WINWORD.EXE` 和 `Office Support/BlankEqn.doc`。环境缺失时在界面说明配置原因并阻止导出；不等到 Word 打开后才失败。

## 公式编号

块级公式默认显示右侧编号。编辑器只计算视觉编号，Markdown 仍是普通的 `$$ ... $$`：

- `\tag{7}` 或 `\tag*{A}` 优先作为显式标签；
- 取消“右侧编号”会写入标准 LaTeX `\notag`；
- 未手写标签的公式在插入、删除、重排后按顺序重新编号。

导出时不把编号写进 MathType 公式对象。Pandoc 生成 OMML 后，后端将对应的 Word 段落改为一个居中制表位和一个右对齐制表位：公式在页面中心，编号靠右。之后才调用 MathType 官方插件，因此编号不会被误当作公式内容，Word 原生与 MathType 两条正式路径也保持同一编号规则。

## MathType 自动化与人工接管

`src-tauri/tools/mathtype_official_batch.py` 只做官方插件的桌面自动化：

1. 等待并设置“转换公式”窗口的整篇文档 / OMML 选项；
2. 尝试点击“转换”；
3. 若旧版对话框控件不可识别，界面显示人工接管按钮；
4. 用户完成窗口操作后点击“我已完成 MathType 操作，继续导出”；
5. 后端以 Word 中 OMML 数量减少、MathType OLE 数量增加作为成功条件，而不是仅依据弹窗是否消失。

“没有公式被发现和/或更新”属于已知的 Word / MathType 兼容提示，不能单独判定导出失败。只要结构校验确认 OMML 已转换为 MathType OLE，交付仍可继续。相关外部排查参考见本机私有的进展记录；自动处理该兼容问题不属于当前正式路径。

## 源码职责

| 位置 | 职责 |
| --- | --- |
| `src/math.ts` | Milkdown 公式节点、公式源码编辑、编辑器内右侧编号与 `\notag` 开关。 |
| `src/features/pandoc/PandocWorkspace.tsx` | Word 导出界面、Pandoc / MathType 环境状态、进度和人工接管入口。 |
| `src-tauri/src/pandoc.rs` | Pandoc 调用、编号段落布局、DOCX 封装和最终文件发布。 |
| `src-tauri/src/mathtype.rs` | MathType 环境检测、官方批量转换器进程与人工接管信号。 |
| `src-tauri/tools/mathtype_official_batch.py` | Word + MathType 官方插件自动化。 |

## 验证门槛

任何公式导出改动至少要通过：

```powershell
npm run build
Set-Location src-tauri
cargo test --no-default-features --lib
```

涉及 MathType 的改动还必须用真实 Word + MathType 做一次小文档和一次真实论文回归，检查：公式可双击编辑、WMF 显示清晰、块公式编号位置正确、人工接管能恢复完成导出。不得只看返回码、文件大小或 OLE 数量就认定显示效果正确。
