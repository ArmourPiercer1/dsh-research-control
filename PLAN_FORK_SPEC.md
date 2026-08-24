# PLAN_FORK_SPEC.md - Agent PlanFork 规范（proposal / selection / stale）

> 文档状态：**Frozen V1**（2026-08-22 冻结；含独立审计修订 A-13（修正版）/A-14/A-15（per-WS 口径经用户确认），追溯见计划书 §40 附录）
> 上游：计划书 §11（Agent PlanFork）、§10（Canonical Future Plan）、§21.9（blob OID stale detection）
> 关联：`DOMAIN_SCHEMA.md` §5（字段）、`GIT_INTEGRATION.md` §7（hash-object 用法）、`ARCHITECTURE.md` §5.4（INV-PLAN-\*）
> 核心立场：**Agent 发现计划需要修改时，禁止直接修改 canonical plan；必须提出一条完整候选分支（append-only proposal），由用户选择。**

---

## 1. 动机与权限

```text
canonical:  G1 - T1 - T2 - T3 - M1 - T4 - G2

agent proposal (PF-17):
            G1 - T1' - T2' - M' - T3' - T4' - T5' - G2
            └── fork_anchor ─────────────── merge_anchor ──┘
```

| 操作 | Agent | 用户 |
|---|---|---|
| 创建 PlanFork proposal | ✅（经 `research_plan_fork_create`，校验后 append） | ❌（用户直接编辑 canonical） |
| 修改 / 删除已有 PlanFork | ❌（append-only，INV-PLAN-4） | ❌（DISMISS 只改状态，不删除） |
| SELECT / DISMISS | ❌（INV-PERM-2） | ✅ |
| 修改 canonical plan | ❌（无 API，INV-PLAN-3） | ✅（GUI reorder/insert/delete + Git 版本化） |
| 以 unresolved PF 为基准再 fork | ❌（工具无 base 参数，INV-PLAN-6） | - |

## 2. 模型

字段定义见 `DOMAIN_SCHEMA.md` §5。此处补充语义细节：

### 2.1 ProposedItem

```ts
type ProposedItem =
  | { action: 'KEEP'; kind: 'TASK'|'GATE'|'MILESTONE'; ref: string }   // 引用当前 canonical 中的 item id，保持不变
  | { action: 'NEW'; kind: 'TASK'|'GATE'|'MILESTONE'; spec: NewItemSpec } // 新 item，SELECT 时才获得正式 ID
```

`NewItemSpec` 按 kind 对应 DOMAIN_SCHEMA §4 的必填声明字段（Task: title/goal/deliverables/acceptance_criteria；Gate: title/criteria/references；Milestone: title/statement）。

### 2.2 anchor 语义

- `fork_anchor`：canonical 中**保留**的最后一个分叉点；
- `merge_anchor`：proposal **重新接入** canonical 的汇合点；
- 替换区间为**开区间** `(fork_anchor, merge_anchor)`：两个 anchor 本身保留在 canonical 中，区间内的 canonical items 被 `proposed_items` 替换（可增删改）；
- 边界哨兵：`__START__`（计划起点之前）/ `__END__`（计划终点之后），用于整计划替换或纯尾部追加，是否允许由 policy 控制；
- 校验：anchor 若非哨兵，必须是当前 canonical `ordered_items` 中存在的 id，且 `fork_anchor` 的序号 ≤ `merge_anchor` 的序号（相等 = 纯插入）。

## 3. Plan Closure 与 blob OID 基准

### 3.1 Plan closure 定义

```text
closure(WS) = { plan.yaml }
            ∪ { ordered_items 中每个 item 的定义文件 }
```

即（相对 workspace 根的路径集合）：

```text
.research/topics/<t>/workstreams/<w>/plan.yaml
.research/topics/<t>/workstreams/<w>/items/tasks/<id>.yaml        × N
.research/topics/<t>/workstreams/<w>/items/gates/<id>.yaml        × N
.research/topics/<t>/workstreams/<w>/items/milestones/<id>.yaml   × N
```

V1 **默认保存整个当前 Future Plan closure**（而非仅 anchor 区间），消除区间裁剪的实现歧义（计划书 §11.3）。

### 3.2 blob OID 捕获

创建 PlanFork 时，对 closure 中每个文件执行：

```text
git hash-object -- <path>        # 对 working-copy 内容计算 Git blob OID（无需 commit）
```

保存 `base_plan_objects: { path, git_blob_oid }[]`（稳定集合）。同时记录 `base_git_commit`（当时 HEAD，信息性，不参与 stale 判定）。

