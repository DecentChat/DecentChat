import type { LoadedCompanyContext } from './context-loader.ts';
import { hasExplicitHandoffTarget, hasExplicitTaskOwner, hasSummaryTriggerTag, isAssignedChannel, isEmployeeMentioned, isHandoffTargetedToEmployee, isTaskOwnedByEmployee, matchesParticipationTopic } from './participation.ts';
import type { CompanyEmployeeConfig } from './types.ts';

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
    | 'not-task-owner'
    | 'handoff-target'
    | 'not-handoff-target'
    | 'thread-assignee'
    | 'not-thread-assignee'
    | 'suppressed-by-peer';
  preferredReply: 'channel' | 'thread';
}

type RoutingParams = {
  context: LoadedCompanyContext | null;
  chatType: 'direct' | 'channel';
  channelNameOrId?: string;
  text: string;
  threadId?: string;
  threadAssignedEmployeeId?: string;
};

const SUPPRESSIBLE_SPECIALIST_REASONS = new Set<CompanyRoutingDecision['reason']>([
  'specialist-thread',
  'owned-channel',
]);

function decideBaseCompanyParticipationForEmployee(params: RoutingParams, employeeOverride?: CompanyEmployeeConfig): CompanyRoutingDecision {
  const context = params.context;
  if (!context) {
    return { shouldRespond: true, reason: 'not-company-sim', preferredReply: params.threadId ? 'thread' : 'channel' };
  }

  const employee = employeeOverride ?? context.employee;
  const participation = employee.participation;
  const mentioned = isEmployeeMentioned(params.text, employee);
  const assignedChannel = isAssignedChannel(employee, params.channelNameOrId);
  const topicMatch = matchesParticipationTopic(params.text, participation.respondToChannelTopics);
  const inThread = Boolean(params.threadId);
  const summaryTrigger = hasSummaryTriggerTag(params.text);
  const explicitTaskOwner = hasExplicitTaskOwner(params.text);
  const taskOwnerMatch = isTaskOwnedByEmployee(params.text, employee);
  const explicitHandoffTarget = hasExplicitHandoffTarget(params.text);
  const handoffTargetMatch = isHandoffTargetedToEmployee(params.text, employee);
  const threadAssignedEmployeeId = params.threadAssignedEmployeeId?.trim() || undefined;
  const threadAssigneeMatch = Boolean(threadAssignedEmployeeId && threadAssignedEmployeeId === employee.id);

  if (params.chatType === 'direct') {
    return { shouldRespond: true, reason: 'direct-message', preferredReply: 'channel' };
  }

  if (mentioned && participation.respondWhenMentioned !== false) {
    return { shouldRespond: true, reason: 'mentioned', preferredReply: inThread ? 'thread' : 'thread' };
  }

  if (explicitTaskOwner && taskOwnerMatch) {
    return { shouldRespond: true, reason: 'task-owner', preferredReply: 'thread' };
  }

  if (explicitHandoffTarget && handoffTargetMatch) {
    return { shouldRespond: true, reason: 'handoff-target', preferredReply: 'thread' };
  }

  switch (participation.mode) {
    case 'mention-only':
      return { shouldRespond: false, reason: 'not-mentioned', preferredReply: 'thread' };

    case 'silent-unless-routed':
      if (explicitTaskOwner && !taskOwnerMatch) {
        return { shouldRespond: false, reason: 'not-task-owner', preferredReply: 'thread' };
      }
      if (explicitHandoffTarget && !handoffTargetMatch) {
        return { shouldRespond: false, reason: 'not-handoff-target', preferredReply: 'thread' };
      }
      if (threadAssignedEmployeeId && !threadAssigneeMatch) {
        return { shouldRespond: false, reason: 'not-thread-assignee', preferredReply: 'thread' };
      }
      if (threadAssignedEmployeeId && threadAssigneeMatch) {
        return { shouldRespond: true, reason: 'thread-assignee', preferredReply: 'thread' };
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
      if (explicitHandoffTarget && !handoffTargetMatch) {
        return { shouldRespond: false, reason: 'not-handoff-target', preferredReply: 'thread' };
      }
      if (threadAssignedEmployeeId && !threadAssigneeMatch) {
        return { shouldRespond: false, reason: 'not-thread-assignee', preferredReply: 'thread' };
      }
      if (threadAssignedEmployeeId && threadAssigneeMatch) {
        return { shouldRespond: true, reason: 'thread-assignee', preferredReply: 'thread' };
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

function shouldSuppressForPeerWinner(params: RoutingParams, currentDecision: CompanyRoutingDecision): boolean {
  const context = params.context;
  if (!context || !currentDecision.shouldRespond) return false;
  if (!SUPPRESSIBLE_SPECIALIST_REASONS.has(currentDecision.reason)) return false;

  const winner = context.manifest.employees.find((employee) => {
    const decision = decideBaseCompanyParticipationForEmployee(params, employee);
    return decision.shouldRespond && SUPPRESSIBLE_SPECIALIST_REASONS.has(decision.reason);
  });

  if (!winner) return false;
  return winner.id !== context.employee.id;
}

export function decideCompanyParticipation(params: RoutingParams): CompanyRoutingDecision {
  const baseDecision = decideBaseCompanyParticipationForEmployee(params);
  if (shouldSuppressForPeerWinner(params, baseDecision)) {
    return { shouldRespond: false, reason: 'suppressed-by-peer', preferredReply: baseDecision.preferredReply };
  }
  return baseDecision;
}

export function describeCompanyRoutingDecision(
  decision: CompanyRoutingDecision,
  employee: { alias: string; title: string },
): string {
  const name = employee.alias || employee.title;
  switch (decision.reason) {
    case 'not-company-sim':
      return `${name} is not in a company sim context.`;
    case 'direct-message':
      return `${name} responds because this is a direct message.`;
    case 'mentioned':
      return `${name} responds because they were mentioned.`;
    case 'summary-thread':
      return `${name} responds because a summary trigger tag was detected in an assigned thread.`;
    case 'summary-topic':
      return `${name} responds because the channel topic matches their configured interests.`;
    case 'specialist-thread':
      return `${name} responds as assigned specialist in this thread/channel.`;
    case 'owned-channel':
      return `${name} responds because they own this channel.`;
    case 'task-owner':
      return `${name} responds because they are the explicit task owner.`;
    case 'silent-unless-routed':
      return `${name} is silent unless explicitly routed to by mention, task assignment, or handoff.`;
    case 'not-mentioned':
      return `${name} is silent because they were not mentioned.`;
    case 'not-owned-channel':
      return `${name} is silent because this is not their assigned channel.`;
    case 'threads-only':
      return `${name} is silent because they only respond in threads, not top-level messages.`;
    case 'awaiting-summary-signal':
      return `${name} is silent, waiting for a summary trigger tag ([BLOCKED], [HANDOFF], [DONE]) before responding in this thread.`;
    case 'not-task-owner':
      return `${name} is silent because another employee is the explicit task owner.`;
    case 'suppressed-by-peer':
      return `${name} is silent because another employee won the peer routing decision.`;
    default:
      return `${name}: ${decision.reason}`;
  }
}
