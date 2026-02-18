# P2P Chat PWA - Implementation Plan

## Overview
Serverless peer-to-peer chat application that works as a Progressive Web App, installable on mobile devices. Uses WebRTC for P2P connections, end-to-end encryption, and requires no backend infrastructure.

---

## Tech Stack

### Core
- **Runtime**: Bun 1.3.9+
- **Build**: Vite (fast dev server, optimized builds, PWA plugin support)
- **Language**: TypeScript (type safety, better maintainability)
- **P2P**: PeerJS (WebRTC abstraction with built-in signaling server)

### Security
- **Encryption**: Web Crypto API (ECDH key exchange + AES-GCM)
- **Key Management**: IndexedDB for local key storage
- **Message Signing**: ECDSA signatures to verify sender identity

### PWA
- **Service Worker**: Workbox (via vite-plugin-pwa)
- **Manifest**: Auto-generated with icons, theme colors, install prompts
- **Offline**: Cache-first strategy for app shell, network-first for messages

### Testing
- **Test Runner**: Bun's native test runner (fast, TypeScript-native)
- **DOM Testing**: happy-dom (lightweight DOM for unit tests)
- **Coverage**: Built-in Bun coverage
- **E2E**: Playwright (optional, for cross-browser PWA testing)

---

## Architecture

### 1. **Connection Layer** (`src/connection/`)
```
PeerManager
├── PeerJS client initialization
├── Connection lifecycle (connect, disconnect, reconnect)
├── Room-based discovery (join/leave rooms)
├── Direct peer ID connection
└── Connection health monitoring

SignalingClient
├── PeerJS cloud signaling (default: peerjs.com)
├── Custom signaling server support (optional self-host)
└── Fallback STUN/TURN configuration
```

**Key Features:**
- Auto-reconnect on network changes
- Multiple connection modes:
  - **Room mode**: Users join named rooms, auto-discover peers
  - **Direct mode**: Copy/paste peer IDs or scan QR codes
- Connection status tracking (connected, disconnecting, failed)

### 2. **Encryption Layer** (`src/crypto/`)
```
CryptoManager
├── Key pair generation (ECDH P-256)
├── Shared secret derivation (ECDH + HKDF)
├── Message encryption (AES-GCM-256)
├── Message signing (ECDSA P-256)
└── Key storage (IndexedDB)

MessageCipher
├── encrypt(plaintext, recipientPublicKey)
├── decrypt(ciphertext, senderPublicKey)
└── verify(message, signature, publicKey)
```

**Security Design:**
- Each user generates an ECDH key pair on first launch
- Per-peer shared secrets derived via ECDH
- Messages encrypted with AES-GCM before sending
- Each message includes ECDSA signature for authenticity
- No keys transmitted in plaintext (only public keys exchanged)

### 3. **Message Layer** (`src/messages/`)
```
MessageStore
├── IndexedDB message persistence
├── Message history (per peer, per room)
├── Read receipts tracking
└── Message search/filtering

MessageProtocol
├── Message format (JSON with encryption envelope)
├── Message types (text, file, system)
├── Delivery status (pending, sent, delivered, failed)
└── File transfer protocol (chunked for large files)
```

**Message Format:**
```typescript
interface EncryptedMessage {
  id: string;              // UUID v4
  timestamp: number;       // Unix timestamp
  sender: string;          // Sender's peer ID
  type: 'text' | 'file' | 'system';
  encrypted: {
    ciphertext: string;    // Base64 AES-GCM ciphertext
    iv: string;            // Base64 initialization vector
    tag: string;           // Base64 authentication tag
  };
  signature: string;       // Base64 ECDSA signature
  metadata?: {             // Unencrypted (for routing)
    fileName?: string;
    fileSize?: number;
    mimeType?: string;
  };
}
```

### 4. **UI Layer** (`src/ui/`)
```
App (vanilla TS + Web Components)
├── ConnectionView (room/peer selection, QR codes)
├── ChatView (message list, input, file picker)
├── SettingsView (peer ID display, signaling server config)
└── InstallPrompt (PWA install banner)
```

