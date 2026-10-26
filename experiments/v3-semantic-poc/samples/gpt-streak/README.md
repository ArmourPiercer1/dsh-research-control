# `gpt-streak` — GPT 条纹相机数值仿真样本（P0 合成）

PoC 样本 **numerical-streak-camera**（`docs/poc/V3_POC_EXECUTION_PLAN.md` §3）在 V3 语义侧车里的
落地形状：一个 GPT (General Particle Tracer) 束线案例，覆盖 **场模型/数据版本修订、数值诊断、
后处理结果、异常校准/收敛判断** 四类语义。信封与三通道规则见 [`../../SPEC.md`](../../SPEC.md)。

> **本样本是 P0 合成样本**（上述限制在 P0 期内有效）。**更新 2026-10-26：deck 已经
> WSL interop 真实执行**（strk-05/06，见文末）；**更新 2026-10-27：判别实验入库**
> （strk-07a..k + strk-08）。合成行（strk-01..04）仍为合成占位、保留不动；
> 真实数值一律以 strk-05 起的信封与其 sha256 登记为准。

## 1. 在 PoC 里的角色与升级路径

| 阶段 | 本目录内容 | 访问边界 |
|---|---|---|
| **现在（P0）** | deck 文本 + 观测规格 + 合成事件序列：把"来源记录 / 研究者推测 / LLM 建议"三通道的分离规则**钉在一个具体科学案例上**，并提供可失败的 fixture | `synthetic` |
| **interop 通路开通后** | 按 `gpt` 技能实际执行 `gpt -o … streak_nominal.in`（nps≤200，秒级）→ 真实 `.gdf` → `gdfa`/`gdf2a` 读数 → 重算各 `envelopes.strk-0*.jsonl` 行的数值与**真实** `content_sha256` | 升级为 `sanitized-snapshot`（只留派生标量与脚本 argv，原始 `.gdf` 与运行日志**不入库**） |
| **有真实计算任务时** | 换成真实条纹相机束线 deck 与真实台架标定，走 live passive 观察 | `live-mirror`（需另行授权，不在本样本的职权内） |

升级动作清单（interop 开通时按序做，任何一步失败即记 `run.failed`，不得回改合成行）：
① deck 首跑（技能建议的 smoke 规模，nps=100）→ ② 语法/物理异常按 [`observation-spec.md`](observation-spec.md) §4 判据过一遍 →
③ 观测规格 §3 的 C1（`accg=7 accx=8`）与 C2（`nps=200`）收敛双检 → ④ 用真实哈希与真实读数
新建 `envelopes-real.strk-*.jsonl`（每 run 一文件，`access_boundary: "sanitized-snapshot"`），**合成文件保留不动**，
两套事件不混run_id、不混通道。

## 2. 文件清单

| 文件 | 内容 | 通道归属 |
|---|---|---|
| [`streak_nominal.in`](streak_nominal.in) | 束线 deck 模型版本 **v1（nominal）**：枪→漂移→单四极格→漂移→屏；头注释含运行/分析命令、预期 `.gdf` 量名与 g0 换算说明 | 源（文件本身） |
| [`streak_quad_error.in`](streak_quad_error.in) | **v2 版本修订 deck**：`Go` 0.30 → 0.33 T/m（+10%），头注释给出 diff 摘要与理由；**去掉注释后的代码行**与 v1 逐字符比对只差声明的那两处（`Go` 与 `rev`），已用去注释 diff 核验 | 源（文件本身） |
| [`observation-spec.md`](observation-spec.md) | 预期 `.gdf` 变量清单、`gdfa`/`gdf2a`/`easygdf` 读法、校准与收敛双检（C1/C2/C3）、异常最小判据（A1–A5）、束斑比例简并与判别观测（D2）、三通道分工表 | 规格（含解析预估，已标注非结果） |
| `envelopes.strk-0{1..4}.jsonl` | **合成事件序列**（12 行总计，`access_boundary: synthetic`），按 SPEC v0.1 规则 0「一个文件一个 run」切分：<br>`strk-01`＝失败尝试（1 行）；`strk-02`＝登记 deck → 运行 → 同一 `.gdf` 两次分析（seq 4 漂移长度用 0.20 m、seq 5 修正为 0.225 m）（6 行）；`strk-03`＝修订 deck 单变量重跑 → 屏面观测（3 行）；`strk-04`＝受质疑的 claim（0）与质疑/后续检查（1）（2 行，跨文件 `payload.based_on` 用 `{run_id, seq}`） | 前三文件全 `SOURCE_RECORD`；`strk-04` 为 `RESEARCHER_INFERENCE` + `LLM_SUGGESTION` |

