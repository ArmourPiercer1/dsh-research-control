# Concept 领域对象契约

> **PR #42 · DRAFT-PROPOSAL · 2026-10-28。** 细化[五类主基线](H_S_R_FIVE_OBJECT_ARCHITECTURE_DRAFT.md) §1/§3 与[组合合同 C02/C05/C11](H_S_R_COMPOSITION_SEMANTICS_DRAFT.md)。**共享约定（身份、引用、时间、五态、状态轴、修订判据）只在[共同底座](H_S_R_DOMAIN_FOUNDATIONS_DRAFT.md)定义**，本文只定义 Concept 专有内容。字段名是领域阅读名（N-01）。**Proposed，不表示已实施或已冻结。**

## 1. 语义定义与边界

**Concept** 是概念、定义、类型、符号、术语及**规则**的**可版本化含义**。它回答“这个术语/类型/尺度/方法定义是什么含义、是哪个版本”，不回答“该含义下的个体是否存在”“谁主张它”“该论证是否有效”。**Scheme 定义（InferenceSchemeDefinition 等方法定义）归 Concept；论证实例归 Argumentation**（RD-12）。WorldType 归 Concept；具体 WorldContext 个体归 Entity（对象化条件未冻结，见 §8）。

| 用途 | 不属于 Concept 的典型情形 | 该情形应登记为 |
| --- | --- | --- |
| 术语、定义、类型、符号、指标、单位、方法定义的含义版本化登记 | 具体设备个体、某次仿真运行、文件、具体 WorldContext 个体 | Entity |
| 声明论证所用的方法定义（角色、条件、目标、结局、尺度） | 一次具体论证（某次使用前提、条件与方法） | Argumentation（论证实例） |
| 声明合法关系类型、研究维度/选项、研究框架定义 | 某概念与另一概念的对应/映射声明 | Association（可另立元 Proposition） |
| 为命题提供所用概念版本（指标版本、单位、谓词签名） | 把概念用作论证输入（角色绑定） | Argumentation 输入角色（`INFERENTIAL` 引用） |
| 登记版本化采纳政策与关键问题模板 | 一次概念修订事件、一次定向重检提示事件 | H 记录（ID-08） |
| 词汇、别名、上位关系、标准词汇对应的版本化登记 | “120 fs”这个数值本身 | 其它对象的属性值或 Entity（不必对象化） |

**登记 ≠ 使用 ≠ 支持 ≠ 接纳 ≠ 为真**（DF-01）：Concept 的版本化登记不保证定义科学正确，也不保证被任何主体采纳。

## 2. 子型清单（开放注册，非封闭枚举）

状态标注沿用[对象对账](H_S_R_OBJECT_MAPPING_DRAFT.md) §二：“确定”= 用户已同意方向，“建议”= 候选映射需后续细化。清单开放：新子型可注册而不改变旧对象（N-02）；对象的 `concept_subtype` 不可变（CO-ID-5）。

