/**
 * Bootstrap 测试夹具：**自足**的最小 Kernel 世界。
 *
 * 纪律（Bootstrap Gate，2026-11-03）：
 * - **零** `experiments/**` 导入——正式测试不得寄生在实验区装配代码上（import 断言在
 *   `tests/kernel-bootstrap.test.ts` 里机验）；本文件只用 `src/**` 与 node 标准库。
 * - 一个 ResearchSpace = 一个 SQLite 文件（`#44 §7`）；每个用例用独立临时目录，互不共享连接。
 * - 授权表**默认为空**：没有显式授权就没有写权（`#44 §7.2` / PR-A1）。
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SqlitePort } from '../../src/storage-sqlite/sqlite-port';
import {
  Kernel, type Authorizer, type UnitOfWork,
} from '../../src/kernel/kernel';
import {
  asSpaceId, type CapabilityId, type PluginManifest, type VerifiedPrincipal,
} from '../../src/contracts';

/** 合成能力：只用于证明机制能承载「声明 → 写事件 → 提交 → 读回」，不含任何科研语义。 */
export const CAP_BOOTSTRAP = 'cap.bootstrap.probe' as CapabilityId;

// 一个插件 = 一个持久命名空间（两能力共用 ns 会被装配拒绝，R3-C）；事件归属挂在本能力下。
export const CAP_EVENTS = CAP_BOOTSTRAP;
/** 正式事件名（机制内直写 = 通用通道拒写的那一类）。名字只在本夹具里出现，不表达任何科研语义。 */
export const DOMAIN_EVENT = 'boot-probe-recorded';
export const RETIRED_EVENT = 'boot-probe-retired';
export const AXIS_DOMAIN = 'boot-domain-admission';

export const BOOTSTRAP_PLUGIN: PluginManifest = {
  pluginId: 'bootstrap.probe',
  codeVersion: '0.0.0-bootstrap',
  provides: [{ capability: CAP_BOOTSTRAP, contractVersion: 'v1' }],
  requires: [],
  storageNamespace: 'boot_probe',
  eventAuthority: 'ledger-payload',
  ownsKinds: [{ kind: 'boot.probe', capability: CAP_BOOTSTRAP }],
  // EA-3.1 全形条目：PR-2 起 `ownsEventTypes` 就是归属账，五字段缺一装配红。
  ownsEventTypes: [
    {
      eventType: DOMAIN_EVENT,
      capability: CAP_EVENTS,
      requiresAuthority: AXIS_DOMAIN,
      truthSource: 'ledger-payload',
      interpretationRuleSetVersion: 'boot/r1',
      contractVersion: 'v1',
      approval: { approvedBy: 'harness-owner', approvedOn: '2026-11-03', anchor: 'tests/helpers/kernel-harness.ts' },
    },
    {
      eventType: RETIRED_EVENT,
      capability: CAP_EVENTS,
      requiresAuthority: AXIS_DOMAIN,
      truthSource: 'ledger-payload',
      interpretationRuleSetVersion: 'boot/r1',
      contractVersion: 'v1',
      retired: true,
    },
  ],
};

/** 已验证主体（机制只信 `verified` 的 principal；这是装配根的断言，不是调用方自封）。 */
export const PRINCIPAL = (actorId: string): VerifiedPrincipal => ({ actorId, verified: true });

export interface BootstrapWorld {
  readonly dir: string;
  readonly file: string;
  readonly port: SqlitePort;
  readonly kernel: Kernel;
  uow<T>(principal: VerifiedPrincipal, fn: (tx: UnitOfWork) => T): T;
  /** 直接读 count（绕过 Kernel 的读面，用于断言存储层真实状态）。 */
  count(sql: string, ...params: readonly unknown[]): number;
  close(): void;
}

export interface BootstrapOptions {
  /** 覆盖默认探针插件（装配期负例用）。 */
  readonly plugin?: PluginManifest;
  /** actor → 授权资源列表；默认 `{ alice: ['space-write'] }`。 */
  readonly grants?: Readonly<Record<string, readonly string[]>>;
  readonly space?: string;
}

/** 建一个临时目录（调用方负责在 afterAll 里 `rmSync(dir)`）。 */
export function tempDir(prefix = 'g2-boot-'): string {
  return mkdtempSync(join(tmpdir(), prefix));
}

export function cleanup(dir: string): void {
  rmSync(dir, { recursive: true, force: true });
}

export function openBootstrapWorld(dir: string, opts: BootstrapOptions = {}): BootstrapWorld {
  const file = join(dir, 'research.sqlite');
  const port = new SqlitePort({ file });
  const grants = new Map<string, Set<string>>(
    Object.entries(opts.grants ?? { alice: ['space-write', AXIS_DOMAIN], bob: ['space-write'] })
      .map(([a, r]) => [a, new Set(r)]),
  );
  const auth: Authorizer = { can: (actor: string, resource: string) => grants.get(actor)?.has(resource) ?? false };
  const kernel = new Kernel(asSpaceId(opts.space ?? 'SP-boot'), port, auth);
  // 装配期判据的负例要能塞**坏清单**：`plugin` 覆盖默认探针插件（不动默认路径）。
  kernel.registry.register(opts.plugin ?? BOOTSTRAP_PLUGIN);
  kernel.activate();

  const count = (sql: string, ...params: readonly unknown[]) => {
    let n = 0;
    port.read((raw) => { n = raw.get<{ c: number }>(sql, ...params)?.c ?? 0; });
    return n;
  };

  return {
    dir, file, port, kernel,
    uow: (principal, fn) => kernel.uow(principal, fn),
    count,
    close: () => { /* SqlitePort 随进程/文件释放；显式 API 见 PR-5 的 TransactionLease */ },
  };
}
