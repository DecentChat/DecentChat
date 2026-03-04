# DecentChat Web → Svelte 5 Migration Plan

## Current State

- **Total source:** ~18,800 lines (TS + CSS)
- **UIRenderer.ts:** 3,776 lines — the monster (innerHTML templates, 184 querySelector calls, 103 event listeners, 32 innerHTML assignments)
- **ChatController.ts:** 4,835 lines — business logic + state
- **main.css:** 4,138 lines
- **Build output:** 615KB JS + 65KB CSS
- **E2E tests:** 43 spec files (Playwright)
- **Framework:** None — vanilla TS + Vite + manual DOM
- **Protocol deps:** decent-protocol, decent-transport-webrtc (workspace packages)

## Why Svelte 5

- **Runes** — fine-grained reactivity with `$state`, `$derived`, `$effect` (no virtual DOM)
- **Bundle size** — compiler-based, no runtime; won't add bloat to current 615KB
- **Capacitor-ready** — Svelte + Vite + Capacitor is well-trodden for iOS/Android
- **Component model** — the 3,776-line UIRenderer is unmaintainable; Svelte forces clean decomposition
- **TypeScript first** — Svelte 5 has excellent TS support

## Architecture Decisions

### State Management: Svelte Stores + Runes

Current: ChatController holds all state as mutable properties, UIRenderer reads `this.state.*` and manually calls `renderMessages()`, `updateSidebar()`, etc.

Target: Extract state into Svelte stores (`$state` runes). Components reactively subscribe. ChatController becomes a pure service layer with no DOM awareness.

```
src/lib/
  stores/
    workspace.svelte.ts    # workspaces, active workspace/channel
    messages.svelte.ts     # messages per channel
    connection.svelte.ts   # peer connections, online status
    huddle.svelte.ts       # huddle/voice state
    settings.svelte.ts     # user preferences
  services/
    ChatService.ts         # extracted from ChatController (no DOM)
    CryptoService.ts       # extracted from MessageProtocol
    StorageService.ts      # IndexedDB operations
    PeerService.ts         # transport + signaling management
```

### Component Decomposition

Map UIRenderer methods → Svelte components:

```
src/lib/components/
  layout/
    WorkspaceRail.svelte       # renderWorkspaceRailHTML()
    Sidebar.svelte             # renderSidebarHTML()
    ChannelHeader.svelte       # renderChannelHeaderHTML()
    AppShell.svelte            # renderApp() container
  workspace/
    CreateWorkspaceModal.svelte
    JoinWorkspaceModal.svelte
    WorkspaceSettings.svelte
  channel/
    ChannelList.svelte
    CreateChannelModal.svelte
    DirectMessageList.svelte
  messages/
    MessageList.svelte         # renderMessages() — virtual scroll
    MessageItem.svelte         # single message bubble
    MessageComposer.svelte     # compose area + attachments
    ThreadPanel.svelte         # renderThreadMessages()
    ThreadIndicator.svelte     # thread reply count
    StreamingMessage.svelte    # live token streaming
  members/
    MemberList.svelte
    MemberRow.svelte
  huddle/
    HuddlePanel.svelte
    HuddleControls.svelte
  shared/
    Modal.svelte               # showModal() replacement
    Toast.svelte               # showToast() replacement
    EmojiPicker.svelte
    QRCode.svelte
    ReactionPicker.svelte
    SettingsPanel.svelte
    ActivityPanel.svelte
```

### Routing

Plain Svelte 5 + Vite (no SvelteKit). We keep our own SPA routing — no server runtime needed.

```
  join/[code]/
```

## Migration Strategy: Strangler Fig (Incremental)

**NOT a rewrite.** Migrate component-by-component while the app keeps working.

### Phase 0: Foundation (1-2 days)
1. Add Svelte 5 + SvelteKit
   - `bun add svelte @sveltejs/vite-plugin-svelte`
   - Add `svelte()` plugin to vite.config.ts. No svelte.config.js needed.
2. Create `src/lib/bridge.ts` — Svelte ↔ vanilla bridge
   - Wraps ChatController + UIRenderer.state as Svelte stores
   - New Svelte components read/write the same state as vanilla code
3. Keep ALL existing code working — Svelte renders alongside vanilla DOM
4. Verify build + E2E tests pass

### Phase 1: Leaf Components (3-4 days)
Self-contained UI pieces that don't affect core flow:
1. **Modal.svelte** — replace showModal()
2. **Toast.svelte** — replace showToast()
3. **EmojiPicker.svelte** — replace EmojiPicker.ts
4. **QRCode.svelte** — replace QRCodeManager.ts
5. **MemberList.svelte** + **MemberRow.svelte**

### Phase 2: Layout Shell (2-3 days)
1. **WorkspaceRail.svelte** — replace renderWorkspaceRailHTML() + bindWorkspaceRailEvents()
2. **Sidebar.svelte** — replace renderSidebarHTML() + bindSidebarEvents()
3. **ChannelHeader.svelte** — replace renderChannelHeaderHTML()
4. **AppShell.svelte** — top-level layout

### Phase 3: State Extraction (2-3 days)
1. Extract ChatController state → Svelte stores
2. Convert ChatController methods → service functions
3. Remove UIRenderer.state — components read stores directly
4. Delete the bridge

### Phase 4: Message Rendering (3-4 days)
Hardest part — performance-critical:
1. **MessageList.svelte** with virtual scrolling
2. **MessageItem.svelte** — markdown, attachments, reactions
3. **MessageComposer.svelte** — compose box, files, slash commands
4. **StreamingMessage.svelte** — live token streaming
5. **ThreadPanel.svelte**

### Phase 5: Remaining Features (2-3 days)
1. HuddlePanel, SettingsPanel, ActivityPanel
2. Landing page → Svelte
3. NotificationManager integration

### Phase 6: Cleanup (1-2 days)
1. Delete UIRenderer.ts entirely
2. Extract main.css → per-component `<style>` blocks
3. Remove any manual URL handling that Svelte components replace
4. Update E2E test selectors
5. Final build comparison

## E2E Test Strategy

- Playwright is framework-agnostic — clicks DOM, doesn't care about framework
- Main risk: selector changes (class names, IDs)
- Mitigation: add `data-testid` to ALL Svelte components from day 1
- Run E2E after every phase
- MockTransport / relay infrastructure stays identical

## Capacitor Prep (Future Phase)

Svelte migration auto-preps for Capacitor:
- Vite build → dist/ → `npx cap copy`
- WebRTC works in WKWebView (iOS 14.5+)
- IndexedDB + WebCrypto work in WKWebView
- Need Capacitor plugins for: Push notifications, Filesystem, Share

## Risk Assessment

- **UIRenderer is 3,776 lines of tangled DOM** → strangler fig, never break the app
- **E2E tests break on selectors** → data-testid from day 1; update per-phase
- **State sync during bridge phase** → bridge wraps existing state, no dual truth
- **Message list performance** → benchmark before/after; virtual scroll from start
- **Bundle size** → Svelte compiles away; should stay same or smaller

## Timeline

- Phase 0: Foundation — 1-2 days
- Phase 1: Leaf components — 3-4 days (cumulative: 6)
- Phase 2: Layout shell — 2-3 days (cumulative: 9)
- Phase 3: State extraction — 2-3 days (cumulative: 12)
- Phase 4: Message rendering — 3-4 days (cumulative: 16)
- Phase 5: Remaining — 2-3 days (cumulative: 19)
- Phase 6: Cleanup — 1-2 days (cumulative: 21)

**~3 weeks of focused work.** App stays fully functional throughout.
