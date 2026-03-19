import { describe, expect, mock, test } from 'bun:test';

import { describeCompanyTemplateInstallStatus } from '../../src/lib/company-sim/installStatus';
import {
  COMPANY_TEMPLATE_BRIDGE_HTTP_PATH,
  CompanyTemplateRuntimeBridgeHttpError,
  normalizeRuntimeBridgeInstallResult,
  resolveCompanyTemplateRuntimeBridge,
} from '../../src/lib/company-sim/runtimeBridge';

describe('company template install status', () => {
  test('reports truthful manual actions for workspace-shell mode', () => {
    const status = describeCompanyTemplateInstallStatus({
      provisioningMode: 'workspace-shell',
      provisionedAccountIds: [],
      onlineReadyAccountIds: [],
      manualActionRequiredAccountIds: [],
    });

    expect(status.statusHeadline).toContain('Runtime provisioning pending');
    expect(status.manualActionItems).toContain(
      'Run the decent-openclaw company template installer to provision real accounts/agents.',
    );
  });

  test('reports restart requirement for config-provisioned mode', () => {
    const status = describeCompanyTemplateInstallStatus({
      provisioningMode: 'config-provisioned',
      provisionedAccountIds: ['backend', 'qa'],
      onlineReadyAccountIds: ['backend', 'qa'],
      manualActionRequiredAccountIds: ['backend'],
    });

    expect(status.statusHeadline).toContain('runtime apply pending');
    expect(status.statusDetail).toContain('Provisioned 2 account(s)');
    expect(status.manualActionItems.some((item) => item.includes('Restart/reload OpenClaw'))).toBeTrue();
    expect(status.manualActionItems.some((item) => item.includes('backend'))).toBeTrue();
  });

  test('uses success headline for runtime-provisioned mode without manual actions', () => {
    const status = describeCompanyTemplateInstallStatus({
      provisioningMode: 'runtime-provisioned',
      provisionedAccountIds: ['backend', 'qa'],
      onlineReadyAccountIds: ['backend', 'manager', 'qa'],
      manualActionRequiredAccountIds: [],
    });

    expect(status.statusHeadline).toContain('runtime-applied');
    expect(status.manualActionItems).toHaveLength(0);
  });
});

