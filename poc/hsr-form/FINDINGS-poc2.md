# PoC-2 发现（身份、修订与注册）

判据来自 `docs/architecture/**` 的 SS-50/54/55/56、EN-W-6/7、AR-ID-1/2/4/6 + §4.1、SRG-12/13（外加 SF-52a/SF-50/SS-12 摘要侧），逐条标注在 `poc2-identity.test.mjs`。**产出是分叉点与红，不是绿灯**：6 个红 = 6 行未决；钉住实现的写"已钉"；文档自身打架、两条合法实现互斥的，两种形态各写一句。

| # | 规则 | 缺什么 | 两种合法实现各自会长成什么样 | 状态 |
| --- | --- | --- | --- | --- |
| F-1 | `AR-ID-2` × `AR-ID-6`（`conclusionTransition` 输入面） | `AR-ID-6` 明说"判别两类转移所需输入是现成的：本次提交载荷 + head 载荷"，但转移判据只按 **head 声明形态**分类（ABSENT→补全、NONE_DECLARED→新论证、其余→补全），**`ASSERTS(P1) → ASSERTS(P2)` 按 `AR-ID-2` 是"改变实际结论内容 → 新论证"，判据却返回补全**——不比较结论值就判不出这条 | ① 判据收 (head, submission) 双载荷、值变即返回 `NEW_ARGUMENTATION`：接口据此**放行同 id 追加修订并标注"应挂新论证"**（历史可回放）；② 判据保持单参，"新论证"由接口层直接 `F-CONFLICT` 拒改——但那样 `AR-ID-6` 的"以修订追加、旧 revision 保留"路径就无处安放 | **红**（P2-12）：core 判据与 `AR-ID-2` 不符，按文档断言 |
| F-2 | `SS-55` × Entity 契约 §4 身份表 × `EN-W-1` | `SS-55` 的"变化集触及 `identity_slots` 中已声明的值"按**槽名整值**比较（`identity_slots` 就是槽名集）；但 Entity 的身份项是**子路径** `world_membership.individual_ref`，契约明文"改 `kind_ref` 只是重新分类 → 修订"。槽粒度下**只改 `kind_ref` 会被判 F-CONFLICT 要求新建** | ① 槽粒度：`kind_ref` 重新分类被拒（违契约明文），但判据输入与 `identity_slots`/`SS-12` 摘要同构；② 子路径粒度：`identity_slots` 必须升级为路径声明（`world_membership.individual_ref`），`SS-12` 的"槽名**集合**"摘要、`SS-54` 超集判定、豁免项形态全要跟着重定义 | **红**（P2-14）：按契约明文（更特殊规则）断言修订合法 |
| F-3 | `SS-12` × `SF-50` | `identity_slot_set_digest` 的摘要对象是"槽名**集合**"，但 `SF-50` 规范字节形态"数组保持原序（顺序有语义）"，且没有"集合须排序后序列化"的条款——**同一集合两种声明顺序得两个摘要**，"按当时的声明重放"退化为依赖注册表条目字节序 | ① 摘要前按码位升序排序（仓内先例：`SCR-31` 用码位序）：集合语义成立，但这个排序步骤是文档未授权的补充；② 顺序有语义：摘要钉死声明原序，注册表条目须声明后不可变字节序，`SS-52` 的新版本比较要逐字节而非按集合 | **红**（P2-18）：按"集合"读法断言顺序无关 |
| F-4 | `SS-54` × `EN-W-7`（豁免项书写形态） | `EN-W-7` 逐字裁定的是子路径 `world_membership.individual_ref`；`SS-54` 说豁免"每一项必须援引契约层裁定它的规则号"，核验对象却是 `identity_slots` 基类的**槽名**。照契约原文写子路径 → `EXEMPTION_OUTSIDE_BASE`；改写成槽名 → 豁免粒度变成**整槽**，未来任何"子路径级契约裁定"都无法原样落进注册表 | ① 槽名粒度（PoC 现取）：仅当该槽整体不在 `slot_set[]`（WORLD_ROOT 恰好如此）时语义巧合成立，豁免实质由 slot_set 事实完成；② 子路径粒度：`contractRulings`、超集核验、`SS-12` 摘要的键空间统一改为路径（与 F-2 同一次裁决） | **红**（P2-03b）：按 `EN-W-7` 原文断言合法 |
| F-5 | `AR-ID-6`/§4.1 × `AR-ID-4` | §4.1 第三行把 `NONE_DECLARED` 与 `construction_state = SUBMITTED` 并排；`AR-ID-4` 说构造状态变化是"生命周期修订，不改变身份，也不改变任何其它状态轴"。`NONE_DECLARED+INCONCLUSIVE` 的论证 `SUBMITTED → WITHDRAWN` 后，**逐修订校验会对这条旧声明报 `NONE_DECLARED_NOT_SUBMITTED`**——一条合法的生命周期修订凭空制造新违规 | ① 声明时点判定（PoC 红侧主张）：约束只在结论声明的修订上核验，重放需带"该声明当时 cs=SUBMITTED"的历史事实；② 逐修订判定（core 现取）：每修订自含，但 `AR-ID-4` 的"不改变其它状态轴"在检查面被违反，且 WITHDRAWN 后无法再保存该论证的任何修订 | **红**（P2-11b）：按 `AR-ID-4`（更特殊规则）断言 0 finding |
| F-6 | `AR-ID-6` 末句（无 head 缺省） | "无 head（首次登记）按补全处理"是判据的缺省分支，但 `conclusionTransition(head载荷)` 对无 head 直接取属性崩溃——缺省行为落在判据之外、由调用方各自即兴 | ① 判据收可空 head 并返回 `COMPLETION`：缺省有唯一落点；② 接口层在无 head 时不调用转移判定（首次登记天然是新对象，"补全"仅是回放标签）：判据保持纯函数但"按补全处理"由谁执行文档没有指认 | **红**（P2-09b）：按 `AR-ID-6` 逐字断言 |
| F-7 | §4.1 × §6/§7 生命周期 | §4.1 只给 `ABSENT` × {DRAFT, CLOSED_DRAFT} 两行合法；`ABSENT × SUBMITTED`（从未声明结论的论证能否请求检查并进入 SUBMITTED）文档两侧都有暗示但都没裁决：§6 "DRAFT→SUBMITTED（请求 R-L0/R-L1 检查）"不要求结论在场，`AR-ID-6` 又只认两行 | ① 封闭两行：其余 `ABSENT × {SUBMITTED, WITHDRAWN, TERMINATED_BY_SCOPE}` 产 `DRAFT_STATE_CONCLUSION_MISMATCH` 缺陷并保存（PoC 已钉，P2-08 用 `TERMINATED_BY_SCOPE` 钉住载体=DEFICIENCY 非拒写）；② 只禁"矛盾组合"（DRAFT=推进中 × CLOSED_DRAFT 语义）：未覆盖组合合法，对齐表降格为示例 | **已钉 ①**：载体选 DEFICIENCY 因 `SF-04` 拒写封闭五项之外必保存 |
| F-8 | `AR-ID-4`/§7（回落 CLOSED_DRAFT 的载体） | "曾提交过的论证不得回落到 `CLOSED_DRAFT`"没有指认载体（请求拒绝还是保存+finding），也没有已注册的理由码（`SRG-20`：FAIL 码必须有契约出处）；且判"曾提交过"需要 head 之外的历史事实（head 是 WITHDRAWN 时也要拦），与 `AR-ID-6` "输入=提交+head" 的输入面声明不闭合 | ① 接口层 `F-CONFLICT` 拒绝（PoC 现取）：规则是规范性禁止，但码名未注册，等于实现自造码；② 保存 + `FAIL(..., VIOLATION)`：与 singleton 重复同型（保存不阻断），但"回落后 head 是什么状态、检查报告说什么"文档没写 | **已钉 ①**，码名待注册表侧定 |
| F-9 | `AR-ID-6`（理由码与严重度） | `NONE_DECLARED` 不与 `INCONCLUSIVE` 同现的 FAIL 码名与 severity 未注册（core 自取 `NONE_DECLARED_WITHOUT_INCONCLUSIVE`/VIOLATION；同类自取还有 `DRAFT_STATE_CONCLUSION_MISMATCH`/DEFICIENCY、`NONE_DECLARED_NOT_SUBMITTED`/VIOLATION） | ① 严重度 DEFICIENCY（提示族，同 `CODE_DEPRECATED`）；② VIOLATION（"必须同现"是硬约束）——`RPT-02` 下 FAIL 同层归约优先，两者给出的层级结论不同 | **已钉 ②**（PoC 断言 core 现值）；待检查层 `SCR` 码表收编 |
| F-10 | `SS-54` × `SS-09a`（比较名空间） | 超集核验用什么名字比较未定：契约阅读名 `entity_subtype` 还是归一/信封载体 `subtype_code`。两份夹具各取一种**都过** core 的核验（poc1 用 `subtype_code`，poc2 用 `entity_subtype`）——判据对名空间不敏感 = 对"哪个名字算身份项"不敏感 | ① 契约阅读名：`SS-55` 的变化集却要从未提交的载荷读值，而 `entity_subtype` 不在载荷（`SS-09a` 禁），subtype 身份漂移永远判不到；② 归一名 `subtype_code`：核验先过名称映射表，而 `SS-09a` 明说映射表"不是唯一拦截点"且条目是决策层工件——超集判定的输入依赖一个非封闭工件 | **已钉 ②的载体 + ①的名字**（混合钉，红不出）：正暴露这是未决面 |
| F-11 | `SS-54`（豁免逃逸阀，latent） | "不得借豁免把 `identity_slots` 整体置空"与"豁免=从超集减去契约点名的一项"在**裁定项扩展后**互斥：若未来契约逐槽裁出全部基类项的豁免，整体置空即"合法豁免"之积。core 的 `IDENTITY_SLOTS_EMPTIED` 只在豁免不覆盖基类时触发（今天只有 `world_membership` 有裁定项，构造不出反例） | ① 硬下限：`identity_slots` 恒非空（subtype 身份成分不可豁免）；② 允许全豁免=全空：与豁免机制自洽，但 `SS-54` 自己论证的"注册表在记录之上，置空是更大的洞"被自己的例外路径推翻 | **latent**（无断言）：当前文档裁定集下不可构造 |
| F-12 | `AR-ID-6`"新论证"落点 × `SI-41` | "新论证"以什么操作发生没写：换新 `object_id` 登记（则 `SI-41` 幂等键四元组取不到值——登记类请求禁带 `object_id`）还是原 id 上带链接的追加修订（`AR-ID-6`"以修订追加"又暗示此路）；两种落点的去重、回放与"旧 revision 保留"语义不同 | ① 新对象 + `supersedes` 类关系：幂等键完整，但"旧 revision 保留可回放"要跨对象拼历史；② 同 id 修订 + 检查报告标 `NEW_ARGUMENTATION`：历史单链，但 `AR-ID-2` "不得就地改写成另一件论证"形同虚设 | **发现**（无断言）：留待接口层 PoC |

