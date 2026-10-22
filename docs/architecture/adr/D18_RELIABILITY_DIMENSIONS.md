# D18 — 三类可靠性分离

**状态**：原则已同意，2026-10；类型、Schema、端口与实现未冻结。

## 决策

Semantic Validity 管语义是否稳定；Inferential Validity 管已声明推理条件与规则；Evidential Adequacy 管科学证据对研究问题是否充分，主要靠科研判断。

## 边界与未决问题

SHACL、Lean 与 DQV 的成功验证各有不同的保证范围，不能合并为通用“正确”评分。

**执行前提**：与 [V3 基线](../ARCHITECTURE_BASELINE.md) 和 [W3C Crosswalk](../W3C_ALIGNMENT.md) 一致；本 ADR 不改变已冻结的 V1 运行时代码和工具。
