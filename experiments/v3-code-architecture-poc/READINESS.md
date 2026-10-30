# Implementation Readiness — 进入正式实施前必须为真的条件

> 本文件不是实施计划，而是**开工前置条件的可核验清单**。状态上限见 `ASSESSMENT.md`：
> 当前 **POC VERIFIED**，不是 IMPLEMENTATION READY。

## 1. 可以直接沿用的（PoC 已证明，含证据位置）

| 资产 | 沿用方式 | 证据 |
| --- | --- | --- |
| `contracts/index.ts` 的引用/空间/StoragePort/拒绝码封闭集 | 作为实施契约的起点（补真实 kind 与领域扩展码命名空间） | 73 例断言全绿（含 14 例审查员攻击） |
| `storage-sqlite` 的表结构与触发器 | 作为 DDL 草案（**须**补 `records` 与索引，按 `CONTRACTS.md` §3） | P1 不可变性探针 |
| `kernel.ts` 的注册表 + UoW + 命名空间写入器骨架 | 作为机制层参考实现，不作最终代码 | P1/P2/arch 三组 |
| `arch-independence.test.ts` 三类门禁 | **直接搬进正式 CI**（词汇扫描 + 依赖方向 + 面哈希） | 本轮抓出 3 处作者越界 |
| `attacks/**` 攻击测试 | 作为回归资产随契约演进扩充 | `REVIEW.md` §2 |

## 2. 必须重做或补足的（PoC 故意没做）

1. **真实对象模型**：五类对象的字段、状态机与领域接纳判据（PoC 用 `test.*` 占位 kind 与
   合成策略，`src/domains/**` 文件头已声明不得当作政策）。
2. ~~多进程并发写同一空间文件~~ **本轮已补证**：真起子进程抢写事务（`tests/multiprocess-contention.test.ts`，`EVIDENCE.md` §5）。
3. **DSH 宿主权限面**：`CONTRACTS.md` §10 明确未证明；装配根注入 principal ≠ 宿主身份真实性。
4. **Schema 迁移与时间点恢复**：`capability_route`/`records` 的演进、备份与 PITR 全未实现。
5. **热插件加载与沙箱**：PoC 的"插件"是同进程静态清单，不涉及加载与隔离。
6. **性能与容量**：PoC 数据量在个位数行级；`ref_edge` 反向查询目前全表扫。

## 3. 需要用户裁决的设计未决项（编码量能解决不了）

| 编号 | 决策 | 影响 |
| --- | --- | --- |
| D-1 | 空间粒度：一空间一文件（PoC 选）还是单库多空间 | 选后者 ⇒ P4 隔离证明整体作废，需重新证明 |
| D-2 | 派生面缺口策略：拒绝增量续跑（PoC 选）还是四态不可判定标注 | 决定 `Projection` 状态机与读面契约 |
| D-3 | 记录标识：`records` 表 + 声明/引用分离（PoC 选）还是 `ledger.record_id` UNIQUE | UNIQUE 会误伤"同一记录被多条后续事件引用" |
| D-4 | ~~F-14 级别~~ **已裁决**：独立复审实证守卫可被绕过 ⇒ 改判 **P0**，已修（`4ab5cf6`） | 无需再裁决；实施期须把 SQL 守卫列入红队常驻攻击面 |
| D-5 | `recordReport` 返回 `{reportId, recordedAt, seq}`：`recordedAt` 与 `seq` 是同一个值的两个名字（历史名 + 记录字段名）。实施期必须二选一，并在改名前跑一遍调用方——PoC 里一次静默改名当场打断了 4 个在用调用方 |
| D-6 | `domain_state.contract_version` 只有**写入侧**与**读侧判定**，没有 v2→v3 的回填迁移器。实施期第一个工作项就是它：无版本标记的既有库现在会被打开期拒绝，这是设计意图，但拒绝不等于迁移路径存在 |


## 4. 实施首批工作项（若用户批准开工，按此顺序）

