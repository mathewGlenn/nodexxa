import { describe, expect, it, vi } from 'vitest'
import { cpuPercentFromModes, createDoClient, DoApiError, normalizeApp, normalizeDatabase, normalizeDroplet, parseUrn, ratioPercent } from '../../server/utils/digitalocean'

const json = (status: number, body: unknown, headers: Record<string, string> = {}) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } })

describe('DigitalOcean client', () => {
  it('follows pagination links on the API origin only and never leaks the token elsewhere', async () => {
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(json(200, { droplets: [{ id: 1 }], links: { pages: { next: 'https://api.example/v2/droplets?page=2' } } }))
      .mockResolvedValueOnce(json(200, { droplets: [{ id: 2 }], links: { pages: { next: 'https://evil.example/steal' } } }))
    const c = createDoClient('secret-token', { baseUrl: 'https://api.example', fetchImpl: fetchImpl as any, retries: 0 })
    await expect(c.paginate('/v2/droplets', 'droplets')).rejects.toThrow(/outside the DigitalOcean API origin/)
    expect(fetchImpl).toHaveBeenCalledTimes(2)
    for (const call of fetchImpl.mock.calls) expect(new URL(call[0]).origin).toBe('https://api.example')
  })

  it('only ever issues GET requests', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(json(200, { account: {} }))
    await createDoClient('t', { baseUrl: 'https://api.example', fetchImpl: fetchImpl as any }).get('/v2/account')
    expect(fetchImpl.mock.calls[0]![1].method).toBe('GET')
  })

  it.each([[401, 'auth'], [403, 'forbidden'], [404, 'not_found'], [429, 'rate_limited'], [422, 'invalid']])('maps HTTP %i to %s without echoing the token', async (status, kind) => {
    const fetchImpl = vi.fn().mockResolvedValue(json(status, { id: 'some_error', message: 'contains secret-token maybe' }, { 'ratelimit-reset': '2000000000' }))
    const err = await createDoClient('secret-token', { baseUrl: 'https://api.example', fetchImpl: fetchImpl as any, retries: 0 }).get('/v2/x').catch(e => e)
    expect(err).toBeInstanceOf(DoApiError)
    expect(err.kind).toBe(kind)
    expect(err.message).not.toContain('secret-token')
    if (kind === 'rate_limited') expect(err.resetAt.getTime()).toBe(2_000_000_000_000)
  })

  it('retries transient 5xx responses', async () => {
    const fetchImpl = vi.fn().mockResolvedValueOnce(json(502, {})).mockResolvedValueOnce(json(200, { ok: 1 }))
    vi.useFakeTimers({ shouldAdvanceTime: true, advanceTimeDelta: 500 })
    const res = await createDoClient('t', { baseUrl: 'https://api.example', fetchImpl: fetchImpl as any, retries: 1 }).get('/v2/x')
    vi.useRealTimers()
    expect(res).toEqual({ ok: 1 })
  })

  it('rejects malformed list responses', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(json(200, { droplets: 'nope' }))
    await expect(createDoClient('t', { baseUrl: 'https://api.example', fetchImpl: fetchImpl as any }).paginate('/v2/droplets', 'droplets')).rejects.toThrow(/Malformed/)
  })
})

describe('sanitizers', () => {
  it('drops database credentials and connection strings', () => {
    const db = normalizeDatabase({ id: 'db1', name: 'pg', engine: 'pg', version: '16', status: 'online', region: 'fra1', size: 'x', num_nodes: 1, connection: { password: 'S3CRET' }, private_connection: { uri: 'postgres://u:S3CRET@h' }, users: [{ password: 'S3CRET' }] })
    expect(JSON.stringify(db)).not.toContain('S3CRET')
    expect(db?.version).toBe('pg 16')
  })

  it('keeps only app component names, never env vars', () => {
    const app = normalizeApp({ id: 'a', spec: { name: 'web', services: [{ name: 'api', envs: [{ key: 'K', value: 'ENVSECRET' }], run_command: 'node --secret=x' }] }, active_deployment: { id: 'd', phase: 'ACTIVE' } })
    expect(JSON.stringify(app)).not.toMatch(/ENVSECRET|secret=x/)
    expect(app?.details.components).toEqual([{ kind: 'services', name: 'api' }])
    expect(app?.status).toBe('ACTIVE')
  })

  it('normalizes droplets and tolerates malformed input', () => {
    expect(normalizeDroplet(null)).toBeNull()
    expect(normalizeDroplet({ name: 'no-id' })).toBeNull()
    const d = normalizeDroplet({ id: 5, name: 'x', status: 'active', networks: { v4: [{ type: 'private', ip_address: '10.0.0.5' }, { type: 'public', ip_address: '203.0.113.5' }] }, tags: ['a', 3] })
    expect(d).toMatchObject({ providerId: '5', publicIpv4: '203.0.113.5', privateIpv4: '10.0.0.5', tags: ['a'] })
  })

  it('parses project resource URNs and ignores unsupported types', () => {
    expect(parseUrn('do:droplet:123')).toEqual({ type: 'droplet', providerId: '123' })
    expect(parseUrn('do:dbaas:abc-def')).toEqual({ type: 'database', providerId: 'abc-def' })
    expect(parseUrn('do:volume:x')).toBeNull()
    expect(parseUrn('do:droplet:../../x')).toBeNull()
  })
})

describe('metric math', () => {
  it('computes CPU % from cumulative per-mode counters', () => {
    const pts = cpuPercentFromModes([
      { metric: { mode: 'idle' }, values: [[0, '100'], [60, '160']] },
      { metric: { mode: 'user' }, values: [[0, '50'], [60, '80']] },
      { metric: { mode: 'system' }, values: [[0, '10'], [60, '20']] },
    ])
    // Δtotal = 100, Δidle = 60 → 40 %
    expect(pts).toEqual([{ metric: 'cpu_pct', ts: new Date(60_000), value: 40 }])
  })

  it('returns no points (not zero) when data is missing', () => {
    expect(cpuPercentFromModes([])).toEqual([])
    expect(ratioPercent('mem_pct', [], [{ metric: {}, values: [[0, '100']] }], true)).toEqual([])
  })
})
