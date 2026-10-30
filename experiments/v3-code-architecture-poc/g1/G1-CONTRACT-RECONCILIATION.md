# G1-CONTRACT-RECONCILIATION —— 跨契约硬不一致的裁决与变更台账

- 席位：跨契约对账席（父代理 `session-3e3f10a7` 委派，2026-11-01）。
- 输入冲突源：`G1-UNIFIED-CONTRACTS.md` §7.2 注册表 B 的 **I-1…I-6**（装配席登记，原文位置见各条）。
- 本文编号 **R-1…R-6 ↔ I-1…I-6** 一一对应；裁决口径来自父席 2026-11-01 指令（「修复要真改条文，
  不许加一句『待协调』了事」）。
- 更正纪律：照 `CONTRACTS.md` 的 D-25 / 包 4 更正段先例——**旧句保留于原位 + 就地标注取代**，
  不静默覆盖；本文只做**留痕与对账**，规范句一律在三部契约正文本体里。
- 未改动的文件（授权面外，逐条见 §7 回填清单）：`G1-UNIFIED-CONTRACTS.md`、`G1-ACCEPTANCE-MATRIX.md`、
  `G2-DEV-PLAN.md`、`G1-REMAINING-USER-DECISIONS.md`、`G1-ADJUDICATION-TABLE.md`、`CONTRACTS.md`、
  校验器与门禁、`src/**`、`tests/**`、`attacks/**`、冻结面。无任何 git 写操作。

## 0. 收口状态（一次看全）

| 项 | 状态 | 正文落点 | 夹具证据 |
| --- | --- | --- | --- |
| R-1 遮蔽计数呈现面 | 已修，两侧同步 | EA-7.2/7.4 更正段；FM-2.4 同步句；RL-6.5③/§8.1/T-N13 行 | EA T-P7（反转断言）+ T-N11 + MUT-5；FM T-N9 + MUT-4；RL T-N19 + MUT-8；机验 EA S15 / FM S14 / RL S15 |
| R-2 全形闸轴判据 | 已修，两侧互指 | EA-4.5 **三分**（③ 覆盖式）；FM-7 **DEP-EA45-3** + FM-9 见证列 + FM-11.2 行 | EA T-P8/T-N12 + MUT-4（+ 常驻作废形态 `gateFullShapeSuperseded2Branch`）；FM T-P8；机验 EA S16 / FM S12/S13 |
| R-3 `RELOCATABLE_NS_KEYS` | 已修，收窄并逐项区分 | RL-3.4/RL-6.4/§14.1-3；FM-2.5 末段 + FM-11.1 A.6-6 更正行 | RL T-P10/T-N18 + MUT-9；机验 RL S12 / FM S13 |
| R-4 `failedGate` 封闭集 | 已修：**10 → 12 门**正式入集 | RL-4（11 `APPROVAL` / 12 `REPAIR_PROVENANCE`）+ RL-3.3 + RL-8.4 | RL T-N17 + MUT-7；机验 RL S6（三方逐等 + 正文取值扫描） |
| R-5 批准主体 | 已修：契约不得自称已批准 | EA-2.4 拆块（**已入账 7 + 提案未入账 4**）+ EA-7.1 + EA-9.2-④；RL-2.2 + RL-8.2；FM-9 未动（标准形） | EA T-N13 + MUT-6，机验 EA S1/S1b/S2/S2b/S17/S17b；RL T-N20 + MUT-6，机验 RL S14 |
| R-6 无戳行的版本归属 | 已修，两侧同文 | EA-5.3 收口句；RL-6.1 版本列 + RL-8.4 新条 | EA T-P9/T-N14 + MUT-7；RL T-N21 + MUT-10；机验 EA S18 / RL S13 |

**实测（真实退出码，2026-11-01，本席最后一次全量跑）**

| 命令 | 退出码 | 结果 | 本轮前基线 |
| --- | --- | --- | --- |
| `node g1/G1-CONTRACT-EVENT-AUTHORITY.fixtures.mjs` | **0** | 48 PASS / 0 FAIL | 35 PASS / 0 FAIL |
| `node g1/G1-CONTRACT-FACET.fixtures.mjs` | **0** | 35 PASS / 0 FAIL | 29 PASS / 0 FAIL |
| `node g1/G1-CONTRACT-RELOCATION.fixtures.mjs` | **0** | 57 PASS / 0 FAIL | 42 PASS / 0 FAIL |
| `node g1-checklist-validate.mjs` | **0** | items=27 open=23 done=4 违规=0（绿） | 同 |
| `node g1-checklist-validate.mjs --self-test` | **0** | 变异自验 17/17 全部捕获 | 同 |
| `node g1-checklist-validate.mjs --require-clear` | **1**（**预期红**） | NO-GO 阶段放行谓词未满足；违规=0 | 同 |

正反例表计数同步：EA §8 **17 → 23** 例；FM §10 **15 → 17** 例；RL §13 **25 → 31** 例
（各自动三向逐等闸 S6 / S5 / S4，孤儿实现与表内空转都当场红）。

---

## 1. R-1（= I-1）遮蔽计数的呈现面

**原冲突**。裁决表 `G1-ADJUDICATION-TABLE.md` **D1-d（L51）/ C4（L73）**：`hiddenBy*` 遮蔽计数
**退出调用方 echo 面**，只进内部审计面（后裁，「裁决已定」）。EA 侧相反——
`G1-CONTRACT-EVENT-AUTHORITY.md` **§7.2 末句**：「……计数**照旧进读回执**」；
**§7.4 第二条**：「既有 `hiddenByContractSkew` 等 echo 键是……**已冻结面**……不改变任何既有键的取值来源」。
装配席原话影响：「实现批只能满足其一；夹具（读回执键集 vs 审计行数）互相矛盾」。

**裁决**（父席）：裁决表 D1-d/C4 为准。EA 两句作废并就地更正；计数**算法与留存一字不动**，
只改**出口**；EA/RL/FM 三份夹具的旧形态 echo 键集 repin 到新形态，并补负例
「普通响应面出现 `hiddenBy*` ⇒ 夹具红」。

**改了哪些条**

1. EA-7.2 末段：旧句**保留于原位**，其后追加「**【R-1 更正段｜2026-11-01……旧句保留于上、以本段为准】**」，
   宣布「计数照旧进读回执」作废，引 D1-d/C4 + #42 SP-03 + #47 SF-N-04 三个外锚，并写下判据句
   「**改的是出口，不是算法**」（遮蔽算法、`K=32`、「只报不阻」、审计载荷
   `hidden: {byContractSkew, byInactiveCapability}` 全部一字未动）。
2. EA-7.4「响应面零差分」bullet：旧两句保留 + 标注作废；新句「调用方 echo 面**不含任何 `hiddenBy*` 键**」
   ＋「隐藏 0 件、1 件、≥2 件三种世界在普通调用者处**逐字节同形**」；并处理与 §16.3 的关系：
   §16.3「echo 形状不加字段」那句**只禁加字段**，撤键不在其禁内（不留「两条裁决互斥」的残题）；
   旧键集 `{hiddenByContractSkew, hiddenByInactiveCapability}` 作为**历史形态**记录，标注 G2 落地时
   的 `arch-independence` 重锚义务。
