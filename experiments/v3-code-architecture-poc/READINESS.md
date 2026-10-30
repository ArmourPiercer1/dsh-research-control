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
| GT-1 | **P1 — 部分修（G2-A：吸收形仍假绿）**（外部复审第四轮确认修复方向）** | 审查方流**从不判 `v.status`/`v.success`**：审查方文件「断言全通过 + `afterAll` 抛错」⇒ vitest `exit=1 / success=false`，门禁仍打印「与基线完全一致」+ **PASS exit 0**。这正是 `47cc386`（G-1）给**作者流**修过的同一形态——**修第二条流时没顺手修第三条，我的修复只做了一半** | 席位已给出实测零误报规则：「文件 `status=failed` 且其中 **0 条** `failed` 断言 ⇒ 判收集/清理期失败」，在现有 attacks 上命中 1 份（其夹具）、11 份已知红零误报 | **本轮已照此实现**：判据改为「文件 `status=failed` 且其中 **0 条** `failed` 断言（或文件带 `message` 且无断言）」⇒ 判收集/解析/清理期失败。用席位原始夹具形态复现验证（断言全通过 + `afterAll` 抛错）⇒ 门禁红；还原 ⇒ exit 0；现有 11 份已知红文件零误报 | **G2-A：只修了一半**——纯形被抓，**吸收形**（同文件内一条已登记红藏住清理期崩溃）被 `reds === 0` 豁免 ⇒ 仍 PASS。这是 G-1/G-2/GT-1 同族**第四次**：每次只补「当前见到的那一种形态」。自洽形态 = 基线逐文件登记**失败成因签名**、任何未登记成因一律红（席位实测在 133 例基线上零误报），登记为 **N5** |
| GT-2 | **P2 — 未修** | 基线**按名字**比对 ⇒ 已知红条的判据可被掏空成 `expect(1).toBe(2)`，名字与红状态一字不变，**两次都 PASS** | 席位实测可行改法：基线为每条已知红记录归一化 `failureMessages[0]` 摘要（真判据 `cea44fd1741c` vs 掏空版 `17506aa47500`，可分辨） |
| GT-3 | **P2 — 结构性未修** | **基线自洽即通过**：删一份审查方测试后按新现实重算基线，`155→153` 两次都报「与基线完全一致」；伪造"整份文件未被收集 + total 同步调小"亦 PASS。`generated_from_commit` 只要求是 HEAD 祖先，不要求内容真源于该提交 | 可靠解法（席位给出，比我原猜测多一环）：门禁自己在 `git worktree add --detach` 干净树重算并逐字段比对，**并额外要求重算所用 worktree 内 `attacks/**` 的文件清单哈希 == 基线登记的清单哈希**——必须把「被收集的文件清单」本身作为被锚定的量 |
| GT-4 | **P2 — 部分修（G5-A：身份锚为真升级，七条变异路无一静默绿；唯一洗白链=改断言体+重锚）** | `AUTHOR_MIN_PASSED=90` 而实际 **118** ⇒ 伪造「90 例全绿」即可 PASS。**G2-A 实测放大**：整删 4 个作者测试文件（`p3-intake-validation` 15 + `arch-independence` 12 + `p1-storage-tx` 10 + `p2-identity-plugin` 10 = **47 例 / 34.3%**）后，复制树门禁仍报「OK —— 90 例全绿」PASS；**删到第 48 例才红**；注释仍写「作者侧当前 95 例」，说明该数从未随基线重锚 | 下限必须由基线自身推导（如 `passes` 计数的函数），不得是手填魔数 **修法**：`AUTHOR_ANCHOR.json`（`passed`/`total`/`generated_from_commit`）+ 判据**逐等而非 ≥**（变少=被删/被排除/被 skip，变多=「全绿」含义漂移，两个方向一律红）；戳必须是 HEAD 祖先；`--reanchor` 在当前不干净时**拒写**（否则重锚本身就是把回归洗成基线的合法通道——GT-3 的教训）。**变异验证**：移走 1 个测试文件 ⇒ exit=1（实测 165 ≠ 锚 167）；还原 ⇒ exit=0；锚戳改非祖先 ⇒ exit=1。**代价**：以后每加一条测试都要显式重锚一次——覆盖面的任何变化都必须被人看见。 |
| D-20 | **P1 — 已修（包 2 + 包 3 第三层「授权结论=机制证据」收口）+ 变异验证，待独立复验** | 写侧 `appendLedger` 曾**不判 `objectId` 归属**且正式事件无唯一写入口（修前后果，席位 A-6 实测）：无关能力一条伪造 `note='AUTHORIZED'` 即翻转他人对象的采纳投影；读侧 E-01 的对称门写侧没有 | 修法（CONTRACTS.md §16.2，**先契约后机制**）：① `PluginManifest.ownsEventTypes` 登记正式事件类型（判据同族 `ownsKinds`）；② 通用 `appendLedger`/`declareRecord`/`write()` 台账行对已登记类型在**一切作用域含 assembly** 一律新码 `EVENT_AUTHORITY_REQUIRED`；③ scoped 事务 `appendLedger` 的 objectId 走与 `revise` 同一条 `#assertScope(owner)` ⇒ `CAPABILITY_SCOPE_ESCAPE`（assembly 协调权保留，Q40 正例护栏同钉）；④ **唯一入口** = 新插件可见成员 `NamespaceWriter.appendAuthoritativeEvent`（事件类型归属核对 + 对象/修订存在性 + `actor` 由机制从已验证主体落账），领域侧包装 = `FactDesignationCommandPort`；⑤ 投影信任模型：只认结构化字段 + `issuer === 机制 actor` + 按事件记录的 `policyVersion` 查**冻结判据表**（未知版本 fail-closed），绝不按当前权限重解释历史。`use-case-write-path` 末条已从"现状断言"翻正为双向断言；单层直测 + 端到端红条 = `tests/formal-event-authority.test.ts` + `g1a-regression.test.ts`。**遗留**：H append-only，库里既有伪造行不再生效但仍在——审计/处置为运维缺口（G1）。**（包 3 补充，N1——席位 G2-A C4 实测本行修后仍留半扇门：判据从 `note` 换到结构化字段 `authorization`，投影照旧认载荷自称）** 第三层收口：入口判据 ②激活核对（D-25）+ ③授权取证（按 `ownsEventTypes.requiresAuthority` 登记的轴向与 `assertAuthority` 同一本 authority 账本取证，`principalCan` 无异常形态；证据由机制写 ledger 见证列 `authority_basis`，载荷 `authorization` 降为意图声明）；投影加**见证优先闸**（带 `authorized:false` 见证的行在任何版本查表前不计 ⇒ 自称 v2 走旧判据不可达，父代理点名测试已钉），冻结表新增 v3 行（不读载荷自称）、**v2 行一字未动转为只读历史语义**（无见证历史行仍按当时版本计入——两个方向都由 `tests/n1-authorization-evidence.test.ts` 双钉）；缺轴登记装配期 `ACTIVATION_IMPOSSIBLE`。变异验证（M1 摘取证 / M2 摘见证落账 / M3 摘投影闸）红点记录在该文件头与回报 |
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
| E-01 | **P2（登记，待 G1 裁定）** | `NAMESPACE_ESCAPE` 的拒绝本身声明「该 oid 存在且属他人」；与 D-12 的可预测 oid 叠加即成存在性 oracle。**（包 2 加宽登记）** D-20 修法给 `eventsOf`/`eventsFor` 返回行新增 `actor`（机制 ledger 的登记者主体，投影判签发方所必需）⇒ 已获跨读授权的能力多看到一项「事件行登记者」；对正式声明类事件签发者本就是业务可见数据，但泄露面确实加宽一项，随本行一并裁定。**（包 3 第三次加宽登记，N1/D-25 修复引入）** 返回行再加 `authority: { axis; capability; authorized } | null`（机制授权见证）⇒ 跨读能力又多看到「签发时经核对的授权轴名 + 机制授权结论」。必要性 = 投影只认机制证据（载荷自称已被判为不可信面，见 CONTRACTS §16.2 包 3），不给这一列投影就只能退回读载荷自称 | 当前取舍=显式拒读（静默返空会把「没权限」读成「没有历史」，属被禁止的「缺失读成空」家族）；`tests/events-of-scope.test.ts` 已钉住该取舍；`actor`/`authority` 加宽的登记见 CONTRACTS.md §16.2；**包 4 未再加宽**：D-26 判据只住注册期、N6/N7/N9 修法不触插件面——插件可见成员清单对拍（ef86df3 vs 包 4）face/tx/writer/scopedTx/events 行键五组逐字节等（`kernel.ts`/`contracts` 变动的全部运行时投影 = 无新成员；contracts 模块新增的两个导出是常量，不在任何递入插件的对象上）；G1 裁定复核范围 = 存在性 + 归属者身份 + 登记者 + 授权见证 |
| D-17 | **P1 — 已修（作者自述，待独立复验）**：`NamespaceWriterImpl` 改 `#k`/`#raw`，Kernel 回读走类内静态 `peekRaw()`（类未导出）| `faceFor()` 交给插件的 `writerFor(tx)` 返回 `NamespaceWriterImpl`，以 TS 参数属性持有 `k`/`raw`（`kernel.ts:522`），运行时实测可达 ⇒ 第三个逃逸对象 | 作者侧 `tests/namespace-writer-surface.test.ts` 已复现并按漏洞现状钉住；**与 D-7/D-16 同批修**，只修前两者不够 |
| D-16 | **P1 — 已修（作者自述，待独立复验）**：`UnitOfWorkImpl` 改 `#k`/`#raw` | 交给插件的 `UnitOfWork` 对象在运行时携带 `raw`（裸 SQL 句柄）与 `k`（全量 Kernel 引用），实测 `[raw,k,port] = [false,false,true]`（false=可达）。类型面靠 `@ts-expect-error` 藏住，运行时没藏住 ⇒ JS 插件或一次 `as unknown as` 即得全库读写 | **我原来的门禁断言是恒真式（`x===undefined \| x!==undefined`），恰好把这个洞盖住了**——是复验席指出后改成真判据才现形。修法与附录 A 同族：`#raw`/`#k` 私有字段，让属性在运行时不存在；同类名测试"领域插件不得持有 Kernel"是源码扫描，扫不到运行时面 |

