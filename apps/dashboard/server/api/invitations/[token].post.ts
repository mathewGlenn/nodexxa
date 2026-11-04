/**
 * Accepts an invitation. New users set a name/password; existing users must be signed in
 * as the invited email address.
 */
export default defineEventHandler(async (event) => {
  await enforceRateLimit(`invite:ip:${clientIp(event)}`, 30, 900)
  const token = getRouterParam(event, 'token') ?? ''
  const body = await parseBody(event, acceptInvitationSchema)
  const inv = await prisma.invitation.findUnique({ where: { tokenHash: sha256(token) } })
  if (!inv || inv.acceptedAt || inv.expiresAt < new Date()) notFound('Invitation is invalid or expired')

  const existing = await prisma.user.findUnique({ where: { email: inv.email } })
  if (existing) {
    const current = await requireUser(event)
    if (current.id !== existing.id) throw createError({ statusCode: 403, statusMessage: 'Sign in as the invited user to accept' })
  }
  else if (!body.name || !body.password) {
    throw createError({ statusCode: 400, statusMessage: 'Name and password are required' })
  }
  const passwordHash = existing ? null : await hashPassword(body.password!)

  const userId = await prisma.$transaction(async (tx) => {
    // Atomic single-use claim.
    const claimed = await tx.invitation.updateMany({ where: { id: inv.id, acceptedAt: null, expiresAt: { gt: new Date() } }, data: { acceptedAt: new Date() } })
    if (!claimed.count) throw createError({ statusCode: 409, statusMessage: 'Invitation already used' })
    const user = existing ?? await tx.user.create({ data: { email: inv.email, name: body.name!, passwordHash: passwordHash! } })
    await tx.membership.upsert({
      where: { userId_workspaceId: { userId: user.id, workspaceId: inv.workspaceId } },
      create: { userId: user.id, workspaceId: inv.workspaceId, role: inv.role },
      update: { role: inv.role, disabledAt: null },
    })
    await audit({ workspaceId: inv.workspaceId, actor: user, action: 'invitation.accepted', targetType: 'invitation', targetId: inv.id }, tx)
    return user.id
  })
  if (!existing) await createSession(event, userId)
  return { workspaceId: inv.workspaceId }
})
