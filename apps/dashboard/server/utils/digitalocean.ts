/**
 * Minimal read-only DigitalOcean API v2 client.
 * Only GET requests are ever issued. Endpoints and required token scopes are documented in
 * docs/modules/02-discovery-monitoring.md ("Implemented endpoints").
 */
export type DoErrorKind = 'auth' | 'forbidden' | 'rate_limited' | 'not_found' | 'transient' | 'invalid'

export class DoApiError extends Error {
  constructor(public kind: DoErrorKind, message: string, public status?: number, public resetAt?: Date) {
    super(message)
    this.name = 'DoApiError'
  }
}

export interface RateInfo { remaining?: number, resetAt?: Date }

interface ClientOptions { baseUrl: string, fetchImpl?: typeof fetch, timeoutMs?: number, maxPages?: number, retries?: number }

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))

export function createDoClient(token: string, opts: ClientOptions) {
  const base = new URL(opts.baseUrl)
  const doFetch = opts.fetchImpl ?? fetch
  const rate: RateInfo = {}

  async function get(pathOrUrl: string): Promise<any> {
    const url = new URL(pathOrUrl, base)
    // Never send the token anywhere but the configured API origin (pagination links included).
    if (url.origin !== base.origin) throw new DoApiError('invalid', 'Refusing to follow a link outside the DigitalOcean API origin')
    const attempts = (opts.retries ?? 2) + 1
    for (let attempt = 1; ; attempt++) {
      let res: Response
      try {
        res = await doFetch(url, {
          method: 'GET',
          headers: { 'Authorization': `Bearer ${token}`, 'Accept': 'application/json', 'User-Agent': 'nodexxa/1 (read-only monitoring)' },
          signal: AbortSignal.timeout(opts.timeoutMs ?? 20_000),
          redirect: 'error',
        })
      }
      catch (e) {
        if (attempt < attempts) { await sleep(500 * 2 ** attempt); continue }
        throw new DoApiError('transient', `DigitalOcean API unreachable (${(e as Error).name})`)
      }
      const remaining = res.headers.get('ratelimit-remaining')
      const reset = res.headers.get('ratelimit-reset')
      if (remaining !== null) rate.remaining = Number(remaining)
      if (reset !== null && Number.isFinite(Number(reset))) rate.resetAt = new Date(Number(reset) * 1000)

      if (res.ok) return res.json()
      // Only the provider's short error id is surfaced; bodies are never logged verbatim.
      const errId = await res.json().then((b: any) => (typeof b?.id === 'string' ? b.id.slice(0, 60) : ''), () => '')
      const suffix = errId ? ` (${errId})` : ''
      if (res.status === 401) throw new DoApiError('auth', `Token rejected by DigitalOcean${suffix}`, 401)
      if (res.status === 403) throw new DoApiError('forbidden', `Token lacks the required read scope${suffix}`, 403)
      if (res.status === 404) throw new DoApiError('not_found', `Not found${suffix}`, 404)
      if (res.status === 429) throw new DoApiError('rate_limited', 'DigitalOcean rate limit reached', 429, rate.resetAt ?? new Date(Date.now() + 60_000))
      if (res.status >= 500 && attempt < attempts) { await sleep(500 * 2 ** attempt); continue }
      throw new DoApiError(res.status >= 500 ? 'transient' : 'invalid', `DigitalOcean API error ${res.status}${suffix}`, res.status)
    }
  }

  async function paginate<T>(path: string, key: string): Promise<T[]> {
    const items: T[] = []
    let next: string | undefined = `${path}${path.includes('?') ? '&' : '?'}per_page=200`
    for (let page = 0; next; page++) {
      if (page >= (opts.maxPages ?? 50)) throw new DoApiError('invalid', `Pagination limit exceeded for ${key}`)
      const body: any = await get(next)
      const list = body?.[key]
      if (!Array.isArray(list)) throw new DoApiError('invalid', `Malformed response: missing "${key}" list`)
      items.push(...list)
      next = typeof body?.links?.pages?.next === 'string' ? body.links.pages.next : undefined
    }
    return items
  }

  return { get, paginate, rate }
}

export type DoClient = ReturnType<typeof createDoClient>

// ---------- Sanitizers: allow-list provider fields; never keep secrets ----------

const str = (v: unknown, max = 200) => (typeof v === 'string' && v.length ? v.slice(0, max) : null)
const strArray = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string').slice(0, 100).map(s => s.slice(0, 100)) : [])
const date = (v: unknown) => { const d = typeof v === 'string' ? new Date(v) : null; return d && !Number.isNaN(d.getTime()) ? d : null }

