export default defineEventHandler(async (event) => {
  const { user, workspaceId } = await requireMember(event, 'ADMIN')
  const id = idParam(event)
  const { count } = await prisma.enrollmentToken.deleteMany({ where: { id, workspaceId, usedAt: null } })
  if (!count) notFound('Enrollment token not found or already used')
  await audit({ workspaceId, actor: user, action: 'enrollment.revoked', targetType: 'enrollment', targetId: id })
  return { ok: true }
})
