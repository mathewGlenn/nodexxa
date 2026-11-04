export default defineEventHandler(async (event) => {
  const { workspaceId } = await requireMember(event)
  const connections = await prisma.connection.findMany({ where: { workspaceId }, orderBy: { label: 'asc' } })
  const counts = await prisma.resource.groupBy({ by: ['connectionId', 'type'], where: { workspaceId, missingSince: null }, _count: true })
  return connections.map(c => ({
    ...connectionView(c),
    resourceCounts: Object.fromEntries(counts.filter(x => x.connectionId === c.id).map(x => [x.type, x._count])),
  }))
})