export interface NormalizedResource {
  type: 'droplet' | 'app' | 'database'
  providerId: string
  name: string
  status: string | null
  region: string | null
  size: string | null
  tags: string[]
  publicIpv4: string | null
  privateIpv4: string | null
  version: string | null
  url: string | null
  providerCreatedAt: Date | null
  details: Record<string, unknown>
}

export function normalizeDroplet(d: any): NormalizedResource | null {
  if (d === null || typeof d !== 'object' || (typeof d.id !== 'number' && typeof d.id !== 'string')) return null
  const v4: any[] = Array.isArray(d.networks?.v4) ? d.networks.v4 : []
  return {
    type: 'droplet',
    providerId: String(d.id),
    name: str(d.name) ?? String(d.id),
    status: str(d.status, 40),
    region: str(d.region?.slug, 40),
    size: str(d.size_slug, 60),
    tags: strArray(d.tags),
    publicIpv4: str(v4.find(n => n?.type === 'public')?.ip_address, 45),
    privateIpv4: str(v4.find(n => n?.type === 'private')?.ip_address, 45),
    version: null,
    url: null,
    providerCreatedAt: date(d.created_at),
    details: {
      vcpus: typeof d.vcpus === 'number' ? d.vcpus : null,
      memoryMb: typeof d.memory === 'number' ? d.memory : null,
      diskGb: typeof d.disk === 'number' ? d.disk : null,
      image: [str(d.image?.distribution, 60), str(d.image?.name, 100)].filter(Boolean).join(' ') || null,
      vpcUuid: str(d.vpc_uuid, 60),
      features: strArray(d.features),
    },
  }
}

const APP_COMPONENT_KINDS = ['services', 'workers', 'static_sites', 'jobs', 'functions'] as const

export function normalizeApp(a: any): NormalizedResource | null {
  if (a === null || typeof a !== 'object' || typeof a.id !== 'string') return null
  const spec = a.spec ?? {}
  // Only component names/kinds are kept — app specs carry env vars that may hold secrets.
  const components = APP_COMPONENT_KINDS.flatMap(kind => (Array.isArray(spec[kind]) ? spec[kind] : []).map((c: any) => ({ kind, name: str(c?.name, 100) })))
  const active = a.active_deployment
  return {
    type: 'app',
    providerId: a.id,
    name: str(spec.name) ?? a.id,
    status: str(active?.phase, 40) ?? (a.in_progress_deployment ? 'DEPLOYING' : null),
    region: str(a.region?.slug, 40),
    size: str(a.tier_slug, 60),
    tags: [],
    publicIpv4: null,
    privateIpv4: null,
    version: str(active?.id, 60),
    url: str(a.live_url, 300),
    providerCreatedAt: date(a.created_at),
    details: {
      components: components.slice(0, 50),
      lastDeploymentActiveAt: str(a.last_deployment_active_at, 40),
      inProgressDeployment: str(a.in_progress_deployment?.id, 60),
    },
  }
}

export function normalizeDatabase(d: any): NormalizedResource | null {
  if (d === null || typeof d !== 'object' || typeof d.id !== 'string') return null
  // connection / private_connection / users contain credentials and are deliberately dropped.
  return {
    type: 'database',
    providerId: d.id,
    name: str(d.name) ?? d.id,
    status: str(d.status, 40),
    region: str(d.region, 40),
    size: str(d.size, 60),
    tags: strArray(d.tags),
    publicIpv4: null,
    privateIpv4: null,
    version: [str(d.engine, 20), str(d.version, 20)].filter(Boolean).join(' ') || null,
    url: null,
    providerCreatedAt: date(d.created_at),
    details: { engine: str(d.engine, 20), numNodes: typeof d.num_nodes === 'number' ? d.num_nodes : null },
  }
}

export interface NormalizedDeployment { providerId: string, phase: string, cause: string | null, progress: string | null, createdAt: Date, updatedAt: Date | null }

export function normalizeDeployment(d: any): NormalizedDeployment | null {
  if (!d || typeof d.id !== 'string') return null
  const created = date(d.created_at)
  if (!created) return null
  const p = d.progress
  return {
    providerId: d.id,
    phase: str(d.phase, 40) ?? 'UNKNOWN',
    cause: str(d.cause, 300),
    progress: p && typeof p.success_steps === 'number' && typeof p.total_steps === 'number' ? `${p.success_steps}/${p.total_steps}` : null,
    createdAt: created,
    updatedAt: date(d.updated_at),
  }
}

