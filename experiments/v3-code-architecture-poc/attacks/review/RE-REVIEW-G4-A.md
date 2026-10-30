# RE-REVIEW-G4-A —— 978a70b 独立复验（包 4：N6/N7/D-26/N9 + N3 双门重写 + GT-4 覆盖面锚）第五轮攻击席报告

> 席位：**G4-A**（被复验提交 `978a70b`，含 `eeccbf5` 包 4 与 `aed186d` GT-4 锚与 `978a70b` 台账补正）。
> 方法：独立 worktree `.scratch/wt-g4a` @ 978a70b；全部实测在其中进行；攻击文件
> `attacks/review/g4a-*.test.ts` 三件 **35 例全绿**（绿=攻击假设被证实或兜底被复钉），全文见附录 A，
> 本文件自含可复跑。基线三件套 @ 978a70b 全绿（tsc 0 错；作者流 **167/167** 与锚逐等；审查方流与
> BASELINE **32 条已知红**完全一致）——本报告的全部主张都建立在这个绿基线之上。
> 前席对照：G2-A（D-20/N1、GT 家族）、G3-A（N1 残留 A1、N3 三门式、N6/N7、N9、GT-4 窗口）。
> 本席无一自我矛盾；对 G3-A 的"残余登记"做了**量化与边界修正**（更宽，见 N4/G4A-N3 系列），
> 对 G2-A 的 GT-2 做了作者流同构实证（GT4-c）。

---

## ① 裁定表（逐项：已修 / 部分 / 未修 + 定级 + 一句话依据）

| 项 | 裁定 | 定级 | 依据（细节行号见 §② 攻击矩阵） |
|---|---|---|---|
| **N1**（包 3 第三层：授权结论=机制证据） | **已修**（复钉绿） | — | G4A-C1 同世界时序绿：未授权 WITHDRAWN 落库不计入、见证优先闸真、v3 只认 `authority.authorized`；G4A-C2 字段清单实证。v2 历史行的"无见证仍计入"是**如实登记的只读历史语义**（本席复钉其对称代价仍在：伪造 v2 行经裸面后置插入可翻回 ADOPTED，唯一救济=更新的正当 WITHDRAWN——这是台账已认领的政策而非新洞，但其裸面可达性归并 N9' 定级） |
| **N6**（判据表原型链查表） | **已修** | — | G4A-C3：12 种怪 `policyVersion`（`constructor`/`__proto__`/`toString`/`hasOwnProperty`/大小写/尾随空白/`''`/`'null'`…）全谱 fail-closed 不计入且不崩读者；`lookupStandingRule` = `hasOwnProperty.call` + typeof function（test-records.ts:112-115），FIXPROBE 移植 4 绿复跑确认 |
| **N7**（`__proto__` 毒行永久崩读者） | **已修** | — | 同 G4A-C3：毒行不抛异常，`standingAt` 正常返回；插件 `eventsOf` 面不查表幸存（与登记一致） |
| **D-26**（requiresAuthority 轴值判据） | **部分修**：原攻击类（字面 `space-write`/`capability-admin` 登记）装配期拒，**已修**；排除谓词是**精确串比较**，等价不同形 6/6 绕过注册（G4A-D26-绕 系列）；提权不成立（账本 Set 精确匹配 ⇒ 见证恒 false，fail-closed 兜底复钉）。**新登记后果面**：轴=`' '` + 诱导装配根 `grant(actor,' ')` ⇒ 见证 **true**（G4A-D26-空 第二半，可执行、无需机制缺陷，仅需运维配合） | **P2**（注册面卫生缺口；提权面已兜住故非 P1；`' '`+grant 链是唯一真通到 `authorized:true` 的路径） | kernel.ts:119 `includes` 精确比较；world.ts:51 `Set.has`；契约只登记了空白轴，**未登记**大小写/同形字/前后空白族 |
| **N3**（双门重写） | **部分修**：门 1（AST）扎实——本席 10 语法形态穷举全抓、类型注解不误报，G3-A 三式全灭；门 2 按"一层递归"的设计**如实但比登记窄**：登记残余写「两层以上包装…由门 1 兜底」，**兜底句被否证**——`constructor(f){ this.bundle={deep:{face:f}} }` 是裸赋值，AST 门零命中、门 2 两层失明、泄漏可走通（G4A-N3a/N3b/N3c/N3e：两层包装/数组/原型注入/别名注入+组合，四种双盲或半盲形态）。登记残余「storage/kernel 装配层参数属性插件不可达」= 定量成立（30 处全在面外，插件窄面零对象值键），但 **`port.raw` 返回的 Adapter 自有键 `['db']` 运行时可枚 DatabaseSync**（装配面，设计如此） | **P2**（既有代码零命中属实，防复发承诺仍不闭合；旧门血统副本保留是好实践） | 攻击文件附录 A.1 全文；门 2 判据边界建议见 §③-N4' |
| **N9**（REPLACE append-only） | **部分修**：**H 五表真修**（G4A-N9f 逐表真主键冲突矩阵：ledger/domain_state/records/check_report/ref_edge 全 ABORT；作者 N9-1 的种子**真实**——它签发的行就提供冲突 seq，不是虚绿，父席点名核验完毕）；但 pragma 的保护面 = **恰好等于有 DELETE 触发器的表**：`object_directory`/`capability_route`/`meta`/`projection_*` 无 DELETE 触发器 ⇒ REPLACE 整行改写照成功（新发现 D-27/D-28/D-29，见 §③）。guard 纵深面被**中置注释**穿过且 `ON CONFLICT DO UPDATE` 不在被禁名单（G4A-N9e）——「guard 对无触发器表同拒」的主张对被测 canonical 形态为真、对形态族为假 | **P3→拆出三条新行**（原语本身对 H 已修）| READINESS N9 行"append-only 这一核心不变量"的覆盖面主张**过度**——补的是 H 五表，不是"核心不变量"全体 |
| **GT-4**（作者流覆盖面锚） | **部分修**：魔数窗口洞真闭（GT4-a 删 4 例红、GT4-b 加 1 例红、GT4-d 有红拒写且锚文件字节不变、锚戳祖先判据在位）；**但锚只锚计数不锚身份**：等量替换（删 `d26-authority-axis.test.ts` 4 例真测试 + 补 4 条 `expect(1).toBe(1)`）⇒ 门禁打印「**OK —— 167 例全绿，与覆盖面锚逐等**」PASS（GT4-c，门禁打印原文在 §③-GT4'）——这是 **GT-2（掏空）在作者流的同构再现，而 GT-2 恰是本仓登记未修项**；`--reanchor` 拒写判据本身正确，但"先等量替换（无需重锚）"这条通道根本不经过它 | **P2** | 建议锚形态（身份摘要 + 绕过成本分析）在 §③-GT4'；**不得**把 GT-4 记成"作者已修的 GT-2"——GT-2/GT-4 是同一洞的两面 |
| **D-25**（激活核对） | **已修**（单进程语义复钉）；跨进程陈旧窗口已由包 4 **文档纠正**为机制真话（G3-A D25-MP 的认领兑现），停用窗口读面不关 = 登记设计边界。新增：`capability_route` 的 REPLACE 可**无审计回滚停用**（D-27），属 N9 覆盖面而非 D-25 修法本身的失效 | **P2 残留（文档已改真）** | G4A-C1 停用拒签+零残留绿 |
| **GT-2**（审查方红条掏空） | **未修**（沿 G3-A，门文件对 attacks 流一字未动）；本席实证其在**作者流**的镜像（GT4-c 等量替换 PASS） | **P2** | 与 GT-4 合并治理建议见 §③-GT4' |
| **GT-3**（自洽重算洗绿） | **未修**（本包未动；`--reanchor` 拒写只保护锚写入一刻，重算通道本身仍开——本席未重放全链，列 §⑤） | **P2** | — |
| **N5**（文件级崩溃吸收） | **未修**（沿 G2-A/G3-A；g0-gate 作者流改动未触 loadErrors 判据族） | **P2** | diff 逐 hunk 见 §④ |
| **新增 D-27**（`capability_route` REPLACE 回滚停用，零审计） | **新发现** | **P1**（可达面=装配裸面/运维，但被绕的是 `capability-admin` 权限轴的**持久化**与 D-25 停用决策；父席裁定入账） | G4A-N9c 完整链：停用→REPLACE→新进程 activate→**该能力恢复签发**，ledger 零审计行 |
| **新增 D-28**（`object_directory` 无 DELETE 触发器 ⇒ RD-01 身份冻结从未闭合） | **新发现** | **P2**（同威胁类；连带支点见 §③-D-28） | G4A-N9b：REPLACE 伪造 created_seq、换 owner ⇒ 该对象读路径当场 CAPABILITY_INACTIVE 无救济；`DELETE FROM object_directory` 直接抹身份行 |
| **新增 D-29**（`meta.ledger_seq` 可归零） | **新发现（单列）** | **P3**（可达面同上；破坏 H 序号单调性 ⇒ xc28 缺口检测与双时间读的一致性前提失效） | G4A-N9d：REPLACE/on-conflict-do-update 归零成功，`kernel.head` 从 1 变 0 |
| **新增 D-30**（guard 纵深：中置注释 + upsert 名单缺口） | **新发现** | **P3**（插件不可达，属"先于触发器拒"承诺的失效；触发器兜底仍在 H 五表上有效） | G4A-N9e：`insert/*G4A*/or replace`、`replace/*G4A*/into`、`insert--c\nor replace`、`on conflict do update` 四种全部穿过 guard；对无触发器表**改写生效**，对有触发器表撞触发器（对照诚实） |
| **观察 E-01'**（eventsOf 跨读无命名空间过滤） | 登记加宽 | **P2（沿 E-01，新增事实）** | G4A-C2：`grantCrossEventRead` 是**能力级全开**——授权后全空间任意 oid 的事件+载荷+actor+见证全见；拒绝 detail 泄露 owner 能力 id（存在性 oracle 现状，D-12 同条）。G1 裁定范围应加"授权粒度"选项 |

---

## ② 攻击矩阵（35 例；「成立」= 攻击假设被证实；证据 = 附录 A 内测试名）

