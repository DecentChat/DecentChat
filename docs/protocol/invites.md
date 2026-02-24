# Invites

## 1) What it is

Shareable invite links/URIs that carry workspace join details and connection bootstrap hints.

## 2) How it works

- `InviteURI` encodes/decodes web and native invite formats.
- Invite payload can include invite code, signaling host/port/path, fallback servers, inviter peer ID, and optional public key/workspace metadata.
- Join flow sends a `join-request` using invite code; inviter validates code and returns workspace state.

## 3) Current implementation status

**Partially implemented**

## 4) Limitations / gaps

- Invite code validation is code-based and workspace-local; no signed/expiring one-time token model.
- Invite lifecycle controls (rotation/revocation/audit) are limited.
- Invite permissions exist in workspace settings, but invite-link generation/usage is not a full policy+token system.

## 5) Where in code it lives

- `decent-protocol/src/invite/InviteURI.ts`
- `decent-protocol/src/workspace/SyncProtocol.ts`
- `decent-protocol/src/workspace/WorkspaceManager.ts`
- `decent-client-web/src/app/ChatController.ts`
