# DecentChat Web Client — UX Audit Report

**Reviewer:** Iris UX
**Date:** 2026-04-04 (second consolidated audit)
**App version:** localhost:5173 (dev build, branch `feat/splash-retry-progress`)
**Review scope:** Full landing page, connection retry/offline flow, create workspace modal, comparison table, features section, donations, footer, mobile responsive CSS, header toolbar, sidebar, accessibility, loading screen

---

## UX verdict: PASS

The product is polished and production-ready for a P2P messaging landing page and onboarding flow. All critical and high-severity issues from the previous audit have been resolved. The new ConnectionRetryProgress feature is well-implemented with proper user feedback. Three low-priority items remain (carried forward from previous audit) that are enhancement requests, not blockers.

---

## Screens reviewed

1. **Landing page** (/) — full scroll: hero, problem banner, how-it-works, features grid, comparison table, tech stack, donations, final CTA, footer
2. **Loading screen** (`index.html`) — accessibility improvements (role="status", aria-live, aria-hidden on spinner)
3. **Connection retry → offline fallback** — "Connecting to network… attempt X/5" → offline mode toast
4. **Create workspace modal** — form fields, trust copy, validation labels, "Ready right away" messaging
5. **Comparison table** — semantic HTML, responsive stacked-card mobile layout, color variable usage
6. **Footer** — peer ID click-to-copy with hover affordance
7. **Channel header** — button set for DM vs. non-DM views
8. **Mobile responsive CSS** — 768px, 640px, 560px, 420px, 390px, 375px breakpoints

---

## New feature reviewed: ConnectionRetryProgress (ALE-686)

**Verdict: PASS — well-designed UX flow.**

- First attempt shows no hint (avoids flicker on fast connections)
- Subsequent attempts show "Connecting to network… attempt N/5" — clear and non-alarming
- On exhaustion: transitions to landing page with toast "Offline mode — messages will sync when connected"
- Toast uses `info` type with 6-second duration — appropriate for non-critical notification
- Unit tests cover all state transitions (9 tests, all pass)
- Loading screen now has `role="status"` and `aria-live="polite"` — screen readers will announce status changes
- Spinner has `aria-hidden="true"` — correct, purely decorative

**One minor copy observation:** The retry hint says "attempt 2/5" (not "1/5") because attempt 0 is silent. This is intentional and correct — users only see the counter when something takes longer than expected. Good design.

---

## Key friction — ALL PREVIOUSLY FIXED ITEMS VERIFIED

F1 through F14 from the previous audit remain fixed. Verified via source code diff and live browser testing:
- `.mid` uses `var(--warning)` ✓
- `.bad` uses `var(--error)` ✓
- `.good` uses `var(--success)` ✓
- Footer peer ID hover: underline + opacity ✓
- `✗ Nothing to hand over` prefix ✓
- `.lp-inline-link:hover` uses `#c2b9ff` (WCAG AA pass) ✓
- Connect to peer button hidden in DM header ✓
- Mobile comparison table: stacked card layout with "Others:" / "DecentChat:" labels ✓
- Offline fallback with toast ✓

---

## Key friction — REMAINING (carried forward, all LOW severity)

### [P1] Channel header button overload (V2)
**Severity: LOW**
**Status: Partially mitigated**

At ≤390px, QR/Connect/Invite buttons are hidden via `display: none`. This prevents overflow but removes access to those features entirely on narrow screens. An overflow "⋯" menu would preserve access.

For desktop widths, 6 buttons (🎧🔌📱🔍🔗⚙️) remain in the header for non-DM channels. Dense but functional.

**File:** `decent-client-web/src/lib/components/layout/ChannelHeader.svelte` lines 100-119
**CSS:** `decent-client-web/src/ui/styles/main.css` line 4647 (`@media (max-width: 390px)`)

### [P2] "AI" sidebar button is cryptic (V3)
**Severity: LOW**

The "AI" button (Sidebar.svelte line 258) still shows as a plain text button with tooltip "Install AI team template". No change since last audit.

### [P3] Modal accessibility
**Severity: LOW**

ModalImpl.svelte still uses a `<div class="modal-overlay">` instead of native `<dialog>`, and no `aria-hidden` is applied to background content when modal is open.

### [P4] "vs Discord ↗" pseudo-element looks like a link (NEW, trivial)
**Severity: TRIVIAL**

The `.lp-feature-card--highlight::after` renders "vs Discord ↗" in the features section. The ↗ arrow conventionally signals an external link, but this is CSS-only text with no click target. Users may try to click it expecting to navigate somewhere.

**Fix options:**
- Remove the ↗ character (change to "vs Discord" or "Discord comparison")
- Or make the entire feature card clickable, linking to an article or the comparison table section

---

## Visual issues — ALL RESOLVED

No new visual issues found. All CSS variable usage is correct. Color contrast passes WCAG AA on the dark theme.

---

## What's good

- **ConnectionRetryProgress is clean.** Pure state machine, unit-tested, no flicker on happy path, clear messaging on retry, graceful offline fallback.
- **Loading screen accessibility** — `role="status"` + `aria-live="polite"` is the right pattern for dynamic status text.
- **Comparison table mobile layout** is excellent — stacked cards with "Others:" / "DecentChat:" labels preserve all information that the previous version hid.
- **Build is fast** — 2.09s for full production build.
- **All 9 unit tests pass** for ConnectionRetryProgress.
- **Copy quality remains high** throughout — "Offline mode — messages will sync when connected" is calm, clear, and actionable.

---

## Files changed by UX

None in this audit. All prior changes verified as intact.

---

## Recommended next owner: Xena

## Recommended next status: done

## Recommended next action:

The `feat/splash-retry-progress` branch is **UX-approved for merge to main**. The ConnectionRetryProgress feature, loading screen accessibility improvements, and all carried CSS/copy fixes are solid.

The 3+1 remaining low-priority items (P1–P4) are enhancements that should be tracked as separate issues:
1. **[P1] Channel header overflow menu** — new `OverflowMenu.svelte` component. Assign to Codex Engineer.
2. **[P2] "AI" sidebar button** — product decision needed on visibility/labeling.
3. **[P3] Modal accessibility** — `<dialog>` migration or `aria-hidden` on background. Design decision needed.
4. **[P4] "vs Discord ↗" pseudo-link** — trivial CSS-only fix, can be bundled with any future landing page work.

None of these block shipping. The product is production-ready from a UX perspective.
