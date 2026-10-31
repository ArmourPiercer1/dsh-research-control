# RE-REVIEW-G1-ENG —— G1 契约独立工程实现性审查（第六席·工程面）

> **席位**：独立工程实现性审查者（领域正确性另有席位，本席不重复、不重开已批准 Q1–Q45）。
> **对象**：`experiments/v3-code-architecture-poc/g1/**` 全部 + 现存实现 `src/**` + 门禁
> `g0-gate.mjs` / `gate-causes.mjs` / `g1-checklist-validate.mjs` / `BASELINE.json` / `AUTHOR_ANCHOR.json`。
> **工作树**：分支 `g1/contracts-20261031`，HEAD `243f8f4`（工作树含矩阵/统一契约/G2 计划三处未提交改动 +
> 本席目录内领域席位文件；本席未改任何被测文件，全部实跑取文即当时工作树状态）。
> **计数**：**P0 = 0；P1 = 3；P2 = 3**。

## 0. 基线实跑（先于任何一条发现）

| 命令 | 退出码 | 关键输出 |
| --- | --- | --- |
| `node g0-gate.mjs` | 0 | 作者 225 全绿与身份锚四项逐等；attacks 与基线**完全一致（33 已知红 / 100 过 / 总 133）** |
| `node g1/G1-CONTRACT-FACET.fixtures.mjs` | 0 | 35 PASS / 0 FAIL |
| `node g1/G1-CONTRACT-EVENT-AUTHORITY.fixtures.mjs` | 0 | 48 PASS / 0 FAIL |
| `node g1/G1-CONTRACT-RELOCATION.fixtures.mjs` | 0 | 57 PASS / 0 FAIL |
| `node g1-checklist-validate.mjs` | 0 | items=27 open=23 done=4 违规=0 |
| `node g1-checklist-validate.mjs --require-clear` | 1 | 预期红（NO-GO 阶段） |
| `node g1-checklist-validate.mjs --self-test` | 0 | 变异自验 17/17（M1–M17） |
| `node ../../scripts/snapshot-release.mjs` | 0 | 31 canonical files match SNAPSHOT.md |

计划/矩阵引用的门禁计数（48/35/57、17 变异、31 快照文件、225/33/100）与工作树实测**全部一致**。

---

## E1 可实施性 —— 1 × P1

### 【P1-1】RL-5.1 切换事务第 3 步被现存 `domain_state_no_update` 触发器当场拒绝；P-07 锚点对该触发器的陈述**在其自称基准提交上即为假**；RL-5.2 的「不相容恰两处」不成立

- **条文要求**：`G1-CONTRACT-RELOCATION.md:376`（RL-5.1 步骤 3）「物理重映射：对每个
  `RELOCATABLE_NS_KEYS` 表，ns=fromNs 的行位置键改为 toNs（**UPDATE 位置键列**）」；清单现形全集
  = `{domain_state}`（`G1-UNIFIED-CONTRACTS.md:327-329`，R-3 收窄后）。
- **代码现状**：`src/storage-sqlite/sqlite-port.ts:202-205` 无条件触发器
  `domain_state_no_update`（`raise(abort, 'DOMAIN_STATE_APPEND_ONLY')`）拦截**一切** UPDATE；
  且该触发器在 `REQUIRED_TRIGGERS` 必备集内（同文件 `:297-301`，缺一个就不算同一套模式，
  包 6 起还比对体摘要）。
- **锚点失实**：`G1-CONTRACT-RELOCATION.md:61` 锚点清单自称「SHA 统一 `d2f19cc`，行号=工作树实测」，
  P-07 行（`:71`）却写「`domain_state` PK=(ns,oid,revision) 且**无不可变性触发器**」。实测：
  `git show d2f19cc:…/sqlite-port.ts` 的 L202/L204 **就有** `domain_state_no_update`/`no_delete`
  （d2f19cc 是 HEAD 祖先，`git merge-base --is-ancestor` exit 0）——锚点连自己的基准提交都没对上。
- ** exhaustiveness 失守**：`G1-CONTRACT-RELOCATION.md:390-392` RL-5.2 自称点名「现文的**两处**
  不相容」（只 `route_change_guarded`）；第三处（domain_state 冻结触发器）在全部 G1 文档
  （RL/EA/FM/UNIFIED/矩阵/计划）grep `domain_state_no_update|DOMAIN_STATE_APPEND_ONLY` = **0 命中**。
  讽刺的是**反向扫描判据自己的理由**（`G1-CONTRACT-RELOCATION.md:493-494`：挂载表「本就禁 UPDATE，
  真跑必炸」）逐字适用于 domain_state——同一把尺没量自己。
