# V3 正式实施契约：草案（DRAFT-PROPOSAL）

> 状态：**DRAFT-PROPOSAL · 非冻结契约** · 内容仅提升 PoC 已实证事实，不新增未实证
> 能力承诺 · 冻结面（8 份根文档 + `schema/**`，基准哈希
> `docs/engineering-baseline/gates/G0-inventory.yaml`）的任何修订必须走
> `pnpm run snapshot:update` 冻结变更流程，**本文只登记待裁项，不改冻结面** ·
> `LIVE_PASSIVE / LIVE_REVIEW / CONTROLLED_ADVISORY` 全部**未解锁**（PoC §8 范围
> 裁定；本文不构成任何解锁动作或申请）。

- **起草日期**：2026-10-27。
- **上游依据**：
  - PoC 完成评审素材包 [../poc/gates/POC-COMPLETION-REVIEW.md](../poc/gates/POC-COMPLETION-REVIEW.md)
    （main=`718b26d`，PR #31 合并；PR 链 #20–#30）；
  - §8 用户裁定 = **ITERATE** + 「并行起草 V3 正式实施契约」获准（素材包 §7，裁定提交 `80e546e`）；
  - PoC 契约与证据：[../../experiments/v3-semantic-poc/SPEC.md](../../experiments/v3-semantic-poc/SPEC.md)
    （prov-envelope v0/v0.1 + 落地裁定）、
    [../../experiments/v3-semantic-poc/NOTES.md](../../experiments/v3-semantic-poc/NOTES.md)
    （P1–P4 实现裁定与偏差登记）、
    [../../experiments/v3-semantic-poc/REPORT-P4.md](../../experiments/v3-semantic-poc/REPORT-P4.md)（逐数字实跑）；
  - 接入级别与决策语义：[../poc/V3_POC_EXECUTION_PLAN.md](../poc/V3_POC_EXECUTION_PLAN.md) §5/§6/§8；
  - 方向性原则（D13–D20，未冻结 Schema）：[ARCHITECTURE_BASELINE.md](ARCHITECTURE_BASELINE.md)。
- **词汇纪律**（沿 SPEC 硬规则 4 与执行计划 §5 注）：旁路接入级别只用
  `LIVE_PASSIVE / LIVE_REVIEW / CONTROLLED_ADVISORY`；`L0/L1`、`L2–L5` 恒指科研
  形式化等级（基线 §4），两套词汇永不互推。

## 1. 范围与非目标

**范围**：把 PoC P0–P4 已实证的论证 / 关联 / 受控建议机制正式化为可评审、可回归
的实施契约——信封与来源边界、非单调语义算子、论证层对象、双图谱读面与 W3C
交换、隔离渠道接纳门、受控建议治理接口。PoC 测试族 `test:poc` 共 **173 例**
（P2 为 12 例双向；P3 +20 例 118→138；P4 +35 例 138→173）是本契约各模块验收的
**唯一实测底账**，正式回归由这些族提升而来。

**非目标**：

| 非目标 | 依据 |
|---|---|
| 不触碰 V1 生产科研状态写入（`.research/**`、生产 DB、canonical Plan、Gate、Agent 权限） | PoC 零容忍自检「V1 生产面零写入」全程成立（素材包 §3） |
| 不做真实任务接入（H1 真实历史、live passive、live A/B、advisory 试运行） | 素材/授权未就绪：P1 真实历史面、P4 人工 A/B 与 live 侧车均为 N/A（素材包 §4） |
| 不预设统计置信模型；不引入数值概率字段 | 强度面纯定性已实测（§2 M3）；基线 §1「统计检验不自动证明因果结论」 |
| 不冻结 L2–L5 等级、不做 Lean 内核证明、不做通用因果发现或全量 RDF 迁移 | 执行计划 §1 非目标；基线 §4「L2–L5 不冻结为单一真理阶梯」 |
| 不解锁 `LIVE_*` 任何级别；不申请任何 Gate | 素材包 §4 N/A 清单第 4 条；§8 裁定「接入级别提升维持冻结」 |
| 不改冻结面：`schema/**`、8 份根文档、`SNAPSHOT.md` 均零字节 | 本文性质 = 提案；修订走 snapshot:update |

## 2. 模块分解与 PR 切分

