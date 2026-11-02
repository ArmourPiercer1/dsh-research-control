# prex — G1 冻结前「最小科研工作流预实验」（S-L0 解析层 / S-L1 声明检查层）

> 状态：**已完成（两连绿）** · 2026-11-02 执行 · 用户授权（2026-11-01 G1 冻结前预实验席位任务书）
> 命名纪律（RD-22，`g1/G1-ADJUDICATION-TABLE.md:237`：全套文档禁止裸层级名——该规则原文本身含两个裸 token，此处从略、逐字见原文）：
> 本文档与全部代码一律写 **S-L0**（解析层 / 原始登记）与 **S-L1**（声明检查层），不出现裸层级名。

## 1. 这是什么

`prex/` 是一个**自包含的最小科研工作流机制切片**：它用零 npm 依赖的纯 Node.js（仅内置
`crypto/fs/path`）实现「事件源 jsonl digest 链台账 + S-L0 原始登记 + S-L1 声明检查 + 检查报告 +
结论出口」的最简形态，并在一条真实材料轨迹上验证四件事（§7），附三个成本场景的实跑记账
（`VERDICT.md` 成本表）。

**性质**：G1 冻结**前**的预实验（用户授权），不是生产实现、不是 G1 契约的一部分、不是
G2 目标形态。它验证的是**机制形态对真实材料的行为**，不证明任何科学主张的真值（§10 边界）。

## 2. 隔离纪律（违反即整批作废）

1. **文件面**：只创建/修改 `experiments/v3-code-architecture-poc/prex/` 之下的文件（运行时数据在
   `prex/.run/`，`.gitignore` 已排除，不提交）。
2. **git 面**：零 git 写操作（仅允许只读 `git status` 查看）。不提交、不暂存、不改分支。
3. **依赖面**：不读取 `src/**`、`tests/**`、`schema/**` 作为依赖；不 import `@deepseek-ai/*` 或任何
   仓内模块；`core.mjs`/`run.mjs`/`crash-probe.mjs` 只 import `node:` 内置模块与彼此。
4. **契约面**：`g1/**` 文档与 `docs/architecture/V3_CODE_ARCHITECTURE_DRAFT.md` **只读**，仅作为
   引文锚（§9）；`reuse/e2`、`reuse/e0` 的 digest 链形态**只参考其形状**（prev-digest +
   stableStringify + GENESIS），不复制其断言语义、不 import 其代码。
5. **命名面**：本目录事件名全部带 `prex:` 前缀（§4），与生产封闭名单零碰撞；生产名只出现在
   「不冒充」断言与引文锚里。

## 3. 真实材料（本预实验的「真实」锚点）

### 3.1 论文与命题

| 项 | 值 |
|---|---|
| 论文 | Ronneberger, Fischer, Brox — *U-Net: Convolutional Networks for Biomedical Image Segmentation* |
| 出版版（Proposition + citation Evidence 的 **DOI 溯源**） | **DOI `10.1007/978-3-319-24574-4_28`**（MICCAI 2015, LNCS, pp. 234–241, Springer International Publishing） |
| DOI 存在性核验 | `https://api.crossref.org/works/10.1007/978-3-319-24574-4_28` → **HTTP 200**（2026-11-02 核验；Crossref record indexed 2026-11-02T14:27:19Z；is-referenced-by-count 64602） |
| 引文文本源 | **arXiv:1505.04597v1**（abstract 原文，2026-11-02 取文） |

轨迹中的两个真实主张（Proposition，均逐字引自 arXiv:1505.04597v1 abstract，citation 带 DOI 溯源）：

- **P-1**（r1→r2）：*“We show that such a network can be trained end-to-end from very few images and
  outperforms the prior best method (a sliding-window convolutional network) on the ISBI challenge for
  segmentation of neuronal structures in electron microscopic stacks.”*（locator：arXiv:1505.04597v1 abstract, sentence 4）
- **P-2**（r1，中断场景材料）：*“Segmentation of a 512x512 image takes less than a second on a recent
  GPU.”*（locator：arXiv:1505.04597v1 abstract, sentence 8）

