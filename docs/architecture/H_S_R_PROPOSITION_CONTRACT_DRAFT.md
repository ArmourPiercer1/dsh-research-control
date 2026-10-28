# Proposition 领域对象契约

> **PR #42 · DRAFT-PROPOSAL · 2026-10-28。** 细化[五类主基线](H_S_R_FIVE_OBJECT_ARCHITECTURE_DRAFT.md) §1/§3 与[组合合同 C02/C04/C12](H_S_R_COMPOSITION_SEMANTICS_DRAFT.md)。**共享约定（引用、时间、五态、状态轴、修订判据）只在[共同底座](H_S_R_DOMAIN_FOUNDATIONS_DRAFT.md)定义**，本文只定义 Proposition 专有内容。字段名是领域阅读名（N-01）。**Proposed，不表示已实施或已冻结。**

## 1. 语义定义与边界

**Proposition** 是具有稳定真值条件、可被独立引用与反复讨论的命题内容。它回答“说了什么、在什么 World 与 Scope 下说、精确版本是什么”，不回答“是否为真”“谁相信”“是否被证明”。

| 用途 | 不属于 Proposition 的典型情形 | 该情形应登记为 |
| --- | --- | --- |
| 保存可精确引用的科研论点、假设、定理、工程断言 | 某设备、某次仿真运行、某文件 | Entity |
| 承载“在 M 中、工况 W 下、按定义 D 的版本”的精确含义 | “发射度”的定义及其版本 | Concept |
| 被论证、评价、接纳、质疑的锚点 | “A 在 T1 登记：Q 在 CCD 上游”这一来源记录 | Association |
| 表达主体态度（评价、正式接纳）与规范义务（作为子型） | 一次推理活动的过程记录（使用了哪些前提） | Argumentation（+ H 活动记录） |
| 讨论其他命题、论证、关联乃至自身 | “120 fs”这个数值本身 | 其它对象的属性值或 Entity（不必对象化） |

**登记 ≠ 主张为真 ≠ 被支持 ≠ 被接纳 ≠ 客观为真**（DF-01）。

## 2. 字段契约

### 2.1 内容与表示

| 字段/角色 | 语义 | 类型/引用对象 | S-L0/S-L1 要求 | UNKNOWN/缺失规则 | 修订约束 |
| --- | --- | --- | --- | --- | --- |
| `primary_expression` | 登记时认定的主表述（自然语言或结构化文本），承载真值条件的权威陈述 | 文本 + 语言标识 | S-L0 必须存在（可很短）；S-L1 必须存在且非空 | 不得为 `UNKNOWN`（没有表述就没有命题）；原文残缺时按原始材料登记并可标注 `AMBIGUOUS_IN_SOURCE` | 见 §4；改动措辞但主张真值条件不变 → 新修订 |
| `representations[]` | 同一 revision 的多种表示（译文、受控文本、FOL 候选、类型化谓词式、Lean 公式） | 见 §3 | S-L0 可空；S-L1 非空时每项须有 `representation_kind` 与 `equivalence_claim` | 空集合合法（尚未形式化不是缺陷） | 表示集合的任何变化产生**新 revision**（revision 是不可变快照） |
| `declaration_kind` | 声明类型：`HYPOTHESIS / THEOREM / CONJECTURE / ENGINEERING_CLAIM / OBSERVATION_STATEMENT / DEFINITIONAL / CONDITIONAL / OTHER`（开放） | 值 | S-L0 可缺；S-L1 必填 | `UNKNOWN` 合法（作者未定性） | 定性变化通常是修订；若同时改变真值条件则新命题 |
| `sublanguage_tag` | 命题属于哪套形式语言/受控文本约定（如有） | Concept@rev 或 `UNKNOWN` | S-L1：若声明则引用须可解析 | 合法 `UNKNOWN` | 修订 |
| `proposition_subtype` | `PLAIN / ASSESSMENT / FACT_DESIGNATION / DECISION_BASIS / PROOF_OBLIGATION / META`（见 §6） | 值 | S-L0 必填（决定校验分支） | 不允许多值 | **不可变**；子型变化 = 新对象 |

### 2.2 语义定位（决定“说了什么”）