（D-20/D-22/D-23/D-24 的修复前后比较已有机验锚）（基线 `total 133 / failures 39 / passes 94` @ `8adc6ac`）

| N5 | **P1 候选 — 未修（G2-A）** | 同文件内存在一条已登记红时，清理期崩溃被 `reds===0` 放过 ⇒ 门禁假绿（G-1/G-2/GT-1 同族第四次） | 基线逐文件登记**失败成因签名**，任何未登记成因一律红（席位实测 133 例零误报） |
| N3 | **P2 — 部分修（G4-A：门 1 AST 十形态全抓；门 2 四种双盲形态，"两层由 AST 兜底"的兜底句被否证）** | 包 3 两道门被席位 G3-A 实测打穿：门 1 正则+括号配对被 `constructor(tag = ")", private readonly face)`（默认值字符串未配对右括号截断参数表扫描）等三式绕过；门 2 `'value' in d` 对 **getter 访问器**失明、不下钻**一层包装** `{bundle:{face}}` ⇒ 「结构性防复发」承诺不成立，按未修记 | 包 4 重写（`tests/n3-parameter-property-gate.test.ts`）：**门 1 = TS Compiler API AST**（经 `typescript-6` 别名——train 的 `typescript@7` 原生移植不暴露经典 API）遍历构造器参数修饰符（参数属性），覆盖 PropertyDeclaration 可见性修饰符、AccessorDeclaration、`Object.defineProperty(s)(this,…)` 注入；**解析诊断 fail-closed**（读不进语法树=违规）。**门 2 = 双 descriptor + 一层递归**：accessor 与 value 都判（own accessor 保守拦）、plain-object 包装递归一层、Symbol 键继续查。**红→绿血统自带**：旧门实现保留为副本，每条已知绕过形态先钉「旧门漏检」红、再断「新门抓住」绿（六行分列输出见包 4 回报）；白名单为空仍是断言；门 1↔门 2 镜像纪律保持。**登记的残余形态**：两层以上包装、Proxy ownKeys 欺骗（N3g，理论）、storage/kernel 装配层参数属性（插件不可达，扩面须先登记）。**变异验证**：把两门降级回旧形态 ⇒ 血统测试与变异锚点 3 条转红，还原 `sha256sum -c` OK |
| N4 | **P2 观察 — 未修** | `tx` 运行时原型比声明接口宽（`reassignRouteInternal` 直改 `capability_route` 的裸通道挂在插件经手实例原型上，`kernel.ts:1186`）；实测被方法体内 `AUTHORITY_REQUIRED` 兜住，**无越权** | "类型面即边界"实为编译期边界；应收敛运行时原型或给裸通道补机制授权 |
| D-25 | **P1 候选 — 已修（包 3，2026-10-30），待独立复验** | `unloadCapability` 停用拥有者后 `appendAuthoritativeEvent` **仍能签发正式事件**（零激活核对）；`CONTRACTS` 原句曾把期望写成事实（G2-A N2） | 包 3 修法（CONTRACTS.md §16.2 入口判据 ②）：签发入口在事件类型归属核对之后、对象解析之前核对**激活状态**（生效路由缺失 ⇒ `CAPABILITY_INACTIVE`、零残留）；同时按 `requiresAuthority` 轴向机制可信授权来源**取证**并落 ledger 见证 `authority_basis`（判据 ③，N1 同处修）。实测依据：`tests/n1-authorization-evidence.test.ts`「D-25 直测面」（停用后通道 B `CAPABILITY_INACTIVE`+ledger 不动、`write()` 同码、再启用恢复）；「去掉机制侧取证 ⇒ 单测必须红」的变异验证记录在该文件头与回报。**（包 4 文档纠正，席位 G3-A D25-MP 实测）** 本行与 CONTRACTS 原句「查生效路由表」超前于机制真实行为：判据查**本进程内存 registry**，持久列 `capability_route.enabled` 只在执行停用/启用的进程 + 其后新启动进程生效（B 停用后先启动的 A 仍能签发，A restart 才拒）；CONTRACTS §16.2 已按实测改写并**保留旧句痕迹**，跨进程陈旧窗口记为设计边界（实施期或补跨进程失效机制）。停用窗口内 `eventsOf` **读面不关**（D-25 只承诺写面，判据如此，登记于同处） |

