/**
 * Ambient module face for CSS Modules (V2-T6.1 视图目录).
 *
 * Vite/vitest 原生解析 `*.module.css`（类名映射对象）; tsc 无 CSS 知识,
 * 需此声明才能类型检查 import。按扩展名作用域, 永不遮蔽真实 TS 模块
 * （同各视图目录惯例）。
 */
declare module '*.module.css' {
  const styles: { readonly [key: string]: string }
  export default styles
}