| 字段/角色 | 语义 | 类型/引用对象 | S-L0/S-L1 要求 | UNKNOWN/缺失规则 | 修订约束 |
| --- | --- | --- | --- | --- | --- |
| `concept_refs[]` | 该 revision 使用的概念**精确版本**：术语、定义、指标定义、谓词签名、单位/量纲（`SEMANTIC` 引用） | Concept@rev 集合 | S-L1：非空时全部引用必须可解析、同空间；不得用 `latest` | 允许空集合或 `UNKNOWN`（术语未定），但必须在报告中列为待补 | 已声明版本改指另一概念 → 主张真值条件变化者须新命题（§4） |
| `world_ref` | 该命题主张为真的世界。两种角色不可混用：**具体世界个体** `Entity@rev`（WorldContext：某个模型世界、某次仿真配置、真实装置世界）用于“在这个世界里为真”；**世界类别** `Concept@rev`（WorldType）只用于“对这类世界泛指” | `Entity@rev` \| `Concept@rev` \| `UNKNOWN` | S-L1：存在**或**显式 `UNKNOWN(reason)` → `PASS` + `declared_gaps` | 两种角色含义不同：`UNKNOWN`=不知在哪个世界为真；类别引用=泛指而非具体世界，二者不得互相顶替 | 变更 `world_ref` 的**具体世界个体**通常改变真值条件 → 新 Proposition（PR-ID-3/PR-ID-4）；把泛指收窄为某个具体世界同样改变真值条件 |
| `scope_refs[]` | 适用范围：工况、样本集合、参数区间、时间段、装置状态 | Entity@rev / Concept@rev 集合 | S-L1：非空时引用合法；空须显式 `UNKNOWN` | 允许 `UNKNOWN` | 已声明范围被扩展或收缩改变真值条件 → 新命题；仅澄清表述 → 修订 |
| `variable_bindings[]` | 自由变量、量词类型、取值域与相互约束 | `{variable, quantifier, domain_ref}` 列表 | S-L1：`primary_expression` 中出现待绑定量词时，每项须给出绑定或显式 `UNKNOWN` | 允许 `UNKNOWN`（自然语言量词未明） | 已声明量词由 `∀` 改 `∃` → **新命题** |
| `dimension_binding[]` | 指标所用的定义/归一化/单位版本（如“几何发射度 v2”“RMS vs FWHM”） | Concept@rev | S-L1：涉及可比数值时必须声明或显式 `UNKNOWN` | 允许 `UNKNOWN`；系统不得按同名猜测 | 定义版本改变真值条件 → 新命题 |
| `condition_refs[]` | 命题自身声明的条件（条件性命题的“若 C”部分） | Proposition@rev 集合 | S-L1：`declaration_kind = CONDITIONAL` 时必须给出或显式 `UNKNOWN` | 允许 `UNKNOWN`（条件尚未明确） | 已声明条件被替换或增删实质项 → 新命题 |
| `mention_refs[]` | 命题提及的其它对象（Entity/Association/Argumentation/Proposition/自身），高阶命题亦可提及某条 H 记录（登记、检查、采用记录）作为讨论目标 | `{target@rev, role ∈ {SUBJECT, CONTEXT, TARGET_OF_CLAIM, COMPARATOR, SELF}}` | S-L1：非空时引用合法、角色非空、同空间或 `UNRESOLVED` | 允许空集合与 `UNKNOWN` | 主体提及变化通常意味着不同命题（§4） |

### 2.3 历史与来源（由 H 拥有，本文只声明语义角色）

| 字段/角色 | 语义 | S-L0/S-L1 | 备注 |
| --- | --- | --- | --- |
| `recorded_at`、`actor_ref`、`source_refs[]` | 登记时间、登记主体、来源材料 | S-L0 必需（H 侧） | 不得由系统猜测来源 |
| `assertion_chain_ref` | 该 revision 所属的 H 历史连续性链（`ID-06`） | 可选 | 链成员可指向不同 PropositionID；链不含真值 |
| `confirmation_refs[]` | 主体对**该精确 revision** 的原意确认/异议记录 | 可选 | 派生为状态轴 A3；**不是** S-L1 的一部分 |

### 2.4 明确禁止存在的字段

`is_true`、`truth_value`、`global_probability`、`confidence_score`、`fact_status`、`is_verified`、`is_current`、`merged_into`（自动合并）、任何“latest 跟随”指针。理由：DF-01/DF-05 与 C02；真假与接纳属于评价/接纳子型与派生投影，不属于命题本体。

