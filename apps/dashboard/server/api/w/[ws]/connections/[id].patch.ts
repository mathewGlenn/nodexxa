export default defineEventHandler(async (event) => {
  const { user, workspaceId } = await requireMember(event, 'ADMIN')
  const id = idParam(event)
  const body = await parseBody(event, connectionUpdateSchema)
  const conn = await prisma.connection.findFirst({ where: { id, workspaceId } })
  if (!conn) notFound('Connection not found')

  const data: Record<string, unknown> = { label: body.label, client: body.client, enabled: body.enabled }
  if (body.enabled === false) data.status = 'DISABLED'
  if (body.enabled === true && conn.status === 'DISABLED') Object.assign(data, { status: 'PENDING', nextSyncAt: new Date() })

  if (body.token) {
    await enforceRateLimit(`connection-verify:${user.id}`, 20, 600)
    const tokenCiphertext = encryptSecret(body.token, `connection:${id}`)
    let team
    try {
      team = await verifyToken(connectionClient({ id, tokenCiphertext }))
    }
    catch (e) {
      throw createError({ statusCode: 400, statusMessage: e instanceof DoApiError ? e.message : 'Token verification failed' })
    }
    // A rotated token must belong to the same DO team, otherwise inventories of two accounts would merge.
    if (conn.teamUuid && team.teamUuid && conn.teamUuid !== team.teamUuid) {
      throw createError({ statusCode: 400, statusMessage: 'New token belongs to a different DigitalOcean team; create a separate connection instead' })
    }
    Object.assign(data, { tokenCiphertext, tokenSuffix: body.token.slice(-4), tokenRotatedAt: new Date(), status: 'PENDING', lastError: null, consecutiveFailures: 0, nextSyncAt: new Date() })
  }

  try {
    const updated = await prisma.connection.update({ where: { id }, data })
    const { token: _token, ...safeDetails } = body
    await audit({ workspaceId, actor: user, action: body.token ? 'connection.token_rotated' : 'connection.updated', targetType: 'connection', targetId: id, details: safeDetails })
    return connectionView(updated)
  }
  catch (e) {
    if (isUniqueViolation(e)) throw createError({ statusCode: 409, statusMessage: 'A connection with this label already exists' })
    throw e
  }
})
