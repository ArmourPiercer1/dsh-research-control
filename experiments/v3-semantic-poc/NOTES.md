# V3 PoC · P1 离线机制层 NOTES（合成范围）

> 阶段：**P1 的离线机制部分**（Gate P1 的验收须等真实历史接入，本层不写任何
> Gate 声称）。上游权威：`docs/poc/V3_POC_EXECUTION_PLAN.md` §2（安全约束）、
> §4「P1」；`experiments/v3-semantic-poc/SPEC.md`（信封 v0.1）；
> `HISTORY_EVENT_CATALOG.md`（V1 冻结事件目录，**只读投影映射，未修改**）。
> 分支基线：`poc/v3-semantic-poc`（= 本会话起点 main `5022aa5`）。
>
> **合成声明**：本层全部输入 = P0 fixtures + 本目录自建 V1 风格合成历史；
> 无任何真实数据/真实运行。缺的是素材，不是机制。

## 0. 交付面（全部在 `experiments/v3-semantic-poc/`）

| 文件 | 角色 |
|---|---|
| `src/prov.ts` | 纯函数投影：`EnvelopeEvent` 流 → `{activities, entities, agents, usage, generation, derivation}`；每条记录带 `source_ref={file,run_id,event_seq}` 回指；未知项显式 `UNKNOWN` 字段而非省略 |
| `src/replay.ts` | 确定性重放器：一组信封文件 → Run 时间线视图；幂等合并 + 断链/未知项显式 `unresolved` 列表（不报错不静默） |
| `src/v1adapter.ts` | V1 `ResearchHistory` **只读**适配（`v1crosswalk/0.1` 代码常量）：JSONL → 信封 v0.1；缺字段→UNKNOWN，未知类型→unmapped |
| `fixtures/v1-style/*.jsonl` | 两个合成 V1 历史（成功 run+FACT_RECORDED / 失败 run+ARTIFACT_REGISTERED），头注释声明合成 |
| `src/prov.test.ts` `src/replay.test.ts` `src/v1adapter.test.ts` | `test:poc` 收集 |
| `poc-run.mjs` | 扩展 `--project <dir> [--export]`（计数打印 + writeguard） |

改动面：`src/{prov,replay,v1adapter}.ts` 与 `fixtures/v1-style/` 为新增；
`poc-run.mjs`、`poc-run.test.ts` 为扩展；`src/envelope.ts` **仅**把内部
`canonicalize` 加 `export`（行为零变化，供 replay/v1adapter 共用同一规范化器）。
`src/**`、`schema/**`、根契约八文档、`docs/**` 零字节改动。

## 1. PROV / SOSA 映射方向与例外（对齐 `W3C_ALIGNMENT.md` / `CORE_SEMANTICS.md`）

- `prov:Activity` ← `run.*`（Run 是 V1 执行记录，保留来源与活动角色，不假装
  与 `prov:Activity` 一对一等价——#10 §2.2）。`deck.executed`/`analysis.performed`/
  `observation.recorded` 各成子活动；分析子类型标 `dsh:Analysis`（W3C 无 `prov:Analysis`）。
- `prov:Entity` ← artifact / observation 数据物 / deck 输入 / 分析结果 /
  claim+note 记录实体（CORE_SEMANTICS §1「具有固定身份的物体或信息」）。
- `prov:used`→`usage`；`prov:wasGeneratedBy`→`generation`；
  `prov:wasDerivedFrom`→`derivation`。

**SOSA 例外纪律（代码注释 + 正/负例双向锁定）**：
`sosa:Observation`/`sosa:Result` **只**给「deck 执行（仿真运行=测量类比）产出的
单一数值观测」（`observation.recorded` 且 `payload.value` 为有限数）。以下一律
不配 SOSA，只做 prov 投影并显式记 unknown（对应 #10 §6 零容忍「凭空制造
sosa:Observation/sosa:Result」、W3C §四「强制失败 Experiment 有结果」冲突行）：

1. `analysis.performed`（纯分析/后处理）——即使产数值（two-analyses 的 emittance
   两版、strk-02 的 readout）也只出 `prov:Entity`+派生，**测试红灯**：任何
   analysis 活动带 `sosa` 非 null 即失败；
2. 复合/跨 run 观测（strk-04 `quantities` 数组）——被观测对象不唯一，不拆伪 Result；
3. 非数值 `observation.recorded`；
4. 失败 Run 保留 Activity 与错误记录，无可用 Result。

**派生 ≠ 证明**：`derivation` 只承载**数据派生**（分析输出←输入，
W3C §三 DERIVED_FROM 数据侧）。推测/建议 `claim.candidate` 的 `payload.based_on`
是**逻辑推理依据**，属 `dsh:Argument`（P3），原样存进实体的 `based_on_refs`，
**绝不**投影成 `prov:wasDerivedFrom`（W3C §四「把 wasDerivedFrom 当科学结论蕴涵」
冲突行）。测试锁定：derivation 表内不出现 claim_record/note_record 实体。

