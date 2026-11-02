# 效应声明台账（CLAIMS）— 每条主张必须挂接它自己的实验设计

> **为什么有这个文件**：本项目两次把"观察到的散布"当成"效应"（E4a 的乐观估计、AB3 的"压低取阅方差"），
> 都是**语义上通顺、形式上无据**。本台账 + `check-claims.mjs` 是防它复发的形式化门。
> **规矩：任何写进 VERDICT 或汇报的效应/设计主张，必须先在此登记并通过校验；未登记的主张不得出口。**

```claim
id: C-01
statement: 全可见条件下 A/B 两臂检出率饱和（无对比），审计性指标可分
design: 同案例双臂配伍（自由记录 vs 写时登记），唯一差异=四条写时登记行；全库可见，n=4 案例/臂
cells: A:4|B:4
metric: 检出率（二值/案例）+ 审计性 4 项打分
stat: 不适用（描述性饱和，不作效应声明）
prereg: experiments/v3-necessity-probe/VERDICT.md#①
status: MEASURED
evidence: experiments/v3-necessity-probe/VERDICT.md
```

```claim
id: C-02
statement: 写时登记提升可审计性（工件指纹 13.6×、显式缺口 6.5×、复现钩子 4.8×），引用量无差
design: 同案例双臂对照，全库可见
cells: A:4|B:4
metric: 审计性三项 + 引用条数
stat: 比值描述，未检验（n=4/臂）
prereg: experiments/v3-necessity-probe/VERDICT.md#②
status: JUDGED
evidence: experiments/v3-necessity-probe/VERDICT.md
```

```claim
id: C-03
statement: 一行主题行使预算受限取阅在极端埋点库上从 1/3 翻到 2/2 正确
design: 单案例索引开/关，预算受限
cells: 差索引:3|主题行:2
metric: 结论对错（二值）
stat: 缺失（n=1/格，Fisher 不可算）
prereg: experiments/v3-necessity-probe/e7/PREREG.md
status: HYPOTHESIS
downgrade_reason: E8 装置自检发现索引 t 字段可 100% 分流靶案（该轮作废）；E9 修后两臂同判；AB4 修后库 A 臂自行取满线索
notes: 降级为待验假设，不得作为设计正当性论据
```

```claim
id: C-04
statement: 索引/登记把关键记录取阅命中从抽签（0–5 全谱）压到恒定满命中，即压低取阅方差、消除尾部失败
design: 事后汇总三次不同用途的运行（AB2 1 次 + AB3 2 次 + AB4 1 次），库版本两个、干预两种混池
cells: A:4|B:3
metric: 关键记录命中数（0–5）+ 满命中率
stat: Fisher 单侧 p=0.143（含 1 个超预算脏样本）；剔除后 p=0.400
prereg: MISSING（该结论没有对应设计，是我事后并池算出来的）
status: HYPOTHESIS
downgrade_reason: 格内 n=1、跨层并池、含协议脏样本、A 臂已出现满命中使"压方差"与"本可撞满"观测不可分
notes: 证实需同库同预算同模型的 A×4 / B×4 配伍重复（AB5 之后排）
```

```claim
id: C-05
statement: 半提示（只点"定义可能变过"而不给换算路径）会让审查者在未取到数据时自信给出符号相反的定量数
design: 单次观察（AB2 r2），机制由修后库 AB4 反证为"非主因"
cells: 观察:1
metric: 定量结论符号与是否引用未取阅依据
stat: 不适用（单例机制观察）
prereg: experiments/v3-necessity-probe/ab2/PREREG-AB2.md
status: JUDGED
notes: 保留为案例编写教训，不作为设计效应
```

```claim
id: C-06
statement: 数值跨记录搬运时若缺适用域，富索引可能提高串用率（观测到 1 例：好索引臂借入他案已失效数值）
design: 48 条混库，索引开/关，预算 12/48
cells: 差索引:1|主题行:1
metric: 跨案数值借用率 + 证据归属率
stat: 缺失（n=1/格）
prereg: experiments/v3-necessity-probe/e9/PREREG.md
status: HYPOTHESIS
downgrade_reason: 串用事件仅观测 1 次（n=1/格）；且同轮索引存在日期泄漏，缺适用域与串用的因果链未经重复验证，不得升级为设计要求
```

