# 接口目录：IC-\* 操作到工具形态的映射

> **PR #47 · DRAFT-PROPOSAL · 2026-10-29。** 把[领域交互契约](H_S_R_INTERACTION_CONTRACT_DRAFT.md)（PR #42，未合并）的每个 IC-\* 操作映射为一个工具入口的请求/响应形态。**操作语义、前置条件与不变量由契约层裁决，本文只裁决形态**；凡冲突以契约层为准。通用纪律（包络、错误、两视图、幂等、分页、双时相）见[接口基座](H_S_R_INTERFACE_FOUNDATIONS_DRAFT.md)，本文不重复。
>
> **工具名是本层的建议命名**，落地前属冻结面变更（SI-02）。所有写操作隐含：主体与 `run_id` 由宿主注入（SI-01）、`client_request_id` 必填（SI-41）、`space_id` 必填（接口基座 §2.1）。**Proposed，不表示已实施。**

## 1. 记法

- 列名 **必填** / **可选** 中的名字是请求槽位名，遵循 SF-02（与契约阅读名同名）；稀疏提交合法（SI-11）。
- `ref` = 精确引用 `obj@rN`（可带 `#rep`）；`ref?` = 五态之一包裹的引用；`rec:` = 非对象记录引用（SF-24）。
- **视图类**：`A` = 可为有权者呈审计视图；`S` = 恒定脱敏；`—` = 无跨空间可见性判定（同空间写入回执）。
- **失败码**列只列该操作可能出现的领域码；`F-DENIED-WRITE` / `F-DENIED-AUTH` 的适用性按 SI-22，凡涉及跨空间或正式接纳/豁免的操作都可能出现，表中不重复罗列。

## 2. H：历史、来源与回放

| 工具名 (IC) | 必填 | 可选 | 成功响应 | 失败码 | 视图 | 测试锚点 |
| --- | --- | --- | --- | --- | --- | --- |
| `hsr_record_append` (IC-H1) | `object_kind`, `payload`（规范形态，槽位穷尽）, `source_refs` | `claimed_time`, `client_note` | `object_id` + `r1` + `record_id` + `report_refs[]` | `F-SCHEMA-INVALID`(→H 原始记录), `F-UNRESOLVED`, `F-WITHHELD`, `F-INCOMPLETE` | `—`/`A`(后续读) | 载荷非法必须落 H 原始记录而非拒收；缺字段不得被补默认值（SI-12、UN-02） |
| `hsr_revision_append` (IC-H2) | `object_id`, `expected_head_revision`, `changeset`, `revision_class`, `reason` | `completion_basis`(必填于补全), `truth_condition_claim`(Proposition 必填) | 新 `revision_id` + `record_id` + `report_refs[]` | `F-PRECONDITION-REVISION`(见 SI-24), `F-INCOMPLETE`, `F-CONFLICT` | `—` | 前置不匹配不产生记录；身份构成字段变更必须被要求转新建（G-REV） |
| `hsr_raw_record_register` (IC-H3) | `raw_text`, `source_refs` | `candidate_hint` | `record_id`（**无** `object_id`） | `F-RETRYABLE` | `—` | 响应绝不返回 `object_id`；原文字节不被改写（SF-42） |
| `hsr_assertion_link_append` (IC-H4) | `chain_ref`(新或旧), `member` = `ref`(命题), `relation_claim`, `reason` | `chain_title` | `chain_id` + `record_id` | `F-UNRESOLVED`, `F-DENIED-AUTH` | `—` | 链成员序不被重排；链不携带真值（ID-06）；非链主声明另记不覆盖 |
| `hsr_availability_check_record` (IC-H5) | `target` = `ref`, `method`, `result` ∈ A8 取值, `checked_at`, `checker` | `evidence_refs` | `record_id` + A8 投影回执 | `F-WITHHELD`, `F-RETRYABLE` | `—` | 检查失败不删除对象、不改旧检查记录（IC-H5 不变量） |
| `hsr_history_replay` (IC-H6) | `space_id` | `recorded_as_of`, `described_at`/`described_during`, `perspective` ∈ {`as-recorded`,`as-claimed`,`both`}, `version_selection` ∈ {`at-revision`,`chain-at`,`as-declared-by`}, `actor_filter`, `scope_filter`, `cursor`, `limit` | 投影 + `echo`(两个时间实际值+视角+版本选择) + 缺失/未映射/未知清单 + `boundary` | `F-PARTIAL`, `F-WITHHELD` | `A`/`S` | 过滤顺序固定（先知识截点后对象时间）；缺省时间必须回显；晚到登记不得出现在早截点（T-02） |
| `hsr_gaps_query` (IC-H7) | `scope` | `category_filter[]`, `as_of`, `cursor`, `limit` | 分类清单：`UNRESOLVED` / `UNRETRIEVABLE` / `ABSENT(必填)` / `INDETERMINATE`(仅标注存在，不给计数) / 截断点 | `F-PARTIAL` | `S`(权限类) | 两类不得合并统计、不得由总数反推（SP-07）；空结果仍带 `boundary` |

