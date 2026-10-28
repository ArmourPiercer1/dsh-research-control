# S-L0/S-L1 与 R-L0/R-L1 规范化详细契约

> **PR #42 · DRAFT-PROPOSAL · 2026-10-28。** 把[主基线](H_S_R_FIVE_OBJECT_ARCHITECTURE_DRAFT.md) §2 的“S-L0 可解析、S-L1 结构合法”落实为可被后续 Schema 与 validator 实现的检查规则。共享约定见[共同底座](H_S_R_DOMAIN_FOUNDATIONS_DRAFT.md)；被检查字段只在各对象契约中定义。
>
> **两条硬边界**：①规范化是**结构门禁**，不是科研真实性审查；②任何 FAIL **都不阻止保存、阅读、检索、引用与继续研究**（DF-07），只影响该版本能否进入被认证的组合推理与“结构合规”呈现。S-L2/S-L3 与更高 R 等级本轮只留扩展边界，不设计规则。**Proposed，不表示已实施。**

## 1. 检查报告与判定词表

`CheckReport = {target 引用（可到 @rev 或 @rev#representation）, contract_version, checker 标识与版本, checked_at, subject_space, findings[]}`；`finding = {rule_id, outcome, field_path, reason_code, message}`。

| `outcome` | 含义 | 计入 |
| --- | --- | --- |
| `PASS` | 该检查项在此契约版本下满足 | 计入层级达成 |
| `FAIL` | 结构/引用/角色不满足（含必填 `ABSENT`、跨类端点、非法取值） | 阻断层级达成，不阻断保存 |
| `PENDING_SEMANTICS` | 字段为 `UNKNOWN` 或引用 `UNRESOLVED`，结构上合法但语义待补 | **不**算 FAIL，也**不**算 PASS；单列“待补语义”计数 |
| `NOT_APPLICABLE` | 该检查项在此 kind/子型/Scheme 下不适用，须带理由 | 不计入分母 |
| `UNKNOWN` | 检查器、规则或依赖资源不可用（超时、崩溃、版本缺失） | **绝不**折算为 FAIL 或科学否定（`F-CHECK-UNAVAILABLE`） |

| 编号 | 报告规则 |
| --- | --- |
| RPT-01 | 报告**追加不可改**：新契约版本、新检查器版本重检旧对象产生**新报告**；历史 PASS 与其规则/环境/时间永久保留（C11）。 |
| RPT-02 | 层级由“该层级全部检查项 `PASS`（或合法 `NOT_APPLICABLE`）”得出；存在 `PENDING_SEMANTICS` 时层级**未达成**但不记为违规。 |
| RPT-03 | 报告必须携带 `subject_space` 与被屏蔽引用计数；因权限不可判定的项记 `NOT_APPLICABLE(reason=WITHHELD)`，不得记 PASS 或 FAIL。 |
| RPT-04 | 报告不得包含科学充分性、方法恰当性、样本代表性或结论真值判断；出现此类字段即契约违规。 |

## 2. 七种记录形态的区分（本轮要求的分类）

| 记录形态 | 落点 | 状态组合 | 是否可保存 |
| --- | --- | --- | --- |
| ① 无法解析的原始记录 | H 原始记录（IC-H3），**不是**正式对象 | 无 S 层级；原文+来源完整 | 是（最低门槛即保存） |
| ② 已解析但语义字段不完整 | 正式对象，`S-L0` 达成、`S-L1` 未达成 | `FAIL(reason=REQUIRED_ABSENT)` + `PENDING_SEMANTICS` | 是 |
| ③ 具有基本合法引用与结构 | `S-L1` 达成（论证另可 `R-L0`/`R-L1` 达成） | 全项 PASS/`NOT_APPLICABLE` | 是 |
| ④ 需要主体确认但未确认 | `S-L1` 达成 + 状态轴 A3 `UNCONFIRMED` | `confirmation ≠ S-L1`；两者独立呈现 | 是 |
| ⑤ 结构合法但科学上可能错误 | `S-L1`（+ `R-L1`）达成 + 相反 Assessment 并存（A6） | 结构合规 ≠ 科学有效（D18） | 是，且必须能同时看到相反意见 |
| ⑥ 尚未形式化的合法命题 | `S-L1` 达成 + `representations` 为空或含 `UNKNOWN` 等价声明 | 无 S-L2；形式化非前置条件 | 是 |
| ⑦ 条件未满足但可继续探索的论证 | `R-L1` 达成 + `path_conditions.status = OPEN` + 义务 `OPEN` | 不阻断条件性使用（D15） | 是 |

