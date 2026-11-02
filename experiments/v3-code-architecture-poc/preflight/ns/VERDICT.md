# P-NS 判定：`PASS_STABLE_NS`（稳定物理命名空间 vs 通用重定位）

> 实验代码：`experiments/v3-code-architecture-poc/preflight/ns/run.mjs`（单文件、可复现、固定命令）
> 判据授权：`g1/G2-DEV-PLAN.md §0bis / P-NS`（2026-11-03 外部审查收口，现行）
> 上位版本治理约束：`g1/G1-UNIFIED-CONTRACTS.md §3.3/§3.4`（四层版本轴）与 §5.1（历史按自钉版本解释）
> 证据锚：本文件 §3（`src/**` sha256 为锚，HEAD 只报运行时刻指向）；连跑 2 次均 exit 0
> 版本：2026-11-03 修订（按外部审查 P1 意见修正迁移形态；旧「批量改版本戳」做法已降为负例）

## 0. 结论

**`PASS_STABLE_NS`（exit 0，五项全过；同源连跑 2 次，两次 exit 0）。** 结论分两段，须一起读：

| 段 | 结论 | 强度 |
| --- | --- | --- |
| **A. 换实现 / 稳定 ns** | 同 `CapabilityID` 换 `PluginID`（拆包、换实现、v1→v2 同版本升级）不需要迁移对象数据；旧 ObjectID/RevisionRef、旧事件、旧检查报告按原版本可读，`storage_ns` 与 owner 一字不变 | **有效支持**（①③⑤ 全过 + 常驻测试侧证） |
| **B. 离线物理升级** | 迁移只推进**物理层** `storage_schema_version`（per space×capability 登记 + 迁移记录），历史行 `contract_version` 与解释结果**一字不动**；跨版本读按记录自钉版本派发解释器，缺解释器 ⇒ `UNINTERPRETED_FAIL_CLOSED` | **有效支持**（②④ 全过 + 真负例） |

**被否证的形态**（本报告最需要强调的一条）：把历史行的 `contract_version` 批量改写成新版本
（本实验 2026-11-03 之前的实现、以及任何「迁移器代盖章」的形态）**不是**兼容手段——
在 v1/v2 解释规则真正不同的前提下，它会让历史记录**变得不可解释**（负例实测
`UNINTERPRETED_FAIL_CLOSED`）。该形态违反 UNIFIED §3.3（`contract_version` = 契约层、迁移器不得回填）
与 §3.4（迁移器三不做：不回填版本戳、不补造迁移证据、不代盖章），**禁止写入正式实现**。

⇒ 分支后果（§0bis「自动结果」）：**PR-8/W8 DEFERRED**、`ns-relocated` 保持 `planned` 不要求批准；
PR-5/PR-7 承接稳定 ns、版本化读者/解释器派发与可回滚重启式迁移；PR-10 不再验物理重定位。
本判定**不构成**生产迁移器可用性证明：生产迁移器与换库/WAL 崩溃窗口的硬性验收归 PR-5（§2 清单）。

## 1. 五项最小真实测试（逐项 + 真负例）

| # | 保证 | 实测 | 结果 |
| --- | --- | --- | --- |
| ① | 同 CapabilityID 换 PluginID 后旧对象/事件/报告按原版本可读 | `pluginId test.object-model → test.object-model.split`；`ns=dom_test_om` 恒等；旧修订/事件/报告 `RPT-3` 字节等；v1 解释结果不变 | **通过** |
| ② | 只升级一个 Space，另一空间仍可运行 | SP-A 物理版本登记 v1→v2、迁移记录 1 条、域行 2 行零改动（`contract_version` 仍 v1）；SP-B 版本登记缺省、行 v1、新提交可读 | **通过** |
| ③ | 不改变持久 ns/owner，缺旧解释器时 fail-loud | 身份行 ns/owner 恒等、路由 ns 恒等、路由契约版本仍 v1；机制层缺派发 ⇒ `SCHEMA_INCOMPATIBLE`（拒读不重解释）；版本化读者 v1 ⇒ 与升级前逐字同 | **通过** |
| ④ | 离线升级注入崩溃全回滚、重启可恢复 | 在线 DML ⇒ `DOMAIN_STATE_APPEND_ONLY`；事务内崩溃 exit=9 → 版本登记/迁移记录双回滚、域行逐字未变；重跑后版本化读者恢复历史解释 | **通过** |
| ⑤ | Facet/跨能力精确引用拆包后不漂移 | 合成挂载载荷逐字等；facet `ns=dom_test_facet` 恒等；核心对象 owner 恒等 | **通过** |

**每项的真负例**（打破该保证的形态，全部实测）：

