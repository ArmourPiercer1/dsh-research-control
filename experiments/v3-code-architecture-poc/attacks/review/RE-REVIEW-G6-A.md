# RE-REVIEW-G6-A — 第六席独立复验（commit `398df30`，POC 包 6）

- **席位**：G6-A（独立复验席，对作者包 6「五 P1 收口」做攻击 + 审计；绿 ≠ 通过）。
- **对象**：分支 `poc/v3-code-arch-20261030` @ `398df30`；重建文件 `src/storage-sqlite/sqlite-port.ts`（647 行，作者事故后用记忆重写，EVIDENCE 自述「重建部分未经逐行独立审查」）——**本席主责**。
- **基线（开席核验）**：`tsc` 0 错；作者流 35 文件 / 207 例全绿且与 `AUTHOR_ANCHOR.json` 四项逐等（passed=207 / total=207 / passed_sha=115026e7cde9… / files_sha=fe1c391601c0…，建锚 `d578208`）；g0-gate 对 `attacks/BASELINE.json` 33 条已知红**逐等** PASS。
- **方法**：隔离 worktree（`.scratch/wt-g6a`）；新攻击 32 例全部另辟形态（不抄作者测试），两文件 `attacks/review/g6a-storage-forensics.test.ts`（22 例，存储层 A1–A5）+ `g6b-reacttack-p1.test.ts`（10 例，P1 复攻 B 组 + 历史面）；门禁面变异实验（C 组）全部「临时路径 + 改后即恢复 + `git hash-object` == `git rev-parse HEAD:` 双验」。历史库夹具由 `d578208` worktree **包 5 合法通道**造出（附录 C），非手改 SQL。
- **纪律自查**：主锚 / `AUTHOR_ANCHOR.json` / `attacks/BASELINE.json` / `g0-gate.mjs` / `src/**` / `tests/**` 零改动（全部走 `--anchor` / `--baseline` 临时路径）；两处临时变异文件恢复双验 RESTORE-OK；worktree 已按规程移除。

---

## ① 裁定表

| # | 面 | 前席（RE-REVIEW-G5-A） | **本席实证裁定** | 依据 |
|---|---|---|---|---|
| 1 | **D-27 主行**（机制审计名预留 + 路由见证闸，插件可达面） | partial-fix P1 | **收口成立（插件可达面归零）**：五名 × appendLedger/declareRecord/write() 三通道全拒零半成品（G6B-D27-1）；恶意清单认领机制名 ⇒ `AMBIGUOUS_AUTHORITY`（G6B-D27-2）；`appendAuthoritativeEvent` 不借道（同）；裸面伪造=已登记界（G27-C + 我 A2 矩阵复钉）。 | g6b D27-1/2；g6a A2-1..4 |
| 1a | **D-27 残余·联合形漏检** | — | **P4（界内）**：enabled 翻转 + 三元组同改，只配 `capability-enabled` 名 ⇒ 过闸；移交语义（transferred）被吞。子句③两支各自为判，无「并发改必须并名」判据。 | g6a A2-4 |
| 1b | **D-27 残余·actor 只核非空（独立成行，父席要求）** | 并入 D-27 | **P4（界内），单列**。实证：`actor=`**别人的 principal** 照过闸（G6A-A2-3），只有 NULL 被拦（G27-C 已钉）。⇒「核 actor」的正确表述是：**核的是『有一个 actor』，不是『这个 actor 有权』**。可判定修法：闸追加 `l.actor = json_extract(l.authority_basis, '$.actor')`（信封一致性——actor 必须与机制见证信封里的取证主体同源），机制侧 `authority_basis` 增写 actor 字段；伪造方从此不能在诚实信封上写别人的名字，「连信封一起伪造」形仍归已登记裸界。**注**：触发器层本就无法判别 actor 是否 capability-admin 持有者——任何不引入不可伪造信封的修法都到不了「核权」。 | g6a A2-3、G27-C |
| 1c | **D-27 结构性残余·预留策略（G1 裁决句）** | — | **结构性缺口（本席按父席要求原样钉这句）：**当前默认策略 = 名单外事件名默认可写（deny-by-exception）**。实证（G6B-D27-3）：机制自己在写的名单外名 `object-revised`（kernel.ts:1231 revise）、`record-backfilled`（migrateLegacyRecords）以及任意未来新名（`capability-reloaded`、`capability-migrated-v9`……）经通用台账通道**照常可 mint**。今天无害只因为**没有任何触发器/判据依赖这两个名**——「没洞」是巧合，不是设计。修法二选一：(a) 改 deny-by-default（预留=前缀/命名空间规则，机制名全部落进封闭名单，新增机制名走冻结面流程）；(b) 机验「机制事件名清单与写点共生」（编译期从写点生成名单，名单外写机制域事件=编译红）。 | g6b D27-3 |
| 2 | **停用复活·PK 改名链（独立成行，父席定性）** | 新形态待定性 | **「我上席写的方向判据自身有洞」——父席原话，单列。P3（登记裸界内，但它绕开的正是专为 D-27 写的判据）**。完整链 3 步、1 条伪造见证审计（任意名即可）：① `UPDATE capability_route SET capability='<墓碑名>'`——`capability` 是主键，**不在子句③三元组名单里**，任意一条名实相符的审计即过；② `INSERT` 一条原能力的全新登记形行——`route_insert_guarded` 对新生行零审计是设计（:93-97 注释自述「INSERT 伪造不出『已审计』」，但新生行本身不要求任何审计）；③ 重启 ⇒ 新进程按持久路由复活，`enabled=1, changed_seq=NULL`。**复活全程零启用审计**：H 里指向该能力的启停账只有停用那 1 条（G6B-D27-4 实证），审计面看不出「它又活了」；唯一痕迹=墓碑行永久残留（`route_no_delete` 删不掉）且**不在任何机制扫描面上**。插件可达面逐步验证做不到（mint 已被预留封死，先撞 `EVENT_AUTHORITY_REQUIRED`）。修法方向（父席定）：方向判据从「名单内 capability 的字段变化」扩为「**任何主键出现/消失都必须有对应审计事件**」——`route_insert_guarded` 对新生行也要求随附审计（首登记 bootstrap 需另立边界或水位形判据）；墓碑行（enabled=0 或无对应清单声明的路由名）纳入 `auditRequiredIntegrity` 巡检。 | g6b D27-4 |
| 3 | **D-31 入口**（移交不携 ns） | fixed | **收口成立**：`TRANSFER_NS_DRIFT` 判据在开事务/落账/改路由之前，detail 恰四键、路由一字未动、零半成品（G6B-D31-1）；停用中移交 = `CAPABILITY_INACTIVE`（EVIDENCE ⑤ 未覆盖组合补钉）；`reassignRouteInternal` 确无 ns 参数、路由 ns 恒取持久行。 | g6b D31-1 |
| 3a | **D-31 历史面（独立成行——本轮最想要的回答）** | （本洞即 G5-A 所造） | **P2（PoC 范围）+ 升级注记：真实产品里 v6-era 库只要存在过即 P1 运维洞。关键分辨：v6 库是被版本墙顺住的，不是被检出的**。实证链：(1) 包 5 **合法通道**造出的漂移库（dir.ns=`dom_test_om` ≠ route.ns=`dom_test_om_v2`，schema_version=6）在 398df30 打开 ⇒ `SCHEMA_UPGRADE_REQUIRED`（v6≠v7 版本墙先拦住，`sqlite-port.ts:384`，漂移根本没被评估）；(2) 救济面为空：`migrateLegacyRecords`（:223-259）不查版本、只回填 records，跑完仍拒开；`auditRequiredIntegrity` 根本不比对 ns（且库开不了）；(3) **一旦 SCHEMA_VERSION 对齐（下一次任何迁移都会），漂移就零声纳照常开**——v7 库内同形漂移（界外构造）重开零判据通过、快照面 fail-loud、扫描面 hiddenByContractSkew=1 存活、`auditRequiredIntegrity` 零声纳、`dir.ns` 被 `directory_no_update` 冻死无救济（G6B-D31-3）。⇒ **D-31 = 修了入口，历史面 = 无检出 + 无救济 + 无迁移通道**。建议（写进运维面）：打开期扫描 = `select d.oid from object_directory d join capability_route r on r.capability=d.owner_capability where r.enabled=1 and r.ns<>d.ns` 非空 ⇒ 拒开+点名 oid 集；显式迁移通道需带 `capability-transferred` 三元组见证的 ns 改写——但 `dir.ns` 冻结与它正面冲突（D-28 裁定），**这是 G1 设计题不是修法题**。 | g6b D31-2/3；附录 C |
| 4 | **D-24 读侧**（漂移不再炸穿扫描面） | fixed（P1 修法待验） | **修法成立**：投毒行剔除且计数、三读面一致（G24-A 复验）；漂移扫描存活（G24-B）；我另辟：v7 库内漂移重开，快照 fail-loud / 扫描遮蔽存活 / echo 键集冻结（G6B-D31-3）。残余见 #4a/4b。 | g6b D31-3、D24-1 |
| 4a | 残余·遮蔽计数=一过性回声 | — | **P4 观察**：`hiddenByContractSkew` 等计数**合法流量可淹没**（1 投毒 + 5 合法挂载 = 同一计数 6，不可分且不归计数负责）且**不落任何持久工件**——库里没有任何「发生过遮蔽」的痕迹；可见性=每次读的一过性回声，没人盯回声就没有发现。统一建议见 #13。 | g6b D24-1 |
| 4b | 残余·`CONTEXT_INCOMPLETE` 幽灵行整页抛 | 已登记 | **维持登记（P4，界内）**：无目录行的 domain_state 行 ⇒ readAsOf 整页抛（read-context.ts:88）；需裸面构造，界内。 | 前席登记，本席未回归 |
| 5 | **D-21**（RPT- 预占） | fixed | **收口成立**：显式 `RPT-` 声明 ⇒ `RECORD_ID_RESERVED` 零半成品、合法报告照常、连续发号照常（G21 复验 + 我 G6B-D21-1 复钉）；**前缀全集穷举=仅 `RPT-`**（kernel.ts:68）；`OBJ-` 前缀声明为 record 与对象身份互不踩（records/ledger 双 namespace 实证，resolvePresented 两路各自 PRESENT、对象读面不受影响）；小写 `rpt-` 放行（binary collation，与机制发号零碰撞）。残余：前缀全集语义归 G1（代码注释自让）。 | g6b D21-1 |
| 6 | **C2**（softGhosts 可见化） | fixed | **收口成立**：`softGhosts` **确有非零断言**（g5a-c2 C2-A 断 `softChecked=3, softGhosts=2`——父席要的不是「默默新增字段」，验实）；只报不阻语义未动；我补双 NULL 软边形态（raw 直插）→ 计入 ghost（G6B-C2-1）。 | g6b C2-1；g5a-c2 |
| 7 | **N9 残余**（水位/ghost 戳） | partial-fix P2 | **打开期判据复钉全部符合宣称**：ghost 号前跳（水位抬高、行不写）重开**检不出**——合法形态恒满足 `max(seq)≤watermark`，注释（:408-411）自己承认「ghost 戳不可分辨」是登记面（G6A-A4-1）；**「只删最大 seq 行」两路全灭**——显式 DELETE 一切连接撞 `HISTORY_IMMUTABLE`（recursive_triggers 只管**隐式**删除，前席口头理解钉正，G6A-A4-2）；REPLACE 顶写撞 DELETE 触发器（Port 连接）；水位 REPLACE 归零重开红（ST-A 路径复现）；`id_counter` DELETE 被 OID 一致性判据接住（:22-24 注释宣称兑现，G6A-A4-4）；`schema_version` 下调撞单调触发器（v7 标记自身进计数保护面）。**残余=登记面，无新洞。** | g6a A4-1..4 |
| 8 | **GT-4**（作者流身份锚） | partial-fix P2 | **维持 P2**：唯一洗白链=「改断言体 + 重锚」，本席完整走通（实验 S1）：掏空 C2-A 的 `softGhosts` 断言体（名/数不变）⇒ `files_sha` 红被抓（S1a FAIL，:436 摘要判据生效）；`--reanchor` 到临时锚 ⇒ 通过项身份/计数四项全等、锚重写（S1b）⇒ 门禁对该流放行（链在位实锤）。主锚未动。防线仍是「变异抽检纪律，非机制」——锚注释（g0-gate.mjs:129）自己写明。 | C 组 S1 |
| 9 | **GT-2**（attacks 内容零校验） | P2 | **维持 P2，本席最小复现**：把已登记红 `host-boundary-attack.test.ts > …must not carry arbitrary SQL…` 的一条守卫断言掏空成 `expect(1).toBe(1)`（名/红不变）⇒ 门禁对重算基线 **PASS**（S3）。**attacks/\*\* 的断言体不在任何摘要面内**——已登记红条探针的文本可以被掏空而门禁无感。这是登记残余，非本包回归。 | C 组 S3 |
| 10 | **GT-3**（基线重算=洗白通道） | P2 | **维持 P2，最小复现**：从当前状态重算基线 JSON（33 红 + 132 绿含本席 32 条）写临时路径 ⇒ 门禁 PASS（S2）。谁都能把「自己新增的红」洗成「已知红」。摩擦项（未登记细节，本席补记）：`--reanchor` 只覆盖作者流，attacks 基线**没有** `--reanchor` 通道，须手工重算 JSON——重算通道因此比锚通道更隐蔽（无「当前不干净拒写」的护栏）。 | C 组 S2 |
| 11 | **N5**（清理期崩溃吸收） | P2 | **维持 P2，复现**：已登记红文件挂 `afterAll(() => { throw … })` ⇒ 文件级失败被「有登记红可解释」吸收（loadErrors 判据 `(f.status==='failed' && reds===0)` 的豁免侧），门禁 **PASS**（S4）。对照面：崩溃文件**无**登记红可解释时 loadErrors 抓住（GT-1 修复有效，本席以 Transform 失败意外复验——语法坏掉的攻击文件被点名拒收）。 | C 组 S4 |
| 12 | **E-01 / N3 / N4** | P2 / P2 / P3 | **不变**：E-01 读侧归属门未被本包触动（appendLedger objectId 路径 `#assertScope` 在位，kernel.ts:1262-1267）；N3（raw DML 伪造数据行/见证列）界内不变——本席全部伪造审计实验正是其复钉；N4=33 红基线逐等维持，无一消失无一新增。 | 各处 |
| 13 | **「只报不阻」计数器统一建议（父席③）** | — | 统一修法（比逐个加测试有用）：`auditRequiredIntegrity()` 每次运行**落一条机制事件**（新预留名 `integrity-audit-recorded`，机制内部专属落账，payload=计数快照 + 幽灵/漂移目标集的摘要），把「一次性回声」变成**可回看的持久记录**；读侧遮蔽计数（`hiddenByContractSkew` 等）在连续 N 次读出现非零时同样落一条。归属裁定：这正是 1c 的 deny-by-default 必须先生效的场景——新机制名必须走封闭名单，不能又是一个默认可写的字符串。 | 综合 |
| 14 | **BARE_PRAGMA_READ 类目（独立成行，父席②点名）** | 本包新面 | **P2：假文档 + 假边界，无 durability 实伤（实测定级）**。宣称（:494-496 与 :603-604）：「PRAGMA 裸读形……只读连接态」「读不改状态，写才改」——**不实**：`pragma optimize`（VACUUM+ANALYZE）与 `pragma wal_checkpoint` 是**无参写副作用**形，被 `BARE_PRAGMA_READ`（:606）当「裸读」放行（G6A-A5-2 实测：wal_checkpoint 返回 busy/log/checkpoint 三元组、optimize 执行并返回行）。**durability 面逐形实测全拦**：`journal_mode`/`synchronous`/`locking_mode`/`query_only`/`writable_schema`/`foreign_keys` 的赋值形（`=`、空格、函数形、`main.` 前缀形）全部 `RAW_SQL_REFUSED`；裸词形 `journal_mode`/`synchronous` 实测纯读（返回值、不改状态）⇒ 无「改出 durability 洞」的可达形。定级 P2（不是 P1）；修法：常量更名 `PRAGMA_FUNCTIONLESS_PASSTHROUGH`、注释改「无参透传形（含写副作用者）」、放行集收紧为查询形白名单（草案见附录 C 末）。 | g6a A5-1/2 |
| 15 | **重建文件 `sqlite-port.ts` 逐行复核** | 自述「未经逐行独立审查」 | **有条件可信**。逐 hunk 裁定见第 ④ 节：18 条触发器 + 打开判据序 + 双守卫 + translate/水位/OID 面，行为与注释宣称逐条对上（A1–A4 共 22 例独立取证全绿，含六触发器一字改体全红 + respace 不误伤 + 注释字节参与摘要）；**不符点两处**：① #14 假文档（P2）；② `expectedTriggerDigests` 与 SCHEMA 同源（:322-331，登记上限，非回归——残余句必须入 CONTRACTS，见 ④）。「条件」= ①②修复/登记前，不得把重建文件当作已终审资产引用。 | ④ 全文 |

