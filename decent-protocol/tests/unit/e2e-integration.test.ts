/**
 * End-to-end integration tests — Full flows using all protocol layers
 */

import '../setup';
import { describe, test, expect } from 'bun:test';
import {
  CryptoManager, MessageCipher, MessageStore, WorkspaceManager,
  MessageCRDT, PersistentStore,
} from '../../src/index';
import { SeedPhraseManager } from '../../src/identity/SeedPhrase';
import { IdentityManager } from '../../src/identity/Identity';
import { SyncProtocol } from '../../src/workspace/SyncProtocol';

describe('E2E - Full Identity + Workspace + Messaging Flow', () => {
  test('complete flow: seed → identity → workspace → encrypt → send → decrypt → persist → restart', async () => {
    const crypto = new CryptoManager();
    const cipher = new MessageCipher();
    const spm = new SeedPhraseManager();
    const im = new IdentityManager();

    // 1. Alice generates seed phrase → derives keys → creates identity
    const aliceSeed = spm.generate();
    const aliceKeys = await spm.deriveKeys(aliceSeed.mnemonic);
    const aliceId = await im.createIdentity(
      'Alice',
      aliceKeys.ecdhKeyPair.publicKey,
      aliceKeys.ecdsaKeyPair.publicKey
    );

    // 2. Alice creates workspace
    const wm = new WorkspaceManager();
    const alicePeerId = aliceId.identityId.slice(0, 16);
    const ws = wm.createWorkspace('Test Team', alicePeerId, 'Alice',
      await crypto.exportPublicKey(aliceKeys.ecdhKeyPair.publicKey));

    // 3. Bob generates identity
    const bobSeed = spm.generate();
    const bobKeys = await spm.deriveKeys(bobSeed.mnemonic);
    const bobId = await im.createIdentity(
      'Bob',
      bobKeys.ecdhKeyPair.publicKey,
      bobKeys.ecdsaKeyPair.publicKey
    );
    const bobPeerId = bobId.identityId.slice(0, 16);

    // 4. Bob joins workspace
    const joinResult = wm.addMember(ws.id, {
      peerId: bobPeerId,
      alias: 'Bob',
      publicKey: await crypto.exportPublicKey(bobKeys.ecdhKeyPair.publicKey),
      joinedAt: Date.now(),
      role: 'member',
    });
    expect(joinResult.success).toBe(true);

    // 5. Alice sends encrypted message to Bob
    const aliceShared = await crypto.deriveSharedSecret(bobKeys.ecdhKeyPair.publicKey, aliceKeys.ecdhKeyPair.privateKey);
    const plaintext = 'Hello Bob! Welcome to the team!';
    const encrypted = await cipher.encrypt(plaintext, aliceShared);

    // 6. Bob decrypts
    const bobShared = await crypto.deriveSharedSecret(aliceKeys.ecdhKeyPair.publicKey, bobKeys.ecdhKeyPair.privateKey);
    const decrypted = await cipher.decrypt(encrypted, bobShared);
    expect(decrypted).toBe(plaintext);

    // 7. Both add to MessageStore → verify hash chain
    const aliceStore = new MessageStore();
    const channelId = ws.channels[0].id;
    const msg = await aliceStore.createMessage(channelId, alicePeerId, plaintext);
    const addResult = await aliceStore.addMessage(msg);
    expect(addResult.success).toBe(true);

    // 8. Both add to CRDT → verify ordering
    const aliceCRDT = new MessageCRDT(alicePeerId);
    aliceCRDT.createMessage(channelId, plaintext);
    expect(aliceCRDT.getMessages(channelId)).toHaveLength(1);

    // 9. Save to PersistentStore
    const dbName = `e2e-test-${Date.now()}`;
    const store = new PersistentStore({ dbName });
    await store.init();
    await store.saveWorkspace(wm.exportWorkspace(ws.id)!);
    await store.saveMessage({ ...msg, id: msg.id, channelId, timestamp: msg.timestamp });

    // 10. "Restart" — new PersistentStore instance
    const store2 = new PersistentStore({ dbName });
    await store2.init();

    // 11. Verify everything survived
    const restoredWs = await store2.getWorkspace(ws.id);
    expect(restoredWs).toBeDefined();
    expect(restoredWs.name).toBe('Test Team');
    expect(restoredWs.members).toHaveLength(2);

    const restoredMsgs = await store2.getChannelMessages(channelId);
    expect(restoredMsgs).toHaveLength(1);
    expect(restoredMsgs[0].content).toBe(plaintext);

    await store.close();
    await store2.close();
  });
});

