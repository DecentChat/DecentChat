import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import {
  clearDecentLogConfig,
  createLogger,
  getDecentLogBuffer,
  getDecentLogConfig,
  setDecentLogConfig,
} from '../../src/logging/Logger';

const g = globalThis as any;

function clearLocalStorageKeys(): void {
  try {
    localStorage.removeItem('decentchat.log.consoleLevel');
    localStorage.removeItem('decentchat.log.bufferSize');
    localStorage.removeItem('decentchat.log.categoryLevels');
  } catch {
    // ignore
  }
}

describe('Decent logger', () => {
  const originalConsole = {
    debug: console.debug,
    info: console.info,
    warn: console.warn,
    error: console.error,
    trace: console.trace,
  };

  let calls: Array<{ method: string; args: unknown[] }> = [];

  beforeEach(() => {
    calls = [];
    console.debug = (...args: unknown[]) => { calls.push({ method: 'debug', args }); };
    console.info = (...args: unknown[]) => { calls.push({ method: 'info', args }); };
    console.warn = (...args: unknown[]) => { calls.push({ method: 'warn', args }); };
    console.error = (...args: unknown[]) => { calls.push({ method: 'error', args }); };
    console.trace = (...args: unknown[]) => { calls.push({ method: 'trace', args }); };

    clearDecentLogConfig();
    g.__DECENT_CLEAR_LOGS__?.();
    delete g.__DECENT_DEBUG;
    delete g.__DECENT_LOG_CONFIG__;
    clearLocalStorageKeys();
  });

  afterEach(() => {
    console.debug = originalConsole.debug;
    console.info = originalConsole.info;
    console.warn = originalConsole.warn;
    console.error = originalConsole.error;
    console.trace = originalConsole.trace;

    clearDecentLogConfig();
    g.__DECENT_CLEAR_LOGS__?.();
    delete g.__DECENT_DEBUG;
    delete g.__DECENT_LOG_CONFIG__;
    clearLocalStorageKeys();
  });

  test('keeps suppressed entries in the in-memory buffer', () => {
    const logger = createLogger('ChatController', 'perf');
    logger.debug('handshake took longer than expected', { ms: 123 });

    expect(calls).toHaveLength(0);
    expect(getDecentLogBuffer()).toEqual([
      expect.objectContaining({
        level: 'debug',
        category: 'perf',
        scope: 'ChatController',
        message: 'handshake took longer than expected',
      }),
    ]);
  });

  test('emits warn and above by default', () => {
    const logger = createLogger('PeerTransport', 'transport');
    logger.info('connected to signaling');
    logger.warn('peer missed pong');

    expect(calls).toHaveLength(1);
    expect(calls[0]?.method).toBe('warn');
    expect(calls[0]?.args[0]).toBe('[DecentChat][transport][PeerTransport]');
    expect(calls[0]?.args[1]).toBe('peer missed pong');
  });

  test('category override can enable perf logs without globally enabling info/debug', () => {
    setDecentLogConfig({ categoryLevels: { perf: 'debug' } });
    const perfLogger = createLogger('ChatController', 'perf');
    const syncLogger = createLogger('ChatController', 'sync');

    perfLogger.debug('restore total', { ms: 88 });
    syncLogger.info('workspace sync complete');

    expect(calls).toHaveLength(1);
    expect(calls[0]?.method).toBe('debug');
    expect(calls[0]?.args[0]).toBe('[DecentChat][perf][ChatController]');
    expect(calls[0]?.args[1]).toBe('restore total');
  });

  test('debug flag raises default console level to debug', () => {
    g.__DECENT_DEBUG = true;
    const logger = createLogger('Main', 'app');

    logger.debug('debug mode enabled');

    expect(getDecentLogConfig().consoleLevel).toBe('debug');
    expect(calls).toHaveLength(1);
    expect(calls[0]?.method).toBe('debug');
  });
});
