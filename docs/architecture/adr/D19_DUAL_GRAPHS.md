# D19 — 双图谱与灵活召回

**状态**：原则已同意，2026-10；类型、Schema、端口与实现未冻结。

## 决策

Inference Graph 维护有推理意义的前提、EvidenceRelation、Argument、反驳与义务；Research Association Graph 维护设备、数据、上下游、统计与经验等弱关联。两图共享身份和来源。

## 边界与未决问题

关联边不自动产生因果、逻辑蕴涵、Fact 或义务。由外部 LLM 选择图、跳数和剪枝；检索算法与接口尚待讨论。

**执行前提**：与 [V3 基线](../ARCHITECTURE_BASELINE.md) 和 [W3C Crosswalk](../W3C_ALIGNMENT.md) 一致；本 ADR 不改变 V1 冻结契约与既有工具面。