| D-26 | **P2 — 部分修（G4-A：字面轴装配期拒=原攻击类已修；等价不同形 6/6 穿注册，提权面被 Set 精确匹配兜住）** | **授权轴名由清单自称，机制不自证它是业务轴**：`ownsEventTypes[].requiresAuthority` 只验"缺不缺"，不验"是什么"（修前 `kernel.ts` 仅 `typeof==='string' && !==''`）。恶意清单声明 `requiresAuthority:'space-write'` ⇒ **只有写权、无任何业务轴的主体**经正当通道即得 `authorized:true` 见证并被 v3 全额采信 | 包 4 修法（CONTRACTS.md §16.2「轴值判据」段）：注册判据补**机制资源排除谓词**——`contracts` 新增 `MECHANISM_RESOURCES`（`MechanismResource` 运行时投影 + 编译期穷尽检查），登记轴名 ∈ 该联合 ⇒ 装配期 `ACTIVATION_IMPOSSIBLE`（同缺轴码，零签发面）。**Kernel 零业务知识**：只做「≠ 机制自身权限轴」排除，不硬编码 `domain-admission` 一类业务名，取证照旧把 axis 当不透明串 principalCan（CONTRACTS 已写明不构成回流）。实测 `tests/d26-authority-axis.test.ts` 4 例（A1-1/A1-3 两轴装配期拒 + 正当轴照常 + 怪轴恒 false 的 fail-closed 边界）；**变异验证**：短路该判据（`false && includes`）⇒ D26-1/2 转红、D26-3/4 保绿，还原 `sha256sum -c` OK |
| N6 | **P1 完整性 — 已修（包 4，2026-10-30），待独立复验** | **冻结判据表曾用裸下标查表，而 `policyVersion` 在插件自写的 payload 里**（修前 `test-records.ts:357`）⇒ `'constructor'` 查到 `Object` ⇒ 真值 ⇒ **v3 全部形状判据（`designationSchema`/字面相等/`issuer===actor`）整体旁路**，授权主体可把任意畸形行铸成权威 `ADOPTED`（载荷 `issuer` 被完全无视）；`'toString'` 同族（返回真值字符串） | 修法已落地（CONTRACTS.md §16.2 投影信任模型第 4 条包 4 纪律）：`test-records.ts` 查表改 `lookupStandingRule` = `Object.prototype.hasOwnProperty.call` + 命中值过「必须是登记过的函数」形状校验，未知/原型键/非函数一律 fail-closed 不计入；**禁用了 `in` 与裸下标真值判断**。验收锚 = **席位 FIXPROBE-1/2/3/4 原样移植**进 `tests/n6-n7-frozen-table-prototype.test.ts`（只改 import 深度，断言一字未动）：现状 **3 红 1 绿**（把修法回退成裸下标实跑，见本包回报变异输出）、修法落地 **4 绿** |
| N7 | **P1 可用性 — 已修（包 4，2026-10-30），待独立复验** | 修前 `policyVersion:'__proto__'` ⇒ 取到 `Object.prototype`（非函数）⇒ `standingAt` **`TypeError` 崩读者且永久**：账本不可删改，**再写正当 `WITHDRAWN` 仍先崩** ⇒ 对该对象的 standing 语义永久 DoS、**机制内无自愈** | 同一修法顺带封堵（`lookupStandingRule` 命中值非函数即 return undefined ⇒ 调用方 fail-closed 正常返回「不计入」，**不抛异常崩读者**）。爆炸半径如实：插件 `eventsOf` 不查判据表 ⇒ **幸存**，读者是 standing 消费面而非全体插件读面。验收锚 = FIXPROBE-2（回退裸下标时 `TypeError` 现形=红、修法后 `NOT_ADOPTED`=绿），同文件 |
| N9 | **P3 — 部分修（G4-A 逐表实测：覆盖面恰等于"有 DELETE 触发器的表"；H 五表真修）** | 修前 `INSERT OR REPLACE` **静默改写历史行**：`UPDATE`/`DELETE`/`ON CONFLICT DO UPDATE` 均被触发器拦，唯独 `REPLACE` 走"隐式删除+插入"，而 SQLite 的隐式删除**仅在 `recursive_triggers=ON` 时才触发 DELETE 触发器**（端口未开）⇒ 整行替换成功、投影翻 `ADOPTED` | 可达面 = 装配裸面/运维（插件拿不到 `raw`），**非越权**，但破坏 append-only 这一核心不变量。修法（CONTRACTS.md §16.2 包 4 存储纪律）：`sqlite-port.ts` 连接建立处 `PRAGMA recursive_triggers=ON`（REPLACE 隐式删除触发 `ledger_no_delete` abort）+ guard 面登记 `insert or replace`/`replace into` 为被禁写法（纵深，先于触发器拒）。实测 `tests/n9-replace-append-only.test.ts` 2 例（裸面 REPLACE/REPLACE INTO 撞 `HISTORY_IMMUTABLE`、原行一字不变、投影不翻；guard 对无触发器表同拒、普通 insert 不误伤）。**变异验证**：关 pragma ⇒ N9-1 红（REPLACE 成功、投影翻 ADOPTED），还原 `sha256sum -c` OK。**如实**：pragma 改了存储层行为，g0-gate 全量采集显示 attacks 基线一字未变（32 条已知红），无意外转绿/转红。**包 5 跟进（2026-10-30）**：本行 G4-A 判定「覆盖面恰等于有 DELETE 触发器的表」已被正面处理——`capability_route`/`object_directory`/`meta` 补 7 触发器并入 `REQUIRED_TRIGGERS`（D-27/D-28/D-29），guard 归一化重写（D-30），`SCHEMA_VERSION` 5→6；`journal`/`projection_*` **仍无**不可变性触发器（派生/压实面，形态由守卫兜），残余清单见 CONTRACTS.md §16.2 包 5 存储纪律 |
| GT-4 窗口增长史（已由上条关闭） | **（历史行）** | 席位 G3-A 重放：可静默消失窗口 = `155 − 90 = 65 例 ≈ 42%`（注释仍写「95 例」，从未随基线重锚）。**包 4 现状**：作者侧已增至 167 例（新增 FIXPROBE 4 + D-26 4 + N9 2 + N3 净 2 例），窗口进一步扩大到 `167 − 90 = 77 例 ≈ 46%`——下限锚点从未随基线移动的缺陷更严重了 | 同 N5/GT-2/GT-3，正式 CI 前硬化；下限须由基线自身推导（本包未动 `g0-gate.mjs`，按纪律不顺手改门禁数字，留待父席裁决） |

