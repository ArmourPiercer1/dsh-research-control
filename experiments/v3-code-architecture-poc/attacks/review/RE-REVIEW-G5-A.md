# RE-REVIEW-G5-A —— 包 5（D-27/D-28/D-29/D-30 + GT-4 身份锚）独立复审（席位 G5-A @03d74a0）

- 席位：G5-A（攻击位：攻①写形覆盖 / 攻②触发器作用域 / 攻③身份锚 laundering / 攻④组合世界 / 攻⑤前席项状态位）
- 基线：`03d74a0` 隔离 worktree（`.scratch/wt-g5a`，测毕销毁）。开工前三命令全绿（tsc 0 错；作者流 29 文件/185 例全绿、身份锚四项逐等、skip=0；审查流与基线逐等 32 已知红）。收工时同三命令复验（[3/3] 报「审查方新增通过 17 条」= 本席攻击文件入收集的正常面，与前席一致）。
- 攻击落点：`attacks/review/g5a-route-forms.test.ts`（9 例）+ `attacks/review/g5a-combo-world.test.ts`（8 例），全绿=攻击假设成立或兜底复钉；GT-2/GT-3/N5/GT-4 变异实验走 `--baseline/--anchor` **临时路径**与 temp 变异+恢复+哈希校验，未永久改动任何受保护文件（校验记录见附录 C）。
- 与父席（裁决人）四条裁定改账均已吸收：新洞1 写成**共同误判纠正**；C3（读侧两答案）与 D-21 各提级 P1；transferRoute 修法取 (a) 且入口 fail-loud；C2 给可判定修法。

---

## ① 判定表

| 项 | 包 5 主张 | 实测判定 | 级别 | 一句话实证 |
|---|---|---|---|---|
| **D-27 路由审计闸** | 已闭 | **部分修（P1）**：触发器覆盖本体为真（十写形全灭），但「审计随附」守的是**可伪造形状**——且伪造审计一半**插件可达** | **P1** | F1 十形矩阵全拒 + F4 `appendLedger` mint 机制审计名零预留 + F4b 全链翻停用新进程复签发；伪证与真账**机制上不可区分**，且借 `ledger_no_delete` 获得**不可篡改性**——比包 5 前更糟一层：假证据获得了防篡改 |
| **D-28 目录身份冻结** | 已闭 | **已修**（UPDATE/DELETE/出生审计三闸真实，全连接生效）；但作者「owner 一经登记不可变更」裁定**引入新 P1 缺陷**（transferRoute 携 ns ⇒ 永久锁死） | 本体已修 + **新增 P1** | F2/F2b 写形全拒+空账本窗口钉形；C1a 移交携 ns ⇒ 单对象读全抛 + **readAsOf 无任何可过页**（毒对象自 seq=1 在每一页）重启持续；C1b 迁移器连接 UPDATE 同样被拦——机制不提供通道 |
| **D-29 meta 计数器** | 已闭 | **已修**（单调性判据真，归零各形全拒）；两条如实残余：id_counter REPLACE（登记过）；归零后首提交以裸驱动错误越界暴露 + 打开判据缺 `max(ledger.seq) ≤ 水位` | 已修（P4 残余） | F3：`replace/update or ignore/or replace/do update` 归零 `ledger_seq` 全撞 `META_COUNTER_MONOTONICITY`；F5b：裸面归零+复活+改写后**重开全绿**、首机制提交报 `UNIQUE constraint failed: ledger.seq`（抽象边界泄漏，单独入台账一行） |
| **D-30 守卫写形** | 已闭 | **已闭**：四式穿透封死复钉；本席十写形矩阵未找到新穿透形；多语句双保险（守卫正则+驱动单语句） | 已修 | F1(9) RAW_SQL_REFUSED + d30 锚不回归（F5b REPLACE 撞触发器=守卫摘掉也灭） |
| **GT-4 身份锚** | 升级为身份锚 | **部分修（P2）——真实升级**：七条变异路**无一能静默绿**（改名等数替换/保名改体/skip/移目录 全红；re-anchor 在红/skip 态拒写）；但「改断言体+重锚」洗白链成立 ⇒ 锚的上限=**人对重锚的识别**；且 `attacks/**` 在**一切摘要覆盖面之外** | P2 | 附录 B 实验 E1–E4：`passed_sha256` 抓改名、`files_sha256` 抓保名改体（单闸）、skip 计数红、tests2/ 移目录名集红（vitest 子串过滤仍收集它，逃逸也不绿）；E2b 掏断言→`--reanchor`→四项逐等 OK |
| **N9 追加表防改写** | （G4-A：部分修） | **部分修维持**：H 五表触发器真；本席新否证「**经 SqlitePort 的连接（含 port.raw）全部受护**」契约句——同连接一条 `pragma recursive_triggers=off` 即拆 DELETE 触发器，重开检不出 | P2 | F5a：机制自己的 port.raw 上 `insert or replace into ledger` 静默整行改写成功 |
| **D-24 write() 归属** | 两面无歧义已修，完整修法待 G1 | **未修（待 G1 属登记）；读侧落点提级 P1**：`write()`（ns=自己、oid=他人）机制面成功 ⇒ `readAsOf` 无 ns 过滤 ⇒ **以他人对象之名端出攻击者 payload**，`readLatest/readSnapshot` 按 dir.ns 过滤不见——同一对象同一时刻两个答案，插件可达，写侧全走机制通道 | **P1**（由质量问题提级；双时间读是本 PoC 声称的语义支点） | C3 实测双答案 |
| **D-21 报告身份** | — | **未修，提级 P1**：`RPT-${seq}` 可被任何 space-write 主体**滚动预占**（`declareRecord('RPT-<head+2>')`）⇒ 合法验证提交 `RECORD_ALREADY_DECLARED`，报告落账面**持续**拒用 | **P1** | C5a 两轮滚动预占全拒 |
| **E-01/D-12 eventsOf** | 登记 P2 | **未修**：拒绝 detail 原样携带 `oid`+`owner`；与可预测 oid 叠加=存在性预言机在位 | P2 维持 | C5b detail 回显实测 |
| **N3 参数性质门** | 包 5 未触及 | **现状维持**（G4-A 判部分修 P2 不回归；本席未重跑该攻击类，静态核对门 2 双盲形态未动） | P2 维持 | 静态核对 |
| **N4 reassignRouteInternal 暴露** | — | **未修未恶化**：仍在 UnitOfWork 原型上运行时可及；capability-admin 权威闸兜底实测在位 | P3 维持 | C5c |
| **GT-2 基线只比名** | — | **未修**：注册红条断言掏空为 `expect(1).toBe(2)`（同名同红）⇒ 门禁「与基线完全一致」PASS。且比前席登记更强一点：**`attacks/**` 连文件内容摘要都没有**（`files_sha256` 只走 `tests/`）——红条内容可任意改写而门禁零反应 | P2 维持（面更宽） | 附录 B 重放（PASS，exit=0） |
| **GT-3 基线自洽重算** | — | **未修（结构性）**：从当前态重算 `failures/passes/total` 写临时 baseline ⇒ 门禁 **PASS**——重算者可以把自己加的恒红探针写成「已知红」洗绿 | P2 维持 | 附录 B（33 条已知红含攻击者探针，PASS） |
| **N5 清理崩溃吸收** | — | **未修**：文件已有登记红时，`afterAll` 抛错不进 loadErrors、门禁不报（`loadErrors` 判据是「0 红且有 message」） | P2 维持 | 附录 B（同轮实测） |

**总判**：包 5 的触发器与写序本体**不是**「为凑绿放宽」——判据比机制自身还严（raw 也被拦）；D-29/D-30 可闭。**闭不掉的不是触发器，是触发器守的语义**：D-27 守的审计行机制面可伪造（新洞1），D-28 的冻结裁定自身制造不可恢复态（新洞·锁死），存储不变量对自家 raw/外部写入者不设防且不可检（新洞2）。三处都到 G1 裁决位。

---

## ② 攻击矩阵

