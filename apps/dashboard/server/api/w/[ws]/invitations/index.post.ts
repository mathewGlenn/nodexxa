export default defineEventHandler(async (event) => {
  const { user, membership, workspaceId } = await requireMember(event, 'ADMIN')
  const { email, role } = await parseBody(event, invitationSchema)
  if (role === 'OWNER' && membership.role !== 'OWNER') throw createError({ statusCode: 403, statusMessage: 'Only owners can invite owners' })
  const existing = await prisma.membership.findFirst({ where: { workspaceId, user: { email } } })
  if (existing) throw createError({ statusCode: 409, statusMessage: 'User is already a member' })

  const token = randomToken()
  const invitation = await prisma.invitation.create({
    data: { workspaceId, email, role, tokenHash: sha256(token), expiresAt: new Date(Date.now() + 72 * 3600_000), createdById: user.id },
  })
  await audit({ workspaceId, actor: user, action: 'invitation.created', targetType: 'invitation', targetId: invitation.id, details: { email, role } })
  // The raw token is returned exactly once; only its hash is stored.
  return { id: invitation.id, email, role, expiresAt: invitation.expiresAt, path: `/invite/${token}` }
})
