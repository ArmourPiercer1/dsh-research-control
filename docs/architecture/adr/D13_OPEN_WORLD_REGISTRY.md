# D13 — 开放 World Context

**状态**：原则已同意，2026-10；类型、Schema、端口与实现未冻结。

## 决策

Theory/Simulation/Engineering 不构成封闭枚举或信任等级。按 World、Representation、Scope、来源分别绑定明确、版本化的身份；跨 World 不隐式强制转换。

## 边界与未决问题

W3C RDF/OWL 可表达类型，但不提供我们的物理模型适用性语义。种子类型、变更迁移、类型继承与检查规则尚待 PoC。

**执行前提**：与 [V3 基线](../ARCHITECTURE_BASELINE.md) 和 [W3C Crosswalk](../W3C_ALIGNMENT.md) 一致；本 ADR 不改变 V1 冻结契约与既有工具面。
