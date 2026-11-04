export default defineEventHandler(async (event) => {
  const { workspaceId } = await requireMember(event)
  const procs = await prisma.agentProcess.findMany({
    where: { agent: { workspaceId, status: 'ACTIVE' } },
    include: { agent: { select: { id: true, hostname: true, displayName: true, status: true, lastSeenAt: true } } },
    orderBy: [{ kind: 'asc' }, { name: 'asc' }],
    take: 2000,
  })
  return procs.map(p => ({
    id: p.id, kind: p.kind, name: p.name, status: p.status, health: p.health, restarts: p.restarts, lastSeenAt: p.lastSeenAt,
    healthy: isProcessHealthy(p), agentId: p.agent.id, host: p.agent.displayName ?? p.agent.hostname, agentState: agentState(p.agent),
  }))
})
