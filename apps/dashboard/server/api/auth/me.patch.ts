export default defineEventHandler(async (event) => {
  const user = await requireUser(event)
  const body = await parseBody(event, profileSchema)
  const updated = await prisma.user.update({ where: { id: user.id }, data: body })
  if (body.theme) setCookie(event, 'nx-color-mode', body.theme, { path: '/', sameSite: 'lax', maxAge: 31536000 })
  return { user: toSafeUser(updated) }
})
