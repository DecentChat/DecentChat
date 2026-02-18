# Protocol Changes Workflow

When making changes to DecentChat's protocol, follow this workflow to maintain DEPs (Decent Enhancement Proposals).

## When to Create a DEP

**Always create a DEP for:**
- New message types or protocol extensions
- Cryptographic primitives changes
- Sync algorithm changes (CRDT, Merkle, etc.)
- Transport layer changes (WebRTC, discovery, NAT traversal)
- Breaking changes to wire format
- Security-critical changes

**No DEP needed for:**
- UI-only changes (unless standardizing cross-client behavior)
- Bug fixes that don't change protocol
- Internal refactoring (no wire format impact)
- Client features that don't require peer coordination

## DEP Creation Checklist

1. **Check existing DEPs** in `specs/deps/` to avoid duplication
2. **Copy template:** `cp specs/deps/DEP-TEMPLATE.md specs/deps/DEP-XXX.md`
3. **Assign number:** Use next available number (check `specs/deps/README.md`)
4. **Fill metadata:**
   ```
   Number:  DEP-XXX
   Title:   Short Descriptive Title
   Author:  Your Name
   Status:  Draft
   Type:    Core | Transport | Application | Process
   Created: YYYY-MM-DD
   ```
5. **Write sections:**
   - **Abstract** — 1-2 paragraph summary
   - **Motivation** — Why is this needed? What problem does it solve?
   - **Specification** — Technical details (message formats, algorithms, state machines)
   - **Rationale** — Design decisions, alternatives considered, tradeoffs
   - **Backward Compatibility** — Migration path for existing clients
   - **Security Considerations** — Threat model, attack vectors, mitigation
   - **Test Vectors** — Example inputs/outputs for interop testing
   - **References** — Related work, papers, prior art

6. **Add to index:** Update `specs/deps/README.md` with new DEP entry

7. **Commit DEP before implementation:**
   ```bash
   git add specs/deps/DEP-XXX.md specs/deps/README.md
   git commit -m "Add DEP-XXX: [Title] (Draft)"
   ```

## Implementation Workflow

### 1. Draft → Proposed
- DEP is written and approved by Alex
- Specification is complete and reviewed
- No implementation yet

**Action:** Update `Status: Proposed` in DEP header

### 2. Proposed → Active
- Implementation PR is merged
- Tests pass (include test count in commit message)
- Reference implementation section updated with commit hash + file paths

**Actions:**
1. Update DEP:
   ```markdown
   Status:  Active
   Updated: YYYY-MM-DD
   
   ## Reference Implementation
   
   **Status:** ✅ Implemented in commit `abc1234`
   
   **Files:**
   - `decent-protocol/src/path/to/file.ts` — Description
   - `decent-protocol/tests/unit/test.ts` — X tests
   ```

2. Commit:
   ```bash
   git add specs/deps/DEP-XXX.md
   git commit -m "Mark DEP-XXX as Active (implementation complete)"
   ```

### 3. Active → Final
- Shipped in production for 3+ months
- No breaking bugs found
- Adopted by multiple clients (if applicable)

**Action:** Update `Status: Final` + add release version

### 4. Deprecated
- Superseded by newer DEP
- Add `Replaces: DEP-YYY` to new DEP
- Update old DEP: `Status: Deprecated` + `Superseded-By: DEP-ZZZ`

## Code Changes Checklist

When implementing a DEP:

- [ ] Core logic implemented
- [ ] Message types added to `types.ts` with proper TypeScript interfaces
- [ ] Integration tests written (minimum 10-15 test cases)
- [ ] Unit tests for edge cases
- [ ] All existing tests still pass
- [ ] Backward compatibility verified (or migration path documented)
- [ ] Security review for crypto/auth changes
- [ ] Performance benchmarks (if applicable)
- [ ] Update main `README.md` if user-facing change
- [ ] Update DEP with implementation details

## Example Commit Messages

**Draft DEP:**
```
Add DEP-002: Peer Exchange for Signaling Server Discovery (Draft)

- BitTorrent-style PEX for server discovery
- Server ranking algorithm (recency + reliability + speed)
- Handshake + periodic broadcast
- Max 50 servers/workspace, 30-day pruning
```

**Implementation:**
```
Implement DEP-002 (PEX) - Peer Exchange for Signaling Server Discovery

- Add ServerDiscovery class with ranking, pruning, persistence
- Integrate into SyncProtocol handshake
- 16 comprehensive tests (all pass)
- DEP-002 Status: Draft → Active
```

**Status Update:**
```
Mark DEP-002 as Active (implementation complete)

- Updated reference implementation section with commit hash
- Added file paths and test count
- Status: Draft → Active
```

## Quick Reference

| Status | Meaning | Required Actions |
|--------|---------|------------------|
| Draft | Being written | Write DEP, get feedback |
| Proposed | Spec complete, awaiting impl | Write code, tests |
| Active | Implementation merged | Ship to production, monitor |
| Final | Stable, no changes | Archive, reference only |
| Deprecated | Superseded | Point to replacement DEP |

## Automation Ideas

Future improvements:
- Pre-commit hook to check if protocol files changed without DEP update
- CI check: if `src/workspace/types.ts` changes, require DEP reference in commit
- Bot to update DEP index automatically

## Questions?

- Read DEP-000 for full process details
- Check existing DEPs in `specs/deps/` for examples
- Ask Alex if unsure whether a change needs a DEP

---

**Remember:** DEPs are for coordination, not bureaucracy. When in doubt, write one—it forces clear thinking about design decisions and helps future maintainers understand why choices were made.
