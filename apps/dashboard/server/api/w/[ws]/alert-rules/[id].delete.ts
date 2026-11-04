export default defineEventHandler(async (event) => {
  const { user, workspaceId } = await requireMember(event, 'ADMIN')
  const id = idParam(event)
  const open = await prisma.incident.findMany({ where: { ruleId: id, workspaceId, status: { not: 'RESOLVED' } }, select: { id: true } })
  for (const inc of open) await resolveIncident(inc.id, workspaceId, new Date(), 'Rule deleted')
  const { count } = await prisma.alertRule.deleteMany({ where: { id, workspaceId } })
  if (!count) notFound('Rule not found')
  await audit({ workspaceId, actor: user, action: 'alert_rule.deleted', targetType: 'alert_rule', targetId: id })
  return { ok: true }
})
