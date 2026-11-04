export default defineEventHandler(async (event) => {
  const { workspaceId } = await requireMember(event)
  const id = idParam(event)
  const agent = await prisma.agent.findFirst({
    where: { id, workspaceId },
    include: {
      resource: { select: { id: true, name: true, providerId: true, connection: { select: { id: true, label: true } } } },
      processes: { orderBy: [{ kind: 'asc' }, { name: 'asc' }] },
    },
  })
  if (!agent) notFound('Agent not found')
  const [series, suggestions] = await Promise.all([
    getSeries(workspaceId, `agent:${id}`, new Date(Date.now() - 24 * 3600_000)),
    // Name match is only a hint shown to operators; linking always requires explicit confirmation.
    agent.resourceId
      ? []
      : prisma.resource.findMany({
          where: { workspaceId, type: 'droplet', missingSince: null, name: { equals: agent.hostname, mode: 'insensitive' } },
          select: { id: true, name: true, region: true, connection: { select: { label: true } } },
          take: 5,
        }),
  ])
  return {
    ...agentView(agent),
    resource: agent.resource,
    processes: agent.processes.map(p => ({ id: p.id, kind: p.kind, name: p.name, status: p.status, health: p.health, restarts: p.restarts, details: p.details, lastSeenAt: p.lastSeenAt, healthy: isProcessHealthy(p) })),
    series,
    linkSuggestions: suggestions,
  }
})
