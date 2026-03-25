export type DecentLogLevel = 'error' | 'warn' | 'info' | 'debug' | 'trace';

export interface DecentLogConfig {
  consoleLevel?: DecentLogLevel;
  categoryLevels?: Record<string, DecentLogLevel | undefined>;
  bufferSize?: number;
}

export interface DecentLogEntry {
  ts: number;
  level: DecentLogLevel;
  category: string;
  scope?: string;
  message: string;
  args: unknown[];
}

export interface DecentLogger {
  trace: (message: string, ...args: unknown[]) => void;
  debug: (message: string, ...args: unknown[]) => void;
  info: (message: string, ...args: unknown[]) => void;
  warn: (message: string, ...args: unknown[]) => void;
  error: (message: string, ...args: unknown[]) => void;
  child: (scope: string, category?: string) => DecentLogger;
}

interface InternalLogState {
  buffer: DecentLogEntry[];
  runtimeConfig: DecentLogConfig;
}

const LEVEL_PRIORITY: Record<DecentLogLevel, number> = {
  error: 0,
  warn: 1,
  info: 2,
  debug: 3,
  trace: 4,
};

const DEFAULT_CONFIG: Required<DecentLogConfig> = {
  consoleLevel: 'warn',
  categoryLevels: {},
  bufferSize: 500,
};

