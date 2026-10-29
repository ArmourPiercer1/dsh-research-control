# Argumentation 领域对象契约

> **PR #42 · DRAFT-PROPOSAL · 2026-10-28。** 细化[五类主基线](H_S_R_FIVE_OBJECT_ARCHITECTURE_DRAFT.md) §1/§3、[组合合同 C02/C03/C04/C06/C07/C09/C10](H_S_R_COMPOSITION_SEMANTICS_DRAFT.md) 与 [Concept 契约](H_S_R_CONCEPT_CONTRACT_DRAFT.md) §Scheme 定义。**共享约定只在[共同底座](H_S_R_DOMAIN_FOUNDATIONS_DRAFT.md)定义**；字段名是领域阅读名（N-01）。**R-L0/R-L1 只适用于本类对象。Proposed，不表示已实施或已冻结。**

## 1. 语义定义与边界

**Argumentation** 是声明了推理 Scheme、输入角色绑定、条件、讨论目标、实际结论内容与局部结局的论证记录。它回答“有人按某种方法、在这些输入与条件下，对某目标声称得到了什么结局”，不回答“该结论客观为真”“该方法选得对”“科学证据充分”。

| 用途 | 不属于 Argumentation 的典型情形 | 应登记为 |
| --- | --- | --- |
| 组织多前提通向精确命题的论证，并保留条件与路径 | 一类推理方法的定义与角色要求 | Concept（InferenceSchemeDefinition） |
| 记录一项证据在明示背景下对精确命题的局部支持/反对（证据子型，§6.1） | 被用作证据的数据、文件、Result 本身 | Entity |
| 表达攻击/削弱（rebut/undercut），可产出关于目标论证的元命题 | 某主体对命题的评价态度 | Proposition（ASSESSMENT） |
| 声明本次论证采用的输入版本、角色与适用范围 | “本次研究采用了这条关联记录”的研究范围采用 | Adoption 记录（Association 契约 §7） |
| 记录图上可追踪的推导依赖 | 设备上下游、共数据等弱关联 | Association |

**禁止的自动晋升**：Association、PROV 来源、ReviewSuggestion、检索召回、机器检查 PASS 都不得自动成为 Argumentation 或其组成部分（DF-04）。

## 2. 字段契约

### 2.1 方案与目标

| 字段/角色 | 语义 | 类型/引用对象 | S-L1/R-L0/R-L1 要求 | UNKNOWN/缺失规则 | 修订约束 |
| --- | --- | --- | --- | --- | --- |
| `scheme_ref` | 使用的推理 Scheme **定义**及其精确版本 | Concept@rev（InferenceSchemeDefinition） | **R-L0 必填且须解析到合法 Scheme**；解析失败 = R-L0 FAIL | 不允许 `UNKNOWN`（无 Scheme 则本对象不是正式论证，应作为原始记录或 ResearchFinding 保存） | **不可变**：改 Scheme = 新论证 |
| `engagement_target` | 本论证**讨论的目标** | `Proposition@rev` \| `Argumentation@rev` \| `Association@rev` \| `NONE` | R-L1：按 Scheme 声明必填并解析 | 允许 `NONE`（纯推导新命题，不针对既有对象） | **不可变** |
| `engagement_role` | 与目标的关系：`SUPPORTS / ATTACKS / EXPLORES / CLARIFIES`（开放） | 值 | R-L1：目标存在时必填 | 允许 `UNKNOWN`（标注待补） | 修订；但由 SUPPORTS 改 ATTACKS 视同换目标 → 新论证 |
| `conclusion` | **实际声称得到的结论内容**：`{mode, proposition_rev}`，`mode ∈ {ASSERTS, DENIES_TARGET, ASSERTS_ABOUT_TARGET, NONE_DECLARED}` | Proposition@rev 或 `NONE_DECLARED` | R-L1：必须满足 Scheme 的 `conclusion_policy`（SCHEME-3）；`ASSERTS*` 时必须精确到 revision | 允许 `NONE_DECLARED` **仅当** Scheme 声明允许（CN-02）；否则缺失即 R-L1 FAIL | **不可变** |
| `conclusion_vs_target` | 结论与目标的关系：`SAME / NEGATION / META_ABOUT_TARGET / UNRELATED_BY_SCHEME` | 值 | R-L1：结论与目标同时存在时必填 | 允许 `UNKNOWN` | 修订 |

