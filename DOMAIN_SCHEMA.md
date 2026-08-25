# DOMAIN_SCHEMA.md - DSH Research Control Plane V1 领域对象正式规范

> 文档状态：**Frozen V1**（2026-08-22 冻结；含独立审计修订 A-2/A-3/A-6/A-7/A-10/A-11/A-14，追溯见计划书 §40 附录）
> 上游：计划书 §4–§14、§17–§19、§21、§23
> 规范性声明：本文与 `schema/` 目录下的 JSON Schema（draft 2020-12）共同构成 V1 **冻结契约**。二者冲突时以 `schema/` 为机器可读真源、本文为语义真源，冻结前必须消解冲突。
> 约定：字段表列出「字段 | 类型 | 必填 | 约束/默认 | 说明」；枚举值大小写敏感；所有示例为说明性而非规范性。

---

## 1. 通用约定

### 1.1 ID 规范

**格式**：`<PREFIX>-<正整数>`，正则 `^[A-Z]+-[1-9][0-9]*$`。

**前缀注册表**（冻结；新增前缀必须 bump `.research/schema-version`）：

| 对象 | 前缀 | 示例 | 唯一性范围 | 分配时机 |
|---|---|---|---|---|
| Project | `PRJ` | `PRJ-1` | 插件安装内全局 | 创建 Project |
| Topic | `TPC` | `TPC-3` | Project 内 | 创建 Topic |
| Workstream | `WS` | `WS-12` | Project 内 | 创建 Workstream |
| TopologyEdge | `TE` | `TE-17` | Project 内 | 创建拓扑边 |
| PlanFork | `PF` | `PF-17` | Project 内 | Agent 创建 proposal |
| Task | `T` | `T-17` | Project 内 | 创建 Task 定义 |
| Gate | `G` | `G-2` | Project 内 | 创建 Gate 定义 |
| Milestone | `M` | `M-1` | Project 内 | 创建 Milestone 定义 |
| Run | `R` | `R-81` | Project 内 | 注册 Run |
| Claim | `C` | `C-17` | Project 内 | 记录 Claim |
| Fact | `F` | `F-31` | Project 内 | 记录 Fact |
| Artifact | `A` | `A-9` | Project 内 | 注册 Artifact |
| Relation | `REL` | `REL-40` | Project 内 | 添加 Relation |
| Objective | `OBJ` | `OBJ-1` | Project 内 | 创建 Objective |
| Intervention | `IV` | `IV-5` | Project 内 | 创建 Intervention |
| NextAction | `NA` | `NA-2` | Project 内 | 创建 NextAction |
| Blocker | `BLK` | `BLK-3` | Project 内 | 创建 Blocker |
| Interaction | `INT` | `INT-7` | Project 内 | 登记 Interaction |
| ReportingItem | `RPT` | `RPT-4` | Project 内 | 创建 ReportingItem |
| ScheduledEvent | `SEV` | `SEV-6` | Project 内 | 登记 ScheduledEvent |
| HistoryEvent | `H` | `H-1001` | Project 内（单调递增） | append 时 |
| InboxItem | `IN` | `IN-11` | Project 内 | capture 时 |
| DiscoveredSession | `DS` | `DS-2` | Project 内 | 发现时 |
| ManagementAction | `MA` | `MA-30` | Project 内 | 管理操作时 |
| AnalysisRecord | `AN` | `AN-1` | Project 内 | 用户保存分析时 |

规则：

1. ID **不可变**：一旦分配，任何操作不得改变对象的 ID（INV-HIST-7 的前提）；
2. 分配由插件执行（Project 内单调递增计数器，持久化于 operational DB `meta` 表）；声明式对象的 ID 同步持久化于文件名与文件内 `id` 字段，二者必须一致（加载期校验）；
3. 手工编辑 `.research/` 不得复用/篡改已有 ID；加载期发现文件名与 `id` 不一致即报错；
4. ID 解析按**最长前缀优先**（`TE`/`T`、`INT`/`IN` 等有前缀包含关系）。

### 1.2 时间表示

| 载体 | 表示 |
|---|---|
| `.research/` YAML 文件 | ISO 8601 UTC 字符串（如 `2026-08-21T12:34:56Z`；日期用 `2026-08-21`） |
| SQLite / 内存 / 事件信封 | epoch **毫秒**（INTEGER） |

转换在 loader 序列化边界统一完成；UI 展示时区由 client 决定，不落库。

### 1.3 公共结构

```ts
/** 操作者 */
interface ActorRef {
  kind: 'USER' | 'AGENT' | 'PLUGIN' | 'SYSTEM'
  user_id?: string    // kind=USER 且宿主提供用户标识时
  run_id?: string     // kind=AGENT 时：产生该操作的 Run（R-<n>）
  session_id?: string // 关联 DSH session id
  label?: string      // 人类可读名（展示用）
}

/** 来源追溯 */
interface SourceRef {
  kind: 'DSH_SESSION' | 'FILE' | 'GIT' | 'MANUAL' | 'IMPORT' | 'INTERACTION' | 'PLUGIN'
  session_id?: string
  path?: string        // workspace 相对路径
  commit_oid?: string
  interaction_id?: string
  note?: string
}

/** 类型化对象引用（跨对象引用统一形式） */
interface TypedRef {
  kind: ObjectKind
  id: string
}
type ObjectKind =
  'PROJECT' | 'TOPIC' | 'WORKSTREAM' | 'TASK' | 'GATE' | 'MILESTONE' | 'RUN'
  | 'CLAIM' | 'FACT' | 'ARTIFACT' | 'RELATION' | 'OBJECTIVE' | 'INTERVENTION'
  | 'NEXT_ACTION' | 'BLOCKER' | 'INTERACTION' | 'REPORTING_ITEM'
  | 'SCHEDULED_EVENT' | 'INBOX_ITEM' | 'PLAN_FORK' | 'TOPOLOGY_EDGE'
  | 'DISCOVERED_SESSION' | 'HISTORY_EVENT' | 'ANALYSIS_RECORD'
```