另有两个 Entity：**E1** = U-Net 出版章节（身份 = 上述 DOI，Crossref 核验 HTTP 200）；
**E2** = arXiv:1505.04597v1 文本副本（引文核对源；`knownFromMs` 早于首份报告 → 晚到登记/补录标注的建模输入）。

### 3.2 S-L0 原始材料：**构造损坏 of 真实文本**（如实标注）

RAW-1 的正文是**对真实文本的人为构造损坏**（构造损坏 of 真实文本）：取 arXiv:1505.04597v1 abstract
第 3 句的**原文**，施加 OCR 式损坏（`c→e` 混淆 + 行界空格插入）。

**原文**（arXiv:1505.04597v1 abstract, sentence 3，逐字）：

> The architecture consists of a contracting path to capture context and a symmetric expanding path that enables precise localization.

**损坏映射表**（token 级，逐字对应；损坏模式：首/中 `c`→`e` 混淆 + 词内空格插入，模拟双栏排版 OCR 行界错位）：

| # | 原文 token | 损坏 token | 损坏类型 |
|---|---|---|---|
| 1 | architecture | archit ecture | 空格插入（pos 6） |
| 2 | consists | oon sists | c→e + 空格插入 |
| 3 | contracting | contrae ting | c→e + 空格插入 |
| 4 | capture | eapture | c→e |
| 5 | context | eont ext | c→e + 空格插入 |
| 6 | symmetric | sym metrie | 空格插入 + c→e |
| 7 | expanding | exp anding | 空格插入 |
| 8 | enables | en ables | 空格插入 |
| 9 | precise | pre ise | 空格插入 |
| 10 | localization | loe alization | c→e + 空格插入 |

**损坏后文本**（RAW-1 落账正文；sha256 = `f7704303…7bdfe`，断言 A1-06 逐字节核验）：

> The archit ecture oon sists of a contrae ting path to eapture eont ext and a sym metrie exp anding path that en ables pre ise loe alization.

损坏由 `run.mjs` 中 `CORRUPTION_MAP` 确定性生成（上表与代码同源）。该文本不可解析为 prex 对象信封
（S-L0 `parseAttempt = UNPARSEABLE`），按 C-04 以 Raw Intake 通道落账为原始记录。

**RAW-2**：Crossref 记录的论文标题原文（`U-Net: Convolutional Networks for Biomedical Image Segmentation`）
+ 完全不认识的 `declaredType = totally-unknown-foreign-schema-xyz`（B-1 形态：机制不解释 declaredType，仍收）。

## 4. prex 本地事件词表（非生产封闭名单）

**本目录使用的全部事件名属于「prex 本地事件词表（非生产封闭名单）」**——带 `prex:` 前缀，与生产名
零碰撞；prex 不登记、不铸造、不向台账写入任何生产机制名。镜像关系与生产批准状态逐名如实标注
（`core.mjs` `nameProvenance` 逐行落进台账事件信封）：

| prex 本地事件名 | 镜像的生产名 | 生产状态（正源：`g1/G1-CONTRACT-EVENT-AUTHORITY.md` §2.4，L222–243） |
|---|---|---|
| `prex:raw-record-declared` | `raw-record-declared` | **planned 未批准**（提案未入账 4 名之一，`gated_by EA-1.2.3`，L240/L243）——本表及台账行内一律标注 planned |
| `prex:object-registered` | `object-registered` | 已入账（机制封闭名单已入账 7 名之一） |
| `prex:object-revised` | `object-revised` | 已入账（7 名之一） |
| `prex:check-report-recorded` | `check-report-recorded` | 已入账（7 名之一） |
| `prex:record-backfilled` | `record-backfilled` | 已入账（7 名之一）——本轨迹保留未用（晚到登记走 `object-registered` + 读时补录标注） |
| `prex:assessment-exited` | （无生产对应） | prex 独有（结论出口） |

生产封闭名单（已入账 7 名 + 提案未入账 4 名 + A 侧 planned 2 名）完整正源见
`g1/G1-CONTRACT-EVENT-AUTHORITY.md` §2.4（L222–243）。`run.mjs` 断言 A1-02 机验「prex 事件名 ∉
生产已入账 7 名 + 行内 planned 标注」。

## 5. 机制设计（`core.mjs`）

### 5.1 台账：jsonl digest 链（e2 形态同源）