**UI Framework**: **Vanilla TypeScript + Web Components**
- Lightweight (no framework overhead)
- Native browser features (Shadow DOM, Custom Elements)
- Fast load times (critical for PWA)
- Modern reactive patterns via Proxies for state

**Design Principles:**
- Mobile-first responsive design
- Touch-friendly UI (large tap targets)
- Offline-first UX (graceful degradation)
- Dark mode support (prefers-color-scheme)

### 5. **Storage Layer** (`src/storage/`)
```
Database (IndexedDB)
├── messages (id, peerId, timestamp, content, status)
├── peers (id, publicKey, alias, lastSeen)
├── keys (myKeyPair, peerSharedSecrets)
└── settings (theme, notifications, signaling)
```

---

## File Structure

```
p2p-chat-pwa/
├── src/
│   ├── main.ts                 # App entry point
│   ├── connection/
│   │   ├── PeerManager.ts      # PeerJS wrapper
│   │   ├── SignalingClient.ts  # Signaling server interface
│   │   └── ConnectionTypes.ts  # TypeScript types
│   ├── crypto/
│   │   ├── CryptoManager.ts    # Key management
│   │   ├── MessageCipher.ts    # Encrypt/decrypt
│   │   └── KeyStore.ts         # IndexedDB key storage
│   ├── messages/
│   │   ├── MessageStore.ts     # Message persistence
│   │   ├── MessageProtocol.ts  # Message format/types
│   │   └── FileTransfer.ts     # Chunked file handling
│   ├── storage/
│   │   ├── Database.ts         # IndexedDB wrapper
│   │   └── Migrations.ts       # Schema versioning
│   ├── ui/
│   │   ├── components/
│   │   │   ├── ChatView.ts
│   │   │   ├── ConnectionView.ts
│   │   │   ├── MessageList.ts
│   │   │   └── SettingsView.ts
│   │   ├── styles/
│   │   │   ├── main.css
│   │   │   └── components.css
│   │   └── state.ts            # App state management
│   └── utils/
│       ├── logger.ts
│       └── qrcode.ts           # QR code generation
├── tests/
│   ├── unit/
│   │   ├── crypto.test.ts
│   │   ├── messages.test.ts
│   │   ├── connection.test.ts
│   │   └── storage.test.ts
│   ├── integration/
│   │   └── e2e-flow.test.ts
│   └── mocks/
│       └── PeerMock.ts
├── public/
│   ├── icons/                  # PWA icons (192x192, 512x512)
│   ├── manifest.json           # PWA manifest
│   └── robots.txt
├── vite.config.ts              # Vite + PWA plugin config
├── tsconfig.json
├── bunfig.toml                 # Bun config (if needed)
└── package.json
```

---

## Implementation Phases

### **Phase 1: Core Infrastructure** (Foundation)
**Goal**: Basic app shell + local crypto working

1. **Setup** (~30 min)
   - Initialize Bun + Vite + TypeScript project
   - Install dependencies: `peerjs`, `vite-plugin-pwa`, `workbox`
   - Configure Vite with PWA plugin
   - Setup Bun test runner with happy-dom

2. **Crypto Layer** (~2-3 hours)
   - Implement `CryptoManager` (key generation, ECDH)
   - Implement `MessageCipher` (AES-GCM encrypt/decrypt)
   - Implement `KeyStore` (IndexedDB persistence)
   - **Unit tests**: Key generation, encryption roundtrip, signature verification

3. **Storage Layer** (~1-2 hours)
   - Implement `Database` wrapper for IndexedDB
   - Define schemas (messages, peers, keys, settings)
   - **Unit tests**: CRUD operations, migrations

**Deliverable**: Encrypted local storage working, 100% test coverage on crypto

---

### **Phase 2: P2P Connection** (Networking)
**Goal**: Two browsers can connect and exchange raw messages

1. **PeerJS Integration** (~2 hours)
   - Implement `PeerManager` (PeerJS lifecycle)
   - Implement room discovery (broadcast peer list in room)
   - Implement direct peer connection (via peer ID)
   - Handle reconnection logic

2. **Message Protocol** (~1-2 hours)
   - Define `MessageProtocol` (JSON schema)
   - Implement send/receive with encryption
   - Implement delivery status tracking

