# 独立复验报告 G0-A —— 席位 A（D-7 / D-16 / D-17 插件可见对象面）

- 席位：独立复验席位 A（与作者、席位 B 互相隔离）
- 对象 PoC：`experiments/v3-code-architecture-poc/`，分支 `poc/v3-code-arch-20261030`
- 判定锚定提交（不用 HEAD）：`11b4bf6`(D-15) → `1c95d5e`(D-16/D-17) → `fa9c2d0`(D-7) → `0fba915`(E-00/E-01) → **`ccc1449`**(WeakMap 修复 + g0-gate)
- 隔离手段：独立 worktree `.scratch/g0a-fa9c2d0`（detached，node_modules 符号链接自主仓），全部变异实验在 worktree 内做并**逐文件**恢复；主树只写本目录两个文件。
- 日期：2026-10-30（会话时间）

---

## 结论

**部分封住。** G0 原命题——"插件可见对象在运行时携带机制句柄"——在 `ccc1449` 已封住：我在 `fa9c2d0` 上实测复现的 P1 逃逸（`tx.constructor.peekRaw(tx)` 取到守卫句柄，进而跨命名空间取数、删 journal、伪造 ledger 行、劫持 `capability_route` 致重启后读写全拒）在 `ccc1449` 重跑**不可复现**，且对构造器/原型/描述器/闭包/回调/异常/`Reflect.apply`/`globalThis` 全矩阵复测无替代泄露通道。但本次新设的机器门禁本身被我实测出**假绿路径**（`g0-gate.mjs` 作者测试流忽略 vitest 退出码、无最小通过数；D-7 import 禁令正则只认单引号），故"门禁证明封住"这一论证目前不成立，只能由本报告的双状态实测背书。

---

## 尝试矩阵

视角纪律：只使用插件实际拿得到的对象——`face = kernel.faceFor(cap)`（含 `writerFor`/`readOwn`/`eventsOf`/`revisionOf`）与 `uow` 回调参数 `tx`。测试侧持有 `w.kernel`/`w.raw` 的条目单独标注。证据 = 测试输出标记（完整输出在对应运行的控制台；测试文件 `attacks/review/rereview-g0a-escape.test.ts`）。

