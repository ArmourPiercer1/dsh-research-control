# G1 错误模型对账：四个新信号的归类（2026-11-03）

> 触发：外部审查 P1-2 —— R3 修订在契约与实验里引入了 `REPLAY_ACCESS_DENIED`、`SPACE_UNBOUND`、
> `COMMIT_RECORD_EMPTY`、`IDEMPOTENCY_KEY_REUSED` 四个新名称，未说明它们是封闭 `RefusalCode`、
> 宿主错误映射，还是内部存储信号。
> 性质：**错误模型对账**（归类 + 载体 + 依据），不新增功能、不改语义、不扩张封闭集。
> 判据源：`G1-UNIFIED-CONTRACTS.md §2.10`（扩张总登记）、`src/contracts/index.ts` 的 `RefusalCode` 封闭联合、
> `G1-CONTRACT-IDEMPOTENCY.md` IDC-5/IDC-12、ADJ X-2/X-3（`TOOL_INPUT + detail.serviceCode` 形态）。

## 0. 结论：封闭集净扩张 = **0**

| 新名称 | 归类 | 正式载体 | 是否进 `RefusalCode` |
| --- | --- | --- | --- |
| `REPLAY_ACCESS_DENIED` | 运行期拒绝 → **复用既有码** | `RefusalCode.AUTHORITY_REQUIRED`（detail 仅 `{reason:"replay-disclosure", operation}`，**不含 `resultRef`/oid/响应字节**） | **否** |
| `SPACE_UNBOUND` | 上下文缺件 → **复用既有码** | `RefusalCode.CONTEXT_INCOMPLETE`（detail `{field:"spaceId", reason:"space-unbound"}`） | **否** |
| `COMMIT_RECORD_EMPTY` | **内部存储信号**（事务完整性） | 存储层信号文本（与 `MOUNT_ROW_FROZEN` 等同类，P-03 区分：非封闭集成员）；对外只表现为事务回滚 + 通用提交失败，**不新增对外码** | **否** |
| `IDEMPOTENCY_KEY_REUSED` | 接口层错误回显 → **既有裁定形态** | `TOOL_INPUT` + `detail.serviceCode="IDEMPOTENCY_KEY_REUSED"`（ADJ X-2/X-3 已裁：不自造 `F-*`，不进机制封闭集） | **否** |

**因此 `RefusalCode` 封闭集本轮零新增**。原有唯一计划新增项 `RELOCATION_PRECONDITION`（RL-11.2）随
**PR-8 DEFERRED** 一并推迟——它不进首版集，也不作为本轮对账的一部分。

## 1. 逐项归类与理由

### 1.1 `REPLAY_ACCESS_DENIED` → `AUTHORITY_REQUIRED`

- **为什么不是新码**：`AUTHORITY_REQUIRED` 的既有语义正是「缺该业务动作所需的授权轴」（SP-09：与写权分轴）。
  重放披露需要的是**当前读授权轴**，属同一语义面；新增一个平行码会让客户端面对两个含义重叠的权限错误。
- **约束（防泄漏）**：拒绝时 detail **不得**携带 `resultRef`、oid、revision 或任何响应字节片段——
  否则「拒绝披露」本身变成了存在性/内容泄漏通道（与 `NOT_FOUND_IN_SPACE` 合并存在性与不可见性的同族纪律）。
- **与 `NO_SPACE_WRITE` 的关系**：连写权都没有时，更早的 UoW 守卫先拒（`NO_SPACE_WRITE`），根本到不了披露判定；
  两者**不是**同一信号，不得互相替代或合并记录（JC-1 第 7 步 + IDC-12 第 3 条）。
- **客户端映射**：宿主侧按既有权限错误通道呈现（与 `AUTHORITY_REQUIRED` 的既有映射一致），不新增客户端错误类型。

### 1.2 `SPACE_UNBOUND` → `CONTEXT_INCOMPLETE`

- **为什么**：`CONTEXT_INCOMPLETE` 的既有语义是「ReadContext 缺必需字段（未声明截点的查询视为未定义）」；
  `SpaceContext.spaceId` 缺失属同一类「调用上下文缺件」，只是字段不同（T-01 同型）。