| # | 攻击 | 面 | 结果 | 判定 |
|---|---|---|---|---|
| F1 | capability_route 十写形（REPLACE/IGNORE/DO NOTHING/DO UPDATE/UPDATE/OR REPLACE/DELETE/INSERT…SELECT/RETURNING/多语句），每形先播种真冲突 | raw + 机制句柄 | 十形全拒 | D-27 覆盖本体真 |
| F2 | object_directory 五写形 + 空账本 mint | raw | 全拒；新库空账本窗口放行 | D-28 本体真 + 登记界钉形 |
| F2b | 空账本 + `id_counter` 先推 ⇒ mint 后缀≤counter 身份行 | raw | **重开检不出，永久入库** | 登记界的持久形状首钉 |
| F3 | meta 归零四形 + REPLACE id_counter | raw | 归零全拒；id_counter REPLACE 过（登记过） | D-29 真 |
| F4 | **插件面 mint 机制审计事件名**（`capability-enabled/-disabled/-transferred/object-registered/check-report-recorded`） | **插件可达** | **全放行**，与真账逐列同形，删不掉；对照正式名有预留 | **新洞1 P1** |
| F4b | mint 审计→UPDATE 过闸→停用翻回→重启复签发 | raw+机制 | 全链成 **NO_REFUSAL**，伪审计 actor 自定 | D-27=P1 的实证支点 |
| F5a | port.raw 同连接 `pragma recursive_triggers=off` → REPLACE 隐删 | **机制自己的连接** | DELETE 触发器失效、行被改写、**重开检不出** | **新洞2 P2**；契约句被否证 |
| F5b | 手工 DatabaseSync 四表同刻（ledger 改写/路由复活/meta 归零） | 裸文件（登记界） | 全成；**归零复活库重开全绿**；首提交裸驱动错误越 Port 界 | 登记界 + 边界泄漏入台账 |
| F5c | 触发器**同名掏体**（drop+空壳重建） | 裸文件 | **重开全绿、保护全灭**；`writable_schema` 直改体被 node:sqlite 拦（未验证形态，等价后果可达） | **新洞3 P3**：REQUIRED_TRIGGERS 只比名字 |
| C1a | transferRoute 携新 ns ⇒ 三读面 + 双时间扫描 | capability-admin（合法权威） | 单对象读全抛；**readAsOf 无任何可过历史页**；重启持续 | **新缺陷 P1（可用性）** |
| C1b | 补救面：装配 raw / 迁移器连接 UPDATE dir.ns | 全连接 | `DIRECTORY_IDENTITY_FROZEN`——机制与机制的通道皆无；唯一通路=裸 REPLACE（恰是封禁写形） | 锁死定性 |
| C1c | 同 ns 移交正向对照 | 同上 | 无恙 | 缺陷面=「移交携 ns」精确钉死 |
| C2 | linkRef required:false 幽灵 to × auditRequiredIntegrity | 插件可达 | 提交过；巡检 `checked=0` | 「0 违规」与幽灵并存 |
| C3 | write() 他人 oid ⇒ readAsOf 端出攻击者行 | **插件可达** | 三读面两答案 | **P1（D-24 读侧落点）** |
| C5a | `RPT-${head+2}` 滚动预占 | 插件可达 | 报告落账持续拒用 | **D-21 P1** |
| C5b | eventsOf 拒绝 detail 泄露 | 插件可达 | oid+owner 回显 | E-01 未修 |
| C5c | 原型枚举取 `reassignRouteInternal` | 插件可达 | 取得到，权威闸拒 | N4 未修未恶化 |
| E1–E4 | GT-4 变异（改名等数替换/保名掏体+重锚/test.skip/移 tests2/） | 门禁 | 无一径静默绿；重锚=唯一洗白链（需人点头） | GT-4 真升级、上限=人 |
| GT-2/3/N5 | 临时 baseline 重放（红条掏空/自洽重算/afterAll 崩溃） | 门禁 | 三轮全 PASS | 三项未修维持 |

---

## ③ 新发现（定级 + 复现 + 前后状态）

### 新洞1【P1 · 完整性/审计可信】机制审计事件名零预留——对前席与作者的**共同误判纠正**
**这不是新登记界外洞，而是此前所有席位（含 G3-A/G4-A 与我）与作者测试把 D-27 可达面记成「装配裸面/运维」的误判**：作者 `d27-route-audit-gate.test.ts` L223-234 把「先写一条形态齐全的审计行再过闸」钉为 NO_REFUSAL 并如实登记——但它把 mint 审计的前提记在裸面上。实测：**mint 审计这一半根本不需要裸面**——`appendLedger`（插件可达、任何 space-write 主体）对 `capability-enabled/-disabled/-transferred/object-registered/check-report-recorded` 五个机制审计名**零预留**，落账行与 `setRouteEnabled` 真账**逐列同形**（event_type 同、payload 形同、actor=调用者自报、`authority_basis` 同为 NULL）。对照实验：正式事件名（`synth:fact-designation`）经同一入口被 `EVENT_AUTHORITY_REQUIRED` 拒 ⇒ **预留机制已存在，只是没盖到机制自己的审计名**——修法是补全已存在的机制，不引入新中心耦合。

D-27 的实质状态因此是：「静默改写」→「可伪造改写」+「伪证借 `ledger_no_delete` 成为**不可抹除的假证据**」——比包 5 之前多一层：**假证据获得了防篡改**。伪证与真账机制上不可区分。

复现：`g5a-route-forms.test.ts` F4（插件面 mint+删不掉+预留对照）、F4b（裸面单连接补 UPDATE 一腿⇒新进程恢复签发）。
修法逐条验证（父席三判据）：
1. 机制审计命名空间走正式事件同一预留登记——**成立且是最小改动**（对照实验证明预留通道现成）；
2. 触发器判据必须核 `authority_basis` + `actor` 由机制落账（与正式事件见证同源）——**必要**：只查形状=把谎话写进不可删的表；
3. **只做 1 不做 2 不够**：攻击者用自己的真实 actor 经 appendLedger mint 仍过闸（`actor` 列谁都能写、且真账行的 actor 本来就是主体自报值）——闸要成立必须能区分「机制落账」与「主体代笔」，现机制里这个区分不存在。

### 新洞2【P2 · 界外被自家 raw 面打穿】`recursive_triggers` 连接态可关，写入不可检
可判定结论（进台账原话）：**机制不保证它打开的连接全生命周期带该 PRAGMA**（构造时开一次，`port.raw` 未守卫、随时可关）；经非机制连接/关闸连接写入的数据**重开不可检出**（无行级摘要、无连接态指纹、REQUIRED_TRIGGERS 只比名字）。⇒ 「存储不变量对并发/外部写入者不设防」为真；且**界外不是「第三方/运维」，是我们的自家 `raw` 面**——「经 SqlitePort 建立的连接（含 port.raw）全部受护」这句 CONTRACTS §16.2 的话与实现不符，须改。
复现：F5a（同连接关 PRAGMA ⇒ REPLACE 静默改写 ledger、重开全绿、伪行以真身被读出）、F5c（同名掏体重开全绿）。
修法（父席三条全采，另加一条）：打开期判据补 `max(ledger.seq) ≤ 水位`（归零必红）；pragma 状态入 `meta` 且**每次机制写前**比对；`port.raw` 要么守卫（拒 pragma/DDL），要么契约明写「拿到 raw=撤销全部存储不变量」——二选一，不许两头话；触发器 SQL **体摘要**入打开判据（治同名掏体）。
**抽象边界泄漏单独入行**：归零后的第一次机制提交以裸驱动错误 `UNIQUE constraint failed: ledger.seq` 越过 Storage Port 边界（sqlite-port.ts 头注承诺「驱动词汇不得越过本边界」违例）。

### 新缺陷【P1 · 可用性】transferRoute 携 ns ⇒ 既有对象永久锁死（作者「owner 不可变更」裁定引入）
合法权威操作（capability-admin，全程机制通道）即可触发：移交路由携带不同 `storageNamespace` ⇒ 既有对象 `dir.ns` 与生效路由 ns 不符 ⇒ 单对象三读面全抛 `SCHEMA_INCOMPATIBLE`；`readAsOf` 扫描面 `serveable()` 只兜 `CAPABILITY_INACTIVE`，`SCHEMA_INCOMPATIBLE` 上抛 ⇒ **整页死，且不存在能过的历史截点页**（毒对象自 seq=1 出生即在每一页）⇒ 全 Space 双时间读面永久不可用、重启持续。补救面：目录行 UPDATE 在**一切连接**（含 migrateLegacyRecords 同款自开 DatabaseSync）被 `directory_no_update` 拦 ⇒ **机制不提供通道**；唯一通路是裸连接 REPLACE（隐删因默认无 pragma 不触发 + 出生真账在位放行）——**修一个锁死要用包 5 自己封禁的写形**，「摘触发器-改-重建」按纪律不算修法。
修法取 (a)：**在 `transferRoute` 入口 fail-loud 拒绝携带 ns 变更**（读侧兜底=把可用性故障留给最晚时刻，不许只靠读侧）。**签名判定：`ns` 参数根本不该存在**——`#44 §11` 对移交的原注是「只改 Capability→Plugin 实现映射，不改 ObjectID/Revision」，`to.storageNamespace` 参数与该语义自相矛盾；所有合法调用方（含 split 正例）都传同一 ns ⇒ 删参数、ns 沿当前路由，比校验更干净；ns 迁移若真有需求，另立机制迁移通道（独立审计事件），不搭移交的车。
复现：C1a/C1b/C1c（正向对照：同 ns 移交无恙）。

### C3【P1 · 完整性+语义可信，D-24 的读侧落点】（提级，父席裁定）
`write()`（ns=自己、oid=他人）机制面成功 ⇒ `readAsOf` 无 ns 过滤 ⇒ 攻击者行**以他人对象之名**被端出（附 payload），`readLatest/readSnapshot`（按 dir.ns 过滤）不见。同一对象同一时刻两个答案、插件可达、写侧完全走机制通道。REPLACE 封禁后依旧——包 1 只修了写侧无歧义子集，本条是**读侧落点**。修法：readAsOf 扫描面与 readLatest 用**同一条归属判据**（dir.ns），且 `serveable()` 对归属不符/`SCHEMA_INCOMPATIBLE` 兜住计入遮蔽数，不上抛炸整页。复现：C3。

### D-21【P1 · 可用性，提级】`RPT-${seq}` 滚动预占 = 报告落账持续 DoS
`recordReport` 报告号=`RPT-${nextSeq}` 可预测；`declareRecord` 接受任意 recordId ⇒ space-write 主体每轮预占 `RPT-${head+2}` 即让所有后续合法验证提交 `RECORD_ALREADY_DECLARED`。**最小机制侧止血判定：可行**——保留前缀（`RPT-`）的 id 由机制计数器分配、`declareRecord`/`declaresRecord` 对外显式指定保留前缀即拒（一个前缀名单+一行判断），G1 只需裁「保留前缀集合」的语义、不必重新发明分配器。复现：C5a。

### C2【P3 · 巡检语义】软幽灵边与「巡检 0 违规」并存（可判定修法）
`auditRequiredIntegrity` 只扫 `required=1` ⇒ `required:false` 幽灵边永不进巡检计数（checked=0 与幽灵在位并存，`ref_edge` 无触发器=边本身永久在）。修法一句话：**巡检判据覆盖 `required:false` 边引用目标的存在性，产出 `softGhosts` 计数只报告、不阻塞提交**——「0 违规」回执才与「无幽灵」脱钩、有确定含义。复现：C2。

