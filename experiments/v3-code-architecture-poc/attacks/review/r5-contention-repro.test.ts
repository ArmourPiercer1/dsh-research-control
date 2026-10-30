import { describe, expect, test } from 'vitest';
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { dirname, join as pathJoin } from 'node:path';
import { fileURLToPath } from 'node:url';
import { POC_DATA_DIR } from '../../src/harness/paths.ts';
import { openWorld, PRINCIPAL } from '../../src/harness/world.ts';

const HERE = dirname(fileURLToPath(import.meta.url));
const HOLD = pathJoin(HERE, '../../../../experiments/v3-code-architecture-poc/tests/helpers/hold-write-lock.mjs');
const ALICE = PRINCIPAL('r5-contention');

describe('R5 independent contention reproduction', () => {
  test('parent starts only after locked event and observes TX_CONTENTION while child holds 2500ms', async () => {
    const dir = mkdtempSync(join(POC_DATA_DIR, 'r5-contention-'));
    const file = join(dir, 'space.db');
    const w = openWorld({ file, space: 'R5-CONTENTION', grants: { 'r5-contention': ['space-write'] } });
    const child = spawn(process.execPath, [HOLD, file, '8000'], { stdio: ['ignore', 'pipe', 'pipe'] });
    let out = ''; let err = '';
    try {
      await new Promise<void>((resolve, reject) => {
        child.stdout.on('data', (b) => { out += String(b); if (out.includes('locked')) resolve(); });
        child.stderr.on('data', (b) => { err += String(b); });
        setTimeout(() => reject(new Error(`lock event timeout: ${err}`)), 5000).unref();
      });
      let thrown: unknown;
      try { w.uow(ALICE, (tx) => tx.createObject({ kind: 'test.claim', payload: { during: true } })); }
      catch (e) { thrown = e; }
      expect((thrown as { code?: string })?.code).toBe('TX_CONTENTION');
      await new Promise<void>((resolve) => child.on('close', () => resolve()));
      expect(out).toContain('child-committed');
    } finally {
      if (!child.killed) child.kill('SIGKILL');
      w.close(); rmSync(dir, { recursive: true, force: true });
    }
  }, 15_000);
});
