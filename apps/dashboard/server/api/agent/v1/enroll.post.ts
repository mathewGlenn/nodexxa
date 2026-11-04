/**
 * Exchanges a one-time enrollment token for an agent identity bound to the agent's Ed25519 public key.
 * The private key never leaves the host; the server stores only the public key.
 */
export default defineEventHandler(async (event) => {
  await enforceRateLimit(`enroll:ip:${clientIp(event)}`, env().NODEXXA_RATE_LIMIT_ENROLL_IP, 600)
  const body = await readLimitedBody(event, 16 * 1024)
  const parsed = enrollRequestSchema.safeParse(parseJson(body))
  if (!parsed.success) throw createError({ statusCode: 400, statusMessage: 'Invalid enrollment request' })
  const req = parsed.data
  if (!SUPPORTED_PROTOCOL_VERSIONS.includes(req.protocolVersion)) {
    throw createError({ statusCode: 426, statusMessage: 'Unsupported protocol version', data: { supported: SUPPORTED_PROTOCOL_VERSIONS } })
  }

  const agent = await prisma.$transaction(async (tx) => {
    // Atomic single-use claim: concurrent or repeated use of the same token fails.
    const token = await tx.enrollmentToken.findUnique({ where: { tokenHash: sha256(req.enrollmentToken) } })
    const claimed = token && await tx.enrollmentToken.updateMany({
      where: { id: token.id, usedAt: null, expiresAt: { gt: new Date() } },
      data: { usedAt: new Date() },
    })
    if (!token || !claimed?.count) throw createError({ statusCode: 401, statusMessage: 'Enrollment token invalid, expired or already used' })
    const created = await tx.agent.create({
      data: {
        workspaceId: token.workspaceId, hostname: req.hostname, os: req.os, arch: req.arch, agentVersion: req.agentVersion,
        protocolVersion: req.protocolVersion, capabilities: req.capabilities, publicKey: req.publicKey, displayName: token.label,
      },
    })
    await tx.enrollmentToken.update({ where: { id: token.id }, data: { agentId: created.id } })
    await audit({ workspaceId: token.workspaceId, actor: `agent:${req.hostname}`, action: 'agent.enrolled', targetType: 'agent', targetId: created.id, details: { hostname: req.hostname, version: req.agentVersion } }, tx)
    return created
  })

  setResponseStatus(event, 201)
  return { agentId: agent.id, protocolVersion: PROTOCOL_VERSION, ingestIntervalSec: 60, maxSnapshots: MAX_SNAPSHOTS }
})
