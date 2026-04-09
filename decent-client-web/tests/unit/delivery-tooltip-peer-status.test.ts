import { describe, expect, test } from 'bun:test';
import { formatDeliveryTooltipWithPeers } from '../../src/lib/utils/deliveryReceiptTooltip';

describe('delivery tooltip peer status', () => {
  test('appends per-peer ack state for multi-recipient messages', () => {
    expect(formatDeliveryTooltipWithPeers({
      status: 'delivered',
      total: 2,
      delivered: 1,
      read: 0,
      recipientPeerIds: ['peer-a', 'peer-b'],
      ackedBy: ['peer-a'],
      readBy: [],
      getPeerLabel: (peerId) => (peerId === 'peer-a' ? 'Alice' : 'Bob'),
    })).toBe('1/2 delivered • Alice: acked, Bob: pending');
  });

  test('marks read before acked when both arrays contain the peer', () => {
    expect(formatDeliveryTooltipWithPeers({
      status: 'read',
      total: 2,
      delivered: 2,
      read: 1,
      recipientPeerIds: ['peer-a', 'peer-b'],
      ackedBy: ['peer-a', 'peer-b'],
      readBy: ['peer-b'],
      getPeerLabel: (peerId) => (peerId === 'peer-a' ? 'Alice' : 'Bob'),
    })).toBe('2/2 delivered • 1/2 read • Alice: acked, Bob: read');
  });

  test('falls back to summary copy when recipient ids are not available', () => {
    expect(formatDeliveryTooltipWithPeers({
      status: 'delivered',
      total: 1,
      delivered: 1,
      read: 0,
      recipientPeerIds: [],
      ackedBy: [],
      readBy: [],
      getPeerLabel: () => 'Alice',
    })).toBe('Delivered');
  });
});
