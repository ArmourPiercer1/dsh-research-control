/**
 * CSS Modules type declaration (WP-5.3).
 *
 * The host renderer resolves `*.module.css` through its bundler; this repo
 * has no bundler types in the tsconfig (`types: ["node"]` only), so the
 * view's CSS module imports need an ambient face for `tsc --noEmit`.
 * Vitest stubs CSS imports to an empty object by default, and the
 * production client bundle (tsdown) resolves the module through the host
 * module table — this declaration covers only the type-checking gap.
 */

declare module '*.module.css' {
  const classes: Readonly<Record<string, string>>
  export default classes
}
