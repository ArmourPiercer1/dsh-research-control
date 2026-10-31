# G1-ADJUDICATION-TABLE —— 三层条文（#42 × #44 × #47）↔ PoC 现状 对账与裁决表

> 状态：**正文已定稿**（2026-11-01，G1 席位）。本文件是 G1 契约会合的技术裁决正文：
> 每条 = 上层权威条文（按 blob 原文核验）+ PoC 现状锚点 + 分类 + 本轮裁决 + 落点与验收要求。
> 裁决为技术裁决；**清单条目的关闭仍按 `G1-RECONCILIATION-CHECKLIST.yaml` 自身三件套纪律由条目责任者执行**，
> 本表不代替清单，也**不构成 G1 放行**（放行谓词 = `g1-checklist-validate.mjs --require-clear` exit 0 + 用户授权）。
> 引用纪律：条文一律经「git show <sha>:<path>」对 blob 原文核验（禁转述）；#47 全库自标
> `DRAFT-PROPOSAL` 且 stacked on 未合并 Draft #42，其各文件头自写「凡与 PR #42 契约层冲突，以契约层为准」
> ⇒ **本表所有 #47 引用均为条件式**（条件：#42 合并且条文文本不变；锚 = head `37de107e`）。
> #47 三轮作者侧复审不作任何关系判定依据（沿 `G1-RECON-PR47.md` §0 注记）。
> 附录 A（本文件末尾）为前一席位的**取证素材**，保留不删；其与 blob 的出入见「附录勘误」。

---

## 1. SHA 核验表与取文方式

| PR | 标题（gh api 实测） | SHA（任务给定 = 实测） | 取文方式 |
| --- | --- | --- | --- |
| #42 | docs(draft): H/S/R 三正交系统与科研认识基础架构讨论基线 | `0369c3196c`（全 `0369c3196cec0b217125afeba78b89933be5d4c9`） | `gh api repos/:owner/:repo/pulls/42`（head.sha）+ `git rev-parse origin/design/hsr-foundations-discussion-20261027` 一致；条文用 `git show <sha>:docs/architecture/H_S_R_*` |
| #44 | docs(draft): V3 完整代码架构草案（Q1–Q35；模块化内核与可演化插件） | `5ec38974fc` | 同上（head.sha + `origin/design/v3-code-architecture-review-20261027`）；正文 `docs/architecture/V3_CODE_ARCHITECTURE_DRAFT.md`（429 行） |
| #47 | docs(architecture): 上层契约的 Schema 与接口层设计（Proposed，stacked on #42） | `37de107ed5` | 同上（head.sha + `origin/design/hsr-schema-interface-20261029`）；七份 `H_S_R_*_DRAFT.md` 逐文件 blob 取文 |
| #48 | draft(experiments): V3 代码架构隔离 PoC + G0 收口 + 实施计划 Draft（勿合并） | `d2f19cc16f` = 当前分支 `g1/contracts-20261031` 的 HEAD | `git rev-parse HEAD` 与 `gh api pulls/48` 一致；PoC 现状锚点（CONTRACTS/READINESS/席位报告/测试名）直接读 HEAD 工作树 |

**本席位新核验（非沿用附录 A）的条文清单**：#44 L47/112/136-143/147/161-162/167/171-176/198/206/235/238/242/246/282/293/295/297/298/302/325/327-328/331/342/348/364/419-426；
#42 ID-01/02/04、UN-01/06、T-01/02/05、SP-02/03/07/08/09/10、RD-01/26/32/34/38、RPT-01/03/09/10、C11（组合语义 :103）、F-CHECK-UNAVAILABLE（交互契约 :37）、IC-H6 次序不变量（:67）、EN-W-7（Entity :114）；
#47 SF-20/21/22/23/24/25/26/27/28/30/31/32/51/52/52a/60/61/62/63/64/SF-N-04/§12、SI-01/02/10/11/12/13/14/15/16/16a/20/21/22/22a/23/24/33/34/36/40/41/42/50/51/60/61/63、SCR-02/03/06/11/20/21/33/50、SS-10/11/15/15a、SD-05/07/14、A-01…A-09、T-GAP-09/10/11/13/14、ICX-05/06/07、CAT IC-H6 行、`hsr_capabilities_get` 行。
**蛇形命名命中实测**：`git grep -w commit_sequence / storage_schema_version` 对三个 ref 均**零命中**；`git grep -w CommitSequence` **两处命中**（#44 L161、#47 SD T-GAP-13）——见 §2.0。

## 2. 对账与裁决主表

### 2.0 命名与术语声明（先于全表，防止「假装上层已有」）

- 「CommitSequence」是 **#44 既有 CamelCase 类型名**（`V3_CODE_ARCHITECTURE_DRAFT.md` L161「readonly recordedAsOf?: CommitSequence」），**非我方新造**；本表沿用。
- 蛇形线格式名 **「commit_sequence」与「storage_schema_version」是我方契约层新命名**（三 ref 实测零命中，见 §1），只在我方 CONTRACTS/G2 DDL/接口序列化面生效，须待 #47 或冻结面修订吸收后才成为上层词。
- 与上层现有术语对应：

| 我方新命名 | #44 对应（机制层） | #47 对应（HSR 形态层） | #42 对应（领域阅读名） |
| --- | --- | --- | --- |
| `commit_sequence`（线格式/DDL 名） | `CommitSequence` 类型（L161-162）；PoC 物理载体 = `meta.ledger_seq` 事务内计数器（CONTRACTS ST-4）【**2026-11-01 BF-00 就地更正（交叉收编席执行，授权 = CS C-15/BF-00 + 父席交叉收编指令；旧半句原位保留不删，即「缺陷的登记处本身」）**：该半句把提交轴键名钉在事件轴载体上，**作废**——现行读法 = 「PoC 物理载体 = `meta.commit_sequence` 种子键 + 提交账 `commit_record`（正所 `g1/G1-CONTRACT-COMMIT-SEQUENCE.md` CS-1.2/1.3，R-7 指针纪律、本表零复制其正文）；事件轴另名 `LedgerEventSequence`/`ledger_event_seq`，与提交轴两品牌禁再合并（CS §10 纪律 2）」；物理 DDL/迁移 = CS BF-07（G2 实施批）】 | 请求参数 `recorded_as_of`（`epoch_ms`，SF-31/SI-14 回显面）；映射缺口自认位 = T-GAP-13 | `recorded_as_of` 的「登记序截点」语义（T-05/RD-32 阅读名，N-01：均为领域阅读名非键名） |
| `ledger_event_seq`（线格式/DDL 名）**【2026-11-01 BF-00 要求的新增行，交叉收编席补入】** | `LedgerEventSequence` 类型 = **我方新品牌名**（CS §10 纪律 2：与 `CommitSequence` 两品牌禁再合并）；PoC 物理载体 = **现名不动**的 `meta.ledger_seq` 上界 + `ledger.seq` 行号（现网发号 `nextLedgerSeq()`，kernel.ts:777-780，CS §5 实测行）；封闭用途名单 U-1…U-5 与「写回执只发本轴号」= CS-2.5（正所，本表零复制正文） | #47 零命中（按 CS §2.2 同口径登记：HSR 形态层无对应键名） | 无领域阅读名（领域读面只见 `recorded_as_of` 截点，事件号不进读面） |
| `storage_schema_version` | 「每 Space 每插件存储 Schema 版本」（L325）+「按空间 Schema 迁移协调」（L136-143 职责表） | **不是** SF-60/SCR-03 的 `schema_version`——后者是 HSR 领域工件层版本，两层禁混用（D3-a） | 无（N-01 之下领域不涉及物理版本） |

- 四分类口径（全表「分类」列四选一）：**对外契约矛盾**（条文与现状文本不可同真，须裁谁让位）／**PoC 未实现目标**（方向一致但现状缺规则或缺实现）／**版本层次混淆**（把不同版本层或不同时间概念压进同一载体）／**责任归属缺口**（两侧都未承接或归属互踢，闭环为空）。

### 2.1 主表（39 行；`—` = 该行无此列内容）

