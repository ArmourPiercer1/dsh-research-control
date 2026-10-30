# RE-REVIEW-G2-A — 独立复验报告（攻击席位，第四轮·包 1/包 2 修复复验）

- **审计对象**：分支 `poc/v3-code-architecture-poc-20261030` @ `ba3d69d`（HEAD；包 1 = `95d17b8` D-23/D-24，包 2 = `b29d540` D-20/D-22，`ba3d69d` 仅基线重算，`8adc6ac` GT-1 门禁修复）。
- **方法**：独立 worktree（`.scratch/wt-g2a`，已销毁）；**不重跑 g1a-regression 就算完**——另写 25 例自有反例（`attacks/review/g2a-attacks.test.ts`，全文见附录 A，25/25 实测钉死）+ 4 组门禁实验（自有夹具 + 临时基线，未动作者 `BASELINE.json`）。
- **纪律合规**：未改 `src/**`、`tests/**`、`g0-gate.mjs`、他人 attacks 文件；无 `git checkout --/stash/restore/add/commit/push`；门禁判定标准未为绿而改。
- **基线状态复核**（工作树原状）：`npx tsc` 0 错；作者测试 `137/137`（skip=0）；`node g0-gate.mjs` PASS（32 条已知红，`BASELINE.json` total=133/failures=32/passes=101，`generated_from_commit=b29d540`）。

---

## ① 逐项结论（一行一条）

| 项 | 结论 | 一句话依据 |
|---|---|---|
| **D-23** | **确认已修** | 迟到 port 建立、提交期抛错、`#scoped` 瞬时实例边记账、终结句柄搭活事务四条独立反例全部 `TX_CLOSED`/回滚拦下；记账键是事务本体（`kernel.ts:606-609` finally）而非任何实例。 |
| **D-24** | **部分修（与作者登记一致，无不实声明）** | 无歧义两面（幽灵 oid `write()`、幽灵 from+`required:true`）实测收口；两条登记残余（幽灵 from+软边、`readAsOf` 不判 ns）复测**仍为真**，且各补一个新落点。 |
| **D-20** | **不成立——按最严格形态：部分修（通道强制、授权轴仍载荷自称），第三层（投影信任模型）未落地**（见 N1，P1） | 通道层（`EVENT_AUTHORITY_REQUIRED` 三入口）与归属/登记层实测为真；但 `issuer===机制actor` + **载荷自称** `authorization:'AUTHORIZED'` 即翻 `ADOPTED`，业务授权轴 `domain-admission` 在机制唯一入口上**零核对**——判据从认 `note` 字符串变成认结构化字段，仍是载荷自称。 |
| **D-22** | **确认已修（声明范围内）** | 自有属性/符号/原型链/静态面全量枚举无执行器；`adaptLegacyValidationWiring` 直调只得单动作对象；旧形态有登记与删除条件。同课残余另立 N3。 |
| **GT-1** | **修一半** | 纯形（断言全绿 + `afterAll` 抛）被 `loadErrors` 抓红 ✓；**吸收形**（同文件 1 条登记红藏清理期崩溃）门禁 PASS（N5，P2）。 |

**综合**：包 1（D-23）与包 2 的通道/归属层是真修；**D-20 的"已修"声明按外部复审原始四条要求的第③④条衡量不成立**，外加一条规范文档主张为假（N2）。无"为绿放宽判据"、无"测试伪装实现"证据（逐 hunk 见 §④）。

---

## ② 攻击矩阵（25 例攻击 + 4 组门禁实验；「成立」= 修复拦住了攻击 / 残余确认仍开）

工作树行号 = 已销毁 worktree 中 `attacks/review/g2a-attacks.test.ts`（全文附录 A）。机制行号 = `ba3d69d` 的 `src/kernel/kernel.ts` 等。

| # | 攻击形态（我的，非 g1a 复刻） | 预期（理想） | 实测 | 成立? | 证据 |
|---|---|---|---|---|---|
| A1 | 事务终结后 `face.writerFor(旧tx)`、`world.writerOf(旧tx)`、事后 `readLatest`/`write`/`createOwned` | 一律 `TX_CLOSED` 且零落库 | 全部 `TX_CLOSED`，目录计数不动 | ✅ | 测试 L65；kernel.ts:508-509, 704-707, 606-609 |
| A2 | 提交期抛错那一形：回调正常返回、`checkRequiredRefs` 提交期拒绝，随后旧句柄迟到写 | 与提交成功/回滚同判终结 | 句柄 `TX_CLOSED`，`ref_edge` 零残留 | ✅ | L86；kernel.ts:602-609, 1216-1222 |
| A3 | `linkOwned` 经 `#scoped()` 瞬时实例建立 required 悬空边（按实例记账的修法会漏） | 边归外层账、提交失败整体回滚 | `REQUIRED_REF_MISSING`，六表全回滚 | ✅ | L103；kernel.ts:1105-1114（`TX_REQUIRED_EDGES` 键=RawTx 本体） |
| A4 | 终结句柄在**另一条活事务回调内**使用（借活锁搭车 autocommit） | `TX_CLOSED`，活事务不误伤 | `TX_CLOSED`；同回调内活句柄正常 revise=2 | ✅ | L118 |
| B1 | 幽灵 oid `write()`（域端口，新事务） | `NOT_FOUND_IN_SPACE` 先于一切写 | 命中，六表计数与 `ledger_seq` 全部不动 | ✅ | L137；kernel.ts:734 |
| B2 | 幽灵 from + `required:false` 软边（scoped 事务） | 理想：拒；登记：静默入库 | **静默入库复测为真**；新落点①：审计面 `checked=0` 完全隐形；新落点②：`impactCandidates` 被注入幽灵候选 | ⚠️ 洞仍在（登记一致） | L155；kernel.ts:1094 `if (src)` 整段跳过 + audit 只巡 `required=1`（kernel.ts:557） |
| B3 | 幽灵 from + `required:true` | 提交期 `level:'source'` 拒 | 命中，零残留 | ✅ | L174；kernel.ts:900 |
| B4 | 合法外形扩展行（victim@99 落 facet ns）→ `readAsOf` | 理想：不端出或带归因；登记：端出 | **复测为真**：`(oid,rev)` 双行同键不同载荷、行无 ns 字段；`readLatest`=1、`readRevision@99`=undefined、扫描面有 rev99——三个读面两个答案；台账 actor 恒 `'system:capability'` | ⚠️ 洞仍在（登记一致） | L192；read-context.ts:81-84（查询无 ns 过滤）、kernel.ts:749 |
| B5 | scoped 事务对他人对象 `appendLedger` 普通事件（g1a §④ 点名形态席位复测） | `CAPABILITY_SCOPE_ESCAPE`，拒绝先于写入 | 命中，零残留；装配作用域正例不受伤（Q40 反向对照） | ✅ | L217 |
| B6 | `write()` 台账行冒充正式事件类型 | `EVENT_AUTHORITY_REQUIRED` 先于 domain_state 插入 | 命中，零残留 | ✅ | L234；kernel.ts:721-724 |
| C1 | `declareRecord` 换通道 / assembly 作用域 `appendLedger` 正式事件 | 同判 `EVENT_AUTHORITY_REQUIRED` | 双双命中，records 零声明 | ✅ | L252；kernel.ts:1042-1046 |
| C2 | 装配期登记判据：重复登记同事件类型 / 指向未激活能力 | `AMBIGUOUS_AUTHORITY` / `CAPABILITY_INACTIVE` | 双双命中（openWorld 即抛） | ✅ | L264；kernel.ts:88-104 |
| C3 | `policyVersion` 用已知版本但 issuer 冒充（actor=机制写、issuer 自称他人） | 不进投影 | `NOT_ADOPTED`（`issuer===actor` 判据真拦住了**冒充**） | ✅ | L284；test-records.ts:300-316 |
| **C4** | **issuer=actor（诚实主体）+ 载荷自称 `authorization:'AUTHORIZED'`，无 `domain-admission` 的主体经记录域 face 直调 `appendAuthoritativeEvent`** | 理想（CONTRACTS §16.2/原始要求③④）：授权轴由机制核对，未授权不得进投影 | **翻成 `ADOPTED`**；对照：同主体走正当命令 Port ⇒ `AUTHORITY_UNVERIFIED` 不计数 | ❌ **D-20 第三层未落地（N1，P1）** | L298；kernel.ts:792-830（零授权轴核对）、test-records.ts:285, 369-380（判据在领域 policy 里，机制不可见） |
| **C5** | `unloadCapability(CAP_RECORDS)` 后：通用通道 + 权威通道写正式事件 | CONTRACTS.md:385-386：两通道都写不动 | 通用通道拒 ✅；**权威通道写动**（ledger +1），同能力 `write()` 已正确 `CAPABILITY_INACTIVE`（对照证明停用生效） | ❌ **契约文本为假（N2）** | L321；kernel.ts:502-518, 792-830 零激活核对 |
| C6 | 撤销 × 历史双方向 | 旧事件按当时 policyVersion 生效；撤销后新写 UNVERIFIED 不计入 | 双向钉死（ledger 行 `['AUTHORIZED','AUTHORITY_UNVERIFIED']`）；`capability-admin` 撤销只拦运维操作 | ✅ | L344；test-records.ts:298-303 冻结判据表 |
| D1 | `ValidationService` 实例运行时面穷举（own/symbols/proto/静态/返回值） | 无任何事务执行器 | own=[]，proto 仅 4 方法+constructor，静态面仅 length/name/prototype | ✅ | L370；test-records.ts:213-231（#私有字段） |
| D2 | 直接调用模块导出的 `adaptLegacyValidationWiring` | 只得 `{submitReport}` 单动作对象，原执行器不可达 | own=['submitReport']、proto=Object.prototype、符号=[]；闭包不可反向取参 | ✅（登记过渡形态） | L397；test-records.ts:190-197 |
| **D3** | 其余领域/用例类实例自有属性枚举 | 「构造参数一律 #私有……不得再犯」（§16.2）应全局成立 | `FactStandingPolicy` 自有 `['authority','face']`（授权探针运行时可枚举可调用）、`FacetStore`=`['face']`、`IntakeUseCase`=`['delegation','policy']`、`StandingUseCase`=`['commands','policy']` | ❌ **同课第四次（N3，P2）** | L423；test-records.ts:361、test-facet.ts:22、intake-use-case.ts:34、standing-use-case.ts:23 |
| D4 | `FacetStore` 接装配全权事务写他人 ns | 写面上界随端口不随事务 | `NAMESPACE_ESCAPE`；合法挂载正例通过 | ✅ | L441 |
| E1 | 跨能力两腿单事务（Q40），第二腿 `EVENT_AUTHORITY_REQUIRED` 抛出 | 第一腿真回滚、ledger/journal 零残留、head 不消耗、空间不打砖 | 全部满足（六表回到起点） | ✅ | L459 |
| E2 | 合法挂载外壳 victim@99 + required 边指 99（"挂载救存在性"）；同边指真实修订 1（反向对照）；`appendAuthoritativeEvent@99` | 三向：拒 / 过 / 拒 | `REQUIRED_REF_MISSING`+零残留 / `NO_REFUSAL` / `NOT_FOUND_IN_SPACE` | ✅ | L484；kernel.ts:884, 920（归属 ns 修订判据同函数共用） |
| E3 | 从 face/writer/tx/Refusal 深度 3 穷举对象图求 `auditRequiredIntegrity` 等运维面可达性；脏 required 边（装配后门入库）后各主体新提交 | 审计入口不可达；存量脏边不阻塞、新脏边仍拒 | `auditRequiredIntegrity`/`transferRoute`/`setRouteEnabled`/`namespacedWriter`/`assertAuthority` 均不可达；audit 报 1 违规不抛；装配+scoped 后续提交均成功；新悬空边提交期仍拒。附带测量见 N4 | ✅（附 N4 观察） | L514 |
| E4 | 组合双时间面：伪造外形行 → `readLatest` vs `readAsOf` vs `readRevision` | 三面一致 | **互相矛盾钉死**（扫描面有 rev2、单对象面无）——B4 的组合形态 | ⚠️（=B4 登记缺口） | L589 |
| E5 | 撤销 `capability-admin` × 已落库正式事件 | 历史不重解释；运维新写拒；恢复后非污点 | 全部满足 | ✅ | L607；world.ts:69-74 |
| G1a | **GT-1 纯形**：夹具断言全绿 + `afterAll` 抛；基线=当前树自洽重算 | 门禁红（`loadErrors`） | **FAIL(exit 1)**：`清理期崩溃（夹具）` 被点名 | ✅ GT-1 纯形修住 | g0-gate.mjs:66-68 |
| G1b | **GT-1 吸收形**：同夹具再加**一条登记红**，崩溃不变；基线重算（33 红/125 绿/total 158） | 理想：崩溃仍红 | **PASS(exit 0)**「与基线完全一致（33 条已知红）」——崩溃被 `reds===0` 判据豁免 | ❌ **GT-1 修一半（N5，P2）** | 见 §③ N5 |
| G2 | **GT-2 掏空断言**：基线内含一条红；把该红断言整段换成无关恒假断言（名字/红态不变），旧基线不动再跑 | 理想：内容/成因变化应红 | **PASS**「与基线完全一致」——门禁只比名字与状态；`failureMessages` 在 g0-gate.mjs 中 0 引用 | ❌ GT-2 仍未修 | g0-gate.mjs 全文 grep=0 |
| G3 | **GT-3 自洽重算**：任意漂移（含崩溃夹具、含我的 25 例新攻击面）用一次性脚本重算基线 | 理想：重算需外部锚 | 一键重算（158/33/125）门禁即绿；唯一锚=祖先提交检查（g0-gate.mjs:106-113），**基线内容本身 = 当次实测 = 恒自洽** | ❌ GT-3 结构性仍开 | 脚本全文附后 |
| G4 | **GT-4 下限缺口**：复制树整删 4 个作者测试文件 | `AUTHOR_MIN_PASSED` 应兜住"整批消失"且随实际收紧 | **PASS**「OK —— 90 例全绿」——137→90 恰好贴地 | ❌ GT-4 仍未修（缺口实测 **47 例 = 34.3%**） | g0-gate.mjs:34（注释还写「当前 95 例」） |

