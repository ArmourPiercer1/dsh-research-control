# Entity 领域对象契约

> **PR #42 · DRAFT-PROPOSAL · 2026-10-28。** 细化[五类主基线](H_S_R_FIVE_OBJECT_ARCHITECTURE_DRAFT.md) §1/§3/§4（含不变量 5/6）、[组合合同 C01/C04/C11/C12](H_S_R_COMPOSITION_SEMANTICS_DRAFT.md)、[对象对账](H_S_R_OBJECT_MAPPING_DRAFT.md) §一 与 [W3C Crosswalk](W3C_ALIGNMENT.md)。**共享约定（引用、时间、五态、状态轴、修订判据）只在[共同底座](H_S_R_DOMAIN_FOUNDATIONS_DRAFT.md)定义**，本文只定义 Entity 专有内容。字段名是领域阅读名（N-01）。**Proposed，不表示已实施或已冻结。**

## 1. 语义定义与边界

**Entity** 是具有独立指称身份的具体指称个体。它回答“这是哪个个体、在什么 World/存在范围内、以什么载体存在、被精确引用的版本是什么”，不回答“它与别者是什么关系”“它的定义/类型是什么”“它是否为真”。

| 用途 | 不属于 Entity 的典型情形 | 该情形应登记为 |
| --- | --- | --- |
| 保存可精确引用、可版本回放的具体个体（设备、一次 Run、一份数据文件、一个 Agent、一个配置个体、一个理想化个体） | “条纹相机”作为类别或设备型号（而非一台） | Concept（类型/定义） |
| 为来源链与论证输入提供锚点（used/generated/derived 都锚定个体的精确版本） | “Q 在 CCD 上游”这一带来源的关系 | Association |
| 记录具体活动个体及其结果（Experiment/Analysis/Run/Observation/Result） | “发射度小于 0.6 π mm·mrad”这一命题内容 | Proposition |
| 区分内容载体与被指称个体、区分登记与现实 | “谁在何时登记了什么”的来源事件、快照、可用性检查报告 | H 记录（事件/SnapshotID/检查报告，ID-08；需独立引用时 → RegistryEntry 子型） |
| 如实登记外部资源及其缺失、断链 | “120 fs”等简单数值、查询结果 | 其它对象的属性值（不必对象化） |
| 限定理想化数学个体的存在范围、区别于真实装置 | 一次具体的登记/可用性检查行为 | H 记录 |

**登记不证明现实存在**（登记≠使用≠支持≠接纳≠为真，DF-01）。Entity 可以没有载体、没有检查、没有被引用，仍是合法对象（DF-07）。

## 2. 子型清单（开放注册）

| 编号 | 规则 |
| --- | --- |
| EN-01 | 子型是**开放注册**：子型是“阅读标签 + 登记约束 + 对外导出类”，不是 W3C 类、不是封闭枚举；新增子型不构成语义破坏（N-02）。 |
| EN-02 | 个体归入某子型的判据是**独立指称身份**：可被独立指称、精确引用、版本回放与讨论；“仅在关系/论证中扮演角色”不构成个体（那是 Association/Argumentation 的角色）。 |
| EN-03 | `entity_subtype` 是身份构成（声明值改变 → 新对象，见 §4），因为它决定对外导出类（prov:Entity / prov:Activity / prov:Agent）；误登纠正走“新对象 + 纠正记录”，不静默改写（F-09）。 |
| EN-04 | V1 控制面个体（Project/Topic/Workstream/Plan/Task/Gate）在需要指称时作为 Entity，不因此改写原业务契约（对象对账 §一）。 |

