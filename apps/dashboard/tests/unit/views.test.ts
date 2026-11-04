import { describe, expect, it } from 'vitest'
import { agentState, isProcessHealthy } from '../../server/utils/views'

describe('reliability semantics', () => {
  it('never treats unknown process states as healthy', () => {
    expect(isProcessHealthy({ kind: 'pm2', status: 'online' })).toBe(true)
    expect(isProcessHealthy({ kind: 'pm2', status: 'errored' })).toBe(false)
    expect(isProcessHealthy({ kind: 'pm2', status: '' })).toBe(false)
    expect(isProcessHealthy({ kind: 'docker', status: 'running', health: 'unhealthy' })).toBe(false)
    expect(isProcessHealthy({ kind: 'docker', status: 'running', health: 'none' })).toBe(true)
    expect(isProcessHealthy({ kind: 'systemd', status: 'activating' })).toBe(false)
    expect(isProcessHealthy({ kind: 'mystery', status: 'online' })).toBe(false)
  })

  it('distinguishes never-seen, stale, online and revoked agents', () => {
    expect(agentState({ status: 'ACTIVE', lastSeenAt: null })).toBe('never_seen')
    expect(agentState({ status: 'ACTIVE', lastSeenAt: new Date() })).toBe('online')
    expect(agentState({ status: 'ACTIVE', lastSeenAt: new Date(Date.now() - 10 * 60_000) })).toBe('stale')
    expect(agentState({ status: 'REVOKED', lastSeenAt: new Date() })).toBe('revoked')
  })
})
