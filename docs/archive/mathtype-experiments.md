# MathType 实验归档（冻结）

这些路线在真实公式、真实 Word 或 MathType 环境中走到过可复现实验阶段，因此保留结论和最小源码；它们**不是**当前 UI 可选的交付方案，也不得在没有完整视觉回归的情况下重新启用。

当前正式方案见 [公式交付：当前正式技术路径](../architecture/formula-delivery.md)。

## 直接 MTEF / OLE 写入

### 做到了什么

- 由 MathML 生成 `Equation.DSMT4` OLE，并在 DOCX 中保留可编辑对象；
- 对 `docx-equation` 0.3.0 的 MTEF 脚本模板编码做过运行时修补：上下标、上下标组合、tilde / hat / vector 装饰与粗体字形均对照真实 MathType 字节验证；
- 修补了 CFB 容器重封装，能让 Word 打开生成的文档；
- 做过单公式 native OLE 缓存 smoke test，缓存放在文稿自己的 assets 内，避免污染导出目录；
- 记录过批量会话、GDI / USER 对象增长以及 32 / 64 公式批次的探索。

### 为什么冻结

- 单公式直写路径需要大量 OLE、MTEF 与 Word 进程状态维护，真实论文中的连续调用存在稳定性和速度问题；
- Word 曾在连续嵌入后将对象误识别为 Equation Editor 并提示转换为 Office Math，选择“是”会破坏 MathType OLE；
- 此路线依赖单独安装的 `docx-equation`，不适合作为当前正式产品依赖；仓库所参考的公开项目为 AGPL-3.0，因此不得将其代码或依赖误标为 MIT，也不得重新作为正式路线引入而不做许可证审查；
- 当前官方 Word 插件批量转换已经通过真实论文验收，稳定性和显示一致性更好。

### 保留位置

- `src-tauri/tools/mathtype_mtef_embed.py`：冻结的运行时编码修补器，当前正式 UI 不调用；
- `research/mathtype/direct-mtef/`：最小复现实验脚本与输入夹具；
- `research/mathtype/official-render-pocs/`：缓存与批量阈值 PoC 源码；
- `research/mathtype/**/raw-artifacts/`：本机保留的生成 DOCX、OLE、WMF、渲染图和依赖快照；受 `.gitignore` 排除，不推送。

## MTXForm 生成 WMF

### MTEF 二进制 → PICT / WMF

`MTXFormEqn(srcFmt=MTEF, dstFmt=PICT)` 对真实和生成的 Equation Native 可返回成功，但生成约 684 B 的全白 WMF。它可以读取或重编码 MTEF，却不能作为 MTEF → PICT 渲染器。`MTXFormSetPrefs`、翻译器设置、两步转换和 LOCAL 输出均未改变结论。

### LaTeX 文本 → PICT / WMF

`srcFmt=TEXT` 不是通用 LaTeX 输入。真实论文含 `\left`、`\frac` 等命令时，WMF 会直接显示源码，且与实际公式尺寸、间距严重失配。因此不能用这条路径替换 MathType 的原生显示层。

### 结论

WMF 文件存在、返回码为零或文件大小非零，都不能代表公式正确。只有在 Word / PDF 中实际检查过显示，才可以将一条渲染路线视为可用。

## KaTeX PNG 显示层

KaTeX PNG 曾用于兼容预览和早期 OLE 占位。它具备速度与隔离性，但在缩放、打印和字体一致性上无法达到 MathType 原生 WMF 的效果。当前正式导出不再使用 PNG 冻结公式；相关前端预览代码仅作为冻结研究资料保留。

## 重新开启冻结路线的条件

任一冻结路线若要重新成为正式候选，必须同时满足：

1. 明确许可证、运行时依赖和用户安装边界；
2. 用至少一篇真实论文连续导出并检查 Word / PDF 视觉结果；
3. 验证公式可编辑、字体和间距一致、编号正确；
4. 验证异常、进程崩溃和中断后的恢复策略；
5. 与当前官方插件路径比较速度、稳定性和交付质量后，再由产品决策切换。
