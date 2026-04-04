<!--
  MessageList.svelte — Main + thread message list with adaptive virtualization.
  Keeps full message data in store while bounding DOM rows.
-->
<script lang="ts">
  import { onMount } from 'svelte';
  import type { PlaintextMessage } from 'decent-protocol';
  import MessageItem from './MessageItem.svelte';
  import {
    MAIN_VIRTUALIZATION,
    THREAD_VIRTUALIZATION,
    DEFAULT_MESSAGE_HEIGHT,
    MIN_ESTIMATED_HEIGHT,
    MAX_ESTIMATED_HEIGHT,
    MESSAGE_VERTICAL_GAP_PX,
    computeAdaptiveWindowSize,
    computeSmoothedAverageHeight,
    shouldKeepBottomAnchored,
    shouldApplyTopSpacerCompensation,
    estimateMessageHeightFromContent,
    type VirtualizationConfig,
  } from './virtualizationHeuristics';

  type PretextPrepare = (text: string, font: string, options?: { whiteSpace?: 'normal' | 'pre-wrap' }) => unknown;
  type PretextLayout = (prepared: unknown, maxWidth: number, lineHeight: number) => { height: number; lineCount: number };

  interface Props {
    messages: PlaintextMessage[];
    channelName: string;
    activeChannelId: string | null;
    isDirectMessage?: boolean;
    myPeerId: string;
    myDisplayName: string;
    inThreadView?: boolean;
    threadRoot?: PlaintextMessage | null;
    activeThreadRootId?: string | null;
    frequentReactions: string[];
    scrollTargetMessageId?: string | null;
    scrollTargetNonce?: number;
    hasOlderMessages?: boolean;
    loadingOlder?: boolean;
    onLoadOlder?: (channelId: string) => Promise<number>;
    // Callbacks
    getThread: (channelId: string, messageId: string) => PlaintextMessage[];
    getPeerAlias: (peerId: string) => string;
    isBot: (senderId: string) => boolean;
    getCompanySimProfile: (senderId: string) => { automationKind?: string; roleTitle?: string; teamId?: string; managerPeerId?: string; avatarUrl?: string } | undefined;
    onOpenThread: (messageId: string) => void;
    onToggleReaction: (messageId: string, emoji: string) => void;
    onRememberReaction: (emoji: string) => void;
    onShowMessageInfo: (messageId: string) => void;
    onImageClick?: (name: string, src: string) => void;
    resolveAttachmentImageUrl?: (attachmentId: string) => Promise<string | null>;
    onInvite?: () => void;
    onShowQR?: () => void;
  }

  let {
    messages,
    channelName,
    activeChannelId,
    isDirectMessage = false,
    myPeerId,
    myDisplayName,
    inThreadView = false,
    threadRoot = null,
    activeThreadRootId = null,
    frequentReactions,
    scrollTargetMessageId = null,
    scrollTargetNonce = 0,
    hasOlderMessages = false,
    loadingOlder = false,
    onLoadOlder,
    getThread,
    getPeerAlias,
    isBot,
    getCompanySimProfile,
    onOpenThread,
    onToggleReaction,
    onRememberReaction,
    onShowMessageInfo,
    onImageClick,
    resolveAttachmentImageUrl,
    onInvite,
    onShowQR,
  }: Props = $props();

  let mounted = $state(false);
  let isNearBottom = $state(true);
  let isCompactViewport = $state(false);

  // Virtualized window [windowStart, windowEnd)
  let windowStart = $state(0);
  let windowEnd = $state(0);

  // Spacer heights for offscreen continuity
  let topSpacerHeight = $state(0);
  let bottomSpacerHeight = $state(0);
  let averageMessageHeight = $state(DEFAULT_MESSAGE_HEIGHT);
  const measuredHeights = new Map<string, number>();

  // Cached virtual-height index for fast spacer math + offset->index lookup.
  let offsetsDirty = true;
  let estimatedOffsets: number[] = [0];
  const messageIndexById = new Map<string, number>();

  let prevContextKey = '';
  let prevMessageCount = 0;
  let lastHandledScrollNonce = 0;

  let scrollSyncRaf: number | null = null;
  let spacerRefreshRaf: number | null = null;
  let spacerRefreshPreserveScroll = false;
  let rowResizeObserver: ResizeObserver | null = null;
  let suppressScrollVirtualizationUntil = 0;
  let keepBottomAnchoredUntil = 0;
  let pretextPrepare: PretextPrepare | null = null;
  let pretextLayout: PretextLayout | null = null;
  let pretextLoadPromise: Promise<void> | null = null;

  const estimatedHeights = new Map<string, { cacheKey: string; height: number }>();
  const pretextPreparedContent = new Map<string, unknown>();

  const MESSAGE_FONT = '400 15px "Inter", "Segoe UI", "Helvetica Neue", Arial, sans-serif';
  const MESSAGE_FONT_COMPACT = '400 14px "Inter", "Segoe UI", "Helvetica Neue", Arial, sans-serif';
  const MESSAGE_LINE_HEIGHT = 22.5;
  const MESSAGE_LINE_HEIGHT_COMPACT = 21;

  const renderedMessages = $derived(messages.slice(windowStart, windowEnd));

  const visibleStartIndex = $derived(windowStart);

  function getVirtualizationConfig(): VirtualizationConfig {
    return inThreadView ? THREAD_VIRTUALIZATION : MAIN_VIRTUALIZATION;
  }

  function getContainer(): HTMLElement | null {
    return document.getElementById(inThreadView ? 'thread-messages' : 'messages-list');
  }

  function getVirtualAnchorOffset(container: HTMLElement): number {
    const anchor = container.querySelector('.message-virtual-anchor') as HTMLElement | null;
    if (!anchor) return 0;

    const top = Number(anchor.offsetTop);
    return Number.isFinite(top) ? Math.max(0, top) : 0;
  }

  function viewportOffsetFromContainerScroll(container: HTMLElement, scrollTop = container.scrollTop): number {
    return Math.max(0, scrollTop - getVirtualAnchorOffset(container));
  }

  function scrollToEnd(container: HTMLElement): void {
    container.style.scrollBehavior = 'auto';
    container.scrollTop = container.scrollHeight;
    requestAnimationFrame(() => { container.style.scrollBehavior = ''; });
  }

  function updateNearBottom(container: HTMLElement): void {
    isNearBottom = container.scrollTop + container.clientHeight >= container.scrollHeight - getVirtualizationConfig().nearBottomPx;
  }

  function armBottomAnchor(durationMs = 800): void {
    keepBottomAnchoredUntil = Math.max(keepBottomAnchoredUntil, performance.now() + durationMs);
  }

  function shouldAutoStickToBottomNow(nowMs = performance.now()): boolean {
    return shouldKeepBottomAnchored({
      isNearBottom,
      pinnedUntilMs: keepBottomAnchoredUntil,
      nowMs,
    });
  }

  function clampEstimatedHeight(height: number): number {
    return Math.max(MIN_ESTIMATED_HEIGHT, Math.min(MAX_ESTIMATED_HEIGHT, height));
  }

  function ensurePretextLoaded(): void {
    if (pretextPrepare || pretextLayout || pretextLoadPromise || typeof window === 'undefined') return;

    pretextLoadPromise = import('@chenglou/pretext')
      .then((mod) => {
        pretextPrepare = mod.prepare as PretextPrepare;
        pretextLayout = mod.layout as PretextLayout;
        markOffsetsDirty();
        scheduleSpacerRefresh(true);
      })
      .catch(() => {
        // Keep virtualization on baseline heuristics if pretext cannot load.
      })
      .finally(() => {
        pretextLoadPromise = null;
      });
  }

  function getEstimatedContentWidth(container?: HTMLElement | null): number {
    if (!container) return isCompactViewport ? 320 : 460;
    const avatarWidth = isCompactViewport ? 28 : 36;
    const horizontalPadding = 16;
    const rowGap = 10;
    const bodyInsets = 6;
    return Math.max(180, container.clientWidth - avatarWidth - horizontalPadding - rowGap - bodyInsets);
  }

  function estimateContentHeightWithPretext(msg: PlaintextMessage, maxWidth: number): number | null {
    if (!pretextPrepare || !pretextLayout || maxWidth <= 0) return null;

    const content = msg.content ?? '';
    if (content.length === 0) return 0;

    const font = isCompactViewport ? MESSAGE_FONT_COMPACT : MESSAGE_FONT;
    const lineHeight = isCompactViewport ? MESSAGE_LINE_HEIGHT_COMPACT : MESSAGE_LINE_HEIGHT;
    const preparedCacheKey = `${font}\n${content}`;

    let prepared = pretextPreparedContent.get(preparedCacheKey);
    if (!prepared) {
      prepared = pretextPrepare(content, font, { whiteSpace: 'pre-wrap' });
      pretextPreparedContent.set(preparedCacheKey, prepared);
    }

    const result = pretextLayout(prepared, maxWidth, lineHeight);
    return Number.isFinite(result.height) ? Math.max(lineHeight, result.height) : null;
  }

  function estimateMessageHeight(msg: PlaintextMessage, index: number, contentWidth: number): number {
    const measured = measuredHeights.get(msg.id);
    if (measured !== undefined) return measured;

    const attachmentCount = (((msg as any).attachments as unknown[] | undefined)?.length ?? 0);
    const grouped = isGrouped(msg, index, messages);
    const widthBucket = Math.max(180, Math.round(contentWidth / 8) * 8);
    const fontMode = isCompactViewport ? 'compact' : 'regular';
    const cacheKey = `${msg.id}:${widthBucket}:${grouped ? 1 : 0}:${attachmentCount}:${fontMode}`;

    const cached = estimatedHeights.get(msg.id);
    if (cached?.cacheKey === cacheKey) {
      return cached.height;
    }

    const contentHeight = estimateContentHeightWithPretext(msg, widthBucket);
    const estimated = estimateMessageHeightFromContent({
      type: msg.type,
      contentHeightPx: contentHeight,
      isGrouped: grouped,
      attachmentCount,
    });

    estimatedHeights.set(msg.id, { cacheKey, height: estimated });
    return estimated;
  }

  function markOffsetsDirty(): void {
    offsetsDirty = true;
  }

  function rebuildEstimatedOffsets(): void {
    const total = messages.length;
    const contentWidth = getEstimatedContentWidth(getContainer());
    estimatedOffsets = new Array(total + 1);
    estimatedOffsets[0] = 0;
    messageIndexById.clear();

    for (let i = 0; i < total; i += 1) {
      const msg = messages[i];
      messageIndexById.set(msg.id, i);
      estimatedOffsets[i + 1] = estimatedOffsets[i] + estimateMessageHeight(msg, i, contentWidth);
    }

    offsetsDirty = false;
  }

  function ensureOffsets(): void {
    if (!offsetsDirty) return;
    rebuildEstimatedOffsets();
  }

  function estimateRangeHeight(start: number, end: number): number {
    if (start >= end) return 0;
    ensureOffsets();
    const safeStart = Math.max(0, Math.min(start, messages.length));
    const safeEnd = Math.max(safeStart, Math.min(end, messages.length));
    return estimatedOffsets[safeEnd] - estimatedOffsets[safeStart];
  }

  function findIndexForOffset(offset: number): number {
    ensureOffsets();

    const total = messages.length;
    if (total <= 0) return 0;

    const maxOffset = estimatedOffsets[total] ?? 0;
    const target = Math.max(0, Math.min(offset, maxOffset));

    let lo = 0;
    let hi = total;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if ((estimatedOffsets[mid + 1] ?? maxOffset) <= target) {
        lo = mid + 1;
      } else {
        hi = mid;
      }
    }

    return Math.max(0, Math.min(lo, total - 1));
  }

  function getTargetWindowSize(container?: HTMLElement | null): number {
    const config = getVirtualizationConfig();
    if (!container) return config.initialWindowSize;

    return computeAdaptiveWindowSize({
      containerHeight: container.clientHeight,
      averageRowHeight: averageMessageHeight,
      config,
    });
  }

  function currentWindowSize(container?: HTMLElement | null): number {
    const config = getVirtualizationConfig();
    const existing = windowEnd - windowStart;
    const fallback = getTargetWindowSize(container);
    return Math.max(config.minWindowSize, Math.min(config.maxWindowSize, existing > 0 ? existing : fallback));
  }

  function resetWindowToLatest(total: number, container?: HTMLElement | null): void {
    const size = Math.min(total, currentWindowSize(container));
    windowEnd = total;
    windowStart = Math.max(0, total - size);
  }

  function clampWindow(total: number): void {
    if (total <= 0) {
      windowStart = 0;
      windowEnd = 0;
      return;
    }

    const config = getVirtualizationConfig();

    if (windowEnd <= 0) windowEnd = total;
    windowEnd = Math.max(0, Math.min(windowEnd, total));
    windowStart = Math.max(0, Math.min(windowStart, windowEnd));

    // Keep at least a minimal adaptive window once list has enough rows.
    const size = windowEnd - windowStart;
    const minSize = Math.min(total, Math.max(config.initialWindowSize, config.minWindowSize));
    if (size < minSize) {
      const missing = minSize - size;
      windowStart = Math.max(0, windowStart - Math.ceil(missing / 2));
      windowEnd = Math.min(total, windowEnd + Math.floor(missing / 2));
      if (windowEnd - windowStart < minSize) {
        if (windowStart === 0) {
          windowEnd = Math.min(total, minSize);
        } else if (windowEnd === total) {
          windowStart = Math.max(0, total - minSize);
        }
      }
    }
  }

  function updateSpacerHeights(options: { preserveScroll?: boolean } = {}): void {
    const prevTop = topSpacerHeight;
    const nextTop = Math.max(0, Math.round(estimateRangeHeight(0, windowStart)));
    const nextBottom = Math.max(0, Math.round(estimateRangeHeight(windowEnd, messages.length)));

    topSpacerHeight = nextTop;
    bottomSpacerHeight = nextBottom;

    if (!options.preserveScroll) return;

    const topDelta = nextTop - prevTop;
    if (!shouldApplyTopSpacerCompensation(topDelta)) return;

    const container = getContainer();
    if (!container || shouldAutoStickToBottomNow()) return;

    requestAnimationFrame(() => {
      container.scrollTop = Math.max(0, container.scrollTop + topDelta);
      updateNearBottom(container);
    });
  }

  function scheduleSpacerRefresh(preserveScroll = false): void {
    spacerRefreshPreserveScroll = spacerRefreshPreserveScroll || preserveScroll;
    if (spacerRefreshRaf !== null) return;

    spacerRefreshRaf = requestAnimationFrame(() => {
      spacerRefreshRaf = null;
      const preserve = spacerRefreshPreserveScroll;
      spacerRefreshPreserveScroll = false;
      updateSpacerHeights({ preserveScroll: preserve });
    });
  }

  function computeWindowForViewport(container: HTMLElement): { start: number; end: number } {
    const total = messages.length;
    if (total <= 0) return { start: 0, end: 0 };

    const config = getVirtualizationConfig();
    if (total <= config.initialWindowSize) {
      return { start: 0, end: total };
    }

    const viewportTop = viewportOffsetFromContainerScroll(container);
    const viewportBottom = viewportTop + container.clientHeight;

    let start = findIndexForOffset(Math.max(0, viewportTop - config.viewportOverscanPx));
    let end = Math.min(total, findIndexForOffset(viewportBottom + config.viewportOverscanPx) + 1);

    const targetSize = Math.min(total, getTargetWindowSize(container));
    if (end - start < targetSize) {
      const center = Math.floor((start + end) / 2);
      start = Math.max(0, center - Math.floor(targetSize / 2));
      end = Math.min(total, start + targetSize);
      start = Math.max(0, end - targetSize);
    }

    if (end - start > config.maxWindowSize) {
      const centerIndex = findIndexForOffset(viewportTop + (container.clientHeight / 2));
      start = Math.max(0, centerIndex - Math.floor(config.maxWindowSize / 2));
      end = Math.min(total, start + config.maxWindowSize);
      start = Math.max(0, end - config.maxWindowSize);
    }

    return { start, end };
  }

  function applyWindowRange(start: number, end: number): boolean {
    const total = messages.length;
    const nextStart = Math.max(0, Math.min(start, total));
    const nextEnd = Math.max(nextStart, Math.min(end, total));
    const changed = nextStart !== windowStart || nextEnd !== windowEnd;

    windowStart = nextStart;
    windowEnd = nextEnd;

    return changed;
  }

  function scheduleWindowSync(container: HTMLElement): void {
    if (scrollSyncRaf !== null) return;

    scrollSyncRaf = requestAnimationFrame(() => {
      scrollSyncRaf = null;
      const prevTopSpacer = topSpacerHeight;
      const prevScrollTop = container.scrollTop;
      const next = computeWindowForViewport(container);

      if (applyWindowRange(next.start, next.end)) {
        updateSpacerHeights();

        const topDelta = topSpacerHeight - prevTopSpacer;
        if (shouldApplyTopSpacerCompensation(topDelta)) {
          container.scrollTop = Math.max(0, prevScrollTop + topDelta);
          updateNearBottom(container);
        }
      }
    });
  }

  function recordMeasuredHeights(nodes: Iterable<HTMLElement>): void {
    let observedTotal = 0;
    let observedCount = 0;
    let changed = false;

    for (const node of nodes) {
      const id = node.dataset.messageId;
      if (!id) continue;

      const measured = clampEstimatedHeight(node.getBoundingClientRect().height + MESSAGE_VERTICAL_GAP_PX);
      if (!Number.isFinite(measured) || measured <= 0) continue;

      observedTotal += measured;
      observedCount += 1;

      const prev = measuredHeights.get(id);
      if (!prev || Math.abs(prev - measured) > 1) {
        measuredHeights.set(id, measured);
        changed = true;
      }
    }

    if (observedCount > 0) {
      const observedAvg = observedTotal / observedCount;
      const blended = computeSmoothedAverageHeight({
        previousAverage: averageMessageHeight,
        observedAverage: observedAvg,
        minHeight: MIN_ESTIMATED_HEIGHT,
        maxHeight: MAX_ESTIMATED_HEIGHT,
        blendWeight: 0.2,
        maxStep: 2.5,
      });
      if (Math.abs(blended - averageMessageHeight) > 0.25) {
        averageMessageHeight = blended;
        changed = true;
      }
    }

    if (changed) {
      markOffsetsDirty();

      const container = getContainer();
      if (container && shouldAutoStickToBottomNow()) {
        requestAnimationFrame(() => {
          scrollToEnd(container);
          updateNearBottom(container);
        });
      } else {
        scheduleSpacerRefresh(true);
      }
    }
  }

  function scrollAndHighlightMessage(messageId: string, attempt = 0): void {
    requestAnimationFrame(() => {
      const container = getContainer();
      if (!container) return;

      const msgEl = container.querySelector(`.message[data-message-id="${messageId}"]`) as HTMLElement | null;
      if (!msgEl) {
        if (attempt < 8) scrollAndHighlightMessage(messageId, attempt + 1);
        return;
      }

      msgEl.classList.remove('highlight');
      void msgEl.offsetWidth;
      msgEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
      msgEl.classList.add('highlight');
      setTimeout(() => msgEl.classList.remove('highlight'), 2500);
    });
  }

  function resetHeightEstimates(): void {
    measuredHeights.clear();
    estimatedHeights.clear();
    averageMessageHeight = DEFAULT_MESSAGE_HEIGHT;
    topSpacerHeight = 0;
    bottomSpacerHeight = 0;
    estimatedOffsets = [0];
    messageIndexById.clear();
    offsetsDirty = true;
  }

  onMount(() => {
    const mediaQuery = window.matchMedia('(max-width: 768px)');
    const updateCompactViewport = () => {
      isCompactViewport = mediaQuery.matches;
      markOffsetsDirty();
    };
    updateCompactViewport();
    mediaQuery.addEventListener?.('change', updateCompactViewport);
    ensurePretextLoaded();

    return () => {
      mediaQuery.removeEventListener?.('change', updateCompactViewport);
    };
  });

  $effect(() => {
    mounted = true;

    return () => {
      if (scrollSyncRaf !== null) cancelAnimationFrame(scrollSyncRaf);
      if (spacerRefreshRaf !== null) cancelAnimationFrame(spacerRefreshRaf);
      if (rowResizeObserver) {
        rowResizeObserver.disconnect();
        rowResizeObserver = null;
      }
    };
  });

  // Keep viewport behavior aligned with context/message changes.
  $effect(() => {
    if (!mounted) return;

    const total = messages.length;
    const contextKey = inThreadView
      ? `thread:${activeChannelId ?? ''}:${threadRoot?.id ?? ''}`
      : `channel:${activeChannelId ?? ''}`;

    const contextChanged = contextKey !== prevContextKey;
    prevContextKey = contextKey;

    if (contextChanged) {
      prevMessageCount = total;
      resetHeightEstimates();
      resetWindowToLatest(total, getContainer());
      markOffsetsDirty();
      updateSpacerHeights();

      requestAnimationFrame(() => {
        const container = getContainer();
        if (!container) return;
        scrollToEnd(container);
        updateNearBottom(container);
        armBottomAnchor(900);
      });
      return;
    }

    if (total !== prevMessageCount) {
      markOffsetsDirty();
    }

    clampWindow(total);

    if (total > prevMessageCount) {
      const wasShowingLatest = windowEnd >= prevMessageCount;
      if (wasShowingLatest && shouldAutoStickToBottomNow()) {
        const container = getContainer();
        resetWindowToLatest(total, container);
        requestAnimationFrame(() => {
          if (!container) return;
          scrollToEnd(container);
          updateNearBottom(container);
          armBottomAnchor(900);
        });
      }
    } else if (total < prevMessageCount) {
      clampWindow(total);
    }

    prevMessageCount = total;
    updateSpacerHeights();
  });

  // Track rendered row heights continuously (handles async image/markdown growth).
  $effect(() => {
    if (!mounted) return;

    // Depend on current rendered slice and message count.
    windowStart;
    windowEnd;
    renderedMessages;
    messages.length;

    const container = getContainer();
    if (!container) return;

    if (rowResizeObserver) {
      rowResizeObserver.disconnect();
      rowResizeObserver = null;
    }

    const nodes = Array.from(container.querySelectorAll<HTMLElement>('.message[data-message-id]'));
    recordMeasuredHeights(nodes);

    rowResizeObserver = new ResizeObserver((entries) => {
      const changedNodes: HTMLElement[] = [];
      for (const entry of entries) {
        if (entry.target instanceof HTMLElement && entry.target.dataset.messageId) {
          changedNodes.push(entry.target);
        }
      }
      if (changedNodes.length > 0) {
        recordMeasuredHeights(changedNodes);
      }
    });

    for (const node of nodes) {
      rowResizeObserver.observe(node);
    }

    return () => {
      if (rowResizeObserver) {
        rowResizeObserver.disconnect();
        rowResizeObserver = null;
      }
    };
  });

  // Search/activity jump requests: ensure target enters current window.
  $effect(() => {
    const nonce = scrollTargetNonce ?? 0;
    const messageId = scrollTargetMessageId ?? null;
    if (!messageId || nonce <= 0 || nonce === lastHandledScrollNonce) return;

    ensureOffsets();
    let targetIndex = messageIndexById.get(messageId);
    if (targetIndex === undefined) {
      const fallback = messages.findIndex((m) => m.id === messageId);
      if (fallback === -1) {
        if (threadRoot?.id === messageId) {
          lastHandledScrollNonce = nonce;
          scrollAndHighlightMessage(messageId);
        }
        return;
      }
      targetIndex = fallback;
    }

    lastHandledScrollNonce = nonce;

    if (scrollSyncRaf !== null) {
      cancelAnimationFrame(scrollSyncRaf);
      scrollSyncRaf = null;
    }

    const config = getVirtualizationConfig();
    const targetWindowSize = Math.min(
      messages.length,
      Math.max(currentWindowSize(getContainer()), config.searchWindowSize)
    );
    const targetStart = Math.max(
      0,
      Math.min(targetIndex - Math.floor(targetWindowSize / 2), Math.max(0, messages.length - targetWindowSize))
    );

    applyWindowRange(targetStart, targetStart + targetWindowSize);
    updateSpacerHeights();

    const container = getContainer();
    if (container) {
      const anchorOffset = getVirtualAnchorOffset(container);
      const estimatedTargetTop = anchorOffset + Math.max(0, estimateRangeHeight(0, targetIndex) - (container.clientHeight / 2));
      suppressScrollVirtualizationUntil = performance.now() + 1200;
      container.scrollTop = estimatedTargetTop;
      updateNearBottom(container);
    }

    scrollAndHighlightMessage(messageId);
  });

  // Load-older-messages detection: when the user scrolls near the top of
  // the message list and the virtual window already starts at index 0,
  // request older messages from IndexedDB.
  let loadOlderScheduled = false;

  function checkLoadOlder(container: HTMLElement): void {
    if (inThreadView || !onLoadOlder || !hasOlderMessages || loadingOlder || loadOlderScheduled) return;
    if (windowStart > 0) return; // virtualizer hasn't reached the top yet
    // Trigger when within 200px of the top (generous threshold so it feels seamless)
    if (container.scrollTop > 200) return;
    if (!activeChannelId) return;

    loadOlderScheduled = true;
    const chId = activeChannelId;
    const prevScrollHeight = container.scrollHeight;
    onLoadOlder(chId).then((count) => {
      if (count > 0) {
        // After prepend, preserve the user's visual scroll position.
        requestAnimationFrame(() => {
          const newScrollHeight = container.scrollHeight;
          container.scrollTop += newScrollHeight - prevScrollHeight;
          markOffsetsDirty();
          updateSpacerHeights();
        });
      }
    }).finally(() => { loadOlderScheduled = false; });
  }

  // Scroll-driven adaptive window sync.
  $effect(() => {
    if (!mounted) return;

    const container = getContainer();
    if (!container) return;

    updateNearBottom(container);

    const onScroll = () => {
      updateNearBottom(container);
      if (!isNearBottom) keepBottomAnchoredUntil = 0;
      if (performance.now() < suppressScrollVirtualizationUntil) return;
      scheduleWindowSync(container);
      checkLoadOlder(container);
    };

    container.addEventListener('scroll', onScroll, { passive: true });
    return () => container.removeEventListener('scroll', onScroll);
  });

  // Keep bottom anchoring on resize only when user is already near bottom.
  $effect(() => {
    if (!mounted) return;

    const container = getContainer();
    if (!container) return;

    const ro = new ResizeObserver(() => {
      markOffsetsDirty();
      if (shouldAutoStickToBottomNow()) {
        scrollToEnd(container);
        updateNearBottom(container);
        armBottomAnchor(500);
      } else {
        scheduleWindowSync(container);
      }
    });
    ro.observe(container);

    return () => ro.disconnect();
  });

  function getSenderName(msg: PlaintextMessage): string {
    const isMine = msg.senderId === myPeerId;
    return isMine ? myDisplayName : ((msg as any).senderName || getPeerAlias(msg.senderId));
  }

  function isGrouped(msg: PlaintextMessage, index: number, list: PlaintextMessage[]): boolean {
    if (index === 0) return false;
    const prev = list[index - 1];
    return prev.senderId === msg.senderId
      && msg.timestamp - prev.timestamp < 300000
      && msg.type !== 'system';
  }

  function getModelLabel(msg: PlaintextMessage): string {
    const assistant = (msg as any).metadata?.assistant as {
      modelLabel?: string;
      modelAlias?: string;
      modelName?: string;
      modelId?: string;
    } | undefined;
    if (!assistant) return '';
    return assistant.modelLabel || assistant.modelAlias || assistant.modelName || (assistant.modelId?.split('/').pop() ?? '');
  }
