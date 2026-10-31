# G1 补正专题① 契约正文 —— 历史序号：`CommitSequence` 与 Ledger 事件序号必须区分（席位 CS）

> **性质**：G1 阶段 3 的**补正专题①**契约正文（`g1/G1-FREEZE-CRITERIA.md:42` 把「专题①（CommitSequence /
> 双时间截点）」列入 A 层，`:52-53` 实测「专题① 的契约正文本席位实测未在盘」⇒ **本文件就是那份文书**；
> 同文件 `:55-63` 的**同轮更正段**记「正文已落盘、配套夹具当时缺位（`MODULE_NOT_FOUND`）」⇒ 本文件与
> 其配套夹具**现已同时在盘**（夹具 `node` 直跑 exit 0，见 §6.2 实测记录），A 层「机验面未闭合」一项据此
> 可复验。两段实测原样保留不删；本席不改他席文件，后续状态由治理席位自判）。
> 本席只裁一件事：**历史截点的载体**，并顺手收口 `D2-a`/`D2-b`/`D2-c` 三条已裁行在载体上的漏项。
> **本文件不关闭任何清单条目**（放行谓词 = `node experiments/v3-code-architecture-poc/g1-checklist-validate.mjs
> --require-clear` exit 0 **+ 用户授权**，`g1/G1-ADJUDICATION-TABLE.md:6-8`）；凡涉及他席文件的改动一律
> **登记不删**（§8 回填清单），本席未改任何他席文件。
> **不写生产 DDL / 生产代码**：正文里的 TS 形状与「逻辑列」是契约形状（先例：FM-6、RL-11、EA-4.2），
> 物理 DDL 与触发器归 G2；真库形态只在夹具里以**夹具形状**存在（`g1/G1-CONTRACT-COMMIT-SEQUENCE.fixtures.mjs`）。
> **配套夹具**：`g1/G1-CONTRACT-COMMIT-SEQUENCE.fixtures.mjs`（零依赖、`node` 直跑、**退出码即结论**；
> 含真库用例与常驻架空判据变异）。§6 表与夹具 id **双向逐等**（S6 机验）。
> **路径约定**：不带前缀的路径（`g1/…`、`src/…`、`tests/…`、`CONTRACTS.md`、`READINESS.md`）相对本侧车根
> `experiments/v3-code-architecture-poc/`；`docs/**`、`schema/**`、8 份根文档相对仓库根。
> **工作树**：分支 `g1/contracts-20261031`；本席落笔时 HEAD `079b69f`，两份文书随后由并行席位随提交
> `744f777` 入库、`docs/README.md:123` 已由 `docs:sync`（`6e23f34`）收录索引行（**本席全程未做任何 git 写操作**，
> 提交与索引动作均非本席所为，此处如实记）。

---

## 0. 引用与平面纪律

### 0.1 三个平面（沿 EA §0.1 / FM §0.1，不重开）

| 平面 | 内容 | 本席用法 |
| --- | --- | --- |
| V1 冻结面 | 8 份根文档 + `schema/**`（批准基准哈希 `docs/engineering-baseline/gates/G0-inventory.yaml`） | **零接触**。本席未读未改冻结面 |
| #47 HSR 条件式 | 形态层条文（SF/SI/T-GAP），以「#42 合并且条文不变」为条件 | 只引用既有规则号（T-GAP-13/SF-31/SI-10/SI-13/SI-50/SI-51），不新增条件式主张 |
| V3 机制侧车 | 本 PoC 的机制契约（EA/FM/RL/IG/IDC/DC + ADJ + 本席 CS） | 本文件的唯一落笔面 |

### 0.2 引用格式

`文件`（`§/行位`，规则号）+ 原文短句 + SHA。上层三 ref：#42 = `0369c3196c`、#44 = `5ec38974fc`、
#47 = `37de107ed5`；侧车自身锚点 = 工作树实测（HEAD `079b69f`）。夹具 S9 对下表**逐字保真**机验
（`git show <sha>:<path>` 取 blob 抽原文，非人工转述）。

### 0.3 引用清单（正文以 C-xx 指代）

| # | SHA | 文件（规则号/行位） | 原文短句 |
| --- | --- | --- | --- |
| C-01 | `5ec38974fc` | `docs/architecture/V3_CODE_ARCHITECTURE_DRAFT.md`（L161，#44） | 「`readonly recordedAsOf?: CommitSequence; // H 登记知识截点`」——`CommitSequence` 是**上层既有类型名**，本席沿用、只重判其取值域 |
| C-02 | `5ec38974fc` | 同上（L167，#44） | 「读取同一事务状态须提供**一致提交快照**；历史读取须**先按 `recorded_as_of` 过滤可见登记**，再按 `described_at/during` 过滤所描述时间」「迟到登记不可追溯变成过去已登记」 |
| C-03 | `5ec38974fc` | 同上（L138，#44 §5 Kernel 职责表） | 「**History Ledger**：不可变登记序、**记录提交和历史截点元信息**」——提交与截点是 Kernel 职责，不是领域解释 |
| C-04 | `5ec38974fc` | 同上（L224，#44） | 「**History Ledger (H)** \| **同一 Space 统一不可变登记顺序/提交截点**」——「登记顺序」与「提交截点」在同一句里被并列，正是必须拆开的两个序 |
| C-05 | `5ec38974fc` | 同上（L242，#44 Q40） | 「再**一次原子提交**：领域权威状态/事件、Directory、H Ledger、Change Journal 全成或全回滚。**未提交的 ID 对其他事务不可见**」 |
| C-06 | `5ec38974fc` | 同上（L339，#44） | 「跨插件暂存后失败 \| Domain State、Directory、Ledger、Journal 均回滚，**预留 ObjectID 不冒充已存在对象**（Q40）」——预留值的通用纪律：未提交即不得冒充已完成 |
| C-07 | `37de107ed5` | `H_S_R_SCHEMA_DECISIONS_DRAFT.md`（L126，T-GAP-13，#47） | 「两者不等价：**同一毫秒内可有多个提交**，时间戳不能充当事务快照边界。必须写明其一：① `epoch_ms → CommitSequence` 的定序规则，并给『该毫秒无提交』『该毫秒多提交』两个分支的确定取值；② 或把外部时间条件定义为…**回显实际使用的截点**」 |
| C-08 | `37de107ed5` | `H_S_R_SCHEMA_FOUNDATIONS_DRAFT.md`（SF-31，#47） | 「查询侧的两个时间条件（`recorded_as_of` × `described_at`/`described_during`）是**请求参数**，不是记录字段；响应必须**回显实际生效值与缺省**」 |
| C-09 | `37de107ed5` | `H_S_R_INTERFACE_FOUNDATIONS_DRAFT.md`（SI-10，#47） | 「请求里**禁止**出现：…**调用方自报的 `recorded_at`（登记时间由系统产生）**…」 |
| C-10 | `37de107ed5` | 同上（SI-13，#47） | 「`echo` 是**必填**：任何查询结果必须回显实际生效的两个时间…缺回显视为实现缺陷，不是可选元数据」 |
| C-11 | `37de107ed5` | 同上（SI-50/SI-51，#47） | 「超上限**拒绝而非钳制**」「游标必须**自包含知识截点**…晚到登记不得使同一游标翻页时重复或漏项」「游标跨越截点 → 拒绝并要求新查询」 |
| C-12 | `d2f19cc`（现存文本沿用至 HEAD） | `CONTRACTS.md`（§2 ST-4，:29） | 「登记序 `seq` 必须是**事务内计数器**（`meta.ledger_seq`）…回滚后 `ledger_head` 仍为 0 且下一次成功提交从 1 起 **[实测]」**——提交序走同一纪律（CS-1.4），且实测已复核（§6 T-P2） |
| C-13 | 工作树 | `READINESS.md`（:34，D-5） | `recordReport` 把 `recordedAt` 与 `seq` 当**同一数值的两个名字**——两序混用的现存活例 |
| C-14 | 工作树 | `READINESS.md`（附录 B，D-12，:106） | 「席位实测用**截点前缀差分 `C(X)-C(X-1)`** 可枚举被剔除行的精确 `recorded_seq`…另 `usedRecordedAsOf` 在默认截点下泄露 head」 |
| C-15 | 工作树 | `g1/G1-ADJUDICATION-TABLE.md`（§2.0，:31-41） | 「『CommitSequence』是 **#44 既有 CamelCase 类型名**…**非我方新造**；本表沿用」+ 对应表行「`commit_sequence`（线格式/DDL 名）\| `CommitSequence` 类型（L161-162）；PoC 物理载体 = `meta.ledger_seq` 事务内计数器（CONTRACTS ST-4）」——本席判这半行**作废**（CS-4 行 0） |
| C-16 | 工作树 | `g1/G1-ADJUDICATION-TABLE.md`（D2-a…D2-f，:52-57） | 已裁六行全文；本席逐条对齐（§4），其中 D2-a/b/c 三行的**载体列需修订** |
| C-17 | 工作树 | `g1/G1-CONTRACT-EVENT-AUTHORITY.md`（:341 / :117） | 「`readonly txSeq: CommitSequence; // 同事务内登记序`」「`declareRawIntake(a: RawIntakeEnvelope): CommitSequence`」——两处把**事务内事件序**冠以 `CommitSequence`，属同一混用的第二现场（回填项 BF-01/BF-02） |
| C-18 | 工作树 | `g1/G1-CONTRACT-IDEMPOTENCY.md`（:107-111、:198-200） | 专题② 对专题① 的三条显式依赖 **DEP-①-1/2/3**（回执行 `commitSequence` = 专题①唯一发号点同事务产出；c1 截点不做 `recorded_at` 重算；`resultRef` 在 c1 截点永久可解析）——本席在 CS-1.4、CS-3.1、CS-2.5 兑现 |
| C-19 | 工作树 | `src/kernel/read-context.ts`（:100-101） | 现状可见性谓词「`select … from domain_state where recorded_seq <= ? order by recorded_seq, oid`」——**按事件序过滤**，即本缺陷的物理现场 |
| C-20 | 工作树 | `g1/G2-DEV-PLAN.md`（:61 W4 行、:277 PR-4 卡片） | W4「双时间三概念分离 + `recorded_as_of → CommitSequence` 两分支映射 + 分页游标自包含」——本契约给出其**取值规则与形状**，实现批按此落码 |

