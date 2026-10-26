# testing.md — 测试世界纪律

> 完整四件套语义见 README「开发」节；这里只记**环境的坑**（每条都有过现场代价）。

- **实例来源**：需要真实 DSH 的一切测试用 `tests/deepseek-harness/`（train 对齐
  `dev/engineering/registry.yaml` host_pins；切 train 必先 `pnpm run clean`）。
  `references/` 只读参考，**不是**测试实例。
- **状态隔离**：`DSH_HOME`、`HOME`（pnpm 11 sqlite 落 `$HOME`）、pnpm storeDir 三者
  全落 `tests/dsh-homes/` 内；起服/探测/关停写进**同一个** bash 调用（会话回收后台进程）。
- **git identity**：部分 fixture（如 `tests/store/tc-db-002`）在测试世界内 `git commit`
  依赖 ambient git 身份——干净环境须注入 `GIT_AUTHOR_*/GIT_COMMITTER_*`（CI 已注入；
  新 fixture 请自带 `-c user.name=...`，别再依赖环境）。
- **临时文件**：`/tmp` 跨调用不保证存在，长链探针用 `.scratch/` 或 `tests/dsh-homes/`。
- **perf**：`test:perf` 全量套跑后紧跟执行可能因负载 flake（TC-PERF-006 已登记）——
  单独重跑为准，不改阈值。
- **tsc 债务**：基线 21 错是**已知失败的身份**（`docs/BASELINE_TSC_BASELINE.md`，
  归一化身份比对），任何报告里不得显示为全绿。
- **构建路径噪声**：build 后 `lib/client.js` 的 `rcm-css:<abs>` 注释差异 = 构建机噪声
  （`check:freshness` 归一化该模式），验证后 `git checkout -- lib/`，不提交。

## e2e（TC-DSH-008 registry-floor 世界）的三个环境前提（EB3 实测）

- **pnpm workspace 边界**：`.smoke` 在仓内，而 `e2e-run.sh` 的 CLI-prep 在
  `$SMOKE_ROOT/cli` 跑 `pnpm add`——pnpm 11 会向上撞仓根 `pnpm-workspace.yaml`，
  把 rc.8 树按仓 train overrides 解析（实测三联征：仓 lock 长 importer / tsc
  虚警 / 起服 24 包解析失败）。对策：`.smoke/pnpm-workspace.yaml`
  （`packages: ["*","*/*","*/*/*"]`）封成独立 workspace；`.smoke` 重置后**要重建**。
- **profile bootstrap**：harness 不建 profile；先用**钉版 CLI**跑一次
  `DSH_HOME=$SMOKE_ROOT/dsh-home $SMOKE_ROOT/cli/…/dsh plugin --profile web list`。
- **Playwright**：`PLAYWRIGHT_BROWSERS_PATH` 指进工作区
  （`tests/dsh-homes/pw-browsers`），默认 `~/.cache` 在沙箱写域外。
- 本世界另有 **rc.8 起服自身缺陷**（与插件无关，归因实验见
  `docs/engineering-baseline/gates/G3.md`），修复前 `test:e2e` 在本机 = 已知红。

## 时间戳断言的时区假设（EB3 扫净）

`git log %aI` 在 UTC runner 上偏移输出 `Z`（本机 TZ 输出 `+08:00`）。断言 git
日期的测试必须接受 `(Z|[+-]\d{2}:\d{2})`（RFC3339 两种合法偏移）。CI 真实红灯
两轮定位全仓共 3 处：`tests/checkpoint/diff-history`（run 40273375870）、
`tests/git/tc-git-001` + `tests/git/tc-git-005`（run 40273888910）；修法附
`TZ=UTC` 本地复验。写新断言时不要复刻本机时区假设。