## 2. 重放幂等与断链处理（Gate P1 第一条的机制层形式）

- `importRunFiles` 以解析后绝对路径为键合并；`buildReplayView` 每次对**导入并集**
  重建视图（knownRuns 解析表在 build 时对全目录重算）→ 重复导入同文件、
  交换导入顺序、两次构建 → `exportReplayView`/`exportReplayEvents` 逐字节一致
  （`exportReplayEvents` 走 `normalizeExport`；`exportReplayView` 走 `canonicalize`）。
- `unresolved` 显式列：① `unknown_item`（unknowns 非空的源，逐条）；
  ② `validator_*`（信封校验问题，含 `dangling_based_on`/`dangling_external_ref`
  即 based_on 解析表外引用）；③ `file_unreadable`/`file_unparseable`。
  构建**永不抛**，坏输入也入账。
- Run 视图状态 `FAILED>FINISHED>RUNNING` 全由事件推出，不伪造终态；失败 Run
  的正常结果实体可为空（合法）。

## 3. v1adapter 与 HISTORY_EVENT_CATALOG.md 的出入（逐条，附目录原文）

映射表 `V1_CROSSWALK_VERSION = 'v1crosswalk/0.1'` 是代码常量。逐事件：

- **信封字段（目录 §1）**：`ownerWorkstreamId`→`source_project`；双时序
  `occurredAt`/`recordedAt`（epoch ms）→ `occurred_at`/`recorded_at`
  （RFC3339，ms→ISO 是格式转换非语义补全，已是 RFC3339 的字符串原样透传，
  不 Date 往返）；V1 原始定位（`eventId`/`ownerWorkstreamId`/`eventSeq`/
  `schemaVersion`/`eventType`/`actor`/`source` + 源文件+行号）完整落输出的 `v1`
  元数据键。目录 §1 原文：「`occurredAt` 允许早于已有事件（late registration…）；
  此时 `eventSeq` 仍取当前最大值 +1 —— 双时序的意义正在于此」。信封 v0.1 的
  `event_seq` 按 SPEC 硬规则 0「一个文件一个 run」在 run 内从 0 重排，V1 原
  `eventSeq` 永久保留在 `v1.event_seq`——**这是有意的重排，非丢失**。
- **`FACT_RECORDED`→`kind=claim.candidate`+`channel=SOURCE_RECORD`**，注入
  unknowns「仅证明当时登记过 Fact 标签，非科学确认」（#10 §2.1 原文：「不把
  历史 `FACT_RECORDED` 转成新的可信 `FactStanding=ACTIVE`；它只证明 V1 当时
  登记过一个名为 Fact 的标签」；W3C §六「旧 `FACT_RECORDED` 不能无审查自动转成
  新的 ACTIVE FactStanding」）。payload 原样透传，不添加任何确认字段；键名级
  扫描测试强制。
- **目录已知但 v0.1 故意不映射**（显式 unmapped 表 + 逐类原因，不伪造近似映射）：
  `RUN_CANCELLED` 是**显式有损折叠**到 `run.failed`（信封无 run.cancelled kind，
  取消语义完整保留于 v1 元数据+payload+unknowns 注记）；`RUNS_STARTED`（目录
  §5.1 信封特例：一事件多 run，与「一个文件一个 run」冲突，需逐 run 拆分规则
  另行裁定）；`CLAIM_RETRACTED`（撤回折叠成 claim.candidate 会歪曲为「提出」）；
  `ARTIFACT_MARKED_MISSING`；`RELATION_ADDED`/`RELATION_REMOVED`（需按 W3C §三
  逐类型分流，P1 不做一刀切）；`TASK_*`/`GATE_EVALUATED`/`MILESTONE_ACHIEVED`/
  `ACCEPTANCE_CRITERION_CHANGED`（计划态/治理，非执行来源，CORE_SEMANTICS §6）；
  `INTERVENTION_CREATED`；`TOPOLOGY_FORK/MERGE_REALIZED`（目录 §4「管理+实际
  发生混合操作」，管理面不映射）。
- **目录外未知 eventType**：显式 unmapped，`reason` 含「未知 eventType」与
  「HISTORY_EVENT_CATALOG.md」字样，raw 完整保留。
- **缺字段→UNKNOWN，禁止补全**：缺 `eventType`/`payload`/`eventSeq`/
  `occurredAt`/`recordedAt`/`ownerWorkstreamId` 的**可映射**事件落 UNKNOWN 表，
  raw 原样保留（不用 occurredAt 顶替 recordedAt，SPEC「不可互相顶替」）；缺
  `actor`/`source`（目录 §1 可选或可推断）不阻断映射，改记 unknowns + UNKNOWN 值；
  `created_by_run` 缺失→显式 `RUN-UNATTRIBUTED-<WS>` 桶。
- **行数守恒测试**：`input_event_lines = mapped + unmapped + unknown`；`#` 注释
  头与空行单列计数（合成声明头不是事件）。

## 4. 本层可被合成测试预验的 Gate P1 项 vs 必须等真实素材

