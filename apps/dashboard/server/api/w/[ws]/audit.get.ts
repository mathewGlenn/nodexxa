export default defineEventHandler(async (event) => {
  const { workspaceId } = await requireMember(event, 'ADMIN')
  const q = parseQuery(event, paginationSchema)
  const [total, items] = await Promise.all([
    prisma.auditLog.count({ where: { workspaceId } }),
    prisma.auditLog.findMany({ where: { workspaceId }, orderBy: { createdAt: 'desc' }, skip: (q.page - 1) * q.pageSize, take: q.pageSize }),
  ])
  return { total, items }
})