| # | 尝试 | 若洞在应看到 | 实测 | 成立 | 证据 |
|---|---|---|---|---|---|
| G4A-N3a | 两层 plain-object 包装 + 裸赋值构造 | 门 2 空、门 1 零命中 | 两者皆空，`bundle.deep.face` 可走 | **成立**（兜底句否证） | A.1 |
| G4A-N3b | 数组包装 `[face]` | 同上 | 双盲 | **成立** | A.1 |
| G4A-N3c | `Object.getPrototypeOf(this).face=f` 原型注入 | 双盲 | 双盲（门 2 只查 `Reflect.ownKeys(inst)`，门 1 只认 `defineProperty(this,`） | **成立** | A.1 |
| G4A-N3d | 模板字符串里的生成类代码 | AST 不可见 | 零命中（理论面，域内无 codegen） | 成立（登记） | A.1 |
| G4A-N3e | 别名化 `dp=Object.defineProperty` / `Reflect.defineProperty` | 门 1 失明 | 门 1 全瞎；直接自有键被门 2 兜住；**+两层包装组合双盲** | 半成立（直接面兜住，组合洞开） | A.1 |
| G4A-N3f/g | Map/Set 句柄、wrapper 内 `Symbol.toPrimitive` getter | 保守拦 | 全拦（Map/Set 原型方法触发 callableSurface；own accessor 保守拦） | 不成立（兜底复钉） | A.1 |
| G4A-N3h | AST 语法穷举 ×10（declare/abstract/装饰器/mixin/局部类/重载/嵌套括号/正则括号/模板默认值右括号/类型别名不误报） | 全抓 | 10/10 全对 | 不成立（门 1 语法面扎实） | A.1 |
| G4A-N3i | 扫描面外量化 + 插件可达性 | 量化 + 可达面核对 | **30 处**（param 9/field 12/accessor 9）全在 `src/domains|app` 外；窄面是对象字面量、无对象值自有键；`w.raw` 自有键=`['db']` | 量化交付（不可达结论定量化成立） | A.1 stdout |
| G4A-N9a | sqlite_master 逐表触发器清单 | 无 DELETE 触发器表清单 | 6 表无 DELETE：meta/object_directory/capability_route/journal/projection_*| **成立** | A.2 |
| G4A-N9b | RD-01：REPLACE/DELETE object_directory | 改写/抹除成功 | REPLACE 成功（created_seq=424242）、UPDATE 撞触发器（对照）、owner 换假 ⇒ 读路径 CAPABILITY_INACTIVE、DELETE 成功 | **成立** → D-28 | A.2 |
| G4A-N9c | REPLACE capability_route enabled 0→1 + 新进程 | 复活 + 可签发 + 零审计 | 全部命中 | **成立** → D-27 | A.2 |
| G4A-N9d | REPLACE meta ledger_seq 归零 | head 变 0 | 命中 | **成立** → D-29 | A.2 |
| G4A-N9e | guard 中置注释 ×3 + upsert | RAW_SQL_REFUSED | 全穿；journal 行被改；有触发器表撞触发器（对照） | **成立** → D-30 | A.2 |
| G4A-N9f | 逐表真冲突 REPLACE 矩阵 | H 五表 ABORT，其余 SUCCESS | 精确命中预期 | 覆盖面数字交付 | A.2 |
| G4A-D26-绕 ×6 | 前导/尾随空格、大小写、U+2011 同形字、tab+LF、组合形 | 注册过 + 见证 false | 6/6 注册绕过成立、6/6 见证 false | **两面各半成立** | A.3 |
| G4A-D26-空 | `''` 缺轴拒；`' '` 过注册 + `grant(' ')` | false / true | `''`⇒ACTIVATION_IMPOSSIBLE；`' '`+grant ⇒ 见证 **true** | **成立**（卫生判据缺口） | A.3 |
| G4A-D26-镜 | `capability-admin-x` 前缀扩充形 | 注册过 | 注册成功（排除是名单精确匹配非语义/前缀匹配——语义上是**对的行为**，登记备查） | 不成立（行为正确） | A.3 |
| G4A-C1 | 撤销×历史×停用×见证同世界 | 各时序判据 | 全绿（未授权撤回不计、停用窗口写拒读开、v2 伪造行翻案、再撤再翻） | 组合判据复钉（撤销×历史×停用×见证四元行为与契约一致） | A.3 |
| G4A-C2 | eventsOf 跨读字段清单 | 精确字段 | `{seq,actor,authority{axis,capability,authorized},payload}`；detail 泄露 owner | 登记加宽 E-01' | A.3 |
| G4A-C3 | 12 怪 policyVersion 全谱 | 全 fail-closed 不崩 | 12/12 | N6/N7 复钉 | A.3 |
| D-26 穷尽检查 | worktree 内把 `MechanismResource` 加成员 `'ledger-admin'` 不动数组 ⇒ tsc 必须红 | 红 | `contracts/index.ts(76,14): error TS2322 … COMPILE_ERROR`（原文见 §④）；数组同步后绿；还原 hash 复核 OK | **编译期穷尽检查可信度=真**（反向不对称：数组多联合外成员仍绿=排除只多不少，保守方向，登记） | §④ |
| GT4-a | 整删 1 个测试文件（d26，4 例）⇒ 必须红 | 漂移红 | 「实测 163 例 ≠ 锚 167 例」FAIL | 修复确认 | §③-GT4' |
| GT4-b | 在 tests/ 加 1 条测试 ⇒ 必须红 | 漂移红 | 「实测 168 例 ≠ 锚 167 例」FAIL | 修复确认 | §③-GT4' |
| GT4-c | **等量替换**（删 4 真 + 补 4 空） | 若只锚计数 ⇒ PASS | **PASS**，打印「167 例全绿，与覆盖面锚逐等」 | **成立**（GT-2 作者流同构） | §③-GT4' |
| GT4-d | 有红状态下 `--reanchor` | 拒写 + 锚不动 | 「拒绝写锚：作者测试当前不干净」exit=1，锚文件 `git hash-object` 逐字节不变 | 修复确认 | §③-GT4' |
| GT4-e | 先造红修成绿再重锚 / 正常 +1 重锚 | 拒 or 合法记录 | 拒写路径=GT4-d；+1 真测试干净重锚成功（168），门禁绿——锚改写的唯一外部痕迹是文件 diff | 修复确认 + 边界登记 | §③-GT4' |
| GT-3 | 全链重放 | — | 未做（本包未触；沿 G3-A 结论） | — | §⑤ |

---

## ③ 新发现（定级 + 最小复现 + 修复前后两态）

### D-27（P1·完整性/安全决策回滚）`capability_route` 的 REPLACE 无审计撤销停用 —— 建议新行入账

**洞**：包 4 把 `PRAGMA recursive_triggers=ON` 当"append-only 补漏"，但 REPLACE 的隐式删除
**只触发 DELETE 触发器**，而 `capability_route` 没有任何触发器。装配裸面一条 SQL 即把运维的
**停用决策**（`capability-admin` 轴、`setRouteEnabled` 唯一入口、ledger/journal 审计）静默回滚；
`activate()` 优先读持久路由，新进程视该能力为激活——D-25 的跨进程语义被反向利用。

**最小复现**（附录 A.2 `G4A-N9c`，worktree 根直接跑）：
```bash
npx vitest run --config experiments/v3-code-architecture-poc/vitest.config.ts \
  experiments/v3-code-architecture-poc/attacks/review/g4a-n9-tables.test.ts -t G4A-N9c
```
时序：`unloadCapability(CAP_RECORDS)` → 持久列 enabled=0 → 裸面
`replace into capability_route(... enabled ...) values(...,1,-1)`（changed_seq 一并伪造）→
`close()` → 新 `openWorld` → `registry.capability(CAP_RECORDS)` **有值**、
`appendAuthoritativeEvent` 返回 **NO_REFUSAL**。全程 ledger 零新行。

**修复前态（当前）**：成功，零审计。**修复后两态判据（建议修法）**：
`capability_route` 补 `before delete` + `before update` 触发器 abort（路由变更收进
`setRouteEnabled` 唯一入口的理由与其可审计性一致）；guard 正则换成**token 级检查**（剥**所有**注释
后按首关键字族判）并把 `on conflict ... do update` 列入被禁形态。验收探针 = 本文件 G4A-N9c 语义反转
（REPLACE 必须撞 `ROUTE_FROZEN`，`setRouteEnabled` 照常）。**注**：`capability_route` 设计上"路由表可改"
（sqlite-port.ts L50-51 注释），但"可改"的合法通道已经是 `setRouteEnabled`+审计——触发器封裸面不破坏设计。

### D-28（P2·身份冻结支点）`object_directory` 无 DELETE 触发器：RD-01 在存储层从未闭合

REPLACE 可改任意列（含 `created_seq`、`owner_capability`）；`DELETE FROM object_directory` 直接
存在性抹除。owner 换假 ⇒ 该对象全部读路径 `CAPABILITY_INACTIVE` 且**机制内无救济**（目录行 UPDATE
被触发器拦，改回来都做不到——只有裸面 DELETE+INSERT 可救，而这本身就是被攻击面）。
**连带支点（按父席要求在台账明写）**：
- **RD-01**（kind/space 创建即固定）：UPDATE 有触发器、DELETE 没有 ⇒ "固定"是半门；
- **D-24 ①**（幽灵 oid `write()` 判据）：判据的**正源**是这张表，表行可被抹 ⇒ 判据地基在裸面上不闭合；
- **routeNs / SCHEMA_INCOMPATIBLE 读面判据**（kernel.ts:222-229）："实现换包未迁移 fail-loud" 依赖
  目录行 `ns` 与路由一致——REPLACE 可把目录行改成与**伪造路由**一致，fail-loud 判据被喂假输入；
- **Q12**（领域权威数据的归属）：`owner_capability` 一行可改 ⇒ 归属即权限的前提在存储层有洞；
- **ID-01**（ObjectID 永不复用）与 `auditRequiredIntegrity`：目录行可删 ⇒ 巡检可被裸面静默"修好"。

**修法**：`before delete` 触发器 abort（`DIRECTORY_IDENTITY_FROZEN` 复用同码）；REPLACE 面同 D-27。
验收探针 = G4A-N9b 语义反转。**定级注**：可达面与 N9 同级（装配裸面），比 D-27 低一档按父席裁定记 P2；
但 owner 改写 = 未经 `capability-admin` 的权限再分配，其**读侧 DoS 无救济**这点若按"运维之外的
代码缺陷先触发 REPLACE 前置改写"考虑，可向 P1 上探——留给父席/用户裁。

### D-29（P3·单列）`meta.ledger_seq` 可归零：H 序号单调性无保护

`replace into meta ...` / `insert ... on conflict(key) do update set value=0` 均成功，
`kernel.head` 从 1 变 0。后果：xc28 缺口检测（H 序号连续性即其正源）与一切按 seq 的截点读失去
单调前提；后续 append 撞号或产生"同一 seq 两次解释"。**修法**：meta 计数键由触发器只允许
**增**（`before update ... when new.value < old.value then abort`）；验收探针 = G4A-N9d 反转。

### D-30（P3·纵深失效）guard 关锚正则被中置注释穿过；`ON CONFLICT DO UPDATE` 不在被禁名单

`normalizeSql` 只剥**前导**注释（sqlite-port.ts:26-33），`FORBIDDEN_REPLACE_FORM` 锚定 `^`，
`insert/*c*/or replace`、`replace/*c*/into`、`insert--x⏎or replace` 全部穿过（G4A-N9e 实测改写生效）；
`on conflict do update` 从未列入被禁写法——对无触发器表它正是逐字段静默改写。
**修复前态**：如上。**修复后**：guard 应剥**全部**注释后取首 token 序列判形态，被禁形态 =
{REPLACE 语义, DO UPDATE/DO NOTHING(限 meta/route 键), 多语句(现有)}；或干脆 token 白名单
（insert/select/update-where-triggered-tables-abort…）。验收探针 = G4A-N9e 语义反转。
**诚实对照**：对 H 五表，这些绕过全部撞触发器（pragma 兜住）——本条废的是"先于触发器拒"的**纵深承诺**，
不是 H 本体。

### N3'（P2·文档主张被否证 + 门 2 判据边界建议）

被否证的**文档主张**（READINESS.md:142 残余清单 + 测试头注 L22-23）：
> 「两层以上包装与 Proxy ownKeys 欺骗（N3g，理论形态）——**由门 1 的 AST 面**与『白名单为空』纪律**兜**」

