import type { PlaintextMessage } from './types';

export type MessageReceiptType = 'ack' | 'read';

export interface MessageReceiptPayload {
  type: MessageReceiptType;
  channelId: string;
  messageId: string;
}

export interface RoutedMessageReceiptPayload extends MessageReceiptPayload {
  _receiptFromPeerId?: string;
  _receiptTargetPeerId?: string;
}

export interface ApplyMessageReceiptOptions {
  peerId: string;
  type: MessageReceiptType;
  at?: number;
  allowedRecipients?: string[];
  statusRecipients?: string[];
}

export interface ApplyMessageReceiptResult {
  accepted: boolean;
  changed: boolean;
  message: PlaintextMessage;
  counts: {
    acked: number;
    read: number;
    total: number;
  };
  status: PlaintextMessage['status'];
}

function normalizeRecipients(recipients: string[] | undefined, senderId?: string): string[] {
  if (!Array.isArray(recipients)) return [];
  return Array.from(new Set(
    recipients.filter((id): id is string => typeof id === 'string' && id.length > 0 && id !== senderId),
  ));
}

function statusRank(status: PlaintextMessage['status']): number {
  switch (status) {
    case 'read':
      return 3;
    case 'delivered':
      return 2;
    case 'sent':
      return 1;
    case 'pending':
    default:
      return 0;
  }
}

export function applyMessageReceipt(
  message: PlaintextMessage,
  options: ApplyMessageReceiptOptions,
): ApplyMessageReceiptResult {
  const allowedRecipients = normalizeRecipients(options.allowedRecipients ?? message.recipientPeerIds, message.senderId);
  if (allowedRecipients.length > 0 && !allowedRecipients.includes(options.peerId)) {
    return {
      accepted: false,
      changed: false,
      message,
      counts: {
        acked: normalizeRecipients(message.ackedBy, message.senderId).length,
        read: normalizeRecipients(message.readBy, message.senderId).length,
        total: normalizeRecipients(options.statusRecipients ?? allowedRecipients, message.senderId).length,
      },
      status: message.status,
    };
  }

  const at = typeof options.at === 'number' ? options.at : Date.now();
  const statusRecipients = normalizeRecipients(options.statusRecipients ?? allowedRecipients, message.senderId);
  const ackedBy = new Set(normalizeRecipients(message.ackedBy, message.senderId));
  const readBy = new Set(normalizeRecipients(message.readBy, message.senderId));
  const ackedAt: Record<string, number> = { ...(message.ackedAt || {}) };
  const readAt: Record<string, number> = { ...(message.readAt || {}) };

  const prevAck = ackedBy.has(options.peerId);
  const prevRead = readBy.has(options.peerId);

  ackedBy.add(options.peerId);
  if (!ackedAt[options.peerId]) ackedAt[options.peerId] = at;

  if (options.type === 'read') {
    readBy.add(options.peerId);
    if (!readAt[options.peerId]) readAt[options.peerId] = at;
  }

  const deliveredToAll = statusRecipients.length > 0 && statusRecipients.every((id) => ackedBy.has(id));
  const readByAll = statusRecipients.length > 0 && statusRecipients.every((id) => readBy.has(id));
  const computedStatus: PlaintextMessage['status'] = readByAll ? 'read' : (deliveredToAll ? 'delivered' : 'sent');
  const nextStatus = statusRank(message.status) > statusRank(computedStatus) ? message.status : computedStatus;

  const nextMessage: PlaintextMessage = {
    ...message,
    ackedBy: Array.from(ackedBy),
    ackedAt,
    readBy: Array.from(readBy),
    readAt,
    status: nextStatus,
  };

  return {
    accepted: true,
    changed: !prevAck || (options.type === 'read' && !prevRead) || nextStatus !== message.status,
    message: nextMessage,
    counts: {
      acked: statusRecipients.filter((id) => ackedBy.has(id)).length,
      read: statusRecipients.filter((id) => readBy.has(id)).length,
      total: statusRecipients.length,
    },
    status: nextStatus,
  };
}
