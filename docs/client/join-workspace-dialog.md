# Join Workspace Dialog UX

This document defines the UX behavior for joining via invite links, with clipboard-assisted flow.

## Objective

Reduce join friction while keeping invite parsing reliable and transparent.

## Proposed Flow

1. User opens **Join Workspace** dialog
2. App attempts clipboard read (user-gesture context)
3. If clipboard contains valid invite, auto-fill input
4. Parse invite immediately
5. Show parsed metadata preview:
   - **Workspace name** (read-only)
6. User confirms join

## Clipboard Rules

- Use `navigator.clipboard.readText()` after explicit user interaction
- If permission denied/unavailable: fail silently
- Never overwrite non-empty user-edited input
- Ignore invalid clipboard content

## Parsing Rules

- Single source of truth parser for all entry points (`/join/*`, input paste, clipboard auto-detect)
- Accept supported formats:
  - `decent://...`
  - web invite URL format used by app
- Show parse errors only for actively submitted invalid input

## UI Requirements

- Invite input remains editable
- Workspace preview field is read-only
- Optional hint when invite was auto-detected:
  - "Invite detected from clipboard"
- Optional fallback button:
  - "Paste from clipboard"

## Security & Privacy Notes

- Clipboard is read only when user opens the join dialog (not in background)
- No telemetry/logging of raw invite link by default
- Do not expose sensitive invite payload details beyond what user needs

## Validation Checklist

- Valid invite in clipboard => auto-fill + workspace preview visible
- Invalid clipboard => no auto-fill, no disruptive error
- User typed input => clipboard does not override it
- Permission denied => dialog still works manually
