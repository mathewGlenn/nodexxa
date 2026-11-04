/** Requests a sync; the worker process performs it (HTTP handlers never run long provider calls). */
export default defineEventHandler(async (event) => {
  const { user, workspaceId } = await requireMember(event, 'ADMIN')
  const id = idParam(event)
  const { count } = await prisma.connection.updateMany({ where: { id, workspaceId, enabled: true }, data: { nextSyncAt: new Date() } })
  if (!count) notFound('Connection not found or disabled')
  await audit({ workspaceId, actor: user, action: 'connection.sync_requested', targetType: 'connection', targetId: id })
  return { ok: true }
})
