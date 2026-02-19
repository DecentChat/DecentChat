# Testing Workflow

All new features and bug fixes require tests. Tests are the primary safety
net for storage compatibility, protocol correctness, and regression prevention.

---

## Test Suites

### Protocol Unit Tests (primary)
```bash
cd decent-protocol && bun test
```
- Location: `decent-protocol/tests/unit/`
- Runner: Bun native test runner
- Coverage: All protocol logic, crypto, CRDTs, storage, identity
- **Target: 663+ tests, 0 failures**
- Fast (~6s) — run on every change

### Client Unit Tests
```bash
cd decent-client-web && bun test
```
- Location: `decent-client-web/tests/unit/`
- Runner: Bun native test runner
- Coverage: UI managers (QRCodeManager, NotificationManager, etc.)

### E2E / Integration Tests
```bash
cd decent-client-web && bun run test:integration
```
- Location: `decent-client-web/tests/integration/`
- Runner: Playwright (Chromium headless)
- **Known failures: 13** (WebRTC P2P — Playwright infrastructure limitation)
- Run before deploy to verify failure count hasn't increased

---

## When to Write Tests

| Change | Test location | What to test |
|--------|--------------|-------------|
| New protocol feature | `decent-protocol/tests/unit/` | Happy path, edge cases, invalid input |
| Bug fix | Same file as broken code | Regression: the specific bug scenario |
| New UI component | `decent-client-web/tests/unit/` | Callbacks, state transitions |
| Protocol message type | `decent-protocol/tests/unit/` | Encode/decode roundtrip, validation |
| Storage migration | `decent-protocol/tests/unit/migrations.test.ts` | Old data → new structure |
| Crypto change | `decent-protocol/tests/unit/` | Key derivation determinism, old ciphertext |
| Security fix | `decent-protocol/tests/unit/` | Prove the vulnerability is closed |

---

## Test File Naming & Location

```
decent-protocol/tests/unit/
  workspace-isolation.test.ts   ← one concern per file
  reactions.test.ts
  threads.test.ts
  notifications.test.ts
  seed-phrase.test.ts
  ...

decent-client-web/tests/unit/
  qr-seed-restore.test.ts
  notification-manager.test.ts
  ...

decent-client-web/tests/integration/
  <feature>.spec.ts             ← Playwright E2E
```

---

## Writing Good Protocol Tests

```typescript
import { describe, test, expect } from 'bun:test';

describe('FeatureName', () => {
  // Group by behaviour, not by method name
  describe('happy path', () => {
    test('does the expected thing', () => {
      const result = doThing(validInput);
      expect(result).toEqual(expectedOutput);
    });
  });

  describe('edge cases', () => {
    test('handles empty input gracefully', () => {
      expect(() => doThing('')).not.toThrow();
    });

    test('rejects invalid input', () => {
      expect(() => doThing(null as any)).toThrow();
    });
  });

  describe('security', () => {
    test('cannot forge a valid result without the key', async () => {
      const tampered = { ...validResult, signature: 'fake' };
      await expect(verify(tampered)).rejects.toThrow();
    });
  });
});
```

**Minimum test count for new features: 10–20 tests**
Previous examples:
- `workspace-isolation.test.ts` — 17 tests
- `reactions.test.ts` — 20 tests
- `threads.test.ts` — 20 tests

---

## Crypto / Key Tests

Crypto tests must prove **determinism** and **isolation**:

```typescript
test('same seed always produces same peer ID', async () => {
  const id1 = await spm.derivePeerId(MNEMONIC);
  const id2 = await spm.derivePeerId(MNEMONIC);
  expect(id1).toBe(id2);
});

test('different seeds produce different peer IDs', async () => {
  const id1 = await spm.derivePeerId(MNEMONIC_A);
  const id2 = await spm.derivePeerId(MNEMONIC_B);
  expect(id1).not.toBe(id2);
});
```

**Never hard-code expected crypto output** without a comment explaining why
that exact value is expected. Otherwise a key algorithm change silently
changes the test expectation and defeats the purpose.

