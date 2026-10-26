# development.md — Agent 开发纪律（精简版）

> 与 `AGENTS.md`（沙箱与工作区纪律）互补：这里管**变更怎么进来**。红线冲突时
> 以 `AGENTS.md` 与用户指令为准。

## 红线（先读这个）

1. **冻结面**（8 根文档 + `schema/**`）只在冻结变更流程内改：改文件 →
   `pnpm run snapshot:update` → 契约与清单同一提交评审（构建的双向 sha256 门会拦住偷懒）。
2. **数据/权限语义、宿主 pin、V1 冻结语义的变化 = 停工向用户确认**，不借「清理/重构」夹带。
3. `docs:sync` 只写 `docs/README.md` 的派生块；任何工具自动改规范/ADR/registry/源码
   的诉求直接拒绝（SYNC_REFUSED）。
4. 状态**不可互相推导**：ADR 的 `proposed/accepted/implemented/verified/released` 与
   Gate 的 `PASS/BLOCKED/PENDING/UNKNOWN` 各管各的；声称 `verified/released` 必须带
   存在的 evidence 路径（`docs:check` 抓虚假证据）。
5. 决策进 `docs/decisions/`（一文件一决策，frontmatter：`id/status/title/date`，
   可选 `supersedes/evidence`）；`id` 不复用、不改名。
   上游设计线的原则性 Draft ADR（`docs/architecture/adr/D<NN>_*.md`，PR #9 类）
   受**类别规则**：D-id 唯一、id↔文件名、`**状态**` 行存在、必须入该目录 README
   索引（`ADR_ORPHAN`）——其状态词汇自由且**不**映射实现状态词汇（映射待 #10
   PoC 通过后另行裁决；状态词汇不互推双向适用）。

## 与并行子代理共工作区（integrator 纪律）

- 子代理在**同一工作目录**写文件时，integrator 的一切 git 暂存必须用**显式
  路径**；`git add -A` 会把代理半成品卷进无关提交（真实事故：P1 代理的
  prov/replay 中途快照被卷入 CI 小 PR，只能 amend+force-push 剔除）。
- 提交前 `git show --stat` 核对范围；代理文件在交付回报前一律视为不可提交。
- **registry.yaml 是内核 mini-YAML**（scripts/docs/kernel.mjs：仅嵌套映射 +
  block list + 注释；不支持 block scalar `|`/`>` 与多行折行值，直接 FATAL
  REGISTRY_UNPARSABLE——真实事故：known_debts 条目长值必须写成单行）。
- **新文档先跟踪再 sync**：`docs:sync` 生成的派生索引只覆盖**已跟踪**文件——
  新 md 未 commit 时 sync 不出条目、docs:check 也测不出 stale，push 后 CI 才红
  （真实事故 ×2：PR #10、#25 均为此）。固定顺序：add → commit → sync --write →
  （README 有 diff 则）amend → push。

## 标准工作流

```sh
# 提交前本地门（与 CI 同内核）
git diff --name-only origin/main...HEAD > /tmp/changed.txt
pnpm run docs:probe --paths /tmp/changed.txt   # 影响范围与相关测试（advisory）
pnpm run docs:check                             # 全量静态一致性（read-only）
pnpm run build && pnpm run check:freshness      # 契约校验 + 预构建产物新鲜度
pnpm run lint && pnpm test                      # 四件套
pnpm run pack:verify                            # 发布门禁（含新鲜度门）
```

- 变更分级选门：一般 PR 跑快门口径；`schema/**`、权限/持久化、宿主 Adapter 变化
  升 T2/T3；V3 科研语义属 Draft #9/#10 范围（未生效，勿在主干实施）。
- 一个原子提交一个意图；**门禁/工具脚本自身的变更**必须在 PR 里给红→绿证据。
- 归属与风险面见 `dev/engineering/doc-ownership.yaml`（最具体 glob 优先）；
  probe 报 `DOC_IMPACT_UNOWNED` 时补条目或确认忽略。

## 非推导事实登记

宿主 pin、Gate 裁决、TS 债务基线等在 `dev/engineering/registry.yaml`（人工维护，
sync 禁写）。改 pin 不跑 T3 = 违规；`docs:check` 只核对登记一致性，不核对世界。
