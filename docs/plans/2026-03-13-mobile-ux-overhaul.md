# Mobile UX Overhaul — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use `superpowers:executing-plans` to implement this plan task-by-task.

**Goal:** Redesign the DecentChat mobile app to match the web app's design language, make DMs first-class, add QR-based account recovery with peer sync, implement WhatsApp-style 1:1 calling, defer seed phrase backup to 100 messages, and generate an octopus/DC SVG logo.

**Architecture:** 8 workstreams executed in dependency order. Design tokens align with web's purple/indigo palette. QR codes use an extended `decent://recover?seed=...&peer=...` URI for cross-device sync. DMs get their own tab, replacing Workspaces as the default. Calling extends the existing CallManager with ring/accept/decline UX. Seed backup becomes a deferred notification system.

**Tech Stack:** Svelte 5 (runes), decent-protocol, qrcode (npm), Gemini API (SVG generation), Playwright (tests)

---

## Workstream 1: Design Token Alignment (web ↔ mobile)

### Task 1.1: Unify CSS variables

**Files:**
- Modify: `decent-client-mobile/src/styles/mobile.css`

The web app uses:
- `--primary: #6c5ce7` (purple), `--primary-dark: #5a4bd1`, `--primary-light: #a29bfe`
- `--bg: #0f0f23` (dark), `--bg-secondary: #16162b`, `--surface: #1a1a30`
- `--border: #2a2a45`, `--text: #e2e4e9`, `--text-muted: #8b8fa3`
- `--sidebar-bg: #0a0a1a`

Mobile currently uses WhatsApp-green (`#00a884`). Replace with web palette:

1. Update `--color-bg` → `#0f0f23`, `--color-surface` → `#1a1a30`, `--color-surface-elevated` → `#222240`
2. Update `--color-border` → `#2a2a45`, `--color-text` → `#e2e4e9`, `--color-text-muted` → `#8b8fa3`
3. Update `--color-accent` → `#6c5ce7`, `--color-accent-soft` → `rgba(108, 92, 231, 0.16)`
4. Update `--color-badge-text` → `#ffffff`
5. Add `--color-success: #00b894`, `--color-online: #00b894` (keep green for status indicators)
6. Update all component styles that hardcode green (`rgba(0, 168, 132, ...)`) to use the new purple accent

### Task 1.2: Update all component accent colors

**Files:**
- Modify: All `.svelte` files under `decent-client-mobile/src/`

Search-replace hardcoded green values:
- `#00a884` → `var(--color-accent)` or `#6c5ce7`
- `rgba(0, 168, 132, ...)` → `rgba(108, 92, 231, ...)`
- `#06755f`, `#00150f` → appropriate purple variants

---

## Workstream 2: Logo SVG Generation

### Task 2.1: Generate octopus/DC logo via Gemini API

Generate a beautiful SVG logo featuring an octopus theme with "DC" letters. Use Gemini API to create it.

Save to: `decent-client-mobile/src/assets/logo.svg`

