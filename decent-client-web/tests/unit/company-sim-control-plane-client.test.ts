import { describe, expect, test } from 'bun:test';

import {
  createCompanySimControlPlaneClient,
  normalizeCompanySimDocumentPayload,
  normalizeCompanySimEmployeeContext,
  normalizeCompanySimRoutingPreview,
  normalizeCompanySimState,
} from '../../src/lib/company-sim/controlPlane';
import { ChatController } from '../../src/app/ChatController';

describe('company-sim control-plane client', () => {
  test('requests state, docs, context, and routing preview through transport and normalizes responses', async () => {
    const calls: string[] = [];
    const client = createCompanySimControlPlaneClient({
      requestState: async ({ workspaceId }) => {
        calls.push(`state:${workspaceId}`);
        return {
          overview: {
            companyId: 'software-studio',
            companyName: 'Software Studio',
            counts: { employees: 3 },
            sourceState: 'ready',
            generatedState: 'warning',
            liveState: 'ready',
          },
          docs: [
            { id: 'company', relativePath: 'COMPANY.md', label: 'Company', required: true, exists: true, usedByEmployeeIds: ['manager', 'backend'] },
          ],
          employees: [
            { id: 'manager', accountId: 'team-manager', alias: 'Mira PM', title: 'Manager', channels: ['engineering'], participation: { mode: 'summary-first' } },
          ],
          channels: [
            { name: 'engineering', memberEmployeeIds: ['manager', 'backend'] },
          ],
          provisioning: {
            bootstrapEnabled: true,
            bootstrapMode: 'runtime',
            configuredAccountIds: ['team-manager'],
          },
        };
      },
      readDocument: async ({ relativePath }) => {
        calls.push(`read:${relativePath}`);
        return { doc: { id: 'company', relativePath, label: 'Company', required: true, exists: true }, content: '# Hello' };
      },
      writeDocument: async ({ relativePath, content }) => {
        calls.push(`write:${relativePath}`);
        return { doc: { id: 'company', relativePath, label: 'Company', required: true, exists: true }, content };
      },
      requestEmployeeContext: async ({ employeeId }) => {
        calls.push(`context:${employeeId}`);
        return {
          employeeId,
          alias: 'Mira PM',
          sections: [
            { id: 'company', title: 'COMPANY', relativePath: 'COMPANY.md', content: '# Company' },
          ],
        };
      },
      requestRoutingPreview: async ({ text }) => {
        calls.push(`preview:${text}`);
        return {
          companyId: 'software-studio',
          responders: [
            { employeeId: 'manager', alias: 'Mira PM', title: 'Manager', shouldRespond: true, reason: 'summary-thread', preferredReply: 'thread', explanation: 'summary trigger' },
          ],
        };
      },
    });

    const state = await client.getState({ workspaceId: 'ws-1' });
    const doc = await client.readDocument({ workspaceId: 'ws-1', relativePath: 'COMPANY.md' });
    const write = await client.writeDocument({ workspaceId: 'ws-1', relativePath: 'COMPANY.md', content: '# Updated' });
    const context = await client.getEmployeeContext({ workspaceId: 'ws-1', employeeId: 'manager' });
    const preview = await client.getRoutingPreview({ workspaceId: 'ws-1', chatType: 'channel', channelNameOrId: 'engineering', text: '[BLOCKED] waiting' });

    expect(calls).toEqual([
      'state:ws-1',
      'read:COMPANY.md',
      'write:COMPANY.md',
      'context:manager',
      'preview:[BLOCKED] waiting',
    ]);
    expect(state.overview.workspaceId).toBe('ws-1');
    expect(state.overview.counts.employees).toBe(3);
    expect(state.overview.counts.channels).toBe(0);
    expect(state.docs[0]?.relativePath).toBe('COMPANY.md');
    expect(doc.content).toBe('# Hello');
    expect(write.content).toBe('# Updated');
    expect(context.sections[0]?.relativePath).toBe('COMPANY.md');
    expect(preview.workspaceId).toBe('ws-1');
    expect(preview.chatType).toBe('channel');
    expect(preview.responders[0]?.employeeId).toBe('manager');
    expect(preview.suppressed).toEqual([]);
  });

  test('ChatController sends company-sim state requests to capable host peers and resolves responses', async () => {
    const sent: Array<{ peerId: string; msg: any; opts: any }> = [];
    const ctrl = Object.create(ChatController.prototype) as any;
    ctrl.state = {
      myPeerId: 'me-peer',
      readyPeers: new Set(['host-peer']),
    };
    ctrl.transport = {
      connect: async () => {},
    };
    ctrl.workspaceManager = {
      getWorkspace: (workspaceId: string) => workspaceId === 'ws-1'
        ? {
          id: 'ws-1',
          members: [
            { peerId: 'me-peer', role: 'owner' },
            { peerId: 'host-peer', role: 'member', isBot: true },
          ],
        }
        : null,
    };
    ctrl.peerSupportsCapability = (peerId: string, capability: string) => peerId === 'host-peer' && capability === 'company-template-control-v1';
    ctrl.sendControlWithRetry = (peerId: string, msg: any, opts: any) => {
      sent.push({ peerId, msg, opts });
      return true;
    };
    ctrl.pendingCompanySimControlRequests = new Map();
    ctrl.pendingCompanyTemplateInstallRequests = new Map();

    const requestPromise = ctrl.requestCompanySimStateViaControlPlane({ workspaceId: 'ws-1' });
    const [[requestId]] = ctrl.pendingCompanySimControlRequests.entries();

    await ctrl.handleSyncMessage('host-peer', {
      workspaceId: 'ws-1',
      sync: {
        type: 'company-sim-state-response',
        requestId,
        ok: true,
        result: {
          overview: {
            companyId: 'software-studio',
          },
        },
      },
    });

    const result = await requestPromise;
    expect(sent).toHaveLength(1);
    expect(sent[0]?.peerId).toBe('host-peer');
    expect(sent[0]?.msg?.sync?.type).toBe('company-sim-state-request');
    expect(sent[0]?.opts).toEqual({ label: 'company-sim-state' });
    expect(result).toEqual({ overview: { companyId: 'software-studio' } });
  });

  test('normalizes partial or null payloads into stable UI-safe defaults', () => {
    expect(normalizeCompanySimState(null, 'ws-fallback')).toEqual({
      overview: {
        workspaceId: 'ws-fallback',
        companyId: '',
        companyName: '',
        manifestPath: '',
        companyDirPath: '',
        counts: { employees: 0, teams: 0, channels: 0, docs: 0 },
        sourceState: 'unknown',
        generatedState: 'unknown',
        liveState: 'unknown',
        warnings: [],
      },
      teams: [],
      employees: [],
      channels: [],
      docs: [],
      provisioning: {
        bootstrapEnabled: false,
        bootstrapMode: null,
        manifestPath: '',
        configuredAccountIds: [],
        missingAccountIds: [],
        onlineReadyAccountIds: [],
        manualActionRequiredAccountIds: [],
      },
    });

    expect(normalizeCompanySimDocumentPayload({ content: 123 })).toEqual({
      doc: {
        id: '',
        relativePath: '',
        label: '',
        kind: 'company',
        required: false,
        exists: false,
        usedByEmployeeIds: [],
      },
      content: '',
    });

    expect(normalizeCompanySimEmployeeContext({ sections: [{}] })).toEqual({
      employeeId: '',
      alias: '',
      sections: [{ id: '', title: '', relativePath: '', content: '' }],
      prompt: '',
    });

    expect(normalizeCompanySimRoutingPreview({}, {
      workspaceId: 'ws-fallback',
      chatType: 'channel',
      channelNameOrId: 'general',
      text: 'hello',
    })).toEqual({
      workspaceId: 'ws-fallback',
      companyId: '',
      chatType: 'channel',
      channelNameOrId: 'general',
      text: 'hello',
      responders: [],
      suppressed: [],
    });
  });
});
