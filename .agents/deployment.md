# Deployment Workflow

Deploying DecentChat touches real users' data, keys, and peer connections.
A bad deploy can orphan peer IDs, corrupt IndexedDB, or silently break
encryption for everyone who hasn't refreshed yet.

**Rule: never deploy until all gates below pass.**

---

## Quick Reference

```bash
# 1. Run unit tests — must be 0 fail
cd decent-protocol && bun test

# 2. Run typecheck — must be 0 errors
cd decent-client-web && bun run typecheck

# 3. Build — must succeed cleanly
cd .. && bun run build:client

# 4. Check E2E baseline (see §E2E Tests below)
cd decent-client-web && bun run test:integration 2>&1 | tail -5

# 5. Deploy
cd .. && ./scripts/deploy.sh
```

---

## Gate 1 — Protocol Unit Tests (BLOCKING)

```bash
cd decent-protocol && bun test
```

**Required result: `0 fail`**

All 663+ tests must pass. A single failure blocks deployment, no exceptions.
Flaky tests do happen on a re-run; run twice before investigating.

If tests are failing:
- Fix the code. Never skip or comment out tests to make CI green.
- If the test itself is wrong (bad assertion, wrong expectation), fix the test
  and document why in the commit message.

---

## Gate 2 — TypeScript Typecheck (BLOCKING)

```bash
cd decent-client-web && bun run typecheck
```

**Required result: `0 errors`**

The build (`vite build`) catches most TS errors but not all — run typecheck
explicitly. A build that emits JS despite type errors is still a broken deploy.

---

## Gate 3 — Build (BLOCKING)

```bash
cd decent-client-web && bun run build
# or from root:
bun run build:client
```

**Required result: exits 0, no error output**

The build must succeed cleanly. Vite warnings are acceptable; errors are not.
Inspect output bundle sizes — a sudden +50KB jump deserves investigation
(you may have accidentally imported a Node-only module).

---

## Gate 4 — E2E Tests (ADVISORY — threshold-based)

```bash
cd decent-client-web && bun run test:integration
```

**Required result: failures ≤ 13 (current known baseline)**

The 13 currently failing tests are all WebRTC P2P connection tests that fail
due to Playwright's headless Chromium environment (STUN timeouts, browser
contexts on different IPs). These are infrastructure limitations, not app bugs.

**Known failing tests (do not regress beyond this list):**
```
messaging-simple.spec.ts       — simple P2P message exchange
messaging.spec.ts (×3)         — real-time send/receive, concurrent, rapid
mock-messaging.spec.ts (×2)    — MockTransport messaging
multi-user.spec.ts (×3)        — Alice/Bob P2P messaging
webrtc-final.spec.ts           — P2P data channel
webrtc-localhost.spec.ts       — localhost ICE
webrtc-raw.spec.ts             — raw transport
webrtc-transport.spec.ts       — transport state
```

**If failure count increases** → stop. You've broken something. Fix before deploying.
**If a previously passing test starts failing** → stop. Fix before deploying.

---

## Gate 5 — Compatibility Checks (depends on what changed)

Run `git diff HEAD~1 --name-only` and check each category:

### 5a. Storage schema changed?

Files: `decent-protocol/src/storage/PersistentStore.ts`,
       `decent-protocol/src/storage/migrations.ts`

→ Read `.agents/storage-migrations.md` in full before proceeding.

**Checklist:**
- [ ] Is this v0.x (no real users) or v1.0+ (users with data)?
- [ ] For v1.0+: migration written, tested with exported real data, logged
- [ ] `PersistentStore` version bumped if schema changed
- [ ] "Clear Local Data" fallback still works

**Red lines:**
- Never change the IndexedDB version number without a corresponding migration
- Never rename object stores without migrating existing data
- Never change `keyPath` on existing stores

### 5b. Protocol wire format changed?

Files: `decent-protocol/src/messages/`, `decent-protocol/src/workspace/`,
       `decent-transport-webrtc/src/`

→ Read `.agents/protocol-changes.md` in full before proceeding.

**Checklist:**
- [ ] DEP exists for this change (or DEP explicitly not required — document why)
- [ ] Backward compatibility: can a client on the old version still connect?
- [ ] Is the change additive (new optional field) or breaking (renamed/removed field)?
- [ ] If breaking: version bump in message type or envelope format

**Safe patterns:**
- Adding **optional** fields with fallback defaults → additive, no DEP required
- Renaming required fields → breaking, needs DEP + migration + version bump
- Adding new message types → additive, lightweight DEP recommended

### 5c. Peer ID derivation changed?

Files: `decent-protocol/src/identity/SeedPhrase.ts`,
       `decent-client-web/src/main.ts` (lines around `derivePeerId`)

**This is the most dangerous category.** Changing peer ID derivation means
every existing user gets a new peer ID after the update. Their contacts will
not recognise them. Their workspace memberships will be orphaned.

**Checklist:**
- [ ] Does existing stored `myPeerId` (in IndexedDB settings) survive the change?
- [ ] Does `derivePeerId()` produce the same result for the same seed phrase as before?
- [ ] If the algorithm must change: provide a migration that reads the old ID and
      writes the new one, then updates all workspace member records

**If in doubt: do not change peer ID derivation.**

### 5d. Crypto primitives changed?

Files: `decent-protocol/src/crypto/`, `decent-protocol/src/messages/DoubleRatchet.ts`

