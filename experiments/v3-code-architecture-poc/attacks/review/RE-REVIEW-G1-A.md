# 独立复验 G1-A —— commit `8a9624b`（D-19c 收口 / G-2b 门禁 / E-00 eventsOf）

复验席位：**G1-A**（攻击位，非确认位）。分支 `poc/v3-code-arch-20261030`，被复验提交
`8a9624bd88c3e3d132332001599bf0efe53b498d`（`8a9624b`，"D-19c 收口——Intake 归位用例层"）。
工作树：`.scratch/wt-g1a`（@ `8a9624b`，修复后）与 `.scratch/wt-g1a-pre`（@ `e4fd27a`，修复前）。
本报告只写入主树这一个文件；未改作者任何文件；未 `git add/commit`。

**判定口径**（两条分开说，不互相抵扣）：
① **接口权威越权**——机制是否说了不做（做了它声明不允许做的事）；
② **现实可利用性**——Q18/Q20 的第一版前提是同进程可信插件，这一条**压低**可利用性，但**不取消**①。
下文每条发现都分别给这两个结论。定级按我自己的判断，不因作者已登记或已认错而调整。

---

## ① 一句话裁决（含我的定级）

| 项 | 裁决 | 我的定级 |
| --- | --- | --- |
| **A. D-19c 领域写权威边界** | **不通过（部分收口）**：被复验的那个**实例**确实关闭了（PF-1↔修后源码互证），但使它能发生的**形态**仍开着，且我在此边界上新找到两处独立缺口 | 新洞 **N1 = P1**、**N2 = P1**；**D-20 抬为实质 P1**；**D-21 后果升级（P2→P1）**；**D-22 P2→P1** |
| **B. G-2b 门禁收集期分类** | **不通过**：仍能做出**假绿**——审查方流根本不判退出码/`success`（G-1 修过的同一形态在第三条流上从未补上）；覆盖面缩水只要基线同步重算就无人可拦 | 门禁 **G-1' = P1**；**G-2' 名字身份可掏空 = P2**；**G-3' 基线无外部锚 = P2（结构性）**；**G-4' 作者下限失效 = P2**。② 计数语义与 ⑤ 字段漂移我**没能**攻破，如实记为判据成立 |
| **C. E-00 `eventsOf` 跨能力读授权** | **通过**（首次独立复验）：拒绝/放行/撤销三态正确，**撤销对同一进程内已发出的窄面确实失效**；`readOwn`/`writerFor().readLatest`/`revisionOf`/`tx` 四条路都没有载荷旁路；开权撤销都要 `capability-admin`，插件面无从触发 | 唯一问题是 **E-01 = P2**，且泄露面比你登记的**宽一项**：不只"存在"，还有**归属者身份** |

**必须收窄的声明（原文位置 + 收窄后的措辞）**

- 原文（`CONTRACTS.md` §16 末段、`src/app/delegation.ts` 文件头、`tests/domain-write-face.test.ts` 文件头第 1 段）：
  "**运行时作用域上界是墙**……领域拿到的是 scoped tx（`kernel.uowFor(cap,…)`）或能力作用域端口……跨归属就是 `CAPABILITY_SCOPE_ESCAPE`。这是机制保证，与源码怎么写无关。"
- 实测边界：**墙只对 `kernel.uowFor(cap,…)` 取到的那一条事务生效**。凡装配根把 `uow()`（`scope='assembly'`，`kernel.ts:521` 缺省）产出的事务交进领域对象——`ValidationService` 的 `runIn`（`src/domains/test-records.ts:158`）、任何接 `UnitOfWork` 形参的领域服务（`FacetStore.write`）——墙上**没有这一层的执行点**，唯一拦阻是那张被自曝为可绕的词法网。
- 收窄为：**「D-19c 已收口——仅限经 `uowFor` 取得的领域事务路径；装配根交入领域对象的全权事务路径未收口（D-22），该路径上'墙'不成立，只有网。」**

---

## ② 攻击矩阵

"预期"= 我认为机制**应当**做到什么；"实测"= 跑出来的事实；"成立?"= **判据是否守住**（守住 = 我没能攻破）。
每条都是可跑测试，文件名 + 用例名即定位。

### A 组（`attacks/review/g1a-A-write-authority.test.ts`，18 例，修后 18/18 攻击成功 = 18 条都越权成功）