- 每行 = 一个**提交块**（一个事务 = 一行）：
  `{seq, t:'commit', c, commitRecordedAtMs, op, actor, clientRequestId, events:[…], idem:{key,resultJson}, digest}`
- `digest = sha256(prev + "\u0000" + stableStringify(body))`，`stableStringify` = 键排序 + 丢 undefined；
  创世 `prev = "GENESIS"`；`seq` 从 0 连续。与 `reuse/e2` 的 digest 链**形态同源**（prev-digest 形式相同）。
- **已登记的形态差异**：e0/e2 是每事件一行；prex 是每**事务**（提交块）一行——这是 prex 层
  「提交点之前崩溃 = 零落盘」的建模形态：一个事务**要么整块落盘、要么零落盘**（撕裂尾在 open 时
  截断并计数，`repairedTornLines`）。
- 时间语义：逻辑时钟（提交 i ⇒ `BASE + i*1000` ms，`BASE` 对齐 2026-11-01T00:00:00Z）；**墙钟永不入台账**
  （只用于成本测量）。`cutoff(t) = max{ c ∈ committed ∪ {0} : M(c) ≤ t }`（CS-3.1 前缀界；空 ⇒ c=0 空视图）。

### 5.2 S-L0 解析层 / 原始登记（Raw Intake，EA-1.2.3 形态）

- 唯一入口 `declareRawIntake`。`declaredType` **三不参与**（机制不解释、不登记进 event_type、不据以命名）。
- **B-1**：`declaredType` 完全不认识（未来格式/乱码/外来 schema）⇒ **收**为 raw，**永不**出
  `EVENT_AUTHORITY_REQUIRED` 形态拒绝（断言 A1-07 反向护栏）。
- **B-4**：无空间写权 ⇒ 完全拒收（`SPACE_WRITE_DENIED`），台账字节零变化（断言 A1-08）。
- S-L0 解析失败（`parseAttempt = UNPARSEABLE`，EA-1.2.3 三值词汇；`PARSE_FAILED`/`STRUCTURED_INVALID`
  本轨迹未用）⇒ 转 Raw Intake：**「即使 S-L0 无法解析仍保存为原始记录，不冒充正式五类对象」（C-04）**。
- 原始记录读面只返回 raw 形态（`form/body/origin/declaredType/intakeNotes`），Object Directory 无 raw 行，
  台账中不存在把 raw 记录当正式对象的任何行（断言 A1-03/04/05）。

### 5.3 Domain Admission（对象登记，#44 L235 形态）

- 只收 S-L0 可解析材料且 `objectClass ∈ 正式五类`（Entity/Concept/Association/Argumentation/Proposition，
  `docs/architecture/V3_CODE_ARCHITECTURE_DRAFT.md` L73–79 表）；`objectClass` 不在五类 ⇒
  `MASQUERADE_REFUSED`（冒充防线：材料走 Raw Intake 通道）。
- **S-L1 旁路**：「**对象可在 S-L1 未达成但已可解析时登记**：结构缺陷留报告，不能将未达成说成 PASS
  （PR #42 IC-S1/RPT-00）」（V3 draft L235）——首轮 S-L1 报告（若请求）与对象**同事务原子落**（Q40 单次
  原子提交形态）；报告 verdict = NOT_ACHIEVED 时对象照常存在、不消失、不重写（断言 A2-01/02/04）。
- 对象修订 = 新 revision 行（`r2, r3, …`，追加不覆盖；旧 revision 行字节不变）。
- 同事务内引用合法（#44 L90 形态）：同一事务刚登记的 r1 对象对本事务内的 S-L1 检查可见。

### 5.4 S-L1 声明检查层（规则集版本化，RD-33）

- 规则集注册表：`rs/v1`（objectClass 五类、proposition 非空 statement、来源引用声明 doi+locator+
  accessed_via、assessment 引用可解析、entity 身份 doi）；`rs/v2` = `rs/v1` + `CIT-QUOTE-VERIFIED-AGAINST`
  （citation 有 quote 必须声明 verifiedAgainst）。**规则集变更一律 bump 版本**；旧版本保留。
