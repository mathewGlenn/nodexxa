import { prisma } from './db'
import { probe } from './probe'

/** Executes one check, records the result and schedules the next run. Called by the worker only. */
export async function runCheck(checkId: string) {
  const check = await prisma.check.findUnique({ where: { id: checkId } })
  if (!check || !check.enabled) return null
  const result = await probe({
    url: check.url, method: check.method === 'HEAD' ? 'HEAD' : 'GET', timeoutMs: check.timeoutMs, followRedirects: check.followRedirects,
    expectedStatusMin: check.expectedStatusMin, expectedStatusMax: check.expectedStatusMax,
  })
  const now = new Date()
  await prisma.$transaction([
    prisma.checkResult.create({ data: { checkId, ts: now, ok: result.ok, httpStatus: result.httpStatus, latencyMs: result.latencyMs, error: result.error } }),
    prisma.check.update({
      where: { id: checkId },
      data: {
        lastStatus: result.ok ? 'up' : 'down', lastCheckedAt: now, lastLatencyMs: result.latencyMs, lastHttpStatus: result.httpStatus,
        lastError: result.error, consecutiveFailures: result.ok ? 0 : { increment: 1 },
        tlsExpiresAt: result.tlsExpiresAt ?? (check.url.startsWith('https:') ? check.tlsExpiresAt : null),
        nextRunAt: new Date(now.getTime() + check.intervalSec * 1000), leaseOwner: null, leaseUntil: null,
      },
    }),
  ])
  return result
}
