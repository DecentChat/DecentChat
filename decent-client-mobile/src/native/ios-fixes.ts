/**
 * iOS-specific web fixes for Capacitor apps.
 *
 * Addresses common issues when running a web app inside WKWebView on iOS:
 * - Bounce/rubber-band scrolling on non-scrollable areas
 * - Keyboard viewport resize (window shrinks when keyboard appears)
 * - Safe area insets (notch, home indicator)
 * - iOS font size adjustment (auto-zoom on input focus)
 * - Long-press context menu on non-text elements
 */

import { Capacitor } from '@capacitor/core';

/**
 * Prevents bounce scrolling on a specific element but allows it on
 * designated scrollable children (elements with .scrollable or overflow scroll/auto).
 */
function disableBouncingOnContainer(): void {
  const preventBounce = (e: TouchEvent): void => {
    const target = e.target as HTMLElement;

    // Walk up the DOM to find the nearest scrollable ancestor
    let el: HTMLElement | null = target;
    while (el && el !== document.body) {
      const style = window.getComputedStyle(el);
      const overflow = style.overflowY;
      const isScrollable =
        (overflow === 'scroll' || overflow === 'auto') &&
        el.scrollHeight > el.clientHeight;

      if (isScrollable) {
        // Allow native scrolling inside scrollable containers
        return;
      }
      el = el.parentElement;
    }

    // No scrollable ancestor found — prevent bounce
    e.preventDefault();
  };

  document.addEventListener('touchmove', preventBounce, { passive: false });
}

/**
 * On iOS, when the keyboard opens, the window shrinks to the visible area.
 * This can cause layout issues (fixed-position elements move, viewport units break).
 * We store the initial window height and expose it as a CSS variable.
 */
function fixKeyboardViewport(): void {
  const setViewportHeight = (): void => {
    const vh = window.innerHeight * 0.01;
    document.documentElement.style.setProperty('--vh', `${vh}px`);
  };

  setViewportHeight();

  // Re-measure on resize (keyboard open/close)
  window.addEventListener('resize', setViewportHeight);

  // Also handle Capacitor keyboard events if available
  window.addEventListener('keyboardDidShow', () => {
    document.documentElement.classList.add('keyboard-open');
  });

  window.addEventListener('keyboardDidHide', () => {
    document.documentElement.classList.remove('keyboard-open');
    // Restore after keyboard closes
    setViewportHeight();
  });
}

/**
 * Injects CSS to handle iOS safe area insets (notch, Dynamic Island, home indicator).
 * Uses env(safe-area-inset-*) CSS variables exposed by WKWebView.
 */
function applySafeAreaInsets(): void {
  const style = document.createElement('style');
  style.id = 'ios-safe-area';
  style.textContent = `
    :root {
      --safe-area-top: env(safe-area-inset-top, 0px);
      --safe-area-bottom: env(safe-area-inset-bottom, 0px);
      --safe-area-left: env(safe-area-inset-left, 0px);
      --safe-area-right: env(safe-area-inset-right, 0px);
    }
  `;
  document.head.appendChild(style);
}

/**
 * iOS auto-zooms inputs when font-size < 16px. We prevent this by injecting
 * a meta tag that disables user-scalable zoom, and a CSS rule for text size.
 *
 * Note: We keep pinch-zoom disabled for app-like feel; enable if needed.
 */
function preventTextSizeAdjust(): void {
  const style = document.createElement('style');
  style.id = 'ios-text-size';
  style.textContent = `
    * {
      -webkit-text-size-adjust: 100%;
      text-size-adjust: 100%;
    }
  `;
  document.head.appendChild(style);
}

/**
 * iOS shows a context menu (copy/paste/share) on long-press.
 * We disable it on non-text/non-input elements for a more native feel.
 */
function disableLongPressContextMenu(): void {
  document.addEventListener('contextmenu', (e: MouseEvent) => {
    const target = e.target as HTMLElement;
    const tag = target.tagName.toLowerCase();

    // Allow context menu on text inputs and content-editable elements
    const isTextElement =
      tag === 'input' ||
      tag === 'textarea' ||
      target.isContentEditable ||
      target.closest('[contenteditable]') !== null;

    if (!isTextElement) {
      e.preventDefault();
    }
  });

  // Also prevent callout (link preview on long-press) via CSS
  const style = document.createElement('style');
  style.id = 'ios-no-callout';
  style.textContent = `
    *:not(input):not(textarea):not([contenteditable]) {
      -webkit-touch-callout: none;
    }
    /* Prevent text selection on non-text UI elements */
    button, a, [role="button"], nav, header, footer {
      -webkit-user-select: none;
      user-select: none;
    }
  `;
  document.head.appendChild(style);
}

/**
 * Apply all iOS fixes. Call this once at app startup, before mounting the UI.
 * Safe to call on non-iOS platforms — checks platform before applying.
 */
export function setupIOSFixes(): void {
  if (!Capacitor.isNativePlatform()) return;
  if (Capacitor.getPlatform() !== 'ios') return;

  applySafeAreaInsets();
  preventTextSizeAdjust();
  disableLongPressContextMenu();
  fixKeyboardViewport();
  disableBouncingOnContainer();
}
