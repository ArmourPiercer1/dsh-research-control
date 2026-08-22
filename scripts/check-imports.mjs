#!/usr/bin/env node
/**
 * INV-PERM-5 static lint (ARCHITECTURE.md §2.2 rule 2 / §5.9, check layer "static check (lint rule)").
 *
 * Business code must not import DSH internal modules; only src/host/dsh-adapter/**
 * and src/client/dsh-adapter/** are exempt.
 *
 * WP-0.7 (G0 remediation, RR-001/RR-002 disposition): parser-level rewrite.
 * The line-based regex scan was escape-able via 8 measured forms (G0 round-1
 * inv-attacker, fixtures .g0-inv-attack-fixtures/, now codified under
 * tests/fixtures/attack/). This version parses every file with the TypeScript
 * Compiler API and inspects REAL module specifiers, so comments and string
 * mentions are immune by construction and the G0 attack forms are all caught:
 *
 *   1. @deepseek-ai/* scope — in import/export/import(…)/require(…) specifiers;
 *   2. any specifier containing a deepseek-harness path (escape into the
 *      harness checkout);
 *   3. symlinks — any file OR directory symlink inside the scanned tree is a
 *      violation (read-through protection; the walker never follows them);
 *   4. extension coverage: .ts/.tsx/.mts/.cts/.js/.jsx (non-TS extensions in
 *      src are themselves suspicious and now scanned);
 *   5. triple-slash references (/// <reference types/path=…>) in .d.ts (or any
 *      file) pointing at @deepseek-ai/* or deepseek-harness paths;
 *   6. dynamic import(`…`) — static template-literal specifiers are checked,
 *      and any LITERAL PART of a templated specifier is checked (so
 *      import(`@deepseek-ai/${x}`) is caught via its head);
 *   7. require(…) — literal `require('…')` calls, plus the statically
 *      decidable createRequire alias form: `const r = createRequire(…)`
 *      followed by `r('…')` (G0 attack C). Deeper aliasing (alias passed
 *      through functions/objects) is not statically decidable and is
 *      registered as residual (see docs/execution/reports/phase0/WP-0.7.md);
 *   8. package.json npm aliases — a dependency aliasing a DSH monorepo
 *      package (e.g. "cordis-alias": "npm:@deepseek-ai/cordis@4.0.1") is a
 *      violation; the in-source specifier is benign and only the manifest
 *      check catches it (G0 attack D). The package.json inspected is the
 *      one in the PARENT directory of the scanned tree (repo root by default).
 *
 * Usage:   node scripts/check-imports.mjs [srcDir]     (default: <repo>/src)
 * Output:  "<file>:<line>:<content>" per violation on stderr;
 * Exit:    1 on any violation, 0 otherwise.
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript-6';

const ROOT = join(fileURLToPath(new URL('..', import.meta.url)));
const SRC = process.argv[2] ? resolve(ROOT, process.argv[2]) : join(ROOT, 'src');
// The scanned tree's "repo root" is its parent directory (the plugin repo
// root for the default src scan); exemption paths are resolved against it so
// the lint behaves identically for out-of-tree scan roots (e.g. fixture dirs).
const SCAN_ROOT = dirname(SRC);

/** Exempt directories (POSIX-style, relative to the scanned tree's repo root). */
const ADAPTER_PREFIXES = ['src/host/dsh-adapter', 'src/client/dsh-adapter'];

/** Scan surface (WP-0.7): TS + JS extensions; .d.ts is covered by .ts. */
const SCANNED_EXTENSIONS = ['.ts', '.tsx', '.mts', '.cts', '.js', '.jsx'];

/** DSH internal package scope (deepseek-harness monorepo: all packages are @deepseek-ai/*). */
const DSH_SCOPED = /^@deepseek-ai\//;
/** Relative/absolute path escape into the harness checkout. */
const HARNESS_PATH = /deepseek-harness/;