### 0.4 新命名声明（防止「假装上层已有」）

本席新命名（或本层沿用但上层没有的词）**七个**由夹具 S10 对三 ref 逐词复跑零命中
（`git grep -w … -- '*.md'`，只读）；下表逐词登记：

| 词 | 层位 | 三 ref 实测命中 | 定性 |
| --- | --- | --- | --- |
| `CommitSequence` | 类型名 | #44 命中（C-01） | **上层既有**，沿用；本席只重判取值域（CS-1.1） |
| `commit_sequence` | 线格式/DDL 名 | 三 ref 零命中 | ADJ §2.0 **已认领的我方新命名**（C-15），本席沿用其**名**、替换其**载体** |
| `LedgerEventSequence` | 类型名 | `0369c3196c`/`5ec38974fc`/`37de107ed5` 均 **0** | **本席新命名**（契约层，须待 #44/#47 修订吸收才成上层词） |
| `ledger_event_seq` | 线格式/DDL 名 | 三 ref 均 **0** | 同上 |
| `commit_record` | 表/账名 | 三 ref 均 **0** | 同上（提交账，CS-1.3） |
| `commit_recorded_at_ms` | 线格式列名 | 三 ref 均 **0** | 同上（每提交一枚的登记墙钟，CS-3.1） |
| `resolved_cutoff` / `resolved_at_ms` | 回显键名 | 三 ref 均 **0** | ADJ D2-b 已裁的本层键名（C-16），非上层词；SI-13（C-10）只要求「必须回显」不要求键名 |
| `commit_sequence`（`meta` 计数键） | `meta.key` | 三 ref 均 **0** | 同上；键集扩张登记于 §8 BF-07 |

### 0.5 保证范围如实（沿 `G1-UNIFIED-CONTRACTS.md` §0.4 与 D-23 口径）

CS-1.4 的「分配点与提交同事务」保证**只覆盖 Kernel 管理的 UoW 路径**（`Kernel.uow`/`uowFor`，
`src/kernel/kernel.ts:738`/`:727`）；`SqlitePort.tx()` 无独立失效机制（`G1-STORAGE-01`）⇒ 绕过 Kernel
直接提交的路径**不自动获得**提交序与提交账行，其后果由 §1.6 的**打开期不变量 I-3/I-4 fail-loud 兜住**
（不是静默）。这条边界必须与任何绿灯并列引用（`CONTRACTS.md` §14.1 先例）。

---

## 1. CS-1 两个序：定义、载体、分配点、作用域、与 commit 的先后、禁令

### 1.1 定义（规范句；机读块 ↔ 夹具 S1 逐等）

<!-- CS-1 SEQ-BEGIN -->
```
seq_axis | 类型名                | 线名/DDL 名    | 步长        | 单调 | 唯一合法用途                          | 绝对禁止
event    | LedgerEventSequence   | ledger_event_seq | 每事件 +1   | 是   | 事件排序 / 见证引用 / 审计对账 / 页内位置键 | 作任何读面的历史截点
commit   | CommitSequence        | commit_sequence  | 每提交 +1   | 是   | 历史截点 / 游标截点分量 / 派生面水位 / 回显 | 作事件身份或页内排序键
```
<!-- CS-1 SEQ-END -->

**一句话版（回报口径）**：`CommitSequence` 是**一次原子提交完成后在历史上留下的稠密序号，也就是读面唯一
可寻址的历史截点**；`LedgerEventSequence` 是**H 内逐条登记的排序号（每事件 +1）**，只回答「这条事件排在
第几」，**永远不能当历史截点用**。

- **CS-1.1a** 两轴是**两个独立品牌类型**，禁互相赋值、禁互相转换、禁在同一变量名下来回使用。现状把两轴
  压进一个品牌（`src/contracts/index.ts:43`「`export type CommitSequence = number & { readonly __brand:
  'CommitSequence' }`」，其值实际是 `meta.ledger_seq` 的事件序）是本专题的**根因**；该品牌的每一处使用点
  必须重判属哪一轴（逐点清单见 §8 BF-01…BF-06）。
- **CS-1.1b** 「登记顺序」与「提交截点」在上层句里并列出现（C-04）**不构成**「同一数两个名字」的授权：
  前者是事件轴，后者是提交轴；一句并列只说明 H 同时承载两件事，不说明两件事共用一个序号。
- **CS-1.1c** `recorded_at`（每事件的墙钟）、`described_at`（所述对象时间）与两轴**四者**互不可转
  （D2-a 三概念分离在本席扩为四槽：`described_at` / `recorded_at`(事件) / `commit_recorded_at_ms`(提交) /
  两轴序号）。

### 1.2 `CommitSequence` 的四要素（裁决项 ① 的正面答复）

| 要素 | 裁决 | 为什么不是别的 |
| --- | --- | --- |
| **分配点** | 事务内**第一次权威写之前**（凡将写 H/`domain_state`/挂载账/路由账/位置键者），由机制单点 `nextCommitSequence(raw)` 预留：`update meta set value = value + 1 where key='commit_sequence'`，本事务后续所有写**复用**该值，不再发号。一个事务**至多**一个提交序；一个历史写都没有的事务**不分配、不占号** | 不能搬到 COMMIT 之后：H 是 append-only（`ledger_no_update` ⇒ `HISTORY_IMMUTABLE`），行落库后**无法回填**归属 ⇒ 提交时再打号在物理上不可行（夹具 T-N5 真库否证：提交后 `update ledger set commit_sequence=?` 撞 `HISTORY_IMMUTABLE`） |
| **作用域** | **每 Space 全局**（跨 Capability、跨命名空间单调），从 1 起稠密。**跨 Space 无共同序**：两空间的同一数字无相互含义，禁比较、禁进任何标识字符串 | 不按 ns / 不按 capability 分轴：Q40 的一次原子提交可同时写多个 owner 的 ns（C-05），若分轴就没有「这一次提交」的单一截点；Space = 文件 = 事务边界（C-04「同一 Space 统一…」），跨 Space 无原子提交 ⇒ 无跨 Space 截点 |
| **持久化位置** | ① `meta` 键 `commit_sequence` = 已分配水位；② **提交账 `commit_record`**（CS-1.3）= 已提交事实账，读面解析只读它。两处**同事务**写入 | 只存水位不存提交账 ⇒ 墙钟分支无法解析（T-GAP-13 两个分支的取值都要求"哪些提交存在、各自几点"，C-07）；只存提交账不存水位 ⇒ 发号没有单点，回滚不留 ghost 的性质无法用既有 `meta_counter_monotonic` 守卫（`src/storage-sqlite/sqlite-port.ts:25-27`） |
| **与 commit 的先后** | **先预留，后 COMMIT**；**生效（进入读面可见域）= COMMIT 成功**，无第二次写。回滚 / 提交期抛错 ⇒ 预留号与业务行一并消失，水位不前进、号可被后续提交复用（**无 ghost**，C-12 同族，真库复核 T-P2）。读面解析的候选集**只含 `commit_record` 里已存在的行** ⇒ 「预留但未提交」的值对读面**不可表示** | 若"提交后再 +1"则需第二次写（跨提交窗口 = 存在「内容已提交但无截点」的世界）；若在事务开始前分配则纯读事务也烧号，稠密性判据（I-1 等号）失效 |