| 子型（阅读名） | 定义与指称判据（为什么是 Entity） | W3C 导出映射 | 关键禁止项 |
| --- | --- | --- | --- |
| 物理个体（设备/部件） | 一台物理装置或部件个体（条纹相机、四极磁铁、CCD、一只具体阀门）；指称锚点可为序列号/位置，锚点非身份构成 | `prov:Entity` | 上下游等与其它设备的关系不得写入字段（→ Association）；`prov:wasAssociatedWith` 不得用于设备↔设备（那是 Activity↔Agent）；“当前是否服役”不做布尔字段 |
| 人员与软件 Agent | 执行登记、承担责任或执行活动的个体 | `prov:Agent` | **不含接纳权限**（授权是 FACT_DESIGNATION 的独立层）；DSH 运行时执行权限另属一层 |
| 实际活动个体 | 一次确实发生的具体活动（Experiment/Analysis/Run/Observation/DerivationActivity），可被精确引用与回放 | **对外精确映射 `prov:Activity`**（领域子型 dsh:Experiment/Analysis；真观测行为映射 `sosa:Observation`），**不是** `prov:Entity` | 计划态≠已发生（`execution_state` 显式）；计划个体不得导出为已发生 |
| 信息资源 | 有载体的内容资源：文件（GDF/CSV）、数据集、日志、程序、网格/模型输入文件 | `prov:Entity`；**真数据集才允许专门化为 `dcat:Dataset`/`dcat:Distribution`** | 简单数值不必对象化；注册条目≠资源本体；哈希失配≠内容曾不存在 |
| Result | 语义适用 SOSA 的观测行为所产出的结果资源 | `sosa:Result` / `sosa:hasSimpleResult`（仅语义适用时）；一般分析输出用 `prov:Entity` | **失败观测可无 Result**；不得伪造 Result 使失败观测“完整” |
| 模型实现与 ModelVersion | 一份具体模型代码、一个具体模型版本、一次仿真模型的具体实例化 | `prov:Entity`（可加领域子型） | 模型类别/模型类属 Concept；选用某模型不等于相信模型物理正确（选择关系→Association，主张→Proposition） |
| 具体配置 / ContextProfile 个体 | 模型/波形/物理效应的具体选择（模板实例，非模板） | `prov:Entity`（dsh 扩展） | Frame/Dimension/Option 定义属 Concept；配置变化不改写旧配置（EN-ID-3）；Frame 新增维度不改写旧 Profile |
| WorldContext 具体个体 | 具体世界语境个体（某一整套仿真配置、某一真实装置的特定状态），被命题/论证的 `world_ref` 作为 Entity 使用语境关系与命题/论证 `world_ref` 的端点 | `dsh:WorldContext`（DSH 扩展） | **其类型 WorldType 归 Concept**；World 类型开放注册，无封闭三值枚举与信任阶梯 |
| 理想化数学个体 | 指定辛映射、理想化装置个体、理想束流 | `prov:Entity`（或 DSH 扩展） | 须声明其归属世界/语境限定（EN-W-3：此处语境构成身份）；理想化个体不得与现实装置混同；理想化个体中的定理不直接迁移到现实装置（那是 Argumentation/Proposition 的工作） |
| 外部资源引用（ExternalResourceRef） | 系统之外的外部资源（URL、DOI、外部档案） | `prov:Entity` + 外部标识 | 指称不可达≠资源不存在（UNRESOLVED）；跨空间不可见 → WITHHELD（SP-02） |
| 资源注册条目（RegistryEntry） | 资源的登记记录/条目；**仅在需独立引用时**对象化，否则为 H 登记/属性 | 工程对象，**不是** `prov:Entity` 本体 | **与被登记资源本体分离**：条目描述资源（URI/哈希）但不是资源身份；条目删除不代表资源未登记 |
| 原始材料 | ResearchFinding 原文、S-L0 原始科研提交、原始日志 | `prov:Entity` | 原文本身不是命题的表示；抽取的候选命题单独成为 Proposition；原文不被解释污染；被论证当作证据引用时按 RF-06 直接绑定本个体@rev，其 `source_refs[]` 指回 H 记录 |

## 3. 字段契约

### 3.1 指称与身份

| 字段/角色 | 语义 | 类型/引用对象 | S-L0/S-L1 要求 | UNKNOWN/缺失规则 | 修订约束 |
| --- | --- | --- | --- | --- | --- |
| `entity_subtype` | 子型阅读标签；决定导出类与校验分支 | 值（开放） | S-L0 必填（决定校验分支） | 不允许 `UNKNOWN`（无法归类 → 先按原始材料登记，§2） | **身份构成**：声明值改变 → 新对象（EN-03、EN-ID-7） |
| `designated_name` / `aliases[]` | 指称名与别名（多值）；每个别名携带来源与声称有效区间 | 文本 + {source, claimed_interval} 列表 | S-L0：至少一个指称锚点（名或标识）；S-L1：已声明别名须有来源或显式 `UNKNOWN` | `UNKNOWN` 合法（来源未找到）；空别名集合合法 | 改名/增删别名 → **修订**而非新对象（EN-ID-1）；旧名保留在旧修订 |
| `external_identifiers[]` | URI/DOI/内部路径等外部标识；每项声明其在哪个身份体系中有效及来源 | 值 + {scope, source} 列表 | S-L0 可空；S-L1：已声明项须有来源 | `UNKNOWN` 合法 | 非 ExternalResourceRef 子型：标识变化 → 修订（指称锚点非身份）；ExternalResourceRef：**身份构成**，URI 改变 → 新对象（指称了另一资源） |
| `world_membership` | **归属世界，带角色的引用**（禁止一字段两义）：`{kind_ref: Concept@rev（WorldType，仅作分类与检索）, individual_ref: Entity@rev（WorldContext 世界个体，身份判据）}`。回答“它在哪个世界里存在”，**不**回答“本次实验怎么配置它” | 见左：两半各自是引用 | S-L1：`individual_ref` 必填**或**整体显式 `UNKNOWN(reason)`；`kind_ref` 可 `UNKNOWN` | `UNKNOWN` 合法并进 `declared_gaps`；补全为修订（RV-01/RV-06） | `individual_ref` 由 `M` 改指 `M′` → **新 Entity**（真实相机与其仿真对应体是两个个体）；改 `kind_ref` 只是重新分类 → 修订；**使用语境变化不在此列**（EN-W-1/EN-W-2/EN-W-6） |
| `source_refs[]` | 登记所依据的来源材料（原文、日志、台账、验收记录） | Entity@rev（原始材料）或 H 记录标识 | S-L0 必需（H 侧） | 不得由系统猜测来源 | 来源变化 → 修订；来源材料缺失不抹去原文（C12） |

