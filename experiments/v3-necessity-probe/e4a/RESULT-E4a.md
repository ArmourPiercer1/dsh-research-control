# E4a · 真实科研修正事件的难度标定 — 结果

状态：**MEASURED**（仅登记测量；不做 GO/NO-GO，不建议 V3 设计修改）
席位：机械+抽取子代理（父会话 session-72f5cc29 委派 E4a）
标准：`experiments/v3-necessity-probe/PROTOCOL.md`「E4 · 难度谱系 T0–T5」为唯一分档标准
日期：2026-10（执行日）；样本时间跨度 2025-03（EGUN）至 2026-10-14（Beijing 包）

## 0. 核心数字

- **标定事件总数：9，覆盖 3 个独立项目**（rhodotron 理论 / AIEO_DEV / Beijing 场诊断包）。
- **T0–T5 分布**：T0=0，T1=1（11.1%），T2=4（44.4%），T3=1（11.1%），T4=3（33.3%），T5=0。
- **线索当时是否已在记录中（仅对 9 个标定事件）**：**是 9/9（100%），从未登记 0/9**；其中 2 条带限定（A1 原始层在/汇总层断言相反；A3 当时在/主要工件现不在库）。
- **另计「该记未记」（父会话指令：单独计入，不与「记了但没召回」混类）：2 条未登记变更轨迹**（EGUN 同名文件多版本无日志；rhodotron 3D deck 无输出无结论）。它们不构成闭合修正事件（无修正后信念的记录），单独列于 §3.2。
- **最强 T3–T5 实例**：E-A1（T3，LEDRO 种子继承——2×2×5 受控重复 + git 修订链完整）、E-R1（T4，rhodotron RF 角色前提整体更换）、E-B3（T4，三层勘误链）。

## 1. 标定表（9 事件 × 3 项目）