### G4-A（第四席 @978a70b）追加：D-27…D-30 与 GT-4/GT-2 同洞两面

| 编号 | 级别 | 事实（席位实测，非推断） | 修法（包 5 状态：作者自报**已修**，待独立复验） |
| --- | --- | --- | --- |
| **D-27** | **P1 — 已修（包 5 触发器 + 包 6 真修，2026-10-30），待独立复验**（G5-A 曾判「部分修」：十写形矩阵全灭 ⇒ 触发器覆盖本体为真；守闸形状可伪造 + 可达面误判已由包 6 收口，见 G5-A 节真修记录） | `capability_route` 两个触发器都没有 ⇒ `REPLACE` 把 `enabled=0` 改回 `1` 并伪造 `changed_seq`、**零 ledger 审计**；新进程 `activate()` 读持久路由 ⇒ 停用被静默撤销、该能力恢复签发。**绕开 `capability-admin` 轴的持久化**，被绕的是"停用"这一安全决策（回滚 D-25 语义） | 路由表三触发器（`route_no_delete`/`route_insert_guarded`/`route_change_guarded`，CONTRACTS.md §16.2 包 5 存储纪律）：启停/移交只能经机制通道且**审计先落、同事务原子**（三个正当写方写序改为 ledger 先行；原子性由 `uow→port.tx` 单一事务边界保证，机制内无第二边界——外部复审点名后已实测三形态零残留并把原子性**架空**一次证明测试抓得住幽灵，还原 sha256 等值）。**实测两态**：修前席位链复现成功（REPLACE 生效、新进程恢复签发、零审计）⇒ 修后被拒。**诚实修正（闸序与直觉不同，G1 谈存储契约会被引用）**：席位原形（带伪造戳 `-1`）实撞 `ROUTE_SHAPE_FROZEN`——BEFORE INSERT 先于冲突消解执行；「登记形 REPLACE」穿过形态闸后才撞隐式删除的 `ROUTE_FROZEN`。两闸各有用例钉（D27-1/D27-4）。验收探针出处 `RE-REVIEW-G4-A.md` §③，落地 `tests/d27-route-audit-gate.test.ts` 6 例。**包 6 真修**：预留 + 见证判据（G5-A 节真修记录），D27-4 的「无见证 mint 过闸」诚实边界**翻正为拒**，残余边界改钉在 `tests/g5a-d27-audit-reserve.test.ts` G27-C |
| **D-28** | **P2 — 已修（包 5，2026-10-30），待独立复验**（席位建议向上探 P1 的裁级仍留用户/裁） | `object_directory` 有 UPDATE 无 DELETE 触发器 ⇒ `REPLACE` 改 `created_seq`/`owner` 成功、`DELETE FROM` 抹身份行成功；换假 owner 后该对象**所有读路径当场 `CAPABILITY_INACTIVE` 且机制内无救济**（UPDATE 被拦 ⇒ 连"改回来"都做不到）。**RD-01 身份冻结在存储层从未闭合**，包 4 的"append-only 补漏"是过度主张 | `directory_no_delete`（REPLACE 隐删同拒，复用 `DIRECTORY_IDENTITY_FROZEN`）+ `directory_birth_audited`（账本非空空间的新身份行必须带真实 `object-registered` 出生账；空账本=迁移器/夹具形状不参判据，如实登记）。**修法方向的本行原文「owner 变更必须经 capability-admin」被包 5 裁定取代**：PoC 内不存在正当的 owner 变更路径，「留可变列而无正当写者」正是本洞根因 ⇒ 裁定 **owner 一经登记不可变更**，`transferRoute` 语义对齐为只动路由行不碰目录行（CONTRACTS.md §16.2）。落地 `tests/d28-directory-identity.test.ts` 4 例（含席位三式全灭与「先落账再插行」上限钉）|
| **D-29** | **P3 — 已修（包 5，2026-10-30），待独立复验** | `meta.ledger_seq` 可被 `REPLACE` 与 `ON CONFLICT DO UPDATE` 归零 ⇒ 缺口检测与 seq 截点读的**单调前提失效**（H 序号倒退/撞号） | `meta_counter_monotonic`（任何键只增不减，含 `schema_version`——版本下调同拒）+ `meta_ledger_seq_no_delete`（堵 REPLACE 的隐删形）。归零两式实测均撞 `META_COUNTER_MONOTONICITY`。**边界如实**：`id_counter` 键 DELETE 不拦（打开期 `SCHEMA_UPGRADE_REQUIRED` 已治理，old-schema 绿条钉着）；前跳 ghost seq 触发器层不可分辨。落地 `tests/d29-meta-counters.test.ts` 5 例，**含存量库打开路径专测两条**：版本退回 5 的库重开必红（detail 带 foundVersion/expectedVersion/missingTriggers）；**7 条新触发器逐一摘掉都必 `SCHEMA_UPGRADE_REQUIRED` 且 missingTriggers 逐名**（「触发器只护新库」类缺陷从此有人发现——外部复审点名） |
| **D-30** | **P3 — 已修（包 5，2026-10-30），待独立复验** | guard 纵深被四式穿过：`insert/*c*/or replace`、`replace/*c*/into`、`insert--c` + 换行 `or replace`、`ON CONFLICT DO UPDATE`（`normalizeSql` 只剥**前导**注释、锚是 `^`）；对**无触发器表**改写生效。对照诚实：对 H 五表这些形态照样撞触发器 ⇒ **废掉的是 §16.2「先于触发器拒」的承诺，不是 H 本体** | `normalizeSql` 重写：剥**全部**注释（块/行、任意位置）后**子串**匹配（弃 `^` 锚——中置注释证明锚本来就是错的）；名单补 `on conflict … do update`（`do nothing` 保持合法，投影登记在用）。落地 `tests/d30-guard-forms.test.ts` 3 例（四式各一 + 合法形态不误伤 + 双层纵深定位）。**词法残余登记**：字符串字面量内伪关键词仍可绕、字面量内注释符误杀（误杀方向安全）；主修是触发器层，guard 是纵深 |