---

## ② 攻击矩阵（结果一览；全文见附录 A）

### A1 NULL / 三值逻辑（逐触发器）
| 形态 | 期望 | 实测 |
|---|---|---|
| `meta.value` 插 NULL | NOT NULL 拦 | ✅ `NOT NULL constraint failed`（:17 列定义兜住三值面） |
| `meta` UPDATE 相等 | 放行（只禁减） | ✅ |
| `meta.key` NULL 键（TEXT-PK 可空怪癖，父席点名） | 可插且互不冲突；REPLACE 撞不出唯一；DELETE 不撞 ledger_seq 支；UPDATE 仍受单调判据（行级与键无关） | ✅ 全形钉（A1-2） |
| `route_insert_guarded` enabled NULL | 无此形（列 NOT NULL）；显式 changed_seq=NULL 是唯一合法登记形 | ✅ |
| `directory_birth_audited` created_seq 撞既有出生账但 object_id 不符 | 拒（`object_id = new.oid` 判据在位） | ✅ |
| 空账本窗口出生 | 放行（:70 登记界复钉）；账本非空判据是 EXISTS 全表 ⇒ **跨空间语义在 PoC 单空间恒真** | ✅（登记面） |

### A2 route_change_guarded 六 witness 子句绕过矩阵
| 形态 | 期望 | 实测 |
|---|---|---|
| `authorized` 取值域：JSON true / 1 过；'1' / 'true' / 0 / false / 无见证 / 坏 JSON | 闸语义=JSON 真值 1 | ✅（A2-1：true 与 1 同形通过——与机制行一致） |
| 见证轴=space-write / capability=别的能力 / actor NULL | 全拒 | ✅（G27-C 复钉） |
| actor=别人的真实 principal | 过闸（闸只查非空） | ✅ → #1b |
| 事件名大小写 / 尾空白变体 | 全拒（binary collation，无洗白通道） | ✅（A2-3） |
| 翻转配错名 / 三元组配错名 | 拒 | ✅ |
| 翻转+三元组联合只配 enabled 名 | — | **过闸** → #1a |
| 重复 JSON 键 `{"capability":"<对>","capability":"<错>"}` | — | **取左值过闸**（json_extract 语义，伪造方控制判据读到的值）→ F-G6A-8 |
| 同戳复用 / 不写戳 | 单调性支必红 | ✅ 双形 `ROUTE_CHANGED_SEQ_MONOTONICITY`（戳无法绕过） |

### A3 ST-E 一字自证（六条触发器，ST-E 只做过一条）
`route_no_delete`（消息+1 字）/ `route_insert_guarded`（`<>`→`>`）/ `route_change_guarded`（`<=`→`<`，真·一字）/ `directory_no_delete` / `directory_birth_audited`（`=`→`>`）/ `meta_ledger_seq_no_delete`（`=`→`>`）⇒ **六条重开全红且 `alteredTriggers` 点名**；respace 同体异形**不误伤**；**体内注释改一字也红**（摘要覆盖面比语义面宽——误杀方向，如实登记，:128 那行注释参与字节面）。

### A4 水位/计数面
ghost 号前跳重开放行（登记面复钉）/「删最大 seq 行」显式+REPLACE 两路全灭/水位 REPLACE 归零红 + detail 逐形/`id_counter` DELETE 撞 OID 判据（detail `idCounter:0, maxExistingOidSuffix`）/`schema_version` 下调撞单调——全部与 :22-24、:408-417 宣称逐条对上。

### A5 guardRawBoundary 三分法之外
| 形态 | 结果 | 定性 |
|---|---|---|
| `SAVEPOINT`/`RELEASE`（清单无此词） | **放行**（事务控制同族；`begin immediate` 形同族放行是 ST-D 既定） | P4 登记 |
| `VACUUM INTO` / `ANALYZE` / `CREATE VIRTUAL TABLE` / `ATTACH--c…`（注释夹缝） | 全拒（剥注释 + 头部词表） | ✅ |
| `insert into sqlite_master` | 驱动墙 `may not be modified` | ✅ |
| `select 'a; b'`（**字符串字面量内分号**） | **误拒**（多语句判据 `;/\s*\S/` 进字面量） | 误杀方向，登记 F-G6A-9 |
| `pragma optimize` / `pragma wal_checkpoint` | **放行**（写副作用） | → #14 P2 |
| journal_mode/synchronous/…赋值全形 | 全拦 | ✅（durability 无实伤的依据） |

### B 组（P1 复攻）与 C 组（门禁变异）
见裁定表各行「依据」列——B 组 10 例全绿（含 PK 改名完整链、历史面夹具链）；C 组 S1（作者流洗白链）、S2/GT-3、S3/GT-2、S4/N5 全部复现，变异文件全部 RESTORE-OK 双验。

---

## ③ 新发现（severity + 复现 + 修前/修后状态）

| id | 级别 | 发现 | 复现 | 修前（若无本包）→ 现状 |
|---|---|---|---|---|
| F-G6A-1 | **P3**（界内，独立行 #2） | PK 改名+INSERT 新生行 = 停用复活且**零启用审计**；方向判据③名单不含主键 | g6b D27-4 | 修前：一条 `replace into` 零审计复活（D-27 原洞）→ 现状：复活仍可达但需 1 条伪造见证审计 + 2 条语句，痕迹=墓碑行；审计面看不出复活 |
| F-G6A-2 | P4 | 子句③联合形漏检（翻转+三元组只配 enabled 名） | g6a A2-4 | 修前无从谈起（闸不存在）→ 现状：漏检在两支之间，不在支内 |
| F-G6A-3 | P4（独立行 #1b） | actor 只核非空，别人的名字照写 | g6a A2-3 | G27-C 钉了 NULL 形；「核 actor」表述失实由本席补齐 |
| F-G6A-4 | **P2**（独立行 #14） | `BARE_PRAGMA_READ` 类目名+文档失实：optimize/wal_checkpoint 写副作用当「裸读」放行 | g6a A5-2 | 包 6 新建面；durability 开关全拦故非 P1 |
| F-G6A-5 | **P2→P1 升级注记**（独立行 #3a） | 历史面：v6 库靠版本墙顺住非检出；v7 库内漂移零检出零救济；version 对齐后即零声纳 | g6b D31-2/3 + 附录 C | 修前：合法移交直接造漂移（D-31）→ 现状：入口封死，存量无面 |
| F-G6A-6 | **结构性（G1）** | 事件名预留=deny-by-exception；机制在写的 `object-revised`/`record-backfilled` 不在名单 | g6b D27-3 | 恒真；本包把「预留」当完成态表述时未含此面 |
| F-G6A-7 | P4 观察 | 遮蔽/幽灵计数一过性回声、合法流量可淹没、零持久工件 | g6b D24-1 | 包 6 引入可见化时未连带持久面（建议 #13） |
| F-G6A-8 | P4 | 重复 JSON 键取左值 ⇒ 伪造方控制 witness 判据读到的值 | g6a A2-5 | SQLite 语义，界内；登记即可（闸与 json 层之间无规范化） |
| F-G6A-9 | P4（误杀向） | 多语句判据在字符串字面量内命中分号 ⇒ 合法单语句被拒 | g6a A5-1 | 误杀方向安全，与「宁误杀不漏放」同族，登记 |
| F-G6A-10 | P4 | SAVEPOINT/RELEASE 不在词表（事务控制同族放行） | g6a A5-1 | 与 begin/commit 放行同裁定；无独立危害（DML 仍受触发器） |
| F-G6A-11 | 如实登记 | 触发器**体内注释文本**参与摘要（改注释一字=重开红） | g6a A3-7 | 覆盖面>语义面，误杀方向；作者注释未宣称「注释可自由改」，不算失实 |
| F-G6A-12 | 门禁残余（维持） | GT-2/GT-3/N5 三通道全部复现（① 节 #9/#10/#11）；另补：attacks 基线无 `--reanchor` 护栏（重算通道比锚通道更无「当前不干净拒写」防线） | S2–S4 | 均为登记残余的实证更新，非新回归 |

