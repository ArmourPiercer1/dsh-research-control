# 结项报告 — §0bis 三项收口 + 非作者 G1 冻结复核（2026-11-03）

> 授权与判据：`g1/G2-DEV-PLAN.md §0bis`（外部审查 `ddbe50b`/`7d016cc` 引入，现行）＋其「固定收尾门禁」
> 分支：`g1/contracts-20261031`｜首版 `4e30c18`（父 `71fa972`）；**2026-11-03 外部审查 P1 后已按 §7 修订**｜PR #49 仍为 **Draft**
> 性质：甲类（实验 + 文书）。**本报告是「申请冻结」的证据包，不是冻结决定，也不是乙类开工许可。**

## 0. 一句话

三项全部收口：P-NS = **PASS_STABLE_NS**、P-EXT = **PASS_EXTENSION_SEAM**、T-SEC = 五处适用域对账完成；
非作者独立复核席复验 **无阻塞**；门禁 `--self-test` 31/31、`--require-clear` exit 0、`g0-gate` PASS。
**G1 冻结与 G2 乙类开工仍待用户授权**（门禁绿只是申请判据）。

## 1. 三项判定

### 1.1 P-NS（稳定物理命名空间 vs 通用重定位）

- **裁决：`PASS_STABLE_NS`**（`node …/preflight/ns/run.mjs` **exit 0**，五项全过，同源连跑 2 次），
  但结论分两段（详见 `preflight/ns/VERDICT.md` §0）：
  - **A. 换实现/稳定 ns = 有效支持**：同 `CapabilityID` 换 `PluginID`（拆包/换实现）不需要迁移对象数据，
    旧 ObjectID/RevisionRef、旧事件、旧检查报告按原版本可读，`storage_ns` 与 owner 一字不变（①③⑤ + 常驻测试侧证）。
  - **B. 离线物理升级 = 有效支持（形态已修正）**：迁移只推进**物理层** `storage_schema_version`
    （per space×capability 登记 + 迁移记录），历史行 `contract_version` 与解释结果**一字不动**；
    跨版本读按记录自钉版本派发解释器，缺解释器 ⇒ `UNINTERPRETED_FAIL_CLOSED`（②④）。
- **被否证的形态**：把历史行 `contract_version` 批量改写成新版本（本实验 2026-11-03 之前的实现，即
  「迁移器代盖章」）**不是兼容手段**——在 v1/v2 解释规则真正不同的前提下，它使历史记录**不可解释**
  （负例实测 `UNINTERPRETED_FAIL_CLOSED`）。违反 UNIFIED §3.3（契约层版本、迁移器不得回填）与 §3.4
  （迁移器三不做），**禁止写入正式实现**。
- 每项均有真负例：① 携 ns 移交 ⇒ `TRANSFER_NS_DRIFT`；② 按库批量改历史版本 ⇒ 历史不可解释；
  ③ 缺 v1 解释器 ⇒ 拒读、宽容解释器 ⇒ 静默错值；④ 非事务崩溃 ⇒ 半套登记被来源判据拒
  （`MIGRATION_PROVENANCE_MISSING`）；⑤ 路径键引用拆包后漂移，oid+revision 键不漂移。
- **未覆盖、归 PR-5 硬性验收**（不再作架构必要性 PoC）：换库（rename）与 `-wal`/`-shm` 删除窗口的崩溃注入、
  迁移器幂等与半态检出、迁移记录完整性、迁移期 Kernel 必须关闭。清单见 `preflight/ns/VERDICT.md` §2。
- **分支后果**：PR-8/W8 **DEFERRED**；`ns-relocated` 保持 `planned`、不要求批准；PR-5/PR-7 承接稳定 ns、
  版本化读者/解释器派发与可回滚重启式迁移；PR-10 不再验物理重定位。

### 1.2 P-EXT（独立 Kernel 扩展缝）

- **裁决：`PASS_EXTENSION_SEAM`，范围 = 基础 Capability 机制可扩展**（`preflight/ext/VERDICT.md`）。
- 有效支持三条：新 Capability 可注册并合法装配（只经清单声明，Kernel/其他领域/装配根零改动）；
  能力级存储归属隔离成立（`ns` 归属 + `CAPABILITY_SCOPE_ESCAPE` 负例）；精确引用与基础跨域事务可用
  （同事务内跨两能力落笔，Q40）。本 HEAD 复跑引用面 7 files/52 tests 全绿。
