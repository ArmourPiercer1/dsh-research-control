# 观测规格 — GPT 条纹相机数值仿真样本（`gpt-streak`）

> 状态：**P0 合成样本。两份 deck 均未执行**（PoC 主机无 GPT 许可，且本轮明令不运行外部程序）。
> 本文所有数值是**线性束光学的解析预估**（漂移+硬边四极传输矩阵 + 装载分布的二阶矩），
> 用途只是让"真实运行出来的数应当落在什么量级"可被检查；**不是仿真结果，不得被引用为结果**。
> 上游契约：[`../../SPEC.md`](../../SPEC.md)（信封与三通道规则）、
> `docs/poc/V3_POC_EXECUTION_PLAN.md` §3（本样本 = numerical-streak-camera）与 §4-P0。
> deck 语法与单位遵循 `gpt` 技能（`.in` deck / `.gdf` / `gdfa` 约定）。

## 0. 一句话束线

光电枪二极管间隙（1 cm，25 MV/m）→ 漂移 0.315 m → **单个四极格**（L=5 cm，Go=0.30 T/m，硬边）
→ 漂移 0.225 m → **屏**诊断面（z = 0.60 m）。nps = 100（上限 200），Qtot = 0（无空间电荷）。
修订版 `streak_quad_error.in` 只改 `Go` 0.30 → 0.33（+10%），其余逐字符不变。

## 1. 预期 `.gdf` 与变量清单

### 1.1 由 deck 直接写入的标量（`outputvalue`，随 run 落进 .gdf）

这些量是**模型身份的自证**：任何分析都能把数字与产生它的模型版本对上，不必回头猜 deck。

| 名 | 单位 | nominal 期望 | 说明 |
|---|---|---|---|
| `rev` | – | 1（修订版 2） | 模型修订标签，与 deck 头注释一致 |
| `nps` | – | 100 | 宏粒子数 |
| `Go` | T/m | 0.30（修订版 0.33） | 实际使用的四极梯度 |
| `Lq` / `zq` | m | 0.05 / 0.35 | 四极有效长度 / **中心**位置 |
| `Ld1` | m | 0.315 | 枪出口 → 四极**入射面** |
| `Ld2` | m | 0.225 | 四极**出射面** → 屏（不是从中心量！见 §4-D2） |
| `zscr` | m | 0.60 | 屏面位置 |
| `Ekin_eV` | eV | 2.53e5 | 枪后动能（解析值） |
| `g0` | – | 1.4951 | 诊断面洛伦兹因子 → 发射度归一化因子 |
| `gcat` | – | 1.00587 | 阴极处洛伦兹因子 |
| `Bsqr` | T·m | 1.894e-3 | Bρ = βγ·me·c/\|q\| |

### 1.2 粒子相空间列（GPT 固定输出）

- `snapshot(0, 3.6e-9, 0.1e-9)` → `time` 组：`ID, x, y, z, rxy, Bx, By, Bz, G, m, q, nmacro, rmacro`（37 组，~0.4 MB）
- `screen("wcs","I", 0.60)` → `position` 组：同上 **+ `t`**（穿越屏的时刻，s）
- 本 deck 无 `tout` → **没有** `fEx..fEz / fBx..fBz`；需要场就必须改 deck，不能事后补。

### 1.3 派生诊断量（`gdfa` prog，不是 deck 变量）

```
gdfa -o nom_time.gdf streak_nominal.gdf time     numpar avgz stdx stdy avgG nemixrms nemiyrms
gdfa -o nom_pos.gdf  streak_nominal.gdf position stdx   stdy  avgG nemixrms nemiyrms avgt stdt
gdf2a  -o nom_pos.txt nom_pos.gdf
```

| 量 | 含义 / 单位 | 屏上解析预估 | nominal vs 修订版 |
|---|---|---|---|
| `nemixrms`, `nemiyrms` | **归一化** rms 发射度 [m·rad]（gdfa 由 GBx=G·Bx 构成，天然归一化） | ≈1.22e-6（=1.22 π mm mrad），x、y 同量级 | 两版**相同**（线性元件不产生发射度增长） |
| `stdx` | 屏上 x rms 束斑 [m] | ≈6.5e-4 | 0.646 mm → 0.787 mm（**+21.8%**） |
| `stdy` | 屏上 y rms 束斑 [m] | ≈3.0e-3 | 3.02 mm → 3.22 mm（**+6.7%**） |
| `avgG` | 平均洛伦兹因子 → 平均动能 Ekin=(avgG−1)·me·c²/\|qe\| [eV] | 1.4951 → 2.53e5 eV | 不变 |
| `avgt`, `stdt` | 平均到达时刻 / rms 到达展宽 [s]（**只有屏输出才有 `t`**） | ≈3.0e-9 / ≈4e-13 | 不变 |
| `numpar` | 存活宏粒子数 | =nps（无光阑） | =nps |
| `CSbetax`, `CSalphax` | Twiss（可选） | 屏不在腰上，`CSalphax`≠0 | 变化 |

