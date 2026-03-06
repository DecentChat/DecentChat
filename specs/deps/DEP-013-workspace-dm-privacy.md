# DEP-013: Workspace DM Privacy Preference (Invite-Time Allow/Disallow)

```
Number:  DEP-013
Title:   Workspace DM Privacy Preference (Invite-Time Allow/Disallow)
Author:  Alex + Xena
Status:  Draft
Type:    Application
Created: 2026-03-06
Requires: DEP-007 (workspace-state sync)
```

## Abstract

This DEP adds a per-member privacy preference controlling whether a workspace member can receive direct messages initiated from inside that workspace.

At invite acceptance time, users choose whether to allow workspace DMs (Discord-like behavior). The preference is synced as part of workspace member state and enforced by both sender-side UX checks and receiver-side validation.

## Motivation

Current behavior allows any workspace member to initiate a DM from the workspace member list with no per-user privacy control. Users need a simple way to opt out of unsolicited workspace DMs while still participating in channels.

Requirements:

- Capture the preference during invite acceptance.
- Keep backward compatibility with existing clients/data.
- Prevent bypasses (UI-only restrictions are insufficient).
- Preserve standalone contact DMs (outside workspace context).

## Specification

### 1) Member Field

Add an optional field to `WorkspaceMember`:

- `allowWorkspaceDMs?: boolean`

Semantics:

- `true` => member allows workspace-origin DMs.
- `false` => member disallows workspace-origin DMs.
- `undefined` => treated as `true` for backward compatibility.

### 2) Invite Acceptance UX

When joining via invite, the modal MUST include:

- Checkbox: `Allow direct messages from workspace members`
- Default: checked (`true`)

Submitted value is stored on the joining member record in the joined workspace.

### 3) Sync Propagation

The preference MUST be propagated through existing member sync surfaces:

- Workspace state snapshots (`workspace-sync` / `workspace-state` member list)
- Any lightweight member announcements used to refresh member metadata

Peers should eventually converge on the same preference value.

### 4) Enforcement

#### 4.1 Sender-side (UX)

When initiating DM from workspace member list (workspace context):

- If target member preference is `false`, sender UI must block DM creation and show a deterministic error/toast.

This is a UX guard only.

#### 4.2 Receiver-side (Authoritative)

Workspace-origin direct envelopes MUST include optional `workspaceContextId` metadata.

On inbound workspace-origin direct message:

- Receiver resolves local member record for self in `workspaceContextId`.
- If local `allowWorkspaceDMs` is `false`, receiver MUST reject/drop the message and may emit a denial control event (`direct-denied`).

Receiver-side check is authoritative and prevents bypass by modified clients.

### 5) Scope

This preference applies only to **workspace-origin DMs**.

It does **not** automatically block:

- Existing standalone contact DMs without workspace context.
- Other non-workspace channels/features.

## Rationale

- Invite-time preference maps naturally to user expectations and avoids hidden privacy settings.
- Optional field avoids hard migrations and keeps old clients interoperable.
- Dual enforcement (sender UX + receiver validation) balances usability and security.

## Backward Compatibility

- Old data without `allowWorkspaceDMs` behaves as allow (`true`).
- Older clients that do not send `workspaceContextId` continue to work as legacy direct messages.
- New clients should still treat missing preference as allow.

## Security Considerations

- Sender-side block alone is insufficient; receiver-side enforcement is required.
- Malicious clients may forge or omit workspace context metadata.
- Receiver must only enforce deny on messages explicitly marked as workspace-origin; otherwise preserve legacy behavior.
- Audit logs/toasts for denials should avoid leaking sensitive details.

## Test Vectors

### Vector A: Invite with DMs disabled

1. Bob joins workspace via invite with checkbox unchecked.
2. Alice tries DM from workspace members list.
3. UI blocks start with `disallows workspace DMs` error.
4. Crafted workspace-origin envelope to Bob is dropped by Bob.

### Vector B: Legacy member record

1. Workspace member has no `allowWorkspaceDMs` field.
2. Sender sees member as DM-allowed.
3. DM flow behaves exactly as pre-DEP behavior.

### Vector C: Standalone contact DM unaffected

1. Bob disables workspace DMs.
2. Alice starts DM from contacts view (outside workspace context).
3. Message is delivered as normal legacy direct conversation.

## Reference Implementation

Planned implementation:

- `decent-protocol/src/workspace/types.ts`
- `decent-client-web/src/lib/components/modals/JoinWorkspaceModal.svelte`
- `decent-client-web/src/app/ChatController.ts`
- `decent-client-web/tests/integration/workspace-dm-privacy.spec.ts`

## References

- DEP-007: Workspace snapshot/state sync
- DEP-005 / DEP-012: Delivery and reliability semantics

## Copyright

This document is placed in the public domain (CC0-1.0).
