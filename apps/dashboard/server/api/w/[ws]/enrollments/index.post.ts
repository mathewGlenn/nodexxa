export default defineEventHandler(async (event) => {
  const { user, workspaceId } = await requireMember(event, 'ADMIN')
  const { label, ttlMinutes } = await parseBody(event, enrollmentCreateSchema)
  await enforceRateLimit(`enrollment-create:${user.id}`, 30, 3600)
  const token = randomToken()
  const row = await prisma.enrollmentToken.create({
    data: { workspaceId, tokenHash: sha256(token), label: label || null, expiresAt: new Date(Date.now() + ttlMinutes * 60_000), createdById: user.id },
  })
  await audit({ workspaceId, actor: user, action: 'enrollment.created', targetType: 'enrollment', targetId: row.id, details: { label, ttlMinutes } })
  // Shown exactly once; only the hash is persisted.
  return { id: row.id, token, expiresAt: row.expiresAt, label: row.label }
})
