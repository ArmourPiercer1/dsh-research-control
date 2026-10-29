# H/S/R × 五类科研对象：统一架构设计（Draft）

> **PR #42 讨论基准；非 V1 运行时契约，也不授予 V3 实施权限。** 2026-10-27。本文优先于本 PR 早期 H/S/R 两份草案表达**最新讨论方向**；旧稿保留供溯源。

> **组合语义收口（2026-10-28）**：[组合语义合同与反例审查](H_S_R_COMPOSITION_SEMANTICS_DRAFT.md) 补齐本基线的基本运行规则；不改变五类对象/H/S/R。本轮未发现要求重新划分顶层架构的阻塞，可转入细化设计与实施准备；不表示代码已实现、正式契约已冻结或 live 已获授权。

## 1. 使命与五类基础对象

系统保存科研主体**已登记**的对象、命题、关联、论证、审查及其演化。系统不判定普遍科学真理、不臆造未记录的历史、不编排 Agent、不保证外部原始文件永久可重建。

| 层次 | 基础对象 | 语义边界 |
|---|---|---|
| 指称/定义 | **Entity** | 有独立身份的具体指称个体，可为设备、具体数据、一次活动、理想模型中的数学个体。登记不自动证明物理存在。 |
| 指称/定义 | **Concept** | 概念、术语、类型、定义、研究维度和方法 Schema 的可版本化含义。 |
| 连接 | **Association** | 某来源对关系的记录，具有来源、方向、角色及所描述的时间/语境；**没有系统管理的全局真值**。本次使用要保留适用依据，不自动成为科研证明。 |
| 连接 | **Argumentation** | 指定 Scheme、角色输入、条件和局部结局的论证对象；输入可引用五类对象，命题端精确引用 PropositionRevision；**讨论目标、实际结论内容与局部结局分开**。R-L0/R-L1 仅用于此类。 |
| 命题 | **Proposition** | 具有独立身份、稳定真值条件的命题，允许讨论 Entity、Association、Argumentation、其他 Proposition 和自身；不因自指自动获得真值规则。 |

这三层是认知作用的组织结构，**不是继承树或创建顺序**。单一命题可以没有 Argumentation；数学 Argumentation 可以没有物理 Entity；Observation 可以没有 Hypothesis。基础五类不强制一切数值、词语和查询结果实体化。

**PropositionID** 表示真值条件稳定的命题内容；100 fs 和 120 fs 若条件相同，是不同 Proposition。表达、译文、描述和不改变真值条件的修订可以有版本；改变真值条件原则上建立新 Proposition。是否实质同义并非 L1 机器自动判定。

**AssertionID** 已从对象本体移至 H：仅标识研究者维护的历史修订连续性。例如链 A 的 r1 指向 P100、r2 指向 P120，而 P100 和 P120 各有独立身份。论证/评价指向精确 PropositionRevision，不跟随链的 latest。

## 2. 三个正交系统

| 系统 | 管理什么 | 适用 | 不能承诺 |
|---|---|---|---|
| **H — History** | 事件、登记时间/声称发生时间、来源、版本、快照、回放、补记与缺失 | 全部持久对象，以及尚未能规范化的原始记录 | 未登记的过去、真实知情/心理因果、文件必可恢复 |
| **S — Semantics** | 基础类型、概念、命题内涵、World/Scope、研究配置、规范化及对齐 | 全部持久对象 | L1 等于真理、强制跨 World 同义、自然语言必被正确翻译 |
| **R — Reasoning** | 论证 Scheme、前提、局部证据、依赖、规则/证书校验、义务；评价与正式接纳的领域政策 | **R-L* 仅适用于 Argumentation**；Assessment/接纳仍作为 Proposition | 结构检查自动保证有效推理或真实科学结论 |

正交性是**职责和保证正交**，不是三套数据库。所有对象共用薄的 ObjectID/ResearchSpace/类型及版本引用协议，H 记录 S/R 事件；不建立第四个科研认识系统，也不建立万能 ResearchObject 类。

**L0/L1 的统一原则**：L0 = 可由机器解析；L1 = 满足该对象类型的基本结构、身份、角色和引用约束。R-L0 对正式论证至少要求声明合法 Scheme；R-L1 检查必要输入/结论角色。两级均不验证分类是否实质恰当、样本代表性、科学正确性或结论真值。H 可保存 L0 失败的原文，不把失败原文冒充通过门禁。独立语义确认与 L1 机器通过分离。形式化 FOL 可作为后续 S-L2 候选，允许无法/暂不形式化的命题继续科研；R 更高等级和 Lean 证书独立设计。

## 3. 五类交互与评价

- **Entity/Concept ↔ Association**：设备使用数据、文件由活动生成、设备上下游、概念词汇映射属于 Association 或具有明确来源的标准关系，不自动变成 Argumentation。
- **Association → Proposition**：一项关联可作为命题讨论对象；登记、所描述的有效时段与本次采用不是一回事；关联与命题不能形成两套全局真假状态。
- **Argumentation → Proposition**：论证命题端是精确版本；Scheme 规定输入角色及结局含义。反对 P 不把 P 当作正结论，未证 P 不等于证得 ¬P；undercut 可经关于 A 的元命题表达。
- **关于论证的高阶命题**：Q 可以声明“A1 的前提 C 未得到满足”；新的 A2 可支持 Q；不要求论证以实体作前提。
- **Assessment**：具有主体、目标（命题或论证）和 Scope 的特殊 Proposition，允许不同主体相反评价并存。
- **FactDesignation**：有授权主体对精确命题作出的正式接纳/撤销陈述；**FactStanding 是历史重建的状态投影**，不等同于 Proposition 的真假标签。
- **DecisionBasis**：主体自述“当时考虑了什么”的历史笔记，可具有 L1 语义；不自动形成真实决策因果或 R 的正式 Argument。

