# G2 审计矩阵（2026-11-03 集中修订后）

> 用途：外部审查要求的「合并后的审计矩阵」——逐条列出已修缺陷、真实测试、所依据的合同、正式实施 PR、
> 仍未覆盖的运行风险。每一行都能追到**可复跑的命令**，不是文档编号或字符串比对。
> 适用：G1 冻结申请与 G2 乙类开工的判据面。
> **2026-11-03 状态更新**：G1 已冻结、G2 乙类已获用户授权（`g1/G1-FREEZE-DECISION-20261103.md`；**契约冻结版本 `fa3b892`**，与开发起点 SHA 分列，见实施基线 §2）。
> 本矩阵仍是判据台账，不因授权而改变任何判据；授权范围与未授权项以该决策文书为准。

## 0. 审查轮次与覆盖范围（诚实记录）

| 轮次 | 范围 | 结论 |
| --- | --- | --- |
| R1 非作者复核（2026-11-03，`71fa972`） | §0bis 三项 + 冻结门禁全量 | 阻塞：2 BLOCKER（证据锚、②负例）+ 2 需修（高位同步、exit 断言） |
| R1 修复（`4e30c18`） | 同上 | 复验「无阻塞，可进入结项」 |
| R2 外部审查（2026-11-03，`01db6f6`/`e3e8eb5`） | 迁移形态、PR-8 权威收口、权限分层、P-EXT 范围、复核归档 | P1 已修（`e3e8eb5`） |
| R3 外部审查（2026-11-03，`e3e8eb5`） | JC-1 事务时序（P0）、幂等回放、PR-6b/PR-10 边界、宿主映射、实施基线、CI 投票 | **本矩阵对应的一次性修订** |
| R4 非作者定向复验 | 仅 R3 影响的机制链与正式放行门（真实反例，非文档编号） | 2×P1 + 4×P2，已修（`53f3329`） |
| R5 非作者定向复验 | 仅 R4 修复面 | 「修复有效，可进入结项」；2×P2 已修（`db27ad2`） |
| R6 外部复审（2026-11-03，`db27ad2`） | 六组整改复查 + 生产接入顺序 + 错误模型 | 核心通过；2×P1（Bootstrap/错误模型）+ 3×P2，本轮修订 |

**覆盖声明**：本轮覆盖「单个契约各自正确、组合后是否可执行」这一类问题（JC-1 是首个实例）。
**不覆盖**：五类对象语义、H/S/R 顶层、独立 Kernel 必要性（已有稳定结论，不再重开）。

## 1. 已修缺陷与证据

