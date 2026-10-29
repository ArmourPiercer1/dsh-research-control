# S-L0/S-L1 与 R-L0/R-L1 规范化详细契约

> **PR #42 · DRAFT-PROPOSAL · 2026-10-28。** 把[主基线](H_S_R_FIVE_OBJECT_ARCHITECTURE_DRAFT.md) §2 的“S-L0 可解析、S-L1 结构合法”落实为可被后续 Schema 与 validator 实现的检查规则。共享约定见[共同底座](H_S_R_DOMAIN_FOUNDATIONS_DRAFT.md)；被检查字段只在各对象契约中定义。
>
> **两条硬边界**：①规范化是**结构门禁**，不是科研真实性审查；②任何 FAIL **都不阻止保存、阅读、检索、引用与继续研究**（DF-07），只影响该版本能否进入被认证的组合推理与“结构合规”呈现。S-L2/S-L3 与更高 R 等级本轮只留扩展边界，不设计规则。**Proposed，不表示已实施。**

## 1. 检查报告与判定词表

`CheckReport = {target 引用（可到 @rev 或 @rev#representation）, contract_version, checker 标识与版本, checked_at, subject_space, level_results[], findings[], declared_gaps[], coverage}`；`finding = {rule_id, outcome, severity, field_path, reason_code, message}`；`level_result = {level, verdict ∈ {ACHIEVED, NOT_ACHIEVED, INDETERMINATE}}`。

### 1.1 三条互不混合的判定线（审查修订 R1）

先前版本把三件不同的事压进同一个 `outcome`，导致“显式承认不知道”反而使对象拿不到 S-L1。现固定为三条正交判定线：

| 判定线 | 回答的问题 | 载体 | 对层级的影响 |
| --- | --- | --- | --- |
| **A 结构合法性** | 该检查项在此契约版本下是否满足其**结构**要求（形态、必填、引用形式、角色、取值域） | `finding.outcome` | 决定层级达成 |
| **B 语义完备性** | 登记者是否仍声明某处未知、待定或待解析 | `declared_gaps[]` | **不**影响层级；只说明信息量 |
| **C 可判定性** | 检查所需信息是否可见、检查器与规则是否可用 | `outcome = INDETERMINATE(reason)` | 使层级 **INDETERMINATE**，既不达成也不违规 |

| 编号 | 规则 |
| --- | --- |
| RPT-00 | A/B/C 三条线不得互相冒充：语义待补不是结构违规；结构违规不是语义待补；检查不可执行不是前两者之一。把 B 计入 A（“因为研究者承认不知道，所以结构不合法”）是**契约缺陷**，其后果是逼迫研究者补造尚不知道的科研语义（NEV-05、DF-08）。 |

### 1.2 `outcome` 与 `severity`

| `outcome` | 含义 | 计入层级 |
| --- | --- | --- |
| `PASS` | 结构要求满足。**字段值为显式 `UNKNOWN(reason)`、且该字段规范允许 `UNKNOWN` 且理由合法时，仍为 `PASS`** | 计入达成 |
| `FAIL` | 结构要求不满足：必填字段 `ABSENT`、非法取值、跨类端点、禁用字段、伪装成值的空占位、Scheme 必填角色未绑定、同空间引用缺失 | 阻断层级达成，**不**阻断保存 |
| `NOT_APPLICABLE(reason)` | 该规则在此 kind/子型/Scheme 下**本身不适用**（与权限、可见性无关） | 不计入分母 |
| `INDETERMINATE(reason)` | 检查**无法执行**：`reason ∈ {WITHHELD_REFERENCE, CHECKER_UNAVAILABLE, DEPENDENCY_MISSING, RULE_UNREGISTERED}` | 该层级判为 `INDETERMINATE` |

`severity ∈ {DEFICIENCY, VIOLATION}`，仅在 `FAIL` 上有意义：**DEFICIENCY** = 可经后续补全或修订消除的结构欠缺（如必填项尚未登记）；**VIOLATION** = 出现契约禁止项（禁止字段、伪装占位、`latest` 进入正式声明、报告含科学判真），必须经新登记纠正且不得被“补全”掩盖。两者都阻断层级达成，但呈现与处置不同。

`declared_gap = {field_path, state ∈ {UNKNOWN(reason), UNRESOLVED(ref), ABSENT}, note}`：**不是 finding**，不产生 PASS/FAIL，不参与层级计算，只如实说明“登记者声明了哪些不知道”。

