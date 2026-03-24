import { describe, expect, test } from 'bun:test';
import { WorkspaceStateSyncDeduper, buildWorkspaceStateFingerprint } from '../../src/app/workspaceStateSyncDeduper';

describe('workspace state sync deduper', () => {
  test('suppresses repeated identical payloads inside cooldown window', () => {
    const deduper = new WorkspaceStateSyncDeduper(5000);
    const key = 'ws-1';
    const peerId = 'peer-a';
    const payload = {
      name: 'Studio',
      channels: [{ id: 'ch-1', name: 'general', type: 'channel' }],
      members: [{ peerId: 'peer-a', alias: 'Alice', role: 'owner' }],
    };
    const fingerprint = buildWorkspaceStateFingerprint('ws-1', payload);

    expect(deduper.shouldProcess(key, peerId, fingerprint, 1_000)).toBe(true);
    expect(deduper.shouldProcess(key, peerId, fingerprint, 2_000)).toBe(false);
    expect(deduper.shouldProcess(key, peerId, fingerprint, 5_999)).toBe(false);
  });

  test('suppresses identical payloads from different peers inside cooldown window', () => {
    const deduper = new WorkspaceStateSyncDeduper(5000);
    const key = 'ws-1';
    const payload = {
      name: 'Studio',
      channels: [{ id: 'ch-1', name: 'general', type: 'channel' }],
      members: [{ peerId: 'peer-owner', alias: 'Owner', role: 'owner' }],
    };
    const fingerprint = buildWorkspaceStateFingerprint('ws-1', payload);

    expect(deduper.shouldProcess(key, 'peer-a', fingerprint, 1_000)).toBe(true);
    expect(deduper.shouldProcess(key, 'peer-b', fingerprint, 2_000)).toBe(false);
  });

  test('allows identical payloads after cooldown window', () => {
    const deduper = new WorkspaceStateSyncDeduper(5000);
    const key = 'ws-1';
    const peerId = 'peer-a';
    const payload = {
      name: 'Studio',
      channels: [{ id: 'ch-1', name: 'general', type: 'channel' }],
      members: [{ peerId: 'peer-a', alias: 'Alice', role: 'owner' }],
    };
    const fingerprint = buildWorkspaceStateFingerprint('ws-1', payload);

    expect(deduper.shouldProcess(key, peerId, fingerprint, 1_000)).toBe(true);
    expect(deduper.shouldProcess(key, peerId, fingerprint, 6_001)).toBe(true);
  });

  test('processes changed payload immediately even inside cooldown', () => {
    const deduper = new WorkspaceStateSyncDeduper(5000);
    const key = 'ws-1';
    const peerId = 'peer-a';
    const base = {
      name: 'Studio',
      channels: [{ id: 'ch-1', name: 'general', type: 'channel' }],
      members: [{ peerId: 'peer-a', alias: 'Alice', role: 'owner' }],
    };
    const changed = {
      ...base,
      channels: [...base.channels, { id: 'ch-2', name: 'random', type: 'channel' }],
    };
    const baseFp = buildWorkspaceStateFingerprint('ws-1', base);
    const changedFp = buildWorkspaceStateFingerprint('ws-1', changed);

    expect(baseFp).not.toBe(changedFp);
    expect(deduper.shouldProcess(key, peerId, baseFp, 1_000)).toBe(true);
    expect(deduper.shouldProcess(key, peerId, changedFp, 2_000)).toBe(true);
  });
});
