import type { LoadedCompanyContext } from './context-loader.ts';
import { hasExplicitTaskOwner, hasSummaryTriggerTag, isAssignedChannel, isEmployeeMentioned, isTaskOwnedByEmployee, matchesParticipationTopic } from './participation.ts';

export interface CompanyRoutingDecision {
  shouldRespond: boolean;
  reason:
    | 'not-company-sim'
    | 'direct-message'
    | 'mentioned'
    | 'summary-thread'
    | 'summary-topic'
    | 'specialist-thread'
    | 'owned-channel'
    | 'silent-unless-routed'
    | 'not-mentioned'
    | 'not-owned-channel'
    | 'threads-only'
    | 'awaiting-summary-signal'
    | 'task-owner'
    | 'not-task-owner';
  preferredReply: 'channel' | 'thread';
}

export function decideCompanyParticipation(params: {
  context: LoadedCompanyContext | null;
  chatType: 'direct' | 'channel';
  channelNameOrId?: string;
  text: string;
  threadId?: string;
}): CompanyRoutingDecision {
  const context = params.context;
  if (!context) {
    return { shouldRespond: true, reason: 'not-company-sim', preferredReply: params.threadId ? 'thread' : 'channel' };
  }

  const employee = context.employee;
  const participation = employee.participation;
  const mentioned = isEmployeeMentioned(params.text, employee);
  const assignedChannel = isAssignedChannel(employee, params.channelNameOrId);
  const topicMatch = matchesParticipationTopic(params.text, participation.respondToChannelTopics);
  const inThread = Boolean(params.threadId);
  const summaryTrigger = hasSummaryTriggerTag(params.text);
  const explicitTaskOwner = hasExplicitTaskOwner(params.text);
  const taskOwnerMatch = isTaskOwnedByEmployee(params.text, employee);

  if (params.chatType === 'direct') {
    return { shouldRespond: true, reason: 'direct-message', preferredReply: 'channel' };
  }

  if (mentioned && participation.respondWhenMentioned !== false) {
    return { shouldRespond: true, reason: 'mentioned', preferredReply: inThread ? 'thread' : 'thread' };
  }

  if (explicitTaskOwner && taskOwnerMatch) {
    return { shouldRespond: true, reason: 'task-owner', preferredReply: 'thread' };
  }

  switch (participation.mode) {
    case 'mention-only':
      return { shouldRespond: false, reason: 'not-mentioned', preferredReply: 'thread' };

    case 'silent-unless-routed':
      if (explicitTaskOwner && !taskOwnerMatch) {
        return { shouldRespond: false, reason: 'not-task-owner', preferredReply: 'thread' };
      }
      if (inThread && assignedChannel) {
        return { shouldRespond: true, reason: 'specialist-thread', preferredReply: 'thread' };
      }
      return { shouldRespond: false, reason: 'silent-unless-routed', preferredReply: 'thread' };

    case 'specialist':
      if (!assignedChannel) {
        return { shouldRespond: false, reason: 'not-owned-channel', preferredReply: 'thread' };
      }
      if (explicitTaskOwner && !taskOwnerMatch) {
        return { shouldRespond: false, reason: 'not-task-owner', preferredReply: 'thread' };
      }
      if (participation.replyInThreadsOnly && !inThread) {
        return { shouldRespond: false, reason: 'threads-only', preferredReply: 'thread' };
      }
      return { shouldRespond: true, reason: 'specialist-thread', preferredReply: 'thread' };

    case 'summary-first':
      if (inThread && assignedChannel && summaryTrigger) {
        return { shouldRespond: true, reason: 'summary-thread', preferredReply: 'thread' };
      }
      if (inThread && assignedChannel) {
        return { shouldRespond: false, reason: 'awaiting-summary-signal', preferredReply: 'thread' };
      }
      if (assignedChannel && topicMatch) {
        return { shouldRespond: true, reason: 'summary-topic', preferredReply: 'channel' };
      }
      return { shouldRespond: false, reason: assignedChannel ? 'not-mentioned' : 'not-owned-channel', preferredReply: 'channel' };

    case 'proactive-on-owned-channel':
      if (assignedChannel) {
        return { shouldRespond: true, reason: 'owned-channel', preferredReply: inThread ? 'thread' : 'channel' };
      }
      return { shouldRespond: false, reason: 'not-owned-channel', preferredReply: inThread ? 'thread' : 'channel' };
  }
}