3. **Testing** (~1 hour)
   - Mock PeerJS for unit tests
   - Test connection establishment
   - Test message encryption end-to-end

**Deliverable**: Two browser tabs can connect and send encrypted messages

---

### **Phase 3: UI Implementation** (User-facing)
**Goal**: Usable chat interface with mobile support

1. **Core UI** (~3-4 hours)
   - `ConnectionView`: Room input, peer ID display, QR code
   - `ChatView`: Message list, text input, send button
   - `MessageList`: Display messages with timestamps
   - `SettingsView`: Peer ID, export keys, clear data

2. **File Sharing** (~2 hours)
   - File picker integration
   - Chunked file transfer (DataChannel)
   - File download handler

3. **Responsive Design** (~1-2 hours)
   - Mobile-first CSS
   - Touch-friendly interactions
   - Dark mode support

**Deliverable**: Fully functional chat UI, works on mobile browsers

---

### **Phase 4: PWA Features** (Offline + Install)
**Goal**: App works offline and can be installed

1. **Service Worker** (~1 hour)
   - Configure Workbox via vite-plugin-pwa
   - Cache app shell (HTML, CSS, JS)
   - Cache-first for assets, network-first for data

2. **PWA Manifest** (~30 min)
   - Generate icons (192x192, 512x512)
   - Configure manifest.json (name, colors, display mode)
   - Add install prompt UI

3. **Offline UX** (~1 hour)
   - Show connection status in UI
   - Queue messages when offline
   - Sync when reconnected

**Deliverable**: PWA installable on Android/iOS, works offline

---

### **Phase 5: Polish & Testing** (Quality)
**Goal**: Production-ready with comprehensive tests

1. **Unit Test Coverage** (~2 hours)
   - All crypto functions
   - Message protocol edge cases
   - Storage layer (migrations, errors)

2. **Integration Tests** (~1-2 hours)
   - Full flow: connect → send message → receive → decrypt
   - File transfer flow
   - Reconnection scenarios

3. **UX Polish** (~1-2 hours)
   - Loading states
   - Error messages (connection failed, encryption error)
   - Notifications (new message)

**Deliverable**: 80%+ test coverage, polished UX

---

## Testing Strategy

### Unit Tests (Bun Test)
```typescript
// Example: crypto.test.ts
import { describe, test, expect } from 'bun:test';
import { CryptoManager } from '../src/crypto/CryptoManager';

describe('CryptoManager', () => {
  test('generates valid key pair', async () => {
    const crypto = new CryptoManager();
    const keyPair = await crypto.generateKeyPair();
    expect(keyPair.publicKey).toBeDefined();
    expect(keyPair.privateKey).toBeDefined();
  });

  test('encrypts and decrypts message', async () => {
    const alice = new CryptoManager();
    const bob = new CryptoManager();
    await alice.generateKeyPair();
    await bob.generateKeyPair();
    
    const plaintext = 'Hello, Bob!';
    const encrypted = await alice.encrypt(plaintext, bob.publicKey);
    const decrypted = await bob.decrypt(encrypted, alice.publicKey);
    
    expect(decrypted).toBe(plaintext);
  });
});
```

### Run Tests
```bash
bun test                    # Run all tests
bun test --coverage         # With coverage report
bun test --watch            # Watch mode
```

---

## Security Considerations

1. **Key Storage**: Private keys stored in IndexedDB (origin-isolated, not extractable)
2. **Perfect Forward Secrecy**: Not implemented (would need session keys + ratcheting)
3. **Man-in-the-Middle**: Vulnerable if peer IDs swapped (consider out-of-band verification)
4. **Room Security**: Room names are not secret (anyone with name can join)
5. **Signaling Server Trust**: PeerJS cloud signaling sees peer IDs (not message content)

**Mitigations**:
- Display peer public key fingerprints for manual verification
- Support custom signaling servers (self-host option)
- Add optional "trusted peers" list
- Implement key rotation (future enhancement)

---

## PWA Configuration