## 3. 表示（Representation）与 revision 的身份边界

这是本轮的重点裁决，用于避免重复设计第二套 Assertion 体系。

| 编号 | 规则 |
| --- | --- |
| RP-01 | **表示附着于 revision，不是独立 revision。** 一个 `PropositionRevision` 是一个不可变语义快照，内含一个 `primary_expression` 与零到多个 `representations`。表示集合变化 → 新 revision，而非修改旧快照。 |
| RP-02 | 表示可被精确引用，形式为 `PropositionID@revision#representation_id`；形式化验证记录必须引用到这一粒度，才能说明“检查了哪个公式”。 |
| RP-03 | 每个表示应携带 `equivalence_claim ∈ {SAME_TRUTH_CONDITIONS, APPROXIMATE, DISPUTED, UNKNOWN}`、声明者与（可有时）依据。**沉默 = `ABSENT`（登记者未作说明），不是 `UNKNOWN`（登记者声明了“不知道是否等价”）**：两者都进 `declared_gaps[]`、都 `PASS`（RPT-05、SL1-PRO-02、UN-03），但含义不同——沉默不可被当作“已声明不确定”，也不得被系统默认填充为任何一种。 |
| RP-04 | `SAME_TRUTH_CONDITIONS` 是**登记者的主张**，不是机器结论；机器只检查声明与引用是否存在。等价性可被他人以 Assessment/新命题质疑。 |
| RP-05 | 若形式化表示需要引入原文没有的假设（如“忽略空间电荷”），它**不得**标为 `SAME_TRUTH_CONDITIONS`；应为 `APPROXIMATE` 并列出 `added_assumptions[]`，或者登记为新的 Proposition 并保留历史关系（CS-22、C11）。 |
| RP-06 | 两个文本真值条件不同 → 两个不同 PropositionID。是否“实质同义”不由 S-L1 判定；等价候选通过等价候选记录表达（§5），绝不自动合并（ID-07）。 |
| RP-07 | AssertionChain 只连接 revision（`ID-06`），不承载含义；**不存在“AssertionRevision 承担命题内容”的第二套结构**。旧文档中该结构按[对账表](H_S_R_OBJECT_MAPPING_DRAFT.md) §二处理。 |

## 4. 身份、修订与新建判据

**身份构成字段**（已声明值被改变 → 新 Proposition）：

`primary_expression` 所表达的真值条件（由登记者主张）、`concept_refs[]` 中被声称构成含义的定义版本、`world_ref`、`scope_refs[]`、`variable_bindings[]`、`dimension_binding[]`、`condition_refs[]`、`mention_refs[]` 中的 `SUBJECT` 项。

| 编号 | 判据 | 例子 |
| --- | --- | --- |
| PR-ID-1 | 补全 `UNKNOWN/ABSENT → DECLARED` 且不改变原主张 → 新修订 | 原命题 `world_ref = UNKNOWN`，作者后补 `M`（并声明当时就指 M） |
| PR-ID-2 | 同真值条件下的措辞澄清、译文新增、表示更新 → 新修订 | 修正笔误；补充 FOL 候选（`APPROXIMATE`） |
| PR-ID-3 | 数值、量词、World、范围或构成性定义版本改变 → 新 Proposition，并由 H 链连接 | “100 fs”→“120 fs”；“M 中 RMS”→“真实装置 W2 中 FWHM” |
| PR-ID-4 | 每次修订必须携带 `truth_condition_claim ∈ {UNCHANGED, CHANGED}`、`completion_basis ∈ {SAME_INTENT_CONFIRMED, NEW_JUDGEMENT, UNDETERMINED}` 与 `change_basis`（说明文本）。`CHANGED` 而仍写同 PropositionID → 规范化 FAIL（结构可判，不判语义，RPT-07）。**身份判据优先于补全规则**：`completion_basis = NEW_JUDGEMENT` 或 `truth_condition_claim = CHANGED` 时一律新建命题；只有 `SAME_INTENT_CONFIRMED + UNCHANGED` 才允许同 ID 修订（RV-01 修订）。`UNDETERMINED` 时保留原版本 + 登记 `INTERPRETATION_DIVERGENCE`，系统不自动选边（RV-06）。 | 声称“只是澄清”却把 `∀` 改成 `∃` → FAIL；把“测量定义由未定确认为 RMS”判为修订（合法），把“改用 FWHM 重新给出结论”判为修订 → 应为新命题 |
| PR-ID-5 | 不同主体各自登记的命题默认是**不同对象**，即使文本相同；合并需显式登记等价候选 | 两位作者写下同一句“时间分辨率约 120 fs”但 World 不同 |
| PR-ID-6 | 已发布 revision 永不可变；评价、接纳与论证锁定旧 revision（RV-03、DF-06） | — |

