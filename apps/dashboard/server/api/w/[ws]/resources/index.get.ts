import { z } from 'zod'
import type { Prisma } from '@prisma/client'

const querySchema = paginationSchema.extend({
  type: z.enum(['droplet', 'app', 'database']).optional(),
  connectionId: z.string().uuid().optional(),
  projectId: z.string().uuid().optional(),
  region: z.string().max(40).optional(),
  client: z.string().max(80).optional(),
  q: z.string().max(100).optional(),
  includeMissing: z.enum(['true', 'false']).optional(),
})

export default defineEventHandler(async (event) => {
  const { workspaceId } = await requireMember(event)
  const q = parseQuery(event, querySchema)
  const where: Prisma.ResourceWhereInput = {
    workspaceId,
    type: q.type,
    connectionId: q.connectionId,
    region: q.region || undefined,
    connection: q.client ? { client: q.client } : undefined,
    projects: q.projectId ? { some: { projectId: q.projectId } } : undefined,
    missingSince: q.includeMissing === 'true' ? undefined : null,
    OR: q.q
      ? [{ name: { contains: q.q, mode: 'insensitive' } }, { tags: { has: q.q } }, { publicIpv4: q.q }, { privateIpv4: q.q }]
      : undefined,
  }
  const [total, items] = await Promise.all([
    prisma.resource.count({ where }),
    prisma.resource.findMany({
      where,
      orderBy: [{ type: 'asc' }, { name: 'asc' }],
      skip: (q.page - 1) * q.pageSize,
      take: q.pageSize,
      include: {
        connection: { select: { id: true, label: true, client: true, status: true, lastSyncAt: true } },
        projects: { select: { project: { select: { id: true, name: true, environment: true } } } },
        agents: { select: { id: true, hostname: true, status: true, lastSeenAt: true } },
      },
    }),
  ])
  return {
    total,
    items: items.map(r => ({
      id: r.id, type: r.type, providerId: r.providerId, name: r.name, status: r.status, region: r.region, size: r.size, tags: r.tags,
      publicIpv4: r.publicIpv4, privateIpv4: r.privateIpv4, version: r.version, url: r.url, lastSeenAt: r.lastSeenAt, missingSince: r.missingSince,
      metricsStatus: r.metricsStatus, connection: r.connection, projects: r.projects.map(p => p.project),
      agents: r.agents.map(a => ({ id: a.id, hostname: a.hostname, state: agentState(a) })),
    })),
  }
})