1. 把 `arch-independence.test.ts` 与 `attacks/**` 迁入正式测试面并接进 CI 门禁。
2. 冻结 `CONTRACTS.md` §2–§9 为实施契约（含 D-1…D-4 裁决结果），走文档评审。
3. 用真实五类对象替换 `test.*` 占位，逐步把合成策略换成 PR #42 已定语义（**不得**新增第六类
   对象或第四套认识系统）。
4. 补 C-3 两组真实运行证据（多进程并发、宿主权限面），每项一个可复跑的证据目录。
5. Schema 迁移器 + PITR 的最小闭环，先于任何读面加速。

## 5. 开工门禁清单（每次实施提交都要全绿）

```bash
pnpm run test:poc:arch                                        # 侧车机制与攻击回归
npx tsc -p experiments/v3-code-architecture-poc/tsconfig.json # 侧车类型门（当前 0 诊断）
pnpm run check:types                                          # 根类型债门（19 条已知债，逐条身份匹配）
pnpm run lint                                                 # check-imports（INV-PERM-5）
pnpm run docs:check                                           # 文档静态一致性
pnpm run docs:probe --fail-on-blocking                        # 变更影响面
pnpm test                                                     # 根全量（当前见 EVIDENCE.md §6 的归因边界）
```

任何一项被放宽（跳过、降标准、从索引剔除）都视为**未通过**，而不是"通过"。
| D-7 | **P1 — 已修（作者自述，待独立复验）**：`#port` + `get [KERNEL_PORT]()` symbol 内部通道（键在 `src/kernel/internal.ts`）；`projection.ts` 9 处、`read-context.ts` 1 处改走该通道；新增机验禁令 `domains`/`contracts` 禁止 import 该模块（带变异锚点）。**代价如实**：symbol 可被 `getOwnPropertySymbols` 枚举、也可被 import ⇒ 买到的是边界显式化与可门禁性，非密码学隔离。详见 `REVIEW.md` §28。（原记录：`Kernel.port` 仍公开（S-0③，与 S-5 同根，本 PoC 唯一剩余 P1）。实施期第一个安全动作：`port` 转 private + 具名读 API（`eventsFor` 已是雏形），`check_report` 读取必须带 principal 且只绑定回显不解码 findings。PoC 里读句柄已收紧到 `SELECT/WITH`，但**原始 SELECT 仍可取到 `check_report` 全文**，破 RPT-09 的 REF_UNRESOLVED/WITHHELD_REFERENCE 合并。修复后原始 SELECT 不再经插件可见面对象可达 |
| D-8 | 扫描面遇禁用能力现在**回显** `hiddenByInactiveCapability`，不是抛 `CAPABILITY_INACTIVE`。理由：扫描面没有"这个对象"可报。是否应与快照面同形改抛错，属契约裁量，PoC 未定；两派各有一条代价（抛错会让一次禁用打断整页读取） |
| D-9 | 装配边界：跨命名空间事实（快照、边角色）由装配根经 `hostSnapshot` / `registeredEdges` 交入。实施期必须约束 resolver 的**绑定**——否则"宿主替它取"会退化成"把任意读取器交给领域"。PoC 只有形状，没有绑定约束的机制 |
| D-10 | 门禁可证明的范围已收窄并写死在 `CONTRACTS.md` §14.1：词汇扫描是命名门、`attacks/**` 不类型检查、**任何绿灯不证明 Kernel 业务无知**。实施期若要拿门禁当证据，必须同时给出这三条的补偿措施，否则门禁数字会被读成安全保证 |

## 附录 A：D-7 的落地配方（`Kernel.port` 收口），含"为什么 TS private 不够"

第 11–14 轮三次推迟这一项，每次都因为"上下文不够做跨文件改动"。把它写成配方，使这件事
不再依赖任何单个会话的记忆。

**实测影响面（第 11 轮量过，别凭印象）**：`Kernel.port` 的**外部**消费者只有一个——
`src/kernel/read-context.ts:57` 的 `k.port.read(...)`；其余 `.port` 引用都在 `Kernel` 类内部
或走 `World` 自持的端口。**先量再改**，是这一项看起来比实际危险的原因。