| # | 尝试 | 预期 | 实测 | 成立? | 证据 |
| --- | --- | --- | --- | --- | --- |
| A-1 | `writerFor(tx).write()` 把 `domain_state` 行种到**不存在的 oid** | 拒（oid 必须在目录里且归我） | 提交成功，行落库 | **否** | `kernel.ts:614` 只判 `a.ns !== this.ns`；`:619` `insert into domain_state(...oid...)` 原样取参 |
| A-2 | `write()` 种**他人 oid 的不存在修订**（victim 只有 rev1，种 rev99），再提 `required` 边 | 拒（RD-05 精确引用） | `required:true` 边提交成功 | **否** | `kernel.ts:934` `select 1 from domain_state where oid=? and revision=?` **不带 ns** ⇒ 我 ns 里的伪造行被判"存在" |
| A-3 | `linkRef` 的 `from` 用**幽灵 oid**（不在 object_directory） | 拒 | `if (src)` 为假 ⇒ 归属判定整段跳过；跨能力 `required` 边提交成功，`impactCandidates()` 收到攻击者投递的反向依赖 | **否** | `kernel.ts:805-807` |
| A-4 | 拿 `writerOwningKind(A 的 kind)` 得到端口后写 B 的 kind（端口/kind 错配） | 拒 | `CAPABILITY_SCOPE_ESCAPE` | **是** | `#assertScope` `kernel.ts:698`；二次校验存在 |
| A-5 | `transferRoute` 之后复用**移交前**取到的端口 | 不产生第二个权威 | 作用域仍跟旧能力走 ⇒ 越界被拒，无新权威 | **是** | 归属在写入时查注册表 |
| A-6 | 由**无关的第三个能力**在 scoped tx 里对**他人对象** `appendLedger` 一条 `synth:fact-designation` + `note:'AUTHORIZED'`，principal **无** `domain-admission` | 拒或至少不进投影 | **`standingAt()` 由 `NOT_ADOPTED` 翻成 `ADOPTED`** | **否** | `appendLedger` 不判 objectId 归属（D-20）；投影 `test-records.ts` 只看 `note` |
| A-7 | `declareRecord` 抢占 `RPT-${未来 seq}`（seq 可预测，与 D-12 同族） | 拒（归属/命名空间） | 下一份校验报告登记当场 `RECORD_ALREADY_DECLARED`，整条事务回滚 | **否** | D-21 的后果实例：**可阻断他人的校验落库** |
| A-8 | 只持有 `ValidationService` 实例（不持 world/kernel），从运行时面取回 `runIn` 并 `tx.revise(他人对象)` | 领域实例不该有全权事务 | 改写成功，`readObject` 读到 `REWRITTEN-BY-DOMAIN` | **否** | `test-records.ts:158` TS `private readonly` 参数属性 = 运行时**自有可枚举字段**（= 本仓 D-17/P2-2 的同一条教训） |
| A-8b | 同一条装配作用域事务跨归属 `createObject` / `linkRef` | 同上 | 全部成功，落库 `owner_capability` = 别人 | **否** | `scope='assembly'` |
| A-9 | 拼接成员名 / `Object.getPrototypeOf(tx)['rev'+'ise']` / `Reflect.get` / `Reflect.apply` | **运行时**拦住（网本来就声明不拦） | 四条全部被拒（`Reflect.apply` 因 `#private`  receiver 抛 TypeError，也是拒） | **是** | 墙在 `uowFor` 路径上确实活着 |
| A-10 | 把 scoped tx 存进闭包，**事务结束后**再调用 | 不产生新的写窗口 | 跨归属写仍被拒（归属墙在），但**本能力**的迟到写**直接落库**（`object_directory` 多一行） | **否** | `kernel.ts:529-535` 提交点唯一；`sqlite-port.ts:288-304` `commit` 后句柄未失效 ⇒ autocommit |
| A-12 | 用**已结束**的事务句柄写一条 `required:true`、目标记录不存在的边 | 与真事务同判（`REQUIRED_REF_MISSING`） | `NO_REFUSAL`；随后**任何人**的提交都被这条悬空边拒绝 = **空间级写阻塞** | **否** | `checkRequiredRefs` 全表扫 `where required=1`（`kernel.ts:909`）无事务过滤；对照实验：同一条边写在真事务里当场红 |
| A-12b | 旧句柄连写两笔后抛错 | 原子（Q40） | 第一笔仍在库里 = **无事务即无回滚** | **否** | 同上 |
| A-12c | 同一形态经**领域路径**触发（`uowFor` 的 scoped tx 被扣住） | 同上 | 同样成立；领域侧后续正常写也被悬空边拒绝 | **否** | 不是只有装配根能做 |
| A-13 | `write()` 把别人 oid 的行种进自己 ns 后读回 | 读不到别人的对象 | 自己的 `readLatest(他人oid)` 返回"该对象第 7 修订 = 我伪造的 payload" | **否** | `readLatest` 按 `ns=<自己>` 过滤，恰好命中自己种的行 |
| A-13b | `readAsOf` 双时间读面是否按 ns 过滤 | 只端出有权看的行 | **不按 ns 过滤**：伪造行作为他人对象的一条状态行被端出（附 payload） | **否** | `read-context.ts`；`ns` 只用于 `serveable(oid)` 目录判定 |
| A-14 | `write()` 是否顺手写 `ledger` | 不注入他人事件流 | `ledger` 出现 `object_id=他人 oid` 的事件，且**带 journal 行 ⇒ 通过投影缺口检测** | **否** | `kernel.ts:625` |
| A-11 | 从 `face` / `writer` / `tx` 穷举原型链 + symbol 找机制句柄 | 拿不到 | `kernel/port/raw/uow/namespacedWriter/grant*/transferRoute/…` 全部为 0 命中 | **是** | 插件面上 0 个 symbol；`WeakMap` 映射没漏（`.constructor` 逃逸同族已修） |

### C 组（`attacks/review/g1a-C-events-of-scope.test.ts`，10 例，修后与修前**同一结论**）

