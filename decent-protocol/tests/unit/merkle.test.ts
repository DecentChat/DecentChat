/**
 * MerkleTree tests - efficient sync comparison
 */

import { describe, test, expect, beforeEach } from 'bun:test';
import { MerkleTree } from '../../src/crdt/MerkleTree';

describe('MerkleTree', () => {
  test('empty tree has null root', async () => {
    const tree = new MerkleTree();
    await tree.build([]);
    expect(tree.getRootHash()).toBeNull();
  });

  test('single message tree', async () => {
    const tree = new MerkleTree();
    await tree.build(['msg-1']);

    expect(tree.getRootHash()).toBeTruthy();
    expect(tree.getLeafIds()).toEqual(['msg-1']);
    expect(tree.getDepth()).toBe(1);
  });

  test('deterministic hashing', async () => {
    const tree1 = new MerkleTree();
    const tree2 = new MerkleTree();

    await tree1.build(['msg-1', 'msg-2', 'msg-3']);
    await tree2.build(['msg-1', 'msg-2', 'msg-3']);

    expect(tree1.getRootHash()).toBe(tree2.getRootHash());
  });

  test('different messages produce different roots', async () => {
    const tree1 = new MerkleTree();
    const tree2 = new MerkleTree();

    await tree1.build(['msg-1', 'msg-2']);
    await tree2.build(['msg-1', 'msg-3']);

    expect(tree1.getRootHash()).not.toBe(tree2.getRootHash());
  });

  test('order matters', async () => {
    const tree1 = new MerkleTree();
    const tree2 = new MerkleTree();

    await tree1.build(['msg-1', 'msg-2']);
    await tree2.build(['msg-2', 'msg-1']);

    expect(tree1.getRootHash()).not.toBe(tree2.getRootHash());
  });

  test('builds balanced tree', async () => {
    const tree = new MerkleTree();
    await tree.build(['a', 'b', 'c', 'd']);

    expect(tree.getDepth()).toBe(3); // leaf + 2 levels
    expect(tree.getLeafIds()).toHaveLength(4);
  });

  test('handles odd number of leaves', async () => {
    const tree = new MerkleTree();
    await tree.build(['a', 'b', 'c']);

    expect(tree.getRootHash()).toBeTruthy();
    expect(tree.getLeafIds()).toContain('a');
    expect(tree.getLeafIds()).toContain('b');
    expect(tree.getLeafIds()).toContain('c');
  });
});

// === Diff Tests ===

describe('MerkleTree - Diff', () => {
  test('identical trees have no diff', async () => {
    const tree1 = new MerkleTree();
    const tree2 = new MerkleTree();

    await tree1.build(['msg-1', 'msg-2', 'msg-3']);
    await tree2.build(['msg-1', 'msg-2', 'msg-3']);

    const diff = tree1.diff(tree2);
    expect(diff).toHaveLength(0);
  });

  test('finds messages missing from local', async () => {
    const local = new MerkleTree();
    const remote = new MerkleTree();

    await local.build([]);
    await remote.build(['msg-1', 'msg-2']);

    const diff = local.diff(remote);
    expect(diff).toContain('msg-1');
    expect(diff).toContain('msg-2');
  });

  test('detects single difference in large set', async () => {
    const ids = Array.from({ length: 8 }, (_, i) => `msg-${i}`);
    const local = new MerkleTree();
    const remote = new MerkleTree();

    await local.build(ids);
    await remote.build([...ids.slice(0, 7), 'msg-NEW']); // Replace last

    const diff = local.diff(remote);
    expect(diff).toContain('msg-NEW');
    expect(diff.length).toBeGreaterThan(0);
  });

  test('diff with empty local returns all remote', async () => {
    const local = new MerkleTree();
    const remote = new MerkleTree();

    await local.build([]);
    await remote.build(['a', 'b', 'c']);

    const diff = local.diff(remote);
    expect(diff).toHaveLength(3);
  });

  test('diff with empty remote returns nothing', async () => {
    const local = new MerkleTree();
    const remote = new MerkleTree();

    await local.build(['a', 'b', 'c']);
    await remote.build([]);

    const diff = local.diff(remote);
    expect(diff).toHaveLength(0);
  });
});

// === Sync Scenarios ===

describe('MerkleTree - Sync Workflow', () => {
  test('sync workflow: compare roots → identify diff → transfer only missing', async () => {
    // Alice has messages 1-5
    const aliceTree = new MerkleTree();
    await aliceTree.build(['msg-1', 'msg-2', 'msg-3', 'msg-4', 'msg-5']);

    // Bob has messages 1-3 (missing 4 and 5)
    const bobTree = new MerkleTree();
    await bobTree.build(['msg-1', 'msg-2', 'msg-3']);

    // Step 1: Compare roots
    expect(aliceTree.getRootHash()).not.toBe(bobTree.getRootHash());

    // Step 2: Bob diffs against Alice to find what he's missing
    const missing = bobTree.diff(aliceTree);
    expect(missing).toContain('msg-4');
    expect(missing).toContain('msg-5');

    // Step 3: Bob requests only msg-4 and msg-5 from Alice
    // (In real app, would request these specific messages)

    // Step 4: After sync, trees should match
    const bobUpdated = new MerkleTree();
    await bobUpdated.build(['msg-1', 'msg-2', 'msg-3', 'msg-4', 'msg-5']);

    expect(bobUpdated.getRootHash()).toBe(aliceTree.getRootHash());
  });

  test('bidirectional sync: both peers have unique messages', async () => {
    // Alice: 1, 2, 3, A1, A2
    // Bob:   1, 2, 3, B1
    const aliceTree = new MerkleTree();
    const bobTree = new MerkleTree();

    await aliceTree.build(['msg-1', 'msg-2', 'msg-3', 'alice-1', 'alice-2']);
    await bobTree.build(['msg-1', 'msg-2', 'msg-3', 'bob-1']);

    // Alice needs from Bob
    const aliceNeeds = aliceTree.diff(bobTree);
    expect(aliceNeeds).toContain('bob-1');

    // Bob needs from Alice
    const bobNeeds = bobTree.diff(aliceTree);
    expect(bobNeeds).toContain('alice-1');
    expect(bobNeeds).toContain('alice-2');

    // After exchange, both have same set
    const allIds = ['msg-1', 'msg-2', 'msg-3', 'alice-1', 'alice-2', 'bob-1'].sort();

    const aliceFinal = new MerkleTree();
    const bobFinal = new MerkleTree();
    await aliceFinal.build(allIds);
    await bobFinal.build(allIds);

    expect(aliceFinal.getRootHash()).toBe(bobFinal.getRootHash());
  });

  test('already in sync: no data transfer needed', async () => {
    const alice = new MerkleTree();
    const bob = new MerkleTree();

    const ids = ['msg-1', 'msg-2', 'msg-3', 'msg-4'];
    await alice.build(ids);
    await bob.build(ids);

    // Roots match → no sync needed
    expect(alice.getRootHash()).toBe(bob.getRootHash());
    expect(alice.diff(bob)).toHaveLength(0);
    expect(bob.diff(alice)).toHaveLength(0);
  });
});
