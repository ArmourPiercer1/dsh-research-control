# 五类对象的 Schema：信封、槽位表与子型注册

> **PR #43 · DRAFT-PROPOSAL · 2026-10-29。** 把五类对象的字段定义编码为规范形态。**字段的语义、必填性与修订判据只在各对象契约中定义一次**（[Entity](H_S_R_ENTITY_CONTRACT_DRAFT.md)、[Concept](H_S_R_CONCEPT_CONTRACT_DRAFT.md)、[Association](H_S_R_ASSOCIATION_CONTRACT_DRAFT.md)、[Argumentation](H_S_R_ARGUMENTATION_CONTRACT_DRAFT.md)、[Proposition](H_S_R_PROPOSITION_CONTRACT_DRAFT.md)，均属 PR #42，未合并）；本文只做机械映射并补充形态约束，凡冲突以契约层为准。编码基线见[Schema 基座](H_S_R_SCHEMA_FOUNDATIONS_DRAFT.md)。**Proposed，不表示已实施。**

## 1. 读法

| 列 | 含义 |
| --- | --- |
| **槽位** | 规范形态中的键名，逐字等于契约阅读名（SF-02） |
| **类型** | 编码类型：`ref`（`obj@rN`，可 `#rep`）、`ref?`（五态包裹的引用）、`rec:`、`text`、`bool`、`decimal`、`time`、`vocab(X)`（注册词表）、`enum(X)`（封闭枚举）、`<object>`、`[]` 表示集合 |
| **状态** | 该槽位允许的存在状态；`D/U/NA/UN/A` 分别对应 `DECLARED/UNKNOWN/NOT_APPLICABLE/UNRESOLVED/ABSENT`（SF-10）。凡列出 `U` 者，如实未知必须 `PASS`（RPT-05） |
| **身份** | `★` = 该对象的身份构成槽位（改其已声明值 → 新建对象，G-REV）；`—` = 非身份槽位；`◐` = 条件性身份槽位（依子型声明，见 §5） |
| **规则** | 契约层规则号（逐字），是本层校验器与规则注册表的锚点 |

**通用形态规则（对五类一律适用）**

| 编号 | 规则 |
| --- | --- |
| SS-01 | 每类对象的载荷对象模型**封闭**（未知键 → 形态非法）。契约层的"禁止字段"清单因此获得机器兜底：没有开放字段，就无处塞 `confidence`/`is_current`/`truth`/`fact_status`（SF-N-02、`SL1-COM-04`、`SL1-ASS-06`、`SL1-PRO-08`）。 |
| SS-02 | 每个槽位的值都是**带标签值**（SF-10）；无标签的裸值 → 形态非法（`SL1-COM-03`）。 |
| SS-03 | 关系类与使用类反向清单**不作为槽位存在**：Entity 内不得有 `upstream`/`uses`/`used_in[]`/`operating_context_refs[]`，Association 内不得有冲突/替代内联字段（`SL1-ENT-05`、`SL1-ENT-08`、`SL1-ASS-07`、EN-W-5）。它们只在查询时以派生视图出现。 |
| SS-04 | 状态轴 A1–A8 **不是对象字段**：可持久化的只有产生轴值的记录（采用记录、评价命题、接纳声明、可用性检查记录、构造状态槽位等）；不得出现单一 `status`/`state` 汇总槽位（AX-01、SF-N-02）。 |
| SS-05 | 端点/参与者的引用只能是五类对象精确引用，不能是 `rec:`（SF-24、RF-05）。原始记录要成为论证输入必须走对象化路径（RF-06）。 |
| SS-06 | 每个对象修订必须携带 `recorded_at`、写入事件产生的 `registrant_ref` 与 `source_refs`（五态之一）；`registrant_ref` **不可** `UNKNOWN`（由宿主注入，IC-02、`SL1-ASS-05` 同理适用于全部对象）。 |
| SS-07 | 修订专有槽位：`revision_id`、`revision_class`、`reason`、`completion_basis`（补全分支必填）、`expected_head_revision` 的满足记录；`completion_basis = UNDETERMINED` 时不得产生身份迁移（RV-06）。 |
| SS-08 | 载荷中任何 `ref` 都不得由内容哈希派生；任何集合的排序语义必须由子型注册表声明（序敏感/序无关，SF-51）。 |

## 2. 信封（五类共用，`payload` 之外）