### 3.2 载体与内容

| 字段/角色 | 语义 | 类型/引用对象 | S-L0/S-L1 要求 | UNKNOWN/缺失规则 | 修订约束 |
| --- | --- | --- | --- | --- | --- |
| `carrier_refs[]` | 内容载体（文件路径、镜像、档案、存储位置），各有独立身份与来源；载体是存在方式，不是个体本身；属结构性引用，不是正式声明（不进 RF-02 类别约束） | {carrier_ref, source} 列表 | S-L0 可空；S-L1：物理/数字个体已声明的载体须可解析或 `UNRESOLVED` | 数学/理想化个体可 `NOT_APPLICABLE(reason)`（无载体） | 增加新载体（镜像、迁移）→ **修订**（EN-ID-4），不是新个体 |
| `content_digest` | 内容快照哈希（算法 + 值）；是内容快照同一性的声称，不是语义同一性的证明（H3） | {algorithm, value} 或 `UNKNOWN` | S-L0 可选；S-L1：已声明项须带算法 | `UNKNOWN` 合法（尚未取哈希） | 已声明摘要改变 → 内容个体：快照模式新对象（EN-ID-3）、容器模式修订；摘要失配按检查态处理（§6） |
| `availability_checks[]` | 可用性检查历史：每次检查 = {检查时间（`recorded_at`）、载体、结果、检查者、依据}；结果取值域即 A8 轴 | H 检查记录（A8 轴）列表 | S-L0 可空；S-L1：已声明检查须有时间与载体 | **不在 Entity 上放“当前是否可用”布尔字段**：“当前可用”是派生投影（按载体最新检查 + `as_of` 声明，T-01/AX-02） | 检查只追加，历史结论不覆盖（EN-MS-1/2/3） |

### 3.3 活动个体专用（仅适用活动子型，其余子型 NOT_APPLICABLE 带理由）

| 字段/角色 | 语义 | 类型/引用对象 | S-L0/S-L1 要求 | UNKNOWN/缺失规则 | 修订约束 |
| --- | --- | --- | --- | --- | --- |
| `execution_state` | “计划 vs 已执行”区分字段：`PLANNED / IN_PROGRESS / COMPLETED / ABORTED / FAILED`（开放） | 值 | 活动子型 S-L1 必填 | `UNKNOWN` 合法（发生态未确认） | PLANNED→实际态是修订；发生本身不变 |
| `occurred_interval` | 声称的发生时段（`claimed_time` 语义）；PLANNED 时为声称的执行窗口，尚未发生 | 时间区间（可开区间） | S-L1 必填**或**显式 `UNKNOWN` | `UNKNOWN`/开区间合法；不得用 `recorded_at` 顶替 | 发生时间声称更正 → 修订（EN-ID-6）；另一次 Run = 新对象（EN-ID-5） |
| `used_intervals[]` | 声称的使用或生效区间（`described_interval` 语义，如“该校准在 T1–T2 期间生效”“该设备 T5–T6 期间被使用”），各带来源 | {interval, claim, source} 列表 | S-L1：已声明须带来源 | `UNKNOWN` 合法 | 声称区间变化 → 修订；不自动推导为现实布局事实（C01） |

### 3.4 生命周期声称（值为声称，非事实）

