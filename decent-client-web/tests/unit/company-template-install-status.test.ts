import { describe, expect, mock, test } from 'bun:test';

import { describeCompanyTemplateInstallStatus } from '../../src/lib/company-sim/installStatus';
import {
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

  test('returns null when no bridge is injected on window', () => {
    const previousWindow = (globalThis as any).window;
    const previousFetch = globalThis.fetch;
    const fetchMock = mock(async () => {
      throw new Error('runtime bridge should not perform implicit HTTP fetches');
    });

    (globalThis as any).window = { location: { origin: 'http://127.0.0.1:1234' } };
    (globalThis as any).fetch = fetchMock as typeof fetch;

    try {
      expect(resolveCompanyTemplateRuntimeBridge()).toBeNull();
      expect(fetchMock).toHaveBeenCalledTimes(0);
    } finally {
      (globalThis as any).window = previousWindow;
      (globalThis as any).fetch = previousFetch;
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
});
