# VERDICT — prex 最小科研工作流预实验裁决

> 2026-11-02 · 用户授权（2026-11-01 G1 冻结前预实验席位任务书）· 命名纪律 RD-22（全程 S-L0/S-L1，无裸层级名；该规则原文本身含裸 token，逐字见 `g1/G1-ADJUDICATION-TABLE.md:237`）
> **事件词表声明：本实验使用的全部事件名属于「prex 本地事件词表（非生产封闭名单）」**（`prex:` 前缀，与生产名零碰撞）；
> `raw-record-declared` 为**生产 planned（未批准）**名（gated EA-1.2.3），本实验镜像为 `prex:raw-record-declared` 且逐行台账标注
> `productionStatus: "planned-not-approved (gated EA-1.2.3)"`。详见 `README.md` §4。

## 1. 裁决

**四件事全部验证通过（40/40 断言，三连绿）；三个成本场景全部实跑并记账。**

| # | 事项 | 裁决 | 关键实证 |
|---|---|---|---|
| 1 | S-L0 提交 | **通过** | 不可解析材料（真实文本的构造损坏，RAW-1）落账为原始记录；`prex:raw-record-declared` 不属生产封闭名单且行内携 planned 标注；Object Directory 无 raw 行；台账中无任何「把 raw 当正式五类对象」的行；raw 读回键集恰为 raw 形态（A1-01…09） |
| 2 | S-L1 旁路 | **通过** | 可解析材料 P-1 在首轮 S-L1 = NOT_ACHIEVED（CIT_ACCESS_VIA_MISSING）时仍登记为正式对象；报告是独立事件（对象事件载荷不含 verdict）；对象不消失、不重写（c3 时刻快照 + 修订恰 1 条）；报告缺陷码全部 ∈ 结构/声明封闭词表，verdict+defects 面语义判定词机验零命中（RD-33）（A2-01…11） |
| 3 | 证据适用域 | **通过** | 报告绑定五分量各缺一件 ⇒ `RPT_BIND_INCOMPLETE` 拒收 + 零新增块（×5）；同对象换规则集版本（rs/v1→rs/v2）复查 ⇒ 新报告 RPT-6，旧报告块行自磁盘重读 sha256 逐等（C11）；历史报告按钉住版本原样可读（D3-b）；原始字节不重解释（X-6）；跨 revision / 跨对象引用 ⇒ 出口 `OUT_OF_SCOPE_CITATION`（A3-01…10） |
| 4 | 结论出口 | **通过** | 出口四分量缺一即拒（缺 declared_gaps ⇒ `EXIT_MISSING_DECLARED_GAPS`）；`SCIENTIFICALLY_TRUE`（把 S-L1 当「科学为真」）⇒ `VERDICT_SEMANTIC_CLAIM_REFUSED`；成功出口记录携 {verdict, declared_gaps, applicabilityDomain, provenanceBindings} + 逐字不变量「S-L1 PASS ≠ 原意被确认 ≠ 正确」（IC-S2）（A4-01…10） |

**真实材料锚**：DOI `10.1007/978-3-319-24574-4_28`（Crossref `api.crossref.org/works/…` HTTP 200，2026-11-02 核验；
Ronneberger/Fischer/Brox, U-Net, MICCAI 2015 LNCS pp. 234–241）；引文文本逐字取自 arXiv:1505.04597v1 abstract
（P-1 = sentence 4，P-2 = sentence 8）；RAW-1 = 对 arXiv v1 abstract sentence 3 的**构造损坏 of 真实文本**
（原文 + 10 项 token 级损坏映射见 `README.md` §3.2）。

## 2. 成本表（三场景实跑记账，round 5 实测值）