| 字段/角色 | 语义 | 类型/引用对象 | S-L0/S-L1 要求 | UNKNOWN/缺失规则 | 修订约束 |
| --- | --- | --- | --- | --- | --- |
| `service_intervals[]` | 声称的服役区间（如设备“在 T2–T9 服役”），各带来源；与 `recorded_at` 严格分离（T-01/T-02） | {interval, claim, source} 列表 | S-L0 可空 | `UNKNOWN` 合法；补录不成为“当时已知”（T-02） | 新增声称/区间延展 → 修订 |
| `retirement_claim` | 声称的退役（时间 + 理由 + 来源），**是声称** | {time, reason, source} 或 `UNKNOWN` | S-L0 可选 | `UNKNOWN` 合法（未退役或未知） | 退役声称不使对象失效（EN-LC-3） |

### 3.5 版本与后继

| 字段/角色 | 语义 | 类型/引用对象 | S-L0/S-L1 要求 | UNKNOWN/缺失规则 | 修订约束 |
| --- | --- | --- | --- | --- | --- |
| `version_of` | 本内容个体是哪一个前一内容个体的新版本（精确引用 + 来源，`PROVENANCE` 类别） | Entity@rev 或空 | S-L1：已声明须可解析 | 空/`UNKNOWN` 合法（首版本） | 版本链只追加；新版本是新对象（EN-ID-3/4） |
| 替代/后继关系 | 新旧替代关系（设备更替、配置替代） | **Association 记录**（带来源与理由），不是 Entity 上的可变字段 | S-L1：声称替代时须有对应 Association 或 H 记录 | 未声称即不登记；系统不推断替代 | RV-02：旧对象原样保留可回放；替代不得用修订关系冒充 |

### 3.6 明确禁止存在的字段

`is_available` / `is_currently_retrievable`（当前可用布尔）、`is_deleted`、`is_valid` / `is_current`（当前有效）、`confidence_score`、`truth_value`、任何 Association 语义字段（`upstream_of`、`used_by`、`next_to` 等）、任何“latest 跟随”指针、任何由 A8 轴推导的汇总布尔。理由：A8 是轴与投影（AX-01）不是字段命名；缺失≠否定（DF-05、UN-01、C12）；关系语义一律由 Association 承载（N-06、§5）；DF-01。

## 4. 身份与修订判据

**身份构成字段**（已声明值被改变 → 新 Entity）：

| 身份构成字段/角色 | 锚定什么 | 改变的后果 |
| --- | --- | --- |
| `entity_subtype`（已声明） | 指称的个体种类 + 对外导出类 | 新 Entity（EN-ID-7） |
| `world_membership.individual_ref`（已声明） | 个体在**哪个具体世界**中被指称 | 新 Entity（真实个体、仿真世界内个体、数学世界内个体互不互换）；`UNKNOWN→M` 是修订（RV-01/RV-06）。`kind_ref` 与使用语境、配置、服役状态均**不是**身份构成（EN-W-1/EN-W-2/EN-W-6） |
| 哪一次具体发生（活动个体：`execution_state` + `occurred_interval` 的已声明组合） | 那一次活动 | 同实验另一次 Run = 新 Entity（EN-ID-5） |
| 完整内容（内容个体：快照模式 `content_digest`/内容快照；配置个体：完整选择内容） | 这一版内容 | 原地变更 → 新 Entity + `version_of`（EN-ID-3） |
| `external_identifiers[]`（仅 ExternalResourceRef 子型） | 外部资源身份 | 新 Entity（指称了另一资源） |

非身份构成（变化 → 修订）：名称与别名、载体列表、状态声称（服役/退役/发生时间更正）、说明补全、来源变化。

**归属世界与使用语境分离（审查修订 R3）**：