3. FM-2.4 加「**同步句（R-1）**」：挂载面/插件可见响应零 `hiddenBy*` 键，且**不为此开新读数**
   （与 FM-3.1(a)/(b) 的「对外同形 / 内部保真」同立场）。
4. RL-6.5③ 的「扫描面照旧」加更正段：「**扫描面照旧 ≠ 调用方面照旧**——前者是算法与留存，后者是呈现面」；
   §8.1 报告面裁定补半句「遮蔽/漂移计数只进这一面」；RL-13 的 T-N13 行措辞同步改写。

**夹具证据**（三份夹具各一套「真判据拦得住 + 架空判据放过同一负例」）

| 侧 | 新形态 | 正例反转 | 新负例 | 常架空影 |
| --- | --- | --- | --- | --- |
| EA | `CALLER_ECHO_KEYS = []`；`pluginVisibleResponse()` 零 `hiddenBy*` | **T-P7**：断言从「`after` 含 `"hiddenByContractSkew":6`」反转为「零 `hiddenBy*` 键 + 计数在审计行里可回看 + 三态逐字节同形」 | **T-N11**：旧形态体（`pluginVisibleResponseSuperseded`）必判红 | **MUT-5**（只核「不出现审计事件名字样」）对同一泄漏体判绿 |
| FM | `pluginVisibleResponse()` 的 `echo: {}` | T-P5 原断言不变（挂载对属主读面零差分） | **T-N9** | **MUT-4** |
| RL | `callerBodyFor(code)` 只回 `{code}`（RL-INFO 唯一构造器） | T-N13/T-N11 等既有断言随构造器改形仍绿 | **T-N19**：旧体泄漏 + 计数仍在 `opsDetail` | **MUT-8** |

**仍开放**：G2 落地时按 §7.4 的历史形态句做 `arch-independence.test.ts` 重锚（撤键是**收紧**方向，
但面锚是逐字比对，必须逐条点名重锚，不走静默）——该义务已写进 EA-7.4 正文，不再悬空。

---

## 2. R-2（= I-2）`gateFullShape` 轴判据的覆盖式

**原冲突**。EA-4.5 只有两类别式：正式类 `axis ∉ MECHANISM_RESOURCES`、路由类
`axis = 'capability-admin'`。FM-7 轴值段把 `'facet-mount'` **扩入** `MECHANISM_RESOURCES`
（依据 C-17/D-26 的「至少」二字）⇒ 挂载审计行既不是路由审计，又因轴在机制轴集内被 ① 排除，
**两式皆不满足**；而 FM 未把「EA-4.5 需三类化」登记为依赖。

**裁决**（父席）：EA-4.5 轴判据改**三分**；③ 必须是**覆盖式谓词**（「轴 ∈ 机制轴集 ∧ 事件名 ∈
机制封闭名单」这一族），**不许再点名堆名单**；FACET 侧把「依赖 EA-4.5 三分修订」登记为显式依赖，
两侧同一批互指。

**改了哪些条**

1. EA-4.5 判据块的轴判据写成三分（封闭覆盖，**闸内不写任何事件名清单**）：
   ① `classify = 'domain' ∧ axis ∉ MECHANISM_RESOURCES`；
   ② `classify = 'mechanism' ∧ axis = 'capability-admin' ∧ authorized = 1`；
   ③ `classify = 'mechanism' ∧ axis ∈ MECHANISM_RESOURCES ∧ axis = registeredMechanismAxis(event_type) ∧ authorized = 1`。
2. 其后「**R-2 修订段**」三条如实写明：**② 是 ③ 的特例**（单列只为把 `route_change_guarded` 的既成形态
   钉成可读历史支，两支等价、不产生第二真源）；**③ 不许退化成名单**——三支只依赖三个既有正源
   （分类器 / 机制轴集 / 名册登记的机制轴），在闸内再写一份白名单就是把 C-27「名单与事实同源 ⇒ 失明」
   搬进闸门，按契约违例处置；**挂载方的显式依赖登记在同批**。
3. FM-7 轴值段新增 **DEP-EA45-3** 显式依赖登记（依赖已兑现 / 双向绑死 / **扩轴不撤**三条理由，
   含「撤轴会把挂载审计塞回 `capability-admin`，令路由审计与挂载审计同轴不可分」）；
   FM-9 见证列点名「依据 = EA-4.5 ③ 支（覆盖式谓词，非点名清单）」；FM-11.2 关系表加 R-1/R-2/R-3/R-5 四行。

**夹具证据**：EA **T-P8** 三支各命中 + **旧两类别式对挂载行必须判不过**（常驻作废形态
`gateFullShapeSuperseded2Branch` 就是「这刀真砍到了」的证据）+ **覆盖性自验**（临时新增一根机制轴 +
一个新机制名入账 ⇒ 判据一字不改即覆盖）；**T-N12** 串轴负例（挂载名带 `capability-admin`、
名单外名带机制轴、领域行冒充机制轴）+ **MUT-4**（③ 丢掉名册轴绑定）对同一串轴负例判绿。
FM **T-P8** 同一判据的挂载侧形态 + 名册轴 `EA_AXIS_OF` ↔ `MECHANISM_AXIS_OF` 逐等（防两份名册成二真源）。
互指机验：EA 夹具 **S16**、FM 夹具 **S12/S13**——任一侧单独回滚，另一侧当场红。

**仍开放**：无（本项两侧闭合）。

---

## 3. R-3（= I-3）`RELOCATABLE_NS_KEYS` 与挂载登记表

**原冲突**。RL-6.4 的构建期判据 = 扫描「列名 = ns 的表」，同条却把「挂载登记/扩展记录表」
**预先列入**清单；而 `facet_mount`（FM-2.1 `FacetMountRow` / FM-2.5 DDL）**没有 ns 列**
（FM-2.1 的逻辑 `targetOid` 设计）⇒ 该表既扫不到、也没有可搬的位置键；RL-3.4 又称「加入该清单」
是迁移联动的**唯一接口** ⇒ 该接口在现形状下是空操作。

**裁决**（父席）：`RELOCATABLE_NS_KEYS` **收窄并逐项区分**——只有「物理带 ns 列的表」进该集；
「挂载登记表」按挂载账自身规则处理（逻辑目标迁移后挂载语义不变 ⇒ **零搬迁**），一句成文 + 夹具用例。

**改了哪些条**

1. **RL-6.4 重写为类别谓词**：入选谓词 = 「该表**物理有无 `ns` 位置列**」；清单 = `{domain_state}`（现形全集）。
   两类账分工：**(a) 位置键账** ⇒ 进清单、随切换事务改位置键；**(b) 挂载账** ⇒
   判据输入 `(facetCapability, targetOid)` 是逻辑量、迁移前后逐字不变 ⇒ **零搬迁**（不改行、不补见证、不落事件）。
2. **双向构建期扫描判据**：正向 = 「ns-keyed 表未入清单 ⇒ 构建红」（既有）；
   反向（新增半边）= 「清单里出现**不带 ns 列**的表 ⇒ 构建红」，并如实写明为什么这不是「更保守」：
   切换事务会为它生成一条**永不命中**的改位置键步骤（把「位置无关」伪装成「已搬迁」），
   而挂载表的 `MOUNT_ROW_FROZEN` 本就禁 UPDATE，**真跑必炸**。
