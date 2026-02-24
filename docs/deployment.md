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
