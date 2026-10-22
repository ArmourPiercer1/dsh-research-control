# 核心领域语义：活动、结果、论证与认识修正

> 状态：V3 上层语义候选。W3C 含义等价时强制使用 W3C 正式名称；不冻结数据表和接口。

## 1. 科研系统的最小问题

谁研究了什么对象？如何采集或处理数据？得到了什么结果？为什么认为这些结果支持某项论点？哪些推理缺条件？新材料出现后如何修正认知？

**通用语义和我们的领域扩展必须清晰分离**：

| 角色 | 正式语义 | 解释 |
| --- | --- | --- |
| 实际研究活动 | `prov:Activity` | 实验、分析、推导、仿真可以有领域子类型 |
| 具有固定身份的物体或信息 | `prov:Entity` | 原始/处理文件、数据、模型文档、部分物理设施 |
| 实际负责人 | `prov:Agent` | 人、团队或软件 Agent 作为来源主体；不等于运行时权限模型 |
| 对特征属性进行观察/估计的活动 | `sosa:Observation` | 旧“Detection”在语义相同情形下弃用 |
| 观察得到的结果 | `sosa:Result` / `sosa:hasSimpleResult` | 旧“Observation 表示结果”改用 SOSA 名称 |
| 概念定义与术语 | `skos:Concept` | 名称、同义词、定义、概念映射 |
| 数据集、分发资源 | `dcat:Dataset` / `dcat:Distribution` | 仅数据集领域适用，不覆盖所有 `prov:Entity` |

### 1.1 仍要有科研领域子类型

`dsh:Experiment`（研究目的和工况的实际实验）、`dsh:Analysis`（数据处理）、`dsh:DerivationActivity`（理论推导）可以在确切情况下作为 `prov:Activity` 的专门类型。

**计划中的实验不必等于已发生的 `prov:Activity`**。当前 V1 `Run` 的执行绑定/状态不会无损变成 `prov:Activity`；活动语义可对齐，运行治理仍保留。

不是所有计算结果都属于 `sosa:Result`：只有符合 SOSA 观测结果定义才用它；其他科学计算、证明输出使用 `prov:Entity` 加相应领域说明。采集失败可以有 Activity 和错误日志但无可用 `sosa:Result`。简单数值也不必强制先变成独立的文件 Artifact。

### 1.2 来源关系直接采用标准

`prov:used`：Activity 使用 Entity。`prov:wasGeneratedBy`：Entity 由 Activity 生成。`prov:wasDerivedFrom`：数据实体来源于另一个实体。`prov:wasAssociatedWith`：Activity 关联执行/负责 Agent。

**这些关系记录的是生产与来源，不表达科学逻辑蕴涵或物理因果证明。** 绝不能把 `prov:wasDerivedFrom` 直接用作数学证明的 `DERIVED_FROM`。

## 2. 需要自主定义的科研语义

| 科研类型 | 含义 | 来源/关系 |
| --- | --- | --- |
| `dsh:ResearchFinding` | L0 规范化自然语言科研提交；原文和来源不可变 | 有 `prov:Entity` 来源；不是直接承认科研陈述真实 |
| `dsh:Assertion` / Revision | 关于明确 World/Scope 的科研命题及准确版本 | 跨 Agent L1 语义确认后成为稳定引用 |
| `dsh:EvidenceRelation` | 在特定条件下，观测结果对一个 AssertionRevision 的局部证据含义 | 默认一个结果对一个命题，可有支持/反对/未决等倾向 |
| `dsh:Argument` / Revision | 多项前提、若干证据、明确推理模式和条件共同支持/质疑目标命题 | 严格或可废止；不能靠单点证据评分自动合成 |
| `dsh:Assessment` | 谁在什么范围、依据什么，怎样评价命题、证据或论证 | 追加事件并保留分歧 |
| `dsh:FactStanding` | 项目在特定范围对某命题的正式接纳 | ACTIVE/SUSPENDED 等是可撤回科研判断，非真值保证 |
| `dsh:WorldContext` / Scope | 数学模型、计算配置、物理装置语境及适用条件 | 可注册开放类型、明确版本；不是 OWL 已有“世界” |
| `dsh:ProofObligation` | 已登记推理规则要求、尚待满足的条件 | 可 OPEN，允许有标注的条件性探索 |
| `dsh:ResearchQuestion` / Anomaly | 待解问题、解释失配、未解释观测 | 不等于执行 Task，也不自动判定谁对谁错 |