## 3. 通用检查项（适用全部五类）

| 规则号 | 检查 | FAIL 条件 | 负例 |
| --- | --- | --- | --- |
| `SL0-COM-01` | 载荷可按声明 kind 解析为对象骨架 | 无法解析 → `F-SCHEMA-INVALID`，转 H 原始记录 | 把自由文本整段当作关联载荷提交 |
| `SL0-COM-02` | `object_kind` 明确 | kind 缺失或取值不在五类 | 提交 `kind: RESEARCH_ITEM` |
| `SL0-COM-03` | `space_id` 明确 | 缺失或多值 | “公共空间”对象试图被两个空间写入 |
| `SL1-COM-01` | 全部引用为精确形式或显式 `UNRESOLVED` | 出现 `latest` / 无版本引用于正式声明位置（ID-05、RF-02） | 论证结论端写 `P7(latest)` |
| `SL1-COM-02` | 全部同空间引用可解析；跨空间引用呈现 `WITHHELD` | 引用其他空间对象且未标注为不可见 | 借公共概念引用另一空间的私有实验个体 |
| `SL1-COM-03` | 每个字段有明确五态之一 | 空串/空集合被用作“未知”替代 | `world_ref: ""` 表示不知道 |
| `SL1-COM-04` | 不出现禁止字段（真值、置信度、当前有效等） | 出现 §“明确禁止字段”中的任一 | 命题带 `confidence`；关联带 `is_current` |
| `SL1-COM-05` | 来源与主体字段存在或显式 `UNKNOWN` | 既无主体也无 `UNKNOWN(reason)` | 匿名“系统自动”结论无来源材料 |
| `SL1-COM-06` | 时间字段类别未被混用 | 用 `recorded_at` 填 `described_interval` 等 | 把补录时间当作现象发生时间 |

## 4. 分对象 S-L1 规则

### 4.1 Entity（`SL1-ENT-*`）

`SL1-ENT-01` 活动个体的导出形态声明为活动而非资源；`SL1-ENT-02` 观测子型的结果引用允许缺失但须显式（失败观测可无 Result，`NOT_APPLICABLE` 需理由）；`SL1-ENT-03` 资源个体若声明载体则哈希形态合法，未声明记 `PENDING_SEMANTICS`；`SL1-ENT-04` 可用性**不作为布尔字段**存在（检查其有无，有即 FAIL）；`SL1-ENT-05` 关系类内容（上下游、使用、生成）不得写进 Entity 字段（FAIL）；`SL1-ENT-06` RegistryEntry 与被登记资源的引用方向正确；`SL1-ENT-07` 计划态与已发生态互斥取值。
**负例**：给失败采集伪造 `sosa:Result` 以通过检查；把设备上下游塞进 `Entity.upstream`；把跨空间不可用呈现为“资源不存在”。

### 4.2 Concept（`SL1-CON-*`）

`SL1-CON-01` `concept_subtype` 明确；`SL1-CON-02` 词法字段（label/altLabel）与含义字段（definition/signature）分离，词法修订不得标 `SUBSTANTIVE`；`SL1-CON-03` WorldType 声明为开放类型（出现封闭枚举集合即 FAIL）；`SL1-CON-04` `PredicateSignature`（若有）自洽：参数角色齐备、量纲引用可解析——**只查自洽，不查它是否与某命题匹配**；`SL1-CON-05` Scheme 定义见 §5；`SL1-CON-06` W3C 别名仅在声明精确等价时存在；`SL1-CON-07` 维度/选项定义之间无重复 option 标识。
**负例**：把 Theory/Simulation/Engineering 写成封闭三值；`skos:closeMatch` 被当作等价证明；给谓词签名加上“已验证”。

### 4.3 Association（`SL1-ASS-*`）

