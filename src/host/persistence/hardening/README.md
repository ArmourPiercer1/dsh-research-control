# persistence/hardening — startup hardening (WP-8.1)

Crash recovery + boundary handling for `[Service.init]`: the startup
integrity checks (ARCHITECTURE §10 失效与降级), the failure
classification (可恢复 / 不可恢复), and the schema-migration strategy.

## Failure taxonomy (the §10 table, machine-readable)

| 失效 | check | 分类 | 处置 |
|---|---|---|---|
| SQLite 损坏（quick_check / 结构 / JSON 列） | `db` | 不可恢复 | 结构化 `STORE_CORRUPT` 报错 + 指向 DB 文件；operational 数据**不可恢复**（V1 无事件导出/备份，已知风险）；报告**断言**声明式真源（`.research/`+Git）状态（取自 tree/git check 实测结果，不过度声称）；remedy = 用户删除文件（+ -wal/-shm）重开 |
| `user_version` 不匹配 / 过期 V1 结构 | `db` | 不可恢复 | `STORE_VERSION` / `STORE_SCHEMA_STALE` — pre-release **不迁移**（DSH_ADAPTER §9「不匹配即拒绝」）；remedy = 删除重开 |
| DB 无法创建/打开（环境） | `db` | 不可恢复 | `STORE_OPEN` — 明确报错，无静默降级 |
| `.research/` 文件非法（schema 校验失败等） | `tree` | 可恢复（降级） | §10 行原文：拒绝加载该文件并**报错定位（文件+字段）**，不猜测修复；其余文件正常加载 → **只读可用面**（写面拒绝：checkpoint/plan 变更/事件 append）+ loud 告警 |
| `.research` 根缺失 / project.yaml / schema-version 缺失 / 契约版本不匹配 / 冻结 schema 集损坏 | `tree` | 不可恢复 | 启动拒绝（fail loud）+ 按形态给出 remedy（git restore / 重装插件） |
| Git 可执行缺失 / 非 repo | `git` | 可恢复（降级） | §10 行：拒绝 managed research mode；给出「Initialize Git Repository」**显式操作入口**（install-Git 对应 install 指引）；**绝不静默 init**；读面不受影响 |
| merge/rebase/cherry-pick/revert 进行中（§5.1 五标志） | `git` | 可恢复（降级） | **checkpoint 显式拒绝**（INV-GIT-4）+ 提示先解决；读面不受影响（working copy 即 canonical） |
| 脏工作区 | `git` | pass | TC-GIT-001：读不受影响；checkpoint 仍允许（仅提交 `.research/**`，无关脏态原样保留） |
| git 自身报错（repo 损坏） | `git` | 可恢复（降级） | §9「原样展示 git 错误；插件不尝试修复」；managed mode 拒绝直到 repo 健康 |
| 双真源分歧（file-leads / file-trails） | `consistency` | 可恢复 | **重建 derived / 对账 loud**：本检查只检测（read-only），wiring 的启动对账（lifecycle convergence → run-vs-history → semantics rebuild）在本报告之后 loud 收敛 |
| 项目作用域不匹配（project.yaml id ≠ 注册 scope） | `consistency` | 不可恢复 | 不猜哪边该改 → 启动拒绝 + remedy（restore 任一侧） |

聚合语义：**聚合而非短路** —— 每个能跑的 check 都跑（DB 坏了也要报告
tree/git 状态，这正是 §10 SQLite 行要求「断言声明式真源完好」的前提）。
outcome = `fatal`（任一不可恢复）> `degraded`（仅可恢复）> `ok`。
`fatal` → `assertStartup` 抛 `HardeningFatalError`（携带完整 report，
dsh-adapter 转 fiber FAILED，TC-DSH-008）。**绝不静默**：每个非 pass
finding 都有 guidance（用户指引）+ 结构化日志（warn/error）+ summary。

## Surface narrowing（degraded 时）

- `readSurface: 'readonly'` ⟺ tree 部分损坏（写面不得建立在部分坏
  真源上）；git 冲突/缺失**不**置 readonly（声明式文件完好，单独收窄
  `checkpointAllowed` / `managedMode`）；
- `checkpointAllowed` = managedMode ok ∧ 无进行中冲突 ∧ tree 未坏
  （dirty **不**阻断 — TC-GIT-001）；
- `managedMode: 'refused'` ⟺ git 缺失 / 非 repo / git 报错。

## Schema migration 策略（文档化决策）

**Pre-release（当前）：不迁移。** `PRAGMA user_version` 单调
（DSH_ADAPTER §9，照 DSH storage-sqlite 模式）：

| `user_version` | 决策（`resolveVersionPolicy`） |
|---|---|
| `0` | `initialize` — V1 init 单事务 |
| `1`（supported） | `open`（+ 结构复核；过期 V1 结构 → `STORE_SCHEMA_STALE` 拒） |
| 其他 | **`reject`** — 不匹配即拒绝；remedy = 用户删除文件重开（数据是 pre-release dev 产物，已知接受） |

**预留机制（本 WP 交付骨架，测试假迁移一轮证明）：**

- `SchemaMigration` — upgrade 钩子接口：`fromVersion`/`toVersion` +
  `upgrade(db)`；runner 在**同一事务**内执行 step DDL + 最后一条
  `PRAGMA user_version = toVersion` → 崩溃 mid-step 整步回滚，文件停在
  上一步版本（始终完整、可重入、单调）；
- `planMigrations(current, target, registry)` — 升级路径规划：单调
  （禁降级）、链式连接（缺链 = 结构化错误，绝不静默跳过）、同起点多
  step 取最大 toVersion（确定性）；
- `runMigrations(db, steps)` — 逐步 `fromVersion` 守卫（stale plan 在
  任何 SQL 前拒绝）+ 每步单事务；
- `PRE_RELEASE_MIGRATIONS` — **刻意留空**。Post-release WP 在此加 step
  并同步 bump `DB_USER_VERSION`，open path 的 mismatch 分支改走
  plan+run — 策略开关只在这两处，别处不动。Pre-release 期 live 行为
  就是「不匹配即拒绝」（测试钉死：registry 空 + `resolveVersionPolicy(99,1).action === 'reject'`）。

## 边界

- 只读探测：本层**不修复、不 init、不改写**；收敛机制 = 已交付的
  wiring 启动对账 + 用户显式操作（GIT_INTEGRATION §6/§9）。唯一 DB
  写面 = 预留迁移机制（pre-release 无 live 调用）。
- INV-PERM-5：无 DSH import；git 经 `src/host/git`（唯一 spawn 点）+
  可注入 `GitOps` 端口（测试注入 ENOENT/repo-error 形态）。
- 接线点：dsh-adapter `[Service.init]` 在 `createHostWiring` **之前**
  调 `runStartupIntegrityChecks` + `assertStartup`（wiring 变更归后续
  接线 WP；wiring 当前的 WIRING_TREE「任何 load 错误即启动失败」比
  §10 行更严，采用本分类后可为部分损坏服务只读面 — 见报告未决问题）。