### 2.2 输入与对齐

| 字段/角色 | 语义 | 类型/引用对象 | S-L1/R-L0/R-L1 要求 | UNKNOWN/缺失规则 | 修订约束 |
| --- | --- | --- | --- | --- | --- |
| `input_bindings[]` | 输入端绑定：`{role_name, endpoint_ref, endpoint_kind, role_kind ∈ {CONCLUSION_INPUT, BACKGROUND, CASE_STUDY, SUBJECT_OF_DISCUSSION}, alignment_claim, notes}`；`role_kind` 声明**这个绑定在推理中承担什么**：是否需要被绑定端点提供一个已推出的命题 | 端点 = 五类对象@rev（检查报告、可用性检查、采用记录等 H 记录**不能**充当输入端点，只能作为本论证的来源或作为元命题的讨论目标，见共同底座 RF-05） | R-L1：Scheme 声明的**必填角色**全部有绑定（或该路径标注 `UNBOUND(reason)`）；角色名必须在 Scheme 声明内；端点必须属于该角色允许的对象类别 | 允许 `UNBOUND(PENDING_INPUT)`（CS-06：等待数据），**但空占位不得伪装成已满足** | 绑定与对齐声明可修订；改 Scheme 须新论证；原始实验/测量/检查记录须先按 Entity 子型对象化再绑定（RF-06），不放宽端点类别 |
| `alignment_claims[]` | 每个输入与结论之间的精确对齐：单位/量纲、指标定义版本、变量与量词绑定、World/工况对应 | `{from_ref, to_ref, relation ∈ {EXACT_MAP, DECLARED_MAP, ASSUMED, UNKNOWN}, basis_ref}` | R-L1：Scheme 要求对齐的角色必须给出 `relation`；`UNKNOWN` 合法但阻止组合认证（CS-12/CS-13） | 允许 `UNKNOWN`；禁止按同名/同数值默认相接 | 修订（新对齐声明产生新报告，不改写旧报告） |
| `shared_dependency_refs[]` | 与其它论证共享的原始数据、校准、证书或模型（显式登记） | 引用集合 | R-L1：Scheme 要求独立性声明时必填或 `UNKNOWN` | `UNKNOWN` 合法，但禁止按路径数量提升支持度（C09） | 修订 |

### 2.3 路径、条件与程度值

| 字段/角色 | 语义 | 类型/引用对象 | S-L1/R-L0/R-L1 要求 | UNKNOWN/缺失规则 | 修订约束 |
| --- | --- | --- | --- | --- | --- |
| `support_paths[]` | 稳定的路径集合（`path_id` 不重排）；每条含 `premise_refs[]`（路径内 AND） | 路径对象列表 | R-L1：路径非空、每条路径的输入必须在 `input_bindings` 中有角色绑定；不同路径之间是替代支持（OR），**系统不合并其条件** | 允许单路径；允许路径含 `UNBOUND` 前提 | 增删路径 = 修订（旧 revision 保留） |
| `path_conditions[]` | 条件集合，每项 `{condition_prop_rev, status, path_scope[], discharge_basis?}`；`status ∈ {ASSERTED, OPEN, DISCHARGED, CONTESTED, UNKNOWN}` | Proposition@rev + 路径作用域 | R-L1：条件必须落在具体 `path_scope`（不得悬空于整个论证而不指明路径，除非 Scheme 声明全局条件） | `OPEN/UNKNOWN` 合法且**不阻断**探索（D15） | 状态变化必须由显式记录驱动，附 `discharge_basis`；不得因“视图切换/摘要”消失（C07） |
| `degree_value` | 可选的局部程度值 `{value, scale_ref, allowed_operations[], declared_range}`；`allowed_operations` **可以是空集 `NONE`** | Concept@rev（DegreeScaleDefinition） | R-L1：若存在则 `scale_ref` 必须存在、`allowed_operations` 必须**被显式声明**（`NONE` 合法）；缺 `scale_ref` → FAIL(`DEGREE_SCALE_UNDECLARED`)，运算集合未声明 → FAIL(`OPS_STATE_UNDECLARED`) | 允许完全缺省；`scale_ref` 可显式 `UNKNOWN`（此时该值**不可参与任何运算或比较**，仅原样呈现） | 修订；改尺度语义即改 Scheme → 新论证。**只读程度值合法**：声明了尺度含义但声明 `allowed_operations = NONE` 的值是良构的，只是不得被平均、取小、相加或当作概率读（RL1-08、CS-10） |

