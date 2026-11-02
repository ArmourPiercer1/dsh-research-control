# VERDICT — P-NS 稳定物理命名空间 vs 通用重定位（最小真实测试）

> 2026-11-03 · 授权与判据：`g1/G2-DEV-PLAN.md §0bis / P-NS`（外部审查收口，现行）
> 性质：**类甲实验**（只读引用 `src/**` 机制本体；不落生产 `src/**`、`tests/**`、`schema/**`、无 DDL 进生产、无新事件名入生产封闭名单）
> 命令：`node experiments/v3-code-architecture-poc/preflight/ns/run.mjs`
> 退出码：0 = PASS_STABLE_NS ｜ 10 = RELOCATION_REQUIRED（有效必要性反例）｜ 2 = INCONCLUSIVE / 无效

## 1. 裁决

**`PASS_STABLE_NS`（exit 0，五项全过；同一源码锚连跑 2 次，两次 exit 0 且五项全绿）。**

在本仓 PoC 机制本体（Kernel + SqlitePort + 装配根，未改一行）上，H0（`CapabilityID` 稳定、持久 `storage_ns`
与 Plugin 包名分离、允许更换实现与重启式离线 Schema 迁移）的五项最小真实测试全部通过，且每一项都配有
**真正打破该保证的负例**。实验侧未发现任何「离线迁移 / 正确 PluginID/ns 解耦 / 普通兼容适配」消除不了的
Q44/Q45/历史不变量反例。

| # | 事项 | 裁决 | 关键实证（逐字取自本次运行输出） |
|---|---|---|---|
| ① | 同 CapabilityID 更换 PluginID 后旧 ObjectID/RevisionRef、旧事件、旧检查报告按原版本可读 | **通过** | `pluginId test.object-model → test.object-model.split；ns=dom_test_om 恒等；旧修订/事件(1)/报告 RPT-3 字节等；负例：携 ns 移交 ⇒ TRANSFER_NS_DRIFT` |
| ② | 只升级一个 Space，另一空间仍可运行 | **通过** | `SP-A：未迁移 fail-loud=SCHEMA_INCOMPATIBLE → 盖戳 2 行 → v2；SP-B 仍 v1（路由 v1、行 v1）且新提交可读；负例：按库误盖 B 的 3 行 ⇒ B 读面 SCHEMA_INCOMPATIBLE（打破 ② 的耦合形态实测）` |
| ③ | 不改变持久 ns/owner，缺旧解释器时 fail-loud 而非重解释 | **通过** | `身份行 ns/owner 恒等（1 行）、路由 ns=dom_test_om 恒等；漏盖行读面 ⇒ SCHEMA_INCOMPATIBLE（不重解释）；同对象已盖行仍可读（逐行）；触发器在位=["domain_state_no_delete","domain_state_no_update"]` |
| ④ | 离线 Schema 升级的注入崩溃全回滚，重启后可恢复 | **通过** | `在线 DML ⇒ DOMAIN_STATE_APPEND_ONLY；事务内崩溃 exit=9 → 行版本 v1 全回滚、触发器随回滚保留、重跑盖戳 2 行后恢复读取；负例（非事务）：exit=9 → 混合态 ["v1","v2"] + update 触发器缺失留存 ⇒ 打开面 SCHEMA_UPGRADE_REQUIRED` |
| ⑤ | Facet/跨能力的精确引用在拆包后不漂移（合成挂载） | **通过** | `挂载载荷逐字等；目标解析 v=first；facet ns=dom_test_facet 恒等；负例：路径键 test.instrument-facet#OBJ-SP-A-1 → test.instrument-facet.split#OBJ-SP-A-1 已漂移（oid 键未漂移）` |

**「Kernel 未引入领域特殊分支」**：本实验全程只经通用机制面（capability / ns / oid / revision / 事件 /
报告 / 路由移交 / 作用域端口），未新增任何领域分支；业务无知的常驻机验继续由
`tests/arch-independence.test.ts`（g0-gate 流 2 内跑，225 绿基线）承担，本实验不复制该判据。

## 2. 迁移形态的发现（对 PR-5/PR-7 的承接要求）

`domain_state` 在**存储层**是追加式表（`domain_state_no_update` / `domain_state_no_delete` 触发器，
`sqlite-port.ts:200-205`）。这直接决定了「重启式离线 Schema 迁移」在本仓形态下只能是：