- Changing key derivation parameters (PBKDF2 iterations, HKDF contexts) = breaking
- Changing curve (P-256 → P-384) = breaking
- Adding a new key usage = additive (safe)

Always add a corresponding unit test proving the old ciphertext is still
decryptable after the change (or explicitly prove it's not and handle that).

---

## Deploy Steps

Once all gates pass:

```bash
# From repo root
./scripts/deploy.sh
```

What this does:
1. `bun run build:client` — Vite production build → `decent-client-web/dist/`
2. `lftp` mirror `dist/` → `decentchat.app/web/` over FTPS (delete removed files)
3. PWA service worker is updated automatically via Workbox

**Credentials:** See `TOOLS.md` for FTP host, login, password.

**Do not deploy from a dirty working tree** (uncommitted changes).
Always ensure `git status` is clean before running the deploy script.

```bash
git status          # should be clean
git log --oneline -3  # review what's going out
./scripts/deploy.sh
```

---

## Post-Deploy Smoke Test

After every deploy, manually verify at https://decentchat.app:

### Tier 1 — Always (2 min)
- [ ] Page loads without JS errors in console
- [ ] Logo displays correctly (dark/light mode)
- [ ] "Create Workspace" modal opens
- [ ] "Join with Invite Code" modal opens
- [ ] "Restore from seed phrase" link visible + modal opens

### Tier 2 — After protocol/storage changes (10 min)
- [ ] Create a new workspace → name appears in sidebar
- [ ] Send a message → it appears in the channel
- [ ] Reload the page → workspace and messages persist (IndexedDB working)
- [ ] Settings → Seed Phrase → Show works
- [ ] Settings → 📲 Transfer → QR code generates

### Tier 3 — After identity/crypto changes (30 min)
- [ ] Full two-device test: Device A creates workspace, Device B joins
- [ ] Messages flow both ways
- [ ] Reload both devices → reconnection works
- [ ] Peer IDs are the same before and after reload (no identity regression)

---

## Rollback

If the deploy breaks something:

### Immediate (< 5 min)
```bash
# Revert the last commit and redeploy
git revert HEAD --no-edit
./scripts/deploy.sh
```

### If the broken commit is not the last one
```bash
git revert <broken-sha> --no-edit
./scripts/deploy.sh
```

### Storage emergency (users report data loss)
1. **Do not deploy again** until the migration issue is understood
2. Redeploy the previous working version immediately
3. The "Clear Local Data & Reload" button (in the error screen) is a user
   self-recovery mechanism — it's a last resort, not a fix
4. Write a proper migration, test it, then redeploy

---

## Change Classification Table

Use this to determine which gates to run and what docs to read.

| Change type | Unit tests | Typecheck | Build | E2E | storage-migrations.md | protocol-changes.md | Post-deploy tier |
|---|---|---|---|---|---|---|---|
| UI only (CSS, layout) | ✅ | ✅ | ✅ | advisory | no | no | 1 |
| New UI feature | ✅ | ✅ | ✅ | advisory | no | no | 2 |
| Settings (new key+default) | ✅ | ✅ | ✅ | advisory | no | no | 1 |
| New optional protocol field | ✅ | ✅ | ✅ | ✅ | no | recommended | 2 |
| New message type | ✅ | ✅ | ✅ | ✅ | no | **required** | 2 |
| Storage schema change | ✅ | ✅ | ✅ | ✅ | **required** | depends | 3 |
| Crypto algorithm change | ✅ | ✅ | ✅ | ✅ | **required** | **required** | 3 |
| Peer ID derivation change | ✅ | ✅ | ✅ | ✅ | **required** | **required** | 3 |
| Wire format breaking change | ✅ | ✅ | ✅ | ✅ | depends | **required** | 3 |

---

## Deploying Storage Migrations

The app is currently at **v0.x** (no real users in production at scale).
This means:

**Acceptable now:** Version bump + clear data (with user-visible error screen)
**Required for v1.0+:** Full non-destructive migration (see storage-migrations.md)

When deploying a storage schema change at v0.x:
1. Bump the DB version in `PersistentStore.ts`
2. The existing "storage init failed" error screen will offer "Clear Local Data & Reload"
3. Document the breaking change in the commit message with `BREAKING STORAGE:`

---

## Versioning Convention

```
v0.x.y  → Early development. Storage breaks acceptable with notice.
v1.0.0  → First stable. Storage migrations required from this point.
v1.x.y  → Additive changes only on patch. Minor = new features. Major = breaking.
```

Bump `version` in `decent-client-web/package.json` before deploying any user-visible version change.

---

## Common Mistakes

**❌ "Tests were passing before my change, good enough"**
→ Run them again. Test results after your change are what matter.

**❌ Deploying on Friday or before going offline**
→ Don't. If something breaks, you need to be available to fix it.

**❌ "It's just a CSS change, no need to build/test"**
→ CSS is bundled with JS. Build anyway. Takes 30 seconds.

**❌ "I'll write the migration after deploy to fix the broken state"**
→ By then users have hit the error. Write it first.

**❌ "The E2E failures are pre-existing, I'll ignore them"**
→ Count them. If the count increased, you broke something new.

---

## Links

- Storage details: `.agents/storage-migrations.md`
- Protocol DEP workflow: `.agents/protocol-changes.md`
- Test coverage guidelines: `.agents/testing.md`
- FTP credentials + server info: `TOOLS.md`
- Deploy script: `scripts/deploy.sh`
- Signaling server: `scripts/signaling-server.ts`
