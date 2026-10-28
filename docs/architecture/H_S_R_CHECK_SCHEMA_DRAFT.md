# 检查报告与规则注册表的 Schema

> **PR #43 · DRAFT-PROPOSAL · 2026-10-29。** 把[规范化契约](H_S_R_NORMALIZATION_CONTRACT_DRAFT.md)（PR #42，未合并）的 `CheckReport`、`finding`、`level_result`、`declared_gap`、`coverage`、两视图与规则编号落到编码层。**判定语义由规范化契约裁决，本文只裁决形态**；凡冲突以契约层为准。编码基线见[Schema 基座](H_S_R_SCHEMA_FOUNDATIONS_DRAFT.md)。**Proposed，不表示已实施。**

## 1. 报告记录形态（真源 = 审计视图）

```
CheckReport = {
  report_id, report_digest,
  target,                     // 被检对象的精确引用
  subject_space,
  contract_version, schema_version, rule_set_version,
  checker { id, version, env_ref },
  checked_at,                 // 带 @st 的时间槽（SF-30 系）
  level_results[], findings[], declared_gaps[],
  coverage
}
```

| 编号 | 规则 |
| --- | --- |
| SCR-01 | 报告是**非对象记录**（ID-08）：有 `report_id`，可被 `rec:` 引用（SF-24），但**没有** `object_id`/`revision_id`，也不得被赋给对象引用槽位。 |
| SCR-02 | `target` 是精确引用：`"${object_id}@${revision_id}"` 或带表示片段，**或** `rec:` 形式（可用性检查记录等被检目标）。缺 `@rev` → 形态非法。 |
| SCR-03 | 三个版本字段（`contract_version`、`schema_version`、`rule_set_version`）**全部必填**，缺一即形态非法：报告必须可追溯到"当时按哪套规则判的"（RPT-01、SF-63）。 |
| SCR-04 | `checker` 记录检查器标识与版本；`env_ref` 是可选的 `rec:` 或精确引用（计算基/规则环境），未声明 → 五态之一，不得省略键。 |
| SCR-05 | 报告对象模型是**封闭**的：未知键 → 形态非法。这是 RPT-04（报告不得含科学判真）与 SF-N-02 在 Schema 层的机器兜底——没有开放字段，就无处塞"充分性/置信度/通过率"。 |
| SCR-06 | 报告一经写入永不改写；重检产生新 `report_id`（RPT-01、SI-61）。`report_digest` 是其规范字节形态的摘要，用于回放核验，不是身份（SF-52）。 |

## 2. `finding` 形态

```
finding = { finding_id, rule_id, outcome, severity?, field_path?, reason_code?, note? }
```

| 编号 | 规则 |
| --- | --- |
| SCR-10 | `outcome` 是封闭枚举 `{"PASS","FAIL","NOT_APPLICABLE","INDETERMINATE"}`；`severity` **仅当** `outcome = FAIL` 时存在且 ∈ `{DEFICIENCY, VIOLATION}`，其余取值携带 `severity` → 形态非法。 |
| SCR-11 | `NOT_APPLICABLE` 与 `INDETERMINATE` **必须**携带 `reason_code`；`INDETERMINATE` 的 `reason_code` ∈ `{WITHHELD_REFERENCE, CHECKER_UNAVAILABLE, DEPENDENCY_MISSING, RULE_UNREGISTERED}`（契约层 §1.2 原文四值，封闭）。缺失或越界 → 形态非法。 |
| SCR-12 | `field_path` 是 RFC 6901 JSON Pointer，指向**规范形态**中的槽位（如 `/fields/world_ref`、`/fields/input_bindings/3/role_kind`）。检查项不依赖具体序列化偏移或数据库列。 |
| SCR-13 | `rule_id` 必须解析到规则注册表条目（SCR-40）；解析不到 → 该 finding 本身非法，整份报告按 `INDETERMINATE(RULE_UNREGISTERED)` 记录一条 finding，而不是静默丢弃（对应契约层 `INDETERMINATE` 理由）。 |
| SCR-14 | finding **不得**携带：分数、权重、聚合支持度、真值、置信度、"建议补全值"。`note` 只可是文本说明，且不得被呈现层用来暗示缺失值应为某具体值（UN-02、SF-N-03）。 |