```
ObjectRevisionEnvelope = {
  object_id, object_kind, space_id,
  revision_id, schema_version,
  recorded_at, registrant_ref, source_refs,
  subtype_code,                    // 指向子型注册表（§5），决定载荷槽位集
  identity_slot_set_digest,        // 该子型当时声明的身份构成槽位集合摘要（只读校验用）
  completion_basis?,               // 补全分支
  payload
}
```

| 编号 | 规则 |
| --- | --- |
| SS-10 | `object_kind` 与 `space_id` 在 `r1` 固定且**永不出现在后续修订的可变部分**（ID-01、ID-02）；`hsr_revision_append` 提交这两个槽位即 `TOOL_INPUT` 拒绝（SI-10）。 |
| SS-11 | **不存 `head_revision` 或 `is_head`**：链首是登记簿的派生属性，写进记录就变成可被写歪的第二真源（AX-03、DF-03）。查询 `version_selection = latest` 只用于导航（ID-05、SF-23）。 |
| SS-12 | `identity_slot_set_digest` 记录"当时该子型声明了哪些身份构成槽位"，使旧修订的判定可**按当时的声明**重放；它不改变契约层的身份判据，只是防漂移（SF-60、RV-04）。 |
| SS-13 | `subtype_code` 必须解析到子型注册表条目；解析不到 → 保存成功 + `FAIL(SUBTYPE_UNREGISTERED, DEFICIENCY)`（SRG-21）。 |
| SS-14 | 非对象记录（检查报告、采用记录、可用性检查、H 原始记录、Assertion 链成员声明）**不使用本信封**：它们有各自的记录形态，且不得被赋对象引用类型（ID-08、SCR-01、SF-24）。 |

## 3. 五类对象载荷槽位表

本节按对象分节给出槽位表。**槽位语义、必填性与修订判据以契约层为准**；"状态"列只声明编码层允许写入哪些状态，"身份"列按契约层身份构成表填写（`◐` = 依子型声明的条件性身份槽位）。

### 3.1 Entity（源：Entity 契约 §2–§4）

| 槽位 | 类型 | 状态 | 身份 | 规则 |
| --- | --- | --- | --- | --- |
| `entity_subtype` | `subtype_code`（子型注册表） | D（不允许 `UNKNOWN`：无法归类先按原始材料登记） | ★ | EN-01、EN-03、EN-ID-7 |
| `designated_name` | text | D / A | — | EN-ID-1 |
| `aliases[]` | `{alias: text, source: ref? \| rec:, claimed_interval: time?}` 集合 | D / A（空集合合法且必须显式，SF-14） | — | EN-ID-1、`SL1-COM-03` |
| `external_identifiers[]` | `{identifier: text, identity_scope: text, source: ref?}` 集合 | D / U / A | ◐ 仅 `ExternalResourceRef` 子型构成身份 | EN-ID-1 |
| `world_membership` | `{kind_ref: ref?（Concept@rev，仅分类）, individual_ref: ref?（Entity@rev，世界个体）}` | D / U（整槽可 `UNKNOWN(reason)`） | `individual_ref` ★（已声明时改变 → 新 Entity）；`kind_ref` — | EN-W-1、EN-W-2、EN-W-3、EN-W-6、RV-01、RV-06 |
| `source_refs[]` | `(ref \| rec:)` 集合（来源可为 H 记录，属 `PROVENANCE`） | D / A（**不得**由系统猜测来源） | — | IC-02、UN-02、C12 |
| `carrier_refs[]` | `{carrier_ref: ref \| rec:, source: ref?}` 集合 | D / NA(带 reason，数学/理想化个体无载体) / A | — | EN-ID-4（增载体/迁移是修订） |
| `content_digest` | `{algorithm, value}` | D / U / A | ◐ 快照模式内容个体与配置个体（完整内容构成身份） | EN-ID-3、EN-ID-4、SF-52 |
| `availability_checks[]` | `rec:` 集合（每次检查一条 A8 记录） | D / A | — | EN-MS-1、EN-MS-2、EN-MS-3、`SL1-ENT-04` |
| `execution_state` | `vocab(execution_state)`（`PLANNED/IN_PROGRESS/COMPLETED/ABORTED/FAILED`，开放） | D / U / A（非活动子型 → NA 带 reason） | ◐ 活动个体：与 `occurred_interval` 的已声明组合构成身份 | `SL1-ENT-07`、EN-ID-5 |
| `occurred_interval` | time（可开区间） | D / U / A | ◐ 活动个体 | EN-ID-5、EN-ID-6、`SL1-COM-06` |
| `used_intervals[]` | `{interval: time, claim: text, source: ref?}` 集合 | D / A | — | C01、T-01 |
| `service_intervals[]` | `{interval: time, claim: text, source: ref?}` 集合 | D / A | — | T-01、T-02 |
| `retirement_claim` | `{time, reason, source}` | D / U / A | — | EN-LC-3（退役是声称，不使对象失效） |
| `version_of` | `ref?`（`PROVENANCE` 类别） | D / U / A | — | EN-ID-3、EN-ID-4 |
| `operating_context_view` | **无槽位**（只允许出现在查询投影） | 不可写 | — | EN-W-5、`SL1-ENT-08` |
| 替代/后继关系 | **无槽位**（由 Association 记录承载） | 不可写 | — | RV-02、EN-ID-2、N-06 |
| 禁止键 | `is_available`、`is_currently_retrievable`、`is_deleted`、`is_valid`、`is_current`、`confidence_score`、`truth_value`、`upstream_of`/`used_by`/`next_to`、任何 latest 指针、任何由 A8 推导的汇总布尔 | 出现即形态非法 | — | `SL1-ENT-04`、`SL1-ENT-05`、`SL1-ENT-08`、`SL1-COM-04`、AX-01 |