## 3. S：语义与规范化

| 工具名 (IC) | 必填 | 可选 | 成功响应 | 失败码 | 视图 | 测试锚点 |
| --- | --- | --- | --- | --- | --- | --- |
| `hsr_object_register` (IC-S1) | `object_kind`, `payload`, `source_refs` | `register_note` | `object_id` + `r1` + 首轮 `report_refs[]`（`status = ACCEPTED_WITH_FINDINGS` 若含 FAIL） | `F-SCHEMA-INVALID`, `F-INCOMPLETE`, `F-UNRESOLVED`, `F-WITHHELD` | `—` | 保存永不被结构 FAIL 阻断（SI-21、DF-07） |
| `hsr_check_request` (IC-S2) | `target` = `ref` 或 `ref#rep` | `contract_version`, `checker_hint`, `scope`(检查范围) | `report_id`（异步时 + 轮询参数） | `F-CHECK-UNAVAILABLE`(→报告 `INDETERMINATE`), `F-RETRYABLE` | `A`/`S` | 每次产生新 `report_id`；不可用不得折叠为不通过（SI-23） |
| `hsr_check_report_get` (SCR/SI-63) | `report_id` | — | 审计视图或脱敏呈现视图（按调用者授权，SI-30） | `F-WITHHELD` | `A`/`S` | 同请求两世界逐字节同形（SCR-54） |
| `hsr_object_amend` (IC-S3) | `object_id`, `expected_head_revision`, `changeset` | `truth_condition_claim`, `completion_basis`, `reason` | 新 `revision_id` + `report_refs[]` | `F-INCOMPLETE`, `F-CONFLICT`, `F-PRECONDITION-REVISION` | `—` | 概念/World 新版本不得倒灌旧含义（C11） |
| `hsr_proposition_establish` (IC-S4) | `payload`(含 `truth_condition_claim = CHANGED`), `source_refs` | `chain_ref`, `diff_note` | 新 `PropositionID` + `report_refs[]` | `F-CONFLICT`(并存不合并) | `—` | 同 ID 承载真值条件变化必须被拒（PR-ID-4） |
| `hsr_concept_revise` (IC-S5) | `object_id`, `expected_head_revision`, `revision_class` ∈ {LEXICAL, SUBSTANTIVE}, `changeset`, `reason` | `impact_self_report`(SUBSTANTIVE 必填于该分支) | 新 `revision_id` + 定向重检提示（受影响引用清单） | `F-CONFLICT`, `F-PRECONDITION-REVISION` | `—` | 提示不改写历史 PASS；`revision_class` 与实际改动字段集矛盾必须 FAIL（`SL1-CON-02`） |
| `hsr_intent_confirm` (IC-S6) | `target` = `ref`, `stance` ∈ {CONFIRMED, DISPUTED}, `basis_refs` | `scope` | `record_id` + A3 投影回执 | `F-DENIED-AUTH`(降级为普通评价) | `—` | 确认不改变 S-L1 结果；他人不得代确认（IC-S6 不变量） |
| `hsr_alignment_declare` (IC-S7) | `from` = `ref`, `to` = `ref`, `relation` ∈ {EXACT_MAP, DECLARED_MAP, ASSUMED, UNKNOWN}, `basis_refs` | `note` | Association `object_id` 或元命题 `object_id` | `F-UNRESOLVED`, `F-WITHHELD` | `—` | 未通过检查时允许保留候选但不得呈"已对齐"（C05） |
| `hsr_high_order_proposition_register` (IC-S8) | `mentions[]`(每项 `ref` + `role`), `payload` | `source_refs` | 新 `PropositionID` | `F-UNRESOLVED` | `—` | 自指允许；被讨论对象字段不被改写 |
| `hsr_identity_claim_register` (IC-S9) | `subjects[]`(≥2 精确引用), `claim` ∈ {POSSIBLY_SAME, DEFINITELY_DISTINCT, NAME_COLLISION, INCOMPATIBLE_AS_STATED, SUPERSEDES_AS_STATED}, `basis_refs` | `note` | 主张记录 `object_id`（高阶命题承载主张 + 精确提及） | `F-WITHHELD` | `—` | 绝不自动合并/重定向/标记冲突（ID-07、AS-CF-3）；机器提示与本记录分属两类 |

