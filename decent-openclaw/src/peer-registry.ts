/**
 * Shared registry for active DecentChatNodePeer instances, keyed by account id.
 * Allows channel.ts adapters to deliver outbound messages and directory lookups
 * via the correct P2P peer when multiple DecentChat accounts are running.
 */

import type { DecentChatNodePeer } from "./peer/DecentChatNodePeer.js";

const DEFAULT_ACCOUNT_ID = "default";

const activePeers = new Map<string, InstanceType<typeof DecentChatNodePeer>>();

export function setActivePeer(
  peer: InstanceType<typeof DecentChatNodePeer> | null,
  accountId: string = DEFAULT_ACCOUNT_ID,
): void {
  const key = accountId?.trim() || DEFAULT_ACCOUNT_ID;
  if (peer) {
    activePeers.set(key, peer);
  } else {
    activePeers.delete(key);
  }
}

export function getActivePeer(accountId: string = DEFAULT_ACCOUNT_ID): InstanceType<typeof DecentChatNodePeer> | null {
  const key = accountId?.trim() || DEFAULT_ACCOUNT_ID;
  return activePeers.get(key) ?? null;
}

export function listActivePeerAccountIds(): string[] {
  return Array.from(activePeers.keys()).sort((a, b) => a.localeCompare(b));
}