1. **离线窗口**（Kernel 未打开该库）内，单事务重写版本戳：`DROP TRIGGER → 盖戳 → 重建 TRIGGER → COMMIT`；
2. 完整性检查通过后**换库**（rename）——提交边界 = 换库，崩溃只会留下旧库或完整新库；
3. 打开路径校验**完整触发器集**（摘掉任何一条 ⇒ `SCHEMA_UPGRADE_REQUIRED` fail-loud，不隐式迁移，
   `sqlite-port.ts:273-285`）。

三条实测负例支撑该形态的必要性：在线 DML 改戳被触发器拒绝；非事务式迁移崩溃留下混合态 + 触发器缺失，
最终连打开面都 fail-loud；事务内崩溃则全量回滚（含触发器恢复）。

⇒ **PR-5/PR-7 的承接项（PASS 分支）**：稳定 ns 下的启动版本校验、可回滚重启式迁移、历史读回
（含迁移器原子边界与打开面触发器集/版本校验），`ns-relocated` 通道与物理重定位不再是首版依赖。

## 3. 输入锚（可复现）

**锚职责声明**：判据输入以 `src/**` 的 sha256 为准；`HEAD` 行只报运行时刻工作树指向，**不承担锚职责**
（提交本文件本身会改变 HEAD，把 HEAD 当锚会造成自指）；`run.mjs` 同时打印 `src` 面是否有未提交改动。
下表两次运行均在工作树 `src` 面干净的条件下产生，两次 exit 0。

```
输入：HEAD=71fa97296bfa659f55bbd1e6df28a519b7a32760（工作树 src 面 干净；HEAD 不承担锚职责，判据以 src sha256 为准）
输入：src/kernel/kernel.ts sha256=0eeb5cafe2200ed3
输入：src/storage-sqlite/sqlite-port.ts sha256=3c24da64da507cda
输入：src/harness/world.ts sha256=6513482f8b2a00b2
输入：src/domains/test-object-model.ts sha256=8093cdf63ddd4d6e
输入：src/domains/test-facet.ts sha256=595e80d000d3b612
运行环境：Node v24.21.0（node:sqlite 内置）；src/** 为 TS，run.mjs 以 --experimental-transform-types 自重启加载
```

完整运行输出（run#1 逐字，`run.mjs` 修复后于同一工作树连跑两次；临时目录路径已脱敏）：

```
✅ [P-NS-1] 同 CapabilityID 更换 PluginID 后：旧 ObjectID/RevisionRef、旧事件、旧检查报告按原版本可读
   pluginId test.object-model → test.object-model.split；ns=dom_test_om 恒等；旧修订/事件(1)/报告 RPT-3 字节等；负例：携 ns 移交 ⇒ TRANSFER_NS_DRIFT

✅ [P-NS-2] 只升级一个 Space（v1→v2 离线迁移 + 重启），另一 Space 仍按 v1 正常运行
   SP-A：未迁移 fail-loud=SCHEMA_INCOMPATIBLE → 盖戳 2 行 → v2；SP-B 仍 v1（路由 v1、行 v1）且新提交可读；负例：按库误盖 B 的 3 行 ⇒ B 读面 SCHEMA_INCOMPATIBLE（打破 ② 的耦合形态实测）

✅ [P-NS-3] 升级不改变持久 ns/owner；缺旧解释器时 fail-loud（拒读，不重解释）
   身份行 ns/owner 恒等（1 行）、路由 ns=dom_test_om 恒等；漏盖行读面 ⇒ SCHEMA_INCOMPATIBLE（不重解释）；同对象已盖行仍可读（逐行）；触发器在位=["domain_state_no_delete","domain_state_no_update"]

✅ [P-NS-4] 离线 Schema 升级的注入崩溃全回滚、重启后可恢复；在线 DML 与非事务迁移均为负例
   在线 DML ⇒ DOMAIN_STATE_APPEND_ONLY；事务内崩溃 exit=9 → 行版本 v1 全回滚、触发器随回滚保留、重跑盖戳 2 行后恢复读取；负例（非事务）：exit=9 → 混合态 ["v1","v2"] + update 触发器缺失留存 ⇒ 打开面 SCHEMA_UPGRADE_REQUIRED

✅ [P-NS-5] Facet 合成挂载的精确引用在拆包（pluginId 变、能力/ns 不变）后不漂移
   挂载载荷逐字等；目标解析 v=first；facet ns=dom_test_facet 恒等；负例：路径键 test.instrument-facet#OBJ-SP-A-1 → test.instrument-facet.split#OBJ-SP-A-1 已漂移（oid 键未漂移）

════════ 汇总 ════════
PASS  P-NS-1
PASS  P-NS-2
PASS  P-NS-3
PASS  P-NS-4
PASS  P-NS-5
判定：PASS_STABLE_NS —— 五项全过，Kernel 未引入领域特殊分支（业务无知的常驻机验见 tests/arch-independence.test.ts）。
分支后果：PR-8/W8 DEFERRED（不再是首版依赖）；ns-relocated 保持 planned、不要求批准；
          PR-5/PR-7 承接稳定 ns、启动版本/历史验证与可回滚重启式迁移；PR-10 不再验物理重定位。
```