### GT-4 与门禁三兄弟（P2 组）
- **GT-4=真升级但有天花板**：七条变异路无一静默绿（明细附录 B）——尤其「保名换体」这一 GT-2 老招被 `files_sha256` 单独抓住。洗白唯一链=「改断言体+`--reanchor`」：实测掏空 D30-1 四条真断言→重锚→「与身份锚四项逐等 OK」。**锚的上限=人识别重锚**。最低机械防线（具体形态，比人认进一步）：
  1. `--reanchor` 必须输出**通过项名集与前次锚的增删 diff 清单**（0 增删而 `files_sha256` 变 ⇒ 高亮「纯内容改写重锚」）；
  2. 锚文件新增 `reanchored_by`（git 提交者外显）+ `delta_sha`（新旧 passed_sha/files_sha 双联）——重锚不可无痕；
  3. CI probe（既有 Frozen-Face-Review 同款）：diff 同时触及 `tests/**` 与 `AUTHOR_ANCHOR.json` 的提交，必须带 `Anchor-Review: <日期> <非作者批准人>` 标记，否则红——把「二人规则」机验化。本席 E2b 用 `--anchor` 临时路径做的重锚不动真锚，但 1+2+3 落地后这类洗白在真流程里会被机器拦在「需要第二人」。
- **GT-2 未修且面更宽**：红条名对内容错⇒「完全一致」；且 `attacks/**` 不在任何摘要内（红条文件内容可任意改）。
- **GT-3 未修（结构性）**：自洽重算 baseline ⇒ PASS。根因同 GT-2：基线的「已知红」语义由重算者单方面定义。
- **N5 未修**：带红文件的 `afterAll` 崩溃被吸收（loadErrors 判据 `reds===0` 盲区原样在）。

---

## ④ 逐 hunk 判定（包 5 变更面）

| hunk | 判定 |
|---|---|
| 七条触发器 DDL + SCHEMA_VERSION 6 + REQUIRED_TRIGGERS | **不是放宽凑绿**——判据严于机制自身。但打开校验只比触发器**名字**（F5c）；「含 schema_version 的全部归零形被拒」的注释口径对 REPLACE-id_counter 面如实（登记过），对 `schema_version` REPLACE 形未在文档出现（后果打开期治理兜住，P4 文档面） |
| 「先审计后变更」写序（setRouteEnabled/reassignRouteInternal/createObject） | 实质修复，单事务原子性真；十写形矩阵 + D27 锚均未破。但审计**语义**未闭（新洞1） |
| 「owner 一经登记不可变更」裁定 + transferRoute 只动路由行 | 方向可辩护，但**未配套禁止 ns 漂移的入口拦截** ⇒ 制造无通道不可恢复态（新缺陷 P1）。「移交审计随附」在 reassignRouteInternal 里真写、真过闸 |
| CONTRACTS §16.2「经 SqlitePort 建立的连接（含 port.raw）全部受护」 | **与实现不符**（F5a 反例），须改写（新洞2 修法三选一） |
| d27-d30 作者测试 | **无「把期望写成事实」**：D27-4 甚至主动钉了「过闸=可伪造」的诚实界。缺陷是**登记面记错可达性**（mint 审计记在裸面，实际插件面可达）——期望诚实、边界错记 |
| GT-4 锚升级 | 真升级（见③）；「重锚拒写于红/skip 态」实测在位（E3b：`拒绝写锚`） |
| 越权主张检查 | 未发现声称修了范围外问题；N3/D-24 读侧/E-01 均未声称动过，实测也确实未动（无回归） |

## ⑤ 未能验证（如实清单）
1. `writable_schema` 直改触发器体：node:sqlite 拦 `table sqlite_master may not be modified`——该形态**未验证**；同名掏体（drop+重建）等价后果已验证。
2. GT-4「同名重复用例等数替换」未做实验（passNames 为 Set、全名含文件路径 ⇒ 静态推断仅 `files_sha256` 可抓；该闸本身已被 E2 验证在位）。
3. attacks/** 流的 skip/移目录口径未单独重放（author 流已验；attacks 流有同构 skip 计数条款 L213，推断同形）。
4. 多进程 WAL 竞态下 pragma 窗口（两进程连接交错）未测——单进程语义已钉死。
5. N3 攻击类未重跑（包 5 diff 未触及守卫两门，静态核对维持 G4-A 判）。
6. `--reanchor` 后 `generated_from_commit` 前溯性未变异测试（锚祖先校验代码在位，未主动攻）。

---

**收工确认**：本报告为主树唯一改动。隔离 worktree `.scratch/wt-g5a` 已在报告落盘后 `git worktree remove --force` 销毁；销毁前四个受保护文件（d30/g0-gate.mjs/AUTHOR_ANCHOR.json/BASELINE.json）`git hash-object` 对 `git rev-parse HEAD:` 全等（附录 C），主树除本报告外无我产生的任何变更。

---

## 附录 A —— 攻击测试全文（worktree 销毁后逐字可复现：两文件原样放入 `attacks/review/` 即跑）

### A-1 `g5a-route-forms.test.ts`

```ts
/**
 * G5-A 攻①+②（席位 G5-A @03d74a0）：包 5 触发器的写形覆盖 × 连接作用域 × 「审计随附」的真实可forgery性。
 *
 * 与作者测试的差集（作者 d27–d30 钉的是 canonical 形态；本文件打的是）：
 *  A) 写形矩阵逐式（每种**先播种真冲突行**）：REPLACE / INSERT OR IGNORE / ON CONFLICT DO NOTHING /
 *     DO UPDATE / UPDATE / DELETE / UPDATE OR REPLACE / INSERT…SELECT / 多语句 / RETURNING，
 *     逐表覆盖 capability_route、object_directory、meta。
 *  B) **机制面伪造审计**：`appendLedger` 对三个机制审计事件名（capability-enabled/disabled/transferred）
 *     **零预留**——它们不是 ownsEventTypes 登记的正式事件类型，⇒ 任何 space-write 主体经
 *     插件可达面就能在 H 里 mint 出与 `setRouteEnabled` 落账行**同形**的审计行。
 *     ⇒ 「审计随附」判据守的是一个**机制面可伪造的形状**。
 *  C) 连接作用域：`PRAGMA recursive_triggers` 是**连接态**，`port.raw`（同连接、未守卫）可把它
 *     关掉 ⇒ 同连接 REPLACE 的隐删不再触发 DELETE 触发器 ⇒ CONTRACTS §16.2「经 SqlitePort 建立的
 *     连接（含 port.raw）全部受护」在**同一连接的生命周期内**为假；关掉后写入的行任何重开校验都检不出。
 *  D) 手工 DatabaseSync / writable_schema：触发器**同名掏体**（改 sqlite_master.sql 不改名）⇒
 *     REQUIRED_TRIGGERS 只比对**名字**，掏体触发器重开照绿 ⇒「摘掉任一必红」只钉"摘名"，钉不住"掏体"。
 *
 * 判定词汇：测试**绿 = 攻击假设成立**（作者登记的界外被复钉）或**兜底成立**（触发器/守卫拒住了）。
 */
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { POC_DATA_DIR } from '../../src/harness/paths.ts';
import { openWorld, PRINCIPAL, type World } from '../../src/harness/world.ts';
import { TEST_OBJECT_MODEL } from '../../src/domains/test-object-model.ts';
import { TEST_RECORDS, CAP_RECORDS } from '../../src/domains/test-records.ts';
import { SqlitePort } from '../../src/storage-sqlite/sqlite-port.ts';
import { asOid, type ObjectOid } from '../../src/contracts/index.ts';

const ADM = PRINCIPAL('g5aadm');
const NOBODY = PRINCIPAL('g5anobody'); // 只有 space-write
const GRANTS = {
  g5aadm: ['space-write', 'capability-admin', 'domain-admission'],
  g5anobody: ['space-write'],
};
let dir: string;
beforeAll(() => { dir = mkdtempSync(join(POC_DATA_DIR, 'g5a-forms-')); });
afterAll(() => { rmSync(dir, { recursive: true, force: true }); });

const openFile = (file: string): World =>
  openWorld({ file, space: 'SP-G5A', grants: GRANTS, plugins: [TEST_OBJECT_MODEL, TEST_RECORDS] });
const open = (name: string): World => openFile(join(dir, `${name}.db`));

const outcome = (fn: () => unknown): string => {
  try { fn(); return 'NO_REFUSAL'; }
  catch (e) {
    const err = e as { code?: unknown; message?: unknown };
    return typeof err?.code === 'string' && err.code !== 'ERR_SQLITE_ERROR' ? err.code : String(err?.message ?? e);
  }
};
const routeRow = (w: World, cap = CAP_RECORDS) =>
  w.raw.get<{ enabled: number; changed_seq: number | null; plugin_id: string; ns: string }>(
    `select enabled, changed_seq, plugin_id, ns from capability_route where capability=?`, cap)!;
const dirRow = (w: World, oid: string) =>
  w.raw.get<{ owner_capability: string; created_seq: number; ns: string }>(
    `select owner_capability, created_seq, ns from object_directory where oid=?`, oid)!;

