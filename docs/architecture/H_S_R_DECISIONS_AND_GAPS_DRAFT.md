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

## A2. 本轮细化裁决（RD-01…，字段契约层，仍非冻结）

这些是**由既有原则直接推导**的细化裁定，用于让上层契约可接入软件工程设计；不改变顶层架构，也不属于需要用户重新讨论的顶层问题。落点见[共同底座](H_S_R_DOMAIN_FOUNDATIONS_DRAFT.md)与各对象契约。

| ID | 裁决 | 理由与影响 |
|---|---|---|
| RD-01 | `object_kind` 与 `space_id` 创建即固定且不可变；不存在 kind 迁移或跨空间迁移 | 防止“关联晋升为论证”类隐式升级（DF-04）；跨空间引用无法解析而不是被屏蔽后泄漏 |
| RD-02 | 字段存在状态固定为 `DECLARED / UNKNOWN / NOT_APPLICABLE / UNRESOLVED / ABSENT` 五态，且 `ABSENT ≠ UNKNOWN` | 使“未说明”和“说明了不知道”可分别查询；规范化无补全路径（UN-02） |
| RD-03 | 时间拆为 `recorded_at / claimed_time / described_interval / adoption_at` 四类，任何“当前”查询必须声明使用哪一类与历史截点 | C01 与迟到登记（T-02）的字段落点；杜绝 latest-write-wins 当成现状 |
| RD-04 | 生命周期、规范化、原意确认、研究结局、本次适用、主体评价、正式接纳、资源可用八条轴**互不可推导**，且缺项必须显式标注 | C03 的推广；摘要/看板省略某轴时必须声明，不得赋默认值（AX-02） |
| RD-05 | 正式声明位置（论证输入/结论/条件、评价目标、接纳目标、检查对象）**只允许精确引用**；“跟随当前”仅限浏览与非规范选择 | 落实“不被 latest 隐式覆盖”不变量（ID-05、RF-02） |
| RD-06 | 修订与新建用统一判据 G-REV：补全 `UNKNOWN → 值` 永远是修订；改变**身份构成字段**的已声明值必须新建对象 | 各对象只需列出自己的身份构成字段集，避免每类各造一套修订理论（RV-01/RV-02） |
| RD-07 | **表示（Representation）附着于 PropositionRevision，不是独立 revision，也不是第二套陈述结构**；等价性是声明者主张，`added_assumptions` 非空时禁止声明“同真值条件” | 直接关闭“重复设计第二套 Assertion 体系”的风险；形式化验证可精确到 `@rev#representation`（RP-01…RP-07、`SL1-PRO-04`） |
| RD-08 | 论证的**讨论目标**可为命题/论证/关联，而**实际结论端**必须是精确 PropositionRevision（或显式“无结论”） | 消解“关联可被命题讨论”与“结论必须是命题修订”的表面冲突（C02 字段化） |
| RD-09 | 条件的满足/解除、攻击登记、适用性判定**优先作为新记录追加**，而非覆盖式修改字段 | 使“当时认为条件如何”可回放（IC-R4/IC-R5、CS-08/CS-09） |
| RD-10 | 关联**内部字段之间**不存在冲突/矛盾/取代关系；关系间的冲突与替代是来源承载的独立主张 | 防止把“关系之间的关系”误造出第二套真值状态（Association §6.2/§6.3） |
| RD-11 | **采用记录**独立于关联本体，不写回被采用对象；采用不要求每次重新人工认证现实 | C01 的“本次使用”落点；避免多真源（AD-01…AD-04、XC-01） |
| RD-12 | Scheme **定义**归 Concept，论证实例归 Argumentation；R-L1 只检查实例是否满足其声明 Scheme 的结构要求，不检查科学充分性 | 使 R-L1 可机器实现且不成为判真器（Concept Scheme 章、`RL1-*`、NEV-02） |
| RD-13 | 概念修订分 `LEXICAL`（别名/说明）与 `SUBSTANTIVE`（含义）；词法修订不影响历史检查，实质修订只产生**定向重检提示** | 落实“新别名不使证明失效、重定义谓词/单位才触发重检”（IC-S5、XC-04） |
| RD-14 | 检查器/资源/时间不可用返回 `UNKNOWN`，**永不**折算为 FAIL 或科学否定；FAIL 只限制“进入被认证组合”与“呈现为结构合规” | 统一 `F-CHECK-UNAVAILABLE`；把 DF-07 变成可实现语义 |
| RD-15 | PROV 来源关系**只登记一次**为来源记录；“关联视图”与 W3C 导出是其派生投影，不另存一份关联 | 消除来源关系与 Association 的双真源风险（[对账表](H_S_R_OBJECT_MAPPING_DRAFT.md)对 `prov:used` 类的既有含糊） |
| RD-16 | 未登记依赖、未展开遍历、被过滤与被屏蔽范围必须作为**边界事实**呈现（截断计数、`WITHHELD` 计数、未展开节点数） | 使“没检索到/没展示”不被读成科学否定（IC-H7、IC-P5、C12） |
| RD-17 | **计算得到的概率/后验是科学结果，不是论证层面的支持度**：后验须连同模型、先验与数据范围登记为结果与命题；论证 `degree_value` 只在 Scheme 声明尺度语义时存在 | 阻止“同一个 0–1 数字既当后验又当支持度”的尺度混淆（Argumentation §8、C02） |
| RD-18 | 跨 ResearchSpace 复用只能**显式导出/导入**并在目标空间新建对象（`voice = IMPORTED`），不存在活着的跨空间引用 | 隔离不可穿透（SP-05），同时给出可实施的协作路径 |
| RD-19 | 主体身份按空间登记，接纳投影与归因查询只在单空间内有意义，不提供跨空间主体聚合 | 隔离的既定后果而非缺陷（SP-06）；避免经“某人接纳清单”反查他人空间 |
| RD-20 | H 记录、检查报告与采用记录**不是**关联端点或论证输入端点；关于它们的主张改由高阶命题承载 | 关闭“把记录升格为语义端点”造成的类别膨胀（RF-05、`RL1-02`） |
| RD-21 | V1 冻结词汇的落点单列一份对照文档，映射表只保留归属结论 | 避免同一对照内容在两处独立维护（EB1 单正源纪律） |
| RD-22 | 字段表列名按**该对象实际适用的层级**写全：四对象写 `S-L0/S-L1 要求`，Argumentation 写 `S-L1/R-L0/R-L1 要求`；全套文档禁止裸 `L0`/`L1` | 落实 N-03；防止读者把结构层级误读为旧的形式化轴（各契约 §3 表头、N-03） |
| RD-23 | Concept 允许软区 `CHANGED + 同 ID 修订`，与 Proposition「真值条件改变必新对象」（`PR-ID-4`）**不矛盾**：Concept 判据是**可声明的硬含义构成集**（签名/量词/尺度/单位/归一化/Scheme 结构），Proposition 判据是二值真值条件；两者都禁止版本倒灌 | 避免为了表面统一把概念定义压成全或无，导致每次澄清都新建对象、定义历史碎片化（Concept CO-REV-5/6、`PR-ID-4`） |
| RD-24 | 概念间 redefines/alternative **归 Association**（`SUPERSEDES_AS_STATED`），不由 H 事件或对象字段承载 | 替代是对象间有来源的主张，需要可被双向发现；H 事件只说明“何时登记了什么”（Concept CO-ID-2/CO-V-5、Association §6.3） |

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