每模块三节：**正式接口**（= PoC 对应面的提升，全部有 PoC 实现与测试为证）、
**验收**（指明提升哪些 PoC 测试族为正式回归）、**明确不做**。测试族文件名以
`experiments/v3-semantic-poc/src/` 实测为准。

### M1 provenance-envelope（来源信封与来源投影）

| 面 | 正式接口（PoC 实证面提升） |
|---|---|
| 信封契约 | `poc/prov-envelope/v0.1` 全部硬规则固化为契约候选：一文件一 run、`event_seq` 从 0 起严格 +1 无空洞不可回退（断号/重号 = 文件级拒绝）；三通道不混存（`SOURCE_RECORD` payload 键名命中 `/inference\|suggestion\|llm_/` 即拒，仅作用于键名、大小写敏感）；推测/建议通道 `payload.based_on` 强制（整数同文件 seq 或 `{run_id,seq}` 跨文件，悬空 = `dangling_*` 拒绝）；双时间戳 `occurred_at`/`recorded_at` 不可互相顶替（ms→ISO 是格式转换非语义补全）；`content_sha256` hex 64 位小写、可 null + `unknowns` 指路 |
| 重放与投影 | `importRunFiles`/`buildReplayView` 确定性重放（重复导入、乱序、两次构建逐字节一致）；`unresolved` 显式列（unknown_item / validator / file_unreadable），构建永不抛、坏输入也入账；prov 六表投影每条带 `source_ref={file,run_id,event_seq}` 回指 |
| V1 只读适配 | `v1crosswalk/0.1` 版本化 Crosswalk：`FACT_RECORDED → claim.candidate + SOURCE_RECORD` + 「仅证明登记过标签」unknowns 注记；缺字段→`UNKNOWN` 禁补全；已知未映射类别显式 unmapped 表（含 `RUNS_STARTED` 一事件多 run，见 R10）；行数守恒 `input_event_lines = mapped + unmapped + unknown` |
| SOSA 例外纪律 | `sosa:Observation/Result` 只给「deck 执行产出的单一数值观测」；纯分析、复合/跨 run 观测、非数值观测、失败 Run 一律不配 SOSA（测试红灯双向锁定） |
| 写入边界 | writeguard：唯一允许写区（PoC 为 `.poc-data/v3/**`），越界即 FATAL 非静默 |

- **验收**：`envelope.test.ts`、`poc-run.test.ts`、`writeguard.test.ts`、
  `prov.test.ts`、`replay.test.ts`、`v1adapter.test.ts` 族整体提升为正式回归；
  43/43 边带 provenance 的可追踪覆盖口径保留。
- **明确不做**：不把 envelope 并入 `schema/**`（关系待裁 R1）；不做多 run 全局
  叙事顺序（由投影层时间维度承担）；不承诺真实 V1 记录的 unmapped 实际占比
  （素材问题，非机制问题）。
- **待裁挂点**：R1、R10。

### M2 语义算子（L0/L1 与非单调语义）

| 面 | 正式接口 |
|---|---|
| undercut/rebut 选择性波及 | 传播 =「沿依赖边向下，只染可达路径」；独立路径不可达 ⇒ 不级联；`rebut(claim)` 是唯一撤 claim 通道，rebut 节点只染节点+直接路径，claim 仍 OPEN |
| L0 不可变 | `reviseL0` 纯函数产新对象（rev+1、`based_on` 指旧版）；槽位缺失恒 `'UNKNOWN'` 并记 uncertainties，全链无补全路径 |
| actor 确认态机 | 确认必须带 `actor`（无授权人 = 不可归因确认，停留 `NEEDS_CLARIFICATION` 并列账）；PoC 确认约定 = `RESEARCHER_INFERENCE` + `payload.action='semantic_confirmation'` + `payload.confirming{candidate_id\|l0_revision_id}` 必填 + `payload.actor` 必填（我方加严） |
| 场景验证 | `verifyScenario` 两趟法（先宽松收集 knownRuns 再严格解析），跨 run `based_on` 复用 v0.1 解析表规则 |

- **验收**：`semantics.test.ts` 12 例双向族提升为正式回归（含「槽位缺失恒
  UNKNOWN、禁编造」负例 5）。
- **明确不做**：本层无 LLM、不猜原作者意图；不实现对象化 WorldContext/
  ResearchScope 正式投影（取态待裁 R3）。
