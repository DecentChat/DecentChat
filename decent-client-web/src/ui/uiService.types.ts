import type { PlaintextMessage, InviteData } from '@decentchat/protocol';
import type { HuddleState, HuddleParticipant } from '../huddle/HuddleManager';

export interface UIService {
  syncShellAll(): void;
  renderApp(): void;
  renderWelcome(): void;
  renderMessages(): void;
  renderThreadMessages(): void;
  appendMessageToDOM(msg: PlaintextMessage, container?: HTMLElement, animate?: boolean): void;
  updateSidebar(options?: { refreshContacts?: boolean }): void;
  updateChannelHeader(): void;
  updateWorkspaceRail(): void;
  updateMessageStatus(messageId: string, status: 'pending' | 'sent' | 'delivered' | 'read', detail?: { acked?: number; total?: number; read?: number }): void;
  updateStreamingMessage(messageId: string, content: string): void;
  finalizeStreamingMessage(messageId: string): void;
  updateThreadIndicator(parentMessageId: string, channelId: string): void;
  updateTypingIndicator(text: string): void;
  switchChannel(channelId: string): void;
  switchToDirectConversation(conversationId: string): void;
  switchWorkspace(workspaceId: string): void;
  openThread(messageId: string): void;
  closeThread(): void;
  refreshContactsCache(): Promise<void>;
  showCreateWorkspaceModal(): void;
  showJoinWorkspaceModal(): void;
  showJoinWithInvite(inviteCode: string, peerId: string, workspaceName: string, inviteData?: InviteData): void;
  showToast(message: string, type?: 'info' | 'error' | 'success'): void;
  onHuddleStateChange(state: HuddleState, channelId: string | null): void;
  onHuddleParticipantsChange(participants: HuddleParticipant[]): void;
  refreshActivityPanel(): void;
  reloadReactionUsage(): void;
}
