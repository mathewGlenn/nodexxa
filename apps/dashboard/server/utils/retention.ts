import { prisma } from './db'

export const RETENTION = {
  rawMetricsDays: Number(process.env.NODEXXA_RETENTION_RAW_DAYS ?? 2),
  rollupMetricsDays: Number(process.env.NODEXXA_RETENTION_ROLLUP_DAYS ?? 90),
  checkResultsDays: Number(process.env.NODEXXA_RETENTION_CHECK_DAYS ?? 30),
  resolvedIncidentsDays: 180,
  auditDays: 365,
  missingResourceDays: 30,
}

/**
 * Downsamples raw metrics older than rawMetricsDays into hourly averages (source suffixed ":1h"),
 * then expires old rollups, check results, sessions, rate-limit windows and long-missing inventory.
 */
export async function runRetention(now = new Date()) {
  const day = 86400_000
  const rawCutoff = new Date(now.getTime() - RETENTION.rawMetricsDays * day)
  const rolledUp = await prisma.$executeRaw`
    WITH moved AS (
      DELETE FROM "MetricSample" WHERE "ts" < ${rawCutoff} AND "source" NOT LIKE '%:1h'
      RETURNING "workspaceId", "seriesKey", "metric", "ts", "value", "source"
    )
    INSERT INTO "MetricSample" ("workspaceId", "seriesKey", "metric", "ts", "value", "source")
    SELECT "workspaceId", "seriesKey", "metric", date_trunc('hour', "ts"), avg("value"), min("source") || ':1h'
    FROM moved GROUP BY "workspaceId", "seriesKey", "metric", date_trunc('hour', "ts")
    ON CONFLICT ("seriesKey", "metric", "ts") DO UPDATE SET "value" = EXCLUDED."value", "source" = EXCLUDED."source"`
  const [rollups, checkResults, sessions, rateLimits, incidents, audit, missing, enrollments] = await prisma.$transaction([
    prisma.metricSample.deleteMany({ where: { ts: { lt: new Date(now.getTime() - RETENTION.rollupMetricsDays * day) } } }),
    prisma.checkResult.deleteMany({ where: { ts: { lt: new Date(now.getTime() - RETENTION.checkResultsDays * day) } } }),
    prisma.session.deleteMany({ where: { expiresAt: { lt: now } } }),
    prisma.rateLimit.deleteMany({ where: { windowStart: { lt: new Date(now.getTime() - day) } } }),
    prisma.incident.deleteMany({ where: { status: 'RESOLVED', resolvedAt: { lt: new Date(now.getTime() - RETENTION.resolvedIncidentsDays * day) } } }),
    prisma.auditLog.deleteMany({ where: { createdAt: { lt: new Date(now.getTime() - RETENTION.auditDays * day) } } }),
    prisma.resource.deleteMany({ where: { missingSince: { lt: new Date(now.getTime() - RETENTION.missingResourceDays * day) } } }),
    prisma.enrollmentToken.deleteMany({ where: { expiresAt: { lt: new Date(now.getTime() - 7 * day) } } }),
  ])
  return {
    rolledUp, rollupsExpired: rollups.count, checkResults: checkResults.count, sessions: sessions.count, rateLimits: rateLimits.count,
    incidents: incidents.count, audit: audit.count, missingResources: missing.count, enrollments: enrollments.count,
  }
}
