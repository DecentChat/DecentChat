# DecentChat UX Review — 2026-04-04 (Follow-up)
**Reviewer:** Iris UX
**Scope:** Re-audit of all P0/P1/P2 items from initial review + full landing page + onboarding flow + empty states

---

## UX verdict: PARTIAL

Significant progress since the initial review. Three of the five original issues are resolved. The product's onboarding and landing page are now meaningfully better. Two items remain open.

---

## Screens reviewed

1. **Splash screen** — Connection retry progress ("Connecting to network… attempt X/5")
2. **Landing page** (http://localhost:5173/) — hero, feature grid, comparison table, tech pills, donations, footer CTA
3. **Create workspace modal** — form fields, trust messaging, validation
4. **Join workspace modal** — clipboard auto-detect, invite parsing, workspace preview
5. **Mobile comparison table** (CSS review) — new card-based stacked layout at ≤768px
6. **Empty states** — "No channel selected" + "Welcome to #channel" with invite CTAs
7. **Channel header** — icon button density audit
8. **Sidebar** — DM list, contacts, invite banner

---

## Resolved since last review

### ✅ [P0] Loading state feedback — FIXED
- `ConnectionRetryProgress.ts` now shows "Connecting to network… attempt X/5"
- After exhaustion, transitions to landing page (offline mode)
- Confirmed via live browser testing: splash → retry countdown → landing page

### ✅ [P1] Mobile comparison table — FIXED
- Previous: `display: none` on the competitor column at ≤768px (lost all competitive context)
- Now: Stacked card layout where each row becomes a bordered card with:
  - Feature name as card header (bold, secondary background)
  - "Others: " and "DecentChat: " inline pseudo-element labels
  - Full competitive context preserved on mobile
- Well-done implementation at main.css:4215-4277

### ✅ [P2] Semantic comparison table — FIXED
- Now uses proper `<table>`, `<thead>`, `<th scope="col">`, `<tbody>`, `<tr>`, `<td>` markup
- `aria-label="Feature comparison: traditional chat apps vs DecentChat"` present
- Screen readers can now navigate this as tabular data

### ✅ [P0] Badge contrast — FIXED (confirmed from previous review)
- `.lp-hero-badge` and `.lp-inline-link` use `var(--primary-light)` (#a29bfe)
- WCAG AA 6.41:1 contrast ratio confirmed

---

## Still open

### 🔴 [P1] Channel header button overload — STILL OPEN
The channel header still renders 6 emoji icon buttons in a row: 🎧 🔌 📱 🔍 🔗 ⚙️ (plus ☰ hamburger and 👥 member count). On narrow viewports, this creates a dense, illegible toolbar.

No overflow menu has been added. No text labels on hover. Recommendation unchanged:
- Group 🔌 (Connect), 📱 (QR), 🔗 (Invite) behind a "⋯" overflow menu
- Keep 🔍 (Search), ⚙️ (Settings), 🎧 (Huddle) as primary visible actions
- Add `title` tooltips (already present) but consider visible text labels on wider viewports

**File:** `decent-client-web/src/lib/components/layout/ChannelHeader.svelte` lines 100-118

### 🟡 [P2] Hardcoded color values — PARTIALLY FIXED
Fixed `.bad` → `var(--error)` and `.good` → `var(--success)` in this review.
`.mid` still uses `#d4870e` because there's no `--warning` CSS variable in the design system. A `--warning` variable should be added to `:root` and used here.

---

## Key friction

### Onboarding flow is clean
The splash → landing → create/join workspace flow works well:
- Clear value proposition in the hero
- "Create private group" and "Join with invite" CTAs are prominent
- Create modal has good trust messaging ("No email required", "Ready right away")
- Join modal has clipboard auto-detect for invite links (smart UX)
- Form validation prevents empty submissions
- Display name helper text: "This is how people will see you. You can change it later." — reassuring

### Empty states are solid
- "Welcome to #general!" with actionable CTAs (Invite people via link / Show invite QR code)
- Contextual keyboard shortcut tips (Ctrl+K on desktop, /help on mobile)
- E2E encryption messaging reinforced

### Sidebar structure is clear
- Channel list → DM list → Contacts → Connect to peer
- Invite banner at bottom is always visible
- "No direct messages yet" empty state is appropriately minimal

---

## Visual issues

### Minor: Modal truncation in accessibility tree
The "Create private group" modal contains the full landing page behind it in the DOM, which causes accessibility tools (and snapshots) to merge all 60+ elements. The modal's own form fields (display name input, submit button) fall past the 63-element truncation boundary. This is an accessibility concern — modal focus trapping should prevent background content from being reachable.

**Recommendation:** Add `aria-hidden="true"` to the landing page content when a modal is open, or use `<dialog>` element with native `showModal()` for proper inert background.

### Minor: Donation section is long
Five crypto donation cards (BTC, LTC, ETH, XMR, ZEC) take up significant vertical space on the landing page. Consider a tabbed or accordion interface to show one at a time, or collapse behind a "Show donation addresses" button.

---

## Suggested improvements

1. **[P1] Header overflow menu** — Reduce visible buttons to 3-4, add overflow "⋯" menu (STILL OPEN from previous review)
2. **[P2] Add `--warning` CSS variable** — Define in `:root`, use for `.lp-compare-row .mid`
3. **[P2] Modal accessibility** — Add `aria-hidden` to background content when modals are open, or use native `<dialog>`
4. **[P3] Donation section density** — Consider collapsible/tabbed layout for crypto addresses

---

## Files changed by UX

| File | Change | Lines |
|------|--------|-------|
| `decent-client-web/src/ui/styles/main.css` | `.bad` color: `#e74c3c` → `var(--error)` | L3938 |
| `decent-client-web/src/ui/styles/main.css` | `.good` color: `#00b894` → `var(--success)` | L3940 |
| `decent-client-web/src/ui/styles/main.css` | `.mid` added comment noting missing `--warning` var | L3939 |

All changes are minimal, low-risk, CSS-only. Build verified: `bun run build` succeeds.

---

## Recommended next owner: Xena
## Recommended next status: todo
## Recommended next action

One remaining user story to create:
1. **[P1] Channel header overflow menu** — Consolidate 6+ icon buttons into 3 primary + overflow "⋯" menu. File: `ChannelHeader.svelte` + new `OverflowMenu.svelte` component + CSS. Assign to Codex Engineer.

Lower priority (P2/P3):
2. **[P2] Add `--warning` CSS variable** — Add to `:root` in main.css, update `.lp-compare-row .mid`. Assign to Codex Engineer.
3. **[P2] Modal accessibility** — Use `aria-hidden` on background or native `<dialog>`. Needs design decision.
4. **[P3] Donation section layout** — Product decision: collapse vs keep expanded.

The contrast fix (committed in initial review) and comparison table fixes (semantic HTML + mobile card layout + color variable cleanup) can all be committed together.