**为什么不自建 plan_revision_id**：proposal 的语义基准不仅包括 `plan.yaml` 的顺序，还包括被引用的 Task/Gate/Milestone 定义。用户只修改 T2 的 goal 而不改顺序时，旧 proposal 也必须失效。Git blob OID 让 stale 检测不依赖用户 commit 频率（计划书 §11.3）。

## 4. 创建流程（工具 `research_plan_fork_create`）

输入：`workstream_id`、`fork_anchor`、`merge_anchor`、`proposed_items[]`、`trigger_refs[]`、`reason`、`necessity`（+ 调用上下文中的 actor/run）。

校验顺序（任一失败即拒绝，错误信息指明失败项）：

1. policy `enabled = true`；
2. `workstream_id` 存在且 canonical plan 已加载；
3. **基准由服务端重算**：当前 closure 的 blob OID 集合（不接受客户端提交 base -- INV-PLAN-6 的结构性保证）；
4. `proposed_items` 非空有序；`KEEP.ref` 必须存在于当前 canonical（anchor 哨兵策略校验同 §2.2）；`NEW.spec` 通过对应 item schema 校验；
5. anchor 合法（§2.2）且满足 policy 的 anchor 约束（如 required_item_types）；
6. `trigger_refs` ≥1 且全部存在，kind ∈ policy 允许集合（默认 CLAIM/FACT/ARTIFACT/MILESTONE/OBJECTIVE）；
7. `reason`、`necessity` 非空；
8. `created_by_run` 存在且**属于该 workstream**（formal run，绑定关系见 DOMAIN_SCHEMA §6.1）。

通过后：分配 PF id，status=OPEN，append 写入 operational DB；记录 `ManagementAction(PF_CREATED)`。

插件只做上述**机械校验**（引用存在、字段存在、拓扑合法），不判断科研理由是否正确（INV-SCI-2）。

## 5. Stale 检测算法

```text
stale(PF) ⇔ currentClosure(WS) ≠ PF.base_plan_objects     # (path, oid) 集合不相等
```

- 集合比较：路径集合不同（增/删文件）或任一同路径文件 blob OID 不同，均判 stale；文件缺失视为不同；
- 触发时机：canonical plan 或任一 item 定义文件加载/变更后；PF 列表查询时（懒检测 + 缓存）；SELECT 前强制复核；
- 判 stale 后：status OPEN -> STALE，`stale_reason` 记录首个差异（path + old/new oid），`ManagementAction(PF_STALE_MARKED)`；
- stale 是**信息性状态**：不阻塞用户任何操作，STALE 的 PF 不能被 SELECT（基准已失真，需 Agent 重新提议）。

## 6. SELECT 物化流程（用户，GUI 触发）

前置：`PF.status == OPEN`（STALE/DISMISSED/SELECTED 均拒绝）。

1. **复核基准**：重算当前 closure；与 `PF.base_plan_objects` 不一致 -> 自动置 STALE 并拒绝本次 SELECT，返回差异说明（INV-PLAN-8）；
2. **物化新 items**：为每个 `NEW` item 分配正式 ID（T/G/M 各自的下一序号），原子写入定义文件；`created_by = { kind: AGENT, run_id: PF.created_by_run }`（内容作者），物化执行者记录在 ManagementAction；
3. **重写 plan.yaml**：
   `new_plan = canonical[..fork_anchor]（含 fork_anchor 的前缀） + materialized(proposed_items) + canonical[merge_anchor..]（含 merge_anchor 的后缀）`——两 anchor 各保留一次；哨兵 `__START__`/`__END__` 按计划边界处理；
   特例 `fork_anchor == merge_anchor == X`（纯插入）：`new_plan = canonical[..X]（含） + materialized(proposed_items) + canonical[位于 X 之后的首个 item..]（含）`；
4. `PF.status = SELECTED`，记录 `selected_at/selected_by`；
5. **同基准连锁失效**：该 workstream 其余 OPEN PF 一律置 STALE（`stale_reason = "superseded by PF-<id> selection"`）--它们的基准 closure 已不存在（INV-PLAN-7）；
6. **不写 ResearchHistory**：SELECT 是管理操作（计划书 §22.4），只记录 `ManagementAction(PF_SELECTED)`（含新 plan.yaml 与各定义文件的 blob OID）；
7. **提示用户 Save Research Checkpoint**（git commit，显式、可选、绝不自动 -- INV-GIT-2）；记录 resulting commit OID 于 ManagementAction；
8. 被 SELECT 替换掉的旧 canonical items：定义文件**保留**（INV-PLAN-9），只是不再出现在 `ordered_items`；旧计划本身不进 ResearchHistory（它没有实际发生）。

