# REPORT-P4 —— 双图谱、联合召回、W3C 交换与受控建议（机制层运行报告）

> 生成方式：本报告全部数字来自 `runAbStudy('fixtures/ab/corpus')` 与
> `buildViews`（`src/ab.ts` / `src/graph.ts` / `src/w3c.ts`）的**真实运行输出**
> （复现命令见 §6），非估算、非编造；「负结果照录」纪律适用。
> 样本量：合成任务包 7 份信封 / 31 条保留事件 / **7 个机器植入缺口**；
> 挂接面 strk-05/06 真实 GPT 运行信封 2 份 / 10 事件。**样本极小且缺口为
> 机器植入，一切检出率不外推。**

## 0. 范围裁定与 N/A 声明（写死，≠ PASS）

2026-10-26 用户裁定：PoC 素材 =「合成 + 真实 GPT 运行」（strk-05/06 信封）。
与 #10 P4 原文的两处偏差（**均为 N/A（范围裁定），不是通过**）：

1. **「脱敏真实任务四组人工标注 A/B」= 素材不存在 → N/A**。本报告 §2 的
   四组数字是**机器植入答案键的机械召回对照**（`fixtures/ab/corpus/planted.json`
   植入缺口 + 机械可达性判定），测量的是「机器从该读法可达的植入缺口」，
   **不是人类问题发现质量**，不能替代也不声称替代人工标注 A/B。
2. **「live task 侧车试运行」= 素材不存在 → N/A**。`src/advisory.ts` 的
   受控建议界面只是 stall 形态的离线机械面（无授权零副作用 + 导出名白名单
   已测），无任何 live 注入渠道，不声称 LIVE_REVIEW 解锁。

另一处实现面偏差（如实登记）：`src/w3c.ts` 的 `validateShapes` 是
**SHACL-风格形状校验子集**（node kind 必填属性/枚举值域），非 RDF/SHACL
完整实现；文件头已声明。

## 1. 语料与两视图规模（真实输出）

| 面 | 数字 |
|---|---|
| AB 合成任务包 | 7 文件、31 保留事件、拒收账 1 条（无锚经验联想）、断链账 2 条（inference EVIDENCE 1 + association REGISTERED_FINDING 1） |
| AB 视图规模 | inference/association 合计 43 条边（两视图） |
| strk-05/06 真实运行挂接面 | events_kept=10；inference 节点 16、边 2（EVIDENCE：strk-06#3→assertion、strk-05#4→assertion）；association 节点 12、边 11（SAME_RUN 10 + CROSS_RUN_BASIS 1）；SHARED_DECK=**0**（两 deck sha 不同，golden 锁定）；SHARED_ARTIFACT=0；rejections=0、broken=0 |

## 2. 四读法召回对照（逐字数字，`runAbStudy` 输出）

植入缺口 7 个（GAP-01 断链 / GAP-02 无锚联想 / GAP-03 共享 deck 无机制 /
GAP-04 artifact sha 缺锚缺失 / GAP-05 finding 指向不存在 / GAP-06 证据无支持
关系 / GAP-07 失败运行依据）。

### 2.1 检出率（per_read_detection_rate，逐字）

| 读法 | detected / planted | 比率 | queries | nodes_visited |
|---|---|---|---|---|
| rawScan（纯文本单趟线性，无图） | **4 / 7** | 57.1% | 7 | 31 |
| inferenceOnly（只读 inference 视图） | **3 / 7** | 42.9% | 5 | 62 |
| associationOnly（只读 association 视图+账目） | **4 / 7** | 57.1% | 1 | 42 |
| bothAlternating（两视图交替） | **7 / 7** | 100% | 6 | 104 |

### 2.2 每缺口 × 每读法可达矩阵（逐字）

| gap_id | gap_kind | rawScan | inferenceOnly | associationOnly | bothAlternating |
|---|---|---|---|---|---|
| GAP-01 | dangling_based_on | ✅ | ✅ | ❌ | ✅ |
| GAP-02 | anchorless_association | ✅ | ❌ | ✅ | ✅ |
| GAP-03 | shared_deck_no_mechanism | ❌ | ❌ | ✅ | ✅ |
| GAP-04 | artifact_sha_unanchored | ✅ | ❌ | ✅ | ✅ |
| GAP-05 | finding_target_unresolvable | ❌ | ❌ | ✅(resolvable_source=**false**) | ✅(false) |
| GAP-06 | no_support_evidence | ✅ | ✅ | ❌ | ✅ |
| GAP-07 | failed_run_basis | ❌ | ✅ | ❌ | ✅ |

