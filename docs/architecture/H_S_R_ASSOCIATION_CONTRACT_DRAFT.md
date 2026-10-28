# Association 领域对象契约

> **PR #42 · DRAFT-PROPOSAL · 2026-10-28。** 细化[五类主基线](H_S_R_FIVE_OBJECT_ARCHITECTURE_DRAFT.md) §1/§3、[组合合同 C01/C04/C08/C09/C12](H_S_R_COMPOSITION_SEMANTICS_DRAFT.md) 与 [Concept 契约](H_S_R_CONCEPT_CONTRACT_DRAFT.md) 的 RelationTypeDefinition。**共享约定只在[共同底座](H_S_R_DOMAIN_FOUNDATIONS_DRAFT.md)定义**；字段名是领域阅读名（N-01）。**Proposed，不表示已实施或已冻结。**

## 1. 语义定义与边界

**Association** 是**某来源**在某一语境下登记的一项非论证性关系记录，具有关系类型、参与对象及角色、方向、所描述的时间/区间、适用语境与版本。它回答“谁在何时依据什么声称了什么关系”，**不回答“该关系当前客观是否成立”**。

| 用途 | 不属于 Association 的典型情形 | 应登记为 |
| --- | --- | --- |
| 设备上下游、共数据、配置选择、概念词汇映射、来源/产出关系 | 带 Scheme、条件与局部结局的推理 | Argumentation |
| 保存不同来源对同一事项的前后描述 | 对该关系内容“是否成立”的论点 | Proposition（可由论证支持/攻击） |
| 登记“本项研究本次采用哪条记录、依据什么政策” | 关系是否为真的全局标记 | 采用记录（§7），不是字段 |
| 记录关系与关系之间的冲突/替代主张 | 参与对象的属性与身份 | Entity / Concept |
| 承载 PROV 语义的来源关系 | 记录被登记这一事件本身 | H 事件 |

**核心禁止**：Association **没有系统管理的全局真值**。质疑一项关联不删除其登记历史（C01）。

## 2. 明确不存在或永不出现的字段

`is_true`、`truth_value`、`validity`、`confidence`、`reliability_score`、`is_current`、`is_verified`、`superseded:boolean`、任何 `latest-write-wins` 派生标记、任何“系统已确认现状”的隐含状态。需要表达类似意思时，一律改用：有来源的**替代主张**（§6.3）、**采用记录**（§7）、**冲突关系**（§6.2）或**评价性命题**。

## 3. 字段契约

| 字段/角色 | 语义 | 类型/引用对象 | S-L0/S-L1 要求 | UNKNOWN/缺失规则 | 修订约束 |
| --- | --- | --- | --- | --- | --- |
| `relation_type_ref` | 关系类型（含 W3C 标准谓词别名，仅在精确等价时） | Concept@rev（RelationTypeDefinition） | S-L0：存在且可解析；S-L1：类型定义存在、方向与角色要求可读 | 不允许 `UNKNOWN`；类型未定则登记为候选类型（Concept 契约） | **不可变**（改类型 = 另一项关系主张） |
| `participants[]` | n 元参与端：`{role_ref, endpoint_ref, is_standard_subject?}`，至少 2 项 | 端点 = 五类对象@rev（**不含** H 记录、检查报告或采用记录，见共同底座 RF-05） | S-L1：≥2 且每个 role 在类型定义中声明；端点引用可解析或 `UNRESOLVED`；同空间 | 允许 `UNRESOLVED`（目标尚未登记，可后补） | **不可变**（换端点 = 新关联） |
| `directionality` | `DIRECTED / SYMMETRIC / UNSPECIFIED` | 值 | S-L1：必填（可 `UNSPECIFIED`） | 允许 `UNSPECIFIED`，不因此推定对称 | **不可变**；不限制逆向检索 |
| `described_interval` | 记录**所描述**的时间/区间：`{kind ∈ {TIMEPOINT, INTERVAL, UNTIL_REVOKED, TIMELESS}, from, to}` | 时间值或 `UNKNOWN` | S-L0：可缺；S-L1：必填或显式 `UNKNOWN(reason)` | 允许 `UNKNOWN(INDETERMINATE_AT_SOURCE)`（CS-01 无切换日志） | 由 `UNKNOWN` 补全为区间 → 修订；已声明区间被替换 → 新关联（§5） |
| `applicability_context` | 该主张所声称适用的 World/Scope/配置语境（如“布局未变”假设） | Concept@rev / Entity@rev 集合 | S-L1：非空或显式 `UNKNOWN` | 允许 `UNKNOWN` | 修订（澄清）；实质改变适用范围 → 新关联 |
| `source_assertion` | 谁声称：`{actor_ref, voice ∈ {SELF, REPORTED, IMPORTED, TOOL_OUTPUT}, basis_refs[]}` | Agent@rev + 材料引用 | S-L0：至少 actor 或 `UNKNOWN`；S-L1：`actor_ref` 必填或 `UNKNOWN(reason)` | `UNKNOWN` 记为“不可归因来源”，S-L1 FAIL 但可保存 | 补充来源材料 → 修订；来源者改变 → 新关联 |
| `recorded_via` | 本关联的登记事件（`recorded_at`、登记序） | H 记录引用 | H 侧必须存在 | 不允许缺失 | 不可变（H 拥有） |
| `conflict_or_supersede_refs[]` | 指向另一关联的显式主张：`{kind ∈ {CONFLICTS_WITH, SUPERSEDES_AS_STATED, SAME_PHENOMENON_AS}, target_rev, basis_ref}` | 关联@rev | 可选 | 缺失合法（未检查冲突 ≠ 无冲突） | 追加新主张，不改写旧条目 |
| `standard_predicate_alias` | 精确等价的 W3C 谓词名（如 `prov:used`） | 值 | 可选；仅在含义精确等价时填写 | 缺失合法 | 修订；不得用近似标准名“洗白”内部语义（N-04） |