### vite.config.ts
```typescript
import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  plugins: [
    VitePWA({
      registerType: 'autoUpdate',
      manifest: {
        name: 'P2P Chat',
        short_name: 'P2PChat',
        description: 'Secure peer-to-peer chat with no servers',
        theme_color: '#2563eb',
        background_color: '#ffffff',
        display: 'standalone',
        icons: [
          {
            src: '/icons/icon-192.png',
            sizes: '192x192',
            type: 'image/png',
          },
          {
            src: '/icons/icon-512.png',
            sizes: '512x512',
            type: 'image/png',
          },
        ],
      },
      workbox: {
        runtimeCaching: [
          {
            urlPattern: /^https:\/\/fonts\.googleapis\.com\/.*/i,
            handler: 'CacheFirst',
            options: {
              cacheName: 'google-fonts-cache',
              expiration: {
                maxEntries: 10,
                maxAgeSeconds: 60 * 60 * 24 * 365, // 1 year
              },
            },
          },
        ],
      },
    }),
  ],
});
```

---

## Development Workflow

### Setup
```bash
cd ~/Projects/p2p-chat-pwa
bun install
```

### Development
```bash
bun run dev         # Start Vite dev server (http://localhost:5173)
bun test --watch    # Run tests in watch mode
```

### Build
```bash
bun run build       # Production build
bun run preview     # Preview production build locally
```

### Deploy
Static hosting (no server needed):
- **Cloudflare Pages** (recommended, free, fast CDN)
- **Netlify** (also free, easy SSL)
- **GitHub Pages** (free for public repos)
- **Vercel** (free tier available)

---

## Dependency List

### package.json (estimated)
```json
{
  "name": "p2p-chat-pwa",
  "version": "1.0.0",
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "vite build",
    "preview": "vite preview",
    "test": "bun test",
    "test:coverage": "bun test --coverage"
  },
  "dependencies": {
    "peerjs": "^1.5.4"
  },
  "devDependencies": {
    "@types/bun": "latest",
    "vite": "^5.4.0",
    "vite-plugin-pwa": "^0.20.0",
    "workbox-window": "^7.1.0",
    "happy-dom": "^15.0.0",
    "typescript": "^5.6.0"
  }
}
```

**Note**: Bun includes TypeScript + test runner built-in (no need for ts-node, vitest, jest, etc.)

---

## Open Questions / Decisions

1. **Signaling Server**: Use PeerJS cloud (free) or self-host (more control)?
   - **Recommendation**: Start with PeerJS cloud, add self-host option later

2. **UI Framework**: Vanilla JS/TS vs React/Svelte?
   - **Recommendation**: Vanilla TS (smallest bundle, fastest load)

3. **File Size Limit**: Cap file transfers at X MB to avoid memory issues?
   - **Recommendation**: 100 MB limit, stream large files in chunks

4. **Group Chats**: Support N-way chats (mesh network) or only 1-on-1?
   - **Recommendation**: Start with 1-on-1, add group chats in v2

5. **Voice/Video**: Include WebRTC audio/video calls?
   - **Recommendation**: Text + files first, media calls in future version

---

## Success Metrics

- [ ] App loads in <2s on 3G
- [ ] PWA installable on Android + iOS
- [ ] Works offline (queues messages)
- [ ] 80%+ test coverage
- [ ] Two users can chat across different networks
- [ ] Messages encrypted end-to-end (verified in tests)
- [ ] No console errors in production build

---

## Timeline Estimate

**Total**: ~15-20 hours for v1.0

- Phase 1 (Infrastructure): 3-5 hours
- Phase 2 (P2P): 3-4 hours
- Phase 3 (UI): 4-6 hours
- Phase 4 (PWA): 2-3 hours
- Phase 5 (Polish): 3-4 hours

**MVP** (basic chat working): Could be done in 8-10 hours if cutting scope (no file transfer, basic UI)

---

## Next Steps

1. **Review this plan** — Any changes to scope or tech choices?
2. **Initialize project** — Run `bun create vite p2p-chat-pwa --template vanilla-ts`
3. **Start Phase 1** — Set up crypto layer + tests
4. **Iterate** — Build, test, deploy incrementally

---

**Questions or changes?** Let me know and we can adjust the plan before starting implementation. ⚔️