| # | 手段 | 修复前 `fa9c2d0` | 修复后 `ccc1449` | 证据 |
|---|---|---|---|---|
| 1 | 直读 `tx.raw / tx.k / tx.port`、`writer.k / writer.raw / writer.port` | 全 `undefined`（**假绿陷阱**：见 #9） | 全 `undefined` | `G0A-SURFACE-POSTFIX direct: {}`；修复前运行同值 |
| 2 | `Object.getOwnPropertyNames`（自有 + 完整原型链至 `Object.prototype`） | 无 `raw/k/port` 名；链名含 9 个机制方法 | `ownNames=[principal]`；`chainNames=[appendLedger,checkRequiredRefs,constructor,createObject,declareRecord,linkRef,principal,readLatest,reassignRouteInternal,recordReport,revise]` | `enumTx` |
| 3 | `getOwnPropertySymbols`（自有 + 原型链） | `[]` | `[]` | `enumTx.chainSymbols: []` |
| 4 | `for...in` / `Reflect.ownKeys` | `[principal]` | `[principal]` | `enumTx.forIn` / `reflectOwnKeys` |
| 5 | `JSON.stringify`（tx / writer / face） | tx `{"principal":...}`；**writer `{"cap":"cap.test.object-model"}`（泄露，见新发现 P2-2）** | 同左 | `enumTx.json` / `enumWriter.json` |
| 6 | `util.inspect(showHidden)` | `UnitOfWorkImpl { principal: {...} }` | 同左（`#k`/`#raw` 真私有不可见） | `enumTx.utilInspect` |
| 7 | `constructor` 回溯（`tx.constructor` / `writer.constructor`） | **成功（P1）**：`ctorName=UnitOfWorkImpl`、`hasPeekRaw=true`、`ctor.peekRaw(tx)` 取到守卫句柄 | **闭合**：`txPeekRawPresent=false`、`txCtorExtras=[]`、`writerCtorExtras=[]`、描述器仅 `length/name/prototype` | 修复前运行 5/5 通过；`G0A-SURFACE-POSTFIX f1` |
| 8 | 句柄用途复测（取到 raw 后） | 全打通（影响面见 #11-15） | 不适用（取不到） | 见下行起 |
| 9 | 逃逸句柄越界存活（uow 外再执行） | `postTx: "1"`（存活） | 不适用 | 修复前运行 |
| 10 | **跨命名空间取数**（raw SELECT 第二命名空间 `domain_state`） | `crossNsPayload: "{\"text\":\"SECOND-NS-PAYLOAD\"}"`、`otherNsObjects: "OBJ-SP-G0A-2"` | 不适用 | 修复前运行 |
| 11 | **读报告全文**（`check_report`） | `reportPayload: "FAIL [{\"code\":\"X\",...}]"` | 不适用 | 修复前运行 |
| 12 | **journal 删除**（审计擦除，`delete from journal`） | `journalDelete: "OK 3 -> 0"` | 不适用 | 修复前运行 |
| 13 | **ledger 伪造行**（无 insert 触发器，历史篡改） | `ledgerInsert: "INSERTED actor=attacker"` | 不适用 | 修复前运行 |
| 14 | **meta 改写** | `metaUpdate: "OK(no-op)"` | 不适用 | 修复前运行 |
| 15 | **`capability_route` 劫持**（`update capability_route set ns='dom_evil_attacker'` → 重启） | `readState/writeState = "THROW SCHEMA_INCOMPATIBLE"`（持续 DoS） | 插件面唯一入口 `reassignRouteInternal` 被二次授权挡住：`authErr: code=AUTHORITY_REQUIRED`，DB 实测 `nsAfter=dom_g0a_second` 未变 | 修复前 HIJACK 测试；`G0A-HIJACK-POSTFIX` |
| 16 | 守卫边界（句柄上执行） | DDL/多语句/注释前缀 `REFUSED: RAW_SQL_REFUSED`；但 SELECT 与全部 DML（含 #10-14）放行 | 不适用（无句柄） | 修复前 `guardDrop/guardMulti/guardComment` |
| 17 | 闭包 Receiver 劫持（`Reflect.apply(face.writerFor, fakeThis, [tx])`、`readOwn.call(fakeThis, oid)`） | —（修复前未测，面相同） | 箭头忽略 `this` 参数：`receiverHijack: "returned=NamespaceWriterImpl (arrow 忽略 this，仍走原闭包)"`、`callTry: no-throw`（仍走原 kernel 闭包，未换出 kernel） | `G0A-SURFACE-POSTFIX` |
| 18 | 回调参数携带（某方法把句柄传进插件回调） | `uow` 的 `fn` 是唯一插件回调，只收到 `tx` 实例（源码核对 `kernel.ts` 全文件 + 本矩阵 #1-7） | 同左；源码核对 `RAW_OF_UOW` 在 `kernel.ts` 仅 3 处引用（ctor set / setRouteEnabled get / namespacedWriter get），均模块内部 | 静态 + #1-7 |
| 19 | 异常携带 / `Error.cause` | — | `errProbe.revisionOf: "code=NAMESPACE_ESCAPE ownNames=[stack,message,code,detail,name] cause=null"`，无可调用成员，`detail` 纯数据 | `G0A-SURFACE-POSTFIX errProbe` |
| 20 | 机制内部方法仍挂原型（`checkRequiredRefs`/`reassignRouteInternal`/`readLatest`） | 在 | 在且可调用，但：`reassignRouteInternal` 需 `capability-admin`（#15）；`checkRequiredRefs` 只读校验返回 void；`readLatest` 返回纯数据快照；无一返回句柄 | `txProtoMethods` + #15 |
| 21 | symbol 通道 `KERNEL_PORT`（测试侧单列：持有 `w.kernel`） | 可枚举（原型 symbol，**无需 import**）且可 import：`derived === KERNEL_PORT`、`portOwn: ["opts","db","adapter","failBeforeCommit"]`、`adapter.db` 即裸 `DatabaseSync`、`sqliteMasterRows: 32` | 同左（通道形态未变；前提"持有 Kernel 实例"插件面不成立——`#k` 为真私有，face 闭包不可提取，#17） | `G0A-SYMBOL`（两状态同值） |
| 22 | `globalThis` 残留（kernel/sqlite/peekRaw/UnitOfWork/SqlitePort/RAW_OF_UOW 等关键词） | `[]` | `[]` | `G0A-GLOBAL` |
| 23 | 源码扫描旁路（8 条 FORBIDDEN 正则静态复算） | 旧 P1 攻击形态（`Reflect.get(tx,'constructor')` + `ctor.peekRaw`）**0 命中**：门禁从未覆盖构造器路径，只能靠 `ccc1449` 新增构造器断言兜底 | 同左（扫描未变强；`legacyAttackHits: []`） | `G0A-SCAN` |
| 24 | D-7 import 禁令正则（单/双引号/动态 import） | 单引号命中、双引号与 `await import("…")` **不命中**（静态复算） | 同左 | `G0A-SCAN` d7 三行 |

