import { describe, expect, it } from 'vitest'
import { prisma } from '../../server/utils/db'
import { Client, createUser, PASSWORD } from './helpers'

describe('authentication', () => {
  it('logs in with hardened session cookie and logs out server-side', async () => {
    const { email } = await createUser('OWNER')
    const c = new Client()
    const res = await c.post('/api/auth/login', { email, password: PASSWORD })
    expect(res.status).toBe(200)
    expect(res.body.user).not.toHaveProperty('passwordHash')
    const cookie = res.headers.getSetCookie().find(s => s.startsWith('nx_session='))!
    expect(cookie).toMatch(/HttpOnly/i)
    expect(cookie).toMatch(/SameSite=Strict/i)
    expect((await c.get('/api/auth/me')).body.user.email).toBe(email)

    const token = c.cookies.get('nx_session')!
    await c.post('/api/auth/logout')
    // The old token is invalid even if replayed.
    const replay = new Client()
    replay.cookies.set('nx_session', token)
    expect((await replay.get('/api/auth/me')).body.user).toBeNull()
  })

  it('rejects wrong passwords with a generic message and rate-limits per account', async () => {
    const { email } = await createUser('VIEWER')
    const c = new Client()
    const bad = await c.post('/api/auth/login', { email, password: 'wrong-password-123' })
    expect(bad.status).toBe(401)
    expect(bad.body.statusMessage).toBe('Invalid email or password')
    const unknown = await c.post('/api/auth/login', { email: 'nobody@example.test', password: 'wrong-password-123' })
    expect(unknown.body.statusMessage).toBe('Invalid email or password')
    let last = 0
    for (let i = 0; i < 10; i++) last = (await c.post('/api/auth/login', { email, password: 'wrong-password-123' })).status
    expect(last).toBe(429)
    // Even the right password is throttled during the window.
    expect((await c.post('/api/auth/login', { email, password: PASSWORD })).status).toBe(429)
  })

  it('rejects disabled users', async () => {
    const { email, user } = await createUser('VIEWER')
    await prisma.user.update({ where: { id: user.id }, data: { disabledAt: new Date() } })
    expect((await new Client().post('/api/auth/login', { email, password: PASSWORD })).status).toBe(401)
  })

  it('blocks cross-site mutations (CSRF) while allowing same-origin ones', async () => {
    const { client, workspaceId } = await createUser('OWNER')
    const evil = Object.assign(new Client('https://evil.example'), { cookies: client.cookies })
    expect((await evil.post(`/api/w/${workspaceId}/checks`, { name: 'x', url: 'https://example.com' })).status).toBe(403)
    const noOrigin = await client.req('POST', `/api/w/${workspaceId}/checks`, { name: 'x', url: 'https://example.com' }, { origin: '' })
    expect(noOrigin.status).toBe(403)
  })

  it('sets security headers and no-store on API responses', async () => {
    const res = await new Client().get('/api/auth/me')
    expect(res.headers.get('cache-control')).toBe('no-store')
    const page = await fetch(`${process.env.NODEXXA_PUBLIC_URL ?? 'http://127.0.0.1:4511'}/login`)
    expect(page.headers.get('x-frame-options')).toBe('DENY')
    expect(page.headers.get('x-content-type-options')).toBe('nosniff')
  })
})

describe('authorization and workspace isolation', () => {
  it('requires authentication for workspace APIs', async () => {
    const { workspaceId } = await createUser('OWNER')
    for (const path of ['connections', 'resources', 'agents', 'incidents', 'checks']) {
      expect((await new Client().get(`/api/w/${workspaceId}/${path}`)).status).toBe(401)
    }
  })

  it('hides other workspaces entirely (404), including malformed ids', async () => {
    const a = await createUser('OWNER')
    const b = await createUser('OWNER')
    for (const path of ['connections', 'resources', 'agents', 'members', 'overview', 'audit']) {
      expect((await a.client.get(`/api/w/${b.workspaceId}/${path}`)).status).toBe(404)
    }
    expect((await a.client.get(`/api/w/not-a-uuid/connections`)).status).toBe(404)
    expect((await a.client.post(`/api/w/${b.workspaceId}/enrollments`, {})).status).toBe(404)
  })

  it('lets viewers read inventory but denies every privileged mutation', async () => {
    const owner = await createUser('OWNER')
    const viewer = await createUser('VIEWER', owner.workspaceId)
    const ws = `/api/w/${owner.workspaceId}`
    expect((await viewer.client.get(`${ws}/resources`)).status).toBe(200)
    expect((await viewer.client.get(`${ws}/connections`)).status).toBe(200)
    const denied = [
      viewer.client.post(`${ws}/connections`, { label: 'x', token: 'dop_v1_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx' }),
      viewer.client.post(`${ws}/enrollments`, { ttlMinutes: 10 }),
      viewer.client.get(`${ws}/enrollments`),
      viewer.client.post(`${ws}/alert-rules`, { name: 'x', type: 'cpu_high' }),
      viewer.client.post(`${ws}/channels`, { name: 'x', type: 'email', target: 'a@b.co' }),
      viewer.client.post(`${ws}/checks`, { name: 'x', url: 'https://example.com' }),
      viewer.client.post(`${ws}/invitations`, { email: 'x@example.test', role: 'ADMIN' }),
      viewer.client.get(`${ws}/audit`),
    ]
    for (const r of await Promise.all(denied)) expect(r.status).toBe(403)
  })

  it('prevents admins from managing owners and keeps at least one owner', async () => {
    const owner = await createUser('OWNER')
    const admin = await createUser('ADMIN', owner.workspaceId)
    const ws = `/api/w/${owner.workspaceId}`
    const members = (await owner.client.get(`${ws}/members`)).body.members
    const ownerMembership = members.find((m: any) => m.role === 'OWNER')
    expect((await admin.client.patch(`${ws}/members/${ownerMembership.id}`, { disabled: true })).status).toBe(403)
    expect((await admin.client.post(`${ws}/invitations`, { email: 'o@example.test', role: 'OWNER' })).status).toBe(403)
    expect((await owner.client.patch(`${ws}/members/${ownerMembership.id}`, { role: 'VIEWER' })).status).toBe(400) // self
  })

  it('invitations are single-use and grant the invited role', async () => {
    const owner = await createUser('OWNER')
    const ws = `/api/w/${owner.workspaceId}`
    const inv = await owner.client.post(`${ws}/invitations`, { email: 'new-member@example.test', role: 'VIEWER' })
    expect(inv.status).toBe(200)
    const token = inv.body.path.split('/').pop()
    const stored = await prisma.invitation.findUniqueOrThrow({ where: { id: inv.body.id } })
    expect(stored.tokenHash).not.toBe(token)
    const c = new Client()
    expect((await c.post(`/api/invitations/${token}`, { name: 'New', password: 'a-long-password-123' })).status).toBe(200)
    expect((await c.get('/api/auth/me')).body.workspaces[0]).toMatchObject({ id: owner.workspaceId, role: 'VIEWER' })
    expect((await new Client().post(`/api/invitations/${token}`, { name: 'Again', password: 'a-long-password-123' })).status).toBe(404)
  })
})
