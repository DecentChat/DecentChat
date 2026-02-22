/**
 * Shared registry for the active NodeXenaPeer instance.
 * Allows channel.ts sendText to deliver outbound messages via the P2P peer.
 */

import type { NodeXenaPeer } from "./peer/NodeXenaPeer.js";

let activePeer: InstanceType<typeof NodeXenaPeer> | null = null;

export function setActivePeer(peer: InstanceType<typeof NodeXenaPeer> | null): void {
  activePeer = peer;
}

export function getActivePeer(): InstanceType<typeof NodeXenaPeer> | null {
  return activePeer;
}
