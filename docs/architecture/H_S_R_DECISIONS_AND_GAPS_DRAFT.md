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

### A1. 本轮新增共识与组合推论

- Association 是有来源的关系记录，不具有系统全局真值；记录时间、所描述时间与本次使用依据分离。
- Argumentation 局部结局不等于命题全局真值；不强制 `[0,1]`，数值解释/组合必须有声明的尺度与规则。
- Draft/Closed Draft 是构造状态，不替代完成的无定论结果、适用性争议或正常的元论证；不同状态维度不得互推。
- 组合必须精确对齐输入、保留已声明条件及共同来源，禁止因图路径、摘要或形式化无依据增加保证。
- AND/OR 分离、循环引用不自动自证、分歧不自动合并为公理、版本化重检与缺失范围透明，是上述原则的组合推论；具体 Schema/算法未冻结。

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

## C. 实施准备事项与验证责任清单（不再作为九项顶层阻塞）

**2026-10-28 组合审查结论**：在既定职责范围内未发现要求新增基础对象、第四系统或推翻身份原则的顶层反例。[组合合同](H_S_R_COMPOSITION_SEMANTICS_DRAFT.md) 已提供 C01–C12 及 24 类走查场景；未承诺所有科研场景完备或实现已验证。F-01–F-09 保留编号便于追踪，但分别进入“原则继承、细化设计、实现/PoC 验证”，**不要求用户重新讨论全部九项**。


| ID | 事项与已有原则 | 下一阶段工作性质 | 必要反例/依据 |
|---|---|---|---|
| F-01 | 统一 ObjectID；Proposition 内涵稳定、Assertion 为历史链已定 | 精确引用/版本协议细化与测试 | 100→120 fs、设备改名、版本重检 |
| F-02 | 五类与按需对象化已定，不建立万能对象类 | 子型/最小字段设计 | 数值、活动、文件载体与命题内容 |
| F-03 | S/R-L0/L1 均为机器门禁，独立于审查/接纳已定 | 五类 Schema、Scheme 角色校验及负例 | UNKNOWN、缺少数据、完整但有争议论证 |
| F-04 | 命题范围、论证条件、本次使用分离；维度/选项原则已定 | World/Scope/Profile 最小表示与局部对齐 | 新波形、跨 World、AND/OR 条件保留 |
| F-05 | 原意确认与 L1 独立；公式不自动忠实表达已定 | 对应记录细化；高阶形式化 PoC 可后置 | 新增假设改变真值条件、错误指标定义 |
| F-06 | 论证目标/结局区分、路径非默认推理、多轴 Scheme 已定 | 最小注册/组合许可及检查实现 | 无物理实体数学前提、共享来源、循环论证 |
| F-07 | 主体评价并存、普通转述不授予接纳权已定 | 授权/状态投影政策与测试 | 乙声称甲接纳、相反分支不得全局合并 |
| F-08 | 追加历史、双时间、资源缺失透明已定 | 事件与查询、V1 只读迁移 PoC | 迟到登记、布局变更缺日志、文件删除 |
| F-09 | 内部五类不改写 W3C 固有语义已定 | 版本化 Crosswalk 与交换回归 | 活动不误导出 prov:Entity、来源不当证明 |

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

**后续目标**：结束无界顶层扩张，依据既定语义与组合合同开展五类最小契约、L0/L1、事件/查询、Scheme 和授权的细化设计与分阶段实施准备；F-01–F-09 按上表分工落实。仅当出现无法用现有类别/合同无损表达的新反例时，才重新升级为顶层裁决。当前仍为 Draft，不自动改写 V1 Current 或解锁 LIVE_*。