- **可重复反例**（复刻仓内 DDL 逐字）：
  ```
  node rl51.mjs   # 建 domain_state + no_update 触发器 → update domain_state set ns='nsB'
  RL51_EXIT=3     # 输出：RL-5.1 步骤 3 在现 schema 上被拒： DOMAIN_STATE_APPEND_ONLY
  ```
- **定性**：不是「根本做不出」——窄化触发器体（放行仅改 ns 的 UPDATE、内容/身份列仍 abort）+
  `REQUIRED_TRIGGERS` 摘要重登 + `SCHEMA_VERSION` 推进三件套有 RL-5.2 现成先例，**工程上可行**；
  但契约把唯一清单内表的必炸点漏出「不相容点名/改造范围」之外（`G2-DEV-PLAN.md:251` PR-8 触发器
  改造面只写 RL-5.2），PR-8 落码必撞墙且锚点会以「实测无误」的姿态误导实施者。**P1**。
- **同域其余怀疑点判「能做出」**：`route_change_guarded` ②「同事务先落 `ns-relocated` 再改路由」的
  BEFORE 触发器读 ledger 可见性 = 同事务未提交行可读，SQLite 成立，且同形判据
  （`directory_birth_audited`/`route_change_guarded` ② 查账在先）已在 225 例全绿下运行；
  `meta.ns_epoch` 单点推进在单写者 + `begin immediate` 下无并发问题（`meta_counter_monotonic`
  只拦降不拦升，`:128` 实测语义）；`facet_mount_insert_guarded`（FM-2.5）与现存出生审计同形；
  RL-4 gate 5 `TARGET_EMPTY` 走 PK 前缀 `(ns,…)` 索引，点查级。

## E2 判据可机验性 —— 无发现

抽验 10 行【机】行并读断言体（不只看文档）：EA S1/S1b/S2（名单三方/两方逐等——读契约正文源文本，
非自算期望）、EA T-P3（Raw 通道逐字段断言 + `mechanismWriteGate` phase 门真实生效，非恒真）、
EA T-P4/T-P5（`authorized=false` 仍 VERIFIED、同数不同集 digest 必不等、K=32 窗口落账语义各有
独立断言）、RL T-P10（挂载账 `JSON.stringify` 逐字节等 + 清单形状 + 扩展行随迁）、
RL T-N17（12 门封闭 + 集外取值必红）、RL T-N18（双向扫描两半 + MUT-9 判别力双断言）、
RL T-N19/T-N20（批准门 phase 正反两面 + 快照等式）、FM S6（对拍**真实读** `g1a-regression.test.ts`
源文与 `BASELINE.json` passes——跨文件非自证）。反向抽 3 个夹具实现用例（T-N15/T-N20/T-N21）
矩阵均有行。**断言体无一恒真、无一从被测实现现算期望**。已登记的诚实残体（锚未物化 ⇒「三方逐等」
实为两方；矩阵 §4 尾行 + 计划 §4.1 双登记）不重开。

## E3 G2 计划自洽性 —— 3 × P2（依赖图无环、Approved-By 落位正确）

- 依赖图（§1/§2 邻接）：**无环**；PR-0 无前置、其余全部可传递到 PR-0——「尺子最前」成立。
- 4 个 `Approved-By` 落位：`integrity-audit-recorded`/`read-shadow-recorded` → PR-2 进入门禁
  （`G2-DEV-PLAN.md:130-134`，消费点同段）；`ns-relocated` → PR-8（`:258-260`，消费点 `:254`）；
  `raw-record-declared` → PR-10（`:300-301`，消费点 `:296`）；A 侧两名 → PR-7（`:236-237`）。
  **均落在真正消费的 PR 上，无空转门禁、无无门禁消费**（PR-1 物化 `planned:true` 占位不构成运行时
  写消费）。**无发现**。
- **【P2-1】PR-9 冻结面行漏 `snapshot:update`**：`G2-DEV-PLAN.md:290` 写「是（新工具名 + 宿主权限面）
  ⇒ `Frozen-Face-Review`（和工具名清单和本 PR 同一提交）」，但工具名正源 `ARCHITECTURE.md` §7.2
  是哈希冻结面（`SNAPSHOT.md:16` 实测在列；`snapshot-release.mjs` 校验 31 文件）——按 `AGENTS.md §5`
  与本计划 §4.4（`:388-398`）「每次」模板必须同交 `pnpm run snapshot:update`；PR-2/5/7/8 都写了这条，
  PR-9（及 `:43` W9 行）没写。兜底在（`check:freshness` 自 PR-5 起入阶段门），故 P2 非 P1。
