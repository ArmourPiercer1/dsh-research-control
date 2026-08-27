#!/usr/bin/env node
/**
 * WP-8.4 — pack verification (release-gate smoke):
 *
 *  1. `pnpm run build` then `pnpm pack` in the plugin root (the build
 *     refreshes `lib/` + the SI-001 snapshot, so the tarball is always the
 *     CURRENT surface — `lib/` is committed prebuilt, so the pack reflects
 *     whatever was last built);
 *  2. **surface check** — the tarball entry list must carry the complete
 *     `files` surface (all `lib/` artifacts, the `schema/` snapshot, the
 *     8 root docs, `SNAPSHOT.md`, `cordis.patch.yml`, `package.json`,
 *     `README.md`, `src/`) and must NOT leak dev-private paths
 *     (`node_modules/`, `tests/`, `e2e/`, `scripts/`, `test-results/`,
 *     `.pnpm-store/`, tarballs, editor/VCS residue);
 *  3. **unpack smoke** — extract to a temp dir, build a DEDICATED
 *     `node_modules` inside the temp tree (one symlink per top-level
 *     entry of the repo `node_modules` + the package self-link — the
 *     unpacked tree has no install of its own), then `node`-import the
 *     BUILT main entry from the extracted bytes: `.` (default-export
 *     service class) + `./typert` (TYPERT manifest, 23 invocations = 22 RPC (13 frozen V1 + 9 plane) + ping) +
 *     `./remote` (client contribution). `./client` is a browser CJS
 *     bundle (the `window.__ModuleLoader__` banner runs at require
 *     time) — asserted BY NAME in the list check only, never imported
 *     under node. The dedicated temp dir is what makes the gate
 *     REPEATABLE: the old single-symlink approach wrote the self-link
 *     THROUGH the `node_modules` symlink into the repo tree, leaving a
 *     dangling residue that made every re-run fail with EEXIST (G8 R3).
 *
 * Exits non-zero on the first violated expectation; prints the full
 * verdict table. No dependencies (node:child_process / fs / os / path /
 * crypto). The temp dir is removed on success; kept (path printed) on
 * failure for inspection.
 */