describe('G5A-F1 capability_route 写形矩阵（每种先播种真冲突：unload 停用后 enabled=0 行在位）', () => {
  test('G5A-F1 十写形逐式：REPLACE/UPDATE/UPDATE OR REPLACE/DELETE/INSERT…SELECT/RETURNING 全拒；OR IGNORE/DO NOTHING 的触发器语义钉形；多语句被驱动层拦', () => {
    const w = open('f1-route');
    try {
      w.unloadCapability(CAP_RECORDS, ADM); // 播种真冲突：enabled=0 行存在
      const stamp = routeRow(w).changed_seq!;

      // (1) REPLACE 登记形 ⇒ 隐删撞 ROUTE_FROZEN（recursive_triggers=ON 在位）
      expect(outcome(() => w.raw.run(
        `replace into capability_route(capability, plugin_id, ns, contract_version) values(?,'test.test-records','dom_test_records','v1')`,
        CAP_RECORDS,
      ))).toContain('ROUTE_FROZEN');
      // (2) INSERT OR IGNORE 冲突形：BEFORE INSERT 先于冲突消解 ⇒ 停用形照样撞形态闸（IGNORE 不豁免触发器）
      expect(outcome(() => w.raw.run(
        `insert or ignore into capability_route(capability, plugin_id, ns, contract_version, enabled, changed_seq)
         values(?,'p','ns_x','v1',0,9)`, CAP_RECORDS,
      ))).toContain('ROUTE_SHAPE_FROZEN');
      // (3) ON CONFLICT DO NOTHING：同 (2) 形——BEFORE 触发器先 abort，DO NOTHING 不是豁免
      expect(outcome(() => w.raw.run(
        `insert into capability_route(capability, plugin_id, ns, contract_version, enabled, changed_seq)
         values(?,'p','ns_x','v1',0,9) on conflict(capability) do nothing`, CAP_RECORDS,
      ))).toContain('ROUTE_SHAPE_FROZEN');
      // (4) ON CONFLICT DO UPDATE（upsert 改写形）：BEFORE UPDATE 逐语句判 ⇒ 无审计必拒
      expect(outcome(() => w.raw.run(
        `insert into capability_route(capability, plugin_id, ns, contract_version) values(?,'p','ns_x','v1')
         on conflict(capability) do update set enabled=1, changed_seq=?`, CAP_RECORDS, stamp + 5,
      ))).toContain('ROUTE_AUDIT_REQUIRED');
      // (5) UPDATE OR REPLACE 翻停用不动戳 ⇒ 单调性闸（OR REPLACE 不豁免触发器）
      expect(outcome(() => w.raw.run(
        `update or replace capability_route set enabled=1 where capability=?`, CAP_RECORDS,
      ))).toContain('ROUTE_CHANGED_SEQ_MONOTONICITY');
      // (6) DELETE ⇒ ROUTE_FROZEN
      expect(outcome(() => w.raw.run(`delete from capability_route where capability=?`, CAP_RECORDS)))
        .toContain('ROUTE_FROZEN');
      // (7) INSERT…SELECT 停用形 ⇒ 形态闸（SELECT 源真冲突行在位）
      expect(outcome(() => w.raw.run(
        `insert into capability_route(capability, plugin_id, ns, contract_version, enabled, changed_seq)
         select 'cap.g5a.sel', plugin_id, ns, contract_version, 0, 7 from capability_route where capability=?`,
        CAP_RECORDS,
      ))).toContain('ROUTE_SHAPE_FROZEN');
      // (8) UPDATE … RETURNING：RETURNING 不豁免触发器（经 Adapter.get → prepare().get()）
      expect(outcome(() => w.raw.get(
        `update capability_route set enabled=1 where capability=? returning enabled`, CAP_RECORDS,
      ))).toContain('ROUTE_CHANGED_SEQ_MONOTONICITY');
      // (9) 多语句：机制守卫拒（/;\s*\S/），且 node:sqlite prepare 单语句约束双保险
      expect(outcome(() => w.port.tx((raw) => raw.run(
        `update capability_route set enabled=1 where capability='x'; update meta set value=0 where key='ledger_seq'`,
      )))).toContain('RAW_SQL_REFUSED');
      // (10) 经 port.tx 机制句柄的裸 UPDATE：守卫放行 DML，但触发器兜底（纵深定位）
      expect(outcome(() => w.port.tx((raw) =>
        raw.run(`update capability_route set enabled=1, changed_seq=99998 where capability=?`, CAP_RECORDS),
      ))).toContain('ROUTE_AUDIT_REQUIRED');
      expect(routeRow(w).enabled).toBe(0); // 十形全灭：停用决策在经 SqlitePort 的连接上一形不破
    } finally { w.close(); }
  });

  test('G5A-F2 object_directory 写形矩阵：REPLACE/DELETE/UPDATE/DO UPDATE/INSERT…SELECT 全撞身份闸；出生审计的"空账本窗口"复钉（登记的界内形状）', () => {
    const w = open('f2-dir');
    try {
      const oid = w.uow(ADM, (tx) => tx.createObject({ kind: 'test.claim', payload: { v: 1 } })) as ObjectOid;
      // (1) REPLACE 同 oid（登记形——created_seq 与真出生账一致都过不了：隐删先撞 no_delete）
      const d = dirRow(w, oid);
      expect(outcome(() => w.raw.run(
        `replace into object_directory(oid, space, kind, owner_capability, ns, created_seq) values(?,'SP-G5A','test.claim',?,?,?)`,
        oid, d.owner_capability, d.ns, d.created_seq,
      ))).toContain('DIRECTORY_IDENTITY_FROZEN');
      // (2) DELETE 真冲突行
      expect(outcome(() => w.raw.run(`delete from object_directory where oid=?`, oid)))
        .toContain('DIRECTORY_IDENTITY_FROZEN');
      // (3) UPDATE owner（换 owner 一形）
      expect(outcome(() => w.raw.run(
        `update object_directory set owner_capability='cap.evil' where oid=?`, oid,
      ))).toContain('DIRECTORY_IDENTITY_FROZEN');
      // (4) upsert DO UPDATE 改写既有身份行
      expect(outcome(() => w.raw.run(
        `insert into object_directory(oid, space, kind, owner_capability, ns, created_seq) values(?,'SP-G5A','test.claim','cap.evil','ns_x',99)
         on conflict(oid) do update set owner_capability='cap.evil'`, oid,
      ))).toContain('DIRECTORY_IDENTITY_FROZEN');
      // (5) INSERT…SELECT 新 oid：账本非空 ⇒ 出生审计必须真账，SELECT 伪造 created_seq 撞闸
      expect(outcome(() => w.raw.run(
        `insert into object_directory(oid, space, kind, owner_capability, ns, created_seq)
         select 'OBJ-SP-G5A-777','SP-G5A', kind, owner_capability, ns, created_seq from object_directory where oid=?`, oid,
      ))).toContain('DIRECTORY_IDENTITY_FROZEN'); // created_seq=1 的行 object_id 不是新 oid ⇒ 判据不符

      // (6) **空账本窗口**（登记的界外形状复钉，不是新洞但钉形）：全新库 ledger 空 ⇒ 出生判据不参判，
      //     任何目录行 mintable；此后第一笔真实提交前这个窗口一直开着。
      const w2file = join(dir, 'f2-fresh.db');
      const port2 = new SqlitePort({ file: w2file });
      expect(outcome(() => port2.raw.run(
        `insert into object_directory(oid, space, kind, owner_capability, ns, created_seq)
         values('OBJ-SP-G5A-1','SP-G5A','test.claim','cap.whatever','ns_w',1)`,
      ))).toBe('NO_REFUSAL'); // 账本空 ⇒ 出生审计放行（CONTRACTS 如实登记：迁移器/夹具形状）
      port2.close();
      // 且这个 minted 行 created_seq=1 与 id_counter=0 的关系：后缀 1 > counter 0 ⇒ 重开撞 OID 一致性检查
      // ——登记过的打开期治理形态；若 minted 后缀 ≤ id_counter 则**永久隐身**（下面 G5A-F2b 钉）
      let reopened = 'NO_REFUSAL';
      try { new SqlitePort({ file: w2file }); } catch (e) {
        reopened = String((e as { code?: string }).code ?? e);
      }
      expect(reopened).toContain('SCHEMA_UPGRADE_REQUIRED'); // 此形被 OID 一致性检查抓住
    } finally { w.close(); }
  });

  test('G5A-F2b 空账本窗口 + 后缀 ≤ id_counter 的 minted 身份行：重开**检不出**（出生审计窗口的持久形态）', () => {
    const file = join(dir, 'f2b.db');
    const port = new SqlitePort({ file });
    // 全新库：id_counter 在 activate 前=0；先走一次机制提交推 id_counter 到 1（ledger 变非空前…）
    // ——不行，机制提交本身就让 ledger 非空。⇒ 攻击序：raw 推 id_counter，再 mint 后缀 ≤ id_counter 的行。
    port.raw.run(`update meta set value = 1 where key='id_counter'`);
    expect(outcome(() => port.raw.run(
      `insert into object_directory(oid, space, kind, owner_capability, ns, created_seq)
       values('OBJ-SP-G5A-1','SP-G5A','test.claim','cap.ghost','ns_g',1)`,
    ))).toBe('NO_REFUSAL'); // 账本仍空 ⇒ 放行
    port.close();
    let reopened = 'NO_REFUSAL';
    try { new SqlitePort({ file }); } catch (e) { reopened = String((e as { code?: string }).code ?? e); }
    // id_counter(1) ≥ maxSuffix(1) ⇒ OID 一致性检查过；ledger 空 ⇒ 出生审计不参判；版本/触发器全对
    expect(reopened).toBe('NO_REFUSAL');
    // ⇒ 一条**从未在任何 H 里存在过**的身份行永久入库。界外=裸面（raw），登记面（"空账本不参判据"）
    //   的完整形状第一次被钉成断言：不止"mintable"，而是"重开检不出 + 后续 H 永远没有它的出生账"。
    const w = openFile(file); // 机制照常开
    expect(outcome(() => w.kernel.readSnapshot('OBJ-SP-G5A-1' as ObjectOid))).toContain('CAPABILITY_INACTIVE');
    w.close();
  });

  test('G5A-F3 meta 写形：归零两式拒（钉作者主张）；REPLACE id_counter（登记界外）复钉；DELETE schema_version 重开治理复钉', () => {
    const w = open('f3-meta');
    try {
      w.uow(ADM, (tx) => tx.createObject({ kind: 'test.claim', payload: {} }));
      // 归零两式（ledger_seq）——作者主张复钉
      expect(outcome(() => w.raw.run(`replace into meta(key,value) values('ledger_seq',0)`)))
        .toContain('META_COUNTER_MONOTONICITY');
      expect(outcome(() => w.raw.run(
        `insert into meta(key,value) values('ledger_seq',0) on conflict(key) do update set value=0`,
      ))).toContain('META_COUNTER_MONOTONICITY');
      // UPDATE OR REPLACE / UPDATE OR IGNORE 归零形：触发器不豁免
      expect(outcome(() => w.raw.run(`update or ignore meta set value=0 where key='ledger_seq'`)))
        .toContain('META_COUNTER_MONOTONICITY');
      expect(outcome(() => w.raw.run(`update or replace meta set value=0 where key='id_counter'`)))
        .toContain('META_COUNTER_MONOTONICITY');
      // id_counter 的 REPLACE（隐删不撞 WHEN old.key='ledger_seq'）⇒ 登记过的界外，钉形
      expect(outcome(() => w.raw.run(`replace into meta(key,value) values('id_counter',0)`)))
        .toBe('NO_REFUSAL');
      expect(w.raw.get<{ value: number }>(`select value from meta where key='id_counter'`)!.value).toBe(0);
    } finally { w.close(); }
  });
});