| 子型 | 定义 · 为何属 Concept | S-L0/S-L1 特有要求 | 关键禁止项 |
| --- | --- | --- | --- |
| `TERM` 术语（确定） | 词汇中一个术语的词法身份；SKOS `prefLabel`/`altLabel` 的承载；含义的最小可版本单位 | S-L1：`preferred_label` 非空、`language` 已声明 | 别名不是新概念；同名异义按语境区分，不自动合并（ID-07） |
| `DEFINITION` 定义（确定） | 对术语或类型外延/内涵的陈述；定义是“含义本身”，不是真值条件命题 | S-L1：`definition_text` 非空或显式 `UNKNOWN(reason)` | 定义不登记为“事实为真”；定义不能直接成为 Fact（DF-01） |
| `TYPE` 类型（确定） | 对个体/对象集合的划分（模型类别、设备类别、数据类别） | S-L1：`superordinate` 可声明 | 成员判定是登记者主张；类型不封闭枚举 |
| `SYMBOL` 符号/记法（建议） | 符号、记法及其解释（“发射度” vs “ε” vs 公式写法） | S-L1：解释文本或等价声明 | 记法 ≠ 物理量；不同子语言同符号须声明子语言 |
| `DIMENSION_UNIT` 量纲与单位（建议） | 物理量量纲、单位定义与换算声明（SI、π·mm·mrad） | S-L1：量纲已声明；换算关系有来源 | 禁止跨单位隐式换算（C05）；换算 ≠ 测量 |
| `METRIC_DEFINITION` 指标定义（确定） | 指标背后的测量/归一化版本（RMS vs FWHM、几何 vs 归一化发射度） | S-L1：归一化方式、参考系、适用 World 已声明或 `UNKNOWN` | 归一化方式/参考系是身份构成（CO-REV-5）；同名不同版本 ≠ 同指标 |
| `WORLD_TYPE` WorldType（确定） | 开放 World 的类型登记（理论、仿真、真实装置、理想化、混合等） | S-L1：类型名 + 区分性说明 | 禁止 Theory/Simulation/Engineering 封闭三值与信任阶梯（D13）；具体 WorldContext 个体归 Entity |
| `RESEARCH_FRAME` / `RESEARCH_DIMENSION` / `RESEARCH_OPTION`（确定） | 研究框架、框架内维度、维度内选项的定义 | S-L1：维度/选项按框架登记；框架版本已声明 | 维度新增不回填旧 Profile（CO-W-3）；“未选某选项” ≠ 科学否定（CO-W-4） |
| `PREDICATE_SIGNATURE` 谓词签名（建议） | 谓词的参数角色、类型、量纲、World 类型约束；形式化扩展边界而非形式化 | S-L1：参数列表与角色已声明、引用可解析 | 签名不参与科学正确性检查（CO-SIG-2）；签名 ≠ 已形式化 |
| `RELATION_TYPE_DEFINITION` 关系类型定义（建议） | Association 可使用的合法关系类型声明（UPSTREAM_OF、CORRELATED_WITH 等） | S-L1：主客类别约束与方向已声明 | 类型定义 ≠ 关系实例；新实例归 Association |
| `INFERENCE_SCHEME_DEFINITION` Scheme 定义（建议） | 供 Argumentation 的方法定义：输入角色、条件槽位、目标形式、局部结局词表、程度尺度（§7） | S-L0 可解析；S-L1：必需输入角色非空（SCHEME-1） | 不检查科学正确性（SCHEME-8，RD-12）；论证实例归 Argumentation |
| `DEGREE_SCALE_DEFINITION` 程度尺度定义（建议） | 程度值尺度语义、逻辑 Profile 与允许运算的声明（概率、模糊、支持强度等） | S-L1：尺度语义 + 允许运算 + 版本 | 未声明尺度禁止比较/平均/相乘/取小（C02、SCHEME-5） |
| `CRITICAL_QUESTION_TEMPLATE` 关键问题模板（建议） | Scheme/定义应回应的重要科学问题模板（代表性、独立性、竞争解释） | S-L0 可空 | 非阻断义务（D15）；`OPEN` 不阻断保存与条件性探索 |
| `ADOPTION_POLICY` 采纳政策（建议） | 某主体/范围“何时用哪个版本/基线”的政策声明 | S-L1：采纳主体 + scope 已声明 | 政策 ≠ 接纳（FactDesignation）；政策不改变任何对象字段 |

## 3. 字段契约

### 3.1 身份、词汇与定义

| 字段/角色 | 语义 | 类型/引用对象 | S-L0/S-L1 要求 | UNKNOWN/缺失规则 | 修订约束 |
| --- | --- | --- | --- | --- | --- |
| `concept_id` | 全局唯一标识，创建时固定，永不复用、永不重新解释（ID-01） | 值（H 分配） | S-L0 必填 | 不得为 `UNKNOWN`/`ABSENT` | **不可变**；改变“kind”= 新对象 |
| `concept_subtype` | §2 子型（开放注册） | 值 | S-L0 必填（决定校验分支） | 不允许多值 | **不可变**；子型变化 = 新 Concept（CO-ID-5） |
| `preferred_label` | 首选名称（SKOS `prefLabel` 语义，带语言） | 文本 + 语言 | S-L1 必填且非空 | `UNKNOWN` 合法 | 更改 = LEXICAL 修订（CO-ID-3） |
| `alt_labels[]` | 别名（SKOS `altLabel` 语义），各带语言 | 文本[] | S-L0 可空 | 空集合合法 | 新增 = LEXICAL 修订，不使历史检查失效（CO-REV-3） |
| `definition_text` | 定义的权威文本（自然语言或受控文本），含义边界的载体 | 文本 + 语言 | S-L1：必填非空或显式 `UNKNOWN(reason)` | `UNKNOWN` 合法（定义未定） | 措辞澄清 = 修订；软区含义调整 = SUBSTANTIVE 修订 + 提示；越过硬集合 = 新 Concept（CO-REV-5） |
| `definition_version_claim` | 本修订登记者主张：含义边界是否相对前一版本未变 | `UNCHANGED`/`CHANGED` + `change_basis` | S-L1 每次修订必填（CO-REV-1） | 不得 `ABSENT` | `CHANGED` 且越过硬集合 → S-L1 FAIL（须新建 Concept） |
| `revision_class` | 本修订分类（开放注册，种子两值） | `LEXICAL`/`SUBSTANTIVE` | S-L1 每次修订必填（CO-REV-1） | 不得 `ABSENT` | `SUBSTANTIVE` 触发定向重检提示（CO-REV-4，RD-13） |
| `domain_scope` | 词汇域（System/Domain/Project，D14）与适用研究范围 | 值 + 可选 Concept@rev/Entity@rev | S-L0 可缺；S-L1 必填 | `UNKNOWN` 合法 | 范围边界变化 = 软区含义变化（CO-REV-6） |
| `language` | 标签与定义的语言标识 | 值 | S-L1 必填 | `UNKNOWN` 合法 | 修订 |
| `superordinate`/`broader` | 上位概念（SKOS `broader` 语义） | Concept@rev | S-L0 可缺 | `UNKNOWN` 合法 | 更改通常为 LEXICAL；若牵动含义边界由登记者标 SUBSTANTIVE |
| `standard_vocabulary_alias` | **仅精确等价时**挂接的 W3C/标准词汇名（N-04、DF-10） | 标准 URI | S-L0 可缺 | 关系仅为 `closeMatch` 时禁止写入 | 挂接变更须附等价主张与依据（CO-SKOS-2） |
| `lexical_notes[]` | 说明、示例、用法注记（词法材料） | 文本[] | S-L0 可空 | 空集合合法 | 变化 = LEXICAL（CO-REV-2） |

