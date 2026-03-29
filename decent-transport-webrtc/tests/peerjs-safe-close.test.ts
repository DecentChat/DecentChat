import { describe, expect, test } from 'bun:test';
import { PeerTransport } from '../src/PeerTransport';

describe('PeerTransport safe PeerJS close guard', () => {
  test('restores a dormant provider after close so late PeerJS callbacks do not crash', () => {
    const transport = new PeerTransport({ signalingServers: ['https://signal.example.test/peerjs'] });

    const conn: any = {
      peer: 'peer-1',
      provider: {
        options: { config: { iceServers: [] } },
        socket: { send: () => { throw new Error('real socket should not be used after close'); } },
        emitError: () => { throw new Error('real emitError should not be used after close'); },
        getConnection: () => { throw new Error('real getConnection should not be used after close'); },
        _removeConnection: () => {},
      },
      close() {
        this.provider = null;
      },
    };

    (transport as any)._installSafePeerJsClose(conn);
    conn.close();

    expect(conn.provider).toBeTruthy();
    expect(() => conn.provider.emitError('webrtc', new Error('late failure'))).not.toThrow();
    expect(() => conn.provider.socket.send({ type: 'LATE' })).not.toThrow();
    const routed = conn.provider.getConnection('peer-1', 'conn-1');
    expect(routed).toBeTruthy();
    expect(() => routed._initializeDataChannel({})).not.toThrow();
  });

  test('patching is idempotent', () => {
    const transport = new PeerTransport({ signalingServers: ['https://signal.example.test/peerjs'] });

    let closeCalls = 0;
    const conn: any = {
      peer: 'peer-2',
      provider: { options: { config: {} } },
      close() {
        closeCalls += 1;
        this.provider = null;
      },
    };

    (transport as any)._installSafePeerJsClose(conn);
    const wrapped = conn.close;
    (transport as any)._installSafePeerJsClose(conn);

    expect(conn.close).toBe(wrapped);
    conn.close();
    expect(closeCalls).toBe(1);
    expect(conn.provider).toBeTruthy();
  });
});