## 4. Association

| 工具名 (IC) | 必填 | 可选 | 成功响应 | 失败码 | 视图 | 测试锚点 |
| --- | --- | --- | --- | --- | --- | --- |
| `hsr_association_register` (IC-A1) | `relation_type_ref` = `ref`, `participants[]`(端点 `ref` + 角色名), `directionality`, `described_interval`?, `source_assertion`(含 `registrant_ref`/`actor_ref?`/`voice`/`basis_refs`) | `context_refs`, `note` | `object_id` + `r1` + `report_refs[]` | `F-UNRESOLVED`, `F-CONFLICT`, `F-WITHHELD`, `F-INCOMPLETE` | `—` | 出现内联冲突/替代字段 → FAIL(`SL1-ASS-07`)；作者 `UNKNOWN` 必须 PASS+gap（`SL1-ASS-05`） |
| `hsr_association_amend` (IC-A2) | `object_id`, `expected_head_revision`, `changeset`, `revision_class` | `reason` | 新 `revision_id` | `F-CONFLICT`, `F-PRECONDITION-REVISION` | `—` | 不得实现为"更新为现状"（AS-ID-6） |
| `hsr_association_adopt` (IC-A3) | `adopted_ref` = `ref`, `adoption_scope`, `adoption_at`, `basis_ref` | `assumptions[]` | 采用记录 `record_id`（A5 载体） | `F-UNRESOLVED`, `F-DENIED-AUTH` | `—` | 采用 ≠ 验证 ≠ 接纳（AD-03）；外推到新场景必须新记录（AD-02） |

## 5. R：论证、条件、验证与接纳