### 3.2 形式化扩展

| 字段/角色 | 语义 | 类型/引用对象 | S-L0/S-L1 要求 | UNKNOWN/缺失规则 | 修订约束 |
| --- | --- | --- | --- | --- | --- |
| `predicate_signature` | 谓词的参数角色、参数类型、量纲、World 类型约束；形式化扩展边界而非形式化 | `{role, type_ref, dimension_ref, world_constraint}` 列表 | S-L1：声明时引用全部可解析；空集合合法 | `UNKNOWN` 合法（未定） | 参数/类型/量纲变化 = 新 Concept（CO-ID-4、CO-REV-5） |
| `quantifier_scope` | 定义声明的量词类型（全称/存在/受限）及其辖域 | 值 + 可选 scope | S-L1：定义文本含量词时声明或显式 `UNKNOWN` | `UNKNOWN` 合法（自然语言量词未明） | 量词类型变化 = 新 Concept（CO-REV-5） |

### 3.3 Scheme 定义专有字段（`concept_subtype = INFERENCE_SCHEME_DEFINITION` 时适用，见 §7）

| 字段/角色 | 语义 | 类型/引用对象 | S-L0/S-L1 要求 | UNKNOWN/缺失规则 | 修订约束 |
| --- | --- | --- | --- | --- | --- |
| `scheme_input_roles[]` | 输入角色声明：角色名、允许对象类别集合、基数、是否必填（SCHEME-1） | `{role_name, allowed_kinds[], cardinality, required}` | S-L1：必填且非空；每项字段齐备 | “基数未定”可 `UNKNOWN`；必填角色必须声明 | 必需集合/角色类型约束变化 = 新 Concept；纯新增可选角色 = SUBSTANTIVE 修订 |
| `scheme_condition_slots[]` | 条件槽位：名、含义、不满足时行为（SCHEME-2） | `{slot_name, meaning, on_failure}` | S-L1：空集合合法；`on_failure` 未声明 = 规范默认 PRESERVED+REPORTED | `UNKNOWN` 合法 | 槽位删除或含义变化 = 新 Concept；纯新增 = SUBSTANTIVE 修订 |
| `scheme_target_form` | 目标形式：结论端必须为精确 PropositionRevision；讨论目标可为论证/关联/他对象精确修订（SCHEME-3） | `PROPOSITION_REVISION` + 可选讨论目标类别 | S-L1 必填 | 不得 `UNKNOWN` | 禁止声明“自由/latest 目标”（ID-05、DF-03）；变化 = 新 Concept |
| `scheme_outcome_vocabulary[]` | 局部结局词表：该 Scheme 允许哪些结局及其含义（SCHEME-4） | `{outcome, meaning}` 列表 | S-L1：必填且非空 | `UNKNOWN` 合法（词表未定），报告列为待补 | 条目含义变化 = 新 Concept；纯新增 = SUBSTANTIVE 修订 |
| `degree_scale_declaration` | 该 Scheme 程度值的尺度语义、逻辑 Profile、允许运算、版本（SCHEME-5） | DegreeScaleDefinition@rev 或显式“不产生程度值”声明 | S-L1：能产生程度值时必填；否则必须显式声明不产生 | `UNKNOWN` 合法但禁止一切程度值运算 | 尺度变化 = 新 Concept |
| `scheme_composition_permission` | 该 Scheme 输出可否作为另一 Scheme 输入、条件为何：角色映射 + 对齐要求（SCHEME-6） | `{target_scheme?, role_mapping, alignment_refs[]}` | S-L0 可缺 | `UNKNOWN` 合法；未声明 = 默认无组合许可 | 声明变化 = SUBSTANTIVE 修订（是声明，非机器保证） |
| `critical_questions[]` | 非阻断义务触发点：应回应哪些科学问题（SCHEME-7） | `{question, template_ref?, blocking = false}` | S-L0 可空 | 空集合合法 | 非阻断（D15）；`OPEN` 不阻断保存/探索 |

### 3.4 明确禁止存在的字段

`is_correct`、`truth_value`、`recommended_definition`、`is_current`、`latest` 跟随指针、`auto_merged_into`（自动合并）、`scientific_validity_score`、任何“版本信任级/信任阶梯”字段。理由：DF-01/DF-05/DF-07、C02/C11、D13（信任阶梯）、ID-07（自动合并）；正确性与接纳属于 Assessment/FactDesignation 与派生投影，不属于概念本体。