- **待裁挂点**：R2、R3、R4（NOTES「P2 与基线 §4 的出入」三条偏差的正式化取态）。

### M3 论证层（EvidenceRelation / Argument / Assessment / FactStanding）

| 面 | 正式接口 |
|---|---|
| EvidenceRelation | **记录用、不评分**：`EvidenceStrength = QUALITATIVE(WEAK\|MODERATE\|STRONG + basis) \| NOT_QUANTIFIED(+reason)`——类型层无数值概率字段；键名命中 `/probability\|p_ho\|confidence/i` 一律拒收；`conditions` 缺省记 `['UNKNOWN']`；`relation_id=stableId(内容)`，手写冒充被 `relation_id_mismatch` 拒 |
| ArgumentRevision | 不可变（同 L0 纪律）；`SupportNode = LEAF \| AND（合取）\| OR（替代支持路径）`，允许联合 Observation/结果作 LEAF，不要求和评分 |
| Assessment | append-only：导出面无删除/覆盖 API（白名单测试）；「当前判断」只能 `latestFor` 派生；已入账条目 `Object.freeze`；target 三形态 ∈ `{argument_id, premise:x, applicability:x}`，格式非法 → 拒记 + unresolved 列账 |
| FactStanding | 本地、无生产影响；默认 CANDIDATE 且默认停留；仅带 actor 的显式确认可推 STANDING；attack 记 CONTESTED/SUSPENDED；**无从 report/LLM 分数自动生成 standing 的通道**（导出名白名单 + 类型面双锁） |
| 反例基线 | 三反例 golden 提升为契约级回归：independent-paths（undercut 只染含靶的 OR 分支）、explanation-falsified（解释被疑、观测与历史断言保留）、formal-valid-applied-fails（数学可信与适用性失败并存互不覆盖） |

- **验收**：`argument.test.ts` 族（P3 +20 例中论证面）+ `fixtures/argument/*`
  golden 提升；strk-05/06 真实运行信封挂接的 golden 保留（实测签名
  (+7.4%,+15.0%) vs 预估 (+21.8%,+6.7%) 的证伪照录不涂改）。
- **明确不做**：正式 Theory 对象（含形式化证明工件）不在 V3 首批——PoC 只做
  「数学可信 vs 工程适用性失败并存」最小对照；数值强度（R6 裁定前）。
- **待裁挂点**：R6、R11。

### M4 双图谱读面 + W3C 交换

| 面 | 正式接口 |
|---|---|
| 双视图 | `buildViews(files, baseDir, scenarioFiles?)` 纯函数从同一批信封派生 `{inference, association}`，**无独立存储**；两次 build canonicalize 后逐字节相同（含入参乱序不变）；scope/version 缺失 = `'UNKNOWN'` 占位禁补全 |
| Association 边 | 闭集 SAME_RUN / SHARED_ARTIFACT / SHARED_DECK / CROSS_RUN_BASIS / REGISTERED_FINDING / SOURCED_ASSOCIATION，超出即拒；`origin ∈ {STRUCTURAL, REGISTERED, SOURCED}` 构造期定死、**无任何改写 API**（弱边绝不升格）；无锚 SOURCED_ASSOCIATION 零入图 + 拒收账；断链 → broken_references 账，禁静默 |
| 读操作 | `queryView`：start/direction/edgeTypes(闭集子集)/maxHops(1..6)/prune/limit 自由组合，**无默认必查工作流**；返回恒注「关联不等于因果/已支持」；truncated/dropped_count 真实计数入账；视图属性投影即读法边界（盲区是设计事实，不跨视图补全） |
| W3C 交换 | JSON-LD 导出/导入零依赖；@id 由 run_id/seq 确定性派生；**接纳状态门**：仅带 actor 确认记录方可 `poc:status:'asserted'`，未确认一律 candidate 且零 sosa 事实谓词（构造期门 + `findGateViolations` 独立守卫）；导入未知字段逐条 `lossReport {at, field, action:'dropped'}`，禁静默；往返对核心面语义等价（对象 ID、关系语义、provenance、unknowns、状态、broken/确认账） |
| 形状校验 | `validateShapes` = node kind 必填属性 + 枚举值域（**子集**，见 R5）；SHACL 通过永不等于科学判真 |