| # | 缺陷 | 严重度 | 真实测试（可复跑） | 依据合同 | 正式实施 PR | 残余风险 |
| --- | --- | --- | --- | --- | --- | --- |
| D1 | JC-1 旧顺序要求执行前写入未知事件区间与未知首次结果（组合不可实现） | **P0** | `node experiments/…/preflight/tx/run.mjs` → TX-1/TX-2（三注入点）/TX-3（四守卫）/TX-4，exit 0；R4 复核席自写 CE-1/CE-2/CE-3 反例均未成立 | JC-1（八步）、CS-1.3、IDC-4 | PR-9（幂等层）＋ PR-5（表形） | 并发同键持锁竞争、kill 9 格矩阵未在真库覆盖（IDC-7/IDC-8 已设计，归 PR-9） |
| D2 | 幂等回放三缺口（中间提交、同键异体、权限撤销）＋ 回执可删 | P1 | 同上 IDEM-1/2/3 + TX-3 第四条（回执 DELETE 拒），exit 0；R4 的 CE-5 反例已由该条覆盖 | IDC-5/IDC-7/**IDC-12** | PR-9 | 披露判定依赖宿主授权模型；PoC 只验证「读权撤销 ⇒ 拒披露」一形 |
| D3 | P-NS 迁移批量改写历史 `contract_version`（违版本治理） | P1 | `node experiments/…/preflight/ns/run.mjs` → 五项 + 负例，exit 0（连跑 2 次） | UNIFIED §3.3/§3.4/§5.1 | PR-5（迁移器）＋ PR-7（版本化读者） | 换库/WAL 崩溃窗口归 PR-5 硬性验收（清单见 VERDICT §2） |
| D4 | PR-8 延后未同步到权威契约/入口/门禁 | P1 | `g1-checklist-validate --require-clear` exit 0（27 项，违规 0）；四处文档加注 | UNIFIED §3.2 步 4、PLAN PR-5/PR-8/PR-10、ENTRY、清单 | —（文书） | 重定位契约文本保留；未来启用需按冻结变更流程 |
| D5 | PR-6b 要求三步写同事务（与 Q40/现有报告接口冲突） | P1 | 契约层拆分（保证 A/B + 可选 C）；`preflight/tx` 的 TX-1 覆盖「两个命令同事务」形态 | PLAN PR-6b、Q40、DC-4 | PR-6b | 可选 C（事务作用域报告 Port）尚未实现，属显式 API 的后续设计 |
| D6 | PR-10 把 G3 领域规则偷渡为 G2 退出条件 | P1 | 契约层边界声明（五类对象机制兼容性 vs 字段/状态机） | PLAN PR-10、§6.1′ | PR-10 | 字段/状态机完备性留 G3；G2 只验机制面 |
| D7 | ResearchSpace 宿主映射无实施规则 | P1 | `G2-IMPLEMENTATION-BASELINE.md §1`（禁推导 + 显式绑定 + `CONTEXT_INCOMPLETE`） | UNIFIED P1、D-1 未决、Q24 | PR-3/PR-9（Adapter） | D-1 粒度仍未决（本矩阵不裁决）；绑定规则可替换 |
| D8 | 正式源码收编基线未写死 | P1 | `G2-IMPLEMENTATION-BASELINE.md §2/§3`（起点 `e3e8eb5`、五个 PR SHA、模块映射表） | #44 布局建议、禁止整体合并 PoC | PR-3 起 | `packages/kernel` 是否拆包由 PR-3 定 |
| D9 | CI 只对 main 投票、PoC 侧车 advisory | P1 | `G2-IMPLEMENTATION-BASELINE.md §4`（正式测试进投票路径、SHA 可识别） | `.github/workflows/ci.yml` 现状 | 第一个实施 PR | 触发面调整需改 `.github/**`（非冻结面），属阻塞项 |
| D10 | 科研采纳权与开发批准混淆 | P1 | `G1-TRUSTED-PROFILE-DELTA.md §4` 两层拆分 | 用户裁决 + `G1-REMAINING-USER-DECISIONS` 项 4 | —（文书） | 采纳政策待业务启用前确定 |
| D11 | P-EXT 证据范围高估 | P1 | `preflight/ext/VERDICT.md §1/§4` 收窄 + 挂 PR-11/PR-6b | §0bis P-EXT、Q40 | PR-11/PR-6b | 具名命令端口跨域写入未验证 |
| D12 | 非作者复核原文未归档 | P2 | `G1-FREEZE-REVIEW-20261103-SEAT.md`（R1 两轮 + R4 定向复验原文 + 逐项处置） | §0bis 固定收尾门禁 | —（文书） | R5 复验结论需继续追加同文件 |
| D13 | 唯一实施入口仍写旧七步/旧三步同事务（R4 P1-1） | P1 | `G2-IMPLEMENTATION-ENTRY.md` 行 3/11/24 已改（八步、A/B 两保证、步 6） | JC-1 八步、PLAN PR-6b | —（文书） | 入口与计划后续需保持单源 |
| D14 | 回执 DELETE 未被守卫（R4 P1-2） | P1 | `preflight/tx` TX-3 第四条断言 + `idem_receipt_no_delete` | IDC-4（回执行永久不删）+ INV-K | PR-9（生产 DDL 同形触发器） | 生产表仍需同形触发器 |
| D15 | PR-2/PR-3 落地顺序倒置＋`p3-intake-validation` 无投票载体（R6 P1-1） | P1 | `G2-DEV-PLAN` **Bootstrap Gate**（落点 `src/kernel/**`、骨架、`tests/kernel-bootstrap.test.ts`、测试迁入根 `tests/`、CI 触发面、五条命令门禁） | 实施基线 §2、根 `vitest.config.ts` 排除 `experiments/**` | PR-2 第一提交 | Bootstrap 尚未执行（G2 开工后第一件事）；CI 触发面仍是实施前阻塞 |
| D16 | 四个新错误信号绕过封闭码治理（R6 P1-2） | P1 | `g1/G1-ERROR-MODEL-RECONCILIATION.md`（四信号逐一归类；封闭集净扩张 0）；JC-1/IDC-12/基线/tx 实验改用既有载体并实跑 | §2.10、`RefusalCode` 联合、ADJ X-2/X-3 | PR-3/PR-9（正式负例与宿主映射） | `AUTHORITY_REQUIRED`/`CONTEXT_INCOMPLETE` 的新用法负例待补 |
| D17 | PR-6b 保证 A 未要求两个**不同** Capability（R6 P2-1） | P2 | 保证 A 加严（双 Capability 正负例；单域「创建+修订」不算通过）；tx VERDICT 明示该实验不冒充跨域 | PLAN PR-6b | PR-6b | 跨域具名命令协同仍待正式实现验证 |
| D18 | 基线 Git 起点三义（R6 P2-2；R7 改冻结 tip；**R8 用户修正：tip 浮动不可追溯**） | P2 | 基线 §2 拆两概念：**契约冻结版本 `fa3b892`（不可变）** vs **开发起点（`g2/impl` 第一提交钉死的字面 SHA，≥ `788c6ee`，且契约文本与 `fa3b892` 逐文件一致）**；禁用 `$(git rev-parse <branch>)` 作基线；新增 §2.4 选择性收编 | 实施基线 §2/§2.4、冻结决定 §1 | 第一个实施 PR | 收编 PR 尚未创建 |
| D19 | 采纳权引用错误项号（R6 P2-3） | P2 | DELTA §4 改「项 1」并注明项 4 是事件名单签署人 | `G1-REMAINING-USER-DECISIONS` 项 1 | —（文书） | 无 |
| D20 | Bootstrap 要求原始 `tsc` 零错误（与 19 条已登记债务冲突） | P1 | 改为 `pnpm run check:types`（诊断身份不新增债务）+ 新增 `tsconfig.kernel.json` 只检新面 | `dev/engineering/tsc-debt.ids`、`scripts/tsc-gate.mjs` | PR-2 Bootstrap | `tsconfig.kernel.json` 需随第一提交落地 |
| D21 | Bootstrap 提前要求双序号分离（依赖倒置复发） | P1 | 改为最小提交环（提交/读回/回滚）；双轴归 PR-4/PR-5；测试夹具须自足（禁 import `experiments/**`） | PLAN PR-4/PR-5 | PR-2 / PR-4 / PR-5 | `tests/helpers/kernel-harness.ts` 随第一提交落地 |
| D22 | 生产收编方式可能把叠层实验历史并入主线 | P1 | 基线 §2.4：收编 PR base = `main`，白/黑名单 + `git diff --stat` 逐 PR 核对；`g2/impl → #49` 仅开发期可见性，不是发布路径 | 既有「禁止整体合并 PoC 分支」纪律 | 第一个收编 PR | 收编 PR 尚未创建 |

## 2. 未修但已定归属（不在本轮，不需要新 PoC）

| 事项 | 归属 | 为什么可以留 |
| --- | --- | --- |
| 换库 `rename` / `-wal`/`-shm` 删除窗口崩溃注入、迁移器幂等 | PR-5 硬性验收 | 属实现质量，不改变架构结论；VERDICT §2 已列 5 条判据 |
| 并发同键持锁竞争、kill 9 格矩阵 | PR-9 真库夹具 | IDC-7/IDC-8 已给判据形状 |
| 具名命令端口的跨域扩展性 | PR-11 + PR-6b | P-EXT 已收窄到基础机制 |
| 五类对象正式字段/状态机/接纳规则 | G3 | G2 只验机制兼容性 |
| D-1 空间粒度 | 用户裁决 | 本矩阵不裁决；映射规则可替换 |
| 双轴（提交序/事件序）完整验收 | PR-4 + PR-5 | Bootstrap 只验最小提交环，不提前要求双轴（否则依赖倒置复发） |
| 首版 5 个待消费事件名的 `Approved-By`（PR-2 两名、PR-7 两名、PR-10 一名） | **用户指派独立批准者** | 既定流程逐名办理；不重开架构讨论，也不由作者自批 |
| P-A 敌对 Profile（恒时/逐字节/穷尽侧信道） | 未来敌对部署立项 | 已按 T-SEC 降级为可选加固 |

## 3. 放行判据自检（外部审查给的退出条件）

| 条件 | 状态 | 证据 |
| --- | --- | --- |
| 无已知 P0 契约自相矛盾或不可实现写入时序 | **满足** | D1 已修 + TX-4 反例否证旧顺序 |
| 所有 P1 有已验证修复，或有明确理由留给实施 PR | **满足** | §1（D2–D11）＋ §2 归属表 |
| 自动化验收验证真实行为（非夹具自报/词汇扫描/重复断言） | **满足（本轮范围内）** | TX/IDEM 用真实 SQLite 事务与触发器；P-NS 用真实库升级与崩溃注入 |
| G2 正式基线、宿主绑定、CI、分支收编固定；结果对应 SHA | **满足（文书层）** | `G2-IMPLEMENTATION-BASELINE.md` §2/§4；CI 触发面调整仍待第一个实施 PR 落地 |
| 用户只需批准阶段冻结与开工，不需重裁 H/S/R | 满足 | 本轮全部改动在判据/文书/实验区，未动五类对象与顶层语义 |

## 4. 门禁快照（提交见 PR #49 最新 HEAD）

| 门禁 | 结果 |
| --- | --- |
| `node experiments/…/preflight/ns/run.mjs` | exit 0（五项 PASS，真负例齐） |
| `node experiments/…/preflight/tx/run.mjs` | exit 0（TX-1..4 + IDEM-1..3） |
| `node experiments/…/g1-checklist-validate.mjs --self-test` | exit 0（31/31） |
| `node experiments/…/g1-checklist-validate.mjs --require-clear` | exit 0（27 项；A 20/20 done、B 7 open 有归属、违规 0） |
| `git diff --stat` 范围 | 仅 `experiments/**`（冻结面 8 根文档 + `schema/**`、生产 `src/**`、`tests/**` 零改动） |
