export default defineEventHandler(async (event) => {
  const { workspaceId } = await requireMember(event)
  const projects = await prisma.project.findMany({
    where: { workspaceId },
    orderBy: [{ missingSince: { sort: 'desc', nulls: 'first' } }, { name: 'asc' }],
    include: {
      connection: { select: { id: true, label: true, client: true } },
      resources: { select: { resource: { select: { id: true, type: true, name: true, status: true, missingSince: true } } } },
    },
  })
  return projects.map(p => ({
    id: p.id, name: p.name, description: p.description, purpose: p.purpose, environment: p.environment, isDefault: p.isDefault,
    lastSeenAt: p.lastSeenAt, missingSince: p.missingSince, connection: p.connection, resources: p.resources.map(x => x.resource),
  }))
})
