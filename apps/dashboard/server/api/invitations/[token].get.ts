export default defineEventHandler(async (event) => {
  await enforceRateLimit(`invite:ip:${clientIp(event)}`, 30, 900)
  const token = getRouterParam(event, 'token') ?? ''
  const inv = await prisma.invitation.findUnique({ where: { tokenHash: sha256(token) }, include: { workspace: { select: { name: true } } } })
  if (!inv || inv.acceptedAt || inv.expiresAt < new Date()) notFound('Invitation is invalid or expired')
  const userExists = !!(await prisma.user.findUnique({ where: { email: inv.email }, select: { id: true } }))
  return { email: inv.email, role: inv.role, workspace: inv.workspace.name, userExists }
})