## 4. 概念修订规则（本轮重点）

| 编号 | 规则 |
| --- | --- |
| CO-REV-1 | 每次修订必须携带 `definition_version_claim ∈ {UNCHANGED, CHANGED}`、`revision_class ∈ {LEXICAL, SUBSTANTIVE}` 与 `change_basis`（说明文本）。`CHANGED` + `LEXICAL` 组合非法（自相矛盾）→ S-L1 FAIL；`SUBSTANTIVE` 主张须先过硬集合检查（结构可判，不判语义，DF-07）。 |
| CO-REV-2 | **词法修订**（LEXICAL + UNCHANGED）：增删别名、更新说明/示例、更正笔误、新增译文、更改 `preferred_label`、不改变含义边界的措辞澄清 → 同一 Concept 的新修订。 |
| CO-REV-3 | 新别名、新说明、新示例**不使历史检查、历史论证、历史接纳失效**：它们不改变任何已声明 `ConceptID@rev` 的含义（C11、DF-06，RD-13）。 |
| CO-REV-4 | **定向重检提示**：由 (a) Concept 的 `SUBSTANTIVE` 修订、(b) 带 redefines/alternative 关系指向旧 Concept 的新 Concept（重定义谓词/类型/单位/量词/归一化/Scheme 声明/尺度等）触发。**输入（语义级）**：旧版本的**引用集**（所有 `SEMANTIC` 精确引用旧 `ConceptID@rev` 的 Proposition/Argumentation/Association/评价）+ 新版本的 `change_basis` + 身份构成字段差异清单（旧 vs 新）。**输出（语义级）**：一份**新的**重检报告——“可能受含义影响对象”清单，逐条附原因与复核建议；旧检查报告、旧结局、旧接纳**原样保留**（C11、RV-03、DF-06）。提示是**非阻断义务**（D15）：`OPEN` 不阻断保存与继续使用；是否重新论证/复核由主体决定。 |
| CO-REV-5 | **新建 Concept 而非新修订的可判定判据**：改变硬含义构成集（§5 表）中**已声明**的值 → 必须新建 Concept、保留旧对象、登记显式 redefines/alternative 关系（RV-02），同 ID 修订 S-L1 FAIL。 |
| CO-REV-6 | **软区含义修订**：未越过硬集合、但登记者主张含义变化（范围边界调整、定义条件细化、适用边界澄清、可选角色/槽位/词表条目的纯新增）→ 同一对象的合法 `SUBSTANTIVE` 修订，并触发 CO-REV-4 定向重检提示。 |

**硬含义构成集（CO-REV-5 种子）**：`concept_subtype`；`predicate_signature`（参数角色/个数/类型/量纲/World 约束）；`quantifier_scope`（量词类型）；`degree_scale_declaration`（尺度语义/逻辑 Profile/允许运算）；量纲与单位所指物理量（DIMENSION_UNIT）；归一化方式/参考系/测量方法（METRIC_DEFINITION）；`scheme_target_form`；`scheme_input_roles[]` 必需集合与角色类型约束；`scheme_outcome_vocabulary[]` 条目含义；`scheme_condition_slots[]` 删除或含义变化。

**边界例子**：

| 情形 | 判定 | 依据 |
| --- | --- | --- |
| “几何发射度（RMS，未归一化）”增加别名“emittance” | 修订（LEXICAL） | CO-REV-2/3；含义边界不变 |
| 定义中归一化方式由几何改为归一化（乘 γ·βγ 因子） | **新 Concept** | 归一化方式是硬字段；CO-REV-5 |
| 测量方法由 RMS 改为 FWHM | **新 Concept** | 测量方法是硬字段；CO-REV-5 |
| 谓词签名 `focused_at(position, time)` 增加“温度”参数 | **新 Concept** | 签名参数增删；CO-REV-5 |
| 单位“mrad”重定义（改为非 SI 约定） | **新 Concept** | 单位重定义改变所指物理量；CO-REV-5 + 提示（CO-REV-4） |
| 定义量词由“对所有初始条件”改为“对某个初始条件” | **新 Concept** | 量词类型是硬字段；CO-REV-5 |
| 定义增补“本定义不适用于相对论工况”（登记者主张 CHANGED，测量方式仍为 RMS） | SUBSTANTIVE 修订 + 定向重检提示 | 软区；CO-REV-6/4 |
| `domain_scope` 由 `UNKNOWN` 补全为“加速器域” | 修订（补全） | RV-01；补全不是改变 |

## 5. 身份与修订判据（CO-ID-*）

**身份构成字段**（已声明值改变 → 新 Concept；G-REV/RD-06 在 Concept 的实例化）：