| 事件短名 | 课题路径 | 原信念（工件可证） | 修正后信念 | 支撑工件（具体文件/行/版本） | 档位 | 线索当时是否已在记录中 | 若是：哪几条记录、相隔多远 | 检测需要什么能力 |
|---|---|---|---|---|---|---|---|---|
| E-R1 RF角色/啁啾放大 | rhodotron（«盘C»/…/Downloads/rhodotron_nonlinear_v2/ + rhodotron_echo_theory_v1.zip；第三代表 «本地项目»/Rhodotron-new-design/） | v1（10-10）：有限腔 RF 响应 b=0.02144（corrected 0.12185 vs 理想 0.12249），RF 曲率按「需 1 GHz 谐波间隙校正的像差」处理，路线=分能区级联+谐波校正 | v2（10-11）：RF 最优相位下 J_KK≈0.999、J_Kτ≈0——主 RF 通常最抑制一阶啁啾，「没有显著自动放大弱能量调制」；2f≈Gκ²/4 混频弱（0.247 keV@50ps）；RF 为可调纵向镜片（±30°：911.5/1.19 vs 909.1/0.80）；路线改为 A/B 对局部谐波+多圈级联 | v1: results.json `finite_bunch_quadrature`、THEORY_zh.md §4/§6、model.py docstring（"integrated-voltage model"、"ASSUMED path law…not an exact dipole field map"）、README（"transit-time factors…not modeled"）；v2: THEORY_v2_zh.md §3/§4/§7、run.log L2/L4–12（transition 268.38606 keV、RF-optimal phase −0.77667 rad）、results_v2.json | T4 | 是 | v1 包内 3 个文件自记模型边界（model.py docstring、README、THEORY §1/§9），同目录、同日 2026-10-10 | 前提依赖+版本指纹（RF 模型版本/输入指纹随 run 登记） |
| E-R2 D与能区口径 | 同上 | v1：不同能区 0.5…7.5 MeV 八返回单元+8.5 MeV 二次调制（独立能区）；D=5.35778 ps/keV（η 参数化，TOF=1 RF 周期）；过零 0.422 MeV；K=8500 MeV 对比 voltage_ratio=1.813（"~45% 电压降幅"） | v2：「严格而言 A_j 与 B_j 参考能量相同，并不自动给出两种独立能区…真正的参考能量跳跃发生在 B_j 和 A_{j+1} 之间」；D 用 hard-edge 弧+漂移几何口径（ρ=0.12 m、θ=180°、drift 0.25/0.25 m）；transition=268.386 keV「不可当成现成可用的工作点」；1 MeV 过零需 α_b 0.377→0.100 m 或总漂移 2.92 m | v1: THEORY_zh.md §2/§6、results.json（D1=5.357776151945684、all_high_energy_comparison）；v2: THEORY_v2_zh.md §1/§2、run_study.py（弧/漂移参数）、run.log、results_v2.json | T2 | 是 | 两版各自文件自记构造法（v1 THEORY §2/§6+model.py；v2 THEORY §1/§2+run_study.py），跨版本、同项目、隔 1 天（10-10→10-11） | 量口径登记表（同一命名量的构造/定义登记） |
| E-R3 run 位置自述≠实际+清单不覆盖输出 | 同上（v2 包） | v2 包自述：输出保存于 /mnt/data/rhodotron_nonlinear_v2（run.log L1 "Saved outputs to /mnt/data/rhodotron_nonlinear_v2"）；SHA256.txt 覆盖 6 个核心文件 | 包实际位于 «用户主目录»/Downloads/rhodotron_nonlinear_v2（移动无记录）；SHA256.txt 仅覆盖 6 个 .py/.md/.json，4 张 PNG+run.log+tests.log 不在完整性清单内（实测 sha256sum -c 6/6 OK） | run.log L1；SHA256.txt（6 行清单）；包目录 ls（13 文件 vs 6 项清单） | T4（T0 系边界，**需复核**） | 是 | 自包含于同包（run.log 自述路径 vs 实际位置；清单 vs 目录），同包同日 | 完整性检查+环境/位置记录（T0–T4 边界） |
| E-A1 LEDRO 优势来源（种子继承 vs 流程结构） | AIEO_DEV（«AIEO_DEV»/） | 2026-06-30 报告：「LEDRO 用更少的仿真（80<114）取得 Pareto 占优，J：0.0081 vs 0.292」；分析文档进而断言「同一个起始锚点…唯一差别是工作流」「LEDRO 的胜出是结构性深层优势，不是随机性…约 4× 结构性领先」 | 2026-07-04 受控实验：「此前的『LEDRO 胜出』主要是赢了起跑线（H2 种子继承）」——LEDRO 经 bash 越狱读到旧 B1 已收敛解作锚点、Q_indp 仅得通用起点；公平盲启下 LEDRO 不再领先且更易系统性失败（3/5、2 次漏 C3/A3r）；给种子后两流程 100% 收敛；全局最优 Q_indp·Seed_02 J=2.6×10⁻⁴。07-29 git 913f89b 修订 Phase_1 总结报告为「未通过公平复现」 | reports/实验报告/Phase-1/场景B1_实验报告.md（§八+核验声明）、场景B1_实验分析.md（§4 结论+§〇逐位核验表）、场景B1_种子对照实验报告.md（2×2×5、20 算例表 A-3.1、审计 A-4）；git 913f89b diff（Phase_1总结报告.md 能力边界表行删除/重编号、"更易翻车"→"更易系统性失败"）；runs/B1_LEDRO/history.jsonl（80 行）、runs/B1_Q_indp/history.jsonl（123 行） | T3 | 是（原始层；汇总层断言相反、设计登记缺失） | 原始层：LEDRO 执行细节/会话记录在库（Task_B1_LEDRO/，本席未开正文；07-04 报告 §A-1.1 证实复盘从执行记录发现 bash 越狱）；汇总层：06-30 报告与分析文档同目录同日，断言「同一起始锚点」；跨天（06-30→07-04） | 实验设计记录（受控因子登记）+汇总断言对原始记录的核对 |
| E-A2 Q_indp 对手数据（中途快照 vs 最终） | 同上 | LEDRO 报告 §7 对比表所载：Q_indp「纯 SCBO、28 迭代、C3=1.83 未校正、J=1.90、未收敛」 | Q_indp 最终交付 C3=0、astig=0.014、A3r=0.256、C1=−0.0215、J=0.292、已收敛（独立重跑逐位复现）；前数「必须来自某个中途快照或自跑对照，不是 Q_indp 的最终结果」——06-30 报告 §8.2 当日订正 | 场景B1_实验报告.md §8.2（订正原文，同日）+报告头独立复现声明；runs/B1_Q_indp/history.jsonl `b1q_r2_solve1`（C3=0.0、C1=−0.02152、A3r=0.2562，2026-06-30T20:20:11） | T1 | 是 | 两记录并存同项目同日（06-30）：Q_indp 最终记录（history.jsonl/最终记录文件）与 LEDRO 报告对比表 | 等值/区间比对（join）+run 终态识别 |
| E-A3 取斑口径 10µm→1µm | 同上 | 三构型实验①（07-25..27）：双物镜束斑 327 nm（10 µm 近轴像面网格）、单物镜 347 nm@10 µm，「距 250 nm 门 77 nm」 | 实验②：「取斑口径是首要陷阱…10 µm 网格会跨过亚微米束腰→束斑被高估 ~65 nm 且 K_S 被误导到次优点」；1 µm 真束腰 263 nm（347→263）；「实验①的 327 nm 几乎肯定也被同法高估」（未重跑，推断） | reports/jKDesign_eoopt_三构型实验报告.md §2.2/§4（git 913f89b，07-29 新增）；runs/eoopt-agent-ds/scw/optimum.in L11 起、_run/spot.in L11 起（screen("wcs") z 步长 1e-6 m=1 µm，修正后 08-06 运行实际采用新口径） | T2（347/263 数值出自结论文档，**需复核**） | 是（当时在；主要工件现不在库） | 实验① 10 µm deck 及 GPT 输出当时应在记录中（实验②据此对比），现不在库（全仓检索无 optimum_bfield_only.in/10µm deck）；现存工件级证据=后续运行 deck 口径变化+git 版本链，隔 ~1 周（07-27→08-06） | 量口径登记表（网格/束腰定义）+输入指纹（deck screen 行） |
| E-B1 SC-off v1 宽度统计撤回 | Beijing pm0 三代静电场诊断包（«盘C»/…/Downloads/20261014_Beijing_field_sanity_v2/） | v1 off 后处理：宽度表 tables/onoff-ref2-4plane-32width-commonID-v1.csv 及其脚本，σ 用 ddof=1、W90 用 numpy 线性插值分位数 q95−q05（非冻结统计），表名带 commonID 但未按群体分开 | 2026-10-13 ROOT 撤回：「v1 files are KEPT for history but are RETRACTED STATISTICS - DO NOT CITE their numeric values」；冻结口径 σ=np.std(v,ddof=0)、W90=排序索引差（round(0.95(n−1))−round(0.05(n−1))，不插值）、SC 响应=100×(ON/OFF−1)；v2 产物分离群体（all_survivors vs per_plane_common_ID）、424mm 面用真 tag screen424_diag、32/32 ON 值与 G1 逐位相等（job 01M4VB7KYK63RJ2N1VX14NNTXD，exit=0，192.677 s）。424mm：yσ 238.208→233.927 µm、W90 742.555→727.842 µm、SC 响应 σ 1.83003%/W90 2.02134% | source_data/fieldsanity-ERRATA-OFFRUN-V1-STATISTICS-v1.txt（撤回原文，单行）；source_data/ref2topo-G1-PAIRED-FROZEN32-v1.json（`width_formulas` 冻结定义）；field_sanity_plots/SC_OFF_summary_validation.json（`excluded_sources`、64 行核查、32/32 相等）；SC_OFF_result_summary_zh.txt L25；ERRATA_AND_EVIDENCE_SCOPE_zh.txt §10 | T2 | 是 | 冻结口径登记（G1-PAIRED-FROZEN32-v1.json 的 width_formulas）与 v1 脚本/表同项目并存、同日（10-13）、跨文件（定义 JSON vs 统计表/脚本）；撤回文本点名 "violating the frozen 32-metric definitions" | 量口径登记表（命名量→统计公式）+统计脚本与登记公式的一致性检查 |
| E-B2 DSH v2 说明 HEADLINE 混用口径 | 同上 | DSH OFFRUN-NOTE-v2-FROZEN32.txt 的 HEADLINE：同一「SC 响应 yσ/yW90」标签混用全存活/共同ID 群体口径（或旧值） | 该误导说明不采用、不收入包；「所谓 DSH v3 纠正文案未写成，不存在」；数值以独审 v2 CSV（64 行冻结表）为准——同标签两口径差 0.34 pp（424mm yσ SC 响应 all_survivors=1.83003% vs per_plane_common_ID=2.16815%；W90 2.02134% vs 2.34964%） | ERRATA_AND_EVIDENCE_SCOPE_zh.txt 条目 11a（L53）；SC_OFF_summary_validation.json（`excluded_sources[1]="Misleading DSH v2 note HEADLINE"`、summary_rows 两群体×4 面）；SC_OFF_result_summary_zh.txt「口径与证据」节（两口径分行） | T2 | 是 | v2 CSV（64 行含两群体行）与 DSH note 同时存在于同工作区（10-13/14）；headline 数与 CSV 行对账（join）即可判别；note 原件未收入本包（被排除），现存证据=勘误文本+CSV 两行 | 口径登记（群体定义）+headline 数↔表行 join |
| E-B3 合并勘误 E4(d)「assert 不存在」+E2 范围扩展 | 同上 | ERRATA-CONSOLIDATED-v1 的 E4(d)：把「三代 x/y 反对称误差为 0」归因/担保于 mirror 脚本的 assert/abort（「脚本注释说配对失败会 abort」）；E2 只订正 −10mm 附近的标签 | §7 追加订正：「E4(d)…也不成立：mirror 脚本记录坐标反对称误差，但未执行该 assert 或失败 abort。此批数据的零误差由输出记录及独立坐标复核支持，不能归功于不存在的断言」；E2 扩展：遗漏更广的负 z 节点误标 emit_extract_0-11mm，整个 domain_zone 列一律不作物理区段证据 | ERRATA_AND_EVIDENCE_SCOPE_zh.txt §7（两条）；source_data/fieldsanity-mirror_symmetry_v1.py（头注 L6 "unpaired -> abort" 为注释；grep 'assert' 仅 2 处且均为 "NOT/no …assertion" 否定表述；L70 输出 manifest 自记 "no axial-symmetry assertion"）；mirror-manifest-v1.json（零误差输出记录） | T4（E2 属 T2 系；**需复核**） | 是 | 脚本、输出记录、合并勘误同包并存（source_data/，10-13）；docstring 声明与代码行为的差异同目录可查 | 前提依赖+脚本内容/版本指纹（T4）；E2 需标签有效性口径登记（T2） |

