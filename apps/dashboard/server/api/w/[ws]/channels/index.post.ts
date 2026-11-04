export default defineEventHandler(async (event) => {
  const { user, workspaceId } = await requireMember(event, 'ADMIN')
  const body = await parseBody(event, channelSchema)
  const channel = await prisma.notificationChannel.create({ data: { ...body, workspaceId } })
  await audit({ workspaceId, actor: user, action: 'channel.created', targetType: 'channel', targetId: channel.id, details: body })
  return channel
})
