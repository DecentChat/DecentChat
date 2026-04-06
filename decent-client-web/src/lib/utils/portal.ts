/**
 * portal — Svelte action that teleports a node to document.body.
 *
 * Usage:
 *   <div use:portal>…</div>
 *
 * The element is moved to <body> on mount and returned to its original
 * position (removed) on destroy. Useful for dropdowns and tooltips that
 * need to escape overflow/stacking-context clipping from parent containers.
 */
export function portal(node: HTMLElement): { destroy(): void } {
  document.body.appendChild(node);
  return {
    destroy() {
      node.remove();
    },
  };
}