- **验收**：`graph.test.ts`、`w3c.test.ts`、`ab.test.ts` 族（P4 +35 例中三面）
  提升；strk-05/06 golden（SHARED_DECK=0、SHARED_ARTIFACT=0、CROSS_RUN_BASIS=1、
  SAME_RUN=10、rejections=0、broken=0）与 ab 合成语料 golden **两侧分开锁定**；
  导出面读数口径保留（asserted 1/5、candidate 4/5、非 SUPPORTS 证据边 1/6、
  无锚联想入图 0）。
- **明确不做**：不引入 RDF 原生写入或多数据库（真源一个，图是可重建投影，基线 §2）；
  不把机械 A/B 读数（检出率 raw 4/7、inference 3/7、association 4/7、both 7/7；
  成本 queries 7/5/1/6、nodes_visited 31/62/42/104；样本 7 缺口，**禁外推**）
  当作人工 A/B 证据（R7）。
- **待裁挂点**：R5、R7。

### M5 隔离渠道与接纳门（候选报告）

| 面 | 正式接口 |
|---|---|
| 报告状态 | `generateCandidateReport` 输出 status 恒为常量 `CANDIDATE_REVIEW_ONLY`；推理/建议通道 → 候选论证条目、observation → 候选证据条目（各带 source_ref 锚点）；unknowns/based_on 断链 → missing_inputs 清单（断链条目宁缺勿错，不入候选区） |
| 措辞自查 | 输出逐条递归过 `scanHighRiskPhrasing` 四族正则（证明成立/为真、相关即因果、run 通过证理论、置信度即事实），命中即整条降级 `flagged` 区并加 unknowns，正式候选区不含 |
| 固定声明段 | 渲染面恒在场：「仅供人阅览、不注入主 Agent 指令、未经审查不得转正式 Fact/Task/Obligation」 |
| 词汇纪律 | 接入级别词只用三个正式词（SPEC 落地裁定 6：行文纪律不作校验器规则——正式化后是否升级为部署面机械检查见 R9） |

- **验收**：`report.test.ts` 族（P3 +20 例中报告面，含 high-risk fixtures 端到端
  负例：喂违规信封 seq1/2 必 flagged；固定声明段负例）提升为正式回归。
- **明确不做**：不解锁 LIVE_REVIEW、不提供任何注入主 Agent 指令的在线渠道
  （报告生成器只是 LIVE_REVIEW 形态的离线前身，PoC 已声明）；不自动转正式
  Fact/Task/Obligation。
- **待裁挂点**：R9。

### M6 受控建议治理（只定义接口与冻结面）

**实现整体挂起至真实任务 + 授权就绪**；本模块在 V3 首批只交付接口与纪律，
PoC 面（advisory.ts）即接口蓝本：

| 面 | 冻结的接口纪律 |
|---|---|
| stall 语义 | 无授权不行动：授权三要素 `granted_by / scope / expires_at` 缺任一 → `NEEDS_AUTHORIZATION`；过期 → `EXPIRED`（时钟由调用方 `now` 注入，模块内无 `Date.now`）；越权 → `OUT_OF_SCOPE` |
| 零副作用 | 无 fs/进程/网络 import；全路径零副作用（目录 sha 前后同）；有授权也只回「可审阅材料」渲染文本（声明段与 M5 同语义） |
| 授权边界 | 导出名白名单 = **4**：面上不存在任何修改 FactStanding/Task/配置/命令的 API；授权必须由用户或外部权限治理系统显式授予（执行计划 §4-P4） |

- **验收（仅接口 PR）**：`advisory.test.ts` 族作为接口回归蓝本；行为面的正式
  验收（「建议由外部系统按授权交付、出错不影响主任务、可立即停止」）挂起至
  R8 前置条件满足后的真实任务 PoC。
- **明确不做**：不实现任何真实任务接线、不实现自动交付通道、不做 Agent 编排
  或唤醒循环（PoC §2 安全约束继承）。

## 3. 待裁事项登记表