## 5. 与其他对象的关系

| 方向 | 角色 | 说明与禁止 |
| --- | --- | --- |
| Proposition —`SEMANTIC`→ Concept@rev | 使用概念版本 | 概念新版本不倒灌改写旧命题（C11） |
| Proposition —`SEMANTIC`→ Entity@rev / Association@rev / Argumentation@rev / Proposition@rev | 提及（`mention_refs`） | 提及不等于存在断言、不等于支持；允许自指，但**不存在** `True(P)` 消解规则 |
| H —拥有→ AssertionChain —成员→ Proposition@rev | 历史连续性 | 链不表示语义等价 |
| Argumentation —`INFERENTIAL`/`EVALUATIVE`→ Proposition@rev | 结论端 / 讨论目标 | 见 Argumentation 契约 §3；不得跟随 latest |
| Assessment / FactDesignation（Proposition 子型）—`EVALUATIVE`→ 目标@rev | 评价 / 正式接纳 | 评价与接纳不写入目标命题的任何字段 |
| Proposition ↔ Proposition | 等价候选、细化、分歧 | 等价候选是**有来源的关系记录**（Association 或元命题），不合并身份（ID-07、RV-05） |

## 6. 子型

### 6.1 `ASSESSMENT`（评价性命题）

| 字段 | 要求与规则 |
| --- | --- |
| `assessor_ref` | `prov:Agent` 身份的个体（Entity@rev）。S-L1 必填；缺失则记录为“不可归因评价”并 FAIL 于 S-L1（不阻断保存） |
| `target` | 精确 `Proposition@rev`、`Argumentation@rev`、`Association@rev` 或论证内部路径/条件标识；S-L1 必填且精确 |
| `stance` | `SUPPORT / OPPOSE / QUALIFY / UNRESOLVED`（开放扩展） |
| `scope_refs[]` | 评价所依据的范围；缺失记 `UNKNOWN` |
| `basis_refs[]` | 该评价引用的证据/论证/材料；可为空 |

不变量：不同主体的相反评价可并存（CS-11）；评价不是机器检查结果的镜像，也不改变目标命题字段；评价本身可再被评价。

### 6.2 `FACT_DESIGNATION`（正式接纳/暂停/撤回声明）

| 字段 | 要求与规则 |
| --- | --- |
| `designator_ref` | 作出声明的主体；S-L1 必填 |
| `authority_basis_ref` | 授权依据（策略/角色定义/项目授权记录）；S-L1 必填或显式 `UNKNOWN` |
| `action` | `ACCEPT / SUSPEND / WITHDRAW` |
| `target_proposition_rev` | 被接纳的**精确**命题版本；禁止链级或 latest 引用 |
| `scope_refs[]`、`effective_time` | 接纳范围与其声称生效时间（与 `recorded_at` 区分） |

| 编号 | 规则 |
| --- | --- |
| PR-A1 | 授权依据不可确认时，声明**仍完整保存**，但标注 `AUTHORITY_UNVERIFIED`，且**不参与**接纳状态投影；不得静默丢弃，也不得静默生效（CS-23）。 |
| PR-A2 | “乙说甲接纳了 P”是普通命题或评价，不是 `FACT_DESIGNATION`；他人的转述不能改变甲的接纳状态。 |
| PR-A3 | 机器检查（S-L1/R-L1）PASS 不产生接纳；接纳也不产生真值（DF-01/DF-04）。 |
| PR-A4 | 接纳状态（A7）是按主体、scope、精确命题版本与历史截点重建的**派生投影**，不落为命题上的可变字段；撤回保留全部历史。 |

### 6.3 `DECISION_BASIS`（决策自述）

主体、决策所指、`considered_refs[]`（当时声称考虑了什么）、主观性声明。规则：

