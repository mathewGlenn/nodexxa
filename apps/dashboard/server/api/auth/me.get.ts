export default defineEventHandler(async (event) => {
  const user = await getSessionUser(event)
  if (!user) return { user: null, workspaces: [] }
  const memberships = await prisma.membership.findMany({
    where: { userId: user.id, disabledAt: null },
    include: { workspace: { select: { id: true, name: true } } },
    orderBy: { createdAt: 'asc' },
  })
  return {
    user: toSafeUser(user),
    workspaces: memberships.map(m => ({ id: m.workspace.id, name: m.workspace.name, role: m.role })),
  }
})
