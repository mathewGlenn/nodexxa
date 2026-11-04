export default defineEventHandler(async (event) => {
  const { workspaceId } = await requireMember(event)
  const channels = await prisma.notificationChannel.findMany({ where: { workspaceId }, orderBy: { name: 'asc' } })
  return { channels, connectors: connectorStatus() }
})
