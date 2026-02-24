# FAQ

## Is DecentChat fully decentralized?

At the messaging/state layer: yes (peer-to-peer sync, no central chat database).
Some helper infrastructure may still be used for discovery/bootstrap, but not as plaintext message authority.

## Is my seed phrase enough as a full backup?

Seed phrase is identity backup first.
History recovery works when at least one peer/device still has the data and can sync it.

## What if I lose all devices and no peer has my history?

Identity can be restored from seed, but unavailable history cannot be reconstructed.

## Can I use the same seed on multiple devices?

Yes. Same seed = same identity on every device.

## Why safety numbers?

They let participants verify cryptographic identity out-of-band to reduce impersonation risk.

## Does DecentChat work offline?

Yes, partially. You can keep local state and sync once peers reconnect.
