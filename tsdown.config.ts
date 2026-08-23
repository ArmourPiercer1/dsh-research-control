import { existsSync, readFileSync, statSync } from 'node:fs';
import { dirname, resolve as resolvePath } from 'node:path';
import ts from 'typescript-6';
import { defineConfig, type UserConfig } from 'tsdown';

/** Matches a TC39 standard decorator at line start (same heuristic as vitest.config.ts). */
const decoratorSyntax = /^\s*@[A-Za-z_$][\w$]*/m;

/**
 * Lower TC39 standard decorators before rolldown's oxc transform sees the
 * file. rolldown does not lower decorators for any `target` (verified: the
 * default esnext and node18 targets both emit `@Remote('ping')` verbatim, a
 * SyntaxError on the Node runtimes DSH supports). This mirrors the DSH host
 * repo's solution — its production build emits JS through the TypeScript
 * compiler first, and its vitest pipeline uses the same `ts.transpileModule`
 * lowering (deepseek-harness/vitest.shared.ts); the plugin repo keeps a
 * single tsdown pass, so the lowering runs here as a pre-transform. The
 * `typescript-6` devDep alias exists because this repo's typescript 7 is the
 * native tsc and exposes no transpileModule.
 */
function lowerStandardDecorators() {
  return {
    name: 'lower-standard-decorators',
    // User plugin transforms run before rolldown's built-in TS transform,
    // so the lowered helper code (no decorator syntax) is what oxc parses.
    transform(code: string, id: string) {
      const file = id.split('?', 1)[0];
      if (!/\.(ts|mts)$/.test(file) || !decoratorSyntax.test(code)) return;
      const result = ts.transpileModule(code, {
        fileName: file,
        compilerOptions: {
          target: ts.ScriptTarget.ES2022,
          module: ts.ModuleKind.ESNext,
          sourceMap: false,
        },
      });
      return { code: result.outputText, map: null };
    },
  };
}

/**
 * WP-4.6 — inline `.module.css` into the CLIENT bundle (the single-file
 * client artifact has no companion-CSS channel: the host loader serves
 * `lib/client.js` ONLY, and tsdown refuses any CSS in the module graph —
 * its internal `css-guard` transform (order `post`, id-filtered) throws
 * for every module id still matching `*.css`, so the guard is bypassed by
 * re-identifying the module: `resolveId` maps each `*.module.css` import
 * to a VIRTUAL id (never ending in `.css` → the guard's filter cannot
 * match it) and `load` serves the JS module).
 *
 * Each `.module.css` becomes a JS module that (a) injects its (class-name
 * namespaced) stylesheet ONCE via a deterministic `<style id>` tag and
 * (b) default-exports the CSS-Modules class map with STABLE names
 * (`rcm_<dir>_<key>` — no hash, so e2e assertions and the DOM stay
 * deterministic). Selectors are rewritten token-wise (`.<name>` →
 * `.rcm_<dir>_<name>`); the files in scope are plain CSS (no nesting /
 * preprocessor), and the only other dot-followed-by-letter tokens CSS can
 * contain are in comments (harmless) — decimals carry a digit after the
 * dot and never match.
 *
 * Vitest keeps resolving `.module.css` natively (this plugin is
 * tsdown-build-only), so the view sources and their unit tests are
 * untouched; only the BUILD pipeline changes.
 */
const MODULE_CSS_VIRTUAL_PREFIX = '\0rcm-css:'

/**
 * The virtual module id — it must NOT end in `.css` (tsdown's css-guard
 * id-filter is a suffix regex) while remaining deterministic per file.
 */
function moduleCssVirtualId(file: string): string {
  const rel = file.replace(/\.module\.css$/, '')
  return MODULE_CSS_VIRTUAL_PREFIX + rel.replace(/[^a-zA-Z0-9]+/g, '_')
}

function moduleCssInline() {
  /** virtual id → on-disk path (set by resolveId, read by load). */
  const fileByVirtual = new Map<string, string>();
  return {
    name: 'module-css-inline',
    enforce: 'pre' as const,
    resolveId(source: string, importer: string | undefined) {
      if (!source.endsWith('.module.css')) return null
      const base = importer ? importer.split('?', 1)[0] : source
      const resolved = source.startsWith('/') ? source : importer ? resolvePath(dirname(base), source) : null
      if (resolved === null) return null
      if (!existsSync(resolved) || !statSync(resolved).isFile()) return null
      const virtualId = moduleCssVirtualId(resolved)
      fileByVirtual.set(virtualId, resolved)
      return virtualId
    },
    load(id: string) {
      if (!id.startsWith(MODULE_CSS_VIRTUAL_PREFIX)) return null
      // Recover the on-disk path from the sanitized virtual id.
      const file = fileByVirtual.get(id)
      if (file === undefined) return null
      const code = readFileSync(file, 'utf8')
      const dirName = file.split('/').filter(Boolean).pop() ?? 'view';
      const ns = 'rcm_' + dirName.replace(/[^a-zA-Z0-9]/g, '_');
      const map: Record<string, string> = {};
      const css = code.replace(/\.([A-Za-z_][A-Za-z0-9_-]*)/g, (whole, name: string) => {
        const globalName = `${ns}_${name}`;
        map[name] = globalName;
        return `.${globalName}`;
      });
      const injectedId = `rcm-style-${ns}`;
      return [
        `var __css = ${JSON.stringify(css)};`,
        `var __styles = ${JSON.stringify(map)};`,
        `(function () {`,
        '  if (typeof document === "undefined") return;',
        `  if (document.getElementById(${JSON.stringify(injectedId)})) return;`,
        '  var s = document.createElement("style");',
        `  s.id = ${JSON.stringify(injectedId)};`,
        '  s.textContent = __css;',
        '  (document.head || document.documentElement).appendChild(s);',
        '})();',
        'export default __styles;',
      ].join('\n');
    },
  };
}