| 工具名 (IC) | 必填 | 可选 | 成功响应 | 失败码 | 视图 | 测试锚点 |
| --- | --- | --- | --- | --- | --- | --- |
| `hsr_argument_append` (IC-R1) | `scheme_ref` = `ref`, `target`, `conclusion_mode`, `input_bindings[]`(可含 `UNBOUND(reason)`), `path_conditions[]`, `construction_state` | `object_id`+`expected_head_revision`(补全分支), `close_reason`(`CLOSED_DRAFT` 必填) | `object_id`/新 `revision_id` + `report_refs[]` | `F-SCHEMA-INVALID`(scheme 悬空→退研究材料), `F-INCOMPLETE` | `—` | 空占位伪装已绑定必须 VIOLATION（CS-06）；关闭只改 A1，不得动其他轴（C03） |
| `hsr_argument_check` (IC-R2) | `target` = `ref` | `contract_version` | `report_id`（R-L0/R-L1 各项 + `verdict`） | `F-CHECK-UNAVAILABLE`, `F-RETRYABLE` | `A`/`S` | `FAIL` 不阻断保存；混合结果归约唯一（XC-27） |
| `hsr_input_bind` (IC-R3) | `argument` = `ref`, `endpoint` = `ref`, `role_name`, `role_kind` ∈ {CONCLUSION_INPUT, BACKGROUND, CASE_STUDY, SUBJECT_OF_DISCUSSION}, `alignment_claim` | `note` | `record_id`/新 `revision_id` + finding | `F-UNRESOLVED`, `F-INCOMPLETE`, `F-WITHHELD` | `—` | `role_kind` 缺失必须 FAIL(`ROLE_KIND_UNDECLARED`)；无结论实例充当 `CONCLUSION_INPUT` → FAIL（`RL1-14`、XC-26） |
| `hsr_condition_append` (IC-R4) | `condition_proposition` = `ref`, `path_scope[]`, `new_status` | `discharge_basis`(解除/质疑必填于该分支) | `record_id` + 依赖视图回执 | `F-UNRESOLVED`, `F-CONFLICT` | `—` | 解除必须有依据；`UNKNOWN` 条件 ≠ 不成立（CS-08） |
| `hsr_attack_register` (IC-R5) | `attacker` = `ref`, `target_argument` = `ref`, `meta_proposition` = `ref`, `kind` ∈ {REBUT, UNDERCUT} | `target_path_or_condition` | 攻击登记 `record_id`（主张内容只在记录里，`attack_links[]` 是它的派生视图，SS-49） | `F-UNRESOLVED` | `—` | undercut 不否定目标命题本体、不删除被攻击记录（CS-09）；不得使目标呈"已反驳"（CN-04）；**测试**：写记录后读回的 `attack_links[]` 必须与之逐字段一致，且不存在任何能单独写 `attack_links[]` 的路径（双真源探针） |
| `hsr_verification_record` (IC-R6) | `target` = `ref` 或 `ref#rep`, `rule_ref`, `environment_ref`, `result`, `checked_at` | `computational_base_ref` | `record_id` | `F-CHECK-UNAVAILABLE`(→`UNKNOWN`), `F-RETRYABLE` | `—` | 新记录不覆盖旧 PASS；`UNKNOWN` ≠ 失败 ≠ 反证 |
| `hsr_impact_query` (IC-R7) | `subject` = `ref` | `as_of`, `depth`, `cursor`, `limit` | 受影响路径清单 + 独立支持路径清单 + 未登记依赖的未知声明 + `boundary` | `F-PARTIAL` | `A`/`S` | 只沿已登记依赖传播；必须标注遍历边界（R5） |
| `hsr_assessment_record` (IC-R8) | `target` = `ref`, `stance`, `scope`, `basis_refs` | `note` | 评价命题 `object_id`（A6） | `F-UNRESOLVED`, `F-WITHHELD` | `—` | 可相互矛盾并存；不改变目标字段（CS-11） |
| `hsr_acceptance_record` (IC-R9) | `target` = `ref`, `action` ∈ {ACCEPT, SUSPEND, WITHDRAW}, `scope`, `effective_time`, `authority_basis` | `note` | `record_id`；`status = ACCEPTED_UNVERIFIED` 若授权不可校验（SI-22） | `F-DENIED-AUTH`, `F-DENIED-WRITE` | `—` | 无写权限时目标空间零记录（SP-09(b)）；检查 PASS 不产生接纳（PR-A3） |
| `hsr_acceptance_query` (IC-R10) | `subject_ref`, `scope`, `target` = `ref` | `as_of`, `cursor`, `limit` | 派生投影 + 支撑声明集合 + 冲突提示（标注为机器提示） | `F-PARTIAL`, `F-WITHHELD` | `A`/`S` | 不合并不同主体/范围；不得由投票或平均得出（IC-R10 不变量） |
| `hsr_conditional_conclusions_query` (IC-R11) | `scope` | `include_open_obligations`(bool), `as_of`, `cursor`, `limit` | 每条结论附未解除条件（按路径）/开放义务/实际命题端/层级/缺失资源 | `F-PARTIAL`, `F-CHECK-UNAVAILABLE` | `A`/`S` | `OPEN` 不得被过滤掉；条件性结论不得压缩为无条件（D15） |

## 6. 跨系统读侧投影

| 工具名 (IC) | 必填 | 可选 | 成功响应 | 失败码 | 视图 | 测试锚点 |
| --- | --- | --- | --- | --- | --- | --- |
| `hsr_state_axes_get` (IC-P1) | `target` = `ref` | `axes[]`(缺省全轴), `as_of` | 八轴各自的值或显式"本视图未包含"（AX-02） | `F-PARTIAL`, `F-WITHHELD` | `A`/`S` | 任一轴缺失必须显式标注；轴之间不得互相推导（AX-01） |
| `hsr_context_compile` (IC-P2) | `subject`(`ref` 集合或范围), `budget` | `must_include[]`, `as_of`, `perspective` | 上下文包 **或** `status = INSUFFICIENT_BUDGET` + 缺口清单 | `F-PARTIAL` | `S`(按参与者授权) | 必需前提/量词/World/版本引用不得静默截断；预算不足必须拒发而非编造（SI-54） |
| `hsr_scope_export` (IC-P3) | `scope`, `profile` | `version_selection`, `loss_policy` ∈ {REPORT, REFUSE_ON_CORE} | 导出工件 + `lossReport[]`(位置/字段/动作) | `F-PARTIAL`, `F-WITHHELD` | `S` | 核心面（身份/来源/版本/未知/状态）往返无损；不得改写 W3C 语义（DF-10） |
| `hsr_summary_query` (IC-P4) | `scope` | `axes[]`, `as_of` | 摘要 + 明确的"未包含"清单 | `F-PARTIAL` | `A`/`S` | 不得由摘要运算生成程度值/通过率（C02、C06、NEV-06） |
| `hsr_object_query` (IC-P5) | `query` | `filters`, `as_of`, `cursor`, `limit`, `sort_key` | 结果 + 来源 + 冲突提示 + 缺失范围 + 层级 + `boundary` | `F-PARTIAL`, `F-WITHHELD` | `S`(权限类) | 排序键受限（SI-52）；跨空间过滤必须按 SP-03 粒度假装不可见 |