## 7. DISMISS（用户）

- 允许对 OPEN 或 STALE 的 PF 执行；`status -> DISMISSED` + `ManagementAction(PF_DISMISSED)`；
- **只改状态，不删除记录**（append-only）。

## 8. Flooding 检测

- 触发点：每次 PF 创建后；每次 plan 加载后；
- 规则：`count(status == OPEN 的 PF, per workstream) > threshold`（默认 5，policy 可调）且该 workstream **不存在** origin=AUTO_FLOODING 的 OPEN Intervention。**口径说明（对计划书 §11.6 的工程简化，经用户确认维持）**：计划书原文为「对每个 canonical plan 区域统计 unresolved PlanFork 覆盖数」，但区域边界未定义；per-WS 总数 ≥ 任意区域覆盖数，同阈值下触发不晚于区域口径（方向保守），且实现确定；
- 动作：创建 Intervention（title：`Review accumulated agent plan forks [WS-<n>]`，origin=AUTO_FLOODING，source_refs=[相关 PF]），产生 `INTERVENTION_CREATED` History 事件（actor=PLUGIN，owner=该 WS）；
- V1 不做更复杂自动限流（不阻止后续 PF 创建）。

## 9. AgentPlanForkPolicy（`.research/policies/agent-plan-fork.yaml`）

```yaml
enabled: true
anchors:
  allow_boundary_sentinels: true   # 允许 __START__ / __END__
  required_item_types: []          # 空 = 任意 item 可作 anchor；可设 [GATE]
flooding:
  threshold: 5                     # 每 workstream unresolved OPEN PF 数上限
triggers:
  require_at_least_one: true
  allowed_kinds: [CLAIM, FACT, ARTIFACT, MILESTONE, OBJECTIVE]
```

对应 schema：`schema/declarative/agent-plan-fork-policy.schema.json`。

## 10. 状态机与不变量

```text
           ┌────────────┐  SELECT(用户)  ┌──────────┐
  创建 ──> │    OPEN    │ ────────────> │ SELECTED │（终态）
           └─┬───────┬──┘               └──────────┘
     基准失效│       │ DISMISS(用户)
           ┌▼───────▼──┐ DISMISS(用户) ┌──────────┐
           │   STALE   │ ───────────> │ DISMISSED │（终态）
           └───────────┘               └──────────┘
```

- OPEN -> SELECTED | DISMISSED | STALE；STALE -> DISMISSED；SELECTED/DISMISSED 终态；
- 全部状态迁移 append-only 记录，PF 行永不删除。

涉及不变量：INV-PLAN-3 / 4 / 5 / 6 / 7 / 8 / 9（ARCHITECTURE §5.4）、INV-PERM-2、INV-GIT-2。

## 11. 端到端示例

初始 canonical（WS-1）：`G-1, T-1, T-2, T-3, M-1, T-4, G-2`

1. Agent Run R-81 完成实验，记录 `FACT_RECORDED F-31`（新数据与 T-2 假设冲突）；
2. Agent 调用 `research_plan_fork_create`：fork_anchor=`G-1`，merge_anchor=`G-2`，proposed = `[NEW Task "复算误差预算", KEEP T-3, NEW Milestone "标定方案定稿", NEW Task "补充实验", KEEP T-4]`，trigger_refs=`[F-31]`，reason/necessity 齐全；
3. 服务端重算 closure blob OID（plan.yaml + 7 个定义文件）作为 base；PF-17 = OPEN；
4. **用户手动修改 T-2 的 goal**（编辑 YAML）-> closure 中 T-2 定义文件 OID 变化 -> PF-17 自动 STALE（stale_reason 指向该文件）；
5. Agent 重新提议（基于新 closure）-> PF-18 OPEN；若此时该 WS 的 OPEN PF 数超过 5 -> AUTO_FLOODING Intervention；
6. 用户 SELECT PF-18：新 items 获得 T-5、M-2、T-6 正式 ID 并写定义文件；plan.yaml 重写为 `G-1, T-5, T-3, M-2, T-6, T-4, G-2`；PF-18=SELECTED；其余 OPEN PF（如有）置 STALE；
7. 用户点击 Save Research Checkpoint -> git 只提交 `.research/**` 变更，commit message 如 `research: select PF-18 for WS-1`，OID 记入 ManagementAction；
8. Git log/diff/restore 提供新旧计划的所有版本操作（INV-GIT-8）。
