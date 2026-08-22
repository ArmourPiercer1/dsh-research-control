/**
 * Vitest configuration (WP-0.3).
 *
 * The only non-default piece is `standardDecoratorPlugin`: WP-0.3 introduces
 * the repo's first TC39 standard class method decorator
 * (`@Remote('ping')` from @deepseek-ai/dsh-typert-protocol), and Vite 8's
 * dev-time TS transform (rolldown/oxc) does not parse decorator syntax in
 * this pipeline. The plugin adapts the DSH host repo's own solution to the
 * same problem — `standardDecoratorPlugin` in deepseek-harness/vitest.shared.ts:
 * transpile decorator-bearing TS with typescript 6 (`typescript-6` devDep
 * alias; this repo's typescript 7 is the native tsc and exposes no
 * transpileModule) into the `__esDecorate` helper form before Vite's parser
 * runs. Files without decorator syntax pass through untouched, so the
 * transform cost stays off the critical path for the other suites.
 */

import ts from 'typescript-6'
import { defaultExclude, defineConfig } from 'vitest/config'

const decoratorSyntax = /^\s*@[A-Za-z_$][\w$]*/m

/** Pre-transform standard TS decorators before Vite's default parser sees the file. */
function standardDecoratorPlugin() {
  return {
    name: 'dsh-standard-decorators',
    enforce: 'pre' as const,
    transform(code: string, id: string) {
      const file = id.split('?', 1)[0]!
      if (!/\.[cm]?tsx?$/.test(file) || !decoratorSyntax.test(code)) return
      const result = ts.transpileModule(code, {
        fileName: file,
        compilerOptions: {
          target: ts.ScriptTarget.ES2024,
          module: ts.ModuleKind.ESNext,
          jsx: file.endsWith('x') ? ts.JsxEmit.ReactJSX : undefined,
          sourceMap: true,
        },
      })
      return {
        code: result.outputText.replace(/\n?\/\/# sourceMappingURL=.*$/u, '\n'),
        map: result.sourceMapText,
      }
    },
  }
}

export default defineConfig({
  plugins: [standardDecoratorPlugin()],
  test: {
    // e2e/*.spec.ts belong to Playwright (scripts/e2e-run.sh / test:e2e), not
    // the unit runner; vitest's default include would otherwise collect them.
    exclude: [...defaultExclude, 'e2e/**'],
  },
})