### 1.3 报告规则

| 编号 | 报告规则 |
| --- | --- |
| RPT-01 | 报告**追加不可改**：新契约版本、新检查器版本重检旧对象产生**新报告**；历史 PASS 与其规则/环境/时间永久保留（C11）。 |
| RPT-02 | **层级归约（唯一确定）**：`NOT_ACHIEVED` ⟸ 该层级存在任一 `FAIL`（**优先级最高**：已确认的结构缺陷是确定结论，不因“同时有看不见的东西”而降格为不可判定）；否则存在任一 `INDETERMINATE` → `INDETERMINATE`；否则全部 `PASS`/合法 `NOT_APPLICABLE` → `ACHIEVED`。`coverage` 与 `declared_gaps[]` 是**独立字段**，不参与归约、不改变 verdict。**混合结果正例**：某论证 3 项 `FAIL` + 2 项 `INDETERMINATE(WITHHELD_REFERENCE)` → `verdict = NOT_ACHIEVED`、`coverage = INCOMPLETE_DUE_TO_VISIBILITY` 同时呈现，两者各说各的事。**反例（违规）**：为了让报告“说得清”而把 `INDETERMINATE` 排在 `FAIL` 之前，用“有依赖看不见”掩盖已知缺陷；或反过来因为存在屏蔽项就宣称该层级永不达成、把可见缺陷说成不存在。 |
| RPT-03 | 因权限或跨空间过滤而不可见的引用，其检查项**在审计视图中**记 `INDETERMINATE(reason=WITHHELD_REFERENCE)`；**禁止**记 `NOT_APPLICABLE`、`PASS` 或 `FAIL`。报告携带 `coverage ∈ {COMPLETE, INCOMPLETE_DUE_TO_VISIBILITY, NOT_DISCLOSED}`，其对外可见性受 RPT-09 约束：调用者对被屏蔽范围无可见权时一律呈现 `NOT_DISCLOSED`。审计视图不得给出被屏蔽项的精确计数、标识或可据以反推存在性的粒度（SP-03、SP-07）。 |
| RPT-04 | 报告不得包含科学充分性、方法恰当性、样本代表性或结论真值判断；出现此类字段即 `VIOLATION`。 |
| RPT-05 | **允许未知即可通过**：凡字段规范允许 `UNKNOWN`，其合法 `UNKNOWN(reason)` 使相关结构项 `PASS` 并进入 `declared_gaps[]`。系统不得因“研究者如实承认不知道”而使其停留在 `S-L0`，也不得为此提供任何“填个默认值即可通过”的路径（UN-02、DF-08）。 |
| RPT-06 | **必填输入角色不适用未知语义**：Scheme 声明为必填的输入角色只有“已绑定合法端点”（`PASS`）与“未绑定”（`FAIL(ROLE_UNBOUND, severity=DEFICIENCY)`）两态；`UNBOUND(reason)` 中的 reason 只是说明，不改变判定。可选角色未绑定 → `PASS`。以空占位符伪装已绑定 → `FAIL(severity=VIOLATION)`（CS-06）。 |
| RPT-07 | **只查声明，不判语义**：凡涉及“含义是否改变、是否等价、翻译是否忠实、量词是否真的绑全、原意是否如此”的规则，机器只检查**声明字段存在、形态合法、彼此不矛盾**；声明内容是否为真由原意确认（IC-S6）、评价（A6）与后续 S-L2/形式化承担。机器永不因为一个 `UNCHANGED` 声明存在就认为语义等价已被验证（RPT-07、NEV-01、NEV-07）。 |
| RPT-08 | **引用不可用按原因三分**，不得一律通过或一律失败：同空间目标不存在 → `FAIL(REF_UNRESOLVED, DEFICIENCY)`；目标可能位于无权空间 → `INDETERMINATE(WITHHELD_REFERENCE)`；引用连五态都未声明（空串、空集合、缺字段）→ `FAIL(STATE_UNDECLARED, VIOLATION)`（UN-01、UN-03、UN-05）。 |
| RPT-09 | **检查报告有两个视图，真源只有一个**：`audit_view`（完整 `outcome`/`reason_code`/`coverage`）与 `presented_view(caller)`（经脱敏的呈现）。内部审计视图只对**同时对检查对象空间与被屏蔽范围有可见权**的主体开放；其余调用者一律得到脱敏视图。脱敏函数 `sanitize()` 必须：(a) 把 `FAIL(REF_UNRESOLVED)` 与 `INDETERMINATE(WITHHELD_REFERENCE)` 合并为同一个对外码 `UNVERIFIABLE_REFERENCE`（对无权核验目标的调用者，“不存在”与“看不见”不可区分）；(b) 把 `coverage=INCOMPLETE_DUE_TO_VISIBILITY` 呈现为 `NOT_DISCLOSED`；(c) 不得泄漏计数、标识、被屏蔽字段名、时间分布；(d) 同一请求的响应形态与量级不得随目标是否存在而变（SP-07）。**报告本身仍是单一真源**，脱敏发生在呈现层而非记录层，事后有权主体复核仍能看到完整审计视图。 |
| RPT-10 | **对外层级呈现**：`verdict` 由审计视图按 RPT-02 归约；当脱敏移除了任何检查项时，对该调用者呈现 `UNVERIFIABLE_TO_YOU` 而非 `ACHIEVED`/`NOT_ACHIEVED`，并允许说明“依赖未能完整核验”。有权完整核验者看到真实 verdict。理由：若把审计 verdict 直接给无权者，猜测一个 ID 就能靠 `NOT_ACHIEVED` 与 `INDETERMINATE` 的差异反推他空间是否存在该对象。 |
| RPT-11 | **核验权与写权限分离**：能在某空间写入对象，不等于能核验其跨空间依赖。登记指向未知/外部目标的引用始终合法（保存不受阻），但其规范化结论对该调用者呈 `UNVERIFIABLE_TO_YOU`；系统不得为提高层级而要求先取得目标可见权。 |