| ID | 待裁事项 | 正式化选项 | 影响 | 建议 |
|---|---|---|---|---|
| R1 | prov-envelope/v0.1 与仓内 `schema/**` 冻结契约的关系 | (a) 独立新契约文件；(b) 并入 `schema/**`（触发冻结流程）；(c) 双层：`schema/**` 仍为仓内事件唯一真源，envelope 定位为导入/交换边界契约 | 决定 M1 交付物落点与 snapshot:update 触发面 | **(c)**；合并点由冻结流程另行评审 |
| R2 | NOTES P2 偏差 a：L1 语义确认载体——payload 约定 vs envelope 正式 kind（PoC 因「kind 枚举不可扩」被迫用 payload 约定） | (a) 沿用 payload 约定；(b) 正式 kind（如 `semantic.confirmation`）进入契约 v1 | (b) 机器可校验更干净，但打破 v0.1 枚举裁定、需全 validator 族重跑 | **(b) 方向，在 R1 落点裁定后执行** |
| R3 | NOTES P2 偏差 b：WorldContext/ResearchScope 对象化（基线 §4 为对象字段，PoC 简化为字符串/'UNKNOWN'） | (a) 正式化仍用字符串；(b) 直接对象化；(c) L0 提交=字符串，L1 确认=对象化引用 | 影响 L0/L1 分层语义与 crosswalk 形状 | **(c)**，与基线 §4 渐进语义对齐 |
| R4 | NOTES P2 偏差 c：语义确认状态持久形态（基线未给；PoC 挂 L1 记录 `confirmations[]` 可回源确认事件） | (a) 固化 PoC 形态；(b) append-only 确认事件、状态读面派生 | (a) 与「append-only、无就地篡改」总纪律不一致 | **(b)**，PoC 读形态保留为投影 |
| R5 | SHACL 差距：PoC `validateShapes` 为子集（必填属性/枚举值域；无 path 表达式/约束组件库/目标选择器） | (a) 声明永久子集并文档化边界；(b) 引入完整 SHACL 实现；(c) 自定义「形状契约子集」正式文档+测试 | 交换面校验强度声明的可信度 | **(c) 先行，(b) 按需**；零容忍措辞保留：SHACL 通过 ≠ 科学判真 |
| R6 | 强度面纯定性：`EvidenceStrength` 类型层无数值概率面 | (a) 永久纯定性；(b) 预留「外部统计证书引用」记录位（系统不产数、只存外部签发证书引用）；(c) 开数值字段 | (c) 直接违反 PoC 已锁负例与基线 §1 | **(a)+(b)**：数值只进外部证书对象，永不进 EvidenceRelation |
| R7 | 机械 A/B 证明力边界：四读法（rawScan/inferenceOnly/associationOnly/bothAlternating）+ 机器植入 7 缺口 ≠ 人工标注四组 A/B | (a) 机械面仅作回归基线，人工 A/B 待素材另跑；(b) 视机械读数为发布证据 | 合成数字被误当现场率的合规风险 | **(a)**；「测的是机器可达缺口」声明句（PoC 文件头原句）升为契约措辞 |
| R8 | LIVE_PASSIVE / LIVE_REVIEW / CONTROLLED_ADVISORY 解锁前置 | (a) 契约只登记前置（对应 Gate 通过 + 素材存在 + 人工裁定，逐级）；(b) Gate 通过自动解锁 | (b) 与 PoC 全程「判定权在人」裁定链冲突 | **(a)**；本文**不解锁任何级别**，前置沿用执行计划 §5 表 |
| R9 | 高风险措辞自查从「生成方自查」到部署面要求：自查与检查同源是单点 | (a) 仅生成方自查（PoC 形态）；(b) 部署面独立复检；(c) 双保险且自查不豁免部署面 | 隔离渠道最终出口的最后防线 | **(c)**；部署面复检为渠道准入条件 |
| R10 | `RUNS_STARTED` 一事件多 run 与「一文件一 run」冲突（PoC 显式 unmapped，「需逐 run 拆分规则另行裁定」） | (a) 定拆分规则：每 run 派生一条 run.started 信封、`v1` 元数据完整保留原事件、行数守恒扩展为「1 事件 N 记录」登记；(b) 永久 unmapped 交叙事层 | 真实 V1 导入覆盖率 | **(a)**，PR-V3-1 内裁定 |
| R11 | Assessment/FactStanding 持久化：PoC 为内存 append-only，「落盘与生产接线留待正式实现」 | (a) 事件源落盘（Git+SQLite 投影，基线 §2「真源一个、图可重建」），写区限 V3 自有 store；(b) 暂不固化 | 决定 M3/M5 是否可重启即恢复 | **(a)**；零容忍 ① 继承——绝不写 V1 生产 DB |