事件序列覆盖 PoC 对样本的最小要求：一次成功输出的 Run（RUN-STRK-02/03）、一次无有效科研结果的
失败 Run（RUN-STRK-01）、同一数据两次 Analysis 得到不同结论（`strk-02` seq 4 vs 5）、一条后来受质疑的
推理（`strk-04` seq 0 被 seq 1 质疑）、多个真实未知项（各行 `unknowns`，共 39 条）。SPEC 硬规则 5 的
`FACT_RECORDED → claim.candidate + SOURCE_RECORD` 形状在本样本**没有实例**（本案例历史里没有
V1 登记的 Fact 标签，不编造）。

### 2.1 事件文件形状的两次返工（契约在执行中变了，如实记账）

1. 初版交付为**单个** `envelopes.jsonl`（12 行、全局连续 `event_seq` 0–11），当时 `SPEC.md` 只有
   "每 run 内严格 +1"的措辞、`src/envelope.ts` 尚不存在，故按 SPEC 文本自查通过。
2. 期间 integrator 给 SPEC 加了 **v0.1 规则 0「一个文件一个 run，`event_seq` 文件内从 0 连续」**，
   并把依据字段位置裁定为 **`payload.based_on`**（元素＝同文件整数 seq，或跨文件 `{run_id, seq}`）。
   合并文件随即被真实校验器按 `mixed_run_id` 拒绝（11 处）→ **已删除**，本目录改用按 run 切分的四文件。
3. 用真实校验器复核本目录（只读，不写 `.poc-data`）：以同目录四文件的 `run_id → seq 集` 作
   `knownRuns` 解析表调 `parseEnvelopeFile()`，**四个文件 problems 全为 0**。
4. 顺手清掉我自己留在 `strk-04` 两行上的**顶层** `based_on`（旧形状，与 `payload.based_on` 并存会误导；
   校验器把未知顶层键当透传不报错，故不会自己暴露）。未改动 integrator 写的其他内容。

**遗留给 integrator 的一处引用错映射**（不是我校订的范围，避免与在飞写入打架）：
`strk-04` seq 1（质疑行）的 `payload.based_on` 现为 `{RUN-STRK-03,1}` + `{RUN-STRK-03,2}`，
即 `run.finished` 与 `observation.recorded`；但该行的文字依据是**两次分析**，应为
`{RUN-STRK-02,4}`（漂移长度用错的 v1）、`{RUN-STRK-02,5}`（修正后的 v2）、`{RUN-STRK-03,2}`（观测）。
现写法在形状上合法（不悬空），但**指向了正文没引用的事件**——正是本 PoC 想抓的"引用与支撑不符"缺陷，
留在样本里等主责裁定，不静默改。

## 3. 最小数据声明

- `nps` 默认 **100**，硬上限 **200**（deck 头注释与本目录所有文档一致声明）；单次运行约 40 s 量级，
  产物 `.gdf` 约 0.4 MB（snapshot 37 组 × 100 粒子 + 1 个屏面）。**不产生大文件**。
- 本目录**不含任何 `.gdf`、日志或二进制产物**；interop 开通后真跑产物落 `sims/<run>/`（工作目录内，
  不入本仓、不进发布包），入库的只有派生标量与命令 argv。
- 无网络访问、无外部程序调用（本轮只写文本）；`GPTLICENSE` 取值在任何记录里都不出现。

## 4. 与 `gpt` 技能文本的一致性说明

deck 语法、单位（SI，能量 eV、角度 rad）、`gdfa` prog 名与 `group_by` 匹配规则一律按 `gpt` 技能
（`gpt-input` / `reference/*.md`）书写。发现技能文本与手册示例的一处措辞差异并**从技能文本**：
枪后能量换算写成 `g0 = 1 + abs(qe)*Ekin/(me*c^2)`，取自技能 `templates/solenoid.in`、`accel.in` 的
`abs(qe)` 写法；`UserManual` 的 Listing 1-1 示例则用竖线写法 `|qe|`（手册 §4.1 函数表把两种并列，
故此处不构成实质冲突，仅记录取舍）。其余（`setparticles` 五参、`erect(ECS,a,b,L,E)`、
`quadrupole(ECS,L,Go[,b1])`、`snapshot(from,to,step)`、`screen(ECS,pos)`、`tmax=…;`、`accuracy(GBacc,xacc)`）
均与技能和手册同时一致。

## 5. 诚实自评：真实 `gpt` 首跑最可能拒绝/咬人的三处

（interop 开通后按此顺序修，第一条不通就不要再往下跑。）

