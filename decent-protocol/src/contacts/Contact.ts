/**
 * Contact — A known peer, independent of any workspace.
 *
 * Contacts represent people you communicate with directly.
 * They store the peer's public identity info and signaling metadata
 * needed to establish a P2P connection.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface Contact {
  /** Peer ID (unique identifier) */
  peerId: string;
  /** ECDH public key (base64) for key exchange */
  publicKey: string;
  /** Human-readable name chosen by or assigned to this contact */
  displayName: string;
  /** Signaling servers this contact can be reached through */
  signalingServers: string[];
  /** When this contact was added */
  addedAt: number;
  /** Last time this contact was seen online */
  lastSeen: number;
}

// ---------------------------------------------------------------------------
// ContactStore interface
// ---------------------------------------------------------------------------

export interface ContactStore {
  add(contact: Contact): Promise<void>;
  remove(peerId: string): Promise<void>;
  get(peerId: string): Promise<Contact | undefined>;
  list(): Promise<Contact[]>;
  update(peerId: string, updates: Partial<Omit<Contact, 'peerId'>>): Promise<void>;
}

// ---------------------------------------------------------------------------
// In-memory implementation
// ---------------------------------------------------------------------------

export class MemoryContactStore implements ContactStore {
  private contacts = new Map<string, Contact>();

  async add(contact: Contact): Promise<void> {
    this.contacts.set(contact.peerId, contact);
  }

  async remove(peerId: string): Promise<void> {
    this.contacts.delete(peerId);
  }

  async get(peerId: string): Promise<Contact | undefined> {
    return this.contacts.get(peerId);
  }

  async list(): Promise<Contact[]> {
    return Array.from(this.contacts.values());
  }

  async update(peerId: string, updates: Partial<Omit<Contact, 'peerId'>>): Promise<void> {
    const existing = this.contacts.get(peerId);
    if (!existing) return;
    this.contacts.set(peerId, { ...existing, ...updates });
  }
}
