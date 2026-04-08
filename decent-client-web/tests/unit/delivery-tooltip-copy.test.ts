import { describe, expect, test } from 'bun:test';
import { formatDeliveryTooltip } from '../../src/lib/utils/deliveryReceiptTooltip';

describe('delivery tooltip copy', () => {
  test('keeps single-recipient copy concise', () => {
    expect(formatDeliveryTooltip({
      status: 'delivered',
      total: 1,
      delivered: 1,
      read: 0,
    })).toBe('Delivered');
  });

  test('shows n/m delivered for multi-recipient sent state', () => {
    expect(formatDeliveryTooltip({
      status: 'sent',
      total: 2,
      delivered: 0,
      read: 0,
    })).toBe('0/2 delivered');
  });

  test('shows n/m delivered for multi-recipient delivered state', () => {
    expect(formatDeliveryTooltip({
      status: 'delivered',
      total: 3,
      delivered: 2,
      read: 0,
    })).toBe('2/3 delivered');
  });

  test('includes delivered and read counts for multi-recipient read state', () => {
    expect(formatDeliveryTooltip({
      status: 'read',
      total: 3,
      delivered: 3,
      read: 2,
    })).toBe('3/3 delivered • 2/3 read');
  });
});