### 2.4 结局、状态与检查

| 字段/角色 | 语义 | 类型/引用对象 | S-L1/R-L0/R-L1 要求 | UNKNOWN/缺失规则 | 修订约束 |
| --- | --- | --- | --- | --- | --- |
| `local_outcome` | **本论证对目标的局部结局**（状态轴 A4）：`NONE_YET / SUPPORT / REBUT / UNDERCUT / INCONCLUSIVE / APPLICABILITY_FAILURE`，取值必须在该 Scheme 声明的结局词表内 | 值 + 声明者 + 时间 | R-L1：取值必须属于 Scheme 声明集合 | `NONE_YET` 合法（研究未完成） | 修订；结局**不写入**目标命题的任何字段（C02） |
| `construction_state` | 状态轴 A1：`DRAFT / SUBMITTED / CLOSED_DRAFT / WITHDRAWN / TERMINATED_BY_SCOPE`（关闭≠撤回，见 §7） | 值 | 不属于 R-L1 判定内容 | 允许任意值 | 修订；`CLOSED_DRAFT` 只表示停止推进该次构造，**不**产生反证、不把已提交论证追溯降为草稿（C03） |
| `applicability_records[]` | 状态轴 A5：某主体在某场景判定本论证**本次是否适用** | 记录集合（引用本论证@rev + scope + 判定 + 依据） | 可选 | `UNKNOWN` 合法 | 新记录；不得把场景不适用推广为全局无效（CS-09） |
| `verification_records[]` | R-L0/R-L1 及更高等级的检查报告引用（含 checker 版本、契约版本、时间、结果） | 报告引用 | 报告本身由检查产生，非论证字段 | 无报告合法 | **追加**；新规则只产生新报告，不改写历史 PASS（C11） |
| `composition_records[]` | 在已登记组合规则下，本论证输出与其他论证组合的许可记录 | 记录集合 | R-L1 不要求；存在时须引用规则版本与输入集合 | 无记录合法（图可追踪 ≠ 可组合，C06） | 追加 |
| `obligation_refs[]` | 由已登记 Scheme 规则触发的证明义务 | ProofObligation 引用 | 可选 | 无义务合法 | `OPEN` 不阻断条件性探索 |
| `attack_links[]` | 本论证对他论证的攻击：`{kind ∈ {REBUT, UNDERCUT}, target_argumentation_rev, target_path?, target_condition?, meta_proposition_rev?}` | 精确引用 | R-L1：`kind=UNDERCUT` 时须指明被打掉的路径或条件，或给出承载它的元命题 | 允许缺失（本论证不攻击他人） | 追加/新论证；攻击不删除被攻击者的登记历史 |

### 2.5 四正交描述轴（继承[系统合同 R3](H_S_R_SYSTEM_CONTRACTS_DRAFT.md)，不得压缩为单值）

