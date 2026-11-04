export default defineEventHandler(async (event) => {
  const { workspaceId } = await requireMember(event)
  const id = idParam(event)
  const conn = await prisma.connection.findFirst({ where: { id, workspaceId } })
  if (!conn) notFound('Connection not found')
  const [counts, history] = await Promise.all([
    prisma.resource.groupBy({ by: ['type'], where: { connectionId: id, missingSince: null }, _count: true }),
    prisma.auditLog.findMany({
      where: { workspaceId, targetType: 'connection', targetId: id },
      orderBy: { createdAt: 'desc' },
      take: 50,
      select: { id: true, action: true, actorLabel: true, createdAt: true, details: true },
    }),
  ])
  return { ...connectionView(conn), resourceCounts: Object.fromEntries(counts.map(c => [c.type, c._count])), history }
})