### 1.4 全局枚举注册表

| 枚举 | 取值 | 使用处 |
|---|---|---|
| `AttentionMode` | `FOCUS` \| `NORMAL` \| `BACKGROUND` | Project / Topic |
| `WsLifecycle` | `PLANNED` \| `REALIZED` \| `DROPPED` | Workstream / TopologyEdge |
| `EdgeOp` | `FORK` \| `MERGE` | TopologyEdge |
| `TaskExecution` | `PLANNED` \| `ACTIVE` \| `PAUSED` \| `EXECUTED` \| `CANCELLED` | Task 派生状态 |
| `TaskValidation` | `NOT_REQUIRED` \| `PENDING` \| `UNDER_REVIEW` \| `PASSED` \| `FAILED` | Task 派生状态 |
| `RunStatus` | `RUNNING` \| `FINISHED` \| `FAILED` \| `CANCELLED` | Run 派生状态 |
| `ArtifactType` | `DATASET` \| `FIGURE` \| `MODEL` \| `CODE` \| `REPORT` \| `NOTE` \| `OTHER` | Artifact |
| `RelationType` | 见 §8 | Relation |
| `IvStatus` | `OPEN` \| `PENDING` \| `CLOSED` | Intervention |
| `PfStatus` | `OPEN` \| `SELECTED` \| `DISMISSED` \| `STALE` | PlanFork |
| `NaStatus` | `PROPOSED` \| `PROMOTED` \| `DISMISSED` | NextAction |
| `BlkStatus` | `ACTIVE` \| `CLEARED` | Blocker |
| `AwarenessState` | `UNSEEN` \| `SEEN` \| `REVIEWED` \| `ASSESSED` | Awareness |
| `ObjStatus` | `ACTIVE` \| `ACHIEVED` \| `DROPPED` | Objective |
| `InteractionKind` | `MEETING` \| `AD_HOC_DISCUSSION` \| `SUPERVISOR_UPDATE` \| `COLLABORATOR_DISCUSSION` \| `EXPERIMENT_SHIFT_HANDOFF` \| `OTHER` | Interaction |
| `RptStatus` | `OPEN` \| `MATERIAL_READY` \| `READY_TO_REPORT` \| `REPORTED` \| `FOLLOW_UP_REQUIRED` | ReportingItem |
| `InboxSource` | `HUMAN_QUICK_CAPTURE` \| `UNCLASSIFIED_AUDIT_FINDING` \| `IMPORTED_MEETING_NOTE` \| `UNREGISTERED_WORKSPACE_CHANGE` \| `AGENT_UNSTRUCTURED_REPORT` \| `EXTERNAL_NOTE` \| `DISCOVERED_SESSION` | InboxItem |
| `DsState` | `PENDING` \| `BOUND` \| `DETACHED` \| `IGNORED` | DiscoveredSession |
| `InboxState` | `CAPTURED` \| `CONVERTED` \| `DISMISSED` | InboxItem |

---

## 2. 层级对象

### 2.1 Project（`.research/project.yaml`，单文件单对象）

| 字段 | 类型 | 必填 | 约束/默认 | 说明 |
|---|---|---|---|---|
| `id` | PRJ id | ✅ | 不可变 | 全局唯一 |
| `title` | string | ✅ | 1..200 字符 | |
| `description` | string | ❌ | | |
| `importance` | int | ❌ | 1..5，默认 3 | Attention Manager 输入特征 |
| `attention_mode` | enum | ❌ | 默认 `NORMAL` | |
| `current_objective_refs` | OBJ id[] | ❌ | 默认 `[]`，元素须存在 | 当前聚焦 Objective |
| `target_date` | ISO date | ❌ | | |
| `created_at` | ISO ts | ✅ | | |

### 2.2 Topic（`.research/topics/<topic-id>/topic.yaml`）

| 字段 | 类型 | 必填 | 约束/默认 | 说明 |
|---|---|---|---|---|
| `id` | TPC id | ✅ | 须与目录名一致 | |
| `project_id` | PRJ id | ✅ | 须与 project.yaml 匹配 | 加载期校验 |
| `title` | string | ✅ | 1..200 字符 | |
| `description` | string | ❌ | | |
| `importance` | int | ❌ | 1..5，默认继承 Project | |
| `attention_mode` | enum | ❌ | 默认继承 Project | |
| `objective_refs` | OBJ id[] | ❌ | 默认 `[]` | Topic 级 Objective（scope=TOPIC） |
| `created_at` | ISO ts | ✅ | | |

### 2.3 Workstream（`.research/topics/<t>/workstreams/<ws-id>/workstream.yaml`）