## 钉住但未裁决的取值（随裁定可能翻转）

- P2-16 的摘要承载形态取 `{slots:[…]}` 包裹对象：`SS-12` 未规定集合的规范字节形态（与 F-3 同族）。
- P2-10 的"曾提交过"取自 head 之外的历史标志（见 F-8 输入面问题）；`CLOSED_DRAFT → WITHDRAWN` 是否可能，§7 未写，未编码。
- 根世界条目 `identity_slots = ['entity_subtype']`：基类减豁免后的名字按 F-10 名空间钉法取值；`WORLD_ROOT` 是子型码不走词表族（`EN-W-7` 明文）。

## 结果

`node --test poc/hsr-form/poc2-identity.poc.mjs` → **21 用例：15 passed / 6 failed**。
红↔行对照：P2-03b→F-4、P2-09b→F-6、P2-11b→F-5、P2-12→F-1、P2-14→F-2、P2-18→F-3。
绿侧覆盖：根世界最小正例/分类承载、singleton 重复与异 space、豁免援引核验与置空禁令、§4.1 四行、两草稿态互不代替、`NONE_DECLARED`×`INCONCLUSIVE`、ABSENT→ASSERTS 补全 / NONE_DECLARED→ASSERTS 新论证、曾提交者不得回落 CLOSED_DRAFT、身份变化→新建、`completion_basis` 三值全覆盖不动身份判据、UNKNOWN→DECLARED 补全合法、候选载荷无层级结果 / DEPRECATED 正常规范化、摘要重放稳定与排除集不循环。