- **【P2-2】并行带自相矛盾**：§1 一行读法（`:46-47`：「`W3 ∥ W4`、`W6 ∥ W7` 是仅有的两条并行带」）
  与 §3.1（`:318`：「PR-3 ∥ PR-4 ｜ 前置条件：PR-2 已合入」）对 `W3∥W4` 的声明，同 §1 表 W4 行
  依赖列「W2、**W3**（游标要冻结的可见性谓词）」（`:38`）与 PR-4 自己的进入门禁「PR-3 退出码 0」
  （`:175`）+ 前置依赖「PR-2、**PR-3**」（`:180`）直接冲突——按 §3.1 只合 PR-2 就并行 PR-4，
  恰好把「把 oracle 形态编进工具面」（W4 行自己给的理由）变成现实。
- **【P2-3】计划行号引用漂移（三处）**：`G2-DEV-PLAN.md:127` 引 EA「不留豁免窗」句作 `:577-578`
  （实测在 `G1-CONTRACT-EVENT-AUTHORITY.md:694`）；`:158` 与 `:421` 引「夹具世界迁移登记（实施批）」
  作 `:613`（实测 `:728`）；`:55`/`:351` 写「变异 17（M1–M14）」（实测自验 17 个、编号至 M17）。
  矩阵有「锚点纪律/行号漂移限定」免责段（矩阵 `:15-17`），**计划没有**——计划通篇以「命令 + 退出码 +
  文件:行」立身，引用应按其自身纪律重锚。

## E4 门禁可信度 —— 1 × P1（新构造，第三次同族洗白）

- **【P1-2】`--require-clear` 终局谓词的锚只判形不判真：伪造锚即可把 27 条全洗成 done 判绿**。
  - 判据现状：`g1-checklist-validate.mjs:385` DONE-EVIDENCE 只测
    `COMMIT_RE=/\b[0-9a-f]{7,40}\b/` 或 `FILE_RE=/[\w./-]+\.(md|ts|…)/`（`:306-307`）——
    **提交号从不 `git cat-file`、文件路径从不 `existsSync`**；同文件 `:329-331` 的 PLAN-PATH
    却实测存在性（「对账对象不许是幽灵路径」），`g0-gate.mjs:296-303` 对基线
    `generated_from_commit` 也实测 `merge-base --is-ancestor`——**判真实性的先例两条都在仓内**。
  - 头注人工边界声明（`:71-79`）只豁免 owner 权威性 / review 权威性 / id 复用，**未把锚存在性
    登记为界**；`SUPERSESSION-REASON/EVIDENCE`（`:417-422`）同判形。`REVIEW_RE` 连
    `9999-99-99`、`2020-02-30` 都收。
  - **可重复反例**（纯 /tmp 真目录树，零仓内写入；`--file` 形态判跑）：
    ```
    构造：/tmp/fakeroot/experiments/v3-code-architecture-poc/ 真目录（validator 用
    resolve(dirname(清单),'..','..') 解析 plan 字段，故在该层放占位 IMPLEMENTATION-PLAN-DRAFT.md）；
    复制清单为 fake.yaml，23 条 open→done、owner→"Q40（伪造归属）"、
    evidence→"abcdef0 见 ghost-evidence-does-not-exist.md"、缺 resolution 者补一句形合文本。
    判跑：node …/g1-checklist-validate.mjs --file /tmp/…/fake.yaml --require-clear
    ⇒ 计数 items=27 open=0 assigned=0 done=27 … 违规=0 / 结论：绿 / FAKE_CLEAR_EXIT=0
    锚真伪对照：git cat-file -t abcdef0 ⇒ GIT_ANCHOR_EXIT=128；ls ghost-evidence-… ⇒ LS_EXIT=2
    ```
    （同构造在默认正源路径语义下同样成立——判据对锚点真实性零检查，与清单放哪无关。）
    即 `G2-DEV-PLAN.md:443`「G1 冻结放行（唯一放行命令）」可被一次全 done 化 + 形合假锚满足。
    与历史两次（M8 全 assigned、M14/M15 全 superseded）同族：那两次的修法都是「加一种计数/载荷
    判据」，本洞是「**锚的存在性**根本没进判据」。机验加强完全可实施：done/superseded 锚点提交号
    过 `git cat-file -e`、仓内相对路径过 `existsSync`（锚语义既有先例判真）；残余（真锚但语义空转、
    自指锚）仍归人工——如实登记，不外推。
  - 变异自验 P1 正向夹具（MUTants 表）用的恰是**真实存在**的锚 `g1-checklist-validate.mjs:1`，
    所以 17/17 全绿与此洞并存——自验面从未测过「锚是假的」。
