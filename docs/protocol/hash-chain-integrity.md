# Hash Chain Integrity

## 1) What it is

Tamper-evidence for message history by linking each message to the hash of the previous message.

## 2) How it works

- `HashChain` computes SHA-256 over canonical message fields.
- `MessageStore` enforces `prevHash` linkage on message insert.
- Full-chain verification is available for channel validation and for sync imports that include full message content.

## 3) Current implementation status

**Partially implemented**

## 4) Limitations / gaps

- Some sync/import paths intentionally omit content and skip full-chain content verification.
- Local trusted restore paths (`forceAdd`) bypass chain verification by design.
- Integrity is strong for validated paths, but not uniformly enforced on every persistence/sync path.

## 5) Where in code it lives

- `decent-protocol/src/crypto/HashChain.ts`
- `decent-protocol/src/messages/MessageStore.ts`
- `decent-protocol/tests/unit/hash-chain-branch.test.ts`
- `decent-protocol/tests/unit/sync-edge-cases.test.ts`
