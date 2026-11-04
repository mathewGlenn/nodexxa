export default defineEventHandler(async (event) => {
  const { user, workspaceId } = await requireMember(event, 'ADMIN')
  const id = idParam(event)
  const { count } = await prisma.notificationChannel.deleteMany({ where: { id, workspaceId } })
  if (!count) notFound('Channel not found')
  await audit({ workspaceId, actor: user, action: 'channel.deleted', targetType: 'channel', targetId: id })
  return { ok: true }
})
