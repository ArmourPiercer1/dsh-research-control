/**
 * Element-tree harness (WP-4.3 view tests) — DOM-free interaction
 * simulation for the PURE zone components.
 *
 * Why a harness: this repo pins its view tests on `react-dom/server`
 * render assertions (task brief) and installs no DOM environment
 * (no jsdom / @testing-library devDeps — see the WP-4.3 report for the
 * dependency ruling). SSR output carries no event handlers, so the
 * callback-triggering tests render the PURE zone components by DIRECT
 * FUNCTION CALL (they carry no hooks by construction) and walk the
 * resulting React element tree: find the host element by
 * `aria-label`/text, then INVOKE its `onClick` prop — the exact handler
 * a click would run.
 *
 * Function-type elements in the tree (the zone's private row
 * sub-components) are resolved by rendering them (safe: pure, no hooks);
 * a hook-bearing element would throw loudly here, which is the intended
 * failure mode for a view that broke the purity contract.
 */

import type { ReactElement, ReactNode } from 'react'

type AnyProps = Record<string, unknown>
export type AnyElement = ReactElement<AnyProps>

/**
 * Walk a React element tree and collect host elements (string types)
 * matching the predicate. Resolves pure function components along the
 * way; ignores text/number/boolean nodes.
 */
export function findHostElements(root: ReactElement, predicate: (el: AnyElement) => boolean): AnyElement[] {
  const found: AnyElement[] = []
  const walk = (node: ReactNode): void => {
    if (node === null || node === undefined || typeof node !== 'object') return
    if (Array.isArray(node)) {
      for (const child of node) walk(child)
      return
    }
    const el = node as AnyElement
    const type: unknown = el.type
    if (typeof type === 'function') {
      // Pure function component — render it to reach its host subtree.
      walk((type as (props: AnyProps) => ReactNode)(el.props ?? {}))
      return
    }
    if (typeof type === 'string' && predicate(el)) found.push(el)
    const props = el.props
    if (props !== null && typeof props === 'object') {
      walk((props as AnyProps).children as ReactNode)
    }
  }
  walk(root)
  return found
}

/** All host elements whose `aria-label` equals the given label. */
export function findByAriaLabel(root: ReactElement, label: string): AnyElement[] {
  return findHostElements(root, el => el.props['aria-label'] === label)
}

/** The element's OWN direct text content (string/number children, joined). */
export function hostElementText(el: AnyElement): string {
  const children = el.props.children as ReactNode
  if (children === null || children === undefined) return ''
  const parts: string[] = []
  const visit = (node: ReactNode): void => {
    if (typeof node === 'string' || typeof node === 'number') parts.push(String(node))
  }
  if (Array.isArray(children)) {
    for (const child of children) visit(child)
  } else {
    visit(children)
  }
  return parts.join('')
}

/** All host elements whose direct text equals the given string. */
export function findByHostText(root: ReactElement, text: string): AnyElement[] {
  return findHostElements(root, el => hostElementText(el) === text)
}

/**
 * Invoke a host element's `onClick` handler with no event (the zone
 * handlers take no event argument). Throws when the element carries no
 * handler — a click on a non-interactive element is a test bug.
 */
export function invokeClick(el: AnyElement): void {
  const onClick = el.props.onClick
  if (typeof onClick !== 'function') {
    throw new Error(`harness: element has no onClick handler: aria-label=${String(el.props['aria-label'] ?? '')}`)
  }
  ;(onClick as () => void)()
}

/**
 * Normalize `renderToString` output for text assertions: React SSR emits
 * `<!-- -->` separator comments between adjacent text/expression nodes
 * (e.g. `历史事件：<!-- -->12<!-- --> 条`). Strip them so user-visible text
 * can be asserted as one contiguous string.
 */
export function ssrText(html: string): string {
  return html.replaceAll('<!-- -->', '')
}
