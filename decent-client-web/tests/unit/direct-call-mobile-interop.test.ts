import { describe, expect, mock, test } from 'bun:test';
import { ChatController } from '../../src/app/ChatController';

type SignalResponse = {
  peerId: string;
  payload: { type?: string; channelId?: string };
};

function createHarness(options?: { huddleState?: 'inactive' | 'available' | 'in-call' }) {
  const sent: SignalResponse[] = [];
  const toasts: Array<{ message: string; type?: string }> = [];

  let state = options?.huddleState ?? 'available';
  let activeChannelId: string | null = state === 'in-call' ? 'dm:existing' : null;

  const ctrl = Object.create(ChatController.prototype) as any;
  ctrl.state = {
    myPeerId: 'web-peer',
    activeWorkspaceId: null,
    activeChannelId: null,
  };
  ctrl.huddle = {
    getState: () => state,
    getActiveChannelId: () => activeChannelId,
    joinHuddle: mock(async (channelId: string) => {
      state = 'in-call';
      activeChannelId = channelId;
    }),
  };
  ctrl.ui = {
    showToast: (message: string, type?: string) => {
      toasts.push({ message, type });
    },
    updateSidebar: () => {},
    renderMessages: () => {},
  };
  ctrl.sendControlWithRetry = (peerId: string, payload: { type?: string; channelId?: string }) => {
    sent.push({ peerId, payload });
    return true;
  };
  ctrl.getDisplayNameForPeer = (peerId: string) => `Peer ${peerId}`;
  ctrl.findWorkspaceByChannelId = () => null;

  return { ctrl, sent, toasts, setHuddleJoinBehavior: (fn: (channelId: string) => Promise<void>) => { ctrl.huddle.joinHuddle = mock(fn); } };
}

describe('mobile -> web direct call interop (ChatController)', () => {
  test('mobile -> web: ring -> accept responds with call-accept after joining huddle', async () => {
    const { ctrl, sent } = createHarness({ huddleState: 'available' });

    await (ChatController.prototype as any).handleDirectCallSignal.call(ctrl, 'mobile-peer', {
      type: 'call-ring',
      channelId: 'dm:mobile-peer:web-peer',
    });

    expect(sent).toHaveLength(1);
    expect(sent[0]).toEqual(expect.objectContaining({
      peerId: 'mobile-peer',
      payload: expect.objectContaining({
        type: 'call-accept',
        channelId: 'dm:mobile-peer:web-peer',
      }),
    }));
  });

  test('mobile -> web: ring -> decline when web cannot enter huddle', async () => {
    const { ctrl, sent, setHuddleJoinBehavior } = createHarness({ huddleState: 'available' });

    setHuddleJoinBehavior(async () => {
      // Simulate failed join: state remains non in-call.
    });

    await (ChatController.prototype as any).handleDirectCallSignal.call(ctrl, 'mobile-peer', {
      type: 'call-ring',
      channelId: 'dm:mobile-peer:web-peer',
    });

    expect(sent).toHaveLength(1);
    expect(sent[0]).toEqual(expect.objectContaining({
      peerId: 'mobile-peer',
      payload: expect.objectContaining({
        type: 'call-decline',
        channelId: 'dm:mobile-peer:web-peer',
      }),
    }));
  });

  test('mobile -> web: ring -> busy when web is already in-call', async () => {
    const { ctrl, sent } = createHarness({ huddleState: 'in-call' });

    await (ChatController.prototype as any).handleDirectCallSignal.call(ctrl, 'mobile-peer', {
      type: 'call-ring',
      channelId: 'dm:mobile-peer:web-peer',
    });

    expect(sent).toHaveLength(1);
    expect(sent[0]).toEqual(expect.objectContaining({
      peerId: 'mobile-peer',
      payload: expect.objectContaining({
        type: 'call-busy',
        channelId: 'dm:mobile-peer:web-peer',
      }),
    }));
  });
});