3. **RL-3.4** 的「唯一联动接口」按类别改写（谓词而非表名）；**RL §14.1-3** 的旧句
   「G1-FACET-01 表落地即入清单」标注作废并给出新读法。
4. **A 侧同步**：FM-2.5 末段新增「本表与物理重定位的关系（R-3）」三条（零搬迁成文 /
   反向也被钉住 / **扩展记录行是另一回事**——A2 形态今天物理住属主 ns、带 ns 位置键 ⇒ 随行搬走，
   G2 若另立表按「有无 ns 列」逐项归位）；FM-11.1 **A.6-6 行**就地更正（**旧句保留、以本行为准**）。

**夹具证据**：RL **T-P10**（切换前后 `facet_mount` **逐字节等**、挂载仍 ACTIVE 且扩展记录仍可写、
扩展记录行随 `domain_state` 搬走、清单不含挂载表）；**T-N18** 双向（塞进挂载表 ⇒ 红；
漏登记新增 ns-keyed 表 ⇒ 红）+ **MUT-9**（只留正向半边 ⇒ 对「假保守」放行）；
模型里 `TABLE_SCHEMA.facet_mount` **无 ns 列**，且 `nsKeyedTables()` 不含它（与 FM-2.1 形状互为约束）。
机验：RL **S12**、FM **S13** 双向核对两侧条文互指且 A 侧旧句仍在原位。

**仍开放**（如实）：`G2-DEV-PLAN.md` PR-7 仍写「并把该两名加入 `RELOCATABLE_NS_KEYS`
（这是 `RL-3.4` 指定的唯一联动接口）」——与本裁决直接冲突，该文件本席禁改 ⇒ **需 G2 责任席回填**（§7-3）。

---

## 4. R-4（= I-4）`failedGate` 封闭集自相矛盾

**原冲突**。RL-4 清单块：「清单名即 `detail.failedGate` 取值，**不得旁加**（封闭十门）」；
而同一份正文 **RL-3.3②** 用 `gate='APPROVAL'`、**RL-8.4/RL-8.5/§10.2 F-13/T-N9** 用
`failedGate='REPAIR_PROVENANCE'`——两个取值在十门之外。装配席：「夹具 S 组逐等会红；
『不得旁加』句与自家取值矛盾」。

**裁决与自选理由**（父席准自选一种并说明理由）：**正式纳入封闭枚举**，`RelocationGate` = **12 门**。
理由（已写进 RL-4 正文，不是本文的辩解）：两个取值**拒的东西**与既有十门不同——
`APPROVAL` 拒「批准主体资格」这一**账外事实**，`REPAIR_PROVENANCE` 拒「证据 digest 互检不等」这一
**证据面事实**；塞进 `AUTHORITY`/`SOURCE_PARSEABLE` 会让 `detail.failedGate` 失去「一眼定位失败阶段」
的价值，也与 §11.2「detail 只回显调用方自己的输入与机制本地可判事实」冲突。
**取值语义不同就必须是不同取值**——旧的「不得旁加」只是没把自己正在用的两个算进去。

**改了哪些条**

1. RL-4：封闭集改 12 门，**阶段归属写进判据**（1–10 = precheck 阶段，只读零写；
   11–12 = 流程阶段：approve / repair-approve，同样零写、同样 fail-closed）；
   11/12 各给**语义 + 失败后果 + detail 形状**（11 的 `observed ∈ {self-approval, stale-proposal-digest,
   no-operation-grant}`；12 的拒签 + 库保持隔离 + **绝不允许改投一条普通 relocation 蒙过去**）。
2. 「不得旁加」改写为**对全部 12 门生效**，并配机验（见下）。
3. RL-3.3 与 RL-8.4 的取值句改为「= RL-4 封闭集第 11 / 12 门」，并声明**取值面仍是一处正源**
   （别处只引用、不另立）。

**夹具证据**：模型 `PRECHECK_GATES(10) + FLOW_GATES(2) = GATES(12)` + `gateValueOk`；
**S6** 升级为三方逐等（正文 12 门逐名在位 ↔ 模型 12 ↔ **扫正文所有 `failedGate='X'`/`gate='X'`
取值 ⊆ 集**——这条扫描就是「别处再长出集外值」的护栏，也是本条不止于散文的证据）；
**T-N17**（集外第 13 取值被拦 + 11/12 两门各以**不同修法**命中、断言两门未塌成同一取值）
+ **MUT-7**（「取值全都合法」）放过同一越界值。

**仍开放**：无。

---

## 5. R-5（= I-5）新机制事件名的批准主体（六项中最重）

**原冲突**。同一件事四种自我授权表述：EA-2.4 步骤 2 =「用户（或用户指名代表）批准」；
EA-7.1 =「批准由 G1 冻结评审 = 本条裁定承担，落地时补记 `Approved-By`」；
RL-2.2 =「**本合同即** EA-2.4 流程的提案**与批准**文书」；FM-9 =「planned 块不得被引用为已入账、
入账走 EA-2.4 六步」。而 **G1 冻结评审尚未发生**（`G0-R-CLOSURE` = NO-GO）⇒
「名单唯一正源 + 异源人工批准」的锚可能整体空转（批准人 = 文书自身）。

**裁决**（父席）：唯一有效批准 = **EA-2.4 的人工 `Approved-By` 标记**；任何契约不得自称已批准。
EA-7.1 删自授批准语义（保留「名单形状与判据由本契约裁定」——**判据 ≠ 批准**）；
B 的 `ns-relocated` 由「本契约即批准文书」降级为「**提案文书**」，入账前装配 fail-closed；
A（FM-9）的写法即标准形，**不动**。加夹具用例：**无 `Approved-By` ⇒ 该名字不可入账（红）**。

**改了哪些条**

1. **EA-2.4 名单块拆两半**（机器可读标记，供三方逐等）：
   `<!-- EA-2 MECHANISM-CLOSED-LIST-BEGIN -->` 内 = **7 名**
   （`capability-enabled · capability-disabled · capability-transferred · object-registered ·
   check-report-recorded · object-revised · record-backfilled`，即包 6 五名 C-19 + 存量升格两名，
   **批准面在 `CONTRACTS.md`/实现既有事实里**，未动）；
   新增 `<!-- EA-2 PLANNED-PENDING-LIST-BEGIN -->` 内 = **4 名提案未入账**
   （`raw-record-declared · integrity-audit-recorded · read-shadow-recorded · ns-relocated`）+
   逐名 `gated_by`（`EA-1.2.3` / `EA-7.1` / `EA-7.2` / `G1-NS-01`）。
