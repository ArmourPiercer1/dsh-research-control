# 独立复验 R9–R12：作者自述修复是"真封死"还是"测试变绿"

**席位**：独立复验席（与父代理不同上下文、不同会话）
**状态**：**已完成**（五项全部落盘；HEAD 基线 `7dc953f` ≥ `30afe91` 已核）
**仓库**：`/home/user/dsh-plugins/dsh-research-control`，目标 `experiments/v3-code-architecture-poc/`，要求 HEAD ≥ `30afe91`

## 独立性边界（先读）

父代理也是 `qwen3.8-flash-next`。本复验与父代理**不同上下文、不同会话**，但**不是不同模型**。本报告**不应被当成"多模型交叉验证"**——它的证明力低于跨模型复验：同一模型的共享盲区（同类推理捷径、同类遗漏模式）不会被本复验覆盖。它只能证明"另一个上下文独立重跑了一遍静态与动态检查得到 X"。

## 逐项结论

### 1. F-EV-R2 写侧根因 —— 判定：**真封死**（机制内路径），作者自述与 git 事实逐条相符

**根因自述核 git 属实**：`git show cd82793~1:…/src/kernel/kernel.ts` 显示修复前 `revise` 的语句是
`insert into domain_state(ns, oid, revision, payload_json, recorded_seq) values(?,?,?,?,?)`（旧文件 L604，
**无 contract_version**），而 `createObject` 与 `NamespaceWriterImpl.write` 当时已盖戳。
⇒ "凡 revision≥2 的行标记全为空串 + 读侧空标记被拒/未装判据面静默放行"的因果链成立，非事后编造。

**现态**：三处 insert（kernel.ts:534 write / 585 createObject / 619 revise）全部盖 `contract_version`。

**第四处写路径普查（不止看他改的那处）**：全 poc `(?i)insert\s+into\s+domain_state` + 全量 `domain_state`
引用 49 处逐处读——
- `migrateLegacyRecords`（sqlite-port.ts:125-165）只写 records/ledger/journal/meta，**不碰 domain_state**；
- `harness/world.ts`、`src/kernel/projection.ts` 对 domain_state **零引用**（projection.ts 对
  readAsOf/readLatest/readSnapshot/eventsFor/payload 亦零引用——投影不构成 payload 出口）；
- 其余命中全在 tests/attacks 的攻击脚手架里。⇒ **机制内不存在第四处写路径**。

**唯一旁路不是"漏盖戳"而是无守卫句柄**：`SqlitePort.raw`（sqlite-port.ts:314）返回**未经 guard** 的
adapter，`kernel.port.raw` 可直写不盖戳的行。但伤害被读侧纪律封顶：不盖戳 ⇒ `contract_version=''` ⇒
`assertContractVersion`（kernel.ts:162-169，`recorded === ''` 同拒）在**全部四个判据面**拒读 ⇒ 无法静默
端给读者。该旁路与 D-7（`Kernel.port` 公开）同根同罪，已登记为唯一剩余 P1，不是 F-EV-R2 的新洞。

**新发现 P2（作者未登记）**：ns→capability 反查 `capabilityOfNs` 遍历 routes()；activate() 禁两能力共享
ns（kernel.ts:263-273），但 `transferRoute`/`reassignRouteInternal` 运行时改路由**不重查唯一性** ⇒
运行期移交可造出共享 ns，此后写侧盖戳与读侧判据取哪个能力由 Map 迭代顺序决定（R3-C 防护在运行期移交
路径失效）。无攻击测试覆盖。不否定本项判定，但属盖戳正确性的邻面残留。

### 2. 逐读面判据 —— 判定：**真封死**（六面逐一手验）；eventsOf 维持 P2 但**推翻作者理由**

**逐面读码**（全文通读 kernel.ts 807 行 / read-context.ts 130 行）：

| 读面 | 位置 | 判据 | 判定 |
|---|---|---|---|
| `readRevision` | kernel.ts:303-318 | select 带列 + assertContractVersion ⇒ 拒读 | ✓ |
| `readSnapshot`/`readObject` | :475 → UnitOfWorkImpl.readLatest :721-741 | 与 readRevision 共用同一函数 | ✓ |
| `PluginFace.readLatest` | NamespaceWriterImpl.readLatest :552-563 | 拒读 | ✓ |
| `PluginFace.readOwn` | :435-438 → 同上 | 拒读 | ✓ |
| `readAsOf` | read-context.ts:91-103 | 剔除 + `hiddenByContractSkew` 计数，keep 集合在 :107 真实参与行过滤 | ✓ |
| `PluginFace.revisionOf` | :421-426 | 恒拒 NAMESPACE_ESCAPE（占位符，可被攻击测试持续验证） | ✓ |