---

## Storage Migration Tests

When adding a storage migration, always test the migration itself:

```typescript
test('migration v4 → v5 preserves all messages', async () => {
  // 1. Build a v4-shaped data object
  const oldData = { id: 'msg-1', content: 'hello', timestamp: 12345 };

  // 2. Apply the migration function
  const newData = await migrateV4toV5(oldData);

  // 3. Verify data survived
  expect(newData.id).toBe('msg-1');
  expect(newData.content).toBe('hello');
  // New field added correctly
  expect(newData.channelId).toBe('general');
});

test('migration v4 → v5 handles missing optional fields', async () => {
  const partial = { id: 'msg-2', content: 'hi' }; // no timestamp
  const result = await migrateV4toV5(partial);
  expect(result.timestamp).toBeDefined(); // should have a default
});
```

---

## Regression Tests

When fixing a bug, write the test *first* (before the fix) to confirm it
fails, then fix it to confirm the test passes. Include in commit message:

```
fix: reactions not syncing across workspaces

The handleReactionEvent() was passing notify=false which silently
dropped callbacks for peer-received reactions.

Regression test added in reactions.test.ts:
  - "peer reaction notify=true triggers onChanged callback"
```

---

## E2E Test Guidelines

E2E tests (Playwright) are for user-facing flows that can't be covered
by unit tests:

```typescript
test('user can create a workspace and send a message', async ({ page }) => {
  await page.goto('/');
  await page.click('#create-ws-btn');
  await page.fill('#workspace-name', 'Test Workspace');
  await page.click('#create-ws-confirm');
  // ...
});
```

**Don't write E2E tests for:**
- WebRTC P2P connectivity (known Playwright limitation)
- Crypto operations (unit test those)
- Protocol message formats (unit test those)

**Do write E2E tests for:**
- UI flows (modal opens, form validates, button click leads to expected state)
- Navigation (channel switch, workspace switch)
- Settings (save persists, theme applies)

---

## Running Tests Efficiently

```bash
# Run only a specific test file
cd decent-protocol && bun test tests/unit/reactions.test.ts

# Run tests matching a pattern
cd decent-protocol && bun test --test-name-pattern "workspace isolation"

# Run and watch
cd decent-protocol && bun test --watch

# Verbose output
cd decent-protocol && bun test --reporter=verbose 2>&1 | head -50
```

---

## Test Coverage Expectations

| Component | Unit tests | Notes |
|-----------|-----------|-------|
| SeedPhraseManager | ✅ Required | Determinism, validation, key derivation |
| CryptoManager | ✅ Required | Encrypt/decrypt, sign/verify, edge cases |
| MessageCRDT | ✅ Required | Merge, conflict resolution, ordering |
| WorkspaceManager | ✅ Required | Create, join, sync, isolation |
| NotificationManager | ✅ Required | Unread counts, focus tracking |
| QRCodeManager | ✅ Required | URI format, scan routing, callbacks |
| PersistentStore | ✅ Required | CRUD, migrations, version handling |
| UIRenderer | optional | Hard to unit test; covered by E2E |
| SettingsPanel | optional | E2E sufficient |

---

## Fixing Flaky Tests

A test that fails intermittently without code changes is a flaky test.
Causes: timing dependencies, non-deterministic crypto, shared state.

**Fix, don't skip:**
```typescript
// ❌ Bad
test.skip('flaky test — sometimes fails', () => { ... });

// ✅ Good: fix the underlying timing issue
test('deterministic test', async () => {
  const result = await waitForCondition(() => getResult());
  expect(result).toBe(expected);
});
```

---

## Links

- Deployment checklist: `.agents/deployment.md`
- Protocol change workflow: `.agents/protocol-changes.md`
- Storage migration workflow: `.agents/storage-migrations.md`
- Test files: `decent-protocol/tests/unit/`
- E2E tests: `decent-client-web/tests/integration/`