## 3. `level_result` 与层级归约

```
level_result = { level, verdict }    // level ∈ {"S-L0","S-L1","R-L0","R-L1"}
```

| 编号 | 规则 |
| --- | --- |
| SCR-20 | `verdict ∈ {"ACHIEVED","NOT_ACHIEVED","INDETERMINATE"}` 是**审计视图**归约值，按契约层 RPT-02 的唯一顺序计算（`FAIL` 优先）。`UNVERIFIABLE_TO_YOU` **不是**存储取值——它是呈现层对脱敏调用者的替代呈现（RPT-10、SCR-51）。 |
| SCR-21 | 归约是**可重算的派生值**：报告同时保留全部 findings，任何人可用同一规则重算出同一 verdict；存储 verdict 只为免重算与可追溯，不得反过来覆盖 findings。 |
| SCR-22 | 未涉及的层级**不出现**在 `level_results[]` 中（非论证对象没有 `R-*` 项）；"该层级不适用"与"该层级未检查"由 `findings` 中的 `NOT_APPLICABLE` 项与规则注册表的适用范围共同说明，不得用空数组或 `null` 表达。 |
| SCR-23 | 报告**不得**含跨层级总分、总评、等级百分比（NEV-06、SF-N-02）。 |

## 4. `declared_gaps` 与 `coverage`

| 编号 | 规则 |
| --- | --- |
| SCR-30 | `declared_gaps[] = {gap_id, field_path, state, note}`，`state` 复用 §3 的存在状态标签（`UNKNOWN(reason)` / `UNRESOLVED(ref)` / `ABSENT`）；它**不是** finding，不参与层级计算（契约层 §1.2、RPT-00）。编码上的隔离方式：两者是**不同数组、不同形态**，无共用类型。 |
| SCR-31 | 排序：`declared_gaps[]` 按 `field_path` 码位序、`findings[]` 按 `(rule_id, field_path)` 码位序写入规范形态（SF-50），使两份实现产出的报告可逐字节比较（SCR-60）。 |
| SCR-32 | `coverage ∈ {"COMPLETE","INCOMPLETE_DUE_TO_VISIBILITY","NOT_DISCLOSED"}` 是**报告级**字段，独立于 `level_results` 与 `declared_gaps`，不参与归约（RPT-02）。 |
| SCR-33 | **存储层的 `coverage` 永不取 `NOT_DISCLOSED`**：`NOT_DISCLOSED` 是呈现值（SP-03、RPT-03 的对外降级）。真源写 `COMPLETE` 或 `INCOMPLETE_DUE_TO_VISIBILITY`；对无可见权调用者由脱敏函数改写为 `NOT_DISCLOSED`（SCR-50）。落盘 `NOT_DISCLOSED` 会把"谁看不见"写进真源，污染审计（SP-10）。 |

## 5. 两视图的编码：只存一份，脱敏在呈现层