| 编号 | 规则 |
| --- | --- |
| EN-W-1 | Entity 区分**归属世界**与**使用语境**：前者是字段 `world_membership`（其 `individual_ref` 可能构成身份）；后者是该个体在哪些 WorldContext 个体中被使用过，**永不**构成身份，其真源是 Association / 活动个体记录，Entity 侧只有派生视图（EN-W-5）。 |
| EN-W-2 | **使用语境一律不构成身份**：同一台条纹相机由配置 W₁ 切换到 W₂，仍是同一个 Entity——W₁/W₂ 是 WorldContext 个体，经由使用关系（Association / 活动个体）与该设备关联。把配置切换判为换对象会让同一物理装置随研究配置反复换 ID，摧毁来源链与历史精确引用。需要引用“该设备在某配置下的状态”时，引用配置个体 + 带来源关系，而不是复制设备个体。 |
| EN-W-3 | **语境构成型个体的对称说明**：理想化数学个体、仿真世界内的模型实现个体等，其“所处世界/语境”本身就是被指称之物的一部分，因此对它们而言那个语境记在 `world_membership` 里（构成身份），而是通过 `world_membership.individual_ref` 表达；对他者的使用语境则记在使用关系里，不写进他者字段。判据始终是**指称是否随世界改变而改变**，不是子型名称。 |
| EN-W-4 | 命题与论证引用个体时必须精确到 `EntityID@rev`；“同一设备在两个语境下的两个状态”若需分别被引用，登记为语境个体 + 带来源关系，而不是把语境塞进设备字段或复制设备个体。 |
| EN-W-5 | **使用关系的真源是关系对象，不是 Entity 字段**：某个体参与了哪些实验配置、哪些活动、哪些装置组合，由 Association 或活动个体登记；Entity 上出现的 `operating_context_view` 只是**派生视图**（RF-03），不可写、不参与身份、不得作为字段存储（`SL1-ENT-08` 发现即 FAIL）。这避免同一种关系既写进 Entity 又登记为 Association 造成双真源（RD-12）。 |
| EN-W-6 | **可指称的世界必须有个体身份**：任何被引用的世界都要有一个 WorldContext 个体（真实世界也是一个 singleton 个体），`individual_ref` 因此总能表达“哪一个世界”；`kind_ref`（WorldType）只回答“这是哪一类世界”。两个同属 `WT_MATHEMATICAL` 但分属不同数学模型世界的理想化个体，靠不同 `individual_ref` 获得不同身份（EN-ID-1、PR-ID-2）。 |
| EN-W-7 | **根世界不递归**：`EN-W-6` 要求"被引用的世界"都有个体身份，但它不要求每个世界都有自己的上级归属——否则 `world_membership` 会形成无穷回归。裁决：存在唯一的**根 WorldContext 个体**（真实世界，singleton），**其子型的槽位集本身不含 `world_membership`**（由子型注册表条目的 **`slot_set[]`** 声明；缺槽位判定的输入就是这个数组而非全局槽位清单，故"不在数组内"是类型层事实。**singleton 唯一性有校验谓词**：注册表条目带 `singleton: true`，校验器按 `(space_id, subtype_code)` 统计活跃对象，第二个 `WORLD_ROOT` → **保存不阻断** + `FAIL(SINGLETON_SUBTYPE_DUPLICATE, VIOLATION)`（不静默合并、不拒写）。其它一切世界的 `world_membership.individual_ref` 必须能解析到某个 WorldContext 个体。**为什么不用五态表达"没有上级世界"**：`ABSENT` 是"未声明"、`UNKNOWN` 是"有但不知道是哪一个"，两者都会把根世界误报成信息缺失；"该子型无此槽位"是类型层事实，只能在注册表里说一次。**根世界的最小合法实例**：`subtype_code = WORLD_ROOT`（注册条目）、`kind_ref`（WorldType，如 `WT_ACTUAL`）、`identity_slots` = 基类身份槽位减去**经本条裁定的豁免项** `world_membership.individual_ref`（豁免的机器形态与封闭性由 Schema 侧 SS-54 规定，不得由子型自行宣布）；**类型分类的承载**：根世界**不**经 `world_membership.kind_ref` 声明 WorldType（该槽位不在其 `slot_set[]` 内），而由子型注册表条目的 `kind` + `subtype_code = WORLD_ROOT` 承载——分类在注册表里说一次，不在载荷里再造一份、`source_refs` 取登记凭据、`world_membership` 不出现。`WORLD_ROOT` 是**子型码**而非新的词表族，注册与退役照走注册表规则。 |