## 2. 八种记录形态的区分（本轮要求的分类）

同一份报告必须能把下列形态彼此区分开；它们对应不同的判定线组合（§1.1），不得合并呈现。

| 记录形态 | 落点 | 判定组合 | 是否可保存 |
| --- | --- | --- | --- |
| ① 无法解析的原始记录 | H 原始记录（IC-H3），**不是**正式对象 | 无 S 层级；原文 + 来源完整 | 是（最低门槛即保存） |
| ② 已解析但语义字段不完整 | 正式对象，`S-L0` 达成；`S-L1` 视缺失字段而定 | 必填 `ABSENT` → `FAIL(DEFICIENCY)`；可选字段显式 `UNKNOWN` → `PASS` + `declared_gaps` | 是 |
| ③ 具有基本合法引用与结构 | `S-L1` `ACHIEVED`（论证另可 `R-L0`/`R-L1` `ACHIEVED`） | 全部适用项 `PASS`/合法 `NOT_APPLICABLE`；`declared_gaps` 有无皆可，不影响达成 | 是 |
| ④ 需要主体确认但未确认 | `S-L1` `ACHIEVED` + 状态轴 A3 `UNCONFIRMED` | `confirmation ≠ S-L1`；两者独立呈现，互不换算 | 是 |
| ⑤ 结构合法但科学上可能错误 | `S-L1`（+ `R-L1`）`ACHIEVED` + 相反 Assessment 并存（A6） | 结构合规 ≠ 科学有效（D18）；报告不含充分性判断（RPT-04） | 是，且必须能同时看到相反意见 |
| ⑥ 尚未形式化的合法命题 | `S-L1` **`ACHIEVED`** + `representations` 缺省或含 `UNKNOWN` 等价声明（进 `declared_gaps`） | 无 S-L2；形式化不是前置条件，也不因未形式化而降级 | 是 |
| ⑦ 条件未满足但可继续探索的论证 | `R-L1` **`ACHIEVED`** + `path_conditions.status = OPEN` + 义务 `OPEN` | 条件未满足是研究状态，不是结构违规（C12、D15） | 是 |
| ⑧ 引用因权限不可见而无法判定 | 正式对象，层级 `INDETERMINATE` | 相关项 `INDETERMINATE(WITHHELD_REFERENCE)`；`coverage = INCOMPLETE_DUE_TO_VISIBILITY` | 是；**不得**被呈现为“合规”或“不合规”，也不得据此推断被屏蔽内容 |

