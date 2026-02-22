import { describe, test, expect } from 'bun:test';
import { normalizePeerJsServer } from '../src/PeerTransport';

describe('PeerJS URL/path normalization', () => {
  test('https://0.peerjs.com/ keeps path as /', () => {
    const normalized = normalizePeerJsServer('https://0.peerjs.com/');
    expect(normalized.path).toBe('/');
  });

  test('https://host/peerjs keeps path as /peerjs', () => {
    const normalized = normalizePeerJsServer('https://host.example/peerjs');
    expect(normalized.path).toBe('/peerjs');
  });

  test('strips default :443 for https URL', () => {
    const normalized = normalizePeerJsServer('https://signal.example:443/peerjs');
    expect(normalized.port).toBe(443);
  });

  test('strips default :80 for http URL', () => {
    const normalized = normalizePeerJsServer('http://signal.example:80/peerjs');
    expect(normalized.port).toBe(80);
  });
});