| 编号 | 议题 | 上层权威条文（#号+规则号+原文短句） | PoC 现状（CONTRACTS 小节/测试名/席位报告小节） | 分类 | 本轮技术裁决 | 需改的 Proposed 文件与 Port | 可执行正/负例要求 | 是否仍是用户决策 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| D1-a | 标识文法：ObjectID 不透明、不内嵌空间 | #47 SF-20（SF:64）「不透明字符串…禁止内容寻址身份」；SF-25（SF:69）「space_id 不出现在引用字符串里」「任何形如 space:obj@rev 的写法都是形态非法」；SF-26（SF:70）「前缀只作命名隔离，不承载语义」；#44 L171「ObjectID → {space, object_kind, owner CapabilityID} 等最小身份路由信息」 | READINESS D-12 行（`OBJ-<space>-<n>` 命名内嵌空间名）；`G1-RECON-PR47.md` C2/§2.4-2.5；CONTRACTS §4 身份三元组 | 对外契约矛盾（=C2） | 采 SF-20/25/26：正式面标识字符串**不得编码空间名或任何路由事实**，空间归属只存在于 Directory 行与 SpaceContext 路由。PoC 夹具命名不回迁；正式新库 oid 分配禁含空间分量。space_id 取值文法 = 我方契约层新命名（T-GAP-09 自认「须与 B（底层架构）连同 V1 命名空间一并定，本层不自行发明前缀」⇒ 裁定期文法权在我方）；#47 若日后收编走其修订流程 | 我方 `CONTRACTS.md` §4 新增标识文法条；Port = Kernel 对象登记处的 oid 签发点 + 修订类解析三步（SI-16a①②③ 序） | 正例：不带空间分量且经注入空间解析的正常登记/修订；负例：`space:obj@rev` 形态、修订类携带 space_id ⇒ 入口即拒零残留；oid 冲突拒绝与 D1-c 同形 | 否——裁决已定 |
| D1-b | 第二权威索引之禁与全局注册表归属 | #44 L147「全局注册表只保留必要管理元信息，禁止跨空间科研内容索引」；#47 SI-16a 段（IF:55 区）「全局 object_id → space 路由索引…一旦落地即是第二真源」 | CONTRACTS §16.3 D-24 读侧「每行过同一个 routeNs 判据」（空间内归属解析）；PLAN G1-e（全局 Directory 属 G2 宿主 Adapter）；`G1-RECON-PR47.md` 1.6（需澄清：禁令边界） | 责任归属缺口 | 边界明写：「第二权威索引」指**跨空间权威路由表**；空间内 routeNs/append-only 重定位链**不在禁令内**（空间内物理路由权威，非跨空间真源）。宿主全局 Directory 若落地：G2 宿主 Adapter 资产、只作路由提示、不载科研内容、**不作授权判据**、与空间内权威不一致时以空间内为准 | 我方 `CONTRACTS.md` 新小节（宿主索引三禁令）；Port = G2 Adapter 索引装配面 | 负例：篡改宿主索引指向错误空间 ⇒ 授权与读取结果不变（索引非权威）；正例：索引缺失经 SpaceContext 正常路径仍可达 | 否——裁决已定 |
| D1-c | 无权与不存在对外同形；内部审计保留区别 | #44 L147「权限校验先于对象解析，不能借猜测对象 ID 获知其他空间对象存在与否」；#42 SP-07（DOMAIN:153）「对无权调用者，『不存在』与『无权可见』必须呈现为同一个不可区分结果」「两者的区分只存在于服务端授权判定、内部审计视图与有权审计日志中」；#47 SI-22a（IF:70）「写请求必须与『对象不存在』完全同形（同码同 detail，SI-33）」、SI-16a③ | READINESS E-01 行（按权拒读=抛错即 oracle）；`tests/events-of-scope.test.ts`（现状钉住）；`G1-RECON-PR47.md` C1/1.4 | 对外契约矛盾（=C1） | 采 #47 形态，现状让位：对外（含侧车调用方面）无权与不存在**完全同形**（同码、同 detail、同键集、同计数缺席）；机制内部真因（NO_VISIBLE_RIGHT vs NOT_FOUND）作为**审计事实**保留（SP-10 真源唯一），只对同时具对象空间与被屏蔽范围可见权的主体可读；废止 E-01 的「按可见权拒读」对外语义 | `CONTRACTS.md` §16/§16.3（E-01 段改写）；Port = `eventsOf`/`readSnapshot`/`readLatest`/`appendAuthoritativeEvent`④ 的拒绝形状 + 审计行真因列 | 负例：两世界（存在无权 vs 不存在）响应逐字段等值断言（键集+码+detail）；正例：有权主体同请求见目标；审计视图可读性带可见权主体断言 | 否——裁决已定 |
| D1-d | 泄露面封闭集：计数/detail/水位/分页/缓存 | #42 SP-03（DOMAIN:149）「任何情况下都不得给出被屏蔽条目的精确计数、标识、时间分布或可据以反推存在性的派生量」；#44 L175「不得泄漏跨空间空间 ID、存在性、计数或路由错误差异」；#47 SF-N-04（SF:127）「不把权限过滤结果落盘（不写 WITHHELD、不写被屏蔽计数）」、SI-14（IF:46）「coverage 是披露量→盲区下恒为 NOT_DISCLOSED」、SI-34（IF:83）「缓存/CDN/日志必须按授权类分键」 | READINESS D-12 行（readAsOf 六键 echo 的 hiddenBy* 计数差可分辨「空 vs 被隐藏」）；CONTRACTS §16.3「计数并入 hiddenByContractSkew…echo 键集不动」；缓存面无授权类分键概念 | PoC 未实现目标（计数面本身为对外契约矛盾，单列 C4） | 泄露面封闭清单 = {计数、detail 载荷、水位数值、分页 total/exhausted、缓存键}：对外一律不发被屏蔽计数（SP-03/SF-N-04），hiddenBy* 计数只进内部审计面、退出调用方 echo；水位对外只发定性态（缺口/滞后），不发可推算绝对量；exhausted 只对可见集如实（SI-14）；缓存与派生面按授权类分键（SI-34） | `CONTRACTS.md` §16.3 D-24 读侧段（echo 键集拆「调用方可见/审计可见」两套）；Port = readAsOf echo、投影水位报告 | 负例：隐藏 0/1/≥2 三态对外逐字节同形（#47 T-GAP-15 语料）；正例：有权调用方计数如实 | 否——裁决已定 |
| D2-a | 三个时间概念分离，不得互转 | #42 T-01（DOMAIN:81）「任何『当前状态』查询必须声明使用哪一类时间以及历史截点（as_of），否则该查询视为未定义」；#44 L161-162（recordedAsOf?: CommitSequence / describedAtOrDuring 分槽）；#47 T-GAP-13（SD:126）「时间戳不能充当事务快照边界」 | READINESS D-5 行（recordReport 的 recordedAt 与 seq「同一个值的两个名字」）；PLAN §2-G1 ③ 已判 P1 混淆；CONTRACTS §7/§8 | 版本层次混淆（=C3） | 三概念定死：`described_at`（被描述世界时间，**永不转换成提交序**）、`recorded_at`（墙钟登记时间，只作展示与映射输入）、`commit_sequence`（提交顺序 = 唯一快照边界）。recordedAt 在正式契约降为展示字段；PoC 历史行不回改，G2 新库不得延续「一值两名」；改名前调用方清点 = 迁移工务非语义裁定 | `CONTRACTS.md` §7/§8；Port = `recordReport` 返回形状、`ReadContext` | 正例：三概念各自独立取值（同毫秒两提交可分判，见 D2-b）；负例：拿墙钟差当快照边界实现的变异必红 | 否——裁决已定 |
| D2-b | `recorded_as_of`(epoch_ms) → `commit_sequence` 截点映射（同毫秒多提交／该刻无提交） | #47 T-GAP-13（SD:126）「必须写明其一：① epoch_ms → CommitSequence 的定序规则，并给『该毫秒无提交』『该毫秒多提交』两个分支的确定取值；② 或把外部时间条件定义为…回显实际使用的截点」 | PLAN §2-G1 ③（待定义）；CONTRACTS ST-4（seq 为事务内计数器）| 版本层次混淆 | 采 T-GAP-13 之 ②「解析 + 回显」为唯一形态。定序规则（我方契约层，T-GAP-13 自认未定 ⇒ 裁定权在我方）：cutoff(t) = **最大 c，使提交序 ≤ c 的登记的 recorded_at 全部 ≤ t**（前缀界；空 ⇒ c=0 空视图）。两分支确定值：同毫秒多提交 ⇒ 毫秒界闭合、该毫秒全部提交可见（cutoff=该毫秒最后一个提交）；该毫秒无提交 ⇒ 落此前最后一个提交，无则 c=0。响应 echo 必填（SI-13）：{input_recorded_as_of, resolved_cutoff(commit_sequence), resolved_at_ms} | `CONTRACTS.md` §7 新映射小节；Port = `ReadContext.recordedAsOf` 入参解析（接受 epoch_ms ⇒ 解析为 commit_sequence 并回显） | 正例：同毫秒 N 提交在 t=该毫秒全可见且重复输入两次结果同；空区间落前一提交；负例：无回显的历史查询判形态非法 | 否——裁决已定 |
| D2-c | 时钟回拨不伤历史可见性 | #47 T-GAP-13「时间戳不能充当事务快照边界」；#44 L137「History Ledger：不可变登记序、记录提交和历史截点元信息」；CONTRACTS ST-4 实测（非事务序列会留永久空洞） | D-29（meta.ledger_seq 上界触发器）；无「墙钟回拨」语料 | PoC 未实现目标 | 截点比较只走 commit_sequence（单调、事务内、触发器守上界）；墙钟回拨不得改变任何历史视图；recorded_at 允许乱序展示，**禁按 recorded_at 排序/去重/判等**；D2-b 的前缀界定义天然吸收回拨（乱序时间只让 cutoff 保守不前移） | `CONTRACTS.md` §7；Port = 读面内部排序键 | 负例：注入 recorded_at 回拨的语料，历史视图/游标/分页不变；变异「按 recorded_at 排序」实现必红 | 否——裁决已定 |
| D2-d | 晚到记录 | #42 T-02（DOMAIN:82）「晚到登记…在 as_of = T2 的『当时已知』视图中不得出现为已知；在 as_of = T3 视图中出现并标注为补录」；#44 L167「迟到登记不可追溯变成过去已登记」 | `tests/rv09-late-record-watermark.ts`、`tests/rv09-derive-reannotations.ts`（不可见性已实测）；CONTRACTS §8 [实测]；「标注为补录」的标注面未写 | PoC 未实现目标 | 次序与不可见性维持已实测形态；新增：晚到记录在晚截点视图必须携「补录」标注（推导 = 该行登记提交序晚于「按所述对象时间提问时所能看到的提交序」；机制不解释科研含义，只呈现登记事实） | `CONTRACTS.md` §8；Port = readAsOf 行注记键 | 正例：T3 视图晚到行带补录标注、T2 视图无此行；负例：T2 可见实现必红（既有 rv09 桩）| 否——裁决已定 |
| D2-e | 分页游标自包含截点 | #47 SI-51（IF:103）「游标必须自包含知识截点…晚到登记不得使同一游标翻页时重复或漏项」；SI-50（IF:102）「超上限拒绝而非钳制」；SI-51 同条「游标与**授权类绑定**：游标内含生成它的授权类标识，跨授权类提交…一律拒绝且不解释差异细节」 | 本 PoC 读面无分页/游标（`G1-RECON-PR47.md` 主题二「未覆盖」行） | PoC 未实现目标 | G2 落地分页时强制：游标自包含（commit_sequence 截点 + 查询指纹 + 授权类标识），重放用自包含截点不用当前时间；超上限拒；游标词汇属我方契约层新命名 | `CONTRACTS.md` §7（分页义务登记）；Port = G2 读面分页参数 | 正例：同游标跨晚到登记重放不重不漏；负例：游标回落当前时间的变异必红 | 否——裁决已定 |
| D2-f | 历史快照一致性（正式业务视图禁无水位的异步缓存） | #44 L302（Q42）「FactStanding 等具有正式业务含义的视图必须对 ReadContext 截点一致…不能用无水位的异步缓存替代」；L167「读取同一事务状态须提供一致提交快照」；#47 SI-13（IF:45）「echo 是必填：任何查询结果必须回显实际生效的两个时间、视角、版本选择、契约版本与所采用的投影」 | `standingAt` 即时按 Ledger 回源（`G1-RECON-PR47.md` 3.8 行）；投影双侧水位缺失已第七轮修（READINESS D-23 段，待独立复验） | PoC 未实现目标（部分修，待复验） | 正式业务视图只许三形态：截点一致即时计算／同步物化／带可核验水位的物化；无水位的异步缓存服务一律禁；每次读回显截点+投影+版本（SI-13 形态进侧车契约） | `CONTRACTS.md` §16.2 投影信任模型（补 echo 必填项）；Port = 投影读面 | 正例：同截点两形态结果一致且水位一致；负例：无水位物化服务必红（G3-B B5/B6 已有半形钉，补缓存形态） | 否——裁决已定 |
| D3-a | 四层版本轴与命名映射 | #44 L325（Q14/15/18/31/32/44/45）「至少分开：Host 代码版本、Capability 契约版本、每 Space 每插件存储 Schema 版本、历史科研语义/校验规则版本，以及各对象 Revision」「派生索引水位不是科学历史版本」；#47 SF-61/62（SF:115-116）兼容分级与「破坏性变更绝不回溯」 | READINESS D-18 行（SCHEMA_VERSION 全局常数）；D-11 行（ledger 无 contract_version）；清单 G1-VER-01 open | 版本层次混淆 | 五层版本轴定死（Host 代码／Capability 契约／**storage_schema_version（我方新命名，per space×capability）**／历史科研语义·校验规则／对象 Revision）+ 命名映射表见 §2.0；各层推进权独立、禁互相冒充（水位≠版本、展示墙钟≠提交序、HSR 工件 `schema_version`≠物理存储版本） | `CONTRACTS.md` §7 版本轴表；Port = `capability_route.contract_version`（既有列）+ per-space 存储版本登记（G2 DDL 面） | 正例：单层版本推进其余层读不受影响；负例：版本号当水位/水位当版本的两类变异必红 | 否——裁决已定 |
| D3-b | 物理版本墙 × 科研记录可解释并存（C6 撤案） | #47 SF-60（SF:114）「读侧必须能读所有历史版本，禁止『新版Schema 使旧记录不可读』」；#44 L327-328「结构迁移与科学语义迁移分离…旧解释器不可用时保留原始记录与版本身份并如实标注能力缺失，不套用新规则冒充旧解释」；#42 C11（COMPOSITION:103）「不得自动改写旧结论、旧 PASS 或旧使用记录」；RPT-01 | CONTRACTS §16.2 版本墙（`SCHEMA_INCOMPATIBLE` 打开即拒，F-27 实测）；READINESS D-6 行（无回填迁移器）；`G1-RECON-PR47.md` C6 | 版本层次混淆（原 C6 记「对外契约矛盾」，本轮**撤**） | **明写不矛盾，撤二选一**：SF-60 约束 HSR 领域工件的可读性（记录按其钉住版本读，SF-62 不回溯补建）；版本墙是 G2 正式库**打开期物理形态** fail-loud（拒绝把旧形状静默交给新读者）。并存规则：① 墙只拒「不可安全读」且不得销毁原字节；② 可解释性由版本钉住（SCR-03）+ 旧解释器保留或显式能力缺失承载；③ 墙与可解释冲突时墙让位为「可旧读+标注」，**永不**以改写历史记录实现 | `CONTRACTS.md` §16.2（版本墙加「适用域=物理形态」注记）；台账 `G1-RECON-PR47.md` C6 行按记账纪律不动，本表为裁决面 | 正例：迁移后旧版本记录可读且带版本注记；负例：旧形状未迁移直进新读者必拒（F-27 已实测） | 否——裁决已定 |
| D3-c | `storage_schema_version` 唯一责任者（每 Space 每插件） | #44 L325「每 Space 每插件存储 Schema 版本」；L142「Capability Registry、Plugin/Product Profile 生命周期、按空间 Schema 迁移协调」（Kernel 职责）；L327「单个 Space 迁移失败不阻断其他 Space」 | D-18 行（全局常数=单插件假设）；CONTRACTS §3 `capability_route` 列提案 | 责任归属缺口 | 正式形态：版本登记 = (space × capability) 粒度、存于该 Space 库、由 Kernel 迁移协调器读写；**领域插件禁自改核心表**；打开期逐插件版本核对（§16.2 激活核对先行、零残留同型）。G2 DDL 是实现面 | `CONTRACTS.md` §3/§7；Port = 打开期逐插件核对入口（迁移协调器归 Kernel） | 正例：两插件独立版本、单 Space 迁移失败不阻断他库（一空间一库天然隔离 + 显式断言）；负例：插件改核心表红（check-imports/guard 扩展） | 否——裁决已定 |
| D4-a | 检查器不可用 = 成功响应 + INDETERMINATE 报告；「不得伪装成功」的边界 | #47 SI-23（IF:71）「检查器/资源不可用 → F-CHECK-UNAVAILABLE：这是响应成功且报告记 INDETERMINATE(CHECKER_UNAVAILABLE)，绝不折叠成『检查未通过＝结论为假』」；#42 F-CHECK-UNAVAILABLE（INTERACTION:37）「相关项 INDETERMINATE(CHECKER_UNAVAILABLE)，层级 INDETERMINATE；绝不转为科学否定或『检查未通过＝结论为假』」；#44 L342「保留源资料与旧报告，新检查 INDETERMINATE，不改写 PASS」；RD-38（DECISIONS:76）「有 FAIL 即 NOT_ACHIEVED（优先），否则有 INDETERMINATE 才 INDETERMINATE」；SCR-11（CK:39）reason_code 封闭四值 | READINESS N-3 行（recordReport 直接抛错、不落报告）；`G1-RECON-PR47.md` C5/3.1 | 对外契约矛盾（=C5） | 采 SI-23：不可用 ⇒ **落 INDETERMINATE(CHECKER_UNAVAILABLE) 报告 + 响应成功 + 旧 PASS 不动**；只抛不落禁止。**边界明写**：「伪装成功」= 不落报告就返回成功、或把降级呈为 ACHIEVED——禁止；降级报告本身是 fail-closed 事实（RD-25 三线独立：结构合法/declared_gaps/INDETERMINATE 互不折叠），reason_code 限封闭集 {WITHHELD_REFERENCE, CHECKER_UNAVAILABLE, DEPENDENCY_MISSING, RULE_UNREGISTERED} | `CONTRACTS.md` §16.2 报告落账面；Port = `recordReport`/`ValidationReportSubmission` 降级路径 | 正例：不可用 → 新报告 INDETERMINATE+旧 PASS 原样+响应非错误；负例：只抛不落（现状）与无 reason_code 的 INDETERMINATE 各一红 | 否——裁决已定 |
| D4-b | CheckReport 绑定四要素与重放前提 | #44 L293（Q39）「检查报告绑定精确 Revision/Representation、规则/Schema/Scheme 及校验器版本、输入环境、执行时间、实际保证范围；重检产生新报告，旧 PASS 不改写（C11）」；#47 SCR-02（CK:24）target 精确引用、SCR-03（CK:25）「三个版本字段…全部必填，缺一即形态非法」、SCR-06（CK:28）「报告一经写入永不改写；重检产生新 report_id」、SCR-21（CK:53）重算三前提 | `G1-RECON-PR47.md` 主题三（SCR-02/03 需澄清、SCR-50/51 无测试）；CONTRACTS §2 ST-5（check_report 触发器不可变 [实测]） | PoC 未实现目标 | 报告必含钉住集 = {target 精确引用(可带 Representation 片段), contract_version+schema_version+rule_set_version, 校验器身份与版本, 输入环境摘要, checked_at, 保证范围}；机制做**存在性形态闸**（缺件拒）不验科研对错；历史重放必须用报告自钉版本（SCR-21 三前提） | `CONTRACTS.md` §3/§16.2（报告信封列建议）；Port = 报告信封形态闸 | 负例：三版本各缺一 ⇒ 拒；正例：按钉住版本重放 verdict 可复算 | 否——裁决已定 |
| D4-c | 对外 Check Request 与对内受限 `ValidationReportSubmission` 两立 | #47 SI-60（IF:114）「检查是独立操作，不隐含在写操作中改变对象」、SI-61（IF:115）每次新 report_id；#44 L143「Versioned Validation 的注册/调用接口与最小报告持久化通道」；L136「统一业务授权入口」 | CONTRACTS §16.2 D-22（领域服务仅携单动作 Port，无 UoW）；`G1-RECON-PR47.md` B10；G1-ADM-01（open） | 责任归属缺口 | 两立且同构：对外（Agent/宿主）= Check Request 独立操作（hsr_check_request 形态，对象零变化）；对内（领域校验器）= `ValidationReportSubmission` 单动作 Port——两者都是「交报告」非「写对象」；报告签发资格 = 登记校验器身份（归属账+机制取证，与 §16.2 requiresAuthority 同族）；**科研正式采纳权不进机制**：机制只做不透明业务轴取证（SP-09 两分），采纳权委托与政策属用户/宿主政策面（§4 清单项 1） | `CONTRACTS.md` §16.2（签发归属账成文 + 对外形态映射小节）；Port = `ValidationReportSubmissionPort` 现状 +（G2）工具面 hsr_check_request 注册（走 D6-a 冻结流程） | 正例：外部检查请求产生新报告且对象 revision 不变；负例：经提交 Port 取得写面对象（面锚对拍钉死） | 否——机制面裁决已定；采纳权委托见 §4 |
| D4-d | Domain Validation 四禁：不得重取通用 Kernel/Raw SQL/全权 UoW/解析不可信输入 | #44 L147「任何业务读写都有明确的 SpaceContext/ReadContext」；L136-143 职责表（Kernel 职责与「领域对象私有规则」一栏划界，领域不借机制面后门）；#42 SP-09（DOMAIN:155）写权与业务授权两分 | D-19c 两侧门已闭（CONTRACTS §16 双层写面、G1-DONE-03、`tests/capability-scope.test.ts`）；G1-BIND-02 open（N-1 不可信 resolver 输入边界）；READINESS D-22 行 | PoC 未实现目标（机验门欠账） | 四禁写成规范条款：领域校验/领域服务不得 ① 重取通用 Kernel port（face/writerFor 复用禁止）；② 触 raw SQL（raw 仅 §16.3 守卫面且非领域可达）；③ 拿全权 UoW；④ 把未绑定 resolver 输出当事实输入（输入必须携可信绑定，见 X-7）。机验面 = 既有 face/tx/writer 运行时面锚 + 构造注入白名单 | G1-BIND-02 契约文本（与 `G1-CONTRACT-EVENT-AUTHORITY.md` C-15/C-16 通道纪律同族，本表不重复其文）；Port = 领域服务构造签名白名单 | 负例：领域模块 import internal 通道（既有禁令已钉）+ face 重取新变异各一红；正例：仅经 Port 完成一次完整校验闭环 | 否——裁决已定 |
| D5-a | 迁移前校验清单与打开判据次序的唯一责任者 | #47 T-GAP-09（SD:122）「space_id 没有文法规定…须与 B（底层架构）连同 V1 命名空间一并定，本层不自行发明前缀」；SF §12（SF:154-156）「本层尚未裁决的内容：具体存储引擎、索引与查询计划；序列化后端选型；数据库迁移与运维」；#44 L142「按空间 Schema 迁移协调」（Kernel） | DESIGN F-1（原 B.6/B.7-1「属 #47 决策面」已被否证）；`G1-RECON-PR47.md` C7/C8；G1-DONE-03 已登记判据雏形 | 责任归属缺口（=C7/C8） | 唯一责任者 = **我方 G1 契约**（本表 + `CONTRACTS.md` 打开面小节）写「打开判据次序 + 迁移前校验清单」【**按 R-7 指针化，正文见 RL-4**——「迁移前校验清单 / 打开判据次序」清单本体的**唯一正所 = `G1-CONTRACT-RELOCATION.md` RL-4**，裁决出处 `G1-CONTRACT-RECONCILIATION.md` §10 R-7（领域复审 P2-2，2026-11-01）：旧句原文照抄保留于此、其住所枚举按 R-7 第 1 条以「对象读法」统一并被取代；本行自此只留指针引用（锚点 + 至多一句摘要），**禁止复制清单正文**——复制即第二正源，机验护栏 = EA 夹具 S19（全文 distinct 门名命中 <10 为指针形）】；G2 实施 DDL 与故障注入承接验收；space_id/record_id 文法由 T-GAP-09/10 自认延后交 B（底层架构）⇒ 裁定期文法权同归我方，#47 日后收编走其修订流程。此后禁止再写「属 #47 决策面」（附三纪律） | `CONTRACTS.md` §16.2 打开面新小节（落笔按 R-7 第 2 条指针纪律：只引用 RL-4，不复制清单正文）；Port = 打开期校验序（激活核对先行、零残留，§16.2 先例同型） | 负例：打开判据任两步交换的变异必红（GT 系列先例）；正例：全兼容库一次打开成功 | 否——裁决已定 |
| D5-b | 重定位表 DDL 与版本推进 | #47 T-GAP-09/10（SD:122-123）文法与迁移细节「须与 B（底层架构）连同 V1 命名空间一并定」（T-GAP-10 同型）；#44 L325 per-plugin 存储版本 | DESIGN F-1 更正段；G1-DONE-03（「G2 真库 DDL 迁移+故障注入为最终验收证据」） | 责任归属缺口 | 唯一责任者 = **G2 实施席位**：DDL、重定位账、版本推进全是物理实现；本 G1 只裁契约形状（追加式账本、无物理删、重定位链作为 routeNs 输入）。D-31 ns 迁移的机制内显式通道同批（当前机制无通道=已登记事实） | 无 Proposed 上层文件改动；去向登记 = 清单 G1-DONE-03 行（由条目责任者落）；Port =（G2）迁移协调器 | 本表只登记验收要求：迁移中断 ⇒ 回滚零残留；单 Space 失败不阻断；逐条由 G2 故障注入清单出证据 | 否——裁决已定 |
| D5-c | 迁移/backfill 的落账语义与历史钉住衔接 | #44 L198（Q44）「所有权转移需要受控、可审计、原子切换，并在激活前验证新实现支持所承诺的历史查询与解释版本。首版只承诺重启式升级」；L328 旧解释器句；#42 C11/RPT-01；#47 SF-62「破坏性变更绝不回溯」 | G1-VER-01 open（V1/V2/V3 历史与版本标记）；D-11 行（ledger 无 contract_version）；§16.2 已禁「按当前配置静默重解释历史事件」 | 责任归属缺口 | 迁移/backfill 以**机制事件封闭名单**落账（`G1-CONTRACT-EVENT-AUTHORITY.md` EA-1 机制事件族），显式登记迁移事实、不回写历史行；历史行补 contract_version = **显式修补事件语义**（G1-VER-01 采纳形态）；唯一责任者 = 机制侧（我方契约 + G2 实现），#47 领域侧不承接打开判据 | 同 D5-a/D5-b 去向；Port = 迁移协调器落账入口（机制内部直写通道） | 正例：迁移后按历史钉住版本重放 verdict 不变（C11 重放测试）；负例：按当前配置静默重解释必红 | 否——裁决已定 |
| D6-a | `hsr_*` 工具注册通道 | #47 SI-01（IF:11）「既有 11 个 research_* Agent 工具…全部保持不变」；SI-02（IF:12）「新增任何工具名都是冻结面变更…Frozen-Face-Review…permissions.test.ts 的禁止操作清单同步」；CAT ICX-06（CAT:99）「非契约操作是封闭清单，只有四个…全部只读」、ICX-07（CAT:100）39 名 ≠ 工具平面拓扑 | 本 PoC 不接宿主工具面（READINESS §2.3 宿主权限面未证明）；DESIGN F-2 建议条目 G1-TOOL-01 | 责任归属缺口 | 唯一责任者 = **V1 冻结面流程**（`ARCHITECTURE.md` §7.2 清单 + Frozen-Face-Review 人工标记 + `tests/tools/permissions.test.ts` 同步）；机制侧车不承担工具名注册；采纳 G1-TOOL-01：4 个 ICX-06 只读工具 + 39 个 hsr_* 名的注册与响应形态与 E-01 存在性 oracle（D1-c/D1-d）**同批裁定**，禁止复制 `NAMESPACE_ESCAPE` 拒读即 oracle 形态与 D-12 计数面 | 上层文件不改；G1-TOOL-01 的正式清单条目由清单责任者登记；Port = G2 宿主 Adapter 工具注册面 | 负例：未走冻结面流程出现新工具名 ⇒ permissions.test.ts 红；正例：工具名集合与封闭清单逐等对拍 | 否——裁决已定 |
| D6-b | 新只读工具不得绕过 SpaceContext、不得回显隐藏计数 | #47 ICX-06（CAT:99）「只读形态层自身工件…不是新增业务操作」；SI-36（IF:86）「报告的可见性从被检对象派生」；SI-33（IF:82）恒定响应面三可观察量；`hsr_capabilities_get` 行（CAT:79）「只读，跨空间无关」 | 本 PoC 无工具层（同 D6-a）；D-12 计数面教训在册 | 责任归属缺口 | 新只读工具四条硬约束：① 任何空间内读必携 SpaceContext/ReadContext（#44 L147 同形），禁旁路直读表；② 响应 echo 键集不得含隐藏计数/被屏蔽 detail（SI-14/SF-N-04）；③ 报告读取授权从被检对象派生（SI-36），不开独立特权通道；④ 跨空间只读面（capabilities/rule_registry）不得返回任何 per-space 计数 | 同 D6-a；Port = 工具读实现复用空间内同一判据函数（禁复制逻辑，D-24 读侧同型要求） | 负例：两世界逐字节同形探针挂到工具面（SCR-54 先例）；负例 2：工具旁路读核心表被扫描门禁红 | 否——裁决已定 |
| C1 | 冲突账本 C1：「无权=不存在」完全同形 vs 现状拒读即 oracle | #47 SI-16a③、SI-22a（IF:55/70） | READINESS E-01 行；`tests/events-of-scope.test.ts` | 对外契约矛盾 | 一句话裁决：**采 #47 同形，现状让位；机制内部审计保留真因**（细则见 D1-c） | 见 D1-c | 见 D1-c | 否——裁决已定 |
| C2 | 冲突账本 C2：标识文法排除空间分量 vs 现状 oid 内嵌空间名 | #47 SF-25、SF-26（SF:69-70）、SI-16a | READINESS D-12 行（`OBJ-<space>-<n>`） | 对外契约矛盾 | 一句话裁决：**采 SF-25/26，夹具命名不回迁，正式面文法归我方契约层**（细则见 D1-a） | 见 D1-a | 见 D1-a | 否——裁决已定 |
| C3 | 冲突账本 C3：「时间戳不能充当事务快照边界」vs 现状登记时间≡提交序 | #47 T-GAP-13 前提句（SD:126） | READINESS D-5 行；PLAN §2-G1 ③ | 版本层次混淆 | 一句话裁决：**采 T-GAP-13 前提；D-5「一值两名」判缺陷非契约；三概念分离+映射见 D2-a/D2-b** | 见 D2-a/b | 见 D2-a/b | 否——裁决已定 |
| C4 | 冲突账本 C4：遮蔽计数禁发 + boundary 三键 vs readAsOf 计数回显 | #47 SI-14（IF:46，三键按角色分别裁决）、SI-33、SF-N-04（SF:127） | CONTRACTS §16.3 D-24 读侧段（echo 键集冻结）；READINESS D-12 行 | 对外契约矛盾 | 一句话裁决：**采 SI-14/SF-N-04——hiddenBy* 计数退出调用方 echo 面（键集变更按 §16 流程重登记对拍），exhausted 对可见集如实**；细则见 D1-d | `CONTRACTS.md` §16.3；Port = readAsOf echo 键集 | 隐藏三态同形语料（T-GAP-15）+ 有权计数如实正例 | 否——裁决已定 |
| C5 | 冲突账本 C5：检查器不可用=成功响应+INDETERMINATE 报告 vs 现状抛错不落报告 | #47 SI-23、SCR-11（IF:71/CK:39） | READINESS N-3 行 | 对外契约矛盾 | 一句话裁决：**采 SI-23；抛错不落报告让位；降级边界见 D4-a** | 见 D4-a | 见 D4-a | 否——裁决已定 |
| C6 | 冲突账本 C6：「读侧必须能读所有历史版本」vs 版本墙拒开 | #47 SF-60（SF:114） | CONTRACTS §16.2 版本墙；READINESS D-6 行 | 版本层次混淆（**撤案**：非对外契约矛盾） | 一句话裁决：**撤二选一——两者层次不同（物理打开形态 vs 领域工件钉版可读），并存规则三条见 D3-b** | 见 D3-b | 见 D3-b | 否——裁决已定 |
| C7 | 冲突账本 C7：席位预期「打开判据/重定位 DDL 属 #47 决策面」vs #47 不收口 | #47 T-GAP-09/10（SD:122-123）、SF §12（SF:154-156） | DESIGN B.6/B.7-1（已被附三否证）、F-1 | 责任归属缺口 | 一句话裁决：**归属收回我方（G1 契约文 + G2 验收），#47 无收口义务是条文原话；见 D5-a/D5-b** | 见 D5-a/b | 见 D5-a/b | 否——裁决已定 |
| C8 | 冲突账本 C8：「迁移前校验清单属 #47 决策面」vs #47 不收口该面 | #47 T-GAP-10（SD:123）「须与 B（底层架构）连同 V1 命名空间一并定，本层不自行发明」（T-GAP-09 同型）；SD §6（SD:154）「以上均不属于本层职责」 | DESIGN B.7-1 | 责任归属缺口（C7 同根） | 一句话裁决：**同 C7：唯一责任者=我方 G1；条文中「B（底层架构）」即本 PoC 线，闭环由 D5-a 落地** | 见 D5-a | 见 D5-a | 否——裁决已定 |
| X-1 | 永久幂等键 | #47 SI-41（IF:93）「幂等键是四元组 (actor_ref, space_id, operation, client_request_id)…同一键的重复请求必须返回首次结果且不产生第二条记录/第二个修订」+ §5 测试预期「把窗口配置调小后重放，仍必须返回首次结果且零新记录」；SD-14（SD:24） | `G1-RECON-PR47.md` §8.6（SI-40/41/42/43 判「与本 PoC 无对应面」） | 责任归属缺口 | 幂等层唯一责任者 = **接口/宿主工具面（我方契约层），不进机制存储语义**：机制外账本存四元组键 + 首次请求体摘要，**永久保存非窗口化**；修订类的 space_id 分量取可信上下文注入值（SI-16a 通道）后参与构键 | `CONTRACTS.md` 接口面新节 / G2 Adapter 契约；Port = 工具写操作装配层（先幂等、后机制） | 正例：同键重放 3 次仅 1 修订；负例：同键不同体拒且零记录、跨空间同名键互不干扰、调小窗口仍返回首次结果 | 否——裁决已定 |
| X-2 | 请求体摘要与规范字节 | #47 SI-41「首次请求体的规范字节摘要（SF-50）随键一并保存」；SF-52a（SF:107）「摘要域必须显式，禁止自引用」 | 同上（本 PoC 无规范序列化面，HCF 不在本仓） | 责任归属缺口 | 规范字节形态与摘要算法唯一责任者 = **#47 HCF 层**（SF-50/52/52a 是其文）；本仓幂等账本只存不透明 {alg, hex} 并做等值比较，**不重算摘要**；冲突拒绝按 blob 原文码 `IDEMPOTENCY_KEY_REUSED` 只进工具 detail（附录 A 的「IDEMPOTENCY_BODY_MISMATCH」名不符 blob，见附录勘误） | 本仓无 Proposed 文件改动（存不透明值即可）；Port = 幂等账本列 | 负例：体字节不同同键 ⇒ 拒且零记录；正例：重试摘要一致 ⇒ 首次结果回 | 否——裁决已定 |
| X-3 | 乐观并发前置（expected_head_revision） | #47 SI-42（IF:94）「修订类写入必须携带 expected_head_revision；不匹配 → 拒绝写入，不产生记录」；A-01（SD:48）F-PRECONDITION-REVISION **回写请求未决** | `G1-RECON-PR47.md` §8.6（SI-42 无对应面）；CONTRACTS §4 修订纪律 | PoC 未实现目标 | 机制侧补前置核对：revise 入口携 expected head，不匹配 ⇒ 拒写零残留；对外失败码在 A-01 落契约层前维持 **SI-24 暂态**（`TOOL_INPUT + detail.precondition`），**本仓不自造 `F-*` 码**（SI-20 禁本层新增） | `CONTRACTS.md` §4/§16.2；Port = revise/命令 Port 前置参数 | 负例：前置不符拒写且无记录、last-write-wins 变异红；正例：相符追加成功 | 否——裁决已定 |
| X-4 | Q40 单 Space 跨领域原子事务 | #44 L242（Q40）「一次原子提交：领域权威状态/事件、Directory、H Ledger、Change Journal 全成或全回滚。未提交的 ID 对其他事务不可见」；L246（长事务禁令） | CONTRACTS §16 双层写面；G1-DONE-03 **done**（ST-3/ST-6 [实测]、`tests/capability-scope.test.ts`） | 责任归属缺口（已闭合） | 维持闭合裁决：协调方只暂存不写、各写点过拥有者 Port 判据、跨 Space 一律禁；**不重开 Q40**，本行仅作闭合登记与条文对账 | —（无改动；清单 G1-DONE-03 为登记位） | 既有验收保留：回滚零残留 + 未提交不可见 | 否——裁决已定 |
| X-5 | Application 只有跨领域事务协调权（Capability-scoped Storage Port ≠ Domain Command Port） | #44 L112「跨域 Use-case 及事务协调，非中心业务规则」；L136-137 职责表（跨域用例归 application）；L242（Q40 暂存形态） | §15 G1-a；G1-OWN-02 open；DESIGN A 节（挂载登记前提）；`G1-CONTRACT-EVENT-AUTHORITY.md` §4.1 FactDesignationCommandPort 同族 | 责任归属缺口 | 三条定死：① 协调方（Application/UoWImpl）**不持有通用写面**；② **Capability-scoped Storage Port（NamespaceWriter，ns 自有行的物理写通道）≠ Domain Command Port（业务动作唯一权威入口，如 appendAuthoritativeEvent/拥有者命令 Port）**——写他人核心对象的合法路径只有后者（或 Facet 挂载登记，另席）；③ 机验 = 静态集合等值：跨归属写点 == 命令 Port 调用点（G1-OWN-02 evidence 形态） | `CONTRACTS.md` §16（术语对定义 + 静态等值门）；权威条文面 = `G1-CONTRACT-EVENT-AUTHORITY.md`（本表只登记指针，不重复其文） | 正例：Q45 Facet 护栏保持绿；负例：协调方直写他人 ns 红、命令 Port 调用点未入等值集红 | 否——裁决已定 |
| X-6 | 历史记录版本钉住与解释器责任 | #44 L175「最新 Revision 的语义与解释器版本由领域所有者负责」；L328 旧解释器句；#42 C11；#47 SF-63/SCR-03 钉版 | G1-VER-01 open；D-11 行；§16.2 投影信任模型已禁静默重解释 | PoC 未实现目标 | 责任三分：报告/记录**自携版本**（形态闸）；解释器保留 = 领域所有者（能力包保留历史解释器或声明能力缺失并如实标注）；机制责任 = 截点一致提供原始字节 + 不重解释。ledger 补 contract_version 与 D-11 同批（G1-VER-01 采纳形态，显式修补见 D5-c） | `CONTRACTS.md` §16.2；Port = ledger 行版本列（G2 DDL） | 正例：钉版重放同 verdict；负例：按当前配置重解释历史红 | 否——机制面裁决已定；V1 接管范围见 §4 |
| X-7 | resolver 可信绑定与覆盖范围 | #44 L175「引用解析先做空间/可见性控制，再提供审计与呈现结果（RD-26、RD-34）」；L147；#47 SI-16a「可信调用上下文（与注入的主体、run_id 同一信任级）」、T-GAP-11（SD:124，SI-16a 残余两项） | READINESS D-9 行（只有形状没有绑定）；G1-BIND-01/02；`G1-RECON-PR47.md` B8（未绑定 resolver=新 oracle） | 责任归属缺口 | 唯一责任者 = **装配根声明 + 宿主供证**：装配根声明 resolver 数据范围与信任级，机制核形状与装配声明、**不核内容**（G0「装配根注入 ≠ 宿主真实性」边界延续，G2 最小装配冒烟补证）；覆盖约束：**空视图 ≠ 完整视图**——registeredEdges 必须携完备性凭证（全量声明或显式 INCOMPLETE），无凭证 = 输入不可用（fail-closed） | G1-BIND-01 契约文本；Port = resolver 装配签名 + 输入信封（EVENT-AUTHORITY C-15/C-16 同族） | 负例：resolver 越声明范围读他空间事实红；负例 2：空 edges 无完备凭证被判不可用；正例：声明范围内正常消费 | 否——裁决已定 |
| X-8 | V1–V3 首版历史分离，仅显式跨平面引用 | #47 SD-07（SD:17）「HSR 记录的追加式存储由本层定义，与 V1 历史事件面的合一暂不裁决」；SF-28（SF:72）「跨平面引用是唯一被许可的 HSR↔V1 连接形态，且只能在 HSR 侧登记」；SS-15（OBJ:53）「external_citations[] 只能出现在信封，不得进入 payload 的任何端点/参与者/正式声明槽位」；T-GAP-14（SD:127） | G1-VER-01 open；DESIGN C.7-3（不允许为统一命名重写既有 History Ledger） | 版本层次混淆 | 首版分离定为规范条款：V3 侧车历史与 V1 事件面**不合一、不互推**；连接仅 HSR 侧 `external_citations[]` 显式登记（SS-15：不进 payload、不参身份、不隐含存在）；V1→HSR 过渡期不可达（A-09 不对称接受为事实）；事件面跨平面禁混名（EVENT-AUTHORITY 封闭名单承接） | 上层文件不改；`CONTRACTS.md` 维持同向（C.7-3 已有）；Port = 无 | 负例（#47 层）：external_citations 入 payload 拒；本仓侧：事件名跨平面出现红 | **是**——V1 历史接管/切换范围属用户决策（§4 项 2）；首版分离与连接形态本身已定 |
| X-9 | SS-15a 身份判定单位（规范引用位）的采纳与本仓登记 | #47 SS-15a（OBJ:54）「身份判定单位统一为『契约点名的引用位』…identity_slots[]、identity_slot_exemptions[].slot、identity_slot_set_digest 的输入必须使用同一形态」「采纳状态（2026-10-29 用户确认）」；确认记录 = 提交 `8f2795b`（见 §3）——**★ 本列权威来源由专题⑤就地更正（2026-11-01；引文与旧登记一律保留不删）：技术方案采纳 = 本轮技术裁决（架构审查者授权范围内）；git 历史中的 `8f2795b` 提交信息仅作为「该提案曾登记」的证据，不足以独立证明用户明确批准该具体条款**——commit message 不是用户批准文书，「曾登记」与「已批准」是两面（本表纪律原文：登记与批准分离，同 `EA-2.4` 步骤 2 与 R-5「提案文书≠批准」）。**裁决内容（本行右三列的方案）照旧采纳，改的只是「凭什么算已定」** | `G1-RECON-PR47.md` §8.6（曾判「本仓内无法定位对应裁定记录」——本轮溯源**更正**，见 §3）；本表 §3 为本仓主线登记位 | 责任归属缺口（裁定记录面缺口，非裁定本身） | 采纳为基础规则（既有用户裁决，按纪律不再开放）——**★ 权威来源更正（专题⑤）：依据是本轮技术裁决，不是「既有用户裁决」；方案本身一字不改**：父槽位不得自动替代规范引用位；identity_slots/豁免/摘要使用同一引用位名形态（契约点名子路径用子路径，如 `world_membership.individual_ref`）；digest 输入 = 去重排序引用位名序列；改 `kind_ref` 不构成身份变化 | 上层不改；本表 §3 = 本仓主线登记位；后续实现（含底层架构 B）可直接引用 | 复验义务：吸收该规则的实现批必须带上 #47 层已钉的 P2-03b/P2-14/P2-18 形态复跑 | 否——**本轮技术裁决**直接采纳（旧口径「既有用户裁决」的权威来源不成立，见本行第 3 列；本席位仅改本行，§3 溯源专节与 §4.2 项 1 的「既有用户裁决」措辞不在本席位允许改面内，残留矛盾以本行为准） |

