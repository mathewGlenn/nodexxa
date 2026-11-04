import type { Prisma } from '@prisma/client'
import { prisma } from './db'
import { env } from './env'
import { decryptSecret } from './crypto'
import {
  createDoClient, DoApiError, fetchDropletMetrics, normalizeApp, normalizeDatabase, normalizeDeployment, normalizeDroplet, parseUrn,
  type DoClient, type NormalizedResource,
} from './digitalocean'

export const SYNC_INTERVAL_MS = Number(process.env.NODEXXA_SYNC_INTERVAL_SEC ?? 300) * 1000
const MAX_METRIC_DROPLETS = 50
const MAX_DEPLOYMENT_APPS = 50

type Capability = 'ok' | 'forbidden' | 'error'

export function connectionClient(conn: { id: string, tokenCiphertext: string }, fetchImpl?: typeof fetch): DoClient {
  return createDoClient(decryptSecret(conn.tokenCiphertext, `connection:${conn.id}`), { baseUrl: env().DO_API_BASE_URL, fetchImpl })
}

/** Validates a token by reading the account; returns team identity. */
export async function verifyToken(client: DoClient) {
  const body = await client.get('/v2/account')
  const account = body?.account
  if (!account || typeof account !== 'object') throw new DoApiError('invalid', 'Malformed account response')
  return {
    teamUuid: typeof account.team?.uuid === 'string' ? account.team.uuid : null,
    teamName: typeof account.team?.name === 'string' ? account.team.name.slice(0, 120) : null,
    status: typeof account.status === 'string' ? account.status : null,
  }
}

/** Runs one listing; a missing scope only disables that resource type rather than failing the sync. */
async function list<T>(caps: Record<string, Capability>, key: string, fn: () => Promise<T[]>): Promise<T[] | null> {
  try {
    const items = await fn()
    caps[key] = 'ok'
    return items
  }
  catch (e) {
    if (e instanceof DoApiError && e.kind === 'forbidden') { caps[key] = 'forbidden'; return null }
    throw e
  }
}

/**
 * Full discovery + metrics for one connection. Lists that fail with a non-scope error abort the
 * sync before any write, so a failed sync never erases inventory (it is just marked stale).
 */
