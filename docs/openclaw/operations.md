# Operations & Troubleshooting

## Runbook

1. Configure `channels.decentchat.seedPhrase`
2. Start OpenClaw and confirm channel status shows `running=true`
3. Verify log line: `[xena-peer] online as <peerId>`
4. Confirm peers connect and handshake successfully
5. Verify inbound messages trigger assistant reply in DM/group

## Template-first company-sim runbook

1. Install a template (see `docs/openclaw/company-sim-template-installer.md`).
2. Confirm install summary includes expected agents/accounts/channels.
3. Fill `seedPhrase` for every account in `summary.createdAccountIds`.
4. Ensure `channels.decentchat.companySimBootstrap` is enabled in runtime mode with valid `manifestPath`.
5. Start OpenClaw and check for bootstrap log: `company bootstrap ready`.
6. Verify each company account data dir has a shared workspace with expected channels/members.

### Template install troubleshooting

#### Bootstrap enabled but manifest path missing

Symptoms:

- startup error similar to `companySimBootstrapManifestPath is missing`

Fix:

- set `channels.decentchat.companySimBootstrap.manifestPath` (or legacy flat field) to the generated `company.yaml` path

#### Bootstrap fails with missing account list

Symptoms:

- error lists missing account ids for company employees

Fix:

- add missing entries under `channels.decentchat.accounts`
- ensure each account has `seedPhrase` and (recommended) dedicated `dataDir`

#### Bootstrap fails with missing topology installation

Symptoms:

- error mentions missing `agents.list` entries or route bindings

Fix:

- re-run template installer and write merged config
- avoid manually deleting installer-managed `agents.list`/`bindings` entries

## Health indicators

Expected logs:

- startup: signaling servers list + online peer id
- connect/disconnect events
- stream telemetry (`enabled/chunks/finalChars`) during streamed replies
- offline queue flush counts after reconnection

Status surface (`src/channel.ts`):

- `running`
- `configured`
- `lastError`

## Common failures

### Missing seed phrase

Symptoms:

- start failure with message about `channels.decentchat.seedPhrase`

Fix:

- provide valid BIP39 mnemonic in channel config

### Invalid seed phrase

Symptoms:

- startup throws validation error

Fix:

- replace with valid mnemonic (12/24 words)

### No outbound delivery (`DecentChat peer not running`)

Symptoms:

- outbound `sendText` fails immediately

Root cause:

- active peer singleton not initialized / runtime not started

Fix:

- check account enabled/configured and restart channel runtime

### Peers connected but decrypt fails

Symptoms:

- decrypt warnings, message drops

Current behavior:

- ratchet/shared secret state is reset on decrypt failure
- new handshake should re-establish state

Fix:

- inspect handshake/public key sync and ensure both peers are on compatible protocol versions

### Stream duplicates or missing final persistence

Current behavior:

- when streaming is ON, final plain message is intentionally not re-sent
- when streaming is OFF, final reply is sent once as normal message

If UX appears wrong:

- verify `streamEnabled` and receiver stream rendering behavior

## Storage locations

Default data dir:

- `~/.openclaw/data/decentchat`

Inbound temporary image files:

- `~/.openclaw/media/inbound`

## Current known gaps

1. `thread.initialHistoryLimit` not applied
2. `replyToMode=first` not distinctly implemented
3. `openclaw.plugin.json` drift from `src/channel.ts` schema
4. media `chunkHash` integrity TODO
5. single active peer singleton limits richer multi-account support

## Test coverage snapshot

Unit tests in `decent-openclaw/tests/unit/` cover:

- seed phrase validation
- signaling URL normalization
- offline queue reconnect behavior
- pending ack clear on ack
- name announce flow/alias cache
- message restore from drifted buckets
- runtime streaming + thread-session behavior
- stream finalize direct/group semantics
