# UI & UX Implementation Status

This page is an implementation audit of the current DecentChat web client.

Scope audited:
- onboarding and first run
- landing vs `/app` routing
- join workspace flow (including clipboard behavior)
- workspace/channel/DM/thread UX
- roles and permissions surfacing
- search and notifications
- offline behavior and user messaging
- known limitations

---

## 1) Onboarding and first run

### What is implemented

- **Welcome/landing experience** is rendered by `UIRenderer.renderWelcome()`:
  - marketing-style page
  - CTA buttons for Create Workspace, Join Workspace, Open App, Restore identity
  - copy peer-id action
  - code: `decent-client-web/src/ui/UIRenderer.ts` (`renderWelcome`)

- **Identity seed is auto-generated** if missing:
  - app checks `seedPhrase` in persistent store
  - if missing, generates and stores one automatically
  - code: `decent-client-web/src/main.ts` (seed generation in `init()`)

- **Restore from seed phrase** is exposed in UI:
  - landing has “Restore from seed phrase” action
  - settings also supports seed transfer and display
  - code: `decent-client-web/src/ui/UIRenderer.ts`, `decent-client-web/src/ui/QRCodeManager.ts`, `decent-client-web/src/ui/SettingsPanel.ts`

### User-visible behavior notes

- First-time user does **not** need signup/email/phone.
- Alias is requested during create/join flow and persisted (`myAlias`).

---

## 2) Landing (`/`) vs app (`/app`) routing

### What is implemented

Routing gate is explicit in startup:
- `/app` and `/join/*` run full app bootstrap (transport, crypto, sync)
- `/` and non-app routes render landing-only flow
- code: `decent-client-web/src/main.ts` (route checks `isAppRoute` / `isJoinRoute`)

This matches intended route isolation (no accidental transport ownership on landing path).

### `/join/*` handling

- Join URL is parsed.
- Invite payload is stored temporarily in `sessionStorage`.
- URL is normalized back to `/` via `history.replaceState`.
- Welcome page is rendered, then join modal opens with invite prefill.
- code: `decent-client-web/src/main.ts` (`pendingInvite` logic + `showJoinWithInvite` call)

---

## 3) Join workspace flow (manual + invite link + clipboard)

### What is implemented

Join modal supports:
- invite URL or invite code input
- alias input
- workspace preview (from invite payload)
- clipboard auto-read autofill when modal opens
- code: `decent-client-web/src/ui/UIRenderer.ts`
  - `showJoinWorkspaceModal`
  - `parseJoinInviteInput`
  - `updateWorkspacePreview`

Join from invite link route supports:
- parsing full invite data (`InviteURI.decode`)
- prefilled join modal (`showJoinWithInvite`)
- code: `decent-client-web/src/main.ts`, `decent-client-web/src/ui/UIRenderer.ts`

### Clipboard behavior (actual)

- Uses `navigator.clipboard.readText()`.
- Triggered only after user opens Join modal (good user-gesture timing).
- If clipboard contains valid invite data and input is empty:
  - invite input is auto-filled
  - workspace preview is shown
  - hint is shown
  - focus moves to alias input
- Failures (permissions/availability) are silent.
- code: `decent-client-web/src/ui/UIRenderer.ts` (`showJoinWorkspaceModal`)

### Important nuance

- If user enters only plain invite code (no embedded peer id), app prompts for peer id via `prompt(...)`.
- code: `decent-client-web/src/ui/UIRenderer.ts` (`showJoinWorkspaceModal` submit handler)

---

## 4) Workspace / channel / DM / thread UX

### Workspace UX

Implemented:
- left workspace rail with quick switching
- workspace menu (settings, members, invite, notification prefs)
- create workspace modal
- invite copy from sidebar/header/menu
- code: `decent-client-web/src/ui/UIRenderer.ts`

### Channel UX

Implemented:
- channel list in sidebar with unread badges
- channel switch updates focus/read state
- create channel modal
- channel member count button + modal
- code: `decent-client-web/src/ui/UIRenderer.ts`

### Direct messages UX

There are two DM concepts implemented:

1. **Workspace DM channels** (`workspaceManager` DM channels)
2. **Standalone direct conversations** (`directConversationStore`), shown in DM section and workspace rail DM area

