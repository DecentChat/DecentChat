# Sync, Multi-Device, and Backup

## Multi-device with one identity

Using the same seed phrase on multiple devices gives you the same identity everywhere.

## How sync happens

When devices/peers connect, DecentChat exchanges summaries and missing records.

Under the hood this uses:
- CRDT merge
- vector clocks
- negentropy range reconciliation
- minimal delta exchange

So each replica can catch up incrementally instead of re-downloading everything.

## Is the seed phrase a backup?

The seed phrase is primarily an **identity backup**.

In DecentChat it also enables practical history recovery because:
- it restores your cryptographic identity
- your devices can rejoin and synchronize history from peers/local replicas

But remember:
- if no peer/device still has some history, it cannot be magically recovered
- backup quality depends on at least one replica retaining that data

## Best practice backup strategy

1. Keep seed phrase backed up offline.
2. Keep at least 2 devices logged in when possible.
3. Avoid deleting local data on all devices at once.
4. For critical workspaces, maintain active peers for better history availability.
