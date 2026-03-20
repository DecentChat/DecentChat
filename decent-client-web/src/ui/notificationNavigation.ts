export interface NotificationTarget {
  channelId: string;
  workspaceId?: string;
  threadId?: string;
}

interface NavigateFromNotificationArgs {
  notification: NotificationTarget;
  state: {
    activeWorkspaceId: string | null;
    activeChannelId: string | null;
    activeThreadId: string | null;
    threadOpen: boolean;
  };
  switchWorkspace: (workspaceId: string) => void;
  switchChannel: (channelId: string) => void;
  switchToDirectConversation: (conversationId: string) => void;
  openThread: (threadId: string) => void;
  resolveWorkspaceIdByChannelId: (channelId: string) => string | null;
}

export function navigateFromNotification({
  notification,
  state,
  switchWorkspace,
  switchChannel,
  switchToDirectConversation,
  openThread,
  resolveWorkspaceIdByChannelId,
}: NavigateFromNotificationArgs): void {
  const targetWorkspaceId = notification.workspaceId ?? resolveWorkspaceIdByChannelId(notification.channelId);
  const needsWorkspaceSwitch = !!(targetWorkspaceId && targetWorkspaceId !== state.activeWorkspaceId);

  if (targetWorkspaceId) {
    if (needsWorkspaceSwitch) {
      switchWorkspace(targetWorkspaceId);
    }

    if (needsWorkspaceSwitch || notification.channelId !== state.activeChannelId) {
      switchChannel(notification.channelId);
    }
  } else {
    switchToDirectConversation(notification.channelId);
  }

  if (notification.threadId && (!state.threadOpen || state.activeThreadId !== notification.threadId)) {
    openThread(notification.threadId);
  }
}
