# 非作者 G1 冻结复核 — 席位意见原文与处置记录（2026-11-03）

> 用途：§0bis「固定收尾门禁」要求的一次独立复核。本文件归档**复核席原文**与**逐项处置**，
> 使冻结门禁的依据不只依赖作者结项摘要（外部审查 2026-11-03 的程序性要求）。
> 席位：独立子代理，独立 detached worktree（`.scratch/wt-g1freeze` @ `71fa972`；复验 `.scratch/wt-g1freeze2` @ `4e30c18`），
> **未参与实现与文书写作**，未修改任何受复核文件。
> **路由偏差（席位首行自述）**：`SUBAGENT_ROUTING.md` 指定权威审查席模型 `qiyuan-inter/glm-5.3` 本期不可用
> （在册仅 `gpt-6-astra`；`qiyuan-self` 仅 `qwen3.8-27b`），实际由 `qiyuan-inter/gpt-6-astra` 执行。
> **时效声明**：本文件是**当时**的席位结论与处置。此后外部端点审查（2026-11-03，基于 `01db6f6`）指出
> P-NS 迁移形态本身违反版本治理（讨论见 `preflight/ns/VERDICT.md` §0 与结项报告 §1.1），
> 相应修正**取代**了本文件 §3 中「P-NS 无阻塞」的适用范围——本文件不因此被改写，作为历史记录保留。

## 1. 第一轮（被复核提交 `71fa972`）：**阻塞**

### 1.1 总判定（原文）

> **阻塞（列 BLOCKER）**
>
> 发现两项阻塞性问题：P-NS 报告证据锚与实跑提交不一致，且 P-NS-2 的「负例」实际是正向隔离证据；T-SEC 未同步全部高位冻结验收面，仍有首版「逐字节同形」硬门禁残留。因此不能据此无条件冻结 G1 或授权 G2 乙类开工。

### 1.2 逐项结论（原文，节选表格）

| 项 | 判定 | 关键证据 |
|---|---|---|
| P-NS 总体执行 | PASS（但证据报告需修） | `node …/preflight/ns/run.mjs` exit 0；`PASS P-NS-1`…`PASS P-NS-5`、`判定：PASS_STABLE_NS` |
| P-NS-2 负例是否真正打破保证 | **BLOCKER** | `run.mjs:279-280`「负例：两库独立，A 的升级未波及 B」正是目标保证的正例 |
| P-NS-4 是否严格验证 exit 9 | 需修 | `run.mjs:344-350`、`:371-380` 仅检查 stdout/后态，未断言 `child.status === 9` |
| P-NS VERDICT 输入锚 | **BLOCKER** | `VERDICT.md:48` 写 `HEAD=7b3315a`；实跑输出 `HEAD=71fa972`，与被复核提交不一致 |
| P-EXT 测试 ID 与语义 | PASS | 五个指定测试文件均存在；实跑 3 files/16 tests、2 files/15 tests 全绿 |
| T-SEC 七项逐项对账 | PASS（文档完整性基本成立） | DELTA §2.1–§2.6 覆盖 SP-07、RPT-09/10、SCR-54、G1-READ-02、D1-c/d、PR-3/PR-9 |
| 三处契约加注是否只改适用域 | PASS | `git diff 7b3315a..71fa972` 仅新增适用范围文字，五类对象/H/S/R/事件名未改动 |
| 高位契约/矩阵是否同步 | **BLOCKER** | `G1-FREEZE-CRITERIA.md:151`、`G1-ACCEPTANCE-MATRIX.md:146` 仍把逐字节同形作首版门 |
| 冻结面范围 | PASS | 7 文件全在 `experiments/**` |
| 提交/授权表述 | PASS | commit body 明确「不代表 G1 冻结或 G2 乙类开工已获授权」 |
| `--self-test` / `--require-clear` | PASS | 均 exit 0；31/31；27 项 A20 done / B7 open / 违规 0 |
| PR-8 分流 / PR-10 条件化 | PASS（计划层） | PLAN `:505-507`、`:190`、`:565-567` |

### 1.3 建议（原文）

