export default defineEventHandler(async (event) => {
  const { workspaceId } = await requireMember(event)
  const rules = await prisma.alertRule.findMany({ where: { workspaceId }, orderBy: { name: 'asc' } })
  return rules.map(r => ({ ...r, threshold: ruleThreshold(r) }))
})
