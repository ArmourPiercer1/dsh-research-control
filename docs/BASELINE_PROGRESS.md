# BASELINE_PROGRESS — 进度记录与可复现基线（Stage-0）

- 基线 SHA：`0fa2b1a1391889752ea12538071811832d2155bd`（= origin/main，v0.1.0 后 112 commits）
- 本分支：`baseline/stage0-docs-gates`（worktree 开发，主检出不动）
- 本次运行环境：node v24.21.0，pnpm 11.7.0（engines `^22.19.0 || >=24` 内），依赖 `pnpm install --frozen-lockfile` exit 0
- 证据分级标记：〔声称〕=作者文档/提交记载；〔实证〕=本次读码；〔实跑〕=本次命令 + 真实 exit code + 完整日志

## 1. 门禁复现结果〔实跑〕

| 门禁（README L91 顺序 tsc→lint→build→test） | exit | 摘要 | 日志（完整 stdout/stderr） |
|---|---|---|---|
| `npx tsc -p tsconfig.json` | **1** | 21 条 `error TS` / 输出 40 行（诊断见 §3） | `.baseline-logs/tsc.log` |
| `node scripts/check-imports.mjs`（lint） | 0 | INV-PERM-5 无违规 | `lint.log` |
| `pnpm run build`（tsdown+snapshot） | 0 | 三相位成功；产物面见 §5 | `build.log` |
| `npx vitest run`（未 build、缺 §4 正本） | 1 | 106/336 files failed（根因 §4） | `test.log` |
| `npx vitest run`（build 后 + §4 准备步骤） | **0** | **330 files 通过｜6 skipped；4844 passed｜21 skipped** | `test-rerun1.log` |
| `pnpm run test:perf` | 0 | 21/21（TC-PERF-001..006） | `perf.log` |
| `pnpm run pack:verify`（父层仅 schema） | 1 | snapshot-release「SOURCE_ROOT PARTIAL」fail-loud（预期行为） | `pack-verify.log` |
| `pnpm run pack:verify`（§4 完整后） | 0 | 519 entries、无 dev 泄漏、main/typert/remote（59 invocations=58 RPC+ping）node 导入 OK | `pack-verify2.log` |

日志目录：`/srv/workspace/dsh-plugins/dsh-research-control/.baseline-logs/`（会话工作区，未入库）。
〔声称〕作者记录「tests 4844/21、perf 21/21、pack:verify 519 entries、tsc ZERO DIFF（40 行基线）」——本次数字与前三项一致〔实跑〕；tsc 见 §3，**历史内容等同性未证**。

## 2. 上轮 1128 failed 的根因（诊断闭合，非回归）〔实跑+实证〕

独立 clone 缺「科研工作区根正源」环境假设。三类消费者：

1. **测试 resolver（受影响）**——14 处把「仓库父目录」当作 workspace root 读 `schema/`：
   `tests/property/helpers.ts:67`、`tests/runbinding/helpers.ts:51`、`tests/perf/generator.ts:61`、
   `tests/rpc-face/stale-precheck.test.ts:36`、`tests/sessionlink/fixtures.ts:38`、`tests/reporting/pure.test.ts:127`、
   `tests/semantics-records/harness.ts:54`、`tests/semantics/fixtures.ts:25`、`tests/history-registry/fixtures.ts:26`、
   `tests/loader/fixtures.ts:22`、`tests/dependency/harness.ts:41`、`tests/wiring/helpers.ts:48`、
   `tests/history-replay/helpers.ts:116`、`tests/rpc-face/stale-precheck.test.ts`（同一列表按 grep 计）。
   全部为 `resolve/join(HERE,'..','..','..')`（HERE=`tests/<suite>/`），即 `WR_ROOT = <repo>/..`；
   下游 ~38 个 spec 文件消费其 `WR_ROOT/schema/…`。standalone clone 中解析到不存在的
   `<repo>/../schema` → `SCHEMA_UNAVAILABLE`/ENOENT → wiring integrity gate 抛 `WIRING_INTEGRITY`
   （`src/host/service/wiring/startup-integrity.ts:211`）。**测试代码不读任何 env 覆盖**。
