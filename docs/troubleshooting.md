# Troubleshooting

## Issue: Stuck on loading storage in second tab

### Symptoms

- App appears stuck during initialization
- Console shows:
  - `Error: ID "..." is taken`
  - PeerJS abort/retry loop

### Cause

Two tabs try to own the same derived peer ID at once.

### Fix

- Ensure only `/app` performs transport init
- Keep `/` as landing-only route
- Add explicit error UI when peer ID already active in another tab

## Issue: Clipboard auto-detect not working in join dialog

### Symptoms

No auto-fill from clipboard despite copied invite.

### Checks

- Dialog opened via user interaction
- Browser supports Clipboard API in secure context
- Clipboard contains a supported invite format
- Existing user input is not being intentionally preserved

## Issue: Layout warning before full page load

### Example

`Layout was forced before the page was fully loaded...`

### Notes

Usually non-fatal. Investigate if it correlates with visible FOUC or bootstrap race conditions. Prioritize runtime blockers (transport/session collisions) first.

## Issue: Derived peer ID fallback warning

### Example

`Failed to derive peer ID from seed phrase, falling back...`

### Checks

- Seed phrase availability/validity
- Crypto API compatibility in browser context
- Any storage corruption during identity restore

If fallback occurs often, treat as a bug: identity derivation should be deterministic and stable.

## Debug Capture Template

When filing issues, include:

- Route (`/`, `/app`, `/join/...`)
- Browser + version
- Reproduction steps
- Full console snippet
- Whether another DecentChat tab/session was open