- 其余 E4 检查项**无发现**：`gate-causes.mjs` 反转默认 + fail-closed（banner 失配产保守红签名
  `:172-177`；`fileCauses` 无解释形态单列红 `:148-151`）；g0-gate 三条流的
  收集数/skip/名集/锚摘要/提交祖先判据逐条走查未见 fail-open；`--write-baseline`/`--reanchor`
  拒写三条在位（`:247-256`）；checklist 解析器对子集外构造与重复键一律 PARSE 红。
  attacks/** 内容哈希缺位属 G1-GATE-01 在册（PR-0②），不重开。

## E5 性能与可运维性 —— 无「不可运维」发现；给可实施界

先钉事实：三份契约 grep「量级」= **0 命中**——「契约声明的量级」在契约里**不存在**，唯一数值
常数是 K=32（EA 4 处）。在此前提下对四个怀疑点实测（`node perf.mjs`，PERF_EXIT=0）：

1. **打开期全表链完备性扫描（RL-8.1 步 4）**：200k `object_directory` 行 × 5 路由、40k 漂移行的
   全表 join = **14ms**；每进程一次（打开判据），非每读。不是不可运维。
   **可实施界**：三路输入全为触发器级单调/冻结（目录行 `directory_no_update/no_delete`、
   路由 `changed_seq` 单调、链源 ledger append-only）⇒ 持久化水位
   `(directory max rowid, max changed_seq, ledger max seq, ns_epoch)`，四项未动且上次全清 ⇒
   跳过重扫；动了 ⇒ 只扫 rowid/seq 水位增量。全表判据语义不变，摊销 O(Δ)。
2. **每次审计落账（EA-7.1）**：每次 open/audit-call 一行，O(1)/次；巡检本体是 `ref_edge`
   全表逐边点查（`kernel.ts:694-724` 现状），50k 边 = **68ms**/次——按巡检频率线性，可接受；
   同水位界可用（`ref_edge_no_update/no_delete` 在位，存量边永不变）。
3. **K=32 聚合（EA-7.2）**：遮蔽行增速 ≤ masked_reads/32，且 K 为冻结常量防调大——增速有界，
   无问题。
4. **`routeNs` 三分支读放大 + 前缀完备链解析（RL-6.5/7.3）**：快路径①两值比较零增量；
   步 4/②支若逐读现算链 = O(链长) JSON 解析 + ledger 检索，**可实施界** = 按 capability 内存
   缓存链、以 RL-7.3 本就必须核对的 `ns_epoch` 作唯一失效键（epoch 只随提交变，`begin immediate`
   事务内稳定 ⇒ **每事务**至多一次 epoch 点查，实测 2.7µs/次；链重建 O(全库 ns-relocated 行数)
   = 运维频次）；`UNIFIED-CONTRACTS.md:318` 已把 `(event_type, seq)` 索引写进 ledger 索引主张，
   重建走索引。**结论：不构成红线，但界应写进 RL-7.3/6.5（现文只说「解析前核对」，未容许/禁止
   缓存，实现者会在歧义里自选）。**

## E6 迁移与回滚现实性 —— 1 × P1

- 数字核验：作者 225 / attacks 133 = 33 红 + 100 过（`g0-gate` 实测，见 §0）——计划引用的数字
  与工作树一致，尺子未漂。
- 「`Approved-By` 未落地期间装配红」的**当前**存量测试面**不被卡死**：`src/**` 对四个提案名
  grep = 0 命中（现实现根本不引用提案名），装配红只在 PR 落码后出现，且计划把它们都写成**进入**
  门禁（先批准后落码，不存在带红合并期）。
