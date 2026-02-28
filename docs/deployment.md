# Deployment Guide

## Target

Production deployment currently serves DecentChat at `https://decentchat.app`.

## Standard Deployment

### App

Use repo deployment script from project root:

```bash
./scripts/deploy.sh
```

Expected behavior:
- Build client bundle
- Upload/mirror artifacts to configured host path

### Docs

Deploy docs site build (VitePress):

```bash
bun run deploy:docs
```

Uses `DEPLOY_DOCS_REMOTE_PATH` from `.env.deploy` (default: `decentchat.app/docs/`).
For a dedicated subdomain, set it to something like `docs.decentchat.app/web/`.

## Pre-Deploy Checklist

1. `bun run test`
2. `bun run test:unit`
3. `bun run build:client`
4. For sync-critical changes: `bun run gate:quick` (or `gate:predeploy`)
5. Verify route contract (`/` landing, `/app` runtime)

## Post-Deploy Smoke

- Landing page loads at `/`
- App loads at `/app`
- Join links from `/join/*` work end-to-end
- No peer ID collision in normal multi-tab usage
- Console shows no critical bootstrap errors

## Rollback Strategy

If production shows regressions:
- Re-deploy previous known-good build
- Keep issue notes with:
  - affected routes
  - exact console/runtime errors
  - reproduction steps

## Notes

Credentials and environment-specific deployment details are intentionally kept outside this document. Use secure local config and team runbooks.


## Decent OpenClaw rollout strategy

### Config migration

Before:

```yaml
channels:
  decentchat:
    replyToMode: all
```

After:

```yaml
channels:
  decentchat:
    replyToMode: all
    replyToModeByChatType:
      direct: off
      group: all
      channel: all
    thread:
      historyScope: thread
      inheritParent: false
      initialHistoryLimit: 10
```

### Staging dry-run checklist

1. Start OpenClaw with updated config in staging account.
2. Validate direct chat behavior:
   - direct message routes to base direct session when `direct: off`.
3. Validate group/thread behavior:
   - reply in thread routes to `:thread:<id>` session.
4. Check logs include structured route line (`[decentchat] route ...`).
5. Validate message send targets:
   - `peerId`, `channel:<id>`, and `decentchat:channel:<id>`.
6. Run regression pack from `docs/testing.md`.

### Fast rollback

If regressions appear, apply conservative toggles and restart:

```yaml
channels:
  decentchat:
    replyToMode: off
    thread:
      historyScope: channel
      initialHistoryLimit: 0
```

Then revert commit range if needed and re-run the regression pack.