2. **未入账期间的语义成文（fail-closed，不靠约定）**：分类器对四名给 `unregistered` ⇒ 通用通道拒；
   **机制内部直写通道同样拒**（Raw Intake 落账 / 审计持久化 / 遮蔽落账 / 重定位落账）⇒
   `ACTIVATION_IMPOSSIBLE`（FM-7「名册缺项 = 装配红」同族同码；**不是** `EVENT_AUTHORITY_REQUIRED`，
   否则就踩 T-N8 钉住的 B-1 违例码）。已收材料/已做校验不丢，只是**台账行写不下去**。
   代价如实写明：四名的人工标记落地是**用户动作**，且是 G2 任何依赖它们的写面 PR 的**进入门禁**
   （不是「先落码后补批准」的退出门禁）。
   并加「**不得反向解释**」句保住七名的既有批准面（防止本条被读成把 C-19 五名重开）。
3. **EA-7.1** 标题改「本契约 = 其**提案文书**；批准归 EA-2.4，C-24 转正指判据面」+ 更正段四条
   （本条不授予批准；C-24 = **判据**转正非**名字**转正；入账前 fail-closed 的代价如实登记；
   RL-2.2 同批、FM-9 是标准形）；**EA §9.2-④** 同族句「本契约即批准」就地更正（旧句保留）。
4. **RL-2.2** 标题与正文降级（旧句以删除线保留原位）+ 三要素同现要求（`Approved-By` +
   `Event-Name-Review:` trailer）；**RL-8.2** 补「R-5 联动」：审计行落不下去 ⇒
   「声纳」在标记落地前**只有实时面、没有留存面**，不写成「先落码后补批准」。
5. **执行的一个后果（如实登记，不粉饰）**：严格按裁决，`raw-record-declared` 也被降为提案名——
   它唯一的「批准」就是 EA-2.4 名单块自列，而那正是本项作废的动作；它与 EA-7.1 两名同构。
   于是机制名基数由「首批 10」变「**已入账 7 + 提案未入账 4**」。这是裁决的必然推论，不是本席加码。

**夹具证据**：EA 名单三方逐等改为**两块**（S1 已入账块 + **S1b** 提案块，顺序敏感）；
**S2** 四名在 `proposed` 阶段仍 `unregistered`、标记落地后 `mechanism`；**S2b** 批准门在写入路径上
且不给 B-1 违例码；**S17/S17b** 正文零处未标注取代的自授批准句 + 提案名各有 `gated_by` +
「判据≠批准」成文；**T-N13**（未入账 ⇒ 通用通道拒 + 机制直写装配红 + 账本零行；
标记落地后同一调用成功，防止 fail-closed 被写成永久禁用）+ **MUT-6**（契约自称批准即过）放过同一未批准态。
RL **T-N20**（提案/批准/precheck 照跑照记账，execute 在落账那一步拒签 ⇒ **整笔回滚**，
`dir/route/domain_state/ledger/meta` 与切换前逐字节等；落地后 committed）+ **MUT-6**；机验 RL **S14**。
FM 夹具 S1 同步：本契约两个 planned 名既不混入 EA 运行时名单、也不混入 EA 提案块（各归各的门控）。

**仍开放**：① 人工动作 = 4 个 `Approved-By` 标记（G2 前置）；② 锚文件
`g1/EVENT-CONTRACT-LEDGER.json` 按 EA §9.4 尚未创建，创建时须按**新形状**写「7 名已入账 + 4 名 planned
带 `gated_by`」，不得沿用旧「首批 10」叙事；③ 汇编席的名单基数句需回填（§7-1）。

---

## 6. R-6（= I-6）历史行版本戳与「修补事件」

**原冲突**。EA-5.3：存量无戳行**不回填**（「补戳 = 系统替历史补语义」）；
裁决表 **D5-c**：历史行补 `contract_version` = **显式修补事件**语义（G1-VER-01）。
若不区分「改旧行」与「新增修补事件」，两文互斥，G1-VER-01 落地时先撞。

**收口句**（父席定的那一句，两侧条文各补一次）：

> 修补事件是**显式、可审计的运维动作**，只调整**呈现档**并可被**回看**；机制**绝不自动补戳**，
> 也**不得因此改写历史语义**。

**改了哪些条**

1. **EA-5.3** 新增 bullet「无戳行的版本归属（R-6 收口句）」：成文句 + 与 EA-5.1「禁改旧行」的相容说明
   （EA-5.1 禁的是**改旧行**，D5-c 允许的是**追加修补行**，两者不在同一动作面上）+ 指向 RL-6.1/RL-8.4。
2. **RL-6.1** 版本列行补同半句（含「重定位**不是**盖章通道」，与 RL-4 门 6「不越权代迁移器盖章」扣死）。
3. **RL-8.4** 新增一条：「禁止自动补造」不只管重定位账，也管**呈现档**——修补走 RL-3⑦ 同一条显式通道
   （谁、何时、把哪批行从缺省档改判为某档；追加行、可回看），**修补 ≠ 洗白**（修补行永久可指认，
   读者面仍按原始字节复算 digest）。
4. **如实边界**（本席补的一句，防被读松）：修补动作的载体**若要**进台账事件名空间，须另走 EA-2.4 入账——
   模型用**运维修补账**表达，**不替自己新造机制事件名**（那正是 R-5 刚作废的动作）。

**夹具证据**：EA **T-P9**（无标记的修补被拒；带标记的修补**只追加行、只调呈现档、可回看**，
原行逐字节不变；机制侧零自动补戳）+ **T-N14**（真判据零补戳且历史行字节不变；
**MUT-7**「打开期顺带盖章」必须真的改了历史行字节 ⇒ 判别力成立）；
RL **T-N21**（重定位后无戳行仍无戳、呈现档仍 `pre-cutover-default`、读者面继续拒读；
显式修补通道可用且不改原行字节；**MUT-10** 顺带盖章形态被复现）；机验 EA **S18** / RL **S13**（两侧同文）。

**仍开放**：`G1-VER-01` 落码时按本句实现「追加修补行 + 呈现档」；本层未为其新造事件名（刻意为之）。

---

## 7. 需他席回填的下游项（本席授权面外，禁改，逐条点名）

1. **`G1-UNIFIED-CONTRACTS.md`（装配席）**：
   - **L171** 「机制事件名封闭名单首批 **10** + planned **3**」与 **L264** 登记表同一句 →
     应为「**已入账 7**（capability-enabled/-disabled/-transferred、object-registered、
     check-report-recorded、object-revised、record-backfilled）+ **提案未入账 4**
     （raw-record-declared / integrity-audit-recorded / read-shadow-recorded，gated EA-1.2.3 / EA-7.1 /
     EA-7.2；`ns-relocated` gated `G1-NS-01`）+ **A 侧 planned 2**（`facet-mounted`/`facet-unlinked`）」
     ——即 R-5 的直接后果，L264 那句里把 `raw-record-declared`/`integrity-audit-recorded`/
     `read-shadow-recorded` 算进「首批 10」的写法作废。
   - §7.2 注册表 B 的 I-1…I-6 状态位 → 标「**已裁决并落地，见 `G1-CONTRACT-RECONCILIATION.md` R-n**」，
     并保留原两侧位置索引（登记不删除，只在原位加指向）。
   - §7.1 的「硬不一致只登记、不抹平、不再裁决」→ 需加一句限定：本台账是**父席另行授权的裁决与落地**，
     不与该纪律冲突；否则读者会以为六项仍待裁决。
