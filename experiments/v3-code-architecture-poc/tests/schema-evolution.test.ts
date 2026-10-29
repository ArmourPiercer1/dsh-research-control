/**
 * 模式演进的**数据层**缺口（演化席位提出，作者独立复现）。
 *
 * F-15 只堵住了"表缺失"：`meta.schema_version` + 表集 + 触发器集校验。
 * 但还有一类无法靠表集发现的情形——**模式是新的，历史是旧的**：
 * 在 `records` 表出现之前合法声明过的记录，只存在于 `ledger.record_id` 里。
 * 这类库打开时校验全过，之后：
 *   - `readRecord(旧记录)` 静默返回 undefined；
 *   - 指向它的必需 `record-ref` 被判 REQUIRED_REF_MISSING ⇒ 该对象永远写不进去。
 * 静默错答比报错严重，所以这里先复现，再要求"打开时检出 + 显式迁移器修复"。
 */
import { describe, expect, test } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { POC_DATA_DIR } from '../src/harness/paths.ts';
import { openWorld, PRINCIPAL } from '../src/harness/world.ts';
import { migrateLegacyRecords } from '../src/storage-sqlite/sqlite-port.ts';

const ALICE = PRINCIPAL('evo-tester');
const GRANTS = { 'evo-tester': ['space-write'] };

/** 造一个"模式为当前、历史为旧"的库：先正常建库，再抹掉 records 里的旧声明。 */
function legacyDb(name: string): string {
  const dir = mkdtempSync(join(POC_DATA_DIR, `evo-${name}-`));
  const file = join(dir, 'space.db');
  const w = openWorld({ file, space: 'SP-EVO', grants: GRANTS });
  const oid = w.uow(ALICE, (tx) => {
    const o = tx.createObject({ kind: 'test.claim', payload: { label: '旧材料' } });
    tx.declareRecord({ recordId: 'REC-OLD', eventType: 'synth:raw-source', payload: { text: 'records 表之前声明的原文' } });
    tx.linkRef({ from: { kind: 'revision-ref', oid: o, revision: 1 }, to: { kind: 'record-ref', recordId: 'REC-OLD' }, role: 'based-on', required: true });
    return o;
  });
  w.close();
  // 模拟"那条记录是在 records 表出现之前声明的"：删除 records 行，保留 ledger 痕迹
  // 造"历史早于 records 表"的形态：**不需要删任何东西**（S-0 之后 records 已被触发器钉死，
  // 删不掉正是封口的证据）。旧库的特征本来就只有"ledger 里有 record_id 而 records 里没有行"，
  // 所以直接补一条那样的 ledger 行即可，形态与真实旧库一致。
  const raw = new DatabaseSync(file);
  const seq = (raw.prepare(`select value from meta where key='ledger_seq'`).get() as { value: number }).value + 1;
  raw.prepare(`update meta set value = ? where key='ledger_seq'`).run(seq);
  raw.prepare(
    `insert into ledger(seq, space, event_type, actor, record_id, payload_json, described_at, recorded_at)
     values(?,?,?,?,?,?,?,?)`,
  ).run(seq, 'SP-EVO', 'synth:raw-source', 'legacy-importer', 'REC-ANCIENT',
    JSON.stringify({ text: 'records 表之前声明的原文' }), null, Date.now());
  raw.close();
  return file;
}

describe('模式新 / 历史旧的库', () => {
  test('打开必须检出"历史里有 records 之前的记录声明"，而不是静默通过', () => {
    const file = legacyDb('detect');
    const dir = file.slice(0, file.lastIndexOf('/'));
    try {
      expect(() => openWorld({ file, space: 'SP-EVO', grants: GRANTS })).toThrow(/SCHEMA_UPGRADE_REQUIRED/);
      rmSync(dir, { recursive: true, force: true });
    } catch { rmSync(dir, { recursive: true, force: true }); }
  });

  test('显式迁移器把首次声明回填进 records，之后打开通过且旧引用恢复', () => {
    const file = legacyDb('migrate');
    const dir = file.slice(0, file.lastIndexOf('/'));
    try {
      // S-0 之后 `records` 被触发器钉死，"已声明再删掉"这条伪造路径在机制内不可走
      // （删不掉本身就是封口的证据）。旧库的真实特征只有一个：ledger 里有 record_id
      // 而 records 里没有对应行——夹具直接补这样一条行，形态与真实旧库一致。
      const n = migrateLegacyRecords(file);
      expect(n).toBe(1);
      const w = openWorld({ file, space: 'SP-EVO', grants: GRANTS });
      try {
        const rec = w.readRecord('REC-ANCIENT');
        expect(rec?.payload).toMatchObject({ text: 'records 表之前声明的原文' });
        // 反差：本就在 records 里的声明不受迁移影响，内容原样
        expect(w.readRecord('REC-OLD')?.payload).toMatchObject({ text: 'records 表之前声明的原文' });
      } finally { w.close(); }
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  test('反差：新建库不需要迁移（迁移器返回 0，打开照旧通过）', () => {
    const dir = mkdtempSync(join(POC_DATA_DIR, 'evo-contrast-'));
    const file = join(dir, 'space.db');
    try {
      const w = openWorld({ file, space: 'SP-EVO', grants: GRANTS });
      w.uow(ALICE, (tx) => tx.declareRecord({ recordId: 'REC-NEW', eventType: 'synth:raw-source', payload: { text: '新库声明' } }));
      w.close();
      expect(migrateLegacyRecords(file)).toBe(0);
      const again = openWorld({ file, space: 'SP-EVO', grants: GRANTS });
      try { expect(again.readRecord('REC-NEW')).toBeDefined(); } finally { again.close(); }
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
});