**Entity 编码要点**

| 编号 | 规则 |
| --- | --- |
| SS-30 | `world_membership` 的两半各自是独立带标签引用，**禁止**合并为单值或一字段两义；写入 `world_membership: "M"` 这类裸值即形态非法（EN-W-6、SF-02）。 |
| SS-31 | 身份判据的编码落点是**子型注册表**：`identity_slots` 由子型声明（§5），记录不自声明；`execution_state`+`occurred_interval` 仅活动子型计入（EN-ID-5/EN-ID-8）。 |
| SS-32 | 时间类槽位一律用 §5 时间形态，且 `occurred_interval`/`used_intervals[]`/`service_intervals[]` 与 `recorded_at` 是**不同槽位**，任何互相填充即 `SL1-COM-06` FAIL（T-01、T-02）。 |
| SS-33 | 可用性只有记录集合形态，无布尔槽位；A8 的最新值只由投影计算（`SL1-ENT-04`、AX-01）。 |
| SS-34 | 来源允许 `rec:`，端点不允许：`source_refs[]` 可含 H 记录，但 Entity 作为论证/关联端点时必须是对象精确引用（SS-05、RF-05、RF-06）。 |

### 3.2 Concept（源：Concept 契约 §2–§4、§7、§8）

| 槽位 | 类型 | 状态 | 身份 | 规则 |
| --- | --- | --- | --- | --- |
| `concept_subtype` | `subtype_code` | D（不允许多值） | ★ 不可变（子型变化 = 新 Concept） | CO-ID-5 |
| `preferred_label` | `{text, language}` | D / U | — | CO-ID-3（LEXICAL 修订） |
| `alt_labels[]` | `{text, language}` 集合 | D / A（空合法） | — | CO-REV-3 |
| `lexical_notes[]` | text 集合 | D / A | — | CO-REV-2 |
| `language` | `vocab(ietf_language)` | D / U | — | SS-43 |
| `definition_text` | `{text, language}` | D / U(reason) / A | — | CO-REV-5 |
| `definition_version_claim` | `{claim ∈ {UNCHANGED, CHANGED}, change_basis}` | D / **A 非法于修订** | — | CO-REV-1、RPT-07 |
| `revision_class` | `vocab(revision_class)`（种子 `LEXICAL/SUBSTANTIVE`） | D / A 非法于修订 | — | CO-REV-1、CO-REV-4、`SL1-CON-02` |
| `domain_scope` | `{scope_kind, scope_ref: ref?}` | D / U / A | — | CO-REV-6 |
| `broader` | `ref?` | D / U / A | — | CO-SKOS-1 |
| `standard_vocabulary_alias` | 标准 URI（仅精确等价） | D / A | — | CO-SKOS-2、DF-10 |
| `predicate_signature[]` | `{role, type_ref: ref?, dimension_ref: ref?, world_constraint: ref?}` 集合 | D / U / A（空合法） | ★ 参数/类型/量纲变化 → 新 Concept | CO-ID-4、CO-REV-5、`SL1-CON-04` |
| `quantifier_scope` | `{kind ∈ vocab, scope_ref: ref?}` | D / U / A | ★ 量词类型变化 → 新 Concept | CO-REV-5 |
| `hard_constituent_set` | 硬含义构成集声明（签名/量词/尺度等的集合化声明） | D / U | ★（越过硬集合 → 新 Concept） | CO-REV-5、RD-23 |
| `scheme_input_roles[]` | `{role_name, allowed_kinds[], cardinality, required}` 集合 | D / A（非 Scheme 子型 → NA 带 reason） | ★ 必需集合/角色类型约束变化 → 新 Concept | SCHEME-1 |
| `scheme_condition_slots[]` | `{slot_name, meaning, on_failure}` 集合 | D / A（空合法；`on_failure` 缺省即规范默认） | ★ 槽位删除/含义变化 → 新 Concept | SCHEME-2 |
| `scheme_target_form` | `{conclusion_form = PROPOSITION_REVISION, discussion_forms[]}` | D（**不可** `UNKNOWN`） | ★ | SCHEME-3、ID-05、DF-03 |
| `scheme_outcome_vocabulary[]` | `{outcome, meaning}` 集合 | D / U（词表未定，报告记待补） / A | ★ 条目含义变化 → 新 Concept | SCHEME-4、`RL1-05` |
| `degree_scale_declaration` | `ref?`（DegreeScaleDefinition）或显式"不产生程度值"声明 | D / U / A | ★ 尺度变化 → 新 Concept | SCHEME-5、`RL1-08` |
| `scheme_composition_permission` | `composition_roles[] = {role_name, direction ∈ {OUTPUT_AS, INPUT_AS}, target_scheme: ref?, requires_conclusion, alignment_refs[], condition_carrying}` | D / U（未声明 = 无许可，默认关闭） / A | — | SCHEME-6、CN-03、CN-05、CN-06、`RL1-14` |
| `critical_questions[]` | `{question, template_ref: ref?, blocking = false}` 集合 | D / A | — | SCHEME-7、D15 |
| `world_type_declaration`（WorldType 子型） | 开放类型声明（**禁止**封闭取值集合） | D / A | — | CO-W-1、`SL1-CON-03` |
| `frame_dimensions[]` / `frame_options[]`（ResearchFrame 子型） | 维度/选项定义集合，option 标识唯一 | D / A | — | `SL1-CON-07`、CO-W-3、CO-W-4、CO-W-6 |
| 禁止键 | `is_correct`、`truth_value`、`recommended_definition`、`is_current`、latest 指针、`auto_merged_into`、`scientific_validity_score`、任何信任阶梯字段 | 出现即形态非法 | — | `SL1-COM-04`、ID-07、D13 |