2. **`G1-ACCEPTANCE-MATRIX.md`（装配席）**：
   - **L30–L32 的夹具计数行**仍是本轮前基线（35 / 29 / 42 PASS），现值为 **48 / 35 / 57 PASS**，
     且组成句里的「S1–S14 + T-P1..P7 + T-N1..N10 + MUT-1..3」等枚举全部变短了
     （EA：S1–S18（含 S17b）+ T-P1..P9 + T-N1..N14 + MUT-1..7；
     FM：S1–S14 + T-P1..P8 + T-N1..N9 + MUT-1..4；
     RL：S1–S15 + T-P1..P10 + T-N1..N21 + MUT-1..10）。
   - **L61 行**「EA-2.4 机制封闭名单首批 **10 名**」→ 应为「已入账 **7** + 提案未入账 **4**」，
     且该行「S2 `planned` 条目不入运行时名单」的语义已被 EA S2 扩成「四名 `proposed` 阶段
     `unregistered`、落地后 `mechanism`」。
   - 门数（RL-4 现 **12 门**）、`RELOCATABLE_NS_KEYS` 若被引用需按 R-3 谓词改写。
   - S 编号：本席新增 EA S15/S16/S17/S17b/S18、FM S12/S13/S14、RL S12/S13/S14/S15
     （FM 侧**未**重排他席已改过的 S4/S5/S11 编号，新号一律接在未改动的 S11 之后）。
3. **`G2-DEV-PLAN.md` L196（G2 责任席）**：PR-7「并把该两名加入 `RELOCATABLE_NS_KEYS`
   （这是 `RL-3.4` 指定的唯一联动接口）」→ 按 R-3 改写为「按『有无 ns 列』谓词逐项归位；
   挂载登记表不入清单、零搬迁」。
4. **人工动作（用户 / 指名代表）**：`raw-record-declared`、`integrity-audit-recorded`、
   `read-shadow-recorded`、`ns-relocated` 四个提案名的 `Approved-By` 标记；未落地期间相应写面
   fail-closed（这是**设计后果**，不是缺陷）。
5. **`src/**` 实现批**：`hiddenBy*` 撤键、`facet_mount` 无 ns 列、12 门取值、批准门的装配期
   `ACTIVATION_IMPOSSIBLE` —— 全部有夹具判据可对齐，但**本轮零碰 `src/**`**（本席无该授权，也不应动）。

## 8. 未采纳的装配席观察项（注册表 C 的 M-1…M-5）与理由

父席要求「诚实列出未采纳的观察项及理由」。六项硬不一致之外，本席**未动** M-1…M-5；
理由不是「不值得做」，而是**落点在本席授权面外**或**属另一决策面**：

| # | 观察（装配席原文要点） | 本席处置与理由 |
| --- | --- | --- |
| M-1 | `ACTIVATION_IMPOSSIBLE` 被 FM-7 用于「名未入封闭名单时装配挂载 Port」——原语义（必需依赖缺失/成环）的用途扩展未在 `CONTRACTS.md` §5 CP-2 登记 | **未采纳（且本席反向加重了该复用）**：R-5/R-3 之后该码在 EA（直写通道）、RL（重定位落账）也各用一次，「名册缺项 = 装配红」已成第 3、4 次复用。登记义务真实存在，但落点是 `CONTRACTS.md` §5 CP-2（**禁改面**）。本席选择**继续复用既有码而非新造码**（封闭集零扩张优先），并把「第 3、4 次复用需同批登记 CP-2」作为待回填项上报；若父席授予 `CONTRACTS.md` 编辑权，这是一次纯登记改动。 |
| M-2 | `PluginFace` 新增具名成员（`FacetMountPort`）触碰「插件可见成员名集零增删」面锚，重锚义务在 FM 只隐含，RL/FM 各有一套对拍口径，缺一张统一重锚清单 | **未采纳**：FM-6/FM-8 已有「面锚对拍钉成员名集零增删」的逐字义务句，缺的是**跨席统一清单**这一工具面，而它的主语是 `arch-independence.test.ts`（`attacks/**`，禁改）。R-1 又新增一处同类重锚（撤 `hiddenBy*` 键），本席把它**就近写进 EA-7.4 正文**而不是自建清单——自建会与将来的统一清单成二真源。统一清单建议单列一席。 |
| M-3 | 报告钉住集**形态闸拒绝**的对外响应码未命名（ADJ D4-b 缺码位；现走 `TOOL_INPUT + detail.serviceCode` 的 X-3 同族过渡形） | **未采纳**：新增 `RefusalCode` 成员 = 冻结面变更，须走 §14.2 同规登记 + 拒绝码封闭集的正反例，落点在 `src/contracts/index.ts` 与 `CONTRACTS.md`（皆禁改）。本席三部契约本轮**零新增拒绝码**（EA/RL/FM 的 S3/S4/S5 封闭集零扩张闸继续绿），维持 X-3 过渡形不恶化。 |
| M-4 | `space_id`/`record_id` 取值文法本体未落（ADJ 裁「文法权在我方契约层」，四契约与 ADJ 均未落） | **未采纳**：这是**新立判据**，不是「跨契约不一致的修复」。写文法必须同时给正反例 + 形状卫生的传输层处置（EA-1.3a 的 `declaredType` 先例是整套：正则 + 上限 + 畸变仍收 + 三不参与），塞进本台账会变成没有夹具判据的散文。已有同族先例可抄（RL 的 `^[a-z0-9][a-z0-9._-]{0,63}$`），建议单独立项（G1-VER-01 / G1-STORAGE 邻面）由专席做。 |
| M-5 | 宿主「目标 → 挂载方列表」导航读面未写（FM-2.4 默认不提供、确需暴露走呈现裁定通道 = G1-READ-02 复核范围） | **未采纳（有意）**：FM-2.4 已裁**默认不提供**，剩下的问题是**暴露形态**，属呈现裁定面（G1-READ-02 清单去向未了结）。本席本轮在 FM-2.4 只加了 R-1 的同一把尺（零 `hiddenBy*` 键），没有替呈现裁定抢跑写形态——那会把一个尚未裁决的读面变成既成事实。 |

**共同点（一句话）**：五条都不是「本席偷懒」，而是**落点在授权面外**（`CONTRACTS.md`、`src/**`、
`attacks/**`、清单工具面）或**属另一决策面**（呈现裁定、新立文法判据）。本席宁可把它们留在台账里
带位置、带落点、带「谁该动」，也不在禁改面上动一刀、或在别人的决策面上抢一句。

## 9. 本席未做的事（避免被误读）

- 未跑 `pnpm test` / `tsc` / `docs:probe`：本轮零碰 `src/**`、零碰文档归属面，跑它们产生的
  diff 与本席授权无关。G1 判据面的自证手段就是那三份夹具 + 清单门禁（§0 表已给退出码）。
- 未做任何 git 写操作（无 `add`/`commit`/`push`，无 `checkout --`/`stash`/`restore`）；
  工作树里他席的未提交改动原样保留。
- 未改本文 §7 列出的任何文件；未新增拒绝码；未新增机制事件名。

---

## 10. R-7（复审 P2-2）—— D5-a「唯一责任者」的文书正所裁定：唯一正所 = RL-4，他处只允许指针引用