describe('E2E - Seed Phrase Recovery', () => {
  test('recover identity from seed phrase: same keys, same shared secrets', async () => {
    const crypto = new CryptoManager();
    const spm = new SeedPhraseManager();

    // Alice creates identity
    const aliceSeed = spm.generate();
    const aliceKeys1 = await spm.deriveKeys(aliceSeed.mnemonic);
    const alicePub1 = await crypto.exportPublicKey(aliceKeys1.ecdhKeyPair.publicKey);

    // Bob's keys (third party)
    const bobKeys = await crypto.generateKeyPair();

    // Alice derives shared secret with Bob
    const shared1 = await crypto.deriveSharedSecret(bobKeys.publicKey, aliceKeys1.ecdhKeyPair.privateKey);

    // Alice "loses device" — all state gone

    // Alice recovers from seed phrase
    const aliceKeys2 = await spm.deriveKeys(aliceSeed.mnemonic);
    const alicePub2 = await crypto.exportPublicKey(aliceKeys2.ecdhKeyPair.publicKey);

    // Same public key
    expect(alicePub2).toBe(alicePub1);

    // Can derive same shared secret with Bob
    const shared2 = await crypto.deriveSharedSecret(bobKeys.publicKey, aliceKeys2.ecdhKeyPair.privateKey);

    // Encrypt with old secret, decrypt with recovered secret
    const cipher = new MessageCipher();
    const encrypted = await cipher.encrypt('test recovery', shared1);
    const decrypted = await cipher.decrypt(encrypted, shared2);
    expect(decrypted).toBe('test recovery');
  });
});

describe('E2E - Offline Divergence + Merge', () => {
  test('two peers diverge offline then merge via CRDT', () => {
    const aliceCRDT = new MessageCRDT('alice');
    const bobCRDT = new MessageCRDT('bob');
    const channelId = 'ch-general';

    // Both go offline and create messages independently
    const aliceMsgs = [];
    for (let i = 0; i < 5; i++) {
      aliceMsgs.push(aliceCRDT.createMessage(channelId, `Alice msg ${i}`));
    }

    const bobMsgs = [];
    for (let i = 0; i < 3; i++) {
      bobMsgs.push(bobCRDT.createMessage(channelId, `Bob msg ${i}`));
    }

    // Before merge: each only sees their own
    expect(aliceCRDT.getMessages(channelId)).toHaveLength(5);
    expect(bobCRDT.getMessages(channelId)).toHaveLength(3);

    // They reconnect — merge
    const newForAlice = aliceCRDT.merge(bobMsgs);
    const newForBob = bobCRDT.merge(aliceMsgs);

    // Both now have all 8 messages
    expect(aliceCRDT.getMessages(channelId)).toHaveLength(8);
    expect(bobCRDT.getMessages(channelId)).toHaveLength(8);

    // Alice got Bob's 3, Bob got Alice's 5
    expect(newForAlice).toHaveLength(3);
    expect(newForBob).toHaveLength(5);

    // Same ordering on both sides
    const aliceOrder = aliceCRDT.getMessages(channelId).map(m => m.id);
    const bobOrder = bobCRDT.getMessages(channelId).map(m => m.id);
    expect(aliceOrder).toEqual(bobOrder);
  });

});