**易混对**：②/③ 的差别只在**必填**字段是否缺失，不在“是否还有未知”；⑦ 与 ② 的差别在于结构已完整而条件尚未满足；⑧ 与 ② 的差别在于信息**存在于系统之外或他人空间**，不是登记者未提供。

## 3. 通用检查项（适用全部五类）

| 规则号 | 检查 | FAIL 条件 | 负例 |
| --- | --- | --- | --- |
| `SL0-COM-01` | 载荷可按声明 kind 解析为对象骨架 | 无法解析 → `F-SCHEMA-INVALID`，转 H 原始记录 | 把自由文本整段当作关联载荷提交 |
| `SL0-COM-02` | `object_kind` 明确 | kind 缺失或取值不在五类 | 提交 `kind: RESEARCH_ITEM` |
| `SL0-COM-03` | `space_id` 明确 | 缺失或多值 | “公共空间”对象试图被两个空间写入 |
| `SL1-COM-01` | 全部引用为精确形式或显式 `UNRESOLVED` | 出现 `latest` / 无版本引用于正式声明位置（ID-05、RF-02） | 论证结论端写 `P7(latest)` |
| `SL1-COM-02` | 引用可解析性按 RPT-08 三分：同空间缺失 `FAIL`、无权可见 `INDETERMINATE`、未声明五态 `FAIL` | 把无权可见记为 PASS/FAIL/NOT_APPLICABLE 中的任一种 | 借公共概念引用另一空间私有个体，却报“对象不存在” |
| `SL1-COM-03` | 每个字段有明确五态之一 | 空串/空集合被用作“未知”替代 | `world_ref: ""` 表示不知道 |
| `SL1-COM-04` | 不出现禁止字段（真值、置信度、当前有效等） | 出现 §“明确禁止字段”中的任一 | 命题带 `confidence`；关联带 `is_current` |
| `SL1-COM-05` | 来源与主体字段存在或显式 `UNKNOWN` | 既无主体也无 `UNKNOWN(reason)` | 匿名“系统自动”结论无来源材料 |
| `SL1-COM-06` | 时间字段类别未被混用 | 用 `recorded_at` 填 `described_interval` 等 | 把补录时间当作现象发生时间 |

## 4. 分对象 S-L1 规则

### 4.1 Entity（`SL1-ENT-*`）

`SL1-ENT-01` 活动个体的导出形态声明为活动而非资源；`SL1-ENT-02` 观测子型的结果引用允许缺失但须显式（失败观测可无 Result，`NOT_APPLICABLE` 需理由）；`SL1-ENT-03` 资源个体若声明载体则哈希形态合法；未声明载体 → `PASS` + `declared_gaps`（RPT-05）；`SL1-ENT-04` 可用性**不作为布尔字段**存在（检查其有无，有即 FAIL）；`SL1-ENT-05` Entity 内**不得出现关系类字段名/结构**（`upstream`/`downstream`/`uses`/`generated_by` 等，出现即 FAIL）；**不**扫描说明文本中是否提到关系（那是语义判断，RPT-07）；`SL1-ENT-06` RegistryEntry 与被登记资源的引用方向正确；`SL1-ENT-07` 计划态与已发生态互斥取值；`SL1-ENT-08` Entity 内**不得**保存使用/参与/配置的**关系列表字段**（`used_in[]`、`operating_context_refs[]`、`configs[]` 等，出现即 FAIL/VIOLATION）——这类关系以 Association 或活动个体为真源，Entity 上的反向清单只能是派生视图（EN-W-5、RD-12 单一真源）。
**负例**：给失败采集伪造 `sosa:Result` 以通过检查；把设备上下游塞进 `Entity.upstream`；把跨空间不可用呈现为“资源不存在”。

### 4.2 Concept（`SL1-CON-*`）

`SL1-CON-01` `concept_subtype` 明确；`SL1-CON-02` 词法字段（label/altLabel）与含义字段（definition/signature）分离；修订声明与**实际改动字段集合**不得自相矛盾：只改词法字段却标 `SUBSTANTIVE` → FAIL，改了含义字段却标 `LEXICAL` → FAIL。**机器只查“声明 vs 改了哪些字段”的一致性，不判断该改动在语义上是否真的实质**（RPT-07；实质性的争议由 CO-REV-1 硬集合声明与 A6 评价承担）；`SL1-CON-03` WorldType 声明为开放类型（出现封闭枚举集合即 FAIL）；`SL1-CON-04` `PredicateSignature`（若有）自洽：参数角色齐备、量纲引用可解析——**只查自洽，不查它是否与某命题匹配**；`SL1-CON-05` Scheme 定义见 §5；`SL1-CON-06` W3C 别名仅在声明精确等价时存在；`SL1-CON-07` 维度/选项定义之间无重复 option 标识。
**负例**：把 Theory/Simulation/Engineering 写成封闭三值；`skos:closeMatch` 被当作等价证明；给谓词签名加上“已验证”。