## 4. 实施 PR 序列

主链 **M1 → M2 → M3 → M4 → M5**；M4/M5 在 M3 合入后可并行；M6 只出接口 PR。
每 PR 的验收 = 对应 PoC 测试族提升进正式回归（挂点见 §2 各模块「验收」行）：

| 顺序 | PR | 内容 | 前置待裁 | 验收族 |
|---|---|---|---|---|
| 1 | PR-V3-1（M1） | 信封契约固化（R1 落点 + R10 拆分规则裁定在此 PR 内完成）、validator、重放、v1crosswalk、writeguard | R1、R10 | envelope / poc-run / writeguard / prov / replay / v1adapter |
| 2 | PR-V3-2（M2） | 语义算子正式化（确认载体、Scope 对象化、确认态持久形态按 R2–R4 裁定实施） | R2、R3、R4 | semantics（12 例双向） |
| 3 | PR-V3-3（M3） | 论证层四对象 + 三反例 golden；R6/R11 裁定落地 | R6、R11 | argument（+三反例 golden） |
| 4 | PR-V3-4（M4） | 双视图、queryView、W3C 交换接纳门、形状子集边界声明 | R5（差距声明）、R7（口径声明） | graph / w3c / ab（两侧 golden 分开） |
| 5 | PR-V3-5（M5） | 候选报告 + CANDIDATE_REVIEW_ONLY 接纳门 + 措辞双保险 | R9 | report |
| 6 | PR-V3-6（M6） | **仅接口**：advisory 类型、授权三要素、导出白名单纪律文本；行为实现挂起 | R8 登记，不解锁 | advisory（作接口蓝本） |

纪律：每 PR 独立可回退；R 表未裁项不得由实现顺手定死——PR 描述必须引用 R 编号
并注明裁定结论；涉及 `schema/**` 的落点（若 R1 取 (b)/(c) 合并点）单独走
snapshot:update 评审提交，不混入功能 PR。

## 5. 风险与停止条件

**继承执行计划 §6 零容忍**（任一出现 = 立即停止提升接入级别、保留可复现失败
记录、回到最小抽象审查，不通过添加隐式例外掩盖）：

1. 任何对 V1 生产研究 DB、`.research/**`、canonical Plan、Gate、Agent 权限的
   非授权写入；
2. 将 `FACT_RECORDED`、LLM 评价、检索相似、联合关联边或形状校验通过误写成
   「科学事实已证明」；
3. 丢失原始事件来源/旧修订，或凭空制造 `sosa:Observation`/`sosa:Result`；
4. 契约实施故障阻塞、终止或更改真实科研任务。

**ITERATE 语义的契约化**（§8 裁定 = ITERATE：机制基座正确、可定位局限有扩展位）：
出现**语义不变量违反**（本文件 §2 各「正式接口」行即为不变量清单）⇒ 回该抽象
最小面修订并重测对应族，**不全面扩展功能**；STOP 触发条件（持续误把弱关联当
证明 / 来源不稳定保留 / 影响真实任务 / 被迫引入隐式例外）任一出现 ⇒ 按执行
计划 §8 停产品化、保留失败经验。

**契约层特有风险**：

| 风险 | 对策 |
|---|---|
| 契约超出 PoC 实证面承诺能力 | §2 每模块验收只挂既有 PoC 族；无对应族的承诺不得写入契约正文，只能进 R 表 |
| 合成读数被当作现场率外推 | 样本 7 缺口禁外推、机械 A/B ≠ 人工 A/B 已入 R7 与 M4「明确不做」 |
| 草案被误读为已批准契约 | 状态头 DRAFT-PROPOSAL + 非冻结声明；批准由人工评审另行给出 |
| 未跟踪草案与文档导航脱节 | 是否入 `docs/README.md` 导航与 doc-ownership 由 integrator 入库时一并裁，本文不自装 |

---

*本文档为唯一交付物；未修改任何已跟踪文件。所有数字取自素材包与
`experiments/v3-semantic-poc/REPORT-P4.md`，未新增计算或外推。*
