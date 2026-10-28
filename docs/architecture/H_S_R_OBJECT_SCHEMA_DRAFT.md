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

<!--SLOT_TABLES-->

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
