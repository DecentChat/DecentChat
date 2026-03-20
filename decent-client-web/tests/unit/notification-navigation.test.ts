import { describe, expect, test } from 'bun:test';

import { navigateFromNotification } from '../../src/ui/notificationNavigation';

describe('navigateFromNotification', () => {
  test('switches workspace, channel, and thread for workspace thread notifications', () => {
    const calls: string[] = [];
    const state: any = {
      activeWorkspaceId: 'ws-current',
      activeChannelId: 'ch-current',
      activeThreadId: null,
      threadOpen: false,
    };

    navigateFromNotification({
      notification: {
        channelId: 'ch-target',
        workspaceId: 'ws-target',
        threadId: 'thread-7',
      },
      state,
      switchWorkspace: (workspaceId) => {
        calls.push(`switchWorkspace:${workspaceId}`);
        state.activeWorkspaceId = workspaceId;
        state.activeChannelId = 'ch-target';
      },
      switchChannel: (channelId) => {
        calls.push(`switchChannel:${channelId}`);
        state.activeChannelId = channelId;
      },
      switchToDirectConversation: (conversationId) => {
        calls.push(`switchDM:${conversationId}`);
      },
      openThread: (threadId) => {
        calls.push(`openThread:${threadId}`);
        state.threadOpen = true;
        state.activeThreadId = threadId;
      },
      resolveWorkspaceIdByChannelId: () => 'ws-target',
    });

    expect(calls).toEqual([
      'switchWorkspace:ws-target',
      'switchChannel:ch-target',
      'openThread:thread-7',
    ]);
  });

  test('opens direct conversation for standalone DM notifications', () => {
    const calls: string[] = [];
    const state: any = {
      activeWorkspaceId: 'ws-current',
      activeChannelId: 'ch-current',
      activeThreadId: null,
      threadOpen: false,
    };

    navigateFromNotification({
      notification: {
        channelId: 'dm-1',
      },
      state,
      switchWorkspace: (workspaceId) => calls.push(`switchWorkspace:${workspaceId}`),
      switchChannel: (channelId) => calls.push(`switchChannel:${channelId}`),
      switchToDirectConversation: (conversationId) => calls.push(`switchDM:${conversationId}`),
      openThread: (threadId) => calls.push(`openThread:${threadId}`),
      resolveWorkspaceIdByChannelId: () => null,
    });

    expect(calls).toEqual(['switchDM:dm-1']);
  });
});
