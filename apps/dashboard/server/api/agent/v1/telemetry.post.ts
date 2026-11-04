export default defineEventHandler(async (event) => {
  const body = await readLimitedBody(event)
  const agent = await authenticateAgent(event, body)
  // Per-agent ingest frequency bound (normal cadence is 1/min; allows queue catch-up bursts).
  if (!(await hitRateLimit(`ingest:${agent.id}`, 20, 60))) throw createError({ statusCode: 429, statusMessage: 'Too many requests' })

  const json = parseJson(body) as { protocolVersion?: unknown }
  if (typeof json?.protocolVersion === 'number' && !SUPPORTED_PROTOCOL_VERSIONS.includes(json.protocolVersion)) {
    throw createError({ statusCode: 426, statusMessage: 'Unsupported protocol version', data: { supported: SUPPORTED_PROTOCOL_VERSIONS } })
  }
  const parsed = telemetryRequestSchema.safeParse(json)
  if (!parsed.success) {
    throw createError({ statusCode: 400, statusMessage: 'Invalid telemetry payload', data: { issues: parsed.error.issues.slice(0, 10).map(i => ({ path: i.path.join('.'), message: i.message })) } })
  }
  const result = await ingestTelemetry(agent, parsed.data)
  setResponseStatus(event, 202)
  return { ...result, ingestIntervalSec: 60, serverTime: new Date().toISOString() }
})