- 检查器只产生**结构/声明缺陷码**（封闭词表 `STRUCTURAL_DEFECT_CODES`：`OBJ_CLASS_MISSING` /
  `PROP_STATEMENT_EMPTY` / `CIT_DOI_MISSING` / `CIT_LOCATOR_MISSING` / `CIT_ACCESS_VIA_MISSING` /
  `CIT_QUOTE_VERIFIED_AGAINST_MISSING` / `PROVENANCE_REF_UNRESOLVED` / `ENTITY_IDENTITY_DCI_MISSING`），
  verdict ∈ {PASS, NOT_ACHIEVED, INDETERMINATE}。**RD-33：S-L1 只查声明不判语义**——断言 A2-05/06
  对 verdict+defects 面做语义判定词封闭集机验（零命中）。
- 来源引用规则只适用于非 assessment 的 proposition；assessment 的 `declared.citations` 是对象引用
  （`{object, revision, report}`），由 `ASSESSMENT-PROVENANCE-RESOLVED` 检查可解析性。

### 5.5 检查报告（绑定五分量存在形态门 + 只写不改）

- 报告绑定五分量（#44 L293 / ADJ D4-b / UNIFIED P5）：**{对象确切 revision, 规则集版本
  （含 contract/schema/validator 版本）, 输入环境, 执行时间, 声明保证范围}**。机制只做**存在形态门**：
  缺任一分量 ⇒ `RPT_BIND_INCOMPLETE` 拒收、零新增块（断言 A3-01…05）。
- **C11**：重检产生新报告，旧 PASS 不改写——旧报告所在块行字节逐等（断言 A3-07、A4-06 自磁盘重读 sha256 比对）。
- **D3-b/X-6**：历史报告按其**钉住版本**原样可读（读侧不重算 verdict、不套新规则重解释；原始字节不重解释）。

### 5.6 结论出口（assessment exit）

出口判据（四分量 + 机制不变量）：

1. **verdict**：必须 ∈ 域相对封闭词表 {`SUPPORTED_WITHIN_DECLARED_SCOPE`,
   `NOT_SUPPORTED_WITHIN_DECLARED_SCOPE`, `INDETERMINATE_WITHIN_DECLARED_SCOPE`}；语义真值词
   （如 `SCIENTIFICALLY_TRUE`）全部在集合外 ⇒ `VERDICT_SEMANTIC_CLAIM_REFUSED`（把 S-L1 当「科学为真」⇒ 拒）。
2. **declared_gaps**：必须存在（数组）⇒ 否则 `EXIT_MISSING_DECLARED_GAPS`（RD-25 三独立线之「语义完备性」线）。
3. **适用域声明** `applicabilityDomain`（domain + method 至少）⇒ 否则 `EXIT_MISSING_APPLICABILITY_DOMAIN`。
4. **溯源绑定** `citations`：全部对象引用可解析（否则 `PROVENANCE_REF_UNRESOLVED`）；所引报告必须
   **在适用域内**（报告钉住目标 `{objectId, revision}` 与引用入条一致，否则 `OUT_OF_SCOPE_CITATION`）。
5. 自身最新 S-L1 报告 ≠ PASS ⇒ `EXIT_REPORT_NOT_PASS`。

闸返回**全部违例码**（不 fail-fast）。成功出口记录是独立台账行（`prex:assessment-exited`），携四分量 +
`mechanismInvariants`（含逐字声明 **「S-L1 PASS ≠ 原意被确认 ≠ 正确」**，IC-S2/RD-33；C11 注记；词表标注）。

### 5.7 幂等（X-1 / JC-1 形态）

- 幂等键 = 四元组 `(actor, space_id, operation, client_request_id)`（sha256 摘要进提交块 `idem` 字段）。
- **重放分支在任何业务守卫之前命中**：同键第二次请求 ⇒ 返回**首次结果字节逐等**（`resultJson` 字符串
  相等；禁 Date.now() 重算、禁重执行），**不产生第二份记录**（断言 A2-09/10/11）。
- 提交点之前崩溃（进程级 `exit(9)`，`crash-probe.mjs` 子进程）⇒ 零落盘（台账文件字节逐等，断言 A2-08）。

### 5.8 双时间截点读面（cutoff / 补录）