| 字段 | 类型 | 必填 | 约束/默认 | 说明 |
|---|---|---|---|---|
| `id` | WS id | ✅ | 须与目录名一致 | |
| `topic_id` | TPC id | ✅ | 须与路径匹配 | INV-STRUCT-1 |
| `title` | string | ✅ | 1..200 字符 | |
| `lifecycle` | `WsLifecycle` | ❌ | 默认 `PLANNED` | `REALIZED`：首个属于本 WS 的 HistoryEvent append 时自动置位；`DROPPED` 仅用户 |
| `summary` | string | ❌ | | Brief 投影用 |
| `origin_topology_edge_ref` | TE id | ❌ | 若存在须为同 Topic 边 | fork/merge 产生的本 WS |
| `created_at` | ISO ts | ✅ | | |

---

## 3. 拓扑

### 3.1 TopologyEdge（`.research/topics/<t>/topology.yaml`，`edges` 数组）

```yaml
topology:
  topic_id: TPC-1
  edges:
    - id: TE-17
      operation: MERGE
      lifecycle: PLANNED
      inputs: [WS-1, WS-2]
      outputs: [WS-3]
      note: 可选说明
```

| 字段 | 类型 | 必填 | 约束 | 说明 |
|---|---|---|---|---|
| `id` | TE id | ✅ | Project 内唯一 | |
| `topic_id` | TPC id | ✅ | 须与所在文件匹配 | |
| `operation` | `EdgeOp` | ✅ | | `FORK` 典型 1→N；`MERGE` 典型 N→1（V1 不强制基数） |
| `lifecycle` | `WsLifecycle` | ✅ | | planned 与 realized 同一模型；plan change 不改写历史 |
| `inputs` | WS id[] | ✅ | ≥1，无重复，同 Topic | INV-STRUCT-2 |
| `outputs` | WS id[] | ✅ | ≥1，无重复，同 Topic | |
| `realized_event_id` | H id | ❌ | lifecycle=REALIZED 时必填且事件存在 | 对应 TOPOLOGY_FORK/MERGE_REALIZED |
| `note` | string | ❌ | | |

### 3.2 MergeContract（`.research/merges/<TE-id>/contract.md`）

- 纯 Markdown 自由内容（接口/数据格式/坐标系/benchmark protocol/精度/关键文件结构/期望产物等）；
- 归属由**路径**决定（TE id 即目录名），文件内不重复校验字段；
- 可选 YAML front-matter（`title`、`updated_at`），不参与核心校验；
- **无 ContractRevision**：版本历史/差异/恢复全部交给 Git（INV-GIT-8）；
- 插件不检查 contract 满足度、不因此阻塞或提示（计划书 §6.3）。

---

## 4. 计划对象

### 4.1 Task 定义（`.research/topics/<t>/workstreams/<w>/items/tasks/<task-id>.yaml`）

**定义文件只含声明式内容；execution/validation 等运行时状态由 ResearchHistory 派生，不落此文件**（INV-PLAN-9）。

| 字段 | 类型 | 必填 | 约束 | 说明 |
|---|---|---|---|---|
| `id` | T id | ✅ | 须与文件名一致 | |
| `workstream_id` | WS id | ✅ | 须与路径匹配 | |
| `title` | string | ✅ | 1..200 字符 | |
| `goal` | string | ✅ | 非空 | 最小可独立执行并验收的研究工作单元 |
| `deliverables` | string[] | ❌ | 默认 `[]` | 产物描述（可含路径/引用） |
| `acceptance_criteria` | string[] | ❌ | 默认 `[]`；为空 ⇒ validation 只能 NOT_REQUIRED（INV-TASK-3） | |
| `created_by` | ActorRef | ✅ | | |
| `created_at` | ISO ts | ✅ | | |
| `note` | string | ❌ | | |

**派生字段**（运行时计算，任何 API 不接受直接写入，INV-TASK-2；缓存落点 = operational DB 的 `derived_state` 表，见 §15——与事件 append 同事务写入，可由 replay 重建）：

- `execution: TaskExecution`、`validation: TaskValidation`：由 History 事件派生（当前值缓存于 `derived_state`）；
- `blockage: NONE | PARTIAL | FULL`：
  - `FULL`：存在 affects 本 Task 的 ACTIVE Explicit Blocker，或其 DEPENDS_ON 目标 Gate 未 PASSED / 目标 Task 未 EXECUTED；
  - `PARTIAL`：存在未满足依赖但并非全部路径被阻断（多依赖部分满足）；
  - `NONE`：无上述阻断因素；
- `completion: DONE | NOT_DONE`：`DONE = (execution==EXECUTED) ∧ (validation==PASSED ∨ validation==NOT_REQUIRED)`；
- 负科研结果：目标为「判断 X 是否成立」而结论为否、过程可信 ⇒ `EXECUTED + PASSED + DONE`，结论本身记为 Claim/Fact（INV-SCI-4）。

### 4.2 Gate 定义（`items/gates/<gate-id>.yaml`）

| 字段 | 类型 | 必填 | 约束 | 说明 |
|---|---|---|---|---|
| `id` | G id | ✅ | 须与文件名一致 | |
| `workstream_id` | WS id | ✅ | | |
| `title` | string | ✅ | | 回答「是否准备好进入下一步」 |
| `criteria` | string | ✅ | 非空 | 自然语言验收标准 + 必要引用 |
| `references` | string[] | ❌ | | |
| `created_at` / `created_by` | | ✅ | | |

