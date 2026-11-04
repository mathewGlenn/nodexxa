export default defineEventHandler(async (event) => {
  const user = await requireUser(event)
  const { name } = await parseBody(event, workspaceSchema)
  // Only existing workspace owners/admins may create further workspaces (no self-service sign-up).
  const privileged = await prisma.membership.count({ where: { userId: user.id, disabledAt: null, role: { in: ['OWNER', 'ADMIN'] } } })
  if (!privileged) throw createError({ statusCode: 403, statusMessage: 'Only owners or admins can create workspaces' })

  const workspace = await prisma.$transaction(async (tx) => {
    const ws = await tx.workspace.create({ data: { name, memberships: { create: { userId: user.id, role: 'OWNER' } } } })
    await tx.alertRule.createMany({ data: defaultAlertRules(ws.id) })
    await audit({ workspaceId: ws.id, actor: user, action: 'workspace.created', targetType: 'workspace', targetId: ws.id }, tx)
    return ws
  })
  return { id: workspace.id, name: workspace.name, role: 'OWNER' }
})