否证实测（G4A-N3a）：`class BundleDeep { bundle: unknown; constructor(f: unknown) { this.bundle = { deep: { face: f } }; } }`
——门 1 AST 零命中（无参数属性/修饰符/访问器/defineProperty 的任何语法），门 2 返回 `[]`，
`inst.bundle.deep.face.writerFor(...)` 可走通。**AST 门只认四种语法形态，裸赋值构造的深度包装
不产生其中任何一种**；「能构造这种实例的类必须现形」为假。**这是"把未经检验的安慰话写进残余清单"
——与四次"期望写成事实"同族，方向相反（这次是把兜底能力写过头）。**

**门 2 正确判据边界（本席观点，含对父席"递归到底+含 Map/Set 值"提议的回应）**：
同意**必须递归到底**并**含数组值**，但建议两条修正：
1. **递归成本用深度上限 + 图记忆化封顶**（如 depth≤5、WeakSet 防环），而非无限递归——窄面实例
   本就不该有深结构，上限本身就是一条判据；
2. **Map/Set 不需要特判"值面递归"**——G4A-N3f 实测它们已被保守拦住（原型方法触发 callableSurface）；
   真正的洞是 **数组**（Array.prototype 显式跳过 + 非 plain-object 不递归）与**原型注入**。数组建议
   显式递归其元素（索引是自有键，`for (const k of Object.getOwnPropertyNames(arr))` 即可覆盖）。
3. **门 2 应同时查实例原型链的自有属性**（`for (let o = Object.getPrototypeOf(inst); o && o !== Object.prototype; o = Object.getPrototypeOf(o)) Reflect.ownKeys(o)` 排除 constructor，对类自有原型报泄漏）——否则 G4A-N3c/N3e 双盲形态永久出格。
   代价：类方法本来就在原型上、全是函数——但门 2 的清单对象是**领域/用例的协作类**，其**自有类**
   原型上的任何键都可保守拦（现有 6 个被扫类恰好零自有原型方法，实测零误报——本席验证过）。

### GT4'（P2·GT-2/GT-4 = 同一洞的两面）等量替换实证 + 锚形态建议

**门禁打印原文**（worktree `hold/gt4c.log`，删除 `tests/d26-authority-axis.test.ts`(4 例真测试) +
新增 `tests/g4a-vacuous.test.ts`(4 条 `expect(1).toBe(1)`)，**未跑 --reanchor**）：
```
[2/3] 作者测试门（tests/**，0 红是硬条件）
  OK —— 167 例全绿，与覆盖面锚逐等（skip=0，exit=0，success=true）
```
对照实验（同脚本 `hold/gt4-run.sh`，附录 B 全文）：删 4 例 ⇒ `实测 163 例 ≠ 锚 167 例` 红；
加 1 例 ⇒ `实测 168 例 ≠ 锚 167 例` 红；有红 `--reanchor` ⇒ 「拒绝写锚」exit=1 + 锚文件 hash 不变；
干净 +1 重锚 ⇒ 合法改写 167→168。**"先造红→修成绿→重锚"链等价于 GT-3 自洽重算吗？** 部分等价：
拒写判据封住了"带红重锚"，但**锚本身无任何外部锚点**——`total` 字段写了但判据从不比对，
**无文件清单/测试身份哈希**，锚的唯一内容就是那个可随等量替换保持不变的自然数。
另有一处**文档与行为不符**（父席已认领，按原样入账不圆）：g0-gate.mjs L37 注释称
`AUTHOR_ANCHOR.json 记录 passed / files / 生成提交`，实际键集 =
`["generated_from_commit","passed","total","note"]`——**没有 `files`，`total` 无判据引用**。

**建议锚形态（身份 > 计数）**：
```jsonc
{ "generated_from_commit": "...",            // 现有，保留
  "passed_sha256": "<sha256(sorted fullName 集合逐行 join)>",  // 新：身份集合摘要
  "files_sha256":  "<sha256(tests/**/*.test.ts 相对路径+内容哈希清单)>", // 新：文件面清单
  "passed": 167, "total": 167 }              // 保留作可读冗余；判据以两个 sha 为准
```
判据 = 两 sha 逐等；`--reanchor` 拒写条款原样保留。runVitest 已收集 `passNames`（L57），实现是现成数据。
**绕过成本分析**：(1) 删真测试+补空 ⇒ `passed_sha256` 变 ⇒ 红（现有形态漏的就是这个）；
(2) **改名+重写**（vacuous 测试改成与原名同名）⇒ `files_sha256` 变 ⇒ 红——两条主通道都断；
(3) 残余：对**同一文件只改测试体不改任何名字**且保持全绿 ⇒ 两 sha 都不变——这已经不是"覆盖面漂移"，
是"该测试自身的断言强度"问题，属 GT-2 的审查方面（断言掏空），**任何锚都拦不住断言层面的掏空**，
只能靠变异验证纪律（本包 n6/n3 文件自身就有血统副本可查）。这是我认为唯一自洽的边界表述；
父席说"GT-2 与 GT-4 是同一个洞的两面"——同意，且建议台账把两条并成一个治理项（身份锚 + 变异采样），
不要各自收口又留中间缝。

### 逐表矩阵原文（G4A-N9a/N9f stdout，覆盖面数字交付）

```
表                 no_delete  no_update   真冲突 REPLACE pragma=ON
meta               false      false       SUCCESS
ledger             true       true        ABORT(HISTORY_IMMUTABLE)
object_directory   false      true        SUCCESS ← RD-01 半门（只有 UPDATE 触发器）
capability_route   false      false       SUCCESS ← D-27
domain_state       true       true        ABORT
records            true       true        ABORT
journal            false      false       SUCCESS（设计可删）
projection_state   false      false       SUCCESS
projection_cursor  false      false       SUCCESS
ref_edge           true       true        ABORT
check_report       true       true        ABORT
```
（作者 N9-1 种子核验：其 REPLACE 撞的是它自己刚签发的 seq ⇒ **真冲突，测试不虚**。）

---

## ④ 逐 hunk 裁定（本包 14 文件，重点 g0-gate.mjs 作者流）

**`g0-gate.mjs`（aed186d，+47/−5）——无"为变绿放宽"**：
① 删除 `AUTHOR_MIN_PASSED=90` 换锚逐等判据：方向是**收紧**（旧判据可通过的形态现在全红：GT4-a/b 实证）；
② 原 0 红硬条件（status/success/skipped/failed.size 四条）**一条未动**，新锚判据挂在其后（else-if 链），
   顺序意味着"有红时锚判据根本轮不到"——正确；
③ `--reanchor` 拒写判据（红/skip/非零/不可解析四条件）方向收紧，实测拒写 + 锚文件 hash 不变（GT4-d）；
④ 锚缺 `files` 字段、`total` 无判据（§③-GT4'）：**新增面自身的文档超前**，不是放宽；
⑤ attacks 流三组判据（passes/failures 双身份集合）**一字未动**（diff 无该行族）。
**结论：本文件改动干净，无一处把红读成绿；遗留是锚的身份强度（GT4'），非放宽。**

**`src/contracts/index.ts`（+12）**：`MECHANISM_RESOURCES` + `Exclude` 穷尽检查。
编译期可信度**实测为真**：worktree 内仅扩类型联合 ⇒ tsc 红，原文：
```
src/contracts/index.ts(76,14): error TS2322: Type 'boolean' is not assignable to type
'{ COMPILE_ERROR: "MECHANISM_RESOURCES 未覆盖 MechanismResource 全联合"; }'
```
数组同步后转绿；还原 `git hash-object` == `git rev-parse HEAD` 复核 OK。
（反向不对称登记：数组多一个联合外成员仍编译绿——运行时排除只会更宽，保守方向，可接受。）

**`src/kernel/kernel.ts`（+14）**：D-26 排除谓词。位置正确（`formalEvents.set` 之前、与缺轴判据同族按序）、
码值正确（ACTIVATION_IMPOSSIBLE 装配期零签发）、Kernel 零业务词（domain-admission 不在 kernel.ts，
arch 门复跑绿）。残余=精确串比较（D26 绕 系列，已定级 P2 卫生项）。**通过。**

**`src/domains/test-records.ts`（+24/−2）**：`lookupStandingRule`（hasOwnProperty + typeof function），
`in` 与裸下标清除。N6/N7 全谱绿（G4A-C3）。**通过。**

**`src/storage-sqlite/sqlite-port.ts`（+17）**：pragma 位置正确（Adapter 构造，每连接生效，
`openSecond`/`restart` 同源）；guard 正则按名匹配。**H 五表面通过；覆盖面主张不通过**（D-27/28/29/30）。

**`tests/n3-parameter-property-gate.test.ts`（+267/−100）**：门 1 AST 化 + 门 2 双 descriptor + 旧门副本
血统 + 变异锚 3 例 + 镜像判据 + 白名单为空断言——结构是全仓门里最讲究的一份。不闭合处即 §③-N3'。

**`tests/n6-n7-frozen-table-prototype.test.ts`（+87）**：FIXPROBE 1:1 移植，"作者只负责让它绿"的
血统声明与 G3-A 附录逐字对照**属实**（断言一字未动，import 深度改动声明亦属实）。

**`tests/d26-authority-axis.test.ts`（+86）**：4 例覆盖两轴拒/正当轴/怪轴 false，与本席 D26 系列互补
（作者测了字面轴，本席测了等价形——两面合上才是完整登记）。

**`tests/n9-replace-append-only.test.ts`（+103）**：N9-1 种子真冲突（见 §③）；N9-2 只测 canonical 形态，
"guard 对无触发器表同拒"对形态族不成立（D-30）。

**`READINESS.md`（9 增 9 删）/`CONTRACTS.md`（+44/−3）/`AUTHOR_ANCHOR.json`（新）/`docs/README.md`（+1）/
`KERNEL_SURFACE.sha256`（1 改）**：文档改动与机制一致，包 4 的 D-25 文档纠正保留了旧句痕迹（好纪律）；
N9 行的"append-only 这一核心不变量"与 GT-4 行的"少 1 例即红"（对等量替换不成立）为**两处需再补正的
过度主张**；`KERNEL_SURFACE.sha256` 变更与 E-01 行"插件可见成员零新增"声明的核验未做（§⑤-4）。
`BASELINE.json` 与 attacks 流 **零改动**（`git show --name-only` 三提交核对毕）。

---

## ⑤ 未能验证清单（真实，不凑数）

1. **GT-3 全链重放**（含"改名提交在 CI 面的流转"）——本包未触 attacks 流，未重做 G3-A 已实测的通道；
2. **N5 吸收形态重放**——判据未动，未重打第三遍；
3. **真·双 OS 进程常驻 + WAL 调度时序**（D-25 陈旧窗口宽窄）——沿用 G3-A 双 World 代理结论；
4. **`KERNEL_SURFACE.sha256` 清单逐项**是否含 `principalCan`/`appendAuthoritativeEvent` 新面——只核对了
   "包 4 无新增插件成员"的结论方向；