### 1.3 提交账 `commit_record`（逻辑形状；物理 DDL 归 G2）

| 逻辑列 | 类型 | 含义与判据 |
| --- | --- | --- |
| `commit_sequence` | integer **PK** | 机制发号，稠密从 1；行存在 ⇔ 该提交已提交（读面唯一候选集） |
| `ledger_event_seq_from` / `ledger_event_seq_to` | integer not null | 本次提交覆盖的事件序**闭区间**；一行提交**至少**登记一个事件（空提交不入账） |
| `commit_recorded_at_ms` | integer not null | 该提交的登记墙钟，**一提交一枚**，由机制在预留点取时；调用方不得自报（C-09 SI-10 同向：登记时间由系统产生） |
| `space` | —（**不建列**） | Space = 文件 = 作用域，不入库内 |

守卫（G2 落地）：`commit_record` 禁 `UPDATE`/`DELETE`（`HISTORY_IMMUTABLE` 同族信号，与 `ledger_no_update`/
`ledger_no_delete` 一对同形，`src/storage-sqlite/sqlite-port.ts:48-51`）；`meta.commit_sequence` 受**既有**
`meta_counter_monotonic` 触发器覆盖（该触发器是 `before update on meta for each row when new.value <
old.value` 的**泛化形**，无需新写；真库复核 T-P3）。**DELETE 支现状只钉 `key='ledger_seq'`**
（`sqlite-port.ts:28-30`）⇒ 第三个计数器键的删除不被拦，登记缺口 BF-07（本席不改 `src/**`）。

### 1.4 禁令（裁决项 ① 的反面，封闭清单）

**禁止任何读面暴露事务内部事件序截点**，具体形态枚举（夹具 S2/S3/T-N4 逐条钉）：

1. **入参封闭**：历史截点入参类型面只有两支（CS-2.1）。不存在、也不得新增「按事件序提问」的第三支；
   `AsOf` 之外的整数一律不是截点。
2. **谓词形状**：可见性谓词**只许**一种形状：`row.commit_sequence <= <已解析提交截点>`。
   形如 `recorded_seq <= <任意入参>` / `l.seq <= <任意入参>` 的过滤形态**一律非法**（现状
   `read-context.ts:100-101`，C-19，即被禁形态；夹具 MUT-1 用现网逐字 SQL 做架空判据必红）。
3. **回显封闭**：截点位置的回显只发提交轴（CS-2.3）。事件序**不得**出现在 `resolved_*` 任何键里。
4. **游标/水位封闭**：游标的**截点分量**只许是提交序；派生面/投影/`CoverageReport` 的**水位**只许是提交序
   （CS-2.7）。游标的**页内位置分量**可含事件序（CS-2.6），二者不得混名。
5. **写回执封闭**：写入口只回事件轴见证（CS-2.5），**不得**携带提交截点。
6. **detail 封闭**：越界/非法截点的 `detail` 不回显 head、总数、差值或事件序区间（C-14 的教训：截点差分
   可枚举被剔除行的精确 `recorded_seq`）。
7. **审计面不受呈现判据约束，但不得回流**：内部审计可留存事件序（`eventsOf` 的行序、`journal.tx_epoch`、
   对账区间），但审计面的数值不得被任何读面当作截点入参回送。

**结构性论证（为什么这条禁令是可满足的、且不靠自觉）**：提交序**稠密**（无空洞，CS-1.4/CS-1.2）⇒
`[0, committedHead]` 内**每个**整数都恰好指认一个真实已提交事务的边界。因此**即使**调用方拿一个事件序数值
冒充提交序传入，他能得到的也只是"另一个合法的完整提交前缀"，**得不到**任何事务内部状态。事件序轴上存在
`1..N` 的密集取值（其中绝大多数落在事务内部），提交序轴上不存在——这就是把截点从事件轴搬到提交轴的**全部
含义**，也是夹具 T-N4 的判据。

### 1.5 `LedgerEventSequence` 的合法用途（封闭清单，缺一即红）

| # | 合法用途 | 现状锚 |
| --- | --- | --- |
| U-1 | H 行排序与唯一身份（`eventsOf` 的行序、`(object_id, seq)` 索引） | `sqlite-port.ts:32-51`（`ledger.seq` PK） |
| U-2 | 见证引用：命令回执 / 挂载登记见证 / 报告登记见证（CS-2.5） | `G1-CONTRACT-DOMAIN-COMMAND.md:174`、`G1-CONTRACT-EVENT-AUTHORITY.md:117`、`kernel.ts:1377` |
| U-3 | 提交账的区间端点（事件轴被提交轴完全划分的物理凭据，I-5） | CS-1.3 |
| U-4 | 页内位置键 / 排序稳定位（**非**可见性判据） | `read-context.ts:101`（`order by recorded_seq, oid` 部分保留） |
| U-5 | 审计对账与异源复算（EA-6、RL-5.1 的 `changed_seq`） | `G1-CONTRACT-RELOCATION.md` RL-5.1 |

**不在清单内的一切用法 = 违规**，其中被点名禁止的三类：作可见性谓词左值（禁令 2）、作水位（禁令 4）、
作回显截点（禁令 3）。

### 1.6 不变量与打开期判据（形状；落点归 G2 打开路径，与 F5b 同族同码）

| id | 不变量 | 违例形态 | 判据 |
| --- | --- | --- | --- |
| I-1 | `max(commit_record.commit_sequence) = meta.commit_sequence`（**等号**，严于 F5b 的 `≤`；无提交时两边皆 0） | 预留号被持久化到提交账之外（ghost）、或提交账缺行（拆账） | 打开期 `SCHEMA_UPGRADE_REQUIRED` |
| I-2 | `max(ledger.seq) ≤ meta.ledger_seq`（既有 F5b，`sqlite-port.ts:408-419`，原样保留） | 水位归零/倒退 | 既有判据 |
| I-3 | 每条 H 行的 `commit_sequence` 必命中 `commit_record` 一行（旁证：无「有归属却无提交」的行） | 绕过 Kernel 的裸 `tx()` 写了 H 行 | 打开期 fail-loud（§0.5 兜底面） |
| I-4 | 每个有历史效果的事务都有提交账行；有归属列的行必携归属（旁证：无「归属未定」的行） | 绕过 Kernel 提交 | 同上 |
| I-5 | 事件轴被提交轴**完全划分**：提交账按 `commit_sequence` 升序时区间首尾相接、无重叠、无缝隙 | 提交账与事件序解耦（如手工塞行） | 打开期 fail-loud + 构建期对账 |
| I-6 | 读面可解析截点集 = `{0} ∪ {c : commit_record 有行 c}`（值域封闭） | 解析器读水位而非提交账 | 夹具 T-N1/T-N4 |

**I-5 就是「不存在事务内部截点」的物理表述**：事件轴上每一个号都恰好属于某个提交区间，截点只能落在区间
**边界**上，落不进区间**内部**。

### 1.7 存量数据与迁移（不静默）

- PoC 存量库**不回填**（PoC 数据可弃；先例 `READINESS.md` D-6 回填器债务不得复制）。
- G2 正式库若出现无提交账的存量：**必须**能证明每条历史行的提交归属才可开库；证明不了 ⇒ 该面按
  `replayAuthorityEvidence` 的既有词汇判 `UNVERIFIABLE_LEGACY`（`G1-UNIFIED-CONTRACTS.md` P5 段），
  **不得**按事件序猜一个截点出来冒充。

---

## 2. CS-2 Port 与查询形状（裁决项 ②）

### 2.1 入参：两支封闭（机读块 ↔ 夹具 S2）

<!-- CS-2 ASOF-BEGIN -->
```
as_of_branch | 线名（入参键）        | 载荷类型            | 解析目标
commit-sequence | as_of_commit_sequence   | CommitSequence      | resolveCutoff(·) ⇒ resolved_cutoff（已提交截点；0 = 一切提交之前）
recorded-at-ms  | as_of_recorded_at_ms    | number（epoch_ms）  | resolveCutoff(·) ⇒ resolved_cutoff（前缀界，CS-3.1）
```
<!-- CS-2 ASOF-END -->

