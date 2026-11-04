export default defineEventHandler(async (event) => {
  const { user, workspaceId } = await requireMember(event, 'ADMIN')
  const { threshold, ...body } = await parseBody(event, alertRuleSchema)
  if ((await prisma.alertRule.count({ where: { workspaceId } })) >= 200) throw createError({ statusCode: 400, statusMessage: 'Rule limit reached' })
  const rule = await prisma.alertRule.create({ data: { ...body, workspaceId, params: threshold === undefined ? {} : { threshold } } })
  await audit({ workspaceId, actor: user, action: 'alert_rule.created', targetType: 'alert_rule', targetId: rule.id, details: { ...body, threshold } })
  return { ...rule, threshold: ruleThreshold(rule) }
})