## 7. 元操作

| 工具名 | 必填 | 可选 | 成功响应 | 说明 |
| --- | --- | --- | --- | --- |
| `hsr_capabilities_get` (SI-70) | — | — | 当前 `contract_version` / `schema_version` 集合 / `rule_set_version` / 词表版本 / 支持的时间视角与投影类型 | 只读，跨空间无关 |
| `hsr_rule_registry_query` (SCR-70) | — | `kind`, `level`, `rule_id` | 规则注册表条目（索引，不含规则正文） | 使"检查依据哪条规则"可被外部审计 |
| `hsr_object_get` | `target` = `ref` | `projection` ∈ {canonical, view} | 规范形态或指定投影（按授权脱敏） | **只接受精确引用**；无版本请求在参数层就被拒（SI-10、SF-23） |

## 7.5 修订类入口是**同一个写原型**的四个 profile

`hsr_revision_append`(IC-H2)、`hsr_object_amend`(IC-S3)、`hsr_concept_revise`(IC-S5)、`hsr_association_amend`(IC-A2) 在契约层是四个独立操作（校验分支与必填项不同），但在形态层是**同一原语**：同一请求包络、同一 `expected_head_revision` 前置、同一失败语义、同一"追加而非覆盖"响应。实现必须共享一条代码路径，四个入口只允许在**载荷校验分支**上分叉。

| 编号 | 规则 |
| --- | --- |
| SS-W-01 | 四个入口对**同一非法载荷**必须给出同一失败码与同一 `field_path`；测试资产以参数化方式跑四个入口 × 同一载荷矩阵，任何分叉即缺陷（防止四套实现漂移出四种拒绝行为）。 |
| SS-W-02 | 四个入口都不得接受 `object_kind` / `space_id` 变更（SS-10）；`revision_class` 缺失一律 `TOOL_INPUT` 拒绝，不得由服务端猜测（CO-REV-1）。 |

## 8. 覆盖核对与负面断言

| 编号 | 规则 |
| --- | --- |
| ICX-01 | 本目录必须**逐一覆盖**契约层的 IC-H1…H7、IC-S1…S9、IC-A1…A3、IC-R1…R11、IC-P1…P5；缺一即本层不完整。**本轮已用一次性脚本核对：契约层定义 35 个操作（H1–H7 / S1–S9 / A1–A3 / R1–R11 / P1–P5），本目录覆盖 35/35，无多余条目**；脚本未入库，落地时必须变成仓库内的文档一致性测试资产。 |
| ICX-02 | **工具名形态**：`hsr_<主题>_<动词>`，动词取自**闭合词表**——写侧 `append / register / record / declare / link / bind / adopt / revise / amend / establish / confirm / request / check`，读侧 `get / query / replay / compile / export`。词表外的新动词等价于新增工具（SI-02 冻结流程）。**负面清单**：名字中禁止出现暗示"改变既有对象"的 `set` / `update` / `delete` / `remove` / `patch` / `mark` / `current` / `merge` / `sync` / `revert`。 |
| ICX-05 | `revise` / `amend` / `adopt` 只表示**追加新记录或新修订**，绝不表示就地覆盖：名字含这三个动词的工具，其响应必须返回新的 `revision_id` 或 `record_id`，且被修改/被采用的旧 revision 在响应之后仍可被精确引用并逐字节回放（同一测试资产覆盖全部此类工具）。 |
| ICX-03 | 每个操作的失败码必须 ∈ 契约层 `F-*` 集合（外加 SI-24 登记的前置码）；出现自造码即本层缺陷。 |
| ICX-04 | 每个操作都必须有 `echo` 与（读操作）`boundary`；写操作必须返回可追溯的 `record_id`/`report_refs[]`，使"谁在何时依据哪版规则登记了什么"可被回放（IC-02、SF-63）。 |

## 9. 本层尚未裁决的内容

工具注册与宿主 wiring 的实现工作包；错误消息文案；客户端 SDK 形态；跨进程传输与鉴权（沿用宿主既有机制）；批量操作的性能与配额；Agent 侧调用编排（运行编排在系统之外）。