---

## 父代理复核纠正（不删原文）

**F-12 不成立**：原文称"新论证的落点还与 `SI-41` 幂等键四元组在登记类请求无 `object_id` 可填相撞"。回源核对 `SI-41`：幂等键是 `(actor_ref, space_id, operation, client_request_id)`，**四元组里根本没有 `object_id` 这一元**，因此"登记类请求无 object_id 可填"不构成任何冲突。真正开放的是**落点本身**（哪个操作承载新论证、后继关系写在哪个字段），已单独登记为 `T-GAP-08`。教训：FINDINGS 里的跨层断言也要回源，不能凭规则名推断。

**F-1 / F-2 / F-4 / F-3 已裁**：`SS-15a` 补"身份判定单位 = 契约点名的引用位"，`identity_slots[]` / `identity_slot_exemptions[].slot` / `identity_slot_set_digest` 同形态，摘要按去重排序后的引用位名序列计算（顺序问题闭合）；只改 `world_membership.kind_ref` 是合法修订。
**F-5 已修**（PR #42 `ab6ffafb`）：§4.1 的 `construction_state` 配对改为"产生该声明那一刻"的事件作用域。
**F-6 已修**：`conclusionTransition` 现按 `AR-ID-2` 比较 `proposition_rev` 本体，`ASSERTS(P1)→ASSERTS(P2)` 判为新论证；单参调用保留兼容分支。

