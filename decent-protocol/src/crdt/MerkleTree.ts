/**
 * MerkleTree - Efficient history comparison between peers
 * 
 * Instead of sending full message history for sync,
 * peers compare Merkle tree roots. If roots match → in sync.
 * If not → traverse tree to find exactly which messages differ.
 * 
 * This reduces sync bandwidth from O(n) to O(log n).
 */

export interface MerkleNode {
  hash: string;
  left?: MerkleNode;
  right?: MerkleNode;
  messageId?: string; // Only set for leaf nodes
}

export class MerkleTree {
  private root: MerkleNode | null = null;

  /**
   * Build tree from message IDs (sorted)
   */
  async build(messageIds: string[]): Promise<void> {
    if (messageIds.length === 0) {
      this.root = null;
      return;
    }

    // Create leaf nodes
    const leaves: MerkleNode[] = await Promise.all(
      messageIds.map(async id => ({
        hash: await this.hashString(id),
        messageId: id,
      }))
    );

    // Build tree bottom-up
    this.root = await this.buildLevel(leaves);
  }

  /**
   * Get the root hash (fingerprint of entire message set)
   */
  getRootHash(): string | null {
    return this.root?.hash || null;
  }

  /**
   * Get the root node
   */
  getRoot(): MerkleNode | null {
    return this.root;
  }

  /**
   * Compare two trees and find differing message IDs
   * Returns IDs that exist in `other` but not in `this`
   */
  diff(other: MerkleTree): string[] {
    if (!other.root) return [];
    if (!this.root) {
      // We have nothing, they have everything
      return this.collectLeafIds(other.root);
    }

    if (this.root.hash === other.root.hash) {
      return []; // Identical!
    }

    return this.diffNodes(this.root, other.root);
  }

  /**
   * Get all leaf (message) IDs in the tree
   */
  getLeafIds(): string[] {
    if (!this.root) return [];
    return this.collectLeafIds(this.root);
  }

  /**
   * Get tree depth
   */
  getDepth(): number {
    if (!this.root) return 0;
    return this.nodeDepth(this.root);
  }

  // === Internal ===

  private async buildLevel(nodes: MerkleNode[]): Promise<MerkleNode> {
    if (nodes.length === 1) return nodes[0];

    const nextLevel: MerkleNode[] = [];

    for (let i = 0; i < nodes.length; i += 2) {
      const left = nodes[i];
      const right = nodes[i + 1]; // May be undefined (odd count)

      if (right) {
        const combinedHash = await this.hashString(left.hash + right.hash);
        nextLevel.push({ hash: combinedHash, left, right });
      } else {
        // Odd node: promote directly
        const combinedHash = await this.hashString(left.hash + left.hash);
        nextLevel.push({ hash: combinedHash, left, right: left });
      }
    }

    return this.buildLevel(nextLevel);
  }

  private diffNodes(local: MerkleNode, remote: MerkleNode): string[] {
    // If hashes match, subtrees are identical
    if (local.hash === remote.hash) return [];

    // If both are leaves
    if (local.messageId && remote.messageId) {
      if (local.messageId !== remote.messageId) {
        return [remote.messageId];
      }
      return [];
    }

    // If remote is a leaf but local isn't (or vice versa)
    if (remote.messageId) return [remote.messageId];
    if (local.messageId) return this.collectLeafIds(remote);

    const diffs: string[] = [];

    // Compare left subtrees
    if (local.left && remote.left) {
      diffs.push(...this.diffNodes(local.left, remote.left));
    } else if (remote.left) {
      diffs.push(...this.collectLeafIds(remote.left));
    }

    // Compare right subtrees
    if (local.right && remote.right) {
      diffs.push(...this.diffNodes(local.right, remote.right));
    } else if (remote.right) {
      diffs.push(...this.collectLeafIds(remote.right));
    }

    return diffs;
  }

  private collectLeafIds(node: MerkleNode, seen = new Set<string>()): string[] {
    if (node.messageId) {
      if (seen.has(node.messageId)) return [];
      seen.add(node.messageId);
      return [node.messageId];
    }
    const ids: string[] = [];
    if (node.left) ids.push(...this.collectLeafIds(node.left, seen));
    if (node.right) ids.push(...this.collectLeafIds(node.right, seen));
    return ids;
  }

  private nodeDepth(node: MerkleNode): number {
    if (!node.left && !node.right) return 1;
    const leftDepth = node.left ? this.nodeDepth(node.left) : 0;
    const rightDepth = node.right ? this.nodeDepth(node.right) : 0;
    return 1 + Math.max(leftDepth, rightDepth);
  }

  private async hashString(input: string): Promise<string> {
    const encoder = new TextEncoder();
    const buffer = await crypto.subtle.digest('SHA-256', encoder.encode(input));
    const bytes = new Uint8Array(buffer);
    return Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('');
  }
}