**GT-4 与 GT-2 是同一个洞的两面（此前分两项记账是分类错误，不是进度问题）**：锚挡住的是**数量**漂移
——删 4 例红、加 1 例红、有红时 `--reanchor` 拒写（锚文件逐字节不变）、祖先戳在位，四条全部实证有效；
但**等量替换**（删 `d26-authority-axis` 4 例真测试 + 补 4 条 `expect(1).toBe(1)`，**不经过 `--reanchor`**）
⇒ 门禁 exit=0，打印原文「OK —— 167 例全绿，与覆盖面锚逐等（skip=0，exit=0，success=true）」。
**锚只记计数、无身份。** 另记我方虚记：`g0-gate.mjs` 注释称锚记录「`passed` / `files` / 生成提交」，
实际键集**无 `files`**、`total` 从不参判据 ⇒ **这是我在修 GT-4 的当次写下的第三个"把期望写成事实"**，按原样入账不替自己圆。
**包 5 落地（2026-10-30，作者自报，待独立复验）**：先把那段虚记注释改对（改为三代演化史：魔数下限 →
计数锚——如实写明它只比 `passed`、`total` 记而不判——→ 身份锚），再实现**身份锚**：`AUTHOR_ANCHOR.json`
新增 `passed_sha256`（排序后「文件相对路径 > 用例全名」集合摘要，与审查方 BASELINE 名集判据同构）+
`files_sha256`（`tests/**`「相对路径+内容 sha256」清单摘要）；`passed`/`total` 降级为可读冗余但
**仍参与判定**（不符即红，可读数字不得与摘要脱钩）；`generated_from_commit` 必须是 HEAD 祖先；
拒写条款**一字未动**（有红/有 skip/非零退出 ⇒ 拒 `--reanchor` 且锚文件零写入）。
四件变异实测（原文输出贴包 5 回报）：删 1 文件红 / 加 1 例红 / **等数替换红**（此前 exit=0 的验收锚）/
测试文件改一个注释字节红（由 `files_sha256` 承载）。
**诚实边界（修正此前一条写早了的话）**：本段原文称残余是「同名只改断言体……任何锚都拦不住」——
`files_sha256` 落地后该形态**已被捕获**（断言体改动=文件内容改动）。真正收不住的是
**「改断言体并且重锚」**：重锚本就是机制要求的显式承认流程，人一边改语义一边认新锚，摘要拦不住——
这是**人认**的边界，防线只剩变异抽检纪律（纪律，非机制）。此句同步写进 `g0-gate.mjs` 头注。

**席位自报的实验教训（入 REVIEW）**：`REPLACE` 只在**主键冲突**时才走隐式删除，无冲突的 `REPLACE` 就是普通插入
⇒ 席位 v1 覆盖面矩阵"全绿"是**假阳性**；任何 REPLACE 类主张必须先播种冲突行。
连带核验：作者的 `N9-1` 种子 REPLACE 撞的正是自己刚签发的 seq ⇒ **真冲突，不虚绿**。