| # | 尝试 | 预期 | 实测 | 成立? | 证据 |
| --- | --- | --- | --- | --- | --- |
| C-1 | 未授权窄面读他能力对象事件载荷 | 拒 | `NAMESPACE_ESCAPE` | **是** | `kernel.ts:455-461` |
| C-2 | **授权前就发出的 face**，授权后不重建直接读 | 按授权状态 | 立即放行并给出载荷 | **是**（判定在调用时） | `kernel.ts:455` 读 `#crossEventRead` |
| C-3 | 撤销后**已发出的 face** | 立即失效 | `NAMESPACE_ESCAPE`；且撤销不会顺手关掉"读自己对象" | **是**（**这是你问的那条，答案是肯定的**） | 同上 |
| C-4 | 无 `capability-admin` 者 `grantCrossEventRead` / 假撤销 | 拒 | `AUTHORITY_REQUIRED`；撤销不生效 ⇒ 授权仍有效 | **是** | `kernel.ts:439/443` 走 `assertAuthority` |
| C-5 | 装配表 `CROSS_EVENT_READ` 的默认放行面 | 装配期写死、插件无从触发 | 确认：`cap.test.records` 默认能跨读；`face` 成员恰好 6 个，无 grant/revoke | **是**（但记一句：装配表**没有撤销入口**，撤销只在测试里被调用过） | `world.ts:33/61-63` |
| C-6 | `readOwn` / `writerFor(tx).readLatest` / `revisionOf` / `tx` 上找事件面 | 都拿不到别人载荷 | 前两者 `undefined`，`revisionOf` 恒 `NAMESPACE_ESCAPE`，`tx` 上无 `eventsOf/eventsFor/events` | **是** | — |
| C-7 | 猜对 `eventType`（含 `object-registered`、`'*'`） | 拒（判据只看归属） | 全拒 | **是** | — |
| C-8 | 对象图遍历找 `eventsFor`；symbol 通道 | 插件拿不到 Kernel | 4 层深度 + 原型链 0 命中；`face` 上 0 个 symbol；`KERNEL_PORT` 挂在 **Kernel 原型**上（可枚举，但要先有 Kernel 实例） | **是** | `internal.ts` + `arch-independence` 门禁 |
| C-9 | 用未授权窄面**枚举对象目录**（E-01 × D-12） | 拒读与不存在**同形** | **不同形**：按 `OBJ-SP-G1C-<n>` 探 12 个，逐一指出**哪 4 个存在**，其余返回空数组；`Refusal.detail.owner` **直接给出归属能力 id** | **否** | `kernel.ts:459` `{capability, oid, owner, reason}` |
| C-10 | `readAsOf` / `Projection` 是否按能力设界 | 装配根级读面不设界是设计属性 | 确认能读全空间；但两者都必须传 `Kernel` 实参，`face` 上无 `KERNEL_PORT` ⇒ 插件不可达 | **是**（记录边界，不是洞） | — |

### B 组（门禁）——实验与结论

| # | 攻击 | 结果 | 结论 |
| --- | --- | --- | --- |
| **B-①** | 审查方新增文件：**断言全通过，但 `afterAll` 抛错** ⇒ vitest `exit=1 / success=false` | 门禁打印 `[3/3] OK —— 与基线完全一致`、`PASS`、**exit 0** | **假绿成立**。根因：第三条流从头到尾**没判过 `v.status` 与 `v.success`**（作者流 `g0-gate.mjs:86-89` 判了），而 `loadErrors` 规则要求"该文件 0 条断言"（`:61`），有断言就漏 |
| B-② | `it.todo` / `describe.skipIf(false)` / `describe.skipIf(true)` / `test.concurrent` / `it.skip` | `todo`/`skip` 的 `status` 是 `todo`/`skipped` ⇒ 落进 `skipped` ⇒ **两条流都红**（`:90`、`:119`）；`skipIf(false)` 与 `concurrent` 正常计入通过 | **没能攻破**。`numTotalTests=7` 里含 2 skipped + 1 todo ⇒ 总数也骗不过 |
| B-③ | 一条**真判据红条**入基线并绿 → **把判据掏空成 `expect(1).toBe(2)`**，名字与红状态一字不变 | 两次都 `PASS` | **按名字身份比对 = 可掏空**。机验改进（已实测可行）：基线对每条已知红记 **归一化后的 `failureMessages[0]` 摘要**——同一名字、同一 `status:'failed'`，真判据哈希 `cea44fd1741c` vs 掏空版 `17506aa47500` ⇒ 可分辨 |
| B-④ | ① 真实做法：删掉我自己的审查方文件（2 例）+ 基线按新现实重算；② 替身 vitest 伪造"整份文件没被收集 + total 同步调小"配一份自洽基线 | ① `155→153`，两次都"与基线完全一致"；② `125→120` 配自洽基线 ⇒ `PASS` | **自洽即通过，基线无外部锚**（详见 ③G-3'） |
| B-⑤ | vitest 字段漂移：`numTotalTests` 改名 | `total \|\| (failed+passed+skipped)`（`:74`）⇒ total 变成**自算回退值**，`:120` 的 total 判据自此**永不自证失败**；本次因名字集合也缺了一份，被 `pGone` 抓住 | 单独不致命（覆盖面判据还在），但**total 判据在这类漂移下静默失效**，属"判据悄悄变成自己证自己" |
| B-⑤b | 替身 `npx` 语法错误（输出不可解析） | `FAIL`（"无法解析 vitest 输出"） | **fail-closed，如实记为通过** |
| B-⑥ | 作者流下限：伪造"90 例全绿 0 红 0 skip exit 0" | **`PASS`**（打印 "90 例全绿"） | `AUTHOR_MIN_PASSED = 90`（`:34`）而实际 **118** ⇒ **28 例（24%）作者测试可以凭空消失而门禁仍绿**；注释还写着"作者侧当前 95 例"，说明这个数**从未随基线重锚** |
| B-⑦ | N1 后果持久性：悬空 `required` 边能否清除 / 跨重开是否仍阻塞 | `delete from ref_edge` 被 append-only 触发器拒；**重开库文件后无辜提交仍 `REQUIRED_REF_MISSING`** | N1 的破坏是**永久且不可自愈**的（只能人工动库） |