### 4.3 Association（`SL1-ASS-*`）

`SL1-ASS-01` `relation_type_ref` 解析到关系类型定义；`SL1-ASS-02` 参与者 ≥2 且角色名在类型声明内；`SL1-ASS-03` `directionality` 存在；`SL1-ASS-04` `described_interval` 存在或显式 `UNKNOWN`；`SL1-ASS-05` **区分两个主体**：`registrant_ref`（系统可信的登记主体或导入来源，由写入事件产生，不可 `UNKNOWN`）缺失 → `FAIL(REGISTRANT_ABSENT, DEFICIENCY)`；`actor_ref`（原始关系声称的作者，可能确实不详）为合法 `UNKNOWN(reason)` → **`PASS` + `declared_gaps`**（RPT-05）。仅当子型显式声明 `actor_required = true` 时，作者 `UNKNOWN` 才是 `FAIL(DEFICIENCY)`——由子型声明，不由通用规则默认。`SL1-ASS-06` 无真值/置信度/当前有效字段；`SL1-ASS-07` 关联对象内**不得**存在冲突/替代内联字段（出现即 FAIL/VIOLATION；冲突与替代只能作为独立主张记录，AS-CF-1）；冲突主张记录自身的两端引用须可解析，同空间缺失 → FAIL、无权可见 → `INDETERMINATE`；`SL1-ASS-08` 采用信息**不**内联在关联字段中（发现即 FAIL，要求改为采用记录）。
**负例**：`is_current` 字段；把 T2 下游记录写成对 T1 上游记录的反证；用 `skos:related` 表达具体设备关系。

### 4.4 Argumentation 的 S 侧（`SL1-ARG-S*`）

`SL1-ARG-S1` 讨论目标、结论端、局部结局三个角色可区分：角色缺声明 → `FAIL(ROLE_UNDECLARED, DEFICIENCY)`，把三者压进同一字段 → `FAIL(VIOLATION)`；`SL1-ARG-S2` 程度值（若有）携带尺度引用或显式 `UNKNOWN`：两者皆无 → `PASS` + `declared_gaps`，其**参与运算与比较的资格**由 §5 `RL1-08` 独立判定（S 侧宽松、R 侧严格，不是同一件事）；`SL1-ARG-S3` `construction_state` 与结局/层级字段互不推导（出现映射约束即 FAIL）。

### 4.5 Proposition（`SL1-PRO-*`）

`SL1-PRO-01` `primary_expression` 存在且非空；`SL1-PRO-02` 每个表示带 `equivalence_claim`；沉默按 `ABSENT` 进 `declared_gaps` 且 `PASS`（未说明 ≠ 说明了不知道，也 ≠ 结构违规，UN-03）；`SL1-PRO-03` 表示若声明 `SAME_TRUTH_CONDITIONS` 则必须有声明者（缺 → FAIL）；`SL1-PRO-04` 表示若 `added_assumptions` 非空则**禁止** `SAME_TRUTH_CONDITIONS`（违反 → FAIL，对应 CS-22）；`SL1-PRO-05` `world_ref`/`scope_refs`/`dimension_binding`/`variable_bindings` 存在或显式 `UNKNOWN`；`SL1-PRO-06` 修订携带 `truth_condition_claim`，且 `CHANGED` 却写同一 PropositionID → `FAIL(VIOLATION)`（PR-ID-4）。**本项只查声明与 ID 的一致性，不判断新旧表述是否真的同真值条件**（RPT-07）；`SL1-PRO-07` 提及集合的角色合法、允许 `SELF`；`SL1-PRO-08` 无真值/概率/fact_status 字段；`SL1-PRO-09` 子型专有字段满足（如 ASSESSMENT 需 assessor 与精确目标；FACT_DESIGNATION 需动作与精确命题版本）。
**负例**：Lean 公式加进来就把 `equivalence_claim` 默认成“等价”；把 `¬P` 写成 P 的一个表示；评价性命题缺 assessor。