- `readAt({cutoffMs})`：前缀界 cutoff（§5.1），回显 `asOfInput / resolvedCutoff / resolvedAtMs /
  cutoffDefaulted`（CS-2.2/2.3 回显键形态）。
- **D2-d 补录派生键**（CS §3.3 形态）：行在 t 视图带补录标注 ⇔ 该行提交序 `c_O > cutoff(knownFromMs)`
  （`knownFromMs` = 材料声明的可得时间）。迟到登记不可追溯变成过去已登记（断言 A4-04/05）。

## 6. 模型-形态边界（prex 层不是生产形态）

1. **提交块粒度**（§5.1）：生产形态是每事件一行（e0/e2）+ 撕裂尾处理；prex 用每事务一行以建模
   「提交点前崩溃 = 零落盘」的**原子性边界**——这是 prex 层的选择，不是对生产台账形态的裁定。
2. **规则集内容**：`rs/v1`、`rs/v2` 的具体规则是 prex 最小集，不是 S-L1 生产规则正源；生产规则集
   由对象拥有者贡献（V3 draft L293 段首句）。
3. **逻辑时钟**：prex 用确定性逻辑时钟（`BASE + i*1000`）替代墙钟入台账，只为断言可复现；生产形态的
   `commit_recorded_at_ms` 取值面不同（CS-3.3 理由段）。
4. **词表**：`STRUCTURAL_DEFECT_CODES`、出口 verdict 词表、出口违例码都是 prex 本地最小集
   （非生产封闭名单）；生产封闭名单以 `g1/G1-CONTRACT-EVENT-AUTHORITY.md` §2.4 为正源。
5. **`INDETERMINATE` 未触发**：prex 简化归约「有结构/声明缺陷 ⇒ NOT_ACHIEVED，否则 PASS」，
   INDETERMINATE（无法判定线）保留在 verdict 词表但本轨迹不产生。
6. **空间模型单空间**（`prex-space-1`）：多空间路由、写权矩阵不在 prex 层建模（只保留
   `principalCanWrite` 布尔门，B-4 形态）。
7. **补录标注面未闭合**（与 ADJ D2-d 一致）：prex 只实现「推导键 + 视图呈现」，标注的具体呈现面
   仍是未闭合项（D2-d 裁决明示「标注面未写」保持未闭合）。

## 7. 四件事 × 契约锚 × 断言（40 条）

| # | 事项 | 契约锚（file:line/§，逐字引文见 §9） | 断言 |
|---|---|---|---|
| 1 | S-L0 提交：不可解析材料提交为原始记录，永不冒充正式五类对象 | C-04（EA ref list L41 / V3 draft L234 §7.2 Q37）；EA B-1/B-4（L146–151）、EA-1.2.3（L104）；RD-22（ADJ L237） | A1-01…A1-09（9） |
| 2 | S-L1 旁路：可解析材料在 S-L1 未 PASS 时仍登记；报告独立；对象不消失不重写；报告只含结构/声明缺陷 | V3 draft L235（Domain Admission）；IC-S1/IC-S2（ADJ L210）；EA B-5（L146–151）；RD-33（ADJ L243）；X-1/JC-1（UNIFIED §2.11 L360，中断场景） | A2-01…A2-11（11，含中断 4 条） |
| 3 | 证据适用域：报告绑定五分量、缺件拒、换规则集版本重检出新报告且旧报告字节不变、跨域引用拒/标 | V3 draft L293（§9.2 Q39，C11）；ADJ D4-b（L63 附近）、D3-b（L60）、X-6（L84 附近）；CS-3.1（L371）；UNIFIED P5 | A3-01…A3-10（10） |
| 4 | 结论出口：出口只带 {verdict, declared_gaps, 适用域声明, 溯源绑定}；缺 declared_gaps 拒；S-L1 PASS 当「科学为真」拒/标；出口记录保留不变量声明 | V3 draft L296（RD-33）、L293（declared_gaps 线，RD-25）；IC-S2（ADJ L210）；RD-33（ADJ L243）；D2-d（ADJ L56，积压场景） | A4-01…A4-10（10） |

**轨迹**（13 个提交块；`RPT-n` 为检查报告）：