| 场景 | 操作数（ops） | 墙钟（wall clock） | 说明 |
|---|---|---|---|
| **中断**（X-1 幂等形态） | 1 崩溃（子进程 exit 9，提交点前）+ 1 重放提交 + 1 幂等重放 + 2 文件字节核验 = **5 ops** | **37.505 ms** | 提交点前崩溃 = 零落盘（崩溃前后台账 sha256 逐等；探针证据 `staged=1 committed=0`）；同幂等键重放首次成功提交（P-2 r1 + RPT-4），第二次重放返回首次结果**字节逐等**、不产生第二份记录（JC-1 四元组） |
| **积压**（D2-d 形态） | 3 出口拒绝尝试 + 3 中断场景操作 + 1 E2 晚到登记 + 1 复查（新报告 RPT-5）+ 1 出口成功 = **9 机制操作**；窗口跨 4 个提交块 | **38.491 ms** | 证据 E2 到达前结论保持「不可出口」（`PROVENANCE_REF_UNRESOLVED` + `EXIT_REPORT_NOT_PASS`）；E2 晚到后复查出新报告、旧报告字节不变（C11）；晚到记录早截点不可见、晚截点携补录标注 `lateBackfill=true`（D2-d：迟到登记不可追溯变成过去已登记）。注：中断 3 ops ⊂ 积压 9 ops，三行不重复计 |
| **回访**（D3-b / X-6 形态） | 1 规则集 v2 重检（新报告 RPT-6）+ 3 钉住版本读（RPT-1 / RPT-2 / RAW-1）= **4 ops** | **0.184 ms** | 规则集版本变更后回访旧对象：历史报告按其钉住版本原样可读（RPT-1 仍 verdict=NOT_ACHIEVED @ rs/v1，不重算、不套新规则）；原始记录原始体字节逐等（机制只供原始字节，不重解释） |

整轮记账：27 机制操作（13 提交块 + 3 出口拒绝 + 1 崩溃 + 2 重放 + 5 负例报告尝试 + 3 钉住读）；
整轮墙钟 round 3/4/5 = 46.584 / 46.467 / 45.076 ms；重放整链验证 `{ok:true, length:13}`（独立实例跨进程复活形态）。

## 3. 诚实边界

**本预实验证明的是机制对真实材料的行为；不证明任何科学主张的真值。**

- 所有出口 verdict 是**域相对值**（`SUPPORTED_WITHIN_DECLARED_SCOPE` 等封闭词表成员）；S-L1 报告、出口记录、
  declared_gaps 全部是**声明面工件**。P-1/P-2 的 PASS 只表示其声明结构在钉住规则集版本（rs/v1）下无结构/声明
  缺陷，**不表示 U-Net 的任何科学结论为真**，不构成对 MICCAI 2015 论文结果的独立复现或验证。
- 模型-形态边界（`README.md` §6，同 E2 纪律）：提交块粒度（每事务一行）是 prex 层对「提交点前崩溃 = 零落盘」
  原子性边界的建模选择，不是对生产台账形态（每事件一行）的裁定；规则集 `rs/v1`/`rs/v2` 的内容、逻辑时钟、
  缺陷码/verdict 词表均为 prex 本地最小集，非生产正源；`INDETERMINATE` 保留未触发；补录「标注面」保持未闭合
  （与 ADJ D2-d 一致）。
- 材料面的「真实」= 论文存在性（Crossref HTTP 200）+ 引文逐字（arXiv v1）+ RAW-1 的损坏**如实标注为构造损坏
  of 真实文本**（README §3.2 给出原文与逐项映射）。除此之外没有任何真实科研流程参与本实验。

## 4. 实际 exit code 与轮次（`prex/.run/run-history.jsonl` 原文照录）

| round | 结果 | exit code | 说明 |
|---|---|---|---|
| 1 | 中止（未跑完断言） | 1 | 轨迹中途异常：`PrexError OBJECT_ID_RESERVED`——幂等重放 #2 被 `registerObject` 的对象唯一性守卫拦截（幂等检查位于业务守卫之后，不符合 X-1「重放先于一切守卫」形态） |
| 2 | 34/40（6 FAIL） | 1 | A1-07（断言取错字段）+ A4-06…10（代码缺陷：S-L1 来源引用规则误套 assessment 的对象引用 ⇒ 复查 NOT_ACHIEVED ⇒ 出口连带被拒） |
| **3** | **40/40** | **0** | **首次全绿**（46.584 ms） |
| **4** | **40/40** | **0** | **稳定性复跑**（46.467 ms） |
| **5** | **40/40** | **0** | 第三次复跑（45.076 ms；成本表数字取自本轮） |
| **6** | **40/40** | **0** | 命名纪律收尾（清除 meta 引用中的裸 token，仅注释/文档措辞变更）后的终态复验（45.595 ms） |