**逐发现「修前/修后」总则**：F-G6A-1/2/3/8 只在包 6 的闸存在后才有意义（修前是更大的洞）；F-G6A-4/5/6/7/11 是本包新面或结构性面的如实定性。

---

## ④ 重建文件 `sqlite-port.ts` 逐 hunk 裁定（647 行；行号 = 398df30）

> 逐行复核 + A1–A4 共 22 例独立取证。每 hunk 给「意图（注释/宣称）vs 判据（实际行为）」裁定。

| hunk | 行 | 意图 | 判据 | 裁定 |
|---|---|---|---|---|
| meta 表 | :17 | key TEXT PK 可空怪癖未声明 | NULL 键行可插、互不冲突（A1-2） | ✅ 无害（`meta_ledger_seq_no_delete` 的 `old.key='ledger_seq'` 判据对 NULL 键行不触发=如实，行级 UPDATE 单调与键无关） |
| meta 计数触发器 ×2 | :22-31 | 三计数只增不减；归零两式各撞 DELETE/UPDATE 触发器；ghost 前跳与合法发号不可分辨（登记） | 全对上：等值 UPDATE 放行、减红、DELETE ledger_seq 行红、REPLACE 归零隐式删红（A1-1/A4-3） | ✅ 意图=判据 |
| ledger 表 + 两禁 | :32-50 | append-only；REPLACE 全灭依赖 recursive_triggers | 显式 DELETE 一切连接红（A4-2，纠正前席口头理解） | ✅ |
| object_directory + 三触发器 | :55-79 | 身份行禁改禁删；新身份必须随账出生；空账本窗口豁免（登记） | birth 判据 `seq=created_seq ∧ event='object-registered' ∧ object_id=new.oid` 三条件实测各自咬合（A1-4 含 object_id 不符形） | ✅ |
| capability_route 表 | :86-89 | — | enabled NOT NULL；changed_seq 可空 | ✅ |
| route_no_delete | :90-92 | REPLACE 隐式删全灭 | recursive_triggers=ON 下实测 REPLACE 撞（Port 连接） | ✅ |
| route_insert_guarded | :93-97 | INSERT 只接受登记形（enabled=1、无戳）；「INSERT 伪造不出已审计」 | 判据对：`new.enabled<>1 or new.changed_seq is not null` ⇒ 三值面无洞（列 NOT NULL） | ⚠️ 意图=判据，但**判据的覆盖面缺口**即 F-G6A-1（新生行零审计是设计，被改名链利用——缺口在方向判据，见下行） |
| 变更三判据注释 | :98-115 | ①戳单调 ②审计随附（六 witness 子句）③方向一致；诚实边界自述（裸面连见证伪造可过） | ①②③逐子句矩阵全对上（A2-1..4）；诚实边界如实（G27-C + A2-3 复钉） | ⚠️ ③ 的意图是「启停/移交只能经审计」，判据只列三元组 + enabled——**主键改名在意图内、判据外**（F-G6A-1）；② 的 actor 意图表述=「非空」正确，但对外沟通表述「核 actor」失实（#1b） |
| route_change_guarded 体 | :116-148 | 同上三支 | 逐字节与宣称一致；体内注释 :128 参与摘要（A3-7） | ✅（一字变异 `<=→<` 重开红点名） |
| migrateLegacyRecords | :223-259 | 只回填 records，不修版本不修触发器 | 实测对 v6 漂移库跑完仍拒开（#3a） | ✅（它本不承担救济职责；「救济面为空」是裁定不是指控） |
| SCHEMA_VERSION/REQUIRED_TRIGGERS | :292-297 | 版本+名集完整性 | 33 红基线 + 打开路径复钉 | ✅ |
| 摘要诚实边界注释 | :316-319 | 自述「字节级同体重建在承诺盲区」 | 与 A3 结论一致 | ✅ |
| **normalizeTriggerSql + expectedTriggerDigests** | **:320-331** | 「摘要期望由模块加载时的 SCHEMA 基准库算得（唯一正源）」 | 判据对**库内漂移**有效（六条一字全红）；对**源码漂移**真空：期望与 SCHEMA 同源 ⇒ 从 SCHEMA 删触发器定义，`expected===undefined ⇒ continue`（:436）+ 名判据用 REQUIRED_TRIGGERS——**须同时删两处**才 vacuous，而删 SCHEMA 不删名 ⇒ 新库 missingTriggers 拒开（fail-loud，好方向） | ⚠️ **登记上限**（与作者 :316-319 自述一致，非隐瞒）。**必须落 CONTRACTS 残余句**：「从 SCHEMA 源码删触发器定义（连同 REQUIRED_TRIGGERS 名单项）这一形态**只被 tests/**（files_sha 身份锚）+ 重锚 挡住；digest 判据对它是设计外真空」。修法方向（G1）：基准期望外置（锚文件记 digest 而非从 SCHEMA 现算）即闭环。 |
| connect pragmas | :346-356 | WAL + foreign_keys + **recursive_triggers=on**（注释解释包 4 教训） | A4-2 实证 REPLACE 隐删在该连接撞触发器=pragma 生效 | ✅ |
| 打开判据序 | :380-460 | 表→版本→OID→**水位**→缺名→**改体**→records 遗留 | 顺序与 detail 逐项复钉（A4-3/4：水位 detail 双值、OID detail 双值、schema_version 下调在触发器层先撞单调——判据序意图「打开路径一个字节不写」维持） | ✅ |
| 水位判据 | :408-417 | `max(seq)≤watermark` 违例拒开；ghost 不可分辨如实 | A4-1 放行形与注释「合法形态恒满足 ≤」严格一致 | ✅ |
| 改体摘要判据 | :429-446 | 同名空壳/改体点名 | 六触发器 ST-E 全红；respace 不误伤；注释字节参与（误杀方向） | ✅（真空见 :320-331 行） |
| raw() doc | :490-501 | 守卫二选一裁决 + 「裸读形只读连接态」「读不改状态，写才改」 | **后两句失实**（optimize/wal_checkpoint） | ❌ **不符点①**（#14，P2 假文档） |
| translate | :510-527 | 驱动错误→机制码；errcode 19 且命中 `ledger.seq` ⇒ LEDGER_SEQ_CONFLICT（提交期撞号可判定） | ST-B 复钉：commit() 路径翻译在位；prepare() 不经此译=与宣称「提交期」一致 | ✅ |
| **BARE_PRAGMA_READ** | **:606** | 名实=「裸读形豁免」 | 实为「无参透传形豁免」（含写副作用） | ❌ **不符点①** 的机制侧：建议更名 `PRAGMA_FUNCTIONLESS_PASSTHROUGH` + 白名单收紧（附录 C） |
| guardRawBoundary | :607-625 | 拒 DDL/PRAGMA 赋值/多语句；DML 放行到触发器「不得截胡」 | A5-1/2 全矩阵对上；分号进字面量误杀（F-G6A-9）；SAVEPOINT 词表外放行（F-G6A-10）；「误杀方向安全」宣称成立 | ✅（登记面内） |
| guard（机制句柄） | :627-647 | DDL/PRAGMA + REPLACE/upsert + 多语句 | N9/D-30 锚复钉（ST-D 三分法语义未回归） | ✅ |

**逐 hunk 小结**：19 个 hunk 中 15 ✅、3 ⚠️（:93-97/:98-115 指向 F-G6A-1 判据覆盖缺口；:320-331 登记上限）、1 ❌（:490-501+:606 假文档 P2）。**重建未引入行为回归**——所有 18 条触发器、双守卫、打开判据序的行为与宣称及 g5a 作者测试相互印证；本席两条 ❌/⚠️ 均是「宣称面 > 判据面」型问题，不是数据面失守。

---

## ⑤ 未验证清单（如实）

1. **字节级同体重建**（持裸面原样抄回触发器体）：仍在承诺盲区（:316-319 自述，本席复认）——本席 ST-E 钉的是「改一字必红」，不是「重写的等价性」。
2. **:436 `expected === undefined ⇒ continue` 的源码删定义路径**：需编辑 `src/**` 才能实跑，本席禁改源码——以代码路径推理 + 双常数同删分析登记（④ :320-331 行），非实跑证据。
3. `migrateLegacyRecords` 的**正路径**（v6 前 records-less 库回填正确性）：非本席任务面，只验证了它对版本墙/漂移「不可救济」。
4. 真**跨空间**语义（birth-audit 的 EXISTS 全表判据在多空间下的行为）：PoC 单空间恒真，已钉形未钉多空间。
5. WAL 文件层篡改（绕过 `DatabaseSync` 直接改 `-wal`/`-shm`）：属裸文件运维界（:497 自述「不在任何承诺内」），未做。
6. 多进程并发（WAL busy/timeout 面）：非本席任务面。
7. C 组门禁实验跑在**重算临时基线**上（因本席新攻击文件必然令真基线 [3/3] 报新增）——GT-2/N5 结论对真基线同样成立（真基线只是多加一条「新增通过」FAIL 行，与实验判定正交）；本席以 S1a（真锚 FAIL）证明判定面未失真。

---

## 终态门禁原文

```
[1/3] 类型门（含作者 tests，不含 attacks/**）
  OK
[2/3] 作者测试门（tests/**，0 红是硬条件）
  OK —— 207 例全绿，与身份锚四项逐等（passed/total/passed_sha/files_sha；skip=0，exit=0，success=true）
[3/3] 审查方基线门（attacks/**：多一条要查，少一条也要查）
  OK —— 与基线完全一致（33 条已知红，均已定性）

[g0-gate] FAIL
 - 审查方收集总数 165 ≠ 基线 133：有文件没被收集或凭空多出一份
 - 审查方新增通过 32 条（覆盖面变大，须显式入基线）：
  （32 条 = 本席两文件全部用例，名集见附录 A 全文；0 新增红、0 红条消失、0 skip、0 loadErrors）
```

**读数（与 G5-A 收工同形）**：[1/3][2/3] 全等绿；33 条已知红逐等；FAIL 的唯一成因是本席攻击文件入场（133→165，新增 32 全绿）——这正是下一步重锚要逐条定性的清单。**32 条中 30 条是「边界钉形/攻击确认绿」，2 条是「登记面复钉绿」（A4-1 ghost 放行、A3-7 注释参与摘要）——无一为「洞被修复所以变绿」。**

**收尾声明**：`.scratch/wt-g6a`、`.scratch/wt-g6a-p5` 两个 worktree 已 `git worktree remove --force`；主树除本报告外零改动（`git status` 干净，`.scratch/` 本身 gitignored）；变异文件恢复均经 `git hash-object` == `git rev-parse HEAD:<path>` 双验。

---

## 附录 C（前置小件）

### C.1 p5 历史库夹具配方（可重跑，产出即 F-G6A-5 的证据）
在 `d578208` 的 worktree 内落一个临时 vitest 文件（跑完删除）：
```ts
test('build p5 drift fixture', () => {
  const w = openWorld({ file: join(POC_DATA_DIR, 'g6a-p5-drift.db'), space: 'SP-P5',
    grants: { 'p5-admin': ['space-write', 'capability-admin'] }, plugins: [TEST_OBJECT_MODEL, TEST_RECORDS] });
  w.uow(ADM, (tx) => tx.createObject({ kind: 'test.claim', payload: { v: 'real' } }));
  w.transferCapability(CAP_OBJECT_MODEL,
    { ...TEST_OBJECT_MODEL, pluginId: 'test.object-model.v2', storageNamespace: 'dom_test_om_v2' }, ADM);
  w.close();
});
```
实测输出：`dir: [{"oid":"OBJ-SP-P5-1","ns":"dom_test_om"}]`；`route: [{"capability":"cap.test.object-model","ns":"dom_test_om_v2","enabled":1,"changed_seq":2}]`；`schema_version: 6`。**漂移由合法通道产生，全程未碰裸 SQL。**

### C.2 BARE_PRAGMA_READ 修法草案
- 更名：`BARE_PRAGMA_READ` → `PRAGMA_FUNCTIONLESS_PASSTHROUGH`；注释（:494-496、:603-604）「只读连接态/读不改状态」改「无参透传形——其中部分形有写副作用（optimize/wal_checkpoint），放行的是『不可改连接态不变量』而非『只读』」。
- 白名单草案（只放行确定无写副作用的查询形）：`journal_mode | synchronous | user_version | schema_version | data_version | integrity_check | foreign_key_check | table_info | compile_options | module_list | page_count | freelist_count`；**排除**：`optimize`、`wal_checkpoint`、`journal_mode=<任何赋值>`、`foreign_keys(<表>)` 函数形（写副作用存疑者一律拒，宁可误杀）。
- 若维持现放行集：至少在 g5a ST-D 补一条「optimize/wal_checkpoint 属界内可执行形」的钉形断言，让文档与行为重新对齐。

### C.3 必须进 CONTRACTS 的两句（本席建议原文）
1. 「触发器摘要判据的期望值与 `SCHEMA` 常量同源：**从 SCHEMA 源码删除触发器定义（连同 `REQUIRED_TRIGGERS` 名单项）这一洗白形态，仅由 `tests/**` 的 files_sha 身份锚 + 显式重锚挡住**，digest 机制对其为设计外真空（登记上限，与重建文件 :316-319 自述同界）。」
2. 「机制审计事件名的预留策略当前为 **deny-by-exception（名单外事件名默认可写）**：机制自身在写的 `object-revised`、`record-backfilled` 不在预留名单，任何未来新增机制审计名若不同步入名单，即落入可被通用台账 mint 的默认域。改 deny-by-default 或机验名单/写点共生之前，『机制审计名不可伪造』只对名单内五名成立。」

---

## 附录 A — 攻击文件全文

以下两文件是本席全部 32 例攻击（sha256 见下），跑位 `attacks/review/`；随 worktree 移除，全文以本附录为存续形态。
`5fb69e4ecc53769d3587a6ccd9c14685d9175b192ec59cf1b5411ecfaad8b97f  g6a-storage-forensics.test.ts`
`77aedd9581109fc15085bbad37ee185c3c7d3e572c36ca4b9558d7d85ced67f3  g6b-reacttack-p1.test.ts`

### A.1 g6a-storage-forensics.test.ts
```ts
/**
 * G6-A（席位 G6-A @398df30）——重建文件 `sqlite-port.ts` 取证复攻（任务 A1–A5）。
 *
 * 判定词汇沿用前席：**绿 = 攻击假设成立（登记面复钉/新形态钉形）或兜底成立（判据真拦住）**。
 * 覆盖：
 *  A1 七触发器 NULL 形与三值逻辑（含 meta.key 的 TEXT-PRIMARY-KEY 可空怪癖）；
 *  A2 `route_change_guarded` 六见证子句的可绕性矩阵（actor=他人 principal / 别能力见证 /
 *     authorized 字符串与布尔 / 事件名大小写与空白 / 重复 JSON 键 / 方向判据联合形）；
 *  A3 体摘要判据：除 `meta_counter_monotonic`（作者 ST-E 已自证）外**其余六条各做一次
 *     一字自证**——改了不红 = 该触发器不在摘要覆盖面（判据漏表）；
 *  A4 水位判据两形：ghost 号前跳（水位抬高、行不写）与「只删最大 seq 行」；
 *  A5 `guardRawBoundary` 三分法之外的形态：SAVEPOINT 系 / VACUUM INTO / PRAGMA journal_mode
 *     读与写 / 空格赋值形 / ANALYZE / CREATE VIRTUAL TABLE / ATTACH 注释形 / sqlite_master
 *     直写 / **无参写副作用 PRAGMA（optimize、wal_checkpoint）被"裸读形"名义放行**。
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
import { Refusal } from '../../src/contracts/index.ts';
import { asOid, type ObjectOid } from '../../src/contracts/index.ts';

const ADM = PRINCIPAL('g6aadm');
const NOBODY = PRINCIPAL('g6anobody'); // 只有 space-write
const GRANTS = {
  g6aadm: ['space-write', 'capability-admin', 'domain-admission'],
  g6anobody: ['space-write'],
};
let dir: string;
beforeAll(() => { dir = mkdtempSync(join(POC_DATA_DIR, 'g6a-forensics-')); });
afterAll(() => { rmSync(dir, { recursive: true, force: true }); });

const open = (name: string): World =>
  openWorld({ file: join(dir, `${name}.db`), space: 'SP-G6AF', grants: GRANTS, plugins: [TEST_OBJECT_MODEL, TEST_RECORDS] });
const outcome = (fn: () => unknown): string => {
  try { fn(); return 'NO_REFUSAL'; }
  catch (e) {
    const err = e as { code?: unknown; message?: unknown };
    if (typeof err?.code === 'string' && err.code !== 'ERR_SQLITE_ERROR') return err.code;
    return String(err?.message ?? e);
  }
};
const refusal = (fn: () => unknown): { code: string; detail: Record<string, unknown> } => {
  try { fn(); return { code: 'NO_REFUSAL', detail: {} }; }
  catch (e) {
    if (e instanceof Refusal) return { code: e.code, detail: e.detail as Record<string, unknown> };
    return { code: 'BARE_ERROR', detail: { message: String((e as Error).message).slice(0, 100) } };
  }
};
const routeRow = (w: World, cap = CAP_RECORDS) =>
  w.raw.get<{ enabled: number; changed_seq: number | null; plugin_id: string; ns: string; contract_version: string }>(
    `select enabled, changed_seq, plugin_id, ns, contract_version from capability_route where capability=?`, cap,
  )!;
/** 承诺外域执行器（手工裸连接：默认 recursive_triggers=OFF）。 */
const outside = (name: string, fn: (db: DatabaseSync) => void): void => {
  const db = new DatabaseSync(join(dir, `${name}.db`));
  try { fn(db); } finally { db.close(); }
};

