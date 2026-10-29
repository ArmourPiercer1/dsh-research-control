# RE-REVIEW-G0-B — 独立复验席位 B（D-15 修法攻击 + 门禁完整性 + 文档核对）

- 工作目录 `/home/user/dsh-plugins/dsh-research-control`，分支 `poc/v3-code-arch-20261030`。
- 任务开始时 HEAD = `fa9c2d0352ce7d256871bb267360a53475935293`（与前置条件一致 ✓）。其后作者继续提交（0fba915 → ccc1449 → de82ed3），属预期；**G0 各项判定以提交号为准**：D-15=`11b4bf6`，D-16/17=`1c95d5e`，D-7=`fa9c2d0`。
- 纪律执行：只读（未修改 `src/**`、`tests/**`、根目录交付文档）；产物 = 本报告 + 临时攻击测试 `attacks/review/re-review-g0b-attacks.test.ts`（在 tsconfig include 之外，16 例，已列出）。未用仓库级/目录级 `git checkout --`/`git stash`；全量实测在独立 worktree `.scratch/wt-b` 完成（已删除）。
- 范围外（依协调指令不下结论）：E-00/E-01（`eventsOf` 作用域 + `CROSS_EVENT_READ` 授权表 + 存在性 oracle 登记）。本席攻击面不使用跨命名空间 `eventsOf`。

## 结论

1. **D-15 修法对其触发面（边视图未交）有效**：`registeredEdges === undefined` ⇒ `SYNTH_EDGES_UNAVAILABLE`（INDETERMINATE）；`synthReduce` 归约 FAIL > INDETERMINATE > ACHIEVED，且 `run()` 先把 PASS 滤掉再归约（`test-records.ts:138,142`）。INDETERMINATE 真能挡住 ACHIEVED——"一条 INDETERMINATE + 三条 PASS ⇒ INDETERMINATE"（直接调用）、端到端混合实例、呈现层（审计/非审计读者均见 INDETERMINATE，不洗白）全部实测成立。作者"可区分"主张在报告级**成立**：未交 ⇒ INDETERMINATE + finding；交而空 ⇒ ACHIEVED + 零信号；两条报告在所有路径上可区分（实测）。
2. **新发现 4 条，均 P2，无新 P0/P1**：
   - **N-1**：恒空视图 + 库内真实 USED_IN 边 ⇒ 仍 ACHIEVED+COMPLETE、零信号（复现 D-15 原始症状）。作者测试 3 所 bless 的"交而空 ⇒ ACHIEVED"是**有条件的**（条件 = 装配根交出完整且真实的视图），该条件在当前机制内**不可验证**——当前依赖装配纪律，无机制保证。
   - **N-2**：检测面是单一字面量。role 拼写变体（`used_in`/`USED_IN_`/`Used_In`/`" USED_IN"`）全部漏检；payload 字段别名（`operatingContext`）/嵌套（`context.operating`）不仅漏检，**连 INDETERMINATE 负信号都不触发**。`CONTRACTS.md:274`「双正源违规可检测」是无限定主张——**主张比实现强**。
   - **N-3**：抛异常/异步视图 ⇒ 整个 `run()` 抛错、不落报告、无 INDETERMINATE 降级（方向安全、无假通过，但与机制自身"不可用 ⇒ INDETERMINATE"哲学不一致；类型层只能在类型检查过的装配点挡异步视图）。
   - **N-4**（文档）：`READINESS.md` 没有 D-15 行，且**从未有过**（`git log -S "D-15"` 空）；P1 修复仅登记在 REVIEW §27.1 / EVIDENCE / 提交信息。作者已承认登记缺口。
