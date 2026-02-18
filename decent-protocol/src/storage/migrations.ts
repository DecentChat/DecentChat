/**
 * Migration Registry — All schema migrations for DecentChat
 * 
 * Add new migrations here as the protocol evolves.
 * Each migration must have a unique, sequential version number.
 * 
 * RULES:
 * 1. NEVER modify an existing migration
 * 2. ALWAYS add new migrations with incrementing version numbers
 * 3. Test migrations with both fresh installs and upgrades
 * 4. Include down() for reversible migrations
 */

import type { Migration } from './Migration';

/**
 * v1: Initial schema
 * This migration establishes the baseline schema.
 * For fresh installs, this is a no-op (stores are created by PersistentStore.init).
 * For existing installs from before versioning, this sets the baseline.
 */
const v1_initialSchema: Migration = {
  version: 1,
  description: 'Establish baseline schema (workspaces, messages, peers, identity, outbox, settings)',
  up: async (ctx) => {
    // Set version marker — existing data is already in correct format
    ctx.log('Setting baseline schema version');
    await ctx.setSetting('_schemaVersion', 1);
    await ctx.setSetting('_protocolVersion', '0.1.0');
  },
};

/**
 * v2: Add vectorClock field to messages
 * Early messages might not have vectorClock. This backfills them.
 */
const v2_addVectorClocks: Migration = {
  version: 2,
  description: 'Backfill vectorClock on messages that lack it',
  up: async (ctx) => {
    const messages = await ctx.getAll('messages');
    let updated = 0;
    for (const msg of messages) {
      if (!msg.vectorClock) {
        msg.vectorClock = {};
        await ctx.put('messages', msg);
        updated++;
      }
    }
    ctx.log(`Updated ${updated}/${messages.length} messages with vectorClock`);
  },
  down: async (ctx) => {
    // No need to remove vectorClock — it's additive
    ctx.log('No rollback needed for vectorClock addition');
  },
};

/**
 * v3: Add attachment metadata support to messages
 */
const v3_addAttachments: Migration = {
  version: 3,
  description: 'Add attachments array to messages schema',
  up: async (ctx) => {
    const messages = await ctx.getAll('messages');
    let updated = 0;
    for (const msg of messages) {
      if (!msg.attachments) {
        msg.attachments = [];
        await ctx.put('messages', msg);
        updated++;
      }
    }
    ctx.log(`Updated ${updated}/${messages.length} messages with attachments field`);
  },
};

/**
 * v4: Add workspace settings (per-workspace preferences)
 */
const v4_workspaceSettings: Migration = {
  version: 4,
  description: 'Add settings field to workspace objects',
  up: async (ctx) => {
    const workspaces = await ctx.getAll('workspaces');
    for (const ws of workspaces) {
      if (!ws.settings) {
        ws.settings = {
          autoDownloadImages: true,
          autoDownloadVoice: true,
          maxStorageBytes: 500 * 1024 * 1024,
        };
        await ctx.put('workspaces', ws);
      }
    }
    ctx.log(`Updated ${workspaces.length} workspaces with settings`);
  },
};

/**
 * v5: Add ratchetStates store for Double Ratchet forward secrecy
 * The IndexedDB object store is created by PersistentStore.init() (version bump).
 * This migration just marks the schema version.
 */
const v5_doubleRatchet: Migration = {
  version: 5,
  description: 'Add ratchetStates store for Double Ratchet forward secrecy',
  up: async (ctx) => {
    ctx.log('Double Ratchet ratchetStates store added (created by IndexedDB upgrade)');
  },
  down: async (ctx) => {
    // Clearing ratchet states on rollback — peers will re-handshake
    try {
      await ctx.clear('ratchetStates');
    } catch {}
    ctx.log('Cleared ratchetStates store');
  },
};

/**
 * v6: Add contacts and directConversations stores
 * The IndexedDB object stores are created by PersistentStore.init() (version bump).
 * This migration just marks the schema version.
 */
const v6_contacts: Migration = {
  version: 6,
  description: 'Add contacts and directConversations stores for standalone DMs',
  up: async (ctx) => {
    ctx.log('Contacts and directConversations stores added (created by IndexedDB upgrade)');
  },
  down: async (ctx) => {
    try {
      await ctx.clear('contacts');
      await ctx.clear('directConversations');
    } catch {}
    ctx.log('Cleared contacts and directConversations stores');
  },
};

/**
 * All migrations in order
 */
export const ALL_MIGRATIONS: Migration[] = [
  v1_initialSchema,
  v2_addVectorClocks,
  v3_addAttachments,
  v4_workspaceSettings,
  v5_doubleRatchet,
  v6_contacts,
];

/** Current schema version */
export const CURRENT_SCHEMA_VERSION = 6;