### G5-A（第五席 @03d74a0）追加：可达面误判的纠正 + 三处提级 + 我那条裁定造的 P1

**先记一条对前席与作者共同误判的纠正（不是新发现）**：D-27 的可达面此前一直被记成"装配裸面/运维"。
G5-A 实测 **mint 审计在插件可达面即可**——`appendLedger` 对五个机制审计名
（`capability-enabled/-disabled/-transferred/object-registered/check-report-recorded`）**零预留**，
任何只有 `space-write` 的主体能落账与 `setRouteEnabled` 真账**逐列同形**的行
（`event_type` 同、payload 同形、`actor` 自定、`authority_basis` 同为 NULL），
全链到"新进程 `declare` 成功"。而守闸判据只查 `seq`/事件类型/`payload.capability`，
**不查 `actor`、不查 `authority_basis`** ⇒ 实质是**「静默改写」→「可伪造改写 + 伪证借 `ledger_no_delete`
获得不可篡改性」**，伪证与真账机制上不可区分。**修法三判据已在报告逐条验证**：
①预留机制**现成**（正式事件名已有 `EVENT_AUTHORITY_REQUIRED` 对照）⇒ 补全非新发明、不引入新中心耦合；
②守闸必须核 `authority_basis` + `actor` 机制落账；③**只做 ① 不做 ② 仍过闸**（攻击者用真实 actor mint）。
**包 6 真修（2026-10-30）**：①五个审计名进预留通道（`isReservedEventType`：正式名 ∪ 机制审计名，
`appendLedger`/`write()` 同码 `EVENT_AUTHORITY_REQUIRED`，清单认领五名 `AMBIGUOUS_AUTHORITY`）；
②`route_change_guarded` 审计存在性判据补核 `actor` 非空 + `authority_basis` 机制见证
（N1 同信封 `axis=capability-admin ∧ capability 字面相符 ∧ authorized=1`，三个正当写方落账时盖章）。
席位 ③ 判据（半形必红）由 `tests/g5a-d27-audit-reserve.test.ts` G27-C 专用钉子承载：真实 actor mint、
逐列同形、无见证 ⇒ 拒；见证内容造错亦拒。收窄未归零的边界如实：裸面连见证列一起伪造仍可过闸
（同文件登记为显式断言），处置归运维/审计。

| 编号 | 级别 | 事实（G5-A 实测） | 修法 |
| --- | --- | --- | --- |
| **D-31** | **P1 可用性 — 已修（包 6，2026-10-30），待独立复验**（作者裁定引入，前四席未抓到） | 我包 5 裁定「owner 一经登记不可变更」与 `transferRoute` 携 `ns` 的既有语义互斥：携新 ns 移交后，既有对象 `readSnapshot`/`readLatest` 全抛 `SCHEMA_INCOMPATIBLE`，`readAsOf` 的 `serveable()` 只兜 `CAPABILITY_INACTIVE`、该错直接上抛 ⇒ **整库扫描读面死，且不存在任何能通过的历史截点页**（毒对象自 `seq=1` 就在每一页；`activate` 不写 `domain_state`），重启持续。**一次完全合法、全走机制通道（`capability-admin`）的操作 = 永久毒化全库双时间读面** | **包 6 落地**：取 **(a)**——`reassignRouteInternal` **删除 ns 参数**（机制面无改 ns 通道），`transferRoute` 把清单 ns 降为**校验输入**：与当前生效路由 ns 不符 ⇒ 入口即拒新码 `TRANSFER_NS_DRIFT`（零半成品：不开事务、不落账、路由不动；契约先行 §16.3）。正向对照（C1c 同 ns 换包）与三读面逐截点无恙由 `tests/g5a-d31-transfer-ns.test.ts` 4 例钉死；`TRANSFER_NS_DRIFT` 不泄漏跨空间存在性负例同文件。行为变化如实登记：移交现要求能力在内存视图激活且持久路由 enabled（插件面**收紧**，KERNEL 成员对拍见包 6 回报）；ns 迁移**机制内无通道**，另立显式路径归 G1 |
| **D-24 读侧落点** | **P1 完整性/语义可信 — 读侧已修（包 6，2026-10-30），写侧挂载登记仍待 G1，待独立复验**（原按"登记未修"记，G5-A 提级） | `write()`（ns=自己、oid=他人）在机制面**成功** ⇒ `readAsOf` 扫描面**无 ns 过滤**，以**他人对象之名**端出攻击者 payload；`readLatest`/`readSnapshot` 按 `dir.ns` 过滤 ⇒ 看不到。**同一对象同一时刻两个答案、插件可达、写侧全走机制通道** | **包 6 落地（读侧）**：`readAsOf` 扫描查询带上行 `ns`，每行过**同一个** `routeNs` 归属函数（与快照面同源，不是复制逻辑）；行 ns ≠ 有效归属 ns ⇒ 剔除并计数；`SCHEMA_INCOMPATIBLE` ⇒ 计数不上抛——**归属不符不再炸整页**，每个截点页可读。计数并入 `hiddenByContractSkew`（语义加宽：版本偏差/路由 ns 漂移/归属不符；echo 键集不动——冻结 oracle 探针钉着它）。三读面同一时刻一致 + 逐截点存活 + 剔除可归因由 `tests/g5a-d24-read-attribution.test.ts` 3 例钉死（C3 投毒行以他人之名出现 ⇒ 修后只端属主状态）。写侧「扩展挂载登记」完整修法仍归 G1；合法挂载行在扫描面不再出现（可见面收窄）已钉成显式断言不藏着 |
| **D-21** | **P1 可用性 — 最小止血已修（包 6，2026-10-30），前缀完整语义待 G1，待独立复验** | `RPT-${head+2}` 等保留前缀 id 任何 `space-write` 主体可**滚动预占** ⇒ 合法验证提交撞 `RECORD_ALREADY_DECLARED`，报告落账面**持续**拒用 | **包 6 落地**：`declareRecord` 显式携带保留前缀（`RESERVED_RECORD_ID_PREFIXES=['RPT-']`）⇒ 新码 `RECORD_ID_RESERVED` 拒（身份 namespace 判据不是存在性判据：空空间/已占用空间同形同拒，负例已钉）；机制 `recordReport` 按计数器发号不受影响、**引用**既有该前缀记录不受影响、非保留前缀照常（不过度封口）。滚动预占在源头断粮（`tests/g5a-d21-reserved-prefix.test.ts` 3 例）。不发明分配器政策：前缀全集/域保留申请归 G1 |
| **N9 残余补两行** | P2/P3 — **已修（包 6，2026-10-30）** | (1) 归零后首次机制提交以裸驱动错误 `UNIQUE constraint failed: ledger.seq` 越界暴露 ⇒ **违例「驱动词汇不得越过 Storage Port 边界」**（本行即为违例登记，包 6 修掉后登记保留为事实）；(2) 打开判据缺 `max(ledger.seq) ≤ 水位` | **包 6 落地**：(2) 打开路径补水位判据——`max(ledger.seq) > meta.ledger_seq` ⇒ `SCHEMA_UPGRADE_REQUIRED`（detail 给 `ledgerMaxSeq`/`ledgerSeqWatermark`，与「OID 计数器落后」同族判据）；(1) `translate()` 把 errcode 19 且消息含 `ledger.seq` 的裸驱动错误包装为机制码 `LEDGER_SEQ_CONFLICT`（`retryable:false`——重试只会再撞同一号；驱动文本只留在 detail 作证据，TX_CONTENTION 同法）。两形 + detail 形状负例由 `tests/g5a-n9-storage.test.ts` ST-A/ST-B 钉死（破坏面用手工裸连接构造——如实的承诺外域） |
| **REQUIRED_TRIGGERS 只比名字** | P3 — **已修（包 6，2026-10-30）** | 摘触发器 + 建**同名空壳** ⇒ 重开全绿、保护全灭（`writable_schema` 改体被 node:sqlite 拦，标未验证） | **包 6 落地**：打开判据升级为**名字 + SQL 体摘要**——期望摘要在模块加载时于内存基准库 `exec(SCHEMA)` 读回 `sqlite_master` 计算（**不手工维护摘要表**，SCHEMA 是唯一正源；归一化只折叠空白与 `if not exists`/头部大写差异，同体异形不误报、同名异体必报）。名字缺失仍走原判据（缺失优先于改体）。ST-C 用裸连接 drop+同名空壳重建 ⇒ 重开 `SCHEMA_UPGRADE_REQUIRED` 且 `alteredTriggers` 点名。残余登记：字节级原样抄回的同体重建在盲区（那要求保持数据不变量成立） |
| **C2 巡检盲区** | P2 — **已修（包 6，2026-10-30）** | `auditRequiredIntegrity` 只巡 `required=1` ⇒ 幽灵边在位而它打印**「0 违规」**（`ref_edge` 无触发器）⇒ **清白回执本身是误导** | **包 6 落地**：巡检覆盖 `required:false` 的**目标存在性**（object-ref 查目录 / record-ref 查 records；修订级悬空是 `required:false` 的合法语义，**不**计幽灵——边界钉在 C2-B），回执加宽为 `{checked, violations, softChecked, softGhosts}`——**只报不阻塞**：`violations` 语义一字未动、无关主体照常提交。「0 违规」与「无幽灵」脱钩由 `tests/g5a-c2-soft-ghosts.test.ts` 3 例钉死（幽灵在位 ⇒ violations=0 且 softGhosts>0；干净库两者皆零防恒红噪音）|

