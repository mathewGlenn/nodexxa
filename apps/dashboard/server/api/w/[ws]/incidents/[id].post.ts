import { z } from 'zod'

/** Acknowledge or manually resolve an incident. Viewers may acknowledge (on-call workflow), not resolve. */
export default defineEventHandler(async (event) => {
  const { user, membership, workspaceId } = await requireMember(event)
  const id = idParam(event)
  const { action } = await parseBody(event, z.object({ action: z.enum(['acknowledge', 'resolve']) }))
  if (action === 'resolve' && !hasRole(membership.role, 'ADMIN')) throw createError({ statusCode: 403, statusMessage: 'Insufficient role' })
  const incident = await prisma.incident.findFirst({ where: { id, workspaceId } })
  if (!incident) notFound('Incident not found')
  if (incident.status === 'RESOLVED') throw createError({ statusCode: 409, statusMessage: 'Incident already resolved' })
  if (action === 'acknowledge') {
    await prisma.incident.update({ where: { id }, data: { status: 'ACKNOWLEDGED', acknowledgedAt: new Date(), acknowledgedById: user.id } })
  }
  else {
    await resolveIncident(id, workspaceId, new Date(), `Resolved manually by ${user.email}`)
  }
  await audit({ workspaceId, actor: user, action: `incident.${action}`, targetType: 'incident', targetId: id })
  return { ok: true }
})
