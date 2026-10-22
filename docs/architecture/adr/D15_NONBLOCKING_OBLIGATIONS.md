# D15 — 强制记录、非全面阻断的义务

**状态**：原则已同意，2026-10；类型、Schema、端口与实现未冻结。

## 决策

已登记推理规则产生明确的 ProofObligation，OPEN 条件可带标注地供研究继续，不能被伪装成证明或工程验收通过。沿真实依赖路径传播；独立支持路径应独立保留。

## 边界与未决问题

关联图召回提出的 ReviewSuggestion 不自动成为 ProofObligation。验证节点由外部 Agent 系统执行。

**执行前提**：与 [V3 基线](../ARCHITECTURE_BASELINE.md) 和 [W3C Crosswalk](../W3C_ALIGNMENT.md) 一致；本 ADR 不改变已冻结的 V1 运行时代码和工具。
