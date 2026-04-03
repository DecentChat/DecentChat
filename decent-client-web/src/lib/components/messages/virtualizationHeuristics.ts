export interface VirtualizationConfig {
  initialWindowSize: number;
  minWindowSize: number;
  maxWindowSize: number;
  viewportOverscanPx: number;
  nearBottomPx: number;
  searchWindowSize: number;
}

export const MAIN_VIRTUALIZATION: VirtualizationConfig = {
  initialWindowSize: 140,
  minWindowSize: 120,
  maxWindowSize: 260,
  viewportOverscanPx: 520,
  nearBottomPx: 80,
  searchWindowSize: 220,
};

export const THREAD_VIRTUALIZATION: VirtualizationConfig = {
  initialWindowSize: 92,
  minWindowSize: 72,
  maxWindowSize: 180,
  viewportOverscanPx: 360,
  nearBottomPx: 64,
  searchWindowSize: 150,
};

// Spacer continuity estimates (custom virtualizer, no external dependency).
export const DEFAULT_MESSAGE_HEIGHT = 76;
export const MIN_ESTIMATED_HEIGHT = 40;
export const MAX_ESTIMATED_HEIGHT = 280;
export const MESSAGE_VERTICAL_GAP_PX = 1;
const SYSTEM_MESSAGE_BASE_HEIGHT = 36;
const MESSAGE_CHROME_HEIGHT = 34;
const GROUPED_MESSAGE_CHROME_HEIGHT = 8;
const MIN_MESSAGE_CONTENT_HEIGHT = 22;
const ATTACHMENT_ROW_HEIGHT = 56;
const ATTACHMENT_BLOCK_PADDING = 8;

const clamp = (value: number, min: number, max: number): number => Math.max(min, Math.min(max, value));

export function computeAdaptiveWindowSize(options: {
  containerHeight: number;
  averageRowHeight: number;
  config: VirtualizationConfig;
}): number {
  const { containerHeight, averageRowHeight, config } = options;
  const safeRowHeight = Math.max(MIN_ESTIMATED_HEIGHT, averageRowHeight);
  const rowsPerViewport = Math.max(1, Math.ceil(containerHeight / safeRowHeight));
  const adaptive = Math.max(config.initialWindowSize, rowsPerViewport * 3);
  return clamp(adaptive, config.minWindowSize, config.maxWindowSize);
}

export function computeSmoothedAverageHeight(options: {
  previousAverage: number;
  observedAverage: number;
  minHeight: number;
  maxHeight: number;
  blendWeight?: number;
  maxStep?: number;
}): number {
  const {
    previousAverage,
    observedAverage,
    minHeight,
    maxHeight,
    blendWeight = 0.2,
    maxStep = 2.5,
  } = options;

  const blended = clamp(
    (previousAverage * (1 - blendWeight)) + (observedAverage * blendWeight),
    minHeight,
    maxHeight,
  );

  const delta = blended - previousAverage;
  if (Math.abs(delta) <= maxStep) {
    return blended;
  }

  return clamp(previousAverage + (Math.sign(delta) * maxStep), minHeight, maxHeight);
}

export function shouldKeepBottomAnchored(options: {
  isNearBottom: boolean;
  pinnedUntilMs: number;
  nowMs: number;
}): boolean {
  return options.isNearBottom || options.nowMs < options.pinnedUntilMs;
}

export function shouldApplyTopSpacerCompensation(topDelta: number, thresholdPx = 1): boolean {
  return Math.abs(topDelta) > thresholdPx;
}

export function estimateMessageHeightFromContent(options: {
  type: 'text' | 'file' | 'system';
  contentHeightPx?: number | null;
  isGrouped: boolean;
  attachmentCount?: number;
}): number {
  const { type, contentHeightPx, isGrouped, attachmentCount = 0 } = options;

  if (type === 'system') {
    return clamp(SYSTEM_MESSAGE_BASE_HEIGHT + MESSAGE_VERTICAL_GAP_PX, MIN_ESTIMATED_HEIGHT, MAX_ESTIMATED_HEIGHT);
  }

  const safeContentHeight = Number.isFinite(contentHeightPx)
    ? Math.max(MIN_MESSAGE_CONTENT_HEIGHT, Number(contentHeightPx))
    : MIN_MESSAGE_CONTENT_HEIGHT;

  const normalizedAttachmentCount = Math.max(0, Math.min(attachmentCount, 6));
  const attachmentHeight = normalizedAttachmentCount > 0
    ? (normalizedAttachmentCount * ATTACHMENT_ROW_HEIGHT) + ATTACHMENT_BLOCK_PADDING
    : 0;

  const chromeHeight = isGrouped ? GROUPED_MESSAGE_CHROME_HEIGHT : MESSAGE_CHROME_HEIGHT;

  return clamp(
    chromeHeight + safeContentHeight + attachmentHeight + MESSAGE_VERTICAL_GAP_PX,
    MIN_ESTIMATED_HEIGHT,
    MAX_ESTIMATED_HEIGHT,
  );
}