**两连绿要求已满足（round 3+4），且实际达成四连绿（round 3+4+5+6）。**

## 5. 修码记录（为通过断言所做的代码变更；逐条判定非「弱化断言凑绿」）

| # | 位置 | 变更 | 性质 |
|---|---|---|---|
| 1 | `core.mjs` | 新增 `_idemKey`/`_replayHit`；五个公开入口（raw intake / register / revise / recordReport / exit）在**任何业务守卫之前**先走重放分支（JC-1：命中 ⇒ 返回首次结果字节逐等，不重执行、不重新鉴权） | **修代码缺陷**：原形态下同键重放被对象唯一性守卫拒（X-1 语义不成立）。断言 A2-09/10/11 未改动 |
| 2 | `core.mjs` | 来源引用规则 `CIT-DOI/LOCATOR/ACCESS-VIA/VERIFIED-AGAINST` 的适用范围加限定 `subType !== "assessment"`（assessment 的 `declared.citations` 是对象引用，由 `ASSESSMENT-PROVENANCE-RESOLVED` 检查） | **修代码缺陷**：原形态把非 assessment proposition 的来源引用规则误套到 assessment 的对象引用上，导致证据到达后的复查仍 NOT_ACHIEVED。断言 A4-06…10 未改动 |
| 3 | `core.mjs` | `_buildReport` 的 `resolveRef` 增加同事务可见性：同事务刚登记的 r1 对象对本事务内 S-L1 检查可见（#44 L90 形态） | **修代码缺陷**（任务书锚点要求的形态）：缺此形态时 A-1 首轮报告的溯源缺陷会误指 E1（同事务对象）而非 E2（真未登记对象） |
| 4 | `run.mjs` | A1-07 的字段位置 `T.raw2.event` → `T.raw2.result.event`（commit 结果包装层的 `result` 字段） | **修断言取数错误**：断言语义（B-1 反向护栏）未改动 |

无断言被删除、放宽或替换；40 条断言的最终语义与 `README.md` §7 一致。

## 6. 交付物清单（全部在 `prex/` 下）

| 文件 | 说明 |
|---|---|
| `README.md` | 设计 + 四件事 × 契约锚（file:line 已核验）+ 真实材料（DOI 核验 + 逐字引文 + 损坏映射表）+ 隔离纪律 + 模型-形态边界 + 运行方式 + 词表/planned 标注 |
| `core.mjs` | 机制切片：digest 链台账（提交块形态）+ S-L0 Raw Intake（B-1/B-4）+ Domain Admission（S-L1 旁路）+ S-L1 规则集版本化检查（RD-33）+ 报告五分量存在门（C11/D4-b）+ 结论出口四分量 + 幂等四元组（JC-1）+ cutoff/补录（CS-3.1/D2-d） |
| `run.mjs` | 轨迹驱动（13 提交块）+ 40 断言（9/11/10/10）+ 三场景成本记账 + run-history 轮次留痕 |
| `crash-probe.mjs` | 进程级中断探针（真实 `prex._stage` 后 `exit(9)`，提交点前零落盘） |
| `VERDICT.md` | 本文件 |
| `.run/`（gitignore） | 运行时数据：`prex-ledger.jsonl`（13 块 digest 链）、`run-history.jsonl`（5 轮）、`last-green-output.txt`（round 5 输出存证） |

## 7. 隔离纪律自证

- 只写 `prex/`（含 `.run/`）；**零 git 写**（全程仅只读 `git status`；`g1/` 下 7 个他席脏文件未触碰）；
- 零 npm 依赖（仅 `node:` 内置 crypto/fs/path/child_process/url）；未 import 任何仓内模块或 `@deepseek-ai/*`；
  未读 `src/**`/`tests/**`/`schema/**` 作依赖；`reuse/e0|e2` 仅参考 digest 链形状；
- 全部事件名 `prex:` 前缀（**prex 本地事件词表（非生产封闭名单）**）；生产名仅出现于「不冒充」断言与引文锚；
  `raw-record-declared` 每次出现均携 **planned 未批准（gated EA-1.2.3）** 标注。