| # | 负例形态 | 实测结果 |
| --- | --- | --- |
| ① | 携新 `storage_ns` 移交 | 入口即拒 `TRANSFER_NS_DRIFT`（否则旧对象永久读不出） |
| ② | 按库（而非按 space×capability）批量改写历史行版本戳 | 该空间历史记录 `UNINTERPRETED_FAIL_CLOSED`（v1 载荷被 v2 解释器拒读） |
| ③ | 缺 v1 解释器；以及「宽容解释器」按 v2 规则硬解 v1 载荷 | 前者 `UNINTERPRETED_FAIL_CLOSED`；后者得到静默错值（契约禁止的重解释） |
| ④ | 非事务迁移：版本登记落库、迁移记录未写就崩溃 | 半套登记（v2/0 条）⇒ 来源判据 `MIGRATION_PROVENANCE_MISSING` |
| ⑤ | 把「包名#oid」当引用键 | 拆包后路径键漂移（`test.instrument-facet` → `….split`），而 oid+revision 键不漂移 |

## 2. 生产迁移器的硬性验收（归 PR-5，本实验不代证）

本实验只证明「物理版本单独推进 + 历史版本不动 + 版本化解释器派发」在机制上可行，**不证明生产迁移器**。
以下由 PR-5 作为硬性验收（外部审查明确要求，不再作为架构必要性 PoC）：

1. 换库阶段（`rename` 前后）与 `-wal`/`-shm` 删除窗口的崩溃注入：任一时刻崩溃只能留下**旧库或完整新库**，
   不得出现「库已换、wal 未删」或「wal 已删、库未换」的半态。
2. 崩溃恢复后的可重入性：重跑迁移必须幂等（已迁移即跳过、半态可检出并拒绝打开）。
3. 迁移记录完整性：版本推进必须有对应迁移记录（来源可证），否则 fail-loud（`MIGRATION_PROVENANCE_MISSING` 同型）。
4. 打开期判据：物理版本墙 + 触发器集 + 激活核对 + 漂移检出（§3.2 序）逐条在位。
5. 迁移期间 Kernel 必须关闭（离线窗口），并证明「迁移中途有 Kernel 打开」会被拒（版本墙/锁）。

## 3. 输入锚与运行输出（可复现）

**锚职责声明**：判据输入以 `src/**` 的 sha256 为准；`HEAD` 行只报运行时刻工作树指向，**不承担锚职责**
（提交本文件本身会改变 HEAD，把 HEAD 当锚会造成自指）；`run.mjs` 同时打印 `src` 面是否有未提交改动。
下表两次运行均在工作树 `src` 面干净的条件下产生，两次 exit 0。

```
输入：HEAD=01db6f6c263b7d2247abf1f4b7b8350c568b4ffa（工作树 src 面 干净；HEAD 不承担锚职责，判据以 src sha256 为准）
输入：src/kernel/kernel.ts sha256=0eeb5cafe2200ed3
输入：src/storage-sqlite/sqlite-port.ts sha256=3c24da64da507cda
输入：src/harness/world.ts sha256=6513482f8b2a00b2
输入：src/domains/test-object-model.ts sha256=8093cdf63ddd4d6e
输入：src/domains/test-facet.ts sha256=595e80d000d3b612
```

完整运行输出（run#1 逐字，临时目录路径已脱敏）：

```
✅ [P-NS-1] 同 CapabilityID 更换 PluginID 后：旧 ObjectID/RevisionRef、旧事件、旧检查报告按原版本可读
   pluginId test.object-model → test.object-model.split；ns=dom_test_om 恒等；旧修订/事件(1)/报告 RPT-3 字节等；v1 解释结果不变；负例：携 ns 移交 ⇒ TRANSFER_NS_DRIFT

✅ [P-NS-2] 只升级一个 Space 的物理 Schema 版本（历史行 contract_version 不动），另一 Space 仍可运行
   SP-A：物理版本登记 v1→v2、迁移记录 1 条、域行 2 行零改动（contract_version 仍 v1、v1 解释结果不变）；SP-B 未升级（版本登记缺省、行 v1）且新提交可读；负例：按库批量改历史行版本 ⇒ 该空间历史记录 UNINTERPRETED_FAIL_CLOSED

✅ [P-NS-3] 升级不改变持久 ns/owner；缺旧解释器时 fail-loud（拒读，不重解释）
   身份行 ns/owner 恒等（1 行）、路由 ns=dom_test_om、路由契约版本仍 v1；机制层缺派发 ⇒ SCHEMA_INCOMPATIBLE（拒读不重解释）；版本化读者 v1 ⇒ 与升级前逐字同；负例：缺 v1 解释器 ⇒ UNINTERPRETED_FAIL_CLOSED；宽容解释器 ⇒ 静默错值（契约禁止）

✅ [P-NS-4] 物理层升级的注入崩溃全回滚、重启后可恢复；非事务崩溃留半套登记（负例）
   在线 DML ⇒ DOMAIN_STATE_APPEND_ONLY；事务内崩溃 exit=9 → 版本登记/迁移记录双回滚（v1、0 条）、域行逐字未变；重跑盖戳 v2 后版本化读者恢复历史解释（机制层直读仍 SCHEMA_INCOMPATIBLE）；负例（非事务）：exit=9 → 半套登记 v2/0 条留存 ⇒ 来源判据 MIGRATION_PROVENANCE_MISSING

✅ [P-NS-5] Facet 合成挂载的精确引用在拆包（pluginId 变、能力/ns 不变）后不漂移
   挂载载荷逐字等；facet ns=dom_test_facet 恒等；核心对象 owner 恒等；负例：路径键 test.instrument-facet#OBJ-SP-A-1 → test.instrument-facet.split#OBJ-SP-A-1 已漂移（oid 键未漂移）

════════ 汇总 ════════
PASS  P-NS-1
PASS  P-NS-2
PASS  P-NS-3
PASS  P-NS-4
PASS  P-NS-5
判定：PASS_STABLE_NS —— 五项全过（换实现/稳定 ns 与离线物理升级两段均过），Kernel 未引入领域特殊分支。
迁移形态：物理层 storage_schema_version 单独推进；历史行 contract_version 与解释结果一字不变；
          缺旧解释器 ⇒ UNINTERPRETED_FAIL_CLOSED；批量改版本戳被负例实测否定（历史变不可解释）。
分支后果：PR-8/W8 DEFERRED；ns-relocated 保持 planned、不要求批准；PR-5/PR-7 承接稳定 ns、
          版本化读者/解释器派发与可回滚重启式迁移（含换库/WAL 崩溃窗口的硬性验收）；PR-10 不再验物理重定位。
```

