import { randomUUID } from 'node:crypto'

export default defineEventHandler(async (event) => {
  const { user, workspaceId } = await requireMember(event, 'ADMIN')
  const body = await parseBody(event, connectionCreateSchema)
  await enforceRateLimit(`connection-verify:${user.id}`, 20, 600)

  const id = randomUUID()
  const tokenCiphertext = encryptSecret(body.token, `connection:${id}`)
  let team
  try {
    team = await verifyToken(connectionClient({ id, tokenCiphertext }))
  }
  catch (e) {
    const message = e instanceof DoApiError ? e.message : 'Token verification failed'
    throw createError({ statusCode: 400, statusMessage: message })
  }
  try {
    const conn = await prisma.connection.create({
      data: {
        id, workspaceId, label: body.label, client: body.client || null, tokenCiphertext, tokenSuffix: body.token.slice(-4),
        teamUuid: team.teamUuid, teamName: team.teamName, nextSyncAt: new Date(),
      },
    })
    await audit({ workspaceId, actor: user, action: 'connection.created', targetType: 'connection', targetId: id, details: { label: body.label, team: team.teamName } })
    return connectionView(conn)
  }
  catch (e) {
    if (isUniqueViolation(e)) throw createError({ statusCode: 409, statusMessage: 'A connection with this label already exists' })
    throw e
  }
})