**归一化 ⇄ 几何换算（g0 因子）**：几何发射度 = `nemixrms` / √(g0²−1) = `nemixrms`/(βγ)。
屏面 g0=1.4951 → βγ=1.11146；阴极 g0=1.00587 → βγ=0.10852（同一束，几何值差 10 倍）。
**报几何发射度必须同时报 g0 所在平面**，否则数字不可比 —— 这正是本样本要抓的经典记录缺陷。

## 2. 怎么读（只用 `gpt` 技能列出的工具）

| 目的 | 命令 / 入口 |
|---|---|
| 组标量序列（默认路径） | `gdfa -o out.gdf in.gdf <group_by> <prog>...`；`group_by` **必须**与 deck 触发器一致：`snapshot`→`time`，`screen`→`position` |
| 转 ASCII 给 numpy/pandas | `gdf2a -w 16 -o out.txt out.gdf` |
| 逐粒子轨迹 | `gdftrans -o traj.gdf in.gdf time x z`（按 `ID` 排序） |
| Python 直读 | `easygdf.load` / `easygdf.load_screens_touts`；技能 `gpt-analyze/scripts/` 的 `gpt_read.py`/`gpt_stats.py`/`gpt_plot.py`（与 gdfa 做过 golden 对齐） |
| 运行本身 | `gpt -o <out>.gdf <deck>.in [var=value]`；`GPTLICENSE` 必须已在环境中（**值不得被记录或回显**） |

`nmacro` 陷阱：本 deck `Qtot=0` ⇒ `nmacro=0`，gdfa 退化为等权平均。这不影响 rms 量的定义，
但**任何"束流电荷/电流"读数在此样本里都不存在**——不要从 `Q` prog 读出 0 再解释成"实测无电荷"。

## 3. 校准 / 收敛判断点（**双检，缺一不可**）

数值诊断在被当作科研证据前，必须先过这两道；本样本因为 `Qtot=0` + 全线性元件，判据特别干净。

| 检 | 操作 | 通过判据 |
|---|---|---|
| **C1 步长/精度收敛** | `gpt ... accg=7 accx=8` 重跑；同法比 `stdx/stdy/nemixrms/avgG` | 四个量相对变化 **< 0.1%**（`nemixrms` 绝对变化 **< 0.5%**） |
| **C2 粒子数收敛** | `gpt ... nps=200` 重跑（本样本 nps 上限 200，故 100→200 即上限；再要收敛证据必须走 sanitized-snapshot 阶段并破例申报） | `stdx/stdy` 相对变化 **< 2%**；`nemixrms` 相对变化 **< 5%**（100 粒子的抽样噪声量级 ~1/√(2N)≈7%，Hammersley 低差异序列会低于此——**以实测差值为噪声尺度，不用解析假设代替**） |
| **C3 守恒量自检** | 同一 .gdf 内比 `nemixrms(t=0)` 与屏上 `nemixrms`；比 `avgG` 与 `Ekin_eV`；比 `numpar` 与 `nps` | 发射度比 ∈ 0.97–1.03；动能差 <0.5%；`numpar` 恒等（**免费校准**：线性无空间电荷系统中任何增长都是错误信号） |

顺序纪律：**C1+C2+C3 未通过前，任何数值只能作为 `observation.recorded` 存在，不得升级为 `claim.candidate` 的支撑**（信封层的 `based_on` 就应指向已过收敛检查的 `analysis.performed`）。

## 4. 「什么算异常」最小判据

阈值是 P0 的最小集，不是标定过的工程判据；违反 = 触发排查动作，**不自动等于物理结论**。

| 判据 | 阈值 | 触发后的第一怀疑与动作 |
|---|---|---|
| **A1 发射度增长** | 屏上 `nemixrms` / 注入 `nemixrms` **> 1.30（+30%）** | 怀疑**四极梯度/元件设置错配**或 fringe 模型；先查 C1/C2 是否为数值假象，再 diff 两版 deck 的 `Go/Lq/zq/Ld*`（deck 已把这些写进 .gdf） |
| **A1b** | 增长 3–30% | 不上升为物理异常：按数值/采样排查（C1、C2），并在 `unknowns` 记"未闭合" |
| **A2 能量一致性** | 由 `avgG` 换算的动能 vs `Ekin_eV` 差 **> 0.5%** | 枪场/间隙被改过，或 **.gdf 与 deck 版本错配**（数据版本修订没跟上）——本样本"场模型/数据版本修订"语义的落点 |
| **A3 像散符号** | `Go>0` 硬边四极却出现 **`stdy` < `stdx`** | 极性/滚动角记录错误，或读错了列；不可能是物理 |
| **A4 粒子丢失** | 屏上 `numpar` < `nps` | deck 无光阑 ⇒ 元件位置/`tmax`/屏面方向异常；先查 `tmax`（2.96 ns 飞行时间 vs 3.6 ns 硬停） |
| **A5 收敛双检不通过** | C1 或 C2 超差 | 该组数值**不得**作为任何 claim 的 `based_on`；只能记 `note.unknown` |

### D2 判别规则（本样本的核心区分）