GT-4 完整复现步骤（删了哪四个、共几例、门禁输出原文）：
1. `cp -r experiments/v3-code-architecture-poc <sim>/experiments/`，删 `<sim>` 复制树里的 `attacks/review/g2a-*.test.ts`（恢复基线收集面 133）；
2. 删除作者测试文件：`p3-intake-validation.test.ts`(15 例) + `arch-independence.test.ts`(12 例) + `p1-storage-tx.test.ts`(10 例) + `p2-identity-plugin.test.ts`(10 例) = **47 例**（137−47=90，恰等于下限）；
3. `node <sim>/experiments/v3-code-architecture-poc/g0-gate.mjs`（基线未动）输出原文：
   > `[2/3] 作者测试门（tests/**，0 红是硬条件）`
   > `  OK —— 90 例全绿（skip=0, exit=0, success=true）`
   > `[3/3] 审查方基线门（attacks/**：多一条要查，少一条也要查）`
   > `  OK —— 与基线完全一致（32 条已知红，均已定性）`
   > `[g0-gate] PASS —— 三条流均符合预期`（exit 0）
4. 删第 48 例才会红（89<90）。注释行 `g0-gate.mjs:34` 仍写「作者侧当前 95 例」——包 2 加了 31 例后下限没跟着动。

---

## ③ 新发现（按最严格形态；定级含裁定理由）

### N1（P1）— D-20 未闭合：第三层「投影信任模型」没有真正落地——**作者声称的 D-20 已修不成立，判据为部分修（通道强制、授权轴仍载荷自称）**

- **原始要求的对照**：外部复审对 D-20 的四条要求中，第③条「接纳状态不得仅凭载荷里的自称判定」、第④条「授权决定要有可追溯签发主体与规则版本」。第④条已兑现（`actor` 机制落账 + `policyVersion` 冻结判据表，C6 实测双向钉死）；**第③条只兑现了一半**：冒充他人签发被 `issuer===机制actor` 拦住了（C3 ✅），但「已获授权」这一判定本身仍是**载荷里的自述字段**——修前是 `payload.note==='AUTHORIZED'`，修后是 `payload.authorization==='AUTHORIZED'`，从随手字符串换成了带 schema 的结构化字段，**判据依旧认载荷自称**。
- **最小复现**（附录 A `g2a-c4-` 用例）：主体 `g2a-nobody` 只有 `space-write`、无 `domain-admission`；经记录域窄面直调机制唯一入口：
  ```ts
  w.uow(NOBODY, (tx) => w.kernel.faceFor(CAP_RECORDS).writerFor(tx).appendAuthoritativeEvent({
    eventType: 'synth:fact-designation', objectId: victim, revision: 1,
    payload: { designationSchema: 'synth:fact-designation/2', stance: 'ACCEPTED',
      issuer: 'g2a-nobody', authorization: 'AUTHORIZED', policyVersion: 'fact-standing/v2' } }));
  // 实测 standingAt ⇒ ADOPTED
  ```
  对照：同一主体走正当 `FactDesignationCommandPort.declare` ⇒ 落 `AUTHORITY_UNVERIFIED`、不计数（policy 在 test-records.ts:370 判 `authority.can(...,'domain-admission')`）。
- **机制事实**：`appendAuthoritativeEvent`（kernel.ts:792-830）核对的三件事是事件类型归属、对象存在、修订归属 ns 存在——**不含任何业务授权轴**；Kernel 业务无知，判据只活在领域 policy 里，而机制入口对「调用方是否经过了 policy」零验证。「唯一入口」只是**通道意义上**的唯一（不能绕开记录域的账本写正式事件），不是「授权判定必经」的唯一。
- **修前/修后状态**：修前 = 任何能力 `appendLedger` 伪造 `note:'AUTHORIZED'` 即翻转（G1-A A-6）；修后 = 必须是记录域代码路径 + 结构齐全 + issuer 诚实，**授权字段仍由写入方自称**。威胁形态从「任意外部能力」收窄到「记录域内部旁路/policy 被绕过/被篡改的记录域代码」——这是收窄，不是闭合。
- **定级 P1 理由**：科研语义的核心判据（"这条声明当时是否被授权"）的最终防线仍是数据自称；修复方向是把「授权轴核对」做成机制可验证的通道属性（如：命令 Port 写入时由机制侧按声明的 authority resource 对照 `Authorizer` 落章，`authorization` 不再是载荷字段而由 ledger 机制列承载），或至少在契约里把「第三层=领域自证」写实。

### N2（P2，若按本仓「伪造同级」先例可由作者升档）— 规范文档主张为假：停用拥有者拦不住权威通道

- **逐字引用**（`CONTRACTS.md:385-386`）：
  > 归属账本按能力 id 记，**不随路由停用而消失**：拥有者被停用时，
  > 正式事件在两个通道上都写不动——那正是语义，不是可用性缺陷。
- **最小复现**（附录 A `g2a-c5-` 用例）：`w.unloadCapability(CAP_RECORDS, ADM)` 之后，通道 A `appendLedger(正式类型)` ⇒ `EVENT_AUTHORITY_REQUIRED`（与文一致）；通道 B `kernel.faceFor(CAP_RECORDS).writerFor(tx).appendAuthoritativeEvent(...)` ⇒ **写动**（ledger `synth:fact-designation` +1）。同能力 `write()` 同场实测 `CAPABILITY_INACTIVE`——停用本身生效，唯独权威通道漏网。
- **机制根因**：`namespacedWriter`（kernel.ts:502-518）只查 tx 终结账，`appendAuthoritativeEvent`（792-830）只查 `registry.formalEventOwner`（kernel.ts:144，按设计不随停用清除）+ 对象/修订存在性；全链路无 `registry.capability(cap)` 激活核对。
- **裁决：这是文档与机制不一致，不是新语义。真的是机制行为（停用后权威通道仍可写），文档把期望写成了事实。** 先改文档还是先补机制由作者定；按本仓先例（提交标题失真按伪造同级处理过一次），"把期望写成事实"的同类错误建议至少 P2 起、并由作者明确认领处置顺序。

