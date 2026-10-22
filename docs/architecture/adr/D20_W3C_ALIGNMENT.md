# D20 — W3C-first 科研语义与命名

**状态**：原则已同意，2026-10；类型、Schema、端口与实现未冻结。

## 决策

凡语义与 W3C 精确一致的对象或关系，使用 W3C 官方名称并作废旧同义名。PROV 负责活动/实体/来源，SOSA 负责观测活动/结果，SKOS 负责概念词汇；DSH 自己扩展 Argument、EvidenceRelation、Assessment、FactStanding、World/Scope 等。

## 边界与未决问题

只在真正等价时强映射，不把科学假设变成默认 RDF 物理事实，不把数据派生当逻辑证明。不强制 RDF 原生存储；详细 crosswalk 见 ../W3C_ALIGNMENT.md。

**执行前提**：与 [V3 基线](../ARCHITECTURE_BASELINE.md) 和 [W3C Crosswalk](../W3C_ALIGNMENT.md) 一致；本 ADR 不改变已冻结的 V1 运行时代码和工具。