## 4. 三种时间的字段落点（C01 核心）

| 需要问的问题 | 使用 | 常见误用 |
| --- | --- | --- |
| 系统什么时候知道这件事？ | `recorded_via.recorded_at` | 当成关系成立的时间 |
| 这条记录说事情发生在/适用于什么时候？ | `described_interval` | 当成系统登记时间；当成永久有效 |
| 我这次研究为什么要用这条记录？ | 采用记录 §7 的 `adoption_at/adoption_scope/basis` | 当成记录被验证为真 |
| 数据本身是什么时候产生的？ | 相关 Entity（Result/活动个体）的时间语义 | 与上三者混为一谈 |

不变量 **AS-T1**：三者可以两两不同且必须都能查询；任何“当前布局是什么”的查询都必须返回所选来源/政策、`described_interval`、并存冲突与历史截点，**不得**实现为不透明的 latest 取值（CS-01、CS-02）。

## 5. 身份与修订判据

**身份构成字段**（改变已声明值 → 新 Association）：`relation_type_ref`、`participants[]`、`directionality`、`described_interval` 的已声明值、`source_assertion.actor_ref`、`applicability_context` 的实质范围。

| 编号 | 判据 | 例 |
| --- | --- | --- |
| AS-ID-1 | 补全 `described_interval`、来源材料、角色注记、语境澄清 → 新修订 | T1 登记“Q 在 CCD 上游”，后补“该说法出自值班日志第 3 页” |
| AS-ID-2 | 同一关系类型、同一端点、**相反关系内容**（上游/下游）→ **必须是新关联**，不得就地覆盖 | CS-01：T1 上游 + T2 下游并存，切换时刻 `UNKNOWN` |
| AS-ID-3 | 端点从 `UNRESOLVED` 补全为已登记对象 → 修订（RV-01） | 后登记了 CCD 个体 |
| AS-ID-4 | 由 `UNKNOWN` 区间改为已声明区间 → 修订；由区间 A 改为区间 B → 新关联 | “整条束线”vs“仅 2026-03 停工期” |
| AS-ID-5 | 两项关联是否为同一关联不自动判定；同一事项的重叠描述由主体登记 `SAME_PHENOMENON_AS` 主张 | 两位工程师分别描述同一次改装 |
| AS-ID-6 | 关联记录永不被“更新为现状”：现状视图是带来源与截点的派生投影 | — |

## 6. 与其它对象的关系

### 6.1 引用方向

| 方向 | 角色 | 禁止 |
| --- | --- | --- |
| Association —`SEMANTIC`→ Concept@rev | 关系类型、角色定义 | 用关系类型定义反写具体关系内容 |
| Association —`SEMANTIC`→ 五类对象@rev | 参与端点 | 端点使用 `latest`；端点跨空间（→ `WITHHELD`） |
| Association —`PROVENANCE`→ Entity / H 记录 | 来源材料与登记事件 | 当成科学推导（DF-04） |
| Proposition —→ Association@rev | 讨论该关联内容 | 使关联与命题形成两套竞争的全局真假状态（CS-04） |
| Argumentation —`INFERENTIAL`→ Association@rev | 作为 Scheme 允许的输入角色 | 未经角色声明即当数学前提（C04） |
| Association —→ Association@rev | 冲突/替代/同现象主张 | 当成系统裁决 |

