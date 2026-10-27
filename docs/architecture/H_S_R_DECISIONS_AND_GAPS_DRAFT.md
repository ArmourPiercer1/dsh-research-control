# 设计裁决、未决问题与历史设计对账

> **PR #42 Draft · 非 ADR、非实施批准。** 此文将之前各轮设计区分为“已获方向性同意”“根据已同意原则提出的归类推荐”“仍待正式裁决”。旧文档保持存在，不能因为纳入本汇总便自动获得同意。

## A. 已形成的方向性共识（包括最新五类决策）

| 领域 | 当前共识 |
|---|---|
| 使命 | 记录、解释、检查研究者已登记的知识演化与依据，不裁决普遍科学真理，不编排 Agent |
| 正交系统 | H 历史、S 语义、R 论证及检验三套职责，共享统一对象身份与事件真源 |
| 对象基础 | Entity、Concept、Association、Argumentation、Proposition 五类；H/S 面向全部对象，R-L* 只面向 Argumentation |
| 关系边界 | Association 不等于 Argumentation；PROV 来源不等于逻辑蕴涵；推理结论必须是精确 PropositionRevision |
| 高阶语义 | Proposition 可讨论其他 Proposition、Argumentation、Association；允许递归，但不自带无约束自指真值机制 |
| 命题身份 | PropositionID 的真值条件稳定；不同内容建新 Proposition；AssertionID 退为 H 的历史修订链标识，不成为第六基础类 |
| 人的认识 | Assessment、FactDesignation 是特殊 Proposition，可针对命题/论证；FactStanding 是主体和 Scope 有别的派生状态 |
| S/R 分级 | 两套规范化门：L0 Parseable、L1 Well-formed，均机器检查；R-L0 要求合法 Scheme 类型声明、R-L1 验证输入角色；独立审查不等于 L1 |
| 形式化 | 类型化 FOL 为 Proposition 默认优先的更深形式表达；允许例外/部分形式化，不作为 S-L0/L1 前提；R 后续验证按方法区分 |
| 研究配置 | 采用“研究维度及其可选项”，不要求所有命题对所有核心对象全局接受/拒绝 |
| 可靠性 | 语义稳定、推理有效、科学证据充分性独立；不能由一种检验推导另一种真实性 |
| 历史 | 追加记录/回放，登记时间与声称发生时间分离；数据失踪、未知和重建失败不阻断整个服务 |
| 隔离 | 不同 ResearchSpace 严禁相互访问；Project/Topic/Workstream 只是组织维度，公共词汇不可穿透私有数据 |
| W3C | 同义采用正式 PROV、SOSA、SKOS 名称；内部五类划分不替换标准 Class 的固有定义 |
| 双图 | 推理依赖与关联有不同语义，可形成两个可重建的视图；多跳查询/图数据库/异常发现是高级能力 |

## B. 本次文档归类的推荐推断（尚非冻结）

| 推荐 | 为什么合理 | 尚需确认 |
|---|---|---|
| 内部 Entity 包括具体 Activity 个体，但对外映射 prov:Activity | “有独立指称身份”比“物理存在”更普适 | 具体活动/资源分型与对象继承 |
| WorldContext 的具体配置可归 Entity，WorldType 归 Concept | 区分定义与具体实例 | World/Scope 对象化边界及引用契约 |
| ResearchFrame/Dimension/Option 归 Concept，ContextProfile 归具体 Entity | 模板与选项实例可区分 | 局部覆盖、互斥与 UNKNOWN |
| ResearchFinding 原始材料为 Entity，提取命题为 Proposition | 原文与解释不互相污染 | L0 对未解析文本的接纳结构 |
| ProofObligation 可表达为规范性 Proposition 与义务记录 | 避免新第六类对象 | 义务状态、规则触发与可引用身份 |
| Anomaly、ResearchQuestion、ResearchRoute 可作为独立 Entity 案件/问题/路线 | 非命题问题与任务不强制有真值 | 高级层分类和独立生命周期 |
| SemanticConfirmation 可以使用有主体的元 Proposition 或 H 事件 | 机器 L1 与主观原意确认分离 | 正式记录/签名/授权细节 |

## C. 第一版进入实施前必须回答的基本问题

