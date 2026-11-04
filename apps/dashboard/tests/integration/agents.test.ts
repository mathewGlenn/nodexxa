import { describe, expect, it } from 'vitest'
import { sign } from 'node:crypto'
import { prisma } from '../../server/utils/db'
import { syncConnection } from '../../server/utils/sync'
import { FAKE_TOKENS } from '../fixtures/fake-do'
import { BASE, createUser, enrollAgent, newKeyPair, signedPost, snapshot, telemetry } from './helpers'

const TELEMETRY = '/api/agent/v1/telemetry'

describe('agent enrollment', () => {
  it('is one-time: a used token cannot enroll a second host', async () => {
    const { client, workspaceId } = await createUser('ADMIN')
    const { body } = await client.post(`/api/w/${workspaceId}/enrollments`, { ttlMinutes: 10 })
    const stored = await prisma.enrollmentToken.findUniqueOrThrow({ where: { id: body.id } })
    expect(stored.tokenHash).not.toContain(body.token)
    const enroll = () => fetch(`${BASE}/api/agent/v1/enroll`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ protocolVersion: 1, enrollmentToken: body.token, publicKey: newKeyPair().publicKeyB64, hostname: 'h', os: 'linux', arch: 'amd64', agentVersion: '1.0.0', capabilities: [] }),
    })
    const results = await Promise.all([enroll(), enroll(), enroll()]) // concurrent replays
    expect(results.map(r => r.status).sort()).toEqual([201, 401, 401])
    expect(await prisma.agent.count({ where: { workspaceId } })).toBe(1)
  })

  it('rejects expired tokens and unsupported protocol versions', async () => {
    const { client, workspaceId } = await createUser('ADMIN')
    const { body } = await client.post(`/api/w/${workspaceId}/enrollments`, { ttlMinutes: 10 })
    const req = (overrides: object) => fetch(`${BASE}/api/agent/v1/enroll`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ protocolVersion: 1, enrollmentToken: body.token, publicKey: newKeyPair().publicKeyB64, hostname: 'h', os: 'linux', arch: 'amd64', agentVersion: '1.0.0', capabilities: [], ...overrides }),
    })
    expect((await req({ protocolVersion: 99 })).status).toBe(426)
    await prisma.enrollmentToken.update({ where: { id: body.id }, data: { expiresAt: new Date(Date.now() - 1000) } })
    expect((await req({})).status).toBe(401)
  })
})

