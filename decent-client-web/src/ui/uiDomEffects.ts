import type { UICallbacks } from './types';
import { activityUI, lightboxUI } from '../lib/stores/ui.svelte';
import { shellData } from '../lib/stores/shell.svelte';

interface DomEffectsContext {
  callbacks: UICallbacks;
  syncShellSidebar: () => void;
  syncShellLightbox: () => void;
}

export interface DomEffects {
  openMobileSidebar: () => void;
  closeMobileSidebar: () => void;
  toggleMobileSidebar: () => void;
  openLightbox: (src: string, name: string) => void;
  closeLightbox: () => void;
  toggleActivityPanel: () => void;
  refreshActivityPanel: () => void;
  scrollToMessageAndHighlight: (messageId: string, containerId?: string) => void;
  clampMainMessagesScroll: () => void;
}

export function createDomEffects(ctx: DomEffectsContext): DomEffects {
  const { callbacks, syncShellSidebar, syncShellLightbox } = ctx;

  function openMobileSidebar(): void {
    const sidebar = document.getElementById('sidebar');
    if (!sidebar) return;
    sidebar.classList.add('open');
    if (document.getElementById('mobile-sidebar-overlay')) return;

    const overlay = document.createElement('div');
    overlay.id = 'mobile-sidebar-overlay';
    overlay.className = 'mobile-overlay';
    overlay.addEventListener('click', () => closeMobileSidebar());
    overlay.addEventListener('touchstart', (e) => { e.preventDefault(); closeMobileSidebar(); }, { passive: false });
    document.body.appendChild(overlay);
  }

  function closeMobileSidebar(): void {
    document.getElementById('sidebar')?.classList.remove('open');
    document.getElementById('mobile-sidebar-overlay')?.remove();
  }

  function toggleMobileSidebar(): void {
    const sidebar = document.getElementById('sidebar');
    sidebar?.classList.contains('open') ? closeMobileSidebar() : openMobileSidebar();
  }

  function openLightbox(src: string, name: string): void {
    if (lightboxUI.blobUrl) {
      URL.revokeObjectURL(lightboxUI.blobUrl);
      lightboxUI.blobUrl = null;
    }
    lightboxUI.open = true;
    lightboxUI.src = src;
    lightboxUI.name = name;
    syncShellLightbox();
  }

  function closeLightbox(): void {
    lightboxUI.open = false;
    lightboxUI.src = '';
    lightboxUI.name = '';
    if (lightboxUI.blobUrl) {
      URL.revokeObjectURL(lightboxUI.blobUrl);
      lightboxUI.blobUrl = null;
    }
    syncShellLightbox();
  }

  function toggleActivityPanel(): void {
    activityUI.panelOpen = !activityUI.panelOpen;
    shellData.activity.panelOpen = activityUI.panelOpen;
    if (activityUI.panelOpen) {
      shellData.activity.items = callbacks.getActivityItems?.() || [];
      document.getElementById('activity-btn')?.classList.add('active');
    } else {
      syncShellSidebar();
      document.getElementById('activity-btn')?.classList.remove('active');
    }
  }

  function refreshActivityPanel(): void {
    if (!activityUI.panelOpen) return;
    shellData.activity.items = callbacks.getActivityItems?.() || [];
  }

  function scrollToMessageAndHighlight(messageId: string, containerId?: string): void {
    requestAnimationFrame(() => {
      const selector = `[data-message-id="${messageId}"]`;
      const container = containerId ? document.getElementById(containerId) : null;
      const msgEl = container?.querySelector(selector) ?? document.querySelector(selector);
      if (!msgEl) return;
      msgEl.classList.remove('highlight');
      void (msgEl as HTMLElement).offsetWidth;
      msgEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
      msgEl.classList.add('highlight');
      setTimeout(() => msgEl.classList.remove('highlight'), 2500);
    });
  }

  function clampMainMessagesScroll(): void {
    requestAnimationFrame(() => {
      const ml = document.getElementById('messages-list');
      if (!ml) return;
      const maxScroll = ml.scrollHeight - ml.clientHeight;
      if (ml.scrollTop > maxScroll) ml.scrollTop = maxScroll;
    });
  }

  return {
    openMobileSidebar,
    closeMobileSidebar,
    toggleMobileSidebar,
    openLightbox,
    closeLightbox,
    toggleActivityPanel,
    refreshActivityPanel,
    scrollToMessageAndHighlight,
    clampMainMessagesScroll,
  };
}
