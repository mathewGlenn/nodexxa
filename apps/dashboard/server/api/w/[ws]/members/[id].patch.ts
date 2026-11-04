export default defineEventHandler(async (event) => {
  const { user, membership: actor, workspaceId } = await requireMember(event, 'ADMIN')
  const id = idParam(event)
  const body = await parseBody(event, memberUpdateSchema)
  const target = await prisma.membership.findFirst({ where: { id, workspaceId } })
  if (!target) notFound('Member not found')
  if (target.userId === user.id) throw createError({ statusCode: 400, statusMessage: 'You cannot change your own membership' })
  // Only owners may modify owners or grant the owner role.
  if ((target.role === 'OWNER' || body.role === 'OWNER') && actor.role !== 'OWNER') {
    throw createError({ statusCode: 403, statusMessage: 'Only owners can manage owners' })
  }

  const updated = await prisma.$transaction(async (tx) => {
    const m = await tx.membership.update({
      where: { id },
      data: { role: body.role, disabledAt: body.disabled === undefined ? undefined : body.disabled ? new Date() : null },
    })
    const owners = await tx.membership.count({ where: { workspaceId, role: 'OWNER', disabledAt: null } })
    if (owners < 1) throw createError({ statusCode: 400, statusMessage: 'A workspace needs at least one active owner' })
    await audit({ workspaceId, actor: user, action: 'member.updated', targetType: 'membership', targetId: id, details: body }, tx)
    return m
  })
  return { id: updated.id, role: updated.role, disabled: !!updated.disabledAt }
})