```ts
/** 事件排序轴：只作排序/见证/对账（CS-1.5）。禁作历史截点（CS-1.4 禁令 2）。 */
type LedgerEventSequence = number & { readonly __brand: 'LedgerEventSequence' };
/** 已提交事务截点轴（#44 既有类型名，C-01；取值域由 CS-1.1 重判）。唯一合法截点载体。 */
type CommitSequence = number & { readonly __brand: 'CommitSequence' };

/** 历史截点入参：恰好两支，无第三支、无裸整数（CS-2.1）。 */
type AsOf =
  | { readonly branch: 'commit-sequence'; readonly value: CommitSequence }
  | { readonly branch: 'recorded-at-ms'; readonly epochMs: number };

interface ReadContextSpec {
  readonly space: SpaceId;
  readonly principal: VerifiedPrincipal;
  readonly mode: ViewMode;
  readonly consistency: 'required' | 'stale-ok';
  readonly asOf?: AsOf;                       // 缺省 = 当前已提交截点，并置 cutoffDefaulted=true（CS-2.3）
  readonly describedAtOrDuring?: TimePredicate; // 对象时间，第二层，量纲不变（D2-a）
}
```

- 现网 `ReadContextSpec.recordedAsOf?: CommitSequence`（`src/contracts/index.ts:181`）的**量纲**由本契约
  判为事件序 ⇒ 该字段形态作废，替换为上表的 `asOf`（他席回填 BF-03）。缺省仍是「当前已提交截点」
  （行为等价，但缺省值来源从 `Kernel.head` 改为 `Kernel.committedHead()`）。
- **两支的解析都必须到达"已提交"这一侧**：`commit-sequence` 支判"该值是否已提交"（I-6），
  `recorded-at-ms` 支只在提交账前缀上取值（CS-3.1）。**不存在**任何一支能把请求带到未提交区间。

### 2.2 解析单点（唯一函数，读面共用）

```ts
/** 读面截点解析的唯一判据点。候选集 = 提交账已存在行（I-6），绝不读 meta 水位兜底。 */
function resolveCutoff(committed: readonly CommitRecord[], requested: AsOf): ResolvedCutoff;

interface CommitRecord {          // CS-1.3 提交账的读面形状
  readonly commitSequence: CommitSequence;
  readonly ledgerEventSeqFrom: LedgerEventSequence;
  readonly ledgerEventSeqTo: LedgerEventSequence;
  readonly commitRecordedAtMs: number;
}

interface ResolvedCutoff {
  readonly asOfBranch: 'commit-sequence' | 'recorded-at-ms' | 'head-default';
  readonly resolvedCutoff: CommitSequence;              // 唯一生效截点（0 = 一切提交之前 ⇒ 空视图）
  readonly resolvedAtMs: number | null;                 // 该截点提交的 commit_recorded_at_ms；c=0 ⇒ null
  readonly cutoffDefaulted: boolean;                    // 入参缺省 ⇒ true（C-08「回显实际生效值与缺省」）
}
```

| 入参形态 | 解析结果 | 判定 |
| --- | --- | --- |
| 缺省（未给 `asOf`） | `c = committedHead`（提交账最大行；无行 ⇒ 0） | `cutoffDefaulted=true` |
| `commit-sequence`，`0 ≤ c ≤ committedHead` 且为整数 | `c` 本身 | 合法（稠密 ⇒ 必是真实提交边界） |
| `commit-sequence`，`c > committedHead` 或 `< 0` 或非整数 | 拒 | `READ_CUTOFF_UNSAFE`（§2.8；拒而非钳制，C-11 同族） |
| `recorded-at-ms` | 前缀界（CS-3.1） | 总可解析；可能 `c=0` |
| `AsOf` 之外的形态（裸整数、未知 branch、缺载荷） | 拒 | `CONTEXT_INCOMPLETE`（未声明截点 = 未定义查询，T-01 既有语义） |

### 2.3 回显（裁决项 ② 的回显面；机读块 ↔ 夹具 S3）

<!-- CS-2 ECHO-BEGIN -->
```
echo_cutoff_key | 类型                      | 必填 | 语义
as_of_input         | AsOf（缺省位取 head-default）  | 是   | 原样回显请求的截点条件；缺省回显 head-default
resolved_cutoff     | CommitSequence          | 是   | 实际生效截点（提交轴）。ADJ D2-b 同名键，量纲由本席钉死
resolved_at_ms      | number（c=0 时取 null）      | 是   | 该截点提交的 commit_recorded_at_ms；c=0 ⇒ null
cutoff_defaulted    | boolean                 | 是   | 缺省与否
```
<!-- CS-2 ECHO-END -->

- 这四键**只加在截点位**，与既有 `hiddenBy*` / `timeFieldMissing` 等键的取舍无关；`AsOf` 两支共用
  `as_of_input` 一个键（原 D2-b 的 `input_recorded_as_of` 收敛于此，避免"另一支恒为 null 的键 = 键的有无
  本身成为形态 oracle"，同 `SI-14` 对恒定在场的要求，C-11）。
- **张力如实登记（不静默）**：`read-context.ts` 的 echo 键集被注释声明为「冻结裁决附件钉着它」
  （`src/kernel/read-context.ts:41`），而 D2-b（C-16）与 SI-13（C-10）已把 `resolved_cutoff` /
  `resolved_at_ms` 定为**必填**。本席判：**SI-13 与 D2-b 优先**，键集须扩这四键；扩键动作落他席
  （`CONTRACTS.md` §16.3 / EA-7.2 的键集附件），登记于 BF-04，本席不改他席文件、不静默宣称已过。
- **不发**：head 数值、`committedHead - resolvedCutoff` 差分、提交总数、事件序区间、任何由被屏蔽集基数派生
  的量（C-14 教训 + SP-03/D1-d）。缺省截点下 `resolved_cutoff` 恒等于当时 head——这是 SI-13 的既有要求，
  属 D-12 已登记的已知交叠处，本席不新裁（§8 BF-08 观察项）。

### 2.4 读方法形状

```ts
interface KernelReadPorts {
  /** 双时间快照面。判据序固定：① 归属/路由 ② 可见性（本函数的 resolved_cutoff）③ 对象时间。 */
  readAsOf(spec: ReadContextSpec, page?: PageRequest): ReadResult;   // echo.resolved: ResolvedCutoff
  /** 已提交截点：读面缺省截点与投影水位的唯一来源。 */
  committedHead(): CommitSequence;
  /** 事件序水位：只供审计/对账/打开期判据，禁作缺省截点（CS-1.4 禁令 4）。 */
  ledgerEventWatermark(): LedgerEventSequence;
}
```

`Kernel.head`（`kernel.ts:663`，现返回 `meta.ledger_seq` 并铸 `CommitSequence`）按本契约**作废拆分**为
上述两个方法（BF-05）。`readSnapshot`/`readLatest` 的可见性谓词同样必须过 `resolved_cutoff`（一条判据
函数共用，§16.3 D-24 读侧同族）。

### 2.5 写回执与见证：只回事件轴（兑现 DEP-①-1 的正面对偶）

```ts
/** 写入口的见证回执 = 事件轴。不携带提交截点：携带 = 邀请当事务内当截点读回，回滚后成悬空游标。 */
interface WriteReceipt { readonly witnessEventSeq: LedgerEventSequence }
```

- **DEP-①-1 的兑现方式**：专题② 的回执行 `commitSequence` 由**机制**在提交账预留点同事务写入提交账派生值，
  **不**经写回执交回调用方再转交（C-18）。若专题② 需在读面确认 c1 已生效，判据 = `c1 ∈ commit_record`
  （I-6），不是"回执里那个数还在"。
- 现状需换轨的写面签名（BF-01/BF-02/BF-06）：`appendAuthoritativeEvent(...): CommitSequence`
  （`G1-UNIFIED-CONTRACTS.md:158-164`）、`declareRawIntake(...): CommitSequence`（EA:117 / UNIFIED:208）、
  `unlinkMount{mountId} → CommitSequence`（UNIFIED:222）、`FactDesignationCommandPort.witnessSeq`
  （UNIFIED:145）、`submitReport(...) → { reportId, recordedAt: CommitSequence }`（UNIFIED:274-275，
  即 D-5「一值两名」正身，C-13）。**修法统一**：这些位置返回的是**事件行**的号 ⇒ 改 `LedgerEventSequence`；
  确需同时给出截点的，另开显式字段 `commitSequence`，且必须来自提交账（不得来自预留值）。
- `AuthorizationContext.txSeq: CommitSequence`（C-17，"同事务内登记序"）语义即事件序 ⇒ 类型名换
  `LedgerEventSequence`（建议同步改名 `eventSeq`）；这是**九字段信封的类型名变化**，JSON 列与字节形态不变，
  但触及 EA-4.6 全形闸的字段类型判据 ⇒ 必须与 EA 席同步（BF-01）。

### 2.6 分页游标（G2 强制；本契约钉分量与轴）