派生状态：`PLANNED`（从未评估）→ `READY_FOR_REVIEW`（**派生**：plan 中位于其前的全部 item 均 EXECUTED/CANCELLED）→ 每次评估产生一条 GATE_EVALUATED 事件，当前结果 = 最近一次评估（`PASSED | FAILED | WAIVED`）；评估可多次，历史全保留。`WAIVED` 仅用户且需理由。READY_FOR_REVIEW 是提示性机械启发式，仅用于 review 提示，不构成依赖解释、不产生阻塞（INV-PLAN-2；blockage 只由显式 DEPENDS_ON 关系与未过 Gate 派生）。

### 4.3 Milestone 定义（`items/milestones/<milestone-id>.yaml`）

| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `id` | M id | ✅ | 须与文件名一致 |
| `workstream_id` | WS id | ✅ | |
| `title` | string | ✅ | 回答「达到了什么重要研究状态」 |
| `statement` | string | ✅ | 达成状态的明确陈述 |
| `created_at` / `created_by` | | ✅ | |

派生状态：`PLANNED` → `ACHIEVED`（MILESTONE_ACHIEVED 事件）→ 终态；`DROPPED` = 用户从 canonical plan 移除（ManagementAction 记录）。稀疏路线节点：不为每个 Task/Claim 建 Gate/Milestone。

### 4.4 canonical plan（`plan.yaml`）

```yaml
workstream: WS-1
ordered_items: [G-1, T-1, T-2, T-3, M-1, T-4, G-2]
```

| 字段 | 类型 | 必填 | 约束 |
|---|---|---|---|
| `workstream` | WS id | ✅ | 须与路径匹配 |
| `ordered_items` | id[]（T/G/M） | ✅ | 元素：定义文件存在 ∧ 属于本 WS ∧ 无重复 |

- 顺序即用户意图，**必须持久化**；加载/刷新/重启不得改变（INV-PLAN-1）；
- `plan order ≠ dependency`（INV-PLAN-2）；
- 只保存当前 Future zone 的有序 ID；离开计划的 item 定义文件长期保留。

---

## 5. PlanFork（operational；完整规则见 PLAN_FORK_SPEC.md）

| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `id` | PF id | ✅ | |
| `workstream_id` | WS id | ✅ | |
| `base_plan_objects` | `{path, git_blob_oid}[]` | ✅ | 创建时刻 canonical plan closure 的 blob OID 集合 |
| `base_git_commit` | string | ❌ | 创建时刻 HEAD（信息性，不参与 stale 判定） |
| `fork_anchor` / `merge_anchor` | id 或 `__START__`/`__END__` | ✅ | canonical 中存在的 item id 或边界哨兵 |
| `proposed_items` | ProposedItem[] | ✅ | 有序：`{kind: TASK|GATE|MILESTONE, action: KEEP, ref}` 或 `{action: NEW, spec: {title, goal/criteria/statement, ...}}` |
| `trigger_refs` | TypedRef[] | ✅ | ≥1，须存在且 kind ∈ {CLAIM, FACT, ARTIFACT, MILESTONE, OBJECTIVE} |
| `reason` | string | ✅ | 非空 |
| `necessity` | string | ✅ | 非空 |
| `created_by_run` | R id | ✅ | Agent proposal 专属 |
| `created_at` | epoch ms | ✅ | |
| `status` | `PfStatus` | ✅ | 初始 `OPEN`；append-only，状态只前进不回退 |
| `selected_at/selected_by`、`dismissed_at`、`stale_reason` | | ❌ | |

## 6. 执行对象

### 6.1 Run（operational）

Run = 一次连续执行尝试（Agent 或人）。Task : Run = 1 : N。

| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `id` | R id | ✅ | |
| `workstream_id` | WS id | ✅ | **Formal Run 必须绑定 Workstream**；`task_id` 可空（exploratory run）；仅 Project/Topic 级 session 不能成为 formal Run |
| `task_id` | T id | ❌ | |
| `dsh_session_id` | string | ❌ | 指针，不复制 session 内容（INV-DB-2） |
| `status` | `RunStatus` | ✅ | 由 RUN_* 事件派生并缓存 |
| `intent` | string | ❌ | 本次尝试的意图/标题 |
| `initiated_by` | ActorRef | ✅ | |
| `started_at` / `ended_at` | epoch ms | ✅/❌ | occurred 时间 |
| `summary` | string | ❌ | |
| `last_checkpoint_at` / `last_checkpoint_note` | | ❌ | `research_run_checkpoint` 工具更新 |

### 6.2 DiscoveredSession（operational）

规则（计划书 §12.3）：session 有显式 ResearchContext/workstream → 自动注册 Run；位于注册 workspace 但无 context → DiscoveredSession；外部 workspace → 忽略。

| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `id` | DS id | ✅ | |
| `dsh_session_id` | string | ✅ | 唯一 |
| `workspace_root` | string | ✅ | |
| `discovered_at` | epoch ms | ✅ | |
| `state` | `DsState` | ✅ | `PENDING` → 用户 `BIND`（→ formal Run）/ `DETACH`（移出范围，原 DSH session 保留）/ `IGNORE`（防重复发现） |
| `bound_run_id` | R id | ❌ | state=BOUND 时 |
| `summary` | string | ❌ | |

