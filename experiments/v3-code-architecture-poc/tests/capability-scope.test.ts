/**
 * D-19（外部复审，2026-10-30）：**能力作用域写权限**——领域数据只能经所属领域的权威接口修改（Q12）。
 *
 * 修前的形状：`UnitOfWork.revise()` 会去 `object_directory` 取 `owner_capability`，
 * 却**从不与调用方能力比对**；领域代码只要拿到一条通用事务，就能经
 * `createObject / revise / linkRef` 改任意领域的权威对象。
 *
 * 修法（复审者建议，作者采纳）：**通用事务面属装配根 / Application Use-case 层**
 * （跨领域原子提交要靠它，Q40）；**领域插件只能经自身 Capability-scoped 端口**
 * ——即 `NamespaceWriter.createOwned / reviseOwned / linkOwned`，归属不符即
 * `CAPABILITY_SCOPE_ESCAPE`。
 *
 * 本文件把两侧都钉住：装配根可跨（否则 Q40 破），领域端口不可跨（否则 Q12 破），
 * 且端口自身不得再把通用事务句柄泄露出去。
 */
import { describe, expect, test } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { POC_DATA_DIR } from '../src/harness/paths.ts';
import { openWorld, PRINCIPAL } from '../src/harness/world.ts';
import { TEST_OBJECT_MODEL, CAP_OBJECT_MODEL } from '../src/domains/test-object-model.ts';
import type { ObjectOid, PluginManifest } from '../src/contracts/index.ts';
import type { UnitOfWork } from '../src/kernel/kernel.ts';

const FOREIGN = 'cap.test.second';
const SECOND: PluginManifest = {
  pluginId: 'test.second-scope', codeVersion: '0.0.1',
  provides: [{ capability: FOREIGN, contractVersion: 'v1' }], requires: [],
  storageNamespace: 'dom_test_second_scope', eventAuthority: 'none',
  ownsKinds: [{ kind: 'test.artifact', capability: FOREIGN }],
};

function withWorld<R>(name: string, fn: (ctx: {
  w: ReturnType<typeof openWorld>; tx: UnitOfWork; own: ObjectOid; foreign: ObjectOid;
}) => R): R {
  const dir = mkdtempSync(join(POC_DATA_DIR, `scope-${name}-`));
  const w = openWorld({
    file: join(dir, 'space.db'), space: 'SP-SCOPE',
    grants: { admin: ['space-write', 'capability-admin'] },
    plugins: [TEST_OBJECT_MODEL, SECOND],
  });
  try {
    // own：本能力（对象模型）拥有；foreign：另一能力拥有
    const own = w.uow(PRINCIPAL('admin'), (tx) => tx.createObject({ kind: 'test.claim', payload: { v: 1 } }));
    const foreign = w.uow(PRINCIPAL('admin'), (tx) => tx.createObject({ kind: 'test.artifact', payload: { v: 1 } }));
    return w.uow(PRINCIPAL('admin'), (tx) => fn({ w, tx, own, foreign }));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

describe('D-19：领域写权威边界', () => {
  test('装配根 / 用例层可跨领域写（Q40 的跨插件原子提交不能被本修法制死）', () => {
    withWorld('assembly', ({ tx, foreign }) => {
      // 装配根事务缺省 scope='assembly'：这是 Application Use-case 的合法能力
      expect(tx.revise(foreign, { payload: { v: 2 }, expectedRevision: 1 })).toBe(2);
    });
  });

  test('领域端口改他能力拥有的对象 ⇒ CAPABILITY_SCOPE_ESCAPE，且目标修订未被改动', () => {
    withWorld('escape', ({ w, tx, foreign }) => {
      const writer = w.kernel.faceFor(CAP_OBJECT_MODEL).writerFor(tx);
      let code = '';
      try { writer.reviseOwned(foreign, { payload: { pwned: true }, expectedRevision: 1 }); }
      catch (e) { code = (e as { code?: string }).code ?? ''; }
      expect(code).toBe('CAPABILITY_SCOPE_ESCAPE');
      // 关键：拒绝必须发生在写入之前，不是"写了再报错"
      const cur = w.raw.all<{ payload_json: string }>(
        `select payload_json from domain_state where oid=? order by revision desc limit 1`, foreign);
      expect(cur[0]?.payload_json ?? '').not.toContain('pwned');
    });
  });

  test('领域端口创建他能力的 kind ⇒ 拒绝（归属由路由表决定，不由调用方挑）', () => {
    withWorld('create', ({ w, tx }) => {
      const writer = w.kernel.faceFor(CAP_OBJECT_MODEL).writerFor(tx);
      let code = '';
      try { writer.createOwned({ kind: 'test.artifact', payload: {} }); }
      catch (e) { code = (e as { code?: string }).code ?? ''; }
      expect(code).toBe('CAPABILITY_SCOPE_ESCAPE');
    });
  });

  test('正例：端口改自己拥有的对象照常成功（否则等于用拒绝把领域写权限一并废掉）', () => {
    withWorld('own', ({ w, tx, own }) => {
      const writer = w.kernel.faceFor(CAP_OBJECT_MODEL).writerFor(tx);
      expect(writer.reviseOwned(own, { payload: { v: 2 }, expectedRevision: 1 })).toBe(2);
      expect(writer.createOwned({ kind: 'test.claim', payload: { v: 1 } })).toContain('OBJ-SP-SCOPE-');
    });
  });

  test('端口不得把通用事务句柄泄露回插件（防止修复本身变成新逃逸面）', () => {
    withWorld('leak', ({ w, tx }) => {
      const writer = w.kernel.faceFor(CAP_OBJECT_MODEL).writerFor(tx) as unknown as object;
      const names = [...Object.getOwnPropertyNames(writer), ...Object.getOwnPropertySymbols(writer).map(String)];
      // WRITER_UOW 是模块级 WeakMap：writer→tx 的映射不在对象图上，这里必须看不到
      expect(names.filter((n) => /tx|raw|uow/i.test(n))).toEqual([]);
      const proto = Object.getOwnPropertyNames(Object.getPrototypeOf(writer));
      for (const m of ['write', 'readLatest', 'createOwned', 'reviseOwned', 'linkOwned']) {
        expect(proto, `方法 ${m} 应在原型上（契约声明的成员）`).toContain(m);
      }
    });
  });
});