run#2（同工作树第二次）：exit 0，`PASS P-NS-1` 至 `PASS P-NS-5` 五行全绿，判定行逐字相同。
本修复提交之后复跑的输出仅 `HEAD` 行随提交变化；`src` 五个 sha256 与上表逐字相同（见结项报告证据节）。

**负例性质说明**（回应复核意见）：① 携 ns 移交、③ 迁移漏盖行、④ 在线 DML 与非事务迁移崩溃、⑤ 路径键引用
——都是**真正打破对应保证**的机制负例；② 的负例是「按库（而非按 ns 作用域）迁移，误盖另一空间的行」，
实测使其读面 fail-loud，属打破 ② 的耦合形态。P-NS-2 的「两库独立」句不是负例，已删去该措辞。

单元级侧证（常驻测试，非本实验独占；门禁内跑）：

- Q44 换实现/拆包：`tests/p2-identity-plugin.test.ts:100`（ObjectID 与旧精确引用不变）、`:119`（移交持久、失败事务不改路由）
- Q45 Facet 独立写入/版本化/卸载：`tests/p2-identity-plugin.test.ts:156`
- 携 ns 移交入口即拒（零半成品）：`tests/g5a-d31-transfer-ns.test.ts:42`；同 ns 换包正向对照：`:92`
- 版本偏差逐行剔除且可归因：`tests/contract-skew-echo.test.ts:46`
- 契约版本判据 fail-loud：`src/kernel/kernel.ts` `assertContractVersion`（`SCHEMA_INCOMPATIBLE`）

## 4. 诚实边界

- 本实验证明的是**本仓 PoC 机制本体在 H0 形态下的行为**，不是生产就绪证明；夹具为合成测试域
  （`test.object-model` / `test.instrument-facet`），不代表真实科研域的全部读面。
- 未覆盖（如实登记，不包装为技术否证）：迁移期间的**多进程并发写**（离线窗口以 Kernel 关闭为前提）、
  跨 Space 的迁移调度、生产级迁移器的运维审计面（谁提案/谁批准/清单跑没跑——`namespace_relocation`
  账若启用才需要）；这些属 PR-5/PR-7 的实现义务，不改变 H0 可行性结论。
- 实验使用 Node v24 的 `--experimental-transform-types` 加载 TS 源码（自重启实现，固定命令不变）；
  若执行环境 Node 版本不同，需先核对 `node:sqlite` 与 transform-types 可用性——这是脚手架前提，
  不是机制判据。
- 负例只跑在丢弃副本上，不污染主证据库；所有临时库在运行结束时删除。

## 5. 分支后果（§0bis「自动结果」逐条兑现）

`PASS_STABLE_NS` ⇒

1. **PR-8/W8 DEFERRED**，不再是首版依赖；
2. `ns-relocated` 保持 `planned`，**不要求批准**（其审批只在 `RELOCATION_REQUIRED` 分支成立）；
3. PR-5/PR-7 实现稳定 ns、启动版本/历史验证与可回滚重启式迁移；PR-10 不再验物理重定位；
4. **G1 冻结前须同步**：RL / EA / UNIFIED、事件名表、验收矩阵与 PR 卡中的**机制条款适用范围**
   （只改适用范围与排期，不废止五类对象 / H/S/R / 历史语义；不以低位计划暗中废止高位合同）。
   同步落点与措辞见结项报告 §同步清单。
