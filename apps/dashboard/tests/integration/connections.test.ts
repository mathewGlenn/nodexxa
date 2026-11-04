import { describe, expect, it } from 'vitest'
import { prisma } from '../../server/utils/db'
import { syncConnection } from '../../server/utils/sync'
import { claimDueConnections } from '../../server/utils/scheduler'
import { FAKE_TOKENS, LEAK_MARKERS } from '../fixtures/fake-do'
import { createUser } from './helpers'

async function setup() {
  const owner = await createUser('OWNER')
  const ws = `/api/w/${owner.workspaceId}`
  const a = await owner.client.post(`${ws}/connections`, { label: 'Alpha', client: 'Alpha Agency', token: FAKE_TOKENS.alpha })
  const b = await owner.client.post(`${ws}/connections`, { label: 'Beta', client: 'Beta Client', token: FAKE_TOKENS.beta })
  expect(a.status).toBe(200)
  expect(b.status).toBe(200)
  return { owner, ws, alpha: a.body, beta: b.body }
}

describe('DigitalOcean connections (Layer 1)', () => {
  it('stores tokens encrypted, returns only a masked suffix, and never echoes them', async () => {
    const { owner, ws, alpha } = await setup()
    expect(alpha.tokenMasked).toBe(`••••${FAKE_TOKENS.alpha.slice(-4)}`)
    expect(alpha.teamName).toBe('Alpha Agency')
    const row = await prisma.connection.findUniqueOrThrow({ where: { id: alpha.id } })
    expect(row.tokenCiphertext).not.toContain(FAKE_TOKENS.alpha)
    expect(row.tokenCiphertext.startsWith('v1.test2.')).toBe(true)
    for (const path of ['/connections', `/connections/${alpha.id}`, '/overview', '/audit']) {
      const res = await owner.client.get(`${ws}${path}`)
      expect(res.raw).not.toContain(FAKE_TOKENS.alpha)
      expect(res.raw).not.toContain('tokenCiphertext')
    }
  })

  it('rejects invalid tokens without disclosing them', async () => {
    const { client, workspaceId } = await createUser('ADMIN')
    const bogus = `fake-unknown-token-${'q'.repeat(40)}`
    const res = await client.post(`/api/w/${workspaceId}/connections`, { label: 'Bad', token: bogus })
    expect(res.status).toBe(400)
    expect(res.raw).not.toContain(bogus)
    expect(res.body.statusMessage).toMatch(/Token rejected/)
    expect(await prisma.connection.count({ where: { workspaceId } })).toBe(0)
  })

  it('discovers two teams separately even when provider IDs collide, with project many-to-many', async () => {
    const { owner, ws, alpha, beta } = await setup()
    expect((await syncConnection(alpha.id)).ok).toBe(true)
    expect((await syncConnection(beta.id)).ok).toBe(true)

    const droplets = (await owner.client.get(`${ws}/resources?type=droplet`)).body.items
    expect(droplets).toHaveLength(6) // 3 per team, both paginated (page size 2)
    const id1001 = droplets.filter((d: any) => d.providerId === '1001')
    expect(id1001).toHaveLength(2)
    expect(new Set(id1001.map((d: any) => d.connection.label))).toEqual(new Set(['Alpha', 'Beta']))

    const alphaWeb1 = id1001.find((d: any) => d.connection.label === 'Alpha')
    expect(alphaWeb1.projects.map((p: any) => p.name).sort()).toEqual(['Ops', 'Production'])

    const conn = (await owner.client.get(`${ws}/connections/${alpha.id}`)).body
    expect(conn.status).toBe('OK')
    expect(conn.resourceCounts).toEqual({ droplet: 3, app: 1, database: 1 })

    // App deployments (read-only history) and droplet metrics with source labels.
    const app = (await owner.client.get(`${ws}/resources?type=app&connectionId=${alpha.id}`)).body.items[0]
    const appDetail = (await owner.client.get(`${ws}/resources/${app.id}`)).body
    expect(appDetail.deployments.map((d: any) => d.phase)).toEqual(['ACTIVE', 'SUPERSEDED'])
    const dropletDetail = (await owner.client.get(`${ws}/resources/${alphaWeb1.id}`)).body
    expect(dropletDetail.metricsStatus).toBe('ok')
    expect(dropletDetail.series.cpu_pct.source).toBe('digitalocean')
    expect(dropletDetail.series.disk_pct.points.at(-1)[1]).toBe(60) // root fs only: (25-10)/25
    const off = droplets.find((d: any) => d.name === 'alpha-worker')
    expect((await owner.client.get(`${ws}/resources/${off.id}`)).body.metricsStatus).toBe('no_data')
  })

  it('never persists provider credentials or app env values', async () => {
    const { alpha } = await setup()
    await syncConnection(alpha.id)
    const rows = await prisma.resource.findMany({ where: { connectionId: alpha.id } })
    const dump = JSON.stringify(rows)
    for (const marker of LEAK_MARKERS) expect(dump).not.toContain(marker)
  })

  it('treats missing scopes as unsupported per type rather than failing', async () => {
    const { client, workspaceId } = await createUser('ADMIN')
    const c = await client.post(`/api/w/${workspaceId}/connections`, { label: 'Limited', token: FAKE_TOKENS.limited })
    expect((await syncConnection(c.body.id)).ok).toBe(true)
    const conn = await prisma.connection.findUniqueOrThrow({ where: { id: c.body.id } })
    expect(conn.capabilities).toMatchObject({ droplets: 'ok', apps: 'ok', databases: 'forbidden', monitoring: 'forbidden' })
    const metricStates = await prisma.resource.findMany({ where: { connectionId: c.body.id, type: 'droplet' }, select: { metricsStatus: true } })
    expect(metricStates.every(r => r.metricsStatus === 'forbidden')).toBe(true)
  })

  it('a failed sync keeps inventory, marks the connection, and surfaces no token', async () => {
    const { owner, ws, alpha } = await setup()
    await syncConnection(alpha.id)
    // Simulate revocation at DigitalOcean: swap in a token the fake API rejects.
    const { encryptSecret } = await import('../../server/utils/crypto')
    await prisma.connection.update({ where: { id: alpha.id }, data: { tokenCiphertext: encryptSecret('dop_v1_revoked0000000000000000000000000000000000000000000000000000', `connection:${alpha.id}`) } })
    const r = await syncConnection(alpha.id)
    expect(r).toMatchObject({ ok: false, kind: 'auth' })
    const conn = (await owner.client.get(`${ws}/connections/${alpha.id}`)).body
    expect(conn.status).toBe('AUTH_ERROR')
    expect(conn.lastError).toMatch(/rejected/)
    expect(conn.raw ?? JSON.stringify(conn)).not.toContain('revoked0000')
    expect(conn.resourceCounts.droplet).toBe(3) // inventory preserved
    expect(new Date(conn.nextSyncAt).getTime()).toBeGreaterThan(Date.now()) // backoff
  })

  it('honours rate limits with a reset-based retry time', async () => {
    const { client, workspaceId } = await createUser('ADMIN')
    const id = crypto.randomUUID()
    const { encryptSecret } = await import('../../server/utils/crypto')
    await prisma.connection.create({ data: { id, workspaceId, label: 'RL', tokenCiphertext: encryptSecret(FAKE_TOKENS.ratelimited, `connection:${id}`), tokenSuffix: 'xxxx' } })
    const r = await syncConnection(id)
    expect(r).toMatchObject({ ok: false, kind: 'rate_limited' })
    const conn = await prisma.connection.findUniqueOrThrow({ where: { id } })
    expect(conn.status).toBe('RATE_LIMITED')
    expect(conn.nextSyncAt.getTime()).toBeGreaterThan(Date.now() + 25_000)
    expect((await client.get(`/api/w/${workspaceId}/connections`)).status).toBe(200)
  })

  it('rotates tokens only within the same DigitalOcean team and records history', async () => {
    const { owner, ws, alpha } = await setup()
    const wrongTeam = await owner.client.patch(`${ws}/connections/${alpha.id}`, { token: FAKE_TOKENS.beta })
    expect(wrongTeam.status).toBe(400)
    expect(wrongTeam.body.statusMessage).toMatch(/different DigitalOcean team/)
    const ok = await owner.client.patch(`${ws}/connections/${alpha.id}`, { token: FAKE_TOKENS.alphaRotated })
    expect(ok.status).toBe(200)
    expect(ok.body.tokenMasked).toBe(`••••${FAKE_TOKENS.alphaRotated.slice(-4)}`)
    const detail = (await owner.client.get(`${ws}/connections/${alpha.id}`)).body
    expect(detail.history.map((h: any) => h.action)).toContain('connection.token_rotated')
    expect(JSON.stringify(detail.history)).not.toContain(FAKE_TOKENS.alphaRotated)
  })

  it('marks resources that disappear as missing instead of deleting them', async () => {
    const { alpha } = await setup()
    await syncConnection(alpha.id)
    const ghost = await prisma.resource.create({ data: { workspaceId: (await prisma.connection.findUniqueOrThrow({ where: { id: alpha.id } })).workspaceId, connectionId: alpha.id, type: 'droplet', providerId: '999999', name: 'deleted-at-provider' } })
    await syncConnection(alpha.id)
    const after = await prisma.resource.findUniqueOrThrow({ where: { id: ghost.id } })
    expect(after.missingSince).not.toBeNull()
  })

  it('schedulers never hand the same connection to two workers', async () => {
    await setup()
    await prisma.connection.updateMany({ data: { nextSyncAt: new Date(Date.now() - 1000), leaseUntil: null } })
    const due = await prisma.connection.count({ where: { enabled: true, nextSyncAt: { lte: new Date() } } })
    const claims = await Promise.all(Array.from({ length: 6 }, (_, i) => claimDueConnections(`w${i}`, 100)))
    const all = claims.flat()
    expect(new Set(all).size).toBe(all.length) // disjoint
    expect(all.length).toBe(due)
    expect((await claimDueConnections('late', 100))).toHaveLength(0) // leased
  })
})