run#2（同工作树第二次）：exit 0，`PASS P-NS-1` 至 `PASS P-NS-5` 五行全绿，判定行逐字相同。

**负例性质说明**：① 携 ns 移交、② 按库批量改历史版本、③ 缺解释器/宽容解释器、④ 非事务半套登记、
⑤ 路径键引用——每一项都是**真正打破该条保证**的形态，不是「正向隔离」的复述。

**夹具边界**：`pns_fixture_storage_schema` / `pns_fixture_migration_log` 是实验侧表，模拟 G2 的
per-(space×capability) 登记（D3-c；PoC 现形是全局 `SCHEMA_VERSION` 常数，D-18 单插件假设）；
版本化读者经只读 raw 面取行，模拟 G2 规则层派发（机制层尚无该读者）。两者都只存在于实验临时库。

单元级侧证（常驻测试，非本实验独占；门禁内跑）：

- Q44 换实现/拆包：`tests/p2-identity-plugin.test.ts:100`（ObjectID 与旧精确引用不变）、`:119`（移交持久、失败事务不改路由）
- Q45 Facet 独立写入/版本化/卸载：`tests/p2-identity-plugin.test.ts:156`
- 携 ns 移交入口即拒（零半成品）：`tests/g5a-d31-transfer-ns.test.ts:42`；同 ns 换包正向对照：`:92`
- 版本偏差逐行剔除且可归因：`tests/contract-skew-echo.test.ts:46`
- 契约版本判据 fail-loud：`src/kernel/kernel.ts` `assertContractVersion`（`SCHEMA_INCOMPATIBLE`）

## 4. 诚实边界

- 本实验证明的是**本仓 PoC 机制本体在 H0 形态下的行为**，不是生产就绪证明；夹具为合成测试域
  （`test.object-model` / `test.instrument-facet`），不代表真实科研域的全部读面。
- v1/v2 解释器是实验侧最小规则（`{v}` vs `{value:{amount,currency}}`），用途是让「改写版本戳」的
  危害**可判据**（两版规则相同则测试无鉴别力）；真实域的解释差异由 PR-5/PR-7 的版本化读者承载。
- 未覆盖（如实登记，不包装为技术否证）：迁移期间的**多进程并发写**（离线窗口以 Kernel 关闭为前提）、
  跨 Space 的迁移调度、换库/WAL 窗口的崩溃注入、生产级迁移器的运维审计面（谁提案/谁批准/清单跑没跑）——
  全部归 §2 的 PR-5 硬性验收，不改变 H0 可行性结论。
- 实验使用 Node v24 的 `--experimental-transform-types` 加载 TS 源码（自重启实现，固定命令不变）；
  若执行环境 Node 版本不同，需先核对 `node:sqlite` 与 transform-types 可用性——这是脚手架前提，
  不是机制判据。
- 负例只跑在丢弃副本上，不污染主证据库；所有临时库在运行结束时删除。

## 5. 分支后果（§0bis「自动结果」逐条兑现）

`PASS_STABLE_NS` ⇒

1. **PR-8/W8 = `DEFERRED`**：不再是 G2 必经图上的节点，`ns-relocated` 不进入首版事件名批准范围。
2. **`ns-relocated` 保持 `planned`、不要求批准**：机制与契约文本保留，作为未来可选能力（需要时按冻结变更流程启用）。
3. **PR-5/PR-7 承接**：稳定 ns、启动版本/历史验证、版本化读者/解释器派发、可回滚重启式迁移（含 §2 验收清单）。
4. **PR-10 不再验物理重定位**：改为验「稳定 ns 下的换实现/升级」。
5. **Kernel 未引入领域特殊分支**：本实验全程只经公开 Port（`openWorld`/`uow`/`transferCapability`/`readRevision`），
   业务无知的常驻机验见 `tests/arch-independence.test.ts`。
