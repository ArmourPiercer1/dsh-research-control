# PoC 完成评审素材包（Go / Iterate / Stop 判定输入）

- **日期**: 2026-10-26 · **main**: `7b160f4`
- **性质**: [执行计划 §8](../V3_POC_EXECUTION_PLAN.md) 最终决策的**素材包**。
  本文**不是** Gate 判定：P1–P4 Gate 均「机制完成、未申请」，判定权在人；
  LIVE_PASSIVE / LIVE_REVIEW / CONTROLLED_ADVISORY 解锁一律未申请。

## 1. 阶段状态总表

| 阶段 | 机制面 | 测试 | Gate | 范围裁定 |
|---|---|---|---|---|
| P0 信封与重放 | 完成（契约 validator、双时间戳、猜测通道 based_on 强制） | 173 总数内 | 入库定位见 P0.md | 合成 |
| P1 真实素材重建 | 机制完成 + **真实 GPT 运行**（strk-05 名义 / strk-06 四极失配，predictions 证伪照录） | 同上 | 未通过未申请 | 真实历史/归档面 **N/A** |
| P2 非单调语义 | 完成（undercut/rebut 选择性波及、L0 不可变、actor 确认态机） | 12 例双向 | 未通过未申请 | 同上 |
| P3 论证层 | 完成（强度 schema **无数值概率面**、AND/OR 支持树、append-only 评价史、CANDIDATE_REVIEW_ONLY 报告） | +20 例 | 未通过未申请 | LIVE_REVIEW 不申请 |
| P4 双图谱 | 完成（可重建双视图、自由读操作、JSON-LD 往返接纳门 + lossReport、stall 建议界面） | +35 例 | 未通过未申请 | 人工 A/B、live 侧车 **N/A** |

## 2. 证据锚点

- PR 链：#20–#24（P0/P1/CI/真实运行）· #25（范围裁定+P2 记录）· #26/#27
  （train 0.2.0-rc.2 + e2e 收口）· #28/#29（P3）· #30（P4）。
- 真实运行数据：`samples/gpt-streak/`（deck/gdf sha256 登记，.gdf 实体按
  数据量控制原则可弃可再生）；observation-spec 预测值证伪后**原文保留**。
- 逐数字报告：`experiments/v3-semantic-poc/REPORT-P4.md`（实跑）。

## 3. 质量指标面（§6 五指标，样本量随注）

| 指标 | 当前读数 | 样本量/边界 |
|---|---|---|
| ① 源可追踪与未解析覆盖 | 43/43 边带 provenance；unknowns/dangling 显式入账不消失 | 合成 corpus 7 信封 + strk-05/06 |
| ② L0/L1 语义与未知项 | 槽位缺失恒 `UNKNOWN`，12 例锁死禁编造 | 场景 2 + 负例 5 |
| ③ 已知前提缺口检出 | 机械植入 7 缺口：双视图交替 7/7 可达（成本 104 节点照录） | **样本 7，禁外推** |
| ④ 不适用的反驳/因果误报 | 选择性波及负例 + 高风险措辞四族自查命中即 flagged | 构造面，非现场率 |
| ⑤ 召回噪声/成本 | rawScan 7q/31n ↔ bothAlternating 6q/104n 全表照录 | 同上 |

**零容忍自检**：V1 生产面零写入（PoC 全程只碰 `experiments/**` 与
gitignored `.scratch/.poc-data`）；无数值置信冒充 FactStanding（schema 拒收）；
无凭空 `sosa:Observation`（导出接纳门 + 守卫点名）；PoC 未接触真实科研任务
（不存在受其影响的通道——advisory 面连修改 API 都不存在）。

## 4. N/A 清单（范围裁定 ≠ PASS）

1. P1 真实历史素材面（归档 Run/ResearchHistory 只读副本）——不存在。
2. P4 人工标注四组 A/B——机器植入缺口替代面已声明偏差。
3. P4 live task 侧车——无真实并行任务；advisory 为 stall 形态。
4. 三个接入级别解锁——全部不申请。

## 5. §8 三选项的事实面（判定输入，非判定）

- **GO**（原文条件含「真实任务观察无副作用」）：该子项**无样本**——范围内
  不可满足字面条件。若判定改采「范围内 GO」语义 = 机制层成立，可启动
  正式 V3 实施契约起草；真实任务面留待素材就绪的后续 PoC。
- **ITERATE**：机制基座正确、无不可追踪有损、无伪造强论证；已知可定位
  局限（SHACL 子集、机械对照≠人工 A/B、强度面纯定性）全部有明确扩展位。
- **STOP**：触发条件（持续误把弱关联当证明 / 来源丢失 / 影响真实任务）
  均未出现，各有双向测试为证。
- **integrator 建议立场**：按 §8 字面 = **ITERATE**（真实任务面缺样本，
  不宣布完整 GO），同时**并行起草 V3 正式实施契约**作为下一阶段准备
  （属开发规划，不依赖任何 Gate 解锁）；接入级别提升维持冻结直到真实
  素材/授权就绪。

## 6. 遗留队列（PoC 外，工程侧）

train 0.2 迁移遗留三件（settings-card→configForms、load/unload 泄漏环、
investigator GUI 走查）；`known_debts.e2e_spec_layer`（上游语义）；可选：
为 strk-06 证伪签名做判别实验（real2sim-experimental-design 路线）。

---

## 7. §8 用户裁定（2026-10-26，只追加）

- **判定 = ITERATE**（§8 字面语义）：机制基座正确、无触发 STOP 条件；真实
  任务面因素材不存在缺样本，不宣布完整 GO。
- **并行动作获准**：起草 **V3 正式实施契约**（提案文档，非冻结；起草与
  评审属开发规划，不依赖任何 Gate 解锁，不改冻结面）。
- 队列优先级（用户选定）：V3 契约起草 **优先**；train 遗留三件与 strk-06
  判别实验在其后排队。
- 门禁复审：用户裁定**本轮不拉昂贵模型**（评审以本素材包 + integrator
  复核为准；契约草案入库后是否复审届时再裁）。