| 字段/角色 | 语义 | 类型/取值 | S-L1/R-L0/R-L1 要求 | UNKNOWN/缺失规则 | 修订约束 |
| --- | --- | --- | --- | --- | --- |
| `inference_method` | 推理方法：`DEDUCTION / INDUCTION / STATISTICAL / ABDUCTION / ANALOGY / CAUSAL / DEFAULT / PRACTICAL`（开放） | 值，通常由 Scheme 声明派生 | S-L1：与 `scheme_ref` 声明一致；不一致须显式声明理由 | 允许 `UNKNOWN`（Scheme 未定性） | 改方法即改 Scheme → 新论证 |
| `logical_force` | 逻辑力度：`STRICT / DEFEASIBLE / HEURISTIC` | 值 | S-L1：必填或 `UNKNOWN` | 允许 `UNKNOWN` | 修订；改变已声明力度影响下游可组合性，需新报告 |
| `verification_status` | 验证状况：**不是单值**，而是 `verification_records[]` 的派生呈现（各报告等级不同可并存） | 派生视图 | 不是字段真源；出现“合并等级”即违反 RPT-04 | 无报告 → `NONE_YET`（≠ 未通过） | 只追加报告 |
| `evidence_polarity` | 证据倾向（证据子型适用）：`SUPPORT / REBUT / UNDERCUT / NEUTRAL / UNRESOLVED` | 值 | S-L1：证据子型必填或 `UNKNOWN` | `UNRESOLVED` 合法（倾向未定） | 修订；`UNRESOLVED` 不得渲染为反对（UN-01） |

| 编号 | 规则 |
| --- | --- |
| AX4-01 | 四轴两两独立：方法不蕴含力度（演绎也可标可废止的前提集）、力度不蕴含验证状况、验证状况不蕴含证据倾向。任何 UI/导出把四轴折叠成一个“可靠度”即契约违规。 |
| AX4-02 | “经验支持”属于评价与证据倾向，**不是**与演绎/归纳并列的第九种推理方法；不得为此新增方法值。 |
| AX4-03 | 四轴都不是真值、概率或接纳状态；`verification_status = NONE_YET` 不等于“无效”。 |

## 3. 目标 / 结论 / 结局三分离（C02 的字段落点）

| 情形 | `engagement_target` | `conclusion` / `local_outcome` | 下游禁止误读 |
| --- | --- | --- | --- |
| A 在条件 C 下支持 P | `P@rev` | `ASSERTS → P@rev`；`SUPPORT`；`path_conditions` 含 C（OPEN） | P 成为无条件命题 |
| 实验完成但无区分力 | `P@rev` | `NONE_DECLARED`；`INCONCLUSIVE` | 证得 `¬P`，或给 P 赋 0/0.5 |
| 论证真正推出 ¬P | `P@rev`（被讨论目标） | `DENIES_TARGET → ¬P@rev`；`conclusion_vs_target = NEGATION`；`REBUT` | 把 P 当正前提又靠负 polarity 偷换 |
| B 指出 A1 的条件 C 未满足 | `A1@rev`（被讨论对象） | `ASSERTS_ABOUT_TARGET → Q@rev`（“A1 的 C 本次不满足”）；`UNDERCUT` | A1 的全部结论为假 |

### 3.1 结论端合法性与“无结论”（审查修订 R4）

