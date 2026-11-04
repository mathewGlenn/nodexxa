export default defineEventHandler(async (event) => {
  const { workspaceId } = await requireMember(event)
  const id = idParam(event)
  const check = await prisma.check.findFirst({ where: { id, workspaceId }, omit: { leaseOwner: true, leaseUntil: true } })
  if (!check) notFound('Check not found')
  const results = await prisma.checkResult.findMany({
    where: { checkId: id, ts: { gte: new Date(Date.now() - 24 * 3600_000) } },
    orderBy: { ts: 'asc' },
    select: { ts: true, ok: true, httpStatus: true, latencyMs: true, error: true },
    take: 3000,
  })
  return { ...check, results }
})
