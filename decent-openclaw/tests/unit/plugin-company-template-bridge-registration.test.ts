import { describe, expect, mock, test } from 'bun:test';

import plugin from '../../index.ts';

describe('decent-openclaw plugin registration', () => {
  test('registers channel plugin without exposing company-template http route', () => {
    const registerChannel = mock(() => {});
    const registerHttpRoute = mock(() => {});

    plugin.register({
      runtime: {
        config: {
          loadConfig: () => ({}),
          writeConfigFile: async () => {},
        },
      },
      logger: {
        info: () => {},
        warn: () => {},
        error: () => {},
      },
      registerChannel,
      registerHttpRoute,
    } as any);

    expect(registerChannel).toHaveBeenCalledTimes(1);
    expect(registerHttpRoute).toHaveBeenCalledTimes(0);
  });
});