| 编号 | 规则 |
| --- | --- |
| SCR-50 | **不为任何调用者存储脱敏副本**（SF-13 的镜像）：真源只有完整审计报告；`presented_view = sanitize(canonical_report, authority_class)` 每次读取现算。理由：预存副本会（a）把"某主体看不到某物"写成记录，（b）让脱敏规则变更无法回溯生效，（c）制造第二份可被误广播的真源（SP-10、RPT-09）。 |
| SCR-51 | `sanitize()` 的形态映射固定：`FAIL(REF_UNRESOLVED)` 与 `INDETERMINATE(WITHHELD_REFERENCE)` 两条 finding 合并为**一条** `UNVERIFIABLE_REFERENCE`（`outcome = INDETERMINATE`，对外码 `UNVERIFIABLE_REFERENCE`）；`coverage → NOT_DISCLOSED`；被合并项移除后若该层级曾受其影响，`verdict → UNVERIFIABLE_TO_YOU`（RPT-09/RPT-10）。 |
| SCR-52 | `UNVERIFIABLE_REFERENCE` 与 `UNVERIFIABLE_TO_YOU` 是**呈现层专用取值，永不出现在存储形态中**（与 SCR-33 同理）。二者必须位于与存储枚举**分离的类型空间**，防止实现者图省事直接落库。 |
| SCR-53 | 脱敏不得泄漏：合并后的 finding 的 `field_path` 必须替换为该层级的**固定占位**（如 `/fields`），不得保留被屏蔽字段名；被移除项的条数、原 `rule_id`、被屏蔽空间标识一律不出现（RPT-09(c)）。 |
| SCR-54 | **逐字节同形**（XC-25）：对同一请求（同一调用者、同一授权类、同一时间参数），"目标存在于他空间"与"目标不存在"两个世界产生的呈现视图必须具有**相同的规范字节形态**（同键集合、同占位值、同数组长度、同 `report_digest` 之外的稳定形态；`report_id`/`checked_at` 等每次都变的字段不计入同形判定，但必须同形于各自类型与长度）。 |
| SCR-55 | 跨授权类的形态差异**只允许出现在"是否给出审计视图 A"这一条授权边界上**：有权者见 A、无权者见恒定脱敏形态 S。任何更细的差异（S 内部再分档、按对象种类改变字段名、按被遮蔽项数量改变数组长度）都会把"存在性"泄漏给本来不该知道它的人，一律禁止。 |
| SCR-55 | 脱敏是纯函数且无副作用；不得按调用者身份做除授权类以外的细分美化（避免形成"按人改写历史"的观感，SP-10）。 |

## 6. 理由码注册表

```
reason_code_entry = { code, applies_to ∈ {NOT_APPLICABLE, INDETERMINATE, FAIL, PRESENTATION},
                      severity_default?, label, introduced_in, contract_ref }
```

| 编号 | 规则 |
| --- | --- |
| SCR-60 | `INDETERMINATE` 的四值理由与 `outcome` 枚举本身是**封闭**注册表：新增即契约层变更，不是词表扩容（N-02）。 |
| SCR-61 | `FAIL` 的理由码（如 `ROLE_UNBOUND`、`REF_UNRESOLVED`、`STATE_UNDECLARED`、`LATEST_REF_IN_FORMAL_SLOT`、`REGISTRANT_ABSENT`、`ROLE_CATEGORY_MISMATCH`、`CONCLUSION_POLICY_UNDECLARED`、`DEGREE_SCALE_UNDECLARED`、`OPS_STATE_UNDECLARED`、`ALIGNMENT_UNDECLARED`、`GAP_CROSSING_UNDECLARED`、`NO_CONCLUSION_AS_CONCLUSION_INPUT`、`ROLE_KIND_UNDECLARED`、`FORBIDDEN_FIELD_PRESENT`）**开放注册**，但每个码必须标出 `contract_ref`（文件 + 规则号），并区分两种出处：**(a) 契约层字面出现的码**（如 `ROLE_UNBOUND`、`REF_UNRESOLVED`、`STATE_UNDECLARED`）；**(b) 本层在既有规则下新命名的码**（如 `LATEST_REF_IN_FORMAL_SLOT` ← `SL1-COM-01`、`FORBIDDEN_FIELD_PRESENT` ← `SL1-COM-04`、`VOCABULARY_CODE_UNREGISTERED`/`CODE_DEPRECATED` ← `SL1-ASS-01` 的「类型引用必须解析到定义」一般化）——(b) 类**不新增语义**，只是给既有 FAIL 条件命名，必须逐条登记并等待契约层确认（[决策文档](H_S_R_SCHEMA_DECISIONS_DRAFT.md) A-08）。无出处的码不得注册；(b) 类未获确认前不得用于跨空间交换工件的规范性版本。 |
| SCR-62 | `PRESENTATION` 类码（`UNVERIFIABLE_REFERENCE`）与 `PRESENTATION` 类 verdict（`UNVERIFIABLE_TO_YOU`）在注册表中单独标注 `storage_forbidden: true`，供 Schema 校验器拒绝落库（SCR-52）。 |