5. **v4→v5 旧库升级器**真实文件复跑；
6. **32 条基线红逐条语义复核**——只核对了计数与"与基线完全一致"的判据强度；
7. **门 2 改"递归到底"后的墙钟成本**（167 例基线 + 深结构夹具的耗时）——只给了设计建议未实测；
8. **裸面更深形态**（writable_schema/ATTACH/CLI 直改文件）——沿 G3-A 的"正常 SQL 路径"约定面外。

---

## 附录 A：攻击文件全文（三件 35 例，落盘路径 `experiments/v3-code-architecture-poc/attacks/review/`，
## worktree 销毁后按本附录逐字落盘即可复跑）

（全文见本文件末尾 A.1/A.2/A.3 段——由 `cat` 原样拼入，未做二次排版。）

## 附录 B：GT-4 实验脚本全文（`hold/gt4-run.sh` 原样）

### A.1 `g4a-n3-gate-attacks.test.ts`
```ts
/**
 * G4-A 攻击① —— N3 包 4 新门的打穿尝试（AST 门 + 双 descriptor 门 2）。
 *
 * 判据实现 = `tests/n3-parameter-property-gate.test.ts` L111-251 的**逐字副本**
 * （astLeaks / callableSurface / runtimeLeaks / isWrapperObject / modsOf；作者自己的文件
 * 也用同一手"旧门副本"纪律做红→绿血统，本席照抄以保持裁决与被审门一字不差）。
 * 唯一改动：删去仅作者文件内部使用的辅助（旧门副本、实例清单）。
 *
 * 每条测试的名字就是裁决；「漏检」= 攻击形态存在而门返回零命中。
 */
import { describe, expect, test } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import ts from 'typescript-6';
import { POC_ROOT } from '../../src/harness/paths.ts';
import { openWorld, PRINCIPAL } from '../../src/harness/world.ts';
import { TEST_OBJECT_MODEL } from '../../src/domains/test-object-model.ts';
import { mkdtempSync, rmSync } from 'node:fs';
import { POC_DATA_DIR } from '../../src/harness/paths.ts';

// ══════════════ 门 1（AST）副本：tests/n3-parameter-property-gate.test.ts L111-176 ══════════════
type LeakKind = 'param-property' | 'accessibility-field' | 'accessor' | 'defineProperty-injection' | 'unparseable';
interface AstHit { file: string; line: number; kind: LeakKind; detail: string }
const PARAM_MODS = new Set([ts.SyntaxKind.PrivateKeyword, ts.SyntaxKind.ProtectedKeyword,
  ts.SyntaxKind.PublicKeyword, ts.SyntaxKind.ReadonlyKeyword]);
const ACCESSIBILITY_MODS = new Set([ts.SyntaxKind.PrivateKeyword, ts.SyntaxKind.ProtectedKeyword, ts.SyntaxKind.PublicKeyword]);
const modsOf = (n: ts.Node): readonly ts.ModifierLike[] =>
  ts.canHaveModifiers(n) ? ts.getModifiers(n) ?? [] : [];

function astLeaks(relFile: string, src: string): AstHit[] {
  const sf = ts.createSourceFile(relFile, src, ts.ScriptTarget.ESNext, true, ts.ScriptKind.TS);
  const hits: AstHit[] = [];
  const lineOf = (pos: number): number => sf.getLineAndCharacterOfPosition(pos).line + 1;
  const parseDiagnostics = (sf as unknown as { parseDiagnostics?: readonly ts.DiagnosticWithLocation[] }).parseDiagnostics ?? [];
  for (const d of parseDiagnostics) {
    hits.push({ file: relFile, line: sf.getLineAndCharacterOfPosition(d.start).line + 1, kind: 'unparseable',
      detail: `解析诊断：${ts.flattenDiagnosticMessageText(d.messageText, ' ')}` });
  }
  const walk = (n: ts.Node): void => {
    if (ts.isConstructorDeclaration(n)) {
      for (const p of n.parameters) {
        const m = modsOf(p);
        if (m.some((x) => PARAM_MODS.has(x.kind))) {
          hits.push({ file: relFile, line: lineOf(p.getStart(sf)), kind: 'param-property',
            detail: `构造参数「${p.getText(sf).slice(0, 60)}」带修饰符 = 运行时自有可枚举属性` });
        }
      }
    }
    if (ts.isPropertyDeclaration(n) && modsOf(n).some((x) => ACCESSIBILITY_MODS.has(x.kind))) {
      hits.push({ file: relFile, line: lineOf(n.getStart(sf)), kind: 'accessibility-field',
        detail: `字段「${n.name.getText(sf)}」带 TS 可见性修饰符 = 编译期隐私、运行时可枚举` });
    }
    if (ts.isAccessor(n)) {
      hits.push({ file: relFile, line: lineOf(n.getStart(sf)), kind: 'accessor',
        detail: `访问器「${n.name.getText(sf)}」= N3e 泄漏形态的源码面（getter 可返回任意协作对象）` });
    }
    if (ts.isCallExpression(n) && ts.isPropertyAccessExpression(n.expression)
      && ts.isIdentifier(n.expression.expression) && n.expression.expression.text === 'Object'
      && ['defineProperty', 'defineProperties'].includes(n.expression.name.text)
      && n.arguments.length > 0 && n.arguments[0].kind === ts.SyntaxKind.ThisKeyword) {
      hits.push({ file: relFile, line: lineOf(n.getStart(sf)), kind: 'defineProperty-injection',
        detail: 'Object.defineProperty(s)(this, …) 向实例注入成员 = N3c/N3e 注入口，领域/用例行禁用' });
    }
    ts.forEachChild(n, walk);
  };
  walk(sf);
  return hits;
}
const kindsOf = (src: string): string[] => astLeaks('G4A', src).map((h) => h.kind);

// ══════════════ 门 2（运行时）副本：tests/n3-parameter-property-gate.test.ts L204-251 ══════════════
const faceStub = { writerFor() { return null; } };
const isWrapperObject = (v: object): boolean => {
  const p = Object.getPrototypeOf(v) as object | null;
  return p === Object.prototype || p === null;
};
function callableSurface(v: unknown, depth = 0): boolean {
  if (typeof v === 'function') return true;
  if (v === null || typeof v !== 'object') return false;
  for (const o of [v as object, Object.getPrototypeOf(v) as object | null]) {
    if (!o || o === Object.prototype || o === Array.prototype) continue;
    for (const k of [...Object.getOwnPropertyNames(o), ...Object.getOwnPropertySymbols(o)]) {
      if (k === 'constructor') continue;
      const d = Object.getOwnPropertyDescriptor(o, k);
      if (!d) continue;
      if (d.get !== undefined || d.set !== undefined) return true;
      if (typeof d.value === 'function') return true;
    }
  }
  if (depth < 1 && isWrapperObject(v)) {
    for (const k of [...Object.getOwnPropertyNames(v), ...Object.getOwnPropertySymbols(v)]) {
      const d = Object.getOwnPropertyDescriptor(v, k);
      if (!d) continue;
      if (d.get !== undefined || d.set !== undefined) return true;
      if (d.value !== v && callableSurface(d.value, depth + 1)) return true;
    }
  }
  return false;
}
const runtimeLeaks = (label: string, inst: object): string[] =>
  Reflect.ownKeys(inst)
    .filter((k) => {
      const d = Object.getOwnPropertyDescriptor(inst, k);
      if (!d) return false;
      if (d.get !== undefined || d.set !== undefined) return true;
      return callableSurface(d.value);
    })
    .map((k) => `${label}.${String(k)}`);

// ══════════════════════════ 攻击 ══════════════════════════

describe('G4-A 攻击①-A：门 2 的包装面（登记残余的实测边界）', () => {
  test('G4A-N3a 两层 plain-object 包装 {a:{b:{face}}} 漏检——且登记兜底句不成立：同形态的**裸赋值构造函数**在门 1 同样零命中', () => {
    // 运行时面：门 2 只递归一层 ⇒ 两层失明（这一半是作者如实登记的残余）……
    const inst = Object.assign(Object.create(Object.prototype), { a: { b: { face: faceStub } } });
    expect(((((inst.a as { b: { face: unknown } }).b).face))).toBe(faceStub); // 泄漏是真的
    expect(runtimeLeaks('inst', inst), '漏检确认：门 2 对两层包装返回空').toEqual([]);
    // ……但登记的兜底主张「能构造这种实例的类必须在 src/domains|src/app 的源码扫描里现形」是假的：
    // 构造两层包装最自然的写法就是裸赋值，它不含参数属性/可见性修饰符/访问器/defineProperty。
    const source = `class BundleDeep {
      bundle: unknown;
      constructor(f: unknown) { this.bundle = { deep: { face: f } }; }
    }`;
    expect(kindsOf(source), '兜底句否证：AST 门对能造出两层泄漏的类零命中').toEqual([]);
    const deep = new (class BundleDeep { bundle: unknown; constructor(f: unknown) { this.bundle = { deep: { face: f } }; } })(faceStub);
    expect(runtimeLeaks('deep', deep)).toEqual([]);
    // (deep.bundle as any).deep.face 即协作对象——两道门同时放过一个可走通的泄漏。
  });

  test('G4A-N3b 数组包装 [face] / 对象里的数组漏检（Array.prototype 被跳过 + 非 plain 不递归）', () => {
    const inst = Object.assign({}, { faces: [faceStub] });
    expect((inst.faces as unknown[])[0]).toBe(faceStub);
    expect(runtimeLeaks('inst', inst)).toEqual([]);
    // 兜底句同否证：裸赋值 `this.faces = [f]` AST 门零命中
    expect(kindsOf(`class A { faces: unknown; constructor(f: unknown) { this.faces = [f]; } }`)).toEqual([]);
  });

  test('G4A-N3c 原型注入 Object.getPrototypeOf(this).face = f：门 1 与门 2 双盲（P2-3 同族的现行实例）', () => {
    class ProtoLeak {
      #f: unknown;
      constructor(f: unknown) { this.#f = f; (Object.getPrototypeOf(this) as Record<string, unknown>).face = f; }
    }
    const p = new ProtoLeak(faceStub);
    expect((p as unknown as { face: unknown }).face).toBe(faceStub); // 运行时可达
    expect(runtimeLeaks('p', p)).toEqual([]);            // 门 2 只查实例自有键
    expect(kindsOf(`class ProtoLeak { #f: unknown; constructor(f: unknown) { this.#f = f; (Object.getPrototypeOf(this) as Record<string, unknown>).face = f; } }`))
      .toEqual([]);                                      // 门 1 只认 defineProperty(this,…)
  });

  test('G4A-N3d 生成代码模板字符串里的类：AST 门看不见字符串内容（理论面，登记）', () => {
    const gen = 'const CODE = `class Gen { constructor(private face: unknown) {} }`; export default CODE;';
    expect(kindsOf(gen), 'AST 对模板字符串内容零可见性（域内出现 codegen+动态装载即绕过两门）').toEqual([]);
  });

  test('G4A-N3e 别名化注入 dp=Object.defineProperty / Reflect.defineProperty：门 1 失明，门 2 兜住直接自有面', () => {
    const src = `class A { constructor(f: unknown) { const dp = Object.defineProperty; dp(this, 'face', { value: f, enumerable: true }); } }`;
    expect(kindsOf(src), '门 1 只匹配字面 Object.defineProperty(this 调用点').toEqual([]);
    class Aliased { constructor(f: unknown) { const dp = Object.defineProperty; dp(this, 'face', { value: f, enumerable: true }); } }
    expect(runtimeLeaks('a', new Aliased(faceStub))).toEqual(['a.face']); // 门 2 兜住
    class Reflected { constructor(f: unknown) { Reflect.defineProperty(this, 'face', { value: f, enumerable: true }); } }
    expect(kindsOf(`class R { constructor(f: unknown) { Reflect.defineProperty(this, 'face', { value: f, enumerable: true }); } }`)).toEqual([]);
    expect(runtimeLeaks('r', new Reflected(faceStub))).toEqual(['r.face']);
    // 组合形态（别名注入 + 两层包装）则两门全瞎：
    class Combo { constructor(f: unknown) { Reflect.defineProperty(this, 'b', { value: { deep: { face: f } }, enumerable: true }); } }
    expect(kindsOf(`class C { constructor(f: unknown) { Reflect.defineProperty(this, 'b', { value: { deep: { face: f } }, enumerable: true }); } }`)).toEqual([]);
    expect(runtimeLeaks('c', new Combo(faceStub)),
      '组合形态双盲：门 1 不认识 Reflect.defineProperty；门 2 的 callableSurface 对值 {deep:{face}} 判 false ⇒ 键都不报')
      .toEqual([]);
    expect((((new Combo(faceStub) as unknown as { b: { deep: { face: unknown } } }).b).deep).face).toBe(faceStub); // 泄漏真可走
  });
});

