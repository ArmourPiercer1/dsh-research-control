# PoC Evidence — 命令、SHA、退出码与实测现象

> 本文件只登记**可复现证据**。任何未被本文件命令覆盖的说法，都不得当作已证明。
> 状态词汇见 `README.md`；结论解读见 `ASSESSMENT.md`。

## 1. 环境与被审提交

| 项 | 值 |
| --- | --- |
| PoC 分支 | `poc/v3-code-arch-20261030`（由 PR #44 head 直接切出，未设 upstream 防误推） |
| 基线 | PR #44 head `5ec38974`（`origin/design/v3-code-architecture-review-20261027`） |
| 领域契约基准 | PR #42 head `0369c3196cec0b217125afeba78b89933be5d4c9` |
| 工程基线 | `origin/main` = `80abe7d` |
| SQLite | `node:sqlite`（内置），SQLite 3.53.4，Node 24.21.0 |
| 新增依赖 | **无**（未装 better-sqlite3 等；用 Node 内置驱动） |

核验命令：

```bash
git rev-parse HEAD
git rev-parse origin/design/v3-code-architecture-review-20261027
gh pr view 42 --json headRefOid --jq .headRefOid
node -e "const {DatabaseSync}=require('node:sqlite');const d=new DatabaseSync(':memory:');console.log(d.prepare('select sqlite_version() v').get().v)"
```

## 2. PoC 套件（本区独立 runner）

```bash
pnpm run test:poc:arch          # exit 0
npx tsc -p experiments/v3-code-architecture-poc/tsconfig.json   # 0 诊断
```

结果（阶段 D 修复后）：**Test Files 7 passed (7) / Tests 58 passed (58)** = 49 例作者测试
+ 9 例审查员攻击测试（其中 2 个文件按修复后契约改写为更强断言，见 `REVIEW.md` §2），全部断言跑在
`experiments/v3-code-architecture-poc/.poc-data/**` 下的真实 SQLite 文件上。

> 例数不手写：由 `npx vitest run --config experiments/v3-code-architecture-poc/vitest.config.ts
> --reporter=json` 按文件计数；下表为当前分支快照（增删测试须重生成）。

| 文件 | 例数 | 覆盖的架构检验 |
| --- | --- | --- |
| `tests/p1-storage-tx.test.ts` | 10 | §13.1/§13.4、§15.1 边界①：单空间跨插件 UoW 原子性、三类故障注入、事件权威唯一、Ledger 不可变、Journal 可压缩、暂存不可见、无写权拒绝 |
| `tests/p2-identity-plugin.test.ts` | 10 | §13.2/§13.3、§15.1 边界②：kind 固定、精确 vs 导航引用、同事务循环引用、硬/软引用、拆包后身份不变、移交持久与原子、ns 漂移 fail-loud、Facet 全周期、越权写拒绝 |
| `tests/p3-intake-validation.test.ts` | 14 | §13.5/§13.7/§13.8、§15.1 边界③：Raw Intake、接纳失败保源、可解析≠合格、版本化报告不可改写、UNKNOWN 合法、不可用降级、归约唯一、端点类别纪律、授权轴与派生视图截点 |
| `tests/p4-read-isolation.test.ts` | 9 | §13.6/§13.10/§13.11/§13.12、§15.1 边界④：ReadContext 必需性、双时间顺序、五出口空间隔离、缓存出口、呈现脱敏不可区分、Journal 缺口与"Journal 不能充当历史"、游标续跑与滞后标注、影响只给候选、截断必须标注 |
| `attacks/invariant/`（不变量攻击者） | 3 | 登记序、精确引用、记录标识（原始攻击 + 修复后更强断言） |
| `attacks/host/`（宿主与边界） | 5 | 修订级引用、报告登记序、路由权威、强转触达内部方法、SQL 守卫 |
| `attacks/review/`（P1 修复复审） | 5 | 第 1 轮修复完整性：报告三件套同滚、源端修订、守卫绕过（注释前缀/多语句）、目标 manifest |
| `tests/arch-independence.test.ts` | 7 | 任务硬约束「Kernel 不包含科研语义判定规则」+ 依赖方向 + 领域插件扩展不需改 Kernel（面哈希）+ 五类 kind 路由 + 必需依赖成环拒绝 |