export async function syncConnection(connectionId: string, fetchImpl?: typeof fetch) {
  const conn = await prisma.connection.findUniqueOrThrow({ where: { id: connectionId } })
  const now = new Date()
  await prisma.connection.update({ where: { id: conn.id }, data: { lastSyncAttemptAt: now } })
  let client: DoClient | undefined
  try {
    client = connectionClient(conn, fetchImpl)
    const c = client
    const team = await verifyToken(c)
    const caps: Record<string, Capability> = {}
    const droplets = await list(caps, 'droplets', () => c.paginate<any>('/v2/droplets', 'droplets'))
    const apps = await list(caps, 'apps', () => c.paginate<any>('/v2/apps', 'apps'))
    const databases = await list(caps, 'databases', () => c.paginate<any>('/v2/databases', 'databases'))
    const projects = await list(caps, 'projects', () => c.paginate<any>('/v2/projects', 'projects'))
    const projectMembers = new Map<string, { type: NormalizedResource['type'], providerId: string }[]>()
    for (const p of projects ?? []) {
      if (typeof p?.id !== 'string') continue
      const items = await c.paginate<any>(`/v2/projects/${encodeURIComponent(p.id)}/resources`, 'resources')
      projectMembers.set(p.id, items.map(r => parseUrn(r?.urn)).filter(x => x !== null))
    }

    const lists: [NormalizedResource['type'], NormalizedResource[] | null][] = [
      ['droplet', droplets && droplets.map(normalizeDroplet).filter(x => x !== null)],
      ['app', apps && apps.map(normalizeApp).filter(x => x !== null)],
      ['database', databases && databases.map(normalizeDatabase).filter(x => x !== null)],
    ]

    // Deployments are fetched before the write transaction (network outside DB transactions).
    const deployments = new Map<string, ReturnType<typeof normalizeDeployment>[]>()
    for (const app of (lists[1]![1] ?? []).slice(0, MAX_DEPLOYMENT_APPS)) {
      const body = await c.get(`/v2/apps/${encodeURIComponent(app.providerId)}/deployments?per_page=20`).catch((e) => {
        if (e instanceof DoApiError && (e.kind === 'forbidden' || e.kind === 'not_found')) return null
        throw e
      })
      if (Array.isArray(body?.deployments)) deployments.set(app.providerId, body.deployments.map(normalizeDeployment))
    }

    await prisma.$transaction(async (tx) => {
      const idByKey = new Map<string, string>()
      for (const [type, items] of lists) {
        if (!items) continue // type not permitted: leave existing rows untouched
        for (const r of items) {
          const data = {
            name: r.name, status: r.status, region: r.region, size: r.size, tags: r.tags, publicIpv4: r.publicIpv4,
            privateIpv4: r.privateIpv4, version: r.version, url: r.url, providerCreatedAt: r.providerCreatedAt,
            details: r.details as Prisma.InputJsonValue, lastSeenAt: now, missingSince: null,
          }
          const row = await tx.resource.upsert({
            where: { connectionId_type_providerId: { connectionId: conn.id, type, providerId: r.providerId } },
            create: { ...data, workspaceId: conn.workspaceId, connectionId: conn.id, type, providerId: r.providerId },
            update: data,
            select: { id: true },
          })
          idByKey.set(`${type}:${r.providerId}`, row.id)
        }
        // Resources no longer listed are marked missing, not deleted, to preserve history.
        await tx.resource.updateMany({
          where: { connectionId: conn.id, type, missingSince: null, providerId: { notIn: items.map(i => i.providerId) } },
          data: { missingSince: now },
        })
      }
      for (const [appProviderId, deps] of deployments) {
        const resourceId = idByKey.get(`app:${appProviderId}`)
        if (!resourceId) continue
        for (const d of deps) {
          if (!d) continue
          await tx.appDeployment.upsert({
            where: { resourceId_providerId: { resourceId, providerId: d.providerId } },
            create: { resourceId, ...d },
            update: { phase: d.phase, cause: d.cause, progress: d.progress, updatedAt: d.updatedAt },
          })
        }
      }
      if (projects) {
        const seen: string[] = []
        for (const p of projects) {
          if (typeof p?.id !== 'string') continue
          seen.push(p.id)
          const data = {
            name: String(p.name ?? p.id).slice(0, 200), description: typeof p.description === 'string' ? p.description.slice(0, 500) : null,
            purpose: typeof p.purpose === 'string' ? p.purpose.slice(0, 200) : null, environment: typeof p.environment === 'string' ? p.environment.slice(0, 40) : null,
            isDefault: p.is_default === true, lastSeenAt: now, missingSince: null,
          }
          const project = await tx.project.upsert({
            where: { connectionId_providerId: { connectionId: conn.id, providerId: p.id } },
            create: { ...data, workspaceId: conn.workspaceId, connectionId: conn.id, providerId: p.id },
            update: data,
          })
          // Membership is many-to-many and rebuilt from the provider's view each sync.
          await tx.projectResource.deleteMany({ where: { projectId: project.id } })
          const memberIds = (projectMembers.get(p.id) ?? []).map(m => idByKey.get(`${m.type}:${m.providerId}`)).filter((x): x is string => !!x)
          if (memberIds.length) await tx.projectResource.createMany({ data: memberIds.map(resourceId => ({ projectId: project.id, resourceId })), skipDuplicates: true })
        }
        await tx.project.updateMany({ where: { connectionId: conn.id, missingSince: null, providerId: { notIn: seen } }, data: { missingSince: now } })
      }
    }, { timeout: 60_000 })

    caps.monitoring = await syncDropletMetrics(c, conn.workspaceId, conn.id, now)

    await prisma.connection.update({
      where: { id: conn.id },
      data: {
        status: 'OK', lastError: null, lastSyncAt: now, consecutiveFailures: 0, teamUuid: team.teamUuid, teamName: team.teamName,
        capabilities: caps, rateLimitRemaining: c.rate.remaining ?? null, rateLimitResetAt: c.rate.resetAt ?? null,
        nextSyncAt: new Date(Date.now() + SYNC_INTERVAL_MS),
      },
    })
    return { ok: true as const }
  }
  catch (e) {
    const err = e instanceof DoApiError ? e : new DoApiError('transient', 'Unexpected sync failure')
    if (!(e instanceof DoApiError)) console.error('[sync] unexpected error for connection', conn.id, (e as Error)?.name)
    const failures = conn.consecutiveFailures + 1
    const backoff = Math.min(SYNC_INTERVAL_MS * 2 ** Math.min(failures, 6), 6 * 3600_000)
    const status = err.kind === 'auth' ? 'AUTH_ERROR' : err.kind === 'rate_limited' ? 'RATE_LIMITED' : 'ERROR'
    const nextSyncAt = err.kind === 'rate_limited' && err.resetAt ? new Date(Math.max(err.resetAt.getTime(), Date.now() + 30_000)) : new Date(Date.now() + backoff)
    await prisma.connection.update({
      where: { id: conn.id },
      data: {
        status, lastError: err.message.slice(0, 300), consecutiveFailures: failures, nextSyncAt,
        rateLimitRemaining: client?.rate.remaining ?? undefined, rateLimitResetAt: client?.rate.resetAt ?? undefined,
      },
    })
    return { ok: false as const, error: err.message, kind: err.kind }
  }
}

/** Pulls the last 30 min of droplet metrics. Missing data is recorded as unavailable, never as zero. */
async function syncDropletMetrics(client: DoClient, workspaceId: string, connectionId: string, now: Date): Promise<Capability> {
  const droplets = await prisma.resource.findMany({
    where: { connectionId, type: 'droplet', missingSince: null },
    select: { id: true, providerId: true },
    take: MAX_METRIC_DROPLETS,
    orderBy: { name: 'asc' },
  })
  let capability: Capability = 'ok'
  for (const d of droplets) {
    let status = 'ok'
    try {
      const points = await fetchDropletMetrics(client, d.providerId, new Date(now.getTime() - 30 * 60_000), now)
      if (!points.length) status = 'no_data'
      await prisma.metricSample.createMany({
        data: points.map(p => ({ workspaceId, seriesKey: `resource:${d.id}`, metric: p.metric, ts: p.ts, value: p.value, source: 'digitalocean' })),
        skipDuplicates: true,
      })
    }
    catch (e) {
      if (!(e instanceof DoApiError) || e.kind === 'rate_limited' || e.kind === 'auth') throw e
      status = e.kind === 'forbidden' ? 'forbidden' : 'error'
    }
    if (status === 'forbidden') capability = 'forbidden'
    await prisma.resource.update({ where: { id: d.id }, data: { metricsStatus: status, metricsAt: now } })
    if (status === 'forbidden') {
      // Scope missing: mark the rest unavailable without spending API calls.
      await prisma.resource.updateMany({ where: { connectionId, type: 'droplet', missingSince: null }, data: { metricsStatus: 'forbidden', metricsAt: now } })
      break
    }
  }
  return capability
}
