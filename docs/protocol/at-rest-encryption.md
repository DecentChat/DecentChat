# At-Rest Encryption

## 1) What it is

Local encryption for persisted message content in IndexedDB.

## 2) How it works

- App derives a master seed from mnemonic startup flow.
- `AtRestEncryption` derives AES-GCM key material via HKDF.
- `PersistentStore` encrypts `message.content` before write and decrypts on read.

## 3) Current implementation status

**Partially implemented**

## 4) Limitations / gaps

- Only message `content` is encrypted; metadata fields remain plaintext for indexing.
- Existing legacy plaintext records are tolerated rather than eagerly re-keyed.
- This is local-device protection, not a replacement for network E2E encryption.
- Non-message stores (for example many settings/workspace fields) are not covered by this mechanism.

## 5) Where in code it lives

- `decent-protocol/src/storage/AtRestEncryption.ts`
- `decent-protocol/src/storage/PersistentStore.ts`
- `decent-client-web/src/main.ts`