**Concept 编码要点**

| 编号 | 规则 |
| --- | --- |
| SS-35 | `definition_version_claim` 与 `revision_class` 是**修订专有槽位**，每次修订必填且不得 `ABSENT`（CO-REV-1）；校验器只比较"声明"与"实际改动的键集合"，不判语义实质（RPT-07、`SL1-CON-02`）。 |
| SS-36 | `hard_constituent_set` 与 `concept_subtype` 一起进入子型注册表的 `identity_slots`；`definition_text` 的措辞变化不是身份变化（软区修订，RD-23）。 |
| SS-37 | Scheme 专有槽位对非 Scheme 子型必须是 `NOT_APPLICABLE(reason)` 或整槽缺省为 NA，**不得**留空对象伪装适用（SF-14）。 |
| SS-38 | `composition_roles[].requires_conclusion` 是布尔必填：缺该键 → `FAIL(COMPOSITION_ROLE_UNDECLARED)`；与"接受 `NONE_DECLARED` 填充"同时为真 → `FAIL(COMPOSITION_ROLE_CONTRADICTION)`（SCHEME-6）。 |
| SS-39 | `standard_vocabulary_alias` 只在精确等价时存在，且**不**参与身份判定；`closeMatch` 级别的关系不得写入本槽位（CO-SKOS-2、DF-10）。 |

### 3.3 Association（源：Association 契约 §3、§5）