## 3. `SS-15a` 溯源专节

**问题**：#47 `H_S_R_OBJECT_SCHEMA_DRAFT.md:54` 的 SS-15a 末段声称「采纳状态（2026-10-29 用户确认）」并援引 `poc/hsr-form/FINDINGS-poc2.md`；`G1-RECON-PR47.md` §8.6 判「该用户确认发生于 #47 侧上下文，**本仓内无法定位对应裁定记录**」，并要求若 G1 拟以 SS-15a 为输入须由用户另行再认一次。本席位实际查过的路径与结论：

| 查证动作（本席位实测） | 结果 |
| --- | --- |
| `git log --all --oneline -S "SS-15a"` | 命中 `e84524d`（2026-10-29 16:39，「docs(architecture): PoC-1 暴露的两处未定项收口（SS-15a）」——SS-15a 的新增提交，分支 `design/hsr-schema-interface-20261029`）、`b92f1e7`、`da113bc`、`cd79fce`、`a738136` |
| `git log --all -S "采纳状态" -- docs/architecture/H_S_R_OBJECT_SCHEMA_DRAFT.md` | 命中 `8f2795b`（2026-10-29 20:48，「docs(architecture): 把 PoC 第二轮暴露的三处判据粒度补到可实现层面」），其 commit message 逐字含「**SS-15a：登记用户 2026-10-29 的采纳确认**——规范引用位作为身份比较单位确立为基础规则，可直接作为后续实现输入；同时登记受影响判据集，不隐藏单点故障」 |
| SS-15a 末段 blob 原文（`git show 37de107ed5:docs/architecture/H_S_R_OBJECT_SCHEMA_DRAFT.md` L54） | 「采纳状态（2026-10-29 用户确认）」句与「可直接作为后续实现（含底层架构 B）的输入」逐字在文 |
| `poc/hsr-form/FINDINGS-poc2.md` 是否存在于本仓 | **存在**：分支 `poc/hsr-schema-validator-20261101`（本地+origin），由 `da113bc`（2026-10-29 16:56）引入、`b92f1e7` 扩充；其「父代理复核纠正」节逐条以 SS-15a 裁决 F-1/F-2/F-3/F-4，「诚实记账」节明写「修改的正确性依赖 SS-15a 那条新裁决本身成立…这正是要请审查确认的点」 |
| 祖先关系 | `8f2795b` **是** #47 head `37de107ed5` 的祖先；**不是** 当前分支 HEAD（`d2f19cc16f`）的祖先，也**不是** `origin/main` 的祖先；`da113bc` 所在分支与 #47 支系无祖先关系 |
| 本仓主线（main / HEAD 工作树）登记位 | grep `SS-15a|hsr-form|FINDINGS-poc2` 于 HEAD 工作树：仅 #47 的 `.scratch/pr47` 取文副本、`G1-RECON-PR47.md` 的「待溯源」告警与本文件 ⇒ **主线文档零登记** |

