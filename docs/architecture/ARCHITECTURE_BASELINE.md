# V3 架构基线：科研语义与论证基础设施

> 状态：讨论稿 · W3C-first · 已同意 D13–D20 的方向性原则；Schema、实施方案、L2–L5 及查询算法未冻结。

## 1. 一句话定义

这是**记录并服务科研认识演化的语义基础设施**：它准确保存科研活动、来源、陈述、证据关系、论证、审查和待解问题，帮助 Agent 追踪“为什么相信、哪里可疑、还应想到什么”，**不负责判定普适科学真理或编排 Agent**。

### 三类独立的可靠性

| 维度 | 系统的局部保障 | 不能声称 |
| --- | --- | --- |
| **Semantic Validity** | 对象身份、概念、World/Scope、版本、引用和确认历史稳定 | 自然语言与物理现实完全一致 |
| **Inferential Validity** | 已登记规则的前提、条件、类型、证书在其限定范围内可检查 | 所有归纳、溯因、类比、因果推理都严格成立 |
| **Evidential Adequacy** | 来源、已记录实验数据及关联信息可被检索，供科研审查 | 存在一台能够自动判定“所有重要因素均已考虑”的机器 |

形式化程度不等于科学真值；准确 Lean 证书不自动证明物理模型适用，统计检验也不自动证明因果结论。

## 2. 逻辑架构

```text
External Human / Research Agents / dsh-agent-team
       ↕ structured submission / semantic review / flexible query
  ┌─────────────────────────────────────────────────────────┐
  │ dsh-research-control (state + semantics only)           │
  │                                                         │
  │ W3C aligned foundations                                │
  │   prov:Activity / Entity / Agent  ;  sosa:Observation   │
  │   sosa:Result  ;  skos:Concept  ;  World / Scope        │
  │                                                         │
  │ DSH scientific extensions                               │
  │   Finding / Assertion / EvidenceRelation / Argument     │
  │   Assessment / FactStanding / Obligation / Anomaly       │
  │                                                         │
  │ Two graph views + query                                 │
  │   Inference Graph      Research Association Graph      │
  │     ↕ Joint Recall (external LLM chooses traversals)    │
  │                                                         │
  │ Existing project/workflow management                    │
  │   Project/Topic/Workstream, Plan, Run, Gate, PlanFork   │
  └─────────────────────────────────────────────────────────┘
            ↓ events + projections (one truth)
         Git + SQLite, with optional JSON-LD/RDF exports
```

逻辑分层不意味着多数据库、独立微服务或 RDF 原生写入。**内部事件真源一个，图谱是可重建的投影**。SHACL 对一部分 RDF 结构进行校验，不能自动成为科学判真器。

## 3. 两条独立的科研知识路径

**生产与来源**：`prov:Activity`（一次实际研究、观测、分析、推导）使用数据 `prov:Entity`，可能产生 `sosa:Result` 或其他 `prov:Entity`。通过 PROV/SOSA/SSN 记录实验、传感器、程序、对象与生成关系。失败的实验仍存在于历史，不强迫伪造观测结果。

**理解与论证**：项目将结果用于支持/质疑某 `dsh:AssertionRevision`，用 `dsh:EvidenceRelation` 表达局部证据含义，用 `dsh:Argument` 组织前提、规则、适用条件和组合分析。`dsh:Assessment` 与 `dsh:FactStanding` 记录在特定研究范围内的可修正认识。

Observation 作为“结果”的旧自定义名称，在真正对应 SOSA 时**改用 `sosa:Result`**；Detection 作为“观测行动”的旧名称**改用 `sosa:Observation`**。实验/分析等具体领域活动需要时仍可有领域子类型，但基础活动名统一 `prov:Activity`。详细映射见 [W3C_ALIGNMENT](W3C_ALIGNMENT.md)。

## 4. L0/L1 渐进式语义契约

- **L0 规范化提交**：主研究 Agent 以结构化自然语言提供可溯源的对象、过程/来源、结果和**存在推理时**的推理模式。通过格式和引用检查后，提交者可继续研究。
- **L1 语义稳定**：概念、World、Scope 与来源得到足以跨 Agent 引用的确认。**共享引用不表示内容正确，也不自动拥有 Fact 身份。**
- **L2–L5** 目前只是更深入形式化、规则检查、领域证书和内核证明的候选能力划分；不把它们冻结为单一真理阶梯，也不强制所有工程结果都获得 Lean 证明。

外部专业语义 Agent 可异步处理澄清、提交候选解释；本项目只存请求状态、候选修订、确认历史和受影响引用，不负责启动或分配 Agent。

## 5. 双图谱与联合召回

| 图谱 | 表达什么 | 禁止什么 |
| --- | --- | --- |
| Inference Graph | 前提、Argument、EvidenceRelation、支持、反驳、undercut、规则要求的 ProofObligation | 未按明确规则审查就认定科学真理 |
| Research Association Graph | 实际设备/流程拓扑、数据来源、物理量相关、统计/经验关联 | 根据“有关联”推断因果、逻辑蕴涵或自动生成正式义务 |

两张图共享 Concept/World/Entity ID/Provenance；**关联图不是新的知识真源**，关系来源、时间、Scope 必须可追溯。`UPSTREAM_OF` 的方向描述装置拓扑，不能限制影响方向或反向检索。

联合召回优先设计为**灵活的只读接口**。外部 LLM 决定查哪张图、多少跳、怎样剪枝和交替，服务返回路径、来源与缺失/截断信息。`ReviewSuggestion` 只是“值得检查”；`ProofObligation` 必须来自已登记的推理规则。

## 6. 非单调认识演化

论点 `dsh:Assertion` 有稳定身份和不可变 Revision；`dsh:Argument` 保留一次确定的前提和论证结构；`dsh:Assessment` 可不断追加新评价。`dsh:FactStanding` 是项目/责任主体作出的可撤回接纳，不是 RDF 三元组天生的真理属性。

例：某工程设计确实表现出性能 P，但原物理机制 H1 被否定；只削弱 H1→P 的解释路径，**不自动撤销由独立实验证据支持的 P**。严格数学证明仍能在它原有的定义/公理下成立；现实适用性另行审查。

## 7. 平台职责与 W3C-first 约束

- 直接用 `prov:Activity`、`prov:Entity`、`prov:Agent`、`sosa:Observation`、`sosa:Result`、`skos:Concept` 等**语义等价的标准名**，不保留平行自定义基本类。
- 精确等价处用标准谓词方向，**废弃 V1 一律 `RELY_ON` 的抽象**；科学推理不用 `prov:wasDerivedFrom` 冒充。
- 只有科研专用的 Assertion、Argument、EvidenceRelation、FactStanding、WorldContext 等由 DSH 自主定义。
- 不因为 RDF 有三元组/Named Graph 就把科研假设的内容发布为被公认的客观事实。
- 工具兼容须以旧 V1 历史、权限和归档均可追溯为前提；Draft PR 没有批准任何运行时迁移。

下一步先审查 [CORE_SEMANTICS](CORE_SEMANTICS.md) 与 [W3C_ALIGNMENT](W3C_ALIGNMENT.md)，再通过 [PoC](POC_IMPLEMENTATION_PLAN.md) 验证负例与兼容性。
