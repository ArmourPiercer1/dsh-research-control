# 五类对象：已有设计对象归属与迁移对账

> **PR #42，Draft、非 Schema。** 与[新核心架构](H_S_R_FIVE_OBJECT_ARCHITECTURE_DRAFT.md)配套。归属判据：特定个体/活动/数据→Entity；定义和类型→Concept；非论证性关系→Association；有 Scheme 的证据/推理/反驳→Argumentation；具有真值条件的命题或主体评价→Proposition。**“确定”表示用户已同意的方向，“建议”表示基于当前语义的候选映射，需后续细化，不应推定已获实施批准。**

## 一、实体与历史记录

| 既有对象/机制 | 五类位置 | 规则及状态 |
|---|---|---|
| 真实设备、条纹相机、四极磁铁、CCD | Entity | 确定：具有独立指称身份；登记不证明现实中存在 |
| 数学个体、指定辛映射、理想化设备个体 | Entity | 确定：个体的存在范围由 WorldContext 限定 |
| GDF/CSV、原始和处理数据、网格/模型/仿真输入文件、日志、程序 | Entity | 确定：符合 PROV 的资源语义时映射 prov:Entity |
| 具体仿真配置、具体 ModelVersion、波形 W1/W2 | Entity | 建议：模型类别、波形类别另外属于 Concept |
| 已发生实验、Analysis、Run、DerivationActivity | Entity（活动个体） | 建议的内部分类；**对外依然精确映射 prov:Activity，而非 prov:Entity**；计划未执行不等于活动已发生 |
| sosa:Observation | Entity（观测活动） | 确定：须确实是观测行为，不能当成结果 |
| sosa:Result、普通数值计算输出 | Entity（结果资源）或简单值 | 确定：仅适用 SOSA 时用 Result；数值不必都对象化 |
| 来源主体/研究人员/软件 Agent | Entity | prov:Agent 是来源主体身份；不自动包含接纳权限 |
| Artifact、数据集/Distribution | Entity | 数据集才允许 DCAT 专门化；RegistryEntry/URI 与本体分离 |
| 资源注册条目、外部可用性检查报告 | Entity（需独立引用时）或 H 登记/属性 | 建议：缺失、哈希不符不抹去资源历史 |
| HistoryEvent/Provenance envelope、SourceRef、RevisionID、SnapshotID | **不强制五类对象化** | 确定：H 的记录/标识/视图基础；不为每个事件递归生成对象 |
| AssertionID / AssertionChain | **H 的历史连续性标识，不是第六基础对象** | 确定：链可以先后指向不同 PropositionID |
| DecisionBasis | Proposition（关于决策所据的主观自述）及 H 事件 | 确定边界：仅复盘主观声明，不成为正式推理依赖 |
| V1 Project/Topic/Workstream/Plan/Task/Gate/PlanFork | 原 V1 控制面，必要时指称为 Entity | 确定：不因为五类新本体改写原业务契约 |

## 二、概念与研究语义

| 既有对象/机制 | 五类位置 | 规则及状态 |
|---|---|---|
| skos:Concept、发射度、时间分辨率、术语定义 | Concept | 确定：版本化定义、名称、别名及可归因映射；SKOS 不等于公式签名 |
| WorldType、理论/仿真/现实世界类别 | Concept | 确定：开放类型，非三值封闭枚举及信任阶梯 |
| 具体 WorldContext / 指定 ResearchScope | Entity（具体语境/范围个体）；抽象 WorldType 归 Concept | **已细化**：命题用 `world_ref` 指向 Concept@rev（世界类别）**或** Entity@rev（具体语境个体），二者择一且必须精确；“是否对象化”由“是否需被多个记录独立引用、是否有独立来源与修订”决定，不新建第六类（见[Proposition 契约](H_S_R_PROPOSITION_CONTRACT_DRAFT.md) §2.2 与[Entity 契约](H_S_R_ENTITY_CONTRACT_DRAFT.md)） |
| Representation、坐标系定义、单位与谓词签名 | Concept | 建议：具体使用实例/配置归 Entity 或属性 |
| ResearchFrame、ResearchDimension/Option、约束定义 | Concept | 确定按维度/选项组织，具体模板归属建议 |
| ContextProfile、模型/波形/物理效应的具体选择 | Entity + Association 选项关系 | 建议；Frame 新增维度不改写旧 Profile |
| InferenceScheme/推理规则定义、Critical Question 模板 | Concept | 建议；具体一次运行规则的 Argumentation 则另有身份 |
| ResearchFinding 原文或 L0 原始科研提交 | Entity（原始材料）或 H 原始记录 | 建议：抽取出的候选命题单独成为 Proposition |
| Hypothesis、Theorem、Conjecture、EngineeringClaim | Proposition | 建议：声明类型不意味着自动获证或正式接纳 |
| 原 Statement、dsh:Assertion 和 AssertionRevision | **Proposition + H AssertionChain** | 新裁决优先于旧稿；不同真值条件不同 PropositionID，论证引用精确版本 |
| 自然语言、FOL/Lean 公式、带类型谓词表达 | Proposition 的**表示**或独立形式化工件 Entity | 形式公式不是命题身份，不因类型检查通过就保证翻译忠实 |
| SemanticAlignment/ContextMapping/Concept closeMatch | Association（对应声明）；可另立元 Proposition | 映射存在不代表已证明跨世界或逻辑等价 |
| SemanticConfirmation | 有主体的 Proposition 或 H 确认事件 | **候选承载形式**，必须与机器 S-L1 分离 |

