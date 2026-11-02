# G2 已知红灯登记（起点即红，非本轮引入）

> 纪律依据：用户 G2 授权「不得为了过门禁而降低测试标准、删除负例、伪造基线或接受新增的未登记红灯」。
> 本文件登记**在 G2 起点（`04c773a`）已存在**的红灯——它们不阻塞 G2 开工，但必须可追溯，且**不得**
> 用重锚（`snapshot:update` / 改 `gates/G0-inventory.yaml` 哈希）或删测试的方式「转绿」。

## R-1 `tests/engineering/eb1-canonical.test.ts` — G0 批准哈希与工作树不符

- **现象**：`every G0-ratified hash still matches the working tree` 失败：
  `SUBAGENT_ROUTING.md: expected '7c23e850…' to be '4b1f3f5f…'`。
- **复现（起点 `04c773a`，独立 worktree，未含本轮任何改动）**：
  ```
  $ npx vitest run tests/engineering/eb1-canonical.test.ts
  × every G0-ratified hash still matches the working tree
  Tests  1 failed | 7 passed (8)
  ```
- **性质**：G0 台账（`docs/engineering-baseline/gates/G0-inventory.yaml`）里的批准哈希与
  当前 `SUBAGENT_ROUTING.md` 内容不一致。即：文件在批准后被改过（或台账登记时即不一致），
  而 `git status` 显示该文件无未提交改动 ⇒ 是**已提交状态下的既存不一致**。
- **为什么不在 G2 修**：修它有两条路，都必须由用户裁决，不能实现者自选：
  ① 恢复文件到批准哈希对应内容（可能丢掉批准后的纪律更新）；
  ② 重锚台账（`SUBAGENT_ROUTING.md` 属 8 根冻结文档之一 ⇒ 须走冻结变更流程 + `Frozen-Face-Review`）。
  G2 授权明确排除「自行修改冻结契约」与「重锚掩盖回归」，故**只登记、不处理**。
- **影响面**：`pnpm test` 全量运行恒有 1 red（5081 passed / 1 failed）。任何 PR 的 `pnpm test`
  证据都必须援引本登记，而不是声称「全绿」。
- **建议**：G2 首个冻结面 PR（PR-2）提交前，请用户给一句裁决（恢复 vs 重锚），届时按对应流程一次办掉。

## 登记纪律

- 新增条目必须附**起点复现证据**（命令 + 输出），否则视为本轮引入的红灯，不许登记。
- 条目被修复后不删除本条，改标注「已修复 + 修复提交」。

## R-2 — `--commit` 在非默认工作树下的可疑静默放行（**未闭合，待查**）

登记时间：2026-11-04（G2 第 24 轮）。发现场景：复核席要求为「改锚残余③④」补常驻架空间，
我在临时仓（`git init` 的全新目录）里构造应判红的提交，`checkCoupling(head, tempRoot)` 返回
**0 条命中**——连本应报的 `EVENT_RECON_COUPLING` 也没有。

已排除：`checkCoupling(sha, cwd)` 内部 `git()` 确实绑定了传入的 `cwd`（`execFileSync` 的 `cwd`），
临时仓里 ledger 路径与写点路径都在 `files` 列表内。

未排除的可能：
- `readAt(`${sha}^`)` 在临时仓里返回 null（父提交/路径解析差异）⇒ 走「创建提交」分支跳过全部比较；
- `verifyApprovals` 依赖 `REPO` 模块级常量，与 `cwd` 不一致导致前置条件不同；
- 其他早退路径。

**影响判断**：生产根（`cwd === REPO`）的逐提交门禁实测 4/4 有判别力，故**当前不认为生产路径漏检**；
但「传别的 `cwd` 就静默放行」本身就是一种可被将来的调用方踩中的失效形态（例如未来把 PR 检查
挂到别的 checkout 上），必须查清后才能声称 `--commit` 可靠。

复现步骤（≤10 行）：建空仓 → 提交 `contracts/event-registry/EVENT-CONTRACT-LEDGER.json`
（单条 `approved[0].anchor = docs/a.md#capability-enabled`）→ 下一提交把 anchor 改成
`docs/mine/docs/a.md#capability-enabled` 并同时改 `src/kernel/k.ts` → 期望 `checkCoupling` ≥1，实测 0。