**结论行**：插件对象图（face / tx / writer 及其闭包、异常、原型、构造器）在 `ccc1449` 上不存在指向 `RawTx`/`StoragePort`/`Kernel` 实例的可达路径——`WeakMap` 在模块闭包内，不在任何对象上。

---

## 新发现

### P1-A（修复前存在、修复后闭合，按要求原样存档）——`.constructor → static peekRaw` 逃逸
- **形态**：`tx.constructor.peekRaw(tx)` 取到守卫句柄。作者"类未导出"的论证错误：实例的 `.constructor` 恒可取类引用，`private` 与未导出都不拦静态方法。
- **影响（fa9c2d0 实测）**：跨命名空间取数（#10）、报告全文读出（#11）、journal 审计擦除（#12）、ledger 历史伪造（#13）、`capability_route` 劫持 → 重启后 `SCHEMA_INCOMPATIBLE` 读写全拒（#15）、句柄越过事务边界存活（#9）。守卫只挡头 DDL/多语句，挡不住上述一切（#16）。
- **两状态记录**：修复前可复现（`fa9c2d0`，攻击测试 5/5 通过，关键值见矩阵 #7-15）；修复后不可复现（`ccc1449`，`txCtorExtras=[]`、`txPeekRawPresent=false`，#7）。
- **复现**：
  ```
  git worktree add .scratch/g0a-fa9c2d0 fa9c2d0   # 修复前
  npx vitest run --config experiments/v3-code-architecture-poc/vitest.config.ts \
    experiments/v3-code-architecture-poc/attacks/review/rereview-g0a-escape.test.ts
  ```
  （本报告落盘的测试文件是 `ccc1449` 后形态；修复前形态的运行输出已记录于本报告矩阵与第一次进度报告。）

### P1-B（**仍开放**，门禁缺陷）——`g0-gate.mjs` 作者测试流可假绿
- **形态 1（实测）**：作者测试文件 import 损坏（文件级加载失败）⇒ vitest `exit=1, success=false`，但 JSON 中 `assertionResults` 无一 `failed`（3 例直接消失，`passed 95→92`）⇒ 门禁流 2 判定 `failed.size=0` ⇒ 打印 `OK —— 92 例全绿`。门禁 `runVitest` **完全忽略 `r.status` 退出码**，也不检查顶层 `success`。
- **形态 2（实测）**：整文件 `test → test.skip` ⇒ `exit=0`，3 例静默消失（vitest 4 JSON 连 `pending` 都不列，`pending=0`）⇒ 门禁绿。
- **根因**：流 2 只查 `failed.size > 0`，无"最小通过数"基线（`passed=95` 这个数没人钉住）。任何让作者测试**静默不跑**的手段（坏 import、改名、收集期崩溃、skip）都假绿。
- **不对称**：流 3（attacks 基线门）因"失败集合必须精确相等"自带保护——红条消失即 `gone` 非空即红；流 2 无任何等价保护。
- **复现**（worktree 内，逐文件恢复）：
  ```
  printf "\nimport 'g0a-nonexistent-module';\n" >> experiments/.../tests/empty-vs-absent.test.ts
  # 按 g0-gate 同逻辑解析 --reporter=json 的 tests/ 流：{"exit":1,"success":false,"failed":0,"passed":92}
  git checkout -- <该文件>   # 恢复后 95 全绿
  ```
- **建议**：流 2 增加 `r.status !== 0 ⇒ fail`（或顶层 `success===false ⇒ fail`）+ 钉住最小通过数（当前 95）。

