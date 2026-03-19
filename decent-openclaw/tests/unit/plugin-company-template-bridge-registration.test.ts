import { describe, expect, mock, test } from 'bun:test';

import plugin from '../../index.ts';
import { COMPANY_TEMPLATE_BRIDGE_HTTP_PATH } from '../../src/company-sim/template-runtime-bridge-http.ts';

describe('decent-openclaw plugin registration', () => {
  test('registers company template runtime bridge http route', () => {
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
    expect(registerHttpRoute).toHaveBeenCalledTimes(1);

    const route = registerHttpRoute.mock.calls[0]?.[0] as any;
    expect(route.path).toBe(COMPANY_TEMPLATE_BRIDGE_HTTP_PATH);
    expect(route.auth).toBe('plugin');
    expect(route.match).toBe('exact');
    expect(typeof route.handler).toBe('function');
  });
});