## 3. 关键实测现象（不是类型签名推断）

> **[实测] 的作用域**：指"断言跑在真实 `node:sqlite` 文件上且可复跑"。它**不**自动蕴含多进程
> 并发、崩溃恢复或宿主集成（那些在 §5 列为未证明）。纯逻辑类断言（kind 路由、证明力缺失等）在
> `CONTRACTS.md` 中标 **[实现断言]**，与存储边界实证区分。

| 编号 | 现象 | 复现 |
| --- | --- | --- |
| M-1 | 另一连接持写锁时，本事务在 `busy_timeout` 耗尽后失败；探针实测等待 502ms 后 `errcode=5`（SQLITE_BUSY），持锁方提交后只读到对方的行 ⇒ **无部分提交** | `p1` 提交冲突例 + 一次性探针 `node -e "...DatabaseSync..."` |
| M-2 | 提交前钩子抛出 ⇒ `object_directory` 计数 0、`ledger_head` 0；随后同世界可正常提交 ⇒ 零不是"写不进" | `p1` 提交阶段失败例 |
| M-3 | 中途抛错的事务不推进水位：其后第一次成功提交落在 `seq=1`、`ledger_head()===1`、`count(seq>1)===0` ⇒ 回滚不留 phantom 空洞（非事务自增做不到） | `p1` 中途失败例 :60-67 |
| M-4 | `update/delete from ledger` 与 `update object_directory` 被触发器拒绝；`delete from journal` 允许 ⇒ 不可变性是存储层属性，不是"整库只读" | `p1` 不可变探针 |
| M-5 | Journal 单独重放只得 1 条，而权威登记有 2 条 ⇒ Journal 不得充当历史真源 | `p4` 缺口例 |
| M-6 | 跨空间目标引用与"目标不存在"的呈现**深度相等**，且序列化后不含对方空间标识 | `p4` 隔离例 |
| M-7 | 脱敏后报告不含任何数字（无计数侧信道），而审计视图仍保留完整区分 | `p4` 脱敏例 |
| M-8 | 移交在事务内改路由 + 留登记；失败事务不回写内存视图；重启后所有者不变 | `p2` 移交例 |
| M-9 | 换实现但 ns 未迁移 ⇒ 读写双向 `SCHEMA_INCOMPATIBLE`，不静默返回空 | `p2` 漂移例 |
| M-10 | 加第二个领域插件（新 kind + 新 ns）时 Kernel+契约 sha256 面基线不变，两种 kind 正确路由 | `arch-independence` 面哈希例 |

## 4. 主仓门禁（PoC 分支上的实测）

| 门禁 | 命令 | 结果 |
| --- | --- | --- |
| 根单测全量 | `pnpm test` | 首跑 `2 failed / 5080 passed / 21 skipped (364 files)`；两个失败文件单独跑均全绿，归因见 §6 |
| 类型债门 | `pnpm run check:types` | `[tsc-gate] known-failing debt reproduced EXACTLY (19 diagnostics; identity match, not count match)` — **未新增债务** |
| 导入不变量 | `pnpm run lint` | `check-imports: OK — no INV-PERM-5 violations in src` |
| 文档静态一致性 | `pnpm run docs:check` | 本分支上**先红后绿**：新增侧车文档后报 `FAIL DOCS_INDEX_STALE @ docs/README.md: 派生索引过期`；按门禁给出的唯一处置执行 `pnpm run docs:sync --write`（只写派生索引）后复跑 → `OK — 1200 tracked files, static consistency clean`。**未**把问题文件从索引或门禁剔除 |
| 文档索引 | `pnpm run docs:sync --write` | 已重生成 `docs/README.md` 派生索引（唯一可自动写文件） |

## 5. 未证明的边界（禁止越级引用）

