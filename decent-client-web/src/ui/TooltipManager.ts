/**
 * TooltipManager — Viewport-aware tooltips via @floating-ui/dom
 *
 * Replaces pure-CSS tooltip pseudo-elements with JS-driven positioning.
 * Works via event delegation on the document — no per-element init needed.
 *
 * Usage (same data attributes as before):
 *   <button data-tooltip="Click me!" data-tooltip-pos="top">…</button>
 *
 * Positions: top (default), bottom, left, right
 * If the tooltip would go off-screen, floating-ui flips it to the opposite side.
 */

import { computePosition, flip, shift, offset, arrow } from '@floating-ui/dom';
import type { Placement } from '@floating-ui/dom';

const TOOLTIP_CLASS = 'ft-tooltip';
const ARROW_CLASS = 'ft-tooltip-arrow';

let tooltipEl: HTMLElement | null = null;
let arrowEl: HTMLElement | null = null;
let currentAnchor: HTMLElement | null = null;
let hideTimeout: ReturnType<typeof setTimeout> | null = null;

function getPlacement(anchor: HTMLElement): Placement {
  const pos = anchor.dataset.tooltipPos;
  const valid: Placement[] = ['top', 'bottom', 'left', 'right'];
  return (valid.includes(pos as Placement) ? pos : 'top') as Placement;
}

function ensureTooltipEl(): { tooltip: HTMLElement; arrow: HTMLElement } {
  if (!tooltipEl) {
    tooltipEl = document.createElement('div');
    tooltipEl.className = TOOLTIP_CLASS;
    tooltipEl.setAttribute('role', 'tooltip');

    arrowEl = document.createElement('div');
    arrowEl.className = ARROW_CLASS;
    tooltipEl.appendChild(arrowEl);

    document.body.appendChild(tooltipEl);
  }
  return { tooltip: tooltipEl, arrow: arrowEl! };
}

async function showTooltip(anchor: HTMLElement): Promise<void> {
  if (hideTimeout) {
    clearTimeout(hideTimeout);
    hideTimeout = null;
  }

  const text = anchor.dataset.tooltip;
  if (!text) return;

  currentAnchor = anchor;
  const { tooltip } = ensureTooltipEl(); // arrowEl set as side-effect (module-level var)

  // Set text (excluding the arrow child)
  // Update only the text node to preserve the arrow element
  let textNode = tooltip.childNodes[0];
  if (!textNode || textNode.nodeType !== Node.TEXT_NODE) {
    textNode = document.createTextNode(text);
    tooltip.insertBefore(textNode, arrowEl);
  } else {
    textNode.textContent = text;
  }

  // Reset styles before measuring
  tooltip.style.visibility = 'hidden';
  tooltip.style.opacity = '0';
  tooltip.style.display = 'block';

  const placement = getPlacement(anchor);
  const fallbacks: Placement[] = placement.startsWith('top')
    ? ['bottom', 'left', 'right']
    : placement.startsWith('bottom')
    ? ['top', 'left', 'right']
    : placement === 'left'
    ? ['right', 'top', 'bottom']
    : ['left', 'top', 'bottom'];

  const { x, y, placement: finalPlacement, middlewareData } = await computePosition(anchor, tooltip, {
    placement,
    middleware: [
      offset(8),
      flip({ fallbackPlacements: fallbacks }),
      shift({ padding: 6 }),
      arrow({ element: arrowEl! }),
    ],
  });

  Object.assign(tooltip.style, {
    left: `${x}px`,
    top: `${y}px`,
  });

  // Arrow positioning
  const { x: ax, y: ay } = middlewareData.arrow ?? {};
  const side = finalPlacement.split('-')[0] as 'top' | 'bottom' | 'left' | 'right';
  const staticSide = { top: 'bottom', bottom: 'top', left: 'right', right: 'left' }[side];

  Object.assign(arrowEl!.style, {
    left: ax != null ? `${ax}px` : '',
    top: ay != null ? `${ay}px` : '',
    right: '',
    bottom: '',
    [staticSide!]: '-4px',
  });

  // Apply side data attribute for CSS arrow color direction
  tooltip.dataset.side = side;

  // Animate in
  requestAnimationFrame(() => {
    if (tooltip.style.display === 'block') {
      tooltip.style.visibility = 'visible';
      tooltip.style.opacity = '1';
    }
  });
}

function hideTooltip(): void {
  if (!tooltipEl) return;
  tooltipEl.style.opacity = '0';
  hideTimeout = setTimeout(() => {
    if (tooltipEl) tooltipEl.style.display = 'none';
    currentAnchor = null;
  }, 150);
}

/** Call once at app startup to activate tooltip delegation. */
export function initTooltips(): void {
  document.addEventListener('mouseover', (e) => {
    const anchor = (e.target as HTMLElement).closest('[data-tooltip]') as HTMLElement | null;
    if (anchor && anchor !== currentAnchor) {
      showTooltip(anchor);
    }
  });

  document.addEventListener('mouseout', (e) => {
    const anchor = (e.target as HTMLElement).closest('[data-tooltip]') as HTMLElement | null;
    if (anchor) {
      // Only hide if not moving to the tooltip itself
      const related = e.relatedTarget as HTMLElement | null;
      if (!related || !anchor.contains(related)) {
        hideTooltip();
      }
    }
  });

  // Hide on scroll/resize
  document.addEventListener('scroll', hideTooltip, { passive: true, capture: true });
  window.addEventListener('resize', hideTooltip, { passive: true });
}