## 7. 语义标签（operational）

Workstream-local 一等语义标签；用于历史索引、引用、Brief、drill-down、PlanFork trigger。**不做自动科学判断**（INV-SCI-2）。

### 7.1 Claim（`C-<n>`）/ 7.2 Fact（`F-<n>`）

| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `id` | C/F id | ✅ | |
| `workstream_id` | WS id | ✅ | |
| `statement` | string | ✅ | 非空 |
| `created_by_run` | R id | ❌ | Agent 产生时必填 |
| `created_by` | ActorRef | ✅ | |
| `references` | string[] | ❌ | |
| `recorded_at` | epoch ms | ✅ | |
| `status`（派生） | Claim: `ACTIVE`/`RETRACTED`；Fact: 恒 `ACTIVE` | | Claim 撤销经 CLAIM_RETRACTED 事件 |

### 7.3 Artifact（`A-<n>`）

外部资源 registry，**不是文件存储**。Run-local 临时输出仅在用户/Agent 显式注册时成为 Artifact。

| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `id` | A id | ✅ | |
| `workstream_id` | WS id | ✅ | |
| `type` | `ArtifactType` | ✅ | |
| `title` | string | ✅ | |
| `uri` | string | ✅ | path 或 URI（不复制内容） |
| `content_hash` | string | ❌ | |
| `created_by_run` | R id | ❌ | |
| `related_task` | T id | ❌ | |
| `supersedes` | A id | ❌ | |
| `recorded_at` | epoch ms | ✅ | |
| `status`（派生） | `REGISTERED`/`MISSING` | | ARTIFACT_MARKED_MISSING 标记；找回可恢复 |

## 8. Relation（operational）

方向规范（INV-REL-1/2）：只持久化 `RELY_ON` 形式的直接边，`TARGET` 始终是 SOURCE 的前提/来源/输入/证据/上位目标；反向视图由 incoming-edge query 派生；不存传递闭包。

| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `id` | REL id | ✅ | |
| `source` | TypedRef | ✅ | |
| `relation_type` | `RelationType` | ✅ | |
| `target` | TypedRef | ✅ | |
| `created_by` | ActorRef | ✅ | |
| `created_at` | epoch ms | ✅ | |
| `status`（派生） | `ACTIVE`/`REMOVED` | | RELATION_REMOVED 撤销 |
| `removed_at` | epoch ms | ❌ | RELATION_REMOVED 时写入 |

唯一性：`(source.kind, source.id, relation_type, target.kind, target.id)`；禁止同边反向重复。

**History owner 推导规则**（RELATION_ADDED/REMOVED 事件的 owner workstream）：`source.workstream ?? target.workstream`；**两端都非 workstream-local 对象的 relation 在 V1 中拒绝创建**（组合表中所有类型均满足此约束）。

**`RelationType` 与合法 (source → target) 组合表**（工程默认；扩展需 bump schema-version）：

| relation_type | source kind | → target kind | 语义 |
|---|---|---|---|
| `DEPENDS_ON` | TASK / GATE | TASK / GATE / MILESTONE | 执行前提 |
| `SUPPORTED_BY` | CLAIM | FACT / ARTIFACT / CLAIM | 证据支持 |
| `CONTRADICTED_BY` | CLAIM | FACT / CLAIM / ARTIFACT | 证据冲突（只记录，不推理） |
| `DERIVED_FROM` | FACT | ARTIFACT / FACT | 推导来源 |
| `PRODUCED_BY` | ARTIFACT | RUN | 产出者 |
| `VALIDATED_BY` | GATE | FACT / ARTIFACT | 验证依据 |
| `CONSUMES` | TASK / RUN | ARTIFACT | 输入消耗 |
| `CONTRIBUTES_TO` | TASK / WORKSTREAM / CLAIM | OBJECTIVE | 上位目标 |
| `IMPLEMENTS` | TASK | OBJECTIVE / MILESTONE | 实现关系 |
| `RELATED_TO` | 任意 | 任意 | 弱关联 |

不保存的反向形式：`SUPPORTS`、`PRODUCES`、`REQUIRED_BY`、`VALIDATES`（INV-REL-2）。

## 9. 人类注意力层（operational）

### 9.1 Objective（`.research/objectives.yaml`，声明式；计划书 §17.3）

文件格式：顶层 `objectives:` 列表包装，每个元素为一个 Objective 对象（机器契约：`schema/declarative/objectives.schema.json`）。

| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `id` | OBJ id | ✅ | |
| `scope` | `PROJECT`/`TOPIC` | ✅ | scope=TOPIC 时 `topic_id` 必填 |
| `topic_id` | TPC id | 条件 | |
| `statement` | string | ✅ | |
| `success_criteria` | string[] | ✅ | ≥1 |
| `status` | `ObjStatus` | ❌ | 默认 `ACTIVE`；仅用户修改 |
| `target_date` | ISO date | ❌ | |
| `priority` | `P0`..`P3` | ❌ | 默认 `P2` |
| `linked_refs` | TypedRef[] | ❌ | G/M/WS |
| `created_at` | ISO ts | ✅ | |

**不允许嵌套 Objective tree**（INV-STRUCT-4）。

### 9.2 Intervention（operational）

一项明确需要人承担责任/注意的事项。

| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `id` | IV id | ✅ | |
| `title` | string | ✅ | |
| `detail` | string | ❌ | |
| `origin` | `USER`/`AGENT_REPORT`/`AUTO_FLOODING`/`AUTO_AUDIT` | ✅ | 自动来源仅限计划书 §16.3 三类机械触发 |
| `workstream_ids` | WS id[] | ❌ | 关联 WS（可由 `source_refs` 推导补全）；`INTERVENTION_CREATED` History 事件的 owner = 第一个关联 WS；完全无 WS 关联的 Intervention 不产生 History 事件（仅存在于 operational 队列） |
| `source_refs` | TypedRef[] | ❌ | 指向触发对象（PF/audit finding/agent report） |
| `status` | `IvStatus` | ✅ | **仅用户显式修改**（INV-PERM-4）；CLOSED ≠ 科学问题解决，只表示本次人类责任完成 |
| `created_by` | ActorRef | ✅ | |
| `created_at` / `closed_at` | epoch ms | ✅/❌ | |
| `resolution_note` | string | ❌ | 关闭时用户填写 |

GUI：OPEN 一组、PENDING 一组、CLOSED 折叠；Manager 只能排序不能隐藏（INV-ATTN-1）。

### 9.3 NextAction（operational）

| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `id` | NA id | ✅ | 轻量「可能值得做」，不是 Task |
| `workstream_id` | WS id | ❌ | |
| `statement` | string | ✅ | |
| `rationale` | string | ❌ | |
| `status` | `NaStatus` | ✅ | Agent 可创建；**用户**才 PROMOTE（转正为 Task）/DISMISS |
| `promoted_to_task_id` | T id | ❌ | PROMOTE 时生成 |
| `created_by` / `created_at` | | ✅ | |

### 9.4 Explicit Blocker（operational）

不可由图推导的现实阻碍（Derived Blocker 由依赖/未过 Gate 机械派生，不落此表）。

| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `id` | BLK id | ✅ | |
| `statement` | string | ✅ | |
| `affects` | TypedRef[] | ✅ | WS/T/R |
| `status` | `BlkStatus` | ✅ | |
| `source` | string | ✅ | 来源说明 |
| `references` | string[] | ❌ | |
| `created_at` / `cleared_at` | epoch ms | ✅/❌ | |

Blocker 与 Intervention 分离（Blocker 描述阻碍，Intervention 描述人类责任）。

### 9.5 Human Awareness（operational）

| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `object_ref` | TypedRef | ✅ | 主键；kind 限高价值对象：CLAIM/FACT/ARTIFACT/MILESTONE/INTERVENTION/PLAN_FORK（INV-ATTN-4） |
| `state` | `AwarenessState` | ✅ | 默认 `UNSEEN`；**仅用户**修改（INV-PERM-2） |
| `updated_at` | epoch ms | ✅ | |

## 10. 沟通与日程（operational）

### 10.1 Interaction

| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `id` | INT id | ✅ | 可跨 Workstream |
| `kind` | `InteractionKind` | ✅ | |
| `title` | string | ✅ | |
| `occurred_at` | epoch ms | ✅ | |
| `participants` | string[] | ❌ | |
| `notes` | string | ❌ | Markdown 会议纪要等 |
| `related_workstreams` | WS id[] | ❌ | 其产生的具体科研变化**分别**进入对应 WS ResearchHistory |

### 10.2 ReportingItem

| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `id` | RPT id | ✅ | 「要向谁、何时、汇报什么」；不是 Task |
| `audience` | string | ✅ | |
| `statement` | string | ✅ | |
| `material_refs` | TypedRef[] | ❌ | |
| `status` | `RptStatus` | ✅ | |
| `occasion_ref` | SEV id | ❌ | 关联 ScheduledEvent |
| `created_at` / `reported_at` | epoch ms | ✅/❌ | |

### 10.3 ScheduledEvent

| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `id` | SEV id | ✅ | 只管理用户登记的事件；**不接外部 Calendar** |
| `title` | string | ✅ | |
| `schedule` | `{kind: ONCE, at}` 或 `{kind: RECURRING, freq: DAILY/WEEKLY/MONTHLY, interval?, until?}` | ✅ | 轻量 recurrence，非完整 RRULE |
| `related_refs` | TypedRef[] | ❌ | 提醒 research-aware：显示关联 RPT/IV/TPC |
| `reminder_lead_ms` | int | ❌ | |

## 11. Research Inbox（operational）

Capture-first staging layer；Inbox item **不是正式科研状态**。

| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `id` | IN id | ✅ | |
| `source` | `InboxSource` | ✅ | |
| `payload` | string | ✅ | 文本/摘要 |
| `raw` | any | ❌ | 原始数据（如 audit finding 细节） |
| `context_refs` | TypedRef[] | ❌ | |
| `state` | `InboxState` | ✅ | |
| `converted_to` | TypedRef | ❌ | 转换目标：Task/NextAction/Intervention/Claim/Fact/ReportingItem/Interaction；**需显式确认或明确 policy** |
| `created_at` | epoch ms | ✅ | |

## 12. Provenance（operational）

### 12.1 ManagementAction

记录管理操作的轻量 operational provenance（谁选择了 PF、谁触发了 restore、UI 操作对应哪个 commit/blob）。**不保存 before/after snapshot，不是 restore source**（计划书 §22.4）；声明式状态的历史回放以 Git 为准；ResearchHistory 不记录 plan reorder、contract edit 等管理操作。

