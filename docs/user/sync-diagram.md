# How Sync Works (Diagram)

```text
Device A (offline edits)            Device B (online)
  - local messages                    - local messages
  - local vector clock                - local vector clock
           │                                  │
           └──────── reconnect ───────────────┘
                          │
                 Exchange summaries
         (vector clock + negentropy range fingerprints)
                          │
                Identify missing records
                          │
                  Exchange only deltas
                          │
                   CRDT merge on both
                          │
                 Converged shared state
```

## Building blocks

- **Vector clocks**: who saw what and when (causal order)
- **Negentropy set reconciliation**: exchange minimal missing sets
- **Range fingerprints**: quickly detect where sets diverge
- **CRDT merge**: deterministic conflict-free convergence
