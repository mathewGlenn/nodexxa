import { z } from 'zod'

const querySchema = paginationSchema.extend({ status: z.enum(['OPEN', 'ACKNOWLEDGED', 'RESOLVED', 'active']).optional() })

export default defineEventHandler(async (event) => {
  const { workspaceId } = await requireMember(event)
  const q = parseQuery(event, querySchema)
  const where = {
    workspaceId,
    status: q.status === 'active' ? { not: 'RESOLVED' as const } : q.status,
  }
  const [total, items] = await Promise.all([
    prisma.incident.count({ where }),
    prisma.incident.findMany({
      where,
      orderBy: [{ resolvedAt: { sort: 'desc', nulls: 'first' } }, { openedAt: 'desc' }],
      skip: (q.page - 1) * q.pageSize,
      take: q.pageSize,
      include: { rule: { select: { name: true, type: true } }, deliveries: { select: { event: true, status: true, lastError: true, channel: { select: { name: true, type: true } } } } },
    }),
  ])
  return { total, items }
})
