# Landing & App Routing

This document defines expected behavior between marketing/onboarding routes and application runtime routes.

## Goals

- Keep landing page always accessible (`/`)
- Keep app runtime isolated (`/app`)
- Preserve deep-link join flows (`/join/*`)
- Avoid multi-tab peer ID collisions from accidental app bootstrap on non-app routes

## Route Contract

## `/` (Landing)

Must:
- render product/marketing/onboarding shell
- allow navigation to app via CTA

Must NOT:
- initialize transport
- claim peer identity/session ownership
- block on full app storage bootstrap

## `/app` (Runtime App)

Must:
- initialize storage + identity + transport
- restore/join workspace state
- own peer session lifecycle

## `/join/*` (Invite Entry)

Must:
- parse invite payload
- guide user into join flow
- transition to `/app` only when runtime is needed

## Common Failure Mode

If `/` accidentally bootstraps transport while `/app` is already open, PeerJS can fail with:

- `Error: ID "<peer-id>" is taken`

This is not a user data issue; it is route bootstrap leakage.

## Recommended Safeguards

1. Route-level bootstrap gate:
   - return early unless route is `/app`
2. Lazy-load app runtime modules only on `/app`
3. Explicit UI error for peer ownership conflict:
   - "DecentChat is already active in another tab."

## Future Improvement (Optional)

Add leader election with `BroadcastChannel`:
- one active transport owner tab
- follower tabs become passive UI or redirect guidance