| 槽位 | 类型 | 状态 | 身份 | 规则 |
| --- | --- | --- | --- | --- |
| `relation_type_ref` | `ref`（Concept@rev，关系类型定义） | D（不允许 `UNKNOWN`；类型未定须先登记候选类型 Concept） | ★ | `SL1-ASS-01`、AS-ID-2 |
| `participants[]` | `{role_ref, endpoint_ref: ref, is_standard_subject?: bool}` 集合（≥2） | D | ★（端点或角色改变 → 新关联；`UNRESOLVED → 已登记` 是修订） | `SL1-ASS-02`、AS-ID-3、SS-05 |
| `directionality` | `enum(DIRECTED / SYMMETRIC / UNSPECIFIED)` | D | ★ 不可变 | `SL1-ASS-03`、AS-ID-6 |
| `described_interval` | `{kind ∈ enum(TIMEPOINT, INTERVAL, UNTIL_REVOKED, TIMELESS), from: time?, to: time?}` | D / U(reason) / A | ◐ `UNKNOWN → 区间` 修订；`区间 A → 区间 B` 新关联 | `SL1-ASS-04`、AS-ID-1、AS-ID-4、CS-01、SF/A-06 |
| `applicability_context` | `(ref)` 集合（World/Scope/配置语境） | D / U | ◐ 实质改变适用范围 → 新关联 | AS-ID-1 |
| `source_assertion` | `{registrant_ref, actor_ref?, voice ∈ enum(SELF, REPORTED, IMPORTED, TOOL_OUTPUT), basis_refs[]}` | `registrant_ref` D（不可 `UNKNOWN`，由写入事件赋予）；`actor_ref` D / U | `registrant_ref` 非身份（可变来源注记？否：不可变）；`actor_ref` — | `SL1-ASS-05`、RD-35、IC-02 |
| `recorded_via` | `rec:`（登记事件） | D（H 侧必须存在） | ★ 不可变（H 拥有） | IC-02 |
| `standard_predicate_alias` | 标准 URI（仅精确等价） | D / A | — | N-04、DF-10 |
| 冲突/替代/采用内联字段 | **无槽位**（冲突与替代是独立主张记录；采用是独立记录） | 不可写 | — | `SL1-ASS-07`、`SL1-ASS-08`、AS-CF-1、AD-01 |

采用记录（非对象记录，`rec:` 可引用）：`{adopter_ref, adopted_ref: ref, adoption_scope, adoption_at, basis_ref}`；`adopted_ref` 必须精确、禁 latest；`basis_ref` 允许 `UNKNOWN`（AD-01…AD-04、`SL1-ASS-08`）。

### 3.4 Argumentation（源：Argumentation 契约 §3–§6）