1. **`Bsqr = g0*sqrt(1-1/g0^2)*me*c/abs(qe) ;` 的幂写法。** 手册示例只见 `G^-2` 这种紧邻形式，
   `1/g0^2` 里 `^` 与 `/` 的优先级由 YACC 文法决定；最可能被拒或静默算错。
   首跑若报语法/数值异常，改为 `sqrt(1-1/(g0*g0))`。（该量仅作记录，不参与轨迹推进。）
2. **`tmax = tmaxv ;` 用变量给关键字赋值 + `snapshot( 0, tmaxv, 0.1e-9 )` 用同一变量作上界。**
   手册给的是 `tmax=expression;`，但未证实可在其中安全代入用户变量；且 `tmax` 与 `snapshot` 上界
   重名相近易被文法误绑。退化写法：两处都写常量 `3.6e-9`，并删掉 `tmaxv` 这一层。
3. **`drift( "wcs","z", <中心>, <长度> )` 与 `erect(..., -Egun )` 的定位/符号约定。**
   这两处**不会**被解析器拒绝，但最可能在首跑咬人：若 `drift` 的 ECS 位置被解释为起点而非中心，
   束线整体错位；若枪场符号反了，电子被反推 → 屏上 `numpar=0`、`stdx/stdy` 缺失。
   首跑必须先看 `gdfa … time numpar avgz` 的单调增长与 `avgG` 是否升到 1.4951，再信任何束斑数。

其余已自查但风险较低：`outputvalue` 名字全部 ≤8 字符且为字母数字下划线（GDF 块名保守取短）；
用户变量名 `Go` 与手册里 `quadrupole(ECS,L,Go[,b1])` 的**参数名**同名，按 §4.1 它只是普通用户变量
而非内建常量，若首跑出现重定义类警告即改名 `Gquad`；`Qtot=0` 故 deck 内**不含** `spacecharge*` 元件
（符合"至多一个、有电荷才写"规则）；所有场元件首参
都是 ECS；`setGdist` 放在横向设置之后（与技能模板同序）；未使用 `randomize`（默认 Hammersley，
结果可复现，这也是 C1/C2 收敛双检成立的前提）。

入库补记（integrator）：seq 1 的 payload.based_on 已由 {03,1}+{03,2} 修正为
{02,4}+{02,5}+{03,2}（质疑行的文字依据是两次分析+一次观测；B 留给
主责裁定的引用-支撑不符项，见其 §2.1 末尾）。

## 更新（2026-10-26）：真实运行已入库（strk-05/06）
interop 启用后用宿主机 gpt.exe（Oct 14 2024）真跑两套 deck（nps=100）。
`envelopes.strk-05-live-nominal.jsonl` / `envelopes.strk-06-live-quaderr.jsonl`
为真实运行 SOURCE_RECORD + 一条推理对比；合成样本（strk-01..04）保留原样作
P0 历史。样本升级路径中 sanitized-snapshot→live 段就此打通（GPT 运行真实；
数据仍为合成研究场景，非实验数据）。

## 更新（2026-10-27）：判别实验（strk-07a..k）与分析（strk-08）

- **动因**：strk-06 的线性签名证伪挂「不归因」；按 real2sim-experimental-design 路线设计
  最小信息量实验分离竞争假说。设计正源 = [`discrimination-design.yaml`](discrimination-design.yaml)
  （targets/三实验/判别预测/DOE 纪律齐）；执行序 = 固定伪随机置换（种子 20261027，见 .scratch 日志）。
- **11 run**：T0 复现锚×2（与 strk-05/06 已登记值逐位复现，字节差仅 GDF 头日期戳）；
  T1 Go 六点响应曲线 {0.24..0.36}；T2 nps 粒度阶梯 {50/100/200}；T3 双屏对照 {0.45, 0.60}。
- **strk-08 分析三结论**（信封为准）：① **行语义修正**——position 组末行对 zscr 不变 ⇒
  strk-05/06 原「screen」登记值实为 tmax 弹道末态 rms（z≈0.80 m）；屏面过面值（首行）另行登记，
  原事件不改写（L0）；② **H1′ 成立**——薄透镜外推模型类在两个观测表示下一致证伪，
  六点曲线光滑且局部斜率复现两点差分（过面 +6.4%/+22.2%；末态 +7.4%/+15.0%），y 向响应
  在 0.45→0.60 间符号翻转（−16%→+22%，束腰穿越指纹）；③ **H3′ 排除**——nps 粒度对响应差
  贡献 <0.5 个百分点；**H2′（梯度约定错位）未判定**，需绝对矩阵拟合，已挂账 note.unknown。
- **文件**：`envelopes.strk-07{a..k}-*.jsonl`（4 事件/件）+ `envelopes.strk-08-disc-analysis.jsonl`（4 事件）；
  `.gdf` 解析后删除（sha256 已在 artifact.registered 登记，恢复=按 run.started 重跑）。