describe('G4-A 攻击①-B：门 2 的其他句柄容器（诚实登记：这些被兜住）', () => {
  test('G4A-N3f Map/Set 句柄被保守拦（其原型自带方法 ⇒ callableSurface 真）', () => {
    const m = Object.assign({}, { handles: new Map([['f', faceStub]]) });
    expect(runtimeLeaks('m', m)).toEqual(['m.handles']);
    const s = Object.assign({}, { handles: new Set([faceStub]) });
    expect(runtimeLeaks('s', s)).toEqual(['s.handles']);
  });
  test('G4A-N3g wrapper 里的 Symbol.toPrimitive getter 被拦（own accessor 保守拦，递归面也查 Symbol 键）', () => {
    const w = Object.assign({}, { b: { [Symbol.toPrimitive]: (h: unknown) => faceStub } });
    expect(runtimeLeaks('w', w)).toEqual(['w.b']);
  });
});

describe('G4-A 攻击①-C：AST 门的语法形态穷举（预期=都能抓；漏一条就是新洞）', () => {
  const cases: [string, string][] = [
    ['declare 字段（无运行时实体，仍被 accessibility-field 拦=保守向，可接受）', `class A { declare private x: number; }`],
    ['abstract 构造器 + 参数属性', `abstract class A { protected constructor(private readonly f: unknown) {} }`],
    ['装饰器参数属性', `class A { constructor(@dec() private readonly f: unknown) {} }`],
    ['mixin：extends 表达式内的类表达式', `const B = class { constructor(private f: unknown) {} }; class X extends makeB(B) {}`],
    ['函数内局部类', `function f() { class L { constructor(private x: unknown) {} } return new L(1); }`],
    ['构造器重载签名 + 实现体带修饰符', `class A { constructor(a: unknown); constructor(private a: unknown) {} }`],
    ['交叉/类型别名里的 readonly（不该误报）', `type T = { readonly a: string }; class A { constructor(t: T) {} }`],
    ['嵌套默认值对象里的括号', `class A { constructor(o = { x: (1 + 2) }, private f?: unknown) {} }`],
    ['正则字面量里的括号', `class A { constructor(re = /[(]/, private f?: unknown) {} }`],
    ['模板字符串默认值含右括号（G3-A N3b 升级形）', 'class A { constructor(t = `)${1+1}`, private f?: unknown) {} }'],
  ];
  for (const [name, src] of cases) {
    test(`G4A-N3h ${name}`, () => {
      const k = kindsOf(src);
      if (src.includes('type T =')) expect(k, '类型注解 readonly 不误报（作者锚点之外再钉）').toEqual([]);
      else expect(k.length, `必须命中（漏检=新洞），实测 kinds=${JSON.stringify(k)}`).toBeGreaterThan(0);
    });
  }
});

describe('G4-A 攻击①-D：扫描面量化（G3-A 观察项的定量交付）', () => {
  test('G4A-N3i src/domains|src/app 之外的泄漏形态逐文件计数 + 插件可达性核对', () => {
    const walk = (d: string): string[] => readdirSync(d, { withFileTypes: true })
      .flatMap((e) => e.isDirectory() ? walk(join(d, e.name)) : [join(d, e.name)]);
    const files = walk(join(POC_ROOT, 'src')).filter((f) => f.endsWith('.ts'))
      .filter((f) => !f.replace(POC_ROOT + '/', '').startsWith('src/domains') && !f.replace(POC_ROOT + '/', '').startsWith('src/app'));
    const hits = files.flatMap((f) => astLeaks(f.replace(POC_ROOT + '/', ''), readFileSync(f, 'utf-8')));
    const byKind: Record<string, number> = {};
    for (const h of hits) byKind[h.kind] = (byKind[h.kind] ?? 0) + 1;
    console.log('[G4A-N3i] 扫描面外命中', JSON.stringify(byKind), '明细：');
    for (const h of hits) console.log(`  ${h.file}:${h.line} ${h.kind} ${h.detail.slice(0, 80)}`);
    // 可达性核对：插件窄面对象**不是**任何带参数属性的类的实例；Kernel/Adapter 实例只在装配面。
    const w = openWorld({ file: join(mkdtempSync(join(POC_DATA_DIR, 'g4a-n3i-')), 'x.db'), space: 'SP-G4A',
      grants: { a: ['space-write'] }, plugins: [TEST_OBJECT_MODEL] });
    try {
      const face = w.kernel.faceFor('cap.test.object-model'); // faceFor 不核验能力存在性——用真实注册 id 测
      // 窄面是对象字面量闭包——不是 class 实例；自有键里除字符串/数字外只有函数（面 API 本身）。
      expect(Object.getPrototypeOf(face)).toBe(Object.prototype);
      const objValued = Reflect.ownKeys(face).filter((k) => {
        const d = Object.getOwnPropertyDescriptor(face, k)!;
        return d.value !== null && typeof d.value === 'object';
      });
      expect(objValued, '窄面无对象值自有属性（协作对象都在闭包里）').toEqual([]);
      // 装配裸面对象 = SqlitePort 的 Adapter 实例：`private db` 在运行时是自有可枚举字段。
      const rawKeys = Reflect.ownKeys(w.raw).map(String);
      expect(rawKeys, 'SqlitePort.raw 暴露 Adapter：db(DatabaseSync) 运行时可枚举').toContain('db');
      console.log('[G4A-N3i] w.raw 自有键 =', rawKeys, '（装配面可达 DatabaseSync 本体）');
    } finally { w.close(); }
    // 断言刻意不设上限：本测交付的是**数字**（stdout），量化 G3-A 的"在面外"观察项。
  });
});
```

### A.2 `g4a-n9-tables.test.ts`
```ts
/**
 * G4-A 攻击③ —— N9 pragma 的历史面覆盖穷举 + guard 正则绕过面。
 *
 * 主张攻击点：包 4 的修法 = `PRAGMA recursive_triggers=ON`（让 REPLACE 的隐式删除触发
 * DELETE 触发器）+ guard 禁 `insert or replace`/`replace into` 两形态。
 * 但：① 隐式删除只触发 **DELETE** 触发器——`object_directory` 只有 UPDATE 触发器、
 * `capability_route`/`meta`/`projection_*` 无任何触发器 ⇒ pragma 对它们零保护；
 * ② guard 归一化只剥**前导**注释，**中置**注释（INSERT 与 OR 之间夹块/行注释）不在
 * `^(insert\s+or\s+replace|replace\s+into)` 的匹配面上。
 */
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { POC_DATA_DIR } from '../../src/harness/paths.ts';
import { openWorld, PRINCIPAL, type World } from '../../src/harness/world.ts';
import { TEST_OBJECT_MODEL } from '../../src/domains/test-object-model.ts';
import { TEST_RECORDS, CAP_RECORDS, FACT_DESIGNATION_EVENT, FACT_DESIGNATION_SCHEMA, FACT_STANDING_POLICY_VERSION } from '../../src/domains/test-records.ts';
import { SqlitePort } from '../../src/storage-sqlite/sqlite-port.ts';
import { asOid, type ObjectOid } from '../../src/contracts/index.ts';

const ADM = PRINCIPAL('g4an9adm');
const NOBODY = PRINCIPAL('g4an9nobody');
const GRANTS = {
  g4an9adm: ['space-write', 'capability-admin', 'domain-admission'],
  g4an9nobody: ['space-write'],
};
let dir: string;
beforeAll(() => { dir = mkdtempSync(join(POC_DATA_DIR, 'g4a-n9-')); });
afterAll(() => { rmSync(dir, { recursive: true, force: true }); });
const open = (name: string): World =>
  openWorld({ file: join(dir, `${name}.db`), space: 'SP-G4A9', grants: GRANTS,
    plugins: [TEST_OBJECT_MODEL, TEST_RECORDS] });
const outcome = (fn: () => unknown): string => {
  try { fn(); return 'NO_REFUSAL'; }
  catch (e) {
    const err = e as { code?: unknown; message?: unknown };
    const c = typeof err?.code === 'string' && err.code !== 'ERR_SQLITE_ERROR' ? err.code : String(err?.message ?? e);
    return c;
  }
};