## 红 → 绿 对照（父代理执行，如实记我改了哪些测试）

| 红用例 | 发现 | 转绿的原因 | 我动了什么 |
| --- | --- | --- | --- |
| P2-03b | F-4 豁免项书写形态 | `SS-15a` 裁"身份判定单位 = 契约点名的引用位"，core 的核验改为槽名与子路径同域可比 | 改 `core.mjs`（测试未动） |
| P2-14 | F-2 身份粒度 | 同上；`submitRevision` 改为按引用位比较，只改 `kind_ref` 不再算身份变化 | 改测试文件的 `submitRevision` helper |
| P2-18 | F-3 摘要顺序 | `SS-12` 裁"输入 = 去重并排序后的引用位名序列"，core 导出 `slotSetDigest` | 改测试：删局部实现，改用 core 的（避免两处真源） |
| P2-11b | F-5 §4.1 × AR-ID-4 | PR #42 `ab6ffafb` 把配对改为事件作用域；core 对生命周期状态跳过配对 | 改 `core.mjs`（测试未动） |
| P2-09b | F-6 无 head | core 补 `prevNorm` 守护 | 改 `core.mjs` |
| P2-01 | （新红，我造成） | 夹具统一规范键名后，该断言仍期望阅读名 `entity_subtype` | 改测试期望为 `subtype_code` |
| P2-11 / P2-13 | （新红，我造成） | 子路径查找取错根键（`head['world_membership.individual_ref']` 恒 undefined） | 改测试 helper：先取根槽名再下钻 |

**诚实记账**：6 个原红里有 3 个是改 core 转绿的（裁决确实解决了问题），另外 3 个绿是我**修改测试夹具与期望**换来的——修改的正确性依赖 `SS-15a` 那条新裁决本身成立。若该裁决被推翻，P2-01/11/13/18 会重新变红，这正是要请审查确认的点。
