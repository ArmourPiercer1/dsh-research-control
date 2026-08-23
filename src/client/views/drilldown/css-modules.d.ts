/**
 * Ambient module face for CSS Modules (WP-4.6 — mirrors the per-view
 * declarations of WP-4.2/4.3/4.4; vitest resolves `*.module.css`
 * natively, the tsdown build inlines it via the `module-css-inline`
 * plugin — see tsdown.config.ts).
 */
declare module '*.module.css' {
  const styles: { readonly [key: string]: string }
  export default styles
}