> 6. 在 P-NS VERDICT 中将「负例」分为「机制负例」与「隔离对照」，避免把隔离正例写成打破保证的负例。
> 7. 对 `G1-ADJUDICATION-TABLE.md` 中 SCR-54、D1-c/d 的历史条款补充明确的 P-T/P-A 适用域指针，减少高位文档与计划卡之间再次出现口径分裂。

## 2. 第二轮聚焦复验（修复提交 `4e30c18`）：**无阻塞，可进入结项**

### 2.1 总判定（原文）

> **无阻塞，可进入结项**
>
> - PASS — BLOCKER-A 证据锚：亲跑 `run.mjs` exit 0；输出 `HEAD=4e30c18…（工作树 src 面 干净；HEAD 不承担锚职责，判据以 src sha256 为准）`。链条自洽。
> - PASS — BLOCKER-A2 P-NS-2 负例：亲跑输出含「负例：按库误盖 B 的 3 行 ⇒ B 读面 SCHEMA_INCOMPATIBLE」；`run.mjs:279-291` 确实按库误盖并验证 fail-loud。
> - PASS — BLOCKER-B 高位验收面同步：`git diff 71fa972..4e30c18` 两处均为适用范围加注；原条款与 T-P7/T-N11/MUT-5 夹具未删除；DELTA `:84-88` 五处登记齐。
> - PASS — 崩溃退出断言：`run.mjs:358` `child.status !== 9`、`:386` `childBad.status !== 9`。
> - PASS — 冻结面与门禁：diff 5 文件全在 `experiments/**`；`--self-test` exit 0（31/31）；`--require-clear` exit 0（A20/B7/unowned=0/违规 0）。

## 3. 逐项处置记录（作者侧）

| 席位意见 | 处置 | 落点 |
|---|---|---|
| BLOCKER：P-NS 报告 HEAD 锚与实跑不一致 | 锚策略改为「`src/**` sha256 为锚，HEAD 只报运行时刻指向并带 dirty 标记」；报告换用修复后逐字输出（连跑 2 次 exit 0） | `preflight/ns/run.mjs`（输入锚段）、`preflight/ns/VERDICT.md` §3 |
| BLOCKER：P-NS-2 负例实为正例 | 换成真负例：按库误盖另一空间的历史行版本 ⇒ 该空间历史不可解释 | `run.mjs` P-NS-2 负例段；后被外部审查进一步修正为「物理版本单独推进 + 历史行不动」（v2，见 §4） |
| BLOCKER：T-SEC 未同步两处高位门禁 | `G1-FREEZE-CRITERIA.md`（G1-READ-02 退出判据）与 `G1-ACCEPTANCE-MATRIX.md`（EA-7.4/T-P7）加行内适用范围注，原条款与夹具不删、重挂 P-A | 两文件 + DELTA §3 登记（五处） |
| 需修：崩溃子进程未断言 exit 9 | 显式断言 `child.status !== 9` / `childBad.status !== 9` 抛错 | `run.mjs` P-NS-4 |
| 需修：连跑 2 次声明缺证据 | 提供两次运行（run#1/run#2 均 exit 0）并在 VERDICT §3 声明 | `preflight/ns/VERDICT.md` §3 |
| 建议 6：负例分为「机制负例/隔离对照」 | 采纳：VERDICT 加「负例性质说明」段，逐项标真负例 | `VERDICT.md` §1 负例表 |
| 建议 7：裁决账 SC-54/D1-c/d 加 P-T/P-A 指针 | **不采纳**（判据史文档不复写适用范围，避免三处口径分裂） | 理由登记 `G1-TRUSTED-PROFILE-DELTA.md §5` |

## 4. 外部审查后的后续修正（本文件归档后发生）

外部端点审查（2026-11-03，基于 `01db6f6`）指出：§3 中「按库误盖版本戳」的 P-NS 实现**本身就是**违反
`G1-UNIFIED-CONTRACTS.md §3.3/§3.4` 的形态（迁移器不得回填 `contract_version`）。修正后：

- P-NS 迁移改为「物理层 `storage_schema_version` 单独推进 + 历史行 `contract_version` 一字不动 +
  版本化解释器派发 + 缺解释器 `UNINTERPRETED_FAIL_CLOSED`」；