## 5. R-L0 / R-L1（仅 Argumentation）

| 规则号 | 检查 | 判定 |
| --- | --- | --- |
| `RL0-01` | 声明了 `scheme_ref` 且解析到合法 InferenceSchemeDefinition | 缺失/悬空 → **FAIL**（本版本不是正式论证，转研究材料保存） |
| `RL0-02` | Scheme 版本引用精确 | `latest` → FAIL |
| `RL1-01` | Scheme 声明的必填输入角色全部有合法端点 | 必填角色未绑定（含 `UNBOUND(reason)`）→ **FAIL**(`ROLE_UNBOUND`, DEFICIENCY)；空占位伪装已绑定 → **FAIL**(VIOLATION)（`CS-06`、RPT-06）；可选角色未绑定 → PASS |
| `RL1-02` | 每个绑定的端点类别 ∈ 该角色允许类别 | 违反 → FAIL（`ROLE_CATEGORY_MISMATCH`，如把文件当数学前提） |
| `RL1-03` | 目标形式符合 Scheme 声明（命题端为精确 PropositionRevision；被讨论目标允许为论证/关联） | 违反 → FAIL |
| `RL1-04` | 结论模式合法：满足 Scheme 的 `conclusion_policy`，且 `NONE_DECLARED` 与结局取值相容 | `ASSERTS` 却无命题端 → FAIL；`NONE_DECLARED` 而 Scheme 为 `REQUIRED` → FAIL(`CONCLUSION_NOT_ALLOWED`)；Scheme 未声明 policy → FAIL(`CONCLUSION_POLICY_UNDECLARED`)（CN-01/CN-02） |
| `RL1-05` | `local_outcome` ∈ Scheme 声明的结局词表 | 越界 → FAIL（`OUTCOME_NOT_IN_SCHEME`） |
| `RL1-06` | 每条路径的前提引用可解析 | 同空间悬空 → FAIL(`REF_UNRESOLVED`, DEFICIENCY)；无权可见 → `INDETERMINATE(WITHHELD_REFERENCE)`（RPT-08） |
| `RL1-07` | 条件均带 `path_scope`；作用域指向存在的稳定标识 | 悬空作用域 → FAIL（`CONDITION_SCOPE_UNRESOLVED`） |
| `RL1-08` | 程度值存在时 `scale_ref` 存在，且 `allowed_operations` **被显式声明**（可为空集 `NONE`） | 缺 `scale_ref` → FAIL(`DEGREE_SCALE_UNDECLARED`)；`allowed_operations` 未声明或含义未定 → FAIL(`OPS_STATE_UNDECLARED`)；显式 `NONE` → **PASS**：只读局部程度值合法，仅不得参与任何运算（CS-10） |
| `RL1-09` | 攻击引用的目标论证/路径/条件可解析；undercut 指明被打掉项或元命题 | 悬空 → FAIL |
| `RL1-10` | Scheme 要求对齐的角色均有 `alignment_claim.relation`（**显式 `UNKNOWN` 是合法取值 → PASS + `declared_gaps`**） | 完全缺声明 → FAIL(`ALIGNMENT_UNDECLARED`, DEFICIENCY)（CS-12/CS-13） |
| `RL1-11` | Scheme 要求独立性声明时 `shared_dependency_refs` 存在或显式 `UNKNOWN` | 缺失 → FAIL；**不**判定实际独立性 |
| `RL1-12` | 证明依赖图中的引用环不被自动赋支持 | 环检测：只标注“存在依赖环”，**不**因此 FAIL 也**不**授予证书（C10） |
| `RL1-14` | 组合资格按**绑定角色的结论要求**逐实例判定 | `role_kind = CONCLUSION_INPUT`（或组合规则中 `requires_conclusion=true` 的角色）绑定了 `mode = NONE_DECLARED` 的实例 → FAIL(`NO_CONCLUSION_AS_CONCLUSION_INPUT`)；角色/`role_kind` 未声明 → FAIL(`ROLE_KIND_UNDECLARED`)；`BACKGROUND`/`CASE_STUDY`/`SUBJECT_OF_DISCUSSION` 绑定无结论实例 → **PASS**（CN-03/CN-06、SCHEME-6） |
| `RL1-15` | 攻击的否定效果有明示内容 | `attack_links` / `UNDERCUT` / `REBUT` 只登记为主张；若该论证要参与下游组合而结论端为空 → FAIL(`ATTACK_WITHOUT_META_PROPOSITION`)（CN-04）。**不**判定攻击是否成立 |
| `RL1-13` | Scheme 要求声明语义跨越时，`gap_crossings[]` 存在且两端引用可解析 | 未声明 → FAIL(`GAP_CROSSING_UNDECLARED`, DEFICIENCY)；声明但目标同空间缺失 → FAIL(`REF_UNRESOLVED`)；无权可见 → `INDETERMINATE`；**不**判定跨越是否成立（Argumentation GAP-01/GAP-05） |