// WP-0.3: build the DSH-canonical `lib/` artifact layout (mirrors the host
// repo's package shape, e.g. packages/feedback/message-feedback):
//   - lib/index.js                 `.`          — host entry, default-exports the service class
//   - lib/typert.host.js           `./typert`   — hand-written host TYPERT manifest (U4 fallback)
//   - lib/typert.remote-client.js  `./remote`   — client contribution (TYPERT_REMOTE)
// dts emits the paired .d.ts for each entry (exports carry types/default twins).
const hostConfig: UserConfig = {
  entry: {
    index: './src/host/index.ts',
    'typert.host': './src/host/dsh-adapter/host/typert.artifact.ts',
    'typert.remote-client': './src/client/dsh-adapter/remote/contribution.ts',
  },
  outDir: './lib',
  format: 'esm',
  dts: true,
  // Emit `.js` (package is `type: module`), matching the DSH canonical `lib/*.js`.
  outExtensions: () => ({ js: '.js', dts: '.d.ts' }),
  plugins: [lowerStandardDecorators()],
};

// WP-0.5: browser client bundle — a replica of the host repo's shared client
// preset (deepseek-harness packages/client/tsdown.client.ts `clientConfig`),
// inlined here because the preset is an in-repo helper that reads the DSH
// workspace manifest. Contract, item for item:
//   - entry `src/client/index.tsx` (frozen layout, ARCHITECTURE §2.1)
//   - format cjs, platform browser, outDir lib, dts off (types would wrap the
//     banner/footer into a .d.cts and break parsing — same reason host-side)
//   - entryFileNames pinned to client.js (the loader serves lib/client.js)
//   - banner/footer/intro: the closure-factory artifact the host module
//     loader (window.__ModuleLoader__) expects — the factory receives the
//     loader's module-table require and returns module.exports
//   - sourcemap on (bundle is fetched outside Vite's module graph; the map is
//     served at /plugins/<id>/client.js.map)
//   - clean off (must never wipe the node-half output emitted by hostConfig)
//   - externals: the shell module-table baseline, exact match with
//     packages/client/web/src/platform.ts (PLATFORM_MODULES +
//     PRELOADED_CLIENT_EXTERNALS) plus no package-specific `dsh.client.external`
//     requests — every other bare specifier (zod, own code) inlines, because a
//     require() the table cannot answer is a guaranteed runtime throw
//   - define: the host preset's build-environment defines — `process.env`
//     collapses to {} (plus the exact NODE_ENV keys) and both import.meta.env
//     probes resolve, or the factory throws ReferenceError at boot
// The `lowerStandardDecorators` plugin is host-half-only (the client graph
// contains no decorators).
const CLIENT_ID = 'dsh-research-control';
const CLIENT_EXTERNALS = new Set([
  'react',
  'react/jsx-runtime',
  'react-dom',
  'react-dom/client',
  '@deepseek-ai/cordis',
  '@deepseek-ai/dsh-client-ui-slots',
  '@deepseek-ai/dsh-client-ui-primitives',
  '@deepseek-ai/dsh-client-runtime/client',
]);

const clientConfig: UserConfig = {
  name: `${CLIENT_ID}/client`,
  entry: { client: './src/client/index.tsx' },
  outDir: './lib',
  format: 'cjs',
  platform: 'browser',
  dts: false,
  sourcemap: true,
  clean: false,
  // WP-4.6: the client graph now carries the Phase 4 views' `.module.css`
  // files — inlined by the plugin above (no companion CSS can leave lib/).
  plugins: [moduleCssInline()],
  deps: {
    neverBundle: (specifier: string) => CLIENT_EXTERNALS.has(specifier),
    alwaysBundle: (specifier: string) => !CLIENT_EXTERNALS.has(specifier),
  },
  define: {
    'process.env': '{}',
    'process.env.NODE_ENV': JSON.stringify(process.env.NODE_ENV ?? 'production'),
    'import.meta.env.MODE': JSON.stringify(process.env.NODE_ENV ?? 'production'),
    'import.meta.env': JSON.stringify({ MODE: process.env.NODE_ENV ?? 'production' }),
  },
  outputOptions: {
    entryFileNames: 'client.js',
    banner: `window.__ModuleLoader__.load({ id: ${JSON.stringify(CLIENT_ID)}, factory: (require) => {`,
    footer: 'return module.exports; } });',
    intro: 'var module = { exports: {} }; var exports = module.exports;',
  },
};

// WP-4.6 — the TC-E2E data factory (a NODE script, bundled from the same
// src/host graph it drives: `createHostWiring` + the runbinding/planfork
// services — the seed goes through the PRODUCTION mutation paths, so what
// the e2e assertions see is exactly what the host wiring produces).
// ESM + node platform: the graph imports `node:sqlite` (built-in) and the
// output runs under plain `node` (no loader magic). Kept OUT of lib/ (it is
// e2e infrastructure, not a shipped artifact — e2e/factory-dist/).
const factoryConfig: UserConfig = {
  name: `${CLIENT_ID}/factory`,
  entry: { factory: './e2e/factory/factory.ts' },
  outDir: './e2e/factory-dist',
  format: 'esm',
  platform: 'node',
  dts: false,
  clean: true,
  sourcemap: false,
};

export default defineConfig([hostConfig, clientConfig, factoryConfig]);
