# D14 — 规范化概念与术语纪律

**状态**：原则已同意，2026-10；类型、Schema、端口与实现未冻结。

## 决策

同义采用 skos:Concept、prefLabel、altLabel、definition、closeMatch 等；词汇范围 System/Domain/Project。概念修订影响相关科研记录，身份和版本不可关闭，扩展术语纪律经可插拔端口启停。

## 边界与未决问题

SKOS 不能替代正式谓词签名、物理量单位、Lean 命题对应关系；这些仍为领域扩展。

**执行前提**：与 [V3 基线](../ARCHITECTURE_BASELINE.md) 和 [W3C Crosswalk](../W3C_ALIGNMENT.md) 一致；本 ADR 不改变已冻结的 V1 运行时代码和工具。