function globalObj(): any {
  return globalThis as any;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function normalizeLevel(level: unknown): DecentLogLevel | undefined {
  switch (level) {
    case 'error':
    case 'warn':
    case 'info':
    case 'debug':
    case 'trace':
      return level;
    default:
      return undefined;
  }
}

function readLocalStorageConfig(): DecentLogConfig {
  try {
    const storage = globalObj()?.localStorage;
    if (!storage) return {};

    const consoleLevel = normalizeLevel(storage.getItem('decentchat.log.consoleLevel'));
    const bufferSizeRaw = storage.getItem('decentchat.log.bufferSize');
    const bufferSize = bufferSizeRaw ? Number(bufferSizeRaw) : undefined;

    let categoryLevels: Record<string, DecentLogLevel | undefined> | undefined;
    const categoryLevelsRaw = storage.getItem('decentchat.log.categoryLevels');
    if (categoryLevelsRaw) {
      const parsed = JSON.parse(categoryLevelsRaw);
      if (isRecord(parsed)) {
        categoryLevels = Object.fromEntries(
          Object.entries(parsed)
            .map(([key, value]) => [key, normalizeLevel(value)])
            .filter(([, value]) => !!value),
        );
      }
    }

    return {
      consoleLevel,
      categoryLevels,
      bufferSize: Number.isFinite(bufferSize) && (bufferSize as number) > 0 ? Math.floor(bufferSize as number) : undefined,
    };
  } catch {
    return {};
  }
}

function mergeConfig(...configs: Array<DecentLogConfig | undefined>): Required<DecentLogConfig> {
  const merged: Required<DecentLogConfig> = {
    consoleLevel: DEFAULT_CONFIG.consoleLevel,
    categoryLevels: { ...DEFAULT_CONFIG.categoryLevels },
    bufferSize: DEFAULT_CONFIG.bufferSize,
  };

  for (const config of configs) {
    if (!config) continue;
    if (config.consoleLevel) merged.consoleLevel = config.consoleLevel;
    if (config.categoryLevels) merged.categoryLevels = { ...merged.categoryLevels, ...config.categoryLevels };
    if (typeof config.bufferSize === 'number' && Number.isFinite(config.bufferSize) && config.bufferSize > 0) {
      merged.bufferSize = Math.max(1, Math.floor(config.bufferSize));
    }
  }

  return merged;
}

function getState(): InternalLogState {
  const g = globalObj();
  if (!g.__DECENT_LOG_STATE__) {
    const state: InternalLogState = {
      buffer: [],
      runtimeConfig: {},
    };
    g.__DECENT_LOG_STATE__ = state;
    exposeGlobalApi(state);
  }
  return g.__DECENT_LOG_STATE__ as InternalLogState;
}

function exposeGlobalApi(state: InternalLogState): void {
  const g = globalObj();

  if (!Object.getOwnPropertyDescriptor(g, '__DECENT_LOGS__')) {
    Object.defineProperty(g, '__DECENT_LOGS__', {
      configurable: true,
      enumerable: false,
      get: () => state.buffer,
    });
  }

  if (typeof g.__DECENT_GET_LOG_CONFIG__ !== 'function') {
    g.__DECENT_GET_LOG_CONFIG__ = () => getDecentLogConfig();
  }

  if (typeof g.__DECENT_SET_LOG_CONFIG__ !== 'function') {
    g.__DECENT_SET_LOG_CONFIG__ = (patch: DecentLogConfig) => setDecentLogConfig(patch);
  }

  if (typeof g.__DECENT_CLEAR_LOGS__ !== 'function') {
    g.__DECENT_CLEAR_LOGS__ = () => {
      state.buffer.splice(0, state.buffer.length);
    };
  }
}

export function getDecentLogConfig(): Required<DecentLogConfig> {
  const state = getState();
  const g = globalObj();
  const seededConfig = isRecord(g.__DECENT_LOG_CONFIG__) ? (g.__DECENT_LOG_CONFIG__ as DecentLogConfig) : undefined;
  const localConfig = readLocalStorageConfig();
  const effective = mergeConfig(DEFAULT_CONFIG, seededConfig, localConfig, state.runtimeConfig);
  const hasExplicitConsoleLevel = !!seededConfig?.consoleLevel || !!localConfig.consoleLevel || !!state.runtimeConfig.consoleLevel;
  if (!hasExplicitConsoleLevel && g.__DECENT_DEBUG === true) {
    effective.consoleLevel = 'debug';
  }
  return effective;
}

export function setDecentLogConfig(patch: DecentLogConfig): Required<DecentLogConfig> {
  const state = getState();
  state.runtimeConfig = {
    ...state.runtimeConfig,
    ...patch,
    categoryLevels: {
      ...(state.runtimeConfig.categoryLevels ?? {}),
      ...(patch.categoryLevels ?? {}),
    },
  };
  return getDecentLogConfig();
}

export function clearDecentLogConfig(): void {
  getState().runtimeConfig = {};
}

export function getDecentLogBuffer(): DecentLogEntry[] {
  return [...getState().buffer];
}

function shouldEmit(level: DecentLogLevel, category: string, config: Required<DecentLogConfig>): boolean {
  const threshold = config.categoryLevels[category] ?? config.consoleLevel;
  return LEVEL_PRIORITY[level] <= LEVEL_PRIORITY[threshold];
}

function consoleMethod(level: DecentLogLevel): (...args: unknown[]) => void {
  switch (level) {
    case 'error':
      return console.error.bind(console);
    case 'warn':
      return console.warn.bind(console);
    case 'info':
      return console.info.bind(console);
    case 'trace':
      return console.trace.bind(console);
    case 'debug':
    default:
      return console.debug.bind(console);
  }
}

function formatPrefix(category: string, scope?: string): string {
  return scope
    ? `[DecentChat][${category}][${scope}]`
    : `[DecentChat][${category}]`;
}

function writeEntry(entry: DecentLogEntry): void {
  const state = getState();
  const config = getDecentLogConfig();

  state.buffer.push(entry);
  if (state.buffer.length > config.bufferSize) {
    state.buffer.splice(0, state.buffer.length - config.bufferSize);
  }

  if (!shouldEmit(entry.level, entry.category, config)) return;
  consoleMethod(entry.level)(formatPrefix(entry.category, entry.scope), entry.message, ...entry.args);
}

export function createLogger(scope: string, category = 'app'): DecentLogger {
  const log = (level: DecentLogLevel, message: string, ...args: unknown[]): void => {
    writeEntry({
      ts: Date.now(),
      level,
      category,
      scope,
      message,
      args,
    });
  };

  return {
    trace: (message: string, ...args: unknown[]) => log('trace', message, ...args),
    debug: (message: string, ...args: unknown[]) => log('debug', message, ...args),
    info: (message: string, ...args: unknown[]) => log('info', message, ...args),
    warn: (message: string, ...args: unknown[]) => log('warn', message, ...args),
    error: (message: string, ...args: unknown[]) => log('error', message, ...args),
    child: (childScope: string, childCategory = category) => createLogger(`${scope}:${childScope}`, childCategory),
  };
}
