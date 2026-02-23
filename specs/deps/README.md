# Decent Enhancement Proposals (DEPs)

Formal specifications for DecentChat protocol evolution.

## What are DEPs?

DEPs are design documents that describe new features, protocol changes, or process improvements for DecentChat. They provide technical specifications and rationale for changes to the protocol.

**Inspired by:** Bitcoin BIPs, Nostr NIPs, Python PEPs, Ethereum EIPs

## DEP Index

| Number | Title | Type | Status |
|--------|-------|------|--------|
| [000](DEP-000.md) | Decent Enhancement Proposals (Process) | Process | Final |
| [001](DEP-001.md) | Negentropy Set Reconciliation | Core | Active |
| [002](DEP-002.md) | Peer Exchange (PEX) for Signaling Server Discovery | Transport | Final |
| [003](DEP-003-derived-peer-id.md) | Derived Peer ID from Seed Phrase | Core | Active |
| [012](DEP-012-reliable-multi-recipient-delivery.md) | Reliable Multi-Recipient Delivery & Reconnect Replay | Core | Draft |

## How to Submit a DEP

1. **Draft your DEP** using the [template](DEP-TEMPLATE.md)
2. **Open a PR** to `decent-chat/specs/deps/`
3. **Discuss** via GitHub comments
4. **Revise** based on feedback
5. **Alex approves** → Status becomes **Proposed**
6. **Implement** → Status becomes **Active**
7. **Ship + stabilize** → Status becomes **Final**

See [DEP-000](DEP-000.md) for full process details.

## DEP Types

- **Core** — Protocol fundamentals (encryption, messages, sync)
- **Transport** — Networking (discovery, signaling, NAT traversal)
- **Application** — Client features (UI, commands, notifications)
- **Process** — Governance and development process

## DEP Statuses

- **Draft** — Work in progress
- **Proposed** — Ready for implementation
- **Active** — Implementation merged
- **Final** — Shipped and stable
- **Deprecated** — Superseded
- **Rejected** — Not accepted

## Questions?

Open a GitHub issue or message `alex@decentchat` (once DNS identity is live 😉).

## License

All DEPs are public domain (CC0-1.0).
