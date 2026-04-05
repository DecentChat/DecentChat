import { Negentropy } from '../../decent-protocol/src/crdt/Negentropy';

const items = Array.from({ length: 10000 }, (_, i) => ({
  id: `msg-${i.toString().padStart(6, '0')}`,
  timestamp: 1000000 + i,
}));

// Measure build time separately
const buildStart = performance.now();
const alice = new Negentropy();
await alice.build(items);
const buildMs = performance.now() - buildStart;
console.log(`Build (10K items): ${buildMs.toFixed(1)}ms`);

// Measure createQuery (which triggers fingerprintEntries on all items)
const queryStart = performance.now();
const query = await alice.createQuery();
const queryMs = performance.now() - queryStart;
console.log(`createQuery: ${queryMs.toFixed(1)}ms`);

// Now full reconcile
const bob = new Negentropy();
await bob.build([]);

const reconcileStart = performance.now();
let rounds = 0;
const result = await alice.reconcile(async (q) => {
  rounds++;
  return bob.processQuery(q);
});
const reconcileMs = performance.now() - reconcileStart;
console.log(`Reconcile: ${reconcileMs.toFixed(1)}ms (${rounds} rounds, ${result.excess.length} excess)`);
console.log(`Total build+reconcile: ${(buildMs + reconcileMs).toFixed(1)}ms`);
