type DeliveryStatus = 'pending' | 'sent' | 'delivered' | 'read';

export interface DeliveryTooltipInput {
  status: string;
  total: number;
  delivered: number;
  read: number;
}

export interface DeliveryPeerTooltipInput extends DeliveryTooltipInput {
  recipientPeerIds?: string[];
  ackedBy?: string[];
  readBy?: string[];
  getPeerLabel?: (peerId: string) => string;
}

export function formatDeliveryTooltip(input: DeliveryTooltipInput): string {
  const status = normalizeStatus(input.status);
  const total = Math.max(0, input.total || 0);
  const delivered = Math.max(0, Math.min(input.delivered || 0, total));
  const read = Math.max(0, Math.min(input.read || 0, total));
  const isMultiRecipient = total > 1;

  if (isMultiRecipient) {
    const deliveredCopy = `${delivered}/${total} delivered`;
    const readCopy = `${read}/${total} read`;
    if (status === 'read') return `${deliveredCopy} • ${readCopy}`;
    if (status === 'delivered') return read > 0 ? `${deliveredCopy} • ${readCopy}` : deliveredCopy;
    if (status === 'sent') return deliveredCopy;
    return delivered > 0 || read > 0 ? `${deliveredCopy} • ${readCopy}` : `0/${total} delivered`;
  }

  if (status === 'read') return 'Read';
  if (status === 'delivered') return 'Delivered';
  if (status === 'sent') return 'Sent';
  return 'Sending…';
}

export function formatDeliveryTooltipWithPeers(input: DeliveryPeerTooltipInput): string {
  const summary = formatDeliveryTooltip(input);
  const recipients = toPeerList(input.recipientPeerIds);
  if (recipients.length === 0) return summary;

  const acked = new Set(toPeerList(input.ackedBy));
  const read = new Set(toPeerList(input.readBy));

  const perPeerStates = recipients.map((peerId) => {
    const label = resolvePeerLabel(peerId, input.getPeerLabel);
    if (read.has(peerId)) return `${label}: read`;
    if (acked.has(peerId)) return `${label}: acked`;
    return `${label}: pending`;
  });

  return `${summary} • ${perPeerStates.join(', ')}`;
}

function normalizeStatus(status: string): DeliveryStatus {
  if (status === 'read' || status === 'delivered' || status === 'sent' || status === 'pending') {
    return status;
  }
  return 'pending';
}

function toPeerList(input?: string[]): string[] {
  if (!Array.isArray(input)) return [];
  return Array.from(
    new Set(input.filter((peerId): peerId is string => typeof peerId === 'string' && peerId.length > 0)),
  );
}

function resolvePeerLabel(peerId: string, getPeerLabel?: (peerId: string) => string): string {
  if (typeof getPeerLabel !== 'function') return peerId.slice(0, 8);
  const label = getPeerLabel(peerId);
  return typeof label === 'string' && label.trim().length > 0 ? label.trim() : peerId.slice(0, 8);
}