import { execFileSync, spawnSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, readdirSync, rmSync, symlinkSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const PLUGIN_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const PKG_NAME = 'dsh-research-control'

const fail = (message) => {
  console.error(`[pack-verify] FATAL: ${message}`)
  process.exit(1)
}
const log = (message) => console.log(`[pack-verify] ${message}`)

/* ------------------------------------------------------------------ *
 * 1. Pack
 * ------------------------------------------------------------------ */

log('running pnpm run build (refresh lib/ + snapshot), then pnpm pack')
const preBuild = spawnSync('pnpm', ['run', 'build'], { cwd: PLUGIN_ROOT, encoding: 'utf8' })
if (preBuild.status !== 0) fail(`pnpm run build failed:\n${preBuild.stdout}\n${preBuild.stderr}`)
const pack = spawnSync('pnpm', ['pack'], { cwd: PLUGIN_ROOT, encoding: 'utf8' })
if (pack.status !== 0) fail(`pnpm pack failed:\n${pack.stdout}\n${pack.stderr}`)

const tgzName = readdirSync(PLUGIN_ROOT).find((name) => new RegExp(`^${PKG_NAME}-.*\\.tgz$`).test(name))
if (!tgzName) fail('no tarball produced')
const tgzPath = join(PLUGIN_ROOT, tgzName)
log(`tarball: ${tgzName}`)

/* ------------------------------------------------------------------ *
 * 2. Surface check
 * ------------------------------------------------------------------ */

const entries = execFileSync('tar', ['tzf', tgzPath], { encoding: 'utf8' })
  .split('\n')
  .filter(Boolean)
  .map((line) => line.replace(/^package\//, ''))

const violations = []
const check = (condition, verdict) => {
  if (!condition) violations.push(verdict)
  return condition
}

// -- required: the complete published surface
const required = [
  'package.json',
  'README.md',
  'cordis.patch.yml',
  'SNAPSHOT.md',
  'lib/index.js',
  'lib/index.d.ts',
  'lib/typert.host.js',
  'lib/typert.host.d.ts',
  'lib/typert.remote-client.js',
  'lib/typert.remote-client.d.ts',
  'lib/client.js',
  'lib/client.js.map',
  // SI-001 snapshot: the frozen schema root (anchor + the three loaded sub-dirs)
  'schema/common.schema.json',
  'schema/README.md',
  'schema/declarative/project.schema.json',
  'schema/declarative/agent-plan-fork-policy.schema.json',
  'schema/history/history-events.schema.json',
  'schema/operational/run.schema.json',
  // the 8 root docs (§2.1 frozen target layout)
  'ARCHITECTURE.md',
  'DOMAIN_SCHEMA.md',
  'DSH_ADAPTER.md',
  'GIT_INTEGRATION.md',
  'HISTORY_EVENT_CATALOG.md',
  'PLAN_FORK_SPEC.md',
  'SUBAGENT_ROUTING.md',
  'TEST_MATRIX.md',
  // `./src/*` export surface (source ships with the tarball, as today)
  'src/host/index.ts',
  'src/client/index.tsx',
]
for (const name of required) {
  check(entries.includes(name), `missing required entry: package/${name}`)
}

// -- required: every rpc-contracts hash twin (js AND d.ts, any hash)
const rpcJs = entries.filter((e) => /^lib\/rpc-contracts-.*\.js$/.test(e))
const rpcDts = entries.filter((e) => /^lib\/rpc-contracts-.*\.d\.ts$/.test(e))
check(rpcJs.length >= 1, 'missing lib/rpc-contracts-*.js')
check(rpcDts.length >= 1, 'missing lib/rpc-contracts-*.d.ts')
check(
  rpcJs.some((js) => rpcDts.includes(js.replace(/\.js$/, '.d.ts'))) || rpcJs.length === rpcDts.length,
  'rpc-contracts js/d.ts hash twins look unmatched',
)

// -- required: the schema snapshot is COMPLETE (all 23 frozen files,
//    counted against the workspace-root source when available)
const schemaEntryCount = entries.filter((e) => e.startsWith('schema/')).length
check(schemaEntryCount >= 23, `schema/ snapshot incomplete: ${schemaEntryCount} < 23 entries`)

// -- forbidden: dev-private leakage
const forbiddenPatterns = [
  /^node_modules\//,
  /^tests\//,
  /^e2e\//,
  /^scripts\//,
  /^test-results\//,
  /^playwright-report\//,
  /^\.pnpm-store\//,
  /^\.npm-cache-tmp\//,
  /^\.git(\/|$)/,
  /\.tgz$/,
  /\.tsbuildinfo$/,
  /^tsconfig\.json$/,
  /^tsdown\.config\.ts$/,
  /^vitest\.config\.ts$/,
  /^pnpm-workspace\.yaml$/,
  /^\.gitignore$/,
  /^e2e__screenshots/,
]
for (const entry of entries) {
  for (const pattern of forbiddenPatterns) {
    if (pattern.test(entry)) {
      violations.push(`forbidden entry leaked into the tarball: package/${entry}`)
      break
    }
  }
}

log(`surface: ${entries.length} entries (${required.length + schemaEntryCount + rpcJs.length + rpcDts.length + 0} required-side checks passed so far)`)

/* ------------------------------------------------------------------ *
 * 3. Unpack smoke (extracted bytes + dedicated temp node_modules)
 * ------------------------------------------------------------------ */

const workDir = mkdtempSync(join(tmpdir(), 'dsh-rc-pack-verify-'))
let unpacked = false
try {
  execFileSync('tar', ['xzf', tgzPath, '-C', workDir], { stdio: 'pipe' })
  const pkgDir = join(workDir, 'package')
  if (!existsSync(join(pkgDir, 'package.json'))) fail('extracted tree has no package/')
  // Dependency resolution: the unpacked tree has no install of its own.
  // Build a DEDICATED node_modules inside the temp tree instead of
  // symlinking the repo node_modules wholesale: one symlink per
  // top-level entry (absolute targets — every loaded module's OWN
  // transitive resolution runs against its REAL path, which lives in
  // the repo, so the mirror only needs the top level) + the package
  // self-link. Nothing is ever written into the repo node_modules: the
  // old single-symlink approach wrote the self-link THROUGH the link
  // into the repo tree, the temp-tree cleanup never reclaimed it, and
  // every re-run failed with EEXIST (G8 R3 — the gate had zero
  // repeatability). The dedicated dir is reclaimed with workDir below,
  // so the gate is repeatable by construction.
  const nmDir = join(workDir, 'node_modules')
  mkdirSync(nmDir, { recursive: true })
  for (const entry of readdirSync(join(PLUGIN_ROOT, 'node_modules'))) {
    if (entry === PKG_NAME) continue // a stale self-link (legacy residue) is replaced, never followed
    symlinkSync(join(PLUGIN_ROOT, 'node_modules', entry), join(nmDir, entry))
  }
  rmSync(join(nmDir, PKG_NAME), { force: true }) // belt & braces: the self-link never EEXISTs
  symlinkSync(pkgDir, join(nmDir, PKG_NAME))
  unpacked = true

  const smoke = spawnSync(
    process.execPath,
    [
      '--input-type=module',
      '-e',
      [
        'const pkg = await import(process.argv[1])',
        'if (typeof pkg.default !== "function") throw new Error("main entry: default export is not a service class (got " + typeof pkg.default + ")")',
        'console.log("main entry: default export class " + pkg.default.name + " (typeof " + typeof pkg.default + ")")',
        'const typert = await import(process.argv[1] + "/typert")',
        'const T = typert.TYPERT ?? typert.default?.TYPERT',
        'if (!T || !Array.isArray(T.invocations)) throw new Error("./typert: no TYPERT.invocations manifest")',
        'if (T.invocations.length !== 23) throw new Error("./typert: expected 23 invocations (22 RPC: 13 frozen V1 + 9 plane, + ping), got " + T.invocations.length)',
        'console.log("./typert: " + T.invocations.length + " invocations, package=" + T.package + ", face=" + T.face)',
        'const remote = await import(process.argv[1] + "/remote")',
        'const C = remote.default',
        'if (!C || typeof C.package !== "string" || !Array.isArray(C.descriptors)) throw new Error("./remote: contribution is not {package, descriptors}")',
        'console.log("./remote: contribution " + C.package + " with " + C.descriptors.length + " descriptors")',
        'console.log("SMOKE OK: main entry class + ./typert + ./remote imported cleanly from the extracted tarball bytes")',
      ].join('\n'),
      PKG_NAME,
    ],
    { cwd: workDir, encoding: 'utf8' },
  )
  const smokeOut = `${smoke.stdout ?? ''}${smoke.stderr ?? ''}`
  if (smoke.status !== 0) fail(`node import smoke failed:\n${smokeOut}`)
  log(smokeOut.trim())
} finally {
  if (unpacked || violations.length === 0) {
    rmSync(workDir, { recursive: true, force: true })
  } else {
    log(`FAILURE — temp tree kept for inspection: ${workDir}`)
  }
}

/* ------------------------------------------------------------------ *
 * Verdict
 * ------------------------------------------------------------------ */

if (violations.length > 0) {
  for (const v of violations) console.error(`[pack-verify] VIOLATION: ${v}`)
  fail(`${violations.length} surface violation(s) in ${tgzName}`)
}
log(`PASS: ${tgzName} — ${entries.length} entries, complete published surface, no dev leakage, unpacked main/typert/remote import cleanly under node`)