```ts
interface Cursor {                       // 自包含，SI-51（C-11）
  readonly cutoff: CommitSequence;       // 截点分量：只许提交轴（CS-1.4 禁令 4）
  readonly position: { readonly oid: ObjectOid; readonly eventSeq: LedgerEventSequence }; // 页内位置：事件轴合法（U-4）
  readonly queryFingerprint: string;     // 查询指纹
  readonly authorityClass: string;       // 授权类标识；跨授权类提交 ⇒ 拒且不解释差异
}
```

- **重放禁止二次解析**：续页/重放一律用 `cutoff` 分量，**禁止**拿 `position.eventSeq` 当截点重开可见性、
  也禁止用当前时间/当前 head 重解析（C-11「游标跨越截点 → 拒绝并要求新查询」）。
- 事件序在游标里是**位置**不是**截点**——这是 §8 BF-09 对 D2-e 的补强句（「游标自包含截点」原文未区分
  游标内部的分量轴，落地时会把位置分量误用为截点）。

### 2.7 派生面与水位（D2-f 的载体钉死）

`CoverageReport.watermark`（`src/contracts/index.ts:189`）、投影水位（`projection_state` / `projection_cursor`，`sqlite-port.ts:172-179`）的量纲一律为 **`CommitSequence`**；**禁以事件序作水位**，
也**禁按事件逐条推进水位**——一个事务的事件分次消费 ⇒ 水位停在一个提交内部 ⇒ 报出「已应用到某事务的一半」，
这是本缺陷在派生面的镜像形态。派生面的消费单位 = **整提交**（原子对齐，C-05）。BF-10。

### 2.8 错误模型（封闭集**零扩员**）

| 场景 | 码 | 复用论证（§14.2 纪律：同码不同 `detail.reason` 而非新码） |
| --- | --- | --- |
| `AsOf` 形态非法（裸整数 / 未知 branch / 缺载荷 / 缺 `asOf` 之外的必需字段） | `CONTEXT_INCOMPLETE` | 既有语义「未声明截点 = 未定义查询」（`contracts/index.ts:115`）；`detail={missing|reason:'as-of-shape-unknown'}`，不回显任何序号 |
| 截点越界（`c > committedHead`、负数、非整数） | `READ_CUTOFF_UNSAFE` | 该码既有（`contracts/index.ts:131`「读取截点无法满足一致性要求」）**实测零使用者** ⇒ 本契约收编为其首个使用面；`detail={reason:'cutoff-beyond-committed-head'}`，**不含** head（禁令 6） |
| 跨空间截点/游标 | `CROSS_SPACE_REFUSED` | 既有（SP-04），零扩员 |
| 游标跨授权类 | `CONTEXT_INCOMPLETE`（同形，不解释差异细节） | C-11 要求「拒且不解释差异细节」⇒ 不给真因词；登记观察项（与 D1-c 同形纪律同源） |
| 打开期不变量违例（I-1/I-3/I-4/I-5） | `SCHEMA_UPGRADE_REQUIRED` | 与 F5b 同族同码（`sqlite-port.ts:408-419`） |

新增 `RefusalCode` **0 枚**（夹具 S8 断言：夹具使用的码集 ⊆ `src/contracts/index.ts` 逐字提取的封闭集，
且新增数 = 0）。

---

## 3. CS-3 墙钟解析与时钟回拨：已解析截点固定（裁决项 ③）

### 3.1 定义：提交账上的**运行最大前缀界**

对提交账按 `commit_sequence` 升序，令 `M(c) = max{ commit_recorded_at_ms(c′) : c′ ≤ c }`（**运行最大**）。

> **CS-3.1**　`cutoff(t) = max{ c ∈ committed ∪ {0} : M(c) ≤ t }`；集合为空 ⇒ `c = 0`（空视图）。

**三条立即可证的性质**（夹具 T-P6/T-P7/T-P8 逐条钉死，非愿望）：

- **P1（单调）** 提交账只追加 ⇒ 旧元素的 `M(c)` 永不变 ⇒ 同一 `t` 的解析结果对数据库状态**单调不减**：
  只会**不变或前移**，**永不回退**。⇒ 「后续提交携带更早 `recorded_at`」**不可能**使历史截点后退；
  它也不可能越过 `M` 的断点向前跳。
- **P2（原子闭合）** 解析结果永远是某个**已提交事务**的边界（`c ∈ committed ∪ {0}`），**永远不是**事务内部
  ⇒ 按 `c` 过滤得到的可见集恒等于「该次提交完成瞬间的完整可见集」。
- **P3（视图纯函数）** H 与 `domain_state` 均 append-only ⇒ 可见集是 `c` 的**纯函数**：新提交不改变任何
  已解析 `c` 的视图字节。**回拨既不改已解析截点，也不改已解析截点上的视图**。

**「已解析截点固定」的规范句**（裁决项 ③ 的正面答复）：

> **CS-3.2**　墙钟条件 → 截点的解析在一次逻辑读（一次请求 + 其全部分页 + 其重放）的**入口发生且只发生
> 一次**；解析结果 `resolved_cutoff` 随响应回显（CS-2.3）并被游标自包含携带（CS-2.6）。该逻辑读的**全部
> 后续操作只用已解析截点**，禁止二次解析、禁止回落当前时间、禁止用新到的提交改写已解析值。
> 全新的一次独立解析**允许**得到更大截点（新提交已发生，这是如实呈现，P1），但**绝不**得到更小截点。

### 3.2 六情形封闭表（五情形 + 冒充支；含 T-GAP-13 要求的两个分支；机读块 ↔ 夹具 S4）

<!-- CS-3 CASES-BEGIN -->
```
case_id | 场景                          | 已解析截点的行为（规范取值）
late-arrival   | 晚到提交（其墙钟 ≤ t 的新提交在解析之后到达）  | 同一逻辑读不变（CS-3.2）；新的独立解析可前移，且新落入的行携「补录」标注（D2-d）
clock-rollback | 后续提交携带更早 commit_recorded_at_ms        | 不回退、不跳跃（P1）；已解析视图字节不变（P3）
same-millisecond | 同一 commit_recorded_at_ms 有多个提交      | 毫秒界闭合：该毫秒的**全部提交**都进截点（c = 该毫秒最后一个**提交**，不是最后一个事件）
no-commit-at-millisecond | 该时刻（或早于一切提交）无提交      | c=0 空视图 + resolved_at_ms=null；若 t 落在两提交之间 ⇒ 落此前最后一个提交
out-of-range   | commit-sequence 支越界（c>committedHead 等）  | 拒 READ_CUTOFF_UNSAFE（§2.8）；不钳制
impersonation  | 拿事件序数值冒充提交序传入                    | 只可能命中另一个合法提交边界，永不可达事务内部（CS-1.4 结构性论证）
```
<!-- CS-3 CASES-END -->

- **同毫秒多提交**在提交粒度下是**平凡**的：一个提交一枚墙钟，「该毫秒的最后一个提交」是良定义的单值；
  D2-b 原句「cutoff=该毫秒最后一个提交」在本席载体下由比喻变成字面量（CS-4 行 1）。
- **回拨与「保守不前移」的边界**：若某提交 `c₃` 墙钟早于 `t`，但前缀里 `c₂` 的墙钟晚于 `t`，则
  `cutoff(t) = c₁`——`c₃` 在 `t` 视图**不可见**，直到出现 `t′ ≥ M(c₃)`。这不是 bug 而是选择：**宁可保守
  不前移，也不让"提交时刻晚于 t"的事实在 t 视图里出现**（D2-c「乱序时间只让 cutoff 保守不前移」的落地）。
- **补录标注**（D2-d）的推导键换轨为提交轴：某行在 `t` 视图携「补录」⇔ 该行的 `commit_sequence` 晚于
  「按所述对象时间提问时同一读者所能看到的截点」（D2-d 原句写「该行登记提交序」，载体由事件序改提交序，
  CS-4 行 3）。

### 3.3 消灭一个前瞻洞：同一提交跨毫秒

若墙钟解析**逐行**消费事件的 `recorded_at`（现状**每个写点各自取一次时**：`kernel.ts:478`/`:905`/`:1001`/
`:1187`/`:1231`/`:1297`/`:1351`/`:1424` 各是独立一次 `Date.now()`），则**同一事务内两行的墙钟可落在毫秒两侧** ⇒ 一个墙钟条件可以把**一次
原子提交从中间切开**——这与「按事件序过滤」是**同一个缺陷的第二把刀**，且是 D2-b 现文本
（「…的登记的 `recorded_at` 全部 ≤ t」，C-16）按事件粒度直读时的必然结果。

> **CS-3.3**　墙钟解析**只消费提交账的 `commit_recorded_at_ms`（一提交一枚）**，**禁止**逐行取
> `ledger.recorded_at` 参与截点解析。事件行的 `recorded_at` 降为展示与映射输入（D2-a 原口径不变）。