| 块 | 内容 |
|---|---|
| c1 | RAW-1 原始登记（构造损坏 of 真实文本；declaredType=proposition） |
| c2 | RAW-2 原始登记（declaredType 完全不认识，B-1） |
| c3 | P-1 登记（r1；缺 accessed_via）+ 首轮报告 RPT-1（rs/v1 → NOT_ACHIEVED，S-L1 旁路生效） |
| c4 | P-1 修订 r2（补齐声明）+ 重检 RPT-2（rs/v1 → PASS；旧报告不改写） |
| c5 | E1 登记（出版物 Entity，DOI）+ A-1 登记（assessment）+ RPT-3（rs/v1 → NOT_ACHIEVED：E2 未登记，溯源未解析） |
| c6 | A-2 / A-3 登记（负例结论对象） |
| — | 出口尝试 ×3：A-1 首拒（PROVENANCE_REF_UNRESOLVED + EXIT_REPORT_NOT_PASS）；A-2 三码（缺 gaps / 语义真值 verdict / 跨 revision 引用）；A-3（跨对象引用） |
| c7 | **中断场景**：P-2 事务提交点前进程级崩溃（exit 9，零落盘）→ 同幂等键重放 #1（首次成功提交，P-2 r1 + RPT-4 PASS）→ 重放 #2（字节逐等返回首次结果） |
| c8 | E2 晚到登记（knownFromMs 早于首份报告；早截点不可见、晚截点携补录标注） |
| c9 | A-1 复查 RPT-5（新报告 PASS；RPT-3 块行字节不变） |
| c10 | A-1 出口成功（四分量 + 不变量声明） |
| c11 | **回访场景**：rs/v2 生效，回访 P-1@r2 → RPT-6（NOT_ACHIEVED：v2 新规则 verifiedAgainst 缺）+ 钉住版本读 RPT-1/RPT-2/RAW-1 |

## 8. 运行方式与诚实轮次

```sh
# 运行（每次运行从全新台账开始；.run/ 为运行时数据，不提交；run-history 除外）
node experiments/v3-code-architecture-poc/prex/run.mjs

# 单进程中断探针（被 run.mjs 以子进程方式调用；独立运行只用于观察）
node experiments/v3-code-architecture-poc/prex/crash-probe.mjs <ledgerDir> <specJson>
```

- 断言每条打印 `PASS/FAIL`；全过才 `exit 0`；每轮（含中止轮）追加进 `prex/.run/run-history.jsonl`。
- **诚实轮次**（详见 `VERDICT.md` §4）：round 1 中止（代码缺陷：重放幂等检查位于对象唯一性守卫之后）；
  round 2 = 34/40（代码缺陷：S-L1 来源引用规则误套 assessment 引用 + 1 条断言取错字段）；
  **round 3 = 40/40 exit 0（首次全绿）**；**round 4 = 40/40 exit 0（稳定性复跑）**。
  修码记录（2 处 core 修复 + 1 处断言字段修正，均非弱化断言）逐条见 `VERDICT.md` §5。

## 9. 契约锚清单（逐字引文，正源行号已核验 2026-11-02）