:735 的 `if (cap)` 短路**不可达为假**：`routeNs` 通过 ⇒ owner cap 存在且 ns 匹配 ⇒ `capabilityOfNs` 在同一
routes 集上必命中——不是漏点。

**其余出口排查**：journal——Kernel 从不写 `journal.payload_json`（四处 insert 均只写 tx_epoch/ns/oid/op），
无 payload 面；records——kernel 内只有存在性查询（:373/:651/:801），无 payload 读面；`resolvePresented`
只回 PRESENT/OPAQUE；`w.raw`/`port.raw` 裸读能把任意旧形状行交给调用者且不可归因——但那是 D-7 的全库
无守卫句柄本体，已登记 P1，**不是本项的漏网出口**。⇒ 除已登记的 eventsOf/D-7 外**无第三个漏网出口**。

**eventsOf（ledger 无版本列）**：**级别 P2 维持，作者理由推翻重写**。
- 作者理由"套当前版本判据=升级即失忆"方向对但非最强论据：ledger 根本没有版本列，该判据**字面上无法
  实施**；唯一替代实现（拒绝末次移交前的事件）才是失忆。
- 真正的支撑是**归因可重建**：每次移交写 `capability-transferred` 事件 + `capability_route.changed_seq`
  （kernel.ts:747-761），读者可按 seq 恢复事件的契约时代。
- **但归因是有条件的**：移交登记只是 kernel 写路径的承诺，`port.raw` 旁路不留 ledger/journal 痕迹 ⇒
  eventsOf 的"可归因"论证**依赖 D-7 收口**。作者与附录 B D-11 均未写明这条依赖。建议 D-11 补一句：
  若不做 ledger 盖戳，必须显式声明"事件归因依赖移交登记完备性，而移交登记可被 D-7 旁路破坏"。
  这条依赖不改变 P2 定级，但使"不算漏网"的裁定从无条件变为有条件——正是 D-11 自己警告的"不能以
  '不算漏网'的名义消失"的另一种形态。

### 3. `KERNEL_SURFACE.sha256` "属收紧非放宽" —— 判定：**结论成立；但作者给的复现区间是空的，无法照抄**

**无法复现作者的复现步骤（如实登记）**：`git diff 30afe91~12 30afe91 -- src/ KERNEL_SURFACE.sha256`
输出为**空**——那 12 个提交（5f3d9ed..30afe91）全是 docs 提交，代码修复不在其中。sha256 的实际重生成在
R9–R12 代码修复提交系列（`git log --oneline -- KERNEL_SURFACE.sha256`：bf3185f / 4ac3844 / 913e819 /
fa5cc6b / cd82793 各一次，每次修复各一次重生成，符合"改面必显式重生成"门禁）。我改用 src 实际变更窗口
**`3b2625f..HEAD`** 复验。

**cd82793（本主张所指那次重生成）逐行核**：hash `e554dc7…` → `c97685f…`。被删的代码行**全部**是
"无版本列的旧 SELECT + 不盖戳 insert"（被带判据版本替换）；新增公开成员只有回显字段
`hiddenByContractSkew`（诊断加量，不可能放行任何调用）。⇒ 就该提交，"多拒不多放"**成立**。

**全窗口删改行扫描**（`git diff 3b2625f HEAD -- src/kernel src/contracts` 中所有被删的判据/拒绝行，
共 3 条，逐条核）：
1. `recorded !== '' && recorded !== effective` → `recorded === '' || recorded !== effective`——空标记改判
   拒绝，**收紧**（R3-B 后门闭合）；
2. `CROSS_SPACE_REFUSED` 的 throw 被删——实为**原样搬家**（现 read-context.ts:51，仅挪到完整性检查之后，
   顺序语义是刻意的），非删除；
3. `CAPABILITY_INACTIVE … return false` → 同一剔除 + `hiddenByInactive += 1`——同形加计数。

新增拒绝码：HARD_REF_NOT_PINNED、NAMESPACE_ESCAPE（恒拒占位）、RECORD_ALREADY_DECLARED、
SCHEMA_INCOMPATIBLE、ACTIVATION_IMPOSSIBLE、CAPABILITY_INACTIVE——全部是新增拒绝。

**诚实例外**（"此前被拒现在能过"确有两条，但均为缺陷修复非面放宽）：S-3（4ac3844）使 ① `resolvePresented`
对自身报告 OPAQUE→PRESENT；② required record-ref 指向报告不再报 REQUIRED_REF_MISSING。修复前行为直接
违反 ID-08（"报告可被引用"机制层不可达），属过度拒绝的修复，不构成新的攻击面。

**证据力弱化注记**：该哈希覆盖 src/kernel + src/contracts **全部文件的全部字节**
（arch-independence.test.ts:89-96），注释级改动同样强制重生成——"sha256 被重生成"这一事实本身**不携带
方向信息**，方向必须像本项一样逐提交 diff。作者的"显式重生成+理由"流程合规，但拿重生成当"收紧"证据
在逻辑上不成立；成立的是我独立做的那份删改行扫描。