夹具 T-P9 用「同一事务内两事件墙钟被人为拉开到毫秒两侧」的语料钉这条；MUT-2 给出架空形态（逐行取
`recorded_at`）必红。

### 3.4 与 D2-f / Q42 的接合

正式业务视图的三形态（D2-f 已裁）不变；本席只钉一句：**「带可核验水位的物化」的水位与读面截点同轴同域**
（`CommitSequence`）。物化停在一个提交内部 ⇒ 水位不可核验（它指认的不是任何读者能请求的状态）。

---

## 4. CS-4 与既有 D2 六情形的逐条对齐（裁决项 ④；登记，不改他席文件）

| 行 | 本席判 | ADJ 原裁定的关键短句（C-16） | 逐条对齐结论 | 需回填的**具体文字**（去向 §8） |
| --- | --- | --- | --- | --- |
| **0（§2.0 命名表）** | **需修订** | 「`commit_sequence`（线格式/DDL 名）↔ PoC 物理载体 = `meta.ledger_seq` 事务内计数器（CONTRACTS ST-4）」 | 这半行把提交轴键名钉在事件轴载体上，是缺陷的**登记处本身**。作废并替换为「↔ `meta.commit_sequence` + 提交账 `commit_record`；事件轴另名 `LedgerEventSequence`/`ledger_event_seq`」 | BF-00 |
| **D2-a** | **需修订（补强）** | 「`commit_sequence`（提交顺序 = 唯一快照边界）」「`recorded_at`…只作展示与映射输入」 | 三概念分离**采认**，但「提交顺序」在旧载体下就是「每事件 +1 的登记序」⇒ 单快照边界形同虚设。需补：唯一快照边界 = **已提交事务**的序；事件序**不是**快照边界；且 `recordReport` 返回形状的 `recordedAt` 与 `seq` 分轴（D-5 收口） | BF-01、BF-06 |
| **D2-b** | **需修订（定义域换轨）** | 「cutoff(t) = **最大 c，使提交序 ≤ c 的登记的 recorded_at 全部 ≤ t**（前缀界；空 ⇒ c=0 空视图）」「同毫秒多提交 ⇒ 毫秒界闭合、该毫秒全部提交可见（cutoff=该毫秒最后一个提交）」「响应 echo 必填（SI-13）：{input_recorded_as_of, resolved_cutoff(commit_sequence), resolved_at_ms}」 | 前缀界形态**采认**；但「登记的 `recorded_at`」是**事件级**取值 ⇒ 必须改为**提交账级** `commit_recorded_at_ms`（CS-3.3 理由）；两分支取值**形态不变**（CS-3.2 表）；三键中 `resolved_cutoff` 的量纲钉死为提交轴，`input_recorded_as_of` 收敛为 `as_of_input`（两支共用，CS-2.3） | BF-04、BF-09 |
| **D2-c** | **需修订（补强，非推翻）** | 「截点比较只走 `commit_sequence`」「recorded_at 允许乱序展示，**禁按 recorded_at 排序/去重/判等**」「D2-b 的前缀界定义天然吸收回拨（乱序时间只让 cutoff 保守不前移）」 | 方向**采认**；补三点：① 载体此前是事件序，故「只走 commit_sequence」此前**空转**，本席给出真载体；② 「禁按 `recorded_at` 排序」不含事件序——事件序是**排序键**（U-1/U-4），否则游标无全序（CS-2.6）；③ 「天然吸收回拨」需写成可执行性质 P1/P2/P3 + 「已解析截点固定」CS-3.2 | BF-09 |
| **D2-d** | **需修订（推导式换轨）** | 「推导 = 该行登记**提交序**晚于『按所述对象时间提问时所能看到的提交序』」 | 「提交序」此前歧义（事件序/提交序两读均通）⇒ 两处均钉 `commit_sequence`；「标注面未写」这一未闭合项**保持未闭合**（去向不变，本席不代裁标注形态） | BF-09 |
| **D2-e** | **需修订（补一句）** | 「游标自包含（commit_sequence 截点 + 查询指纹 + 授权类标识），重放用自包含截点不用当前时间；超上限拒」 | **采认**；补：游标内部**截点分量与页内位置分量分轴**（位置分量可含 `ledger_event_seq`，但禁止被当截点重开可见性，CS-2.6），否则实现会把位置分量误用为截点 | BF-09 |
| **D2-f** | **需修订（量纲补注）** | 「正式业务视图只许三形态：截点一致即时计算／同步物化／带可核验水位的物化」 | **采认**；补：水位的**轴与域** = `CommitSequence`（CS-2.7），派生面消费单位 = 整提交 | BF-10 |

**六行全覆盖，逐行给出结论；无一行判「不需修订」**——因为六行的比较键全部落在被本席判为错误载体的
`meta.ledger_seq` 上（C-15），措辞未改而行已换轴。

**同时采认、不重开的既有裁决**（本席不推翻）：D2-b 的前缀界形态与「空 ⇒ c=0」、D2-d 的晚到不可见性
（`tests/rv09-*` 已实测）、D2-e 的自包含+超上限拒、D2-f 三形态、D1-c/D1-d 的同形与泄露封闭清单
（本席 §2.3/§2.8 的 detail 禁令即其推论）、Q40 单 Space 原子提交（本席是它的**实现前提**而非修订）、
D27-5「提交期失败零残留、序号不留 ghost」。

---

## 5. CS-5 与 PoC 现状的差（如实登记；本席不改 `src/**`）

| 面 | 现状（工作树实测） | 契约要求 | 差 |
| --- | --- | --- | --- |
| 品牌类型 | `contracts/index.ts:43` 单一 `CommitSequence` 承载两轴 | 两品牌分立（CS-1.1） | 拆分 + 逐使用点重判（BF-03） |
| 发号 | `kernel.ts:777-780 nextLedgerSeq()` 每写点各调一次（`:467`/`:895`/`:995`/`:1180`/`:1218`/`:1265`/`:1339`/`:1416`，共 8 处） | 另立 `nextCommitSequence()`，**每事务一次**，首写前预留 | 机制缺一个发号点；现网 `meta` 亦无 `commit_sequence` 键（`sqlite-port.ts:17-18` 只种 `id_counter`/`ledger_seq`） |
| 水位 | `kernel.ts:663 get head()` 读 `meta.ledger_seq` 铸成 `CommitSequence` | 拆 `committedHead()` / `ledgerEventWatermark()`（CS-2.4） | 现网名与类型都在说谎 |
| 可见性 | `read-context.ts:100-101 where recorded_seq <= ?`（C-19） | `commit_sequence <= resolved_cutoff`（禁令 2） | **缺陷正身** |
| 缺省截点 | `read-context.ts:61-62`「`const cutoff = (spec.recordedAsOf ?? head) as CommitSequence;`」 | `?? committedHead()` | 缺省值来源换轴 |
| 回显 | `read-context.ts:139-144` 九键，截点位是 `usedRecordedAsOf`（事件序） | 四键（CS-2.3），截点位是提交序 | 键集扩 + 量纲换轴（BF-04） |
| 归属列 | `ledger` 无提交归属列；`domain_state` 只有 `recorded_seq` | H 行携 `commit_sequence`；提交账存在 | G2 DDL + `SCHEMA_VERSION` 推进（现值 7，`sqlite-port.ts:292`）+ 触发器摘要重锚（打开路径逐触发器 sha256，同文件） |
| 一值两名 | `kernel.ts:1377`「`return { reportId, recordedAt: seq, seq };`」（D-5，C-13） | 分轴（CS-2.5） | 返回形状改 |
| 打开期 | F5b 只管 `max(ledger.seq) ≤ meta.ledger_seq` | 加 I-1（等号）+ I-3/I-4/I-5 | 判据缺三条 |
| 迁移面 | `sqlite-port.ts:223-263 migrateLegacyRecords` 复用同一 `meta.ledger_seq` 计数器 | 迁移器一切写事务同样过提交序分配点 | 登记于 BF-07 |

---

## 6. CS-6 正反例表（可执行判据；与夹具逐一对账，id 双向一致）