```claim
id: C-07
statement: 开放式交付（不给审查问题，只给数据与交付要求）下四案 4/4 自行破题、零复述；审查式提问不是破题主因
design: 同修后库同预算，四格各 1 席（q1–q4），与 AB2 审查式提问条件对照；两条件的暗示方向互相混淆，不可归因
cells: q1:1|q2:1|q3:1|q4:1
metric: 三态分类（复述/破题/悬置）+ 关键记录命中数 + 定量结论与钥匙偏差
stat: 不适用（描述性计数，每格 n=1，无对照格设计）
prereg: experiments/v3-necessity-probe/ab5/PREREG-AB5.md
status: JUDGED
downgrade_reason: 每格 n=1、且与 AB2 的对照存在双向暗示混淆（AB2 提问自带怀疑暗示，AB5 交付要求自带"可以说不显著"），不得升级为效应主张
notes: 同时是一条**负结果登记**——预注册 G3 期待观测的"复述库内错误结论进交付物"未出现，不得反过来主张"不会发生"
evidence: experiments/v3-necessity-probe/ab5/RESULT-AB5.md
```

```claim
id: C-08
statement: 确定性门可捕获语义复核漏掉的案例缺陷（各观测 1 例：正文引用日期晚于记录时间戳；自造量无定义致修正量不唯一）
design: 同一缺陷由独立复核席逐条复算物理时漏过，由开放式席位发现；随后写成确定性门，修前 FAIL／修后 PASS 双向复验
cells: 观察:2
metric: 缺陷是否被新门捕获（二值/缺陷）
stat: 不适用（存在性观察，非效应量）
prereg: experiments/v3-necessity-probe/ab5/RESULT-AB5.md
status: JUDGED
notes: 主张强度限于"这类缺陷可被形式化捕获，且成本低于人审"，不外推为"形式化门覆盖度高于人审"
evidence: experiments/v3-necessity-probe/e4b/validate-cases.mjs
```

```claim
id: C-09
statement: 要求交付物自带适用边界（写明可支撑/不可支撑）可能是破题的真实来源，比审查式提问更本质
design: 未设计；由 AB5 四席一致行为产生，与提问方式完全混淆
cells: 观察:4
metric: 是否主动列出不可支撑清单
stat: 不适用
prereg: MISSING
status: HYPOTHESIS
downgrade_reason: 无对照；须做「交付规范开/关 × 提问方式开/关」2×2、每格 n≥2 才能归因
notes: 若成立，这是**成本最低的 v3 相关机制**（一句交付模板），优先级可能高于索引层
```

```claim
id: C-10
statement: 真实 AI 设计轨迹（jKDesign eoopt run 族）中存在 HSR 甲档写时机验可拦的失效，观测到 6 类各至少 1 例（口径冲突、比较端点设置不一致、退化最优未登记、主张缺适用域、取斑口径、证据强度不足被写成"已验证"）
design: 非受控观察；对既有运行产物按文件:行号逐条核读，无对照组、无操纵；消融 run 的 α 优先级与初始几何属 operator 注入处理，已单列不计为自然失效
cells: 观察:6
metric: 每类失效是否有可核对出处（文件:行号）
stat: 不适用（存在性观察，非效应量）
prereg: experiments/v3-necessity-probe/REALTRACE-1.md
status: JUDGED
notes: 只主张"这类失效真实发生过且有出处"，不外推频率；不得用作"HSR 能降低失效率"的依据
evidence: experiments/v3-necessity-probe/REALTRACE-1.md
```

```claim
id: C-11
statement: 真实轨迹里代价最高的一类失效是"工作区无参照物时把自建工作点的局部结果宣布成物理极限"，我此前四个案例全部未覆盖该形态（案例库缺 T6 参照缺失型）
design: 非受控观察；«人工基线值·已脱敏» 在场外（testbed 基线文档），agent 工作区按纯净化纪律未含该数
cells: 观察:1
metric: 席位是否主动要求对照 / 是否把缺参照写成显式缺口
stat: 不适用
prereg: experiments/v3-necessity-probe/REALTRACE-1.md
status: HYPOTHESIS
downgrade_reason: 单例观察，且"地板比基线差 2 倍以上"取决于 «人工基线值·已脱敏» 的口径（σ_r 还是 rms(r)），该口径尚未向人确认
notes: 若口径确认反向，本条的严重性判断需改写；形态本身（无参照即宣布极限）不依赖口径
evidence: experiments/v3-necessity-probe/REALTRACE-1.md
```