### D1. 本轮细化后仍需 PoC 或 Schema 才能定案的具体问题

字段名与编码形式（`recorded_at` 等均为阅读名）、五态在存储与序列化中的表达、检查报告与规则版本的具体承载、`WITHHELD` 计数在不泄漏存在性前提下的可查询形式、定向重检提示的触发与规模（大量引用时的可用性）、Scheme 声明的机器可读表达（角色/基数/结局词表/尺度运算）、采用记录与授权策略的注册形式、`path_id/condition_id` 稳定性在修订与合并场景下的实现约束、跨空间引用的负例回归集合、以及把 CS-01–CS-24 与 XC-01–XC-12 转为可执行用例。**这些是实施准备工作，不需要新的顶层裁决。**

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

1. [最新五类核心](H_S_R_FIVE_OBJECT_ARCHITECTURE_DRAFT.md)及[对象对账](H_S_R_OBJECT_MAPPING_DRAFT.md)；[系统级合同](H_S_R_SYSTEM_CONTRACTS_DRAFT.md)；[组合合同 C01–C12](H_S_R_COMPOSITION_SEMANTICS_DRAFT.md)。
2. 需要字段与操作级别设计时：[共同底座](H_S_R_DOMAIN_FOUNDATIONS_DRAFT.md) → 对应对象契约 → [交互契约](H_S_R_INTERACTION_CONTRACT_DRAFT.md) → [规范化契约](H_S_R_NORMALIZATION_CONTRACT_DRAFT.md) → [反例矩阵](H_S_R_COMPOSITION_MATRIX_DRAFT.md)。
3. [既有系统级审查稿](H_S_R_SYSTEM_DESIGN_DRAFT.md)：保留早期覆盖矩阵和原始问题编号，但其“旧 Assertion/旧 S-L1”表述不再优先。
4. [早期架构基线](ARCHITECTURE_BASELINE.md)、[核心语义](CORE_SEMANTICS.md)、[W3C Crosswalk](W3C_ALIGNMENT.md)、[开放问题](OPEN_DESIGN_QUESTIONS.md)、[D13–D20 ADR](adr/README.md)。
5. [PoC 素材](../poc/gates/POC-COMPLETION-REVIEW.md)及[PR #33 实施契约草案](V3_IMPLEMENTATION_CONTRACT-DRAFT.md)：结论仍 ITERATE；机械 173/173、构造 7/7 不证明新五类架构已实证。

**本轮验证边界**：细化层内容是设计走查与可测试性要求，**未编写或运行** validator、Schema、PoC 或真实科研任务；文档一致性检查仅覆盖仓库静态一致性（链接、索引、归属），不验证领域语义的正确性。CS-01–CS-24 与 XC-01–XC-12 是未来测试预期，不是通过证据。

**后续目标**：结束无界顶层扩张，依据既定语义、C01–C12 与本层字段/操作/检查契约开展 Schema、事件与查询协议、Scheme 注册及授权策略的细化设计与分阶段实施准备；F-01–F-09 与 D1 清单按分工落实。仅当出现无法用现有类别/合同无损表达的新反例时，才重新升级为顶层裁决。当前仍为 Draft，不自动改写 V1 Current 或解锁 LIVE_*。
