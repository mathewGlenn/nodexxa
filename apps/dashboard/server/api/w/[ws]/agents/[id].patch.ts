/** Rename an agent or explicitly link/unlink it to a discovered droplet (operator-confirmed mapping). */
export default defineEventHandler(async (event) => {
  const { user, workspaceId } = await requireMember(event, 'ADMIN')
  const id = idParam(event)
  const body = await parseBody(event, agentUpdateSchema)
  const agent = await prisma.agent.findFirst({ where: { id, workspaceId } })
  if (!agent) notFound('Agent not found')

  if (body.resourceId) {
    // The target must be a droplet in the SAME workspace; agent-supplied identifiers are never used.
    const droplet = await prisma.resource.findFirst({ where: { id: body.resourceId, workspaceId, type: 'droplet' }, select: { id: true } })
    if (!droplet) throw createError({ statusCode: 400, statusMessage: 'Droplet not found in this workspace' })
  }
  const linkChange = body.resourceId !== undefined && body.resourceId !== agent.resourceId
  const updated = await prisma.agent.update({
    where: { id },
    data: {
      displayName: body.displayName,
      ...(linkChange ? { resourceId: body.resourceId, linkedById: body.resourceId ? user.id : null, linkedAt: body.resourceId ? new Date() : null } : {}),
    },
  })
  await audit({
    workspaceId, actor: user, action: linkChange ? (body.resourceId ? 'agent.linked' : 'agent.unlinked') : 'agent.updated',
    targetType: 'agent', targetId: id, details: body,
  })
  return agentView(updated)
})