| 编号 | 判据 | 例子 |
| --- | --- | --- |
| EN-ID-1 | 设备/物理个体改名、增删别名、更新外部标识（非 ExternalResourceRef）→ **修订**；仅当改名意味着指称了另一台个体时，登记 `IDENTITY_CONFLICT` 候选由主体裁决（RV-05） | “束线条纹相机”→“SC-2026-07”并补序列号锚点 |
| EN-ID-2 | 设备更换部件、升级固件、重新校准 → **原 Entity 的修订** + 更换/升级登记为带来源关系（Association）或 H 记录；被换下的部件若独立指称，是**新的部件个体**，旧部件保留 | 条纹相机更换传感器模块：相机出新修订 + “模块更换”Association；新模块是新 Entity |
| EN-ID-3 | 内容个体原地内容变化按登记模式分判：**快照模式**（指称“这一版内容”，以摘要锚定）→ **新 Entity** + `version_of`；**容器模式**（指称“这个存储位置”，如活动日志）→ 修订，旧摘要保留在旧修订；**配置个体默认快照模式**（指称是完整选择） | GDF 冻结数据文件内容更新 → 新个体；活动日志更新 → 修订 |
| EN-ID-4 | 同一内容（摘要未变）被重新哈希/镜像/迁移 → **新载体**（修订），不是新个体；摘要失配不得当作同内容镜像，登记 `HASH_MISMATCH`（A8）并由主体裁决镜像错误还是内容漂移 | `/data/a.gdf` → `/mirror/a.gdf` |
| EN-ID-5 | 仿真 Run 重跑得到不同结果 → 原 Run **不变**；新 Run 是**新活动个体**，新结果是新的结果个体，两者以重跑关系（Association，带来源）链向旧者；历史精确引用仍指向旧修订 | R3 重跑 → R3′；R3 与 R3′ 的结果并存、可分别回放 |
| EN-ID-6 | 身份构成字段 `UNKNOWN/ABSENT → DECLARED` 补全：仅当属于**原指称/原意的确认**（`completion_basis = SAME_INTENT_CONFIRMED`）时是修订；若补全同时改变了身份承诺（`NEW_JUDGEMENT`）则新建对象；判不了保留分歧不自动决定（RV-01/RV-06，与命题端 PR-ID-4 同一条判据） | Run 的 `occurred_interval` 后确认为 T1 → 修订；把“某个候选个体”改判为“另一台设备的个体” → 新 Entity |
| EN-ID-7 | 已声明 `entity_subtype` 改变（误登纠正）→ **新 Entity** + 纠正关系记录（带来源）；旧对象保留、其错误登记仍可审计；不得自动合并（ID-07） | 一次 Run 被误登为 InformationResource，后纠正为活动个体 |
| EN-ID-8 | **判定线**：“同一对象的两个修订” vs “两个对象”——按上表身份构成字段判定：已声明身份构成字段值改变 → 两个对象；否则（名称、载体、状态声称、说明补全、重哈希/镜像）→ 同一对象的新修订；存疑（疑似同一指称）时登记 `IDENTITY_CONFLICT` 由主体裁决，不自动判定（RV-04/RV-05） | — |

## 5. 与其他基础对象的关系

| 方向 | 角色 | 说明与禁止 |
| --- | --- | --- |
| Entity —`SEMANTIC`→ Concept@rev | 使用类型定义（设备类型、WorldType、模型类、单位/维度） | Concept 新版本不倒灌改写旧 Entity（C11）；名称同义不证明语义等价（S5） |
| Entity —`PROVENANCE`→ Entity@rev / 活动个体 | 版本来源（`version_of`）、来源材料（`source_refs`） | 来源/派生≠逻辑蕴涵（DF-04）；`prov:wasDerivedFrom` 是数据来源不是证明 |
| Entity ↔ Entity | 一切关系（上下游、使用、生成、派生、替代、同位、设备之模块） | **一律登记为 Association**（带来源、方向、声称时间区间）；禁止把关系语义写进 Entity 字段（§3.6）；上下游不自动推导物理因果；PROV 导出用标准谓词（used/wasGeneratedBy/wasDerivedFrom），内部承载仍是 Association 记录 |
| Proposition —`SEMANTIC`→ Entity@rev | 提及（声称的主体/语境/比较对象个体） | 提及≠存在断言≠支持（DF-01） |
| Argumentation —`INFERENTIAL`→ Entity@rev | 论证输入（数据/定义/前提/背景/被讨论对象） | **必须带角色声明**（按 Scheme）；“文件 D 不是自动成立的数学前提”（C04）；“模型 M 中 P”不是现实世界 P；数据丢失不自动使原结论为假（C11） |
| Association —记录→ Entity@rev（端点） | 关系记录的端点 | 端点必须精确版本（ID-04）；关系记录不回写 Entity 字段 |
| H —拥有→ 登记/可用性检查/快照/缺失登记记录（ID-08） | 历史与检查 | A8 轴状态、缺失与断链登记是 H 记录或派生投影，不是 Entity 字段（§3.2/§6） |
| Assessment（Proposition 子型）—`EVALUATIVE`→ Entity@rev | 评价目标（数据质量、设备状态可靠性评价） | 多个并存评价（A6）不写入 Entity 字段 |

## 6. 资源缺失、断链与版本变化的专门契约