## 7. 规则注册表（机器可读索引，不改写规则文本）

```
rule_entry = { rule_id, doc_ref, level, applies_to{kind, subtypes[], scheme_role?},
               field_selector?, outcome_on_fail, severity_default, unknown_allowed,
               contract_version, negative_case_refs[] }
```

| 编号 | 规则 |
| --- | --- |
| SCR-70 | **规则正文唯一真源仍是规范化契约文档**；注册表条目只是索引 + 机器可消费的适用范围，**不得**复制规则正文（EB1 单正源）。`doc_ref` 是文件 + 规则号。 |
| SCR-71 | `applies_to` 决定该项对哪些对象产生 finding：不匹配时**不产出** finding（不是 `NOT_APPLICABLE`）。`NOT_APPLICABLE` 只在规则声明"在某 kind/子型/Scheme 下本身不适用"时由该规则自己产出（契约层 §1.2 原文）。二者混淆会使分母漂移，必须各有一条负例。 |
| SCR-72 | `unknown_allowed: true` 的槽位相关规则必须满足：如实 `UNKNOWN(reason)` → `PASS` 且产生对应 `declared_gap`（RPT-05）。Schema 校验器检查"规则未声明 `unknown_allowed` 但其字段规范要求允许未知"的不一致（一致性检查，不判语义）。 |
| SCR-73 | `negative_case_refs[]` 必须至少含一条反例编号（`CS-*`/`XC-*`/`CC-*`），使每条规则可被测试锚定（契约层 §8 的可测试性要求）。 |
| SCR-74 | 规则集变更一律 bump `rule_set_version`；新增规则可能改变历史 verdict，但**只产生新报告**，历史报告按其钉住的旧版本重放（SF-62、DF-06）。 |
| SCR-75 | 规则注册表自身是**非对象记录**（`rec:` 可引用），不是第六类对象；其条目状态机同注册表生命周期（`ACTIVE/DEPRECATED`，SF-64）。 |

## 8. 负面清单

不做：报告分数与总评（SCR-23）；存储呈现态取值（SCR-33、SCR-52）；存储被屏蔽项计数或标识（SCR-53）；把 `declared_gaps` 计入层级（RPT-00）；用 `null`/空数组表达"未检查"；在报告里塞开放字段以承载"充分性"类判断（SCR-05）；为性能预生成脱敏副本（SCR-50）；报告改写历史 PASS（RPT-01）。

## 9. 落地的最小验证预期（供后续测试设计，非已运行）

1. 封闭性：报告与 finding 添加任意未知键 → 形态非法（含 `confidence`、`score`、`is_current`）。
2. `severity` 仅随 `FAIL`；`INDETERMINATE` 缺 reason → 非法。
3. 归约唯一性：`FAIL × 3 + INDETERMINATE × 2` → `NOT_ACHIEVED` 且 `coverage` 独立呈现（XC-27）。
4. 视图同形：SCR-54 的两个世界逐字节比较；且存储层禁止出现 `UNVERIFIABLE_*`（写盘前校验）。
5. 分母稳定：构造"规则不适用"与"规则未执行"两种世界，`level_result` 输入集合必须可区分。
6. 版本钉住：同一对象在两个 `rule_set_version` 下重检 → 两份报告并存、旧报告字节不变、verdict 可不同。
7. 规则表一致性：注册表中 `unknown_allowed = false` 而契约要求允许未知的条目 → 一致性检查报错。
8. `field_path` 可解析：每条 finding 的指针必须能在被检对象的规范形态中定位（否则报告自身非法）。

## 10. 本层尚未裁决的内容

S-L2/S-L3 与更高 R 等级报告的形态（契约层只留扩展点）；规则执行引擎与调度；检查器环境与计算基的记录形态；跨空间委托检查的授权链路；性能与批量检查形态。**不属于本层职责。**