| 槽位 | 类型 | 状态 | 身份 | 规则 |
| --- | --- | --- | --- | --- |
| `scheme_ref` | `ref`（Concept@rev，InferenceSchemeDefinition） | D（不允许 `UNKNOWN`） | ★ 换 Scheme → 新论证 | `RL0-01`、`RL0-02`、AR-ID-2 |
| `engagement_target` | `ref?` 或 `NONE` | D / A(`NONE`) | ★ 不可变 | `RL1-03`、AR-ID-2 |
| `engagement_role` | `vocab(engagement_role)` | D / U | ◐ `SUPPORTS → ATTACKS` 视同换目标 | AR-ID-2 |
| `conclusion` | `{mode ∈ enum(ASSERTS, DENIES_TARGET, ASSERTS_ABOUT_TARGET, NONE_DECLARED), proposition_rev: ref?}` | D / A | ★ 结论内容改变 → 新论证 | `RL1-04`、CN-01、CN-02、AR-ID-2 |
| `conclusion_vs_target` | `enum(SAME, NEGATION, META_ABOUT_TARGET, UNRELATED_BY_SCHEME)` | D / U / A | — | `SL1-ARG-S1` |
| `input_bindings[]` | `{binding_id, role_name, endpoint_ref: ref?, endpoint_kind, role_kind ∈ enum(CONCLUSION_INPUT, BACKGROUND, CASE_STUDY, SUBJECT_OF_DISCUSSION), alignment_claim, notes}` 集合 | 槽位 D；元素可 `UNBOUND(reason)`（等价呈现为未绑定，判定不受 reason 影响） | `binding_id` 稳定（重排等价改身份） | `RL1-01`、`RL1-02`、`RL1-14`、RPT-06、CS-06、AR-ID-5 |
| `alignment_claims[]` | `{from_ref, to_ref, relation ∈ enum(EXACT_MAP, DECLARED_MAP, ASSUMED, UNKNOWN), basis_ref}` 集合 | D / A | — | `RL1-10`、CS-12、CS-13 |
| `shared_dependency_refs[]` | `ref` 集合 | D / U / A | — | `RL1-11`、C09 |
| `support_paths[]` | `{path_id, premise_refs[]}` 序列（序敏感，`path_id` 不重排） | D / A | `path_id` 稳定 | `RL1-06`、C08、AR-ID-5、SF-51 |
| `path_conditions[]` | `{condition_id, condition_prop_rev: ref, status ∈ enum(ASSERTED, OPEN, DISCHARGED, CONTESTED, UNKNOWN), path_scope[], discharge_basis?}` 集合 | D / A | `condition_id` 稳定 | `RL1-07`、`RL1-13`、CS-08、C07 |
| `degree_value` | `{value: decimal, scale_ref: ref?, allowed_operations[]（可为空集 `NONE`）, declared_range}` | D / U / A | — | `RL1-08`、CS-10、SF-40、SF-41 |
| `local_outcome` | `vocab(scheme_outcome)`（取值域 = Scheme 声明词表）+ 声明者 + 时间 | D（`NONE_YET` 合法） | — | `RL1-05`、C02、CN-04 |
| `construction_state` | `enum(DRAFT, SUBMITTED, CLOSED_DRAFT, WITHDRAWN, TERMINATED_BY_SCOPE)` | D | — | AR-ID-4、C03、A1 轴 |
| `applicability_records[]` | `rec:` 集合（A5 载体） | D / A | — | CS-09、AD-02 |
| `verification_records[]` | `rec:` 集合（报告引用） | D / A | — | C11、RPT-01、`verification_status` 非字段 |
| `composition_records[]` | `rec:` 集合 | D / A | — | C06 |
| `obligation_refs[]` | `ref` 集合（证明义务） | D / A | — | D15、`RL1-*` 义务面 |
| `attack_links[]` | `{kind ∈ enum(REBUT, UNDERCUT), target_argumentation_rev: ref, target_path?, target_condition?, meta_proposition_rev?}` 集合 | D / A | — | `RL1-09`、`RL1-15`、CN-04、CS-09 |
| `inference_method` / `logical_force` | `vocab(...)` | D / U | — | `SL1-*`（与 Scheme 声明一致性只查声明） |
| `verification_status` / `current_status` | **无槽位**（派生视图） | 不可写 | — | RPT-04、AX-03 |
| 禁止键 | `confidence`、`support_score`、`is_valid`、`truth_value`、单一 `status` 汇总 | 出现即形态非法 | — | `SL1-COM-04`、NEV-06 |

### 3.5 Proposition（源：Proposition 契约 §2、§3、§6）

