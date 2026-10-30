/**
 * **合成 Facet 插件（测试专用）**：一个独立拥有扩展记录的能力，用来验 #44 §6.2（Q45）
 * 的三件事：能独立写读版本化、卸载后基础对象无恙、越权写别人命名空间必被拒。
 */
import type { PluginManifest } from '../contracts/index.ts';
import type { NamespaceWriter, PluginFace, UnitOfWork } from '../kernel/kernel.ts';
import { Refusal, type ObjectOid } from '../contracts/index.ts';

export const CAP_FACET = 'cap.test.instrument-facet';

export const TEST_FACET_CALIB: PluginManifest = {
  pluginId: 'test.instrument-facet',
  codeVersion: '0.0.1',
  provides: [{ capability: CAP_FACET, contractVersion: 'v1' }],
  requires: [],
  storageNamespace: 'dom_test_facet',
  eventAuthority: 'none',
};

export class FacetStore {
  // N3（D-17/P2-2/D-22 同一条教训第四次收口）：构造参数一律 `#` 私有字段——`private readonly`
  // 参数属性在运行时就是自有可枚举属性，face 顺名字可达（双门禁：tests/n3-parameter-property-gate.test.ts）。
  // 只接窄面：领域插件持有 Kernel 本身就是越界（门禁会红），所以这里连类型都不出现。
  readonly #face: PluginFace;
  constructor(face: PluginFace) { this.#face = face; }

  private writer(tx: UnitOfWork): NamespaceWriter { return this.#face.writerFor(tx); }

  write(tx: UnitOfWork, oid: ObjectOid, payload: unknown): void {
    const w = this.writer(tx);
    const next = (w.readLatest(oid)?.revision ?? 0) + 1;
    w.write({ ns: w.ns, oid, revision: next, payload, eventType: 'extension-registered' });
  }

  /** 越权尝试：拿着核心对象的命名空间来写（XC-28 的攻击面）。 */
  writeIntoForeignNamespace(tx: UnitOfWork, oid: ObjectOid): void {
    this.writer(tx).write({ ns: 'dom_test_om', oid, revision: 99, payload: { operating_context: '伪造' }, eventType: 'extension-registered' });
  }

  read(oid: ObjectOid): { version: number; payload: Record<string, unknown> } {
    const snap = this.#face.readOwn(oid);
    if (!snap) throw new Refusal('CAPABILITY_INACTIVE', { capability: this.#face.capability, oid });
    return { version: snap.revision, payload: snap.payload };
  }
}