Gate P1 四条（#10 §4-P1）对账：

| Gate P1 验收项（原文摘） | 本层状态 |
|---|---|
| 「相同历史快照重新导入，两次稳定身份、有效事件顺序、可恢复来源引用和轨迹结构一致；重复导入幂等」 | **机制已可合成预验**：replay.test 双构建字节一致、重复导入不翻倍、导入顺序无关、稳定身份(source_ref)+事件顺序+轨迹结构断言 |
| 「100% 导入对象具可追踪源定位或明确缺失来源标记，不允许伪造源 Run/Artifact；已知实际 V1 记录不得静默丢失」 | **机制已可合成预验**：prov.test source_ref 100% 可定位（六表+also_seen_in 回指源行）；v1adapter 行数守恒；unmapped/UNKNOWN 表不丢事件。缺的只是「真实 V1 记录」这一素材面 |
| 「正确区分实际运行、计划 Task、原始数据和加工结果；失败 Run 可保留而无需伪造正常结果」 | **机制已可合成预验**：run/activity 区分、analysis 不冒充 Result、失败 run status=FAILED 且结果实体空、Task 类 unmapped |
| 「零向 V1 生产端回写，零把 FACT_RECORDED 自动升级为科学确认 Fact」 | **机制已可合成预验**：v1adapter 全程只读、writeguard 唯一写区 .poc-data/v3；FACT→claim.candidate+确认字段键名扫描 + unknowns 注记 |

**必须等真实素材（H1 真实历史接入）才能判定的**：真实 Run 的 provenance 完整度、
真实 Artifact 哈希/采样条件缺失比例、真实 V1 记录里 unmapped/UNKNOWN 的实际占比、
真实断链分布、脱敏与权限边界。这些是**素材问题**，本层只保证「喂进去后机制
正确且不撒谎」，不声称 Gate 通过。

## 5. 已知简化（非缺陷，登记）

- `agentOf`：V1 有 `actor.kind` 时直取；否则从 `payload.tool`/`solver` 推断
  软件 Agent；再不可得→显式 `UNKNOWN` Agent 记录（不省略）。真实 V1 的
  Agent 身份细分留待 H1。
- 实体身份合并优先按内容 sha256，其次按路径别名；合成 fixture 复用假 sha 会
  跨文件合并同名实体，`also_seen_in` 保留全部来源定位（真实数据下 sha 才是真值）。
- `--project` 只 glob 目录内 `*.jsonl`（不递归）；`--fixture`/`--project` 互斥。

## P2 机制层（2026-10-26，integrator 内联实现）

> 前委两任代理均因探索期超时无产出被终止，本层由 integrator 按已裁定设计
> 直接实现（设计裁定的完整链条在本目录 git 提交信息可查）。合成范围，无
> Gate 声称。

**实现裁定回放**：
1. 论证结构 = scenario 文件**显式声明**（nodes+paths）；based_on 只作来源
   线索不作结构推断（P1「派生≠证明」同源）。机制读数（observation 的
   mechanism_reading）单独成节点——「质疑机制」有靶而不必撤销观测本体。
2. undercut/rebut 分离：传播=「沿依赖边向下，只染可达路径」；独立路径不可达
   ⇒ 不级联（#10 §1 问题 4）。rebut(claim) 是唯一撤 claim 通道；rebut 节点
   只染节点+直接路径，claim 仍 OPEN。
3. **确认约定**（信封 kind 枚举不可扩）：RESEARCHER_INFERENCE +
   payload.action='semantic_confirmation' + payload.confirming
   {candidate_id|l0_revision_id} 必填 + **payload.actor 必填**（我方加严：
   无授权人=不可归因确认，停留 NEEDS_CLARIFICATION 并列账）。待 P2 Gate 评审。
4. L0 不可变（reviseL0 产新对象 + based_on 指旧版）；槽位缺失恒 'UNKNOWN'
   并记 uncertainties，全链无补全路径（本层无 LLM）。
5. verifyScenario 两趟法：先对被引用信封文件宽松收集 knownRuns，再严格解析
   （strk-04 的跨 run based_on 需解析表——v0.1 规则的复用）。

**与 ARCHITECTURE_BASELINE §4 的出入**：a) 基线的 L1 语义确认是「人工/受授权
动作」抽象——本层落为 payload 约定（上 3），词汇未动；b) 基线 WorldContext/
ResearchScope 为对象字段，本层简化为字符串或 'UNKNOWN'（PoC 面够用，正式
投影留给 V3 实现）；c) 「语义确认状态」基线未给持久形态，本层挂在 L1 记录上
（confirmations[] 每条可回源到确认事件的 source_ref）。

**真实素材衔接**：strk04-degeneracy 场景是合成论证结构 + 真实运行信封混合的
前奏——2026-10-26 实测证伪线性预估签名（strk-06#4）正是「机制读数被疑、
观测记录保留」的真实实例；待 P2 用真实场景文件复刻该攻击时，golden 期望表
直接照抄 strk-06 的语义即可。