| 槽位 | 类型 | 状态 | 身份 | 规则 |
| --- | --- | --- | --- | --- |
| `proposition_subtype` | `subtype_code`（`PLAIN/ASSESSMENT/FACT_DESIGNATION/DECISION_BASIS/PROOF_OBLIGATION/META`） | D（不可变） | ★ | `SL1-PRO-09` |
| `primary_expression` | `{text, language}` | D（不得 `UNKNOWN`；原文残缺按原始材料登记） | ◐ 数值/量词/构成性定义变化 → 新命题 | `SL1-PRO-01`、PR-ID-3 |
| `declaration_kind` | `vocab(declaration_kind)` | D / U / A | — | PR-ID-1 |
| `sublanguage_tag` | `ref?` | D / U / A | — | `SL1-PRO-05` |
| `representations[]` | `{representation_id, representation_kind, text, language, equivalence_claim: {claim ∈ enum(SAME_TRUTH_CONDITIONS, APPROXIMATE, DISPUTED, UNKNOWN), declarant_ref: ref?, basis_refs[], added_assumptions[]}}` 集合 | 槽位 D / A（空合法）；元素内 `equivalence_claim` 缺 = `ABSENT`（≠ `UNKNOWN`） | — | `SL1-PRO-02`、`SL1-PRO-03`、`SL1-PRO-04`、RP-03、RP-04、RP-05、CS-22 |
| `concept_refs[]` | `ref` 集合（`SEMANTIC`） | D / U / A（空合法） | ◐ 构成性定义版本改变 → 新命题 | `SL1-COM-01`、PR-ID-3 |
| `world_ref` | `{individual_ref: ref?（Entity@rev，具体世界）, kind_ref: ref?（Concept@rev，泛指类别）}` | D / U | ★ 具体世界改变 → 新命题 | `SL1-PRO-05`、PR-ID-3、PR-ID-4、EN-W-6 |
| `scope_refs[]` | `ref` 集合 | D / U（空须显式 `UNKNOWN`） | ★ 范围增删改变真值条件 | `SL1-PRO-05`、PR-ID-3 |
| `variable_bindings[]` | `{variable, quantifier, domain_ref: ref?}` 集合 | D / U / A | ★ 量词类型改变 | `SL1-PRO-05`、PR-ID-3 |
| `dimension_binding[]` | `ref` 集合 | D / U / A | ★ 定义版本改变 | `SL1-PRO-05`、PR-ID-3、RP-06 |
| `condition_refs[]` | `ref` 集合 | D / U / A | ★ 条件实质替换/增删 | `SL1-PRO-05`、CS-08 |
| `mention_refs[]` | `{target: ref \\| rec:, role ∈ enum(SUBJECT, CONTEXT, TARGET_OF_CLAIM, COMPARATOR, SELF)}` 集合 | D / A | — | `SL1-PRO-07`、RF-05 |
| `truth_condition_claim` / `completion_basis` / `change_basis` | 修订专有 | D / A 非法于修订 | — | PR-ID-4、RV-01、RV-06 |
| `assertion_chain_ref` | `rec:`（链成员声明） | D / A | — | ID-06 |
| `confirmation_refs[]` | `rec:` 集合（A3 派生源） | D / A | — | IC-S6、`SL1-*` |
| 子型专有：`assessor_ref` / `target` / `stance` / `basis_refs[]`（ASSESSMENT） | `ref` / `ref` / `vocab` / `ref` 集合 | D（缺失 → FAIL 于 S-L1，不阻断保存） | — | `SL1-PRO-09`、CS-11 |
| 子型专有：`designator_ref` / `authority_basis_ref` / `action` / `target_proposition_rev` / `effective_time`（FACT_DESIGNATION） | `ref` / `ref?` / `enum(ACCEPT, SUSPEND, WITHDRAW)` / `ref` / `time` | D / `authority_basis_ref` U | — | `SL1-PRO-09`、PR-A1…A4、SP-09 |
| 禁止键 | `truth_value`、`probability`、`fact_status`、`is_true`、`confidence`、单一 `status` | 出现即形态非法 | — | `SL1-PRO-08`、`SL1-COM-04` |

**Proposition 编码要点**

| 编号 | 规则 |
| --- | --- |
| SS-45 | `representations[].equivalence_claim` **缺键 = `ABSENT`**，与 `{"@st":"UNKNOWN"}` 语义不同，两者都进 `declared_gaps` 且都 `PASS`（RP-03、UN-03）；校验器不得把缺键渲染成"等价性未知"。 |
| SS-46 | `SAME_TRUTH_CONDITIONS` 且 `added_assumptions[]` 非空 → 形态级 FAIL（`SL1-PRO-04`、CS-22）；这是**形态矛盾**检查，不判等价性真伪（RPT-07）。 |
| SS-47 | `world_ref` 的两半角色分离与 Entity 的 `world_membership` 同构（SS-30）；`representation_id` 是对象内稳定标识，不复用、不随内容变（A-05）。 |
| SS-48 | 命题端的 `mention_refs[].target` 允许 `rec:`（高阶命题讨论 H 记录），但它**不是**论证端点：论证绑定仍受 SS-05 约束（RF-05）。 |



## 4. 定义类 Concept 的载荷纪律