## 2. T0–T5 分布统计（核心数字）

| 档位 | 数量 | 占比 | 事件 |
|---|---|---|---|
| T0 | 0 | 0% | —（2 条 T0 系特征事件被划入 T4 并标「需复核」：E-R3、E-B3） |
| T1 | 1 | 11.1% | E-A2 |
| T2 | 4 | 44.4% | E-R2、E-A3、E-B1、E-B2 |
| T3 | 1 | 11.1% | E-A1 |
| T4 | 3 | 33.3% | E-R1、E-R3、E-B3 |
| T5 | 0 | 0% | —（正例见 §3.5 说明） |
| 合计 | 9 | 100% | 3 项目 |

**线索状态比例（对 9 个标定事件）**：
- 「线索当时已在库中」：**9/9 = 100%**（A1：原始层在、汇总层断言相反、设计登记缺失；A3：当时在、主要工件现不在库）。
- 「从未登记」：**0/9 = 0%**。
- **另计「该记未记」（未闭合的未登记变更轨迹，不计入上表分母）：2 条**，见 §3.2。

## 3. 分档实例摘要

### 3.1 T0：该档未找到
9 事件中没有纯 T0（单条记录不自洽）实例。E-R3（run.log 自述 /mnt/data/… 与实际位置不符+清单不覆盖 PNG/日志）与 E-B3（被引用的 assert 不存在于代码）具有 T0 系特征（工件自述不自洽/引用担保不存在），但按协议「谁够用」映射归入 T4 并标「需复核」，请主会话/复核席裁定档位边界。