- 「批量改版本戳」降为**负例**（实测使历史不可解释）；
- 换库/WAL 崩溃窗口验收明确划归 PR-5。

因此本文件 §2 的「无阻塞」只覆盖 `4e30c18` 上的**证据链与文书同步**；P-NS 迁移形态的最终判据见
`preflight/ns/VERDICT.md`（v2）。

---

## 5. R4 定向复验（2026-11-03，对 `36501d2` 的 P0 修订）

**范围**：仅 R3 影响的机制链与正式放行门（JC-1/CS/IDC、`preflight/tx`、PR-6b/PR-10 边界、实施基线、清单归属）。
**方式**：独立 worktree（detached @ `36501d2`），复跑门禁 + 读码 + **自写反例**（不采信作者摘要）。
**路由偏差**：指定 `qiyuan-inter/glm-5.3` 不可用，本轮由 `deepseek-v4.1-flash-1017` 执行（同 R1 记录）。

### 5.1 判定原文（要点）

> **P0 本体已修（真实 SQLite 上时序可实现、旧序被否证），但仍有阻塞，不可结项：2×P1 + 4×P2。**

复跑：`preflight/tx` exit 0、`preflight/ns` exit 0、`--self-test` 31/31 exit 0、`--require-clear` exit 0（27 项/违规 0）。

读码确认（非摘要）：顺序为「判定 → 只推进 `meta` 水位 → `effect` → 取真实 `after.hi` → INSERT 提交账 → INSERT 回执」；
回执 `resultRef`/`snapshot` 取本次 `effect` 返回；无「先落账 + 事后 UPDATE」放行路径。

### 5.2 复核席自写反例（原文）

| 反例 | 构造 | 结果 |
| --- | --- | --- |
| CE-1 | 提交账/回执已 INSERT 之后抛错 | **未成立**：四者同灭、号复用 c=1 |
| CE-2 | 旧序占位区间 → 执行 → 对齐真实区间 | **未成立**：撞 `HISTORY_IMMUTABLE`，零残留 |
| CE-3 | 同事务跨 capability 两写 | **未成立**：区间连续、首尾相接 |
| CE-4 | 首次 v1 → revise v2 → 重放首请求 | **未成立**：仍回 `{"revision":1}` |
| **CE-5** | `delete from idempotency_receipt` | **成立**：`NO_REFUSAL`，行数 4→3 ⇒ 夹具缺 DELETE 守卫 |

### 5.3 处置（逐项）

| 编号 | 严重度 | 内容 | 处置 |
| --- | --- | --- | --- |
| P1-1 | 阻塞 | `G2-IMPLEMENTATION-ENTRY.md`（自述唯一入口）行 3 仍写旧七步、行 11 仍写「三步同一条原子事务」 | **已改**：行 3 = 八步（发号不落账）；行 11 = A/B 两保证（报告独立原子提交）；行 24 步号 4→6 |
| P1-2 | 阻塞 | 回执缺 DELETE 守卫，TX-3 只断言 3 条（CE-5 成立） | **已改**：补 `idem_receipt_no_delete`；TX-3 增第四条断言（四条全拒） |
| P2-1 | 提示 | TX-2 标题称「提交账已插入后」但注入点在 `effect` 内 | **已改**：改为三注入点（领域写后 / 提交账后 / 回执后），快照五项逐等 |
| P2-2 | 提示 | 回执 c1 未真读提交账；`commitRecordedAtMs` 硬编码 | **已改**：回执 `commitSequence`/`recordedAtMs` **读自刚插入的 `commit_record` 行**（读不到即抛错）；时钟取预留点 |
| P2-3 | 提示 | 残留指针：CS-2.5「提交账预留点」、J-1/J-2「第 4 步」、ENTRY「步 4」、MATRIX「七步」 | **已改**：四处就地更新为 P0 后步号/措辞 |
| P2-4 | 提示 | baseline 起点写 `e3e8eb5`（修正前） | **已改**：改为「`e3e8eb5` + 本轮 P0 修正 `36501d2`；实际开工 base = #49 合并后 tip」 |

**结论**：P0 无遗留；2×P1 已按复核席的最小修复方向改完；4×P2 一并处理。修复后待 R5 复验。
