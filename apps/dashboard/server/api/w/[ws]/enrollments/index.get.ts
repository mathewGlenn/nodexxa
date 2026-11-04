export default defineEventHandler(async (event) => {
  const { workspaceId } = await requireMember(event, 'ADMIN')
  return prisma.enrollmentToken.findMany({
    where: { workspaceId, createdAt: { gt: new Date(Date.now() - 7 * 86400_000) } },
    orderBy: { createdAt: 'desc' },
    select: { id: true, label: true, expiresAt: true, usedAt: true, agentId: true, createdAt: true },
  })
})