**我给 G-2b 的净评价**：G-2b 修对了它要修的那件事（覆盖面按名字双向比对，`pAdded/pGone`），但**没有把"这一条流的进程结论"纳入判定**——这与 `47cc386`（G-1）给第二条流修的是同一形态，修第二条时没顺手修第三条。G-1 自己在 `:42-44` 写的注释就是这个洞的说明书："**退出码与 success 必须单独判，不能只看断言计数**"。

**我实测过的改进规则（零误报）**：把"该文件 0 条断言"改成"**该文件 `status==='failed'` 而其中 0 条 `failed` 断言 ⇒ 判为收集/清理期失败**"，在当前 attacks 上跑：**命中 1 份（正是我的 afterAll 夹具），11 份已知红文件零误报**。

---

## ③ 新发现（按级；每条给"修复前 / 修复后"两态）

**两态的论证方式**（按你的要求写成论证，不留白）：
`git diff --numstat e4fd27a 8a9624b -- src/kernel src/contracts g0-gate.mjs attacks/BASELINE.json` = **空**。
⇒ N1/N2/E-01 所在代码在两个提交**逐字节相同**，"修前可复现 + 修后可复现"由代码同一性直接成立，不依赖我再跑一遍。
我仍然跑了第二工作树做交叉验证：把 A/C 两组攻击文件按**最小改动**（`w.uowFor`→`w.kernel.uowFor`、`FactStandingPolicy`→`FactStandingService`，两处都是修前后改名差异）搬到 `e4fd27a`：
**A 组 17/18 同样成功**（第 18 条 A-6 的核心断言——`standingAt → ADOPTED`——在修前也成立，只有它末尾一句"走正当入口应得 `AUTHORITY_UNVERIFIED`"的对照行调用了修后才存在的 `designationEvent`）；**C 组 10/10 同一结论**。
⇒ **N1、N2、D-20、D-21 后果、D-22、E-01 与 D-19c 无关，属本提交未触及的既有面；D-19c 的改动全部落在 `src/app`（新增）、`src/domains/test-records.ts`、`src/harness/world.ts`、`tests/`。**

---

### N1（建议登记为 **D-23**）— 事务句柄在事务结束后仍然可写：**P1**

**新洞**，不是 D-20/D-21 任何一条的后果（那两条判的是"谁有权写哪一行"，这一条判的是"**什么时候还能写**"，两者正交）。

- **形态**：`uow`/`uowFor` 的回调返回后，被扣住的 `UnitOfWork` 句柄仍然可调用；此后的写走 SQLite **autocommit** 直接落库。提交点只有一个（`kernel.ts:533`），句柄没有失效位。
- **后果链（全部实测）**
  1. **`RF-02`/`RD-05` 提交期判据被整条绕过**：`checkRequiredRefs` 只在 `uow` 末尾跑；旧句柄上写的 `required` 边没有提交点 ⇒ 悬空硬引用落库。
  2. **空间级永久写阻塞**：`checkRequiredRefs` 是**全表**扫 `where required=1`（`kernel.ts:909`），无事务/能力过滤 ⇒ 此后**任何人**的任何提交都被这条边拒绝；`ref_edge` 有 append-only 触发器删不掉，**重开库文件仍阻塞**（B-⑦）。
  3. **`Q40` 原子性反例**：旧句柄连写两笔后抛错，第一笔仍在库里。
- **可达性**：`uowFor` 的 scoped tx 同样成立（A-12c）⇒ 领域路径即可触发，不需要装配根。当前 `src/**` 里**没人**扣住句柄（唯一持有事务的东西是 `ValidationService.runIn`，且它是回调不是句柄），所以这是"**缺生命周期执行点**"，不是"已被滥用"。
- **①接口越权**：成立——机制声明"事务内确实存在，否则整体回滚"（`#44 §7.3`），而存在一条路径让这句话根本不被执行。
  **②可利用性**：中低（需同进程代码主动扣句柄），但**后果是不可逆的空间级 DoS**，两者相乘我给 P1 不给 P2。
- **修复方向（不含实现，供你裁）**：`uow()` 返回时把该 `UnitOfWorkImpl` 置 closed（模块级 `WeakSet` 或实例 `#closed`），任何后续写面入口先查 closed ⇒ 新错误码 `TX_CLOSED`；同时 `checkRequiredRefs` 的扫描范围加 `where` 限定到本事务新写的边（否则一条脏边永久连坐全体）。

### N2（建议登记为 **D-24**）— `NamespaceWriter.write()` 只判 `ns`、从不判 `oid`：**P1**

**新洞**，写侧归属检查的**第三处**缺口（D-20 是 ledger 面，D-21 是 linkRef 目标端，这一条是 `domain_state` 写面本身，三者互不覆盖）。

