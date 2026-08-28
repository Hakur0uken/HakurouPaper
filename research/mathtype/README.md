# MathType 研究源码

此目录保存已冻结但可复查的 MathType 研究源码。它们不参与桌面应用编译、不提供 UI 入口，也不是默认导出依赖。

- `direct-mtef/`：直接生成或改写 MathType OLE/MTEF 的最小验证脚本；
- `official-render-pocs/`：早期原生 OLE 缓存、批量会话阈值实验；
- 生成的 Word、OLE、WMF、PDF、渲染截图以及下载的依赖统一在各研究目录的 `raw-artifacts/`，只保留在本机，不进入 Git。

结论与重新启用条件见 [`docs/archive/mathtype-experiments.md`](../../docs/archive/mathtype-experiments.md)。