## 4. 不变量与 W3C 边界

1. 对象身份不复制；所有正式对象由 H/S 管理，R 的结构门禁只管理论证。
2. 事件、Proposition、Concept、World/Scope、Argumentation 的精确修订不被 latest 隐式覆盖。
3. Provenance 不等于推理；Association 不等于 Argumentation；有效形式证明不等于模型的物理适用性。
4. 不同 ResearchSpace 绝对不互读私有数据；公共受控概念词汇不能作为跨空间数据访问跳板。
5. 外部数据失踪、断链及哈希失配应如实记录，不阻断整个历史服务，不伪造替代数据。
6. 五类是**内部认知角色**，不是 W3C 类的一对一同义集合。实际研究活动沿用 prov:Activity，文件/资源沿用 prov:Entity，观测行为/结果区分 sosa:Observation/sosa:Result，概念术语使用 skos:Concept；只在含义精确等价时使用 W3C 原名。
7. 严格 R 规则检查与多主体 Assessment/FactStanding 分离；未闭合证明义务不代表不能条件性探索。

### 4.1 组合时不得无依据增加保证

- **条件与使用范围**：命题的 World/Scope、论证采用的假设、消费者本次采用政策分别记录；保留已声明的条件是基础保证，不等 S-L2/L3 才实施。
- **路径与推理**：能追踪到一条图路径不等于能按规则组合。严格演绎、统计、归纳、类比等之间没有默认的支持传递或程度值运算。
- **AND/OR**：同一路径保留其未解除前提；不同替代路径的条件不合并成全部必需，也不因路径不同就认定证据独立。
- **分歧与循环**：不同观点可并存，不把整库当作共同公理；引用环不自动变成自证。归纳/共归纳等合法递归方法由专用规则验证，不全面禁止图中循环。
- **Draft 与局部结局**：构造状态、规范化通过、研究结局、本次适用性和正式接纳独立。无定论研究或“不适用”的元论证可以完整保存；Closed Draft 不是反证或永久无效。
- **数值与语义**：不强制论证输出 `[0,1]`。使用程度值时声明尺度/逻辑体系与允许运算；不视为命题全局真值，也不平均掉冲突。
- **引用与再验证**：精确版本不自动漂移；新校验规则生成新报告，不改写过去的 PASS。缺失、未知、截断及权限不可访问不转成科学否定；形式化新增假设不得悄悄改变原命题。

这些是对象的组合语义，不要求新增对象类型。详细规则 C01–C12 与 24 类场景见[组合合同](H_S_R_COMPOSITION_SEMANTICS_DRAFT.md)。

## 5. 第一版边界与阅读顺序

第一版优先五类基本身份、H/S 记录、S-L0/L1、Argumentation R-L0/L1、基础语义引用、可回放历史及隔离；**不要求** S-L2 谓词形式化、全库去重、自动 World 等价、复杂统计证明、Graph 引擎或自动异常发现。初步实施需独立方案/测试 Gate，不因本 PR 自动批准。

详细归类：[对象映射与旧设计对账](H_S_R_OBJECT_MAPPING_DRAFT.md)；[H/S/R 系统级合同](H_S_R_SYSTEM_CONTRACTS_DRAFT.md)；[组合语义与审查](H_S_R_COMPOSITION_SEMANTICS_DRAFT.md)；[原有架构](ARCHITECTURE_BASELINE.md)、[W3C Crosswalk](W3C_ALIGNMENT.md)、[D13–D20 ADR](adr/README.md)为历史演进与具体标准依据。保留旧文档但明确其陈旧定义不可覆盖本轮新裁决。

需要字段与操作粒度时读**细化层**（不改变本文裁决）：[共同底座](H_S_R_DOMAIN_FOUNDATIONS_DRAFT.md) 给出身份/修订/引用/时间/未知与状态轴的唯一共享定义，[Entity](H_S_R_ENTITY_CONTRACT_DRAFT.md)、[Concept](H_S_R_CONCEPT_CONTRACT_DRAFT.md)、[Association](H_S_R_ASSOCIATION_CONTRACT_DRAFT.md)、[Argumentation](H_S_R_ARGUMENTATION_CONTRACT_DRAFT.md)、[Proposition](H_S_R_PROPOSITION_CONTRACT_DRAFT.md) 各定义本类专有字段与身份判据，[交互契约](H_S_R_INTERACTION_CONTRACT_DRAFT.md)、[规范化契约](H_S_R_NORMALIZATION_CONTRACT_DRAFT.md) 与[反例矩阵](H_S_R_COMPOSITION_MATRIX_DRAFT.md) 定义操作、检查与落点。本文保持简短：任何只在细化层出现的定义都不构成新的顶层裁决。

下一阶段将既定原则落实为对象最小字段/版本引用、L0/L1 检查、World/Scope 与 Scheme 契约、授权及 V1 迁移用例；这些以细化设计或 PoC 处理，不再统称为顶层未决。S-L2/L3、复杂 R 后端仍渐进引入；只有出现现有规则无法无损表达的反例，才重新提出顶层语义变更。