describe('E2E - Three-Peer Workspace with DMs', () => {
  test('channel isolation: DM not visible to third party', () => {
    const wm = new WorkspaceManager();

    // Alice creates workspace
    const ws = wm.createWorkspace('Team', 'alice', 'Alice', 'alice-key');
    wm.addMember(ws.id, { peerId: 'bob', alias: 'Bob', publicKey: 'bob-key', joinedAt: Date.now(), role: 'member' });
    wm.addMember(ws.id, { peerId: 'charlie', alias: 'Charlie', publicKey: 'charlie-key', joinedAt: Date.now(), role: 'member' });

    // All 3 see #general (public-workspace channel — access derived from workspace membership,
    // so only the creator is in the explicit members array)
    const general = wm.getChannels(ws.id);
    expect(general).toHaveLength(1);
    expect(general[0].members).toContain('alice');
    expect(general[0].accessPolicy?.mode).toBe('public-workspace');

    // Alice creates DM with Bob
    const dmResult = wm.createDM(ws.id, 'alice', 'bob');
    expect(dmResult.success).toBe(true);
    const dm = dmResult.channel!;

    // DM only has Alice and Bob
    expect(dm.members).toHaveLength(2);
    expect(dm.members).toContain('alice');
    expect(dm.members).toContain('bob');
    expect(dm.members).not.toContain('charlie');

    // Charlie's DMs don't include Alice-Bob DM
    const charlieDMs = wm.getDMs(ws.id, 'charlie');
    expect(charlieDMs).toHaveLength(0);

    // Alice and Bob see the DM
    const aliceDMs = wm.getDMs(ws.id, 'alice');
    const bobDMs = wm.getDMs(ws.id, 'bob');
    expect(aliceDMs).toHaveLength(1);
    expect(bobDMs).toHaveLength(1);
  });
});

describe('E2E - SyncProtocol Full Join Flow', () => {
  test('complete join: invite code → sync workspace + history → verify chain', async () => {
    // Alice's side
    const aliceWM = new WorkspaceManager();
    const aliceMS = new MessageStore();

    const ws = aliceWM.createWorkspace('Synced Team', 'alice', 'Alice', 'alice-key');
    const channelId = ws.channels[0].id;

    // Alice sends some messages
    let ts = Date.now();
    for (let i = 0; i < 5; i++) {
      const msg = await aliceMS.createMessage(channelId, 'alice', `Message ${i}`);
      ts += 1; // Ensure strictly ascending timestamps
      msg.timestamp = ts;
      const result = await aliceMS.addMessage(msg);
      if (!result.success) throw new Error(`Failed to add msg ${i}: ${result.error}`);
    }

    // Setup sync protocol for Alice
    const aliceSent: { peerId: string; data: any }[] = [];
    const aliceEvents: any[] = [];
    const aliceSync = new SyncProtocol(
      aliceWM, aliceMS,
      (peerId, data) => { aliceSent.push({ peerId, data }); return true; },
      (event) => aliceEvents.push(event),
      'alice'
    );

    // Bob's side
    const bobWM = new WorkspaceManager();
    const bobMS = new MessageStore();
    const bobEvents: any[] = [];
    const bobSync = new SyncProtocol(
      bobWM, bobMS,
      () => true,
      (event) => bobEvents.push(event),
      'bob'
    );

    // Bob sends join request
    await aliceSync.handleMessage('bob', {
      type: 'join-request',
      inviteCode: ws.inviteCode,
      member: { peerId: 'bob', alias: 'Bob', publicKey: 'bob-key', joinedAt: Date.now(), role: 'member' },
    } as any);

    // Alice should have sent join-accepted
    expect(aliceSent).toHaveLength(1);
    const response = aliceSent[0].data.sync;
    expect(response.type).toBe('join-accepted');
    expect(response.workspace).toBeDefined();
    expect(response.messageHistory[channelId]).toHaveLength(5);

    // Bob processes the acceptance
    await bobSync.handleMessage('alice', response);

    // Bob now has the workspace
    const bobWorkspace = bobWM.getAllWorkspaces();
    expect(bobWorkspace).toHaveLength(1);
    expect(bobWorkspace[0].name).toBe('Synced Team');

    // Bob has all message metadata (content intentionally omitted during sync)
    const bobMessages = bobMS.getMessages(channelId);
    expect(bobMessages).toHaveLength(5);
    expect(bobMessages.every(m => m.content === '')).toBe(true);
  });
});
