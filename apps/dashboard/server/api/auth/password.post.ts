export default defineEventHandler(async (event) => {
  const user = await requireUser(event)
  const { currentPassword, newPassword } = await parseBody(event, changePasswordSchema)
  await enforceRateLimit(`password:${user.id}`, 10, 900)
  if (!(await verifyPassword(currentPassword, user.passwordHash))) {
    throw createError({ statusCode: 400, statusMessage: 'Current password is incorrect' })
  }
  await prisma.$transaction([
    prisma.user.update({ where: { id: user.id }, data: { passwordHash: await hashPassword(newPassword) } }),
    prisma.session.deleteMany({ where: { userId: user.id } }),
  ])
  await audit({ actor: user, action: 'auth.password_changed' })
  await createSession(event, user.id)
  return { ok: true }
})