**为什么不能用 TS `private` 交差**：`private` 只存在于类型层，编译后仍是实例属性，
`kernel['port']` 在 JS 里照拿。本 PoC 的 S-0/S-5 攻击就是"拿着端口做越权读"，
用 TS private 收口等于换了个写法继续漏——**必须让属性在运行时不存在**。

配方（按序，每步都可独立验证）：

1. `Kernel` 内部字段改 JS 私有字段 `#port: StoragePort`；构造器参数属性 `readonly port` 必须改写
   （参数属性不能带 `#`），改后把类内 `this.port` 全部替换为 `this.#port`（实测 8 处）。
   Node 24 支持 `#` 字段；`Object.getOwnPropertyNames(kernel)` 不再列出它，
   `kernel['#port']` 是语法错误——这才是"运行时不可达"。
   （`auth` 同理仍是 TS private，属**残留**，别顺手一起改：见步 5。）
2. 给 `read-context` 一个**具名只读扫描**方法替代 SQL 句柄：`Kernel.scanForRead(cutoff)`，
   内部单次 `this.#port.read(...)` 同时返回 `object_directory` 与 `domain_state` 两批事实。
   **必须是同一次 read**：分两次取会让可见性与对象时间看到不同状态，
   而"可见性截点与时间谓词同源"正是 `tests/empty-vs-absent.test.ts` 在守的性质。
3. 测试断言从"类型不通"升级为"运行时拿不到"：
   `expect(Object.getOwnPropertyNames(kernel)).not.toContain('port')`，
   并断言面集合（沿用 `tests/arch-independence.test.ts` 已有的运行时权威面判据）。
4. `KERNEL_SURFACE.sha256` 显式重生成，理由=面收窄（S-0③ 闭合），属收紧非放宽。
5. **不要顺手改 `auth`**，也**不要顺手关 `World.raw`**：后者是测试装配的显式后门，
   它的存在本身就是"绿灯不能证明 Kernel 业务无知"（`CONTRACTS.md` §14.1）的物证。
   两者各自单列（`auth` 残留、装配后门），混进同一次改动会让"面变窄了多少"重新变得不可核。

**验证清单**：`npx tsc -p …/tsconfig.json` = 0；`tests/` 全绿；
`attacks/semantics/dml-guard-attack.test.ts` 与 `checkreport-raw-read-attack.test.ts` 保持红
（它们红=越权读不再可构造）；`check-imports`、`docs:check` OK。

## 附录 B：两条独立复验带来的新开放项（第 27 轮，作者未自评）

| 编号 | 级别 | 内容 | 为什么不能省 |
| --- | --- | --- | --- |
| D-11 | **P2** | `ledger` 无 `contract_version` 列，`eventsOf` 把 `payload_json` 原样交进插件面 ⇒ v2 实现读 v1 事件载荷可能被静默误读。席位判它**不是** F-EV-R2 的漏网出口（事件面是"当时记下了什么"，套当前版本判据＝升级即失忆，违反 ID-08/T-01/T-02 回放契约），但**不接受静默**：建议加 `ledger.contract_version` 写入时盖戳（别塞进 payload），代价是存量行未盖章 ⇒ **D-6 同款回填器债务再现** | 席位原话：若 PoC 决定不做，必须写成显式裁定，"不能让它以'不算漏网'的名义消失"，否则下轮审查会当漏网出口重提 |
| D-12 | **P2** | `hiddenByInactiveCapability` / `hiddenByContractSkew` 的"只给数量不给 oid"**不抗探测**：席位实测用截点前缀差分 `C(X)-C(X-1)` 可枚举被剔除行的精确 `recorded_seq`，且**无 revise 时 oid 可直接命名**（`OBJ-<space>-<n>` 的 n 按创建序单调），另 `usedRecordedAsOf` 在默认截点下泄露 head。启停能力只重新分桶，不给行级身份 | 这条**推翻了我此前写过的说法**。作者侧曾把"只给数量"表述为防身份泄露的设计；真实语义只是"不在单次批量应答里交出全集合"。泄露的是存在与位置，不是内容 |
| D-13 | **P3** | `timeFieldMissing` 在剔除**前**的 `visible` 上计算（应基于 `keep`）⇒ 行全被剔除时该位口径误导 | 仍可判定，不违反 C12/T-05，但属我自己第 12 轮改动留下的口径缺陷，作者侧应修 |

