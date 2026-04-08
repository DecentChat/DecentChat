import { describe, test, expect, mock } from 'bun:test';
import { isChunkLoadError, renderChunkLoadError } from '../../src/lib/utils/chunkLoadError';

class FakeElement {
  style: { display: string } = { display: '' };
  innerHTML = '';
  private listeners = new Map<string, Array<() => void>>();

  addEventListener(type: string, listener: () => void): void {
    const existing = this.listeners.get(type) ?? [];
    existing.push(listener);
    this.listeners.set(type, existing);
  }

  click(): void {
    const handlers = this.listeners.get('click') ?? [];
    handlers.forEach((handler) => handler());
  }
}

class FakeDocument {
  constructor(private readonly elements: Record<string, FakeElement>) {}

  getElementById(id: string): FakeElement | null {
    return this.elements[id] ?? null;
  }
}

describe('isChunkLoadError', () => {
  test('detects browser dynamic import fetch failure message', () => {
    expect(isChunkLoadError(new Error('Failed to fetch dynamically imported module'))).toBe(true);
  });

  test('detects Webpack-style ChunkLoadError by name', () => {
    const err = new Error('Loading chunk 8 failed');
    (err as any).name = 'ChunkLoadError';
    expect(isChunkLoadError(err)).toBe(true);
  });

  test('does not classify ordinary startup errors as chunk-load failures', () => {
    expect(isChunkLoadError(new Error('IndexedDB blocked by another tab'))).toBe(false);
  });
});

describe('renderChunkLoadError', () => {
  test('renders retry UI and invokes retry callback on click', () => {
    const loading = new FakeElement();
    const app = new FakeElement();
    const retryButton = new FakeElement();
    const doc = new FakeDocument({
      loading,
      app,
      'chunk-retry-btn': retryButton,
    });

    const onRetry = mock(() => {});
    renderChunkLoadError({
      doc: doc as unknown as Document,
      onRetry,
    });

    expect(loading.style.display).toBe('none');
    expect(app.innerHTML).toContain('Failed to load latest app code');

    retryButton.click();
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  test('no-ops when #app is missing', () => {
    const loading = new FakeElement();
    const doc = new FakeDocument({ loading });

    expect(() => {
      renderChunkLoadError({
        doc: doc as unknown as Document,
        onRetry: () => {},
      });
    }).not.toThrow();

    expect(loading.style.display).toBe('none');
  });
});