### P2-1——D-7 import 禁令正则只认单引号
`/from\s+'[^']*kernel\/internal\.ts'/`：双引号 `from "…"` 与动态 `import("…")` 均不命中（静态复算，`G0A-SCAN`）。变异锚点只防"扫描路径改错"，不防引号变体。symbol 本身可枚举（#21），故 import 禁令从来只是编译期辅助——通道强度真正依赖"插件拿不到 Kernel 实例"（面设计 + 领域扫描）。建议正则改 `/from\s+['"][^'"]*kernel\/internal\.ts['"]/` 并补动态 import 规则。

### P2-2——writer 的 TS `private cap` 是运行时自有字段
`NamespaceWriterImpl` 的 `cap` 用 TS `private`（非 `#`）：`Object.getOwnPropertyNames(writer) === ['cap']`，`JSON.stringify(writer) === '{"cap":"cap.test.object-model"}'`——capability id 泄露给任何能序列化 writer 的插件代码。与 D-17 同类，建议改 `#cap`。不构成句柄泄露，故 P2。

### P2-3——新增构造器断言的覆盖面有限
`ccc1449` 在 `namespace-writer-surface.test.ts` 新增"构造器静态面必须为空"断言（对 tx 与 writer），正确覆盖本次 P1-A 的 bug 类（作者变异证据：旧提交下 `expected ['peekRaw'] to deeply equal []`；我持有等价的 `fa9c2d0` 实测 `hasPeekRaw=true`）。但它只查**构造器自身成员**：若未来泄露改写成"原型方法返回句柄"（如新增 `leak(){ return this.#raw }`），现有门禁不会红——门禁里没有"调用任何可达方法不得返回句柄"的行为级可达性测试。我的 #17-20 矩阵是当前方法集的行为级兜底证据，但那是运行时快照，不是持续门禁。

### P2-4——`BASELINE.json` 的 `generated_from_commit` 不被门禁校验
`g0-gate.mjs` 读基线只用 `failures` 数组；`generated_from_commit: "0fba915"` 是纯信息字段。基线可静默漂移（换提交后忘记重生成、或人工改 `failures` 吞新红——后者正是"先定性再更新基线"流程的人工环节）。流程级 P2。

### 备注（不在 G0 四项范围内，不作裁定）
- E-00/E-01（`0fba915`）：`eventsOf` 默认对跨 ns oid 抛 `NAMESPACE_ESCAPE` + `grantCrossEventRead` 授权面——已并入 `ccc1449` 树，不影响 G0 证据链（不触碰 `#port`/WeakMap/句柄面）。作者已登记为 P2/D-12 的存在性 oracle 残余，维持其登记，我不重复裁定。
- 修复前语境下已失效的风险类（句柄到手后的影响放大：guard 仅头 DDL、journal/meta/ledger/capability_route 无触发器）随 P1-A 闭合而失效，完整记录在矩阵 #12-16 备查。

---

## 对作者改动的裁定（`git diff 1c95d5e~1..fa9c2d0` + `ccc1449` 测试面）

逐 hunk 裁定，无"测试改动冒充实现改动"发现——实现面（`internal.ts` symbol、`#port`+symbol getter、`#k`/`#raw`、WeakMap）均为真实改动，测试改动属"翻转假绿 / 补覆盖"。

1. **`tests/arch-independence.test.ts`**
   - 新增 D-7 import 禁令测试 + 变异锚点 + 运行时 symbol 名断言：**正当**。我故意制造单引号违规 import 到 `src/domains/test-facet.ts` ⇒ 该测试变红（`1 failed | 10 passed`）⇒ 逐文件恢复 ⇒ `11/11` 绿。红测证明门禁真在工作（盲点见 P2-1）。
   - 新增 `import { KERNEL_PORT } from '../src/kernel/internal.ts'`：**正当**（禁令对象是领域/契约层，测试层可 import）。
   - `DECLARED` 闭集删除 `k`/`raw`：**正当，且是修正一个假绿配置**。这两个名字本就不是承诺成员（同文件用 `@ts-expect-error` 判过类型面缺失）；而旧清单配合 `.sort()` 使二者落进"检查的前 8 项"，等于门禁**要求洞必须存在**——把洞当基线。运行时缺失判据分轴到 `escapes` 断言，合理。**保留意见**：直读式 `escapes`（`tx.raw === undefined`）单独不充分——修复前运行实测直读全 `undefined` 而逃逸仍成功（#1 vs #7）；真正堵上该盲区的是 `ccc1449` 的构造器断言（见 P2-3 覆盖面提醒）。
   - `escapes` 断言从 `[false,false,true]` 翻转为 `[true,true,true]`：**正当**（保留"修复前实测值"注释，翻转有据）。
   - "不得持有 Kernel"测试内的注释行改写（`kernel.port.read()` → `kernel[KERNEL_PORT].read()`）：表面性，无判据变化。
