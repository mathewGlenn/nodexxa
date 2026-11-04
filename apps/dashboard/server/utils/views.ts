import type { Agent, Connection } from '@prisma/client'
import { SYNC_INTERVAL_MS } from './sync'

/** Public connection shape: never includes the ciphertext, only a masked suffix. */
export function connectionView(c: Connection) {
  const stale = !c.lastSyncAt || Date.now() - c.lastSyncAt.getTime() > 3 * SYNC_INTERVAL_MS
  return {
    id: c.id, label: c.label, client: c.client, tokenMasked: `••••${c.tokenSuffix}`, tokenRotatedAt: c.tokenRotatedAt,
    teamUuid: c.teamUuid, teamName: c.teamName, status: c.status, lastError: c.lastError, lastSyncAt: c.lastSyncAt,
    lastSyncAttemptAt: c.lastSyncAttemptAt, consecutiveFailures: c.consecutiveFailures, rateLimitRemaining: c.rateLimitRemaining,
    rateLimitResetAt: c.rateLimitResetAt, capabilities: c.capabilities, enabled: c.enabled, nextSyncAt: c.nextSyncAt, stale, createdAt: c.createdAt,
  }
}

export const AGENT_STALE_MS = 3 * 60_000

export function agentState(a: Pick<Agent, 'status' | 'lastSeenAt'>): 'online' | 'stale' | 'never_seen' | 'revoked' {
  if (a.status === 'REVOKED') return 'revoked'
  if (!a.lastSeenAt) return 'never_seen'
  return Date.now() - a.lastSeenAt.getTime() > AGENT_STALE_MS ? 'stale' : 'online'
}

/** Healthy = positively observed running state. Anything else (incl. unknown values) is not healthy. */
export function isProcessHealthy(p: { kind: string, status: string, health?: string | null }): boolean {
  if (p.kind === 'pm2') return p.status === 'online'
  if (p.kind === 'docker') return p.status === 'running' && p.health !== 'unhealthy'
  if (p.kind === 'systemd') return p.status === 'active'
  return false
}

export function agentView(a: Agent) {
  return {
    id: a.id, hostname: a.hostname, displayName: a.displayName, os: a.os, arch: a.arch, agentVersion: a.agentVersion,
    protocolVersion: a.protocolVersion, capabilities: a.capabilities, status: a.status, state: agentState(a), enrolledAt: a.enrolledAt,
    keyRotatedAt: a.keyRotatedAt, lastSeenAt: a.lastSeenAt, lastSnapshotAt: a.lastSnapshotAt, revokedAt: a.revokedAt,
    system: a.system, collectors: a.collectors, agentHealth: a.agentHealth, resourceId: a.resourceId, linkedAt: a.linkedAt,
  }
}
