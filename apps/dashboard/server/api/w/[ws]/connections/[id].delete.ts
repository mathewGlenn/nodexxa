export default defineEventHandler(async (event) => {
  const { user, workspaceId } = await requireMember(event, 'ADMIN')
  const id = idParam(event)
  const conn = await prisma.connection.findFirst({ where: { id, workspaceId }, select: { id: true, label: true } })
  if (!conn) notFound('Connection not found')
  // Removes the encrypted token and the connection's discovered inventory.
  await prisma.connection.delete({ where: { id } })
  await audit({ workspaceId, actor: user, action: 'connection.deleted', targetType: 'connection', targetId: id, details: { label: conn.label } })
  return { ok: true }
})
