export default defineEventHandler(async (event) => {
  const { user, workspaceId } = await requireMember(event, 'ADMIN')
  const id = idParam(event)
  const { count } = await prisma.invitation.deleteMany({ where: { id, workspaceId, acceptedAt: null } })
  if (!count) notFound('Invitation not found')
  await audit({ workspaceId, actor: user, action: 'invitation.revoked', targetType: 'invitation', targetId: id })
  return { ok: true }
})