> 追加裁决节（2026-11-01；来源：领域复审第二轮 `attacks/review/RE-REVIEW-G1-DOMAIN.md` **P2-2**，
> 父席 `session-3e3f10a7` 委派执行）。编号续 R-1…R-6，**位置追加于 §9 之后**是刻意的：
> §7–§9 是 R-1…R-6 席原文，本节纯追加、不重排、不改写他席文字。
> **本节只裁「文书住所」；D5-a 已裁语义（责任者 = 我方 G1 契约、责任对象 = 打开判据次序 + 迁移前
> 校验清单、G2 承接验收、禁写「属 #47 决策面」）一字不重开。**

**原冲突**（复审两引，各带行号）。`G1-ADJUDICATION-TABLE.md` **L65（D5-a 裁决列）**：「唯一责任者 =
我方 G1 契约（**本表 + `CONTRACTS.md` 打开面小节**）」；`G1-CONTRACT-RELOCATION.md` **L311（RL-4
标题）**：「封闭清单；**唯一责任者 = 本契约**」——「本契约」（RL）不在 D5-a 的枚举里。而 12 门封闭
清单**本体**（编号 1–12 + 逐门判据句）只存在于 RL-4（本文 §0 R-4 行；RL-3.3/RL-8.4 只引用取值）；
`CONTRACTS.md` 未动（本文头部 L9-11 授权面登记）⇒ D5-a 枚举的两个住所**当下都不含清单本体**，
唯一责任者的文书住所错位。RL:76（P-12 行）转引 D5-a 时括注已按「对象」而非「文书住所」换写 ⇒
两种读法并存、不可同真。

**裁决**（三条，全部现在生效）：

1. **唯一正所**：「迁移前校验清单」（RL-4 十二门封闭清单）与「打开判据次序」的清单本体，其**唯一
   正所 = `G1-CONTRACT-RELOCATION.md` RL-4**。RL-4 标题「唯一责任者 = 本契约」自本节起有明文背书；
   D5-a 枚举中的「本表 + `CONTRACTS.md` 打开面小节」按**对象读法**统一（D5-a 裁的是责任主体与责任
   对象，不是清单正文的存放处），其住所枚举部分被本节取代。
2. **只允许指针引用，禁止复制清单正文**：`G1-ADJUDICATION-TABLE.md` D5-a 行、将来的 `CONTRACTS.md`
   打开面小节（及任何其他文件位）落笔时**只允许指针引用**——「见 `G1-CONTRACT-RELOCATION.md` RL-4」
   式锚点 + 至多一句摘要，**禁止复制清单正文**（逐门编号 + 判据句，或完整门名枚举）。
   **复制即第二正源**——与 C-27「名单与事实同源 ⇒ 失明」、R-4「取值面仍一处正源」同族病灶。
3. **机验判据 J（「复制即第二正源」的可执行判据；登记为 G2 PR-0 承接待办）**：
   记 `GATE12` = RL-4 十二门名集 `{AUTHORITY, ROUTE_STATE, NS_SHAPE, TARGET_UNCLAIMED, TARGET_EMPTY,
   SOURCE_PARSEABLE, CONTENT_DIGEST, NO_INFLIGHT, CHAIN_INTACT, EPOCH_STABLE, APPROVAL,
   REPAIR_PROVENANCE}`。对 RL-4 本体之外的任一受检文件位 X：
   - **J-a 复制判据**：X 内 distinct 门名命中 ≥ 10（满集/近满集枚举）⇒ 判「复制清单正文」= 红；
     单个门名在叙述中的零星引用（取值引用、示例、括注）**不算**复制——合法指针的命中数天然 ≪ 10。
   - **J-b 指针判据**（只对**新落笔**生效）：X 写了「打开判据次序 / 迁移前校验清单」对象而未含
     `RL-4` 锚点字样 ⇒ 红。**存量 ADJ D5-a 行的住所枚举错位不套 J-b**（它正是本裁决要取代的旧句，
     对齐属父席回填动作，见下「需回填」）；J-a 自本节起对 `G1-ADJUDICATION-TABLE.md` **全文（含 D5-a
     行）**即时生效——扫描按全文做：只盯单行会漏掉「把复制体贴到别处」的形态。
   - 阈值 10 在 PR-0 承接时只准收紧（调小），方向「复制=红、指针=绿」不可动；`GATE12` 取值面以
     RL-4 为源、由扫描器现场读取，**禁止在扫描器里再手打一份门名清单**（否则扫描器自己成第二正源）。
   - **豁免登记（如实）**：`G1-UNIFIED-CONTRACTS.md` §5/R-4 落地注记（L242-244 附近）含门名集引用式
     枚举——那是 R-4 封闭集裁决的装配注记、无逐门判据本体、且自注「取值面仍一处正源」，不在本节
     「复制即第二正源」判定范围内；若 PR-0 把扫描面扩至全仓，UNIFIED 的处置（收紧成指针或加豁免
     注记）由父席裁定，本席不代抢。
   - **待办登记（本席授权面外，禁改校验器与 `G2-DEV-PLAN.md`）**：J 的全自动扫描器由
     `G2-DEV-PLAN.md` **PR-0（门禁身份前置）** 承接实现，PR-0 认领清单需增补本条；在 PR-0 落地前，
     本节的当机护栏是 EA 夹具 **S19**（已实现，覆盖：R-7 裁决在位性 + RL-4 正所存在性 +
     ADJ 全文〔含 D5-a 行〕无复制体 + `CONTRACTS.md` 打开面小节回填后必须为指针形）。

**本轮实际改了什么**：仅本节（纯追加）+ EA 夹具新增 S19 护栏。**零碰** `G1-ADJUDICATION-TABLE.md`、
`CONTRACTS.md`、`G1-CONTRACT-RELOCATION.md`（三处均授权面外；「那两处由我处理」= 父席指令原文）。

**实测（真实退出码，本节落地后本席复跑）**：`node g1/G1-CONTRACT-EVENT-AUTHORITY.fixtures.mjs`
含 S19 全绿、exit 0（计数见 EA 夹具输出末行）；`node g1-checklist-validate.mjs` 与 `--self-test`
不受本节影响（校验器只读 `G1-RECONCILIATION-CHECKLIST.yaml`，已实测无漂移）。

**需回填（父席动作，登记不代改）**：① `G1-ADJUDICATION-TABLE.md` D5-a 行住所枚举对齐为指针形
（「唯一正所 = RL-4，见 `G1-CONTRACT-RECONCILIATION.md` R-7」）；② `CONTRACTS.md` 打开面小节回填时
按第 2 条指针纪律落笔（J-a + J-b 届时对其生效，S19 已布防）；③ `G2-DEV-PLAN.md` PR-0 认领清单增补
判据 J。

**仍开放**：J 的全自动实现（待 PR-0）。**本节不是绿着的空文**——S19 今天就扫「R-7 不在位 / 正所
消失 / 两处住所长出复制体 / 未来小节非指针形」四种形态，任一即 EA 夹具红。

---

## 11. R-8（工程审查 P1-1）—— `domain_state_no_update` 触发器与 RL UPDATE 的硬冲突：窄化触发体裁决