| ID | 未决问题 | 最小必要裁决/负例 |
|---|---|---|
| F-01 | ObjectID、RevisionID、AssertionChain 的统一身份与修订边界 | 100→120 fs、同义改写、设备改名、两个主体同时讨论 P |
| F-02 | 五类对象何时独立对象化、是否允许多类型及何种可扩展子型 | 简单 120 fs 字面量、数据文件、一个活动、元命题 |
| F-03 | S-L0/L1、R-L0/L1 各自可机械检查的字段角色 | 允许 UNKNOWN、无 Scheme 的推理草稿、未解析外部文件 |
| F-04 | WorldContext、Scope、ResearchFrame、ContextProfile 的最小版本/引用协议 | 同一测量不同波形、研究框架新增维度、模型跨 World |
| F-05 | 原意确认、形式表示/翻译对应与机器 L1 独立状态 | 误用发射度定义、FOL 公式只部分覆盖原文 |
| F-06 | R 证据关系/组合推理的 Scheme 注册与输入合法性 | 纯数学无实体前提、统计使用一组共享来源样本 |
| F-07 | FactDesignation 有权主体、权限与不同人的评价并存 | 乙提交“甲接受 P”，不得修改甲的 FactStanding |
| F-08 | 统一事件、资源缺失、迟到登记、V1 Crosswalk lossReport | T3 补录 T1、删 GDF、旧 FACT_RECORDED、RUNS_STARTED 一对多 |
| F-09 | 内部五类与 W3C 精确输出 Crosswalk | 内部活动对象绝不误导出 prov:Entity；来源不当证据 |

## D. 可以明确延后的问题

S-L2 的精确语言/签名及可靠去重算法、World 严格等价证明、Lean 正式后端、跨 Scheme 统一概率尺度、ATMS/Carneades/ASPIC+ 规则引擎、完整 ResearchFrame 覆盖服务、异常发现与双图联合召回、复杂图数据库及可视化、Agent 主动建议、长期任务编排。延期前提是第一版**保留精确对象身份、版本及外部扩展引用能力**。

## E. 旧文件与新裁决发生差异时

| 旧文档中的说法 | 最新方向的处理 |
|---|---|
| Assertion 是核心科学对象；AssertionRevision 直接承担变化的命题内容 | Assertion 是 H 的历史链标识；Proposition 有独立稳定身份及 Revision |
| L1 必须由 actor 人工确认才能称为机器规范化通过 | S-L1/R-L1 仅机器 Well-formed；主体 SemanticConfirmation 独立登记 |
| 一条统一 L0–L5 是语义与形式化成熟度轴 | S 与 R 分离；L0/L1 分别定义；更高层多维能力不冻结 |
| EvidenceRelation 与 Argument 是不能归到一个基础类型的并列大对象 | 两者为 Argumentation 的不同论证子型；仍保持局部证据和组合论证的语义区别 |
| Assessment/FactStanding 是脱离五类的独立基础类 | Assessment 和 FactDesignation 是 Proposition 子型；FactStanding 为状态投影 |
| 两张图就是基础存储/事实真源 | Association 与 Argumentation 是基础；图为派生视图/可选查询实现 |
| Theory/Simulation/Engineering 是封闭 World 枚举或可靠性高低顺序 | D13 已禁止此推断，类型开放 |
| RDF/OWL/SHACL/Lean 核验通过便具科学充分性 | D18/W3C 禁止这样晋升；检验范围须明示 |

## F. 文档与证据读序

1. [最新五类核心](H_S_R_FIVE_OBJECT_ARCHITECTURE_DRAFT.md)及[对象对账](H_S_R_OBJECT_MAPPING_DRAFT.md)；[系统级合同](H_S_R_SYSTEM_CONTRACTS_DRAFT.md)。
2. [既有系统级审查稿](H_S_R_SYSTEM_DESIGN_DRAFT.md)：保留早期覆盖矩阵和原始问题编号，但其“旧 Assertion/旧 S-L1”表述不再优先。
3. [早期架构基线](ARCHITECTURE_BASELINE.md)、[核心语义](CORE_SEMANTICS.md)、[W3C Crosswalk](W3C_ALIGNMENT.md)、[开放问题](OPEN_DESIGN_QUESTIONS.md)、[D13–D20 ADR](adr/README.md)。
4. [PoC 素材](../poc/gates/POC-COMPLETION-REVIEW.md)及[PR #33 实施契约草案](V3_IMPLEMENTATION_CONTRACT-DRAFT.md)：结论仍 ITERATE；机械 173/173、构造 7/7 不证明新五类架构已实证。

**后续目标**：在本 PR 文档集上逐项关闭 F-01–F-09，另行创建实施计划及 PoC，严禁把此处的 Draft 一步升格为 V1 Current 或 LIVE_*。