// ─────────────────────────────────────────────────────────────────────────────
describe('A2 route_change_guarded 见证子句矩阵（G27 族之外另辟形态；经 raw = 已登记界内，判据行为取证）', () => {
  /** 播种：真停用（真审计+真见证在位），随后逐形尝试复活。 */
  const seeded = (name: string): World => {
    const w = open(name);
    w.unloadCapability(CAP_RECORDS, ADM);
    return w;
  };
  const forgedStamp = (w: World, a: {
    event: string; actor: string | null; payload: unknown; basis: string | null;
  }): number => {
    const s = w.ledgerHead() + 1;
    w.raw.run(
      `insert into ledger(seq, space, event_type, actor, authority_basis, payload_json, described_at, recorded_at)
       values(?,?,?,?,?,?,null,?)`,
      s, 'SP-G6AF', a.event, a.actor, a.basis, JSON.stringify(a.payload), Date.now(),
    );
    // 伪造行用了 head+1 号 ⇒ 水位同步步进（否则重开水位判据先红，摸不到路由闸）
    w.raw.run(`update meta set value = ? where key='ledger_seq'`, s);
    return s;
  };
  const tryRevive = (w: World, s: number): string =>
    outcome(() => w.raw.run(
      `update capability_route set enabled=1, changed_seq=? where capability=?`, s, CAP_RECORDS,
    ));
  const goodBasis = (cap = CAP_RECORDS, authorized: unknown = true): string =>
    JSON.stringify({ axis: 'capability-admin', capability: cap, authorized });

  test('G6A-A2-1 authorized 取值域：JSON true/1 过闸（与机制行同形）、字符串 "1"/"true" 与 false 均拒——闸语义=JSON 真值 1', () => {
    const w = seeded('a2-authorized');
    try {
      // 全部拒形先行（不改动路由，可同库连试）
      for (const bad of ['1', 'true', 0, false, null]) {
        const s = forgedStamp(w, {
          event: 'capability-enabled', actor: 'someone',
          payload: { capability: CAP_RECORDS }, basis: goodBasis(CAP_RECORDS, bad),
        });
        expect(tryRevive(w, s), `authorized=${JSON.stringify(bad)} 不得过闸`).toBe('ROUTE_AUDIT_REQUIRED');
      }
      expect(routeRow(w).enabled).toBe(0);
      // 真值形过闸 = 已登记的"必须在见证列撒谎"界（G27-C 同族，这里钉的是取值域形状）
      const s = forgedStamp(w, {
        event: 'capability-enabled', actor: 'someone',
        payload: { capability: CAP_RECORDS }, basis: goodBasis(CAP_RECORDS, 1), // JSON 数字 1
      });
      expect(tryRevive(w, s)).toBe('NO_REFUSAL');
      expect(routeRow(w).enabled).toBe(1);
    } finally { w.close(); }
  });

  test('G6A-A2-2 见证必须钉在被改能力上：axis 非 capability-admin、capability 属别能力、无/坏 JSON 见证、actor NULL 全拒', () => {
    const w = seeded('a2-basis');
    try {
      const cases: Array<[string, string | null, string | null]> = [
        ['别能力见证', 'someone', goodBasis('cap.other.not.routed')],
        ['axis 漂移', 'someone', JSON.stringify({ axis: 'space-write', capability: CAP_RECORDS, authorized: true })],
        ['见证缺 capability 字段', 'someone', JSON.stringify({ axis: 'capability-admin', authorized: true })],
        ['见证非法 JSON', 'someone', '{axis'],
        ['无见证', 'someone', null],
        ['真见证但 actor NULL', null, goodBasis()],
      ];
      for (const [label, actor, basis] of cases) {
        const s = forgedStamp(w, { event: 'capability-enabled', actor, payload: { capability: CAP_RECORDS }, basis });
        expect(tryRevive(w, s), label).toBe('ROUTE_AUDIT_REQUIRED');
      }
      expect(routeRow(w).enabled).toBe(0);
    } finally { w.close(); }
  });

  test('G6A-A2-3 actor 是别人的 principal 照过闸（闸只查非空）；事件名大小写/空白变体在 in(...) 名单外必拒（binary collation，无洗白通道）', () => {
    const w = seeded('a2-name');
    try {
      // 名字变体全拒（fail-closed；同时证明预留/闸两侧都是 binary 判据，没有大小写洗白面）
      for (const name of ['CAPABILITY-ENABLED', ' capability-enabled', 'capability-enabled ', 'capability_enables']) {
        const s = forgedStamp(w, {
          event: name, actor: 'someone', payload: { capability: CAP_RECORDS }, basis: goodBasis(),
        });
        expect(tryRevive(w, s), `事件名 ${JSON.stringify(name)} 不得过闸`).toBe('ROUTE_AUDIT_REQUIRED');
      }
      expect(routeRow(w).enabled).toBe(0);
      // actor 冒充：见证钉对了能力，actor 写任何主体（包括真实管理员的 actorId）都过闸
      const s = forgedStamp(w, {
        event: 'capability-enabled', actor: 'g6aadm', // 冒充真管理员的 actorId
        payload: { capability: CAP_RECORDS }, basis: goodBasis(),
      });
      expect(tryRevive(w, s)).toBe('NO_REFUSAL'); // 登记界：痕迹里 actor 完全自由
      expect(routeRow(w).enabled).toBe(1);
    } finally { w.close(); }
  });

  test('G6A-A2-4 方向判据（子句③）逐形：翻转配错名拒、三元组配错名拒、**翻转+三元组联合只配 enabled 名过闸**（子句③对联合形漏检，P4 钉形）', () => {
    const w = seeded('a2-direction');
    try {
      const r0 = routeRow(w);
      // 翻转 0→1 只配 disabled 名 ⇒ 拒
      let s = forgedStamp(w, { event: 'capability-disabled', actor: 'x', payload: { capability: CAP_RECORDS }, basis: goodBasis() });
      expect(tryRevive(w, s)).toBe('ROUTE_AUDIT_REQUIRED');
      // 翻转 0→1 只配 transferred 名 ⇒ 拒
      s = forgedStamp(w, { event: 'capability-transferred', actor: 'x', payload: { capability: CAP_RECORDS }, basis: goodBasis() });
      expect(tryRevive(w, s)).toBe('ROUTE_AUDIT_REQUIRED');
      // 只改三元组（enabled 不动）配 enabled 名 ⇒ 拒
      s = forgedStamp(w, { event: 'capability-enabled', actor: 'x', payload: { capability: CAP_RECORDS }, basis: goodBasis() });
      expect(outcome(() => w.raw.run(
        `update capability_route set plugin_id='test.object-model', changed_seq=? where capability=?`, s, CAP_RECORDS,
      ))).toBe('ROUTE_AUDIT_REQUIRED');
      // 只改三元组配 transferred 名 ⇒ 过（机制正向形）；enabled 保持停用态
      s = forgedStamp(w, { event: 'capability-transferred', actor: 'x', payload: { capability: CAP_RECORDS }, basis: goodBasis() });
      expect(outcome(() => w.raw.run(
        `update capability_route set plugin_id='test.object-model', changed_seq=? where capability=?`, s, CAP_RECORDS,
      ))).toBe('NO_REFUSAL');
      expect(routeRow(w).enabled).toBe(0);
      // **联合形**：enabled 翻转 + 三元组同时改，只配 'capability-enabled' 名 ⇒ 过闸——
      // 子句③第一支只按 enabled 判名字，移交语义（transferred）被联合形吞掉。留痕=一条 enabled 事件。
      s = forgedStamp(w, { event: 'capability-enabled', actor: 'x', payload: { capability: CAP_RECORDS }, basis: goodBasis() });
      expect(outcome(() => w.raw.run(
        `update capability_route set enabled=1, plugin_id='evil.pkg', ns=?, contract_version='v9', changed_seq=? where capability=?`,
        r0.ns, s, CAP_RECORDS,
      ))).toBe('NO_REFUSAL');
      const r1 = routeRow(w);
      expect([r1.enabled, r1.plugin_id, r1.contract_version]).toEqual([1, 'evil.pkg', 'v9']); // 联合形全写入
    } finally { w.close(); }
  });

  test('G6A-A2-5 重复 JSON 键取**左值**（判据读 payload/见证的第一个键——伪造方控制）；changed_seq 不步进必撞单调性', () => {
    const w = seeded('a2-dupkey');
    try {
      // payload 第一个键对上、第二个键是别的：json_extract 返回左值 ⇒ 过闸（判据语义钉形）
      const s = (() => {
        const st = w.ledgerHead() + 1;
        w.raw.run(
          `insert into ledger(seq, space, event_type, actor, authority_basis, payload_json, described_at, recorded_at)
           values(?,?,?,?,?,?,null,?)`,
          st, 'SP-G6AF', 'capability-enabled', 'x', goodBasis(),
          `{"capability":"${CAP_RECORDS}","capability":"other.thing"}`, Date.now(),
        );
        w.raw.run(`update meta set value = ? where key='ledger_seq'`, st);
        return st;
      })();
      expect(tryReviveAt(w, s)).toBe('NO_REFUSAL');
    } finally { w.close(); }
    // 单调性：戳不前进（同戳重复用）必红
    const w2 = seeded('a2-monotonic');
    try {
      const cur = routeRow(w2).changed_seq!;
      expect(outcome(() => w2.raw.run(
        `update capability_route set enabled=1, changed_seq=? where capability=?`, cur, CAP_RECORDS,
      ))).toContain('ROUTE_CHANGED_SEQ_MONOTONICITY'); // 同戳复用撞单调性支
      expect(outcome(() => w2.raw.run(
        `update capability_route set enabled=1 where capability=?`, CAP_RECORDS,
      ))).toContain('ROUTE_CHANGED_SEQ_MONOTONICITY'); // 不写戳：new=old（非空）同撞单调性支——戳无法绕过
    } finally { w2.close(); }
  });
});
function tryReviveAt(w: World, s: number): string {
  try { w.raw.run(`update capability_route set enabled=1, changed_seq=? where capability=?`, s, CAP_RECORDS); return 'NO_REFUSAL'; }
  catch (e) { const err = e as { code?: unknown; message?: unknown }; return typeof err?.code === 'string' ? err.code : String(err?.message ?? e); }
}

