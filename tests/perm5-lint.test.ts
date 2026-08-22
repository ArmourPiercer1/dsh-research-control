// WP-0.1: INV-PERM-5 lint tests (scaffold stage only, no business logic).
// - Negative: fixture tests/fixtures/perm5-violation.ts carries one violating
//   import; check-imports must exit non-zero and report the file:line.
// - Positive: the real src/ tree must exit zero.
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = join(fileURLToPath(new URL('..', import.meta.url)));
const LINT = join(ROOT, 'scripts', 'check-imports.mjs');

function runLint(...args: string[]) {
  return spawnSync(process.execPath, [LINT, ...args], { encoding: 'utf8' });
}

describe('INV-PERM-5 lint (scripts/check-imports.mjs)', () => {
  it('exits non-zero and reports file:line on the violation fixture', () => {
    const r = runLint('tests/fixtures');
    expect(r.status).toBe(1);
    expect(r.stderr).toContain('tests/fixtures/perm5-violation.ts:2');
  });

  it('exits zero on the real src/ tree', () => {
    const r = runLint();
    expect(r.error).toBeUndefined();
    expect(r.status).toBe(0);
    expect(r.stdout).toContain('no INV-PERM-5 violations');
  });
});