describe('G5A-F4 审计随附的真实可伪造性（D-27 裁定的实证支点）', () => {
  test('G5A-F4 插件可达面 mint 机制审计事件名：appendLedger 对 capability-enabled/disabled/transferred 零预留 ⇒ 审计形状在机制面即可伪造，且落账后不可删', () => {
    const w = open('f4-forge');
    try {
      const head0 = w.ledgerHead();
      // space-write 主体（无任何管理/业务轴）经**插件可达**的 UnitOfWork.appendLedger 写机制审计事件名
      const seq = w.uow(NOBODY, (tx) => tx.appendLedger({
        eventType: 'capability-enabled', payload: { capability: CAP_RECORDS },
      }));
      expect(seq).toBeGreaterThan(head0);
      const row = w.raw.get<{ event_type: string; actor: string; payload_json: string; authority_basis: string | null }>(
        `select event_type, actor, payload_json, authority_basis from ledger where seq=?`, seq,
      )!;
      // 与 setRouteEnabled 的落账行**逐列同形**（event_type/payload 形状一致、authority_basis 同为 NULL）
      expect(row.event_type).toBe('capability-enabled');
      expect(JSON.parse(row.payload_json).capability).toBe(CAP_RECORDS);
      expect(row.authority_basis).toBeNull();
      // ⇒ 触发器 route_change_guarded 的审计判据查的就是这种行——它无法区分机制落账与伪造。
      //   机制面能 mint 审计（UPDATE 路由仍需 raw），裸面持有者可单连接完成全链；
      //   且 mint 出的伪审计被 ledger_no_delete **永久钉死**——伪证不可抹。
      expect(outcome(() => w.raw.run(`delete from ledger where seq=?`, seq))).toContain('HISTORY_IMMUTABLE');
      // 反向对照：正式事件类型有预留（synth:fact-designation 经 appendLedger 被拒）——
      // 说明"事件名预留"机制**存在**，只是三个机制审计名没有登记进去。
      expect(outcome(() => w.uow(NOBODY, (tx) => tx.appendLedger({
        eventType: 'synth:fact-designation', payload: {},
      })))).toContain('EVENT_AUTHORITY_REQUIRED');
      // 三个机制审计名逐一确认零预留
      for (const et of ['capability-disabled', 'capability-transferred', 'object-registered', 'check-report-recorded']) {
        expect(outcome(() => w.uow(NOBODY, (tx) => tx.appendLedger({
          eventType: et, payload: { capability: CAP_RECORDS },
        }))), et).toBe('NO_REFUSAL');
      }
    } finally { w.close(); }
  });

  test('G5A-F4b 全链（裸面单连接）：mint 审计 → UPDATE 过闸 → 停用被翻 → 新进程恢复签发；痕=可伪造形状', () => {
    const file = join(dir, 'f4b.db');
    const w = openFile(file);
    const oid = w.uow(ADM, (tx) => tx.createObject({ kind: 'test.claim', payload: {} })) as ObjectOid;
    w.uow(NOBODY, (tx) => w.standingUseCase().declare(tx, { oid, revision: 1, stance: 'ACCEPTED' }));
    w.unloadCapability(CAP_RECORDS, ADM); // 停用（真审计在位）
    const stamp = routeRow(w).changed_seq! + 42;
    // 单连接 autocommit：伪审计 + 过闸 UPDATE（父席点名验证的链）
    w.raw.run(
      `insert into ledger(seq, space, event_type, actor, payload_json, recorded_at) values(?,'SP-G5A','capability-enabled','admin-bot',?,?)`,
      stamp, JSON.stringify({ capability: CAP_RECORDS }), Date.now(),
    );
    expect(outcome(() => w.raw.run(
      `update capability_route set enabled=1, changed_seq=? where capability=?`, stamp, CAP_RECORDS,
    ))).toBe('NO_REFUSAL');
    w.close();
    const w2 = openFile(file);
    try {
      // 新进程读持久路由 ⇒ 停用被撤销、恢复签发；H 里的"启用审计"actor 是攻击者随手写的
      expect(outcome(() => w2.uow(NOBODY, (tx) => w2.standingUseCase().declare(tx, {
        oid, revision: 1, stance: 'ACCEPTED',
      })))).toBe('NO_REFUSAL');
      // 且这条伪审计与 setRouteEnabled 真落账在结构上不可区分（无 authority_basis、事件名、payload 形）
      expect(w2.raw.get<{ actor: string }>(`select actor from ledger where seq=?`, stamp)!.actor).toBe('admin-bot');
    } finally { w2.close(); }
  });
});