**来源**：`attacks/review/RE-REVIEW-G1-ENG.md` P1-1（2026-11-01 复审）。冲突实体：RL-5.1 步 3 要求
迁移切换时对 `domain_state` 行做**纯 ns 改写**（UPDATE），而 `src/storage-sqlite/sqlite-port.ts` 的
`domain_state_no_update` 触发器（实测 d2f19cc 与 HEAD 均在 :202-205，`before update … raise(abort,
'DOMAIN_STATE_APPEND_ONLY')`，全禁一切 UPDATE）**在 `REQUIRED_TRIGGERS`（:297-301）内**——RL-5.1 落地
当天 `g0-gate` 必红。复钉：`.scratch/rl51.mjs`（node:sqlite 真库，复刻现体 + 纯 ns UPDATE）
⇒ **RL51_EXIT=3、错误文本 `DOMAIN_STATE_APPEND_ONLY`**（本席 2026-11-01 实测）。
**零触碰授权面外**：未动 `sqlite-port.ts`、未动 `REQUIRED_TRIGGERS` 成员集、未删触发器。

**裁决（修法二择一，取 b）**：
- (a) 追加-搬移形（append 新位置行 + 标记旧行移出）——**否决**，三条理由入 RL-5.2 第 3 处正文：
  ①「标记旧行移出」本身还是一次 UPDATE，触发器冲突原地复活；② 需要新增全局「有效行恰一」不变量，
  双活行窗口 = RL-3.4 禁止形态；③ 会推翻 RL-6.1/RL-6.3/T-P6 的逐字节等式族，代价大于收益。
- (b) **显式窄化触发体**（采纳）：WHEN 等式清单**只放行**「非位置列全部 `new.X is old.X`」的改写，
  即**唯一可变列 = `ns` 位置列**；其余五列（`oid/revision/payload_json/recorded_seq/contract_version`）
  任一变化照旧 `raise(abort,'DOMAIN_STATE_APPEND_ONLY')`，**信号文本逐字不变**。规范 SQL 全文写在
  RL-5.2 第 3 处；等式清单 ↔ RL-6.1 列语义表 ↔ 夹具 `DOMAIN_STATE_IMMUTABLE_COLS` **三方逐等**
  （机验 RL-§15 S16）。
- **三件套重锚义务**（漏一步 = 旧库静默过闸，P-17 违例形态）：① 触发器**名保留、体摘要重登**
  （`REQUIRED_TRIGGERS` 的体摘要必须换成新体摘要——「名在位」不再是充分判据）；② `SCHEMA_VERSION`
  7→+1，**落地时实测推进，本契约不钉死数字**；③ 打开判据（期望摘要外置，G1-STORAGE-02/P-17）**同批**。
  `domain_state_no_delete` **一字不动**；REPLACE 无旁路（recursive_triggers=ON 的隐式删除撞 no_delete，
  D-30 机制在位）。
- **锚点更正（更正纪律）**：P-07 原句「按 d2f19cc 实测=无不可变性触发器」是**错锚**——该行
  `~~**无不可变性触发器**~~` 划线保留于原位 + 就地更正段（实测 :202/:204 两触发器俱在、俱在
  REQUIRED_TRIGGERS、rl51.mjs exit 3）。同纪律同步 RL-5.2 标题与正文：「不相容恰两处」**作废**，
  更正为**三处**（P-01 route 审计 / P-07 域状态改写 / 混合语句），反证扫描句同步。

**本轮实际改了什么**：`G1-CONTRACT-RELOCATION.md`（P-07 行更正段 / RL-5.1 步 3 注 / RL-5.2 重命名 +
更正块 + 新第 3 处规范体与三件套 / RL-6.1 ns 行互指 / RL-13 新 T-N22 行 / §14.1-6 / §15 S9–S16）+
夹具（`domainStateUpdatePreNarrow/domainStateUpdate/domainStateUpdateMUT11` 触发体模型、
`run_T_N22`、摘要注册表判据、S16、S4 32、S9 十一条、MUT-11 终检）+ `G2-DEV-PLAN.md`（PR-8 范围行
四处改造、§4.1 计数 11、§2 夹具计数 60）。

**夹具证据（负例在夹具面常驻）**：T-N22 六面——(a) **现体连纯 ns 都拒**（P1-1 反例的常驻复跑，
从此不再只活在一次性脚本里）；(b) 窄化体放行纯 ns 且零碰其余列；(c) 五个非位置列 ×{单改, 连带 ns}
**十形全拒**（「非位置列改写仍被拒」的负例面）；(d) 摘要未登/漂移/删除（ABSENT）三形态打开红、
重登后绿；(e) REPLACE/DELETE 面照拒；(f) MUT-11（把「窄化」写成全量放行 UPDATE 的架空体）放过
同一负例 ⇒ 判别力配对断言。

**实测（真实退出码，2026-11-01 本席落地后复跑）**：RL 夹具 **60 PASS / 0 FAIL，exit 0**（57→60：
+T-N22、+S16、+MUT-11 终检）；EA 51 exit 0、FM 35 exit 0 零漂移（R-8 不触彼面）。

**需回填**：PR-8 承接触发体改造 + `SCHEMA_VERSION` 推进 + 期望摘要外置同批（已写入 `G2-DEV-PLAN.md`
PR-8 范围行与进入门禁）；矩阵 RL/MUT 构成长句与 §2 夹具计数由矩阵席按「RL 60 / T-N1..N22 / MUT 11」重锚
（矩阵是本席禁改面）。**仍开放**：真库对应物（真触发器 SQL 的 T-N22 化）在 PR-8 落地前只是模型形；
期望摘要的**外置正源文件**尚未立（G1-STORAGE-02 的范围，本席只钉义务不代做）。

## 12. R-9（工程审查 P1-2 + P1-3）—— DONE 锚点真值校验 + `synth:raw-intake` 登记提前

**P1-2 裁决**：`g1-checklist-validate.mjs` 的 DONE-EVIDENCE / SUPERSESSION-EVIDENCE 补**真值段**——
形态合规之后，锚里的提交号必须 `git cat-file -e <sha>^{commit}` 通过（先例：g0-gate 基线
`generated_from_commit` 的祖先判据，同一「git 即锚点仓库」）；路径必须存在（先例：本文件 PLAN-PATH
「对账对象不许是幽灵路径」；两候选根 existsSync + `git ls-files *basename` 后缀兜底——现存合法形态
G1-DONE-04 的裸 basename 引用靠它转绿）；git 不可用/清单在树外 ⇒ fail-closed 全点名。
supersession_reason 的锚**只判形态**（理由为叙事文本，证据面真值由 SUPERSESSION-EVIDENCE 把门），
分工写死在校验器注释与头注。**边界如实**：机器证「锚点存在」，**不证**「锚点内容支持该结论」——
真锚空转仍是人工审查面（头注「已知边界」新条）。