| 字段 | 为何构成身份 |
| --- | --- |
| `concept_subtype` | 决定含义类别与校验分支 |
| `predicate_signature` | 决定形式化扩展边界（参数、类型、量纲、World 约束） |
| `quantifier_scope` | 决定定义主张的辖域 |
| `degree_scale_declaration` | 决定程度值的可解释性与可运算性 |
| 量纲与单位所指物理量（DIMENSION_UNIT） | 改变所指物理量本身 |
| 归一化方式/参考系/测量方法（METRIC_DEFINITION） | 改变指标值的可比性 |
| `scheme_target_form` / `scheme_input_roles[]` 必需集合与角色类型约束 / `scheme_outcome_vocabulary[]` 条目含义 / `scheme_condition_slots[]` 含义 | 决定方法的结构合同（R-L1 的检查依据） |

| 编号 | 判据问题 | 判定 |
| --- | --- | --- |
| CO-ID-0 | 防误判机制 | “同一对象两个修订”与“两个对象”的判定错误会污染历史（RV-04）；上表 + CO-REV-5/6 是唯一结构判据，语义本身不机器判定（DF-07） |
| CO-ID-1 | 同一定义的措辞澄清 | 修订（LEXICAL，或 SUBSTANTIVE + UNCHANGED 主张） |
| CO-ID-2 | 定义实质改变（越过硬集合） | **新 Concept**，旧对象保留 + redefines 关系（Association，见[关联契约 §6.3](H_S_R_ASSOCIATION_CONTRACT_DRAFT.md)） |
| CO-ID-3 | 换 `preferredLabel` | 修订（LEXICAL）；名称误导时由 Assessment 质疑或新修订更正，不因此新建 Concept |
| CO-ID-4 | 谓词签名增删参数或改类型 | **新 Concept** |
| CO-ID-5 | `concept_subtype` 变化 | **新 Concept**（子型不可变） |
| CO-ID-6 | 程度尺度变化（逻辑 Profile 或允许运算） | **新 Concept** |
| CO-ID-7 | 身份构成字段 `UNKNOWN`/`ABSENT` → 补全声明值 | 修订（RV-01）；渐进规范化合法 |
| CO-ID-8 | 两个 Concept 疑似同一（同名/近义） | 不自动合并：登记 `IDENTITY_CONFLICT`/等价候选记录，由主体裁决并留依据（ID-07、RV-05） |

与 Proposition 契约 PR-ID-4 的关系：命题以“真值条件任何变化”为硬边界；Concept 的含义边界分为**硬集合**（结构可判）与**软区**（登记者主张 + 主体审查），是对象特有的细化，不是对 DF-06/C11 的放松。

## 6. 版本与历史保证

| 编号 | 规则 |
| --- | --- |
| CO-V-1 | 概念新版本不得**倒灌**改变旧命题/旧论证含义：旧记录的含义由其引用的 `ConceptID@old_rev` 决定（C11、DF-06）。 |
| CO-V-2 | 精确引用 `ConceptID@rev` 不漂移；`latest` 不得进入任何正式声明（ID-04、ID-05、DF-03）。 |
| CO-V-3 | “当前概念版本”视图（目录、界面导航、Agent 上下文）必须声明：历史截点（`as_of`，T-01）+ 选择主体/政策（谁的视图）；未声明者该查询未定义。 |
| CO-V-4 | 概念修订不自动产生新命题：旧命题“改用新概念版本”是该命题的新修订或新命题，由主体完成并经 H 链连接；CO-REV-4 的提示只是建议，不是强制。 |
| CO-V-5 | 旧修订永久保留可回放；redefines/alternative 替代关系是**有来源的 Association 记录**（`SUPERSEDES_AS_STATED`，不写成 H 事件、也不写成对象上的隐藏字段），不是对象的隐藏属性（RV-02）。 |
| CO-V-6 | 概念修订不自动产生新接纳/新评价；旧接纳仍锚定旧修订（A7、PR-A4）。 |

## 7. Scheme 定义契约（Concept 子型专章）

InferenceSchemeDefinition 是 **R-L0/R-L1 的检查依据**：R-L0 检查“论证声明的 Scheme 合法且机器可解析”；R-L1 对照 Scheme 声明检查论证的必需输入角色、条件槽位、目标形式与结局词表完整合法（R3、RD-12）。**Scheme 定义不检查科学正确性**：Scheme 选择是否恰当、样本代表性、统计模型适用、类比有效等均不在 S-L*/R-L* 范围（DF-07、R6）。

