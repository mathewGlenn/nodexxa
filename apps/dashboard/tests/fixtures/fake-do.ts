/**
 * Fake DigitalOcean API v2 for CI/E2E/demo. No real cloud contact.
 * - Two teams whose droplets deliberately share provider IDs (cross-account collision test).
 * - Droplet list paginates (per_page forced to 2) via links.pages.next.
 * - Databases include `connection`/`users` credential fields and apps include env vars,
 *   so tests can prove sanitization drops them.
 * - Special tokens: LIMITED (no database/monitoring scope), RATELIMITED (429), anything unknown → 401.
 */
import { createServer, type Server } from 'node:http'

export const FAKE_TOKENS = {
  alpha: 'dop_v1_alpha000000000000000000000000000000000000000000000000000000000',
  beta: 'dop_v1_beta0000000000000000000000000000000000000000000000000000000000',
  limited: 'dop_v1_limited00000000000000000000000000000000000000000000000000000',
  ratelimited: 'dop_v1_ratelimited000000000000000000000000000000000000000000000000',
  alphaRotated: 'dop_v1_alpha111111111111111111111111111111111111111111111111111111111',
} as const

export const LEAK_MARKERS = ['SUPER_SECRET_DB_PASSWORD', 'APP_ENV_SECRET_VALUE']

const droplet = (id: number, name: string, ip: string, status = 'active') => ({
  id, name, status, memory: 1024, vcpus: 1, disk: 25, size_slug: 's-1vcpu-1gb', region: { slug: 'fra1', name: 'Frankfurt 1' },
  image: { distribution: 'Ubuntu', name: '24.04 (LTS) x64' }, tags: ['web', 'prod'], vpc_uuid: 'vpc-1', features: ['monitoring'],
  networks: { v4: [{ ip_address: ip, type: 'public' }, { ip_address: `10.0.0.${id % 250}`, type: 'private' }], v6: [] },
  created_at: '2025-01-01T00:00:00Z', kernel: null, next_backup_window: null,
})

function team(name: string, uuid: string, prefix: string) {
  return {
    account: { email: `${prefix}@example.test`, status: 'active', team: { uuid, name } },
    droplets: [droplet(1001, `${prefix}-web-1`, '203.0.113.10'), droplet(1002, `${prefix}-web-2`, '203.0.113.11'), droplet(1003, `${prefix}-worker`, '203.0.113.12', 'off')],
    apps: [{
      id: `${prefix}-app-uuid-0001`, spec: { name: `${prefix}-frontend`, services: [{ name: 'web', envs: [{ key: 'TOKEN', value: 'APP_ENV_SECRET_VALUE' }] }], workers: [{ name: 'queue' }] },
      region: { slug: 'ams' }, tier_slug: 'basic', live_url: `https://${prefix}-frontend.ondigitalocean.app`, created_at: '2025-02-01T00:00:00Z',
      active_deployment: { id: `${prefix}-dep-2`, phase: 'ACTIVE' }, last_deployment_active_at: '2025-03-01T00:00:00Z',
    }],
    deployments: [
      { id: `${prefix}-dep-2`, phase: 'ACTIVE', cause: 'commit abc123 pushed', progress: { success_steps: 6, total_steps: 6 }, created_at: '2025-03-01T00:00:00Z', updated_at: '2025-03-01T00:05:00Z' },
      { id: `${prefix}-dep-1`, phase: 'SUPERSEDED', cause: 'initial deploy', progress: { success_steps: 6, total_steps: 6 }, created_at: '2025-02-01T00:00:00Z', updated_at: '2025-02-01T00:05:00Z' },
    ],
    databases: [{
      id: `${prefix}-db-uuid-0001`, name: `${prefix}-pg`, engine: 'pg', version: '16', status: 'online', region: 'fra1', size: 'db-s-1vcpu-1gb', num_nodes: 1, tags: [],
      created_at: '2025-01-15T00:00:00Z', connection: { uri: 'postgres://doadmin:SUPER_SECRET_DB_PASSWORD@host:25060/db', password: 'SUPER_SECRET_DB_PASSWORD' },
      private_connection: { password: 'SUPER_SECRET_DB_PASSWORD' }, users: [{ name: 'doadmin', password: 'SUPER_SECRET_DB_PASSWORD' }],
    }],
    projects: [
      { id: `${prefix}-proj-prod`, name: 'Production', description: 'Customer-facing', purpose: 'Web Application', environment: 'Production', is_default: true },
      { id: `${prefix}-proj-ops`, name: 'Ops', description: '', purpose: 'Operational', environment: 'Staging', is_default: false },
    ],
    projectResources: {
      [`${prefix}-proj-prod`]: [{ urn: 'do:droplet:1001' }, { urn: 'do:droplet:1002' }, { urn: `do:app:${prefix}-app-uuid-0001` }, { urn: `do:dbaas:${prefix}-db-uuid-0001` }],
      // droplet 1001 is in two projects (many-to-many), plus an unsupported URN type that must be ignored
      [`${prefix}-proj-ops`]: [{ urn: 'do:droplet:1001' }, { urn: 'do:droplet:1003' }, { urn: 'do:volume:abc' }],
    } as Record<string, { urn: string }[]>,
  }
}