**GT-4 身份锚：G5-A 七条变异路无一静默绿**（改名等数替换／保名掏体／`test.skip`／移 `tests2/`／
`--reanchor` 拒写…）——我点名要找的"**不需要人配合的口径**"确认不存在（`tests2/` 仍被 vitest
子串收集，且名集 key 含路径 ⇒ 双红）。唯一洗白链是**「改断言体 + 重锚」**（实锤：掏空 D30-1 四条真断言
⇒ 重锚 ⇒ 打印「与身份锚四项逐等 OK」）。**最低机械防线三条（席位给，作者采纳）**：重锚输出名集增删 diff
并高亮"0 增删但内容有改写"；锚记 `reanchored_by` + `delta_sha`；CI probe 拦「`tests/**` 与锚同提交变更却无
`Anchor-Review: <日期> <非作者>` 标记」⇒ **把二人规则机验化**。
**新洞2 的可判定结论**：机制**不保证**它打开的连接全生命周期带 `recursive_triggers`（只在构造时开一次，
`port.raw` 未守卫可随时关）；关闸写入的数据重开**不可检出** ⇒ **"存储不变量对并发/外部写入者不设防"为真**，
且**界外是自家 `raw` 面、不是第三方**。修法：水位判据 + pragma 状态写 `meta` 且每次机制写前比对 +
`port.raw` 要么守卫要么在契约里明写"拿到 raw 即获得撤销全部存储不变量的能力"。
**包 6 裁决落地（2026-10-30，契约先行 §16.3）**：二选一**取守卫**——`port.raw`（含 `world.raw`）拒
**DDL / PRAGMA 赋值形 / ATTACH / 多语句**（`RAW_SQL_REFUSED`；词表与机制写句柄同源），PRAGMA **裸读形**
（`pragma <name>`，无赋值无参数）与 DML 放行——前者只读连接态（既有绿锚 N9-1 用它核对），后者是界外面
本职且 REPLACE/upsert 仍**放行到触发器**受拒（「触发器不豁免写形」锚不被守卫截胡）。经本 Port 交出的
任何句柄从此关不掉 `recursive_triggers`；**手工 `new DatabaseSync`/裸文件仍在承诺外**（默认 OFF、关闸
写入重开不可检出）——契约不再写"经 SqlitePort 的连接全部受护"，改写为「守卫域内不可关 + 守卫域外如实
不设防」。**席位给的另一路「pragma 状态写 meta 且每次机制写前比对」未采纳**，理由如实：比对只能在
Port 自己的句柄上读回，读到 OFF 也无处强制恢复成原子动作（读-判-修之间有窗口），且防不住同连接上
"改回 ON 再动手"的时序；守卫直接在入口拒赋值形，无窗口可乘。水位判据（N9 残余(2)）同包落地。
**GT-2 比此前登记更宽**：`attacks/**` 无任何内容摘要 ⇒ 红条掏成 `expect(1).toBe(2)` 仍 PASS。
GT-3 / N5 / E-01 / N3 / N4 状态维持（G5-A 各一次最小复现，N3 静态核对不回归）。
### G6-A（第六席 @398df30）追加：包 6 复核 —— 五 P1 修法成立，但三个结构性面必须进 G1