**结论**：SS-15a 的「2026-10-29 用户确认」**在本仓 git 历史可定位**——裁定记录 = #47 支系提交 `8f2795b` 的 commit message（仓库同一作者的提交），支撑工件 `poc/hsr-form/FINDINGS-poc2.md` 在本仓另一分支；**不是无中生有的宣称**。`G1-RECON-PR47.md` 的「无法定位」在「主线工作树无登记」口径下为真，在「全 git 历史」口径下被本席位实测**更正**。处置：① 按任务纪律，该既有用户裁决**直接采纳**、不再列为开放问题（X-9），`G1-RECON-PR47.md` §8.6 的「另行再认一次」要求由本节溯源关闭（同一仓、同一作者、明示登记，再认无信息增量）；② 残余事实如实登记：确认记录只存在于 #47 支系的 commit message 与 Proposed 文本，不在批准 Q 表（ASSESSMENT §8.1 的 Q1–Q45）内——**本表即 G1 侧登记位**，若未来 #47 被修订需重查该段措辞。

【**2026-11-01 交叉收编席口径同步（任务点 6；本表在我席允许改面内；上面整段原文保留不删，只作就地取代）**：
本段与上表各行把 `8f2795b` 说成「既有用户裁决／裁定记录」的**权威来源**口径，**已被本表 X-9 行的
★ 就地更正（专题⑤）取代**，两侧同步为一致口径，以 **X-9 行为准**：
① **方案内容一字不改**——父槽位不自动替代规范引用位、identity_slots/豁免/digest 同形态引用位名、
   改 `kind_ref` 不构成身份变化，仍**直接采纳**为基础规则、不再列为开放问题；
