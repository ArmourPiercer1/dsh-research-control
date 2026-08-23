/**
 * CSS Modules declaration (WP-4.3) — the only type face for the
 * `*.module.css` imports in this view directory. Scoped to `*.module.css`
 * (plain `*.css` stays untyped); the default export is the class-name map
 * (Vite/host-bundler CSS-module contract). Picked up by the repo tsconfig
 * (`include: ["src", ...]`).
 */

declare module '*.module.css' {
  const classes: Readonly<Record<string, string>>
  export default classes
}