| 编号 | 规则 |
| --- | --- |
| EN-MS-1 | **如实登记**：缺失、删除、哈希失配是**指称/载体**的状态，不是**对象**的状态。三处登记、互为补充：(a) A8 轴检查记录（可用性检查，带检查者/时间/依据）；(b) 悬挂引用（`UNRESOLVED`，原引用保留，RF-04）；(c) 显式缺失登记记录（H 记录或 Association，带来源）。**不抹去历史、不伪造替代数据、不阻断历史服务**（不变量 5、C12）。 |
| EN-MS-2 | **两个视图、都是投影**：历史可用性视图（`recorded_as_of=T`，知识截点）只回放 `recorded_at ≤ T` 的检查记录；当前可用性视图（`as_of=now`）取每个载体的最新检查。二者均由检查历史派生、不是存储布尔（AX-01）；任何“当前”查询必须声明 `as_of`（T-01），省略 A8 轴的视图必须显式标注（AX-02）。 |
| EN-MS-3 | **检查结果纪律**：无检查记录 = `UNKNOWN`（未检查≠存在）；检查超时/失败 → `UNRETRIEVABLE`；只有带来源的删除声称/日志才可 `DELETED`；`HASH_MISMATCH` 保留旧修订中的原声明摘要，新检查不覆盖旧摘要；单次检查不抹去既往检查历史（ID-03、C11）。 |
| EN-MS-4 | **不可得的呈现**：同空间内指称不存在/不可访问 → `UNRESOLVED`（可见其存在，报告为待解析）；跨空间或权限过滤 → `WITHHELD`（不报告目标内容、存在性与空间标识，SP-02）；不得把 `WITHHELD`/`UNRESOLVED` 报告为“资源不存在”（UN-05、CS-24）；过滤得到的部分结果携带边界标注（SP-03）。 |
| EN-MS-5 | **缺失不可推导**：`VERIFIED_PRESENT` 不推导“内容一直存在”或“相关结论为真”；`DELETED`/`UNRETRIEVABLE` 不推导“过去的观测/登记失效”（C11：数据丢失影响重现能力，不自动证明原结果假）；缺失≠反证（DF-05）。 |
| EN-MS-6 | **三种版本变化互不混淆**：内容版本变化（新内容个体 + `version_of`，EN-ID-3）、载体变化（新载体，修订，EN-ID-4）、登记更正（修订，EN-ID-6）；镜像一致性检查失败不自动把两个载体合并为一个（C09：共享来源与重复使用不自动独立）。 |

## 7. 生命周期与可影响它的操作

仅语义级；操作的具体形态、事务与失败码由 [H/S/R 交互契约](H_S_R_INTERACTION_CONTRACT_DRAFT.md) 与规范化契约承担，本文只列状态与允许/禁止。

`登记（S-L0）→ 语义补全（S-L1）→ 可选载体/可用性检查（A8）→ 被引用/讨论/作为论证输入（均经外部精确引用）→ 版本/后继/替代（新对象 + 带来源关系）→ 声称退役（对象仍可引用）`。

| 编号 | 规则 |
| --- | --- |
| EN-LC-1 | 生命周期是“登记→补全→检查→使用→版本/后继→声称退役”的序列；无强制终态；长期停留任一中间态合法（DF-07） |
| EN-LC-2 | 任何影响 Entity 的操作都是**登记行为**：产生新修订、新对象或新记录，绝不就地改写（ID-03、RV-02） |
| EN-LC-3 | 声称退役不使对象失效：仍可被引用、历史可回放、A8 不受影响 |

| 操作（语义级） | 允许 / 禁止 |
| --- | --- |
| 新登记（S-L0：指称锚点 + 子型 + 来源） | 允许；无法归类的原始材料可先按原始材料子型登记 |
| 修订（补全、命名、载体、状态声称、时间更正） | 允许；产生新修订，旧修订不可变（ID-03） |
| 新建对象（身份构成改变/内容新版本/重跑） | 允许；旧对象原样保留 + 带来源关系（RV-02） |
| “合并”两个实体 | **禁止**自动合并；只能等价候选 + `IDENTITY_CONFLICT` 记录，主体裁决（ID-07、RV-05） |
| 删除对象 | **禁止**；“缺失”是载体的检查状态（A8）不是对象状态；Entity 永不删除 |
| 改写旧修订 / 用最新可用性检查覆盖旧结论 | 禁止（ID-03、EN-MS-3） |
| 把跨空间指称报成“不存在” | 禁止（WITHHELD，EN-MS-4） |
| 为图方便给 Entity 加真值/置信度/“当前有效”字段 | 禁止（§3.6） |
| 把计划个体导出为已发生 | 禁止（`execution_state` 必须进入导出 Profile） |
| 长期 `UNRESOLVED`/`UNRETRIEVABLE`/未被引用 | 允许：没有任何阶段要求 Entity 过检查、有载体或被引用（DF-07） |

## 8. 例子

