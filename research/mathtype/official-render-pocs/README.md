# MathType 原生渲染实验（冻结）

两个 Rust PoC 用于确认 MathType 的直接渲染与缓存策略：

- `mathtype_batch64_poc.rs`：验证长会话的批量阈值与进程回收；
- `mathtype_cache_smoke_poc.rs`：验证按公式内容缓存原生渲染结果。

它们曾为“直接 MTEF → WMF”和预渲染缓存方案提供数据，但并非当前交付路径。当前正式方案是 Pandoc 生成 OMML，再调用 MathType 官方 Word 插件；详见 [`docs/architecture/formula-delivery.md`](../../../docs/architecture/formula-delivery.md)。