**建议的 echo 加强（不改形态）**：补首个被剔除行的 `{capability, recordedContractVersion, effectiveContractVersion}`
版本对——给操作者一次读即可行动的线索，仍不给 oid。

| P2-2 | **已修（作者）经席位 A 发现** | `NamespaceWriterImpl` 的 `private cap` 只是编译期，运行时是自有字段：`getOwnPropertyNames(writer)===['cap']`，`JSON.stringify` 泄露 capability id | 改 `#cap`。副作用如实记录：席位 A 的攻击测试第 215 行**把该泄露当证据钉住**，修复后该断言转红 ⇒ 基线按"已定性"更新，**未改审查方文件** |
| P2-3 | **P2（席位 A）** | 新增的构造器断言只覆盖构造器静态成员；"原型方法返回句柄"式泄露不会让作者门禁变红（缺行为级可达性测试） | 部分缓解：席位 A 的运行时矩阵 `rereview-g0a-escape.test.ts` 已入库，随基线流一起被门禁收集；完备的行为级可达性门待 G1 |
| P2-4 | **已修（作者）经席位 A 发现** | `BASELINE.json` 的 `generated_from_commit` 不参与门禁校验 ⇒ 基线可静默漂移在旧提交上 | 门禁现在要求该字段存在且**确实是 HEAD 的祖先**（`git merge-base --is-ancestor`），否则红 |
| D-19c | **P1 — 已收口（作者+席位，四条变异验证），待独立复验** | 领域插件与用例层都能绕过对象拥有者写权威数据；`test-records.ts` 曾是活反例 | **领域侧**：`IntakeService`→`IntakePolicy`（只出草稿、零写）；**用例侧**：新建 `src/app/` 用例层，跨归属写经 `UseCaseDelegation.writerOwningKind(kind,tx)` 拿拥有者作用域端口，同一条事务（Q40 不破）。新增 17 例（`domain-write-face` 9 + `use-case-write-path` 8）：墙／网／负空间／归属不变／两拥有者同事务回滚／委派不多给权限／`transferRoute` 跟随。变异 M1–M4 全部按确切路径还原并 sha256 校验。**未改 kind 归属、内核与契约零字节改动 ⇒ 面哈希不漂移** |
| D-19 | **P1 — 已修 + 变异验证，待独立复验（外部复审发现 A）** | `UnitOfWork.revise()` 取了 `owner_capability` 却不与调用方比对，领域代码拿通用事务即可改任意领域对象，违背 Q12 | 两层写面：通用面属装配根/用例层（保 Q40 跨插件原子提交），领域只经 `NamespaceWriter.createOwned/reviseOwned/linkOwned`（归属不符 ⇒ `CAPABILITY_SCOPE_ESCAPE`）；`tests/capability-scope.test.ts` 5 例，移除执行点恰好两条负例转红。注：初版给 `PluginFace` 加 `uow()` 被自家门禁 AUTHORITY 名单拦下，已撤回 |
| G-2 | **P1 — 已修 + 变异验证（外部复审发现 B）** | `g0-gate` 对 `attacks/**` 只比失败名称集合 ⇒ 原本通过的审查方测试被 `describe.skip`／改名／删文件时失败集合可一字不变，覆盖面缩水被读成"与基线一致" | 基线增 `passes`（通过项身份清单，93 条），门禁要求失败与通过**两个集合都完全相等**；新增通过也红（覆盖面变大须显式承认）。变异验证：移走一份审查方测试 ⇒ 立刻红；还原 ⇒ 绿。基线在干净 worktree `HEAD` 重生成 |
| D-23 | **P1 — 已修（包 1）+ 四条变异验证，待独立复验** | **事务句柄在事务结束后仍可写**：提交点唯一（`kernel.ts:533`），句柄无失效位，回调返回后所有写面照常工作并以 autocommit **直接落库**。后果链（实测）：悬空 `required` 硬引用**根本不经过** `checkRequiredRefs`（对照：同一条边写在真事务里当场 `REQUIRED_REF_MISSING`）；而该判据是**全表扫描** `where required=1` ⇒ **此后空间内任何人的任何提交都被这条边拒绝**，`ref_edge` append-only 删不掉、**重开库文件仍阻塞** = 永久不可自愈的空间级写阻塞；另有 Q40 原子性反例（连写两笔后抛错，第一笔仍在库里）；`uowFor` 领域路径同样成立 | **已有入库回归测试**：`attacks/review/g1a-regression.test.ts` 三条红（装配路径 / 领域路径 / **后果锁**）。后果锁刻意不走旧句柄而是直插存量悬空 required 边，断言**另一主体**的合法提交必须成功——实测：只做「句柄失效」不转绿，必须连「判据不再全表重扫」一起做才转绿。修法方向按外部复审第四轮：**下沉到 `StoragePort`/`TransactionLease`**，不能只给 `UnitOfWork` 加 `closed`（`NamespaceWriter` 也保留底层句柄）；新增引用应在**所属事务内**验证，存量完整性走独立的打开期/迁移/审计路径，禁止让一条历史损坏项永久阻塞整个 ResearchSpace。缺的是**生命周期执行点**（不是已被滥用：`src/**` 当前无人扣句柄）。修法：句柄绑定事务代数，回调返回即失效并抛错。**与 D-20/D-21 正交**——那两条判"谁能写哪行"，这条判"什么时候还能写" |
| D-24 | **P1 — 两个无歧义面已修（包 1），完整修法待 G1 挂载登记，待独立复验** | `NamespaceWriter.write()` **只判 `ns`、从不判 `oid`**（`kernel.ts:614`）。五条落点全实测：种到幽灵 oid；**伪造修订级 required 硬引用**（`:934` 修订判据不带 ns）；幽灵 `from` 使 `linkRef` 归属判定整段跳过（`:807` `if (src)`）；`readAsOf` 不按 ns 过滤 ⇒ 伪造行**作为他人对象的状态行被端出**（附 payload）；`write()` 顺手写 `ledger`+`journal` ⇒ **注入他人事件流且通过投影缺口检测** | **已有入库回归测试**：`g1a-regression.test.ts` 两条负例（幽灵 oid、修订归因）+ **一条 Q45 正例护栏**（Facet 挂扩展记录到他人核心对象必须成功，已入 `passes`）。**席位的实测发现改变了修法**：PoC 中「合法 Facet 挂载」与「A-2 伪造行」在 `write()` 入口是**同一行形态**（ns=自己、oid=他人核心对象、任意 revision），机制层没有「扩展挂载登记」可区分 ⇒ **D-24 的完整修法必须新增挂载声明机制**，而不是在 `write()` 里加一条归属拒绝（后者当场打断正例）。已登记为 G1 存储契约项。原建议 `write()` 必须校验 `oid` 归属（不只 ns），且 `checkRequiredRefs`/`readAsOf` 的判据与读面都要带 ns。与 D-20/D-21 一并交 G1 定写侧权威规则 |
| GT-1 | **P1 — 已修 + 变异验证（外部复审第四轮确认修复方向）** | 审查方流**从不判 `v.status`/`v.success`**：审查方文件「断言全通过 + `afterAll` 抛错」⇒ vitest `exit=1 / success=false`，门禁仍打印「与基线完全一致」+ **PASS exit 0**。这正是 `47cc386`（G-1）给**作者流**修过的同一形态——**修第二条流时没顺手修第三条，我的修复只做了一半** | 席位已给出实测零误报规则：「文件 `status=failed` 且其中 **0 条** `failed` 断言 ⇒ 判收集/清理期失败」，在现有 attacks 上命中 1 份（其夹具）、11 份已知红零误报 | **本轮已照此实现**：判据改为「文件 `status=failed` 且其中 **0 条** `failed` 断言（或文件带 `message` 且无断言）」⇒ 判收集/解析/清理期失败。用席位原始夹具形态复现验证（断言全通过 + `afterAll` 抛错）⇒ 门禁红；还原 ⇒ exit 0；现有 11 份已知红文件零误报 |
| GT-2 | **P2 — 未修** | 基线**按名字**比对 ⇒ 已知红条的判据可被掏空成 `expect(1).toBe(2)`，名字与红状态一字不变，**两次都 PASS** | 席位实测可行改法：基线为每条已知红记录归一化 `failureMessages[0]` 摘要（真判据 `cea44fd1741c` vs 掏空版 `17506aa47500`，可分辨） |
| GT-3 | **P2 — 结构性未修** | **基线自洽即通过**：删一份审查方测试后按新现实重算基线，`155→153` 两次都报「与基线完全一致」；伪造"整份文件未被收集 + total 同步调小"亦 PASS。`generated_from_commit` 只要求是 HEAD 祖先，不要求内容真源于该提交 | 可靠解法（席位给出，比我原猜测多一环）：门禁自己在 `git worktree add --detach` 干净树重算并逐字段比对，**并额外要求重算所用 worktree 内 `attacks/**` 的文件清单哈希 == 基线登记的清单哈希**——必须把「被收集的文件清单」本身作为被锚定的量 |
| GT-4 | **P2 — 未修** | `AUTHOR_MIN_PASSED=90` 而实际 **118** ⇒ 伪造「90 例全绿」即可 PASS，**24% 的作者测试可凭空消失**；注释仍写「作者侧当前 95 例」，说明该数从未随基线重锚 | 下限必须由基线自身推导（如 `passes` 计数的函数），不得是手填魔数 |
| D-20 | **P1 — 已修（包 2）+ 变异验证，待独立复验** | 写侧 `appendLedger` 曾**不判 `objectId` 归属**且正式事件无唯一写入口（修前后果，席位 A-6 实测）：无关能力一条伪造 `note='AUTHORIZED'` 即翻转他人对象的采纳投影；读侧 E-01 的对称门写侧没有 | 修法（CONTRACTS.md §16.2，**先契约后机制**）：① `PluginManifest.ownsEventTypes` 登记正式事件类型（判据同族 `ownsKinds`）；② 通用 `appendLedger`/`declareRecord`/`write()` 台账行对已登记类型在**一切作用域含 assembly** 一律新码 `EVENT_AUTHORITY_REQUIRED`；③ scoped 事务 `appendLedger` 的 objectId 走与 `revise` 同一条 `#assertScope(owner)` ⇒ `CAPABILITY_SCOPE_ESCAPE`（assembly 协调权保留，Q40 正例护栏同钉）；④ **唯一入口** = 新插件可见成员 `NamespaceWriter.appendAuthoritativeEvent`（事件类型归属核对 + 对象/修订存在性 + `actor` 由机制从已验证主体落账），领域侧包装 = `FactDesignationCommandPort`；⑤ 投影信任模型：只认结构化字段 + `issuer === 机制 actor` + 按事件记录的 `policyVersion` 查**冻结判据表**（未知版本 fail-closed），绝不按当前权限重解释历史。`use-case-write-path` 末条已从"现状断言"翻正为双向断言；单层直测 + 端到端红条 = `tests/formal-event-authority.test.ts` + `g1a-regression.test.ts`。**遗留**：H append-only，库里既有伪造行不再生效但仍在——审计/处置为运维缺口（G1） |
| D-21 | **P1 — 定级抬升（席位实测：可阻断他人校验落库）** | `linkRef` 只判发起方 `from` 的归属，**不判 `to`** ⇒ 任何能力都能挂一条指向他人对象的边（含 `required: true`，只要目标存在即可提交）。跨能力"这条边允不允许"无判据 | 需 G1 裁定边的权威归属规则；当前无机制判定，测试未覆盖 |
| D-22 | **P1 — 已修（包 2，现存实例收口）+ 变异验证，待独立复验** | 墙只对 `uowFor(cap,…)` 取到的 scoped tx 生效；装配根曾把 `assembly` 全权事务**执行器**交进领域服务并留在运行时可枚举字段（`ValidationService.runIn` 参数属性，席位 A-8 实测跨归属 `revise` 成功） | 收口（CONTRACTS.md §16.2）：`ValidationService` 类型面只接 `ValidationReportSubmission`（单动作「登记一份校验报告」的 Port，装配根经 `w.validationSubmission(主体)` 实现，F-23 主体链不变）；构造参数一律 `#` 私有字段，`runIn` 从运行时面消失（名字穷举 + 类型穷举 + 原型面钉死）。**冻结裁判以回调形态构造并预设构造成功**（`g1a-regression.test.ts:240` 在 `code()` 之外；其第 57 行绿配方 = `#runIn` 私有字段）⇒ 运行时兼容做成**显式具名导出适配器** `adaptLegacyValidationWiring`（`LegacyRunIn` 标 `@deprecated`，登记删除条件），且攻击面另测：直接攻击适配器，**兼容入口对持有者同样取不回事务句柄**（可达性=零）。一般形态约束继续有效：新领域对象一律不得接全权事务（`delegation.ts`/`domain-write-face.test.ts` 横幅已更新）；`FacetStore` 实测只接窄面+调用方事务，不属本泄漏形态 |
| G-2b | **P1 — 已修 + 双变异验证（外部复审第三轮）** | 审查方流虽已两集合并判，但**收集期失败**未单独识别：新增一份在 import 期崩溃的攻击测试文件 ⇒ 原有通过/失败集合一字不变，门禁仍可能 PASS；新增被 skip 的攻击文件同理 | 新增三道：`testResults` 中"有文件无断言"判为**收集期失败**并红（与"已知断言红"分类区分）、`skipped>0` 即红、收集总数与基线 `total`(125) 不符即红。两条变异各自验证并给出**具名**理由，还原后绿 |
| G-3 | **P2 — 已修（作者）经外部复审发现** | `SUBAGENT_ROUTING.md` 要求席位 worktree 落在仓内 `.scratch/`，但**根 `vitest.config.ts` 未排除 `.scratch/**`** ⇒ 席位 worktree 里的 `tests/**` 副本被根 runner 收编（PR #47 曾发生的同一失效模式） | 根 vitest 与 tsconfig 均排除 `.scratch/**`。**反向对照实测**：移除排除项时根 runner 收编 23 份文件（含我自己未清理的 `wt-g0base` 残留 e2e spec），加回后为 0；残留 worktree 已清理 |
| G-1 | **P1 — 门禁自身假绿，已修并经变异验证（席位 A 实测）** | `g0-gate.mjs` 作者流只数 JSON 红条、**忽略 vitest 退出码** ⇒ 测试文件 import 期崩溃被读成「92 例全绿」；整文件 `describe.skip` 静默通过；`tests/**` 流无任何兜底 | 四道保护：退出码非 0 即红（具名成因=收集期崩溃）、`success=false` 即红、`skipped>0` 即红、通过数下限 90；两条变异各自验证。另修 import 禁令正则的单引号旁路（双引号/动态 import/require） |
| D-15 | **P1 — 已修并经独立复验（席位 B）** | 装配未交边视图时双正源检查静默不执行，报告仍报 ACHIEVED + COMPLETE | 未交 ⇒ `SYNTH_EDGES_UNAVAILABLE`(INDETERMINATE) 真挡 ACHIEVED（reducer、端到端、呈现层三处实测）；**未新增 coverage 第四值** |
| N-1 | **P2（席位 B）** | 装配根交**恒空**视图而库中真有 `USED_IN` 边 ⇒ 仍 ACHIEVED + COMPLETE + 零信号 | 机制无法校验交来的视图内容（受信任输入边界，同 `hostSnapshot`）。作者测试 3 bless 的"交而空 ⇒ ACHIEVED"**有条件**（视图须完整真实），条件**无机制保证、当前依赖装配纪律**。装配级保证待 G1 |
| N-2 | **P2（席位 B）主张强于实现** | `includes('USED_IN')` 精确匹配 + 只认 `operating_context`：`used_in`/`Used_In`/`" USED_IN"` 漏检；`operatingContext`、嵌套 `context.operating` 连 INDETERMINATE 都不触发 | 已在 `CONTRACTS.md` 把"可检测"收窄为"规范化角色名与已声明字段名范围内"，并列出解除该限定所需三项交付 |
| N-3 | **P2（席位 B）** | 视图抛异常 ⇒ `run()` 直接抛、不落报告，无 INDETERMINATE 降级（与 `CHECKER_UNAVAILABLE` 的降级哲学不一致）；`as unknown as` 注入不受 domains 扫描覆盖 | 方向安全（无假通过），但哲学不一致；降级路径待 G1 与 N-1 一并处理 |
| E-00 | **已修（作者自述，待独立复验）** | `eventsOf()` 可被任意能力按任意 oid 取回他能力对象的原始事件载荷 | 默认拒绝 + 装配根 `CROSS_EVENT_READ` 显式授权表（走既有 `capability-admin` 权威轴，未新增枚举值）；见 `REVIEW.md` §29 |
| E-01 | **P2（登记，待 G1 裁定）** | `NAMESPACE_ESCAPE` 的拒绝本身声明「该 oid 存在且属他人」；与 D-12 的可预测 oid 叠加即成存在性 oracle。**（包 2 加宽登记）** D-20 修法给 `eventsOf`/`eventsFor` 返回行新增 `actor`（机制 ledger 的登记者主体，投影判签发方所必需）⇒ 已获跨读授权的能力多看到一项「事件行登记者」；对正式声明类事件签发者本就是业务可见数据，但泄露面确实加宽一项，随本行一并裁定 | 当前取舍=显式拒读（静默返空会把「没权限」读成「没有历史」，属被禁止的「缺失读成空」家族）；`tests/events-of-scope.test.ts` 已钉住该取舍；`actor` 加宽的登记见 CONTRACTS.md §16.2 |
| D-17 | **P1 — 已修（作者自述，待独立复验）**：`NamespaceWriterImpl` 改 `#k`/`#raw`，Kernel 回读走类内静态 `peekRaw()`（类未导出）| `faceFor()` 交给插件的 `writerFor(tx)` 返回 `NamespaceWriterImpl`，以 TS 参数属性持有 `k`/`raw`（`kernel.ts:522`），运行时实测可达 ⇒ 第三个逃逸对象 | 作者侧 `tests/namespace-writer-surface.test.ts` 已复现并按漏洞现状钉住；**与 D-7/D-16 同批修**，只修前两者不够 |
| D-16 | **P1 — 已修（作者自述，待独立复验）**：`UnitOfWorkImpl` 改 `#k`/`#raw` | 交给插件的 `UnitOfWork` 对象在运行时携带 `raw`（裸 SQL 句柄）与 `k`（全量 Kernel 引用），实测 `[raw,k,port] = [false,false,true]`（false=可达）。类型面靠 `@ts-expect-error` 藏住，运行时没藏住 ⇒ JS 插件或一次 `as unknown as` 即得全库读写 | **我原来的门禁断言是恒真式（`x===undefined \| x!==undefined`），恰好把这个洞盖住了**——是复验席指出后改成真判据才现形。修法与附录 A 同族：`#raw`/`#k` 私有字段，让属性在运行时不存在；同类名测试"领域插件不得持有 Kernel"是源码扫描，扫不到运行时面 |

（D-20/D-22/D-23/D-24 的修复前后比较已有机验锚）（基线 `total 133 / failures 39 / passes 94` @ `8adc6ac`）