| 编号 | 规则 |
| --- | --- |
| CN-01 | Scheme 定义必须声明 `conclusion_policy ∈ {REQUIRED, OPTIONAL, NONE_ONLY}`：`REQUIRED` 必须给出精确 `Proposition@rev`；`OPTIONAL` 允许 `NONE_DECLARED`；`NONE_ONLY` 用于纯探索型（不产出结论）。未声明 → R-L1 FAIL(`CONCLUSION_POLICY_UNDECLARED`)。 |
| CN-02 | **已完成但无定论的研究合法**：`mode = NONE_DECLARED` + `local_outcome = INCONCLUSIVE`（或 Scheme 允许的其它无结论结局）是完整合法的对象，**不强迫虚构科学结论**，也不因此判 FAIL。前提是 Scheme 允许（CN-01）。 |
| CN-03 | **组合资格绑定到实例的结论角色，不绑定到整个 Scheme 或整个对象**：`mode = NONE_DECLARED` 的论证实例**不得**充当 `CONCLUSION_INPUT` 角色的端点（没有已推出的命题可绑定）；它**可以**在 Scheme/组合规则显式声明的 `BACKGROUND`（方法与流程背景）、`CASE_STUDY`（失败案例、无区分力实验）、`SUBJECT_OF_DISCUSSION`（被讨论对象）角色中被引用。绑定必须携带 `role_kind`；未声明 → `FAIL(ROLE_KIND_UNDECLARED)`（`RL1-14`）。因此“无定论研究”仍是元研究、方法学复盘与失败案例研究的合法材料（CN-06、`RL1-14`）。 |
| CN-04 | **undercut / rebut 的否定效果必须有明示内容**：`attack_links[]` 与 `local_outcome = UNDERCUT/REBUT` 本身只是**来源承载的主张**，不自动使目标论证失效。若该攻击要作为**有明确结论的正式论证**参与下游组合，其结论端必须是关于目标论证的精确**元命题**（如“A1 的条件 C 在本次不成立”“A1 的推理规则在本次不适用”）；若只是登记一条尚未展开的削弱线索，则登记为攻击主张 + `NONE_DECLARED`（CN-02/CN-03 生效），**不得**在界面上渲染为“目标已被反驳”。 |
| CN-06 | **同一 Scheme 可有不同组合资格的实例**：统计检验 Scheme 既可能产出明确支持结论（可作为 `CONCLUSION_INPUT`），也可能产出 `INCONCLUSIVE`（只能按 `BACKGROUND`/`CASE_STUDY` 被引用）。资格是**逐实例**判定的性质，不是 Scheme 的全局属性；一个实例的无结论不降低另一实例的资格，也不影响 Scheme 定义本身（CN-03、CN-05）。 |
| CN-05 | **组合许可按角色声明结论要求**（SCHEME-6）：Scheme 的 `composition_roles[]` 中每个角色必须声明 `requires_conclusion ∈ {true,false}`。合法形态：`OPTIONAL` Scheme 的**有结论实例**满足规则时可按 `CONCLUSION_INPUT` 参与组合，其 `INCONCLUSIVE` 实例只能按非结论角色被引用。**唯一矛盾形态**：某角色 `requires_conclusion = true` 却同时声明接受 `NONE_DECLARED` 实例填充 → Scheme 自身 S-L1 FAIL(`COMPOSITION_ROLE_CONTRADICTION`)；角色未声明该布尔值 → FAIL(`COMPOSITION_ROLE_UNDECLARED`)。 |

## 4. 身份与修订判据

**身份构成字段**（改变已声明值 → 新 Argumentation）：`scheme_ref`、`engagement_target`、`engagement_role` 的 SUPPORTS/ATTACKS 类别、`conclusion` 的命题端。

