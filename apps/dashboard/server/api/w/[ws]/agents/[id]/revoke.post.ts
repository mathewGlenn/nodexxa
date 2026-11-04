/** Revocation takes effect immediately: authenticateAgent rejects any non-ACTIVE agent. */
export default defineEventHandler(async (event) => {
  const { user, workspaceId } = await requireMember(event, 'ADMIN')
  const id = idParam(event)
  const { count } = await prisma.agent.updateMany({ where: { id, workspaceId, status: 'ACTIVE' }, data: { status: 'REVOKED', revokedAt: new Date() } })
  if (!count) notFound('Active agent not found')
  await audit({ workspaceId, actor: user, action: 'agent.revoked', targetType: 'agent', targetId: id })
  return { ok: true }
})