- **形态**：`kernel.ts:614` 只拦 `a.ns !== this.ns`；`oid`/`revision` 原样取参写 `domain_state`（`:619`）与 `ledger`（`:625`）。
- **落点（5 条，全部实测）**：种幽灵 oid（A-1）；**伪造修订级硬引用**（A-2，因 `:934` 的修订判据不带 ns）；幽灵 `from` 使 `linkRef` 归属判定整段跳过（A-3）；`readAsOf` 不按 ns 过滤 ⇒ **伪造行作为他人对象的状态行被端出**（A-13b）；注入他人对象事件流**且带 journal 行、通过投影缺口检测**（A-14）。
- **①接口越权**：成立——`CONTRACTS` §16 表格里 `NamespaceWriter` 的授权范围写的是"**仅本能力拥有的对象**"，而 `write()` 这个成员允许对**任意 oid** 落笔。
  **②可利用性**：中（需插件主动用 `write()` 而非 `createOwned/reviseOwned`，且 `write()` 的既定用途是扩展登记的修订）。
- **修复方向**：`write()` 入口补 `#assertScope(目录里该 oid 的 owner)`；oid 不在目录 ⇒ 拒（现在**完全不查**）；`checkRequiredRefs` 的修订级判据加 `ns` 归属条件。

### D-20 —— 我从"P1 候选"抬为**实质 P1**

判据按你给的条件：**必须证明 `standingAt` 对他人对象返回 `ADOPTED`（伪造业务授权），而不只是脏数据**——A-6 正是如此：无关能力、无 `domain-admission` 的主体，一条 `note:'AUTHORIZED'` 的伪造声明让投影翻成 `ADOPTED`。
对照锚点（这是它为什么是洞而不是"设计"）：走正当入口，同一未授权主体只能得到 `AUTHORITY_UNVERIFIED` 且**不进投影**。**同一句话，走领域自愿路径就被信任**——差别只在调用者是否自愿。

### D-21 —— 后果比你登记的硬：**P2 → P1**

你登记的是"能挂一条指向他人对象的边（含 required）"。我实测到的落点是 **A-7：抢占可预测的 `RPT-${seq}` ⇒ 他人的校验报告登记当场 `RECORD_ALREADY_DECLARED`，整条事务回滚** = 可**阻断他人落库**；外加 A-3 的"幽灵源端连归属都不判"。这不是可读性/卫生问题，是可用性 + 完整性。

### D-22 —— 我同意不是 P2，给 **P1**，并给出"收口"边界的精确写法

见 ① 末段。**需要收窄的claim 有三处**（`CONTRACTS.md` §16 末段 / `src/app/delegation.ts` 文件头表格 / `tests/domain-write-face.test.ts` 文件头第 1 段），三处都写了"墙 = 运行时作用域上界"而无条件限定。
补一句：**A-8 用的是 TS `private readonly` 参数属性在运行时是自有可枚举字段**——这正是本仓 `READINESS` 里 D-17/P2-2 已写下过的同一条教训，在另一处重犯。所以这条不只是"接线没接好"，而是"**同一课没跨文件生效**"，登记时值得点名。

### E-01 —— P2（不变），但泄露面比登记宽

登记写的是"拒绝本身泄露该 oid 存在且属他人"。实测泄露**两件事**：存在性 + **归属者能力 id**（`detail.owner`），且 C-9 已用它把 12 次探测还原成"哪 4 个 oid 存在、各归谁"。修复方向不变（拒读与不存在同形 = 返回空数组）即可**同时**消掉两项。
定级理由：同进程可信插件前提压低现实可利用性，但接口越权成立 ⇒ P2 而非 P1。

### 门禁发现

| id | 级别 | 内容 | 机验改进 |
| --- | --- | --- | --- |
| **G-1'** | **P1** | 第三条流不判 `v.status` / `v.success` ⇒ 审查方文件在断言之后崩溃 = 门禁绿（B-①）。同一形态 `47cc386` 已在第二条流修过 | 两条并行：① `v.status !== 0` 且 `v.success === false` 时必须给出定性；② `loadErrors` 规则从"0 条断言"改为"**该文件 status=failed 且其中 0 条 failed 断言**"（我实测零误报） |
| **G-2'** | P2 | 已知红按**名字**比对 ⇒ 判据可被掏空而门禁不变（B-③） | 基线每条已知红增记"归一化 `failureMessages[0]` 摘要"；名字+状态一致而消息变了 ⇒ 红"判据被换掉，须重新定性"。可行性已实测（两个哈希不同） |
| **G-3'** | P2（结构性） | **基线自证**：覆盖面缩水只要基线同步重算就完全静默（B-④）；`generated_from_commit` 只要求是 HEAD 的祖先，不要求内容真来自那个提交 | 唯一我认为可靠的解法，与你的猜测同向但要多一环：**基线由门禁自己在临时干净 worktree（`git worktree add --detach <b>`）重算，逐字段比对，并额外要求"重算所用的 worktree 里 `attacks/**` 的文件清单哈希 == 基线里登记的清单哈希"**。只绑提交号不够——同一提交上也可以重算出不同清单（`passes` 是从**运行结果**生成的，运行面变了基线就跟着变）；必须把"**收集到的文件清单**"本身作为被锚定的量，才能把"某份审查文件不再被收集"从"重算即合法"变成"清单哈希不一致 ⇒ 红" |
| **G-4'** | P2 | `AUTHOR_MIN_PASSED=90` vs 实际 118（B-⑥），注释还停在"当前 95 例" ⇒ 28 例作者测试可消失 | 下限从"人写常数"改成"从 `git show <基线提交>:tests/` 或 `BASELINE.json` 里登记的作者用例总数**按比例推出**"，并在门禁里断言"实际通过数 ≥ 登记数 × 0.98"；至少：每次新增测试必须同时改这个数，否则注释与数值必然再度漂移（本次已经漂了） |
| （非缺陷） | — | ② 计数语义、⑤ 字段漂移下的名字判据、不可解析输出 → 都 **fail-closed** | 如实记为**判据成立**，我没有攻破 |