② **变的只是「凭什么算已定」**——技术方案采纳 = **本轮技术裁决**（架构审查者授权范围内），
   **不是**「既有用户裁决」；`8f2795b` 的 commit message 只是「**该提案曾登记**」的证据，
   commit message 不是用户批准文书（「曾登记」与「已批准」是两面——本表纪律：登记与批准分离，
   同 `EA-2.4` 步骤 2 与对账台账 R-5「提案文书 ≠ 批准」）；
③ 本节「溯源」的**取证结论本身不撤回**（git 历史可定位、非无中生有，①② 两项登记事实照旧成立）——
   被更正的是把取证结果**升格为批准文书**的读法；
④ 与 X-9 行残留矛盾的收口：X-9 行第 3 列原注「§3 溯源专节与 §4.2 项 1 的『既有用户裁决』措辞不在
   本席位允许改面内，残留矛盾以本行为准」——**该残留自本注起消除**（本席获准改本表，已按 X-9 口径
   同步；X-9 行原文不删，其「以本行为准」自此与本注同义）。X-8 行与 `G1-CONTRACT-IDENTITY-GRAMMAR.md`
   G-11 行仍写「SS-15a X-9 已按既有用户裁决采纳」——彼为**他席禁改面**，权威口径以 X-9 行 + 本注为准，
   差异如实登记不代改（IG 侧回填义务随 §7-类清单入矩阵 §4 交叉收编行）。】

## 4. 分类汇总与「真·用户决策」清单

### 4.1 分类计数（主表 39 行，按行计；C 类行与 D 类行是同一裁决的「冲突账本视角/议题视角」两个记账面）

| 分类 | 行数 | 行号 |
| --- | --- | --- |
| 对外契约矛盾 | 7 | D1-a、D1-c、D4-a、C1、C2、C4、C5 |
| PoC 未实现目标 | 9 | D1-d、D2-c、D2-d、D2-e、D2-f、D4-b、D4-d、X-3、X-6 |
| 版本层次混淆 | 7 | D2-a、D2-b、D3-a、D3-b、C3、C6、X-8 |
| 责任归属缺口 | 16 | D1-b、D3-c、D4-c、D5-a、D5-b、D5-c、D6-a、D6-b、C7、C8、X-1、X-2、X-4、X-5、X-7、X-9 |
| **合计** | **39** | — |

注：C6 已由「对外契约矛盾」**改类**为版本层次混淆（撤案，D3-b）；改类不改变任何行在 `G1-RECON-PR47.md` 冲突台账中的记账地位（该台账不动，本表为裁决面）。

### 4.2 真·用户决策清单（全表 39 行中判「是」的仅 X-8 一行；D4-c/X-6 的机制面已裁、仅权柄归属指向本节；其余一律「裁决已定」）

1. **科研正式采纳权的委托与政策**——机制只做不透明业务轴取证（SP-09/#44 L136），「谁/哪个政策行使最终科研采纳、如何委托」属用户/宿主政策面（清单 `G1-ADM-01` 的权威面）。本表已裁机制形状，未裁权柄归属。
2. **V1 历史接管范围**——#47 SD-07/T-GAP-14 明写「暂不裁决/未定」，该面本就是用户/上层决策（清单 `G1-VER-01` 的权威面）。本表裁的是 V3 首版隔离与连接形态（X-8/D5-c），不代裁 V1 接管。
3. **G1 冻结、Current 代次生效与 G2 开工授权**——放行谓词（`--require-clear` exit 0）满足后的授权动作本身；本表与任何席位不得自宣放行。

除上述三项外，本表 39 行**无其余用户决策项**。EN-W-7、EN-W-11、EN-EX-1/2、SS-15a、AR-ID-6 等「2026-10-29 用户确认/2026-10-30 联合审查收口」类既有条文一律**按既有裁决直接采纳**，本表未将其重开。【**2026-11-01 交叉收编席就地取代标注（任务点 6；旧句保留不删）**：本句中 **SS-15a 的权威来源**已按 X-9 行 ★ 更正同步——其采纳依据 = **本轮技术裁决**（方案内容一字不改、仍直接采纳、不重开），`8f2795b` commit message 仅证「曾登记」不证「已批准」（详见 §3 溯源专节末的口径同步注，两句同口径）；**其余各项（EN-W-7/EN-W-11/EN-EX-1/2/AR-ID-6）的「按既有裁决直接采纳」地位不变**，本注不扩大射程。】

## 5. Q1–Q45 纪律声明

**本表未重新提问任何已批准的 Q1–Q45**：全表引用的 Q 编号（Q22/Q24/Q30-33/Q35/Q39/Q40/Q41/Q42/Q44/Q45 等）一律出现在「已裁定权威」位置（#44 L47/L147/L242/L293/L302/L325 等原文标注）。逐条复核未发现与任何 Q 裁定的真冲突——最接近的一次（C6 表面违反 Q32/Q44 的「显式迁移+受控移交」两步裁定）经 §2.1 D3-b 核验为**版本层次混淆非矛盾**，两步裁定原文（#44 L198「所有权转移需要受控、可审计、原子切换…首版只承诺重启式升级」）与本表裁决一致，无需引用为冲突。

## 附录勘误（本席位 blob 实测 vs 附录 A；附录正文按纪律原文保留不删）