function isViolation(spec) {
  return DSH_SCOPED.test(spec) || HARNESS_PATH.test(spec);
}

function relPath(abs) {
  return relative(ROOT, abs).split(sep).join('/');
}

/** Walk without following symlinks; symlinks are collected as violations. */
function walk(dir, files = [], symlinks = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, entry.name);
    if (entry.isSymbolicLink()) {
      // Read-through protection: a symlinked file or directory inside src can
      // smuggle in harness sources that would never pass review as real files.
      symlinks.push(p);
      continue;
    }
    if (entry.isDirectory()) walk(p, files, symlinks);
    else if (SCANNED_EXTENSIONS.some((ext) => p.endsWith(ext))) files.push(p);
  }
  return { files, symlinks };
}

/** ScriptKind for the parser, by extension. */
function scriptKindFor(file) {
  if (file.endsWith('.tsx')) return ts.ScriptKind.TSX;
  if (file.endsWith('.jsx')) return ts.ScriptKind.JSX;
  if (file.endsWith('.js')) return ts.ScriptKind.JS;
  return ts.ScriptKind.TS; // .ts / .mts / .cts / .d.ts
}

/**
 * Statically decidable require aliases (G0 attack C):
 * `const r = createRequire(…)` — the bound identifier later used as a call
 * with a literal specifier `r('…')` is a require call in disguise.
 */