`action_kind` 枚举：`PLAN_REORDER | PLAN_ITEM_ADDED | PLAN_ITEM_REMOVED | PF_CREATED | PF_SELECTED | PF_DISMISSED | PF_STALE_MARKED | CHECKPOINT_SAVED | RESTORE_PERFORMED | TOPOLOGY_EDITED | MANIFEST_EDITED | CONTRACT_EDITED | WS_LIFECYCLE_CHANGED | OBJECTIVE_EDITED | INBOX_CONVERTED`

字段：`id`、`action_kind`、`actor: ActorRef`、`subject_refs: TypedRef[]`、`git_commit_oid?`、`git_blob_oids?: {path, oid}[]`、`detail?`、`occurred_at`。

### 12.2 AnalysisRecord

Investigator 分析的持久化形式（默认 transient；仅用户显式保存或被正式 Intervention/Audit/decision 引用时记录）。

字段：`id`、`source_ref: TypedRef`（Intervention / Audit finding / Brief）、`investigator_run_id?`、`dsh_session_id?`、`content`（Markdown）、`created_at`。

---

## 13. 状态机定义（合法转换表；非法转换在 service 层拒绝，INV-TASK-1）

| 对象 | 状态机 |
|---|---|
| Task execution | `PLANNED → ACTIVE \| EXECUTED \| CANCELLED`；`ACTIVE → PAUSED \| EXECUTED \| CANCELLED`；`PAUSED → ACTIVE \| EXECUTED \| CANCELLED`；`EXECUTED`/`CANCELLED` 终态 |
| Task validation | `NOT_REQUIRED → PENDING`；`PENDING → UNDER_REVIEW \| NOT_REQUIRED`；`UNDER_REVIEW → PASSED \| FAILED`；`PASSED → PENDING`（重验）；`FAILED → PENDING`（重验） |
| Gate | `PLANNED → READY_FOR_REVIEW`（派生）→ 评估（可重复）：`PASSED \| FAILED \| WAIVED`；`WAIVED` 仅用户+理由 |
| Milestone | `PLANNED → ACHIEVED`（事件）终态；`PLANNED → DROPPED`（管理操作） |
| Workstream lifecycle | `PLANNED → REALIZED`（首个 HistoryEvent 的接受与迁移为同一原子操作，见 HISTORY_EVENT_CATALOG §3）；`PLANNED \| REALIZED → DROPPED`（仅用户） |
| Run | `RUNNING → FINISHED \| FAILED \| CANCELLED`（终态） |
| PlanFork | `OPEN → SELECTED \| DISMISSED \| STALE`；`STALE → DISMISSED`；`SELECTED` 终态（详见 PLAN_FORK_SPEC §10） |
| Intervention | `OPEN ↔ PENDING`；`OPEN \| PENDING → CLOSED`（终态；重开 = 新 Intervention）；仅用户 |
| NextAction | `PROPOSED → PROMOTED \| DISMISSED`（终态）；PROMOTE 仅用户 |
| Blocker | `ACTIVE → CLEARED`（终态；复发 = 新 Blocker） |
| DiscoveredSession | `PENDING → BOUND \| DETACHED \| IGNORED`（终态；DETACH/IGNORE 后不再重复发现） |
| InboxItem | `CAPTURED → CONVERTED \| DISMISSED`（终态） |
| Objective | `ACTIVE → ACHIEVED \| DROPPED`（仅用户） |
| ReportingItem | `OPEN → MATERIAL_READY`；`MATERIAL_READY → READY_TO_REPORT \| OPEN`；`READY_TO_REPORT → REPORTED \| MATERIAL_READY`；`REPORTED → FOLLOW_UP_REQUIRED`；`FOLLOW_UP_REQUIRED → READY_TO_REPORT` |
| Claim | `ACTIVE → RETRACTED`（终态） |
| Artifact | `REGISTERED ↔ MISSING`（MISSING 经事件标记；找回经用户操作恢复） |

## 14. `.research/` 布局规范（声明式真源）

```text
.research/
├── schema-version            # 单行整数；V1 = 1
├── project.yaml              # Project（§2.1）
├── objectives.yaml           # Objective 列表（§9.1）
├── workspace.yaml            # workspace 注册与 audit policy（§14.1）
├── topics/
│   └── <topic-id>/
│       ├── topic.yaml        # Topic（§2.2）
│       ├── topology.yaml     # TopologyEdge 列表（§3.1）
│       └── workstreams/
│           └── <workstream-id>/
│               ├── workstream.yaml     # Workstream（§2.3）
│               ├── plan.yaml           # canonical plan（§4.4）
│               └── items/
│                   ├── tasks/<task-id>.yaml
│                   ├── gates/<gate-id>.yaml
│                   └── milestones/<milestone-id>.yaml
├── merges/
│   └── <topology-edge-id>/contract.md  # MergeContract（§3.2）
├── policies/
│   └── agent-plan-fork.yaml  # AgentPlanForkPolicy（PLAN_FORK_SPEC §9）
└── state/
    └── research.sqlite  # V2（设计 §3.3）：运行态事件库（单工作区模式落点）——状态区，不入声明树语义
```

