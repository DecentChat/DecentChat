/**
 * DirectConversation — A standalone DM with a Contact, outside of any workspace.
 *
 * Each DirectConversation links to a Contact, has its own channelId for messages,
 * and exists at the top level (not inside a workspace). Messages use the same
 * hash-chain / CRDT system as workspace channels.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface DirectConversation {
  /** Unique conversation ID (used as the channelId for messages) */
  id: string;
  /** The contact's peer ID */
  contactPeerId: string;
  /** When this conversation was created */
  createdAt: number;
  /** Last message timestamp (for sorting) */
  lastMessageAt: number;
}

// ---------------------------------------------------------------------------
// DirectConversationStore interface
// ---------------------------------------------------------------------------

export interface DirectConversationStore {
  create(contactPeerId: string): Promise<DirectConversation>;
  get(id: string): Promise<DirectConversation | undefined>;
  getByContact(contactPeerId: string): Promise<DirectConversation | undefined>;
  list(): Promise<DirectConversation[]>;
  remove(id: string): Promise<void>;
  updateLastMessage(id: string, timestamp: number): Promise<void>;
}

// ---------------------------------------------------------------------------
// In-memory implementation
// ---------------------------------------------------------------------------

export class MemoryDirectConversationStore implements DirectConversationStore {
  private conversations = new Map<string, DirectConversation>();

  async create(contactPeerId: string): Promise<DirectConversation> {
    // Return existing conversation if one already exists for this contact
    for (const conv of this.conversations.values()) {
      if (conv.contactPeerId === contactPeerId) return conv;
    }

    const conversation: DirectConversation = {
      id: crypto.randomUUID(),
      contactPeerId,
      createdAt: Date.now(),
      lastMessageAt: 0,
    };

    this.conversations.set(conversation.id, conversation);
    return conversation;
  }

  async get(id: string): Promise<DirectConversation | undefined> {
    return this.conversations.get(id);
  }

  async getByContact(contactPeerId: string): Promise<DirectConversation | undefined> {
    for (const conv of this.conversations.values()) {
      if (conv.contactPeerId === contactPeerId) return conv;
    }
    return undefined;
  }

  async list(): Promise<DirectConversation[]> {
    return Array.from(this.conversations.values())
      .sort((a, b) => b.lastMessageAt - a.lastMessageAt);
  }

  async remove(id: string): Promise<void> {
    this.conversations.delete(id);
  }

  async updateLastMessage(id: string, timestamp: number): Promise<void> {
    const conv = this.conversations.get(id);
    if (conv) conv.lastMessageAt = timestamp;
  }
}