### 6.2 冲突关系
冲突登记是**对称可发现、由声明者承载**的主张：它不裁定谁真，只保证任何一方被检索时都能看到对方与依据。系统可以生成“重叠描述提示”（按关系类型 + 端点重叠 + 区间重叠），但提示不是冲突主张，也不是裁决。

### 6.3 替代主张（`SUPERSEDES_AS_STATED`）
“后来的说法取代先前说法”**只能是来源的主张**，附依据。没有依据时，系统只并列两项有来源的描述，并报告“真实切换时刻未知”（CS-01）；不得从 `recorded_at` 推断现实切换时刻。

## 7. 采用记录（本次使用，独立于关联本体）

采用记录是**研究范围内的使用记录**（状态轴 A5 的载体），不是关联对象的字段，也不是第六类对象。

| 字段 | 语义 | 规则 |
| --- | --- | --- |
| `adopter_ref` | 采用的主体或研究活动 | 必填（`UNKNOWN` 记为不可归因采用） |
| `adopted_ref` | 被采用的关联**精确 revision** | 必填，禁止 latest |
| `adoption_scope` | 本次采用的适用范围（时间、World、配置基线、目的） | 必填或 `UNKNOWN`；可引用已声明的配置基线/采纳政策 Concept |
| `adoption_at` | 采用发生时间 | 必填 |
| `basis_ref` | 采用依据（政策引用、配置基线、核验记录） | 允许 `UNKNOWN`；回顾性使用（CS-02）可引用“当时采用配置”而不要求今天重新核验 |

| 编号 | 规则 |
| --- | --- |
| AD-01 | 采用记录不要求每次阅读、查询或重复引用都重新人工认证现实（C01）。 |
| AD-02 | 把旧记录用于**新的**实验时段/新装置时，须新增采用记录并保留“布局未变”等明示假设或重新核验依据（CS-03）。 |
| AD-03 | 采用 ≠ 接纳 ≠ 为真；采用记录进入历史，可被后续记录否定而不删除。 |
| AD-04 | 采用关系**不产生**支持度、置信度，也不自动成为论证的独立证据（C09）。 |

## 8. 生命周期

`登记（S-L0）→ 逐步补全角色/区间/来源（S-L1）→ 被引用、被采用、被冲突登记、被命题讨论 → 长期保留`。

允许长期停留：区间 `UNKNOWN`、来源 `UNKNOWN`、端点 `UNRESOLVED`、从未被采用、从未被质疑。**没有“必须被验证才能保存”的阶段**（DF-07）；也没有“被质疑即下架”的转换（C01）。

## 9. 例子

**合法例**：`L3@r2` — `relation_type_ref = REL_UPSTREAM_OF@r1`（领域类型，非 SKOS `related`）；`participants = [SOURCE → E9@r1（四极磁铁 Q3）, SINK → E7@r2（CCD-2）]`；`directionality = DIRECTED`；`described_interval = {kind: UNTIL_REVOKED, from: 2026-03-01}`；`source_assertion = {actor: A2@r1（值班工程师）, voice: SELF, basis: [R-日志-0312]}`；`applicability_context = UNKNOWN`。随后 `L9@r1` 登记相反方向并附另一来源；两者并存，`conflict_or_supersede_refs` 互指，切换时刻 `UNKNOWN`。

**关键非法/易混淆例**：

| 情形 | 为什么非法 | 正确做法 |
| --- | --- | --- |
| 给关联加 `is_current = true` 以便“查询当前布局” | 违反 §2；把 latest 当科学裁决 | 采用记录 + 明确政策与截点，并返回冲突 |
| 把 `skos:related` 用于两台具体设备的上下游 | SKOS 只针对概念间关系 | 用领域 `upstreamOf` 类型（`standard_predicate_alias` 留空） |
| 用 `prov:wasDerivedFrom` 关联记录直接支撑“结论由数据证明” | 来源 ≠ 推理（DF-04） | 另建 Argumentation 并声明输入角色 |
| 后一条下游记录把前一条上游记录改写为“已过时/错误” | 违反 AS-ID-2/AS-ID-6 | 两条并存 + 有来源的替代主张；切换时刻未知如实标注 |
| “本次采用”记在关联对象的 `adopted_by` 反向字段里 | 采用属于使用者的行为记录，写回被采用对象会造成多真源 | 采用记录引用关联精确 revision（§7） |
| 关联端点是其他 ResearchSpace 的个体，系统返回该对象名 | 违反 SP-01/SP-02 | 呈现 `WITHHELD`，不泄漏存在性与内容 |
| 检索未发现冲突即报告“该关联无冲突” | 违反 DF-05/UN-01 | 报告“已检查范围内未发现冲突登记”，附检查范围 |