describe('G5A-F5 触发器作用域 = 连接：recursive_triggers 可被同连接关掉（契约主张被否证）+ 掏体触发器重开照绿', () => {
  test('G5A-F5a port.raw 同连接关 recursive_triggers ⇒ REPLACE 隐删不再触发 DELETE 触发器：H 行在**机制自己的连接**上被静默整行改写', () => {
    const w = open('f5a-pragma');
    try {
      const oid = w.uow(ADM, (tx) => tx.createObject({ kind: 'test.claim', payload: { v: 'real' } })) as ObjectOid;
      const seq = w.raw.get<{ seq: number }>(`select seq from ledger where object_id=? and event_type='object-registered'`, oid)!.seq;
      // 基线：REPLACE 撞 HISTORY_IMMUTABLE（包 4 修复在位）
      expect(outcome(() => w.raw.run(
        `insert or replace into ledger(seq, space, event_type, payload_json, recorded_at) values(?,'SP-G5A','object-registered','{"forged":1}',1)`, seq,
      ))).toContain('HISTORY_IMMUTABLE');
      // 关 PRAGMA：同一 port.raw、同一连接、一条 autocommit——不是裸文件，是机制连接
      w.raw.run(`pragma recursive_triggers = off`);
      expect(w.raw.get<{ recursive_triggers: number }>(`pragma recursive_triggers`)!.recursive_triggers).toBe(0);
      expect(outcome(() => w.raw.run(
        `insert or replace into ledger(seq, space, event_type, payload_json, recorded_at) values(?,'SP-G5A','object-registered','{"forged":1}',1)`, seq,
      ))).toBe('NO_REFUSAL'); // ⇒ 历史行已被整行替换
      expect(JSON.parse(w.raw.get<{ payload_json: string }>(`select payload_json from ledger where seq=?`, seq)!.payload_json))
        .toEqual({ forged: 1 });
      // 关掉 PRAGMA 后重开：连接重建 PRAGMA=ON、触发器名全在、版本一致 ⇒ **任何打开期校验都检不出**
      w.close();
      const w3 = openFile(join(dir, 'f5a-pragma.db'));
      try {
        expect(JSON.parse(w3.raw.get<{ payload_json: string }>(
          `select payload_json from ledger where seq=?`, seq,
        )!.payload_json)).toEqual({ forged: 1 }); // 伪行以 H 真身被读出
      } finally { w3.close(); }
      // ⇒ 结论（父席 ②附加点名）：机制**不保证**"经它打开的连接"在整个生命周期内带该 PRAGMA
      //   （它只在构造时开一次，同连接随时可关且守卫不查 port.raw——raw 本来就是全权面）；
      //   经非机制连接/关闸连接写入的数据在重开时**检不出**（无行级摘要/无连接态指纹）。
      //   ⇒ 「存储不变量对并发/外部写入者不设防」为真，G1 必须裁定边界。
    } finally { /* 已经 close */ }
  });

  test('G5A-F5b 手工 DatabaseSync 默认 recursive_triggers=OFF：REPLACE 隐删直接绕过全部 DELETE 触发器（ledger/route/dir/meta 四表同刻）', () => {
    const file = join(dir, 'f5b-bare.db');
    const w = openFile(file);
    w.uow(ADM, (tx) => tx.createObject({ kind: 'test.claim', payload: { v: 1 } }));
    w.unloadCapability(CAP_RECORDS, ADM);
    w.close();
    const bare = new DatabaseSync(file); // 默认 OFF——不经 SqlitePort，无守卫、无 PRAGMA
    try {
      expect((bare.prepare(`pragma recursive_triggers`).get() as { recursive_triggers: number }).recursive_triggers).toBe(0); // 裸连接默认 OFF
      // ledger 历史行 REPLACE：隐删不触发 ledger_no_delete
      bare.exec(`insert or replace into ledger(seq, space, event_type, payload_json, recorded_at)
                 values(1,'SP-G5A','object-registered','{"bare":"rewritten"}',1);`);
      expect((bare.prepare(`select payload_json from ledger where seq=1`).get() as { payload_json: string }).payload_json)
        .toContain('bare');
      // 路由 REPLACE 复活停用（D-27 的席位原形，在裸连接上原样可行）
      bare.exec(`replace into capability_route(capability, plugin_id, ns, contract_version, enabled)
                 select capability, plugin_id, ns, contract_version, 1 from capability_route where enabled=0;`);
      expect((bare.prepare(`select enabled from capability_route where capability=?`).get(CAP_RECORDS) as { enabled: number }).enabled).toBe(1);
      // meta 归零（D-29 原形）
      bare.exec(`replace into meta(key, value) values('ledger_seq', 0);`);
      expect((bare.prepare(`select value from meta where key='ledger_seq'`).get() as { value: number }).value).toBe(0);
    } finally { bare.close(); }
    // 可达面判定：以上全部要求**文件句柄 + 自带连接**——插件面拿不到 file 路径与 DatabaseSync；
    // 装配根/运维=界内登记（已如实）；**但机制连接的 raw 与裸文件在"能改 H"这个后果上等价**（F5a）。
    // 重开：ledger_seq=0 < 行数 ⇒ 下一次机制提交撞号或回放——打开期校验不含"ledger 最大 seq ≤ 水位"这一条。
    let reopened = 'NO_REFUSAL';
    try { const w2 = openFile(file); w2.close(); } catch (e) { reopened = String((e as { code?: string }).code ?? e); }
    expect(reopened).toBe('NO_REFUSAL'); // 归零+复活+改写后的库**重开全绿**
    const w3 = openFile(file);
    try {
      // 水位被归零后第一次机制提交即撞号——以**裸驱动错误**越过 Storage Port 边界暴露
      // （sqlite-port.ts 头注承诺「驱动词汇不得越过 Storage Port 边界」——此处被违例）
      expect(outcome(() => w3.uow(ADM, (tx) => tx.createObject({ kind: 'test.claim', payload: { v: 2 } }))))
        .toContain('UNIQUE constraint failed: ledger.seq');
    } finally { w3.close(); }
  });

  test('G5A-F5c 同名掏体（drop 后原样名字重建空壳）：REQUIRED_TRIGGERS 只比对触发器**名字**，掏体库重开全绿、保护全灭。writable_schema 改体形态被 node:sqlite 驱动拦（如实：该形态未能验证，但等价后果这条路径可达）', () => {
    const file = join(dir, 'f5c-gut.db');
    const w = openFile(file);
    w.uow(ADM, (tx) => tx.createObject({ kind: 'test.claim', payload: { v: 1 } }));
    w.close();
    const bare = new DatabaseSync(file);
    // writable_schema 直改 sqlite_master.sql：node:sqlite 拦「table sqlite_master may not be modified」
    expect(outcome(() => {
      bare.exec(`pragma writable_schema = on;`);
      bare.exec(`update sqlite_master set sql = 'create trigger ledger_no_delete before delete on ledger begin select 1; end'
                 where type='trigger' and name='ledger_no_delete';`);
    })).toContain('may not be modified');
    // 等价路径：同名摘除+空壳重建——名字集合一字不变，体被掏空
    bare.exec(`drop trigger ledger_no_delete;`);
    bare.exec(`create trigger ledger_no_delete before delete on ledger begin select 1; end;`);
    bare.exec(`pragma wal_checkpoint(truncate);`);
    bare.close();
    let reopened = 'NO_REFUSAL';
    try { new SqlitePort({ file }); } catch (e) { reopened = String((e as { code?: string }).code ?? e); }
    expect(reopened).toBe('NO_REFUSAL'); // ⇒ 名字在位 ⇒ 打开校验全绿；「摘掉任一必红」钉不住同名掏体
    // 保护真灭了：历史行可删（经机制自己的 port.raw）
    const w2 = openFile(file);
    try {
      expect(outcome(() => w2.raw.run(`delete from ledger where seq=1`))).toBe('NO_REFUSAL');
      expect(w2.raw.get<{ c: number }>(`select count(*) c from ledger`).c).toBe(0);
    } finally { w2.close(); }
  });
});
```

### A-2 `g5a-combo-world.test.ts`

```ts
/**
 * G5-A 攻④+⑤（席位 G5-A @03d74a0）：组合世界复验 + 前席未修项状态位。
 *
 * 攻④：
 *  C1 transferRoute × 「owner 一经登记不可变更」裁定的组合后果（**新缺陷**，作者裁定引入）：
 *     移交路由携带不同 storageNamespace ⇒ 既有对象 dir.ns 与生效路由 ns 不符 ⇒
 *     单对象读面 routeNs 抛 SCHEMA_INCOMPATIBLE；双时间扫描面 serveable() 只兜
 *     CAPABILITY_INACTIVE ⇒ **整页 readAsOf 一起死**（一颗毒行毒化全库扫描面）；
 *     `directory_no_update` 在所有连接（含迁移器自开的 DatabaseSync）一律拦 UPDATE ⇒
 *     机制内与机制的 UPDATE 通道都无补救。
 *  C2 D-24 软幽灵边（required:false）× D-28 ⇒ 巡检 `auditRequiredIntegrity` 只扫 required=1，
 *     软幽灵边**永不在巡检计数里**（状态位复钉）。
 *  C3 三读面两答案（G3-A 登记、包 5 未声称修）：`write()` 面（D-24）写他人 oid 的行，
 *     readAsOf（无 ns 过滤）端出他人对象之名的攻击者行，readLatest（按 dir.ns 过滤）不见。
 *
 * 攻⑤：D-21（RPT-${seq} 抢占 + linkRef to 不核）、E-01/D-12（eventsOf 泄露存在性预言机）、
 *       N4（reassignRouteInternal 仍在原型上）、GT-2/GT-3/N5 用 `--baseline/--anchor` 临时路径
 *       重放（不触任何受保护文件），另列 bash 记录，不在本文件。
 */
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { POC_DATA_DIR } from '../../src/harness/paths.ts';
import { openWorld, PRINCIPAL, type World } from '../../src/harness/world.ts';
import { TEST_OBJECT_MODEL, CAP_OBJECT_MODEL } from '../../src/domains/test-object-model.ts';
import { TEST_RECORDS, CAP_RECORDS } from '../../src/domains/test-records.ts';
import { readAsOf } from '../../src/kernel/read-context.ts';
import { asOid, type ObjectOid, type PluginManifest } from '../../src/contracts/index.ts';

const ADM = PRINCIPAL('g5acadm');
const ALICE = PRINCIPAL('g5acalice'); // space-write
const NOBODY = PRINCIPAL('g5acnobody');
const GRANTS = {
  g5acadm: ['space-write', 'capability-admin', 'domain-admission'],
  g5acalice: ['space-write'],
  g5acnobody: ['space-write'],
};
let dir: string;
beforeAll(() => { dir = mkdtempSync(join(POC_DATA_DIR, 'g5a-combo-')); });
afterAll(() => { rmSync(dir, { recursive: true, force: true }); });
const open = (name: string): World =>
  openWorld({ file: join(dir, `${name}.db`), space: 'SP-G5AC', grants: GRANTS, plugins: [TEST_OBJECT_MODEL, TEST_RECORDS] });
const openFile = (file: string): World =>
  openWorld({ file, space: 'SP-G5AC', grants: GRANTS, plugins: [TEST_OBJECT_MODEL, TEST_RECORDS] });
const outcome = (fn: () => unknown): string => {
  try { fn(); return 'NO_REFUSAL'; }
  catch (e) {
    const err = e as { code?: unknown; message?: unknown; detail?: unknown };
    if (typeof err?.code === 'string' && err.code !== 'ERR_SQLITE_ERROR') {
      return `${err.code}:${JSON.stringify(err.detail ?? {})}`;
    }
    if (typeof err?.message === 'string' && typeof err?.code === 'string') return `${err.message} (${err.code})`;
    return String(err?.message ?? e);
  }
};

// 与 TEST_OBJECT_MODEL 同能力、同契约版本、**不同 storageNamespace** 的"升级包"清单（F-11 的正当移交形态）
const OM_MIGRATED: PluginManifest = {
  ...TEST_OBJECT_MODEL, pluginId: 'test.object-model.v2', storageNamespace: 'dom_test_om_v2',
};

