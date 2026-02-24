# Features Overview (Implementation-Based)

This page lists user-facing features that are implemented in the current web client.

## Messaging

Implemented:
- channels
- standalone direct conversations
- thread replies in side panel
- reactions
- typing indicators
- delivery/read receipts
- attachment sending (including clipboard image paste)

Code references:
- `decent-client-web/src/ui/UIRenderer.ts`
- `decent-client-web/src/app/ChatController.ts`

## Workspace experience

Implemented:
- create workspace
- join via invite URL/code
- workspace switcher rail
- workspace/channel members modals
- activity feed (mentions + thread replies)

Code references:
- `decent-client-web/src/ui/UIRenderer.ts`
- `decent-client-web/src/main.ts`

## Roles & permissions

Implemented role model:
- owner
- admin
- member

Surfaced controls:
- promote/demote/remove members
- workspace-level permissions:
  - who can create channels
  - who can invite members

Code references:
- `decent-client-web/src/ui/UIRenderer.ts`
- `decent-client-web/src/app/ChatController.ts`

## Search and notifications

Implemented:
- local search panel (`Ctrl/Cmd+F`)
- unread counts
- desktop notifications (when browser permission granted)

Code references:
- `decent-client-web/src/ui/MessageSearch.ts`
- `decent-client-web/src/ui/NotificationManager.ts`

## Reliability

Implemented:
- offline queue for outbound messages
- reconnect + peer maintenance logic
- sync/catch-up flows on reconnect

Code references:
- `decent-client-web/src/app/ChatController.ts`
- `decent-client-web/src/app/LifecycleReconnectGuard.ts`

## Important current limitations

- No dedicated offline banner/state panel.
- Notification toggles exist in settings UI, but runtime notification logic does not yet strictly enforce those toggles internally.
- Join-by-code can require manual peer-id prompt if invite lacks embedded peer details.
- Search UX is currently focused on active-channel workflows.

For detailed UX behavior, see [UI & UX Implementation Status](/ui/ux-implementation-status).