| 编号 | 判据 |
| --- | --- |
| AR-ID-1 | 补全输入绑定、条件、路径、结局、对齐声明 → 新修订（旧 revision 保留，历史检查仍锚旧 revision）。 |
| AR-ID-2 | 换 Scheme、换讨论目标、改变实际结论内容 → 新论证；不得“就地改写”成另一件论证（否则历史依赖分析失真）。 |
| AR-ID-3 | 条件的满足/解除、攻击登记、适用性判定**优先作为新记录**附加，而不是覆盖式修改，以便回放“当时认为条件如何”。 |
| AR-ID-4 | 同一论证的构造状态变化（含 `CLOSED_DRAFT`、`WITHDRAWN`、`TERMINATED_BY_SCOPE`）是生命周期修订，不改变身份，也不改变任何其它状态轴。已提交过的论证不得回落到 `CLOSED_DRAFT`（§7）。 |
| AR-ID-5 | 论证内部标识（`path_id`、`condition_id`、`role 绑定 id`）必须稳定，供攻击与依赖分析精确引用；重排这些标识等价于改变身份构成，须新对象。 |
| AR-ID-6 | **"尚未产生结论"与"研究完成而无结论"是两个不同状态，必须可区分**：`conclusion.mode = NONE_DECLARED` **只表达后者**——一次已完成的评估得出没有结论，它必须与 `local_outcome = INCONCLUSIVE` 同现（§3 表第二行）。前者是**尚未推完**，表达为 `conclusion` 整槽 `@st = ABSENT`（此时 `mode`/`proposition_rev` 均不出现）+ **`construction_state = DRAFT`**；**不得**写成 `NONE_DECLARED`，也**不得**写成 `CLOSED_DRAFT`——`CLOSED_DRAFT` 按 §7 专指"停止推进该次未提交的构造"，把仍在推进的构造标成它就是谎报已放弃，还与"补齐输入 → 产生结论"的正常推进直接冲突。四种情形与两个字段轴的对应见 §4.1（**不新增任何状态**，只对齐既有用法）。**补全路径与其身份后果**：草稿 → 结论是 `ABSENT → ASSERTS*(P@rev)` 的**补全修订**（AR-ID-1 意义上），**不产生新论证**——因为 AR-ID-2 改变的是"**已声明值**"，而草稿从未声明过结论端；反之 `NONE_DECLARED → ASSERTS*(P@rev)` **是**身份变化 → 新论证（已声明的"无结论"被改掉了）。两者都必须以修订追加，旧 revision 保留可回放（AR-ID-1、AR-ID-3）。R-L1 对草稿态报"结论未声明"的缺项，**不阻断保存**。**判别两类转移所需输入是现成的，不需新增输入面**：本次提交载荷 + 同一 `object_id` 的 head revision 载荷（修订类请求已带 `expected_head_revision`，接口层据此定位）；无 head（首次登记）按补全处理。 |

### 4.1 结论槽位 × 构造状态 的对齐表（AR-ID-6 的展开；**不新增状态**）

| 实际情况 | `conclusion` | `construction_state` |
| --- | --- | --- |
| 尚在构造，未得结论 | `@st = ABSENT` | `DRAFT` |
| 放弃了未完成的构造 | `@st = ABSENT` | `CLOSED_DRAFT` |
| 研究完成但无定论 | `mode = NONE_DECLARED`，配 `local_outcome = INCONCLUSIVE` | **产生该声明时**为 `SUBMITTED` |
| 已形成明确命题结论 | 精确 `PropositionRevision` | 按实际生命周期记录 |

**`construction_state` 列的配对是"产生该声明那一刻"的约束，不是此后每个修订都必须满足的永久约束**：已提交论证转 `WITHDRAWN` / `TERMINATED_BY_SCOPE` 是生命周期修订，按 `AR-ID-4` 不改其它状态轴，此时 `NONE_DECLARED` 仍合法、不得因此新增违规（把本列读成永久约束会让每次撤回都凭空产出一条 FAIL）。跨修订校验只要求：`NONE_DECLARED` 一旦出现，其**产生时**的 head 为 `SUBMITTED` 且配 `INCONCLUSIVE`。

**两条转移**：`ABSENT → 明确结论` 沿同一 `ArgumentationID` 追加修订（补全，不产生新论证）；`NONE_DECLARED → 明确结论` 是已声明含义的变化 → 新论证。

## 5. 与其它对象的关系