3. **门禁完整性：未发现为变绿而放宽任何判据**（`git diff 11b4bf6~1..fa9c2d0 -- tests/ KERNEL_SURFACE.sha256` 逐条裁定见下）。DECLARED 删 k/raw 是纠错+收紧；escapes/leaks 断言从"钉漏洞"翻正为真判据（收紧）；sql-guard 取句柄路径改写**等价**（新旧路径取自同一 `guard(adapter)` 包装的同一 RawTx，源码级证据）；面哈希两跳（da5d3d2f→f3f3a0fa→a3e4b168）**均为收紧**（同 4 文件内容变更；+internal.ts 第 5 文件入面）。
4. **g0-gate.mjs + BASELINE.json（ccc1449 新增）三问皆过**：无静默豁免口子（失败集合严格相等，rename/skip/split 都产生 added/gone ⇒ 红）；退出码不稀释（三条流独立、tests/** 0 红是硬条件；实测 PASS exit 0 @ccc1449）；基线生成环境干净（wt-g0base detached@0fba915；0fba915 实测失败集合与 31 条基线 0/0 差；167/31 精确复现）。**基线在当前代码 tip 上尚未过期**（ccc1449 的 WeakMap 改动未移动失败集合——协调方预期的漂移未出现，按实测报告）。
5. **文档核对**：EVIDENCE 末节 168/24（@8892091）与 167/31（@0fba915）**均精确复现**；READINESS D-7/16/17 三行在且与实现一致，D-15 行缺失（N-4）；REVIEW §27/§28 与 diff 及实测一致（过程记录类除外）。
6. **规定复跑**：`npx tsc -p experiments/v3-code-architecture-poc/tsconfig.json` ⇒ 0 诊断（exit 0）；`npx vitest run --config … experiments/v3-code-architecture-poc/tests/` ⇒ **15 文件 95 例全绿**。全量（worktree @0fba915）：198 总 / 167 过 / 31 红 / 38 文件。

## 攻击矩阵

攻击测试：`attacks/review/re-review-g0b-attacks.test.ts`（16 例全过，断言均为实测行为；命令见附录）。

| # | 攻击 | 构造 | 实测报告结论 | 判定 |
|---|------|------|----------------|------|
| A1 | 基线：未交边视图 | `hostEdges = undefined`，双正源对象（payload 有 `operating_context` + 真实 `USED_IN` 边） | `SYNTH_EDGES_UNAVAILABLE`，verdict=**INDETERMINATE**，coverage=COMPLETE | 修复成立 ✓ |
| A2 | 恒空视图 + DB 真实 USED_IN 边 | `hostEdges = () => []`；先查库确认边真实存在；真实视图同数据对照 = NOT_ACHIEVED | **零信号，verdict=ACHIEVED，coverage=COMPLETE** | 残留假通过 → N-1 |
| A3 | A1 vs A2 报告可区分性 | 对比两条报告 | INDETERMINATE+finding vs ACHIEVED+零信号，**可区分** | 作者主张成立（报告级）✓ |
| A4 | 抛异常视图 | `() => { throw new Error('view down') }` | `run()` 抛 'view down'；`check_report` 行数前后不变（**不落报告**） | 无假通过、无降级 → N-3 |
| A5 | 视图运行时返回 undefined | JS 注入（cast） | 退化为"未交"：SYNTH_EDGES_UNAVAILABLE，INDETERMINATE | 安全方向 ✓ |
| A6 | 异步视图 | `async () => []`（JS 注入） | TypeError（Promise 无 includes），`run()` 抛 | 类型层挡 TS 装配点（静态）；运行时安全方向崩溃 → N-3 |
| A7 | role=`used_in`（小写） | 真实边、真实视图 | 无 SYNTH_DUAL_SOURCE，**ACHIEVED+COMPLETE**（DB role 原样=`used_in`） | 绕过检测 → N-2 |
| A8 | role=`USED_IN_` / `Used_In` / `" USED_IN"` | 同上，3 变体 | 同上（均 ACHIEVED+COMPLETE） | 绕过检测 → N-2 |
| A9 | payload.`operatingContext` + 未交视图 | 别名顶层键 | **零 findings**（连 INDETERMINATE 都不出），ACHIEVED+COMPLETE | 触发面=单一键名 → N-2 |
| A10 | payload.`context.operating`（嵌套）+ 真实视图 | 嵌套改写 | 零信号，ACHIEVED+COMPLETE | 同上 → N-2 |
| A11 | 一条 INDETERMINATE + 三条 PASS | 直接 `synthReduce` | 'INDETERMINATE'（PASS 不洗白） | 归约方向正确 ✓ |
| A12 | FAIL + INDETERMINATE + PASS | 直接 + 端到端（缺 text 且未交视图） | 'NOT_ACHIEVED'（FAIL 优先，RPT-02 顺序成立） | ✓ |
| A13 | 端到端 2×INDETERMINATE（withheld + edges） | `optionalField={UNRESOLVED, withheld}` + 未交视图 | verdict=INDETERMINATE，coverage=INCOMPLETE_DUE_TO_VISIBILITY | ✓ |
| A14 | 呈现层 | `presentReport`（'bob' / 'auditor'） | 均 verdict='INDETERMINATE' | 不洗白 ✓ |

注：当前 checker 只推负 finding（无 outcome=PASS 的 finding），`run()` 又滤 PASS（`test-records.ts:138`）。故"一条 INDETERMINATE + 若干 PASS"只存在于直接 reducer 调用（A11）；端到端归约轴上只见非 PASS 项。两条路径归约方向一致。

## 新发现

### N-1（P2）：恒空视图复现 D-15 原始症状（残留假通过）

- 复现：攻击文件 B-1b（附录命令，16/16 全过）。对象 payload 含 `operating_context`，DB 中**真实存在** `USED_IN` 边（`select role from ref_edge` 预确认）；装配根交 `() => []` ⇒ 报告 `verdict=ACHIEVED, coverage=COMPLETE, findings=[]`。对照：同一数据接真实视图 ⇒ `SYNTH_DUAL_SOURCE, NOT_ACHIEVED`。
- 定性（按要求写到底）：**作者测试 3 所 bless 的"交而空 ⇒ ACHIEVED"是有条件的——条件是装配根交出完整且真实的视图，而该条件在当前机制内不可验证；当前依赖装配纪律，无机制保证。** 机制把视图内容当给定输入消费（与 `hostSnapshot` 同类受信任输入边界），无法区分"视图为空"与"视图是桩"。
- 为何不升回 P1：D-15 自身触发面（undefined 缺省）已封；"未交"与"交而空"在所有路径上报告级可区分（A3 实测）——读者能区分两者；残留路径要求装配根**显式**交出（错误的）空视图，即触发位于机制可验证面之外。与 D-15 同一失败类，但不是其回归。
- 建议：在 READINESS 登记该残留（与 N-4 的 D-15 行一并）；中期给视图加 provenance（装配根盖章 viewId/来源 ns），或在装配根门禁"空视图案例必须归因"。

### N-2（P2）：检测面=单一字面量——主张比实现强

- 实测（A7–A10）：`edges.includes('USED_IN')` 精确、大小写敏感（`test-validation.ts:60`）；`used_in`、`USED_IN_`、`Used_In`、`" USED_IN"` 全部漏检 ⇒ 双正源违规真实存在却报 ACHIEVED+COMPLETE。kernel `linkRef` 把 role **原样入库、无规范化**（静态：`kernel.ts:695–704` @fa9c2d0，702 行 `a.role, a.required ? 1 : 0,` 直接入 `ref_edge.role`；role 参数是自由 `string`，`kernel.ts:206`）。
- 字段别名（A9/A10）：触发面是单一键名 `p.operating_context`（`test-validation.ts:52`）；payload 对 kernel 是 `unknown` 不透明载荷（`validation-contract.ts:18`），领域按自由 `Record<string, unknown>` 收。`operatingContext` 或 `context.operating` ⇒ **不仅不检，连 D-15 的 INDETERMINATE 负信号都不触发**（该守卫也绑键名）。
- 主张出处：`CONTRACTS.md:274` `| D-15 | 双正源违规可检测 | … |` —— 无限定措辞。
- 定性：非代码 bug，是**主张强度问题**——S-7/S-8 的"可检测性"只在约定拼写/字段名下成立，文档未带该约定，读者会把 D-15 行读成无条件能力声明。
- 合格的限定表述（建议替换 CONTRACTS.md:274 的"可检测性"格）：
  > 在"已注册关联边 role 拼写恰为 `USED_IN`（大小写敏感，无前缀/后缀/空白变体）且 payload 中事实字段恰为顶层键 `operating_context`"的声明下，双正源违规可检测（XC-28/SYNTH_DUAL_SOURCE）。role 拼写变体与字段别名/嵌套改写在当前检测面之外（kernel 不对 role 规范化：`kernel.ts:695` @fa9c2d0；payload 为不透明载荷：`validation-contract.ts:18`），会静默报 ACHIEVED+COMPLETE；边视图未交时，别名字段连 INDETERMINATE 负信号都不产生。

### N-3（P2）：异常视图使整个校验崩溃、无报告、无降级

- 实测（A4/A6）：抛异常视图 ⇒ `run()` 抛、`check_report` 无新增行；异步视图（运行时注入）⇒ checker 内 TypeError。方向安全（无假通过），但与机制自身"不可用 ⇒ INDETERMINATE"哲学不一致：校验器离线走 `CHECKER_UNAVAILABLE` 落报告行（`test-records.ts:128–132`），视图故障却以未捕获异常呈现——调用方看不到报告行，只看到进程错误。
- 类型层：异步视图在 TS 装配点是编译错误（签名 `(oid) => readonly string[]`）；运行时返回 undefined 的视图退化为"未交"（安全方向，A5）。`as unknown as` 注入路径**不被** domains 门禁覆盖——FORBIDDEN 源码扫描只扫 `src/domains`（`arch-independence.test.ts:180–198`），装配根/harness 不在扫描面（静态）。
- 建议：`this.hostEdges(oid)` 调用包 try/catch，异常时产出 INDETERMINATE finding（reason=view 故障），与 CHECKER_UNAVAILABLE 同族。

### N-4（P2，文档）：READINESS.md 无 D-15 行

- `grep -n "D-15" READINESS.md` exit 1（工作树与 fa9c2d0 版本均无）；`git log --oneline -S "D-15" -- …/READINESS.md` 空 ⇒ 从未登记。P1 修复目前只在 REVIEW §27.1、EVIDENCE、提交信息里。D-7（行 60）/D-16（行 115）/D-17（行 114）行俱在。作者已承认，将补。

## 对作者改动与文档主张的逐项裁定

### 提交 11b4bf6（D-15）
- `test-records.ts`（缺省 `() => []` → 可选 undefined）与 `test-validation.ts`（undefined ⇒ SYNTH_EDGES_UNAVAILABLE）改动与自述一致；新增 3 例同形复测成立（A1/A2/A3）。
- 不给 Coverage 加第四值：方向正确——coverage 封闭三值（`validation-contract.ts:39`，S-1 结论），负信号落在驱动 verdict 的 findings 轴；与 RPT-03 一致（实测）。
- 裁定：**修复有效（触发面）**。残留另立 N-1/N-2，不计为修复失效。

### 提交 1c95d5e（D-16/D-17 + 三处门禁改动 + 面哈希 f3f3a0fa）
- **DECLARED 清单删 k/raw：纠错 + 收紧。** 旧清单 13 成员，`.sort()` 后被检的前 8 = [appendLedger, checkRequiredRefs, createObject, declareRecord, **k**, linkRef, principal, **raw**]——等于"要求漏洞必须存在"（D-16 用 `#` 私有封洞后不删必红）；新清单 11 成员，前 8 被检 = [appendLedger, checkRequiredRefs, createObject, declareRecord, linkRef, principal, reassignRouteInternal, readLatest]，全部是契约成员。观察（非本轮引入）：`DECLARED.slice(0, 8)` 只查 11 中 8 个，`recordReport`/`revise`/`space` 未被查（`arch-independence.test.ts:235`）——漂移探测覆盖不全，属既有状态。
- **escapes `[false,false,true]`→`[true,true,true]`、leaks `['k','raw']`→`[]`**：从"断言漏洞现状"翻正为真判据（收紧）；复测全绿（95/95）。
- **sql-guard 取句柄路径：等价。** 旧 `(tx as {raw}).raw`，新 `w.kernel[KERNEL_PORT].tx(raw => …)`。UnitOfWorkImpl 的 raw 本就出自同一 `this.#port.tx(raw => new UnitOfWorkImpl(this, principal, raw))`（`kernel.ts:475–476` @fa9c2d0）；`port.tx` 经 `guard(this.adapter)` 包装（`sqlite-port.ts:292,380`）。新旧是**同一 RawTx、同一套判据**；diff 范围未触碰 `sqlite-port.ts`。6 负例（前导注释/多语句/PRAGMA 等）+ 3 正例复测绿。
- **面哈希 da5d3d2f→f3f3a0fa：收紧。** 成员同为 4 文件（`contracts/index.ts` + `kernel/{kernel,projection,read-context}.ts`），仅内容变更（`#` 私有字段化）；与 REVIEW §27.3 主张一致（其"方向证据不是哈希本身"的说明如实）。
- 裁定：**无放宽；三处均收紧或等价**。

### 提交 fa9c2d0（D-7 + 面哈希 a3e4b168）
- `#port` 私有 + `get [KERNEL_PORT]()`（`kernel.ts:233` @fa9c2d0；键由新增 `src/kernel/internal.ts` 导出，模块级 symbol）。变更处数抽查：`projection.ts` KERNEL_PORT 出现 10 次（import 1 + 用法 9 ✓ 自述"9 处"）；`read-context.ts` 2 次（import + 用法 1 ✓）；`kernel.ts` KERNEL_PORT 3 次（import + getter + 注释行）、`#port` 14 次（声明 + getter + 用法 12，提交自述"11 处"，差异在注释/计行口径，方向一致）。
- **面成员 +1**（internal.ts 成为第 5 个被哈希文件）⇒ 收紧。
- 新增机验禁令（domains/contracts 禁 import internal.ts，带变异锚点 + 运行时面断言）复测绿。代价如实（symbol 可 `getOwnPropertySymbols` 枚举、可 import ⇒ 买"边界显式化 + 可门禁性"，非强隔离）——与实现一致，本席不按强隔离口径评判。
- 裁定：**与主张一致，收紧**。

### 提交 8892091（全量 168/24）——复现
- worktree @8892091 全量：`Test Files 9 failed | 28 passed (37); Tests 24 failed | 168 passed (192)` —— 与 EVIDENCE「Test Files 9 failed / 28 passed (37)；168 passed / 24 failed（此前 167/22）」精确一致。新增 2 条红（host-boundary +1 夹具顺 `tx.raw` 洞；r5r8-semantics +1 按修复前 D-15 行为的断言）与基线名逐条对得上（基线含对应条目）。

### 提交 0fba915（全量 167/31）——复现 + 基线完整性
- worktree @0fba915 全量：`TOTAL 198 / passed 167 / failed 31 / files 38` —— 与 EVIDENCE「167 passed / 31 failed（此前 168/24）」一致。
- 31 条失败集合与 BASELINE.json **完全相等**（ADDED 0 / GONE 0）⇒ 基线确实是 0fba915 的完整失败集。
- 新增 7 红归属（checkreport-raw-read +1、r5r8-sql-guard +5、r5r8-semantics +1）与 EVIDENCE 表逐条对上（基线含对应名，如「S-5 check_report 原始读旁路…」「S-0A：…（机制面 kernel.port.read）」×4、「【漏洞探针】…CTE-UPDATE 成功」等）。

### ccc1449（g0-gate.mjs + BASELINE.json + WeakMap 修复）——实测
- **基线出处**：`generated_from_commit: 0fba915`；两文件由 ccc1449 提交（生成后隔一个提交入库，出处缝隙，无害——见下）；`.scratch/wt-g0base` HEAD = `0fba9157ab…`（detached，与生成声明一致）；`ccc1449..de82ed3` 内两文件未再变。
- **门禁行为**：`node g0-gate.mjs` @ccc1449 ⇒ [1/3] tsc OK；[2/3] tests/** **95 例全绿**；[3/3]「与基线完全一致（31 条已知红）」⇒ **PASS，exit 0**。
- **Q1 静默豁免口子**：失败标识 = `文件路径 > vitest fullName`，严格集合相等。改名（旧名 gone + 新名 added）、`describe.skip`（gone）、split（1 gone + 2 added）都使 added/gone 非空 ⇒ 红。**无静默豁免口**。固有限制（静态推断，未构造实证）：「同名同题但断言被弱化」检测不到（按名标识）；若审查方自己弱化其红条，门禁同样看不到——风险低（文件归审查方，作者声明不改）。
- **Q2 退出码稀释**：三条流独立，任一不合 ⇒ exit 1；tests/** 0 红是硬条件且不与基线流混算；PASS 输出自带免责（「不代表产品通过」）。**无稀释**（实测 exit 0 对应真实三流通过）。
- **Q3 生成环境**：端态验证通过（detached@0fba915 + 集合 0/0 + 计数 167/31 一致）；生成时刻的并发写入状态不可回溯证明，但"生成时若有并发写入 ⇒ 集合偏离纯净 0fba915 集"而实测恰好相等，构成干净生成的间接佐证。
- **基线未过期**：ccc1449 的 WeakMap 改动未移动失败集合（gate @ccc1449 PASS 是直接证据）⇒ 当前代码 tip 上基线仍有效（协调方预期的漂移未出现，按实测报告）；de82ed3 为纯文档提交（REVIEW.md +20）⇒ 分支 tip de82ed3 上门禁结论仍成立（静态：无代码 diff）。

### 文档逐项（EVIDENCE / READINESS / REVIEW）
- EVIDENCE 末节：168/24 ✓ 复现；167/31 ✓ 复现（含 7 红归属表逐条）。166/22 @dd3e740（第 31 轮）、167/22（第 32 轮追加）**未复测**（不在 G0 判定线，见"未能验证"）。
- READINESS：D-7（行 60）/D-16（行 115）/D-17（行 114）行在，内容与实现及实测一致（`#` 私有字段、`peekRaw` 静态回读、symbol 通道与代价陈述均成立）；**D-15 行缺失（N-4）**。
- REVIEW §27：§27.1 与 diff 一致；§27.2「两处测试依赖这些洞」（sql-guard 顺洞取句柄 + DECLARED 把 k/raw 列为承诺集）与 diff 逐条对上；§27.3 面哈希方向主张与本席成员/内容分析一致（收紧）。§28：D-7 改法、symbol 代价、World.raw 有意后门（"生产装配根不得暴露"）与实现一致；变更处数抽查一致（见上）。§28.1 过程记录不可独立验证。

## 未能验证的部分

1. EVIDENCE 第 31 轮 166/22 @dd3e740、第 32 轮追加 167/22——未复测（可随时补 worktree；不在 G0 判定线）。
2. 基线**生成时刻**的状态（生成时 `attacks/**` 无并发写入）——只验证了端态（wt-g0base detached@0fba915 + 集合 0/0 + 计数一致）；时刻状态不可回溯。
3. 门禁对审查方红条 rename/split/skip 的行为——静态推断（严格集相等 ⇒ added/gone ⇒ 红），未构造实证（构造需改审查方文件，本席不碰）。
4. "同名但断言弱化"场景——静态判定（按名标识的固有限制），未构造。
5. 门禁在并发写入下的行为（席位在飞写入导致假红）——未实测；按设计 fail-loud、方向安全（与 EVIDENCE「先排除并发写入」纪律自洽）。
6. REVIEW §28.1 过程记录（splice 险事故）——不可独立验证。
7. E-00/E-01（eventsOf 作用域、CROSS_EVENT_READ 授权表、存在性 oracle 登记）——依指令属 G0 范围外，不下结论；本席攻击未用跨命名空间 eventsOf。
8. 面哈希 da5d3d2f/f3f3a0fa/a3e4b168 三个值未逐字节重算——门禁测试自身计算并比对（面哈希用例实测绿），本席方向判定基于成员/内容 diff + 该用例绿。如需字节级复算：按 `arch-independence.test.ts:113–117` 算法在对应提交 worktree 上跑。

## 附录：复现命令（全部已实际执行）

```sh
# 前置
git rev-parse HEAD        # 任务开始 fa9c2d0352…（一致）；后续推进至 de82ed3 属预期

# 规定复跑（主树）
npx tsc -p experiments/v3-code-architecture-poc/tsconfig.json
#   → exit 0
npx vitest run --config experiments/v3-code-architecture-poc/vitest.config.ts \
  experiments/v3-code-architecture-poc/tests/
#   → Test Files 15 passed (15); Tests 95 passed (95)

# 席位 B 攻击测试（16 例，含 B-1…B-5 全部实测断言）
npx vitest run --config experiments/v3-code-architecture-poc/vitest.config.ts \
  experiments/v3-code-architecture-poc/attacks/review/re-review-g0b-attacks.test.ts
#   → Tests 16 passed (16)

# 全量核对（独立 worktree，已删除）
git worktree add .scratch/wt-b 0fba915
ln -s ../../node_modules .scratch/wt-b/node_modules
# @0fba915 全量 → TOTAL 198 / passed 167 / failed 31 / files 38
#   与 BASELINE.json 比对 → ADDED 0 / GONE 0
git -C .scratch/wt-b checkout ccc1449
node experiments/v3-code-architecture-poc/g0-gate.mjs     # @ccc1449
#   → [1/3] OK；[2/3] OK 95 例全绿；[3/3] OK 与基线完全一致；PASS exit 0
git -C .scratch/wt-b checkout 8892091
# @8892091 全量 → Test Files 9 failed | 28 passed (37); Tests 24 failed | 168 passed (192)
git worktree remove .scratch/wt-b --force
```
