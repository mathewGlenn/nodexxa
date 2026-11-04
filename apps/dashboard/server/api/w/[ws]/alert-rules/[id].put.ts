export default defineEventHandler(async (event) => {
  const { user, workspaceId } = await requireMember(event, 'ADMIN')
  const id = idParam(event)
  const { threshold, ...body } = await parseBody(event, alertRuleSchema)
  const { count } = await prisma.alertRule.updateMany({ where: { id, workspaceId }, data: { ...body, params: threshold === undefined ? {} : { threshold } } })
  if (!count) notFound('Rule not found')
  if (!body.enabled) {
    const open = await prisma.incident.findMany({ where: { ruleId: id, status: { not: 'RESOLVED' } }, select: { id: true } })
    for (const inc of open) await resolveIncident(inc.id, workspaceId, new Date(), 'Rule disabled')
    await prisma.alertState.deleteMany({ where: { ruleId: id } })
  }
  await audit({ workspaceId, actor: user, action: 'alert_rule.updated', targetType: 'alert_rule', targetId: id, details: { ...body, threshold } })
  const rule = await prisma.alertRule.findUniqueOrThrow({ where: { id } })
  return { ...rule, threshold: ruleThreshold(rule) }
})
