import ts from 'typescript-6';
import { defineConfig } from 'tsdown';

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
// The `./client` bundle entry (tsdown clientBundle preset) is WP-0.5, not here.
export default defineConfig({
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
});