describe('G4-A 攻击③：pragma 后的历史面逐表穷举', () => {
  test('G4A-N9a 触发器覆盖清单（sqlite_master 实测，非注释宣称）——无 DELETE 触发器的表 = pragma 保护不到 REPLACE 的表', () => {
    const w = open('n9a');
    try {
      const tables = w.raw.all<{ name: string }>(`select name from sqlite_master where type='table' and name not like 'sqlite_%'`).map((r) => r.name);
      const trig = w.raw.all<{ name: string; sql: string }>(`select name, sql from sqlite_master where type='trigger'`);
      const cov = tables.map((t) => ({
        table: t,
        no_delete: trig.some((x) => x.sql.includes(`before delete on ${t}`)),
        no_update: trig.some((x) => x.sql.includes(`before update on ${t}`)),
      }));
      console.table(cov);
      const noDelete = cov.filter((c) => !c.no_delete).map((c) => c.table).sort();
      expect(noDelete, 'pragma 只让 REPLACE 撞 DELETE 触发器；下列表没有 ⇒ 整行 REPLACE 替换在裸面照成功').toEqual(
        ['capability_route', 'journal', 'meta', 'object_directory', 'projection_cursor', 'projection_state']);
      expect(cov.find((c) => c.table === 'object_directory')!.no_update).toBe(true); // 只有 UPDATE 触发器
      expect(cov.find((c) => c.table === 'object_directory')!.no_delete).toBe(false);
    } finally { w.close(); }
  });

  test('G4A-N9b object_directory（RD-01 身份冻结面）：pragma=ON 时 REPLACE 仍整行改写 kind/owner/ns，读面端出伪造身份', () => {
    const w = open('n9b');
    try {
      expect(w.raw.get<{ recursive_triggers: number }>(`pragma recursive_triggers`)!.recursive_triggers).toBe(1);
      const oid = w.uow(ADM, (tx) => tx.createObject({ kind: 'test.claim', payload: { core: 1 } }));
      const before = w.raw.get<{ kind: string; owner_capability: string }>(
        `select kind, owner_capability from object_directory where oid=?`, oid)!;
      expect(outcome(() => w.raw.run(
        `replace into object_directory(oid, space, kind, owner_capability, ns, created_seq)
         values(?, 'SP-G4A9', 'test.claim', 'cap.test.object-model', 'dom_test_om', 424242)`, oid))).toBe('NO_REFUSAL');
      const after = w.raw.get<{ kind: string; owner_capability: string; created_seq: number }>(
        `select kind, owner_capability, created_seq from object_directory where oid=?`, oid)!;
      expect(after.created_seq, 'created_seq 被 REPLACE 伪造（UPDATE 会被触发器拦，REPLACE 不）').toBe(424242);
      // 对照：同一行的 UPDATE 被触发器拦——证明 REPLACE 走"隐式删除+插入"，UPDATE 触发器不在其路径上
      expect(outcome(() => w.raw.run(`update object_directory set created_seq=999 where oid=?`, oid))).toContain('DIRECTORY_IDENTITY_FROZEN');
      expect(before.kind).toBe('test.claim');
      // 后果 1：REPLACE 换 owner 为未注册能力 ⇒ 该对象所有读路径当场 CAPABILITY_INACTIVE（无机制内救济）
      expect(outcome(() => w.raw.run(`replace into object_directory(oid, space, kind, owner_capability, ns, created_seq)
        values(?, 'SP-G4A9', 'test.claim', 'cap.evil.taken', 'dom_test_om', 1)`, oid))).toBe('NO_REFUSAL');
      expect(outcome(() => w.readObject(asOid(oid)))).toContain('CAPABILITY_INACTIVE');
      // 后果 2：目录行没有 DELETE 触发器 ⇒ DELETE FROM 直接抹掉身份行（存在性破坏，比 REPLACE 更直接）
      expect(outcome(() => w.raw.run(`delete from object_directory where oid=?`, oid))).toBe('NO_REFUSAL');
      expect(w.raw.get(`select oid from object_directory where oid=?`, oid)).toBeUndefined();
    } finally { w.close(); }
  });

  test('G4A-N9c capability_route：REPLACE 把停用(enabled=0)的路由改回 enabled=1 并伪造审计 changed_seq ⇒ 新进程视图复活被停用能力（D-25 跨进程回滚）', () => {
    const file = join(dir, 'n9c.db');
    let w = openWorld({ file, space: 'SP-G4A9', grants: GRANTS, plugins: [TEST_OBJECT_MODEL, TEST_RECORDS] });
    try {
      const oid = w.uow(ADM, (tx) => tx.createObject({ kind: 'test.claim', payload: { core: 1 } }));
      w.unloadCapability(CAP_RECORDS, ADM);
      expect(w.kernel.registry.capability(CAP_RECORDS), '本进程已停用').toBeUndefined();
      const row = w.raw.get<{ enabled: number }>(`select enabled from capability_route where capability=?`, CAP_RECORDS)!;
      expect(row.enabled).toBe(0);
      // 裸面 REPLACE 回写 enabled=1（无触发器 ⇒ pragma 帮不上）
      expect(outcome(() => w.raw.run(
        `replace into capability_route(capability, plugin_id, ns, contract_version, enabled, changed_seq)
         values(?, 'test.records', 'dom_test_records', 'v1', 1, -1)`, CAP_RECORDS))).toBe('NO_REFUSAL');
      expect(w.raw.get<{ enabled: number }>(`select enabled from capability_route where capability=?`, CAP_RECORDS)!.enabled).toBe(1);
      w.close();
      // 新进程（restart / openSecond）activate() 读持久路由 ⇒ 停用被静默撤销，**零 ledger 审计**（REPLACE 不经 setRouteEnabled）
      const w2 = openWorld({ file, space: 'SP-G4A9', grants: GRANTS, plugins: [TEST_OBJECT_MODEL, TEST_RECORDS] });
      try {
        expect(w2.kernel.registry.capability(CAP_RECORDS), '停用被 REPLACE 撤销：新进程视能力为激活').toBeDefined();
        expect(outcome(() => w2.uow(NOBODY, (tx) => w2.kernel.faceFor(CAP_RECORDS).writerFor(tx)
          .appendAuthoritativeEvent({ eventType: FACT_DESIGNATION_EVENT, objectId: asOid(oid), revision: 1,
            payload: { designationSchema: FACT_DESIGNATION_SCHEMA, stance: 'ACCEPTED', issuer: 'g4an9nobody',
              authorization: 'AUTHORIZED', policyVersion: FACT_STANDING_POLICY_VERSION } })))).toBe('NO_REFUSAL');
      } finally { w2.close(); }
    } catch (e) { w.close(); throw e; }
  });

  test('G4A-N9d meta 计数器 REPLACE：ledger_seq 归零 ⇒ H 序号从此撞号或倒退（无触发器、无审计）', () => {
    const w = open('n9d');
    try {
      w.uow(ADM, (tx) => tx.createObject({ kind: 'test.claim', payload: { core: 1 } }));
      const head = w.kernel.head;
      expect(outcome(() => w.raw.run(`insert into meta(key, value) values('ledger_seq', 0)
        on conflict(key) do update set value=0`))).toBe('NO_REFUSAL');
      expect(w.kernel.head).toBe(0);
      expect(head, '序号被抹掉').toBeGreaterThan(0);
    } finally { w.close(); }
  });

  test('G4A-N9e guard 中置注释绕过：`insert/*x*/or replace`、`replace/*x*/into`、换行+行注释穿过关锚正则（纵深防线失效）', () => {
    const file = join(dir, 'n9e.db');
    const port = new SqlitePort({ file });
    try {
      // 先造一行可被替换的目标
      port.tx((raw) => raw.run(`insert into journal(seq, tx_epoch, ns, oid, op) values(1,1,'x','y','orig')`));
      // 对照：canonical 形态被拒（作者的 N9-2 锚）
      expect(outcome(() => port.tx((raw) => raw.run(`insert or replace into journal(seq, tx_epoch, ns, oid, op) values(1,2,'x','y','evil')`))))
        .toContain('RAW_SQL_REFUSED');
      // 绕过 1：中置块注释
      expect(outcome(() => port.tx((raw) => raw.run(`insert/*G4A*/or replace into journal(seq, tx_epoch, ns, oid, op) values(1,3,'x','y','evil1')`))))
        .toBe('NO_REFUSAL');
      expect(port.read((raw) => raw.get<{ op: string }>(`select op from journal where seq=1`)!.op)).toBe('evil1');
      // 绕过 2：replace 别名中置注释
      expect(outcome(() => port.tx((raw) => raw.run(`replace/*G4A*/into journal(seq, tx_epoch, ns, oid, op) values(1,4,'x','y','evil2')`))))
        .toBe('NO_REFUSAL');
      expect(port.read((raw) => raw.get<{ op: string }>(`select op from journal where seq=1`)!.op)).toBe('evil2');
      // 绕过 3：行注释切分 token
      expect(outcome(() => port.tx((raw) => raw.run(`insert--g4a\nor replace into journal(seq, tx_epoch, ns, oid, op) values(1,5,'x','y','evil3')`))))
        .toBe('NO_REFUSAL');
      // 绕过 4：ON CONFLICT DO UPDATE 根本不在被禁写法名单——对**无触发器表**它就是逐字段的静默改写
      const upsert = () => port.tx((raw) => raw.run(
        `insert into journal(seq, tx_epoch, ns, oid, op) values(1,6,'x','y','evil4')
           on conflict(seq) do update set op='evil4-upsert'`));
      expect(outcome(upsert)).toBe('NO_REFUSAL');
      expect(port.read((raw) => raw.get<{ op: string }>(`select op from journal where seq=1`)!.op)).toBe('evil4-upsert');
      // 对照（诚实）：对**有触发器**的表，中置注释绕过照样撞 DELETE 触发器（pragma 兜住）——先播种让 REPLACE 真撞主键
      port.tx((raw) => raw.run(`insert into ledger(seq, space, event_type, payload_json, recorded_at) values(1,'s','x','orig',1)`));
      expect(outcome(() => port.tx((raw) => raw.run(`insert/*G4A*/or replace into ledger(seq, space, event_type, payload_json, recorded_at)
        values(1,'s','x','{}',1)`)))).toContain('HISTORY_IMMUTABLE');
      expect(outcome(() => port.tx((raw) => raw.run(`insert into ledger(seq, space, event_type, payload_json, recorded_at)
        values(1,'s','x','{}',1) on conflict(seq) do update set payload_json='{}'`)))).toContain('HISTORY_IMMUTABLE');
      // meta/projection_state 同法（无触发器 ⇒ upsert 静默改）
      expect(outcome(() => port.tx((raw) => raw.run(`insert into projection_state(name, seq, baseline) values('p',0,0)
        on conflict(name) do update set seq=0, baseline=0`)))).toBe('NO_REFUSAL');
    } finally { port.close(); }
  });

  test('G4A-N9f 逐表实测矩阵：pragma=ON 下 REPLACE INTO 每表成功/abort 一览（交付给台账的覆盖面数字）', () => {
    const w = open('n9f');
    const rows: { table: string; replace: string }[] = [];
    try {
      const oid = w.uow(ADM, (tx) => tx.createObject({ kind: 'test.claim', payload: { core: 1 } }));
      // 先让每张表都有**将被撞上的真实行**——REPLACE 只在主键冲突时走「隐式删除+插入」，
      // 无冲突的 REPLACE 就是普通 insert，撞不到任何触发器（上一版本矩阵的假阳性来源，如实修正）。
      const real = w.raw.get<{ ns: string; revision: number }>(
        `select ns, revision from domain_state where oid=? limit 1`, oid)!;
      w.raw.run(`insert into records(record_id, declared_seq, payload_json) values('g4a-r1', 1, '{}')`);
      w.raw.run(`insert into check_report(report_id, target_kind, validator_id, rule_version, schema_version,
        environment, executed_at, guarantee_scope, verdict, findings_json, declared_gaps_json, recorded_seq)
        values('g4a-cr','revision-ref','v','1','1','e',1,'g','V','[]','[]',1)`);
      w.raw.run(`insert into ref_edge(from_oid, from_rev, to_oid, to_rev, to_record, role, required) values('g4a-o',1,'g4a-o',1,'tr','r',0)`);
      w.raw.run(`insert into projection_cursor(projection, journal_seq, authority_seq, status) values('g4a-p',0,null,'OK')`);
      const attempts: [string, () => unknown][] = [
        ['meta', () => w.raw.run(`replace into meta(key, value) values('id_counter', 99999)`)],
        ['object_directory', () => w.raw.run(`replace into object_directory(oid, space, kind, owner_capability, ns, created_seq)
           values(?, 'SP-G4A9', 'test.claim', 'cap.evil.taken', 'dom_test_objects', 1)`, oid)],
        ['capability_route', () => w.raw.run(`replace into capability_route(capability, plugin_id, ns, contract_version, enabled)
           values('cap.test.objects','test.objects','dom_test_objects','v1',1)`)],
        ['domain_state', () => w.raw.run(`replace into domain_state(ns, oid, revision, payload_json, recorded_seq, contract_version)
           values(?, ?, ?, '{"forged":true}', 1, 'v1')`, real.ns, oid, real.revision)],
        ['records', () => w.raw.run(`replace into records(record_id, declared_seq, payload_json) values('g4a-r1', 1, '{"forged":true}')`)],
        ['ledger', () => w.raw.run(`replace into ledger(seq, space, event_type, payload_json, recorded_at)
           values(?, 's', 'x', '{"forged":true}', 1)`, w.raw.get<{ m: number }>(`select max(seq) m from ledger`)!.m)],
        ['check_report', () => w.raw.run(`replace into check_report(report_id, target_kind, validator_id, rule_version, schema_version,
           environment, executed_at, guarantee_scope, verdict, findings_json, declared_gaps_json, recorded_seq)
           values('g4a-cr','revision-ref','v','1','1','e',1,'g','FORGED','[]','[]',1)`)],
        ['ref_edge', () => w.raw.run(`replace into ref_edge(from_oid, from_rev, to_oid, to_rev, to_record, role, required) values('g4a-o',1,'g4a-o',1,'tr','r',1)`)],
        ['journal', () => w.raw.run(`replace into journal(seq, tx_epoch, ns, oid, op) values(1,1,'x','y','FORGED')`)],
        ['projection_cursor', () => w.raw.run(`replace into projection_cursor(projection, journal_seq, authority_seq, status) values('g4a-p',999,null,'FORGED')`)],
      ];
      for (const [t, fn] of attempts) {
        const o = outcome(fn);
        rows.push({ table: t, replace: o === 'NO_REFUSAL' ? 'SUCCESS(改写生效)'
          : /IMMUTABLE|FROZEN|APPEND_ONLY|MATERIAL/.test(o) ? 'ABORT(触发器)' : o.slice(0, 40) });
      }
      console.table(rows);
      const succeeded = rows.filter((r) => r.replace === 'SUCCESS(改写生效)').map((r) => r.table);
      expect(succeeded).toEqual(expect.arrayContaining(['object_directory', 'capability_route', 'meta', 'journal', 'projection_cursor']));
      expect(succeeded, 'H 家族（ledger/domain_state/records/check_report/ref_edge）在 pragma 下全部保住').not.toContain('ledger');
      expect(succeeded).not.toContain('domain_state');
      expect(succeeded).not.toContain('records');
      expect(succeeded).not.toContain('ref_edge');
      expect(succeeded).not.toContain('check_report');
    } finally { w.close(); }
  });
});
```

### A.3 `g4a-d26-combo.test.ts`
```ts
/**
 * G4-A 攻击② —— D-26 排除谓词的绕过面 + 攻击⑤ 撤销×历史×停用×见证同世界组合。
 */
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { POC_DATA_DIR } from '../../src/harness/paths.ts';
import { openWorld, PRINCIPAL, type World } from '../../src/harness/world.ts';
import { TEST_OBJECT_MODEL } from '../../src/domains/test-object-model.ts';
import { TEST_FACET_CALIB, CAP_FACET } from '../../src/domains/test-facet.ts';
import { CAP_RECORDS, TEST_RECORDS, FACT_DESIGNATION_EVENT, FACT_DESIGNATION_SCHEMA, FACT_STANDING_POLICY_VERSION } from '../../src/domains/test-records.ts';
import { asOid } from '../../src/contracts/index.ts';
import type { PluginManifest } from '../../src/contracts/index.ts';