describe('signed telemetry ingestion', () => {
  it('accepts signed telemetry and exposes host + process state', async () => {
    const { client, workspaceId } = await createUser('OWNER')
    const agent = await enrollAgent(client, workspaceId)
    const res = await signedPost(agent, TELEMETRY, telemetry())
    expect(res.status).toBe(202)
    expect(res.body.accepted).toBe(1)
    const detail = (await client.get(`/api/w/${workspaceId}/agents/${agent.id}`)).body
    expect(detail.state).toBe('online')
    expect(detail.processes).toEqual([expect.objectContaining({ kind: 'pm2', name: 'api#0', status: 'online', healthy: true })])
    expect(detail.series.disk_pct.points[0][1]).toBe(40) // tmpfs ignored
    expect(detail.series.mem_pct.points[0][1]).toBe(50)
  })

  it('rejects replayed, reordered, stale, forged and oversized requests', async () => {
    const { client, workspaceId } = await createUser('OWNER')
    const agent = await enrollAgent(client, workspaceId)
    const payload = telemetry()
    expect((await signedPost(agent, TELEMETRY, payload, { seq: 10n })).status).toBe(202)
    expect((await signedPost(agent, TELEMETRY, payload, { seq: 10n })).status).toBe(409) // exact replay
    expect((await signedPost(agent, TELEMETRY, payload, { seq: 9n })).status).toBe(409) // older sequence
    expect((await signedPost(agent, TELEMETRY, payload, { seq: 11n, timestamp: Math.floor(Date.now() / 1000) - 3600 })).status).toBe(401)
    const forger = newKeyPair()
    expect((await signedPost(agent, TELEMETRY, payload, { seq: 12n, key: forger.privateKey })).status).toBe(401)
    const big = JSON.stringify(telemetry([snapshot({ pad: 'x'.repeat(600 * 1024) })]))
    expect((await signedPost(agent, TELEMETRY, null, { seq: 13n, rawBody: big })).status).toBe(413)
    expect((await signedPost(agent, TELEMETRY, telemetry(Array.from({ length: 21 }, () => snapshot())), { seq: 14n })).status).toBe(400)
    expect((await signedPost(agent, TELEMETRY, null, { seq: 15n, rawBody: '{not json' })).status).toBe(400)
    expect((await signedPost(agent, TELEMETRY, { ...telemetry(), protocolVersion: 2 }, { seq: 16n })).status).toBe(426)
    // Unknown agent id: generic 401, no detail.
    const ghost = await signedPost({ ...agent, id: crypto.randomUUID() }, TELEMETRY, payload, { seq: 1n })
    expect(ghost).toEqual({ status: 401, body: expect.objectContaining({ statusMessage: 'Unauthorized' }) })
  })

  it('is idempotent for duplicate snapshots delivered in separate requests', async () => {
    const { client, workspaceId } = await createUser('OWNER')
    const agent = await enrollAgent(client, workspaceId)
    const snap = snapshot()
    await signedPost(agent, TELEMETRY, telemetry([snap]))
    await signedPost(agent, TELEMETRY, telemetry([snap])) // e.g. retry after lost response
    expect(await prisma.metricSample.count({ where: { seriesKey: `agent:${agent.id}`, metric: 'cpu_pct' } })).toBe(1)
  })

  it('strips sensitive fields an agent might send (env, args, configs)', async () => {
    const { client, workspaceId } = await createUser('OWNER')
    const agent = await enrollAgent(client, workspaceId)
    const snap: any = snapshot()
    snap.pm2.items[0].env = { DB_PASSWORD: 'LEAKED_ENV_VALUE' }
    snap.pm2.items[0].args = ['--token=LEAKED_ARG_VALUE']
    snap.nginx.config = 'ssl_certificate_key LEAKED_NGINX_CONFIG;'
    expect((await signedPost(agent, TELEMETRY, telemetry([snap]))).status).toBe(202)
    const stored = JSON.stringify(await prisma.agent.findUniqueOrThrow({ where: { id: agent.id }, include: { processes: true } }), (_k, v) => (typeof v === 'bigint' ? String(v) : v))
    expect(stored).not.toMatch(/LEAKED_/)
  })

  it('revocation immediately stops ingestion', async () => {
    const { client, workspaceId } = await createUser('OWNER')
    const agent = await enrollAgent(client, workspaceId)
    expect((await signedPost(agent, TELEMETRY, telemetry())).status).toBe(202)
    expect((await client.post(`/api/w/${workspaceId}/agents/${agent.id}/revoke`)).status).toBe(200)
    expect((await signedPost(agent, TELEMETRY, telemetry())).status).toBe(401)
  })

  it('rotates the agent key with proof of possession; the old key stops working', async () => {
    const { client, workspaceId } = await createUser('OWNER')
    const agent = await enrollAgent(client, workspaceId)
    const next = newKeyPair()
    const badProof = sign(null, Buffer.from(`nodexxa-v1-rotate\n${agent.id}\n${next.publicKeyB64}`), newKeyPair().privateKey).toString('base64')
    expect((await signedPost(agent, '/api/agent/v1/rotate-key', { protocolVersion: 1, newPublicKey: next.publicKeyB64, proof: badProof })).status).toBe(400)
    const proof = sign(null, Buffer.from(`nodexxa-v1-rotate\n${agent.id}\n${next.publicKeyB64}`), next.privateKey).toString('base64')
    expect((await signedPost(agent, '/api/agent/v1/rotate-key', { protocolVersion: 1, newPublicKey: next.publicKeyB64, proof })).status).toBe(200)
    expect((await signedPost(agent, TELEMETRY, telemetry())).status).toBe(401)
    expect((await signedPost({ ...agent, privateKey: next.privateKey }, TELEMETRY, telemetry())).status).toBe(202)
  })
})

describe('agent ↔ droplet correlation', () => {
  it('requires explicit admin linking within the same workspace', async () => {
    const owner = await createUser('OWNER')
    const viewer = await createUser('VIEWER', owner.workspaceId)
    const other = await createUser('OWNER')
    const ws = `/api/w/${owner.workspaceId}`
    const conn = await owner.client.post(`${ws}/connections`, { label: 'Alpha', token: FAKE_TOKENS.alpha })
    await syncConnection(conn.body.id)
    const otherConn = await other.client.post(`/api/w/${other.workspaceId}/connections`, { label: 'Beta', token: FAKE_TOKENS.beta })
    await syncConnection(otherConn.body.id)

    const agent = await enrollAgent(owner.client, owner.workspaceId, 'alpha-web-1')
    await signedPost(agent, TELEMETRY, telemetry())
    const detail = (await owner.client.get(`${ws}/agents/${agent.id}`)).body
    expect(detail.resourceId).toBeNull() // never auto-linked
    expect(detail.linkSuggestions.map((s: any) => s.name)).toEqual(['alpha-web-1'])

    const foreignDroplet = await prisma.resource.findFirstOrThrow({ where: { workspaceId: other.workspaceId, type: 'droplet' } })
    expect((await owner.client.patch(`${ws}/agents/${agent.id}`, { resourceId: foreignDroplet.id })).status).toBe(400)
    expect((await viewer.client.patch(`${ws}/agents/${agent.id}`, { resourceId: detail.linkSuggestions[0].id })).status).toBe(403)
    const linked = await owner.client.patch(`${ws}/agents/${agent.id}`, { resourceId: detail.linkSuggestions[0].id })
    expect(linked.status).toBe(200)
    expect(linked.body.resourceId).toBe(detail.linkSuggestions[0].id)
    const audit = await prisma.auditLog.findFirst({ where: { workspaceId: owner.workspaceId, action: 'agent.linked' } })
    expect(audit?.actorUserId).toBe(owner.user.id)
  })
})