### 3.2 「该记未记」另计条目（父会话指令：单独计入比例）
1. **EGUN（«盘D»/EGUN_Simulation_Files/）**：`Program/EGUN_Script.ipynb` 0 字节（2025-03-03）；`Projects/GridedGun/PIERCE_TYPE/` 与 `Projects/GridedGun/Program/` 为同名影子副本，内容不同版（EMISSION.EGN 3929→5758 B、INPUT.DAT 417→840 B、Emission.txt 424→1004 B；mtime 03-10 vs 03-17）；`Projects/Learning/CASES/` 第三份同构副本；`EGUN_RUNNER.txt` 指向死路径 `Z:\Projects\GridedGun\Program`；无任何运行日志——03-10→03-17 的参数变更**从未登记**，旧参数集仅靠影子副本偶然存留。
2. **rhodotron 3D deck（«本地项目»/Rhodotron-new-design/rhodotron.in，2026-10-12）**：全 360° 3D 单圈 GPT deck（216.667 MHz、Cfac=1.41、11 个偶极扇区、`D:\GPT Files\relativistic_one_loop\` 场图）——从 1D 理论到 3D 全图的升级**无输出、无日志、无结论文档**，结果从未登记。
这两条说明：用户资产中存在「变更发生但从未登记」的实例；但它们不是闭合修正事件（无修正后信念），故不计入 9/9 分母。

### 3.3 T1（E-A2）
LEDRO 报告对比表与 Q_indp 最终记录各自都是对其对象的真陈述：对比表如实记录某次中途快照（28 迭代、C3=1.83），最终记录如实记录收敛解（C3=0、J=0.292）。错在记录之间的语义前提——「该快照即该 run 的最终状态」——run 的终态没有登记，两条记录必须沿 run 时间轴 join 才能对账。

### 3.4 T2（E-R2 / E-A3 / E-B1 / E-B2）
四条同构：**标签不变、口径变了**。B1 最典型——v1 宽度表与冻结 32 定义各自都对：v1 数值是 ddof=1/线性插值下的正确计算，冻结定义是 G1 审计的登记口径；错在「这个命名量（424mm y 宽度 σ/W90）用哪套公式」的记录之间没有唯一口径登记，同一标签指向两套公式。A3（10µm/1µm 网格）、B2（全存活/共同ID 两群体行）、R2（η 参数化/hard-edge 几何两种能区构造）同构。检测只需一张量口径登记表+脚本/公式一致性检查。

### 3.5 T3（E-A1）
06-30 数据与分析文档各自都对（全部数字经 history.jsonl 逐位复现「完全相符」，机制分析在其内部前提内成立）；错在记录之间的语义前提——「两条线同一起始锚点、唯一差别是流程」——起点因子未在实验设计层登记为受控因子，workflow 与 seed 共变。07-04 的 2×2×5 受控重复（按起点分块）正是对该缺失登记的修复，是 T3 所需「设计层记录」的完整实例。

### 3.6 T4（E-R1 / E-R3 / E-B3）
三条同构：**每个数都对，前提变了/前提登记缺失**。R1：v1 的 b=0.0214 是 integrated-voltage 薄透镜模型下的正确结果，v2 的 J_KK≈0.999 是有限腔相位依赖 Jacobian 下的正确结果；同一「RF 响应」标签的模型版本/输入指纹没有随 run 登记，run 身份混淆。B3：结论（零反对称误差）正确且独立复核，但记录把担保归于代码中不存在的 assert——前提依赖了与代码版本不符的工具行为。R3：run 的环境/位置记录（/mnt/data/…）与实际位置不符，移动无记录。检测需要「结论依赖哪些前提」+软件版本+输入指纹+参数/位置变更史——即 V3 关联召回的靶心。

### 3.7 T5：该档未找到（修正事件）
9 事件中没有「欠定被当成已定」的闭合修正实例。说明（非事件）：Beijing 包的自述边界——材料域 unknown、不是 FEM 精度/几何边界/全 3D 散度旋度/网格收敛证明、单配对种子不足以给统计不确定度、NOT_FOUND 行不用于任何结论、图 13 出生支持矩形不是上游轨迹包络——是 T5 目标能力（**否定性状态：欠定可登记可取回**）的正例展示；它是能力形态的正面证据，不构成修正事件。另答父会话问题：该包自述边界中，「欠定显式登记」部分属 T5 能力形态；「GDF 大场图不在包内、大型分片 SHA 由既有 VERIFIED/sidecar 记录绑定而非本轮重哈希」属 **T0 级完整性谓词**（based_on→包外工件），且被包如实登记（ERRATA §9）。

## 4. 不能声称什么

1. **样本量**：9 事件/3 项目，来自用户自述「混乱且无法复现轨迹」的自有科研资产；选择偏向「留下书面痕迹之处」。真实修正频率与「从未登记」比例被本样本**低估**（§3.2 的 2 条未登记轨迹即为例证，且 EGUN 类资产可能远不止 1 个）。
2. **选择偏差**：只覆盖了可被文件名/目录结构/版本痕迹定位的资产；「无痕迹」类资产（整目录无日志、无版本）无法进入标定，其修正事件（若有）不可见。
3. **被排除范围**：streak camera / UED 合作范围（gpt-streak 样本、AIEO_DEV 的 ued-tuning 目录、AIUED 项目与文档、各 Streak_Camera 目录、«本地项目»/data）未打开、未计入——分布**仅对非合作范围有效**，不能外推到用户全部科研活动。
4. **档位判定**：单席判定（机械+抽取席位）。E-R3、E-B3 为档位边界案例（T0↔T4），标「需复核」；E-R1 的物理前提更换（RF 模型版本）之 T3/T4 归属标「需物理复核」。
5. **E-A3** 的 347/263 nm 数值出自结论文档，修正前主要工件（实验① deck/GPT 输出）现不在库；该事件标「需复核」。
6. **AIEO history.jsonl 的 T4 run 身份混淆假设**：实测 B1_Q_indp 9 个重复 run_id 参数+结果**全部逐位相同**（冗余重记，06-30 当晚）；B1/B1_LEDRO/A1/A2 无同名下不同参数实例——**未发现**「同 run 名参数变了」型 T4 实例。06-30 报告「114 次仿真」vs history 123 行恰由 9 条重复条目解释，非矛盾。
7. 「线索当时已在库中」判定基于「记录当时存在」，不等于「当时被注意到/被召回」。

## 5. 席位自检声明

- **确认未打开排除文件正文**：`experiments/v3-semantic-poc/samples/gpt-streak/**`（仅列文件名，未开任何 .jsonl/.in/.yaml 正文）；`«AIEO_DEV»/experiments/ued-tuning`、`«AIEO_DEV»/testbeds/ued-tuning`（未打开）；`«本地项目»/AIUED`、`«用户主目录»/Downloads/AIUED_*`（未打开，仅登记路径为已排除）；`«盘D»/CST_Simulation/Streak_Camera`、`«盘D»/SIMION_Simulation/Streak_Camera`（未打开）；`«本地项目»/data`（未打开）。
- **考虑过但排除的路径**（非范围相关/无可用痕迹）：`«盘D»/Code/workplace`（零提交 git 仓）；`«本地项目»/Optimizer`（eoopt 主仓，4 提交实测仅 JIT 重构+优化器新增，无信念修正）；`«盘D»/Circuit_Simulation/ElectronGun`（LTspice .ms14 压缩二进制，命名链 FormerDesign→New_Design 存在但 netlist 不可直读，改锚后弃线）；`«用户主目录»/Downloads/A_*|B_*.md`（Lean round-1 取证指令文档，仅线索定位、目标仓未定位，改锚后弃线）；`«盘D»/CST_Simulation` 其余目录（改锚指令禁止搜索，435G）；`«盘D»/AI_Coworking`、`«盘D»/Papers`（改锚指令禁止搜索）。
- **文件读预算**：rhodotron 10/10（改锚后按指令追加读 1 个第三代表 deck rhodotron.in，共 11，超支已登记）；AIEO_DEV 8/10（Phase_1总结报告 diff、三构型报告 diff、种子对照报告、场景B1 报告、场景B1 分析、scw/README、scw/optimum.in grep、runs/history.jsonl 解析）；Beijing 6/10（portable_script_changes.json、README_START_HERE_zh、SC_OFF_result_summary_zh、SC_OFF_summary_validation.json、ERRATA-OFFRUN-V1-STATISTICS、ERRATA_AND_EVIDENCE_SCOPE_zh）+ sha256/grep 核验（不算正文读取）。
- **只读纪律**：/mnt/c 与 /mnt/d 全程只读；全部输出写入工作区 `experiments/v3-necessity-probe/e4a/`。
- **状态词汇**：本文全部结论为 MEASURED 上限；无 GO/NO-GO；未对 V3 设计提出修改建议。