`SL1-ASS-01` `relation_type_ref` 解析到关系类型定义；`SL1-ASS-02` 参与者 ≥2 且角色名在类型声明内；`SL1-ASS-03` `directionality` 存在；`SL1-ASS-04` `described_interval` 存在或显式 `UNKNOWN`；`SL1-ASS-05` 来源主张存在或显式 `UNKNOWN`（后者 FAIL，仍保存）；`SL1-ASS-06` 无真值/置信度/当前有效字段；`SL1-ASS-07` 冲突与替代主张引用可解析；`SL1-ASS-08` 采用信息**不**内联在关联字段中（发现即 FAIL，要求改为采用记录）。
**负例**：`is_current` 字段；把 T2 下游记录写成对 T1 上游记录的反证；用 `skos:related` 表达具体设备关系。

### 4.4 Argumentation 的 S 侧（`SL1-ARG-S*`）

`SL1-ARG-S1` 讨论目标、结论端、局部结局三个角色可区分（缺任一显式角色 = `PENDING_SEMANTICS`；把三者写成同一字段 = FAIL）；`SL1-ARG-S2` 程度值（若有）携带尺度引用（缺失记 `PENDING_SEMANTICS`，其**参与运算的资格**由 §5 `RL1-*` 控制）；`SL1-ARG-S3` `construction_state` 与结局/层级字段互不推导（出现映射约束即 FAIL）。

### 4.5 Proposition（`SL1-PRO-*`）

`SL1-PRO-01` `primary_expression` 存在且非空；`SL1-PRO-02` 每个表示带 `equivalence_claim`（沉默按 `UNKNOWN` 记 `PENDING_SEMANTICS`）；`SL1-PRO-03` 表示若声明 `SAME_TRUTH_CONDITIONS` 则必须有声明者（缺 → FAIL）；`SL1-PRO-04` 表示若 `added_assumptions` 非空则**禁止** `SAME_TRUTH_CONDITIONS`（违反 → FAIL，对应 CS-22）；`SL1-PRO-05` `world_ref`/`scope_refs`/`dimension_binding`/`variable_bindings` 存在或显式 `UNKNOWN`；`SL1-PRO-06` 修订携带 `truth_condition_claim`，且 `CHANGED` 却写同一 PropositionID → FAIL（PR-ID-4）；`SL1-PRO-07` 提及集合的角色合法、允许 `SELF`；`SL1-PRO-08` 无真值/概率/fact_status 字段；`SL1-PRO-09` 子型专有字段满足（如 ASSESSMENT 需 assessor 与精确目标；FACT_DESIGNATION 需动作与精确命题版本）。
**负例**：Lean 公式加进来就把 `equivalence_claim` 默认成“等价”；把 `¬P` 写成 P 的一个表示；评价性命题缺 assessor。

## 5. R-L0 / R-L1（仅 Argumentation）

