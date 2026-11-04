export default defineEventHandler(async (event) => {
  const { workspaceId, membership } = await requireMember(event)
  const members = await prisma.membership.findMany({
    where: { workspaceId },
    include: { user: { select: { id: true, email: true, name: true, disabledAt: true } } },
    orderBy: { createdAt: 'asc' },
  })
  const canManage = hasRole(membership.role, 'ADMIN')
  const invitations = canManage
    ? await prisma.invitation.findMany({
        where: { workspaceId, acceptedAt: null, expiresAt: { gt: new Date() } },
        select: { id: true, email: true, role: true, expiresAt: true, createdAt: true },
      })
    : []
  return {
    members: members.map(m => ({ id: m.id, role: m.role, disabled: !!m.disabledAt, createdAt: m.createdAt, user: m.user })),
    invitations,
  }
})
