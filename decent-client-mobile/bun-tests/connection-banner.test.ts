import { describe, expect, test } from 'bun:test';
import { getConnectionBannerState } from '../src/app/connectionBanner';

describe('connection banner state mapping', () => {
  test('maps transport disconnected to error banner', () => {
    expect(getConnectionBannerState('disconnected')).toBe('error');
  });

  test('maps idle to hidden-idle banner state', () => {
    expect(getConnectionBannerState('idle')).toBe('idle');
  });

  test('maps connecting and connected directly', () => {
    expect(getConnectionBannerState('connecting')).toBe('connecting');
    expect(getConnectionBannerState('connected')).toBe('connected');
  });
});