### 4. D-13 `timeFieldMissing` 口径（作者登记 P3 未修）—— 判定：**P3 定级恰当，不升级**；附最小复现与一行修复

**机制核实**：read-context.ts:117-119，`timeFieldMissing` 的门在 `visible`（截点后、**版本剔除前**）上求值；
版本剔除结果在 `keep`（:91-103），:107 用 keep 过滤 rows。与作者登记一致。

**最小复现（静态构造，未跑测试）**：建一个 payload 无顶层数字 `describedAt` 的对象（或全部行如此），
随后使其行整体被版本剔除（如把生效契约版本改到与行上标记不一致）⇒ `rows=∅`、
`hiddenByContractSkew=N>0`、同时 `timeFieldMissing=true`。

**为何维持 P3 而非 P2**：echo **同一响应里**带 `hiddenByContractSkew>0`，它单独就完全解释空集；
`timeFieldMissing=true` 对 visible 集合在字面上也真（那批行确实不带时间键）。要让读者被误导，读者必须
丢弃同屏存在的 skew 计数——归因误导存在，但不是静默错答，不违反 C12/T-05 的"不可判定不得伪装成没有"
（"没有"从未被声称，两个计数都在）。升级 P2 需要额外假设"消费者只读 timeFieldMissing 不读 skew"，
那是消费纪律问题不是产生侧缺陷。**我不推翻 P3。**

**修复成本一行**：把 :118 的 `visible.length > 0` 改为 `keep.length > 0`、:119 的 `!visible.some(…)` 改为
`!keep.some(…)`——"全被剔除"情形即归 skew 计数独占解释。作者在附录 B D-13 已自认"应基于 keep"，
不另催。

### 5. D-7 残留与附录 A 配方 —— 判定：**配方对，两条主张均成立**；附 3 处订正/补漏

**主张 A"TS private 不算收口，`kernel['port']` 在 JS 里照拿，必须 `#port`"：成立。**
语言层：`private` 只存在于类型面，编译产物是普通实例属性，方括号取法绕过检查。仓内自证：
arch-independence.test.ts:216-224 用 `@ts-expect-error` 证明的只是"类型不通"，而 **L223 的断言
`[x].every(v => v === undefined || v !== undefined)` 是重言式（恒真）**——作者自己没能在运行时层验它。
配方步 1（`#port` + 构造器参数属性改写 + `this.#port`）与步 3（断言升级为
`Object.getOwnPropertyNames(kernel)).not.toContain('port')`）是正确的判据形态。
**订正一处**：附录 A 称 `kernel['#port']` "是语法错误"——不实。`kernel['#port']` 是普通字符串属性查找，
静默返回 `undefined`（私有名不以字符串键存在）；语法错误的是类体外写 `kernel.#port`；
`'#port' in kernel` 才抛 TypeError。配方步 3 不受影响，属 P3 文档瑕疵。

**主张 B"两批事实必须来自同一次 read"：成立且必要。** `tests/empty-vs-absent.test.ts` 守的性质是
"空集的三种成因（禁用遮蔽 / 时间形状缺失 / 真无对象）必须互异可判"。若 `object_directory` 与
`domain_state` 分两次 read 取：并发提交下 state 行可见而 directory 行未见 ⇒ `serveable()` 在
read-context.ts:73 直接抛 `CONTEXT_INCOMPLETE`（异源事实造出的**假错误**）；或路由在两次 read 之间启停 ⇒
`hiddenByInactiveCapability` 按陈旧路由计数 ⇒ 空集被归错类。异源直接破坏该测试守护的三态可判性。
**补漏（作者未写）**：现 `readAsOf` 的 head 本身就在 `port.read` **外**（read-context.ts:53 vs :59，
`k.head` 是另一次读）。今天不炸只因 `recorded_seq` 单调 + `recorded_seq <= head` 过滤恰好兜住——是巧合
安全非结构安全。配方步 2 合并 directory+state 时应把 head 一并折叠进同一次 read，把巧合变结构。

**配方覆盖度补两点**：
1. 配方只收 `Kernel.port`；`SqlitePort.raw`（sqlite-port.ts:314）这个**未经 guard** 的 getter 本身仍随
   port 实例可达（`World` 装配面）。步 5 把它归入"装配后门"刻意不动是对的（它是 §14.1 的物证），但配方
   验证清单应加一条 `kernel['port'] === undefined` 的运行时回归，防 TS private 假收口回潮。