| 编号 | 规则 |
| --- | --- |
| DB-01 | 自述**不自动**代表真实决策因果：系统不得由“某人声称考虑过 X”推断 X 实际影响了决策，也不得把它自动升格为推理前提（DF-01、不变量 3）。 |
| DB-02 | 但自述**本身是有效历史证据**：作为“某主体在某时点如此登记”的记录，它可以经**显式** `INFERENTIAL` 角色参与**关于该决策过程的元论证**（如复盘、责任追溯、流程审查），此时结论端必须是关于决策过程的高阶命题，而不是被自述内容的科学真伪。登记时必须声明所引用的是“自述这一事实”而非“X 为真”。 |
| DB-03 | 禁止的是**隐式**路径：不得存在“DECISION_BASIS 自动进入正式论证前提集”“自述被检索命中即算支持”之类的默认规则；一切使用都经显式角色与精确版本（RF-02）。 |
| DB-04 | 事后补录不得改写决策时点的历史视图（T-02）。 |

### 6.4 `PROOF_OBLIGATION`（规范性义务命题）

内容形如“按已登记规则 R，命题 P 在范围 S 下需满足条件 C 才可声称 X”。附属状态由 H 记录：`OPEN / DISCHARGED / CONTESTED / WAIVED_BY(authority, reason)`。规则：`OPEN` **不阻断**条件性探索与保存（D15）；豁免不得写成“已证明”；只沿已登记依赖传播。

### 6.5 `META`（关于其它对象的高阶命题）

典型：“A1 的前提 C 在这次使用中不满足”“数据 D 在方法 M 下不足以区分 P 与 P′”“关联 R 在范围 S 内不适用”。规则：`mention_refs` 必须精确到 revision/路径/条件；结论仍是命题，不直接改写被讨论对象的状态轴（CS-08/CS-09）。

## 7. 生命周期

`登记为 S-L0 命题 → 逐步补全语义（S-L1）→ 可选：形式化候选表示 → 被论证/评价/接纳/质疑（外部记录引用它）→ 需要改变真值条件时新建命题并由 H 链连接`。

允许长期停留：仅 S-L0 的命题、无 World/Scope 的命题、无形式化的命题、被相反评价同时指向的命题、从未被接纳的命题。**没有任何生命周期阶段要求命题必须被证明、形式化或接纳**（DF-07）。

## 8. 例子

**合法例**：`P7@r2` — “在模型 M（`world_ref = E12@r1`）、工况 W1（`scope_refs = [E31@r1]`）、按几何发射度定义 v2（`dimension_binding = C8@r3`）下，束流几何发射度（RMS，未归一化）小于 0.6 π mm·mrad”；`declaration_kind = ENGINEERING_CLAIM`；表示含一个 `APPROXIMATE` 的 FOL 候选并列出新增假设“忽略空间电荷”。S-L1 PASS，`confirmation = UNCONFIRMED`，A7 = `NONE`。

**关键非法/易混淆例**：

| 情形 | 为什么非法 | 正确做法 |
| --- | --- | --- |
| 把 `P7@r2` 的 `world_ref` 从 `M` 改为真实装置，同时保留同一 PropositionID 并声称“同一命题” | 违反 PR-ID-3/PR-ID-4 | 新 Proposition + H 链 + 差异说明（可另立元命题） |
| 在命题上加 `confidence = 0.8` 以便排序 | 违反 §2.4 与 C02 | 程度值只属于特定 Scheme 下的论证结局；或作为科学结果 Entity + 命题 |
| Lean 公式检查通过即把原自然语言命题标注“已验证” | 违反 DF-04/RP-05 | 检查记录只针对 `@rev#representation` 粒度；翻译忠实性另登记审查 |
| 把“搜索反证结果为空”登记为 `is_true = false` 或“P 被证伪” | 违反 DF-05/UN-01 | 登记为“在已检查范围内未找到反证”的条件性命题或检索边界报告 |
| “甲接受 P” 直接投影为甲的接纳状态，尽管无授权依据 | 违反 PR-A1/PR-A2 | 需 `FACT_DESIGNATION` + 授权依据；否则保留为普通命题/评价 |
| 两位作者同文命题被系统自动合并为一个对象 | 违反 ID-07/PR-ID-5 | 两个对象 + 等价候选记录 |