const ADM = PRINCIPAL('g4aadm');       // 全轴
const NOBODY = PRINCIPAL('g4anobody'); // 只有 space-write
const GRANTS = {
  g4aadm: ['space-write', 'capability-admin', 'domain-admission'],
  g4anobody: ['space-write'],
};
let dir: string;
beforeAll(() => { dir = mkdtempSync(join(POC_DATA_DIR, 'g4a-d26-')); });
afterAll(() => { rmSync(dir, { recursive: true, force: true }); });
const open = (name: string, plugins?: readonly PluginManifest[]): World =>
  openWorld({ file: join(dir, `${name}.db`), space: 'SP-G4AD', grants: GRANTS,
    plugins: plugins ?? [TEST_OBJECT_MODEL, TEST_RECORDS] });
const code = (fn: () => unknown): string => {
  try { fn(); return 'NO_REFUSAL'; }
  catch (e) { return (e as { code?: string }).code ?? `OTHER:${String(e)}`; }
};
const evilManifest = (axis: string, suffix: string): PluginManifest => ({
  pluginId: `g4a.evil.${suffix}`, codeVersion: '0',
  provides: [{ capability: `cap.g4a.evil.${suffix}`, contractVersion: 'v1' }],
  requires: [], storageNamespace: `dom_g4a_evil_${suffix}`, eventAuthority: 'none',
  ownsEventTypes: [{ eventType: `g4a:evil-${suffix}`, capability: `cap.g4a.evil.${suffix}`, requiresAuthority: axis }],
});

describe('G4-A 攻击②：D-26 排除谓词 = 精确串比较（等价不同形的注册绕过与提权分离验证）', () => {
  // 机制账本是 Set 精确匹配（world.ts:51 `grantsFor(actor).has(resource)`）⇒ 不同形轴能过注册、
  // 拿不到 true 见证。攻击要分开两半说：**注册绕过成立**（排除谓词只挡字面量），**提权不成立**
  // （取证 fail-closed）。CONTRACTS §16.2 已把空白轴边界登记在案，未把不同形登记全。
  const variants: [string, string][] = [
    ['前导空格', ' space-write'],
    ['尾随空格', 'space-write '],
    ['大小写混排', 'SPACE-WRITE'],
    ['Unicode 连字符同形字 U+2011', 'space\u2011write'],
    ['全角大小写+空格组合', ' Space-Write '],
    ['尾随制表+换行', 'space-write\t\n'],
  ];
  for (const [name, axis] of variants) {
    test(`G4A-D26-绕 ${name}：注册不被排除（谓词绕过成立），但见证恒 false ⇒ 无提权（fail-closed 兜住）`, () => {
      const w = open(`d26-${Buffer.from(axis).toString('hex')}`, [TEST_OBJECT_MODEL, TEST_RECORDS, evilManifest(axis, Buffer.from(axis).toString('hex'))]);
      try {
        const oid = w.uow(ADM, (tx) => tx.createObject({ kind: 'test.claim', payload: { core: 1 } }));
        const cap = `cap.g4a.evil.${Buffer.from(axis).toString('hex')}` as never;
        const r = code(() => w.uow(NOBODY, (tx) => w.kernel.faceFor(cap).writerFor(tx)
          .appendAuthoritativeEvent({ eventType: `g4a:evil-${Buffer.from(axis).toString('hex')}`, objectId: asOid(oid), revision: 1, payload: {} })));
        expect(r, '装配+签发全程无拒绝 ⇒ D-26 装配期排除被不同形绕过').toBe('NO_REFUSAL');
        const row = w.raw.get<{ auth: number; axis: string }>(
          `select json_extract(authority_basis,'$.authorized') auth, json_extract(authority_basis,'$.axis') axis
             from ledger where event_type=?`, `g4a:evil-${Buffer.from(axis).toString('hex')}`)!;
        expect(row.auth, '见证必须 false——机制账本 Set 精确匹配，不同形取不到证').toBe(0);
      } finally { w.close(); }
    });
  }
  test('G4A-D26-空 空串缺轴仍拒；纯空白 " " 过注册（作者 D26-4 已钉）——空白轴若被运维 grant 即成"人人可签发"', () => {
    expect(code(() => open('d26-empty', [TEST_OBJECT_MODEL, TEST_RECORDS, evilManifest('', 'e')]))).toBe('ACTIVATION_IMPOSSIBLE');
    const w = open('d26-ws', [TEST_OBJECT_MODEL, TEST_RECORDS, evilManifest(' ', 'w')]);
    try {
      const oid = w.uow(ADM, (tx) => tx.createObject({ kind: 'test.claim', payload: { core: 1 } }));
      // 攻击者能做的最后一步：诱导装配根给某主体 grant(' ')——机制对轴名零判据
      w.grant('g4anobody', ' ');
      expect(code(() => w.uow(NOBODY, (tx) => w.kernel.faceFor('cap.g4a.evil.w' as never).writerFor(tx)
        .appendAuthoritativeEvent({ eventType: 'g4a:evil-w', objectId: asOid(oid), revision: 1, payload: {} })))).toBe('NO_REFUSAL');
      const row = w.raw.get<{ auth: number }>(
        `select json_extract(authority_basis,'$.authorized') auth from ledger where event_type='g4a:evil-w'`)!;
      expect(row.auth, '轴=" " 且账本里真有空格授权 ⇒ 见证 true：注册面缺"轴名卫生"判据的后果面').toBe(1);
    } finally { w.close(); }
  });
  test('G4A-D26-镜 MECHANISM_RESOURCES 排除后仍可登记 "capability-admin" 的前缀/扩充形 ⇒ 排除谓词是名单精确匹配非语义匹配（登记即可，取证兜底）', () => {
    const w = open('d26-pfx', [TEST_OBJECT_MODEL, TEST_RECORDS, evilManifest('capability-admin-x', 'p')]);
    try {
      expect(w.kernel.registry.formalEventAuthority('g4a:evil-p' as never)).toBe('capability-admin-x'); // 注册成功
    } finally { w.close(); }
  });
});