- **未证明（2026-11-03 外部审查 P1 修正）**：G2 目标要求「Application 不再以物理写入（`tx.revise()`）
  改领域数据」，而跨能力正例**正是**用通用事务写面落笔 ⇒「具名命令端口架构下的跨域扩展」**未验证**，
  不能由 P-EXT 关闭；验收挂 **PR-11（判据面）+ PR-6b（实施切片）**：两个不同领域的具名命令 Port
  在同一事务内合法写入 + Kernel 零领域分支 + `arch-independence` 常驻绿。无 `EXTENSION_SEAM_GAP`。

### 1.3 T-SEC（可信部署边界）

- 文档：`g1/G1-TRUSTED-PROFILE-DELTA.md`。**P-T（可信首版，默认）** 保留：正常授权、Space 隔离、
  数据不越界、WITHHELD/UNKNOWN 不得变科学断言、普通越权拒绝、检查报告完整性（字段级同形、零
  `hiddenBy*`、计数只进审计面）。**P-A（敌对 Profile，可选）**：响应恒时、恶意枚举逐字节等、隐含计数
  侧信道穷尽证明——不作首版单独放行门。
- 五处高位适用域加注（原条款与夹具**一字未删**，探针重挂 P-A）：
  `G1-CONTRACT-EVENT-AUTHORITY.md`（echo 面）、`G1-CONTRACT-RECONCILIATION.md`（EA-7.4）、
  `G2-DEV-PLAN.md`（PR-3 退出门禁行）、`G1-FREEZE-CRITERIA.md`（G1-READ-02 退出判据）、
  `G1-ACCEPTANCE-MATRIX.md`（EA-7.4/T-P7 判据）。
- **两层权限不可混用**（2026-11-03 外部审查 P1 修正）：**开发批准**（G1 冻结 + G2 乙类开工）由用户以项目
  所有者身份授予；**正式科研采纳权**（谁有权把命题定为 `FactDesignation`）是**研究业务权限**，不是开发批准，
  归属按 `G1-REMAINING-USER-DECISIONS.md` 项 4 另行确定（Kernel 不内置采纳者身份），可在业务能力启用前再定；
  G2 只实现不透明权限轴 + 见证 + 未授权声明处理。P-A 加固由未来敌对部署立项负责人 + `Frozen-Face-Review`
  提出，不自动生效；事件名审批不变。

## 2. 非作者 G1 冻结复核（独立席位）

- **席位**：独立子代理，独立 detached worktree（`.scratch/wt-g1freeze` → 后 `.scratch/wt-g1freeze2`），
  未参与实现/文书。**路由偏差**：`SUBAGENT_ROUTING.md` 指定权威审查席模型 `qiyuan-inter/glm-5.3`
  本期不可用（在册仅 `gpt-6-astra`），经 `qiyuan-inter/gpt-6-astra` 执行；复核意见首行已声明偏差。
- **第一轮：阻塞**。2 BLOCKER + 2 需修：① P-NS VERDICT 的 HEAD 锚与实跑不一致；② P-NS-2 的「负例」
  实为正例；③ T-SEC 未同步 `G1-FREEZE-CRITERIA.md`/`G1-ACCEPTANCE-MATRIX.md` 两处高位门禁；
  ④ P-NS-4 未断言崩溃子进程 exit 9。
- **处置**：提交 `4e30c18`——锚策略改为「src sha256 为锚、HEAD 只报运行时刻指向并带 dirty 标记」；
  新增 ② 的真负例；两处高位门禁补 P-T/P-A 适用范围注；崩溃子进程显式断言 `status === 9`。
  建议「在裁决账 SCR-54/D1-c 行加指针」不采纳，理由登记于 DELTA §5。
- **第二轮复验：无阻塞，可进入结项**（逐点 PASS，含亲自复跑 `run.mjs` exit 0、`--self-test` 31/31、
  `--require-clear` exit 0、diff 仅 `experiments/**`）。

## 3. 门禁与证据（提交 `4e30c18`）