### N3（P2，单列）— 「构造参数属性=运行时没藏」同课第四次：教训记在注释里，没记在结构里

- **实测**（附录 A `g2a-d3-` 用例，`Reflect.ownKeys` 级）：`FactStandingPolicy` 实例自有 `['face','authority']`（**授权探针**运行时可枚举可调用，`pol.authority.can(actor,'domain-admission',space)` 即授权矩阵探测面）、`FacetStore`=`['face']`、`IntakeUseCase`=`['delegation','policy']`、`StandingUseCase`=`['commands','policy']`。同一提交里 `ValidationService` 改成了 `#` 私有并写下「D-17（face/writer 的 k、raw）→ P2-2 → 本条，同一课第三次点名」——**同文件 40 行之外的 `FactStandingPolicy` 仍在参数属性**（test-records.ts:361 vs 213-231）。
- **影响分级**：无直接越权写（face 本来就是自己的窄面；delegation 需要事务句柄；authority 是读探针），故 P2；但它证明修复是**逐点打补丁**，D-17/P2-2/§16.2 的同一条教训对下一个新类毫无约束力。
- **可机验建议（比再写一遍注释有用）**——门禁级双判据，加进 g0-gate 第 1 流或独立测试：
  1. **源码级（无实例化，零误报面）**：AST/正则扫 `src/domains/**`、`src/app/**`：构造函数参数出现 `private|protected|public|readonly` 修饰符（参数属性）⇒ 红。规则登记为 `P2-N3: 领域/用例类构造参数一律 #私有，豁免须逐条登记在 EVIDENCE`。
  2. **运行时兜底**：对每类领域/用例类的构造产物断言 `Reflect.ownKeys(inst).every(k => typeof k === 'symbol' || !(k in 白名单))` 且**自有属性值不得含可调用成员或含方法的对象**（`face/authority/delegation/commands/policy` 全部违规——正是这四例）。
  判据 1 拦新增，判据 2 拦"绕编译期"的形态；两判据合起来让这条课第一次长在结构里。

### N4（P2 观察）— `tx` 运行时原型面比声明类型面宽；「类型面即边界」实为编译期边界

E3 穷举附带测量：`UnitOfWorkImpl.prototype` = 声明成员 + `reassignRouteInternal`（kernel.ts:1186-1198：**直接改写 `capability_route` 的裸通道**，注释自称「仅机制内部可达（接口上没有此方法）」——但运行时它就挂在插件经手的 `tx` 实例原型上，接口没写 ≠ 运行时不可调用）+ `checkRequiredRefs`。实测 `NOBODY` 调用 ⇒ `AUTHORITY_REQUIRED`（方法体内 `assertAuthority` 兜底），**无越权**；`writer` 原型与 `face` 自有面恰为声明集（face 6 成员、writer 9 成员、符号均空）。风险形态：将来给该通道加逻辑时**漏加核对即成越权**，而接口面看不出这里有个可调用成员；建议把「插件经手对象的原型成员必须 ⊆ 声明接口 ∪ 登记白名单」并入 N3 的门禁（同一判据家族，运行时枚举即可，零误报——本席已给出全部实测集）。

### N5（P2）— GT-1 修一半：`reds===0` 判据放过"吸收形"；这是 G-1/G-2/GT-1 同族第四次补漏

- **实测边界**：g0-gate.mjs:66 `if ((f.status==='failed' && reds===0) || (assertionResults.length===0 && f.message))` ⇒ 纯形（0 条红 + 清理崩溃）红 ✓（本席复现：FAIL，点名夹具文件名）；**同文件只要有一条已登记红**，同样的清理崩溃即被解释掉 ⇒ PASS（复现：`OK —— 与基线完全一致（33 条已知红）`，exit 0）。也就是说修复只覆盖了"当前见到的那一种形态"——同族第四次（G-1 整目录未收集、G-1' 导入期崩溃、G-2 覆盖面缩水、GT-1 清理期崩溃 → 本次吸收形）。
- **唯一自洽的判据形态**（我的裁定，与作者猜测一致并具体化）：基线**逐文件登记"失败成因签名"**——`{file, 断言红 fullName 集, 文件级 message 的成因类别}`；门禁要求三者逐一相等，**任何未登记成因的文件级失败一律红**（即"所有文件级失败都必须有名字"，与"所有红都必须逐条定性"同构）。实现要点：message 归一化为「错误类 + 首行去路径/去数字前缀」以抗抖动（本仓错误消息含时间戳/绝对路径，直接存全文会把误报转嫁成基线churn）。
- **误报风险实测**：现判据在 133 例基线（11 份已知红文件）上实测 0 误报（三轮全量跑无一条已知红被误记 loadError）；成因签名制的误报只发生在**文案漂移**上，且漂移即红正是想要的语义（文案漂移=行为变化信号）；成本落在重算脚本（已有自洽重算通道，G3 实测），收益是"新成因即红"不再依赖人盯。

---

## ④ 逐 hunk 裁定

**包 1 = `95d17b8`（D-23/D-24，kernel ±259 行，六文件）**
- `Kernel.uow` finally `CLOSED_TX.add + TX_REQUIRED_EDGES.delete`（606-609）：记账键下沉到 RawTx 本体，覆盖派生端口——**成立**，A1-A4 四条反例均拦；「提交期抛错也记终结账」为真（A2）。
- `write()` 目录前置判（734）+ `appendLedger` objectId `#assertScope`（1052 区）+ `appendAuthoritativeEvent` 存在性判（808-811）——**成立**，B1/B5/B6/E2 全拦且正例（Q45 挂载、assembly 协调）不受伤（作者测试与本席双重锚定）。
- `linkRef` `if (src)`（1094）——**未改**：幽灵 from 的归属判定仍整段跳过；软边版即 B2 登记残余，作者的登记文本（READINESS D-24 行「ghost from 使 linkRef 归属判定整段跳过」+「这种边仍静默入库（登记）」）与实测一致，**无谎**。
- `auditRequiredIntegrity`（548-569）：只巡 `required=1`（557）⇒ 软边注入对审计面不可见（B2 新落点，登记缺口「全表巡检清单」的范围应写明只覆盖 required 边——文档未明说，建议补一句）。
- 无「为绿放宽」：提交期判据仍是**增量严判**（E3 新悬空边当场拒）；存量不阻塞 = G1-A A-12 的裁定语义，非放水。

**包 2 = `b29d540`（D-20/D-22，kernel 9 hunks + test-records ±215 + world/app/contracts）**
- kernel hunks（Authorizer 注释 88-104 登记判据 / 144 formalEventOwner / 434 eventsFor+actor / 646-671 接口声明 / 715-729 write() 正式型拒 / 779-830 appendAuthoritativeEvent / 1035-1059 appendLedger 双判）——**通道与归属部分全部实测成立**；**779-830 即 N1/N2 落点**（无授权轴核对、无激活核对）。
- `adaptLegacyValidationWiring`（test-records.ts:166-197）：docblock 把「为什么存在/保证什么/删除条件」写实，与 g1a 冻结裁判的依赖关系如实披露；D2 实测无泄漏。**成立（登记的过渡形态）**。
- `ValidationService` #私有化 + `standingUseCase` 接线（world.ts:120-125）——成立（D1 实测）。
- **作者测试改动三处 = 增强非放宽**：`p3-intake-validation` 的 `note` 断言换成 `authorization/issuer/actor` 三断言（严于修前）；`use-case-write-path` 把「已知残留钉现状 `expect(...).toBe('NO_REFUSAL')`」翻成双向断言（`CAPABILITY_SCOPE_ESCAPE`+零残留 / assembly 正例 / 命令 Port 正例）——这恰是 G1-A §④ 点名「测试伪装实现（给 P1 打绿灯）」的**正确纠正**，裁定：无测试伪装实现；`xc28`/`edges-view`/`domain-write-face` 改动为接线词迁移，无判据放宽。
- `g1a-regression.test.ts`：`git log --follow` 全史只有 688237c 一条——审查者冻结裁判自入库**一字未动**，无「改裁判」嫌疑。
- `ba3d69d`（基线重算 ±4 行）：逐行核对 = 恰好两条 g1a 条目（D-20 投影翻转、D-22 全权事务泄漏）从 `failures[]` **同名迁移**到 `passes[]`（34→32 红 / 99→101 绿），对应包 2 实测闭合的两条反例（本席 C1/B5、D1 独立复核同判）；**非静默删除、非改名**。

**`8adc6ac`（GT-1 修复）**：见 N5——修了对称判据的一半（`reds===0`），另一半（吸收形）仍开。

---

## ⑤ 未验证清单（诚实登记，不下结论）

1. **多连接并发/锁竞争**（`multiprocess-contention` 域）：本席全部单连接，未攻击"两条连接交错终结事务"的时序形态。
2. **32 条基线红逐条语义复核**：只核对了两条状态迁移（ba3d69d）与 required-floating-ref 红的"红=封堵后无法构造"语义族（EVIDENCE.md 表）；其余 29 条未逐条重打。
3. **同一威胁模型边界内 N1 的可利用性外沿**：真实宿主里记录域代码路径能否在**非受信**输入下走到「绕 policy 直调 appendAuthoritativeEvent」，属集成期验证，PoC 内无法定论。
4. **GT-3 端到端「作者改名/移动自己测试」全链**：结构性自洽重算通道已实测打开（G3），但未演练改名提交在 CI 面上的完整流转。
5. **契约 skew 回显（hiddenBy*）与 xc28 检测面的新形态**：本轮未新增攻击。
6. **N5 建议判据的实现与误报面全面测量**：仅在 133/158 例基线上做了三形态实验，未对全部 11 份已知红文件的成因签名建库。

---

## 复现命令