| 规则号 | 检查 | 判定 |
| --- | --- | --- |
| `RL0-01` | 声明了 `scheme_ref` 且解析到合法 InferenceSchemeDefinition | 缺失/悬空 → **FAIL**（本版本不是正式论证，转研究材料保存） |
| `RL0-02` | Scheme 版本引用精确 | `latest` → FAIL |
| `RL1-01` | Scheme 声明的必填输入角色全部有绑定 | `UNBOUND(reason)` → `PENDING_SEMANTICS`；空占位/占位符 → **FAIL**（`CS-06`） |
| `RL1-02` | 每个绑定的端点类别 ∈ 该角色允许类别 | 违反 → FAIL（`ROLE_CATEGORY_MISMATCH`，如把文件当数学前提） |
| `RL1-03` | 目标形式符合 Scheme 声明（命题端为精确 PropositionRevision；被讨论目标允许为论证/关联） | 违反 → FAIL |
| `RL1-04` | 结论模式合法；`NONE_DECLARED` 与结局取值相容 | 冲突 → FAIL（如 `ASSERTS` 却无命题端） |
| `RL1-05` | `local_outcome` ∈ Scheme 声明的结局词表 | 越界 → FAIL（`OUTCOME_NOT_IN_SCHEME`） |
| `RL1-06` | 每条路径的前提引用可解析 | 悬空 → `PENDING_SEMANTICS` |
| `RL1-07` | 条件均带 `path_scope`；作用域指向存在的稳定标识 | 悬空作用域 → FAIL（`CONDITION_SCOPE_UNRESOLVED`） |
| `RL1-08` | 程度值存在时 `scale_ref` 与 `allowed_operations` 齐备 | 缺失 → FAIL（`DEGREE_SCALE_UNDECLARED`，CS-10） |
| `RL1-09` | 攻击引用的目标论证/路径/条件可解析；undercut 指明被打掉项或元命题 | 悬空 → FAIL |
| `RL1-10` | Scheme 要求对齐的角色均有 `alignment_claim.relation`（`UNKNOWN` 合法） | 缺失 → FAIL（`ALIGNMENT_UNDECLARED`，CS-12/CS-13） |
| `RL1-11` | Scheme 要求独立性声明时 `shared_dependency_refs` 存在或显式 `UNKNOWN` | 缺失 → FAIL；**不**判定实际独立性 |
| `RL1-12` | 证明依赖图中的引用环不被自动赋支持 | 环检测：只标注“存在依赖环”，**不**因此 FAIL 也**不**授予证书（C10） |
| `RL1-13` | Scheme 要求声明语义跨越时，`gap_crossings[]` 存在且两端引用可解析 | 未声明 → FAIL(`GAP_CROSSING_UNDECLARED`)；声明但目标悬空 → `PENDING_SEMANTICS`；**不**判定跨越是否成立（Argumentation GAP-01/GAP-05） |

`RL1-*` 全部通过 → `R-L1` 达成。**明确不检查**：Scheme 选得是否恰当、样本代表性、统计模型适用、归纳强度、类比相关性、演绎是否真为有效证明、结论科学正确性、条件是否实际满足、结论是否值得接纳。

## 6. 明确不属于 S-L0/S-L1 的检查（负面清单）

| 编号 | 永不做 | 依据 |
| --- | --- | --- |
| NEV-01 | 判定对象分类是否“实质恰当”、概念是否“真正同义”、命题是否“实质等价” | 主基线 §1/§2、C05 |
| NEV-02 | 判定科学充分性、代表性、可复现性、结论真值 | D18、DF-07 |
| NEV-03 | 把 LLM 抽取忠实度折算为 S-L1 结果 | 原意确认独立（IC-S6） |
| NEV-04 | 要求形式化、谓词逻辑化或全库术语消歧作为 S-L0/S-L1 前置 | 主基线 §2、D17 |
| NEV-05 | 用“缺失即违规”“未知即不合规”惩罚研究者（缺失只 `FAIL` 于必填且允许 `UNKNOWN` 表达） | UN-01/UN-03 |
| NEV-06 | 生成科学正确性总评分或把四轴压成单值 | 系统合同 R3 |

## 7. 扩展边界（只留接口，不设计规则）

| 扩展点 | 预留内容 | 不在本轮 |
| --- | --- | --- |
| S-L2 候选 | 谓词签名匹配、变量绑定与捕获检查、量纲一致性、受控表达式 AST | 任何具体判定算法、自动等价/去重 |
| R 更高等级 | 规则/证书检查、内核证明、统计方法审查记录：均**新增报告类型**，绑定精确表达 + 规则/环境/计算基版本 | Lean 后端、证明搜索、自动翻译 |
| 义务与政策 | 义务来源规则注册、豁免政策、复审触发策略 | 自动阻断政策、Agent 调度 |
| 跨 Scheme 组合 | 显式组合规则注册与其许可记录 | 通用支持传递律、概率合成 |

## 8. 落地的最小验证预期（供后续测试设计，非已运行）

每条 `PASS`/`FAIL` 规则都需要：一个正例、一个仅违反该规则的反例、一个“显式 `UNKNOWN` 因而 `PENDING_SEMANTICS`”的例子；CS-01–CS-24 的映射见[组合与反例矩阵](H_S_R_COMPOSITION_MATRIX_DRAFT.md)。**本轮未编写或运行任何 validator、Schema 或测试**；上述只是可测试性要求。