function collectRequireAliases(sf) {
  const aliases = new Set();
  const visit = (node) => {
    if (
      ts.isVariableDeclaration(node) &&
      node.initializer &&
      ts.isCallExpression(node.initializer)
    ) {
      const callee = node.initializer.expression;
      if (ts.isIdentifier(callee) && callee.text === 'createRequire' && node.name && ts.isIdentifier(node.name)) {
        aliases.add(node.name.text);
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return aliases;
}

/**
 * All static module specifiers of a parsed source file that violate
 * INV-PERM-5, with 1-based line numbers.
 * Covers: import declarations (incl. multi-line), export … from,
 * import = require(…), import('…') (string + no-substitution template),
 * require('…') and its statically-aliased createRequire form.
 * Template literals WITH substitutions contribute their literal parts
 * (a head of '@deepseek-ai/' alone is already conclusive).
 * Non-literal specifiers (import(variable), fully-templated benign heads)
 * are not statically decidable → registered residual, not reported here.
 */
function specifiersOf(sf, requireAliases) {
  const found = [];
  const push = (node, spec) => {
    const { line } = sf.getLineAndCharacterOfPosition(node.getStart(sf));
    found.push({ line: line + 1, spec });
  };

  const checkSpec = (node, spec) => {
    if (spec == null) return;
    if (isViolation(spec)) push(node, spec);
  };

  const visit = (node) => {
    if (ts.isImportDeclaration(node)) {
      checkSpec(node.moduleSpecifier, node.moduleSpecifier.text);
    } else if (ts.isExportDeclaration(node) && node.moduleSpecifier) {
      checkSpec(node.moduleSpecifier, node.moduleSpecifier.text);
    } else if (ts.isImportEqualsDeclaration(node) && ts.isExternalModuleReference(node.moduleReference)) {
      checkSpec(node.moduleReference, node.moduleReference.expression.text);
    } else if (ts.isCallExpression(node)) {
      const arg0 = node.arguments[0];
      const callee = node.expression;
      const isImportKeyword =
        callee.kind === ts.SyntaxKind.ImportKeyword ||
        (ts.isIdentifier(callee) &&
          callee.escapedText === 'import' &&
          callee.originalKeywordKind === ts.SyntaxKind.ImportKeyword);
      if (isImportKeyword) {
        if (arg0 && (ts.isStringLiteral(arg0) || ts.isNoSubstitutionTemplateLiteral(arg0))) {
          checkSpec(arg0, arg0.text);
        } else if (arg0 && ts.isTemplateExpression(arg0)) {
          // Check every literal part: the head alone can carry the scope marker.
          const parts = [arg0.head.text, ...arg0.templateSpans.map((s) => s.literal.text)];
          for (const part of parts) if (isViolation(part)) push(arg0, part);
        }
      } else if (
        ts.isIdentifier(callee) &&
        (callee.text === 'require' || requireAliases.has(callee.text)) &&
        arg0 &&
        (ts.isStringLiteral(arg0) || ts.isNoSubstitutionTemplateLiteral(arg0))
      ) {
        checkSpec(arg0, arg0.text);
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return found;
}

const violations = [];

const { files, symlinks } = walk(SRC);

for (const file of files.sort()) {
  const rel = relPath(file);
  const relToScanRoot = relative(SCAN_ROOT, file).split(sep).join('/');
  const exempt = ADAPTER_PREFIXES.some((p) => relToScanRoot.startsWith(`${p}/`));

  const text = readFileSync(file, 'utf8');
  const sf = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, scriptKindFor(file));
  const lines = text.split(/\r?\n/);
  const lineContent = (line1Based) => (lines[line1Based - 1] ?? '').trimEnd();

  if (!exempt) {
    for (const { line } of specifiersOf(sf, collectRequireAliases(sf))) {
      violations.push(`${rel}:${line}:${lineContent(line)}`);
    }
    // Triple-slash references (/// <reference types="@deepseek-ai/…" />).
    // TS 6 exposes types=/lib= directives as typeReferenceDirectives /
    // libReferenceDirectives (pos/fileName); path= refs stay referencedFiles.
    const refs = [
      ...(sf.typeReferenceDirectives ?? []),
      ...(sf.libReferenceDirectives ?? []),
      ...(sf.referencedFiles ?? []),
      ...(Array.isArray(sf.referencedLibraries) ? sf.referencedLibraries : []),
    ];
    for (const ref of refs) {
      if (!isViolation(ref.fileName)) continue;
      const line1Based =
        ref.lineNumber != null
          ? ref.lineNumber + 1
          : sf.getLineAndCharacterOfPosition(ref.pos).line + 1;
      violations.push(`${rel}:${line1Based}:${lineContent(line1Based)}`);
    }
  }
}

// Symlinks (file or directory) anywhere inside the scanned tree: report at
// line 1, never follow. Even symlinks inside exempt directories are
// violations — the exemption covers imports, not filesystem indirection.
for (const link of symlinks.sort()) {
  violations.push(
    `${relPath(link)}:1:symlink — ${link.split(sep).pop()} is a symbolic link (INV-PERM-5 forbids symlinks inside src; read-through protection)`,
  );
}

// Package-manifest alias check (G0 attack D): the parent directory of the
// scanned tree is the repo root by default; an npm-alias dependency pointing
// at the @deepseek-ai/* scope smuggles DSH monorepo packages in under a
// benign name. Direct "@deepseek-ai/…" entries are OUT of scope here (some
// are legitimate published packages, e.g. @deepseek-ai/schemastery).
const pkgPath = join(dirname(SRC), 'package.json');
if (existsSync(pkgPath)) {
  const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'));
  const ALIAS_RE = /^npm:@deepseek-ai\//;
  for (const section of ['dependencies', 'devDependencies', 'peerDependencies', 'optionalDependencies']) {
    const deps = pkg[section];
    if (!deps) continue;
    for (const [name, version] of Object.entries(deps)) {
      if (typeof version === 'string' && ALIAS_RE.test(version)) {
        violations.push(
          `${relPath(pkgPath)}:1:${section}.${name} = ${JSON.stringify(version)} — npm alias of a @deepseek-ai/* DSH monorepo package (INV-PERM-5)`,
        );
      }
    }
  }
}

if (violations.length > 0) {
  console.error(`INV-PERM-5 violation(s) found: ${violations.length}`);
  for (const v of violations) console.error(v);
  process.exit(1);
}
console.log(`check-imports: OK — no INV-PERM-5 violations in ${relative(ROOT, SRC) || '.'}`);
