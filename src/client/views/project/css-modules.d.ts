/**
 * Ambient module face for CSS Modules (WP-4.2 — the repo's first CSS usage;
 * per-view copy of the same declaration).
 *
 * Vite/vitest resolve `*.module.css` natively (a class-name map object);
 * tsc has no CSS knowledge and needs this declaration to type-check the
 * imports. Scoped by extension so it never shadows real TS modules.
 */
declare module '*.module.css' {
  const styles: { readonly [key: string]: string }
  export default styles
}