| 附录条目 | blob 实测（head `37de107e`/`5ec38974fc`） | 处置 |
| --- | --- | --- |
| A4「SF-36『所有时间比较与截点都基于登记序（record sequence），墙上时钟只做展示与过滤』」 | **#47 SF 文件无 SF-36**；时间规则实为 SF-30/31/32（SF:87-89），「record sequence」词形全文件不存在 | 正文不引；D2 各条改用 T-GAP-13/L161-167/SI-13/14/51 原文 |
| A4「SF-33 登记时间服务端产生；SF-39 禁时区字符串」 | SF-33/SF-39 无此行号规则；「登记时间由系统产生」实在 **SI-10**（IF:31「调用方自报的 recorded_at（登记时间由系统产生）」列入禁止清单） | 正文引 SI-10 |
| A4「SD-22 A-03＝SI-40/SI-41 双轨→SI-41 权威」「A-05＝SI-70 缺省值语义」「A-06＝SCR-30 与 SF-N-03 冲突」「A-01…A-07」 | blob 的 A 行：A-01=F-PRECONDITION-REVISION（对）、**A-03=WITHHELD 永不落盘**、A-04=时间精度标注、**A-05=`@rev#representation` 生命周期**、A-06=described_interval 开区间、且至少到 A-09（V1 侧不可达） | 正文只引亲核过的 A-01/A-03(按实际内容)/A-09；A 系列全表以 SD §5 blob 为准 |
| A4「`IDEMPOTENCY_BODY_MISMATCH` 只进工具 detail」 | blob SI-41 原文为「`TOOL_INPUT` + detail{serviceCode:**IDEMPOTENCY_KEY_REUSED**}」 | 正文按 blob 码名（X-2） |
| A2/A4「SF-20『标识符不承载内容语义：不得由内容哈希派生（SD-05），不得编码类型、关系、角色』」 | 该句是**转述非逐字**；SF-20 原文＝「不透明字符串（长度上限 64 字符…由登记方在创建时分配…）禁止内容寻址身份…摘要可以算，但不充当身份」；「不得编码语义」的逐字近似在 SF-26（前缀）与 SF-30（时间） | 正文引 SF-20 逐字短句 + SF-25/26 |
| A1/A4「CommitSequence 属我方命名」（前席「零命中」实测） | CamelCase `CommitSequence` 命中 **#44 L161**（ReadContext 类型名）与 #47 T-GAP-13；蛇形 `commit_sequence` 才零命中 | 正文 §2.0 按实测精确声明（CommitSequence=承自 #44；commit_sequence/storage_schema_version=我方新命名） |

---
## 附录A · 取证素材（前一席位逐字摘录区——**保留不删**；与 blob 出入见前面「附录勘误」，本区正文一字未动）

### A1 · #44 V3_CODE_ARCHITECTURE_DRAFT.md @5ec38974fc（已全文读，429 行）
- L47 [已裁定，Q11–Q20] 「Mechanism Kernel + Versioned Domain Plugins + Typed Capability Ports + Application Use-cases + Product Profiles + Host Adapters。」/「插件可演化，但其历史解释契约不可被静默覆盖。」
- L112 application/ 行「跨域 Use-case 及事务协调，非中心业务规则」
- L136-143 Kernel 职责表：「Principal、ResearchSpace 访问验证、SpaceContext、统一业务授权入口」；「单 Space 原子 Unit-of-Work 与受约束的 Storage Port」；「History Ledger：不可变登记序、记录提交和历史截点元信息」；「Object Directory：ObjectID、固定 Space/Kind、逻辑 Capability 路由及唯一权威标识」；「Change Journal：与权威写入同事务的技术性变更通知」；「Versioned Validation 的注册/调用接口与最小报告持久化通道」
- L147 [已裁定 Q23/Q24/Q30-33/Q41] 「任何业务读写都有明确的 SpaceContext/ReadContext」「权限校验先于对象解析，不能借猜测对象 ID 获知其他空间对象存在与否。」
- L161-162 ReadContext 字段：`recordedAsOf?: CommitSequence; // H 登记知识截点`、`describedAtOrDuring?: TimePredicate`
- L167 「先按 recorded_as_of 过滤可见登记，再按 described_at/during 过滤所描述时间」「迟到登记不可追溯变成过去已登记」「过去的读取截点不授权今天的访问。」
- L171-175 Directory：「ObjectID → {space, object_kind, owner CapabilityID} 等最小身份路由信息」「对象 kind 和 space 创建即不可变（PR #42 RD-01）」；L175「Directory 不索引私有对象详情，也不得泄漏跨空间空间 ID、存在性、计数或路由错误差异。引用解析先做空间/可见性控制，再提供审计与呈现结果（RD-26、RD-34）。」
- L176 「对象的暂存 ID 可供同一事务内部相互引用，未提交前不得向其他事务显示为已登记。」
- L198 [Q44]「Capability 指定对象的唯一权威修改接口……所有权转移需要受控、可审计、原子切换，并在激活前验证新实现支持所承诺的历史查询与解释版本。首版只承诺重启式升级，不做在线热迁移。」
- L206 [Q45]「禁止平行复制」RD-15/RD-37/XC-28
- L235 [Q37] Domain Admission「对象可在 S-L1 未达成但已可解析时登记：结构缺陷留报告，不能将未达成说成 PASS（PR #42 IC-S1/RPT-00）。」
- L238 「有空间写权、缺少正式科研接纳授权的主体可保存未生效声明，但不能使 FactStanding 改变；无空间写权则完全拒绝写入（RD-27、PR-A1）。」
- L242 [Q40] 「允许在一个事务中预分配 ID、暂存多个拥有者各自的数据……一次原子提交：领域权威状态/事件、Directory、H Ledger、Change Journal 全成或全回滚。未提交的 ID 对其他事务不可见。」
- L246 「外部网络调用、形式化证明、长时间科学计算及 Agent 调度不得位于有界 DB 写事务中；事务外运行的校验结果在提交时核对输入版本或标注过期」
- L282 [Q22]「不得压缩八条状态轴为全局真值或可靠性分数」
- L293 [Q39]「检查报告绑定精确 Revision/Representation、规则/Schema/Scheme 及校验器版本、输入环境、执行时间、实际保证范围；重检产生新报告，旧 PASS 不改写（C11）。」
- L295 「报告结构合法性、declared_gaps（语义完备性）和 INDETERMINATE（无法判定）三条线相互独立（RD-25）。」
- L297 「混合检查项的领域层 verdict 遵循已裁定的『FAIL 优先，否则 INDETERMINATE』归约规则（RD-14/RD-38）」
- L298 「权限不足的调用者不得通过 REF_UNRESOLVED 与 WITHHELD_REFERENCE、verdict 差异、精确计数或响应差异探测跨空间对象；对外使用 UNVERIFIABLE_REFERENCE / UNVERIFIABLE_TO_YOU 等脱敏表达（RD-26/RD-34）。」
- L302 [Q42]「FactStanding 等具有正式业务含义的视图必须对 ReadContext 截点一致……不能用无水位的异步缓存替代。」
- L325 [Q14/15/18/31/32/44/45]「至少分开：Host 代码版本、Capability 契约版本、每 Space 每插件存储 Schema 版本、历史科研语义/校验规则版本，以及各对象 Revision」「派生索引水位不是科学历史版本。」
- L327-328「单个 Space 迁移失败不阻断其他 Space」「结构迁移与科学语义迁移分离，普通加载不能静默改写历史语义；旧解释器不可用时保留原始记录与版本身份并如实标注能力缺失，不套用新规则冒充旧解释。」
- L331 「可信同进程插件和重启式代码升级是首版边界；不实施在线热切换或沙箱多版本并行运行。」
- L314-320 §10：「DSH Adapter 属正式 Product Profile 的必需装配，但业务插件不得 import DSH 或 Team 私有实现」「Agent Team 仍是执行控制权威」「Agent 不可因拥有执行权限而自动获得科研接受、语义确认或其他科研写入权限；以 Research Control 经校验的 Principal/授权上下文为准。」
- L342 故障表「资源/检查器不可用 | 保留源资料与旧报告，新检查 INDETERMINATE，不改写 PASS 或判科研结论假」
- L348 「Kernel 权威 SQLite 损坏 | 权威数据操作 fail-loud，不拿宽容科研外部文件缺失掩盖 DB 损坏」
- L364 检验7 「T3 补录声称 T1 发生的事件，T2 as-recorded 不能看见」
- L419-426 「实施前必须以 PoC/契约验证的四处边界」1 Ledger/Journal 唯一事件真源 2 拆包唯一所有者 3 不可区分无侧信道 4 校验器/FactStanding/Impact 水位

### A2 · #42 @0369c3196c 已读文件
#### H_S_R_DOMAIN_FOUNDATIONS_DRAFT.md（身份/时间/隔离核心）
- ID-01 「object_kind ∈ {ENTITY, CONCEPT, ASSOCIATION, ARGUMENTATION, PROPOSITION} 在创建时固定且永不可变；改变 kind 意味着登记另一个对象。」
- ID-02 「每个对象归属唯一 space_id（ResearchSpace），创建时固定且不可变。不存在跨空间迁移，也不存在共享实体副本。」
- ID-04 精确引用「object_id@revision_id 一旦写入某记录，永不被后续修订重新解析或漂移」；ID-05 逻辑引用禁止出现在「论证输入、结论、评价、接纳、检查结果或任何正式声明中」
- ID-08 记录标识不获对象身份
- UN-01 「UNKNOWN 不是否定……不得把 UNKNOWN 呈现或转换为 FALSE、REFUTED 或无相关记录」；UN-05 「WITHHELD，与 ABSENT、UNKNOWN、UNRESOLVED 互不相同；不得把 WITHHELD 报告为不存在」；UN-06 如实声明 UNKNOWN 永远不是规范化障碍（RPT-05）
- T-01 四类时间「任何当前状态查询必须声明使用哪一类时间以及历史截点（as_of），否则该查询视为未定义」；T-02 晚到登记 as_of=T2 不得视为已知；T-05 「历史重建需要两个独立时间条件，一个截点不够」「缺 recorded_as_of 默认当前但必须在结果中回显该默认」（IC-H6）
- RV-03 「修订不得改写历史检查报告、历史评价或历史接纳：它们锚定旧修订，新修订的检查是新报告（C11）」
- RV-06 判不了就不决定 INTERPRETATION_DIVERGENCE
- SP-01 全路径空间授权过滤；SP-02 「WITHHELD 与 UNRESOLVED 的判定次序固定：先做空间/权限过滤……无法区分二者时按 WITHHELD 处理（保守侧）」；SP-03 计数只在有权时给出、无权者 NOT_DISCLOSED；SP-05 跨空间只能显式导出/导入新建对象；SP-07 「无权调用者不得通过精确计数、错误码差异、响应时延、排序位置、缓存命中或总数减去可见数推断……『不存在』与『无权可见』必须呈现为同一个不可区分结果……sanitize() 把 REF_UNRESOLVED 与 WITHHELD_REFERENCE 合并为 UNVERIFIABLE_REFERENCE（RPT-09/RPT-10）」；SP-08 屏蔽项只能 INDETERMINATE(WITHHELD_REFERENCE)；SP-09 (a) 未生效声明 AUTHORITY_UNVERIFIED (b) 无写权拒绝写入；SP-10 审计真源唯一+呈现脱敏
- DF-06 「历史检查、评价与接纳锚定旧修订；新规则只产生新报告。」
- N-01 「文中字段名（如 recorded_at）是领域阅读名，不是冻结的 Schema 键名、数据库列名或类型字段。」
#### H_S_R_INTERACTION_CONTRACT_DRAFT.md
- IC-01 「每个写操作的效果 = 追加……不存在就地改写已登记内容的合法操作」；IC-03 检查是读侧派生
- 1.0 两视图表：审计视图 vs 呈现视图「sanitize() 之后：两者合并为 UNVERIFIABLE_REFERENCE、coverage → NOT_DISCLOSED、无计数无标识」；「否则一个猜测 ID 就能靠规范化结果的差异反推他空间是否存在该对象（XC-25）」
- F-CHECK-UNAVAILABLE 「检查器/资源/时间不可用（超时、缺文件、崩溃）| 相关项 INDETERMINATE(CHECKER_UNAVAILABLE)，层级 INDETERMINATE；绝不转为科学否定或检查未通过＝结论为假」
- F-DENIED-AUTH / F-DENIED-WRITE（对应 SP-09）
- IC-H6 输入含两个独立时间条件、视角、版本选择 ∈ {at-revision, chain-at, as-declared-by}；「先按 recorded_as_of 过滤可见记录，再按 described_* 过滤对象时间，两步顺序不得交换或合并」
- IC-S1 前置「可解析」；结果「对象 + 事件 + 首轮报告（verdict + FAIL 项 + declared_gaps）」；「如实声明的未知不阻止达成（RPT-05）」；失败 `F-SCHEMA-INVALID` → 转 IC-H3；IC-S2 「报告不可被后续重检改写（C11）；S-L1 PASS ≠ 原意被确认 ≠ 正确」
- IC-R9 接纳「designator、authority_basis、目标命题@rev……授权可校验 → 参与投影；不可校验 → 保存并标 AUTHORITY_UNVERIFIED（PR-A1）」
- §7 明确不存在的行为（含「自动重算并覆盖历史 PASS」「自动向无写权限的空间写入未生效声明」）
#### H_S_R_FIVE_OBJECT_ARCHITECTURE_DRAFT.md
- L44 「FactDesignation：有授权主体对精确命题作出的正式接纳/撤销陈述；FactStanding 是历史重建的状态投影」
- L65 「精确版本不自动漂移；新校验规则生成新报告，不改写过去的 PASS。缺失、未知、截断及权限不可访问不转成科学否定」
- L23 AssertionID 移至 H；L33 「不建立第四个科研认识系统，也不建立万能 ResearchObject 类」
#### H_S_R_SYSTEM_CONTRACTS_DRAFT.md
- L23 「H 保留 occurred_at（声称的发生时间）与 recorded_at（系统登记时间），还需稳定的登记顺序/序列……晚到材料若声称 T1 发生，但 T3 才录入，则 T2 as-recorded 查询不能把它算作 T2 已知。」
- R5「当 C 被质疑……不能自动把 E1 相关结论删除」；R6「机器的 verification PASS 不自动变成 FactDesignation」
- 交叉核验「对象版本固定……Concept/World/Scope 版本不可使用 latest 隐式替换」
#### H_S_R_TOP_LEVEL_ARCHITECTURE_DRAFT.md
- X2「修订、补录、撤回和争议采用新记录；旧原文及精确版本可回放」；X3 精确引用；X7「不同 ResearchSpace 的数据不能互相访问」；X8「L1 语义确认、科学接纳及正式科研决定各有可归因主体；结构检查不自动替代其裁决」
- §2.1 「区分登记顺序、声称发生时间（occurredAt）与记录时间（recordedAt）；处理迟到登记、补写笔记、乱序导入」
#### H_S_R_OBJECT_MAPPING_DRAFT.md / V1_LEXICON_RECONCILIATION_DRAFT.md
- 归属判据表；ResearchSpace=「横切的隔离/访问命名空间」；V1-01~04；lossReport「报告缺失或静默丢弃即视为迁移不合格」；「V1 时间语义无法区分所描述时间 / 登记时间的记录（不得静默择一）」