**合法例 1（设备个体，部件更换修订）**：`E5@r3` — “6A 束线条纹相机 SC-2026-07”。`entity_subtype = PhysicalIndividual`；`designated_name = "StreakCam-6A"`，`aliases = [{name "SC-2026-07", source: 设备资产台账@E40@r1, claimed_interval T2–}, …]`；`world_membership = W_real_6A@r1`（WorldContext 个体）；`source_refs = [设备验收记录（原始材料）@E41@r1]`；`service_intervals = [{T2–, source: 运行日志}]`；`availability_checks = [check@T5: VERIFIED_PRESENT（载体：现场台账）, check@T6: UNRETRIEVABLE（依据：档案服务器宕机）]`。T7 更换传感器模块：`E5` 产生 r3（修订，注明“传感器模块已更换”），更换登记为 Association A12（带来源）；新模块是 `E9@r1`（新 Entity），旧模块 `E37` 保留且其服役历史可回放。r3 S-L1 PASS、A3 = UNCONFIRMED；无“当前是否服役”字段。

**合法例 2（数据文件，载体镜像与删除）**：`E21@r1` — “Run R3 的 GDF 输出”（`InformationResource`，`version_of` 空，载体 `/data/r3/out.gdf`，`content_digest = sha256:abc…`，生成关系 Association A20：`prov:wasGeneratedBy R3`）。T8 增加镜像：r2（新载体 `/mirror/r3/out.gdf`，摘要一致）。T9 原路径删除（有删除日志为来源）：原路径检查 = `DELETED`，镜像 = `VERIFIED_PRESENT`；`E21` 未被抹去，`as_of=T8` 历史视图仍报告原路径存在，`as_of=now` 报告两个载体各自状态；引用 `E21@r1` 的历史论证输入不受影响（C11）。

**关键非法/易混淆例**：

| 情形 | 为什么非法 | 正确做法 |
| --- | --- | --- |
| 把 Run 个体导出成 RDF 的 `prov:Entity` | 违反 W3C 边界：实际活动是 prov:Activity（Crosswalk 冲突表、F-09）；导出类由子型决定（EN-03） | 对外导出 `prov:Activity`（+ 领域子型）；内部五类分类不变 |
| 给失败的 Observation 伪造一个空 `sosa:Result` 以过 S-L1 | 违反 Result 子型关键禁止项（§2）与 W3C 冲突表“强制失败 Experiment 有结果 = 伪造” | 观测个体 `execution_state = FAILED`、无结果；“无结果”作为声称/检查记录登记 |
| 论证输入中用注册条目 ID 指称“数据文件 D” | 违反 RegistryEntry 与被登记资源本体分离（EN-02/§2）；条目是登记记录不是资源本身 | 输入引用资源 Entity@rev（INFERENTIAL，带角色）；条目仅供审计登记行为 |
| 用“最新可用性检查”覆盖原文件的历史结论（T9 删除 → 所有历史查询报“不可用”） | 违反 EN-MS-2/3：历史视图按 `recorded_as_of` 回放、检查历史只追加（ID-03、C11） | `recorded_as_of=T8` 报存在，`recorded_as_of=now` 报 DELETED（原路径）/存在（镜像），各带检查记录与时间 |
| 把另一 ResearchSpace 的 GDF 文件报成“资源不存在” | 违反 SP-02/UN-05/CS-24；`WITHHELD` 与 `UNRESOLVED` 互不相同 | 报 `WITHHELD`：不报目标内容、存在性与空间标识；部分结果携带边界标注（SP-03） |
| 把“位于四极磁铁上游”写成相机 Entity 上的字段 | 违反 §3.6/§5：Association 语义不得写入 Entity 字段；设备↔设备也不是 `prov:wasAssociatedWith` | 登记为 Association（来源、方向、声称区间）；经关系记录查询，不经 Entity 字段 |
| 给 Entity 加 `is_available = true` 以便 Agent 上下文 | 违反 §3.6/AX-01：A8 是轴不是布尔字段；布尔会抹平检查历史 | Agent 上下文视图显式标注“A8 轴：最近 check@T6 UNRETRIEVABLE（载体 X）”，或标注“本视图未包含 A8 轴” |

## 9. 本契约尚未裁决/需后续验证的内容

- 各内容子型的默认登记模式（快照 vs 容器），以及 V1 历史文件与旧标识的迁移映射（lossReport）——需 PoC 验证（F-01/F-02）。
- WorldContext 的具体对象化边界（何时语境应为独立 Entity 而非对象结构属性）与 RegistryEntry/可用性检查报告的对象化（对象对账均标“建议”）、Anomaly/ResearchQuestion 的“需独立引用”判据。
- A8 轴检查记录的承载形态（H 记录复用还是独立检查报告）、失败码与 S-L0/S-L1 的映射——由交互契约与规范化契约承担。
- 子型 → W3C 类导出 Profile 的版本化管理与回归（F-09）；哈希算法版本升级与镜像一致性检查协议。
- 精确类型系统与持久化结构（含带来源与时间的多值字段编码形态）——后续 Schema 设计；本文不冻结键名（N-01）。
