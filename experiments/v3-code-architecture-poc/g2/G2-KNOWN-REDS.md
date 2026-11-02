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

## R-3 — `raw-record-declared` 翻面受阻：写点面与「唯一入口」冲突（**需裁定，未闭合**）

登记时间：2026-11-04（G2 第 37 轮）。实测：把锚文件 `raw-record-declared` 由 `planned:true`
翻 `planned:false`（Port 形状、实现、清单登记均已就位）后，对账立刻红：

```
FAIL [EVENT_RECON_STALE] 入账条目 raw-record-declared 既无写点又非 planned:true
```

根因是两条规则相互拉扯：
- 锚文件 `writeSites: ["src/kernel/**", "src/storage-sqlite/**"]` —— 写点只认机制面；
- 契约要求端口内部走**拥有者的** `appendAuthoritativeEvent`，而调用点必然在领域包（`src/domains/**`）。
  领域包不在写点面内 ⇒ 对账认为「这个名字没有写点」。

三种可能出路（**必须由人裁定，不是实现细节**）：
1. 扩锚 `writeSites` 加入 `src/domains/**`——但 `writeSites` 是语义行，改它需要 `Event-Name-Review`
   trailer（我们自己 R4 的规则），且这会放宽「写点只在机制面」的既有立场；
2. 在 kernel 内部加一条机制原语 `declareRawRecord(...)`，领域端口调用它——保持写点面不变，
   但「唯一入口」从 Port 移到机制原语，需要在契约里重新表述（DC-5/DC-7 的可实现形式）；
3. 由机制在装配期把端口实现注入 kernel（翻转控制权），写点自然落在 `src/kernel/**`。

**登记原因**：这是 G1 冻结文本内部的一处张力，不该由实施者用「反正能过对账」的方式私自解决。
在裁定前，PR-2 的最后一片保持**不做**：清单已导出但未接线、锚未翻面、无入口可用。
