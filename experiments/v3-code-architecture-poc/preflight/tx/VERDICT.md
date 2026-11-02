# P0 判定：`PASS_TX_ORDER` —— JC-1 事务时序在真实 SQLite 上可实现

> 实验：`experiments/v3-code-architecture-poc/preflight/tx/run.mjs`（固定命令，连跑 2 次 exit 0）
> 触发：外部审查 2026-11-03 P0 —— JC-1 旧顺序要求「执行之前」写入尚不存在的事件区间与首次结果
> 判据契约：`G1-UNIFIED-CONTRACTS.md` JC-1（§2.11）、`G1-CONTRACT-COMMIT-SEQUENCE.md` CS-1.3/CS-2.5、
> `G1-CONTRACT-IDEMPOTENCY.md` IDC-4/IDC-7/IDC-12
> 性质：类甲实验（真实 `node:sqlite` + 真实 PoC Kernel 事务/事件面；`commit_record`/回执为实验侧夹具表，
> 形状按 CS-1.3 / IDC-4；不落生产代码、不改 `src/**`）

## 0. 结论

**旧顺序不可实现，新顺序可实现，且旧顺序已被真实库反例否证。** 契约已按新顺序修订（JC-1 八步、
CS 分配点/持久化位置/与 commit 的先后、IDC 写入时点 + IDC-12）。

| | 旧顺序（被否证） | 新顺序（已落地） |
| --- | --- | --- |
| 发号 | 预留 c1 **并同事务插入 `commit_record(c1, from..to)`** | 预留 c1 **只推 `meta.commit_sequence`**，不落账 |
| 事件区间 | 插入时**未知**，只能占位；事后修正必撞 `HISTORY_IMMUTABLE` | 领域写与事件先落库，区间**取自真实事件** |
| 回执 | 插入时 `resultRef`/`responseSnapshot` **尚不存在**（IDC-4 必填） | 领域执行后写入，c1 读自已插入的 `commit_record` |
| 原子性 | 同事务 | **同事务**（外部不可见中间态） |

## 1. 七项实测（真实 SQLite）

| # | 断言 | 结果 |
| --- | --- | --- |
| TX-1 | 可变事件数量（1 条 / 3 条）下区间逐条真实；水位 = 提交账行数（稠密）；区间总长 = 事件总数（无空洞/重叠） | PASS |
| TX-2 | **三个注入点**（领域写后 / 提交账插入后 / 回执插入后）⇒ 号/账/回执/领域效果同生同灭（五项快照逐等）；下一提交复用同一号（未烧号） | PASS |
| TX-3 | `commit_record` UPDATE/DELETE ⇒ `HISTORY_IMMUTABLE`；回执**改写与删除** ⇒ `IDEMPOTENCY_RECEIPT_IMMUTABLE`（四条断言） | PASS |
| TX-4（负例） | 按旧顺序插占位区间 → 执行后想对齐真实区间 ⇒ 必撞 `HISTORY_IMMUTABLE`，事务回滚零残留 | PASS（旧顺序被否证） |
| IDEM-1 | 首次提交 c1 后插入其他提交，再重放首次请求 ⇒ 返回 **c1**（不随 head），响应逐字节等 | PASS |
| IDEM-2 | 同键异体 ⇒ `IDEMPOTENCY_KEY_REUSED`，零新提交/零新事件，既有回执不改写 | PASS |
| IDEM-3 | 撤写权 ⇒ `NO_SPACE_WRITE`（UoW 守卫更早）；仅撤读权 ⇒ `AUTHORITY_REQUIRED`（零新领域效果，detail 无结果引用）；恢复 ⇒ 正常重放 | PASS |

## 2. 对契约的修订（同步落点）

1. **JC-1**（`G1-UNIFIED-CONTRACTS.md`）：原第 3 步拆为「发号（预留，不落账）」与「落提交账（区间取自真实事件）」；
   领域写与事件前移；回执写入明确在提交账之后；新增「为什么不是先落账」的组合可实现性说明。