`Experiment` 不应强制在创建时产生结果；同一 `prov:Entity` 经过两种 `dsh:Analysis` 可得到不同结果，原数据仍保持独立身份。

## 3. EvidenceRelation ≠ Argument

**局部 EvidenceRelation** 记录“结果 R 在背景 C 下如何与论点 P 相关”。不将它定义为无条件后验概率；因 `P(P|R,C)` 依赖先验/模型与背景。证据倾向可为 SUPPORTS、REBUTS、NEUTRAL、UNRESOLVED；置信度/似然比只有在实际统计模型充分定义后才能存为有方法的评价。

**整体 Argument** 记录“多个前提/结果怎样经演绎、归纳、统计、溯因、类比、因果或默认规则得到 P”。联合分析可能使两项单独不足以支持比较命题的结果合起来具有支持意义，故 Argument 不应只能把独立 Evidence 概率相加。

ArgumentRevision 保留历史前提、结论、推理规则；新结果只触发影响分析与新 Assessment；实质性改写规则/前提必须新建 Revision。

## 4. 推理图和关联图

**Inference Graph** 保存 Argument、EvidenceRelation、Assertion、攻击结论的 Rebuttal、削弱推理的 Undercut 以及已登记 ProofObligation。其结构可以是超边/带身份的关系实体，而非单纯 RDF 二元三元组。

**Research Association Graph** 保存物理对象、仪器、上游设施、数据、程序、统计和经验联想的关联。它问“看到它还应该想到谁”，不问“什么已经得到证明”。含方向的 UPSTREAM_OF 只描述设施关系，不限制影响只能单向、也不证明因果；统计 CORRELATED_WITH 不具有自动传递律。

二图共享实体/概念/World/Scope/来源历史。可以从真实 PROV 来源边派生检索关系，但**关联召回不能无审查生成 Argument 或 ProofObligation**。结果必须说明路径和来源；没检索到信息不意味着科研充分。

## 5. 可靠性、形式化和动态 Fact

- **Semantic Validity**：L0 通过结构化提交便可由原 Agent 继续；L1 术语和身份确认后在项目内可共享，仍可能错误。
- **Inferential Validity**：明确的 Argument 和推理规则可被局部检查；严格数学子图可以依赖 Lean 证明精确形式命题。L2–L5 深度未冻结。
- **Evidential Adequacy**：实验设计、校准、混杂因素、共同数据错误、统计支持力度是科研审查问题，不由通用机器作完备判断。

例：物理性能 P 有独立实验论证 E1 和理论机理论证 H1。发现 H1 错误后，只有依赖 H1 的 Argument 受影响；E1 如果不依赖 H1，P 仍可能获正式 Fact 接纳。反之如果 E1 的反演需要 H1，也必须审查这一路径。

旧 `Fact` 不再是“永远 ACTIVE”的单独科研命题实体；`FactStanding` 表达研究团队曾经及目前的接纳决策，可增强、退化、暂停、撤销，历史不可抹除。

## 6. 研究问题与工作流边界

`dsh:ResearchQuestion` / `ResearchRoute` 描述未知问题及候选方法；`dsh:Anomaly` 描述冲突、失败解释或意外成功；`Frontier` 派生值得复查的知识缺口。`Plan/Task/Gate/Run/PlanFork` 属于现有工作流程或治理，不自动从候选科学论点推出计划修改。`dsh-research-control` 只提供可查询状态，**绝不分派或唤醒科研 Agent**。

进一步检查名称、数据关系与 RDF 导出风险见 [W3C_ALIGNMENT](W3C_ALIGNMENT.md)。