// ─────────────────────────────────────────────────────────────────────────────
describe('A1 NULL 形与三值逻辑（逐触发器构造；含 meta.key TEXT-PK 可空怪癖）', () => {
  test('G6A-A1-1 meta 列 NOT NULL 面：value 不得为 NULL；UPDATE 相等放行（单调只增不减语义如实）', () => {
    const w = open('a1-meta');
    try {
      w.uow(ADM, (tx) => tx.createObject({ kind: 'test.claim', payload: { v: 1 } }));
      expect(outcome(() => w.raw.run(`insert into meta(key, value) values('g6a_x', null)`)))
        .toContain('NOT NULL constraint failed');
      const cur = w.raw.get<{ value: number }>(`select value from meta where key='ledger_seq'`)!.value;
      expect(outcome(() => w.raw.run(`update meta set value = ? where key='ledger_seq'`, cur))).toBe('NO_REFUSAL'); // 相等合法（只禁减）
      expect(outcome(() => w.raw.run(`update meta set value = ? where key='ledger_seq'`, cur - 1)))
        .toContain('META_COUNTER_MONOTONICITY');
    } finally { w.close(); }
  });

  test('G6A-A1-2 meta.key TEXT-PK 可空怪癖：NULL 键行可插入且互不冲突（REPLACE 撞不出唯一）、DELETE 不撞 ledger_seq 支、UPDATE 仍受单调判据（行级，与键无关）', () => {
    const w = open('a1-nullkey');
    try {
      w.uow(ADM, (tx) => tx.createObject({ kind: 'test.claim', payload: { v: 1 } }));
      expect(outcome(() => w.raw.run(`insert into meta(key, value) values(null, 5)`))).toBe('NO_REFUSAL');
      expect(outcome(() => w.raw.run(`insert into meta(key, value) values(null, 7)`))).toBe('NO_REFUSAL'); // NULL 互不冲突
      expect(outcome(() => w.raw.run(`replace into meta(key, value) values(null, 9)`))).toBe('NO_REFUSAL'); // 再一条（隐删撞不到 key='ledger_seq'）
      const c = w.raw.get<{ c: number }>(`select count(*) c from meta where key is null`)!.c;
      expect(c).toBeGreaterThanOrEqual(3); // 怪癖钉形：NULL 键垃圾行可无限堆
      // DELETE 该键：WHEN old.key = 'ledger_seq' 对 NULL 求值为 NULL ⇒ 不触发（正确——它不是水位键）
      expect(outcome(() => w.raw.run(`delete from meta where key is null`))).toBe('NO_REFUSAL');
      // UPDATE 判据与键无关：NULL 键行的 value 下调同样撞单调触发器（行级判据不被 NULL 键旁路）
      w.raw.run(`insert into meta(key, value) values(null, 4)`);
      expect(outcome(() => w.raw.run(`update meta set value = 1 where key is null`))).toContain('META_COUNTER_MONOTONICITY');
      // 机制读面不受污染（按名取键）：head 照常
      expect(w.ledgerHead()).toBeGreaterThan(0);
    } finally { w.close(); }
  });

  test('G6A-A1-3 route_insert_guarded 的 enabled 判据无 NULL 形可钻（列 NOT NULL），changed_seq 显式 NULL 是唯一合法登记形', () => {
    const w = open('a1-insert');
    try {
      expect(outcome(() => w.raw.run(
        `insert into capability_route(capability, plugin_id, ns, contract_version, enabled) values('cap.g6a.x','p','ns','v1',null)`,
      ))).toContain('NOT NULL constraint failed'); // `new.enabled <> 1` 遇 NULL 不触发的通道被列定义堵死
      expect(outcome(() => w.raw.run(
        `insert into capability_route(capability, plugin_id, ns, contract_version, changed_seq) values('cap.g6a.x','p','ns','v1',null)`,
      ))).toBe('NO_REFUSAL'); // enabled 走 default 1 + changed_seq NULL = 登记形（activate 的合法形）
    } finally { w.close(); }
  });

  test('G6A-A1-4 directory_birth_audited：账本非空判据是 EXISTS 全表（**跨空间语义在 PoC 单空间恒真**）；created_seq 撞既有出生账但 object_id 不符 ⇒ 拒；空账本窗口放行（登记界复钉）', () => {
    const w = open('a1-birth');
    try {
      const oid = w.uow(ADM, (tx) => tx.createObject({ kind: 'test.claim', payload: {} })) as ObjectOid;
      const d = w.raw.get<{ created_seq: number }>(`select created_seq from object_directory where oid=?`, oid)!;
      // 借真出生账的 seq 给新 oid：seq 对、事件名对、object_id 不符 ⇒ 拒
      expect(outcome(() => w.raw.run(
        `insert into object_directory(oid, space, kind, owner_capability, ns, created_seq)
         values('OBJ-SP-G6AF-999','SP-G6AF','test.claim','cap.test-object-model','dom_test_om',?)`, d.created_seq,
      ))).toContain('DIRECTORY_IDENTITY_FROZEN');
      // 空账本窗口（登记的界外形状）：新库 ledger 空 ⇒ 出生判据不参判
      const file2 = join(dir, 'a1-birth-fresh.db');
      const port2 = new SqlitePort({ file: file2 });
      expect(outcome(() => port2.raw.run(
        `insert into object_directory(oid, space, kind, owner_capability, ns, created_seq)
         values('OBJ-SP-G6AF-1','SP-G6AF','test.claim','cap.whatever','ns_w',1)`,
      ))).toBe('NO_REFUSAL');
      port2.close();
    } finally { w.close(); }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('A3 体摘要一字自证（ST-E 只做过 meta_counter_monotonic；其余六条逐条补做——改了不红 = 判据漏表）', () => {
  const MUT: Array<[string, string]> = [
    // [触发器, 一字之差的变体体（`<>`→`>`、`=`→`>`、abort 词尾加一字符等）]
    ['route_no_delete',
      `create trigger route_no_delete before delete on capability_route
       begin select raise(abort, 'ROUTE_FROZEN2'); end;`],
    ['route_insert_guarded',
      `create trigger route_insert_guarded before insert on capability_route
       for each row when new.enabled > 1 or new.changed_seq is not null
       begin select raise(abort, 'ROUTE_SHAPE_FROZEN'); end;`],
    // 真·一字之差：单调性支 `<=` 删一个 `=`——同戳重复变更从必红变放行（审计可无限复用）
    ['route_change_guarded',
      `create trigger route_change_guarded before update on capability_route
       begin
         select case when old.changed_seq is not null
                      and (new.changed_seq is null or new.changed_seq < old.changed_seq)
                 then raise(abort, 'ROUTE_CHANGED_SEQ_MONOTONICITY') end;
         select case when not exists (
             select 1 from ledger l
              where l.seq = new.changed_seq
                and l.event_type in ('capability-enabled','capability-disabled','capability-transferred')
                and l.actor is not null
                and json_valid(l.payload_json)
                and json_extract(l.payload_json, '$.capability') = new.capability
                and l.authority_basis is not null
                and json_valid(l.authority_basis)
                and json_extract(l.authority_basis, '$.axis') = 'capability-admin'
                and json_extract(l.authority_basis, '$.capability') = new.capability
                and json_extract(l.authority_basis, '$.authorized') = 1)
                 then raise(abort, 'ROUTE_AUDIT_REQUIRED') end;
         select case
           when new.enabled <> old.enabled and not exists (
             select 1 from ledger l
              where l.seq = new.changed_seq
                and l.event_type = case new.enabled when 1 then 'capability-enabled' else 'capability-disabled' end)
             then raise(abort, 'ROUTE_AUDIT_REQUIRED')
           when new.enabled = old.enabled
            and (new.plugin_id <> old.plugin_id or new.ns <> old.ns or new.contract_version <> old.contract_version)
            and not exists (
             select 1 from ledger l
              where l.seq = new.changed_seq and l.event_type = 'capability-transferred')
             then raise(abort, 'ROUTE_AUDIT_REQUIRED')
         end;
       end;`],
    ['directory_no_delete',
      `create trigger directory_no_delete before delete on object_directory
       begin select raise(abort, 'DIRECTORY_IDENTITY_FROZEN2'); end;`],
    ['directory_birth_audited',
      `create trigger directory_birth_audited before insert on object_directory
       for each row
       when exists (select 1 from ledger)
        and not exists (
          select 1 from ledger l
           where l.seq > new.created_seq
             and l.event_type = 'object-registered'
             and l.object_id = new.oid)
       begin select raise(abort, 'DIRECTORY_IDENTITY_FROZEN'); end;`],
    ['meta_ledger_seq_no_delete',
      `create trigger meta_ledger_seq_no_delete before delete on meta
       for each row when old.key > 'ledger_seq'
       begin select raise(abort, 'META_COUNTER_MONOTONICITY'); end;`],
  ];
  for (const [name, mutated] of MUT) {
    test(`G6A-A3 一字改体「${name}」⇒ 重开必红且 alteredTriggers 点名`, () => {
      const base = `a3-${name}`;
      open(base).close();
      outside(base, (db) => { db.exec(`drop trigger ${name};\n${mutated}`); });
      const r = refusal(() => open(base));
      expect(r.code, '同名变体必须被体摘要抓住').toBe('SCHEMA_UPGRADE_REQUIRED');
      expect((r.detail.alteredTriggers as string[]) ?? []).toContain(name);
    });
  }
  test('G6A-A3-7 route_change_guarded 同体异形（重排空白）不误伤；**体内注释文本属摘要覆盖面**（改注释=重开红，误杀方向如实钉形——归一化只折叠空白，不剥注释）', () => {
    open('a3-respace').close();
    // 与 SCHEMA 逐 token 相同（含体内那行 `-- D-27 真修…` 注释），只重排缩进/换行。
    outside('a3-respace', (db) => {
      db.exec(`drop trigger route_change_guarded;
CREATE TRIGGER route_change_guarded before update on capability_route
  begin
    select case when old.changed_seq is not null
                 and (new.changed_seq is null or new.changed_seq <= old.changed_seq)
             then raise(abort, 'ROUTE_CHANGED_SEQ_MONOTONICITY') end;
    select case when not exists (
        select 1 from ledger l
         where l.seq = new.changed_seq
           and l.event_type in ('capability-enabled','capability-disabled','capability-transferred')
           and l.actor is not null
           and json_valid(l.payload_json)
           and json_extract(l.payload_json, '$.capability') = new.capability
           -- D-27 真修（G5-A 包 6）：机制落账见证（N1 同信封）——无见证 / 见证不成立 = 审计行不是机制写的。
           and l.authority_basis is not null
           and json_valid(l.authority_basis)
           and json_extract(l.authority_basis, '$.axis') = 'capability-admin'
           and json_extract(l.authority_basis, '$.capability') = new.capability
           and json_extract(l.authority_basis, '$.authorized') = 1)
             then raise(abort, 'ROUTE_AUDIT_REQUIRED') end;
    select case
      when new.enabled <> old.enabled and not exists (
        select 1 from ledger l
         where l.seq = new.changed_seq
           and l.event_type = case new.enabled when 1 then 'capability-enabled' else 'capability-disabled' end)
         then raise(abort, 'ROUTE_AUDIT_REQUIRED')
      when new.enabled = old.enabled
       and (new.plugin_id <> old.plugin_id or new.ns <> old.ns or new.contract_version <> old.contract_version)
       and not exists (
        select 1 from ledger l
         where l.seq = new.changed_seq and l.event_type = 'capability-transferred')
         then raise(abort, 'ROUTE_AUDIT_REQUIRED')
    end;
  end;`);
    });
    expect(refusal(() => open('a3-respace')).code).toBe('NO_REFUSAL');
    // 注释文本改一个字符（语义零变化）⇒ 同样点名——覆盖面比「语义面」宽，误杀方向如实
    outside('a3-respace', (db) => {
      const cur = db.prepare(`select sql from sqlite_master where type='trigger' and name='route_change_guarded'`)
        .get() as { sql: string };
      db.exec(`drop trigger route_change_guarded;${cur.sql.replace('机制落账见证', '机制落账见证X')}`);
    });
    const r = refusal(() => open('a3-respace'));
    expect(r.code).toBe('SCHEMA_UPGRADE_REQUIRED');
    expect(r.detail.alteredTriggers as string[]).toContain('route_change_guarded');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('A4 水位判据两形 + meta 保护面复攻', () => {
  test('G6A-A4-1 ghost 号前跳（水位抬高、行不写）：重开**检不出**（合法形态恒满足 ≤ ⇒ 判据设计上放过；§16.2「ghost 戳不可分辨」登记面复钉），机制续号在高位', () => {
    const w = open('a4-ghost');
    const h0 = w.ledgerHead();
    w.raw.run(`update meta set value = value + 40 where key='ledger_seq'`); // 单调允许（上调）
    w.close();
    expect(refusal(() => open('a4-ghost')).code).toBe('NO_REFUSAL'); // 漏检 = 登记形态
    const w2 = open('a4-ghost');
    try {
      const oid = w2.uow(ADM, (tx) => tx.createObject({ kind: 'test.claim', payload: { v: 1 } })) as ObjectOid;
      const seq = w2.raw.get<{ seq: number }>(`select seq from ledger where object_id=?`, oid)!.seq;
      expect(seq).toBe(h0 + 41); // 40 个空洞号永久留在 H 序列里
      expect(w2.raw.get<{ c: number }>(`select count(*) c from ledger where seq > ? and seq < ?`, h0, seq)!.c).toBe(0);
    } finally { w2.close(); }
  });

  test('G6A-A4-2 「只删最大 seq 行」两路全灭：显式 DELETE 在一切连接撞 HISTORY_IMMUTABLE（recursive_triggers 只影响**隐式**删除——前席对该机制的口头理解钉形）；REPLACE 同 seq 顶写撞 DELETE 触发器（Port 连接）', () => {
    const w = open('a4-delmax');
    try {
      w.uow(ADM, (tx) => tx.createObject({ kind: 'test.claim', payload: { v: 1 } }));
      const max = w.raw.get<{ m: number }>(`select max(seq) m from ledger`)!.m;
      expect(outcome(() => w.raw.run(`delete from ledger where seq=?`, max))).toContain('HISTORY_IMMUTABLE');
      // 裸连接：显式 DELETE 同样触发（recursive_triggers 默认 OFF 不影响显式 DML 的触发器）
      let bare = 'NO_REFUSAL';
      try {
        outside('a4-delmax', (db) => { db.exec(`delete from ledger where seq=${max}`); });
      } catch (e) { bare = String((e as Error).message); }
      expect(bare).toContain('HISTORY_IMMUTABLE');
    } finally { w.close(); }
  });

  test('G6A-A4-3 水位倒退（update 直改）在一切连接撞单调触发器；裸 REPLACE 归零（前席 ST-A 路径）重开红 + detail 逐形', () => {
    const w = open('a4-watermark');
    w.uow(ADM, (tx) => tx.createObject({ kind: 'test.claim', payload: { v: 1 } }));
    expect(outcome(() => w.raw.run(`update meta set value = 0 where key='ledger_seq'`))).toContain('META_COUNTER_MONOTONICITY');
    w.close();
    outside('a4-watermark', (db) => { db.exec(`replace into meta(key, value) values('ledger_seq', 0)`); });
    const r = refusal(() => open('a4-watermark'));
    expect(r.code).toBe('SCHEMA_UPGRADE_REQUIRED');
    expect(r.detail.ledgerSeqWatermark).toBe(0);
    expect(typeof r.detail.ledgerMaxSeq).toBe('number');
  });

  test('G6A-A4-4 id_counter 与账本后缀：DELETE 掉 id_counter 键重开被 OID 一致性判据接住（登记形态复钉）；schema_version 下调被单调触发器拦（v7 标记自身也进计数保护面）', () => {
    const w = open('a4-idcounter');
    w.uow(ADM, (tx) => tx.createObject({ kind: 'test.claim', payload: { v: 1 } }));
    expect(outcome(() => w.raw.run(`delete from meta where key='id_counter'`))).toBe('NO_REFUSAL');
    expect(outcome(() => w.raw.run(`update meta set value = 6 where key='schema_version'`))).toContain('META_COUNTER_MONOTONICITY');
    w.close();
    const r = refusal(() => open('a4-idcounter')); // 计数器行缺失 ⇒ ?? 0 < maxOid ⇒ 打开拒
    expect(r.code).toBe('SCHEMA_UPGRADE_REQUIRED');
    expect(r.detail.idCounter).toBe(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('A5 guardRawBoundary：三分法之外的形态（父席点名：类目名"裸读形"是否名副其实）', () => {
  test('G6A-A5-1 拦得住面复钉 + 未列类目：SAVEPOINT 系按词法放行（三分法清单没有它，属事务控制同族）、VACUUM/ANALYZE/CREATE VIRTUAL TABLE/ATTACH 注释形全拦', () => {
    const w = open('a5-guard');
    try {
      // 拦得住（头部词表 + 剥注释归一）
      for (const sql of [
        `vacuum`, `vacuum into '${join(dir, 'a5-vac.db')}'`, `analyze`,
        `create virtual table g6a_fts using fts5(x)`,
        `attach database ':memory:' as m1`, `/*c*/ attach database ':memory:' as m2`,
        `attach--c\ndatabase ':memory:' as m3`,
        `select 1; /*c*/ drop trigger ledger_no_delete`,
        `pragma main.recursive_triggers = off`, `pragma recursive_triggers off`, // 空格赋值形
      ]) {
        expect(refusal(() => w.raw.run(sql)).code, sql.slice(0, 40)).toBe('RAW_SQL_REFUSED');
      }
      // 放行但**不在三分法清单上**：SAVEPOINT/RELEASE/ROLLBACK TO（事务控制同族，不新增绕触发器通道）
      expect(outcome(() => w.raw.run(`savepoint g6a_sp`))).toBe('NO_REFUSAL');
      expect(outcome(() => w.raw.run(`release savepoint g6a_sp`))).toBe('NO_REFUSAL');
      // 驱动层墙（守卫放行到驱动再撞）：sqlite_master 直写
      // （钉形副产品：多语句判据 `;/\s*\S/` 会**在字符串字面量内**命中分号——含分号的合法单语句被误拒，
      //  方向=误杀，登记面「宁误杀不漏放」同族。）分号去掉后放行到驱动，撞 sqlite_master 驱动墙：
      expect(refusal(() => w.raw.run(
        `insert into sqlite_master(rowid, type, name, tbl_name, rootpage, sql) values(99999,'trigger','g6a_x','ledger',0,'x')`,
      )).detail.message ?? '').toContain('may not be modified');
      expect(refusal(() => w.raw.run(
        `select 'a; b' as s`,
      )).code).toBe('RAW_SQL_REFUSED'); // 字符串内分号 ⇒ 误拒（误杀钉形）
    } finally { w.close(); }
  });

  test('G6A-A5-2「裸读形」类目名不实（父席点名，实测后果逐形）：optimize / wal_checkpoint 是无参**写副作用** PRAGMA，按 BARE_PRAGMA_READ 词法放行；但一切改连接行为/耐久性的开关都在赋值形 ⇒ 触发器防线与 durability 开关仍全拦', () => {
    const w = open('a5-pragma');
    try {
      w.uow(ADM, (tx) => tx.createObject({ kind: 'test.claim', payload: { v: 1 } }));
      // 放行且**有写副作用**：
      expect(outcome(() => w.raw.get(`pragma optimize`))).toBe('NO_REFUSAL');           // 写：ANALYZE+索引重建
      const cp = outcome(() => w.raw.all(`pragma wal_checkpoint`));                       // 写：被动 checkpoint（WAL→主库）
      expect(cp).toBe('NO_REFUSAL');
      // 放行后不变量原样（防线未松动）：
      expect(w.raw.get<{ recursive_triggers: number }>(`pragma recursive_triggers`)!.recursive_triggers).toBe(1);
      expect(outcome(() => w.raw.run(`delete from ledger where seq=1`))).toContain('HISTORY_IMMUTABLE');
      // 行为/耐久性开关全在赋值形（含空格形/函数形/schema 限定）⇒ 拒：
      for (const sql of [
        `pragma journal_mode = delete`, `pragma journal_mode(wal)`, `pragma journal_mode wal`,
        `pragma synchronous = off`, `pragma main.locking_mode = exclusive`,
        `pragma query_only = on`, `pragma writable_schema = on`, `pragma foreign_keys = off`,
      ]) {
        expect(refusal(() => w.raw.run(sql)).code, sql).toBe('RAW_SQL_REFUSED');
      }
      // journal_mode/synchronous 的裸词形是**纯读**（返回当前值，不改状态）：
      expect(JSON.stringify(w.raw.all(`pragma journal_mode`))).toContain('wal');
      const syncBefore = JSON.stringify(w.raw.all(`pragma synchronous`));
      expect(refusal(() => w.raw.run(`pragma synchronous`)).code).toBe('NO_REFUSAL'); // 读形放行
      expect(JSON.stringify(w.raw.all(`pragma synchronous`))).toBe(syncBefore);
    } finally { w.close(); }
  });
});
```

### A.2 g6b-reacttack-p1.test.ts
```ts
/**
 * G6-A（席位 G6-A @398df30）——五条 P1 修法的复攻（任务 B 组，另辟形态不抄作者测试）。
 *
 *  ① D-27：预留的五名矩阵之外——declareRecord/write() 台账面、恶意清单认领（register）、
 *     appendAuthoritativeEvent 借预留名 mint、**预留名单外机制在写的其余事件名**
 *     （object-revised / record-backfilled）与**未来新名的默认策略 = 默认不预留**（allow-by-default）；
 *     另辟 **UPDATE-PK 改名 + INSERT 全新登记形** 的停用复活全链（绕开方向判据的完整形态，父席点名）。
 *  ② D-31：删参后的机制内 ns 通道枚举 + **历史面**（包 5 合法通道造出的漂移库在 398df30 上的形态、
 *     救济面枚举）。fixture 由 p5 worktree 造，路径经环境变量注入；缺省时本用例自造等价形状。
 *  ③ D-24 读侧：遮蔽计数的可归因性/可淹没性（安全可见性 vs 可用性）。
 *  ④ D-21：保留前缀之外的机制 id 面枚举（OBJ-/record id 双 namespace 是否互踩）。
 *  ⑤ C2：softGhosts 的形态边界（双 NULL 目标软边）与「只报不阻」的默认忽略检查。
 */
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { POC_DATA_DIR } from '../../src/harness/paths.ts';
import { openWorld, PRINCIPAL, type World } from '../../src/harness/world.ts';
import { readAsOf } from '../../src/kernel/read-context.ts';
import { migrateLegacyRecords } from '../../src/storage-sqlite/sqlite-port.ts';
import { TEST_OBJECT_MODEL, CAP_OBJECT_MODEL } from '../../src/domains/test-object-model.ts';
import { TEST_RECORDS, CAP_RECORDS } from '../../src/domains/test-records.ts';
import { Refusal, type ObjectOid, type PluginManifest, type ReadContextSpec } from '../../src/contracts/index.ts';

const ADM = PRINCIPAL('g6badmin');
const NOBODY = PRINCIPAL('g6bnobody');
const GRANTS = {
  g6badmin: ['space-write', 'capability-admin', 'domain-admission'],
  g6bnobody: ['space-write'],
};
let dir: string;
beforeAll(() => { dir = mkdtempSync(join(POC_DATA_DIR, 'g6b-reacttack-')); });
afterAll(() => { rmSync(dir, { recursive: true, force: true }); });

const open = (name: string): World =>
  openWorld({ file: join(dir, `${name}.db`), space: 'SP-G6B', grants: GRANTS, plugins: [TEST_OBJECT_MODEL, TEST_RECORDS] });
const outcome = (fn: () => unknown): string => {
  try { fn(); return 'NO_REFUSAL'; }
  catch (e) {
    const err = e as { code?: unknown; message?: unknown };
    if (typeof err?.code === 'string' && err.code !== 'ERR_SQLITE_ERROR') return err.code;
    return String(err?.message ?? e);
  }
};
const ctx = (w: World, recordedAsOf?: number): ReadContextSpec => ({
  space: w.kernel.space, principal: ADM, mode: 'as-recorded', consistency: 'required',
  ...(recordedAsOf !== undefined ? { recordedAsOf: recordedAsOf as never } : {}),
});

// ─────────────────────────────────────────────────────────────────────────────
describe('G6B-D27 预留面的复攻（作者 G27 三例之外）', () => {
  const FIVE = ['capability-enabled', 'capability-disabled', 'capability-transferred',
    'object-registered', 'check-report-recorded'] as const;

  test('G6B-D27-1 declareRecord / assembly 作用域 / write() 三条通道对五名全拒且零半成品（台账/records 行数不动）', () => {
    const w = open('d27-channels');
    try {
      for (const et of FIVE) {
        const head0 = w.ledgerHead();
        const recs0 = w.raw.get<{ c: number }>(`select count(*) c from records`)!.c;
        expect(outcome(() => w.uow(NOBODY, (tx) => tx.declareRecord({ recordId: `x.${et}`, eventType: et, payload: {} }))), et)
          .toBe('EVENT_AUTHORITY_REQUIRED');
        expect(outcome(() => w.uow(ADM, (tx) => tx.appendLedger({ eventType: et, payload: {} }))), `${et} assembly`)
          .toBe('EVENT_AUTHORITY_REQUIRED');
        expect(w.ledgerHead()).toBe(head0);
        expect(w.raw.get<{ c: number }>(`select count(*) c from records`)!.c).toBe(recs0);
      }
      // 正例不回归：普通名两通道照常
      expect(outcome(() => w.uow(NOBODY, (tx) => tx.declareRecord({ recordId: 'x.ok', eventType: 'g6b.plain', payload: {} })))).toBe('NO_REFUSAL');
    } finally { w.close(); }
  });

  test('G6B-D27-2 恶意清单 ownsEventTypes 认领机制审计名 ⇒ register 拒（AMBIGUOUS_AUTHORITY）；appendAuthoritativeEvent 无归属亦拒（不借道 mint）', () => {
    // 认领 `object-registered` 的清单：机制出生审计名成了"正式事件" ⇒ 窄面命令 Port 就是预留的第二 breach
    const evil: PluginManifest = {
      pluginId: 'evil.claims', storageNamespace: 'dom_evil', provides: [{ capability: 'cap.evil.claims', contractVersion: 'v1' }],
      requires: [], ownsEventTypes: [{ eventType: 'object-registered', capability: 'cap.evil.claims', requiresAuthority: 'evil-axis' }],
    };
    const file = join(dir, 'd27-register.db');
    expect(outcome(() => openWorld({ file, space: 'SP-G6B', grants: GRANTS, plugins: [TEST_OBJECT_MODEL, evil] })))
      .toContain('AMBIGUOUS_AUTHORITY');
    // appendAuthoritativeEvent：机制名未登记为正式事件（register 已拦）⇒ owner undefined ⇒ 同码拒
    const w = open('d27-authoritative');
    try {
      const oid = w.uow(ADM, (tx) => tx.createObject({ kind: 'test.claim', payload: {} })) as ObjectOid;
      expect(outcome(() => w.uow(ADM, (tx) => w.writerOf(CAP_RECORDS, tx).appendAuthoritativeEvent({
        eventType: 'capability-transferred', objectId: oid, revision: 1, payload: {},
      })))).toBe('EVENT_AUTHORITY_REQUIRED');
    } finally { w.close(); }
  });

  test('G6B-D27-3（结构性钉形）预留名单**外**机制在写的事件名照常可 mint：object-revised / record-backfilled / 任意未来新名 ⇒ 预留是 allow-by-default，deny-by-default 缺位（G1 裁决位）', () => {
    const w = open('d27-default');
    try {
      const oid = w.uow(ADM, (tx) => tx.createObject({ kind: 'test.claim', payload: {} })) as ObjectOid;
      w.uow(NOBODY, (tx) => tx.appendLedger({ eventType: 'anything', payload: {}, objectId: oid })); // 让 write/append 面非空
      for (const et of ['object-revised', 'record-backfilled', 'capability-reloaded', 'capability-migrated-v9']) {
        expect(outcome(() => w.uow(NOBODY, (tx) => tx.appendLedger({ eventType: et, payload: { forged: true } }))), et)
          .toBe('NO_REFUSAL'); // mint 成功 = 默认不预留的实证
      }
      // 当前无害的验证：没有任何触发器/判据依赖这两个名 ⇒ 伪造行不改变机制行为（今天没洞 = 恰好没依赖）
      const d = w.raw.get<{ c: number }>(`select count(*) c from object_directory`)!.c;
      expect(outcome(() => w.uow(ADM, (tx) => tx.revise(oid, { payload: { v: 2 } })))).toBe('NO_REFUSAL');
      expect(w.raw.get<{ c: number }>(`select count(*) c from object_directory`)!.c).toBe(d);
    } finally { w.close(); }
  });

  test('G6B-D27-4（父席点名·完整链）UPDATE-PK 改名 + INSERT 全新登记形 ⇒ 停用复活且**方向判据全程未参与**；插件可达面逐步验证做不到', () => {
    const file = join(dir, 'd27-pkchain.db');
    const w = openWorld({ file, space: 'SP-G6B', grants: GRANTS, plugins: [TEST_OBJECT_MODEL, TEST_RECORDS] });
    const oid = w.uow(ADM, (tx) => tx.createObject({ kind: 'test.claim', payload: {} })) as ObjectOid;
    w.uow(NOBODY, (tx) => w.standingUseCase().declare(tx, { oid, revision: 1, stance: 'ACCEPTED' }));
    w.unloadCapability(CAP_RECORDS, ADM); // 真停用（真审计+真见证）
    const row = w.raw.get<{ plugin_id: string; ns: string; contract_version: string }>(
      `select plugin_id, ns, contract_version from capability_route where capability=?`, CAP_RECORDS)!;
    // —— 插件可达面先撞墙（同一攻击意图经机制通道的每一步）——
    expect(outcome(() => w.uow(NOBODY, (tx) => tx.appendLedger({ eventType: 'capability-enabled', payload: { capability: CAP_RECORDS } }))))
      .toBe('EVENT_AUTHORITY_REQUIRED'); // 预留拦 mint
    // —— 裸面三步链（1 条伪造见证审计 + 1 条 UPDATE + 1 条 INSERT）——
    const s = w.ledgerHead() + 1;
    const tomb = 'cap.g6a.tombstone'; // 改名后的墓碑名
    w.raw.run(
      `insert into ledger(seq, space, event_type, actor, authority_basis, payload_json, described_at, recorded_at)
       values(?,?,?,?,?,?,null,?)`,
      s, 'SP-G6B', 'capability-enabled', 'anyname',
      JSON.stringify({ axis: 'capability-admin', capability: tomb, authorized: true }),
      JSON.stringify({ capability: tomb }), Date.now(),
    );
    w.raw.run(`update meta set value = ? where key='ledger_seq'`, s);
    // 步骤①：路由行改名（capability 是 PK——**不在方向判据③的三元组里**，一条任意名审计即过）
    expect(outcome(() => w.raw.run(
      `update capability_route set capability=?, changed_seq=? where capability=?`, tomb, s, CAP_RECORDS,
    ))).toBe('NO_REFUSAL');
    // 步骤②：给原能力插一条全新登记形行（route_insert_guarded 只核 enabled=1/无戳——**新生行零审计是设计**）
    expect(outcome(() => w.raw.run(
      `insert into capability_route(capability, plugin_id, ns, contract_version) values(?,?,?,?)`,
      CAP_RECORDS, row.plugin_id, row.ns, row.contract_version,
    ))).toBe('NO_REFUSAL');
    w.close();
    // 步骤③：新进程按持久路由复活 ⇒ 停用被撤销，且 H 里**不存在任何一条**指向 CAP_RECORDS 的启用审计
    const w2 = openWorld({ file, space: 'SP-G6B', grants: GRANTS, plugins: [TEST_OBJECT_MODEL, TEST_RECORDS] });
    try {
      expect(w2.kernel.registry.capability(CAP_RECORDS) !== undefined, '新进程路由视图应已复活为启用').toBe(true);
      // H 里指向 CAP_RECORDS 的启停审计**只有停用那一条**——复活全程零启用审计（方向判据被链绕开）
      const audits = w2.raw.get<{ c: number }>(
        `select count(*) c from ledger where json_valid(payload_json) and json_extract(payload_json,'$.capability')=?
           and event_type in ('capability-enabled','capability-disabled','capability-transferred')`,
        CAP_RECORDS,
      )!.c;
      expect(audits).toBe(1); // 停用真账一条；启用：**没有**——审计面看不出「它又活了」
      const revived = w2.raw.get<{ enabled: number; changed_seq: number | null }>(
        `select enabled, changed_seq from capability_route where capability=?`, CAP_RECORDS,
      )!;
      expect(revived).toEqual({ enabled: 1, changed_seq: null }); // **新行无戳**：复活不留变更戳
      const tombRow = w2.raw.get<{ c: number }>(`select count(*) c from capability_route where capability=?`, tomb)!.c;
      expect(tombRow).toBe(1); // 墓碑行永久残留（route_no_delete 删不掉）= 痕迹
    } finally { w2.close(); }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('G6B-D31 移交删参 + 历史面（"修了入口没修历史"裁定实证）', () => {
  test('G6B-D31-1 入口拒的零半成品逐形 + 停用中能力移交 = CAPABILITY_INACTIVE（EVIDENCE ⑤ 未覆盖组合钉齐）', () => {
    const w = open('d31-entry');
    try {
      const oid = w.uow(ADM, (tx) => tx.createObject({ kind: 'test.claim', payload: { v: 'real' } })) as ObjectOid;
      const drifted: PluginManifest = { ...TEST_OBJECT_MODEL, pluginId: 'test.om.v9', storageNamespace: 'dom_drift_v9' };
      const head0 = w.ledgerHead();
      const r = refusalOf(() => w.transferCapability(CAP_OBJECT_MODEL, drifted, ADM));
      expect(r.code).toBe('TRANSFER_NS_DRIFT');
      expect(Object.keys(r.detail).sort()).toEqual(['capability', 'currentNs', 'declaredNs', 'reason']);
      expect(w.ledgerHead()).toBe(head0);                       // 不落账
      const route = w.raw.get<{ ns: string; changed_seq: number | null }>(
        `select ns, changed_seq from capability_route where capability=?`, CAP_OBJECT_MODEL)!;
      expect(route.ns).toBe('dom_test_om');                      // 路由一字未动
      expect(outcome(() => w.uow(ADM, (tx) => tx.readLatest(oid) ?? null))).toBe('NO_REFUSAL');
      // 停用中 ⇒ 移交拒（内存视图无该能力；清单必须 provides 该能力才摸得到这道闸）
      w.unloadCapability(CAP_OBJECT_MODEL, ADM);
      expect(outcome(() => w.transferCapability(
        CAP_OBJECT_MODEL, { ...TEST_OBJECT_MODEL, pluginId: 'test.om.v3' }, ADM,
      ))).toBe('CAPABILITY_INACTIVE');
    } finally { w.close(); }
  });

  test('G6B-D31-2 历史面（父席点名）：**包 5 合法通道造出的漂移库**在 398df30 上被 v6→v7 版本墙整体拒开；版本墙之后无任何漂移检出/救济——auditRequiredIntegrity 不看 ns，migrateLegacyRecords 不修版本不修漂移', () => {
    // p5 worktree（d578208 代码）造的真·历史库，随本攻击文件入库于 .poc-data/；
    // 环境变量可覆盖，缺省走仓内相对路径——门禁重跑不依赖会话环境。
    const fixture = process.env.G6A_P5_FIXTURE
      ?? join(POC_DATA_DIR, 'g6a-p5-drift.db'); // p5 worktree 造的真·历史库（无则失败，不自造形状冒充）
    if (fixture && existsSync(fixture)) {
      // ① 真历史库（包 5 的 transferRoute 携 ns 合法写出，schema_version=6）在 398df30 上：
      const r = refusalOf(() => openWorld({ file: fixture, space: 'SP-P5', grants: GRANTS, plugins: [TEST_OBJECT_MODEL, TEST_RECORDS] }));
      expect(r.code).toBe('SCHEMA_UPGRADE_REQUIRED');       // 版本墙先拦住——漂移根本没被评估
      // ② 救济面：migrateLegacyRecords 不检查版本、也不修任何东西（只回填 records）——跑完仍拒开
      migrateLegacyRecords(fixture);
      const r2 = refusalOf(() => openWorld({ file: fixture, space: 'SP-P5', grants: GRANTS, plugins: [TEST_OBJECT_MODEL, TEST_RECORDS] }));
      expect(r2.code).toBe('SCHEMA_UPGRADE_REQUIRED');
      return;
    }
    // 证据库缺失 ⇒ 显式红（不得 skip 冒充通过）
    expect(existsSync(fixture), `历史库证据缺失：${fixture}（应由 d578208 worktree 的合法通道造出）`).toBe(true);
  });

  test('G6B-D31-3 v7 库内漂移形状（界外伪造后重开）：打开**无漂移判据**照常开；快照面 fail-loud、扫描面遮蔽计数存活；auditRequiredIntegrity 对漂移零声纳 ⇒ 历史面 = 入口修了、检出与救济都没有', () => {
    const w = open('d31-drift');
    const oid = w.uow(ADM, (tx) => tx.createObject({ kind: 'test.claim', payload: { v: 'real' } })) as ObjectOid;
    // 界外构造漂移（v7 触发器下唯一构造路径：伪造 transferred 审计+见证后 raw 改 ns——正主 §16.3 登记的界）
    const s = w.ledgerHead() + 1;
    w.raw.run(
      `insert into ledger(seq, space, event_type, actor, authority_basis, payload_json, described_at, recorded_at)
       values(?,?,?,?,?,?,null,?)`,
      s, 'SP-G6B', 'capability-transferred', 'x',
      JSON.stringify({ axis: 'capability-admin', capability: CAP_OBJECT_MODEL, authorized: true }),
      JSON.stringify({ capability: CAP_OBJECT_MODEL }), Date.now(),
    );
    w.raw.run(`update meta set value = ? where key='ledger_seq'`, s);
    expect(outcome(() => w.raw.run(
      `update capability_route set ns='dom_poisoned', changed_seq=? where capability=?`, s, CAP_OBJECT_MODEL,
    ))).toBe('NO_REFUSAL');
    w.close();
    // 重开：没有任何一条打开判据看 dir.ns vs route.ns
    const w2 = openWorld({ file: join(dir, 'd31-drift.db'), space: 'SP-G6B', grants: GRANTS, plugins: [TEST_OBJECT_MODEL, TEST_RECORDS] });
    try {
      expect(outcome(() => w2.readObject(oid))).toContain('SCHEMA_INCOMPATIBLE'); // 单对象 fail-loud（设计）
      const scan = readAsOf(w2.kernel, ctx(w2));                                   // 扫描面存活（包 6 修）
      expect(scan.rows.length).toBe(0);
      expect(scan.echo.hiddenByContractSkew).toBe(1);                              // 但只有计数，无身份、无审计工件
      const audit = w2.kernel.auditRequiredIntegrity();                            // 巡检对漂移零声纳
      expect([audit.checked, audit.violations.length, audit.softChecked, audit.softGhosts]).toEqual([0, 0, 0, 0]);
      // 救济面终验：机制内没有任何通道能改 dir.ns（D-28 冻结）或 route.ns 回正（审计名已预留、raw 改回也需再伪造）
      expect(outcome(() => w2.raw.run(`update object_directory set ns='dom_test_om' where oid=?`, oid)))
        .toContain('DIRECTORY_IDENTITY_FROZEN');
    } finally { w2.close(); }
  });
});
function refusalOf(fn: () => unknown): { code: string; detail: Record<string, unknown> } {
  try { fn(); return { code: 'NO_REFUSAL', detail: {} }; }
  catch (e) {
    if (e instanceof Refusal) return { code: e.code, detail: e.detail as Record<string, unknown> };
    return { code: 'BARE_ERROR', detail: { message: String((e as Error).message).slice(0, 120) } };
  }
}

// ─────────────────────────────────────────────────────────────────────────────
describe('G6B-D24/D21/C2 收口面复攻', () => {
  test('G6B-D24-1 遮蔽计数可被**合法流量淹没**：1 条投毒行与 N 条合法挂载行在同一计数器里不可分；计数不落任何持久工件（可见性=每次读的一过性回声）', () => {
    const w = open('d24-noise');
    try {
      const v1 = w.uow(ADM, (tx) => tx.createObject({ kind: 'test.claim', payload: { v: 1 } })) as ObjectOid;
      // 1 条投毒
      w.uow(ADM, (tx) => w.writerOf(CAP_RECORDS, tx).write(
        { ns: 'dom_test_records', oid: v1, revision: 99, payload: { evil: true }, eventType: 'ext.poison' }));
      // N 条合法挂载（同形同计数）——淹没
      const hosts: ObjectOid[] = [v1];
      for (let i = 0; i < 4; i += 1) hosts.push(w.uow(ADM, (tx) => tx.createObject({ kind: 'test.claim', payload: { i } })) as ObjectOid);
      hosts.forEach((h, i) => {
        w.uow(ADM, (tx) => w.writerOf(CAP_RECORDS, tx).write(
          { ns: 'dom_test_records', oid: h, revision: 100 + i, payload: { facet: i }, eventType: 'ext.facet' }));
      });
      const scan = readAsOf(w.kernel, ctx(w));
      expect(scan.echo.hiddenByContractSkew).toBe(6); // 1 投毒 + 5 合法挂载——不可分，也不该由计数负责分（登记面）
      // 一过性：计数只在 echo 里；库里没有「发生过遮蔽」的持久痕迹（审计面缺位钉形——发现与否取决于谁在盯着回声）
      expect(w.raw.get<{ c: number }>(
        `select count(*) c from ledger where event_type like '%hidden%' or event_type like '%shadow%'`,
      )!.c).toBe(0);
    } finally { w.close(); }
  });

  test('G6B-D21-1 record-id 与 oid 是两个 namespace：OBJ- 前缀可被声明为记录且不与对象身份互撞（保留集完备性钉形：机制 record 前缀只有 RPT-）；预占链断粮复验（合法报告在尝试攻击后照常）', () => {
    const w = open('d21-prefix');
    try {
      const oid = w.uow(ADM, (tx) => tx.createObject({ kind: 'test.claim', payload: {} })) as ObjectOid;
      // 尝试滚动预占（修后断粮）
      const head = w.ledgerHead();
      expect(outcome(() => w.uow(NOBODY, (tx) => tx.declareRecord({ recordId: `RPT-${head + 2}`, eventType: 'x', payload: {} }))))
        .toBe('RECORD_ID_RESERVED');
      // 报告照常
      const rep = w.uow(ADM, (tx) => tx.recordReport({
        target: { kind: 'revision-ref', oid, revision: 1 }, validatorId: 'v', ruleVersion: 'r', schemaVersion: 's',
        environment: 'e', executedAt: 1, guaranteeScope: 'g', verdict: 'PASS', findings: [], declaredGaps: [],
      }));
      expect(rep.reportId).toBe(`RPT-${rep.seq}`);
      // record-id 与 oid 同串不互踩（双 namespace 实证）
      const oidStr = String(oid);
      expect(outcome(() => w.uow(NOBODY, (tx) => tx.declareRecord({ recordId: oidStr, eventType: 'x', payload: {} })))).toBe('NO_REFUSAL');
      expect(w.kernel.resolvePresented({ kind: 'object-ref', oid }).state).toBe('PRESENT');
      expect(w.kernel.resolvePresented({ kind: 'record-ref', recordId: oidStr }).state).toBe('PRESENT');
      expect(w.readObject(oid)!.oid).toBe(oid); // 对象读面不受 records 行影响
      // 小写 rpt- 变体：机制发号只用 'RPT-'，小写不构成同键 ⇒ 允许且无碰撞（binary 语义钉形）
      expect(outcome(() => w.uow(NOBODY, (tx) => tx.declareRecord({ recordId: 'rpt-001', eventType: 'x', payload: {} })))).toBe('NO_REFUSAL');
    } finally { w.close(); }
  });

  test('G6B-C2-1 软边幽灵的边界形态：to_oid/to_record 双 NULL 的软边（raw 直插形）计入 softGhosts；「只报不阻」——带幽灵提交照常，violations 语义未动', () => {
    const w = open('c2-edge');
    try {
      const oid = w.uow(ADM, (tx) => tx.createObject({ kind: 'test.claim', payload: {} })) as ObjectOid;
      w.uow(ADM, (tx) => tx.linkRef({
        from: { kind: 'revision-ref', oid, revision: 1 }, to: { kind: 'object-ref', oid: 'OBJ-SP-G6B-ghost' as ObjectOid },
        role: 'soft', required: false,
      }));
      // raw 直插双 NULL 软边（无触发器的表）
      w.raw.run(`insert into ref_edge(from_oid, from_rev, to_oid, to_rev, to_record, role, required) values(?,?,null,null,null,'both-null',0)`, oid, 1);
      const a = w.kernel.auditRequiredIntegrity();
      expect([a.checked, a.violations.length]).toEqual([0, 0]);
      expect(a.softChecked).toBe(2);
      expect(a.softGhosts).toBe(2); // 幽灵 oid + 双 NULL 边
      // 只报不阻：幽灵在位，任何主体的机制提交照常
      expect(outcome(() => w.uow(NOBODY, (tx) => tx.appendLedger({ eventType: 'x.ok', payload: {} })))).toBe('NO_REFUSAL');
    } finally { w.close(); }
  });
});
```
