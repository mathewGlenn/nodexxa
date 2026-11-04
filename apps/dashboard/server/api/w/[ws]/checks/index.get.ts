export default defineEventHandler(async (event) => {
  const { workspaceId } = await requireMember(event)
  return prisma.check.findMany({
    where: { workspaceId },
    orderBy: { name: 'asc' },
    omit: { leaseOwner: true, leaseUntil: true },
  })
})