**总裁定**：D-27 / D-31 / D-24 读侧 / D-21 / C2 **五条 P1 修法全部成立、无虚报**；33 条已知红逐等，
0 新增红、0 红条消失、0 skip、0 loadErrors。**重建文件 `sqlite-port.ts` 判「有条件可信」**
（19 hunk = 15✅ / 3⚠️ / 1❌），**❌/⚠️ 处置前不得当作已终审资产引用**——这是它自己的措辞，我保留。

| 编号 | 级别 | 事实（G6-A 实测） | 修法 |
| --- | --- | --- | --- |
| **F-G6A-1** | **P2 — 未修（文档与边界双失实，我写的）** | 类目名 `BARE_PRAGMA_READ`（"裸读形"）**名不符实**：`pragma optimize`（跑 VACUUM）与 `pragma wal_checkpoint`（返回 busy/log/checkpoint）**是有写副作用的操作却被放行**。对照诚实：一切能伤 durability 的开关（`journal_mode`/`synchronous`/`locking_mode`/`query_only`/`writable_schema`/`foreign_keys`）的**赋值全形**（含空格形/等号形/`main.` 前缀形）实测全拦，裸词形实测纯读 ⇒ 无 durability 实伤 | 更名 `PRAGMA_FUNCTIONLESS_PASSTHROUGH` 并在契约明写"按**词法形状**放行、不按语义"；白名单只豁免返回单行的查询形，`wal_checkpoint`/`optimize`/`foreign_keys` 函数形一律拒（草案见报告 §C.2） |
| **F-G6A-2** | **P4 — 未修（单列，我包 6 修法的真实上限）** | 路由闸对 `actor` **只核非空**：`actor=任意他人主体` 照过，只有 NULL 被挡 ⇒ 正确表述是**「核的是『有一个 actor』，不是『这个 actor 有权』」** | 闸追加信封一致性 `l.actor = json_extract(l.authority_basis,'$.actor')`，机制侧信封增写 `actor`（取证同源） |
| **F-G6A-3** | **P3 — 未修（界内新形态，标注「我上席写的方向判据自身有洞」）** | **停用复活·PK 改名链**：3 步（任意名伪造审计 + `UPDATE` 改 `capability` 主键 + `INSERT` 新生登记行）⇒ 复活启用、`changed_seq=NULL`、**全程零启用审计**；唯一痕迹是一枚**不在任何机制扫描面上的墓碑行**（`route_no_delete` 让它删不掉）。插件可达面先撞 `EVENT_AUTHORITY_REQUIRED`（mint 已死），故界内 | `route_insert_guarded` 对**新生行也要求随附审计**（首登记 bootstrap 另立界）+ 墓碑行纳入巡检。方向判据③的三元组名单漏了"capability 主键出现/消失"这一维 |
| **F-G6A-4** | **P2（升级注记：真实产品 P1 运维洞）— 未修** | **D-31 只修了入口，历史面敞开**：v6 漂移库（按包 5 **合法通道**造）在 `398df30` 打开撞 `SCHEMA_UPGRADE_REQUIRED`——**是被版本墙顺住，不是被检出**（版本对齐后即零声纳）；v7 库内同形漂移**重开照常开**，快照面 fail-loud / 扫描面计数存活，`auditRequiredIntegrity` 对漂移**零声纳**，救济无门（`dir.ns` 被 `directory_no_update` 冻死，`route.ns` 改回也要再伪造） | 打开期 `dir.ns` vs `route.ns` 全表比对，不一致 ⇒ 拒开并点名；受审计的 ns 迁移通道与 `dir.ns` 冻结**冲突** ⇒ **G1 设计题** |
| **F-G6A-5** | **P4 — 未修（"只报不阻"计数器的共同缺陷）** | `softGhosts` / `hiddenByContractSkew` 等计数**合法流量可淹没**（1 投毒 + 5 合法 = 同一个 6）且**不落任何持久工件** ⇒ 可见性是每次读的一过性回声，**没人盯回声就没有发现** | 统一建议：这类计数随每次审计运行落一条**机制事件**，成为可回看的记录（比逐个补测试有用） |

**给 G1 的三句裁决位（报告原文，不改写）**：
① **「当前默认策略 = 名单外事件名默认可写（deny-by-exception）」**——机制审计名是**白名单枚举制**，
`object-revised`/`record-backfilled` 与任意未来名照常可 mint，**今天没洞只因触发器恰好不依赖它们**；
② 历史面：**顺墙撞上 ≠ 检出**；打开期扫描 + 迁移通道 与 `dir.ns` 冻结互斥，须一并裁；
③ **从 SCHEMA 源里删触发器定义，只被 `tests/**` + 重锚挡住**（`expectedTriggerDigests` 与 SCHEMA 同源
⇒ 摘要判据设计上只覆盖"改体/同名空壳"，不覆盖"删定义"）。
**门禁面维持**：GT-2（已登记红的断言掏成 `expect(1).toBe(1)` ⇒ 门禁 PASS，`attacks/**` 内容零校验）、
GT-3（重算基线 ⇒ PASS）、N5（登记红吸收 `afterAll` 崩溃）、GT-4 唯一洗白链（改断言体 + 重锚）
全部最小复现成功；**新增一条未登记细节：`attacks` 基线没有 `--reanchor` 通道，重算 JSON 无"当前不干净拒写"护栏 ⇒ 比作者锚更隐蔽**。
E-01 / N3 / N4 状态不变。