| 门禁 | 命令 | 结果 |
|---|---|---|
| G1 清单自验 | `node …/g1-checklist-validate.mjs --self-test` | **exit 0**，`变异自验：31/31 全部捕获` |
| G1 清核 | `node …/g1-checklist-validate.mjs --require-clear` | **exit 0**，`items=27 open=7 done=20 违规=0`；A 层 20/20 done、B 层 7 open 全有 owner |
| P-NS 实验 | `node …/preflight/ns/run.mjs` | **exit 0**，五项 PASS，`PASS_STABLE_NS`（同源连跑 2 次；v2 迁移形态修订后再次连跑 2 次均 exit 0） |
| PoC 全量门 | `node …/g0-gate.mjs` | **PASS**：tsc 0；`tests/**` 225 例全绿（与身份锚四项逐等）；`attacks/**` 与基线完全一致（33 条已定性已知红） |
| P-EXT 引用测试 | `npx vitest run --config … vitest.config.ts <7 files>` | 7 files / 52 tests 全绿（复核席另抽 5 files / 31 tests 全绿） |

说明：`g0-gate` 于 `71fa972` 工作树运行；`4e30c18` 相对它只改 G1 文档与 `preflight/**`，不触及
tsc/tests/attacks 收集面，故结论沿用；复核席在 `4e30c18` 上另跑 `--self-test`/`--require-clear`/`run.mjs` 复核。

**未动面**：8 根冻结文档、`schema/**`、生产 `src/**`、`tests/**`、DDL、事件名封闭集——零改动；
`git diff --stat 7b3315a..4e30c18` 全部位于 `experiments/**`。

## 4. 20 条 A / 7 条 B 复核

- **A 层 20/20 done**：校验器以 `DONE-EVIDENCE` 规则强制「owner 非伪造 + evidence 非幽灵 + resolution 存在」，
  每条 evidence 指向可核契约/测试/提交；抽查（提交 `7b3315a` 的 G1-TIME-01/02、G1-LINK-01、G1-RECON-01）
  均带日期化「让位/收编」注与落点。
- **B 层 7/7 open、owner 齐全**：`G1-OWN-01`、`G1-BIND-03`、`G1-READ-02`、`G1-VER-03`、`G1-STORAGE-01`、
  `G1-STORAGE-02`、`G1-AUDIT-01`。**观察（非阻塞）**：`G1-VER-03` 与 `G1-STORAGE-02` 的 owner 仍列
  PR-8（现已 DEFERRED），但两者同时列 PR-5/PR-7，**不构成孤儿归属**；建议 G2 开工前把 PR-8 从载体列表划掉。
- 结论：B 层「免检完成、不免归属」成立；清零不是冻结前置（`--require-clear` 的 M31-B 正向条已钉住）。

## 5. 仍需用户决定的三件事（本报告不代作决定）

1. **G1 冻结放行**：技术判据已齐（本报告 + 复核意见 + 门禁），但是否冻结由用户签。
2. **G2 乙类开工授权**：P-NS 自动分流只决定 PR-8 去留，不构成开工许可。
3. **PR #49 合并**：仍 Draft；合并时机与范围由用户定（本分支只动 `experiments/**`）。

## 6. 残余风险与未覆盖（如实登记）

- P-NS 只证明 PoC 机制在 H0 形态下可行：未覆盖迁移期多进程并发写、跨 Space 迁移调度、**换库/WAL 崩溃窗口**、
  生产迁移器的运维审计面（全部归 PR-5 硬性验收，清单见 `preflight/ns/VERDICT.md` §2）。
- P-EXT 的边界两条：①「无真实 DSH Adapter」——PR-9 的真实 Adapter 装配冒烟必须按原卡执行；
  ② 具名命令端口的跨域扩展性未验证——挂 PR-11/PR-6b（见 §1.2）。
- P-A 套件（两世界逐字节/恒时/穷尽侧信道）目前只有条款与夹具，**未启用、未实现**，启用条件见 DELTA §4。
- T-SEC 只是适用范围对账；`G1-READ-02` 的呈现落码与检查报告完整性实现仍按 B 层交付归属推进。
- 复核席为单席、模型偏差为 `gpt-6-astra`；对抗式三角色面板未启用（本轮门禁档位为权威审查单席）。

## 7. 外部审查（P1，2026-11-03）处置记录

外部端点审查基于 `01db6f6` 提出 1 项 P1 架构缺陷 + 2 项 P1 一致性问题 + 1 项证据范围问题 + 1 项程序性要求。
本报告与其依赖文档已按下表修订（同一提交）：