describe('G5A-C1 transferRoute 携 ns ⇒ 既有对象永久锁死（作者"owner 不可变更"裁定引入的新缺陷）', () => {
  test('G5A-C1a 移交只动路由行：移交后既有对象三个单对象读面全 SCHEMA_INCOMPATIBLE；**双时间扫描面整页死**（毒行毒化全库扫描）；重启持续', () => {
    const file = join(dir, 'c1.db');
    const w = openFile(file);
    const oid = w.uow(ALICE, (tx) => tx.createObject({ kind: 'test.claim', payload: { v: 'real' } })) as ObjectOid;
    // 另一能力的对象在场（验证扫描面污染范围：整页死 ≠ 单对象不可读）
    const w2oid = oid;
    expect(w.kernel.readSnapshot(w2oid)!.payload).toEqual({ v: 'real' });
    // 正当移交（capability-admin 权威轴，走的全是机制通道）
    w.transferCapability(CAP_OBJECT_MODEL, OM_MIGRATED, ADM);
    // (1) 单对象快照面：fail-loud（设计意图 F-03/F-11——但这正是"永久"的部分）
    expect(outcome(() => w.kernel.readSnapshot(oid))).toContain('SCHEMA_INCOMPATIBLE');
    // (2) 事务内 readLatest：同一判据
    expect(outcome(() => w.uow(ALICE, (tx) => tx.readLatest(oid)))).toContain('SCHEMA_INCOMPATIBLE');
    // (3) 双时间扫描面：**不是剔除+计数，是整页抛**——serveable() 只兜 CAPABILITY_INACTIVE，
    //     SCHEMA_INCOMPATIBLE 直接上抛 ⇒ 一颗毒行让全 Space 的 recorded_as_of 不可用
    expect(outcome(() => readAsOf(w.kernel, {
      space: 'SP-G5AC', principal: ALICE, mode: 'recorded_as_of', consistency: 'required',
    }))).toContain('SCHEMA_INCOMPATIBLE');
    // (4) **任何历史截点都在抛**：毒对象的行自出生起就在每个 ≥ 出生 seq 的页里，
    //     activate 不写 domain_state ⇒ 不存在"早于毒化"的可读页 ⇒ 扫描面永久不可用（不是"部分页能过"）。
    expect(outcome(() => readAsOf(w.kernel, {
      space: 'SP-G5AC', principal: ALICE, mode: 'recorded_as_of', consistency: 'required', recordedAsOf: 1,
    }))).toContain('SCHEMA_INCOMPATIBLE');
    // (5) 重启持续：持久路由带新 ns，dir 行仍旧 ns ⇒ 新进程同样锁死
    w.close();
    const w3 = openFile(file);
    try {
      expect(outcome(() => w3.kernel.readSnapshot(oid))).toContain('SCHEMA_INCOMPATIBLE');
      // (6) 新对象在**新 ns** 正常（锁死范围=移交前既有对象；运维若先移交后发现，已登记对象全废）
      const fresh = w3.uow(ALICE, (tx) => tx.createObject({ kind: 'test.claim', payload: { v: 'fresh' } })) as ObjectOid;
      expect(w3.kernel.readSnapshot(fresh)!.payload).toEqual({ v: 'fresh' });
    } finally { w3.close(); }
  });

  test('G5A-C1b 补救面判定：目录行 UPDATE 在**一切连接**（含迁移器自开 DatabaseSync）被 directory_no_update 拦 ⇒ 机制内与机制的 UPDATE 通道皆无；唯一"补救"=摘触发器（被作者自身纪律禁为修法）', () => {
    const file = join(dir, 'c1.db');
    // 上一例已移交；机制装配面直接 UPDATE dir.ns：
    const w = openFile(file);
    expect(outcome(() => w.raw.run(
      `update object_directory set ns='dom_test_om_v2' where ns='dom_test_om'`,
    ))).toContain('DIRECTORY_IDENTITY_FROZEN');
    w.close();
    // 迁移器连接（migrateLegacyRecords 同款：自带 DatabaseSync，默认 recursive_triggers=OFF）
    const mig = new DatabaseSync(file);
    expect(outcome(() => mig.exec(
      `update object_directory set ns='dom_test_om_v2' where ns='dom_test_om'`,
    ))).toContain('DIRECTORY_IDENTITY_FROZEN');
    // REPLACE 形在迁移器连接上**可行**（隐删不触发 DELETE 触发器 + 出生审计真账在位 ⇒ 判据过）：
    // 补救通道存在，但它恰好是 D-27 钉为"全面封禁"的写形——修一个锁死要用另一个被禁的形。
    const rows = (mig.prepare(`select oid, created_seq, owner_capability, kind from object_directory where ns='dom_test_om'`).all() as
      { oid: string; created_seq: number; owner_capability: string; kind: string }[]);
    for (const r of rows) {
      mig.exec(`insert or replace into object_directory(oid, space, kind, owner_capability, ns, created_seq)
                values('${r.oid}','SP-G5AC','${r.kind}','${r.owner_capability}','dom_test_om_v2',${r.created_seq});`);
    }
    mig.close();
    const w4 = openFile(file);
    try {
      // 换 ns 后可读回来 ⇒ 锁死不是密码学意义上的不可逆，是**机制不提供通道**的锁死
      expect(outcome(() => w4.kernel.readSnapshot('OBJ-SP-G5AC-1' as ObjectOid))).toBe('NO_REFUSAL');
    } finally { w4.close(); }
  });

  test('G5A-C1c 正向对照：同 ns 移交（世界 bless 的 Split 形态）不受影响——缺陷面精确钉在"移交携 ns"', () => {
    const w = open('c1c.db');
    try {
      const oid = w.uow(ALICE, (tx) => tx.createObject({ kind: 'test.claim', payload: { v: 1 } })) as ObjectOid;
      const split: PluginManifest = { ...TEST_OBJECT_MODEL, pluginId: 'test.object-model.split' }; // ns 不变
      w.transferCapability(CAP_OBJECT_MODEL, split, ADM);
      expect(w.kernel.readSnapshot(oid)!.payload).toEqual({ v: 1 });
    } finally { w.close(); }
  });
});

describe('G5A-C2/C3 巡检盲区 + 三读面两答案（状态位复钉）', () => {
  test('G5A-C2 D-24 软幽灵边（required:false）× 巡检：linkRef 幽灵 to 提交过、auditRequiredIntegrity 计数不含它 ⇒ "巡检 0 违规"与幽灵在位并存', () => {
    const w = open('c2.db');
    try {
      const oid = w.uow(ALICE, (tx) => {
        const o = tx.createObject({ kind: 'test.claim', payload: {} }) as ObjectOid;
        tx.linkRef({
          from: { kind: 'revision-ref', oid: o, revision: 1 },
          to: { kind: 'object-ref', oid: asOid('OBJ-SP-G5AC-999999') },
          role: 'g5a.soft-ghost', required: false,
        });
        return o;
      });
      expect(oid).toBeTruthy();
      const audit = w.kernel.auditRequiredIntegrity();
      expect(audit.checked).toBe(0); // 软边不在扫描集合（`where required=1`）
      expect(audit.violations).toHaveLength(0);
      // 幽灵边在 ref_edge 里永久存在（表无触发器——派生/边面按设计豁免，但消费面按存在即真相读它）
      expect(w.raw.get<{ c: number }>(
        `select count(*) c from ref_edge where to_oid='OBJ-SP-G5AC-999999'`,
      )!.c).toBe(1);
    } finally { w.close(); }
  });

  test('G5A-C3 三读面两答案（D-24 面，机制可达）：write() 行以**他人对象之名**进 readAsOf，readLatest/readRevision 按 ns 过滤不见——REPLACE 封禁后依旧两答案（包 5 未声称修，复钉）', () => {
    const w = open('c3.db');
    try {
      const oid = w.uow(ALICE, (tx) => tx.createObject({ kind: 'test.claim', payload: { v: 'real' } })) as ObjectOid;
      // 攻击者能力只有 records 的 ns；oid 属 object-model。write() 只判 ns 不判 oid（D-24 完整修法待 G1）
      expect(outcome(() => w.uow(NOBODY, (tx) => {
        w.writerOf(CAP_RECORDS, tx).write({
          ns: 'dom_test_records', oid, revision: 99, payload: { evil: true }, eventType: 'ext.g5a',
        });
      }))).toBe('NO_REFUSAL');
      // 读面 1/2：ns 过滤的单对象面看不见伪造行
      expect(w.kernel.readSnapshot(oid)!.payload).toEqual({ v: 'real' });
      // 读面 3：readAsOf 扫描无 ns 过滤 ⇒ 伪造行作为**该对象的状态行**被端出
      const r = readAsOf(w.kernel, {
        space: 'SP-G5AC', principal: ALICE, mode: 'recorded_as_of', consistency: 'required',
      });
      const poisoned = r.rows.filter((row) => row.oid === oid);
      expect(poisoned.length).toBeGreaterThan(0);
      expect(poisoned.some((row) => JSON.stringify(row.payload).includes('evil'))).toBe(true);
      // ⇒ 同一对象同一时刻：快照面 {v:real}，双时间面 [{v:real},{evil:true}]——两个答案，机制面可达。
    } finally { w.close(); }
  });
});