`RL1-*` 全部 `PASS`/合法 `NOT_APPLICABLE` → `R-L1` `ACHIEVED`；任一 `INDETERMINATE` → `R-L1` `INDETERMINATE`（RPT-02）。**明确不检查**：Scheme 选得是否恰当、样本代表性、统计模型适用、归纳强度、类比相关性、演绎是否真为有效证明、结论科学正确性、条件是否实际满足、结论是否值得接纳。

## 6. 明确不属于 S-L0/S-L1 的检查（负面清单）

| 编号 | 永不做 | 依据 |
| --- | --- | --- |
| NEV-01 | 判定对象分类是否“实质恰当”、概念是否“真正同义”、命题是否“实质等价” | 主基线 §1/§2、C05 |
| NEV-02 | 判定科学充分性、代表性、可复现性、结论真值 | D18、DF-07 |
| NEV-03 | 把 LLM 抽取忠实度折算为 S-L1 结果 | 原意确认独立（IC-S6） |
| NEV-04 | 要求形式化、谓词逻辑化或全库术语消歧作为 S-L0/S-L1 前置 | 主基线 §2、D17 |
| NEV-05 | 用“缺失即违规”“未知即不合规”惩罚研究者（缺失只 `FAIL` 于必填且允许 `UNKNOWN` 表达） | UN-01/UN-03 |
| NEV-06 | 生成科学正确性总评分或把四轴压成单值 | 系统合同 R3 |
| NEV-07 | 把“声明已存在”当作“语义等价/原意忠实/真值条件未变已被验证”；也不得反向把未声明的语义缺口呈现为结构违规 | RPT-05、RPT-07、IC-S6 |

## 7. 扩展边界（只留接口，不设计规则）

| 扩展点 | 预留内容 | 不在本轮 |
| --- | --- | --- |
| S-L2 候选 | 谓词签名匹配、变量绑定与捕获检查、量纲一致性、受控表达式 AST | 任何具体判定算法、自动等价/去重 |
| R 更高等级 | 规则/证书检查、内核证明、统计方法审查记录：均**新增报告类型**，绑定精确表达 + 规则/环境/计算基版本 | Lean 后端、证明搜索、自动翻译 |
| 义务与政策 | 义务来源规则注册、豁免政策、复审触发策略 | 自动阻断政策、Agent 调度 |
| 跨 Scheme 组合 | 显式组合规则注册与其许可记录 | 通用支持传递律、概率合成 |

## 8. 落地的最小验证预期（供后续测试设计，非已运行）

每条规则都需要：一个正例、一个仅违反该规则的反例、一个“允许 `UNKNOWN` 的字段如实声明未知 → **仍 `PASS` 且出现在 `declared_gaps`**”的例子，以及三组防止隔离与判定退化的必备用例：引用被权限屏蔽 → 审计视图 `INDETERMINATE`；同一猜测 ID 在“目标存在于他空间”与“目标不存在”两种世界下，**呈现视图必须逐字节同形**（`UNVERIFIABLE_REFERENCE` + `NOT_DISCLOSED`，XC-25）；`FAIL` 与 `INDETERMINATE` 同时存在 → `NOT_ACHIEVED` 且 `coverage` 独立呈现（XC-27）；同一 Scheme 的有结论实例与 `INCONCLUSIVE` 实例在同一组合规则下得到不同资格（XC-26）；CS-01–CS-24 的映射见[组合与反例矩阵](H_S_R_COMPOSITION_MATRIX_DRAFT.md)。**本轮未编写或运行任何 validator、Schema 或测试**；上述只是可测试性要求。