- **实施基线 §1 的落点**：`g1/G2-IMPLEMENTATION-BASELINE.md §1` 的「缺绑定 ⇒ 显式拒绝」现明确写
  **`CONTEXT_INCOMPLETE`（`detail.field="spaceId"`）**，不是新码。
- **为什么不用默认值兜底**：缺绑定给默认 Space 会把「未认证上下文」变成「有归属的写」，与 D1-a 同族错误。

### 1.3 `COMMIT_RECORD_EMPTY` → 内部存储信号（非封闭集）

- **语义**：一个已预留提交号的事务最终**零事件** ⇒ 提交账「至少一条事件」判据不成立 ⇒ 必须回滚（号不占）。
- **为什么不能是对外码**：这是**机制自身的完整性断言**（类似触发器拒绝），调用方没有「修法」可选——
  它不是业务拒绝，不构成客户端可编程语义。若把它做成 `RefusalCode`，等于给调用方一个「我做了空提交」的
  稳定可判信号，而正确行为是**根本不该发生**（发号点在第一次权威写之前，写即产生事件）。
- **对外表现**：事务回滚 + 通用提交失败；机制侧以信号文本记录（与 `MOUNT_ROW_FROZEN` 等存储信号同列，
  §2.10 存储层信号表可登记，但**不计入** `RefusalCode` 数量）。

### 1.4 `IDEMPOTENCY_KEY_REUSED` → `TOOL_INPUT + detail.serviceCode`

- 这是 ADJ X-2/X-3 已经裁定的形态：接口层错误用 `TOOL_INPUT` 承载，具体原因放 `detail.serviceCode`，
  **不自造** `F-*` 名、不进机制封闭集。
- 实验（`preflight/tx/run.mjs`）此前直接 `new Refusal('IDEMPOTENCY_KEY_REUSED', …)` 属实验侧简写；
  现改为 `new Refusal('TOOL_INPUT', { serviceCode: 'IDEMPOTENCY_KEY_REUSED', step: 'client_request_id' })`，
  与正式契约同形。
- 注意：IDC-5 步 3 的对外 detail 原文即 `{serviceCode:"IDEMPOTENCY_KEY_REUSED", step:"client_request_id"}`
  ——本对账不改该原文，只确认载体是 `TOOL_INPUT`。

## 2. 同步落点（本轮已改）

| 文件 | 改动 |
| --- | --- |
| `G1-UNIFIED-CONTRACTS.md` JC-1 第 7 步 | `REPLAY_ACCESS_DENIED` → `AUTHORITY_REQUIRED`（detail 不含结果引用），并保留「`NO_SPACE_WRITE` 更早」的区分 |
| `G1-CONTRACT-IDEMPOTENCY.md` IDC-12 | 同上；明确「不得泄漏 resultRef/oid/响应字节」 |
| `G1-CONTRACT-IDEMPOTENCY.md` 写入时点段 | `IDEMPOTENCY_KEY_REUSED` 标注为 `TOOL_INPUT + detail.serviceCode` 形态 |
| `G2-IMPLEMENTATION-BASELINE.md §1` | `SPACE_UNBOUND` → `CONTEXT_INCOMPLETE`（`detail.field="spaceId"`） |
| `preflight/tx/run.mjs` | 三个实验信号改为正式载体：回放拒绝 → `AUTHORITY_REQUIRED`；异体 → `TOOL_INPUT/serviceCode`；空区间 → 存储信号文本（非 Refusal） |
| `G1-ACCEPTANCE-MATRIX.md` §2.10 行 | 不改（本轮封闭集净扩张 0，无需登记新码） |

## 3. 剩余义务（归实施 PR）

1. **每码负例**：`AUTHORITY_REQUIRED` 与 `CONTEXT_INCOMPLETE` 的既有负例（跨空间存在性同形）须覆盖新用法，
   由 PR-9（幂等/披露面）与 PR-3（Space 装配面）在正式 `tests/**` 补。
2. **宿主映射表**：`AUTHORITY_REQUIRED` / `CONTEXT_INCOMPLETE` 到 DSH 宿主错误的映射由 Adapter 侧（PR-9）给出，
   本文件只固定「不新增客户端错误类型」。
3. **空提交信号登记**：若 G2 决定把它写进 §2.10 存储信号表，需在 PR-5 的表形 PR 中同批登记（保持 P-03 区分）。
