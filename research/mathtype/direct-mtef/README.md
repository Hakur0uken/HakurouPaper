# 直接 MTEF / OLE 实验（冻结）

这里是曾经走得最远的“绕过 Word 插件、直接写 MathType OLE”路径的可复现源码和最小输入。它没有 UI 入口，不会参与当前构建或默认导出。

- `scripts/`：混合 OLE、真实对象流提取与替换实验；
- `fixtures/`：用于上标等 MTEF 编码边界的最小公式输入；
- `../legacy-direct-mtef/raw-artifacts/`：本机保留的 DOCX、OLE、WMF 与截图，不进入 Git。

保留它的价值是复查 MTEF 字节和 OLE 封装；不要把它作为新功能的基础。显示层、稳定性和 MathType 原生渲染的结论见 [`docs/archive/mathtype-experiments.md`](../../../docs/archive/mathtype-experiments.md)。