> **V2 注（§3.3 数据库布局，T2.4）**：`state/` 是插件运行态状态区（单工作区
> 模式的库目录 `<treeDir>/state/research.sqlite`；受管模式的库在中枢
> `<hubDir>/projects/<id>/research.sqlite`）。`state/` 是布局的**已知非声明式
> 条目**：装载器（§14 walk）识别它但不展开、不校验其内容；checkpoint 提交
> 白名单（W9/W10）显式排除 `.research/state/`（运行态数据库永不入 commit）。
> V1 的 `$DSH_HOME/research-control/<id>/` 库路径自 V2 起退役（仅启动日志
> 提示，不自动搬运，设计 §14）。

### 14.1 workspace.yaml（工程默认结构）

```yaml
workspace:
  root: .                # 相对 Git repo root
  git_required: true     # INV-GIT-1
audit:
  strict_tracked:        # 计划书 §22.1 第一层
    paths: []            # 关键代码 / Task deliverables / merge 相关文件 glob
  discovery_zones:       # 第二层：发现未注册 Artifact / workspace change
    - path: results/
      artifact_types: [DATASET, FIGURE]   # 可选：该 zone 期望的 ArtifactType（发现分类提示）
    - path: docs/
  ignored:               # 第三层
    - cache/
    - build/
    - tmp/
```

规则：文件名/目录名中的 `<id>` 即对象 ID（加载期与文件内 `id` 字段核对）；所有 YAML 经 `schema/declarative/` 对应 schema 校验，失败即拒绝加载并精确定位（ARCHITECTURE §10）。

## 15. SQLite 表映射概要（operational 真源）

位置：`$DSH_HOME/research-control/<project-id>/research.sqlite`（DSH_HOME 解析见 DSH_ADAPTER.md）。

| 表 | 主键 | 关键约束/索引 |
|---|---|---|
| `history_event` | `event_id` | `UNIQUE(owner_workstream_id, event_seq)`；索引 `(owner_workstream_id, occurred_at, event_seq)`、`(event_type, occurred_at)`、`(recorded_at)` |
| `run` | `run_id` | 索引 `(workstream_id, started_at)`、`dsh_session_id` |
| `discovered_session` | `id` | `UNIQUE(dsh_session_id)` |
| `claim` / `fact` | `id` | 索引 `(workstream_id, recorded_at)` |
| `artifact` | `id` | 索引 `(workstream_id, recorded_at)` |
| `relation` | `id` | `UNIQUE(source_kind, source_id, relation_type, target_kind, target_id)` |
| `intervention` | `id` | 索引 `(status)` |
| `next_action` / `blocker` | `id` | |
| `awareness` | `(object_kind, object_id)` | |
| `interaction` / `reporting_item` / `scheduled_event` | `id` | |
| `inbox_item` | `id` | 索引 `(state, created_at)` |
| `plan_fork` | `id` | 索引 `(workstream_id, status)` |
| `management_action` / `analysis_record` | `id` | |
| `derived_state` | `(object_kind, object_id)` | 声明式对象的派生状态缓存：task execution/validation、gate 当前评估结果、milestone 状态、workstream lifecycle 等（`state` 为 JSON）；与事件 append **同事务**写入；可由 replay 重建（TC-HIST-006）；亦承载 PLANNED WS 首事件的原子 realize 翻转（TC-DOM-033） |
| `meta` | `key` | ID 计数器、DB schema 版本等 |

通则：所有 operational 表**不 hard delete** 一等 identity 行（INV-HIST-7）；状态列是 History 的派生缓存，可由 replay 重建；DB 文件本身永不进 Git。

## 16. 引用完整性规则

1. **声明式 → 声明式**：加载期全量校验（`plan.ordered_items` 项存在、`project_id/topic_id/workstream_id` 路径匹配、objective_refs 存在、拓扑边同 Topic 等）；失败即拒载该文件并报错定位；
2. **operational → 声明式**：写入时校验（如 Claim.workstream_id 须存在）；声明式对象其后被用户移除（如 item 离开 plan 但定义保留——定义文件原则上不删）时，历史引用按「悬挂引用」容错展示，标注 `dangling`，不回填修改 History；
3. **operational → operational**：写入时校验存在性（trigger_refs、supersedes、bound_run_id 等）；
4. **TypedRef 跨表解析**：按 §1.3 ObjectKind 路由到对应表/文件；解析失败 ≠ 错误（悬挂引用），但**写入新引用时**失败 = 拒绝。

---

## 附录 A：YAML 示例（说明性）

```yaml
# .research/project.yaml
id: PRJ-1
title: 机器人视觉定位系统
description: 多传感器融合的亚像素级视觉定位
importance: 4
attention_mode: FOCUS
current_objective_refs: [OBJ-1]
created_at: 2026-08-21T09:00:00Z
```

```yaml
# .research/topics/TPC-1/workstreams/WS-1/plan.yaml
workstream: WS-1
ordered_items: [G-1, T-1, T-2, T-3, M-1, T-4, G-2]
```

```yaml
# .research/topics/TPC-1/workstreams/WS-1/items/tasks/T-1.yaml
id: T-1
workstream_id: WS-1
title: 标定数据采集方案对比
goal: 确定 EURA 相机阵列的标定数据采集方案，误差目标 <2px 重投影误差
deliverables:
  - docs/calibration-plan.md
acceptance_criteria:
  - 三种候选方案均有实测重投影误差数据
created_by: { kind: USER, label: researcher }
created_at: 2026-08-21T09:30:00Z
```
