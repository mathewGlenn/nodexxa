export default defineEventHandler(async (event) => {
  const { user, workspaceId } = await requireMember(event, 'ADMIN')
  const body = await parseBody(event, checkSchema)
  await assertCheckUrlAllowed(body.url)
  const count = await prisma.check.count({ where: { workspaceId } })
  if (count >= 500) throw createError({ statusCode: 400, statusMessage: 'Check limit reached for this workspace' })
  const check = await prisma.check.create({ data: { ...body, workspaceId, nextRunAt: new Date() }, omit: { leaseOwner: true, leaseUntil: true } })
  await audit({ workspaceId, actor: user, action: 'check.created', targetType: 'check', targetId: check.id, details: { name: body.name, url: body.url } })
  return check
})