### 2.3 命中标注与 extras（逐字）

- rawScan hits：GAP-01/02/04/06，resolvable_source 全 true；extras=0；cost {queries:7, nodes_visited:31}
- inferenceOnly hits：GAP-01/06/07，resolvable_source 全 true；extras=0；cost {queries:5, nodes_visited:62}
- associationOnly hits：GAP-02/03/04（true）+ GAP-05（**false**，指向不存在对象不冒充可回源）；extras=0；cost {queries:1, nodes_visited:42}
- bothAlternating hits：GAP-01…07 全部（GAP-05 false）；extras=0；cost {queries:6, nodes_visited:104}

## 3. 指标面（P4 四项，全部真实计数）

1. **可追踪覆盖率**：两视图 43 条边 **43/43 = 100%** 携带非空 provenance
   （SourceRef[] 回源锚）；18 条 hits 中 16 条 resolvable_source=true，
   2 条 false（均为 GAP-05，**明列不隐藏**）——覆盖率=100% 指「每条边/检出
   都有回源锚或明示不可回源」，不是「一切可回源」。
2. **植入缺口检出率（per 读法）**：raw 4/7、inference 3/7、association 4/7、
   both 7/7（§2.1）。**负结果照录**：rawScan 漏掉全部 3 个需要跨行联键/跨文件
   知识的缺口（GAP-03/05/07）；单视图各漏 3–4 个；单视图对合成语料的漏检
   模式由视图属性投影边界决定（sha 面在 association、run 失败结局在 inference），
   这是机制设计的事实而非缺陷。
3. **无根据引用率（导出面）**：断言对象 5 个中 asserted=1（20%，唯一 actor
   确认记录 A#3←dr.zhang）、candidate=4（80%，零 sosa 事实谓词，守卫零违例）；
   证据边 6 条中非 SUPPORTS 1 条（16.7%，GAP-06 的 CONTEXTUALIZES）；
   无锚经验联想入图 **0** 条（拒收账 1 条）。
4. **成本**：召回从 42.9%（inferenceOnly）提升到 100%（bothAlternating）的
   代价是 queries +1、nodes_visited +42（62→104）；associationOnly 以最低
   节点成本（42）拿到与 rawScan 相同检出数但缺口集合不同（互补）。

## 4. 固定负例（全部有测试锁定，173/173 绿）

① 无锚 SOURCED_ASSOCIATION 拒收列账（0 入图+账 1 条）；② buildViews 两次
canonicalize 后逐字节相同（含入参乱序）；③ queryView truncated/dropped_count
真实计数（limit=2 于 5 边 → dropped=3）；④ 未确认 Assertion 零 sosa 谓词 +
asserted 必须有 actor 确认记录（守卫对人工违规 doc 也点名）；⑤ exotic 字段
往返 lossReport 恰好 1 条且点名 `exotic:field`+所在 @id；⑥ deliverAdvisory
无授权/过期/越权三类拒投递且目录 sha 前后不变 + 导出名白名单=4；⑦ 四读法
hits 全部回锚答案键、extras=0、resolvable_source 假者仅 GAP-05 明列。

## 5. 结论边界（不夸大）

- 「bothAlternating 7/7」只说明：**在机器植入缺口 + 视图属性投影即读法边界**
  的合成设定下，双视图交替读取对全部植入缺口可达。它不构成任何人类问题
  发现能力、真实任务召回率或 Gate 通过的证据。
- 弱边不升格纪律在输出面成立：origin 一经构造不改写（STRUCTURAL/REGISTERED/
  SOURCED 三类各有 golden 断言）；关联查询结果恒带固定注记「关联不等于
  因果/已支持」。
- 不声称 Gate；本报告是机制层运行记录。

## 6. 复现

```sh
cd experiments/v3-semantic-poc
node --experimental-strip-types --input-type=module -e \
  'import("./src/ab.ts").then(m=>console.log(JSON.stringify(m.runAbStudy("fixtures/ab/corpus"),null,1)))'
pnpm run test:poc   # 173 = 138（P0–P3 原样） + 35（P4 新增）
```