| 方向 | 引用类别 | 规则与禁止 |
| --- | --- | --- |
| Argumentation —`INFERENTIAL`→ Proposition@rev | 前提/输入角色 | 只有 Scheme 声明为命题类角色（如 PREMISE）时端点才是 Proposition；数据/文件类角色指向 Entity |
| Argumentation —`SEMANTIC`→ Proposition@rev | 结论端 | 必须精确 revision；禁止 `NONE` 之外缺省 |
| Argumentation —`EVALUATIVE`→ 论证/关联@rev | 讨论与攻击目标 | 攻击不改动目标的状态轴 |
| Argumentation —`SEMANTIC`→ Concept@rev | Scheme、定义、尺度 | 新版本不倒灌旧论证（C11） |
| Argumentation —`PROVENANCE`→ H 记录 | 本论证由谁在何时以何材料登记 | 来源不是推理（DF-04） |
| Proposition —→ Argumentation@rev | 高阶命题讨论本论证 | 讨论不改变本论证字段；新状态由新记录表达 |
| Argumentation ↔ Argumentation | 引用环 | 引用环允许保存；**不**因闭环自发获得支持资格或证书；归纳/共归纳等由专用 Scheme 规则检查（C10） |

## 6. 子型与相关记录

### 6.1 `EVIDENTIAL`（证据子型）
一项证据在明示背景下对精确命题的局部支持/反对/语境化。**不要求**数值概率；`local_outcome` 与（若有）程度值受 Scheme 尺度声明约束；证据本体仍是 Entity，被绑定为输入。禁止：把 `prov:wasDerivedFrom` 当本论证；把同源数据的多份报告当作多条独立支持（C09）。

### 6.2 `COMPOSITE`（组合论证）
多条路径与多个前提组成对同一目标的论证。跨论证的“替代支持”由共同结论派生视图给出，**不合并条件**、**不假定独立**（C07）。

### 6.3 `ATTACK`（rebut/undercut）
`REBUT` 指向命题内容的反对；`UNDERCUT` 指向特定路径或条件，通常由 `ASSERTS_ABOUT_TARGET` 的元命题承载。禁止把 undercut 推广为否定目标命题本体。

### 6.4 `FORMAL_DERIVATION`（严格推导）
输入含规则/公理/定义版本与证书引用；结论组合必须保留未解除假设（C06）。证书只担保“在 pinned 依赖、公理、精确公式与环境下的内核检查”，不担保翻译忠实与物理适用（CS-22、DF-04）。

### 6.5 `META_APPLICABILITY`（适用性元论证）
结论是“本论证 A1 在场景 S 下不适用/条件 C 本次未满足”的元命题；这是正常完整的研究结局，**不**强制 `CLOSED_DRAFT`，也**不**全局删除 A1 或其结论（CS-09）。

### 6.6 语义缺口与义务触发
跨 World、跨表示或跨层次的推理步骤必须说明跨越了什么。领域把常见跨越登记为**语义缺口类型**（开放注册的 Concept 子型：形式数学→物理模型、连续→离散、算法→软件实现、数值预测→真实装置、原始信号→观测结论、相关→因果、局部样本→普遍规律、已检验工况→新工况、性能达标→可部署，以及同一 WorldType 的不同版本之间）。

| 编号 | 规则 |
| --- | --- |
| GAP-01 | 论证跨越某缺口时，Scheme 可要求其声明 `gap_crossings[]`（缺口类型 + 两端引用 + 跨越依据）。缺声明按 Scheme 要求记 `FAIL(DEFICIENCY)`，**不**推断“跨越不成立”；目标因权限不可见 → `INDETERMINATE`（RPT-08）。 |
| GAP-02 | 跨越本身合法：它触发 ProofObligation（如模型适用性、实现一致性、数值误差界、标定、物理验证、范围相容、不确定度传播），而非禁止该步骤。 |
| GAP-03 | 义务 `OPEN` 时允许继续条件性探索与条件性结论（D15）；被豁免只表示有权主体允许特定使用继续，**不得**呈现为已证明。 |
| GAP-04 | 不存在“同一 World 内的推理天然安全”这一默认：同 World 不同版本或不同表示之间的跨越同样需要声明与检查记录。 |
| GAP-05 | 缺口登记不裁决跨越是否成立；成立与否仍由命题、论证、评价与接纳各自承担（DF-01）。 |

## 7. 生命周期