2. **`tests/namespace-writer-surface.test.ts`**
   - D-17 测试翻转（`leaks === []`，注释"修复前实测 `['k','raw']`"）：**正当**。
   - 新增"构造器路径不得成为第二条逃逸通道"断言（`ccc1449`）：**正当**，直接对应我报告的 P1-A；覆盖面局限见 P2-3。
3. **`tests/sql-guard.test.ts`**：`handle(tx)`（`(tx as {raw:Handle}).raw`）改 `withHandle(w, fn)`（`w.kernel[KERNEL_PORT].tx(raw => fn(raw))`）——**判据等价，非弱化**。两条路径取到的是**同一个 `guard()` 包装对象**（源码核对：`kernel.uow` 内 `this.#port.tx(raw => …)` 的 `raw` 即 `guard(this.adapter)` 的输出；`port.tx` 与本测试走同一函数），被检对象（`FORBIDDEN_KEYWORD` 头词/多语句/注释剥离判据）未变。且原写法是"顺着 D-16 的洞拿句柄"当夹具——洞一封测试就 TypeError；新写法使本文件语义与 D-16 封否解耦。测试侧持 `w.kernel` 属装配根特权，合法。
4. **`tests/arch-independence.test.ts` 的面哈希** `KERNEL_SURFACE.sha256`（`51e3a152…→74aa12fe…`）：预期内——`kernel.ts` 因 D-7 getter 形态 + E-00/E-01 + WeakMap 变化，face 源码哈希随之变化。
5. **`ccc1449` 其余**：`g0-gate.mjs` + `BASELINE.json` 为新增门禁资产（质量问题见 P1-B/P2-4）；`REVIEW.md` 与 sha256 为记录件。

**门禁数字核对**（`ccc1449`，worktree，任务指定命令）：
- `npx tsc -p experiments/v3-code-architecture-poc/tsconfig.json` → **exit 0**。
- `npx vitest run --config experiments/v3-code-architecture-poc/vitest.config.ts experiments/v3-code-architecture-poc/tests/` → **15 文件 95 例 0 红**（与作者新声称一致；`fa9c2d0` 旧口径全量 168/24 未重跑，见末节）。
- `node experiments/v3-code-architecture-poc/g0-gate.mjs` → 三流全 PASS（类型门 OK / 95 例全绿 / attacks 基线 31 条已知红精确相等）。

---

## 我没能验证的部分

1. `fa9c2d0` 全量口径（tests+attacks 合跑 168/24）未重跑——我的口径是任务指定的 `tests/` 目录 + `g0-gate` 的 attacks 基线流（`ccc1449`：95/0 与 31 红）。
2. E-00/E-01（eventsOf 作用域/授权面）行为不在 G0 四项范围，未裁定（其存在性已确认，不污染 G0 证据）。
3. 作者"`ccc1449` 新断言在旧提交 `0fba915` 上变异变红"的声称未重跑——持有等价证据（`fa9c2d0` 实测 `hasPeekRaw=true`）。
4. "双引号 import 违规 + 审查方文件被篡改"组合的运行时形态未做——正则盲点为静态复算 + 单引号红测实证。
5. vitest 版本升级导致 JSON 字段形态漂移的场景未验证（静态代码分析：解析失败路径是 fail-closed，不会假绿；字段语义未逐版本核对）。
6. 生产宿主真实插件交付路径（超出 PoC）未验证——PoC 内 `IntakeService`/`FacetStore` 签名与 `faceFor`/`uow` 交付面是插件视角依据。

## 我留下的文件

- 主树（只写这两个，均在本目录）：
  - `attacks/review/rereview-g0a-escape.test.ts` —— 攻击矩阵最终版（`ccc1449` 形态，5 例全绿；含 F1 构造器/描述器穷举、F2 闭包/回调/异常探针、symbol 通道残余、globalThis、扫描旁路矩阵）。
  - `attacks/review/RE-REVIEW-G0-A.md` —— 本报告。