2. **CS**（`G1-CONTRACT-COMMIT-SEQUENCE.md`）：分配点只推水位；持久化位置标注两处同事务但时点不同；
   「与 commit 的先后」改为「预留水位 → 领域写与事件 → 落提交账 → COMMIT」。
3. **IDC**（`G1-CONTRACT-IDEMPOTENCY.md`）：回执写入时点写明（结果存在之后、`commit_record` 之后）；
   新增 **IDC-12**（重放披露按当前授权；不重执行历史前置；`NO_SPACE_WRITE` 与 `AUTHORITY_REQUIRED`
   是两级不同守卫，不得混记）。

**取值通道与时钟（复核后补强）**：回执的 `commitSequence`/`recordedAtMs` **读自刚插入的 `commit_record` 行**
（不是局部变量直传；读不到即抛错），`commitRecordedAtMs` 取**预留点**时钟而非硬编码——这两点让
「c1 读自提交账」与「一事务一枚登记时钟」成为可判据事实而非注释。

## 3. 幂等回放的三处缺口（旧夹具未覆盖）

旧 `prex` 夹具只测「连续两次重放 + 比 `resultJson`」，因此 40/40 PASS 不覆盖：

| 场景 | 旧实现/契约缺口 | 现在 |
| --- | --- | --- |
| 中间插入其他提交后重放 | 回放包装用当前 `headCommit`，可能返回后来的截点 | IDEM-1 钉住「永远返回首次 c1」 |
| 同键异体 | 构键不含请求体摘要比对 | IDEM-2 钉住拒绝 + 零任何记录 |
| 权限撤销后重放 | 任何业务守卫之前返回缓存 | IDEM-3 + IDC-12：零新领域效果，披露按当前授权 |

## 3bis. 错误载体（2026-11-03 错误模型对账后）

| 信号 | 对外载体 | 说明 |
| --- | --- | --- |
| 回放披露拒绝 | **`AUTHORITY_REQUIRED`**（真实 Kernel `Refusal`） | detail 仅 `{reason:"replay-disclosure", operation}`，**不含** `resultRef`/oid/响应字节 |
| 同键异体 | **`TOOL_INPUT` + `detail.serviceCode="IDEMPOTENCY_KEY_REUSED"`** | 接口层载体；`IDEMPOTENCY_KEY_REUSED` 不是 `RefusalCode` 成员 |
| 空提交区间 | **内部存储信号**（`COMMIT_RECORD_EMPTY` 文本） | 非对外码；对外只表现为事务回滚 |
| 无写权 | `NO_SPACE_WRITE`（既有码） | 比披露判定更早的 UoW 守卫 |

归类依据见 `g1/G1-ERROR-MODEL-RECONCILIATION.md`；封闭集净扩张 = 0。

## 4. 诚实边界

- 夹具表（`commit_record`/`idempotency_receipt`）是**实验侧**实现，形状按契约；生产 DDL 归 G2（PR-5）。
- **TX-1 的两个写在同一 Capability（`test.claim`）**：它证明「一个事务内可变事件数 + 区间真实 + 稠密」，
  **不**证明两个不同领域的具名命令可共享事务——后者的判据已写入 PR-6b 保证 A（2026-11-03 P2-1 加严），
  由 PR-6b 在正式 `tests/**` 验，不在本实验冒充。
- 未覆盖：并发同键的持锁窗口竞争（IDC-7 已有 MUT-IDEM-2 设计，需真库并发夹具）、进程 kill 的
  9 格崩溃矩阵（IDC-8，归 PR-9 真库对应物）、跨 Space（无共同序，不在本实验范围）。
- 独立复核席（R4）用自写反例在真库上另验了三点：落账后/回执后抛错四者同灭、旧序必撞
  `HISTORY_IMMUTABLE`、跨 capability 同事务区间连续；并指出「回执 DELETE 未被守住」——已补
  `idem_receipt_no_delete` 触发器与第四条断言（本轮修复项）。
- 本实验不证明「生产迁移器/幂等层已完成」，只证明**契约顺序可执行**且旧顺序不可执行。