---

## ④ 逐 hunk 裁定（`git show 8a9624b`，12 文件 / +846 −42）

| hunk | 裁定 |
| --- | --- |
| `src/app/delegation.ts`（新 +45） | **接口本身干净**：只有 `writerOwningKind/writerOf`，无 `uow/port/raw`；A-4/A-5 我独立打了一遍，端口/kind 错配与移交后复用都没有产生第二个权威。**但文件头那张表把 `src/domains/**` 写成"零通用写面 ⇒ 只能经自有端口"，读起来像"领域拿不到全权事务"**——A-8 证否。表下需加 D-22 限定句 |
| `src/app/intake-use-case.ts`（+96）/ `standing-use-case.ts`（+32） | **本层没有新洞**：`#writeOwned` 走 `writerOwningKind(kind,tx).createOwned/linkOwned`，机制级写只有 2 处带 `D-19c-ALLOWED` 的 `appendLedger`。但 `standingUseCase.declare()` 的授权判定是**自愿生效**的（A-6 从旁边绕过去了），这里应加一句"本用例不构成对 `synth:fact-designation` 的权威把关" |
| `src/domains/test-records.ts`（±126） | **收口的实例是真的**：`createObject/linkRef/appendLedger` 的 5 处调用全部从此文件删除（我核了 diff 的删除行），改为只产草稿。**但 `ValidationService` 的 `runIn` 原样留着**，且 `IntakePolicy` 的兄弟类仍收 `UnitOfWork` ⇒ 这就是 D-22 未收口的具体位置（`:158`） |
| `src/harness/world.ts`（+56） | 装配集中化方向正确；`writerOf/writerOwningKind/useCaseDelegation/intakeUseCase/standingUseCase` 都只在装配根可达（A-11 佐证）。**注意**：`CROSS_EVENT_READ` 是硬编码表、无撤销入口（C-5），与你 C 项"撤销粒度"无关但值得登记一句 |
| `tests/domain-write-face.test.ts`（新 +261） | **不是"测试冒充实现"**：墙段 3 条是真运行时判据（A-9 独立复现），网段自曝边界并有"负空间"用例钉住"扫不到"——这是本仓少见的诚实写法。**问题只有一个**：文件头第 1 段把"领域拿到的是 scoped tx"当作既成事实陈述，而 `ValidationService` 这条装配接线恰好反例存在。**没有放宽任何判据**（diff 里没有一条被删的 `expect`） |
| `tests/use-case-write-path.test.ts`（新 +227） | 5 条主判据（归属不变 / Q40 原子 / 委派不多给权限 / 归属查注册表且随移交跟随 / 用例不持有事务入口）都站得住，⑤ 还做了对象面穷举。**唯一要改的是最后一条**："已知残留（钉的是现状）"`expect(code).toBe('NO_REFUSAL')`——把 **D-20 现状钉成了期望行为**。你的注释诚实（"谁补谁红，届时翻正"），但按我给出的 A-6 后果，这条现在**同时在为一条 P1 打绿灯**；建议改成 `it.fails` 风格或改名"已知 P1 未修"，让它在 READINESS 被关单时必须动笔 |
| `tests/p3-intake-validation.test.ts`（+9/−4）、`tests/xc28-detectability.test.ts`（+5/−5） | 只改装配接线（`new IntakeService(...)` → `w.intakeUseCase()`）。**逐行核过删除行：没有任何 `expect` 被删或弱化 ⇒ 不存在"为变绿放宽判据"** |
| `CONTRACTS.md` §16（+9）/ `EVIDENCE.md`（+17）/ `READINESS.md`（+5） | 三处都写"运行时作用域上界是墙"而无路径限定 ⇒ 见 ① 的收窄措辞。`EVIDENCE` 里"**内核与契约 git diff = 0 行 ⇒ 面哈希不漂移**"这句我复核为**真**，而且它恰好是 N1/N2 属既有面的证据（作者把它当卖点，我把它当两态论证的锚，两不冲突） |
| `g0-gate.mjs`、`attacks/BASELINE.json` | **本提交未改**（`git diff --stat` 为空）⇒ B 组发现不能记在 `8a9624b` 头上；B 的"修复前"对照取 `6d4ac39`（G-2b 之前）——我核过：G-2b 加的是覆盖面双向比对，**`v.status` 判据修前修后都没有**（`grep -c 'v.status !== 0'` = 0），所以 G-1' 是"修前存在、修后仍在"，与 `af2aea5` 的修复无关 |
| 变异验证 M1–M4（作者自述） | 我**不复现**（不复现别人的变异是纪律，也是省事）：我只做我自己的攻击。但 M2 声称的"改内核 ⇒ 面哈希当场红"我无需依赖：我用的是 diff 为空这一更强的论证 |

**"洞被做成夹具"这一项我确实抓到一处**：`use-case-write-path.test.ts` 最后一条（上表）。它是**有注释、有意的**，我不判它"隐瞒"，但判它**分类错误**——P1 不该以"现状断言"的形式常驻绿区。

---

## ⑤ 我没能验证的（诚实清单，不凑数）