</script>

<div
  style="display: contents;"
  data-testid="message-list"
  data-view={inThreadView ? 'thread' : 'channel'}
>
  {#if !activeChannelId}
    <div class="empty-state">
      <div class="emoji">💬</div>
      {#if isDirectMessage}
        <h3>No conversation selected</h3>
        <p>Select a conversation or start a new DM</p>
      {:else}
        <h3>No channel selected</h3>
        <p>Pick a channel from the sidebar</p>
      {/if}
    </div>
  {:else if messages.length === 0 && !threadRoot}
    <div class="empty-state">
      <div class="emoji">✨</div>
      <h3>Welcome to {channelName}!</h3>
      <p class="empty-state-status">You’re the first member here right now.</p>
      <p class="empty-state-lead"><strong>Next step:</strong> send your first message, or invite someone with a link or QR code.</p>
      {#if onInvite || onShowQR}
        <div class="empty-state-actions">
          {#if onInvite}
            <button class="btn-primary" type="button" onclick={onInvite}>Invite people via link</button>
          {/if}
          {#if onShowQR}
            <button class="btn-secondary" type="button" onclick={onShowQR}>Show invite QR code</button>
          {/if}
        </div>
      {/if}
      <p class="empty-state-support">Messages stay end-to-end encrypted and are only stored on members’ devices.</p>
      {#if isCompactViewport}
        <p class="empty-state-tip">Need help? Type <code>/help</code>.</p>
      {:else}
        <p class="empty-state-tip">Need help? Press <code>Ctrl+K</code> or type <code>/help</code>.</p>
      {/if}
    </div>
  {:else}
    {#if threadRoot}
      {@const threadRootProfile = getCompanySimProfile(threadRoot.senderId)}
      <div
        style="display: contents;"
        data-testid="message-meta"
        data-view={inThreadView ? 'thread' : 'channel'}
        data-message-id={threadRoot.id}
        data-sender-id={threadRoot.senderId}
        data-sender-name={getSenderName(threadRoot)}
        data-thread-id={threadRoot.threadId || ''}
        data-role-title={threadRootProfile?.roleTitle || ''}
        data-automation-kind={threadRootProfile?.automationKind || ''}
      >
        <MessageItem
          id={threadRoot.id}
          senderId={threadRoot.senderId}
          senderName={getSenderName(threadRoot)}
          content={threadRoot.content}
          timestamp={threadRoot.timestamp}
          type={threadRoot.type}
          isMine={threadRoot.senderId === myPeerId}
          isBot={isBot(threadRoot.senderId)}
          modelLabel={getModelLabel(threadRoot)}
          companySim={threadRootProfile}
          isGrouped={false}
          {inThreadView}
          attachments={(threadRoot as any).attachments}
          threadReplies={[]}
          status={(threadRoot as any).status}
          recipientCount={(threadRoot as any).recipientPeerIds?.length ?? 0}
          ackedCount={(threadRoot as any).ackedBy?.length ?? 0}
          readCount={(threadRoot as any).readBy?.length ?? 0}
          {frequentReactions}
          {getPeerAlias}
          {onOpenThread}
          {onToggleReaction}
          {onRememberReaction}
          {onShowMessageInfo}
          {onImageClick}
          {resolveAttachmentImageUrl}
        />
      </div>
      <div class="thread-root-separator"><span>Thread</span></div>
    {/if}

    {#if loadingOlder && !inThreadView}
      <div class="load-older-indicator" aria-live="polite">Loading older messages...</div>
    {/if}

    <div class="message-virtual-anchor" aria-hidden="true"></div>

    {#if topSpacerHeight > 0}
      <div class="message-spacer" style={`height:${topSpacerHeight}px;`} aria-hidden="true"></div>
    {/if}

    {#each renderedMessages as msg, i (msg.id)}
      {@const msgProfile = getCompanySimProfile(msg.senderId)}
      <div
        style="display: contents;"
        data-testid="message-meta"
        data-view={inThreadView ? 'thread' : 'channel'}
        data-message-id={msg.id}
        data-sender-id={msg.senderId}
        data-sender-name={getSenderName(msg)}
        data-thread-id={msg.threadId || ''}
        data-role-title={msgProfile?.roleTitle || ''}
        data-automation-kind={msgProfile?.automationKind || ''}
      >
        <MessageItem
          id={msg.id}
          senderId={msg.senderId}
          senderName={getSenderName(msg)}
          content={msg.content}
          timestamp={msg.timestamp}
          type={msg.type}
          isMine={msg.senderId === myPeerId}
          isBot={isBot(msg.senderId)}
          modelLabel={getModelLabel(msg)}
          companySim={msgProfile}
          isGrouped={isGrouped(msg, i + visibleStartIndex, messages)}
          {inThreadView}
          isActiveThreadRoot={!inThreadView && !!activeThreadRootId && msg.id === activeThreadRootId}
          attachments={(msg as any).attachments}
          threadReplies={activeChannelId ? getThread(activeChannelId, msg.id) : []}
          status={(msg as any).status}
          recipientCount={(msg as any).recipientPeerIds?.length ?? 0}
          ackedCount={(msg as any).ackedBy?.length ?? 0}
          readCount={(msg as any).readBy?.length ?? 0}
          {frequentReactions}
          {getPeerAlias}
          {onOpenThread}
          {onToggleReaction}
          {onRememberReaction}
          {onShowMessageInfo}
          {onImageClick}
          {resolveAttachmentImageUrl}
        />
      </div>
    {/each}

    {#if bottomSpacerHeight > 0}
      <div class="message-spacer" style={`height:${bottomSpacerHeight}px;`} aria-hidden="true"></div>
    {/if}
  {/if}
</div>

<style>
  .message-virtual-anchor {
    height: 0;
    margin: 0;
    padding: 0;
    pointer-events: none;
  }

  .message-spacer {
    flex: 0 0 auto;
    width: 100%;
    pointer-events: none;
  }

  .load-older-indicator {
    text-align: center;
    padding: 8px 0;
    font-size: 12px;
    color: var(--text-light, #888);
    user-select: none;
  }
</style>
