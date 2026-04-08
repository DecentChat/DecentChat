type DeliveryStatus = 'pending' | 'sent' | 'delivered' | 'read';

export interface DeliveryTooltipInput {
  status: string;
  total: number;
  delivered: number;
  read: number;
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

function normalizeStatus(status: string): DeliveryStatus {
  if (status === 'read' || status === 'delivered' || status === 'sent' || status === 'pending') {
    return status;
  }
  return 'pending';
}