| 编号 | 规则 |
| --- | --- |
| SCHEME-1 | **输入角色声明**：每个角色必须声明角色名、允许对象类别集合（开放：Entity/Concept/Association/Argumentation/Proposition，另含“内部值”）、基数（0..1 / 1 / 1..n / all）、是否必填、含义说明。缺失必填角色 → 该论证 R-L1 FAIL（不得空占位，CS-06）；角色类型不符 → FAIL。 |
| SCHEME-2 | **条件槽位**：每槽声明名、含义、不满足时行为。不满足 = 条件保留在该路径上并报告（C03、C07）；登记者可声明 `on_failure = NO_SUPPORT_OUTCOME`（该路径因此不产出本 Scheme 的支持结局，须显式标记）。**该声明只约束结局生成，绝不阻断登记、保存、阅读、检索或被条件性探索**（DF-07、D15）：不存在“阻断保存”的 BLOCKING 取值。条件无法核实 ≠ 条件被反证（C12、CS-08）。 |
| SCHEME-3 | **目标形式**：结论端为精确 PropositionRevision（C02、RD-08）；讨论目标可为论证/关联/他对象精确修订（元论证用）。禁止声明“目标可为任意/latest”。 |
| SCHEME-4 | **局部结局词表**：每个 Scheme 声明它允许哪些结局及各自含义（如演绎：STRICT_SUPPORT/INCONCLUSIVE；归纳：INDUCTIVE_SUPPORT（附代表性义务）/INCONCLUSIVE；证据：EVIDENTIAL_SUPPORT/CONFLICT/INCONCLUSIVE）。结局是**局部**结局（A4），不是全局真值（C02）；未声明的结局论证端不可用（R-L1 FAIL：结局越出词表）。 |
| SCHEME-5 | **程度值尺度与允许运算**：Scheme 能产生程度值时必须声明 DegreeScaleDefinition@rev（尺度语义、逻辑 Profile、允许运算、版本）。**未声明尺度时禁止任何比较/平均/相乘/取最小/概率读法**（C02、CS-10）；不同 Scheme 的程度值默认不可比（C06）。计算得到的概率/后验是科学结果，不是本尺度对象（RD-17）。 |
| SCHEME-6 | **组合许可**：该 Scheme 输出（命题/结局）可否作为另一 Scheme 输入、条件为何：角色映射（输出进入对方哪个角色）+ 对齐要求（概念版本、World/Scope、量纲一致，C05）+ 条件保留（C06/C07）。未声明 = 无组合许可；路径仅可追踪，不支持传递（C06、CS-15）。 |
| SCHEME-7 | **Critical Questions 与非阻断义务**：Scheme 定义可声明关键科学问题触发点（引用 CriticalQuestionTemplate@rev 或内联文本）。触发产生**义务记录**（D15，非阻断）：`OPEN` 不阻断保存、R-L1 或条件性探索；解除是显式记录（主体 + 依据）。 |
| SCHEME-8 | **R-L1 边界**：Scheme 定义声明结构，不声明正确。R-L1 不检查：Scheme 选择是否恰当、样本代表性、统计模型适用、类比有效性、规则是否科学；这些归 Critical Questions、Assessment 与主体审查（R3、R6、DF-07）。 |

**SCHEME-9 Scheme 定义本身不完整时**（对象是 Scheme 定义自身，按 S-L0/S-L1 检查）：

| 情形 | S-L0 | S-L1 | 规则与说明 |
| --- | --- | --- | --- |
| Scheme 文本不可解析，或 `concept_subtype` 未声明为 INFERENCE_SCHEME_DEFINITION | FAIL | 不评估 | S-L0 门禁（可解析） |
| `scheme_input_roles[]` 缺失（方法所需角色未声明） | PASS | FAIL | SCHEME-1 |
| 某角色“允许对象类别集合”为空且未声明 | PASS | FAIL | SCHEME-1（角色无法约束输入） |
| `scheme_outcome_vocabulary[]` 为空 | PASS | FAIL | SCHEME-4（论证结局无法检查） |
| Scheme 能产生程度值，但尺度未声明且未声明“不产生程度值” | PASS | FAIL | SCHEME-5（登记者必须二选一） |
| 条件槽位存在但 `on_failure` 未声明 | PASS | PASS（默认 PRESERVED+REPORTED，报告列待补） | SCHEME-2（规范默认，不是值补全，UN-02） |
| `scheme_target_form` 未声明或声明“自由目标” | PASS | FAIL | SCHEME-3（ID-05、DF-03） |
| 必需项齐备但 Critical Questions 为空 | PASS | PASS | SCHEME-7（问题可选、非阻断） |

## 8. World 类型与研究维度/选项

| 编号 | 规则 |
| --- | --- |
| CO-W-1 | WorldType **开放注册**：新 World 类型可注册而不改变旧对象；Theory/Simulation/Engineering 是种子示例，不是封闭三值，更不是信任阶梯（D13、S5）。 |
| CO-W-2 | 具体 WorldContext 个体（某模型配置、某装置世界）归 Entity（或对象结构属性；对象化条件未冻结，对象对账 §二）；命题/论证的 `world_ref` 指向个体或类型的精确修订（Proposition 契约 §2.2）。 |
| CO-W-3 | ResearchFrame 新增维度/选项不得**回填改写**历史 ContextProfile、历史命题或历史论证：旧记录保留旧框架版本引用（`ResearchFrameID@rev`）；“未声明新维度”是 `ABSENT`，不是对该维度的否定（UN-03）。 |
| CO-W-4 | “未选某选项” ≠ 科学否定：只表示“本次声明未选择”，不得呈现为“该选项为假”（UN-01、UN-03）。 |
| CO-W-5 | 跨 World 不隐式转换：M 下的命题不自动适用于 W；对齐/对应是 Association（映射声明，有来源）或元命题（等价主张），不是隐式指针（D13、C05）。 |
| CO-W-6 | 框架版本引用精确（`ResearchFrameID@rev`）；“框架最新版本”不得进入正式声明（ID-05、DF-03）。 |