2. 运行时 `UnitOfWorkImpl` 仍带公开成员 `raw` 与 `k`（整个 Kernel 引用）——arch-independence.test.ts 的
   DECLARED 清单（L200-202）自己承认了这一点。`#port` 落地后 `tx['k']['port']` 不可达（私有名经任何引用
   都取不到），但 `tx['k'].transferRoute` 等运维方法仍可达（靠 :444/:746 二次权威核对兜底）。现有运行时
   面判据只查 `faceFor` 窄面（L212-214），**建议配方补一条针对 UnitOfWork 运行时面的同型回归**。

**D-7 定级复核**：`Kernel.port` → `port.raw`（无 guard）→ 任意 SELECT 可取 `check_report` 全文（破 RPT-09）
+ 不盖戳直写 + 移交不登记归因断裂（见第 2 项）——三条独立伤害共用这一根因。**唯一剩余机制侧 P1 的定级
不虚，也未夸大。**

---

## 实际跑过的命令与输出摘要

| # | 命令（均在仓根或 poc 目录） | 输出摘要 |
|---|---|---|
| 1 | `git log --oneline -14; git rev-parse HEAD` | HEAD=`7dc953f` ≥ `30afe91` ✓；R9–R12 修复实为更早的代码提交系列 |
| 2 | glob poc 全部 `*.{ts,md}` | 文件地图；确认 src/kernel 仅 kernel.ts/read-context.ts/projection.ts |
| 3 | grep `(?i)insert\s+into\s+domain_state`（全 poc） | src 仅 3 处且全盖戳；余为攻击脚手架 |
| 4 | grep `contract_version` @src | 29 处，盖戳点/判定点与自述一致 |
| 5 | grep `domain_state`（全 poc，49 处） | 第四处写路径排查依据；projection/world 零引用 |
| 6 | 通读 kernel.ts(807)/read-context.ts(130)/sqlite-port.ts(396)/arch-independence.test.ts(228)/empty-vs-absent.test.ts(98)/READINESS.md(110) | 各面判据、迁移器、配方原文 |
| 7 | `git diff 30afe91~12 30afe91 -- src/ KERNEL_SURFACE.sha256` | **空**——作者区间不可复现（全 docs 提交） |
| 8 | `git show cd82793~1:…/kernel.ts \| grep 'insert into domain_state' -A3` | 修复前 revise 无 contract_version（根因实锤） |
| 9 | `git log -1 cd82793` + `git diff cd82793~1 cd82793`（sha256+kernel+contracts） | hash e554dc7→c97685f；删行=无判据旧路径；新增公开面仅 hiddenByContractSkew |
| 10 | `git diff 3b2625f HEAD -- src/kernel src/contracts` 删改行/新增拒绝码扫描 | 被删判据行 3 条（收紧/搬家/加计数）；新增拒绝码 6 种；无放行 |

**未跑任何 vitest 文件**（见未做清单）。

## P0/P1 清单

**空。** 本次复验未发现新 P0/P1。机制侧唯一 P1 仍是作者已登记的 D-7（`Kernel.port` + `SqlitePort.raw`
同根），经复核**定级准确**。实际攻击过并排除的候选：第四处 domain_state 写路径（无）、投影出口（无
payload 面）、journal 回读（kernel 不写 payload）、records payload（无读面）、`resolvePresented`（仅
存在性）、:735 `if (cap)` 短路（不可达为假）、全窗口被删判据行（3/3 收紧或搬家）、sha256 重生成方向
（逐行 diff 核为收紧）。

新登记（均非 P0/P1）：**P2a** transferRoute/reassignRouteInternal 不重查 ns 唯一性（R3-C 防护在运行期
移交失效）；**P2b** eventsOf 归因依赖移交登记完备性、移交登记可被 port.raw 旁路（应补进 D-11 的显式
裁定）；**P3a** 附录 A `kernel['#port']`"语法错误"表述不实；**P3b** readAsOf 的 head 在 read 外，靠
seq 单调巧合安全。另记：arch-independence.test.ts:223 为恒真断言（门禁假绿形态，但作者未依赖它下结论）。

## 未做清单

- **未运行任何测试文件**（含 `tests/arch-independence.test.ts`、`attacks/evolution/contract-version-skew.test.ts`）
  ——全部结论基于源码全文通读 + git 取证；"139/15 绿"未经本次复验确认，但这不影响"真封死"判定（静态
  证据独立于绿灯）。
- 未新建攻击测试做运行时复现（D-13 复现、`tx['k']` 逃逸、`kernel['#port']` 语义均为静态论证）。
- D-12（差分枚举被剔除行位置）不在本项清单，未碰。
- 未核 R9–R12 之外更早提交（判定窗口 3b2625f..HEAD 由"sha256 重生成史 + src 变更史"圈定，非由轮次编号
  核对——REVIEW.md 轮次↔提交映射未逐一验）。
- 预算内 send_message 一条因 id 笔误重发一次（实耗超预算 1 次）。