const TEAMS: Record<string, ReturnType<typeof team>> = {
  [FAKE_TOKENS.alpha]: team('Alpha Agency', 'team-uuid-alpha', 'alpha'),
  [FAKE_TOKENS.alphaRotated]: team('Alpha Agency', 'team-uuid-alpha', 'alpha'),
  [FAKE_TOKENS.beta]: team('Beta Client Co', 'team-uuid-beta', 'beta'),
  [FAKE_TOKENS.limited]: team('Limited Scope Ltd', 'team-uuid-limited', 'limited'),
}

function metricMatrix(metric: string, start: number, end: number) {
  const ts: number[] = []
  for (let t = start - (start % 60); t <= end; t += 300) ts.push(t)
  const series = (labels: Record<string, string>, f: (i: number) => number) => ({ metric: labels, values: ts.map((t, i) => [t, String(f(i))]) })
  switch (metric) {
    case 'cpu': return [series({ mode: 'idle' }, i => 1000 + i * 240), series({ mode: 'user' }, i => 200 + i * 45), series({ mode: 'system' }, i => 100 + i * 15)]
    case 'memory_total': return [series({}, () => 1024 * 1024 * 1024)]
    case 'memory_available': return [series({}, i => 512 * 1024 * 1024 - i * 1024 * 1024)]
    case 'filesystem_size': return [series({ mountpoint: '/', device: '/dev/vda1' }, () => 25e9), series({ mountpoint: '/boot', device: '/dev/vda15' }, () => 1e8)]
    case 'filesystem_free': return [series({ mountpoint: '/', device: '/dev/vda1' }, () => 10e9), series({ mountpoint: '/boot', device: '/dev/vda15' }, () => 9e7)]
    case 'load_1': return [series({}, i => 0.2 + (i % 3) * 0.1)]
    default: return []
  }
}

export interface FakeDo { url: string, server: Server, requests: { path: string, auth: string | undefined }[], close: () => Promise<void> }

export function startFakeDo(port = 0): Promise<FakeDo> {
  const requests: FakeDo['requests'] = []
  const server = createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://localhost')
    requests.push({ path: url.pathname, auth: req.headers.authorization })
    const send = (status: number, body: unknown, headers: Record<string, string> = {}) => {
      res.writeHead(status, { 'content-type': 'application/json', 'ratelimit-limit': '5000', 'ratelimit-remaining': '4990', 'ratelimit-reset': String(Math.floor(Date.now() / 1000) + 3600), ...headers })
      res.end(JSON.stringify(body))
    }
    if (req.method !== 'GET') return send(405, { id: 'method_not_allowed', message: 'Fake API is read-only' })
    const token = req.headers.authorization?.replace(/^Bearer /, '') ?? ''
    if (token === FAKE_TOKENS.ratelimited) return send(429, { id: 'too_many_requests', message: 'API Rate limit exceeded.' }, { 'ratelimit-remaining': '0' })
    const t = TEAMS[token]
    if (!t) return send(401, { id: 'unauthorized', message: 'Unable to authenticate you' })
    const limited = token === FAKE_TOKENS.limited
    const p = url.pathname
    const page = Number(url.searchParams.get('page') ?? 1)

    if (p === '/v2/account') return send(200, { account: t.account })
    if (p === '/v2/droplets') {
      const per = 2
      const items = t.droplets.slice((page - 1) * per, page * per)
      const next = page * per < t.droplets.length ? `${`http://${req.headers.host}`}/v2/droplets?page=${page + 1}&per_page=${per}` : undefined
      return send(200, { droplets: items, links: next ? { pages: { next } } : {}, meta: { total: t.droplets.length } })
    }
    if (p === '/v2/apps') return send(200, { apps: t.apps, links: {}, meta: { total: t.apps.length } })
    const dep = /^\/v2\/apps\/([^/]+)\/deployments$/.exec(p)
    if (dep) return send(200, { deployments: t.deployments, links: {}, meta: { total: 2 } })
    if (p === '/v2/databases') return limited ? send(403, { id: 'forbidden', message: 'You are not authorized' }) : send(200, { databases: t.databases })
    if (p === '/v2/projects') return send(200, { projects: t.projects, links: {}, meta: { total: t.projects.length } })
    const pr = /^\/v2\/projects\/([^/]+)\/resources$/.exec(p)
    if (pr) return send(200, { resources: t.projectResources[decodeURIComponent(pr[1]!)] ?? [], links: {}, meta: { total: 1 } })
    const m = /^\/v2\/monitoring\/metrics\/droplet\/(\w+)$/.exec(p)
    if (m) {
      if (limited) return send(403, { id: 'forbidden', message: 'You are not authorized' })
      const hostId = url.searchParams.get('host_id')
      // droplet 1003 is off: monitoring returns an empty result (no data, not zero)
      const result = hostId === '1003' ? [] : metricMatrix(m[1]!, Number(url.searchParams.get('start')), Number(url.searchParams.get('end')))
      return send(200, { status: 'success', data: { resultType: 'matrix', result } })
    }
    return send(404, { id: 'not_found', message: 'The resource you were accessing could not be found.' })
  })
  return new Promise((resolve) => {
    server.listen(port, '127.0.0.1', () => {
      const address = server.address()
      const url = `http://127.0.0.1:${typeof address === 'object' && address ? address.port : port}`
      resolve({ url, server, requests, close: () => new Promise(r => server.close(() => r())) })
    })
  })
}

// Allow `tsx tests/fixtures/fake-do.ts` for local demos.
if (process.argv[1]?.endsWith('fake-do.ts')) {
  startFakeDo(Number(process.env.PORT ?? 4010)).then(f => console.log(`fake DigitalOcean API on ${f.url}`))
}