1. **N1 在真实使用中的触发前提**：我证明了"句柄可用 + 判据被绕 + 后果永久"，但**没找到**今天 `src/**` 里任何一段代码会扣住句柄（`grep 'private .*tx'` 只命中 `test-facet.ts` 的形参与 `runIn`）。"谁会第一个扣住句柄"我无从验证。
2. **`it.only` / worker 被 SIGKILL 的分类**：我推演 `it.only` 会因 total 缩水被抓住，但**没有实跑**（它需要往作者文件里插 `.only`，越界）。kill worker 同理未跑。
3. **真实 vitest 版本漂移**：我的 ⑤ 用的是替身 `npx`（伪造字段），**没有装第二个 vitest 版本**去验证"新版本真的会改名"。结论只到"门禁对字段缺失的容忍方式不安全"，不到"某版本会触发"。
4. **E-00 的持久性维度**：`#crossEventRead` 是内存 `Set`、不落库——我确认了撤销即时生效，但**没验证跨进程重启后授权面应否存在**这一产品语义（READINESS 未写，我也不替你决定）。
5. **`readAsOf` 在生产装配里的暴露面**：A-13b 的投影污染我只在装配根可达路径上证到（`arch-independence` 门禁保证插件不可达）。若将来把双时间读面开放给某个受限插件，这条会从"数据被污染"升级成"越权读取"，我没有那条路径可测。
6. **B-④ 的"作者会不会真的这么干"**：我演示的是**门禁能力边界**，不是动机指控。删审查方文件在 git diff 里可见，我说的是"门禁不会替你挡"。
7. **面哈希门是否对所有内核改动都活**：我只信了自己的 diff 论证，没有重复作者的 M2 变异。

---

## 复现命令

```bash
# 主仓根目录
git -C /home/user/dsh-plugins/dsh-research-control worktree list   # 本报告写完时两个 worktree 已移除

# 两个工作树（复现时自行重建）
git -C /home/user/dsh-plugins/dsh-research-control worktree add .scratch/wt-g1a 8a9624b
git -C /home/user/dsh-plugins/dsh-research-control worktree add .scratch/wt-g1a-pre e4fd27a
ln -s ../../node_modules .scratch/wt-g1a/node_modules
ln -s ../../node_modules .scratch/wt-g1a-pre/node_modules

cd .scratch/wt-g1a
# 门禁基线（三条必须与作者自述一致）
npx tsc -p experiments/v3-code-architecture-poc/tsconfig.json
npx vitest run --config experiments/v3-code-architecture-poc/vitest.config.ts experiments/v3-code-architecture-poc/tests/
node experiments/v3-code-architecture-poc/g0-gate.mjs

# A 组 18 例 / C 组 10 例（全绿 = 攻击全部成功 = 全部越权）
npx vitest run --config experiments/v3-code-architecture-poc/vitest.config.ts \
  experiments/v3-code-architecture-poc/attacks/review/g1a-A-write-authority.test.ts \
  experiments/v3-code-architecture-poc/attacks/review/g1a-C-events-of-scope.test.ts

# 两态论证（无需再跑测试即可成立的那一步）
git diff --numstat e4fd27a 8a9624b -- experiments/v3-code-architecture-poc/src/kernel \
  experiments/v3-code-architecture-poc/src/contracts experiments/v3-code-architecture-poc/g0-gate.mjs \
  experiments/v3-code-architecture-poc/attacks/BASELINE.json     # 输出为空

# 修复前对照（e4fd27a；需两处改名适配：w.uowFor→w.kernel.uowFor，FactStandingPolicy→FactStandingService）
cd ../wt-g1a-pre && npx vitest run --config experiments/v3-code-architecture-poc/vitest.config.ts \
  experiments/v3-code-architecture-poc/attacks/review/g1a-A-write-authority.test.ts

# B-①：审查方文件 afterAll 崩溃而门禁绿（夹具见 attacks/review/g1a-B-E1-afterall.test.ts）
#   实测：vitest exit=1 / success=false，但 g0-gate 打印 PASS、exit=0
# B-⑥：AUTHOR_MIN_PASSED 空档
grep -n 'AUTHOR_MIN_PASSED' experiments/v3-code-architecture-poc/g0-gate.mjs   # = 90，实际 118
```

> 本报告里的攻击夹具（`g1a-B-*`）与两个攻击主文件都在 `.scratch/wt-g1a/`、`.scratch/wt-g1a-pre/` 内，
> 随 worktree 一并移除；主树只多了本文件。要复跑攻击，按上面的命令重建 worktree 后向
> `attacks/review/` 取回（用例名与断言都在本报告的矩阵里，可据此重写）。

---

## 附录：关键复现片段（worktree 已随收工移除，这段足够重铺）

共同夹具：`openWorld({file, space, grants:{'adm':['space-write','capability-admin','domain-admission'], 'nobody':['space-write']}}, plugins:[TEST_OBJECT_MODEL, TEST_RECORDS, <第三个能力>])`；
`code(fn)` = 跑 `fn()`，返回 `Refusal.code`，没抛就返回 `'NO_REFUSAL'`。**断言写成"期望越权成功"⇒ 测试绿 = 洞在。**