```bash
# 工作树原状三件套（在审计提交上）
npx tsc -p experiments/v3-code-architecture-poc/tsconfig.json                # 0 错
npx vitest run --config experiments/v3-code-architecture-poc/vitest.config.ts \
    experiments/v3-code-architecture-poc/tests/                               # 137/137
node experiments/v3-code-architecture-poc/g0-gate.mjs                         # PASS（32 已知红）

# 本席攻击套件（把附录 A 落盘为 attacks/review/g2a-attacks.test.ts 后；
# 25 例名字即裁决；此文件不在 BASELINE 内，跑 g0-gate 会如实报「审查方新增通过 25 条」——
# 这本身是 G3 自洽重算通道的日常面）
npx vitest run --config experiments/v3-code-architecture-poc/vitest.config.ts \
    experiments/v3-code-architecture-poc/attacks/review/g2a-attacks.test.ts   # 25/25

# GT 实验（不污染仓库：夹具临时写入 attacks/review/，基线用 --baseline 指到临时文件，跑完即删）
node experiments/v3-code-architecture-poc/g0-gate.mjs --baseline /tmp/g2a-baseline.json
```

自洽重算脚本（G3 用，等价于作者手头的重算通道）：跑 `npx vitest run --config <cfg> --reporter=json <poc>/attacks`，把 `testResults[].assertionResults[]` 按 `file > fullName` 分装进 `failures/passes/total`，`generated_from_commit=git rev-parse HEAD`——门禁即绿。**任何**漂移（包括崩溃夹具）都能被这条通道洗成 PASS；唯一的锚（106-113 祖先检查）只防"来自分叉/已 rebase 的基线"，不防"照当前实况重算"。

---

## 附录 A：`attacks/review/g2a-attacks.test.ts`（25 例全文，626 行）