「四极梯度偏高 +10%」与「屏前漂移长度被记成 0.20 m（沿用旧布局的硬编码）」在
(Δ`stdx`%, Δ`stdy`%) 平面上**几乎简并**：解析预估给出 +21.8%/+6.7%（比值 3.26）对
+28.1%/+7.6%（比值 3.70）——差 ~12%，落在两版共用的解析近似误差之内。
**只用屏上束斑比例分不开两者。** 可区分的观测量目前 deck 里没打开：

- 打开 `screen("wcs","I", 0.45, 0.75, 0.01)`（deck 已注释保留），`gdfa ... position stdx stdy`
  → **x 腰的纵向位置**：梯度变了腰会移动，漂移记错则腰不动只是采样点错位。
- 或读 `Ld2` 标量本身：`.gdf` 里 `Ld2=0.225` 与脚本里用的 0.20 不一致 → 立刻判为分析侧簿记错误。
- 或台架四极标定记录（**本样本无此记录**，属真实未知项）。

## 5. 三通道纪律在这个案例上的具体化

| 通道 | 允许的内容（本样本） | 例 |
|---|---|---|
| **SOURCE_RECORD**（仿真直读 = SOURCE_RECORD 候选） | 运行/退出状态；`.gdf` 路径与内容哈希；`gdfa`/`gdf2a` 的完整 argv；从 .gdf 读出的 `stdx/stdy/nemixrms/avgG/avgt/stdt/numpar` 原始数值与所用 `group_by`；deck 里的标量（`Go`、`Ld2`、`rev`…）；分析脚本被调用时**实际传入的参数值**（含错的 0.20 m） | "对 `streak_nominal.gdf` 以 `group_by=position` 求 `stdx`，得 6.46e-4 m；对比脚本当时以 `Ld2=0.20` 调用"——**这是登记"当时这么算了"，不评价对错** |
| **RESEARCHER_INFERENCE** | 任何因果/归因/外推：残余归因于梯度或漂移；「实际梯度比标称高 10%」；「束线可用于条纹计数」；几何发射度的选取平面声明；解析模型与仿真的可比性 | 必须带 `based_on: [event_seq…]` 指向其所依据的源记录行 |
| **LLM_SUGGESTION** | 替代解释、判别实验建议、下一步扫描方案（如"打开屏扫描定 x 腰""补台架标定"） | 同样必须 `based_on`；**不得**被写成已成立的结论 |

规则落地要点（SPEC 硬规则 1）：`SOURCE_RECORD` 的 payload 里**不出现**推测/建议字段；
"分析用错了漂移长度"这类事实要写成 *调用了什么、传了什么值、得到什么数*，
而 *因此怀疑梯度偏高* 必须另起一行放推理通道。样本事件文件按此写成 12 行、按 run 切成 `envelopes.strk-0{1..4}.jsonl`（见 README §2.1）。

## 6. 本样本明确**没有**的东西（禁止脑补）

- 没有真实 `.gdf`：本轮不运行 GPT；`envelopes.strk-0*.jsonl` 里的哈希与数值都是合成占位，且已在各行 `unknowns` 声明。
- 没有 RF 条纹偏转单元（`TM110gauss`/`TE110gauss` 一类）：deck 里的四极只提供**与时间无关**的线性横向踢量。
  因此 `avgt/stdt` 只是几何到达量，**本样本不具备真实的时间分辨条纹能力** —— 把"屏上 x 分布"读成"时间剖面"是越界推理。
- 没有空间电荷（`Qtot=0`）、没有四极 fringe（未给 `b1`）、没有屏的二次电子/MTF 响应模型、没有束流电荷量。
- 没有台架四极梯度标定记录，也没有第二台立即可用的诊断面。
- `gpt` 版本号、许可证状态、CPU/墙钟时间、stderr 文本在合成事件里均未记录（已列 `unknowns`）。

## 5. 真实运行记录（2026-10-26，Windows GPT Oct 14 2024，经 WSL interop）

首跑体检（B 清单三项全过）：numpar 恒 100 零丢失；avgG≈1.493 与 deck 端
Ekin=250 keV 自洽（此前 1.4951 是线性预估把能量记作 253 keV 之误——**deck
正源 250 keV 为准**）；avgz 单调至 0.7961 m（drift 中心定位约定正确）。

屏面（z=0.6 m）实测 vs 本文档线性预估：

| 量 | 名义（实测） | quad+10%（实测） | 实测变化 | 线性预估签名 |
|---|---|---|---|---|
| stdx | 5.225 mm | 5.610 mm | **+7.4%** | +21.8% |
| stdy | 1.848 mm | 2.126 mm | **+15.0%** | +6.7% |
| nemi x | 1.511 µm | 1.508 µm | ×0.998 | A1 判据 >1.30 |

**诚实结论（信封 strk-06#4 同步登记）**：线性机制读数的签名预测被真实运行
**证伪**（x/y 响应排序相反、A1 不触发）；§2 预估表**保留不改写**（历史预估
即历史事件），实测以 strk-05/06 信封与 .gdf sha256 为准。不一致成因未归因。
数据面：.gdf 在 `.scratch/gptrun/`（gitignored 可弃），恢复方式=按信封
run.started 的 argv 重跑并校验 sha256。