**先复现后修（证据链）**：修**前**，审查席与本席各自构造「27 条全 done + 假提交号 `abcdef0` +
幽灵路径 `ghost-evidence-does-not-exist.md`」洗白形，跑 `--file fake.yaml --require-clear` ⇒
**FAKE_CLEAR_EXIT=0、违规=0**（同日旁证：`git cat-file -t abcdef0` ⇒ exit 128「not a commit」；
`ls ghost-evidence-does-not-exist.md` ⇒ exit 2）——「今天的绿」坐实。修**后**同一文本 ⇒
**exit 1、DONE-EVIDENCE ×54 逐条点名**（`.scratch/fakerun.log`）。该反例以 **M21** 常驻自验。

**变异常驻（先证伪再修绿，四侧钉死）**：M18 done+假提交号 ⇒ 红；M19 done+不存在路径 ⇒ 红；
M20 done+HEAD 实测提交号+真实文件 ⇒ **必须绿**（新增 expect 类型 `CLEAN`——真值校验不得成误伤闸）；
M21 §E4 终局洗白全形 ⇒ 红。`--self-test` **21/21 全部捕获，exit 0**。

**P1-3 裁决**：`synth:raw-intake` 的「登记进 `ownsEventTypes` + 命令 Port 改道」义务**从 PR-10 提前
进 PR-2**（消费批次）。理由：PR-2 正是把通用 `appendLedger` 收敛为机制内部原语（deny-by-default
翻转）的 PR，而 `IntakeUseCase.intake()` 今天就走通用通道且作者套件钉着「ledger 写入成功」——
翻转与消费同批 ⇒ 登记必须同批，否则 225 例当场红。不放 PR-1（其明文「任何域名不得进账」，登记先于
消费只造空转窗）。姊妹先例 = `synth:fact-designation`（D-20：登记 + 命令 Port 同批收口，实测在案）。
`G2-DEV-PLAN.md` 同步：PR-2 范围/退出门禁 + PR-10 基数收缩注记 + **§2 通用退出门禁铁律**——任一 PR
退出 = 落地后 `g0-gate` 仍 exit 0 ∧ 作者套件无新红（225/225 锚定 + passed_sha256/files_sha256 逐等，
「0 红是硬条件」；计数随 §4.2 重锚，不变式不变）；**禁止「改测试让它接受拒写」消缝**（违 Q37/B-1
Raw Intake 容错，把违例从代码面搬进测试面）。

**本轮实际改了什么**：`g1-checklist-validate.mjs`（头注两规则 + 已知边界 + 用法注；
`makeAnchorChecker` 工厂接进 done/supersession_evidence 两处；M18–M21 + `CLEAN` 期望型）+
`G2-DEV-PLAN.md`（铁律 / PR-2 / PR-10 / PR-0 自验计数）。**零碰** `G1-RECONCILIATION-CHECKLIST.yaml`
（数据文件禁改——G1-DONE-04 的裸 basename 锚靠 ls-files 兜底转绿，不需要动它）。

**实测（2026-11-01）**：`--self-test` **21/21 exit 0**；主清单日常门 exit 0（真锚零误伤）；
`--require-clear` 主清单 exit 1（预期红，NO-GO 阶段）；洗白形 exit 1（修前 0）。

**需回填**：`G1-RECONCILIATION-CHECKLIST.yaml` 头注第 10 行「17 条形变：…M14–M17…」已过期（现 21 条：
M1–M17 + M18–M21，且名册本来就漏数 M13——复核：原文 M8–M12 后直接跳 M14，名册与计数本就不一致）——
该文件是本席禁改面，由数据文件责任席重锚；矩阵 §4 放行表与 READINESS 若引用「17/17」同步改 21/21
（矩阵席）。**仍开放**：真锚空转（内容不支撑结论）无机验——登记为人工审查面，不许被 M20 判绿误读。

## 13. R-10（工程审查 P2×3）—— PR-9 补 `snapshot:update` / §3.1 并行带自相矛盾串行化 / 行号漂移重锚

- **P2-1**：`G2-DEV-PLAN.md` W9 行与 PR-9 冻结面行补「**同一提交并跑 `pnpm run snapshot:update`**」
  （工具名正源 `ARCHITECTURE.md` §7.2 在哈希冻结面内；PR-2/5/7/8 都有此条、PR-9 漏写；兜底
  `check:freshness` 在，但排期面不依赖兜底）。
- **P2-2**：`W3 ∥ W4` 并行带**作废**。旧声明与三处自证矛盾：§1 表 W4 依赖列自写「W2、W3（游标要
  冻结的可见性谓词）」、PR-4 进入门禁「PR-3 exit 0」、依赖前序「PR-2、PR-3」。修法：§1 一行读法改
  `W1 → W2 → W3 → W4 → W5 → {W6 ∥ W7} → W8 → W9 → W10`（旧句保留 + 作废注记 + 理由）；§3.1 删该行
  （原位留删除注记）；§3.2 新增「PR-3 → PR-4」串行行——「正交谓词面 ≠ 非消费关系」，分页游标消费的
  正是 PR-3 要裁的呈现形态，按旧并行行排期会把「把 oracle 形态编进工具面」（`E-01`/`D6-b` ②）变成现实。
- **P2-3**：行号漂移重锚。§5-2 两处 EA 引用改「文件 + 小节名 + 判据文字」形（「不留豁免窗」句旧标
  `:577-578`→现文 §9.2 条 2「所有权账范围」；「夹具世界迁移登记」旧标 `:613`→§9.4 条目），旧行号在
  更正句里留名不作数；PR-0 进入门禁「17/17」→ 21/21（作废注记同批）；计划头注新增「**锚点纪律 /
  行号漂移限定**」免责段（形照矩阵头注先例，判据文字优先于行号，新写引用一律不带裸行号）。
  **审查点名的第三处（「17 条形变 M1–M14」名册）实体在 YAML 头注**——禁改面，登记于 R-9 需回填。

**实测（真实退出码，R-8+R-9+R-10 全部落地后本席最后一次全量跑，2026-11-01）**

| 命令 | 退出码 | 结果 |
| --- | --- | --- |
| `node g1/G1-CONTRACT-EVENT-AUTHORITY.fixtures.mjs` | **0** | 51 PASS / 0 FAIL（领域席 S19 轮值，零漂移） |
| `node g1/G1-CONTRACT-FACET.fixtures.mjs` | **0** | 35 PASS / 0 FAIL（零漂移） |
| `node g1/G1-CONTRACT-RELOCATION.fixtures.mjs` | **0** | **60** PASS / 0 FAIL（57→60：+T-N22 +S16 +MUT-11） |
| `node g1-checklist-validate.mjs` | **0** | items=27 open=23 done=4 违规=0（真锚零误伤） |
| `node g1-checklist-validate.mjs --self-test` | **0** | **21/21** 全部捕获 |
| `node g1-checklist-validate.mjs --require-clear` | **1**（**预期红**） | NO-GO 阶段放行谓词未满足；违规=0 |
| 洗白形 `--file .scratch/fakeroot/…/fake.yaml --require-clear` | 修前 **0** ⇒ 修后 **1** | P1-2 修复方向性证据（M21 常驻） |
| `node g0-gate.mjs` | **0** | 三条流逐等：225 例全绿 + 身份锚四项逐等 + skip=0；审查方 33 条已知红逐等 |
| `npx tsc -p experiments/v3-code-architecture-poc/tsconfig.json` | **0** | 零诊断 |
