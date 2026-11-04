export default defineEventHandler(async (event) => {
  const { workspaceId } = await requireMember(event)
  const [connections, resources, agents, checks, incidents, workers] = await Promise.all([
    prisma.connection.findMany({ where: { workspaceId } }),
    prisma.resource.groupBy({ by: ['type', 'status'], where: { workspaceId, missingSince: null }, _count: true }),
    prisma.agent.findMany({ where: { workspaceId, status: 'ACTIVE' }, select: { status: true, lastSeenAt: true } }),
    prisma.check.findMany({ where: { workspaceId, enabled: true }, select: { lastStatus: true } }),
    prisma.incident.findMany({ where: { workspaceId, status: { not: 'RESOLVED' } }, orderBy: { openedAt: 'desc' }, take: 10, select: { id: true, title: true, severity: true, status: true, openedAt: true } }),
    prisma.workerHeartbeat.findMany(),
  ])
  const agentStates = agents.map(agentState)
  return {
    connections: connections.map(connectionView),
    resources: resources.map(r => ({ type: r.type, status: r.status, count: r._count })),
    agents: { online: agentStates.filter(s => s === 'online').length, stale: agentStates.filter(s => s === 'stale').length, neverSeen: agentStates.filter(s => s === 'never_seen').length },
    checks: { up: checks.filter(c => c.lastStatus === 'up').length, down: checks.filter(c => c.lastStatus === 'down').length, unknown: checks.filter(c => !c.lastStatus).length },
    incidents,
    worker: workers.map(w => ({ task: w.task, lastRunAt: w.lastRunAt, lastError: w.lastError, stale: Date.now() - w.lastRunAt.getTime() > 5 * 60_000 })),
  }
})