#### H_S_R_DECISIONS_AND_GAPS_DRAFT.md（RD-01…RD-38 正源，L39-76）
- RD-01 「object_kind 与 space_id 创建即固定且不可变；不存在 kind 迁移或跨空间迁移」
- RD-02 五态；RD-03 「时间拆为 recorded_at / claimed_time / described_interval / adoption_at 四类」
- RD-04 八轴互不可推导；RD-05 「正式声明位置……只允许精确引用」
- RD-06 修订/新建统一判据 G-REV「身份判据优先于补全规则」；RD-07 表示附着于 PropositionRevision
- RD-14 「检查器/资源/时间不可用记 INDETERMINATE(CHECKER_UNAVAILABLE)，永不折算为 FAIL 或科学否定」
- RD-15 PROV 来源关系只登记一次；RD-16 「未登记依赖、未展开遍历、被过滤与被屏蔽范围必须作为边界事实呈现」（R2 修订：屏蔽范围只给粒度受限标注）
- RD-18 「跨 ResearchSpace 复用只能显式导出/导入并在目标空间新建对象（voice = IMPORTED），不存在活着的跨空间引用」
- RD-19 接纳投影与归因查询只在单空间内有意义
- RD-20 H 记录/检查报告/采用记录不是关联端点或论证输入端点
- RD-22 「全套文档禁止裸 L0/L1」；RD-23 Concept 软区 CHANGED+同 ID 修订与 PR-ID-4 不矛盾
- RD-25 「规范化三线分离：结构合法性（outcome）、语义完备性（declared_gaps）、可判定性（INDETERMINATE）互不冒充；允许 UNKNOWN 的字段如实声明未知仍得 PASS」
- RD-26 「权限屏蔽使层级不可判定，不得记 NOT_APPLICABLE/PASS/FAIL；对无权调用者不存在与无权可见呈现为同一不可区分形态，禁止精确计数等存在性侧信道」
- RD-27 「空间写权限与业务授权分离：有权空间内可存未生效接纳声明；无写权限一律拒绝」
- RD-29 补全不豁免身份判据；RD-30 结论端由 Scheme conclusion_policy 决定
- RD-31 冲突与替代只有一处真源；RD-32 「历史重建需双时间条件：recorded_as_of（知识截点）× described_at/described_during（对象时间），先过滤可见性再过滤对象时间」
- RD-33 「S-L1 只查声明不判语义」；RD-34 「检查报告分审计视图与呈现视图，真源唯一……对外层级呈 UNVERIFIABLE_TO_YOU」
- RD-35 registrant_ref 与 actor_ref 分离；RD-36 组合资格绑定实例结论角色；RD-37 world_membership 带角色引用
- RD-38 「层级归约唯一：有 FAIL 即 NOT_ACHIEVED（优先），否则有 INDETERMINATE 才 INDETERMINATE；coverage 与 declared_gaps 不参与归约」
- §D1 L113 「sanitize() 与审计/呈现双视图的落地形式（领域规则已定……）」属实施准备；L136 「CS-01–CS-24 与 XC-01–XC-28 是未来测试预期，不是通过证据。」
#### H_S_R_NORMALIZATION_CONTRACT_DRAFT.md（RPT-00…11 正源）
- L9 「CheckReport = {target 引用（可到 @rev 或 @rev#representation）, contract_version, checker 标识与版本, checked_at, subject_space, level_results[], findings[], declared_gaps[], coverage}」
- §1.1 三线 A 结构合法性 / B 语义完备性 / C 可判定性；RPT-00 三线不得互冒充
- outcome 表：PASS（合法 UNKNOWN 仍 PASS）/FAIL（不阻断保存）/NOT_APPLICABLE（与权限可见性无关）/INDETERMINATE reason ∈ {WITHHELD_REFERENCE, CHECKER_UNAVAILABLE, DEPENDENCY_MISSING, RULE_UNREGISTERED}
- RPT-01 「报告追加不可改：新契约版本、新检查器版本重检旧对象产生新报告；历史 PASS 与其规则/环境/时间永久保留（C11）」
- RPT-02 层级归约唯一+混合结果正例；RPT-03 屏蔽项审计视图 INDETERMINATE(WITHHELD_REFERENCE)，coverage ∈ {COMPLETE, INCOMPLETE_DUE_TO_VISIBILITY, NOT_DISCLOSED}
- RPT-04 报告不得含科学判真；RPT-05 允许未知即可通过；RPT-06 必填输入角色不适用未知语义
- RPT-08 引用不可用按原因三分；RPT-09 sanitize() (a)合并 UNVERIFIABLE_REFERENCE (b)NOT_DISCLOSED (c)无计数 (d)响应形态不随目标存在而变；RPT-10 「呈现 UNVERIFIABLE_TO_YOU 而非 ACHIEVED/NOT_ACHIEVED」；RPT-11 核验权与写权限分离
- §2 八种记录形态（①无法解析原始记录→H；⑧权限屏蔽→INDETERMINATE）
- SL1/RL1 规则族（SL0-COM、SL1-COM、SL1-ENT/CON/ASS/ARG/PRO、RL0/RL1-01…15）；NEV-01…07 负面清单
- §8 L 最后一节：必备用例「同一猜测 ID 在目标存在于他空间与目标不存在两种世界下，呈现视图必须逐字节同形（UNVERIFIABLE_REFERENCE + NOT_DISCLOSED，XC-25）」
- L5 「任何 FAIL 都不阻止保存、阅读、检索、引用与继续研究（DF-07）」

#### H_S_R_COMPOSITION_SEMANTICS_DRAFT.md（C01–C12 正源）
- L11 「登记 ≠ 作为假设使用 ≠ 得到论证支持 ≠ 正式接纳 ≠ 客观为真。」
- C01 L19-25 Association 来源记录三时分离；「不能偷偷采用 latest-write-wins 作为科学裁决」
- C02 目标/实际结论/局部结局三分离表；程度值无契约不得运算
- C03 六维独立表；C04 输入角色/命题范围/假设分立「文件 D 不是自动成立的数学前提；甲声称 P 不是 P」
- C05 精确对齐≠同名同值；C06 图可追踪≠可组合；C07 AND/OR 不混并；C08 并存意见非公理；C09 共享来源不造独立证据
- C10 L97 「A1 用 A2 支持 P、A2 又仅用 A1 支持 Q 不能……自行获得支持资格或证书」
- C11 L103-105 「组合锁定对象、Concept、World/Scope、Scheme、输入/证书及已有映射的确切版本。新版本可以提示当前复审，但不得自动改写旧结论、旧 PASS 或旧使用记录。新规则重新检查旧对象产生新的检查报告；原检查的规则/环境版本和时间仍保留。」「形式化翻译若增添假设……不冒充原命题无损升级」
- C12 L109-111 「不可把搜索空结果或超时直接作为 ¬P」「不得为报告完整性而泄漏其他 ResearchSpace 的对象 ID、内容或推导结果」
- CS-01–CS-24 走查表（L125-148）逐行含落点（矩阵 §2 有细化列）
#### H_S_R_COMPOSITION_MATRIX_DRAFT.md（CC-01…12 映射 + XC-01…28）
- CC-11 行：版本、历史检查与重检不混写 → RPT-01、SL1-COM-01、PR-ID-6
- XC-02 path_id/condition_id 随修订重排→历史依赖分析失准；XC-07 可用性布尔覆盖历史；XC-15 H 检查记录当论证端点
- XC-18 屏蔽引用记 NOT_APPLICABLE+其余通过→整层误判 PASS（必 INDETERMINATE）
- XC-21 换配置新建 Entity（EN-W-1/2 禁）；XC-23 「被屏蔽 3 条」泄露存在性→只报有内容被权限过滤
- XC-24 单一 as_of 混双时间（T-05）；XC-25 「无权主体在自家空间登记一个猜测 ID，靠检查报告是 REF_UNRESOLVED 还是 INDETERMINATE 反推他空间是否存在该对象」→对外统一 UNVERIFIABLE_REFERENCE+NOT_DISCLOSED
- XC-27 FAIL+INDETERMINATE 同存报不可判定（违 RPT-02）；XC-28 operating_context 双真源
- §4 一致性自查：CC/XC 均为既有语义落点编号，不新增类别；「未运行任何 validator、Schema、PoC」
#### H_S_R_ASSOCIATION_CONTRACT_DRAFT.md
- §2 永不出现字段清单 is_true/is_current/is_verified/superseded…；§4 AS-T1 「三者可以两两不同且必须都能查询……不得实现为不透明的 latest 取值」
- AS-ID-2 相反关系内容必须新关联；AS-ID-6 「关联记录永不被更新为现状」
- AS-CF-1 冲突=高阶主张记录，原关联不改写；AS-CF-3 机器提示≠主张
- AD-01…04 采用记录；§7 adopted_ref 必填禁止 latest
#### H_S_R_ENTITY_CONTRACT_DRAFT.md
- EN-03 entity_subtype 身份构成（决定导出类）；EN-W-1/2 「使用语境一律不构成身份」；EN-W-5 使用关系真源在关系对象，Entity 侧派生视图不可写字段（SL1-ENT-08）；EN-W-6 可指称世界必须有 WorldContext 个体
- EN-W-7 根世界 singleton：slot_set 豁免+计数口径（2026-10-29 用户裁决：按不同根世界 object_id 计数不按修订条数；「豁免的机器形态与封闭性由 Schema 侧 SS-54 规定」——**SS-xx 编号体系在 #47 OBJECT_SCHEMA**）
- EN-ID-1…8（改名修订；部件更换修订+Association；快照模式内容新对象+version_of；重跑新活动个体；UNKNOWN→DECLARED 按 SAME_INTENT_CONFIRMED）
- §3.6 禁止字段清单（is_available/is_deleted/confidence_score/latest 跟随）；§3.2 「不在 Entity 上放当前是否可用布尔字段」
- EN-MS-1…6 缺失三处登记/两视图皆投影/UNRESOLVED vs WITHHELD/缺失不可推导
#### H_S_R_PROPOSITION_CONTRACT_DRAFT.md
- §2.4 禁止 is_true/truth_value/confidence_score/fact_status/merged_into/latest
- RP-01 表示附着于 revision；RP-02 `PropositionID@revision#representation_id`；RP-03 沉默=ABSENT≠UNKNOWN；RP-05 新增假设不得 SAME_TRUTH_CONDITIONS；RP-07 不存在 AssertionRevision 第二结构
- PR-ID-1…6（PR-ID-3 数值/量词/World 改变→新 Proposition；PR-ID-4 truth_condition_claim+completion_basis+身份判据优先；PR-ID-6 已发布 revision 永不可变）
- §6.2 FACT_DESIGNATION 字段（designator_ref/authority_basis_ref/action/target_proposition_rev 禁止链级或 latest）；PR-A1 授权不可确认仍保存标 AUTHORITY_UNVERIFIED 不参与投影；PR-A2 转述不改变甲状态；PR-A3 机器 PASS 不产生接纳；PR-A4 A7 派生投影
- §6.3 DB-01…04 DecisionBasis；§6.4 PROOF_OBLIGATION WAIVED 不得写成已证明
#### H_S_R_CONCEPT_CONTRACT_DRAFT.md
- CO-ID-1/4/5 定义改变真值条件→新 Concept；subkind 不可变；CO-REV-1 LEXICAL/SUBSTANTIVE 二分；CO-REV-3 redefines 仅触发定向重检提示；CO-REV-5/6 版本不可变、旧 revision 可精确引用回放
- SCHEME-1…8（Scheme 定义归 Concept；结局语义/尺度运算；SCHEME-6 组合资格属实例的结论角色；SCHEME-8 不检查科学正确性）
- CO-W-1…5 WorldType 开放/跨 World 不隐式转换；CO-DR-1…4 维度定义修订 vs Profile 实例新对象
- CO-MS-2 词表/政策注册表空间级治理；§14 未裁决：Scheme 声明机器可读表达形式（决策清单 D1）等
#### H_S_R_ARGUMENTATION_CONTRACT_DRAFT.md
- 字段契约：scheme_ref 不可变；conclusion 满足 Scheme conclusion_policy（SCHEME-3/CN-02）；input_bindings role_kind；RF-06 原始记录先对象化
- AR-ID-6 修订并发基线：「修订型请求已携带 expected_head_revision，由接口层据此识别；本契约不冻结字段名与存储形态。」
- AR-SC-1 组合资格按 role_kind；CN-01…06 三件事分离；GAP-01…05 语义缺口
- §7 生命周期：CLOSED_DRAFT 只用于从未提交的草稿；「被撤回不删除、不隐去旧报告」；FAIL 只限两件事
- §5 关系表：SEMANTIC→Concept@rev「新版本不倒灌旧论证（C11）」
#### H_S_R_SYSTEM_DESIGN_DRAFT.md（较早代次，被主基线部分取代）
- §0.1 A/C/M/U/X 记号；「横切的 ResearchSpace 隔离、主体认证/授权由公共基础设施执行，不被计算为第四个科研认识系统」
- R-6 保证边界表；§9 阅读顺序与 PoC 173/173 边界
#### docs/architecture/README.md（#42 内索引）
- 权威优先顺序：V1 当前运行为实现真源；V3 目录=讨论基线；「细化层只下沉细节，不改变主基线与 C01–C12 的裁决」

### A4 · #47 @37de107ed5 已读（7 份全文，行号=cat -n）
#### H_S_R_SCHEMA_FOUNDATIONS_DRAFT.md（SF-01…73）
- SF-02 规范键名逐字=契约阅读名；SF-05 每记录携 schema_version+space_id 字节永不改写；SF-06 禁持久「当前有效/最新版本」字段
- SF-10…19 五态 tagged value 封闭键集；SF-16 未注册 reason 命名空间=保存+FAIL(VOCABULARY_CODE_UNREGISTERED)
- SF-20 「标识是**不透明字符串**：服务端分配，永不复用，永不重新解释。标识不承载内容语义：不得由内容哈希派生（SD-05），不得在字符串内编码类型、关系或角色」
- SF-25 引用语法 `{prefix}:{local_part}@r{revision_id}[#rep]`，**space_id 不出现在引用字符串里**；SF-26 前缀封闭 HENT-/HCON-/HASS-/HARG-/HPRO-（不透明字符串+pattern）；SF-27 引用比较不含空间分量；SF-28 `ext:` 跨平面引用不可解析不产生失败；SF-43 SF-26/28 文法永久冻结
- SF-30…42 时间=UTC 微秒+precision；SF-33 登记时间服务端产生；SF-36 「所有时间比较与截点都基于**登记序**（record sequence），墙上时钟只做展示与过滤」；SF-39 时区禁；SF-40 十进制字符串
- SF-50 规范字节形态；SF-52 摘要不得派生引用/ID；SF-56 摘要输入键集封闭
- SF-60…63 版本兼容不回溯；SF-63 「服务端对每个检查类响应与写入类响应，必须回显实际采用的契约版本与记录 schema_version」；SF-64 已登记记录永不重新解释
- SF-N-01…11 负面清单（无 null 未知、无 latest 持久键、无脱敏态落盘）；SF-71 schema/** 属冻结面；SF-73 「在事件族问题被裁决前，本层不声称 HSR 记录已进入单一事件真源」
#### H_S_R_OBJECT_SCHEMA_DRAFT.md（SS-01…56）
- SS-09 信封键不得在载荷重复；SS-09a 异名归一命中信封键集=非法；SS-10 信封 kind/space_id 创建即固定；SS-11 head_revision 不是信封槽位（派生）；SS-14 外部断言不解析；SS-15/15a 身份槽位变化必须新建（L47/L54 全文已录）；SS-15a 末段声称「采纳状态（2026-10-29 用户确认）」并援引 `poc/hsr-form/FINDINGS-poc2.md`——**待溯源**；SS-16 external_citations 封闭键集 v1_kind 15 值
- SS-20 对象 Schema 是接口层不是存储模式；SS-21 载荷不落规范化层级字段
- SS-24 EN-W-7 根世界 singleton 豁免机制；SS-26/27/29 各载荷要点；SS-38 CONCLUSION_INPUT 矛盾 FAIL；SS-40 mode/ABSENT 区分；SS-42 path_id/condition_id 稳定；SS-49 主张内容只有一份
- SS-50…56 子型注册表：identity_slots 每项援引契约规则号；SS-54 至少一个身份槽位；SS-55 身份变化伪装补全→F-CONFLICT；SS-56 未注册码=候选载荷不进规范化；§7 用例 8 根世界对、9 候选态边界
#### H_S_R_CHECK_SCHEMA_DRAFT.md（SCR-01…77）
- L8-17 CheckReport 形态：report_id/report_digest/target/subject_space/**contract_version, schema_version, rule_set_version**/checker{id,version,env_ref}/checked_at/level_results/findings/declared_gaps/coverage
- SCR-02 target 精确引用缺 @rev 非法；SCR-03 三版本字段全必填；SCR-06 报告不改写重检新 report_id；report_digest 排除集=恰 {report_digest}
- SCR-11 INDETERMINATE reason 封闭四值；SCR-13 rule_id 解析不到→整报告 INDETERMINATE(RULE_UNREGISTERED) finding 而非丢弃；SCR-14 finding 不得带分数/建议补全值
- SCR-20 verdict 是审计视图归约值，UNVERIFIABLE_TO_YOU 非存储取值；SCR-21 重算三前提（rule_set_version/授权类/checked_at 截点）；SCR-23 分母注册表决定；SCR-24 NA 逃逸 FAIL
- SCR-31 有遮蔽项 coverage 必 INCOMPLETE_DUE_TO_VISIBILITY；SCR-40 declared_gap reason 命名空间复用；SCR-50 只存审计视图；SCR-51 sanitize 封闭映射表；SCR-52 UNVERIFIABLE_* 禁持久化；SCR-54 两世界逐字节同形（常量 S 封闭形态）；SCR-55 不得按遮蔽项数量改数组长度；SCR-56 授权类封闭 {AUDIT, PRESENTATION}；SCR-57 呈现函数版本钉住；SCR-77 「规则注册表缺项不得让缺陷静默通过：漏检与通过是不同事实」
#### H_S_R_INTERFACE_FOUNDATIONS_DRAFT.md（SI-01…74）
- SI-01 既有 11 个 research_* 工具（冻结根文档）不变，HSR=新增 `hsr_` 命名空间；SI-02 新工具名=冻结面变更+Frozen-Face-Review+permissions.test.ts 同步；SI-03 HSR 与 V1 两套身份无自动同步；SI-04 工具→服务→领域，不新增旁路
- SI-10 请求禁 latest/跨空间目标/自报 recorded_at/跳检标志；修订类禁提交 object_kind+space_id（提交即 TOOL_INPUT）；SI-16a space 分量由可信调用上下文注入非从 object_id 推导——**SI-16 原句把映射当显然、T-GAP-09 已承认缺口**
- SI-13 echo 必填（两个时间+视角+版本选择+契约版本）；SI-14 boundary 恒定在场+三键角色分裁（coverage 披露量/truncated 盲区恒 false 但 exhausted 如实/limit_applied 如实）+白名单封闭三键；SI-15 空结果判读规则（boundary 在场且 coverage=COMPLETE 才可判「无」）
- SI-20 授权失败两类+TOOL_INPUT 恒定性+「任何按 ID 的读/写响应都不得把对象是否存在于他空间编码进状态、detail 或时延」；SI-22a 修订族按 object_id 派生空间；SI-24 expected_head_revision 必填+F-PRECONDITION-REVISION；SI-21 保存永不被 FAIL 阻断；SI-23 检查器不可用不得折叠为不通过
- SI-30…36 两视图呈现（授权派生自被检对象；report_refs[] 不含无权 report_id；缓存按授权类分键；时延量化断言）
- SI-40 写幂等键必填；SI-41 四元组+首次请求体摘要、永久绑定（不同体→IDEMPOTENCY_BODY_MISMATCH 只进工具 detail）、重放不得重放事件通知；SI-42 修订前置不匹配不产生记录
- SI-50 recorded_as_of 缺省=当前且回显；described 缺省不检查不回显；SI-51 游标自包含截点；SI-53 「知识截点与对象时间是两个独立条件……实现不得把两者折叠为一个时间参数或用其一覆盖另一」；SI-52 两过滤不强制原子一致（「诚实的边界比虚假的原子性更可信」）
- SI-60 异步检查返回 report 句柄；SI-61 每次重检新报告；SI-63 检查状态是呈现投影禁状态槽位；SI-70…73 兼容纪律（缺省版本/回显/历史包络回放）
#### H_S_R_INTERFACE_CATALOG_DRAFT.md（39 操作）
- `hsr_record_append`(IC-H1)…`hsr_check_report_get` 等目录；测试锚点内嵌（「载荷非法必须落 H 原始记录而非拒收」「幂等键是四元组且永久绑定首次结果」）
- ICX-05 操作集合封闭 35 契约操作+4 只读形态操作（等式必须被测试钉住）；ICX-06 非契约操作只允许只读形态层自身工件；ICX-07 冻结的是覆盖与语义不是入口个数（允许合并暴露，三条件）
#### H_S_R_SCHEMA_DECISIONS_DRAFT.md（SD-01…22 + T-GAP）
- SD-05 禁内容寻址身份；SD-07 「在裁决前不得声称 HSR 记录已进入单一事件真源……V1 eventSeq per-workstream 与 HSR 记录序无关……跨平面连接只允许 HSR 侧显式 external_citations[]」；SD-08 只存审计视图；SD-13 本轮不入 schema/**；SD-14 幂等四元组+永久绑定；SD-15 游标自包含截点；SD-18 四修订入口=同一写原型
- SD-21 T-GAP 清单：T-GAP-09 授权空间↔object_id 空间映射未定义；T-GAP-11 呈现常量 S 构造方式未钉；T-GAP-12 版本字段缺省值语义（A-05）；T-GAP-13 登记序表示不统一 epoch_ms vs CommitSequence；T-GAP-15 隐藏 0/1/≥2 三态同形语料
- SD-22 A-01…A-07 回写请求（A-01 F-PRECONDITION-REVISION；A-03 SI-40/SI-41 双轨→SI-41 权威；A-04 SI-14 三键；A-05 SI-70 缺省值语义；A-06 SCR-30 与 SF-N-03 冲突）
- §3 修订请求表（SR/SI-14 等）+§5 语料表（版本兼容 fixture 对、位置完备性语料）
#### H_S_R_REGISTRY_SCHEMA_DRAFT.md（SRG-01…41）
- SRG-01/02 领域定义必须 Concept 对象不得降级词表；SRG-12 条目只增不改不删允许 DEPRECATED；SRG-21 未注册码保存+FAIL；SRG-22 空间不可见→INDETERMINATE(WITHHELD_REFERENCE)；SRG-24 注册受权+contract_ref 可机验；SRG-31 名称映射双射；SRG-41 UNVERIFIABLE_* storage_forbidden

### A3 · #42 读取完成度声明
#42 全部 18 个新增正文文件 + 索引 README 已于 head 0369c3196c 逐文件全文读取；#44 V3_CODE_ARCHITECTURE_DRAFT.md 429 行全文读取；#47 七份全文读取。引句均为逐字摘录（行号见上），行号对应 git blob 的 cat -n 编号。