```claim
id: C-12
statement: HSR 记录面（五类对象 + 四本登记）是否相对最小替代设计（索引层 + 三条写时声明）过剩，本轮不可判定；其"作为形式化验证系统必要底座"的必要性未经任何实验检验
design: 分两问。问一（过剩与否）已跑：最小臂 vs 全量臂三臂确定性对照，见 C-13；问二（作为形式化验证底座的必要性）尚未设计实验
cells: 未设计
metric: 最小臂能否支撑全部已声明谓词运行（不能 → 过剩判断不成立；能且成本更低 → 部分过剩）
stat: 不适用
prereg: MISSING
status: HYPOTHESIS
downgrade_reason: 无对照实验；且现有唯一相关实验 E4b′ 在"帮人抓对"这一轴上测到的是**差值为 0**（天花板），正向证据只有可审计性 13.6×/6.5×/4.8× 与成本不对称（读时每件 28 条分诊 vs 写时 1–3 行）
notes: 待裁决的原始命题是用户那句「HSR 并没有**显著**过剩」——"显著"是幅度词，本条刻意不用它做 statement，因为没有任何测量支持幅度判断（这条正是被自家门拦下后改写的：`✗ C-12: 用了「显著/效应量/证明」却非 MEASURED`）。2026-11-02：问一（过剩指控）已由 C-13 按本条 metric 的预注册规则裁决为**不成立**；问二（形式化验证底座的必要性）**尚未有任何数据**，故本条整体仍留 HYPOTHESIS，不得引用 C-13 为问二背书。过剩与否必须先指定目标轴才可判定；真实轨迹的丙档失效（采样充分性、求解器韧性、物理不变量）不属记录面，不得用本条为那部分投入辩护
evidence: experiments/v3-necessity-probe/REALTRACE-1.md
```

```claim
id: C-13
statement: 在 13 条真实轨迹条目上，最小臂做满（A+）裁决正确 11/13，全量记录面（B）13/13；A+ 漏的 2 条（测量级对象槽位缺失、跨 run 反例不可见）恰好都是"判断不可达宣称对不对"所必需的能力，故"HSR 相对最小臂冗余"这一指控按 C-12 预注册判据不成立
design: 三臂确定性对照（A 真实产物 / A+ 最小臂按规约做满 / B 全量记录面），同一 13 条条目、同一 7 个谓词，谓词只从 value 计算；裁决规则预先写在 C-12 的 metric 字段
cells: A:13|A+:13|B:13
metric: 谓词可运行率 + 裁决正确数/13 + 每案写行成本
stat: 不适用（确定性重放，无抽样、无 p 值；13 条条目为单条轨迹全量非随机样本）
prereg: experiments/v3-necessity-probe/CLAIMS.md
status: JUDGED
downgrade_reason: 不得升为 MEASURED——B 臂登记内容由作者按规约代填（测可表达性，不测人是否真会填对）；条目由作者从单条轨迹挑取，选择偏差未控；谓词亦由作者实现。**成本列已更正**：本条原写「B 2.0 行/案」是**新增事实行数**，按 `armtest/cost/WRITE-COST.md` 实写实测为 **≈24–37 行/对象、≈240 行/run（≈现状 5×）**，A+ 为 7 行/案。**二次更正**：上述 B 成本把 L0+L1+L2 全算在提交者头上，与 §3.6 归属不符；按归属重称后主执行体 L0 全部义务实测 6 行/364B/141 汉字，**比 A 现状散文（9 行/84 汉字）更轻**，故"B 每对象 5×"与"先做最小臂明显占优"两条成本结论作废，仅保留为"若全部由提交者手写"的上限（见 armtest/cost/OWNERSHIP.md）。裁决不翻转（预注册指标问的是槽位可得性）
notes: 同向但难受的另一半：11/13 的保护价值来自最便宜的最小臂，HSR 不可替代增量集中在 2/13。附一条独立证据：文本层谓词把 L9T4「未宣布目标不可达」误报为不可达宣称（否定盲区），类型化主张按 kind 天然放行——支持"受管对象是出口的判断、不是行动的选择"
evidence: experiments/v3-necessity-probe/armtest/RESULT-ARM1.md
```
