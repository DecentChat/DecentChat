# DEP-016: Mobile Client (iOS via Capacitor)

```
Number:  DEP-016
Title:   Mobile Client (iOS via Capacitor)
Author:  Alex + Xena
Status:  Draft
Type:    Application
Created: 2026-03-12
```

## Abstract

This DEP proposes a first-party DecentChat iOS mobile client delivered via Capacitor, with a WhatsApp-like mobile user experience and navigation model.

The implementation introduces two new packages: `decent-client-core` for shared client logic and `decent-client-mobile` for the Capacitor-native shell and mobile UI. The mobile app reuses `decent-protocol` and `decent-transport-webrtc` while extracting reusable logic from `decent-client-web` into `decent-client-core`.

## Motivation

DecentChat currently has a web-first client experience. For everyday communication, users expect a native-feeling mobile app with touch-optimized navigation, keyboard-safe layouts, and predictable app lifecycle behavior.

A dedicated iOS app enables:

- Better ergonomics for frequent chat usage
- A clearer app-distribution path (TestFlight initially)
- A clean architecture for reusing protocol and transport logic across web and mobile
- Incremental delivery without rewriting the protocol stack

## Specification

### 1) Product scope (v1)

Implement an iOS client via Capacitor with a WhatsApp-like mobile structure.

Primary bottom navigation tabs:

1. Calls
2. Workspaces
3. Chats
4. You

### 2) Architecture

Create two new packages:

1. `decent-client-core`
   - Shared state, domain logic, orchestration, and protocol/transport integration
   - Must be UI-framework-agnostic where possible

2. `decent-client-mobile`
   - Capacitor application shell and mobile-specific UI
   - Svelte 5 UI implementation for iOS form factor

Both packages reuse existing protocol stack packages:

- `decent-protocol`
- `decent-transport-webrtc`

### 3) Core extraction requirement

Shared logic currently in `decent-client-web` SHOULD be extracted into `decent-client-core` in phases, minimizing behavior regressions and duplication.

Extraction target areas include:

- Session/bootstrap orchestration
- Messaging/workspace domain flows
- Transport wiring and lifecycle hooks
- Shared utilities that are not browser-only UI concerns

### 4) Mobile shell and native capabilities

`decent-client-mobile` uses Capacitor for iOS packaging and lifecycle integration.

Required Capacitor plugins for v1 rollout:

- `@capacitor/keyboard`
- `@capacitor/status-bar`
- `@capacitor/haptics`
- `@capacitor/app`
- `@capacitor/splash-screen`

### 5) Phased implementation plan

Delivery proceeds in the following sequence:

1. Core extraction (`decent-client-web` → `decent-client-core`)
2. Capacitor shell bootstrap (`decent-client-mobile` app scaffold)
3. Mobile UI foundations + bottom-tab navigation
4. Messaging parity on mobile
5. Calls experience integration
6. TestFlight distribution and stabilization

### 6) Non-goals (v1)

The following are explicitly out of scope for v1:

- Android support
- Tablet-specific layout optimization
- APNs push notifications

## Rationale

Capacitor is selected as a pragmatic path to iOS delivery while preserving web technology investments. Svelte 5 keeps UI implementation aligned with existing DecentChat frontend direction.

Splitting core logic from platform UI avoids long-term divergence between web and mobile clients and lowers maintenance cost for protocol-facing behavior.

## Backward Compatibility

This DEP introduces a new application surface and package structure but does not require a wire-level protocol breaking change.

Expected compatibility model:

- Existing web client remains functional
- Mobile app uses existing protocol/transport contracts
- Shared logic extraction is internal refactoring and should preserve behavior

## Reference Implementation

Planned workspace additions and scaffolding:

- `decent-client-core/`
- `decent-client-mobile/`

Initial implementation PR should include:

- Package scaffolds
- Root workspace registration
- Initial mobile shell and placeholder tab UI

## Security Considerations

Key risk areas for this effort:

1. **WebRTC/audio behavior in iOS WKWebView**
   - Verify media permission flow, route changes, interruptions, and reconnection behavior.

2. **IndexedDB persistence characteristics on iOS**
   - Confirm durability, quota behavior, and recovery handling across app restarts.

3. **Background/lifecycle constraints**
   - Ensure safe pause/resume semantics and avoid data inconsistency when app is backgrounded or terminated.

No new cryptographic primitives are introduced by this DEP.

## References

- DEP-000: DEP process and taxonomy
- Capacitor iOS documentation
- Svelte 5 documentation

## Copyright

This document is placed in the public domain (CC0-1.0).
