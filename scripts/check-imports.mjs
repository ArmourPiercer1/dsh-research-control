#!/usr/bin/env node
/**
 * INV-PERM-5 static lint (ARCHITECTURE.md §2.2 rule 2 / §5.9, check layer "static check (lint rule)"):
 *   Business code must not import DSH internal modules;
 *   only src/host/dsh-adapter/** and src/client/dsh-adapter/** are exempt.
 *
 * Violation specifiers:
 *   - "@deepseek-ai/*" scope (all packages of the deepseek-harness monorepo);
 *   - any specifier containing a deepseek-harness path (relative/absolute escape
 *     from the plugin tree into the harness checkout).
 *
 * Usage:   node scripts/check-imports.mjs [srcDir]     (default: <repo>/src)
 * Output:  "<file>:<line>:<content>" per violation on stderr;
 * Exit:    1 on any violation, 0 otherwise.
 *
 * Note: line-based scan; matches `import ... from 'x'`, `import 'x'`,
 * `export ... from 'x'`, `import('x')` and `require('x')`. A multi-line import
 * statement is detected only when its `from` clause sits on one line.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(fileURLToPath(new URL('..', import.meta.url)));
const SRC = process.argv[2] ? join(ROOT, process.argv[2]) : join(ROOT, 'src');

/** Exempt directories (POSIX-style, relative to the scanned tree's repo root). */
const ADAPTER_PREFIXES = ['src/host/dsh-adapter', 'src/client/dsh-adapter'];

/** DSH internal package scope (deepseek-harness monorepo: all packages are @deepseek-ai/*). */
const DSH_SCOPED = /^@deepseek-ai\//;
/** Relative/absolute path escape into the harness checkout. */
const HARNESS_PATH = /deepseek-harness/;

/**
 * Groups: 1/2 = `import ... from 'x'`; 3/4 = `import 'x'`;
 *         5/6 = `export ... from 'x'`; 7/8 = `import('x')` / `require('x')`.
 */
const SPEC_RE =
  /\bimport\s+[^'";]*?\bfrom\s*(['"])([^'"]+)\1|\bimport\s*(['"])([^'"]+)\3|\bexport\s+[^'";]*?\bfrom\s*(['"])([^'"]+)\5|\b(?:import|require)\s*\(\s*(['"])([^'"]+)\6\s*\)/g;

function specifiersOf(line) {
  const out = [];
  for (const m of line.matchAll(SPEC_RE)) {
    const spec = m[2] ?? m[4] ?? m[6] ?? m[8];
    if (spec) out.push(spec);
  }
  return out;
}

function isViolation(spec) {
  return DSH_SCOPED.test(spec) || HARNESS_PATH.test(spec);
}

function walk(dir, files = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, entry.name);
    if (entry.isDirectory()) walk(p, files);
    else if (/\.(ts|tsx)$/.test(entry.name)) files.push(p);
  }
  return files;
}

const violations = [];
for (const file of walk(SRC).sort()) {
  const rel = relative(ROOT, file).split(sep).join('/');
  if (ADAPTER_PREFIXES.some((p) => rel.startsWith(`${p}/`))) continue;
  const lines = readFileSync(file, 'utf8').split(/\r?\n/);
  lines.forEach((line, i) => {
    for (const spec of specifiersOf(line)) {
      if (isViolation(spec)) violations.push(`${rel}:${i + 1}:${line.trimEnd()}`);
    }
  });
}

if (violations.length > 0) {
  console.error(`INV-PERM-5 violation(s) found: ${violations.length}`);
  for (const v of violations) console.error(v);
  process.exit(1);
}
console.log(`check-imports: OK — no INV-PERM-5 violations in ${relative(ROOT, SRC) || '.'}`);