Implemented behaviors:
- start direct message from contacts/member rows
- switch to direct conversation view
- unread badges for direct conversations
- code: `decent-client-web/src/ui/UIRenderer.ts`, `decent-client-web/src/app/ChatController.ts`

### Thread UX

Implemented:
- reply-in-thread action from message actions
- thread side panel open/close
- parent + replies rendering
- thread reply indicators on parent messages
- activity integration for thread replies
- resizable thread panel (saved width in localStorage)
- code: `decent-client-web/src/ui/UIRenderer.ts`, `decent-client-web/src/app/ChatController.ts`

---

## 5) Roles and permissions surfacing

### What is surfaced in UI

- Workspace members modal shows role badges (Owner/Admin)
- Owner/Admin controls are conditionally shown:
  - promote/demote/remove member actions
- Workspace settings modal includes permission controls:
  - who can create channels (`everyone` / `admins`)
  - who can invite members (`everyone` / `admins`)
- code: `decent-client-web/src/ui/UIRenderer.ts`

### Enforcement path

- UI calls ChatController role/permission APIs.
- WorkspaceManager enforces permissions.
- role/settings/remove events are synchronized and signed/verified in controller path.
- code: `decent-client-web/src/app/ChatController.ts`

---

## 6) Search and notifications

### Search

Implemented:
- in-client search panel (`Ctrl/Cmd+F`)
- per-active-channel search scope in current UI flow
- local message-store search (no server indexing)
- basic ranking + highlighting
- code: `decent-client-web/src/ui/UIRenderer.ts` (`showSearchPanel`), `decent-client-web/src/ui/MessageSearch.ts`

### Notifications

Implemented:
- unread counters per channel
- title badge / title flash when unfocused
- desktop notifications via Web Notifications API (when permitted)
- notification click navigates to channel
- code: `decent-client-web/src/ui/NotificationManager.ts`, `decent-client-web/src/main.ts`

Settings UI includes toggles for desktop notifications and sound:
- code: `decent-client-web/src/ui/SettingsPanel.ts`

---

## 7) Offline/reconnect behavior and messaging

### Implemented runtime behavior

- If signaling init fails, app continues in offline-capable mode.
- outgoing messages are queued via OfflineQueue when peers are unavailable
- queued messages are flushed on reconnect
- reconnect maintenance and lifecycle guard run on visibility/pageshow/online events
- code: `decent-client-web/src/main.ts`, `decent-client-web/src/app/ChatController.ts`, `decent-client-web/src/app/LifecycleReconnectGuard.ts`

### User-visible messaging that exists

- toast on delivered queued messages
- toast when queued messages remain pending
- presence dots (online / optionally reconnecting / offline)
- message delivery states (pending/sent/delivered/read)
- code: `decent-client-web/src/app/ChatController.ts`, `decent-client-web/src/ui/UIRenderer.ts`

### What is not explicitly surfaced

- no dedicated global “You are offline” banner/state panel
- no explicit retry queue UI with per-message controls

---

## 8) Known limitations (current implementation)

1. **Search UX is channel-scoped in practice** from current panel integration (not a full multi-workspace discovery UX).
2. **Notification settings are partly cosmetic right now**:
   - toggles exist in settings
   - `NotificationManager.notify()` currently does not read persisted `notifications`/`notificationSound` flags directly
3. **Join by plain invite code may require manual peer ID prompt** if peer info is absent.
4. **No dedicated offline banner**; offline status is inferred from toasts/presence/reconnect behavior.
5. **DM model is dual-path** (workspace DM channels + standalone direct conversations), which can be conceptually confusing in docs/UI copy.

---

## Change log basis

Primary implementation references audited in this pass:
- `decent-client-web/src/main.ts`
- `decent-client-web/src/ui/UIRenderer.ts`
- `decent-client-web/src/app/ChatController.ts`
- `decent-client-web/src/ui/NotificationManager.ts`
- `decent-client-web/src/ui/MessageSearch.ts`
- `decent-client-web/src/app/LifecycleReconnectGuard.ts`
- `decent-client-web/src/ui/SettingsPanel.ts`