```ts
// N2-A1/N2-A2：write() 只判 ns 不判 oid（修后 e4fd27a/8a9624b 同形态）
const victim = w.uow(ADM, (tx) => tx.createObject({ kind: 'test.claim', payload: { v: 1 } }));  // 归对象模型
w.uow(ADM, (tx) => {
  const wr = w.kernel.faceFor(CAP_FACET).writerFor(tx);            // 另一个能力的窄面
  wr.write({ ns: wr.ns, oid: victim, revision: 99, payload: { forged: 1 }, eventType: 'extension-registered' });
});
const mine = w.uow(ADM, (tx) => tx.createObject({ kind: 'test.claim', payload: { v: 1 } }));   // 我自己的对象
// 修订级判据不带 ns ⇒ 这条 required 边提交成功（A-2）
expect(code(() => w.uow(ADM, (tx) => tx.linkRef({ from: { kind:'revision-ref', oid: mine, revision: 1 },
  to: { kind:'revision-ref', oid: victim, revision: 99 }, role: 'forged', required: true })))).toBe('NO_REFUSAL');

// N2-A3：幽灵 from ⇒ linkRef 整段跳过归属
w.uow(ADM, (tx) => {
  const wr = w.kernel.faceFor(CAP_FACET).writerFor(tx);
  wr.write({ ns: wr.ns, oid: 'OBJ-GHOST' as never, revision: 1, payload: {}, eventType: 'extension-registered' });
});
expect(code(() => w.uowFor(CAP_SECOND, ADM, (tx) => tx.linkRef({
  from: { kind:'revision-ref', oid: 'OBJ-GHOST' as never, revision: 1 },
  to: { kind:'revision-ref', oid: victim, revision: 1 }, role:'attacker-role', required: true }))).toBe('NO_REFUSAL');
expect(w.kernel.impactCandidates(victim, 1).length).toBeGreaterThan(0);   // 反向依赖视图收到投递

// N1-A12/A12c：事务结束后的旧句柄 ⇒ 绕过 checkRequiredRefs ⇒ 空间级永久写阻塞
let stale: UnitOfWork | undefined;
w.uow(ADM, (tx) => { stale = tx; });                       // 事务已经结束了
const mine = w.uow(ADM, (tx) => tx.createObject({ kind: 'test.claim', payload: { v: 1 } }));
expect(code(() => stale!.linkRef({ from: { kind:'revision-ref', oid: mine, revision: 1 },
  to: { kind:'record-ref', recordId: 'REC-NEVER-DECLARED' }, role:'escaped', required: true }))).toBe('NO_REFUSAL');
// 对照：同一条边写在真事务里 ⇒ REQUIRED_REF_MISSING（判据本身是活的）
expect(code(() => w.uow(ADM, (tx) => tx.linkRef({ /* 同上 */ })))).toBe('REQUIRED_REF_MISSING');
// 此后无辜提交全体被拒
expect(code(() => w.uow(ADM, (tx) => tx.createObject({ kind: 'test.claim', payload: { v: 2 } })))).toBe('REQUIRED_REF_MISSING');
expect(() => w.raw.run(`delete from ref_edge where role='escaped'`)).toThrow();   // append-only：删不掉
// w.close() 后重开同一库文件：仍然 REQUIRED_REF_MISSING ⇒ 不可自愈

// D-20（抬为 P1 的那条）：伪造声明令他人对象的项目判定翻成 ADOPTED
const victim = w.uow(ADM, (tx) => tx.createObject({ kind: 'test.claim', payload: { v: 1 } }));
const policy = new FactStandingPolicy(w.kernel.faceFor(CAP_RECORDS), w.authority);
expect(policy.standingAt(victim, w.kernel.head).state).toBe('NOT_ADOPTED');
expect(code(() => w.uowFor(CAP_SECOND, PRINCIPAL('nobody'), (tx) => tx.appendLedger({   // 无关能力 + 无 domain-admission
  eventType: 'synth:fact-designation', objectId: victim, revision: 1,
  payload: { stance: 'ACCEPTED', by: 'nobody', note: 'AUTHORIZED' } })))).toBe('NO_REFUSAL');
expect(policy.standingAt(victim, w.kernel.head).state).toBe('ADOPTED');                 // ← 业务授权被伪造

// D-22：只持有领域实例，从运行时面取回装配根交来的 runIn ⇒ 拿到全权事务
const svc = new ValidationService(w.kernel.faceFor(CAP_RECORDS), (fn) => w.uow(ADM, fn), (r) => w.kernel.readRevision(r));
const runIn = (svc as unknown as Record<string, unknown>).runIn as <R>(fn: (tx: UnitOfWork) => R) => R;   // private 参数属性=可枚举自有字段
expect(code(() => runIn((tx) => tx.revise(victim, { payload: { text: 'REWRITTEN-BY-DOMAIN' } })))).toBe('NO_REFUSAL');

// C-9：E-01 的存在性 + 归属 oracle（未授权窄面，12 探 4 中）
const face = w.kernel.faceFor(OUTSIDER);
const probe = (oid: string) => { try { face.eventsOf(oid as never, 'x', w.kernel.head); return 'EMPTY'; }
  catch (e) { const r = e as { code?: string; detail?: { owner?: string } };
    return r.code === 'NAMESPACE_ESCAPE' ? `ESCAPE:owner=${r.detail?.owner}` : 'OTHER'; } };
// 实测：真实存在的 4 个 oid ⇒ ESCAPE 且 detail.owner 给出归属能力 id；不存在的 ⇒ EMPTY

// B-①：门禁假绿（不需要改任何作者文件）
//   attacks/review/xx.test.ts = 一条通过的断言 + `afterAll(() => { throw new Error('清理期崩溃'); })`
//   跑 npx vitest run …/attacks/  ⇒ exit 1 / success=false / 该文件 status=failed 但 assertionResults 有 1 条
//   node g0-gate.mjs --baseline <把这条通过项也算进去的自洽基线>  ⇒ 打印「与基线完全一致」+ PASS + exit 0
```
