# User Quick Start

This guide reflects the **current DecentChat implementation**.

## 1) Open DecentChat

- Landing page is at `/`.
- Full chat runtime is at `/app`.
- Invite links use `/join/...` and then open the join flow.

**Reference:** `decent-client-web/src/main.ts`

## 2) Identity setup (automatic)

On first app run, DecentChat auto-generates a 12-word seed phrase if you do not already have one.

- no email
- no phone number
- no password reset system

You can restore an identity from seed phrase from landing/settings UI.

**References:**
- `decent-client-web/src/main.ts`
- `decent-client-web/src/ui/UIRenderer.ts`
- `decent-client-web/src/ui/SettingsPanel.ts`

## 3) Create or join a workspace

### Create
- Use **Create workspace** on landing
- enter workspace name + your alias

### Join
- Use **Join workspace**
- paste invite link/code
- if invite contains metadata, workspace preview appears
- app may auto-fill invite from clipboard (if browser allows clipboard read)

If you only have a plain invite code (without peer info), app may ask for inviter peer ID.

**Reference:** `decent-client-web/src/ui/UIRenderer.ts` (`showCreateWorkspaceModal`, `showJoinWorkspaceModal`)

## 4) Start chatting

Available now:
- channels
- standalone direct messages
- threads (side panel)
- reactions
- typing indicators
- message delivery/read states
- file attachments (including pasted images)

**References:**
- `decent-client-web/src/ui/UIRenderer.ts`
- `decent-client-web/src/app/ChatController.ts`

## 5) Search and notifications

- `Ctrl/Cmd + F` opens local message search panel
- desktop notifications work with browser permission
- unread counters are shown in sidebar/workspace activity

**References:**
- `decent-client-web/src/ui/MessageSearch.ts`
- `decent-client-web/src/ui/NotificationManager.ts`

## 6) Offline and reconnect behavior

When peers are offline:
- outgoing messages queue
- queue flushes when peers reconnect
- reconnect guards and peer maintenance run automatically

What you see:
- delivery state changes
- presence dots
- queue-related toasts when delivery resumes/fails

**References:**
- `decent-client-web/src/app/ChatController.ts`
- `decent-client-web/src/app/LifecycleReconnectGuard.ts`

## 7) Back up your seed phrase

Your seed phrase is your account. Back it up securely offline.

If you lose it, there is no central recovery service.