The logo should:
- Feature a stylized octopus
- Incorporate "DC" letters
- Use the purple (#6c5ce7) color palette
- Work as a small icon (84x84) and as a splash screen element
- Be clean, modern, minimal SVG

### Task 2.2: Integrate logo into WelcomeScreen

**Files:**
- Modify: `decent-client-mobile/src/screens/onboarding/WelcomeScreen.svelte`

Replace the `💬` emoji logo with the SVG.

---

## Workstream 3: Onboarding Redesign

### Task 3.1: Redesign WelcomeScreen

**Files:**
- Modify: `decent-client-mobile/src/screens/onboarding/WelcomeScreen.svelte`

New flow:
- **Primary button:** "Get started" → creates account silently (no seed shown)
- **Secondary button:** "I have an account" → opens recovery options
- Logo, app name, tagline

### Task 3.2: Implement silent account creation

**Files:**
- Modify: `decent-client-mobile/src/screens/onboarding/CreateIdentityScreen.svelte`
- Modify: `decent-client-mobile/src/App.svelte`

New flow for "Get started":
1. Show alias input only
2. On Continue → generate seed phrase silently, store it, bootstrap identity
3. NO seed display, NO "write it down" prompt
4. Track `isRecoveredAccount: false` in localStorage

### Task 3.3: Implement recovery screen with QR-first approach

**Files:**
- Create: `decent-client-mobile/src/screens/onboarding/RecoverAccountScreen.svelte`
- Modify: `decent-client-mobile/src/App.svelte`

Recovery options (in order of prominence):
1. **Scan QR code** (primary, large) — scan from web app or another device
2. **Enter seed phrase manually** (secondary, collapsed) — click to expand textarea

### Task 3.4: Create RecoveryURI protocol extension

**Files:**
- Modify: `decent-protocol/src/contacts/ContactURI.ts` or create new `decent-protocol/src/identity/RecoveryURI.ts`

New URI format: `decent://recover?seed=<base64-encoded-seed>&peer=<peer-id>&sig=<signaling-servers>`

This allows scanning a QR from the web app that contains:
- The full seed phrase (base64 encoded)
- The current peer ID (for immediate sync)
- Signaling server info (for connection)

### Task 3.5: Add "Show Recovery QR" to web app

**Files:**
- Modify: `decent-client-web/src/lib/components/modals/QRFlowModal.svelte`

Add a new mode `'recovery-qr'` that:
1. Encodes seed + current peer ID into a `decent://recover?...` URI
2. Shows QR code with security warning ("Only scan on YOUR devices")

---

## Workstream 4: Deferred Seed Backup System

### Task 4.1: Message counter + backup state tracking

**Files:**
- Modify: `decent-client-mobile/src/app/MobileController.ts`
- Modify: `decent-client-mobile/src/stores/appState.ts`

Track in localStorage:
- `decentchat-messages-sent`: number (increment on each sent message)
- `decentchat-seed-backed-up`: boolean (true if recovered or confirmed backup)
- `decentchat-backup-dismissed`: boolean (true if dismissed permanently)

### Task 4.2: Seed backup alert component

**Files:**
- Create: `decent-client-mobile/src/components/SeedBackupAlert.svelte`

Triggered when `messages-sent >= 100` AND `seed-backed-up === false` AND `backup-dismissed === false`.

Shows:
1. Alert explaining importance of seed phrase backup
2. "View seed phrase" button → shows seed phrase
3. "I've written it down" button → double confirmation:
   - First: "Are you sure? This is the ONLY way to recover your account."
   - Second: "I understand. If I lose this phrase, I lose my account forever."
4. After confirmation: set `seed-backed-up = true`, never show again
5. NO dismiss without confirming — but allow "remind me later" (shows again after 50 more messages)

### Task 4.3: Skip backup prompt for recovered accounts

If user recovered via seed phrase or QR code, set `decentchat-seed-backed-up = true` immediately — they clearly already have access to their seed.

---

## Workstream 5: DMs as First-Class Citizens

### Task 5.1: Replace tab structure — DMs tab

**Files:**
- Modify: `decent-client-mobile/src/App.svelte`
- Create: `decent-client-mobile/src/screens/ContactsScreen.svelte`
- Modify: `decent-client-mobile/src/components/TabBar.svelte`

New tab order:
1. **Chats** (DMs + group conversations, like WhatsApp)
2. **Contacts** (friend list + add friend)
3. **Calls** (call history)
4. **You** (profile/settings)

Remove Workspaces as a top-level tab. Move workspace management into the You/Settings screen.

### Task 5.2: Redesign ChatsScreen for DM-first

**Files:**
- Modify: `decent-client-mobile/src/screens/ChatsScreen.svelte`

Show both DMs and workspace channels in a unified list, sorted by last message time. DMs appear with contact avatar, workspace channels with `#` prefix.

### Task 5.3: ContactsScreen with Add Friend flow

**Files:**
- Create: `decent-client-mobile/src/screens/ContactsScreen.svelte`

Features:
- Contact list with online status
- "Add Friend" button → options:
  - Show my QR code (ContactURI)
  - Scan friend's QR code
  - Share invite link
  - Paste URI manually

### Task 5.4: Add QR scanning capability

**Files:**
- Add `qrcode` dependency to mobile package.json
- Create: `decent-client-mobile/src/components/QRScanner.svelte`
- Create: `decent-client-mobile/src/components/QRDisplay.svelte`

QRScanner: use `getUserMedia` + canvas-based QR detection (or a lightweight lib like `qr-scanner`)
QRDisplay: use `qrcode` npm package to generate QR code data URLs

---

## Workstream 6: WhatsApp-Style 1:1 Calling

### Task 6.1: Call UI — ring/accept/decline

**Files:**
- Modify: `decent-client-mobile/src/components/ActiveCallOverlay.svelte`
- Create: `decent-client-mobile/src/components/IncomingCallScreen.svelte`

For incoming calls:
- Full-screen overlay with caller name/avatar
- Accept (green) / Decline (red) buttons
- Ring sound (via Web Audio API or <audio>)

For active calls:
- Call timer
- Mute toggle
- Speaker toggle
- End call button

### Task 6.2: Call button in DM chat

**Files:**
- Modify: `decent-client-mobile/src/screens/ChatDetailScreen.svelte`

Add phone icon in DM chat header. Tapping calls that contact directly (not a huddle — a 1:1 call).

### Task 6.3: Extend CallManager for 1:1 call signals

**Files:**
- Modify: `decent-client-mobile/src/app/CallManager.ts`

Add signal types:
- `call-ring` (initiator → recipient)
- `call-accept` (recipient → initiator)
- `call-decline` (recipient → initiator)
- `call-busy` (recipient already in call)

### Task 6.4: Web app call support (optional, if time permits)

**Files:**
- Modify: `decent-client-web/src/app/ChatController.ts`

Add handling for `call-ring`/`call-accept`/`call-decline` signals so web users can receive calls from mobile users.

---

## Workstream 7: Test Updates

### Task 7.1: Update E2E tests for new onboarding

**Files:**
- Modify: `decent-client-mobile/tests/mobile-e2e.spec.ts`

Update all onboarding tests:
- "Get started" instead of "Create new account"
- No seed phrase display on create
- Test recovery flow (QR + manual seed)
- Test default tab is Chats (not Workspaces)
- Test backup alert at 100 messages

### Task 7.2: Protocol tests for RecoveryURI

**Files:**
- Create: `decent-protocol/tests/unit/recovery-uri.test.ts`

Test encode/decode roundtrip, validation, edge cases.

---

## Workstream 8: Polish & Integration

### Task 8.1: Empty states for all screens

Each screen should have a clear, helpful empty state explaining what to do.

### Task 8.2: Animations and transitions

Ensure all screen transitions use consistent fly/fade animations.

### Task 8.3: Final smoke test across browsers

Test in Chrome, Safari, and Firefox/Zen.

---

## Execution Order

1. **Task 2.1** — Logo generation (independent, can run first)
2. **Tasks 1.1–1.2** — Design tokens (foundation for everything)
3. **Tasks 3.1–3.5** — Onboarding redesign
4. **Task 3.4** — RecoveryURI protocol
5. **Tasks 4.1–4.3** — Deferred backup system
6. **Tasks 5.1–5.4** — DM-first redesign
7. **Tasks 6.1–6.3** — 1:1 calling
8. **Tasks 7.1–7.2** — Test updates
9. **Tasks 8.1–8.3** — Polish
