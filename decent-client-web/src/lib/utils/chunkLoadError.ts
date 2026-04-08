export interface RenderChunkLoadErrorOptions {
  doc?: Document;
  onRetry?: () => void;
}

const CHUNK_LOAD_ERROR_PATTERNS = [
  'failed to fetch dynamically imported module',
  'error loading dynamically imported module',
  'loading chunk',
  'runtime chunk unavailable',
  'importing a module script failed',
];

function normalize(value: unknown): string {
  return String(value ?? '').toLowerCase();
}

function messageFromErrorLike(error: unknown): string {
  if (!error || typeof error !== 'object') return normalize(error);

  const maybeMessage = (error as { message?: unknown }).message;
  if (maybeMessage != null) return normalize(maybeMessage);

  return normalize(error);
}

function nameFromErrorLike(error: unknown): string {
  if (!error || typeof error !== 'object') return '';
  return normalize((error as { name?: unknown }).name);
}

export function isChunkLoadError(error: unknown): boolean {
  const name = nameFromErrorLike(error);
  const message = messageFromErrorLike(error);

  if (name === 'chunkloaderror' || name === 'importerror') return true;

  return CHUNK_LOAD_ERROR_PATTERNS.some((pattern) => message.includes(pattern));
}

function defaultRetry(): void {
  if (typeof window !== 'undefined') {
    window.location.reload();
  }
}

export function renderChunkLoadError(options: RenderChunkLoadErrorOptions = {}): void {
  const doc = options.doc ?? (typeof document !== 'undefined' ? document : undefined);
  if (!doc) return;

  const loading = doc.getElementById('loading');
  if (loading) {
    (loading as HTMLElement).style.display = 'none';
  }

  const app = doc.getElementById('app');
  if (!app) return;

  app.innerHTML = `
    <div style="display:flex;flex-direction:column;align-items:center;justify-content:center;height:100vh;padding:20px;text-align:center;gap:16px;">
      <div style="font-size:64px;">🔄</div>
      <h1 style="font-size:24px;font-weight:600;margin:0;">Failed to load latest app code</h1>
      <p style="max-width:640px;opacity:0.8;margin:0;line-height:1.45;">
        A recent update or temporary network issue prevented DecentChat from loading all required files.
      </p>
      <p style="max-width:640px;font-size:14px;opacity:0.65;margin:0;line-height:1.45;">
        Tap retry to refresh and load the latest version.
      </p>
      <div style="display:flex;gap:12px;margin-top:8px;flex-wrap:wrap;justify-content:center;">
        <button id="chunk-retry-btn" style="padding:12px 24px;background:#6c5ce7;color:#fff;border:none;border-radius:6px;cursor:pointer;font-size:14px;font-weight:600;">Tap to retry</button>
      </div>
    </div>
  `;

  const onRetry = options.onRetry ?? defaultRetry;
  doc.getElementById('chunk-retry-btn')?.addEventListener('click', onRetry);
}
