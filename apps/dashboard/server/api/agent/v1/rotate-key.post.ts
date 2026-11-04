/** Credential rotation: a request signed by the current key installs a new public key (with proof of possession). */
export default defineEventHandler(async (event) => {
  const body = await readLimitedBody(event, 4096)
  const agent = await authenticateAgent(event, body)
  const parsed = rotateKeyRequestSchema.safeParse(parseJson(body))
  if (!parsed.success) throw createError({ statusCode: 400, statusMessage: 'Invalid rotation request' })
  const { newPublicKey, proof } = parsed.data
  if (newPublicKey === agent.publicKey || !verifyEd25519(newPublicKey, `nodexxa-v1-rotate\n${agent.id}\n${newPublicKey}`, proof)) {
    throw createError({ statusCode: 400, statusMessage: 'Invalid rotation proof' })
  }
  const keyRotatedAt = new Date()
  await prisma.agent.update({ where: { id: agent.id }, data: { publicKey: newPublicKey, keyRotatedAt } })
  await audit({ workspaceId: agent.workspaceId, actor: `agent:${agent.hostname}`, action: 'agent.key_rotated', targetType: 'agent', targetId: agent.id })
  return { ok: true, keyRotatedAt }
})
