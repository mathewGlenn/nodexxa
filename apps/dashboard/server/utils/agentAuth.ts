import { createPublicKey, verify } from 'node:crypto'
import type { H3Event } from 'h3'
import { createError, getRequestHeader, getRequestURL, readRawBody } from 'h3'
import type { Agent } from '@prisma/client'
import { prisma } from './db'
import { sha256 } from './crypto'
import { CLOCK_SKEW_SEC, MAX_BODY_BYTES, signingString } from './protocol'

// Deliberately generic: failures never reveal whether an agent exists or why a signature failed.
const MAX_SEQ = BigInt('9223372036854775807') // Postgres BIGINT max
const unauthorized = () => createError({ statusCode: 401, statusMessage: 'Unauthorized' })

export function verifyEd25519(publicKeyB64: string, message: string | Buffer, signatureB64: string): boolean {
  try {
    const raw = Buffer.from(publicKeyB64, 'base64')
    if (raw.length !== 32) return false
    const key = createPublicKey({ key: { kty: 'OKP', crv: 'Ed25519', x: raw.toString('base64url') }, format: 'jwk' })
    const sig = Buffer.from(signatureB64, 'base64')
    return sig.length === 64 && verify(null, Buffer.isBuffer(message) ? message : Buffer.from(message), key, sig)
  }
  catch {
    return false
  }
}

/** Reads the body with a hard size limit. Requires Content-Length so oversize bodies are rejected before reading. */
export async function readLimitedBody(event: H3Event, limit = MAX_BODY_BYTES): Promise<Buffer> {
  const declared = Number(getRequestHeader(event, 'content-length'))
  if (!Number.isFinite(declared) || declared <= 0) throw createError({ statusCode: 411, statusMessage: 'Content-Length required' })
  if (declared > limit) throw createError({ statusCode: 413, statusMessage: 'Payload too large' })
  const body = (await readRawBody(event, false)) ?? Buffer.alloc(0)
  if (body.length > limit) throw createError({ statusCode: 413, statusMessage: 'Payload too large' })
  return body
}

export function parseJson(body: Buffer): unknown {
  try { return JSON.parse(body.toString('utf8')) }
  catch { throw createError({ statusCode: 400, statusMessage: 'Malformed JSON' }) }
}

/**
 * Authenticates a signed agent request:
 *  1. headers well-formed, timestamp within ±CLOCK_SKEW_SEC
 *  2. Ed25519 signature over method, path, agent id, timestamp, sequence and body hash
 *  3. strictly increasing sequence, enforced atomically (replay protection)
 */
export async function authenticateAgent(event: H3Event, body: Buffer): Promise<Agent> {
  const agentId = getRequestHeader(event, 'x-nodexxa-agent-id') ?? ''
  const timestamp = getRequestHeader(event, 'x-nodexxa-timestamp') ?? ''
  const seq = getRequestHeader(event, 'x-nodexxa-seq') ?? ''
  const signature = getRequestHeader(event, 'x-nodexxa-signature') ?? ''
  if (!/^[0-9a-f-]{36}$/.test(agentId) || !/^\d{1,12}$/.test(timestamp) || !/^\d{1,19}$/.test(seq) || !/^[\w+/]{86}==$/.test(signature)) throw unauthorized()
  if (BigInt(seq) > MAX_SEQ || BigInt(seq) === BigInt(0)) throw unauthorized()
  if (Math.abs(Date.now() / 1000 - Number(timestamp)) > CLOCK_SKEW_SEC) throw createError({ statusCode: 401, statusMessage: 'Request timestamp outside allowed window' })

  const agent = await prisma.agent.findUnique({ where: { id: agentId } })
  if (!agent || agent.status !== 'ACTIVE') throw unauthorized()
  const message = signingString(event.method, getRequestURL(event).pathname, agentId, timestamp, seq, sha256(body))
  if (!verifyEd25519(agent.publicKey, message, signature)) throw unauthorized()

  const now = new Date()
  const updated = await prisma.agent.updateMany({
    where: { id: agentId, status: 'ACTIVE', lastSeq: { lt: BigInt(seq) } },
    data: { lastSeq: BigInt(seq), lastSeenAt: now },
  })
  if (!updated.count) throw createError({ statusCode: 409, statusMessage: 'Replayed or out-of-order request' })
  return { ...agent, lastSeq: BigInt(seq), lastSeenAt: now }
}