| id | 正/负 | 场景 | 期望判定 | 可执行断言形状 | 真库 |
| --- | --- | --- | --- | --- | --- |
| T-P1 | 正 | 一次原子提交登记三事件（事件序 1/2/3），提交序 c=1 | 提交后 `cutoff=1` ⇒ 三行**全见**；不存在任何合法截点给出「前两行」 | 「visible(1)=3 行 ∧ visible(0)=0 行 ∧ ∀c∈[0,head+2]: visible(c) ∈ 快照集族」 | ✅ |
| T-P2 | 正 | 事务内预留 c=1 与事件 1/2/3 后 **回滚** | 读面零痕迹、两水位皆回 0、下一提交**复用** c=1（无 ghost，C-12 同族） | 「a 连接可见 0 行 ∧ meta.commit_sequence=0 ∧ meta.ledger_seq=0 ∧ commit_record 0 行 ∧ 下次提交 c=1」 | ✅ |
| T-P3 | 正 | 水位守卫 | 下调 `meta.commit_sequence` 被 `META_COUNTER_MONOTONICITY` 拒（既有泛化触发器自动覆盖第三键） | 「update→abort 且信号词=META_COUNTER_MONOTONICITY」 | ✅ |
| T-P4 | 正 | 提交期失败注入（COMMIT 前抛错） | 与回滚**同形**：水位不动、零行残留（D27-5 零残留同族） | 「注入后 head/行数 与注入前逐等」 | ✅ |
| T-P5 | 正 | 值域封闭（I-6） | 可解析截点集 = `{0} ∪ 提交账键集`；解析器**不**读 `meta` 水位 | 「resolveSet(committed)= {0..head} ∧ resolveSet 不随 meta 水位前跳而变」 | ✅ |
| T-P6 | 正 | 墙钟解析单调（P1） | 追加新提交（含更早墙钟）后重解析同一 t ⇒ 结果**不变或前移**，绝不回退 | 「∀追加: cutoff′(t) ≥ cutoff(t)」 | 模型 |
| T-P7 | 正 | 已解析截点固定（CS-3.2） | 游标重放/续页跨「晚到墙钟提交」不重不漏；重放不重解析 | 「replay(cursor)=第一次的同截点集 ∧ 事件集不增不减」 | 模型 |
| T-P8 | 正 | 同毫秒多提交 + 无提交时刻 | 同毫秒 ⇒ 毫秒界闭合（该毫秒全部提交可见）；`t` 早于最早提交 ⇒ `c=0`+`resolved_at_ms=null` | 「cutoff(t_ms)=该毫秒最后一个提交 ∧ cutoff(t_early)=0 ∧ resolvedAtMs=null」 | 模型 |
| T-P9 | 正 | 同一提交跨毫秒（CS-3.3） | 事务内两事件行 `recorded_at` 被拉开到毫秒两侧 ⇒ 任一墙钟条件**不切开**该提交 | 「∀t: 该提交两行要么同见要么同不见」 | ✅ |
| T-N1 | 负 | `commit-sequence` 支越界（c>committedHead / 负 / 非整数） | 各拒 `READ_CUTOFF_UNSAFE`；detail **不含** head | 「码命中 ∧ keys(detail) 无 head/total/区间」 | 模型 |
| T-N2 | 负 | `AsOf` 形态非法（裸整数、未知 branch、缺载荷） | 拒 `CONTEXT_INCOMPLETE`，`reason='as-of-shape-unknown'` | 「码命中 ∧ detail.reason 命中 ∧ 无序号出现」 | 模型 |
| T-N3 | 负 | 游标跨授权类 | 拒且**不解释差异细节**；同形 | 「两授权类下响应字节等 ∧ 无真因词」 | 模型 |
| T-N4 | 负 | **冒充**：把事件序数值当提交序传入（枚举 1..事件head） | 每次解析都落回**某个完整提交前缀**；永不可达事务内部 | 「∀k∈[1,eventHead]: visibleByCommit(resolve(k)) ∈ 快照集族 ∧ 无真前缀」 | ✅ |
| T-N5 | 负 | 回填式分配（提交后再 `update ledger set commit_sequence=?`） | 撞 `HISTORY_IMMUTABLE` ⇒ 分配点只能在行插入之前（CS-1.2「为什么不是别的」） | 「update→abort 且信号词=HISTORY_IMMUTABLE」 | ✅ |
| T-N6 | 负 | 可见性判据形状扫描 | 形如 `recorded_seq <= ?` / `l.seq <= ?` 的过滤谓词在契约允许集中 ⇒ **不允许**；现状 `read-context.ts` 逐字形态被点名 | 「forbiddenPredicateShape(现网 SQL)=true ∧ allowedShape(commit_sequence <= c)=true」 | 文本 |
| T-N7 | 负 | 派生面水位按事件推进（停在提交内部） | 判非法：水位值 ∉ 可解析截点集 | 「watermark ∈ resolveSet 否则红」 | 模型 |
| T-N8 | 负 | 回显越界信息（detail 带 head 或差分） | 判非法（禁令 6 / C-14） | 「echo/detail 全文无 head 数值 ∧ 无差分」 | 模型 |

### 6.1 架空判据变异（常驻不删；方向恒为「真判据拦住 ∧ 架空放过同一负例」）

| id | 架空形态 | 被谁捕获 | 真库 |
| --- | --- | --- | --- |
| MUT-1 | **把判据改成用事件序过滤**：可见性谓词换成现网逐字 SQL「`where recorded_seq <= ?`」（C-19）⇒ 在 T-P1 的同一份数据上，存在截点取值给出「只见前两行」的**从未原子提交过的中间态** | T-P1/T-N4 的快照集族判据在 MUT-1 下必红（夹具自验两向：真判据无中间态、架空判据产出中间态） | ✅ |
| MUT-2 | 墙钟解析**逐行**取事件 `recorded_at`（非提交账 `commit_recorded_at_ms`） | T-P9 语料在 MUT-2 下把一个提交切开 ⇒ 必红 | ✅ |
| MUT-3 | 提交序分配点搬到 **COMMIT 之后**（回填式） | T-N5 真库撞 `HISTORY_IMMUTABLE` ⇒ 该形态不可实现，判「条文与物理不可同真」⇒ 必红 | ✅ |
| MUT-4 | 已解析截点**每页重解析**（游标回落当前时间） | T-P7 在 MUT-4 下重放漏项 ⇒ 必红（C-11 SI-51 的机验化） | 模型 |
| MUT-5 | 提交序按事件 +1（即现状 `meta.ledger_seq` 一值兼两职） | T-P1 的「不存在截点给出真前缀」在 MUT-5 下不成立 ⇒ 必红 | 模型 |

### 6.2 实测记录（本席位落笔时实跑，非计划）

```
$ node experiments/v3-code-architecture-poc/g1/G1-CONTRACT-COMMIT-SEQUENCE.fixtures.mjs
CS 夹具：PASS 50 / FAIL 0
exit 0
```

- 环境：`node v24.21.0` + `node:sqlite` 的 `DatabaseSync`；临时库落在仓库 `.scratch/g1-cs-fix-*`
  （`.gitignore` 内，跑完 `rmSync`），WAL + 读写两条连接。DDL 由 `src/storage-sqlite/sqlite-port.ts`
  **正则逐字提取**（`meta` 及其两个守卫、`ledger` 及其两个守卫、`domain_state` 及其 UPDATE 守卫），
  提交账与归属列以**夹具形状**附加（**不是生产 DDL**）。
- 真库关键读数：① 事务内预留 `commit_sequence=1` + 事件 `1/2/3` 后 `rollback` ⇒ 另一连接读到
  `meta.commit_sequence=0`、`meta.ledger_seq=0`，且 `ledger`/`commit_record`/`domain_state` 均 0 行；
  ② 紧随的成功提交**复用** `commit_sequence=1`、事件序仍是 `1/2/3`（稠密、无 ghost，C-12 同族）；
  ③ 枚举截点 `0..4` 的可见集恒等于某个已提交快照，**不存在**给出「只见前两行」的截点；同一份数据上把
  判据换成事件序过滤（MUT-1）即在 `k=2` 处产出从未原子提交过的中间态；④ 把 `meta.commit_sequence`
  **前跳**（既有触发器只拦下调）⇒ 提交账键集不变（解析器未读水位），而 I-1 的**等号**判据识破该 ghost；
  ⑤ `update meta set value = 0` 对第三个计数器键同样被 `META_COUNTER_MONOTONICITY` 拒（既有触发器是
  泛化形，无需新写）。
- 同时实测到一个**真实缺口**（登记 BF-07，本席未改码）：既有 `meta_ledger_seq_no_delete` 只钉
  `old.key='ledger_seq'` ⇒ `delete from meta where key='commit_sequence'` 现状**不被拦**。G2 落地第三个
  计数器键时必须一并扩守卫；夹具 S12 钉住该现状，守卫补上后该项须 repin 为「两键同拒」。

---

## 7. 一句话版与 Port 签名（回报口径速查）

- **定义一句话版**：见 CS-1.1 末「一句话版」。截点是**已提交事务**的稠密序号；事件序只是 H 内的排序号，
  **永不可作截点**。