2. **构建脚本（受影响）**：`scripts/snapshot-release.mjs:59` `SOURCE_ROOT = env DSH_SNAPSHOT_SOURCE_ROOT ?? <repo>/..`。
   源根完全缺席=大声跳过（git-install 语义）；**部分在场=PARTIAL fail-loud**（L90/L102）。
3. **生产运行时（不受影响）**〔实证〕：`src/host/dsh-adapter/host/index.ts:1910 #resolveSchemaRoot` 是独立解析器——
   `DSH_RESEARCH_SCHEMA_ROOT` env 优先，否则自模块位置向上 ≤8 级探测含 `common.schema.json`+
   `history|declarative|operational` 的 `schema/`。发布/git-install 布局在 `<pkg>/schema`（包内快照）即命中。
   **生产 schema 解析不依赖仓库父目录**。

## 3. tsc 真实失败诊断（SHA `0fa2b1a1`，本次快照）〔实跑〕

exit 1；21 条 error、40 行输出（完整保留于 `tsc.log`）。**没有入库的历史逐行基准**，本表即第一份持久化快照；
不得宣称与作者「ZERO DIFF（40 行基线）」内容等同——仅计数巧合、分类如下（已知技术债边界，非本阶段修复对象）：

- `src/` 2 条：`settings-card.tsx:177` TS2352（Record 断言）、`investigator-page.tsx:55` TS2307
  （`../../shared/analysis-command.js` 模块解析缺失——注意这是 src 内真实类型断链，建议列入债务清单专项）
- `tests/` 19 条：fixture 面滞后（`rpc-face.test.ts:81` 缺 8 个新方法、views-shell 三套 props 面滞后、
  vitest Mock 类型代际、dom testing-library 元素类型等）——test-side 类型债，运行时以 vitest 全绿为实证

40 行诊断正文的**逐字副本已入库**：`docs/BASELINE_TSC_BASELINE.md`（含运行元数据与判定规则）。
后续 **no-new-errors 门禁 = 与该文件逐行 diff 比较内容，禁止以行数/条数巧合判定通过**。

## 4. 最小、受支持的隔离测试准备步骤（standalone clone）

不静默依赖外部拷贝：以下为**显式、create-once、不覆盖**的准备步骤（本次实跑采用的正是它）。
**create-once 语义**：目标任一存在即中止（fail-if-exists）——这是防覆盖的**一次性创建**流程，
不是幂等流程；重跑需人工确认现状后自行决定，本步骤**不删除**任何已有目录。
本仓库内可复现修复（测试 resolver 统一读 env）列为 Stage-1 前置小项 G0，见 PLAN；本轮不改测试代码。

```sh
# 变量定义（本次实际值；REPO=插件仓库 checkout 根，WS=其上的隔离 workspace-root 物化目录）
REPO=/srv/workspace/dsh-plugins/dsh-research-control              # 主检出（完整 clone，含 schema/ 与 8 根文档快照）
WS="$REPO/.worktrees"                                             # 测试 checkout（如 $REPO/.worktrees/baseline）的父目录
# 前置：$REPO 已 clone 且已 pnpm install；测试 checkout 嵌于 $WS/ 下一层（使测试的 WR_ROOT 解析到 $WS）
# create-once：目标任一已存在 = 立即中止（不覆盖、不删除任何既有外部文件）
test -e "$WS/schema" -o -e "$WS/ARCHITECTURE.md" && { echo 'WS fixture 已存在，中止'; exit 1; }
# 正本内容 = 包内快照（SI-001 构建期逐文件 sha256 断言两者一致），不改动任何全局权限/配置
cp -a "$REPO/schema" "$WS/schema"                       # 23 文件（22 json + README）
for f in ARCHITECTURE DOMAIN_SCHEMA DSH_ADAPTER GIT_INTEGRATION HISTORY_EVENT_CATALOG \
         PLAN_FORK_SPEC SUBAGENT_ROUTING TEST_MATRIX; do cp -n "$REPO/$f.md" "$WS/$f.md"; done
```

