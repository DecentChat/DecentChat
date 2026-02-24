# Roles and Permissions

This document describes the role model as currently implemented in the DecentChat client.

## Roles

### Owner

Owner is the highest-privilege workspace role.

Current owner capabilities (implemented):
- promote member → admin
- demote admin → member
- remove members (except owner)
- delete workspace
- update workspace info/permissions

### Admin

Admin has management capabilities, but below owner.

Current admin capabilities (implemented):
- remove non-owner members
- can manage workspace settings where permitted by workspace manager rules

### Member

Default participant role.

Current member capabilities (implemented):
- normal messaging participation
- channel/workspace interaction within current workspace policy
- may create channels/invite members if workspace policy is set to `everyone`

---

## Permissions surfaced in UI

Workspace Settings modal exposes:
- **Who can create channels?** (`everyone` or `admins`)
- **Who can invite members?** (`everyone` or `admins`)

Workspace Members modal exposes role operations:
- Promote (owner-only in current UX path)
- Demote (owner-only)
- Remove (admin/owner depending on target)

Code references:
- `decent-client-web/src/ui/UIRenderer.ts`
- `decent-client-web/src/app/ChatController.ts`

---

## Security model notes (implementation)

Role and settings sync events are validated in controller logic, including signature verification paths for admin events and replay protection checks.

Code reference:
- `decent-client-web/src/app/ChatController.ts`

---

## Current limitations

- Permissions are workspace-wide only (no channel-level ACL matrix in the current user UI).
- Behavior can be affected by stale/out-of-sync peer state during reconnection windows, though controller includes defensive checks and sync recovery paths.