describe('G5A-C5 前席项状态位（D-21 / E-01 / N4）', () => {
  test('G5A-C5a D-21 RPT-${seq} 抢占：space-write 主体预占未来报告号 ⇒ 合法验证提交被 RECORD_ALREADY_DECLARED 拒（报告落账 DoS，未修）', () => {
    const w = open('c5a.db');
    try {
      const run = w.validationSubmission(ALICE);
      const oid = w.uow(ALICE, (tx) => tx.createObject({ kind: 'test.claim', payload: {} })) as ObjectOid;
      const head = w.ledgerHead();
      // 攻击：预声明 `RPT-<head+2>`——预占事务本身吃掉 head+1，下一次别人的提交必用 head+2。
      // 号可预测（seq 单调 +1）⇒ 报告身份 `RPT-${seq}` 可被 space-write 主体滚动抢占。
      w.uow(NOBODY, (tx) => tx.declareRecord({ recordId: `RPT-${head + 2}`, eventType: 'x', payload: {} }));
      // 合法验证提交在下一 seq 落账 ⇒ 报告号撞上攻击者预占的 identity
      const report = {
        target: { kind: 'revision-ref' as const, oid, revision: 1 },
        validatorId: 'v1', ruleVersion: '1', schemaVersion: '1', environment: 'test',
        executedAt: Date.now(), guaranteeScope: 'unit', verdict: 'PASS' as const, findings: [], declaredGaps: [],
      };
      expect(outcome(() => run.submitReport(report))).toContain('RECORD_ALREADY_DECLARED');
      // 且攻击者可滚动预占（seq 永远可猜）⇒ 报告落账面被持续性拒用
      const head2 = w.ledgerHead();
      w.uow(NOBODY, (tx) => tx.declareRecord({ recordId: `RPT-${head2 + 2}`, eventType: 'x', payload: {} }));
      expect(outcome(() => run.submitReport(report))).toContain('RECORD_ALREADY_DECLARED');
    } finally { w.close(); }
  });

  test('G5A-C5b E-01/D-12 存在性预言机：eventsOf 越界拒绝的 detail 携带 oid+owner ⇒ 可判定"对象存在且属主是谁"（未修）', () => {
    const w = open('c5b.db');
    try {
      const oid = w.uow(ALICE, (tx) => tx.createObject({ kind: 'test.claim', payload: {} })) as ObjectOid;
      // records 能力的 face 读 object-model 的对象事件流 ⇒ NAMESPACE_ESCAPE，detail 泄 owner。
      // 先撤销装配期 CROSS_EVENT_READ 授权（否则跨读被允许、走到不到拒绝分支）。
      w.kernel.revokeCrossEventRead(CAP_RECORDS, ADM);
      const res = outcome(() => w.kernel.faceFor(CAP_RECORDS).eventsOf(oid, 'anything', 99999));
      expect(res).toContain('NAMESPACE_ESCAPE');
      expect(res).toContain(oid); // oid 回显
      expect(res).toContain(CAP_OBJECT_MODEL); // **owner 泄露**：不存在与存在的对象可区分 ⇒ 存在性预言机
    } finally { w.close(); }
  });

  test('G5A-C5c N4 状态位：reassignRouteInternal 仍挂在 UnitOfWork 原型上（运行时枚举可及）；权威闸兜底在位', () => {
    const w = open('c5c.db');
    try {
      let onProto = false; let guard = 'NO_REFUSAL';
      w.uow(NOBODY, (tx) => {
        onProto = 'reassignRouteInternal' in (tx as unknown as Record<string, unknown>);
        guard = outcome(() => (tx as unknown as {
          reassignRouteInternal: (c: string, p: string, n: string, v: string) => void;
        }).reassignRouteInternal(CAP_OBJECT_MODEL, 'x', 'ns_x', 'v1'));
      });
      expect(onProto).toBe(true); // N4 本体：暴露未撤
      expect(guard).toContain('AUTHORITY'); // 兜底：capability-admin 拒 space-write
    } finally { w.close(); }
  });
});
```

---

## 附录 B —— 门禁变异实验原始输出（GT-4/GT-2/GT-3/N5；全部经 `--anchor/--baseline` 临时路径或 temp 变异+恢复，受保护文件零永久改动）

通用环境：worktree @03d74a0；`--anchor .g5a-tmp/anchor.json` 与 `--baseline .g5a-tmp/baseline.json` 均为受保护文件的工作副本；真实 `AUTHOR_ANCHOR.json`/`attacks/BASELINE.json` 全程未动（哈希核验见附录 C）。各实验输出为门禁原始行的逐字摘录；「审查方新增通过 17 条 / 总数 150≠133」是本席两攻击文件在收集里的正常面，与各实验结论无关，下列摘录已略去其明细行。

**E1 等数替换·改名**（`sed 'D30-1→D30-1R'` 一处改名，计数不变）→ 红：
```
 - 作者通过集**身份**漂移：计数逐等（185）但通过项名集摘要不等（实测 aa6abf5dd5f6… ≠ 锚 06b997714208…）。计数相等而名集不等 ⇒ 用例被改名 / 被换掉 / 被等数替换——「全绿」的两字中间换了货。必须核对差异后显式 --reanchor。
```
**E2a 保名掏体**（D30-1 四条真断言整体替换为 `expect(1).toBe(1);`，名/数一字不动，185 例仍全绿）→ 仅 `files_sha256` 单闸抓住：
```
 - 作者 tests/** 文件清单摘要不等（实测 458a68b22c40… ≠ 锚 c27056d9eac9…）：名集与计数都没变而文件内容/路径变过——断言体（乃至一个注释字节）与锚不一致。测试怎么写的也在锚定范围内，须核对后显式 --reanchor。
```
**E2b 掏体 + 重锚 = 洗白链成立**：
```
已重锚 .g5a-tmp/anchor.json：passed=185 total=185 passed_sha=06b997714208… files_sha=458a68b22c40… @ 03d74a0
（掏体态重锚后再跑门禁：）
  OK —— 185 例全绿，与身份锚四项逐等（passed/total/passed_sha/files_sha；skip=0，exit=0，success=true）
```
⇒ 断言已被掏空、锚却宣布「逐等」——`passed_sha` 因名集未变完全失明，**唯一残闸是人的重锚识别**（③节机械防线 1–3 因此提出）。
**E3 test.skip 一条** → 红 + 重锚拒写：
```
 - 作者测试门出现 1 条 skip/pending —— 跳过不是通过。整文件 skip 时 vitest 退出码仍为 0，只有计数能抓住它
 - 拒绝写锚：作者测试当前不干净（有红 / 有 skip / 非零退出）。锚只能记真实通过数。
```
（`describe.skip` 未单独跑——同走 skipped 计数口径；`it.skip` 首次尝试因该文件未 import `it` 先撞 tsc 门，改用已 import 的 `test.skip` 完成重放——顺带证明 tsc 门是 skip 变异的额外拦截层而非漏洞。）
**E4 移目录**（`tests/d30-guard-forms.test.ts` → `tests2/`）→ 红；且 vitest **仍收集它**（作者流以路径子串过滤，`poc/tests` ⊂ `poc/tests2`，计数 185 未动）：
```
 - 作者通过集**身份**漂移：计数逐等（185）但通过项名集摘要不等（实测 4499801f8d37… ≠ 锚 06b997714208…）。
```
⇒ 名集 key 含文件路径 ⇒ 移动即改名集红；`files_sha256` 只走 `tests/` 亦失去该文件。**无任何单径让门禁绿**——父席点名要找的「不需要人配合的口径」不存在；唯一洗白链仍是 E2b（改+重锚）。
**GT-3+N5 一轮重放**：本席临时探针（一条恒红真断言 + 同文件 `afterAll` 抛错）入 attacks 后，从当前态重算自洽 baseline（`failures 33 / passes 118 / total 151`，探针红以「已知红」入册）→ 门禁 **PASS**：
```
已重锚 .g5a-tmp/anchor.json（恢复到干净态后）：passed=185 total=185 … files_sha=c27056d9eac9… @ 03d74a0
  OK —— 185 例全绿，与身份锚四项逐等（…）
  OK —— 与基线完全一致（33 条已知红，均已定性）
[g0-gate] PASS —— 三条流均符合预期（审查方红条是"已定性的已知项"，不代表产品通过）   exit=0
```
⇒ GT-3 未修（自洽重算洗绿）；且同轮 `afterAll` 崩溃**未被任何一行报出**（loadErrors 判据=「0 红且有 message」，带红文件被吸收）⇒ N5 未修。
**GT-2 重放**：探针真断言 `expect(w.ledgerHead()).toBe(999999)` 掏为 `expect(1).toBe(2)`（同名同红），基线一字不动再跑 →
```
  OK —— 与基线完全一致（33 条已知红，均已定性）
[g0-gate] PASS —— 三条流均符合预期…   exit=0
```
⇒ GT-2 未修；红条**语义**不在任何摘要内。探针已从本席攻击文件移除（最终收工 17 例全绿=无探针态）。
**收工态（真实锚+真实基线）**：
```
[1/3] OK
[2/3] OK —— 185 例全绿，与身份锚四项逐等（passed/total/passed_sha/files_sha；skip=0，exit=0，success=true）
[3/3] OK —— 与基线完全一致（32 条已知红，均已定性）
[g0-gate] FAIL
 - 审查方收集总数 150 ≠ 基线 133：有文件没被收集或凭空多出一份
 - 审查方新增通过 17 条（覆盖面变大，须显式入基线）
```
（FAIL 仅因本席两攻击文件未入作者基线——与前席 g3a/g4a 收工面相同，属「覆盖面变大须显式入基线」的预期动作，非回归。）

## 附录 C —— 恢复完整性核验（worktree 销毁前最后一次）
```
$ git status --porcelain
?? experiments/v3-code-architecture-poc/.g5a-tmp/            （实验日志与临时锚/基线副本，随 worktree 销毁）
?? experiments/v3-code-architecture-poc/attacks/review/g5a-combo-world.test.ts   （本席攻击文件）
?? experiments/v3-code-architecture-poc/attacks/review/g5a-route-forms.test.ts   （本席攻击文件）
?? node_modules                                              （纪律要求的符号链接）
$ git diff --stat        （空——所有被跟踪文件零改动）
受保护文件哈希（git hash-object == git rev-parse HEAD:）：
OK  tests/d30-guard-forms.test.ts   5d5d75091fdf368d085c80d36d2e251d283c9bb4
OK  g0-gate.mjs                     dc7999bf6ab42830533c40b536a9b0448aba8f2b
OK  AUTHOR_ANCHOR.json              73807943d0a3b1c1bf8da205b3ff57ba86af968d
OK  attacks/BASELINE.json           c394ed70adccc8952b1b3dce8fcbcbfc9b0d2ba0
```
（E1/E2/E3/E4 各自的恢复校验在实验当时逐一做过并打印 `restore OK`，最终收工再以全量 `git status`/`git diff --stat` 兜底。）