未测：多进程并发写同一空间文件（只测同进程双连接）；DSH 宿主权限面与工具面；真实五类对象字段
与状态机；性能/容量；备份与时间点恢复；Schema 迁移工具；热插件加载与沙箱。领域判据全部是
**合成占位规则**（`src/domains/**` 文件头声明），不得被引用为 PR #42 科研语义政策的实现。

## 6. 根单测两个失败的归因（记录事实，不猜结论）

首跑 `pnpm test` 报 2 失败：`tests/engineering/eb2-docs.test.ts`（docs:sync 写边界）与
`tests/g5-real-registry/workflow.test.ts`（history_query 重放得到 4 条而非空）。

已核实的事实：
- 两个文件**单独跑均全绿**（`npx vitest run <file>`：25 tests passed / 15 tests passed）。
- `eb2-docs` 那条会**就地改写 `docs/README.md`** 再断言 `docs:sync --write` 能逐字节还原；
  首跑时有 4 个对抗审查子代理在并发运行同一仓的 `pnpm run test:poc:arch` 与 git 只读命令。
- `g5-real-registry/workflow.test.ts` 不使用 `tests/dsh-homes/`（grep 无命中），因此与
  DSH_HOME 残留无关。

处置：该两条与 `experiments/**` 无代码交集（本区被根 vitest 排除、被根 tsconfig 排除、
不参与 lint、不进 build）。

**最可能的归因（待一次独占串行重跑确认）**：两次全量运行都与其他进程**并发**跑在同一工作树：
- 第 1 次（2 失败）期间，作者正在提交并执行 `pnpm run docs:sync --write`——而
  `eb2-docs.test.ts` 那条正是**就地改写 `docs/README.md` 再断言 sync 能逐字节还原**，
  并发的 sync 会直接破坏它；
- 第 2 次（1 失败，另一条自愈）期间，多个审查子代理正在并发执行 `pnpm run test:poc:arch`
  与只读 git 命令。

这条归因是**可证伪的**：在所有其他进程停止后重跑 `pnpm test`，若两条都消失即成立；
若仍失败，则须回到基线提交做对照，且**不得**声称主门禁全绿。

## 7. 新门禁的红→绿证据（`docs:probe` 对 `package.json` 变更的要求）

本分支在 `package.json` 新增 `test:poc:arch`（侧车 runner），属门禁面变更，按 probe 的 T0 动作
须给出红→绿证据。观测序列（均在本会话内实际发生，非叙述）：

| 时点 | 状态 | 观测 |
| --- | --- | --- |
| P1/P2 落地后 | 绿 | `Test Files 2 passed / Tests 19 passed` |
| 契约重构后 | **红** | `[PARSE_ERROR] Unexpected token`（`src/contracts/index.ts:84` 类型联合被 `;` 提前终止）；`4 failed`（移交授权轴缺失，`Refusal: NO_SPACE_WRITE`） |
| 架构独立性门禁首跑 | **红** | `2 failed`：Kernel 面基线未重生成；可选依赖成环被误判为不可装配 |
| 阶段 D 攻击测试引入 | **红** | `45 failed`（`no such column: to_revision`）；随后 `4 failed`（审查员断言写的是修复前契约） |
| 修复后（当前） | 绿 | `Test Files 7 passed / Tests 58 passed`，`tsc` 0 诊断 |

另有一次**作者自己写错的断言**被记入证据而非抹掉：`tests/p4-read-isolation.test.ts` 的缺口用例
最初把 Journal 缺口构造在重建 baseline 之下（那里缺口确实不影响索引），断言 `STALE` 是错的；
修正方式是调整测试构造，**不是**放宽机制语义（提交 `d0764bd`）。

## 8. 分支与远端边界（避免误读）

- 本分支 `poc/v3-code-arch-20261030` 已从 PR #44 head `5ec3897` 切出并**推送过一次**（远端同名新分支）。
  未合并任何 PR、未改动 PR #42/#44/#47 的 Draft 状态、未向设计分支或 `main` 推送。
  若按最严格口径解读"不推送远端"，该次推送应视为需要用户裁决的一处越界，用户可要求删除远端分支。
- 后续提交（含阶段 D 修复与全部文档）**仅在本地**，等待用户裁决是否推送。