## 三、非论证关联

| 原语义 | 五类位置 | 关键禁止项 |
|---|---|---|
| prov:used / wasGeneratedBy / wasDerivedFrom | Association，或有来源的明确关系记录 | 不能当数学推导；保留标准主客方向 |
| prov:wasAssociatedWith、sosa:hasResult | Association / 角色属性 | 不能泛化成所有设备“相关” |
| UPSTREAM_OF、CORRELATED_WITH、RELATED_TO | Association | 相关不自动推出物理因果；方向不限制逆向检索 |
| 配置选择、实体引用、概念映射、版本间说明 | Association | 选用某模型不表示相信模型物理上正确 |
| V1 PRODUCED_BY、CONSUMES、DERIVED_FROM 等 | 按真实语义分流 | V1 DERIVED_FROM 可指来源或论证，不许无损强译 |

## 四、论证、评价和验证

| 既有对象/机制 | 五类位置 | 规则及状态 |
|---|---|---|
| EvidenceRelation、Evidence 对 P 的局部支持/反对 | **Argumentation** 的证据子型 | 确定：有精确 Proposition 结论，证据本体仍为 Entity |
| Argument / ArgumentRevision、AND/OR 支持路径 | **Argumentation** | 确定：Scheme 决定输入角色、输出为精确 PropositionRevision |
| 演绎、归纳、统计、溯因、类比、因果、默认/可废止、实践推理实例 | **Argumentation** | 已同意方法多轴分类；细则待定 |
| Rebuttal、Undercut | **Argumentation**，可创建关于目标论证的元 Proposition | 确定：攻击目标论证不自动否定其结论 |
| Assessment、AnomalyAssessment、语义/方法审查结论 | **Proposition**（主体评价性命题） | 确定：目标可为 Proposition 或 Argumentation，评价者和 Scope 可追溯 |
| FactDesignation、接纳/暂停/撤回声明 | **Proposition**（授权的正式接纳声明） | 确定：不得因他人普通叙述就改变权威状态 |
| FactStanding | **不作为独立核心对象**，是状态投影 | 确定：按主体、Scope、目标和时间回放；非真值 |
| ProofObligation | Proposition（关于必要条件的规范性声明）及关联的义务记录 | **建议**：具体审查生命周期仍待定，不能自动当事实 |
| FormalProofCertificate、验证报告 | Entity（可引用验证工件） | 建议：Lean 的证明仅覆盖给定公式/公理，不证现实适用 |
| R-L0/L1、VerificationStatus、LogicalForce、EvidencePolarity | Argumentation 的属性/机器检查结果 | 不作为第六类；四轴正交，机器检查≠科学保证 |
| 旧 FACT_RECORDED、C/F 标签 | H 旧事件，可能提取候选 Proposition | 绝不自动成为有效的 FactDesignation |

## 五、高级能力与尚未确定的对象

| 名称 | 归属 | 第一版边界 |
|---|---|---|
| Research Association Graph / Inference Graph | **Association/Argumentation 的可重建视图** | 基本关系是基础；图引擎和跨图联合检索可后置 |
| Anomaly | Entity（独立调查案件）或针对异常的 Proposition | **建议**，自动发现不属于第一版必需能力 |
| ResearchQuestion、ResearchRoute | Entity（提问/路线条目），内部命题另立 Proposition | **建议**：问句本身不强迫有真值 |
| Frontier | 开放问题及义务的派生查询视图 | 不自动调度科研 Agent |
| ReviewSuggestion | Entity（独立建议）或 Proposition（“应审查 X”） | 不自动提升为 ProofObligation |
| ContextCompiler、联合召回、图可视化 | 服务/投影，不是独立科研认识基类 | 能提供引用和缺失范围即可 |
| ResearchSpace | **横切的隔离/访问命名空间** | 与 Project/Topic/Workstream 不同，不允许跨空间数据互读 |

## 六、W3C 兼容与未裁风险五类**内部**分类绝不重新定义 W3C 概念：实际活动仍然是 prov:Activity；资源仍是 prov:Entity；观测活动和结果严格区分 sosa:Observation 与 sosa:Result；词汇同义处采用 skos:Concept。PROV 连接是来源/生产 Association，不是 Argumentation。RDF/SHACL/JSON-LD 作为交换和局部结构检查，不负责科学真理或跨空间 ACL。

待裁映射重点：活动类型、World/Scope 的具体对象化、ProofObligation 的形态、ResearchQuestion 及 Anomaly 的对象化、关于对象的命题与 Association 的精确对应、外部旧类型转换的 lossReport。**“映射推荐”不等于已通过测试或签署的实现契约。**

V1 冻结词汇（关系类型、事件类型、Run/Gate/PlanFork 等）与新层的逐项落点、禁止事项与有损报告要求，见[与 V1 冻结词汇的接入对照](H_S_R_V1_LEXICON_RECONCILIATION_DRAFT.md)；本表只保留归属结论，不重复词汇对照内容。