const URN_TYPES: Record<string, NormalizedResource['type']> = { droplet: 'droplet', app: 'app', dbaas: 'database' }

/** Parses project resource URNs such as "do:droplet:123", "do:app:<uuid>", "do:dbaas:<uuid>". */
export function parseUrn(urn: unknown): { type: NormalizedResource['type'], providerId: string } | null {
  if (typeof urn !== 'string') return null
  const m = /^do:([a-z]+):([\w-]{1,100})$/.exec(urn)
  const type = m ? URN_TYPES[m[1]!] : undefined
  return m && type ? { type, providerId: m[2]! } : null
}

// ---------- Monitoring (Prometheus-style matrix responses) ----------

type Series = { metric: Record<string, string>, values: [number, string][] }

function matrix(body: any): Series[] {
  const result = body?.data?.result
  if (!Array.isArray(result)) throw new DoApiError('invalid', 'Malformed monitoring response')
  return result.filter((s: any) => s && Array.isArray(s.values))
}

const num = (v: unknown) => { const n = Number(v); return Number.isFinite(n) ? n : null }

/** Sums all series per timestamp. */
function sumByTs(series: Series[]): Map<number, number> {
  const out = new Map<number, number>()
  for (const s of series) for (const [ts, v] of s.values) { const n = num(v); if (n !== null) out.set(ts, (out.get(ts) ?? 0) + n) }
  return out
}

export interface MetricPoint { metric: string, ts: Date, value: number }

/** CPU % from cumulative per-mode counters: 100 * (1 - Δidle / Δtotal) between consecutive points. */
export function cpuPercentFromModes(series: Series[]): MetricPoint[] {
  const total = sumByTs(series)
  const idle = sumByTs(series.filter(s => s.metric?.mode === 'idle'))
  const ts = [...total.keys()].sort((a, b) => a - b)
  const points: MetricPoint[] = []
  for (let i = 1; i < ts.length; i++) {
    const dt = total.get(ts[i]!)! - total.get(ts[i - 1]!)!
    const di = (idle.get(ts[i]!) ?? 0) - (idle.get(ts[i - 1]!) ?? 0)
    if (dt > 0 && di >= 0 && di <= dt) points.push({ metric: 'cpu_pct', ts: new Date(ts[i]! * 1000), value: round(100 * (1 - di / dt)) })
  }
  return points
}

export function ratioPercent(metric: string, usedOrFree: Series[], total: Series[], freeMeansAvailable: boolean): MetricPoint[] {
  const a = sumByTs(usedOrFree)
  const t = sumByTs(total)
  const points: MetricPoint[] = []
  for (const [ts, tot] of t) {
    const v = a.get(ts)
    if (v === undefined || tot <= 0) continue
    const pct = freeMeansAvailable ? 100 * (1 - v / tot) : 100 * (v / tot)
    points.push({ metric, ts: new Date(ts * 1000), value: round(Math.min(100, Math.max(0, pct))) })
  }
  return points
}

const round = (n: number) => Math.round(n * 100) / 100

export async function fetchDropletMetrics(client: DoClient, hostId: string, start: Date, end: Date): Promise<MetricPoint[]> {
  const q = (m: string) => `/v2/monitoring/metrics/droplet/${m}?host_id=${encodeURIComponent(hostId)}&start=${Math.floor(start.getTime() / 1000)}&end=${Math.floor(end.getTime() / 1000)}`
  const [cpu, memTotal, memAvail, fsFree, fsSize, load1] = await Promise.all(
    ['cpu', 'memory_total', 'memory_available', 'filesystem_free', 'filesystem_size', 'load_1'].map(m => client.get(q(m)).then(matrix)),
  )
  const rootOnly = (s: Series[]) => { const r = s.filter(x => x.metric?.mountpoint === '/'); return r.length ? r : s }
  return [
    ...cpuPercentFromModes(cpu!),
    ...ratioPercent('mem_pct', memAvail!, memTotal!, true),
    ...ratioPercent('disk_pct', rootOnly(fsFree!), rootOnly(fsSize!), true),
    ...[...sumByTs(load1!)].map(([ts, v]) => ({ metric: 'load1', ts: new Date(ts * 1000), value: round(v) })),
  ]
}