- **【P1-3】PR-2..PR-9 之间 Raw Intake 落账没有合规落点——「先红后绿但没人负责修」的真实缝**。
  四个事实互斥（各带出处）：
  1. EA-1.2.2：`unregistered`「一切通用通道拒写」（deny-by-default 翻转 C-23），
     `G1-CONTRACT-EVENT-AUTHORITY.md` §1.2.2（分类器 `cls:'unregistered'` 行）；矩阵 `:68` 同判。
  2. 现实现的 Raw Intake 走的正是通用通道：`src/app/intake-use-case.ts:53`
     （`tx.appendLedger(this.#policy.rawIntakeEvent(…))`，D-19c-ALLOWED），事件名
     `synth:raw-intake`（`src/domains/test-records.ts:105-107`）——**不在**任何 `ownsEventTypes`
     （`test-records.ts:55` 只登 `synth:fact-designation`），也不在机制名单 ⇒ 按 EA 分类器 =
     `unregistered`。
  3. 该名的「登记或改走 Raw 信封」义务**唯一**排在 **PR-10**（`G2-DEV-PLAN.md:296`，§5-2
     「不留豁免窗」`:420-424`），而 Raw 信封固定名 `raw-record-declared` 的 `Approved-By` 又是
     **PR-10 的进入门禁**（`:300-301`）；PR-1 明文「**不给任何领域名入账**」（`:107`）。
  4. 作者测试把落账成功钉死：`tests/p3-intake-validation.test.ts:52-60`
     （`expect(rec.seq).toBe(seq)` + 来源回读）；PR-2 退出门禁 = 「`g0-gate.mjs` exit 0 且基线
     红/绿名集无漂移」（`G2-DEV-PLAN.md:135`），作者流 0 红是永不放宽的硬条件（`g0-gate.mjs` 头注）。
  于是 PR-2（标题即「deny-by-default」）合并后、PR-10 之前，`intake()` 落账按契约必拒——
  p3 系列作者测试转红 ⇒ 每个中间 PR 的 `g0-gate exit 0` 无法满足；而唯一的解法（把 `synth:*`
  域内名迁入归属账或信封）被排期排除在外。姊妹先例现成：`synth:fact-designation` 已在 D-20
  收口时登记 + 改走命令 Port（`src/app/standing-use-case.ts` 头注），证明修法存在、只是计划
  没把同类项 `synth:raw-intake` 排进 PR-2（或明示中间态豁免）。**P1**。
- 回滚现实性：`ns-relocated` 永久行、`ns_epoch` 单调、触发器改造都是**单向门**，但契约自带救济
  （反查 `proposeRollback` = 反向重定位 RL-3⑤；「可旧读 + 标注」永不改写历史 D3-b/C6）；
  未发现 PR 序列中其他「改了退不回又无救济」的面。

---

## 实跑命令与退出码

| # | 命令 | 退出码 |
| - | --- | --- |
| 1 | `git merge-base --is-ancestor d2f19cc HEAD` | 0 |
| 2 | `git show d2f19cc:experiments/…/sqlite-port.ts \| grep domain_state_no_update` | 命中 L202/L204 |
| 3 | `node g0-gate.mjs` | 0（225 全绿；33 红=基线；skip=0） |
| 4 | `node g1/G1-CONTRACT-{FACET,EVENT-AUTHORITY,RELOCATION}.fixtures.mjs` | 0 / 0 / 0（35/48/57 PASS） |
| 5 | `node g1-checklist-validate.mjs` / `--require-clear` / `--self-test` | 0 / 1（预期）/ 0（17/17） |
| 6 | `node ../../scripts/snapshot-release.mjs` | 0（31 文件） |
| 7 | 伪造锚洗白清单 + `--file … --require-clear`（纯 /tmp 树，§E4） | **0（判绿——本席 P1-2 反例）** |
| 8 | `git cat-file -t abcdef0`；`ls ghost-evidence-does-not-exist.md` | 128；2（锚确不存在） |
| 9 | `node rl51.mjs`（复刻 domain_state DDL 触发 RL-5.1 步骤 3） | **3（DOMAIN_STATE_APPEND_ONLY——P1-1 反例）** |
| 10 | `node perf.mjs`（200k 目录行 join / 50k 边巡检 / epoch 点查） | 0（14ms / 68ms / 2.7µs） |

（构造物全部落 /tmp，工作树仅新增本文件；/tmp 每调用即清，故 7/9/10 均为构造+判跑同调用。）

## 未读到的东西

- GitHub 上 PR #42 / #44 / #47 的评审正文（计划引用的 `#42:319`、`#44:40`、`#47:270-279` 等
  只核对到仓内 `G1-RECON-PR47.md` 转录，未上网逐条核原文）。
- `G1-ADJUDICATION-TABLE.md` 全文（只按引用行核对 D3-b/D4-x/D5-x/C6/X-8/Q45/§4.2 等被引行）。
- `IMPLEMENTATION-PLAN-DRAFT.md`、`CONTRACTS.md`、`READINESS.md` 全文（按引用点核对 §2-G1、
  §7、§16.2/16.3、D-31/F-G6A-4/D-5 等段）。
- `attacks/**` 各测试的断言体细节（核对的是 BASELINE 名集与门禁判据，未逐文件复读攻击面）。
- `src/kernel` 中 routeNs 之外的其余读面（read-context/projection 只抽查）；`.poc-data` 3383 个
  实例库逐个内容未读（仅目录计数与 fixture 二进制 grep）。
- G1 夹具 48/35/57 项未逐条复读（抽验 10 项断言体 + 双向孤儿检查）。
