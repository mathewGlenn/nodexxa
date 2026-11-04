export default defineEventHandler(async (event) => {
  const { workspaceId } = await requireMember(event)
  const agents = await prisma.agent.findMany({
    where: { workspaceId },
    orderBy: [{ status: 'asc' }, { hostname: 'asc' }],
    include: {
      resource: { select: { id: true, name: true, connection: { select: { label: true } } } },
      processes: { select: { kind: true, status: true, health: true } },
    },
  })
  return agents.map(a => ({
    ...agentView(a),
    resource: a.resource,
    processSummary: {
      total: a.processes.length,
      unhealthy: a.processes.filter(p => !isProcessHealthy(p)).length,
    },
  }))
})
