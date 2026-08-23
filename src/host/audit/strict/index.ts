/**
 * WP-6.1 — workspace policy + strict git audit: 包公共面 (唯一 import 点).
 *
 * 交付面 (任务书目标 1-4):
 *  - 目标 1: {@link normalizeWorkspacePolicy} — `.research/workspace.yaml`
 *    policy 字段经 **loader 面** 读取 (loader 解析+冻结 schema 校验,
 *    DOMAIN_SCHEMA §14.1), 归一化为只读 {@link AuditPolicy};
 *  - 目标 2: {@link runStrictAudit} — 注册 workspace 的 strict git audit
 *    (W4 status 分类 / W5 diff 摘要 / W13 ls-files 枚举, GIT_INTEGRATION §8),
 *    输出结构化 {@link AuditReport} (tracked 修改清单 / 新文件清单 /
 *    `.research/` 一致性);
 *  - 目标 3: 只读 — 无任何写路径 (类型面证明:
 *    tests/audit-strict/read-only.test.ts; 执行面经 git wrapper 白名单
 *    W1/W4/W5/W13, 全部自动触发只读操作);
 *  - 目标 4: 与 §5.1 冲突检测正交 — audit 不做 checkpoint、不设冲突门禁
 *    (冲突态下读操作照常, GIT_INTEGRATION §9)。
 *
 * 层规则 (ARCHITECTURE §2.2): audit → git (唯一 git 面) + domain (type-only);
 * 零 DSH import (INV-PERM-5); 零 node:fs/node:child_process (本层纯 git + 纯函数)。
 *
 * 后续 WP 消费面: WP-6.2 (discovery zones 扫描 — 输入 `newFiles.outsideResearch`
 * + `policy.discoveryZones`), WP-6.3 (reconciliation 三档 — 输入
 * `trackedChanges`/`strictTracked`/`research`), WP-6.4 (Inbox)。
 */
export { AuditError, AuditInputError, AuditPolicyError, NotARepoAuditError } from './errors.js'
export { DEFAULT_AUDIT_POLICY, normalizeWorkspacePolicy } from './policy.js'
export { runStrictAudit } from './audit.js'
export type {
  AuditDiscoveryZone,
  AuditPolicy,
  AuditReport,
  ResearchConsistency,
  StrictAuditOptions,
  StrictTrackedChange,
  StrictTrackedReport,
} from './types.js'