describe('runtime bridge normalization', () => {
  test('normalizes bridge payload and sorts arrays', () => {
    const normalized = normalizeRuntimeBridgeInstallResult({
      provisioningMode: 'runtime-provisioned',
      createdAccountIds: ['qa', 'backend', 'backend'],
      provisionedAccountIds: ['qa', 'backend'],
      onlineReadyAccountIds: ['manager', 'qa', 'backend'],
      manualActionRequiredAccountIds: ['backend', 'backend'],
      manualActionItems: ['  step 2', 'step 1  ', 'step 1'],
    });

    expect(normalized.provisioningMode).toBe('runtime-provisioned');
    expect(normalized.createdAccountIds).toEqual(['backend', 'qa']);
    expect(normalized.manualActionRequiredAccountIds).toEqual(['backend']);
    expect(normalized.manualActionItems).toEqual(['step 1', 'step 2']);
  });

  test('returns null when window is unavailable', () => {
    const previous = (globalThis as any).window;
    (globalThis as any).window = undefined;

    try {
      expect(resolveCompanyTemplateRuntimeBridge()).toBeNull();
    } finally {
      (globalThis as any).window = previous;
    }
  });

  test('prefers injected runtime bridge when provided on window', () => {
    const previousWindow = (globalThis as any).window;
    const previousFetch = globalThis.fetch;
    const installTemplate = () => ({ provisioningMode: 'config-provisioned' as const });
    const fetchMock = mock(async () => {
      throw new Error('should not fetch when injected bridge exists');
    });

    (globalThis as any).window = {
      __DECENT_COMPANY_TEMPLATE_BRIDGE__: {
        installTemplate,
      },
    };
    (globalThis as any).fetch = fetchMock as typeof fetch;

    try {
      const bridge = resolveCompanyTemplateRuntimeBridge();
      expect(bridge).not.toBeNull();
      expect(bridge?.installTemplate).toBe(installTemplate);
      expect(fetchMock).toHaveBeenCalledTimes(0);
    } finally {
      (globalThis as any).window = previousWindow;
      (globalThis as any).fetch = previousFetch;
    }
  });


  test('throws typed bridge errors for non-OK HTTP responses', async () => {
    const previousWindow = (globalThis as any).window;
    const previousFetch = globalThis.fetch;

    const fetchMock = mock(async () => new Response(JSON.stringify({ error: 'Forbidden' }), {
      status: 403,
      headers: { 'content-type': 'application/json' },
    }));

    (globalThis as any).window = {
      location: { origin: 'http://127.0.0.1:1234' },
    };
    (globalThis as any).fetch = fetchMock as typeof fetch;

    try {
      const bridge = resolveCompanyTemplateRuntimeBridge();
      expect(bridge).not.toBeNull();

      await expect(bridge?.listTemplates?.()).rejects.toBeInstanceOf(CompanyTemplateRuntimeBridgeHttpError);
      await expect(bridge?.listTemplates?.()).rejects.toMatchObject({
        status: 403,
        message: 'Forbidden',
      });
    } finally {
      (globalThis as any).window = previousWindow;
      (globalThis as any).fetch = previousFetch;
    }
  });

  test('creates built-in HTTP bridge and parses list/install responses', async () => {
    const previousWindow = (globalThis as any).window;
    const previousFetch = globalThis.fetch;

    const fetchMock = mock(async (_input: RequestInfo | URL, init?: RequestInit) => {
      const method = init?.method ?? 'GET';
      if (method === 'GET') {
        return new Response(
          JSON.stringify({
            templates: [
              {
                id: 'software-studio',
                label: 'Software Studio',
                description: 'Preset',
                channels: ['general'],
                roles: [],
                questions: [],
              },
            ],
          }),
          {
            status: 200,
            headers: { 'content-type': 'application/json' },
          },
        );
      }

      return new Response(
        JSON.stringify({
          result: {
            provisioningMode: 'config-provisioned',
            createdAccountIds: ['manager'],
            provisionedAccountIds: ['manager'],
            onlineReadyAccountIds: ['manager'],
            manualActionRequiredAccountIds: [],
            manualActionItems: ['Restart/reload OpenClaw so runtime bootstrap applies the new company manifest.'],
          },
        }),
        {
          status: 200,
          headers: { 'content-type': 'application/json' },
        },
      );
    });

    (globalThis as any).window = {
      location: { origin: 'http://127.0.0.1:1234' },
    };
    (globalThis as any).fetch = fetchMock as typeof fetch;

    try {
      const bridge = resolveCompanyTemplateRuntimeBridge();
      expect(bridge).not.toBeNull();

      const templates = await bridge?.listTemplates?.();
      expect(templates).toHaveLength(1);
      expect(templates?.[0]?.id).toBe('software-studio');

      const installResult = await bridge?.installTemplate?.({
        templateId: 'software-studio',
        workspaceId: 'ws-1',
        answers: { companyName: 'Acme' },
      });

      expect(installResult?.provisioningMode).toBe('config-provisioned');
      expect(fetchMock).toHaveBeenCalledTimes(2);
      expect(fetchMock).toHaveBeenNthCalledWith(
        1,
        COMPANY_TEMPLATE_BRIDGE_HTTP_PATH,
        {
          method: 'GET',
          credentials: 'same-origin',
          headers: {
            accept: 'application/json',
          },
        },
      );

      expect(fetchMock).toHaveBeenNthCalledWith(
        2,
        COMPANY_TEMPLATE_BRIDGE_HTTP_PATH,
        {
          method: 'POST',
          credentials: 'same-origin',
          headers: {
            accept: 'application/json',
            'content-type': 'application/json',
          },
          body: JSON.stringify({
            templateId: 'software-studio',
            workspaceId: 'ws-1',
            answers: { companyName: 'Acme' },
          }),
        },
      );
    } finally {
      (globalThis as any).window = previousWindow;
      (globalThis as any).fetch = previousFetch;
    }
  });
});