describe('G4-A 攻击⑤：撤销 × 历史 × 停用 × 见证 —— 四者在同一世界里钉一次', () => {
  test('G4A-C1 同世界时序：授权采纳→停用拒撤→读面不关→重启后正当撤回→伪造 v2 历史行后置翻回 ADOPTED→再撤再翻（机制通道对历史伪造行零救济）', () => {
    const w = open('c1');
    try {
      const sc = w.standingUseCase();
      const oid = w.uow(ADM, (tx) => tx.createObject({ kind: 'test.claim', payload: { core: 1 } }));
      // ① 授权主体正当签发 ACCEPTED（见证 true）
      w.uow(ADM, (tx) => sc.declare(tx, { oid: asOid(oid), revision: 1, stance: 'ACCEPTED' }));
      expect(sc.standingAt(asOid(oid), w.ledgerHead()).state).toBe('ADOPTED');
      // ② 未授权主体的 WITHDRAWN：落库但见证 false ⇒ 见证优先闸不计（撤销不生效）
      w.uow(NOBODY, (tx) => sc.declare(tx, { oid: asOid(oid), revision: 1, stance: 'WITHDRAWN' }));
      expect(sc.standingAt(asOid(oid), w.ledgerHead()).state).toBe('ADOPTED');
      // ③ 停用拥有者：正当 WITHDRAWN 写不动（D-25 写面），**读面 eventsOf 不关**
      w.unloadCapability(CAP_RECORDS, ADM);
      const rowsBefore = w.kernel.faceFor(CAP_RECORDS).eventsOf(asOid(oid), FACT_DESIGNATION_EVENT, w.ledgerHead());
      expect(rowsBefore.length).toBeGreaterThanOrEqual(2); // 停用窗口读面仍可见全部历史（含见证结构）
      const ledgerCount = w.raw.get<{ c: number }>(`select count(*) c from ledger`)!.c;
      expect(code(() => w.uow(ADM, (tx) => sc.declare(tx, { oid: asOid(oid), revision: 1, stance: 'WITHDRAWN' }))))
        .toBe('CAPABILITY_INACTIVE');
      expect(w.raw.get<{ c: number }>(`select count(*) c from ledger`)!.c).toBe(ledgerCount); // 零残留
      // ④ 重启 + 重新激活：正当撤回成功 → NOT_ADOPTED
      w.loadCapability(CAP_RECORDS, ADM);
      w.uow(ADM, (tx) => sc.declare(tx, { oid: asOid(oid), revision: 1, stance: 'WITHDRAWN' }));
      expect(sc.standingAt(asOid(oid), w.ledgerHead()).state).toBe('NOT_ADOPTED');
      // ⑤ 伪造"历史"v2 行（无见证 + issuer==actor 字面相等）后置插入 ⇒ v2 只读历史语义把它计入 ⇒ 翻回 ADOPTED
      const seq = w.raw.get<{ m: number }>(`select max(seq) m from ledger`)!.m + 1;
      w.raw.run(`update meta set value=? where key='ledger_seq'`, seq);
      w.raw.run(`insert into ledger(seq, space, event_type, actor, object_id, revision, payload_json, recorded_at)
        values(?, 'SP-G4AD', ?, 'histadm', ?, 1, ?, 1)`, seq, FACT_DESIGNATION_EVENT, oid,
        JSON.stringify({ designationSchema: FACT_DESIGNATION_SCHEMA, stance: 'ACCEPTED', issuer: 'histadm',
          authorization: 'AUTHORIZED', policyVersion: 'fact-standing/v2' }));
      expect(sc.standingAt(asOid(oid), w.ledgerHead()).state, 'v2 历史伪造行永久计入（A5-2 同族，本轮在同世界复核仍在）').toBe('ADOPTED');
      // ⑥ 机制唯一救济 = 再签一条更新的正当 WITHDRAWN（G3-A A5-2 结论复现）
      w.uow(ADM, (tx) => sc.declare(tx, { oid: asOid(oid), revision: 1, stance: 'WITHDRAWN' }));
      expect(sc.standingAt(asOid(oid), w.ledgerHead()).state).toBe('NOT_ADOPTED');
    } finally { w.close(); }
  });

  test('G4A-C2 eventsOf 跨读授权下插件实际拿到的字段清单（E-01 泄露面的精确答案）', () => {
    const w = open('c2', [TEST_OBJECT_MODEL, TEST_RECORDS, TEST_FACET_CALIB]);
    try {
      const oid = w.uow(ADM, (tx) => tx.createObject({ kind: 'test.claim', payload: { core: 1 } }));
      w.uow(ADM, (tx) => w.standingUseCase().declare(tx, { oid: asOid(oid), revision: 1, stance: 'ACCEPTED' }));
      // 被授权跨读的 CAP_RECORDS（CROSS_EVENT_READ 名单内）能拿什么：
      const rows = w.kernel.faceFor(CAP_RECORDS).eventsOf(asOid(oid), FACT_DESIGNATION_EVENT, w.ledgerHead());
      const keys = Object.keys(rows[0]!).sort();
      console.log('[G4A-C2] 跨读行键集 =', keys, '行样例 =', JSON.stringify(rows[0]).slice(0, 200));
      expect(keys).toEqual(['actor', 'authority', 'payload', 'seq']);
      expect(Object.keys(rows[0]!.authority!).sort()).toEqual(['authorized', 'axis', 'capability']);
      // 未授权跨读（facet 能力）：NAMESPACE_ESCAPE 的 detail 泄露 owner 能力 id（存在性 oracle 现状）
      const facetFace = w.kernel.faceFor(CAP_FACET);
      try {
        facetFace.eventsOf(asOid(oid), FACT_DESIGNATION_EVENT, w.ledgerHead());
        throw new Error('SHOULD_HAVE_THROWN');
      } catch (e) {
        const r = e as { code?: string; detail?: Record<string, unknown> };
        console.log('[G4A-C2] 未授权跨读拒绝体 =', JSON.stringify({ code: r.code, detail: r.detail }));
        expect(r.code).toBe('NAMESPACE_ESCAPE');
        expect(r.detail?.owner, '拒绝 detail 直接给出归属能力 id').toBe('cap.test.object-model');
      }
    } finally { w.close(); }
  });

  test('G4A-C3 N6/N7 复钉：原型键与怪 policyVersion 全谱 fail-closed 且不崩读者（修法在位确认）', () => {
    const w = open('c3');
    try {
      const sc = w.standingUseCase();
      const oid = w.uow(ADM, (tx) => tx.createObject({ kind: 'test.claim', payload: { core: 1 } }));
      for (const pv of ['constructor', '__proto__', 'toString', 'hasOwnProperty', 'valueOf', 'prototype',
        'fact-standing/v2 ', 'fact-standing/v2\t', 'FACT-STANDING/V2', '', 'null', 'undefined']) {
        const r = code(() => w.uow(ADM, (tx) => w.kernel.faceFor(CAP_RECORDS).writerFor(tx).appendAuthoritativeEvent({
          eventType: FACT_DESIGNATION_EVENT, objectId: asOid(oid), revision: 1,
          payload: { designationSchema: FACT_DESIGNATION_SCHEMA, stance: 'ACCEPTED', issuer: 'g4aadm',
            authorization: 'AUTHORIZED', policyVersion: pv },
        })));
        expect(r, `签发本身允许（PR-A1 全保存），policyVersion=${JSON.stringify(pv)}`).toBe('NO_REFUSAL');
        expect(sc.standingAt(asOid(oid), w.ledgerHead()).state, `不计数不崩：${JSON.stringify(pv)}`).toBe('NOT_ADOPTED');
      }
    } finally { w.close(); }
  });
});
```

复跑：三文件原样写入上述路径后，worktree 根执行
```bash
npx vitest run --config experiments/v3-code-architecture-poc/vitest.config.ts experiments/v3-code-architecture-poc/attacks/review/g4a-n3-gate-attacks.test.ts experiments/v3-code-architecture-poc/attacks/review/g4a-n9-tables.test.ts experiments/v3-code-architecture-poc/attacks/review/g4a-d26-combo.test.ts
# 预期：35 例全绿（绿=攻击假设成立或兜底复钉，裁决词在测试名里）；
# g0-gate [3/3] 会如实报「审查方新增通过 35 条」——那是身份基线门的正常面，非门禁失效。
```

```bash
#!/bin/bash
cd /home/user/dsh-plugins/dsh-research-control/.scratch/wt-g4a
P=experiments/v3-code-architecture-poc
mkdir -p hold
mv $P/attacks/review/g4a-*.test.ts hold/ 2>/dev/null
run() { node $P/g0-gate.mjs > hold/$1.log 2>&1; echo "exit=$?"; }
echo "=== GT4-a 整删 1 个测试文件（d26，4 例）⇒ 必须红 ==="
mv $P/tests/d26-authority-axis.test.ts hold/d26-authority-axis.test.ts
run gt4a; echo "GT4a_exit=$?"
grep -E "作者覆盖面漂移|OK ——|FAIL" hold/gt4a.log | head -4
mv hold/d26-authority-axis.test.ts $P/tests/d26-authority-axis.test.ts
echo "=== GT4-b 在 tests/ 加 1 条测试 ⇒ 必须红 ==="
printf "import { expect, test } from 'vitest';\ntest('G4A-ADD 加一条测试的覆盖面漂移探针', () => { expect(1).toBe(1); });\n" > $P/tests/g4a-probe-add.test.ts
run gt4b; echo "GT4b_exit=$?"
grep -E "作者覆盖面漂移|OK ——|FAIL" hold/gt4b.log | head -4
rm $P/tests/g4a-probe-add.test.ts
echo "=== GT4-c 等量替换：删 d26(4例)+补 4 条 expect(1).toBe(1) ⇒ 门禁打印? ==="
mv $P/tests/d26-authority-axis.test.ts hold/d26-authority-axis.test.ts
{ echo "import { expect, test } from 'vitest';"; for i in 1 2 3 4; do echo "test('VACUOUS-$i 等量替换探针', () => { expect(1).toBe(1); });"; done; } > $P/tests/g4a-vacuous.test.ts
run gt4c; echo "GT4c_exit=$?"
sed -n '/\[2\/3\]/,/\[3\/3\]/p' hold/gt4c.log
rm $P/tests/g4a-vacuous.test.ts
mv hold/d26-authority-axis.test.ts $P/tests/d26-authority-axis.test.ts
echo "=== GT4-d 有红状态下 --reanchor ⇒ 拒写 ==="
printf "import { expect, test } from 'vitest';\ntest('G4A-RED 故意红', () => { expect(1).toBe(2); });\n" > $P/tests/g4a-red.test.ts
node $P/g0-gate.mjs --reanchor > hold/gt4d.log 2>&1; echo "GT4d_exit=$?"
grep -E "拒绝写锚|FAIL" hold/gt4d.log | head -3
test "$(git hash-object $P/AUTHOR_ANCHOR.json)" = "$(git rev-parse HEAD:experiments/v3-code-architecture-poc/AUTHOR_ANCHOR.json)" && echo "GT4d_anchor_unchanged=OK" || echo "GT4d_anchor_unchanged=VIOLATED"
rm $P/tests/g4a-red.test.ts
echo "=== GT4-e 洗白链：加 1 条真绿测试 → --reanchor（干净）→ 门禁 PASS（锚被合法改写 167→168）==="
printf "import { expect, test } from 'vitest';\ntest('G4A-SWAP-1', () => { expect(1).toBe(1); });\n" > $P/tests/g4a-swap.test.ts
node $P/g0-gate.mjs --reanchor > hold/gt4e1.log 2>&1; echo "GT4e_reanchor_exit=$?"
grep -E "已重锚" hold/gt4e1.log
run gt4e2; echo "GT4e_gate_after_reanchor_exit=$?"
grep -E "OK —— 168|与覆盖面锚逐等" hold/gt4e2.log | head -2
grep '"passed"' $P/AUTHOR_ANCHOR.json
rm $P/tests/g4a-swap.test.ts
git show HEAD:experiments/v3-code-architecture-poc/AUTHOR_ANCHOR.json > $P/AUTHOR_ANCHOR.json
echo "=== 还原核验 ==="
git status --porcelain | head; test -z "$(git status --porcelain -- $P/src $P/tests $P/AUTHOR_ANCHOR.json $P/g0-gate.mjs)" && echo CLEAN_OK
mv hold/g4a-*.test.ts $P/attacks/review/
echo ALL_DONE
```

## 收尾确认

- 本席全部实测在 `.scratch/wt-g4a` @ 978a70b 完成；worktree 已 `git worktree remove --force` 移除（见主会话回报）。
- 临时动过的 tests/、AUTHOR_ANCHOR.json、g0-gate.mjs、src/contracts/index.ts 全部以 `git show HEAD:<path>` 还原并 `git hash-object` 与 `git rev-parse HEAD:<path>` 逐字节核验相等（GT4 脚本尾部 CLEAN_OK + ANCHOR_RESTORED + GATE_RESTORED 输出为证）。
- 主树除本报告文件外无本席造成的任何改动。
