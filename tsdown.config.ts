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

export default defineConfig([hostConfig, clientConfig]);