`DRAFT`（结构可不全，R-L1 可有 FAIL 项）→ `SUBMITTED`（请求 R-L0/R-L1 检查，产生报告）→ 后续被攻击/被适用性判定/条件被解除 → 可选 `CLOSED_DRAFT`（停止推进）。

**关闭与撤回是两件事**（审查修订 R5）：`CLOSED_DRAFT` 只用于**从未提交过**的草稿停止推进；已经 `SUBMITTED` 过的论证不得回落到 `CLOSED_DRAFT`，只能进入 `WITHDRAWN`（主体声明不再以此为准，附理由，历史与旧报告全部保留）或 `TERMINATED_BY_SCOPE`（范围/前提变更导致不再适用）。状态变化一律是新修订并留下来源；被撤回不删除、不隐去旧报告，也不使引用过它的下游对象自动失效（RV-03）。

非阻断性（DF-07）：R-L0/R-L1 的任何 FAIL **都不阻止**保存、阅读、检索、被高阶命题讨论、继续补充输入；FAIL 只限制两件事：不得进入被认证的组合推理，不得在导出/统计中被呈现为“结构合规”。

## 8. 例子

**合法例**：论证 `A7@r3`，`scheme_ref = S_IND@r2`（归纳推广）；`engagement_target = P7@r2`；`input_bindings = [OBSERVATION_SET → E44@r1（18 个 run 的结果集，alignment=EXACT_MAP→C8@r3）, DEFINITION → C8@r3]`；`support_paths = [path-1: {E44}]`；`path_conditions = [{condition = P9@r1（"扫描点覆盖工况范围 W1 全域"）, status = OPEN, path_scope = [path-1]}]`；`local_outcome = SUPPORT`；`construction_state = SUBMITTED`；R-L1 PASS；`confirmation` 与接纳均为独立轴。C9 受质疑时**只**报告 `path-1` 受影响；另一条依赖 C10 的独立论证不受牵连（CS-16）。

**关键非法/易混淆例**：

| 情形 | 为什么非法 | 正确做法 |
| --- | --- | --- |
| 数据未补齐就填一个占位符充当 Scheme 必填的实测角色 | CS-06：空占位伪装成已满足 | 该路径标 `UNBOUND(PENDING_INPUT)`，R-L1 FAIL 但可保存为 DRAFT |
| 把 0.8 与 0.6 两个局部程度值取平均当作 P 的“综合支持度” | 未声明尺度与允许运算，违反 C02 | 保留两个带尺度声明的局部值；需要聚合须先声明尺度 Profile 与运算 |
| 把一次贝叶斯分析算出的后验概率 0.9 直接填成 `degree_value`，当作论证对 P 的支持度 | 后验是**在声明的模型、先验与数据下计算出的科学结果**，不是论证层面的支持度；两者的尺度含义不同 | 后验作为 Result/Entity + 相应命题登记（命题内含模型/先验/数据范围），论证若引用它则作为带角色的输入；只有 Scheme 声明了尺度语义时才另有 `degree_value` |
| P 有两条替代路径依赖 C1、C2，系统输出“P 需 C1∧C2” | 违反 C07/CS-16 | 条件按 `path_scope` 逐路径保留；仅在显式组合规则下才合并 |
| 同一份 CCD 数据的两版分析被登记为两条独立支持 | 违反 C09/CS-17 | 两条都登记，并填 `shared_dependency_refs`；独立性需 Scheme 明确声明 |
| 因未找到反证而把 `local_outcome` 设为 `REBUT` | 违反 DF-05/C12 | 登记为“在已检查范围内未找到反证”的条件性命题或检索边界记录 |
| 新校验器版本重检旧论证失败，于是旧 PASS 被改成 FAIL | 违反 C11/DF-06 | 追加新报告；历史报告保留其规则版本与时间 |
| 用 `latest` 引用某命题作为结论端 | 违反 ID-05/RF-02 | 必须 `Proposition@revision` |