- fixture 实际位置（本次）：`$WS/schema/` = `<REPO>/.worktrees/schema/`（23 文件）+ `<REPO>/.worktrees/*.md`×8；
  与测试 checkout `<REPO>/.worktrees/baseline/` 同级，使 `WR_ROOT=<REPO>/.worktrees` 成立。
- 只创建、不覆盖、不 symlink 外部文件、不改全局配置；`pack:verify` 亦可改用官方 env：
  `DSH_SNAPSHOT_SOURCE_ROOT=<WS>`（无需 fixture 在场时按缺席语义跳过刷新）。
- 顺序纪律不变：**build 先于 test**（`tests/rpc-face/artifacts.test.ts` 断言构建产物面）。

## 5. 构建非确定性（不入库，避免 artifact churn）〔实跑〕

fresh build 对已提交产物产生两类**机器特异** diff，Stage-0 一律不提交（已 `git checkout --` 复原）：

1. `lib/client.js`：18 处 `//#region \0rcm-css:<绝对路径消毒>` 注释行（构建机路径烙入 CSS 虚拟模块 id），
   纯注释 churn，无语义差异。
2. `SNAPSHOT.md`：生成时间戳 + 源根路径两行。

边界：Stage-0 不为此引入构建规范化（避免扩大为 artifact 大工程）；若上 CI，需在门禁中把这两类列入
「已知非确定面」白名单或后续专项 normalize。当前 git 纪律（作者机 build 后提交 lib/）继续有效。

## 6. 模块进度表（证据分层）

| 模块 | 状态 | 证据 |
|---|---|---|
| RPC 面 58+1 ping（13 冻结 V1 + 9 plane + 36 GUI mgmt） | 已实现已接线 | 〔实证〕`src/host/dsh-adapter/host/index.ts` `^\s*@Remote`×59；pack-verify 断言 59 invocations〔实跑〕；README L9「22」已在本次 README 修订 |
| service 层 25 子包 | 已实现（写面/读面混合） | 〔实证〕目录 + import 接线 |
| agent 工具 11 | **2 活 + 9 桩** | 〔实证〕`src/host/tools/stub.ts:54`、`index.ts:32-34`、`tests/tools/stubs.test.ts` |
| GUI views 14 域 + i18n 双目录 | 已实现 | 〔实证〕目录；〔声称〕UI-9 提交 59 面冻结 |
| persistence/hardening | 已实现 | 〔实跑〕vitest 全套含 hardening 套件通过 |
| perf（TC-PERF-001..006） | 已实现 | 〔实跑〕`perf.log` 21/21 |
| **e2e（Playwright 18 spec）** | 文件存在、历史有绿证据 | **本次 NOT_RUN**——需启动隔离 DSH_HOME/独立端口宿主实例，超出本次只读调查授权；**不代表本次验证**，仅〔声称〕历史 live 记录（提交信息）+ 文件在场〔实证〕 |
| 文档正源（V2 设计、计划书、SI-001 裁决） | **缺口**（在作者工作区根，未入库） | 〔实证〕find 全树；README L3 引用无法在库内解析 |
| GitHub 协作面（**baseline 调查时点 2026-10-02 快照**） | 该时点：0 issues、0 PRs、无 `.github/` CI workflow、HEAD 无 check runs | 〔实跑〕`gh issue/pr list --state all` 均 `[]`。**注**：本 PR #1（Stage-0）在该快照之后创建，非该时点数据；后续 review 亦可能新增，非静态事实 |
