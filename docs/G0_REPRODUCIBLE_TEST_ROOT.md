# G0 — 可复现测试根（standalone checkout 的 build/test/pack）

> 状态：Active（Stage-1 前置小项 G0 产物，非冻结工程文档；PLAN §5 Q0 的落地）。
> 本文件只描述测试/构建/打包面的**可复现性契约**，不改动任何 Frozen V1 文档、
> `schema/` 快照、`SNAPSHOT.md`、生产权限或业务语义。

## 1. 问题（根因，实证于 BASELINE_PROGRESS §2）

14 个测试 resolver 文件把「仓库父目录」当作科研 workspace root 读取 `schema/`：
`WR_ROOT = resolve/join(HERE,'..','..','..')`（13 个），另有 1 个 URL 变体
`tests/git/tc-git-015.test.ts` 的 `SCHEMA_DIR = new URL('../../../schema')`——
后者不在 PROGRESS §2 清单内（该清单重复计了一次
`tests/rpc-face/stale-precheck.test.ts`；`tests/loader/path.test.ts:54` 是纯
路径单测非 resolver；第 14 个由本轮**无 fixture 隔离实跑**捕获）。standalone
checkout 父层没有该 fixture 时全量测试 ENOENT/`WIRING_INTEGRITY` 失败
（BASELINE §4 的父层 fixture 准备步骤只是过渡，不是可复现条件）。

## 2. G0 契约（测试面）

单一入口 `tests/helpers/workspace-root.ts :: resolveTestWorkspaceRoot()`：

| 项 | 语义 |
|---|---|
| **默认** | 插件仓库根本身 —— 测试读取**随版本树提交的包内快照** `<repo>/schema/`。按 SI-001，它是工作区根正本的**内容一致只读镜像**（`scripts/snapshot-release.mjs` 构建期逐文件 sha256 断言），因此 canonical 布局下测试语义不变，而裸 checkout 自带全部输入 |
| **显式覆盖** | `DSH_RESEARCH_WORKSPACE_ROOT=<research workspace root>`（含 `schema/` 的目录）；用于**有意**指向 canonical 正本。缺失锚点 `schema/common.schema.json` = fail-loud 并打印两个旋钮 |
| **不做的事** | 不向上探测（避免任何父层目录静默改变测试输入面）；不读生产 env `DSH_RESEARCH_SCHEMA_ROOT`；不被 `src/` import |

消费面：14 个 resolver 文件保留原导出名（`WR_ROOT` 等）仅替换解析式；下游
~38 个 spec 与 `tests/{atomic,flooding,intervention,planfork}` 等间接消费者经
import 继承，无需逐文件改动。`scripts/e2e-run.sh` 的 `E2E_SCHEMA_ROOT` 同口径：
默认包内快照，caller 显式 `DSH_RESEARCH_SCHEMA_ROOT` 优先；且在**任何 consumer
之前一次性规范化为绝对路径**（PR#2 review P2：seed factory `abs()` 要求
absolute、host 启动 env 按各自 cwd 解析——相对值统一锚定 `$REPO_DIR`，目录
不存在=启动即 fatal exit 1，杜绝跨 consumer 的歧义解释；实现在
`scripts/resolve-e2e-schema-root.sh`，聚焦回归=default/relative/absolute/invalid
四类跑 `scripts/e2e-schema-root-check.sh`，不启服务）。

## 3. 边界（不混同的三条解析线）

| 解析线 | 默认 | env 覆盖 | G0 改动 |
|---|---|---|---|
| 测试 resolver（本节） | `<repo>`（包内快照） | `DSH_RESEARCH_WORKSPACE_ROOT` | **新增**（13 文件收敛到共享 helper） |
| 生产 `#resolveSchemaRoot`（`src/host/dsh-adapter/host/index.ts`） | 自模块位置向上 ≤8 级找可用 `schema/`（发布/git-install 布局命中 `<pkg>/schema`） | `DSH_RESEARCH_SCHEMA_ROOT`（优先且校验） | **零改动** |
| canonical→包快照同步 `scripts/snapshot-release.mjs` | SOURCE_ROOT = 仓库父目录（工作区根正本在场即刷新 + sha256 断言） | `DSH_SNAPSHOT_SOURCE_ROOT` | 仅新增 SOURCE_ROOT==插件根 的自拷贝 fail-loud 守卫；缺席=大声跳过 / PARTIAL=fail-loud 语义不变 |