- 已清理：worktree `.scratch/g0a-fa9c2d0`（含其内测试副本与 `node_modules` 符号链接）。
- 主树其它文件零改动（所有变异实验均在 worktree 内逐文件恢复）。

## 附录：交付时主树已推进至 `47cc386` 的独立复核（2026-10-30 会话末）

本报告主体判定的锚点是 `ccc1449`。写作完成时主树 HEAD 已推进至 `47cc386`（作者针对席位 A 中途报告的 P1-B/P2-1 的修复：仅改 `g0-gate.mjs`、`arch-independence.test.ts` 正则与三份文档，**未动 kernel/机制面**，故 G0 主体判定不受影响）。对该提交做了独立复验（不采信作者自述，全部重放）：

1. **P1-B 关闭（实测）**：重放两条假绿场景于真门禁——
   - SA（作者测试文件 import 损坏）：门禁 **FAIL**，两条独立理由同时命中：`tsc: …TS2882 Cannot find module` 与 `作者测试门 vitest 退出码=1，解析到的红条数=0`（退出码规则独立生效，不依赖 tsc）。
   - SB（整文件 `test→test.skip`）：门禁 **FAIL**，理由 `作者测试门出现 3 条 skip/pending —— 跳过不是通过`。
   - 逐文件恢复后主树干净（仅剩本目录两个新文件）。
   - 新门禁四道保护：退出码≠0 红 / `success=false` 红 / `skipped>0` 红 / 通过数下限 90；另给 attacks 流加了"0 通过且 exit=0"整目录未收集保护。
2. **P2-1 关闭（实测）**：双引号违规 `import { KERNEL_PORT } from "../kernel/internal.ts";` 植入 `src/domains/test-facet.ts` ⇒ D-7 测试红（`1 failed | 10 passed`）⇒ 逐文件恢复 ⇒ `11/11` 绿。（本报告攻击测试内 `G0A-SCAN` 复算的是 `ccc1449` 时的旧正则，作为历史记录保留。）
3. **最终全门禁（`47cc386`，主树）**：`g0-gate.mjs` **PASS** —— 类型门 OK / 作者流 `95 例全绿（skip=0，exit=0，success=true）` / attacks 基线 `31 条已知红精确相等`。注意：该轮 attacks 流同时收集了本席位 `rereview-g0a-escape.test.ts` 与席位 B `re-review-g0b-attacks.test.ts`，失败集合仍与基线精确相等 ⇒ 两席位文件在当前提交上均为绿。

**更新后的总判定**：G0 命题（插件可见对象携带机制句柄）于 `ccc1449` 封住（双状态实测）；门禁假绿缺陷（P1-B）与 import 正则盲点（P2-1）于 `47cc386` 修复并经本席位独立复验。仍开放的记录项：P2-2（writer `cap` 自有字段泄露）、P2-3（构造器断言覆盖面仅限静态成员）、P2-4（基线 `generated_from_commit` 不参与校验）——均为 P2，不阻塞"封住"结论。

## 关键复现命令

```
# 攻击矩阵（ccc1449 形态）
npx vitest run --config experiments/v3-code-architecture-poc/vitest.config.ts \
  experiments/v3-code-architecture-poc/attacks/review/rereview-g0a-escape.test.ts
# import 禁令红测（worktree 内）
printf "\nimport { KERNEL_PORT } from '../kernel/internal.ts';\n" >> experiments/.../src/domains/test-facet.ts
npx vitest run --config experiments/.../vitest.config.ts experiments/.../tests/arch-independence.test.ts   # ⇒ 1 failed
git checkout -- experiments/.../src/domains/test-facet.ts                                                    # ⇒ 11 passed
# g0-gate 假绿（worktree 内）
printf "\nimport 'g0a-nonexistent-module';\n" >> experiments/.../tests/empty-vs-absent.test.ts
# 按 g0-gate 同逻辑解析 tests/ 流 JSON：{"exit":1,"success":false,"failed":0,"passed":92} ⇒ 门禁假绿
# 门禁全量
npx tsc -p experiments/v3-code-architecture-poc/tsconfig.json        # exit 0
node experiments/v3-code-architecture-poc/g0-gate.mjs                # PASS（95 绿 / 31 基线红）
```