| 锚 | 正源 | 引文 |
|---|---|---|
| C-04 | `g1/G1-CONTRACT-EVENT-AUTHORITY.md:41`（ref list #44 `5ec38974fc` L234 §7.2 Q37）；`docs/architecture/V3_CODE_ARCHITECTURE_DRAFT.md:234` | 「即使 S-L0 无法解析仍保存为原始记录，**不冒充正式五类对象**」 |
| Domain Admission | `docs/architecture/V3_CODE_ARCHITECTURE_DRAFT.md:235` | 「**对象可在 S-L1 未达成但已可解析时登记**：结构缺陷留报告，不能将未达成说成 PASS（PR #42 IC-S1/RPT-00）」 |
| 报告绑定 / C11 | `docs/architecture/V3_CODE_ARCHITECTURE_DRAFT.md:293`（§9.2 Q39） | 「检查报告绑定精确 Revision/Representation、规则/Schema/Scheme 及校验器版本、输入环境、执行时间、实际保证范围；重检产生新报告，旧 PASS 不改写（C11）」 |
| RD-33（V3） | `docs/architecture/V3_CODE_ARCHITECTURE_DRAFT.md:296` | 「S/R-L1 不验证科研语义真实或科学充分性（RD-33）」 |
| 五类对象 | `docs/architecture/V3_CODE_ARCHITECTURE_DRAFT.md:73–79` | Entity / Concept / Association / Argumentation / Proposition 表 |
| 同事务引用 | `docs/architecture/V3_CODE_ARCHITECTURE_DRAFT.md:90` | 同事务内引用合法 |
| IC-S1 / IC-S2 | `g1/G1-ADJUDICATION-TABLE.md:210` | 「报告不可被后续重检改写（C11）；S-L1 PASS ≠ 原意被确认 ≠ 正确」 |
| RD-33（ADJ） | `g1/G1-ADJUDICATION-TABLE.md:243` | 「S-L1 只查声明不判语义」 |
| RD-22 | `g1/G1-ADJUDICATION-TABLE.md:237` | 「全套文档禁止裸层级名」（原文含裸 token，此处从略，逐字见原文） |
| D2-d 晚到记录 | `g1/G1-ADJUDICATION-TABLE.md:56`、`:167` | 「在 as_of = T2 的『当时已知』视图中不得出现为已知；在 as_of = T3 视图中出现并标注为补录」；「迟到登记不可追溯变成过去已登记」 |
| D3-b 历史可读 | `g1/G1-ADJUDICATION-TABLE.md:60` | SF-60「读侧必须能读所有历史版本，禁止『新版Schema 使旧记录不可读』」；#44 L327-328「…不套用新规则冒充旧解释」 |
| D4-b 报告钉住 | `g1/G1-ADJUDICATION-TABLE.md:63` 附近 | 报告 pinned set（对象确切引用 / 版本 / 环境 / 时间 / 保证范围；机制做存在形态门；只写不改） |
| EA B-1/B-4 | `g1/G1-CONTRACT-EVENT-AUTHORITY.md:146–151` | B-1「declaredType 完全不认识…**收**…**永不**出 EVENT_AUTHORITY_REQUIRED」；B-4「无空间写权 ⇒ 完全拒收零变化」 |
| EA-1.2.3 固定名 | `g1/G1-CONTRACT-EVENT-AUTHORITY.md:104` | 「Raw 信封的台账行固定名 = 『raw-record-declared』（机制封闭名单成员，机制内部直写）」 |
| 封闭名单 / planned | `g1/G1-CONTRACT-EVENT-AUTHORITY.md:222–243`（§2.4） | 已入账 7 名；提案未入账 4 名（含 `raw-record-declared`，`gated_by EA-1.2.3`，L240/L243）；A 侧 planned 2 名 |
| CS-3.1 cutoff | `g1/G1-CONTRACT-COMMIT-SEQUENCE.md:371` | `cutoff(t) = max{ c ∈ committed ∪ {0} : M(c) ≤ t }`；空 ⇒ c=0（空视图） |
| JC-1 幂等 | `g1/G1-UNIFIED-CONTRACTS.md:360`（§2.11） | 幂等键四元组；重放分支返回首次结果**逐字节**（禁墙钟重算、禁重执行）；同键不产生第二份记录 |

## 10. 边界声明（与 E2 模型-形态边界同纪律）

**本预实验证明的是机制对真实材料的行为；不证明任何科学主张的真值。**
prex 的全部出口 verdict 是域相对值；S-L1 报告与出口记录都是声明面工件。P-1/P-2 的「PASS」只表示
其声明结构在钉住规则集版本下无缺陷，不表示 U-Net 的任何科学结论为真。

## 11. 目录结构

```
prex/
├── README.md          # 本文件
├── VERDICT.md         # 裁决 + 成本表 + 诚实边界 + exit code + 修码记录
├── core.mjs           # 机制切片（digest 链台账 + S-L0/S-L1/报告/出口/幂等/截点）
├── run.mjs            # 轨迹驱动 + 40 断言 + 三场景成本记账
├── crash-probe.mjs    # 进程级中断探针（子进程 exit 9）
├── .gitignore         # 排除 .run/（运行时数据不提交）
└── .run/              # 运行时数据（不提交）
    ├── prex-ledger.jsonl
    └── run-history.jsonl
```