| 审查意见 | 处置 | 落点 |
|---|---|---|
| **P1-a**：P-NS 的 `migrateOffline()` 批量改写历史行 `contract_version`，把契约版本当存储版本，违反历史语义不可静默重解释 | **重写实验迁移形态**：物理层 `storage_schema_version` 单独推进（per space×capability 登记 + 迁移记录），历史行一行不动；跨版本读按记录自钉版本派发解释器，缺解释器 `UNINTERPRETED_FAIL_CLOSED`；「批量改版本戳」降为负例并被实测否定；补「v1/v2 解释规则真正不同」的判据测试；换库/WAL 崩溃窗口明确归 PR-5 | `preflight/ns/run.mjs`（全文重写）、`preflight/ns/VERDICT.md`（v2） |
| **P1-b**：PR-8 已 DEFERRED，但权威契约/入口/门禁仍有「首版必需重定位」残留 | ① `G1-UNIFIED-CONTRACTS.md §3.2` 步 4 的**重定位专属三项**（`relocationGapCount`/链终态/见证）按 P-NS 分支条件化；② `G2-DEV-PLAN.md` PR-5 两处「随 PR-8」条件化；③ `G2-IMPLEMENTATION-ENTRY.md` 状态行与 B 层交付表去 PR-8；④ 清单 `G1-VER-03` 改锚 PR-5/PR-7、`G1-STORAGE-02` 去 PR-8。重定位契约文本保留（未来可选能力），不删不重审 | 四处文档 + 清单 |
| **P1-c**：科研采纳权与开发批准被混为一谈 | DELTA §4 拆成两层：开发批准（用户，G1 冻结/G2 开工）vs 正式科研采纳权（研究业务权限，按 `G1-REMAINING-USER-DECISIONS` 项 4 另行确定；G2 只做不透明权限轴） | `g1/G1-TRUSTED-PROFILE-DELTA.md §4` |
| **P1-d**：P-EXT 证据范围被高估（正例仍用 `tx.revise()` 通用写面） | 裁决收窄为「基础 Capability 机制可扩展」；具名命令端口跨域扩展性挂 PR-11/PR-6b 验收 | `preflight/ext/VERDICT.md §1/§4` |
| 程序性：非作者复核原文应归档，不能只靠作者摘要 | 新建席位原文归档（两轮判定逐项 + 路由偏差 + 逐项处置 + 外部审查后的后续修正声明） | `g1/G1-FREEZE-REVIEW-20261103-SEAT.md` |

**结构结论不变**：无需推翻独立 Kernel、Capability 体系或 H/S/R 顶层语义；PR-8 仍 DEFERRED。
**G1 冻结、G2 乙类开工、#48/#49 合并仍待用户授权。**

## 8. 第三轮（R3）集中修订：P0 事务时序 + 五项 P1

外部审查在 `e3e8eb5` 上发现 **P0**：JC-1 旧顺序要求「执行之前」写入未知的事件区间与首次结果
（组合不可实现）。已一次性修订，逐条证据见 **`g1/G2-AUDIT-MATRIX-20261103.md`**：

| 包 | 内容 |
| --- | --- |
| P0 | JC-1 改为唯一可执行八步（预留水位 → 领域写与事件 → 落提交账 → 落回执 → COMMIT）；CS/IDC 同步；`preflight/tx/run.mjs` 真实 SQLite 七项，含「旧顺序必撞 `HISTORY_IMMUTABLE`」反例 |
| P1 | 幂等回放三缺口（中间提交/同键异体/权限撤销）→ IDEM-1/2/3 + 新 **IDC-12**（披露按当前授权） |
| P1 | PR-6b 拆为「跨领域命令原子性」+「检查报告独立原子提交」（可选事务 Port 为显式 API）；PR-10 边界收窄到 G2 机制兼容性 |
| P1 | 新 `g1/G2-IMPLEMENTATION-BASELINE.md`：ResearchSpace 显式绑定（禁推导）、开工 base = #49 合并后 tip（含本轮 P0 修正）、五个 PR SHA、PoC→正式模块映射、CI 投票要求 |
| P2 | `G1-ACCEPTANCE-MATRIX` RL-2.1 行条件化；PR-8 卡头加 DEFERRED 状态行 |

**未覆盖（如实）**：并发同键持锁竞争、kill 9 格矩阵（PR-9 真库夹具）；换库/WAL 崩溃窗口（PR-5 硬性验收）；
CI 触发面调整（第一个实施 PR）；D-1 空间粒度（用户裁决）。
