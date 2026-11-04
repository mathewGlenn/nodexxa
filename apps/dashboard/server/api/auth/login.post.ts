export default defineEventHandler(async (event) => {
  const { email, password } = await parseBody(event, loginSchema)
  // Throttle per source IP and per target account to slow credential stuffing and brute force.
  await enforceRateLimit(`login:ip:${clientIp(event)}`, env().NODEXXA_RATE_LIMIT_LOGIN_IP, 900)
  await enforceRateLimit(`login:email:${email}`, 10, 900)

  const user = await prisma.user.findUnique({ where: { email } })
  const valid = await verifyPassword(password, user?.passwordHash ?? await getDummyHash())
  if (!user || !valid || user.disabledAt) {
    throw createError({ statusCode: 401, statusMessage: 'Invalid email or password' })
  }
  await createSession(event, user.id)
  setCookie(event, 'nx-color-mode', user.theme, { path: '/', sameSite: 'lax', maxAge: 31536000 })
  await audit({ actor: user, action: 'auth.login' })
  return { user: toSafeUser(user) }
})
