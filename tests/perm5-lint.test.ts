// WP-0.1: INV-PERM-5 lint tests (scaffold stage only, no business logic).
// - Negative: fixture tests/fixtures/perm5-violation.ts carries one violating
//   import; check-imports must exit non-zero and report the file:line.
// - Positive: the real src/ tree must exit zero.
//
// WP-0.7 (G0 remediation, RR-001/RR-002): check-imports.mjs is now a
// parser-level check (TypeScript Compiler API). All 8 escape forms measured
// by the G0 round-1 inv-attacker (original fixtures at
// WR/.g0-inv-attack-fixtures/, not in git) are codified as negative fixtures
// under tests/fixtures/attack/ and each one is asserted to be caught.
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

describe('INV-PERM-5 lint — G0 attack forms (WP-0.7, RR-001/RR-002 remediation)', () => {
  // One lint run over the codified G0 attack tree; every form is asserted
  // individually so a regression re-exposes exactly the escaped form.
  const r = runLint('tests/fixtures/attack/src');

  it('exits non-zero on the attack tree', () => {
    expect(r.error).toBeUndefined();
    expect(r.status).toBe(1);
  });

  it('A: multi-line import (from-clause on its own line) is caught', () => {
    expect(r.stderr).toContain('a-multiline.ts:4');
  });

  it('B: template-literal dynamic import is caught', () => {
    expect(r.stderr).toContain('b-template-dynamic.ts:2');
  });

  it('C: createRequire alias call r("@deepseek-ai/…") is caught (static alias form)', () => {
    expect(r.stderr).toContain('c-aliased-caller.ts:4');
  });

  it('D: npm dependency aliasing a DSH package is caught via the package.json check', () => {
    // The in-source specifier 'cordis-alias' is benign — the violation must
    // come from the manifest, not from the source file.
    expect(r.stderr).toContain('tests/fixtures/attack/package.json');
    expect(r.stderr).toContain('cordis-alias');
    expect(r.stderr).toContain('npm:@deepseek-ai');
    expect(r.stderr).not.toContain('d-pkg-alias.ts');
  });

  it('E: .mts extension is scanned and caught', () => {
    expect(r.stderr).toContain('evil.mts:2');
  });

  it('F: .js file inside src is scanned and caught', () => {
    expect(r.stderr).toContain('g-js-file.js:2');
  });

  it('G: triple-slash /// <reference types="…"> is caught', () => {
    expect(r.stderr).toContain('h-reference.d.ts:1');
  });

  it('H: file symlink inside src is caught (read-through protection, never followed)', () => {
    expect(r.stderr).toContain('sneaky-file.ts:1');
    expect(r.stderr).toMatch(/sneaky-file\.ts:1:symlink/);
  });

  it('I: directory symlink inside src is caught (walker does not descend)', () => {
    expect(r.stderr).toContain('sneakydir:1');
    expect(r.stderr).toMatch(/sneakydir:1:symlink/);
  });

  it('control: plain single-line DSH import is still caught', () => {
    expect(r.stderr).toContain('control-positive.ts:2');
  });

  it('i-symlink-consumer.ts itself is clean — the symlinks are the violation, not the import', () => {
    expect(r.stderr).not.toContain('i-symlink-consumer.ts');
  });
});