| 编号 | 规则 |
| --- | --- |
| SS-40 | 关系类型、推理 Scheme、程度尺度、WorldType、量纲/单位、采用政策都是 **Concept 对象**（有自己的 `object_id`/修订/来源/被引用关系），不是词表项（SRG-01）。"注册表"就是这些对象的集合 + 查询，不是另一套枚举。 |
| SS-41 | Scheme 声明面必须逐子字段可编码：输入角色（角色标识 + 基数 + 允许端点类别）、`conclusion_policy`、结局词表、对齐要求、独立性声明、`gap_crossing` 要求、组合角色声明（角色标识 + 方向 + 目标 Scheme + `requires_conclusion` + 条件承载）。缺子字段 → 按 `RL1-*`/`SCHEME-*` 对应 FAIL，不得用缺省值补齐（RPT-05、SF-N-03）。 |
| SS-42 | Scheme 的输入角色标识（契约层的 `role_name`）与绑定侧的结论资格类（`role_kind`）是**两个不同槽位**：前者是 Scheme 内部的角色身份，后者是本次绑定的资格类。二者不得合并、不得互相推导（本层登记为对契约层的澄清请求 A-02）。 |
| SS-43 | 词法槽位（label/altLabel）与含义槽位（definition/signature/hard constituents）分属不同子对象，使 `SL1-CON-02` 的"声明 vs 实际改动字段集"一致性可被机器比较（只比**改了哪些键**，不判语义实质，RPT-07）。 |
| SS-44 | WorldType 声明面禁止出现封闭取值集合（`SL1-CON-03`）；WorldContext 个体身份由 Entity 侧 `world_membership.individual_ref` 承载（EN-W-6）。 |

## 5. 子型注册表（把"子型声明的参数"变成形态）

契约层多处把参数下放到子型声明（如 Association 子型可声明 `actor_required = true`、Entity 子型决定专有槽位、Proposition 子型决定专有字段）。编码层必须有承载处，否则这些声明无处落地：

```
subtype_entry = { subtype_code, kind, slot_set[], identity_slots[],
                  declared_params{ actor_required?, resource_required?, allowed_endpoint_kinds?, ... },
                  order_sensitive_slots[], introduced_in, deprecated_in?, contract_ref }
```

| 编号 | 规则 |
| --- | --- |
| SS-50 | 子型注册表决定**槽位集**与**身份构成槽位集**；对象记录不得自我声明身份槽位（否则每条记录可自行放宽身份判据，RV-04 失效）。 |
| SS-51 | `declared_params` 只接受注册表声明过的参数名；未知参数名 → 注册表条目非法（与记录侧同理的封闭模型）。 |
| SS-52 | 子型条目变更槽位集或身份槽位集 → 新版本；已登记记录按其 `identity_slot_set_digest` 重放（SS-12、SF-62）。 |
| SS-53 | 子型退役不删除：`DEPRECATED` 条目永久可解析（SF-64）。 |

## 6. 负面清单（构造层拒绝）

`{"@st":"DECLARED","v":[]}`；缺 `@st`；缺槽位；`UNKNOWN` 带 `v`；集合元素位放 `NOT_APPLICABLE`/`UNKNOWN`（SF-14）；无版本引用、`latest`、`space:` 前缀；`rec:` 赋给端点槽位；Entity 内关系/使用清单；Association 内冲突/替代内联字段；任何 `confidence`/`score`/`truth`/`is_current`/`fact_status`/单一 `status`；对象内 `head_revision`/`is_head`；子型自声明身份槽位；把 Scheme/关系类型写成字符串码（SRG-01）。

## 7. 落地的最小验证预期（供后续测试设计，非已运行）

1. 五类各一个最小合法实例；一个"允许未知处全部如实 `UNKNOWN`"实例仍 `S-L1 ACHIEVED` 且 `declared_gaps` 完整（RPT-05）。
2. 每条 §6 负面构造各自被拒，且**只有**一条对应规则 FAIL（可定位性）。
3. 身份槽位改动被要求转新建（G-REV、各 `*-ID-*`）；`completion_basis` 分支矩阵（三值 × 是否改变真值条件）全覆盖。
4. 子型参数生效检查：同一字段在 `actor_required = true` 与默认子型下分别 FAIL/PASS（`SL1-ASS-05`）。
5. 派生视图不被持久化：尝试写入 `used_in[]`/冲突内联字段 → 拒绝（`SL1-ENT-08`、`SL1-ASS-07`）。
6. 信封不变量：`object_kind`/`space_id` 在修订分支被拒；`head_revision` 无法写入。
7. 摘要重放：旧修订用其 `identity_slot_set_digest` 重放判定，结果与当时一致。

## 8. 本层尚未裁决的内容

字段的存储布局与索引；跨对象约束的执行顺序与传播（属校验器）；载荷压缩与投影裁剪；具体表达语言的形式化 AST（S-L2 扩展点）；导出 Profile 的字段选择（属导出层）。