```ts
/**
 * G2-A 席位独立攻击套件（复验 @ ba3d69d；不重跑 g1a 的形态，另辟反例）。
 *
 * 判定口径（与报告的 §② 矩阵一一对应，用例名前缀即席位裁决）：
 *   · 【修住】= 攻击尝试被机制拒绝；
 *   · 【洞仍在】= 攻击成功落库（含作者已登记的残余形态——复测其仍为真并补新落点）；
 *   · 【发现】= 本次新立的行为事实（契约主张 vs 机制实测），定级见报告 §③。
 * 本文件是**特征化断言**：断言=实测行为，名字=裁决；绿不代表放行，裁决在
 * `RE-REVIEW-G2-A.md`。纪律：不改 src/**、tests/**、g0-gate.mjs 与他人 attacks 文件。
 */
import { describe, expect, test } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { POC_DATA_DIR } from '../../src/harness/paths.ts';
import { openWorld, PRINCIPAL, type World } from '../../src/harness/world.ts';
import type { NamespaceWriter, UnitOfWork } from '../../src/kernel/kernel.ts';
import { asOid, type PluginManifest, type ReadContextSpec, type ObjectOid } from '../../src/contracts/index.ts';
import { readAsOf } from '../../src/kernel/read-context.ts';
import { CAP_OBJECT_MODEL, TEST_OBJECT_MODEL } from '../../src/domains/test-object-model.ts';
import {
  CAP_RECORDS, TEST_RECORDS, FactStandingPolicy, ValidationService, adaptLegacyValidationWiring,
  FACT_DESIGNATION_EVENT, FACT_DESIGNATION_SCHEMA, FACT_STANDING_POLICY_VERSION,
} from '../../src/domains/test-records.ts';
import { CAP_FACET, TEST_FACET_CALIB, FacetStore } from '../../src/domains/test-facet.ts';

const ADM = PRINCIPAL('g2a-adm');
const NOBODY = PRINCIPAL('g2a-nobody');
const BOB = PRINCIPAL('g2a-bob');
const GRANTS = {
  'g2a-adm': ['space-write', 'capability-admin', 'domain-admission'],
  'g2a-nobody': ['space-write'],
  'g2a-bob': ['space-write', 'domain-admission'],
};

function open(prefix: string): { dir: string; w: World } {
  const dir = mkdtempSync(join(POC_DATA_DIR, prefix));
  const w = openWorld({
    file: join(dir, 's.db'), space: 'SP-G2A', grants: GRANTS,
    plugins: [TEST_OBJECT_MODEL, TEST_RECORDS, TEST_FACET_CALIB],
  });
  return { dir, w };
}

const code = (fn: () => unknown): string => {
  try { fn(); return 'NO_REFUSAL'; }
  catch (e) {
    const c = (e as { code?: unknown })?.code;
    return typeof c === 'string' ? c : `OTHER:${e instanceof Error ? e.constructor.name : String(e)}`;
  }
};

const counts = (w: World) => w.raw.get<{ d: number; s: number; l: number; j: number; r: number; e: number }>(
  `select (select count(*) from object_directory) d,
          (select count(*) from domain_state) s,
          (select count(*) from ledger) l,
          (select count(*) from journal) j,
          (select count(*) from records) r,
          (select count(*) from ref_edge) e`)!;

const ctx = (w: World): ReadContextSpec =>
  ({ space: w.kernel.space, principal: ADM, mode: 'as-recorded', consistency: 'required' });

// ─────────────────────────────────────────────────────────────────────────────
describe('A. D-23 事务生命周期——另辟反例（不重跑 g1a 形态）', () => {
  test('【修住】迟到的 port 建立：writerFor(旧tx) 与 world.writerOf(旧tx) 都拒 TX_CLOSED，事后 readLatest 同判', () => {
    const { dir, w } = open('g2a-a1-');
    try {
      const oid = w.uow(ADM, (tx) => tx.createObject({ kind: 'test.claim', payload: { v: 1 } }));
      // 用装配面与领域面两条通道在同一旧句柄上事后建端口——都应根本造不出来
      let stale: UnitOfWork | undefined;
      w.uow(ADM, (tx) => { stale = tx; });
      expect(code(() => w.kernel.faceFor(CAP_FACET).writerFor(stale!))).toBe('TX_CLOSED');
      expect(code(() => w.writerOf(CAP_RECORDS, stale!))).toBe('TX_CLOSED');
      // 提交前建立、终结后使用：读写同权
      let wr: NamespaceWriter | undefined;
      w.uow(ADM, (tx) => { wr = w.kernel.faceFor(CAP_FACET).writerFor(tx); });
      expect(code(() => wr!.readLatest(oid))).toBe('TX_CLOSED');
      expect(code(() => wr!.write({ ns: 'dom_test_facet', oid, revision: 1, payload: { late: 1 }, eventType: 'extension-registered' }))).toBe('TX_CLOSED');
      // 瞬时 scoped 实例路径同样判账：createOwned 走 #scoped() 新实例——迟到即拒且库面零残留
      expect(code(() => w.writerOf(CAP_OBJECT_MODEL, stale!).createOwned({ kind: 'test.claim', payload: { late: true } }))).toBe('TX_CLOSED');
      expect(w.readObject(oid)!.revision).toBe(1);
      expect(w.raw.get<{ c: number }>(`select count(*) c from object_directory`)!.c).toBe(1);
    } finally { w.close(); rmSync(dir, { recursive: true, force: true }); }
  });

  test('【修住】提交期抛错那一形：checkRequiredRefs 在提交期拒绝 ⇒ 句柄同样终结，之后迟到写 TX_CLOSED', () => {
    const { dir, w } = open('g2a-a2-');
    try {
      const a = w.uow(ADM, (tx) => tx.createObject({ kind: 'test.claim', payload: { v: 1 } }));
      let stale: UnitOfWork | undefined;
      expect(() => w.uow(ADM, (tx) => {
        stale = tx;
        tx.linkRef({ from: { kind: 'revision-ref', oid: a, revision: 1 },
          to: { kind: 'revision-ref', oid: asOid('OBJ-GHOST-A2'), revision: 1 }, role: 'g2a-a2', required: true });
      })).toThrow(/REQUIRED_REF_MISSING/);
      // 提交期抛错路径上的句柄必须与提交成功/回滚同判终结
      expect(code(() => stale!.createObject({ kind: 'test.claim', payload: { late: 1 } }))).toBe('TX_CLOSED');
      expect(code(() => stale!.revise(a, { payload: { late: 2 } }))).toBe('TX_CLOSED');
      expect(w.raw.get<{ c: number }>(`select count(*) c from ref_edge`)!.c).toBe(0);
    } finally { w.close(); rmSync(dir, { recursive: true, force: true }); }
  });

  test('【修住】linkOwned 经 #scoped 瞬时实例的 required 边真归外层账：悬空即提交失败、零残留', () => {
    const { dir, w } = open('g2a-a3-');
    try {
      const victim = w.uow(ADM, (tx) => tx.createObject({ kind: 'test.claim', payload: { text: 'ORIGINAL' } }));
      const before = counts(w);
      expect(() => w.uow(ADM, (tx) => {
        // 注意：端口在事务中途建立，linkOwned 走 #scoped() 瞬时实例——按实例记账的修法会漏这条边
        const wr = w.writerOf(CAP_OBJECT_MODEL, tx);
        wr.linkOwned({ from: { kind: 'revision-ref', oid: victim, revision: 1 },
          to: { kind: 'revision-ref', oid: asOid('OBJ-GHOST-A3'), revision: 7 }, role: 'g2a-a3', required: true });
      })).toThrow(/REQUIRED_REF_MISSING/);
      expect(counts(w)).toEqual(before); // 整体回滚：连 ref_edge 都不留
    } finally { w.close(); rmSync(dir, { recursive: true, force: true }); }
  });

  test('【修住】终结句柄在**另一条活事务的回调内**使用仍 TX_CLOSED（不得借活事务的锁搭车 autocommit）', () => {
    const { dir, w } = open('g2a-a4-');
    try {
      const victim = w.uow(ADM, (tx) => tx.createObject({ kind: 'test.claim', payload: { text: 'ORIGINAL' } }));
      let stale: UnitOfWork | undefined;
      w.uow(ADM, (tx) => { stale = tx; });
      const inside = w.uow(ADM, (tx) => {
        const c = code(() => stale!.revise(victim, { payload: { text: 'HIJACK' } }));
        return { c, fresh: tx.revise(victim, { payload: { text: 'FRESH' } }) };
      });
      expect(inside.c).toBe('TX_CLOSED');
      expect(inside.fresh).toBe(2); // 活事务自己写得动（不因误伤变砖）
      expect((w.readObject(victim)!.payload as Record<string, unknown>).text).toBe('FRESH');
    } finally { w.close(); rmSync(dir, { recursive: true, force: true }); }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('B. D-24 写面判据——幽灵 from/软边、readAsOf ns、冒充通道', () => {
  test('【修住】幽灵 oid 的 write()：NOT_FOUND_IN_SPACE 先于一切写，六表计数与登记序全部不动', () => {
    const { dir, w } = open('g2a-b1-');
    try {
      const before = counts(w);
      const head0 = w.kernel.head;
      let wr: NamespaceWriter | undefined;
      w.uow(ADM, (tx) => { wr = w.kernel.faceFor(CAP_FACET).writerFor(tx); });
      // 端口随事务终结——用新事务重取再写（攻击面：幽灵 oid）
      const c = w.uow(ADM, (tx) => {
        const wr2 = w.kernel.faceFor(CAP_FACET).writerFor(tx);
        return code(() => wr2.write({ ns: 'dom_test_facet', oid: asOid('OBJ-GHOST-B1'), revision: 1, payload: {}, eventType: 'extension-registered' }));
      });
      expect(c).toBe('NOT_FOUND_IN_SPACE');
      expect(counts(w)).toEqual(before);
      expect(w.kernel.head).toBe(head0); // ledger 序不消耗（ST-4 语义不破坏）
    } finally { w.close(); rmSync(dir, { recursive: true, force: true }); }
  });

  test('【洞仍在·登记一致+新落点】幽灵 from + required:false：软边静默入库，审计面**看不见**它，反向视图被注入', () => {
    const { dir, w } = open('g2a-b2-');
    try {
      const victim = w.uow(ADM, (tx) => tx.createObject({ kind: 'test.claim', payload: { text: 'ORIGINAL' } }));
      // 领域 scoped 事务（不是装配后门）：from 是幽灵、软边——归属判定整段跳过（linkRef `if (src)`）
      const c = w.uowFor(CAP_FACET, ADM, (tx) => code(() => tx.linkRef({
        from: { kind: 'revision-ref', oid: asOid('OBJ-GHOST-B2'), revision: 42 },
        to: { kind: 'revision-ref', oid: victim, revision: 1 }, role: 'g2a-ghost-soft', required: false,
      })));
      expect(c).toBe('NO_REFUSAL'); // 作者登记「这种边仍静默入库」——复测为真
      // 新落点①：auditRequiredIntegrity 只巡 required=1 ⇒ 这类注入对审计面完全隐形
      const audit = w.kernel.auditRequiredIntegrity();
      expect(audit.checked).toBe(0);
      // 新落点②：反向依赖视图收到攻击者投递的幽灵候选（G1-A A-3 的软边版仍成立）
      const cand = w.kernel.impactCandidates(victim, 1);
      expect(cand.candidates.some((x) => x.oid === ('OBJ-GHOST-B2' as never) && x.role === 'g2a-ghost-soft')).toBe(true);
    } finally { w.close(); rmSync(dir, { recursive: true, force: true }); }
  });

  test('【修住】幽灵 from + required:true：提交期按源端修订存在性拒绝（level:source），零残留', () => {
    const { dir, w } = open('g2a-b3-');
    try {
      const victim = w.uow(ADM, (tx) => tx.createObject({ kind: 'test.claim', payload: { text: 'ORIGINAL' } }));
      const before = counts(w);
      let detail: Record<string, unknown> | undefined;
      try {
        w.uow(ADM, (tx) => {
          tx.linkRef({ from: { kind: 'revision-ref', oid: asOid('OBJ-GHOST-B3'), revision: 1 },
            to: { kind: 'revision-ref', oid: victim, revision: 1 }, role: 'g2a-b3', required: true });
        });
      } catch (e) { detail = (e as { detail?: Record<string, unknown> }).detail; }
      expect(detail).toBeDefined();
      expect(detail!.level).toBe('source');
      expect(counts(w)).toEqual(before);
    } finally { w.close(); rmSync(dir, { recursive: true, force: true }); }
  });

  test('【洞仍在·登记一致】readAsOf 不判 ns：他人核心对象上的扩展行整体端出，与单对象读面互相矛盾', () => {
    const { dir, w } = open('g2a-b4-');
    try {
      const victim = w.uow(ADM, (tx) => tx.createObject({ kind: 'test.claim', payload: { text: 'CORE' } }));
      // 合法挂载外形（Q45 形态：oid 在目录、行落自己 ns）写「伪造修订 99」——机制无法与恶意行区分
      w.uow(ADM, (tx) => {
        const wr = w.kernel.faceFor(CAP_FACET).writerFor(tx);
        wr.write({ ns: 'dom_test_facet', oid: victim, revision: 1, payload: { ext: 'facet-at-rev1' }, eventType: 'extension-registered' });
        wr.write({ ns: 'dom_test_facet', oid: victim, revision: 99, payload: { ext: 'facet-at-rev99' }, eventType: 'extension-registered' });
      });
      // 扫描面：同一 (oid,revision) 出现两行不同载荷，行上没有 ns 可归因
      const scan = readAsOf(w.kernel, ctx(w));
      const vRows = scan.rows.filter((r) => r.oid === victim);
      expect(vRows.filter((r) => r.revision === 1).length).toBe(2);        // core rev1 + facet ext rev1
      expect(vRows.some((r) => r.revision === 99 && (r.payload as { ext?: string }).ext === 'facet-at-rev99')).toBe(true);
      expect('ns' in vRows[0]!).toBe(false);                                // 消费方无从区分权威行与扩展行
      // 单对象面：同一条数据给出第三个答案
      expect(w.readObject(victim)!.revision).toBe(1);
      expect(w.readRevision({ kind: 'revision-ref', oid: victim, revision: 99 })).toBeUndefined();
      // 台账行主体：扩展通道的 ledger.actor 恒 'system:capability'（真实主体不进这列）
      const led = w.raw.get<{ actor: string }>(`select actor from ledger where object_id=? and revision=99`, victim);
      expect(led!.actor).toBe('system:capability');
    } finally { w.close(); rmSync(dir, { recursive: true, force: true }); }
  });

  test('【修住】scoped 事务对他人对象 appendLedger：CAPABILITY_SCOPE_ESCAPE，拒绝先于写入（g1a §④ 点名形态的席位复测）', () => {
    const { dir, w } = open('g2a-b6-');
    try {
      const victim = w.uow(ADM, (tx) => tx.createObject({ kind: 'test.claim', payload: { text: 'CORE' } }));
      // facet 作用域的事务给 object-model 的对象挂普通台账——归属判据必须拦
      expect(w.uowFor(CAP_FACET, ADM, (tx) => code(() => tx.appendLedger({
        eventType: 'synth:foreign-note', objectId: victim, revision: 1, payload: {} })))).toBe('CAPABILITY_SCOPE_ESCAPE');
      expect(w.raw.get<{ c: number }>(`select count(*) c from ledger where event_type='synth:foreign-note'`)!.c).toBe(0);
      // 装配作用域写他人对象台账仍可用（Q40 协调权，反向对照：修法不得一刀切）
      expect(w.uow(ADM, (tx) => code(() => tx.appendLedger({
        eventType: 'synth:assembly-note', objectId: victim, revision: 1, payload: {} })))).toBe('NO_REFUSAL');
      // 同一事务内自己 ns 的合法台账（正例锚点）
      expect(w.uowFor(CAP_FACET, ADM, (tx) => code(() => tx.appendLedger({
        eventType: 'synth:facet-note', payload: {} })))).toBe('NO_REFUSAL');
    } finally { w.close(); rmSync(dir, { recursive: true, force: true }); }
  });

  test('【修住】write() 台账行冒充正式事件类型：EVENT_AUTHORITY_REQUIRED 先于 domain_state 插入，零残留', () => {
    const { dir, w } = open('g2a-b5-');
    try {
      const victim = w.uow(ADM, (tx) => tx.createObject({ kind: 'test.claim', payload: { text: 'CORE' } }));
      const before = counts(w);
      const c = w.uow(ADM, (tx) => {
        const wr = w.kernel.faceFor(CAP_FACET).writerFor(tx);
        return code(() => wr.write({ ns: 'dom_test_facet', oid: victim, revision: 5, payload: {},
          eventType: FACT_DESIGNATION_EVENT }));
      });
      expect(c).toBe('EVENT_AUTHORITY_REQUIRED');
      expect(counts(w)).toEqual(before); // 状态行/ledger/journal 都没落
    } finally { w.close(); rmSync(dir, { recursive: true, force: true }); }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('C. D-20 事件权威——三层机制的绕道尝试', () => {
  test('【修住】换 declareRecord 通道不行；assembly 作用域同样被通道判据拦住', () => {
    const { dir, w } = open('g2a-c1-');
    try {
      const c1 = w.uow(ADM, (tx) => code(() => tx.declareRecord({
        recordId: 'R-G2A-C1', eventType: FACT_DESIGNATION_EVENT, payload: { note: 'AUTHORIZED' } })));
      expect(c1).toBe('EVENT_AUTHORITY_REQUIRED');
      const c2 = w.uow(ADM, (tx) => code(() => tx.appendLedger({ eventType: FACT_DESIGNATION_EVENT, payload: {} })));
      expect(c2).toBe('EVENT_AUTHORITY_REQUIRED');
      expect(counts(w).r).toBe(0); // records 也没被声明（先判通道再动 records）
    } finally { w.close(); rmSync(dir, { recursive: true, force: true }); }
  });

  test('【修住】登记判据在装配期生效：重复登记 AMBIGUOUS_AUTHORITY；指向未激活能力 CAPABILITY_INACTIVE', () => {
    const dup: PluginManifest = {
      pluginId: 'g2a.evil.dup', codeVersion: '0', provides: [{ capability: 'cap.g2a.evil', contractVersion: 'v1' }],
      requires: [], storageNamespace: 'dom_g2a_evil', eventAuthority: 'none',
      ownsEventTypes: [{ eventType: FACT_DESIGNATION_EVENT, capability: 'cap.g2a.evil' }],
    };
    const orphan: PluginManifest = {
      pluginId: 'g2a.evil.orphan', codeVersion: '0', provides: [{ capability: 'cap.g2a.evil2', contractVersion: 'v1' }],
      requires: [], storageNamespace: 'dom_g2a_evil2', eventAuthority: 'none',
      ownsEventTypes: [{ eventType: 'synth:orphan', capability: 'cap.not.registered' }],
    };
    const dir = mkdtempSync(join(POC_DATA_DIR, 'g2a-c2-'));
    try {
      expect(() => openWorld({ file: join(dir, 'a.db'), space: 'SP-C2A', grants: GRANTS, plugins: [TEST_OBJECT_MODEL, TEST_RECORDS, dup] }))
        .toThrow(/AMBIGUOUS_AUTHORITY/);
      expect(() => openWorld({ file: join(dir, 'b.db'), space: 'SP-C2B', grants: GRANTS, plugins: [TEST_OBJECT_MODEL, orphan] }))
        .toThrow(/CAPABILITY_INACTIVE/);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  test('【修住】policyVersion 用已知版本但 issuer 冒充：issuer≠机制 actor ⇒ 不进投影', () => {
    const { dir, w } = open('g2a-c3-');
    try {
      const victim = w.uow(ADM, (tx) => tx.createObject({ kind: 'test.claim', payload: { text: 'CORE' } }));
      w.uow(NOBODY, (tx) => w.kernel.faceFor(CAP_RECORDS).writerFor(tx).appendAuthoritativeEvent({
        eventType: FACT_DESIGNATION_EVENT, objectId: victim, revision: 1,
        payload: { designationSchema: FACT_DESIGNATION_SCHEMA, stance: 'ACCEPTED',
          issuer: 'g2a-adm', authorization: 'AUTHORIZED', policyVersion: FACT_STANDING_POLICY_VERSION },
      })); // 通道合法（记录域 face + 有 space-write 的主体），issuer 自称 adm——机制把 actor 记成 nobody
      const st = w.standingUseCase().standingAt(victim, w.kernel.head);
      expect(st.state).toBe('NOT_ADOPTED'); // 载荷自称不算身份：机制 actor 对不上
    } finally { w.close(); rmSync(dir, { recursive: true, force: true }); }
  });

  test('【发现】唯一入口不核对业务授权轴：issuer=actor（诚实）+ authorization 自称 AUTHORIZED ⇒ 无 domain-admission 也翻转 ADOPTED', () => {
    const { dir, w } = open('g2a-c4-');
    try {
      const victim = w.uow(ADM, (tx) => tx.createObject({ kind: 'test.claim', payload: { text: 'CORE' } }));
      // g2a-nobody 只有 space-write，没有 domain-admission。它拿不到记录域窄面（插件模型内），
      // 这里以装配位置模拟「记录域实现内部（或被篡改的记录域代码）直接调机制入口」——
      // 即 CONTRACTS §16.2 的「领域写入当时的判定落成数据」这一步**没做**、绕开 FactStandingPolicy。
      w.uow(NOBODY, (tx) => w.kernel.faceFor(CAP_RECORDS).writerFor(tx).appendAuthoritativeEvent({
        eventType: FACT_DESIGNATION_EVENT, objectId: victim, revision: 1,
        payload: { designationSchema: FACT_DESIGNATION_SCHEMA, stance: 'ACCEPTED',
          issuer: 'g2a-nobody', authorization: 'AUTHORIZED', policyVersion: FACT_STANDING_POLICY_VERSION },
      }));
      expect(w.standingUseCase().standingAt(victim, w.kernel.head).state).toBe('ADOPTED');
      // 对照：同一主体走正当 Port ⇒ AUTHORITY_UNVERIFIED 不落 ADOPTED
      const v2 = w.uow(ADM, (tx) => tx.createObject({ kind: 'test.claim', payload: { text: 'CORE2' } }));
      w.uow(NOBODY, (tx) => {
        const uc = w.standingUseCase();
        uc.declare(tx, { oid: v2, revision: 1, stance: 'ACCEPTED' });
      });
      expect(w.standingUseCase().standingAt(v2, w.kernel.head).state).toBe('NOT_ADOPTED');
    } finally { w.close(); rmSync(dir, { recursive: true, force: true }); }
  });

  test('【发现·契约主张未兑现】停用归属能力后「两个通道都写不动」为假：权威通道仍能签发正式事件', () => {
    const { dir, w } = open('g2a-c5-');
    try {
      const victim = w.uow(ADM, (tx) => tx.createObject({ kind: 'test.claim', payload: { text: 'CORE' } }));
      w.unloadCapability(CAP_RECORDS, ADM); // capability-admin 轴停用（运维止血）
      // 通道 A：通用 appendLedger —— 与契约一致，写不动
      expect(w.uow(ADM, (tx) => code(() => tx.appendLedger({ eventType: FACT_DESIGNATION_EVENT, payload: {} }))))
        .toBe('EVENT_AUTHORITY_REQUIRED');
      // 通道 B：权威通道 —— CONTRACTS §16.2：「拥有者被停用时，正式事件在两个通道上都写不动」
      const c = w.uow(ADM, (tx) => code(() => w.kernel.faceFor(CAP_RECORDS).writerFor(tx)
        .appendAuthoritativeEvent({ eventType: FACT_DESIGNATION_EVENT, objectId: victim, revision: 1,
          payload: { designationSchema: FACT_DESIGNATION_SCHEMA, stance: 'ACCEPTED',
            issuer: 'g2a-adm', authorization: 'AUTHORIZED', policyVersion: FACT_STANDING_POLICY_VERSION } })));
      // 实测：机制对停用状态零核对（namespacedWriter 与 appendAuthoritativeEvent 都不查 capability 激活）
      expect(c).toBe('NO_REFUSAL');
      expect(w.raw.get<{ c: number }>(`select count(*) c from ledger where event_type='synth:fact-designation'`)!.c).toBe(1);
      // 同能力的其它写面确实死了（对照，证明停用不是全空转）
      expect(w.uow(ADM, (tx) => code(() => w.kernel.faceFor(CAP_RECORDS).writerFor(tx)
        .write({ ns: 'dom_test_records', oid: victim, revision: 1, payload: {}, eventType: 'x-registered' }))))
        .toBe('CAPABILITY_INACTIVE');
    } finally { w.close(); rmSync(dir, { recursive: true, force: true }); }
  });

  test('【修住】撤销 × 历史双钉：旧事件按当时 policyVersion 继续生效；撤销后新声明落 UNVERIFIED 不计入', () => {
    const { dir, w } = open('g2a-c6-');
    try {
      const victim = w.uow(ADM, (tx) => tx.createObject({ kind: 'test.claim', payload: { text: 'CORE' } }));
      w.uow(BOB, (tx) => { w.standingUseCase().declare(tx, { oid: victim, revision: 1, stance: 'ACCEPTED' }); });
      const uc = w.standingUseCase();
      expect(uc.standingAt(victim, w.kernel.head).state).toBe('ADOPTED');
      // 撤销业务授权轴（同时撤销装配根的运维轴做反向对照）
      w.revoke('g2a-bob', 'domain-admission');
      // 方向①：已落库事件不被当前权限重解释
      expect(uc.standingAt(victim, w.kernel.head).state).toBe('ADOPTED');
      // 方向②：撤销后的新写入不生效——WITHDRAWN 以 UNVERIFIED 落库、不翻转状态
      w.uow(BOB, (tx) => { w.standingUseCase().declare(tx, { oid: victim, revision: 1, stance: 'WITHDRAWN' }); });
      expect(uc.standingAt(victim, w.kernel.head).state).toBe('ADOPTED');
      const rows = w.raw.all<{ authorization: string }>(
        `select json_extract(payload_json,'$.authorization') authorization from ledger where event_type='synth:fact-designation' order by seq`);
      expect(rows.map((r) => r.authorization)).toEqual(['AUTHORIZED', 'AUTHORITY_UNVERIFIED']);
      // 运维轴：capability-admin 撤销后路由类操作被拒（该轴与事件通道本就分轴）
      w.revoke('g2a-adm', 'capability-admin');
      expect(code(() => w.unloadCapability(CAP_OBJECT_MODEL, ADM))).toBe('AUTHORITY_REQUIRED');
    } finally { w.close(); rmSync(dir, { recursive: true, force: true }); }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('D. D-22 受限提交 Port——运行时可达性自己枚举', () => {
  test('【修住】ValidationService：自有属性/符号/原型链全量枚举后无任何事务执行器', () => {
    const { dir, w } = open('g2a-d1-');
    try {
      let captured: UnitOfWork | undefined;
      const legacy = <R>(fn: (tx: UnitOfWork) => R): R => { const out = w.uow(ADM, (tx) => { captured = tx; return fn(tx); }); return out; };
      const svc = new ValidationService(w.kernel.faceFor(CAP_RECORDS), legacy, (r) => w.readRevision(r));
      // 1) 自有面：TS #私有 ⇒ 运行时**不存在**这些键
      expect(Object.getOwnPropertyNames(svc)).toEqual([]);
      expect(Object.getOwnPropertySymbols(svc)).toEqual([]);
      expect(Reflect.ownKeys(svc)).toEqual([]);
      // 2) 原型链：只许出现方法名，不得有 raw/k/runIn/submit
      const proto = Object.getPrototypeOf(svc) as object;
      expect(proto).toBe(ValidationService.prototype);
      const names = Object.getOwnPropertyNames(proto);
      expect(names.sort()).toEqual(['checkEndpoint', 'constructor', 'run', 'withValidatorOffline'].sort());
      expect((svc as unknown as Record<string, unknown>).runIn).toBeUndefined();
      expect((svc as unknown as Record<string, unknown>).submit).toBeUndefined();
      // 3) 静态面（.constructor 逃逸家族）
      expect(Object.getOwnPropertyNames(ValidationService).sort()).toEqual(['length', 'name', 'prototype']);
      // 4) 实例方法返回值面不带事务句柄：run() 的返回只有报告形态
      const d1 = w.uow(ADM, (tx) => tx.createObject({ kind: 'test.claim', payload: { claim: 'x' } }));
      const runOut = svc.run(d1, 1, { actor: 'g2a-alice' }, 'v1');
      expect(JSON.stringify(runOut)).not.toMatch(/createObject|recordReport|appendLedger/);
      void captured;
    } finally { w.close(); rmSync(dir, { recursive: true, force: true }); }
  });

  test('【修住】直接调用 adaptLegacyValidationWiring（模块导出面）：只造出单动作对象，原执行器不进任何可枚举位置', () => {
    const { dir, w } = open('g2a-d2-');
    try {
      const seen: unknown[] = [];
      const wrapped = adaptLegacyValidationWiring(<R>(fn: (tx: UnitOfWork) => R): R => {
        seen.push(fn); // 适配器给它的永远是**内部回调**，不是句柄
        return w.uow(ADM, fn);
      });
      expect(Object.getOwnPropertyNames(wrapped)).toEqual(['submitReport']);
      expect(Object.getPrototypeOf(wrapped)).toBe(Object.prototype);
      expect(Object.getOwnPropertySymbols(wrapped)).toEqual([]);
      // seen 里只有 (tx)=>tx.recordReport(a) 这一支闭包；调用方本来就持有自己的执行器——无新增泄漏
      expect(seen.length).toBe(0); // 尚未 submit
      const r = wrapped.submitReport({
        target: { kind: 'revision-ref', oid: asOid('OBJ-NONE-D2'), revision: 1 },
        validatorId: 'synth-claim-checker', ruleVersion: 'v1', schemaVersion: 's1', environment: 'e1',
        executedAt: 1, guaranteeScope: 'g1', verdict: 'INDETERMINATE', findings: [], declaredGaps: [],
      } as never);
      expect(typeof r.reportId).toBe('string');
      expect(seen.length).toBe(1);
      expect(typeof seen[0]).toBe('function');
      // 闭包不可反向取参：包装对象上没有任何键指向 runIn
      expect(Reflect.ownKeys(wrapped).length).toBe(1);
    } finally { w.close(); rmSync(dir, { recursive: true, force: true }); }
  });

  test('【发现·同课重抄】构造参数属性教训只在 ValidationService 修了：其余领域/用例类仍把协作对象挂在运行时自有可枚举字段上', () => {
    const { dir, w } = open('g2a-d3-');
    try {
      const pol = new FactStandingPolicy(w.kernel.faceFor(CAP_RECORDS), w.authority);
      expect(Object.getOwnPropertyNames(pol).sort()).toEqual(['authority', 'face']); // 授权探针在运行时可枚举
      const facets = new FacetStore(w.kernel.faceFor(CAP_FACET));
      expect(Object.getOwnPropertyNames(facets)).toEqual(['face']);
      const iuc = w.intakeUseCase();
      expect(Object.getOwnPropertyNames(iuc).sort()).toEqual(['delegation', 'policy']); // delegation 可枚举（写面白名单对象）
      const suc = w.standingUseCase();
      expect(Object.getOwnPropertyNames(suc).sort()).toEqual(['commands', 'policy']);
      // 事实核对：authority 探针能枚举授权矩阵（对持有 policy 的一方是新的读面）
      const probe = (pol as unknown as { authority: { can(a: string, r: string, s: unknown): boolean } }).authority;
      expect(probe.can('g2a-adm', 'domain-admission', w.kernel.space)).toBe(true);
      expect(probe.can('g2a-nobody', 'domain-admission', w.kernel.space)).toBe(false);
    } finally { w.close(); rmSync(dir, { recursive: true, force: true }); }
  });

  test('【修住】其它接 UnitOfWork 形参的领域类：FacetStore 拿到装配全权事务也只能写自己 ns（写面随端口、不随事务）', () => {
    const { dir, w } = open('g2a-d4-');
    try {
      const victim = w.uow(ADM, (tx) => tx.createObject({ kind: 'test.claim', payload: { text: 'CORE' } }));
      const facets = new FacetStore(w.kernel.faceFor(CAP_FACET));
      // 装配作用域事务直入领域对象（D-22 的「一般形态」）：合法挂载成功
      w.uow(ADM, (tx) => facets.write(tx, victim, { calib: 1 }));
      expect(w.kernel.faceFor(CAP_FACET).readOwn(victim)?.payload).toEqual({ calib: 1 });
      // 越权：拿别人的 ns 来写 ⇒ NAMESPACE_ESCAPE（与事务作用域无关，端口自带上界）
      w.uow(ADM, (tx) => {
        expect(code(() => facets.writeIntoForeignNamespace(tx, victim))).toBe('NAMESPACE_ESCAPE');
      });
    } finally { w.close(); rmSync(dir, { recursive: true, force: true }); }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('E. 组合联合复验（同一测试世界：事务 × 写权威 × 双时间读 × Facet × 跨插件单事务）', () => {
  test('C1 跨能力两腿事务，第二腿 EVENT_AUTHORITY_REQUIRED 抛出 ⇒ 第一腿全回滚、ledger/journal 零残留、登记序不回退', () => {
    const { dir, w } = open('g2a-e1-');
    try {
      const base = counts(w);
      const head0 = w.kernel.head;
      let thrown = 'NO_THROW';
      try {
        w.uow(ADM, (tx) => {
          // 腿 1：对象模型能力的权威端口造对象（经委派面）
          const oid = w.writerOwningKind('test.claim', tx).createOwned({ kind: 'test.claim', payload: { v: 1 } });
          // 腿 1b：Facet 在同一事务里挂扩展行（第二个能力）
          w.kernel.faceFor(CAP_FACET).writerFor(tx).write({ ns: 'dom_test_facet', oid, revision: 1, payload: { ext: 1 }, eventType: 'extension-registered' });
          // 腿 2：同一条事务里用通用通道写正式事件 ⇒ 通道判据当场抛（异常穿透回调 = 真实失败形态）
          tx.appendLedger({ eventType: FACT_DESIGNATION_EVENT, payload: { forged: true }, objectId: oid, revision: 1 });
        });
      } catch (e) { thrown = (e as { code?: string }).code ?? 'UNKNOWN'; }
      expect(thrown).toBe('EVENT_AUTHORITY_REQUIRED');
      expect(counts(w)).toEqual(base);            // 六表全部回到起点：第一腿真回滚
      expect(w.kernel.head).toBe(head0);          // ST-4：登记序不被失败的尝试消耗
      // 世界仍可用（对照：拒绝没有把空间打砖）
      const oid = w.uow(ADM, (tx) => tx.createObject({ kind: 'test.claim', payload: { v: 2 } }));
      expect(oid).toBeTruthy();
    } finally { w.close(); rmSync(dir, { recursive: true, force: true }); }
  });

  test('C2 合法挂载外壳 + D-24 修订归因 + required 边：挂载救不了修订级误判（两端都判归属 ns）', () => {
    const { dir, w } = open('g2a-e2-');
    try {
      const mine = w.uow(ADM, (tx) => tx.createObject({ kind: 'test.claim', payload: { who: 'mine' } }));
      const victim = w.uow(ADM, (tx) => tx.createObject({ kind: 'test.claim', payload: { who: 'victim' } }));
      // 先用合法挂载外形把 victim@99 造出来（行形态完全合法，机制放行）
      w.uow(ADM, (tx) => w.kernel.faceFor(CAP_FACET).writerFor(tx)
        .write({ ns: 'dom_test_facet', oid: victim, revision: 99, payload: { ext: 99 }, eventType: 'extension-registered' }));
      // 攻击：required 边指 victim@99——「挂载外壳」不该让修订判据误判存在
      // （拒绝发生在**提交期** checkRequiredRefs，异常从 uow 边界抛出，不是 linkRef 当场抛）
      let c = 'NO_REFUSAL';
      try {
        w.uow(ADM, (tx) => tx.linkRef({
          from: { kind: 'revision-ref', oid: mine, revision: 1 },
          to: { kind: 'revision-ref', oid: victim, revision: 99 }, role: 'g2a-e2', required: true }));
      } catch (e) { c = (e as { code?: string }).code ?? 'UNKNOWN'; }
      expect(c).toBe('REQUIRED_REF_MISSING'); // 归属 ns 判据：99 只在 facet ns 存在 ⇒ 不算存在
      expect(w.raw.get<{ n: number }>(`select count(*) n from ref_edge where role='g2a-e2'`)!.n).toBe(0); // 整体回滚
      // 反例锚点：指真实修订 1 ⇒ 提交成功
      const ok = w.uow(ADM, (tx) => code(() => tx.linkRef({
        from: { kind: 'revision-ref', oid: mine, revision: 1 },
        to: { kind: 'revision-ref', oid: victim, revision: 1 }, role: 'g2a-e2-ok', required: true })));
      expect(ok).toBe('NO_REFUSAL');
      // 权威通道同判据：appendAuthoritativeEvent 对 victim@99 也拒（§16.2 判据③与 D-24② 同源实测）
      const c3 = w.uow(ADM, (tx) => code(() => w.kernel.faceFor(CAP_RECORDS).writerFor(tx)
        .appendAuthoritativeEvent({ eventType: FACT_DESIGNATION_EVENT, objectId: victim, revision: 99, payload: {} })));
      expect(c3).toBe('NOT_FOUND_IN_SPACE');
    } finally { w.close(); rmSync(dir, { recursive: true, force: true }); }
  });

  test('C3 审计入口穷举不可达 + 存量脏边不阻塞任何主体的新提交（含领域 scoped 路径）', () => {
    const { dir, w } = open('g2a-e3-');
    try {
      // —— 可达性穷举：从插件能持有的每一类对象出发，沿自有属性+原型链走 3 层，收集可达函数名
      const face = w.kernel.faceFor(CAP_FACET);
      const seenFns = new Set<string>();
      const seenOwn = new Set<string>();   // 「path.key」形式的成员，含非函数（原型方法一并记账）
      const safeGet = (o: object, k: string | symbol): unknown => {
        try { return (o as Record<string | symbol, unknown>)[k]; } catch { return undefined; } // strict 模式下 caller/callee/arguments 会抛
      };
      const walk = (x: unknown, depth: number, path: string) => {
        if (depth === 0 || x === null || (typeof x !== 'object' && typeof x !== 'function')) return;
        const o = x as object;
        for (const k of Object.getOwnPropertyNames(o)) {
          if (k === 'caller' || k === 'callee' || k === 'arguments') continue;
          seenOwn.add(`${path}.${k}`);
          if (typeof safeGet(o, k) === 'function') seenFns.add(`${path}.${k}`);
          walk(safeGet(o, k), depth - 1, `${path}.${k}`);
        }
        for (const k of Object.getOwnPropertySymbols(o)) seenOwn.add(`${path}.[sym:${String(k.description)}]`);
        if (typeof x === 'function') for (const k of ['prototype', 'constructor']) walk(safeGet(o, k), depth - 1, `${path}.${k}`);
        walk(Object.getPrototypeOf(o), depth - 1, `${path}[[proto]]`);
      };
      let refusal: unknown; try { w.kernel.namespacedWriter(CAP_FACET, { fake: true } as never); } catch (e) { refusal = e; }
      let txProtoNames: string[] = []; let wrProtoNames: string[] = []; let protoExtras: string[] = [];
      w.uow(ADM, (tx) => {
        const wr = face.writerFor(tx);
        walk(face, 3, 'face'); walk(tx, 3, 'tx'); walk(wr, 3, 'wr'); walk(refusal, 3, 'refusal');
        txProtoNames = Object.getOwnPropertyNames(Object.getPrototypeOf(tx)).sort();
        wrProtoNames = Object.getOwnPropertyNames(Object.getPrototypeOf(wr)).sort();
        // 【发现测量】声明类型面 vs 运行时原型面：UnitOfWork 接口声明的成员之外还挂着什么？
        const DECLARED_TX = ['appendLedger', 'constructor', 'createObject', 'declareRecord', 'linkRef', 'principal', 'readLatest', 'recordReport', 'revise'];
        protoExtras = txProtoNames.filter((n) => !DECLARED_TX.includes(n));
      });
      const joined = [...seenFns].join(' ');
      for (const forbidden of ['auditRequiredIntegrity', 'setRouteEnabled', 'grantCrossEventRead', 'revokeCrossEventRead',
        'namespacedWriter', 'assertAuthority', 'transferRoute']) {
        expect(joined, `插件对象图里不该出现 ${forbidden}`).not.toContain(forbidden);
      }
      // 特征化【发现】：tx 的运行时原型比 UnitOfWork 声明类型面**宽**——多出的
      // reassignRouteInternal 直接改写 capability_route（Kernel.transferRoute 的裸通道，注释自称
      // 「仅机制内部可达」，但运行时就在插件经手的 tx 实例原型上，靠方法体内 assertAuthority 兜底）；
      // 「类型面即边界」实为编译期边界——P2 观察（见报告 §③）。
      expect(protoExtras.sort()).toEqual(['checkRequiredRefs', 'reassignRouteInternal']);
      expect(txProtoNames.filter((n) => /^(get|all|run|prepare)$/.test(n)), '不得有裸 SQL 面').toEqual([]);
      // 越权运行 reassignRouteInternal（NOBODY 无 capability-admin）：授权核对兜住
      expect(w.uowFor(CAP_FACET, NOBODY, (tx) => code(() => (tx as unknown as
        { reassignRouteInternal(c: string, p: string, ns: string): void }).reassignRouteInternal(CAP_FACET, 'x', 'y'))))
        .toBe('AUTHORITY_REQUIRED');
      // writer 原型面：只允许声明成员（appendAuthoritativeEvent 在面上是设计内的通道入口）
      expect(wrProtoNames).toEqual(['appendAuthoritativeEvent', 'constructor', 'createOwned', 'effectiveContractVersion',
        'linkOwned', 'ns', 'readLatest', 'reviseOwned', 'write'].sort());
      // face 自有面恰好 6 成员、无符号（穷举实测值，不是"应该没有"的口头断言）
      expect(Object.getOwnPropertyNames(face).sort()).toEqual(
        ['capability', 'eventsOf', 'readOwn', 'revisionOf', 'space', 'writerFor'].sort());
      expect(Object.getOwnPropertySymbols(face)).toEqual([]);
      // —— 后果锁（独立于 g1a 的造法）：脏 required 边经装配后门入库后，
      const victim = w.uow(ADM, (tx) => tx.createObject({ kind: 'test.claim', payload: { v: 1 } }));
      w.raw.run(`insert into ref_edge(from_oid, from_rev, to_oid, to_rev, to_record, role, required) values(?,?,?,null,null,'dirty',1)`,
        victim, 1, 'OBJ-GHOST-E3');
      const audit = w.kernel.auditRequiredIntegrity();
      expect(audit.violations.length).toBe(1);
      // 无关主体的**合法**提交必须继续成功：装配 + 领域 scoped 两条路都试
      expect(w.uow(ADM, (tx) => code(() => tx.createObject({ kind: 'test.claim', payload: { i: 'innocent' } })))).toBe('NO_REFUSAL');
      expect(w.uowFor(CAP_OBJECT_MODEL, ADM, (tx) => code(() => tx.revise(victim, { payload: { v: 2 } })))).toBe('NO_REFUSAL');
      // 新事务自己的悬空边仍在**提交期**被拒（增量≠放松；拒绝发生在 checkRequiredRefs，异常从 uow 边界出）
      let fresh = 'NO_REFUSAL';
      try {
        w.uow(ADM, (tx) => tx.linkRef({ from: { kind: 'revision-ref', oid: victim, revision: 2 },
          to: { kind: 'revision-ref', oid: asOid('OBJ-GHOST-E3B'), revision: 1 }, role: 'fresh-dirty', required: true }));
      } catch (e) { fresh = (e as { code?: string }).code ?? 'UNKNOWN'; }
      expect(fresh).toBe('REQUIRED_REF_MISSING');
    } finally { w.close(); rmSync(dir, { recursive: true, force: true }); }
  });

  test('C4 组合双时间面：伪造外形行让「扫描面有、单对象面无」——同一 (oid,rev) 在两读面互相矛盾（登记缺口的组合形态钉死）', () => {
    const { dir, w } = open('g2a-e4-');
    try {
      const victim = w.uow(ADM, (tx) => tx.createObject({ kind: 'test.claim', payload: { text: 'CORE' } }));
      w.uow(ADM, (tx) => w.kernel.faceFor(CAP_FACET).writerFor(tx)
        .write({ ns: 'dom_test_facet', oid: victim, revision: 2, payload: { ext: 'forged-look' }, eventType: 'extension-registered' }));
      // readLatest 视角：victim 的权威最新是 rev1
      const latest = w.uow(ADM, (tx) => tx.readLatest(victim)!);
      expect(latest.revision).toBe(1);
      // readAsOf 视角：rev2「存在」且载荷是他人 ns 的扩展行
      const scan = readAsOf(w.kernel, ctx(w));
      expect(scan.rows.some((r) => r.oid === victim && r.revision === 2)).toBe(true);
      // 精确引用视角：rev2 不存在
      expect(w.readRevision({ kind: 'revision-ref', oid: victim, revision: 2 })).toBeUndefined();
      // 且 required 边判据与 readRevision 同侧（C2 已证），与 readAsOf 异侧 ⇒ 三个读面两个答案
    } finally { w.close(); rmSync(dir, { recursive: true, force: true }); }
  });

  test('C5 撤销 capability-admin × 已落库事件：事件通道与运维轴分轴——历史按 policyVersion 继续生效，路由类新写被拒', () => {
    const { dir, w } = open('g2a-e5-');
    try {
      const victim = w.uow(ADM, (tx) => tx.createObject({ kind: 'test.claim', payload: { text: 'CORE' } }));
      w.uow(BOB, (tx) => { w.standingUseCase().declare(tx, { oid: victim, revision: 1, stance: 'ACCEPTED' }); });
      const uc = w.standingUseCase();
      expect(uc.standingAt(victim, w.kernel.head).state).toBe('ADOPTED');
      // 撤销 capability-admin（装配根运维轴）：事件读面与投影**必须不变**（历史不按当前权限重解释）
      w.revoke('g2a-adm', 'capability-admin');
      expect(uc.standingAt(victim, w.kernel.head).state).toBe('ADOPTED');
      // 运维新写被拒
      expect(code(() => w.kernel.grantCrossEventRead(CAP_FACET, ADM))).toBe('AUTHORITY_REQUIRED');
      expect(code(() => w.unloadCapability(CAP_OBJECT_MODEL, ADM))).toBe('AUTHORITY_REQUIRED');
      // 事件新写：不受 capability-admin 影响（分轴），受 domain-admission 影响（C6 已钉）；
      // 恢复 admin 后运维面恢复——撤销是状态不是污点
      w.grant('g2a-adm', 'capability-admin');
      expect(code(() => w.kernel.grantCrossEventRead(CAP_FACET, ADM))).toBe('NO_REFUSAL');
    } finally { w.close(); rmSync(dir, { recursive: true, force: true }); }
  });
});

```

---

## 收尾确认

- `git worktree remove --force .scratch/wt-g2a` 已执行（`git worktree list` 仅剩主树 `ba3d69d`）；本席全部实验夹具（GT 夹具、复制树、临时基线）已随手删除，攻击套件全文保存在上方附录 A。
- 主树 `git status --short` 仅一条：`?? experiments/v3-code-architecture-poc/attacks/review/RE-REVIEW-G2-A.md`（本报告）。HEAD 仍为 `ba3d69d`，作者文件零改动。
