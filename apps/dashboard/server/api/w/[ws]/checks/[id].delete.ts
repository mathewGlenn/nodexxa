export default defineEventHandler(async (event) => {
  const { user, workspaceId } = await requireMember(event, 'ADMIN')
  const id = idParam(event)
  const { count } = await prisma.check.deleteMany({ where: { id, workspaceId } })
  if (!count) notFound('Check not found')
  await audit({ workspaceId, actor: user, action: 'check.deleted', targetType: 'check', targetId: id })
  return { ok: true }
})
