# D16 — 独立观察与异常发现

**状态**：原则已同意，2026-10；类型、Schema、端口与实现未冻结。

## 决策

观察活动和结果独立于既有 Hypothesis 登记；可将预测失配、机制错误但工程结论仍有支持、未解释结果等保存为 Anomaly，供研究者提出新路线。

## 边界与未决问题

按 W3C 语义区分 sosa:Observation（活动）和 sosa:Result（结果）；LLM 审查属于外部调度，不直接裁决 Fact。

**执行前提**：与 [V3 基线](../ARCHITECTURE_BASELINE.md) 和 [W3C Crosswalk](../W3C_ALIGNMENT.md) 一致；本 ADR 不改变已冻结的 V1 运行时代码和工具。
