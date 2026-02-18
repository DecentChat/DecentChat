/**
 * Peer Exchange (PEX) for Signaling Server Discovery
 * DEP-002 implementation
 */

import type { PEXServer } from './types';

export interface ServerStats extends PEXServer {
  addedAt: number
  totalAttempts: number
  successfulAttempts: number
  avgLatency: number
}

export interface PeerExchangeMessage {
  type: 'peer-exchange'
  servers: PEXServer[]
}

export class ServerDiscovery {
  private knownServers: Map<string, ServerStats> = new Map()
  private readonly maxServers = 50
  private readonly maxAge = 30 * 24 * 3600 * 1000 // 30 days
  private readonly topServersCount = 5

  constructor(
    private workspaceId: string,
    private primaryServer: string
  ) {
    // Add primary server from invite
    this.knownServers.set(primaryServer, {
      url: primaryServer,
      addedAt: Date.now(),
      lastSeen: Date.now(),
      successRate: 1.0,
      totalAttempts: 0,
      successfulAttempts: 0,
      avgLatency: 0,
    })
  }

  /**
   * Get top servers for handshake sharing
   */
  getHandshakeServers(): PEXServer[] {
    return this.getRankedServers()
      .slice(0, this.topServersCount)
      .map(s => ({
        url: s.url,
        lastSeen: s.lastSeen,
        successRate: s.successRate,
        latency: s.avgLatency || undefined,
      }))
  }

  /**
   * Merge received servers from peer
   */
  mergeReceivedServers(servers: PEXServer[]): void {
    for (const s of servers) {
      const existing = this.knownServers.get(s.url)
      
      if (!existing) {
        // New server discovered
        this.knownServers.set(s.url, {
          url: s.url,
          addedAt: Date.now(),
          lastSeen: s.lastSeen,
          successRate: s.successRate,
          totalAttempts: 0,
          successfulAttempts: 0,
          avgLatency: s.latency || 0,
        })
      } else if (s.lastSeen > existing.lastSeen) {
        // Update with fresher data
        existing.lastSeen = s.lastSeen
        existing.successRate = (existing.successRate + s.successRate) / 2 // avg
        if (s.latency) {
          existing.avgLatency = existing.avgLatency
            ? (existing.avgLatency + s.latency) / 2
            : s.latency
        }
      }
    }

    this.pruneOldServers()
    this.enforceLimit()
  }

  /**
   * Get servers ranked by quality for connection attempts
   */
  getRankedServers(): ServerStats[] {
    return Array.from(this.knownServers.values())
      .sort((a, b) => this.rankServer(b) - this.rankServer(a))
  }

  /**
   * Record successful connection
   */
  recordSuccess(url: string, latency: number): void {
    const server = this.knownServers.get(url)
    if (!server) return

    server.totalAttempts++
    server.successfulAttempts++
    server.lastSeen = Date.now()
    server.successRate = server.successfulAttempts / server.totalAttempts
    
    // Exponential moving average for latency
    if (server.avgLatency === 0) {
      server.avgLatency = latency
    } else {
      server.avgLatency = server.avgLatency * 0.7 + latency * 0.3
    }
  }

  /**
   * Record failed connection
   */
  recordFailure(url: string): void {
    const server = this.knownServers.get(url)
    if (!server) return

    server.totalAttempts++
    server.successRate = server.successfulAttempts / server.totalAttempts
  }

  /**
   * Rank server by quality (0.0 - 1.0)
   */
  private rankServer(server: ServerStats): number {
    const now = Date.now()
    const age = now - server.lastSeen
    
    // Recency score (exponential decay over 7 days)
    const recency = Math.exp(-age / (7 * 24 * 3600 * 1000))
    
    // Reliability score
    const reliability = server.successRate
    
    // Speed score (inverse of latency, normalized)
    const speed = server.avgLatency > 0 ? 1 / (1 + server.avgLatency / 1000) : 0.5
    
    // Weighted combination
    return recency * 0.3 + reliability * 0.5 + speed * 0.2
  }

  /**
   * Remove servers not seen in 30 days
   */
  private pruneOldServers(): void {
    const now = Date.now()
    const toDelete: string[] = []

    for (const [url, server] of this.knownServers) {
      if (now - server.lastSeen > this.maxAge) {
        // Never prune primary server
        if (url !== this.primaryServer) {
          toDelete.push(url)
        }
      }
    }

    for (const url of toDelete) {
      this.knownServers.delete(url)
    }
  }

  /**
   * Keep only top N servers by rank
   */
  private enforceLimit(): void {
    if (this.knownServers.size <= this.maxServers) return

    const ranked = this.getRankedServers()
    const toKeep = new Set(ranked.slice(0, this.maxServers).map(s => s.url))
    
    // Always keep primary
    toKeep.add(this.primaryServer)

    for (const url of this.knownServers.keys()) {
      if (!toKeep.has(url)) {
        this.knownServers.delete(url)
      }
    }
  }

  /**
   * Serialize for persistence
   */
  toJSON(): { workspaceId: string; servers: ServerStats[] } {
    return {
      workspaceId: this.workspaceId,
      servers: Array.from(this.knownServers.values()),
    }
  }

  /**
   * Restore from persistence
   */
  static fromJSON(data: { workspaceId: string; servers: ServerStats[] }, primaryServer: string): ServerDiscovery {
    const discovery = new ServerDiscovery(data.workspaceId, primaryServer)
    
    for (const server of data.servers) {
      discovery.knownServers.set(server.url, server)
    }
    
    return discovery
  }
}