## 9. 谓词签名与形式化的扩展边界

| 编号 | 规则 |
| --- | --- |
| CO-SIG-1 | `predicate_signature` **参与**：S-L1 的引用可解析与角色齐备检查；两条记录相接时的对齐检查（C05）；论证输入角色检查（R-L1，角色类型约束）。 |
| CO-SIG-2 | `predicate_signature` **不参与**：命题含义是否正确、翻译是否忠实、物理模型是否适用、科学结论真假（DF-07、S5）。 |
| CO-SIG-3 | 签名是**形式化扩展边界声明**，不是形式化：命题可以只声明签名而不携带任何形式表示（FOL/Lean），不影响 S-L0/S-L1；**不要求任何命题必须形式化**（D17、主基线 §5）。 |
| CO-SIG-4 | **S-L2 候选边界**（只写边界，不设计规则）：若声明形式化，则须能检查**签名匹配**（谓词名/元数/参数角色与声明签名一致）、**变量绑定**（自由变量已声明且无捕获）、**量纲一致**（物理量量纲/单位与签名声明一致）。S-L2 的具体规则集、工具链与证书格式留给后续设计（§14）。 |

## 10. SKOS/W3C 边界

| 编号 | 规则 |
| --- | --- |
| CO-SKOS-1 | SKOS 负责**词汇层**：概念、`prefLabel`/`altLabel`、`definition`、`broader`、匹配关系。谓词签名、量纲/单位、Lean 对应是**领域扩展**（dsh:PredicateSignature 等），SKOS 不能表达（D14 边界、W3C 对齐表 §二-C）。 |
| CO-SKOS-2 | `standard_vocabulary_alias` 仅**精确等价**时挂 W3C 名（N-04、DF-10、D20）；等价是登记者主张，可被 Assessment 质疑。 |
| CO-SKOS-3 | `skos:closeMatch` 是**映射声明**（登记为 Association，有来源与声明者），不是自动等价；系统不得由它做任何推理（W3C 对齐表 §二）。 |
| CO-SKOS-4 | 禁止 `owl:sameAs`/`owl:equivalentClass` 掩盖部分重合：部分重合登记为等价候选 + 显式差异说明（ID-07、RV-05）。 |
| CO-SKOS-5 | 内部五类分类不改写标准语义：概念仍是 skos:Concept，活动仍是 prov:Activity 等（DF-10、主基线 §4-6）。 |

## 11. 与其他对象的关系

| 方向 | 角色 | 说明与禁止 |
| --- | --- | --- |
| Proposition —`SEMANTIC`→ Concept@rev | 使用概念版本（术语/指标/单位/签名） | 概念新版本不倒灌改写旧命题（C11） |
| Argumentation —`INFERENTIAL`→ Concept@rev（InferenceSchemeDefinition） | 声明方法定义 | R-L0/R-L1 对照其检查（SCHEME-*）；论证实例归 Argumentation（RD-12） |
| Argumentation —`SEMANTIC`→ Concept@rev（指标/单位/签名） | 输入角色绑定 | 角色约束来自 Scheme 定义（C04、C05） |
| Association —`typed_by`→ Concept@rev（RelationTypeDefinition） | 声明合法关系类型 | 关系实例本身是 Association；类型定义不是实例 |
| Entity（WorldContext 个体）—`typed_by`→ Concept@rev（WorldType） | 个体所属世界类型 | 跨 World 不隐式转换（CO-W-5） |
| ContextProfile（Entity）—`frame`→ Concept@rev（ResearchFrame@rev） | 具体选择 | 维度新增不回填旧 Profile（CO-W-3） |
| Concept ↔ Concept | 上位、等价候选、closeMatch 声明 | closeMatch 是 Association（CO-SKOS-3）；候选不合并（ID-07） |
| Assessment（Proposition 子型）—`EVALUATIVE`→ Concept@rev | 评价定义质量 | 评价写在评价侧，不写概念任何字段；可被再评价 |
| H —拥有→ 修订事件、定向重检提示 | 历史与义务 | 单次修订事件是 H 记录，不是 Concept（ID-08） |

## 12. 生命周期

`登记为 S-L0 Concept（术语/定义）→ 逐步补全语义声明（S-L1）→ 被命题/论证以精确版本引用 → 词法修订（别名/说明）或 SUBSTANTIVE 修订（新版本 + 定向重检提示）→ 含义边界改变时新建 Concept + redefines 关系 + H 记录`。

允许长期停留：仅有标签无定义的 Concept、签名为空的 Concept、从未被引用的 Concept、处于 `IDENTITY_CONFLICT` 的 Concept。**没有任何生命周期阶段要求 Concept 必须形式化、被证明或被采纳**（DF-07）。

## 13. 例子

