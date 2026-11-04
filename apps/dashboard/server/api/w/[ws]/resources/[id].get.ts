export default defineEventHandler(async (event) => {
  const { workspaceId } = await requireMember(event)
  const id = idParam(event)
  const r = await prisma.resource.findFirst({
    where: { id, workspaceId },
    include: {
      connection: { select: { id: true, label: true, client: true, status: true, lastSyncAt: true, teamName: true } },
      projects: { select: { project: { select: { id: true, name: true, environment: true } } } },
      deployments: { orderBy: { createdAt: 'desc' }, take: 20 },
      agents: true,
    },
  })
  if (!r) notFound('Resource not found')
  const series = r.type === 'droplet' ? await getSeries(workspaceId, `resource:${r.id}`, new Date(Date.now() - 24 * 3600_000)) : {}
  return {
    id: r.id, type: r.type, providerId: r.providerId, name: r.name, status: r.status, region: r.region, size: r.size, tags: r.tags,
    publicIpv4: r.publicIpv4, privateIpv4: r.privateIpv4, version: r.version, url: r.url, details: r.details,
    providerCreatedAt: r.providerCreatedAt, firstSeenAt: r.firstSeenAt, lastSeenAt: r.lastSeenAt, missingSince: r.missingSince,
    metricsStatus: r.metricsStatus, metricsAt: r.metricsAt, connection: r.connection, projects: r.projects.map(p => p.project),
    deployments: r.deployments.map(d => ({ id: d.id, providerId: d.providerId, phase: d.phase, cause: d.cause, progress: d.progress, createdAt: d.createdAt, updatedAt: d.updatedAt })),
    agents: r.agents.map(agentView),
    series,
  }
})
