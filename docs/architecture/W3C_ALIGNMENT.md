# W3C 对齐总表：复用、扩展、自主实现及冲突

> **D20：含义真正相同则采用 W3C 的名字，不保留过去自定义的同义名称。** 本文为 V3 语义 Crosswalk（讨论状态）；不冻结具体 RDF 三元组 Schema。

## 一、标准范围及精确用途

| 标准 | 采用范围 | 来源 |
| --- | --- | --- |
| PROV-O / PROV-DM | Activity、Entity、Agent，活动使用输入、生成结果、数据派生及执行者 | [PROV-O REC 2013](https://www.w3.org/TR/prov-o/) |
| SOSA / SSN | 观测活动、传感器、观测属性、被观测对象、结果 | [SOSA/SSN REC 2017](https://www.w3.org/TR/vocab-ssn-2017/) |
| SKOS | 词汇概念、首选/别名、定义与概念之间的匹配 | [SKOS REC 2009](https://www.w3.org/TR/skos-reference/) |
| RDF/OWL | W3C 兼容图表示与**明确定义范围**的逻辑语义 | [RDF](https://www.w3.org/TR/rdf11-concepts/) · [OWL](https://www.w3.org/TR/owl2-overview/) |
| SHACL | RDF 图形状与必填条件的结构校验 | [SHACL REC 2017](https://www.w3.org/TR/shacl/) |
| JSON-LD 1.1 | 不采用 RDF 原生数据库也能交换 Linked Data | [JSON-LD REC 2020](https://www.w3.org/TR/json-ld11/) |
| DCAT 3 | **确实是数据集/分发资源**时的数据目录描述 | [DCAT 3 REC 2024](https://www.w3.org/TR/vocab-dcat-3/) |
| DQV | 数据质量指标、反馈与质量评价元信息；非科学充分性定理 | [DQV W3C Note](https://www.w3.org/TR/vocab-dqv/) |
| Web Annotation | 可追溯的针对资源的审阅注释 | [Web Annotation](https://www.w3.org/TR/annotation-model/) |

非 W3C 规范，例如 QUDT 与 RO-Crate，可以另行接入，但不得声称它们是 W3C 推荐标准。标准更新必须经 Mapping Revision 审核，不自动改变历史科研语义。

## 二、完整命名与语义映射表

分类：**A 直接采用 W3C 名称**；**B 安全专门化/有条件映射**；**C 需要 DSH 科研扩展**；**D 旧用法错误必须纠正**。

| 过去名称/含义 | V3 规范名称 | 类别 | 限定 |
| --- | --- | --- | --- |
| ResearchActivity：实际发生的活动 | **`prov:Activity`** | A | 同义自定义名称废弃 |
| Experiment：具体研究实验 | `dsh:Experiment`（`prov:Activity` 子类型） | B | 研究目标与方法属于扩展；计划态不假装发生 |
| Detection：针对属性的测量/估计行为 | **`sosa:Observation`** | A/B | 只有符合 SOSA 语义才直接采用；普通文件搬运仍用 `prov:Activity` |
| Analysis：数据处理活动 | `prov:Activity`，需要时领域 `dsh:Analysis` | B | W3C 没有 `prov:Analysis` |
| 数学推导活动 | `prov:Activity` + 领域说明 | B | 活动发生≠定理已证 |
| Artifact：固定数据/文件/物件本身 | **`prov:Entity`** | A | 旧广义同义类废弃；registry entry 是另一工程对象 |
| Artifact：真正数据集 | `dcat:Dataset`／`dcat:Distribution` | B | 不覆盖所有数据文件 |
| Observation：观测所得到的结果 | **`sosa:Result`**、`sosa:hasSimpleResult` | **D→A** | 观测动作叫 `sosa:Observation`；一般分析结果不符合 SOSA 时用 `prov:Entity` |
| 旧 Observation：一般数学/软件结果 | `prov:Entity`，必要时领域 ScientificResult | B | 不滥用传感器观测类 |
| Agent：来源责任主体 | **`prov:Agent`** | A | DSH Agent 运行权限是另一层 |
| 活动使用实体 | **`prov:used`** | A | 活动→Entity |
| 数据由活动产生 | **`prov:wasGeneratedBy`** | A | Entity→Activity |
| 一个实体由另一实体派生 | **`prov:wasDerivedFrom`** | A | **数据来源，不表示数学证明** |
| 活动与执行者 | **`prov:wasAssociatedWith`** | A | 不是我们宽松关联图的关联 |
| 概念/词汇/标签 | **`skos:Concept`、`prefLabel`、`altLabel`、`definition`** | A | 概念名不同可废弃旧同义类 |
| 科学谓词签名、Lean 对应 | `dsh:PredicateSignature` 等 | C | SKOS 词汇≠形式逻辑语义 |
| WorldContext / Scope | `dsh:WorldContext` / Scope | C | RDF 可序列化；不等于 OWL 内置物理世界 |
| ResearchFinding(L0)/Assertion(L1) | `dsh:ResearchFinding`／`dsh:Assertion` | C | 科研命题作为**被提出的对象**保存，不自动作为事实三元组 |
| Evidence（局部证据关系） | `dsh:EvidenceRelation` | C | 一源一命题为基础；需要方法/背景/版本 |
| 综合论证 | `dsh:Argument` | C | 演绎/归纳/统计/溯因、Rebuttal、Undercut 等需自行定义 |
| 评估与可修正 Fact | `dsh:Assessment` / `dsh:FactStanding` | C | PROV 可以记录谁审查；不能自动判断科学真理 |
| Research Association | `dsh:ResearchAssociation` | C | 弱关联只供检索，不等同 `skos:related` 或 `prov:wasInfluencedBy` |
| ResearchQuestion/ProofObligation/Anomaly | DSH 领域类型 | C | 标准没有统一科学问题与义务生命周期 |
| Task/Gate/PlanFork/Run | V1 工作流语义 | C | 只有其来源/活动层面可与 PROV 对齐 |

**同义就直接标准化，近似就保留差异**：不应用 `owl:sameAs` 或 `owl:equivalentClass` 掩盖只有部分重合的业务概念。实际的 `skos:closeMatch` 也不是严格的科学推理等价。

## 三、旧 V1 关系需要如何处理？

| V1 Relation | 迁移优先目标 | 风险 |
| --- | --- | --- |
| `PRODUCED_BY` (Artifact→Run) | `prov:wasGeneratedBy` (Entity→Activity)，只限真实产出 | Run 与产生活动必须相符 |
| `CONSUMES` (Task/Run→Artifact) | `prov:used`，只限真正执行活动使用了资源 | “计划使用”≠实际 usage |
| `DERIVED_FROM` (Fact→Fact/Artifact) | **分拆**：数据派生 `prov:wasDerivedFrom`；科学推理 `dsh:Argument` | 不能一对一无损翻译 |
| `SUPPORTED_BY` / `CONTRADICTED_BY` | EvidenceRelation / Argument 与来源 | 科学支持不是 PROV 数据派生 |
| `VALIDATED_BY` | 项目 Gate/科学评价中的领域关系 | 验收通过不等于数据来源 |
| `RELATED_TO` | Research Association 候选边 | 不代表强因果、标准 SKOS 相关或 PROV influence |
| `DEPENDS_ON` | 仍归 Plan / Task 执行依赖 | 不直接作为证明的前提 |
| `IMPLEMENTS` / `CONTRIBUTES_TO` | V3 目标治理关系 | 无确切标准等价，保留 |

**废弃 V1 的统一 `RELY_ON` 方向解释**：标准谓词具有自己的主体与客体方向，逆向查询由检索提供。来源、论证、弱关联不得只因都是边就视作同一语义。

## 四、冲突表（必须设置负例）

| 冲突 | 错误后果 | 正确处理 |
| --- | --- | --- |
| 把旧 `dsh:Observation` 结果等同 `sosa:Observation` | 结果实体被当作观测活动 | 结果用 `sosa:Result`／`prov:Entity` |
| 把所有 Artifact registry 元数据等同 `prov:Entity` 本体 | URI、可用性、注册记录与被指资源混淆 | 区分实体资源与 RegistryEntry |
| 把 `prov:wasDerivedFrom` 当科学结论蕴涵 | 来源会被误解为证明 | DSH Argument 独立实现 |
| 把 `prov:wasInvalidatedBy` 当“Fact 被反驳” | 数据失效与科研评价混淆 | DSH FactStanding 独立状态 |
| 把 `prov:wasAssociatedWith` 用于电子枪关联四极铁 | 标准关联是 Activity↔Agent | 宽松设备关系保留 DSH |
| 把 `skos:related` 用于具体设备上游关系 | SKOS 针对概念相关 | 使用有来源的领域 `upstreamOf` |
| 因别名/检索相似使用 `owl:sameAs` | 错误合并不同模型、设备或工况 | 显式带审查状态的映射 |
| 依靠 OWL 检查缺失必填字段 | OWL 开放世界语义不支持这种闭世界推断 | SHACL / 服务端 Shape 验证 |
| 将候选“P 成立”直接发布成事实 RDF triple | 第三方推理器可能当作当前已承认真命题 | 发布 `dsh:Assertion` 身份及 statement，不直接物化物理事实 |
| 将 Named Graph 命名 `unverified` 即认为足够隔离 | RDF 图名不为所有消费者定义可信度语义 | 明确导出 Profile/数据集及推理隔离策略 |
| 由关联多跳自动得出因果或 ProofObligation | 弱关联被错误强推理 | 关联查询只返回线索及完整来源 |
| 强制失败 Experiment 有结果 | 必须伪造 Observation/Result 才能入库 | 活动状态条件约束，允许无有效结果 |

## 五、存储、校验和交换

**JSON-LD / RDF 是互操作 Profile，不是第二套科研事实真源**。内部继续 Git + SQLite / Event History。可选的 Profiles：Provenance（PROV/SOSA）、Vocabulary（SKOS）、Scientific Statement（DSH Assertion）、Argument/Epistemics（DSH）、Association-only（DSH）。每个 Profile 必须记录版本、URI 身份、迁移有无损失与校验规则。

SHACL 可以验证“引用存在、类型和字段合法”等，但**不能证明实验充分或科研结论正确**；Lean 对精确数学命题的检验也不自动证明其工程现实适用。SPARQL/RDF 数据库是否值得作为查询加速结构必须经 PoC，不能被 W3C 兼容原则提前强制采用。

## 六、迁移纪律与验收

旧 `C/F/A/REL/Run` 历史身份不可删除；旧 `FACT_RECORDED` 不能无审查自动转成新的 ACTIVE FactStanding；旧 `DERIVED_FROM` 应标记待人工或规则分流的有损关系。W3C 语义修订必须另建版本化 Mapping，不能在原事件上覆盖新含义。

关键回归：失败的 SOSA 观测没有 Result 仍合法；相同原始 CCD 数据经两版分析得到不同结果；理论证明与现实校准失败分开；关联多跳不自动产出因果；JSON-LD 往返后来源、版本、Assertion、Argument、FactStanding 和未知条件无损保存。

本文件的对象/关系映射依据 W3C 官方文档，具体 API/Schema 待 [PoC](POC_IMPLEMENTATION_PLAN.md) 后才讨论冻结。