- **Port 签名**：CS-2.1（`AsOf` 两支 + `ReadContextSpec.asOf`）、CS-2.2（`resolveCutoff` + `ResolvedCutoff`）、
  CS-2.4（`readAsOf` / `committedHead` / `ledgerEventWatermark`）、CS-2.5（`WriteReceipt.witnessEventSeq`）、
  CS-2.6（`Cursor`）。

---

## 8. 需要他席回填的清单（登记不删；本席未改任何他席文件）

| id | 他席文件/位置 | 需要回填的内容 | 性质 |
| --- | --- | --- | --- |
| BF-00 | `G1-ADJUDICATION-TABLE.md` §2.0 对应表「`commit_sequence`」行（C-15） | 替换「PoC 物理载体 = `meta.ledger_seq` 事务内计数器」为「`meta.commit_sequence` + 提交账 `commit_record`」；新增 `LedgerEventSequence`/`ledger_event_seq` 一行 | 裁决表命名表修订（我方契约层） |
| BF-01 | `G1-CONTRACT-EVENT-AUTHORITY.md:341`（EA-4.2 九字段 `txSeq`）、`:117`（EA-1.3 `declareRawIntake` 返回） | 类型名 `CommitSequence` → `LedgerEventSequence`（建议 `txSeq`→`eventSeq`）；**九字段名单与 JSON 列不变**，但 EA-4.6 全形闸的类型判据与夹具 S 组须同步重锚 | 跨席契约类型名换轨 |
| BF-02 | `G1-UNIFIED-CONTRACTS.md` P4（:145 `witnessSeq`）、P5（:158-164）、P6（:208）、P7（:222）、P9（:274-275） | 同上：见证/登记类返回值换 `LedgerEventSequence`；`recordReport`/`submitReport` 的 `recordedAt` 与序号分轴（D-5 收口） | 汇编层 Port 换轨 |
| BF-03 | `src/contracts/index.ts:43`（品牌）、`:181`（`ReadContextSpec.recordedAsOf`）、`:273`（`recordedAt`） | 新增 `LedgerEventSequence` 品牌；`recordedAsOf?: CommitSequence` → `asOf?: AsOf`；逐使用点重判轴归属 | G2 代码批（PR-4） |
| BF-04 | `CONTRACTS.md` §16.3 / EA-7.2 的 **echo 键集附件**（现状声明见 `read-context.ts:41`「echo 键集保持不变（冻结裁决附件钉着它）」） | echo 键集增四键 `as_of_input/resolved_cutoff/resolved_at_ms/cutoff_defaulted`；`usedRecordedAsOf` 退役；扩键的登记义务同 §14.2 先例 | 键集冻结附件 + 登记义务 |
| BF-05 | `src/kernel/kernel.ts:663`（`get head`）、`:738`/`:727`（`uow`/`uowFor`） | 拆 `committedHead()`/`ledgerEventWatermark()`；`uow` 内新增提交序预留单点 + COMMIT 前落提交账行（`tx.checkRequiredRefs()` 之后、commit 之前是自然插入点） | G2 代码批 |
| BF-06 | `src/kernel/kernel.ts:1377`（`recordReport` 返回 `recordedAt: seq`）、8 处写点 `:467/:895/:995/:1180/:1218/:1265/:1339/:1416`、取时点 `:478/:905/:1001/:1187/:1231/:1297/:1351/:1424` | 写回执换事件轴；每事务一次提交序预留，禁止在写点内二次发提交号；**提交墙钟一事务一枚**（在预留点取一次 `Date.now()` 供 `commit_record.commit_recorded_at_ms`），各行的 `ledger.recorded_at` 保持现状但不再参与截点解析（CS-3.3） | G2 代码批 |
| BF-07 | `src/storage-sqlite/sqlite-port.ts:17-18`（`meta` 种子键）、`:28-30`（DELETE 守卫只钉 `ledger_seq`）、`:292`（`SCHEMA_VERSION=7`）、`:408-419`（F5b）、`:223-263`（迁移器复用同一计数器） | 种子键加 `commit_sequence`；**DELETE 守卫对第三计数器键现状不拦 ⇒ 缺口**（本席实测：夹具 S12）；`commit_record` 表 + 归属列 ⇒ `SCHEMA_VERSION` 推进 + 触发器 sha256 重锚；打开期加 I-1（等号）/I-3/I-4/I-5；迁移器写事务同过分配点 | 存储面（含一个真实守卫缺口） |
| BF-08 | 观察项（不改条文）：缺省截点回显恒等于当时 head | D-12 已登记该泄露面；D1-d/SI-13 的交叠处需一次统一裁（本席不新裁，避免与他席抢判） | 观察项（M-系列同形态） |
| BF-09 | `G1-ADJUDICATION-TABLE.md` D2-b/c/d/e 行（C-16） | §4 表中各行的「需回填的具体文字」（定义域换轨、事件序合法排序、P1/P2/P3 + CS-3.2、补录推导键、游标分量分轴） | 裁决表正文修订 |
| BF-10 | `G1-ADJUDICATION-TABLE.md` D2-f 行 + 投影面（`projection_state`/`projection_cursor`/`CoverageReport.watermark`） | 水位轴与域钉 `CommitSequence`；派生面消费单位 = 整提交 | 裁决表 + 投影面 |
| BF-11 | `G1-ACCEPTANCE-MATRIX.md`、`G2-DEV-PLAN.md` W4（`:61`）/PR-4（`:277`）（C-20）、`G1-RECONCILIATION-CHECKLIST.yaml` `G1-TIME-01`/`G1-TIME-02` | 新增 CS 条款的验收行（T-P*/T-N*/MUT-* 归属）；PR-4 范围补「提交账 + 两序分离 + 归属列 + 谓词换轨」；两条 TIME 条目的 `evidence` 指向本文件 | 矩阵/计划/清单登记（本席未碰 YAML 与校验器） |
| BF-12 | `G1-CONTRACT-DOMAIN-COMMAND.md:174`/`:221`（`CommandReceipt.witnessSeq`） | 类型换 `LedgerEventSequence`；「不返回信封对象」条款不变 | 跨席类型换轨 |
| BF-13 | `G1-CONTRACT-IDEMPOTENCY.md` DEP-①-1/2/3（C-18） | **本席已兑现**：DEP-①-1 见 CS-2.5（`commitSequence` 由机制从提交账产出，不经写回执）；DEP-①-2 见 CS-3.1 P1/P3（c1 截点解析不做 `recorded_at` 重算，且时间戳重排不影响已解析截点稳定性）；DEP-①-3 见 I-6 + CS-1.7（`resultRef` 在 c1 截点可解析 ⇔ `c1 ∈ commit_record`，永久成立） | 依赖兑现（请专题② 席位复核后自行改状态） |

---

## 9. 真·用户决策：**无**

| 本席遇到的岔口 | 归属 | 为什么不是用户决策 |
| --- | --- | --- |
| 提交序按 Space 还是按全局/按 capability | 技术裁决 | Space = 文件 = 事务边界是既有事实（C-04/C-05）；Q40 原子性只在此粒度下可表达，无可选项 |
| 分配点在首写前还是 COMMIT 前 | 技术裁决 | 由 H append-only 触发器物理决定（T-N5 实测），非偏好 |
| 越界截点拒 vs 钳制 | 由既有条文决定 | C-11「拒绝而非钳制」已裁 |
| 新拒绝码 | 本席裁 0 枚 | 封闭集扩张是汇编层纪律，本席无授权也无需要 |
| 是否为此改动 V1 冻结面 / 科研语义 | 不涉及 | 本席只动机制侧车载体，V1 面零接触；科研时间语义（`described_at`）解释面不碰 |
| 补录标注的**呈现形态** | 未闭合，非决策 | D2-d 原行已记「标注面未写」，保持未闭合（不代他席裁） |

⇒ **本专题不需要用户裁决**；需要的是 §8 的他席回填与 G2 落码。

---

## 10. 本契约的变更纪律

1. **载体不得回退到事件轴**：任何把 `resolved_cutoff` / 游标截点分量 / 水位重新落在 `recorded_seq`/`seq`
   上的改动 = 本契约作废重裁，不是「兼容性调整」。
2. **两轴不得再次合并为一个品牌**：合并一次，本专题全部结论失效（这是把「名字」当「判据」的复发形态）。
3. 新增读面截点入参分支须走本文 §2.1 封闭集修订 + 一次新负例（禁「多一个更细的截点」的诱惑——事件序支
   就是那个诱惑）。
4. 架空变异 MUT-1…MUT-5 **常驻夹具不删**；判据收紧时只允许增加变异，不允许以「已修好」为由删除自验。
5. 本文任何判据若要落到 `schema/**` 或 8 份根文档，必须走冻结变更流程（`AGENTS.md` §5）——**那是另一张
   单子，不在 G1 侧车里**。