即：**canonical 正本同步方向（父→包）与包内快照边界保持原样**；G0 只让测试与
pack 路径不再「恰好站在 canonical 工作区里」才成立。

## 4. standalone checkout 官方流程（父层零 fixture）

```sh
git clone <remote> dsh-research-control && cd dsh-research-control
pnpm install --frozen-lockfile          # node ^22.19.0 || >=24, pnpm 11
pnpm run build                          # snapshot-release 无父层正本 → loud SKIP，exit 0
# README 四件套顺序：
npx tsc -p tsconfig.json                # 已知失败面见 docs/BASELINE_TSC_BASELINE.md（逐行 diff 判定）
node scripts/check-imports.mjs          # lint
pnpm run build                          # 必须先于 test（artifacts.test.ts 断言产物面）
pnpm test                               # 全量（e2e/** 由 vitest exclude，Playwright 另跑）
pnpm run test:perf
pnpm run pack:verify
```

无需 `.baseline-logs` / 父层 `schema`+8 文档 fixture / 任何外部目录。canonical
开发布局想让测试直读正本时：`DSH_RESEARCH_WORKSPACE_ROOT=<workspace-root> pnpm test`；
pack/快照刷新仍用 `DSH_SNAPSHOT_SOURCE_ROOT=<workspace-root>`。

## 5. 验证口径（本轮证据，日志在运行机 `.g0-logs/`，不入库）

- 先失败：base SHA `6cd8663a` + 父层无 fixture → 目标套件 12 files/142 tests 失败
  （ENOENT `<parent>/schema/...`，`iso-base-01-failfirst-targeted.log`）。
- 后通过：同隔离目录 + 本分支 → 同套件全绿；无 fixture 全量 tsc→lint→build→test→
  perf→pack:verify 见 `iso-fix-*.log`（真实 exit code 逐条在日志尾行）。
- tsc：仍 exit 1；与 `docs/BASELINE_TSC_BASELINE.md` 40 行**逐行 diff 为空**
  （本 PR 不触碰基线报错的任何文件；判定规则见该文件，禁止以计数巧合判定）。
- e2e（Playwright）：**NOT_RUN** —— 需启动隔离宿主实例，超出本会话授权；
  `e2e-run.sh` 的 resolver 改动仅静态口径，未被本轮实跑覆盖。
- perf 真实波动：最终 SHA 隔离首跑 TC-PERF-006 一次 ratio 16.9x（阈 <15x，非 schema
  解析路径）；同树 quiet 复跑 21/21 + 单文件复跑 6/6 通过（`iso-fix-05-perf.log`
  失败与 `iso-fix-05b/05c` 重试均在 `.g0-logs/`，不隐藏）。属计时敏感面的环境波动
  记录，未降门禁；是否加 CI 重试策略归后续（BASELINE §5/Q3 域外）。
- 机器特异面（`lib/client.js` region 注释、`SNAPSHOT.md` 时间戳）不入库
  （BASELINE_PROGRESS §5 纪律不变）；本文档与日志不写机器绝对路径结论。
- P2（PR#2 review，e2e schema 根相对路径歧义）修复后聚焦回归：
  `scripts/e2e-schema-root-check.sh` default/relative/absolute/invalid 全 PASS
  （`wt-07b`）；`e2e-run.sh` 接线探针 default=relative(两 cwd)=anchored absolute、
  invalid=启动即 exit 1（`wt-08b`）。未启动任何服务/UI，e2e 维持 NOT_RUN。