**合法例 1** `C8@r3`（METRIC_DEFINITION，“几何发射度（RMS，未归一化）v2”）：`preferred_label = “几何发射度（RMS，未归一化）”`（zh）；`alt_labels = ["geometric RMS emittance"]`；`definition_text` = “束流在 x–x′ 相空间分布的均方根（RMS）值，不乘任何相对论因子（γ 或 βγ）；FWHM 读数不适用”；`domain_scope = SYSTEM`；`predicate_signature = [{role: VALUE, type_ref: LENGTH_ANGLE_AREA, dimension_ref: "L·θ"}, {role: MEASURED_AT, type_ref: Entity@rev（世界个体）}]`；`quantifier_scope = ABSENT`（定义无量词）；`definition_version_claim = CHANGED`（r2→r3：显式排除 FWHM 读数；测量方式仍为 RMS，硬字段未变 → 软区）；`revision_class = SUBSTANTIVE`；作为 SUBSTANTIVE 修订直接触发定向重检提示（CO-REV-4a，同对象修订无需替代关系）：新报告列出使用 C8@r2 的旧命题 P7@r1 为“可能受影响”，P7@r1 含义不变（C11）。

**合法例 2** `C21@r1`（INFERENCE_SCHEME_DEFINITION，溯因片段）：`scheme_input_roles = [{EXPLANAND, [PROPOSITION], 1, 必填}, {HYPOTHESIS, [PROPOSITION], 1..n, 必填}, {BACKGROUND, [PROPOSITION, ASSOCIATION], 0..n, 可选}]`；`scheme_condition_slots = [{COMPETITORS_CONSIDERED, on_failure: PRESERVED+REPORTED}]`；`scheme_target_form = PROPOSITION_REVISION`；`scheme_outcome_vocabulary = [BEST_AVAILABLE_EXPLANATION（含义：已声明候选中最强，不排除未登记竞争者）, INCONCLUSIVE]`；`degree_scale_declaration` = 显式“不产生程度值”（故禁止比较/平均）；`scheme_composition_permission = ABSENT`（默认无组合）；`critical_questions = [{question: “是否存在未登记的竞争解释？”, template: CQ-ABD-01, blocking: false}]`。S-L1 PASS；该定义不检查候选解释是否科学上优（SCHEME-8）。

**非法/易混淆例**：

| 情形 | 为什么非法 | 正确做法 |
| --- | --- | --- |
| 给“几何发射度（RMS，未归一化）”加别名“归一化发射度” | 别意指向不同含义（归一化 ≠ 几何），混淆引用 | 单独登记“归一化发射度” Concept；对比/对照说明用 Association 或元命题（ID-07） |
| 把 C8 的 `definition_text` 由 RMS 改为 FWHM 仍保留同 ID，标 `revision_class = LEXICAL` | 测量方法是硬含义构成字段，LEXICAL 属虚假主张（CO-REV-1） | S-L1 FAIL；新建 Concept（FWHM 版）+ redefines 关系 + H 链 |
| `predicate_signature` 增参“温度”却标为同对象 SUBSTANTIVE 修订 | 签名参数增删越过硬边界（CO-REV-5） | 必须新建 Concept；redefines 关系触发定向重检提示（CO-REV-4） |
| 两个主体各登记“时间分辨率”定义（归一化不同），系统自动合并为一个 Concept | ID-07：身份不因“看起来相同”合并 | 两个对象 + 等价候选/`IDENTITY_CONFLICT` 记录，主体裁决（RV-05） |
| 命题直接引用“发射度 v3（latest）” | `latest` 进入正式声明（ID-05、DF-03） | 精确引用 `C8@r3` |
| C8@r3 登记为 redefines 后，旧命题 P7@r1（引用 C8@r2）被自动更新为新含义 | 版本倒灌改写历史（C11 违反） | 旧命题保留 C8@r2；重检报告把 P7 列为“可能受影响”，由主体决定是否重立（CO-V-4） |
| Scheme 定义 R-L1 检查通过即标注“该方法科学正确” | Scheme 定义不检查科学正确性（SCHEME-8、DF-07） | 代表性/独立性问题走 Critical Questions 与 Assessment |
| World M 下的命题因“与 W2 同 WorldType”自动适用于 W2 | 跨 World 不隐式转换（CO-W-5、D13） | 对齐是 Association 映射声明或元命题 |

## 14. 尚未裁决内容

- S-L2 候选的具体检查规则集、工具链与证书格式（CO-SIG-4），本轮不设计；
- Scheme 声明（角色/基数/结局词表/尺度运算）的机器可读表达形式（决策清单 D1）；
- 定向重检提示在大量引用时的触发方式与规模控制（决策清单 D1）；
- 具体 WorldContext/ResearchScope 的对象化条件（对象对账 §二“建议”，未冻结）；
- `closeMatch` 映射声明是否须审查及其呈现形式（字段细节归 Association 契约）；
- 软/硬含义边界之外的情形（如范围变化何时视为越界）依赖登记者主张与主体审查，本轮不给机器判据；
- 子型种子清单之外新子型的注册流程（注册端口待定，N-02）。
